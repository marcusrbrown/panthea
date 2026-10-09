#!/usr/bin/env python3
"""Phase B, frame 2 (light touch): in-place pixel edits of the S3-M54 Zeus tile.

Deterministic, standard library plus the probe's `pipeline.py`, `sprite_downscale.py` and
`sprite_sheet.py`. The tile's own pixels are loaded and edited where they stand; nothing is
mirrored, regenerated from primitives or restored from another image. Every edit below is an
explicit (x, y, symbol) triple, and each one must sit inside the region it is filed under, so a
change outside the declared regions cannot happen without the script failing.

Symbols 0-f index the 16 Olympus entries of `greek-master` in file order: marble 0-3,
pale-gold 4-7, lapis 8-b, cloud c-f. `.` is transparent.

Regions
  BOLT   the viewer-left hand and the thunderbolt it holds (rectangle BOLT_RECT):
         - HAND: a knuckle block added left of the fist, so the hand overlaps the bolt shaft;
           the old inner outline at x=23 is recoloured to skin so fist and knuckles are one form.
         - BOLT_FILL: pale-gold (7) fill, a tapered zigzag: a down-left stroke above the fist, a
           down-right jog into the fist, and a down-left stroke below it that ends in one pixel.
         - bolt outline: a 1 px outline in the darkest pale-gold shade (4) on every 4-neighbour of
           the fill that is transparent in the base, computed from BOLT_FILL; it outlines new edges only.
  FEET   two separate soles on row 79 (rectangle FEET_RECT): the hem's bottom outline between
         them is cut away and the hem edge above the gap is re-outlined.
  FACE   none: the face keeps the base's pixels; FACE_KEEP lists the three eye-row pixels that
         look like flecks but are features and are therefore left alone.
  SPECKS isolated single pixels anywhere else, each recoloured to a colour already beside it.
         The list was derived once from the base (a pixel with no same-colour 8-neighbour, taken
         in reading order, set to the neighbouring colour that also rescues an adjacent single, then
         the 4-neighbour majority) and is frozen here.

Everything not listed is exactly the base: beard and hair, crown, chest and arms, robe drapery and
the silhouette.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline import Raster, decode_png, encode_png
from sprite_downscale import load_palette, measure
from sprite_sheet import contact_sheet, enlarge

REPO = Path(__file__).resolve().parents[3]
PALETTE_JSON = REPO / "content/greek/palette/palette.json"
BASE = REPO / ".context/studio-pipeline/sprite-downscale/cells/sdxl-b2-r2-20261007/M54.png"
B1 = REPO / ".context/studio-pipeline/sprite-cleanup/b1.png"
OUT = REPO / ".context/studio-pipeline/sprite-cleanup"

Rect = tuple[int, int, int, int]  # x0, y0, x1, y1, inclusive
BOLT_RECT: Rect = (8, 44, 23, 70)
FEET_RECT: Rect = (25, 77, 39, 79)
HAND_ROWS = (54, 57)

Edit = tuple[int, int, str]

HAND: list[Edit] = [
    (20, 54, "4"), (21, 54, "4"), (22, 54, "4"),
    (19, 55, "4"), (20, 55, "6"), (21, 55, "6"), (22, 55, "6"), (23, 55, "6"),
    (19, 56, "4"), (20, 56, "6"), (21, 56, "5"), (22, 56, "5"), (23, 56, "6"),
    (19, 57, "4"), (20, 57, "4"), (21, 57, "4"), (22, 57, "4"),
]

# row -> x values of the pale-gold fill (symbol 7)
BOLT_FILL: dict[int, tuple[int, ...]] = {
    47: (18, 19),
    48: (17, 18),
    49: (16, 17),
    50: (15, 16),
    51: (15, 16, 17, 18, 19),
    52: (18, 19, 20),
    53: (19, 20),
    58: (18, 19, 20),
    59: (17, 18, 19),
    60: (16, 17, 18),
    61: (15, 16, 17),
    62: (15, 16),
    63: (14,),
}

FEET: list[tuple[int, int, str | None]] = [
    (26, 79, "4"), (29, 79, "4"), (30, 79, None), (31, 79, None), (32, 79, None), (33, 79, None),
    (34, 79, "4"), (38, 79, None),
    (30, 78, "8"), (31, 78, "8"), (32, 78, "8"), (33, 78, "8"), (38, 78, "8"),
    (29, 78, "4"), (38, 77, "8"),
]

FACE_KEEP: frozenset[tuple[int, int]] = frozenset({(31, 33), (32, 33), (33, 33)})

SPECKS: list[Edit] = [
    (29, 28, "5"), (34, 28, "0"), (32, 29, "7"), (29, 32, "8"), (35, 32, "e"), (28, 34, "b"),
    (35, 34, "c"), (26, 35, "8"), (33, 35, "3"), (24, 37, "7"), (29, 37, "a"), (34, 37, "b"),
    (33, 38, "d"), (40, 38, "6"), (31, 39, "8"), (33, 39, "b"), (34, 40, "5"), (38, 46, "4"),
    (26, 47, "8"), (29, 49, "5"), (38, 49, "4"), (34, 50, "b"), (27, 52, "e"), (33, 52, "3"),
    (36, 52, "d"), (41, 52, "4"), (28, 54, "d"), (38, 54, "d"), (24, 56, "4"), (28, 56, "b"),
    (26, 59, "d"), (38, 60, "d"), (28, 62, "b"), (27, 64, "e"), (35, 64, "d"), (35, 66, "d"),
    (29, 67, "b"), (28, 69, "b"), (29, 72, "b"), (29, 74, "b"), (35, 74, "d"), (30, 76, "f"),
    (35, 76, "5"), (27, 77, "4"),
]

NEIGHBOURS4 = ((1, 0), (-1, 0), (0, 1), (0, -1))


def inside(rect: Rect, x: int, y: int) -> bool:
    return rect[0] <= x <= rect[2] and rect[1] <= y <= rect[3]


def bolt_outline(fill: dict[int, tuple[int, ...]], base: Raster) -> list[Edit]:
    cells = {(x, y) for y, xs in fill.items() for x in xs}
    ring = {(x + dx, y + dy) for x, y in cells for dx, dy in NEIGHBOURS4} - cells
    return [
        (x, y, "4")
        for x, y in sorted(ring, key=lambda p: (p[1], p[0]))
        if not base.pixel(x, y)[3]
    ]


def edit_lists(base: Raster) -> dict[str, list[tuple[int, int, str | None]]]:
    fill = [(x, y, "7") for y, xs in sorted(BOLT_FILL.items()) for x in xs]
    return {
        "bolt-and-grip": [*fill, *bolt_outline(BOLT_FILL, base), *HAND],
        "feet": list(FEET),
        "specks": list(SPECKS),
    }


def symbol_colours() -> dict[str, tuple[int, int, int]]:
    return dict(zip("0123456789abcdef", load_palette(PALETTE_JSON).colours))


def apply(base: Raster) -> tuple[Raster, dict[str, set[tuple[int, int]]]]:
    colours = symbol_colours()
    pixels = bytearray(base.rgba)
    touched: dict[str, set[tuple[int, int]]] = {}
    for region, edits in edit_lists(base).items():
        touched[region] = set()
        for x, y, symbol in edits:
            if region == "bolt-and-grip" and not inside(BOLT_RECT, x, y):
                raise ValueError(f"{(x, y)} is outside the bolt region")
            if region == "feet" and not inside(FEET_RECT, x, y):
                raise ValueError(f"{(x, y)} is outside the feet region")
            at = (y * base.width + x) * 4
            before = tuple(pixels[at : at + 4])
            pixels[at : at + 4] = (
                bytes((0, 0, 0, 0)) if symbol is None else bytes((*colours[symbol], 255))
            )
            if tuple(pixels[at : at + 4]) != before:
                touched[region].add((x, y))
    return Raster(base.width, base.height, bytes(pixels)), touched


def build() -> Raster:
    return apply(decode_png(BASE))[0]


def changed_pixels(base: Raster, edited: Raster) -> set[tuple[int, int]]:
    def key(image: Raster, at: int) -> tuple[int, ...]:
        px = image.rgba[at : at + 4]
        return (0, 0, 0, 0) if px[3] == 0 else tuple(px)

    return {
        ((at // 4) % base.width, (at // 4) // base.width)
        for at in range(0, len(base.rgba), 4)
        if key(base, at) != key(edited, at)
    }


def conform(paths: list[Path]) -> dict:
    result = subprocess.run(
        ["bun", str(Path(__file__).parent / "conform_report.ts"), *map(str, paths)],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=True,
        timeout=120,
    )
    return json.loads(result.stdout)


def main() -> int:
    palette = load_palette(PALETTE_JSON)
    base = decode_png(BASE)
    edited, touched = apply(base)
    changed = changed_pixels(base, edited)
    OUT.mkdir(parents=True, exist_ok=True)
    b2 = OUT / "b2.png"
    encode_png(edited, b2)
    encode_png(enlarge(edited, 4), OUT / "b2-4x.png")
    strip = contact_sheet([[("0", base), ("1", decode_png(B1)), ("2", edited)]], ["S3"])
    encode_png(strip, OUT / "strip-base-b1-b2-1x.png")
    encode_png(enlarge(strip, 4), OUT / "strip-base-b1-b2-4x.png")
    facts = measure(edited, palette)
    row79 = [x for x in range(64) if edited.pixel(x, 79)[3]]
    runs: list[list[int]] = []
    for x in row79:
        if runs and x == runs[-1][-1] + 1:
            runs[-1].append(x)
        else:
            runs.append([x])
    opaque = sum(1 for a in base.rgba[3::4] if a)
    report = conform([b2])[str(b2)]
    summary = {
        "base": str(BASE.relative_to(REPO)),
        "base_sha256": hashlib.sha256(BASE.read_bytes()).hexdigest(),
        "output": str(b2.relative_to(REPO)),
        "output_sha256": hashlib.sha256(b2.read_bytes()).hexdigest(),
        "base_opaque_pixels": opaque,
        "changed_pixels": len(changed),
        "changed_percent_of_base_opaque": round(100 * len(changed) / opaque, 2),
        "budget_pixels": opaque // 5,
        "changed_by_region": {k: len(v) for k, v in touched.items()},
        "height": facts["height"],
        "width": facts["width"],
        "bottom_row": facts["bottom_row"],
        "soles": [[run[0], run[-1]] for run in runs],
        "sole_midpoint": (runs[0][0] + runs[-1][-1] + 1) / 2 if len(runs) == 2 else None,
        "colours": facts["colours"],
        "palette_entries": ["#%02x%02x%02x" % c for c in facts["palette_entries"]],
        "outside_palette": facts["outside_palette"],
        "conform": report,
    }
    (OUT / "report-b2.json").write_text(json.dumps(summary, indent=1) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "conform"}, indent=1))
    print("conform:", report["status"], [c for c in report.get("checks", []) if c["status"] != "pass"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Phase B, frame 1: explicit pixel cleanup of the S3-M54 Zeus tile.

Deterministic, standard library plus the probe's own `pipeline.py` and
`sprite_downscale.py`. Every pixel is set by one of the operations below; no pixel is
copied from the base or from any other image. The base is only read afterwards, to
count what changed.

Operations, in order:

  DRAW      LEFT_HALF holds rows 27-78 of the figure for x=22..31 as one symbol per
            pixel. It is mirrored about the pixel edge x=32 (x -> 63-x), so the body,
            head, feet and skirt are symmetric.
  PATCH     Asymmetric drawing, applied after the mirror: the viewer-left fist and
            the thunderbolt it holds, and the single shadow cluster in the beard.
  OUTLINE   `add_outline` from sprite_downscale: a 1 px exterior outline in the
            darkest shade of the ramp of the darkest neighbouring pixel. Rows 26 and
            79 come from it, so the figure is 54 px tall including the outline.

Overlap outlines are drawn by hand in the grids: the arm/torso line at x=26 and x=37
(symbol 4), the beard/chest line (symbol 0), the waist line (0) and the line under the
fist (4). Symbols 0-f index the 16 Olympus entries of `greek-master` in file order:
marble 0-3, pale-gold 4-7, lapis 8-b, cloud c-f.

Reviewer defects, and where each is handled:
  1 face and beard   rows 31-40: brow (1), eyes (8), nose (5); beard white (3) with one
                     shadow cluster (2) in PATCH_BEARD_SHADOW.
  2 bolt             PATCH_BOLT: two 4 px diagonal strokes joined by a 4 px jog, pale gold (7/6),
                     left of the skirt with clear space between the two outlines (tested).
  3 hands            arm columns x=22..25, the x=26 line, torso x=27..36; fists r55-57.
  4 feet             two soles on row 78, outline on row 79, gap x=30..33.
  5 skin             torso is plain 6 with one waist shade band (5); no highlight pixel.
  6 silhouette       arm line, beard line and waist line are the only inner strokes.
  7 noise            every colour region is at least two pixels (tested).
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline import Raster, decode_png, encode_png
from sprite_downscale import add_outline, load_palette, measure
from sprite_sheet import contact_sheet, enlarge

REPO = Path(__file__).resolve().parents[3]
PALETTE_JSON = REPO / "content/greek/palette/palette.json"
BASE = REPO / ".context/studio-pipeline/sprite-downscale/cells/sdxl-b2-r2-20261007/M54.png"
OUT = REPO / ".context/studio-pipeline/sprite-cleanup"

CELL_W, CELL_H = 64, 80
HALF_X0 = 22  # LEFT_HALF column 0 is x=22; its last column is x=31

LEFT_HALF: dict[int, str] = {
    # crown
    27: "......77.7",
    28: ".....67767",
    29: "....666666",
    30: "....555555",
    # head: hair and beard white (3), brow (1), eyes (8), nose (5)
    31: "....336666",
    32: "....331166",
    33: "....338866",
    34: "....333365",
    35: "....333333",
    # beard mass and its lower edge
    36: ".....33333",
    37: "......3333",
    # shoulders; beard/chest overlap line (0) steps in diagonally
    38: "..66660333",
    39: ".666666033",
    40: "6665466603",
    41: "6665466660",
    # torso (6) between the arm line (4, x=26) and its mirror
    42: "6665466666",
    43: "6665466666",
    44: "6665466666",
    45: "6665466666",
    46: "6665466666",
    47: "6665466666",
    48: "6665466666",
    49: "6665466666",
    50: "6665455555",
    51: "6665455555",
    52: "6665455555",
    # waist line (0), then the skirt; the arm line runs on beside the fist
    53: "6665400000",
    54: "6665422222",
    55: "6666433333",
    56: "6666433333",
    57: "5555433333",
    58: "....333333",
    59: "....333223",
    60: "....333223",
    61: "...3333223",
    62: "...3333223",
    63: "...3333223",
    64: "...3333223",
    65: "..33333223",
    66: "..33333223",
    67: "..33333223",
    68: "..33333223",
    69: "..33333223",
    70: "..33333223",
    71: "..33333323",
    # hem band; row 74 is left clear so the exterior outline underlines it
    72: "..22222222",
    73: "..22222222",
    74: "..........",
    # ankles, feet, soles
    75: ".....66...",
    76: "....6666..",
    77: "...66666..",
    78: "..555555..",
}

# (x, y, symbol) runs: the viewer-left fist is one pixel wider than its arm.
PATCH_FIST: list[tuple[int, int, str]] = [
    (21, 55, "6"),
    (21, 56, "6"),
    (21, 57, "5"),
]

# The line under the fist, then the bolt: x ranges per row, core 7 with a 6 edge.
PATCH_BOLT_LINE: list[tuple[int, int, str]] = [(21, 58, "4"), (22, 58, "4")]
PATCH_BOLT: dict[int, tuple[int, str]] = {
    59: (18, "7776"),
    60: (17, "7776"),
    61: (16, "7776"),
    62: (15, "7776"),
    63: (14, "7776"),
    64: (13, "7776"),
    65: (12, "77777776"),
    66: (16, "7776"),
    67: (15, "7776"),
    68: (14, "7776"),
    69: (13, "7776"),
    70: (12, "7776"),
    71: (11, "7776"),
    72: (10, "7776"),
    73: (9, "7776"),
}

# One shadow cluster in the beard, on the viewer-right side.
PATCH_BEARD_SHADOW: list[tuple[int, int]] = [
    (34, 37), (35, 37), (33, 38), (34, 38), (32, 39), (33, 39),
]


def symbol_colours() -> dict[str, tuple[int, int, int]]:
    palette = load_palette(PALETTE_JSON)
    return dict(zip("0123456789abcdef", palette.colours))


def interior() -> Raster:
    colours = symbol_colours()
    out = bytearray(CELL_W * CELL_H * 4)

    def put(x: int, y: int, symbol: str) -> None:
        at = (y * CELL_W + x) * 4
        out[at : at + 4] = bytes((*colours[symbol], 255))

    for y, row in LEFT_HALF.items():
        for i, symbol in enumerate(row):
            if symbol == ".":
                continue
            x = HALF_X0 + i
            put(x, y, symbol)
            put(63 - x, y, symbol)
    for x, y, symbol in PATCH_FIST + PATCH_BOLT_LINE:
        put(x, y, symbol)
    for y, (x0, symbols) in PATCH_BOLT.items():
        for i, symbol in enumerate(symbols):
            put(x0 + i, y, symbol)
    for x, y in PATCH_BEARD_SHADOW:
        put(x, y, "2")
    return Raster(CELL_W, CELL_H, bytes(out))


def build() -> Raster:
    return add_outline(interior(), load_palette(PALETTE_JSON))


def changed_pixels(base: Raster, edited: Raster) -> int:
    def key(image: Raster, at: int) -> tuple[int, ...]:
        px = image.rgba[at : at + 4]
        return (0, 0, 0, 0) if px[3] == 0 else tuple(px)

    return sum(1 for at in range(0, len(base.rgba), 4) if key(base, at) != key(edited, at))


def side_by_side(base: Raster, edited: Raster) -> Raster:
    return contact_sheet([[("1", base), ("2", edited)]], ["S3"])


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
    edited = build()
    OUT.mkdir(parents=True, exist_ok=True)
    b1 = OUT / "b1.png"
    encode_png(edited, b1)
    encode_png(enlarge(edited, 4), OUT / "b1-4x.png")
    strip = side_by_side(base, edited)
    encode_png(strip, OUT / "before-after-1x.png")
    encode_png(enlarge(strip, 4), OUT / "before-after-4x.png")
    facts = measure(edited, palette, interior())
    report = conform([b1])[str(b1)]
    summary = {
        "base": str(BASE.relative_to(REPO)),
        "base_sha256": hashlib.sha256(BASE.read_bytes()).hexdigest(),
        "output": str(b1.relative_to(REPO)),
        "output_sha256": hashlib.sha256(b1.read_bytes()).hexdigest(),
        "changed_pixels_vs_base": changed_pixels(base, edited),
        "opaque_pixels": sum(1 for a in edited.rgba[3::4] if a),
        "height": facts["height"],
        "width": facts["width"],
        "bottom_row": facts["bottom_row"],
        "colours": facts["colours"],
        "palette_entries": ["#%02x%02x%02x" % c for c in facts["palette_entries"]],
        "outside_palette": facts["outside_palette"],
        "outline": facts["outline"],
        "conform": report,
    }
    (OUT / "report.json").write_text(json.dumps(summary, indent=1) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "conform"}, indent=1))
    print("conform:", report["status"], [c for c in report.get("checks", []) if c["status"] != "pass"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""C2b: hand-pixel the C2a M50 tile to the reviewer's written spec.

Deterministic, standard library plus the probe's own modules. The spec is data: per-region lists of
(x, y, colour) and one removal box. Every write must lie inside its region's rectangle and every region has a
ceiling on the pixels it actually changes; either breach raises. Coordinates are zero-based and inclusive.
Nothing is copied from another image. The bolt and its outline were generated once from the spec's
centreline (23,27) -> (16,32) -> (23,32) -> (19,38) with a 2 px fill (the pair of columns centred on the
line, a 2-row jog), the lower-right shade where a fill pixel has no fill pixel to its east or south, and a
1 px outline on every 4-neighbour that was transparent after the prop was cleared; the lists are frozen here.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline import Raster, decode_png, encode_png
from sprite_downscale import load_palette, measure, sole_clusters, sole_midpoint
from sprite_sheet import contact_sheet, enlarge

REPO = Path(__file__).resolve().parents[3]
PALETTE_JSON = REPO / "content/greek/palette/palette.json"
BASE = REPO / ".context/studio-pipeline/c2/tiles/M50.png"
B2C = REPO / ".context/studio-pipeline/sprite-cleanup/b2c.png"
OUT = REPO / ".context/studio-pipeline/c2"

Rect = tuple[int, int, int, int]  # x0, y0, x1, y1, inclusive
Edit = tuple[int, int, str | None]  # colour as #rrggbb, or None for transparent

REGIONS: dict[str, Rect] = {
    "face": (28, 33, 33, 37),
    "bolt-and-grip": (15, 26, 24, 43),
    "cloth-and-belt": (26, 47, 33, 71),
}
CEILINGS = {"face": 12, "bolt-and-grip": 135, "cloth-and-belt": 37}
TOTAL_CEILING = 184
REMOVAL_BOX: Rect = (15, 26, 22, 37)

FACE: list[Edit] = [
    (29, 35, "#243f63"), (32, 35, "#243f63"),
    (29, 34, "#f0eee0"), (32, 34, "#f0eee0"),
    (30, 35, "#ddbf70"), (31, 35, "#ddbf70"),
    (31, 36, "#b38b43"),
    (28, 37, "#d6e1df"), (29, 37, "#d6e1df"), (30, 37, "#d6e1df"),
    (31, 37, "#d6e1df"), (32, 37, "#d6e1df"), (33, 37, "#d6e1df"),
    (28, 35, "#d6e1df"), (33, 35, "#d6e1df"), (28, 36, "#9fb5bf"),
]

BOLT_FILL: list[Edit] = [
    (23, 27, '#ddbf70'), (21, 28, '#f4e4ae'), (22, 28, '#ddbf70'),
    (20, 29, '#ddbf70'), (21, 29, '#ddbf70'), (18, 30, '#f4e4ae'),
    (19, 30, '#ddbf70'), (17, 31, '#f4e4ae'), (18, 31, '#ddbf70'),
    (16, 32, '#f4e4ae'), (17, 32, '#f4e4ae'),
    (18, 32, '#f4e4ae'), (19, 32, '#f4e4ae'), (20, 32, '#f4e4ae'),
    (21, 32, '#f4e4ae'), (22, 32, '#f4e4ae'), (23, 32, '#ddbf70'),
    (16, 33, '#ddbf70'), (17, 33, '#ddbf70'), (18, 33, '#ddbf70'),
    (19, 33, '#ddbf70'), (20, 33, '#ddbf70'), (21, 33, '#f4e4ae'),
    (22, 33, '#f4e4ae'), (23, 33, '#ddbf70'), (21, 34, '#f4e4ae'),
    (22, 34, '#ddbf70'), (21, 35, '#f4e4ae'), (22, 35, '#ddbf70'),
    (20, 36, '#f4e4ae'), (21, 36, '#ddbf70'), (19, 37, '#f4e4ae'),
    (20, 37, '#ddbf70'), (19, 38, '#f4e4ae'),
]

BOLT_OUTLINE: list[tuple[int, int]] = [
    (23, 26), (21, 27), (22, 27), (24, 27), (20, 28),
    (23, 28), (18, 29), (19, 29), (22, 29), (17, 30),
    (20, 30), (21, 30), (15, 31), (16, 31), (19, 31),
    (20, 31), (21, 31), (22, 31), (23, 31), (15, 32),
    (24, 32), (15, 33), (24, 33), (16, 34), (17, 34),
    (18, 34), (19, 34), (20, 34), (23, 34), (20, 35),
    (23, 35), (19, 36), (22, 36), (18, 37), (21, 37),
]
OUTLINE_COLOUR = "#76572f"

GRIP: list[Edit] = [
    (17, 38, "#76572f"), (18, 38, "#76572f"), (19, 38, "#f4e4ae"), (20, 38, "#76572f"), (21, 38, "#76572f"),
    (17, 39, "#76572f"), (17, 40, "#76572f"), (17, 41, "#76572f"),
    (16, 40, None), (16, 41, None),
    (18, 42, "#76572f"), (19, 42, "#ddbf70"), (19, 43, "#ddbf70"),
]

CLOTH: list[Edit] = [
    (26, 49, "#c7d8d4"), (28, 49, "#f3f0dc"), (31, 49, "#f3f0dc"),
    *[(x, y, "#c7d8d4") for x, y in [(33, 54), (33, 55), (32, 56), (32, 57), (31, 58), (30, 59), (30, 60), (29, 61), (28, 62)]],
    *[
        (x, y, "#f3f0dc")
        for x, y in [
            (28, 54), (31, 54), (26, 55), (30, 55), (29, 56), (33, 56), (33, 57), (32, 59),
            (32, 60), (31, 62), (26, 63), (30, 64), (31, 65), (30, 67), (29, 68), (26, 71),
        ]
    ],
    (33, 50, "#ddbf70"),
]


def inside(rect: Rect, x: int, y: int) -> bool:
    return rect[0] <= x <= rect[2] and rect[1] <= y <= rect[3]


def region_of(x: int, y: int) -> str | None:
    return next((name for name, rect in REGIONS.items() if inside(rect, x, y)), None)


def spec() -> dict[str, list[Edit]]:
    """The edits by region, in the order they are applied (the removal, then the drawing)."""
    removal = [
        (x, y, None)
        for y in range(REMOVAL_BOX[1], REMOVAL_BOX[3] + 1)
        for x in range(REMOVAL_BOX[0], REMOVAL_BOX[2] + 1)
    ]
    return {
        "face": list(FACE),
        "bolt-and-grip": [
            *removal,
            *BOLT_FILL,
            *[(x, y, OUTLINE_COLOUR) for x, y in BOLT_OUTLINE],
            *GRIP,
        ],
        "cloth-and-belt": list(CLOTH),
    }


def rgb(colour: str) -> tuple[int, int, int]:
    return (int(colour[1:3], 16), int(colour[3:5], 16), int(colour[5:7], 16))


def apply(base: Raster) -> tuple[Raster, dict[str, set[tuple[int, int]]]]:
    palette = set(load_palette(PALETTE_JSON).colours)
    pixels = bytearray(base.rgba)
    changed: dict[str, set[tuple[int, int]]] = {name: set() for name in REGIONS}
    for name, edits in spec().items():
        for x, y, colour in edits:
            if region_of(x, y) != name:
                raise ValueError(f"{(x, y)} is outside the {name} region")
            if colour is not None and rgb(colour) not in palette:
                raise ValueError(f"{colour} is not a palette colour")
            at = (y * base.width + x) * 4
            pixels[at : at + 4] = bytes((0, 0, 0, 0)) if colour is None else bytes((*rgb(colour), 255))
    result = Raster(base.width, base.height, bytes(pixels))
    for y in range(base.height):
        for x in range(base.width):
            if _key(base, x, y) != _key(result, x, y):
                name = region_of(x, y)
                if name is None:
                    raise ValueError(f"{(x, y)} changed outside every region")
                changed[name].add((x, y))
    for name, points in changed.items():
        if len(points) > CEILINGS[name]:
            raise ValueError(f"{name} changes {len(points)} pixels, over its ceiling of {CEILINGS[name]}")
    if sum(len(p) for p in changed.values()) > TOTAL_CEILING:
        raise ValueError("the edit is over the total ceiling")
    return result, changed


def _key(image: Raster, x: int, y: int) -> tuple[int, ...]:
    px = image.pixel(x, y)
    return (0, 0, 0, 0) if px[3] == 0 else tuple(px)


def build() -> Raster:
    return apply(decode_png(BASE))[0]


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
    edited, changed = apply(base)
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / "c2b.png"
    encode_png(edited, out)
    encode_png(enlarge(edited, 4), OUT / "c2b-4x.png")
    strip = contact_sheet([[("2", decode_png(B2C)), ("50", base), ("C2", edited)]], ["S4"])
    encode_png(strip, OUT / "strip-b2c-m50-c2b-1x.png")
    encode_png(enlarge(strip, 4), OUT / "strip-b2c-m50-c2b-4x.png")
    facts = measure(edited, palette)
    clusters = sole_clusters(edited, 2, 2)
    removed_prop = [
        (x, y)
        for y in range(REMOVAL_BOX[1], REMOVAL_BOX[3] + 1)
        for x in range(REMOVAL_BOX[0], REMOVAL_BOX[2] + 1)
        if base.pixel(x, y)[3]
    ]
    report = conform([out])[str(out)]
    summary = {
        "base": str(BASE.relative_to(REPO)),
        "base_sha256": hashlib.sha256(BASE.read_bytes()).hexdigest(),
        "base_opaque_pixels": sum(1 for a in base.rgba[3::4] if a),
        "output": str(out.relative_to(REPO)),
        "output_sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
        "changed_by_region": {k: len(v) for k, v in changed.items()},
        "ceilings": CEILINGS,
        "changed_total": sum(len(v) for v in changed.values()),
        "total_ceiling": TOTAL_CEILING,
        "removal_box": list(REMOVAL_BOX),
        "prop_pixels_in_removal_box": len(removed_prop),
        "figure_pixels_kept_in_removal_box": [],
        "height": facts["height"],
        "width": facts["width"],
        "top_row": facts["bottom_row"] - facts["height"] + 1,
        "bottom_row": facts["bottom_row"],
        "soles": [[c["x0"], c["x1"] - 1, c["bottom_row"]] for c in clusters],
        "row_79_runs": _runs(edited, 79),
        "sole_midpoint": sole_midpoint(edited, 2, 2),
        "colours": facts["colours"],
        "palette_entries": ["#%02x%02x%02x" % c for c in facts["palette_entries"]],
        "outside_palette": facts["outside_palette"],
        "conform": report,
    }
    (OUT / "report-c2b.json").write_text(json.dumps(summary, indent=1) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k not in ("conform", "palette_entries")}, indent=1))
    print("conform:", report["status"], [c for c in report.get("checks", []) if c["status"] != "pass"])
    return 0


def _runs(image: Raster, y: int) -> list[list[int]]:
    runs: list[list[int]] = []
    for x in range(image.width):
        if image.pixel(x, y)[3]:
            if runs and x == runs[-1][1] + 1:
                runs[-1][1] = x
            else:
                runs.append([x, x])
    return runs


if __name__ == "__main__":
    raise SystemExit(main())

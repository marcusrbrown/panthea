#!/usr/bin/env python3
"""C2c: fix the outlines of the accepted C2b frame. Recolour only; the alpha mask is never touched.

Standard library plus the probe's own modules. The rules are the art guide's outline line ("selective
outline: 1 px, in the darkest shade of the local ramp, on the exterior silhouette and where forms overlap; no
outline between adjacent shades of one form"), applied by `plan()`:

  R1  every exterior pixel (opaque, 4-adjacent to transparent) becomes the darkest shade of the ramp of the
      form it bounds: the majority ramp of the non-dark pixels reached by walking inward (to pixels one
      step further from the edge) through dark pixels.
  R3  thinning: a dark pixel one step inside an exterior pixel that was dark (a 2 px band) becomes the
      next-darker shade of the form's ramp, where the pixel inward of it is a lighter form.
  R4  any other dark pixel inside the figure: where its non-dark neighbours span two ramps it is an overlap
      line and takes the darkest shade of the front form (gold in front of cloud); where they span one ramp it is
      a seam inside one form and takes that ramp's shadow tone (second shade).

There is no lit-side exception: the guide does not call for one.

The reviewer's rulings (A layer order, B ties and empties, C unresolved thinning, D overlap lines) are explicit
(x, y, colour) tables applied after the rules and take priority. The bolt, fist and grip pixels and the face
feature pixels of C2b are frozen. The figure has two forms: gold (skin, belt, boots) and cool-white cloth, hair
and beard, which is drawn from the cloud, marble and lapis highlight shades together; for outline purposes
every light non-gold shade belongs to the cloud ramp. Two further tables, E and F, hold pixels where the rules
misfire or a ruling implies a neighbour; both are labelled and counted.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from collections import Counter, deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline import Raster, decode_png, encode_png
from sprite_cleanup_c2b import BOLT_FILL, BOLT_OUTLINE, FACE, GRIP, rgb
from sprite_downscale import load_palette, measure, sole_clusters, sole_midpoint
from sprite_sheet import contact_sheet, enlarge

REPO = Path(__file__).resolve().parents[3]
PALETTE_JSON = REPO / "content/greek/palette/palette.json"
OUT = REPO / ".context/studio-pipeline/c2"
SOURCE = OUT / "c2b.png"

Point = tuple[int, int]
Override = tuple[int, int, str]
NEIGHBOURS = ((1, 0), (-1, 0), (0, 1), (0, -1))
GOLD_RAMP = "pale-gold"
FRONT_ORDER = ("pale-gold", "cloud", "marble", "lapis")

GOLD_DARK, GOLD_SHADOW = "#76572f", "#b38b43"
CLOUD_DARK, CLOUD_SHADOW = "#637b89", "#9fb5bf"

A_LAYER_ORDER: list[Override] = [
    (37, 48, CLOUD_DARK),
    (36, 49, CLOUD_DARK), (37, 49, CLOUD_SHADOW),
    *[(36, y, GOLD_DARK) for y in (50, 51, 52)],
    *[(37, y, CLOUD_SHADOW) for y in (50, 51, 52)],
    *[(36, y, CLOUD_DARK) for y in (53, 54, 55, 56)],
    *[(37, y, CLOUD_SHADOW) for y in (53, 54, 55, 56)],
    (37, 57, CLOUD_SHADOW),
    *[(37, y, CLOUD_DARK) for y in (58, 59, 60, 61, 62)],
]
B_TIES_AND_EMPTIES: list[Override] = [
    (35, 36, CLOUD_DARK), (25, 52, GOLD_DARK), (40, 64, CLOUD_DARK), (34, 77, GOLD_DARK),
    (22, 78, GOLD_DARK), (29, 78, GOLD_DARK), (34, 78, GOLD_DARK), (41, 78, GOLD_DARK),
    (23, 79, GOLD_DARK), (28, 79, GOLD_DARK), (35, 79, GOLD_DARK), (40, 79, GOLD_DARK),
]
C_UNRESOLVED_THINNING: list[Override] = [
    (24, 41, CLOUD_SHADOW), (24, 48, CLOUD_SHADOW), (23, 48, GOLD_DARK), (38, 75, CLOUD_SHADOW),
    (29, 76, GOLD_SHADOW),
    (23, 78, GOLD_SHADOW), (28, 78, GOLD_SHADOW), (35, 78, GOLD_SHADOW), (40, 78, GOLD_SHADOW),
]
D_OVERLAP_LINES: list[Override] = [
    (28, 40, CLOUD_DARK), (29, 41, CLOUD_DARK), (30, 42, CLOUD_DARK), (31, 42, CLOUD_DARK),
    (21, 43, GOLD_DARK), (22, 44, GOLD_DARK), (22, 43, GOLD_SHADOW),
]
E_RULE_CORRECTIONS: list[Override] = [
    (33, 36, CLOUD_DARK), (33, 39, CLOUD_DARK),
    (24, 47, GOLD_DARK), (25, 47, CLOUD_SHADOW), (25, 48, CLOUD_SHADOW),
]
F_IMPLIED_BY_RULINGS: list[Override] = [
    (24, 75, CLOUD_DARK), (39, 75, CLOUD_DARK),
    (25, 50, GOLD_DARK),
    # Exposed bottom-right corner of the hand: north and west are gold shadow, east and south are transparent.
    (41, 59, GOLD_DARK),
]
OVERRIDES: dict[str, list[Override]] = {
    "A": A_LAYER_ORDER,
    "B": B_TIES_AND_EMPTIES,
    "C": C_UNRESOLVED_THINNING,
    "D": D_OVERLAP_LINES,
    "E": E_RULE_CORRECTIONS,
    "F": F_IMPLIED_BY_RULINGS,
}


def frozen_points() -> set[Point]:
    return (
        {(x, y) for x, y, _ in BOLT_FILL}
        | set(BOLT_OUTLINE)
        | {(x, y) for x, y, _ in GRIP}
        | {(x, y) for x, y, _ in FACE}
    )


def ramps() -> dict[str, list[tuple[int, int, int]]]:
    data = json.loads(PALETTE_JSON.read_text())
    olympus = next(f for f in data["families"] if f["id"] == "olympus")
    return {r["id"]: [rgb(s) for s in r["shades"]] for r in olympus["ramps"]}


class Figure:
    """The opaque mask of C2b with its edge distance (4-connected steps from the nearest transparent pixel)."""

    def __init__(self, image: Raster) -> None:
        self.image = image
        self.opaque = {
            (x, y) for y in range(image.height) for x in range(image.width) if image.pixel(x, y)[3]
        }
        self.distance: dict[Point, int] = {}
        queue: deque[Point] = deque()
        for p in self.opaque:
            if any((p[0] + dx, p[1] + dy) not in self.opaque for dx, dy in NEIGHBOURS):
                self.distance[p] = 1
                queue.append(p)
        while queue:
            p = queue.popleft()
            for dx, dy in NEIGHBOURS:
                n = (p[0] + dx, p[1] + dy)
                if n in self.opaque and n not in self.distance:
                    self.distance[n] = self.distance[p] + 1
                    queue.append(n)

    def colour(self, p: Point) -> tuple[int, int, int]:
        return tuple(self.image.pixel(*p)[:3])  # type: ignore[return-value]


def plan(image: Raster) -> dict[Point, tuple[str, tuple[int, int, int]]]:
    """Maps each pixel the rules recolour to (rule, colour). The reviewer's override tables are not in it."""
    figure, shades, frozen = Figure(image), ramps(), frozen_points()
    palette = load_palette(PALETTE_JSON)
    dark = {shade[0] for shade in shades.values()}
    overridden = {(x, y) for table in OVERRIDES.values() for x, y, _ in table}

    def ramp_of(colour: tuple[int, int, int]) -> str:
        return GOLD_RAMP if palette.ramp_of[colour] == GOLD_RAMP else "cloud"

    def inward(p: Point) -> tuple[list[Point], list[Point]]:
        forms: list[Point] = []
        through: list[Point] = []
        seen, stack = {p}, [p]
        while stack:
            a = stack.pop()
            for dx, dy in NEIGHBOURS:
                n = (a[0] + dx, a[1] + dy)
                if n in figure.opaque and n not in seen and figure.distance[n] == figure.distance[a] + 1:
                    seen.add(n)
                    if figure.colour(n) in dark:
                        stack.append(n)
                        through.append(n)
                    else:
                        forms.append(n)
        return forms, through

    def majority(points: list[Point]) -> str | None:
        counts = Counter(ramp_of(figure.colour(n)) for n in points).most_common()
        if not counts or (len(counts) > 1 and counts[0][1] == counts[1][1]):
            return None
        return counts[0][0]

    result: dict[Point, tuple[str, tuple[int, int, int]]] = {}
    exterior_ramp: dict[Point, str] = {}
    for p in sorted(figure.opaque, key=lambda q: (q[1], q[0])):
        if figure.distance[p] != 1 or p in frozen:
            continue
        ramp = majority(inward(p)[0])
        if ramp is None:
            if p not in overridden:
                raise ValueError(f"exterior pixel {p} has no majority ramp and no ruling")
            continue
        exterior_ramp[p] = ramp
        result[p] = ("R1", shades[ramp][0])

    for p in sorted(figure.opaque, key=lambda q: (q[1], q[0])):
        if figure.distance[p] != 2 or p in frozen or figure.colour(p) not in dark:
            continue
        outer = [
            (p[0] + dx, p[1] + dy)
            for dx, dy in NEIGHBOURS
            if (p[0] + dx, p[1] + dy) in figure.opaque
            and figure.distance[(p[0] + dx, p[1] + dy)] == 1
            and figure.colour((p[0] + dx, p[1] + dy)) in dark
        ]
        if not outer:
            continue
        ahead = [
            (p[0] + dx, p[1] + dy)
            for dx, dy in NEIGHBOURS
            if (p[0] + dx, p[1] + dy) in figure.opaque
            and figure.distance[(p[0] + dx, p[1] + dy)] == 3
            and figure.colour((p[0] + dx, p[1] + dy)) not in dark
        ]
        ramp = majority(ahead)
        if ramp is None:
            if p not in overridden:
                raise ValueError(f"band pixel {p} has no majority ramp and no ruling")
            continue
        result[p] = ("R3", shades[ramp][1])

    settled = {p: c for p, (_, c) in result.items()}
    for p in sorted(figure.opaque, key=lambda q: (q[1], q[0])):
        if p in frozen or p in result or p in overridden or figure.distance[p] < 2:
            continue
        if figure.colour(p) not in dark:
            continue
        around = Counter(
            ramp_of(settled.get((p[0] + dx, p[1] + dy), figure.colour((p[0] + dx, p[1] + dy))))
            for dx, dy in NEIGHBOURS
            if (p[0] + dx, p[1] + dy) in figure.opaque
            and settled.get((p[0] + dx, p[1] + dy), figure.colour((p[0] + dx, p[1] + dy))) not in dark
        )
        if not around:
            raise ValueError(f"interior dark pixel {p} has no form beside it and no ruling")
        if len(around) > 1:
            front = next(r for r in FRONT_ORDER if r in around)
            result[p] = ("R4-overlap", shades[front][0])
        else:
            result[p] = ("R4-seam", shades[next(iter(around))][1])
    return result


def apply(image: Raster) -> tuple[Raster, dict[Point, str]]:
    """The recoloured raster and, per changed pixel, the rule or override group that set it."""
    frozen = frozen_points()
    chosen: dict[Point, tuple[str, tuple[int, int, int]]] = dict(plan(image))
    for group, table in OVERRIDES.items():
        for x, y, hex_colour in table:
            if (x, y) in frozen:
                raise ValueError(f"{(x, y)} is a frozen feature pixel")
            chosen[(x, y)] = (group, rgb(hex_colour))
    palette = set(load_palette(PALETTE_JSON).colours)
    pixels = bytearray(image.rgba)
    source: dict[Point, str] = {}
    for (x, y), (label, colour) in chosen.items():
        at = (y * image.width + x) * 4
        if not pixels[at + 3]:
            raise ValueError(f"{(x, y)} is transparent; alpha is never changed")
        if colour not in palette:
            raise ValueError(f"{colour} at {(x, y)} is not a palette colour")
        if tuple(pixels[at : at + 3]) != colour:
            pixels[at : at + 3] = bytes(colour)
            source[(x, y)] = label
    return Raster(image.width, image.height, bytes(pixels)), source


def build() -> Raster:
    return apply(decode_png(SOURCE))[0]


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


def diff_map(before: Raster, after: Raster, source: dict[Point, str], factor: int = 4) -> Raster:
    w, h = before.width * factor, before.height * factor
    out = bytearray(bytes((70, 70, 70, 255)) * (w * h))
    for y in range(before.height):
        for x in range(before.width):
            px = after.pixel(x, y)
            if not px[3]:
                continue
            gray = int(0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]) // 2 + 60
            colour = (255, 0, 255, 255) if (x, y) in source else (gray, gray, gray, 255)
            for dy in range(factor):
                at = ((y * factor + dy) * w + x * factor) * 4
                for dx in range(factor):
                    out[at + dx * 4 : at + dx * 4 + 4] = bytes(colour)
    return Raster(w, h, bytes(out))


def main() -> int:
    palette = load_palette(PALETTE_JSON)
    before = decode_png(SOURCE)
    after, source = apply(before)
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / "c2c.png"
    encode_png(after, out)
    encode_png(enlarge(after, 4), OUT / "c2c-4x.png")
    strip = contact_sheet([[("C2", before), ("C3", after)]], ["S4"])
    encode_png(strip, OUT / "strip-c2b-c2c-1x.png")
    encode_png(enlarge(strip, 4), OUT / "strip-c2b-c2c-4x.png")
    encode_png(diff_map(before, after, source), OUT / "diff-c2b-c2c-4x.png")
    facts = measure(after, palette)
    clusters = sole_clusters(after, 2, 2)
    counts = Counter(source.values())
    report = conform([out])[str(out)]
    summary = {
        "source": str(SOURCE.relative_to(REPO)),
        "source_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        "output": str(out.relative_to(REPO)),
        "output_sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
        "changed_total": len(source),
        "changed_by_rule": dict(sorted(counts.items())),
        "override_table_sizes": {k: len(v) for k, v in OVERRIDES.items()},
        "overrides_that_changed_a_pixel": {k: counts.get(k, 0) for k in OVERRIDES},
        "r4_seam_pixels": sorted(
            [x, y, "#%02x%02x%02x" % tuple(after.pixel(x, y)[:3])]
            for (x, y), r in source.items()
            if r == "R4-seam"
        ),
        "r4_overlap_pixels": sorted(
            [x, y, "#%02x%02x%02x" % tuple(after.pixel(x, y)[:3])]
            for (x, y), r in source.items()
            if r == "R4-overlap"
        ),
        "height": facts["height"],
        "width": facts["width"],
        "top_row": facts["bottom_row"] - facts["height"] + 1,
        "bottom_row": facts["bottom_row"],
        "soles": [[c["x0"], c["x1"] - 1, c["bottom_row"]] for c in clusters],
        "sole_midpoint": sole_midpoint(after, 2, 2),
        "colours": facts["colours"],
        "palette_entries": ["#%02x%02x%02x" % c for c in facts["palette_entries"]],
        "outside_palette": facts["outside_palette"],
        "conform": report,
    }
    (OUT / "report-c2c.json").write_text(json.dumps(summary, indent=1) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k not in ("conform", "palette_entries")}, indent=1))
    print("conform:", report["status"], [c for c in report.get("checks", []) if c["status"] != "pass"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

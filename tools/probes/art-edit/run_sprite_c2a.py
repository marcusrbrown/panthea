"""Phase C2a: a clean downscale of studio candidate S4 (job zeus-idle-south-u7-c1-0003).

Re-keys the raw 512x640 render so only the figure remains, by recorded rules, measures the feet at
source resolution, sets the downscale from the body (crown to soles), and writes tiles, sheets and a
JSON of measurements and removed components to `<repo>/.context/studio-pipeline/c2/`. The studio
store is read only. No model runs.
"""

from __future__ import annotations

import json
import statistics
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline import Raster, decode_png, encode_png
from run_sprite_c1 import box_down, grid
from sprite_downscale import (
    OUTLINE_PX,
    add_outline,
    clear_colour_in_rows,
    clear_light_grey_in_rows,
    downscale_figure,
    foreground_bbox,
    key_foreground,
    keep_largest_component,
    load_palette,
    measure,
    place_by_soles,
    sole_clusters,
    sole_midpoint,
)
from sprite_sheet import contact_sheet, enlarge

REPO = Path(__file__).resolve().parents[3]
STORE = REPO / ".context/studio-pipeline/u7-creative/studio"
C1 = REPO / ".context/studio-pipeline/c1"
OUT = REPO / ".context/studio-pipeline/c2"
PALETTE_JSON = REPO / "content/greek/palette/palette.json"
JOB = "zeus-idle-south-u7-c1-0003"

KEY_TOLERANCE = 24
GROUND_ZONE_FRACTION = 0.03
SHADOW_SAMPLE = (255, 597, 315, 603)
SHADOW_TOLERANCE = 30
FRINGE_MAX_SPREAD = 14
FRINGE_MIN_LUMA = 140
MIN_COMPONENT = 500
SOLE_BAND_ROWS = 8
SOLE_MIN_GAP = 20
BODY_TARGETS = (50, 52)
METHODS = (("M", "mode"), ("K", "kcentroid"))


def magenta_view(source: Raster) -> Raster:
    out = bytearray(source.rgba)
    for at in range(0, len(out), 4):
        if out[at + 3]:
            out[at + 3] = 255
        else:
            out[at : at + 4] = bytes((255, 0, 255, 255))
    return Raster(source.width, source.height, bytes(out))


def crop(source: Raster, box: tuple[int, int, int, int], factor: int = 1) -> Raster:
    x0, y0, x1, y1 = box
    w, h = (x1 - x0) * factor, (y1 - y0) * factor
    out = bytearray(w * h * 4)
    for y in range(y1 - y0):
        for x in range(x1 - x0):
            px = source.rgba[((y0 + y) * source.width + x0 + x) * 4 : ((y0 + y) * source.width + x0 + x) * 4 + 4]
            for dy in range(factor):
                at = ((y * factor + dy) * w + x * factor) * 4
                for dx in range(factor):
                    out[at + dx * 4 : at + dx * 4 + 4] = px
    return Raster(w, h, bytes(out))


def side_by_side(images: list[Raster]) -> Raster:
    height = max(i.height for i in images)
    width = sum(i.width for i in images) + 4 * (len(images) + 1)
    canvas = bytearray(bytes((90, 90, 90, 255)) * (width * (height + 8)))
    left = 4
    for image in images:
        for y in range(image.height):
            at = ((4 + y) * width + left) * 4
            canvas[at : at + image.width * 4] = image.rgba[y * image.width * 4 : (y + 1) * image.width * 4]
        left += image.width + 4
    return Raster(width, height + 8, bytes(canvas))


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


def body_top(image: Raster, x0: int, x1: int) -> int:
    for y in range(image.height):
        if any(image.rgba[(y * image.width + x) * 4 + 3] for x in range(x0, x1)):
            return y
    raise ValueError("no foreground in the body columns")


def main() -> int:
    palette = load_palette(PALETTE_JSON)
    OUT.mkdir(parents=True, exist_ok=True)
    c1 = json.loads((C1 / "results.json").read_text())
    job = next(j for j in c1["jobs"] if j["id"] == JOB)
    blob = STORE / "blobs" / f"{job['output']}.png"
    raw = decode_png(blob)

    keyed, key = key_foreground(raw, KEY_TOLERANCE)
    first_bbox = foreground_bbox(keyed)
    first_height = first_bbox[3] - first_bbox[1]
    zone_top = first_bbox[3] - round(GROUND_ZONE_FRACTION * first_height)

    sx0, sy0, sx1, sy1 = SHADOW_SAMPLE
    samples = [
        tuple(raw.rgba[(y * raw.width + x) * 4 : (y * raw.width + x) * 4 + 3])
        for y in range(sy0, sy1)
        for x in range(sx0, sx1)
    ]
    shadow_key = tuple(int(statistics.median(s[c] for s in samples)) for c in range(3))
    cleared, shadow_pixels = clear_colour_in_rows(keyed, shadow_key, SHADOW_TOLERANCE, zone_top)
    cleared, fringe_pixels = clear_light_grey_in_rows(cleared, FRINGE_MAX_SPREAD, FRINGE_MIN_LUMA, zone_top)
    shadow_ys = [
        y
        for y in range(zone_top, raw.height)
        for x in range(raw.width)
        if keyed.rgba[(y * raw.width + x) * 4 + 3] and not cleared.rgba[(y * raw.width + x) * 4 + 3]
    ]
    shadow_xs = [
        x
        for y in range(zone_top, raw.height)
        for x in range(raw.width)
        if keyed.rgba[(y * raw.width + x) * 4 + 3] and not cleared.rgba[(y * raw.width + x) * 4 + 3]
    ]

    reflooded = bytearray(raw.rgba)
    for at in range(0, len(reflooded), 4):
        if keyed.rgba[at + 3] and not cleared.rgba[at + 3]:
            reflooded[at : at + 3] = bytes(key)
    rekeyed, _ = key_foreground(Raster(raw.width, raw.height, bytes(reflooded)), KEY_TOLERANCE, key)
    pocket_pixels = sum(
        1
        for at in range(0, len(keyed.rgba), 4)
        if keyed.rgba[at + 3] and not rekeyed.rgba[at + 3]
    ) - shadow_pixels - fringe_pixels

    final, removed = keep_largest_component(rekeyed, MIN_COMPONENT)
    bbox = foreground_bbox(final)
    total_src = bbox[3] - bbox[1]

    clusters = sole_clusters(final, SOLE_BAND_ROWS, SOLE_MIN_GAP)
    midpoint_src = sole_midpoint(final, SOLE_BAND_ROWS, SOLE_MIN_GAP)
    body_x0, body_x1 = clusters[0]["x0"], clusters[-1]["x1"]
    crown = body_top(final, body_x0, body_x1)
    soles_row = max(c["bottom_row"] for c in clusters)
    body_src = soles_row + 1 - crown

    encode_png(magenta_view(keyed), OUT / "keyed-before.png")
    encode_png(magenta_view(final), OUT / "keyed-after.png")
    foot_box = (90, 560, 420, 615)
    encode_png(
        side_by_side([crop(magenta_view(keyed), foot_box, 3), crop(magenta_view(final), foot_box, 3)]),
        OUT / "keyed-feet-before-after-3x.png",
    )

    tiles = []
    cells: list[tuple[str, Raster]] = []
    for target in BODY_TARGETS:
        scale = (target - OUTLINE_PX) / body_src
        interior = round(total_src * scale)
        for code, method in METHODS:
            figure = downscale_figure(final, method, interior, palette, bbox)
            placed = place_by_soles(figure)
            cell = add_outline(placed, palette)
            name = f"{code}{target}"
            path = OUT / "tiles" / f"{name}.png"
            encode_png(cell, path)
            encode_png(enlarge(cell, 4), OUT / "tiles" / f"{name}-4x.png")
            facts = measure(cell, palette, placed)
            out_clusters = sole_clusters(cell, 2, 2)
            top = body_top(cell, out_clusters[0]["x0"], out_clusters[-1]["x1"])
            facts.pop("palette_entries")
            tiles.append(
                {
                    "tile": name,
                    "file": str(path.relative_to(REPO)),
                    "scale": round(scale, 5),
                    "interior_rows": interior,
                    "body_height": 79 - top + 1,
                    "total_height": facts["height"],
                    "top_row": facts["bottom_row"] - facts["height"] + 1,
                    "bottom_row": facts["bottom_row"],
                    "soles": [[c["x0"], c["x1"] - 1, c["bottom_row"]] for c in out_clusters],
                    "sole_midpoint": sole_midpoint(cell, 2, 2),
                    "colours": facts["colours"],
                    "outside_palette": facts["outside_palette"],
                    "outline": facts["outline"],
                }
            )
            cells.append((name, cell))
    report = conform([REPO / t["file"] for t in tiles])
    for tile in tiles:
        verdict = report[str(REPO / tile["file"])]
        tile["conform"] = verdict["status"]
        tile["conform_failed"] = [
            f"{c['check']}: {c['message']}" for c in verdict.get("checks", []) if c["status"] != "pass"
        ]
        tile["conform_pixels_changed"] = verdict.get("pixelsChanged")

    old = decode_png(C1 / "cells" / JOB / "M56.png")
    raw_half = box_down(raw, 2)
    raw_eighth = box_down(raw, 8)
    sheet = contact_sheet([[("0", raw_eighth), ("56", old), *cells]], ["S4"])
    encode_png(sheet, OUT / "strip-1x.png")
    encode_png(enlarge(sheet, 4), OUT / "strip-4x.png")
    strip4 = grid([raw_half, enlarge(old, 4), *[enlarge(c, 4) for _, c in cells]], len(cells) + 2)
    encode_png(strip4, OUT / "strip-raw-old-new-4x-scale.png")

    summary = {
        "job": JOB,
        "seed": job["seed"],
        "source": str(blob.relative_to(REPO)),
        "source_sha256": job["output"],
        "rules": {
            "key": {"rgb": list(key), "tolerance": KEY_TOLERANCE, "border_connected": True},
            "ground_zone": f"rows >= {zone_top} (lowest {GROUND_ZONE_FRACTION:.0%} of the first keyed box, {first_bbox})",
            "shadow_key": {"rgb": list(shadow_key), "sample_box": list(SHADOW_SAMPLE), "tolerance": SHADOW_TOLERANCE},
            "fringe": {"max_channel_spread": FRINGE_MAX_SPREAD, "min_luma": FRINGE_MIN_LUMA, "rows": f">= {zone_top}"},
            "rekey": "cleared shadow pixels are painted the background key and the border flood is run again",
            "components": f"keep the largest 8-connected component; drop others under {MIN_COMPONENT} px",
        },
        "removed": {
            "ground_shadow_pixels": shadow_pixels,
            "ground_shadow_fringe_pixels": fringe_pixels,
            "ground_shadow_box": [min(shadow_xs), min(shadow_ys), max(shadow_xs) + 1, max(shadow_ys) + 1],
            "pocket_background_pixels_freed_by_rekey": pocket_pixels,
            "components": removed,
            "foreground_pixels_before": sum(1 for a in keyed.rgba[3::4] if a),
            "foreground_pixels_after": sum(1 for a in final.rgba[3::4] if a),
        },
        "source_measurements": {
            "bbox": list(bbox),
            "total_height": total_src,
            "first_pass_bbox": list(first_bbox),
            "sole_band_rows": SOLE_BAND_ROWS,
            "feet": [
                {"x0": c["x0"], "x1": c["x1"], "lowest_row": c["bottom_row"], "centre": c["centre"]}
                for c in clusters
            ],
            "sole_midpoint": midpoint_src,
            "gap_between_feet": [clusters[0]["x1"], clusters[-1]["x0"]],
            "crown_row": crown,
            "soles_row": soles_row,
            "body_height_crown_to_soles": body_src,
            "bolt_tip_above_crown": crown - bbox[1],
            "body_columns": [body_x0, body_x1],
        },
        "tiles": tiles,
    }
    (OUT / "results.json").write_text(json.dumps(summary, indent=1) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "rules"}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

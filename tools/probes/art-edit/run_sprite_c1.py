"""Phase C1 driver: downscale every succeeded studio candidate of one request and build the sheets.

Reads the studio store (read only), keys each 512x640 render at source resolution, and runs
`sprite_downscale.py` at target height 54 with methods M and K, plus 50 and 56 with M, each with the
1 px outline and foot placement. Writes to `<repo>/.context/studio-pipeline/c1/`. No model runs.
Standard library only (pipeline.py shells out to ffmpeg for PNG I/O).
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline import Raster, decode_png, encode_png
from sprite_downscale import (
    OUTLINE_PX,
    add_outline,
    downscale_figure,
    drop_specks,
    foreground_bbox,
    key_foreground,
    load_palette,
    measure,
    place_feet,
)
from sprite_sheet import contact_sheet, enlarge

REPO = Path(__file__).resolve().parents[3]
STORE = REPO / ".context/studio-pipeline/u7-creative/studio"
OUT = REPO / ".context/studio-pipeline/c1"
PALETTE_JSON = REPO / "content/greek/palette/palette.json"
REQUEST = "zeus-idle-south-u7-c1"
TOLERANCE = 24
SPECK_FRACTION = 0.001
VARIANTS = [("M", 54), ("K", 54), ("M", 50), ("M", 56)]
METHOD = {"M": "mode", "K": "kcentroid"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def box_down(source: Raster, factor: int) -> Raster:
    """Box-average reduction by a whole factor, for judging the raw renders only."""
    width, height = source.width // factor, source.height // factor
    out = bytearray(width * height * 4)
    area = factor * factor
    for y in range(height):
        for x in range(width):
            sums = [0, 0, 0]
            for dy in range(factor):
                row = ((y * factor + dy) * source.width + x * factor) * 4
                for dx in range(factor):
                    at = row + dx * 4
                    sums[0] += source.rgba[at]
                    sums[1] += source.rgba[at + 1]
                    sums[2] += source.rgba[at + 2]
            at = (y * width + x) * 4
            out[at : at + 4] = bytes((sums[0] // area, sums[1] // area, sums[2] // area, 255))
    return Raster(width, height, bytes(out))


def grid(tiles: list[Raster], columns: int, gutter: int = 4) -> Raster:
    tile_w, tile_h = tiles[0].width, tiles[0].height
    rows = (len(tiles) + columns - 1) // columns
    width = columns * (tile_w + gutter) + gutter
    height = rows * (tile_h + gutter) + gutter
    canvas = bytearray(bytes((120, 120, 120, 255)) * (width * height))
    for index, tile in enumerate(tiles):
        left = gutter + (index % columns) * (tile_w + gutter)
        top = gutter + (index // columns) * (tile_h + gutter)
        for y in range(tile_h):
            src = y * tile_w * 4
            dst = ((top + y) * width + left) * 4
            canvas[dst : dst + tile_w * 4] = tile.rgba[src : src + tile_w * 4]
    return Raster(width, height, bytes(canvas))


def runs_in_row(image: Raster, y: int) -> int:
    count, inside = 0, False
    for x in range(image.width):
        opaque = image.rgba[(y * image.width + x) * 4 + 3] != 0
        if opaque and not inside:
            count += 1
        inside = opaque
    return count


def main() -> int:
    palette = load_palette(PALETTE_JSON)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "cells").mkdir(exist_ok=True)
    (OUT / "keyed").mkdir(exist_ok=True)
    request = json.loads((STORE / "requests" / f"{REQUEST}.json").read_text())["request"]
    jobs = []
    for path in sorted((STORE / "jobs").glob(f"{REQUEST}-*.json")):
        record = json.loads(path.read_text())
        job = record["job"]
        outputs = job.get("outputs") or []
        jobs.append(
            {
                "id": job["id"],
                "seed": job["request"].get("seed"),
                "status": job["status"],
                "output": outputs[0]["hash"] if outputs else None,
                "prompt": record["engine"]["settings"]["prompt"] if "engine" in record else None,
            }
        )
    rows: list[list[tuple[str, Raster]]] = []
    labels: list[str] = []
    raw: list[Raster] = []
    results = []
    for number, job in enumerate(jobs, 1):
        if job["status"] != "succeeded" or job["output"] is None:
            results.append({**job, "skipped": "job did not succeed"})
            continue
        blob = STORE / "blobs" / f"{job['output']}.png"
        if sha256(blob) != job["output"]:
            raise SystemExit(f"{blob.name}: hash does not match its record")
        render = decode_png(blob)
        raw.append(box_down(render, 2))
        keyed, key = key_foreground(render, TOLERANCE)
        keyed, dropped = drop_specks(keyed, SPECK_FRACTION)
        x0, y0, x1, y1 = bbox = foreground_bbox(keyed)
        bottom_band = max(y0, y1 - 1 - max(2, (y1 - y0) // 50))
        facts = {
            "key_rgb": list(key),
            "key_tolerance": TOLERANCE,
            "specks_dropped": dropped,
            "figure_bbox": list(bbox),
            "figure_height": y1 - y0,
            "figure_width": x1 - x0,
            "bottom_margin": render.height - y1,
            "touches_edge": {
                "left": x0 == 0,
                "right": x1 == render.width,
                "top": y0 == 0,
                "bottom": y1 == render.height,
            },
            "foreground_runs_on_lowest_row": runs_in_row(keyed, y1 - 1),
            "foreground_runs_near_soles": runs_in_row(keyed, bottom_band),
        }
        preview = bytearray(keyed.rgba)
        for at in range(0, len(preview), 4):
            if preview[at + 3]:
                preview[at + 3] = 255
            else:
                preview[at : at + 4] = bytes((255, 0, 255, 255))
        encode_png(Raster(keyed.width, keyed.height, bytes(preview)), OUT / "keyed" / f"{job['id']}.png")
        row = []
        cells = []
        for code, height in VARIANTS:
            interior = height - OUTLINE_PX
            figure = downscale_figure(keyed, METHOD[code], interior, palette, bbox)
            placed = place_feet(figure)
            cell = add_outline(placed, palette)
            path = OUT / "cells" / job["id"] / f"{code}{height}.png"
            encode_png(cell, path)
            measured = measure(cell, palette, placed)
            measured.pop("palette_entries")
            cells.append({"tile": f"{code}{height}", "file": str(path.relative_to(REPO)), **measured})
            row.append((f"{code}{height}", cell))
        rows.append(row)
        labels.append(f"S{number}")
        results.append({**job, "raw": facts, "cells": cells})
        print(job["id"], facts["figure_height"], flush=True)
    if rows:
        sheet = contact_sheet(rows, labels)
        encode_png(sheet, OUT / "contact-1x.png")
        encode_png(enlarge(sheet, 4), OUT / "contact-4x.png")
        encode_png(grid(raw, 4), OUT / "raw-half.png")
        encode_png(grid([box_down(r, 2) for r in raw], 4), OUT / "raw-quarter.png")
    (OUT / "results.json").write_text(
        json.dumps({"request": request, "tiles": VARIANTS, "jobs": results}, indent=1) + "\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

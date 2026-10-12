"""U1 analysis: palette-mode 1x read, colour drift, silhouette IoU and contact sheets for the art-reference probe.

Reuses the art-edit downscale (method M, 54 px total figure height, `olympus` palette). No model runs; every input
is an image the driver already wrote. Standard library only.

    python3 tools/probes/art-reference/analyze.py [--tolerance 40] [--variant ""]
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "tools/probes/art-edit"))

from pipeline import Raster, decode_png, encode_png  # noqa: E402
from sprite_downscale import (  # noqa: E402
    OUTLINE_PX,
    add_outline,
    downscale_figure,
    drop_specks,
    foreground_bbox,
    key_foreground,
    load_palette,
    oklab,
    place_feet,
)
from sprite_sheet import contact_sheet, enlarge  # noqa: E402

SCRATCH = REPO / ".context/studio-pipeline/art-reference"
ATLAS = REPO / "content/greek/assets/registry/blobs/9976a62d051e1f0349a1f61d5f1cf2e3e673b8b06e97760290c8b99f5c626a69.png"
PALETTE_JSON = REPO / "content/greek/palette/palette.json"
HEIGHT = 54
SPECK_FRACTION = 0.001

# id -> (tile code, reference tiles shown beside it)
RUNS = [
    ("baseline", "1", ["idle"]),
    ("facing-1ref", "2", ["idle"]),
    ("pose-1ref", "3", ["idle"]),
    ("facing-2ref", "4", ["idle", "seated"]),
    # The single settings variant (img_cfg 1.5); skipped when its output does not exist.
    ("facing-1ref-v2", "6", ["idle"]),
]
REF_CODE = {"idle": "0", "seated": "5"}
REF_X = {"idle": 0, "seated": 256}


def crop(source: Raster, x: int, y: int, w: int, h: int) -> Raster:
    out = bytearray()
    for j in range(y, y + h):
        out += source.rgba[(j * source.width + x) * 4 : (j * source.width + x + w) * 4]
    return Raster(w, h, bytes(out))


def reference_cell(name: str, atlas: Raster) -> Raster:
    return crop(atlas, REF_X[name], 0, 64, 80)


def cell_from_output(path: Path, tolerance: int, palette) -> tuple[Raster, Raster, Raster, dict]:
    original = decode_png(path)
    keyed, key = key_foreground(original, tolerance)
    keyed, dropped = drop_specks(keyed, SPECK_FRACTION)
    bbox = foreground_bbox(keyed)
    figure = downscale_figure(keyed, "mode", HEIGHT - OUTLINE_PX, palette, bbox)
    placed = place_feet(figure)
    cell = add_outline(placed, palette)
    facts = {
        "size": [original.width, original.height],
        "key_rgb": list(key),
        "key_tolerance": tolerance,
        "specks_dropped": dropped,
        "figure_bbox": list(bbox),
        "figure_height": bbox[3] - bbox[1],
        "figure_width": bbox[2] - bbox[0],
        "touches_edge": bbox[0] == 0 or bbox[1] == 0 or bbox[2] == original.width or bbox[3] == original.height,
    }
    return cell, placed, keyed, facts


def opaque_pixels(cell: Raster) -> list[tuple[int, int, int]]:
    rgba = cell.rgba
    return [tuple(rgba[at : at + 3]) for at in range(0, len(rgba), 4) if rgba[at + 3]]  # type: ignore[misc]


def ramp_shares(cell: Raster, palette) -> dict[str, float]:
    pixels = opaque_pixels(cell)
    counts: dict[str, int] = {}
    for rgb in pixels:
        ramp = palette.ramp_of.get(rgb, "off-palette")
        counts[ramp] = counts.get(ramp, 0) + 1
    total = sum(counts.values()) or 1
    return {ramp: n / total for ramp, n in sorted(counts.items())}


def mean_oklab(cell: Raster) -> tuple[float, float, float]:
    pixels = opaque_pixels(cell)
    labs = [oklab(tuple(float(c) for c in rgb)) for rgb in pixels]
    n = len(labs) or 1
    return tuple(sum(lab[i] for lab in labs) / n for i in range(3))  # type: ignore[return-value]


def silhouette(cell: Raster) -> set[tuple[int, int]]:
    cells = {(at // 4 % cell.width, at // 4 // cell.width) for at in range(3, len(cell.rgba), 4) if cell.rgba[at]}
    xs = [x for x, _ in cells]
    ys = [y for _, y in cells]
    cx = (min(xs) + max(xs) + 1) // 2
    bottom = max(ys)
    return {(x - cx, y - bottom) for x, y in cells}


def compare(ref: Raster, out: Raster, palette) -> dict:
    ref_shares, out_shares = ramp_shares(ref, palette), ramp_shares(out, palette)
    keys = set(ref_shares) | set(out_shares)
    tv = 0.5 * sum(abs(ref_shares.get(k, 0.0) - out_shares.get(k, 0.0)) for k in keys)
    a, b = mean_oklab(ref), mean_oklab(out)
    delta_e = math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))
    sa, sb = silhouette(ref), silhouette(out)
    return {
        "tv": round(tv, 4),
        "delta_e": round(delta_e, 4),
        "iou": round(len(sa & sb) / len(sa | sb), 4),
        "ref_shares": {k: round(v, 4) for k, v in ref_shares.items()},
        "out_shares": {k: round(v, 4) for k, v in out_shares.items()},
        "opaque_pixels": len(opaque_pixels(out)),
        "off_palette_pixels": sum(1 for rgb in opaque_pixels(out) if rgb not in palette.ramp_of),
    }


def flatten(source: Raster, backdrop=(255, 255, 255)) -> Raster:
    out = bytearray(source.rgba)
    for at in range(0, len(out), 4):
        if out[at + 3] != 255:
            a = out[at + 3] / 255
            for c in range(3):
                out[at + c] = round(out[at + c] * a + backdrop[c] * (1 - a))
            out[at + 3] = 255
    return Raster(source.width, source.height, bytes(out))


def side_by_side(tiles: list[Raster]) -> Raster:
    height = max(t.height for t in tiles)
    width = sum(t.width for t in tiles) + 8 * (len(tiles) - 1)
    canvas = bytearray(bytes((120, 120, 120, 255)) * (width * height))
    left = 0
    for tile in tiles:
        flat = flatten(tile)
        for y in range(tile.height):
            at = (y * width + left) * 4
            canvas[at : at + tile.width * 4] = flat.rgba[y * tile.width * 4 : (y + 1) * tile.width * 4]
        left += tile.width + 8
    return Raster(width, height, bytes(canvas))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tolerance", type=int, default=40)
    parser.add_argument("--variant", default="")
    parser.add_argument("--only", default="")
    args = parser.parse_args()

    palette = load_palette(PALETTE_JSON)
    atlas = decode_png(ATLAS)
    refs = {name: reference_cell(name, atlas) for name in REF_X}
    out_dir = SCRATCH / "analysis"
    (out_dir / "cells").mkdir(parents=True, exist_ok=True)
    (out_dir / "keyed").mkdir(parents=True, exist_ok=True)

    results: dict[str, dict] = {}
    rows: list[list[tuple[str, Raster]]] = []
    labels: list[str] = []
    raw_tiles: list[Raster] = [decode_png(SCRATCH / "refs/idle-south-0-x8.png")]
    for run_id, code, ref_names in RUNS:
        name = f"{run_id}{args.variant}"
        path = SCRATCH / "outputs" / f"{name}.png"
        if not path.exists():
            continue
        cell, placed, keyed, facts = cell_from_output(path, args.tolerance, palette)
        encode_png(cell, out_dir / "cells" / f"{name}.png")
        encode_png(keyed, out_dir / "keyed" / f"{name}.png")
        facts.update(compare(refs["idle"], cell, palette))
        # Supplementary, not the committed rule: the same two numbers before add_outline, because the
        # outline colour is chosen by the downscale script (darkest shade of the ramp) and not by the model.
        pre = compare(refs["idle"], placed, palette)
        facts["tv_pre_outline"], facts["delta_e_pre_outline"] = pre["tv"], pre["delta_e"]
        if run_id.startswith("pose"):
            seated = compare(refs["seated"], cell, palette)
            facts["tv_vs_seated_canon"], facts["delta_e_vs_seated_canon"], facts["iou_vs_seated_canon"] = (
                seated["tv"],
                seated["delta_e"],
                seated["iou"],
            )
        results[name] = facts
        row = [(REF_CODE[ref], refs[ref]) for ref in ref_names] + [(code, cell)]
        rows.append(row)
        labels.append(code)
        raw_tiles.append(decode_png(path))
        print(name, {k: facts[k] for k in ("tv", "delta_e", "iou", "figure_height", "touches_edge")})
    if rows:
        sheet = contact_sheet(rows, labels)
        encode_png(sheet, out_dir / f"contact-1x{args.variant}.png")
        encode_png(enlarge(sheet, 4), out_dir / f"contact-4x{args.variant}.png")
        encode_png(side_by_side(raw_tiles), out_dir / f"raw-512x640{args.variant}.png")
    (out_dir / f"metrics{args.variant}.json").write_text(json.dumps(results, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

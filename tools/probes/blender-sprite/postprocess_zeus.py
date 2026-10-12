"""Round 2 post step: x4 route, selective overlap outlines, measurements, conformance, flicker, repairs, sheets, playback.

    python3 tools/probes/blender-sprite/postprocess_zeus.py [--scratch DIR]

Reads `<scratch>/zeus-render/meta.json` (render_zeus.py) and writes `zeus-*` files under `<scratch>/report/`. The art
is made only by the model, materials, rig poses and this scripted step: nothing is hand-edited, and frames that would
need hand pixels are logged in `repairs.json`, never repaired.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
sys.path.insert(0, str(REPO / "tools/probes/art-edit"))
sys.path.insert(0, str(ROOT))

import overlap  # noqa: E402
import playback  # noqa: E402
import postprocess as p1  # noqa: E402
import proxy_plan as pp  # noqa: E402
import repairs  # noqa: E402
import report_md  # noqa: E402
import sprite_metrics as sm  # noqa: E402
import sprite_plan as sp  # noqa: E402
from pipeline import Raster, decode_png, encode_png, silhouette  # noqa: E402
from sheet import Tile, contact_sheet, enlarge, tile_label  # noqa: E402
from sprite_downscale import Palette, add_outline, load_palette, measure, oklab  # noqa: E402

DEPTH_THRESHOLD_M = 0.04
VARIANT_IDS = tuple(v.id for v in pp.VARIANTS)
DIRS_BY_CLIP = {"idle": sp.DIRECTIONS, "cast": sp.DIRECTIONS, "sit": sp.DIRECTIONS, "walk": ("south", "east")}
ROW_CODES = {"idle": "I", "walk": "W", "cast": "C", "sit": "T"}
DEPTH_TABLE = [pp.decode_depth(b) for b in range(256)]
PLAY_TOTAL_CS = 300
BACKDROP = (120, 120, 120)


# --- passes -> 1x maps ---------------------------------------------------------------------------------


def block_maps(id_image: Raster, depth_image: Raster) -> tuple[list[str | None], list[float], int]:
    """4x ID and depth passes -> per-pixel part and depth at 1x (modal part of each 4x4 block, its mean depth)."""
    factor = sp.SUPERSAMPLE
    w, h = sp.CELL
    ids, depth = id_image.rgba, depth_image.rgba
    width = id_image.width
    parts: list[str | None] = []
    depths: list[float] = []
    unknown = 0
    for by in range(h):
        for bx in range(w):
            votes: Counter = Counter()
            total: dict[str, float] = {}
            for dy in range(factor):
                base = ((by * factor + dy) * width + bx * factor) * 4
                for dx in range(factor):
                    at = base + dx * 4
                    if ids[at + 3] == 0:
                        continue
                    part = pp.decode_id(ids[at])
                    if part is None:
                        unknown += 1
                        continue
                    votes[part] += 1
                    total[part] = total.get(part, 0.0) + DEPTH_TABLE[depth[at]]
            if not votes:
                parts.append(None)
                depths.append(0.0)
            else:
                part = max(votes, key=lambda k: (votes[k], k))
                parts.append(part)
                depths.append(total[part] / votes[part])
    return parts, depths, unknown


def rgb_at(image: Raster, i: int) -> tuple[int, int, int] | None:
    at = i * 4
    return None if image.rgba[at + 3] == 0 else (image.rgba[at], image.rgba[at + 1], image.rgba[at + 2])


def lightness(colour: tuple[int, int, int]) -> float:
    return oklab(colour)[0]


def build_cell(rgb_path: Path, parts: list, depths: list, palette: Palette) -> dict:
    """Mode downscale, exterior outline, then selective overlap lines. Returns the cell and what was drawn."""
    src = decode_png(rgb_path)
    interior = p1.x4_interior(src, palette)
    outlined = add_outline(interior, palette)
    pixels = [rgb_at(interior, i) for i in range(sp.CELL[0] * sp.CELL[1])]
    # A pixel the downscale made opaque but the ID pass left empty has no part; treat it as torso for the line test only.
    lined_parts = [p if px is not None else None for p, px in zip(parts, pixels, strict=True)]
    candidates = overlap.candidate_lines(lined_parts, depths, *sp.CELL, DEPTH_THRESHOLD_M)
    recoloured, drawn = overlap.apply_lines(pixels, candidates, palette.ramp_of, palette.darkest, lightness)
    out = bytearray(outlined.rgba)
    for i in drawn:
        out[i * 4 : i * 4 + 4] = bytes((*recoloured[i], 255))
    return {"cell": Raster(sp.CELL[0], sp.CELL[1], bytes(out)), "interior": interior, "drawn": drawn, "candidates": len(candidates)}


# --- sheets and playback -----------------------------------------------------------------------------------


def clip_row(cells: dict, variant: str, clip: sp.ClipSpec, zeus: Raster, transform=lambda r: r) -> list[Tile]:
    row = [Tile("ZX", transform(zeus), 0)]
    for g, direction in enumerate(DIRS_BY_CLIP[clip.id], start=1):
        for index in range(clip.frames):
            image = cells.get((variant, clip.id, direction, index))
            row.append(Tile(tile_label(direction, index), None if image is None else transform(image), g))
    return row


def write_sheets(cells: dict, zeus: Raster, out: Path, prefix: str = "zeus", variants: tuple = VARIANT_IDS, letters: dict | None = None) -> dict:
    letters = letters or {"a3": "A", "b2": "B"}
    paths: dict[str, Path] = {}
    for variant in variants:
        rows = [clip_row(cells, variant, c, zeus) for c in sp.CLIPS]
        labels = [ROW_CODES[c.id] for c in sp.CLIPS]
        for kind, transform in (("contact", lambda r: r), ("silhouette", silhouette)):
            tiles = rows if kind == "contact" else [clip_row(cells, variant, c, zeus, transform) for c in sp.CLIPS]
            sheet = contact_sheet(tiles, labels)
            paths[f"{kind}-{variant}-1x"] = out / f"{prefix}-{kind}-{variant}-1x.png"
            paths[f"{kind}-{variant}-4x"] = out / f"{prefix}-{kind}-{variant}-4x.png"
            encode_png(sheet, paths[f"{kind}-{variant}-1x"])
            encode_png(enlarge(sheet, 4), paths[f"{kind}-{variant}-4x"])
    combined, labels = [], []
    for clip in sp.CLIPS:
        for variant in variants:
            combined.append(clip_row(cells, variant, clip, zeus))
            labels.append(ROW_CODES[clip.id] + letters[variant])
    sheet = contact_sheet(combined, labels)
    paths["compare-1x"], paths["compare-4x"] = out / f"{prefix}-compare-1x.png", out / f"{prefix}-compare-4x.png"
    encode_png(sheet, paths["compare-1x"])
    encode_png(enlarge(sheet, 4), paths["compare-4x"])
    return {k: str(v.relative_to(REPO)) for k, v in paths.items()}


def panel_indices(image: Raster, lookup: dict, factor: int) -> list[bytes]:
    """Rows of palette indices for one 64x80 tile at `factor`x, transparent shown as the backdrop."""
    rows = []
    for y in range(image.height):
        row = bytearray()
        for x in range(image.width):
            px = image.pixel(x, y)
            row += bytes([lookup[px[:3] if px[3] else BACKDROP]]) * factor
        rows += [bytes(row)] * factor
    return rows


def write_playback(cells: dict, zeus_idle: list[Raster], out: Path, prefix: str = "zeus", variants: tuple = VARIANT_IDS) -> dict:
    written = {}
    canon_timing = pp.CANON_TIMING_MS["idle"]
    for clip in sp.CLIPS:
        dirs = DIRS_BY_CLIP[clip.id]
        for variant in variants:
            panels_src = [zeus_idle] + [[cells[(variant, clip.id, d, i)] for i in range(clip.frames)] for d in dirs]
            schedules = [canon_timing] + [pp.CANON_TIMING_MS[clip.id]] * len(dirs)
            steps = playback.timeline(schedules, PLAY_TOTAL_CS)
            colours = {BACKDROP}
            for frames in panels_src:
                for r in frames:
                    colours |= {r.pixel(x, y)[:3] for y in range(r.height) for x in range(r.width) if r.pixel(x, y)[3]}
            palette = sorted(colours)
            lookup = {c: i for i, c in enumerate(palette)}
            for factor in (1, 4):
                gutter = 2 * factor
                tile_rows = [[panel_indices(r, lookup, factor) for r in frames] for frames in panels_src]
                cache: dict[tuple[int, ...], bytes] = {}
                canvases, delays = [], []
                height = 80 * factor
                for duration, picks in steps:
                    if picks not in cache:
                        sep = bytes([lookup[BACKDROP]]) * gutter
                        rows = []
                        for y in range(height):
                            rows.append(sep.join(tile_rows[p][picks[p]][y] for p in range(len(picks))))
                        cache[picks] = b"".join(rows)
                    canvases.append(cache[picks])
                    delays.append(duration)
                width = len(canvases[0]) // height
                path = out / f"{prefix}-play-{clip.id}-{variant}-{factor}x.gif"
                size = playback.write_gif(path, width, height, palette, canvases, delays)
                written[f"{clip.id}-{variant}-{factor}x"] = {"path": str(path.relative_to(REPO)), "bytes": size, "frames": len(steps), "size": [width, height], "panels": ["canon zeus idle"] + list(dirs)}
    return written


# --- aggregation -----------------------------------------------------------------------------------------------


def summarise(facts: list[dict], flicker: dict, repair_cells: dict) -> list[dict]:
    rows = []
    for variant in VARIANT_IDS:
        for clip in sp.CLIPS:
            group = [f for f in facts if f["variant"] == variant and f["clip"] == clip.id]
            if not group:
                continue
            fl = [flicker[f"{variant}/{clip.id}/{d}"] for d in DIRS_BY_CLIP[clip.id]]
            changed, stable = sum(f["changed_stable"] for f in fl), sum(f["stable_opaque"] for f in fl)
            bad = [f for f in group if repair_cells[(variant, f["clip"], f["direction"], f["index"])]]
            pixels = [sum(i["pixels"] for i in repair_cells[(variant, f["clip"], f["direction"], f["index"])]) for f in bad]
            rows.append(
                {
                    "variant": variant,
                    "clip": clip.id,
                    "cells": len(group),
                    "height": p1.span([f["height"] for f in group]),
                    "bottom_row": p1.span([f["bottom_row"] for f in group]),
                    "colours_max": max(f["colours"] for f in group),
                    "colours_union": len({c for f in group for c in f["colour_set"]}),
                    "outline_all": all(f["outline"] for f in group),
                    "binary_alpha_all": all(f["binary_alpha"] for f in group),
                    "anchor_all_32_74": all(f["anchor_ok"] for f in group),
                    "conform_pass": sum(1 for f in group if f["conform"] == "pass"),
                    "conform_failed": dict(Counter(n for f in group for n in f["conform_failed"])),
                    "overlap_px_mean": round(sum(f["overlap_px"] for f in group) / len(group), 1),
                    "flicker_changed_stable": changed,
                    "flicker_stable_opaque": stable,
                    "cells_needing_repair": len(bad),
                    "repair_px_total": sum(pixels),
                    "repair_px_max": max(pixels, default=0),
                }
            )
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scratch", default=str(ROOT / "scratch"))
    ap.add_argument("--no-playback", action="store_true")
    args = ap.parse_args()
    scratch = Path(args.scratch)
    render_dir = scratch / "zeus-render"
    out = scratch / "report"
    meta = json.loads((render_dir / "meta.json").read_text())
    palette = load_palette(p1.PALETTE_JSON)
    started = time.perf_counter()

    cells: dict = {}
    maps: dict = {}
    facts: list[dict] = []
    drawn_sets: dict = {}
    parts_by_key: dict = {}
    cell_paths: dict = {}
    unknown_ids = 0
    for entry in meta["frames"]:
        parts, depths, unknown = block_maps(decode_png(render_dir / entry["files"]["id"]), decode_png(render_dir / entry["files"]["depth"]))
        unknown_ids += unknown
        for variant in VARIANT_IDS:
            built = build_cell(render_dir / entry["files"][variant], parts, depths, palette)
            key = (variant, entry["clip"], entry["direction"], entry["index"])
            cell = built["cell"]
            cells[key] = cell
            maps[key] = sm.index_map(cell, palette.colours)
            drawn_sets[key] = set(built["drawn"])
            parts_by_key[key] = parts
            path = out / "zeus-cells" / variant / f"{entry['clip']}_{entry['direction']}_{entry['index']:02d}.png"
            encode_png(cell, path)
            cell_paths[key] = path
            measured = measure(cell, palette, built["interior"])
            measured.pop("palette_entries")
            colour_set = {tuple(cell.rgba[a : a + 3]) for a in range(0, len(cell.rgba), 4) if cell.rgba[a + 3]}
            anchor = entry["anchor_px"]
            facts.append(
                {
                    "variant": variant, "clip": entry["clip"], "direction": entry["direction"], "index": entry["index"], "source_frame": entry["source_frame"],
                    **measured,
                    "colour_set": sorted(colour_set),
                    "binary_alpha": {cell.rgba[a + 3] for a in range(0, len(cell.rgba), 4)} <= {0, 255},
                    "anchor_px": anchor,
                    "anchor_ok": abs(anchor[0] - 32.0) < 1e-3 and abs(anchor[1] - 74.0) < 1e-3,
                    "overlap_px": len(built["drawn"]),
                    "overlap_candidates": built["candidates"],
                    "extent_px": entry["extent_px"],
                    "file": str(path.relative_to(REPO)),
                }
            )
    verdicts = p1.conform(list(cell_paths.values()))
    for f in facts:
        v = verdicts[str(REPO / f["file"])]
        f["conform"] = v["status"]
        f["conform_failed"] = [c["check"] for c in v.get("checks", []) if c["status"] != "pass"]
        f["conform_messages"] = [f"{c['check']}: {c['message']}" for c in v.get("checks", []) if c["status"] != "pass"]

    flicker = {}
    for variant in VARIANT_IDS:
        for clip in sp.CLIPS:
            for d in DIRS_BY_CLIP[clip.id]:
                series = [maps[(variant, clip.id, d, i)] for i in range(clip.frames)]
                flicker[f"{variant}/{clip.id}/{d}"] = sm.flicker_series(series, *sp.CELL, clip.loop)

    # Repairs: detectors per cell, plus one-frame blips across each clip's neighbouring frames.
    repair_cells: dict = {}
    for f in facts:
        key = (f["variant"], f["clip"], f["direction"], f["index"])
        clip = next(c for c in sp.CLIPS if c.id == f["clip"])
        cell = cells[key]
        colours = [rgb_at(cell, i) for i in range(sp.CELL[0] * sp.CELL[1])]
        issues = repairs.cell_issues(maps[key], parts_by_key[key], colours, palette.ramp_of, drawn_sets[key], *sp.CELL, f["colours"], f["anchor_px"], f["anchor_ok"])
        if f["extent_px"]["bottom"] > sp.CELL[1]:
            row = sp.CELL[1] - 1
            darkest = set(palette.darkest.values())
            cut = sum(1 for x in range(sp.CELL[0]) if colours[row * sp.CELL[0] + x] is not None and colours[row * sp.CELL[0] + x] not in darkest)
            issues.append({"kind": "bottom_crop", "pixels": cut, "change": f"redraw the seat or feet so they end {f['extent_px']['bottom'] - sp.CELL[1]:.1f} px higher", "why": "the fixed (32, 74) anchor puts the lowest point below the cell, so the outline row holds cut-off figure pixels"})
        review = repairs.review_issues(f["clip"], parts_by_key[key])
        for r in review:
            r["source"] = "visual review rule"
        issues += review
        counts = Counter(p for p in parts_by_key[key] if p)
        f["part_px"] = dict(counts)
        n = clip.frames
        i = f["index"]
        if n >= 3 and (clip.loop or 0 < i < n - 1):
            blip = repairs.blips(maps[(f["variant"], f["clip"], f["direction"], (i - 1) % n)], maps[key], maps[(f["variant"], f["clip"], f["direction"], (i + 1) % n)], *sp.CELL)
            if blip:
                issues.append(blip)
        repair_cells[key] = issues
        f["repair_issues"] = issues

    zeus = p1.zeus_tile()
    atlas = decode_png(p1.ZEUS_ATLAS)
    zeus_idle = [Raster(64, 80, b"".join(atlas.rgba[(y * atlas.width + 64 * k) * 4 : (y * atlas.width + 64 * k + 64) * 4] for y in range(80))) for k in range(4)]
    sheets = write_sheets(cells, zeus, out)
    playback_files = {} if args.no_playback else write_playback(cells, zeus_idle, out)

    subpixel = []
    for variant in VARIANT_IDS:
        built_maps, labels = [], []
        for rec in meta.get("subpixel", []):
            parts, depths, _ = block_maps(decode_png(render_dir / rec["files"]["id"]), decode_png(render_dir / rec["files"]["depth"]))
            cell = build_cell(render_dir / rec["files"][variant], parts, depths, palette)["cell"]
            encode_png(cell, out / "zeus-subpixel" / variant / f"dx{int(rec['dx'] * 100):02d}_dy{int(rec['dy'] * 100):02d}.png")
            built_maps.append(sm.index_map(cell, palette.colours))
            labels.append((rec["dx"], rec["dy"]))
        for (dx, dy), idx in list(zip(labels, built_maps, strict=True))[1:]:
            pair = sm.flicker_pair(built_maps[0], idx, *sp.CELL)
            pair.pop("exact_static")
            subpixel.append({"variant": variant, "dx": dx, "dy": dy, **pair})

    repair_log = {
        "rule": "No frame was hand-edited. Every frame that would need hand pixels is listed here with the pixel count; none of these repairs were applied.",
        "detectors": "automatic detectors over the finished cells, the part-ID pass and neighbouring frames, plus visual-review findings written as measurable rules (repairs.py: edge_crop, over_height, isolated_pixels, bolt_*, temporal_blips, review_*)",
        "cells": [
            {"cell": f"{k[0]}/{k[1]}_{k[2]}_{k[3]:02d}", "variant": k[0], "clip": k[1], "facing": k[2], "frame": k[3], "pixels": sum(i["pixels"] for i in issues), "issues": issues}
            for k, issues in repair_cells.items()
            if issues
        ],
    }
    stamps = []
    for d in sp.DIRECTIONS:
        parts = parts_by_key[("a3", "idle", d, 0)]
        head = [i for i, p in enumerate(parts) if p == "head"]
        if head:
            xs, ys = [i % 64 for i in head], [i // 64 for i in head]
            stamps.append({"facing": d, "head_bbox": [min(xs), min(ys), max(xs) + 1, max(ys) + 1], "visible_head_skin_px": len(head), "hair_px": parts.count("hair"), "beard_px": parts.count("beard")})
    repair_log["face_stamp_slots"] = {"note": "Where a small hand-authored per-facing eye/brow stamp would go: inside the visible head (skin) pixels between the hair and the beard. Not authored; not counted in the repairs.", "idle_frame_0": stamps}
    totals = {}
    for variant in VARIANT_IDS:
        n_cells = sum(1 for k in repair_cells if k[0] == variant)
        bad = [k for k, v in repair_cells.items() if k[0] == variant and v]
        totals[variant] = {
            "cells": n_cells,
            "cells_needing_repair": len(bad),
            "pixels_total": sum(i["pixels"] for k in bad for i in repair_cells[k]),
            "pixels_per_flagged_cell_mean": round(sum(i["pixels"] for k in bad for i in repair_cells[k]) / max(1, len(bad)), 1),
            "by_kind": dict(Counter(i["kind"] for k in bad for i in repair_cells[k])),
        }
    repair_log["totals"] = totals
    out.mkdir(parents=True, exist_ok=True)
    (out / "repairs.json").write_text(json.dumps(repair_log, indent=1) + "\n")

    summary = summarise(facts, flicker, repair_cells)
    result = {
        "post_seconds": round(time.perf_counter() - started, 1),
        "id_pixels_undecodable": unknown_ids,
        "render_timings_ms": meta["timings_ms"],
        "camera": meta["camera"],
        "proxy": meta["proxy"],
        "summary": summary,
        "subpixel": subpixel,
        "flicker": {k: {kk: vv for kk, vv in v.items() if kk != "per_pair"} for k, v in flicker.items()},
        "sheets": sheets,
        "playback": playback_files,
        "repairs_totals": totals,
        "cells": facts,
    }
    (out / "zeus-results.json").write_text(json.dumps(result, indent=1) + "\n")
    (out / "zeus-results-tables.md").write_text(
        "\n\n".join(
            [
                "### Summary per shading variant and clip (x4 route)\n\n" + report_md.zeus_summary_table(summary),
                "### Sub-pixel palette stability (idle south frame 0, shifted, with overlap lines)\n\n" + report_md.subpixel_table(subpixel),
                "### Repairs that would need hand pixels (logged, not applied)\n\n" + report_md.zeus_repair_table(repair_log["cells"]),
                "### Render timing\n\n" + report_md.zeus_timing_table(meta["timings_ms"]),
                "### Playback files\n\n" + report_md.zeus_playback_table(playback_files),
            ]
        )
        + "\n"
    )
    print(json.dumps({"cells": len(facts), "sheets": len(sheets), "gifs": len(playback_files), "repairs": totals, "post_seconds": result["post_seconds"]}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

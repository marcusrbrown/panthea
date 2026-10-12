"""Post step for the Blender sprite probe: palette, outline, measurements, conformance, flicker, contact sheets.

    python3 tools/probes/blender-sprite/postprocess.py [--scratch DIR]

Reads `<scratch>/render/meta.json` and the renders beside it (written by render.py) and writes cells, sheets and
`results.json` under `<scratch>/report/`. Reuses `tools/probes/art-edit/sprite_downscale.py` (method M, palette snap,
outline) and `conform_report.ts` (report-only conformance). Standard library only; PNG IO goes through ffmpeg via
`pipeline.py`, as in the earlier probes.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
ART_EDIT = REPO / "tools/probes/art-edit"
sys.path.insert(0, str(ART_EDIT))
sys.path.insert(0, str(ROOT))

import report_md  # noqa: E402
import sprite_metrics as sm  # noqa: E402
import sprite_plan as sp  # noqa: E402
from pipeline import Raster, decode_png, encode_png, silhouette  # noqa: E402
from sheet import Tile, contact_sheet, enlarge, tile_label  # noqa: E402
from sprite_downscale import Palette, add_outline, downscale_figure, load_palette, measure, snap_to_palette, sole_midpoint  # noqa: E402

PALETTE_JSON = REPO / "content/greek/palette/palette.json"
ZEUS_ATLAS = REPO / "content/greek/assets/registry/blobs/9976a62d051e1f0349a1f61d5f1cf2e3e673b8b06e97760290c8b99f5c626a69.png"
VARIANTS = ("direct", "x4")
ROW_CODES = {"idle": "I", "walk": "W", "cast": "C", "sit": "T"}
SOLE_BAND_ROWS = 6
SOLE_MIN_GAP = 2


# --- cell construction -----------------------------------------------------------------------------------


def input_stats(src: Raster, palette: Palette) -> dict:
    """Facts about a raw render: partial alpha, distinct colours, how many are not exact palette entries."""
    rgba = src.rgba
    alphas = Counter(rgba[at + 3] for at in range(0, len(rgba), 4))
    colours = {tuple(rgba[at : at + 3]) for at in range(0, len(rgba), 4) if rgba[at + 3]}
    return {
        "opaque": sum(n for a, n in alphas.items() if a),
        "partial_alpha": sum(n for a, n in alphas.items() if 0 < a < 255),
        "raw_colours": len(colours),
        "raw_off_palette": sum(1 for c in colours if c not in palette.ramp_of),
    }


def direct_interior(src: Raster, palette: Palette) -> Raster:
    """Direct 64x80 render: binary alpha at 128, every opaque pixel snapped to the palette."""
    out = bytearray(len(src.rgba))
    for at in range(0, len(src.rgba), 4):
        if src.rgba[at + 3] >= 128:
            colour = snap_to_palette((src.rgba[at], src.rgba[at + 1], src.rgba[at + 2]), palette)
            out[at : at + 4] = bytes((*colour, 255))
    return Raster(src.width, src.height, bytes(out))


def x4_interior(src: Raster, palette: Palette) -> Raster:
    """4x render: method M (mode of palette-snapped pixels) over aligned 4x4 blocks; any opaque source pixel counts toward coverage."""
    return downscale_figure(src, "mode", sp.CELL[1], palette, bbox=(0, 0, src.width, src.height))


def build_cell(variant: str, src: Raster, palette: Palette) -> tuple[Raster, Raster]:
    interior = direct_interior(src, palette) if variant == "direct" else x4_interior(src, palette)
    if (interior.width, interior.height) != sp.CELL:
        raise ValueError(f"{variant} cell is {interior.width}x{interior.height}, expected {sp.CELL}")
    return add_outline(interior, palette), interior


def cell_facts(cell: Raster, interior: Raster, palette: Palette, entry: dict, variant: str, raw: dict) -> dict:
    measured = measure(cell, palette, interior)
    measured.pop("palette_entries")
    indices = sm.index_map(cell, palette.colours)
    sizes = sm.component_sizes(indices, cell.width, cell.height)
    alpha_values = {cell.rgba[at + 3] for at in range(0, len(cell.rgba), 4)}
    try:
        sole_pivot = sole_midpoint(interior, band_rows=SOLE_BAND_ROWS, min_gap=SOLE_MIN_GAP)
    except ValueError:  # one foot hidden behind the other, or a seated pose: no two clusters to take a midpoint of
        sole_pivot = None
    return {
        "variant": variant,
        "clip": entry["clip"],
        "direction": entry["direction"],
        "index": entry["index"],
        "source_frame": entry["source_frame"],
        **measured,
        "sole_pivot_x": sole_pivot,
        "binary_alpha": alpha_values <= {0, 255},
        "components": len(sizes),
        "stray_px": sum(sizes[1:]),
        "isolated_px": sm.isolated_pixels(indices, cell.width, cell.height),
        "raw": raw,
    }


# --- conformance -----------------------------------------------------------------------------------------


def conform(paths: list[Path]) -> dict:
    result = subprocess.run(
        ["bun", str(ART_EDIT / "conform_report.ts"), *map(str, paths)],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


# --- aggregation -------------------------------------------------------------------------------------------


def span(values: list[float]) -> str:
    low, high = min(values), max(values)
    return f"{low:g}" if low == high else f"{low:g}–{high:g}"


def aggregate(facts: list[dict], flicker: dict, meta: dict) -> list[dict]:
    rows = []
    for variant in VARIANTS:
        for clip in sp.CLIPS:
            for direction in sp.DIRECTIONS:
                group = [f for f in facts if f["variant"] == variant and f["clip"] == clip.id and f["direction"] == direction]
                if not group:
                    continue
                group.sort(key=lambda f: f["index"])
                fl = flicker[f"{variant}/{clip.id}/{direction}"]
                failed = Counter(name for f in group for name in f["conform_failed"])
                rows.append(
                    {
                        "variant": variant,
                        "clip": clip.id,
                        "direction": direction,
                        "frames": len(group),
                        "source_frames": [f["source_frame"] for f in group],
                        "height": span([f["height"] for f in group]),
                        "width": span([f["width"] for f in group]),
                        "bottom_row": span([f["bottom_row"] for f in group]),
                        "pivot_x": span([f["foot_midpoint"] for f in group]),
                        "sole_pivot_x": span([f["sole_pivot_x"] for f in group if f["sole_pivot_x"] is not None]) if any(f["sole_pivot_x"] is not None for f in group) else "n/a",
                        "colours": span([f["colours"] for f in group]),
                        "colours_max": max(f["colours"] for f in group),
                        "outside_palette": max(f["outside_palette"] for f in group),
                        "outline_all": all(f["outline"] for f in group),
                        "binary_alpha_all": all(f["binary_alpha"] for f in group),
                        "partial_alpha_in": max(f["raw"]["partial_alpha"] for f in group),
                        "stray_px": max(f["stray_px"] for f in group),
                        "isolated_px": max(f["isolated_px"] for f in group),
                        "conform_pass": sum(1 for f in group if f["conform"] == "pass"),
                        "conform_status": dict(Counter(f["conform"] for f in group)),
                        "conform_failed": dict(failed),
                        "flicker_changed_stable": fl["changed_stable"],
                        "flicker_stable_opaque": fl["stable_opaque"],
                        "flicker_exact_static_pairs": fl["exact_static_pairs"],
                        "flicker_pairs": fl["pairs"],
                    }
                )
    return rows


def jitter_table(meta: dict) -> dict:
    """Sub-pixel jitter per clip and facing from the 3D positions projected through the fixed camera (1x pixels)."""
    out: dict = {}
    for clip in sp.CLIPS:
        for direction in sp.DIRECTIONS:
            frames = sorted(
                (f for f in meta["frames"] if f["clip"] == clip.id and f["direction"] == direction), key=lambda f: f["index"]
            )
            if not frames:
                continue
            out[f"{clip.id}/{direction}"] = {
                "root_ground": sm.jitter([f["root_ground_px"] for f in frames]),
                "sole_mid": sm.jitter([f["sole_mid_px"] for f in frames]),
                "lowest_point": sm.jitter([f["lowest_px"] for f in frames]),
                "feet": {
                    name: sm.jitter([f["foot_px"][name] for f in frames]) for name in ("foot_l", "foot_r", "ball_l", "ball_r")
                },
                "figure_bottom_y": sm.range_stats([f["extent_px"]["bottom"] for f in frames]),
                "figure_top_y": sm.range_stats([f["extent_px"]["top"] for f in frames]),
                "toe_drop_below_sole_mid_y": sm.range_stats([f["extent_px"]["bottom"] - f["sole_mid_px"][1] for f in frames]),
            }
    return out


# --- sheets -----------------------------------------------------------------------------------------------


def zeus_tile() -> Raster:
    atlas = decode_png(ZEUS_ATLAS)
    rows = [atlas.rgba[(y * atlas.width) * 4 : (y * atlas.width + sp.CELL[0]) * 4] for y in range(sp.CELL[1])]
    return Raster(sp.CELL[0], sp.CELL[1], b"".join(rows))


def clip_row(cells: dict, variant: str, clip: sp.ClipSpec, zeus: Raster, transform=lambda r: r) -> list[Tile]:
    row = [Tile("ZX", transform(zeus), 0)]
    for g, direction in enumerate(sp.DIRECTIONS, start=1):
        for index in range(clip.frames):
            image = cells.get((variant, clip.id, direction, index))
            row.append(Tile(tile_label(direction, index), None if image is None else transform(image), g))
    return row


def write_sheets(cells: dict, zeus: Raster, out: Path) -> dict:
    paths = {}
    for variant in VARIANTS:
        rows = [clip_row(cells, variant, clip, zeus) for clip in sp.CLIPS]
        sheet = contact_sheet(rows, [ROW_CODES[c.id] for c in sp.CLIPS])
        paths[f"{variant}-1x"] = out / f"contact-{variant}-1x.png"
        paths[f"{variant}-4x"] = out / f"contact-{variant}-4x.png"
        encode_png(sheet, paths[f"{variant}-1x"])
        encode_png(enlarge(sheet, 4), paths[f"{variant}-4x"])
    combined, labels = [], []
    for clip in sp.CLIPS:
        for variant in VARIANTS:
            combined.append(clip_row(cells, variant, clip, zeus))
            labels.append(ROW_CODES[clip.id] + ("D" if variant == "direct" else "X"))
    sheet = contact_sheet(combined, labels)
    paths["compare-1x"], paths["compare-4x"] = out / "contact-compare-1x.png", out / "contact-compare-4x.png"
    encode_png(sheet, paths["compare-1x"])
    encode_png(enlarge(sheet, 4), paths["compare-4x"])
    sil_rows = [clip_row(cells, "x4", clip, zeus, transform=silhouette) for clip in sp.CLIPS]
    paths["silhouette-1x"] = out / "silhouette-x4-1x.png"
    encode_png(contact_sheet(sil_rows, [ROW_CODES[c.id] for c in sp.CLIPS]), paths["silhouette-1x"])
    return {k: str(v.relative_to(REPO)) for k, v in paths.items()}


# --- east/west mirror -------------------------------------------------------------------------------------


def mirror_report(maps: dict) -> list[dict]:
    """How far the west render is from a mirrored east render. The light is fixed upper-left, so even a symmetric
    mesh would differ here; an asymmetric pose (weight on one leg, a raised arm) differs more."""
    rows = []
    for variant in VARIANTS:
        for clip in sp.CLIPS:
            xor = changed = shared = 0
            for index in range(clip.frames):
                east, west = maps.get((variant, clip.id, "east", index)), maps.get((variant, clip.id, "west", index))
                if east is None or west is None:
                    continue
                pair = sm.flicker_pair(sm.mirror_x(east, *sp.CELL), west, *sp.CELL)
                xor += pair["silhouette_xor"]
                changed += pair["changed_any"]
                shared += pair["opaque_both"]
            rows.append({"variant": variant, "clip": clip.id, "silhouette_xor": xor, "changed_any": changed, "opaque_both": shared})
    return rows


# --- direct against 4x -------------------------------------------------------------------------------------


def variant_agreement(maps: dict) -> list[dict]:
    """How different the direct cell and the 4x-mode cell of the same frame are, per clip."""
    rows = []
    for clip in sp.CLIPS:
        xor = changed = shared = opaque = cells = 0
        for direction in sp.DIRECTIONS:
            for index in range(clip.frames):
                a, b = maps.get(("direct", clip.id, direction, index)), maps.get(("x4", clip.id, direction, index))
                if a is None or b is None:
                    continue
                pair = sm.flicker_pair(a, b, *sp.CELL)
                xor += pair["silhouette_xor"]
                changed += pair["changed_any"]
                shared += pair["opaque_both"]
                opaque += sum(1 for v in a if v != sm.TRANSPARENT)
                cells += 1
        rows.append({"clip": clip.id, "cells": cells, "direct_opaque": opaque, "silhouette_xor": xor, "changed_any": changed, "opaque_both": shared})
    return rows


# --- sub-pixel stability ---------------------------------------------------------------------------------


def subpixel_report(meta: dict, render_dir: Path, palette: Palette, cells_out: Path) -> list[dict]:
    results = []
    for variant in VARIANTS:
        maps, labels = [], []
        for record in meta.get("subpixel", []):
            src = decode_png(render_dir / record["files"][variant])
            cell, _ = build_cell(variant, src, palette)
            encode_png(cell, cells_out / "subpixel" / variant / f"dx{int(record['dx'] * 100):02d}_dy{int(record['dy'] * 100):02d}.png")
            maps.append(sm.index_map(cell, palette.colours))
            labels.append((record["dx"], record["dy"]))
        for (dx, dy), indices in list(zip(labels, maps, strict=True))[1:]:
            pair = sm.flicker_pair(maps[0], indices, *sp.CELL)
            pair.pop("exact_static")
            results.append({"variant": variant, "dx": dx, "dy": dy, **pair})
    return results


# --- main -------------------------------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scratch", default=str(ROOT / "scratch"))
    args = ap.parse_args()
    scratch = Path(args.scratch)
    render_dir = scratch / "render"
    out = scratch / "report"
    meta = json.loads((render_dir / "meta.json").read_text())
    palette = load_palette(PALETTE_JSON)

    post_ms = {v: 0.0 for v in VARIANTS}
    facts: list[dict] = []
    cells: dict = {}
    maps: dict = {}
    cell_paths: dict = {}
    for entry in meta["frames"]:
        for variant in VARIANTS:
            if variant not in entry["files"]:
                continue
            started = time.perf_counter()
            src = decode_png(render_dir / entry["files"][variant])
            cell, interior = build_cell(variant, src, palette)
            post_ms[variant] += (time.perf_counter() - started) * 1000.0
            name = sp.output_name(entry["clip"], entry["direction"], entry["index"], variant).replace(f".{variant}.png", ".png")
            path = out / "cells" / variant / name
            encode_png(cell, path)
            key = (variant, entry["clip"], entry["direction"], entry["index"])
            cells[key] = cell
            maps[key] = sm.index_map(cell, palette.colours)
            cell_paths[key] = path
            facts.append({**cell_facts(cell, interior, palette, entry, variant, input_stats(src, palette)), "file": str(path.relative_to(REPO))})
    verdicts = conform(list(cell_paths.values()))
    for fact in facts:
        verdict = verdicts[str(REPO / fact["file"])]
        fact["conform"] = verdict["status"]
        fact["conform_failed"] = [c["check"] for c in verdict.get("checks", []) if c["status"] != "pass"]
        fact["conform_messages"] = [f"{c['check']}: {c['message']}" for c in verdict.get("checks", []) if c["status"] != "pass"]
        fact["conform_pixels_changed"] = verdict.get("pixelsChanged")

    flicker = {}
    for variant in VARIANTS:
        for clip in sp.CLIPS:
            for direction in sp.DIRECTIONS:
                series = [maps[(variant, clip.id, direction, i)] for i in range(clip.frames) if (variant, clip.id, direction, i) in maps]
                if series:
                    flicker[f"{variant}/{clip.id}/{direction}"] = sm.flicker_series(series, *sp.CELL, clip.loop)

    zeus = zeus_tile()
    zeus_measured = measure(zeus, palette)
    zeus_measured.pop("palette_entries")
    sheets = write_sheets(cells, zeus, out)
    subpixel = subpixel_report(meta, render_dir, palette, out)

    result = {
        "post_ms": {v: round(ms, 1) for v, ms in post_ms.items()},
        "post_ms_per_cell": {v: round(post_ms[v] / max(1, sum(1 for f in facts if f["variant"] == v)), 2) for v in VARIANTS},
        "render_timings_ms": meta["timings_ms"],
        "summary": aggregate(facts, flicker, meta),
        "jitter": jitter_table(meta),
        "subpixel": subpixel,
        "mirror": mirror_report(maps),
        "variant_agreement": variant_agreement(maps),
        "render_time_stats": report_md.render_time_stats(meta["frames"]),
        "zeus_canon_frame": zeus_measured,
        "sheets": sheets,
        "flicker": {k: {kk: vv for kk, vv in v.items() if kk != "per_pair"} for k, v in flicker.items()},
        "cells": facts,
    }
    out.mkdir(parents=True, exist_ok=True)
    (out / "results-tables.md").write_text(
        "\n\n".join(
            [
                "### Summary per clip and variant\n\n" + report_md.summary_table(result["summary"]),
                "### Per clip, facing and variant\n\n" + report_md.detail_table(result["summary"]),
                "### Jitter (3D positions through the fixed camera, 1x pixels)\n\n" + report_md.jitter_table(result["jitter"]),
                "### Sub-pixel palette stability (idle south frame 0, shifted)\n\n" + report_md.subpixel_table(result["subpixel"]),
                "### East/west mirror\n\n" + report_md.mirror_table(result["mirror"]),
                "### Direct against 4x mode (same frame)\n\n" + report_md.agreement_table(result["variant_agreement"]),
                "### Timing\n\n" + report_md.timing_table(result["render_time_stats"], result["post_ms_per_cell"]),
            ]
        )
        + "\n"
    )
    (out / "results.json").write_text(json.dumps(result, indent=1) + "\n")
    print(json.dumps({"cells": len(facts), "sheets": sheets, "post_ms": result["post_ms"]}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Markdown tables for the Blender sprite probe's results.json. Pure formatting; no IO."""

from __future__ import annotations

import statistics
from collections.abc import Sequence


def render_time_stats(frames: Sequence[dict]) -> dict:
    """Per-variant render timing (ms) from the per-image timings: the first image pays for shader compilation."""
    out: dict = {}
    for variant in ("direct", "x4"):
        times = [f["render_ms"][variant] for f in frames if variant in f.get("render_ms", {})]
        if not times:
            continue
        out[variant] = {
            "images": len(times),
            "first_ms": round(times[0], 1),
            "median_ms": round(statistics.median(times), 1),
            "mean_ms": round(statistics.fmean(times), 1),
            "max_ms": round(max(times), 1),
            "total_ms": round(sum(times), 1),
            "steady_state_mean_ms": round(statistics.fmean(times[1:]), 1) if len(times) > 1 else None,
        }
    return out


def pct(part: int, whole: int) -> str:
    return "n/a" if whole == 0 else f"{100 * part / whole:.1f}%"


def _row(cells: Sequence[object]) -> str:
    return "| " + " | ".join(str(c) for c in cells) + " |"


def table(headers: Sequence[str], rows: Sequence[Sequence[object]]) -> str:
    lines = [_row(headers), _row(["---"] * len(headers))]
    lines += [_row(r) for r in rows]
    return "\n".join(lines)


def conformance_cell(row: dict) -> str:
    total = sum(row["conform_status"].values())
    text = f"{row['conform_pass']}/{total} pass"
    if row["conform_failed"]:
        text += " (fails: " + ", ".join(f"{k}×{v}" for k, v in sorted(row["conform_failed"].items())) + ")"
    return text


def summary_table(rows: Sequence[dict]) -> str:
    """Per clip and variant, aggregated over the four facings."""
    grouped: dict = {}
    for r in rows:
        grouped.setdefault((r["clip"], r["variant"]), []).append(r)
    out = []
    for (clip, variant), group in grouped.items():
        heights = [h for r in group for h in _numbers(r["height"])]
        bottoms = [h for r in group for h in _numbers(r["bottom_row"])]
        changed = sum(r["flicker_changed_stable"] for r in group)
        stable = sum(r["flicker_stable_opaque"] for r in group)
        passed = sum(r["conform_pass"] for r in group)
        total = sum(sum(r["conform_status"].values()) for r in group)
        out.append(
            [
                clip,
                variant,
                f"{sum(r['frames'] for r in group)}",
                f"{min(heights):g}–{max(heights):g}",
                f"{min(bottoms):g}–{max(bottoms):g}",
                max(r["colours_max"] for r in group),
                "yes" if all(r["outline_all"] for r in group) else "NO",
                "yes" if all(r["binary_alpha_all"] for r in group) else "NO",
                f"{passed}/{total}",
                f"{changed}/{stable} ({pct(changed, stable)})",
            ]
        )
    return table(
        ["clip", "variant", "cells", "height px (incl. outline)", "bottom row", "colours (max)", "outline", "binary alpha", "conformance", "flicker: stable px changed / stable px"],
        out,
    )


def _numbers(text: str) -> list[float]:
    return [float(part) for part in text.replace("–", " ").split()]


def detail_table(rows: Sequence[dict]) -> str:
    out = []
    for r in rows:
        out.append(
            [
                r["clip"],
                r["direction"],
                r["variant"],
                r["frames"],
                r["height"],
                r["width"],
                r["bottom_row"],
                r["pivot_x"],
                r["sole_pivot_x"],
                r["colours"],
                r["outside_palette"],
                "yes" if r["outline_all"] else "NO",
                "yes" if r["binary_alpha_all"] else "NO",
                conformance_cell(r),
                f"{r['flicker_changed_stable']}/{r['flicker_stable_opaque']}",
                f"{r['stray_px']}/{r['isolated_px']}",
            ]
        )
    return table(
        ["clip", "facing", "variant", "frames", "height", "width", "bottom row", "foot-row midpoint x", "sole-cluster midpoint x", "colours", "off-palette", "outline", "alpha binary", "conformance", "flicker changed/stable", "stray/isolated px"],
        out,
    )


def jitter_table(jitter: dict) -> str:
    out = []
    for key, v in jitter.items():
        clip, direction = key.split("/")
        out.append(
            [
                clip,
                direction,
                v["root_ground"]["max_pair_distance"],
                v["sole_mid"]["max_pair_distance"],
                v["lowest_point"]["max_pair_distance"],
                max(f["max_pair_distance"] for f in v["feet"].values()),
                v["figure_bottom_y"]["range"],
                f"{v['toe_drop_below_sole_mid_y']['min']:g}–{v['toe_drop_below_sole_mid_y']['max']:g}",
            ]
        )
    return table(
        ["clip", "facing", "root ground point", "sole midpoint", "lowest vertex", "worst single foot/ankle bone", "figure bottom y range", "toe drop below sole midpoint (px)"],
        out,
    )


def subpixel_table(rows: Sequence[dict]) -> str:
    out = []
    for r in rows:
        out.append(
            [
                r["variant"],
                f"{r['dx']:g}, {r['dy']:g}",
                r["silhouette_xor"],
                f"{r['changed_stable']}/{r['stable_opaque']} ({pct(r['changed_stable'], r['stable_opaque'])})",
                f"{r['changed_any']}/{r['opaque_both']} ({pct(r['changed_any'], r['opaque_both'])})",
            ]
        )
    return table(["variant", "offset px (dx, dy)", "silhouette XOR px", "index changed, stable px", "index changed, all shared px"], out)


def mirror_table(rows: Sequence[dict]) -> str:
    out = []
    for r in rows:
        out.append(
            [
                r["variant"],
                r["clip"],
                r["silhouette_xor"],
                f"{r['changed_any']}/{r['opaque_both']} ({pct(r['changed_any'], r['opaque_both'])})",
            ]
        )
    return table(["variant", "clip", "silhouette XOR px, mirror(east) vs west", "index differs, shared px"], out)


def agreement_table(rows: Sequence[dict]) -> str:
    out = []
    for r in rows:
        out.append(
            [
                r["clip"],
                r["cells"],
                f"{r['silhouette_xor']}/{r['direct_opaque']} ({pct(r['silhouette_xor'], r['direct_opaque'])})",
                f"{r['changed_any']}/{r['opaque_both']} ({pct(r['changed_any'], r['opaque_both'])})",
            ]
        )
    return table(["clip", "cells", "silhouette XOR px / direct opaque px", "palette index differs, shared px"], out)


def timing_table(stats: dict, post_per_cell: dict) -> str:
    out = []
    for variant, s in stats.items():
        out.append(
            [
                variant,
                s["images"],
                s["first_ms"],
                s["steady_state_mean_ms"],
                s["median_ms"],
                s["max_ms"],
                s["total_ms"],
                post_per_cell.get(variant),
            ]
        )
    return table(["variant", "images", "first image ms (shader compile)", "mean ms after first", "median ms", "max ms", "total ms", "post step ms per cell"], out)


def zeus_summary_table(rows: Sequence[dict]) -> str:
    out = []
    for r in rows:
        out.append(
            [
                r["variant"],
                r["clip"],
                r["cells"],
                r["height"],
                r["bottom_row"],
                "yes" if r["anchor_all_32_74"] else "NO",
                r["colours_max"],
                "yes" if r["outline_all"] else "NO",
                "yes" if r["binary_alpha_all"] else "NO",
                f"{r['conform_pass']}/{r['cells']}" + (f" ({r['conform_failed']})" if r["conform_failed"] else ""),
                r["overlap_px_mean"],
                f"{r['flicker_changed_stable']}/{r['flicker_stable_opaque']} ({pct(r['flicker_changed_stable'], r['flicker_stable_opaque'])})",
                f"{r['cells_needing_repair']}/{r['cells']}",
                f"{r['repair_px_total']} (max {r['repair_px_max']})",
            ]
        )
    return table(
        ["shading", "clip", "cells", "height px (incl. outline)", "bottom row", "anchor exactly (32, 74)", "colours (max)", "outline", "binary alpha", "conformance", "overlap-line px per cell", "flicker: stable px changed / stable px", "cells needing hand pixels", "repair px total (max per cell)"],
        out,
    )


def zeus_repair_table(rows: Sequence[dict]) -> str:
    """rows: per cell {variant, issues:[{kind, pixels}]}; totals per variant and kind."""
    kinds: dict = {}
    for r in rows:
        for i in r["issues"]:
            k = kinds.setdefault((i["kind"], r["variant"]), [0, 0])
            k[0] += 1
            k[1] += i["pixels"]
    names = sorted({k for k, _ in kinds})
    out = []
    for name in names:
        a, b = kinds.get((name, "a3"), [0, 0]), kinds.get((name, "b2"), [0, 0])
        out.append([name, f"{a[0]} cells, {a[1]} px", f"{b[0]} cells, {b[1]} px"])
    return table(["repair kind", "a3 (3-band)", "b2 (2-tone)"], out)


def zeus_timing_table(timings: dict) -> str:
    out = []
    for key in ("a3", "b2", "id", "depth"):
        t = timings[key]
        out.append([key, t["images"], t["total"], t["mean"]])
    return table(["pass", "images", "total ms", "mean ms"], out) + f"\n\nWall clock for the whole render script: {timings['wall_clock_total']} ms."


def zeus_playback_table(files: dict) -> str:
    out = [[k, v["frames"], f"{v['size'][0]}×{v['size'][1]}", v["bytes"], ", ".join(v["panels"]), v["path"]] for k, v in files.items()]
    return table(["gif", "steps", "size", "bytes", "panels left to right", "path"], out)

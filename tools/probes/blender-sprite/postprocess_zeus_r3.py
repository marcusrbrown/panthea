"""Round 3 post step: x4 route, overlap lines, authored bolt stamp, corrected repair estimate, criteria pre-check.

    python3 tools/probes/blender-sprite/postprocess_zeus_r3.py [--scratch DIR] [--no-playback]

Reads `<scratch>/zeus-render-r3/meta.json` (render_zeus_r3.py) and the stamps in `stamps/`; writes `zeus-r3-*` files and
`repairs-r3.json` under `<scratch>/report/`. No frame is hand-edited: the stamp is authored art composited by script, and
everything that would still need hand pixels is estimated in `repairs-r3.json`, not applied.
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

import bake_plan as bp  # noqa: E402
import postprocess as p1  # noqa: E402
import postprocess_zeus as pz  # noqa: E402
import repairs_r3 as rr  # noqa: E402
import report_md  # noqa: E402
import sprite_metrics as sm  # noqa: E402
import sprite_plan as sp  # noqa: E402
import stamp_gen  # noqa: E402
from pipeline import Raster, decode_png, encode_png  # noqa: E402
from sprite_downscale import load_palette, measure  # noqa: E402

VARIANT_IDS = tuple(v.id for v in bp.VARIANTS)
LETTERS = {"s3": "S", "b2": "B"}
CRITERIA_FILE = "r3-criteria.json"
W, H = sp.CELL


def load_stamps() -> dict[int, dict]:
    info = json.loads((stamp_gen.STAMP_DIR / "bolt-stamps.json").read_text())
    out = {}
    for v in info["variants"]:
        image = decode_png(stamp_gen.STAMP_DIR / v["file"])
        pixels = {}
        for y in range(image.height):
            for x in range(image.width):
                p = image.pixel(x, y)
                if p[3]:
                    pixels[(x, y)] = p[:3]
        out[v["angle_deg"]] = {"pixels": pixels, "anchor": tuple(v["anchor"]), "file": v["file"]}
    return out


def place_stamp(cell: Raster, locator: dict, offset: tuple[float, float], stamps: dict, parts: list, depths: list) -> dict:
    """Composite the stamp for a pose onto a finished cell (a copy). `offset` shifts the locator (sub-pixel test)."""
    base = [locator["base_px"][0] + offset[0], locator["base_px"][1] + offset[1]]
    tip = [locator["tip_px"][0] + offset[0], locator["tip_px"][1] + offset[1]]
    angle = bp.nearest_angle(bp.screen_angle_deg(base, tip))
    stamp = stamps[angle]
    origin = bp.stamp_origin(base, tip, stamp["anchor"])
    report = bp.composite_stamp(stamp["pixels"], origin, locator["base_depth"], parts, depths, W, H)
    out = bytearray(cell.rgba)
    for i, colour in report["drawn"].items():
        out[i * 4 : i * 4 + 4] = bytes((*colour, 255))
    all_xy = {(origin[0] + x, origin[1] + y) for x, y in stamp["pixels"]}
    drawn_xy = {(i % W, i // W) for i in report["drawn"]}
    return {
        "cell": Raster(W, H, bytes(out)),
        "angle": angle,
        "origin": origin,
        "all_xy": all_xy,
        "drawn_xy": drawn_xy,
        "clipped": report["clipped"],
        "occluded": report["occluded"],
        "protected": report["protected"],
        "screen_length_px": round(((tip[0] - base[0]) ** 2 + (tip[1] - base[1]) ** 2) ** 0.5, 2),
    }


def colour_grid(cell: Raster) -> list:
    return [pz.rgb_at(cell, i) for i in range(W * H)]


def pad(text: str) -> str:
    return text


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scratch", default=str(ROOT / "scratch"))
    ap.add_argument("--no-playback", action="store_true")
    args = ap.parse_args()
    scratch = Path(args.scratch)
    render_dir = scratch / "zeus-render-r3"
    out = scratch / "report"
    meta = json.loads((render_dir / "meta.json").read_text())
    palette = load_palette(p1.PALETTE_JSON)
    darkest = set(palette.darkest.values())
    stamps = load_stamps()
    started = time.perf_counter()

    cells: dict = {}
    maps: dict = {}
    parts_by: dict = {}
    stamp_by: dict = {}
    facts: list[dict] = []
    cell_paths: dict = {}
    for entry in meta["frames"]:
        parts, depths, unknown = pz.block_maps(decode_png(render_dir / entry["files"]["id"]), decode_png(render_dir / entry["files"]["depth"]))
        for variant in VARIANT_IDS:
            built = pz.build_cell(render_dir / entry["files"][variant], parts, depths, palette)
            placed = place_stamp(built["cell"], entry["bolt_locator"], (0.0, 0.0), stamps, parts, depths)
            cell = placed["cell"]
            key = (variant, entry["clip"], entry["direction"], entry["index"])
            cells[key] = cell
            maps[key] = sm.index_map(cell, palette.colours)
            parts_by[key] = parts
            stamp_by[key] = placed
            path = out / "zeus-r3-cells" / variant / f"{entry['clip']}_{entry['direction']}_{entry['index']:02d}.png"
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
                    "extent_px": entry["extent_px"],
                    "stamp": {"angle": placed["angle"], "origin": list(placed["origin"]), "screen_length_px": placed["screen_length_px"], "drawn": len(placed["drawn_xy"]), "total": len(placed["all_xy"]), "occluded": placed["occluded"], "protected": placed["protected"], "clipped": placed["clipped"]},
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
            for d in pz.DIRS_BY_CLIP[clip.id]:
                flicker[f"{variant}/{clip.id}/{d}"] = sm.flicker_series([maps[(variant, clip.id, d, i)] for i in range(clip.frames)], W, H, clip.loop)

    # --- corrected repair estimate: union of unique pixels per cell ---------------------------------------------
    per_cell: dict = {}
    visibility: dict = {}
    blip_denominator: dict = {v: [0, 0] for v in VARIANT_IDS}
    for f in facts:
        key = (f["variant"], f["clip"], f["direction"], f["index"])
        clip = next(c for c in sp.CLIPS if c.id == f["clip"])
        n, i = clip.frames, f["index"]
        kinds: dict[str, set] = {}
        if n >= 3 and (clip.loop or 0 < i < n - 1):
            prev, nxt = maps[(key[0], key[1], key[2], (i - 1) % n)], maps[(key[0], key[1], key[2], (i + 1) % n)]
            kinds["temporal_blips"] = rr.stable_triplet_blips(prev, maps[key], nxt, W, H)
            blip_denominator[key[0]][0] += len(kinds["temporal_blips"])
            blip_denominator[key[0]][1] += rr.stable_triplet_count(prev, maps[key], nxt, W, H)
        colours = colour_grid(cells[key])
        kinds["bottom_crop"] = rr.bottom_crop(colours, darkest, f["extent_px"]["bottom"], W, H)
        kinds["over_height"] = rr.over_height(maps[key], W, H)
        kinds["isolated_pixels"] = rr.isolated(maps[key], W, H)
        st = stamp_by[key]
        hand_px = sum(1 for p in parts_by[key] if p == "hand_r")
        lost, bolt_info = rr.bolt_shape(st["all_xy"], st["drawn_xy"], st["clipped"], hand_px, hand_px)
        kinds["bolt_shape"] = lost
        if f["colours"] > 16:
            kinds["colour_budget"] = {(0, 0)}
        if not f["anchor_ok"]:
            kinds["anchor"] = {(0, 0)}
        estimate = rr.union_estimate(kinds)
        per_cell[key] = {**estimate, "bolt_shape_info": bolt_info}
        f["repair_px"] = estimate["pixels"]
        f["repair_by_kind"] = estimate["by_kind"]
        visibility[key] = rr.visibility_measures(f["clip"], parts_by[key], st["drawn_xy"], W, H)

    averages = {}
    verdict_d = {}
    for variant in VARIANT_IDS:
        rows = [(k[1], v["pixels"]) for k, v in per_cell.items() if k[0] == variant]
        averages[variant] = rr.averages(rows)
        verdict_d[variant] = rr.sparse_verdict(averages[variant])

    # --- canon calibration (same corrected detector, canon idle's 4 frames) ------------------------------------
    atlas = decode_png(p1.ZEUS_ATLAS)
    canon_frames = [Raster(64, 80, b"".join(atlas.rgba[(y * atlas.width + 64 * k) * 4 : (y * atlas.width + 64 * k + 64) * 4] for y in range(80))) for k in range(4)]
    canon_maps = [sm.index_map(c, palette.colours) for c in canon_frames]
    canon_cells = []
    for k in range(4):
        prev, nxt = canon_maps[(k - 1) % 4], canon_maps[(k + 1) % 4]
        blips = rr.stable_triplet_blips(prev, canon_maps[k], nxt, W, H)
        iso = rr.isolated(canon_maps[k], W, H)
        canon_cells.append({"frame": k, "temporal_blips": len(blips), "triplet_stable_px": rr.stable_triplet_count(prev, canon_maps[k], nxt, W, H), "isolated": len(iso), "union_px": len(blips | iso)})
    canon_flicker = sm.flicker_series(canon_maps, W, H, True)
    canon = {
        "frames": canon_cells,
        "temporal_blips_total": sum(c["temporal_blips"] for c in canon_cells),
        "temporal_blips_mean_per_frame": round(sum(c["temporal_blips"] for c in canon_cells) / 4, 2),
        "union_px_mean_per_frame": round(sum(c["union_px"] for c in canon_cells) / 4, 2),
        "silhouette_stable_change_rate_percent": round(100 * canon_flicker["changed_stable"] / canon_flicker["stable_opaque"], 2),
        "silhouette_stable_change": f"{canon_flicker['changed_stable']}/{canon_flicker['stable_opaque']}",
    }
    ours_idle_blips = {v: [per_cell[(v, "idle", d, i)]["by_kind"].get("temporal_blips", 0) for d in sp.DIRECTIONS for i in range(4)] for v in VARIANT_IDS}
    calibration = {"canon_zeus_idle": canon, "ours_idle_temporal_blips_mean_per_cell": {v: round(sum(x) / len(x), 2) for v, x in ours_idle_blips.items()}}

    # --- criteria pre-check: (a), (c), (d); (b) is the reviewer's -------------------------------------------------
    criteria_a, criteria_c = {}, {}
    for variant in VARIANT_IDS:
        rates = {}
        for d in sp.DIRECTIONS:
            fl = flicker[f"{variant}/idle/{d}"]
            rates[d] = round(100 * fl["changed_stable"] / fl["stable_opaque"], 2)
        criteria_a[variant] = {"per_facing_percent": rates, "max_percent": max(rates.values()), "pass": max(rates.values()) <= 6.0}
        sit = [f for f in facts if f["variant"] == variant and f["clip"] == "sit" and f["direction"] == "north"]
        detail = []
        for f in sit:
            key = (variant, "sit", "north", f["index"])
            cell = cells[key]
            top_side = sum(1 for i in range(W * H) if cell.rgba[i * 4 + 3] and (i % W in (0, W - 1) or i // W == 0))
            detail.append(
                {
                    "frame": f["index"],
                    "extent_bottom": f["extent_px"]["bottom"],
                    "bottom_crop_px": per_cell[key]["by_kind"].get("bottom_crop", 0),
                    "top_or_side_edge_px": top_side,
                    "left": f["extent_px"]["left"],
                    "right": f["extent_px"]["right"],
                    "top": f["extent_px"]["top"],
                    "outline_ok": f["outline"],
                }
            )
        criteria_c[variant] = {"frames": detail, "pass": all(d["extent_bottom"] <= H - 1 + 1e-6 + 0 and d["bottom_crop_px"] == 0 and d["top_or_side_edge_px"] == 0 and d["left"] >= 0 and d["right"] <= W and d["top"] >= 0 for d in detail)}
    precheck = {
        v: {
            "a_idle_stable_change_le_6pct": criteria_a[v],
            "b_bolt_zigzag_at_1x": "reviewer item, not scored by the script",
            "c_sit_north_fits": criteria_c[v],
            "d_repair_estimate_sparse": {**averages[v], **verdict_d[v]},
            "a_c_d_all_pass": criteria_a[v]["pass"] and criteria_c[v]["pass"] and verdict_d[v]["pass"],
        }
        for v in VARIANT_IDS
    }

    # --- where the idle flicker sits, by body part (diagnosis; not a criterion) -------------------------------------
    by_part: dict = {}
    for variant in VARIANT_IDS:
        for d in sp.DIRECTIONS:
            counts: dict[str, list[int]] = {}
            for i in range(4):
                a, b = maps[(variant, "idle", d, i)], maps[(variant, "idle", d, (i + 1) % 4)]
                parts = parts_by[(variant, "idle", d, i)]
                for y in range(H):
                    for x in range(W):
                        k = y * W + x
                        if a[k] == sm.TRANSPARENT or b[k] == sm.TRANSPARENT:
                            continue
                        if not all(
                            (a[ny * W + nx] == sm.TRANSPARENT) == (b[ny * W + nx] == sm.TRANSPARENT)
                            for ny in range(max(0, y - 1), min(H, y + 2))
                            for nx in range(max(0, x - 1), min(W, x + 2))
                        ):
                            continue
                        c = counts.setdefault(parts[k] or "stamp", [0, 0])
                        c[1] += 1
                        c[0] += a[k] != b[k]
            by_part[f"{variant}/{d}"] = {k: v for k, v in counts.items()}
    group = {"cloth (robe_upper, robe_skirt, belt, torso)": ("robe_upper", "robe_skirt", "belt", "torso"), "limbs (arm_l/r, hand_l/r, leg_l/r)": ("arm_l", "arm_r", "hand_l", "hand_r", "leg_l", "leg_r"), "head (head, hair, beard)": ("head", "hair", "beard")}
    flicker_groups = {}
    for variant in VARIANT_IDS:
        rows = {}
        for name, members in group.items():
            ch = sum(by_part[f"{variant}/{d}"].get(m, [0, 0])[0] for d in sp.DIRECTIONS for m in members)
            st = sum(by_part[f"{variant}/{d}"].get(m, [0, 0])[1] for d in sp.DIRECTIONS for m in members)
            rows[name] = {"changed": ch, "stable": st, "percent": round(100 * ch / max(1, st), 2)}
        flicker_groups[variant] = rows

    # --- sheets, playback, sub-pixel ----------------------------------------------------------------------------
    zeus = p1.zeus_tile()
    zeus_idle = canon_frames
    sheets = pz.write_sheets(cells, zeus, out, prefix="zeus-r3", variants=VARIANT_IDS, letters=LETTERS)
    playback_files = {} if args.no_playback else pz.write_playback(cells, zeus_idle, out, prefix="zeus-r3", variants=VARIANT_IDS)

    subpixel = []
    for variant in VARIANT_IDS:
        built_maps, labels = [], []
        for rec in meta.get("subpixel", []):
            parts, depths, _ = pz.block_maps(decode_png(render_dir / rec["files"]["id"]), decode_png(render_dir / rec["files"]["depth"]))
            cell = pz.build_cell(render_dir / rec["files"][variant], parts, depths, palette)["cell"]
            cell = place_stamp(cell, rec["bolt_locator"], (rec["dx"], rec["dy"]), stamps, parts, depths)["cell"]
            encode_png(cell, out / "zeus-r3-subpixel" / variant / f"dx{int(rec['dx'] * 100):02d}_dy{int(rec['dy'] * 100):02d}.png")
            built_maps.append(sm.index_map(cell, palette.colours))
            labels.append((rec["dx"], rec["dy"]))
        for (dx, dy), idx in list(zip(labels, built_maps, strict=True))[1:]:
            pair = sm.flicker_pair(built_maps[0], idx, W, H)
            pair.pop("exact_static")
            subpixel.append({"variant": variant, "dx": dx, "dy": dy, **pair})

    # --- logs --------------------------------------------------------------------------------------------------
    repair_log = {
        "rule": "No frame was hand-edited. This is an estimate of what would still need hand pixels, as a union of unique pixels per cell; nothing was applied. The bolt stamp is authored art composited by script; its pixels are not repair pixels.",
        "included_kinds": list(rr.STABLE_KINDS),
        "canon_calibration": calibration,
        "averages": averages,
        "sparse_verdict": verdict_d,
        "cells": [
            {"cell": f"{k[0]}/{k[1]}_{k[2]}_{k[3]:02d}", "variant": k[0], "clip": k[1], "facing": k[2], "frame": k[3], **v}
            for k, v in per_cell.items()
            if v["pixels"]
        ],
        "visibility_measures_not_in_total": {f"{k[0]}/{k[1]}_{k[2]}_{k[3]:02d}": v for k, v in visibility.items() if k[0] == "s3"},
        "blip_rate_percent": {v: round(100 * a / max(1, b), 2) for v, (a, b) in blip_denominator.items()},
    }
    out.mkdir(parents=True, exist_ok=True)
    (out / "repairs-r3.json").write_text(json.dumps(repair_log, indent=1) + "\n")

    summary = []
    for variant in VARIANT_IDS:
        for clip in sp.CLIPS:
            group = [f for f in facts if f["variant"] == variant and f["clip"] == clip.id]
            fl = [flicker[f"{variant}/{clip.id}/{d}"] for d in pz.DIRS_BY_CLIP[clip.id]]
            changed, stable = sum(x["changed_stable"] for x in fl), sum(x["stable_opaque"] for x in fl)
            summary.append(
                {
                    "variant": variant, "clip": clip.id, "cells": len(group),
                    "height": p1.span([f["height"] for f in group]),
                    "bottom_row": p1.span([f["bottom_row"] for f in group]),
                    "colours_max": max(f["colours"] for f in group),
                    "outline_all": all(f["outline"] for f in group),
                    "binary_alpha_all": all(f["binary_alpha"] for f in group),
                    "anchor_all_32_74": all(f["anchor_ok"] for f in group),
                    "conform_pass": sum(1 for f in group if f["conform"] == "pass"),
                    "conform_failed": dict(Counter(n for f in group for n in f["conform_failed"])),
                    "overlap_px_mean": round(sum(f["overlap_px"] for f in group) / len(group), 1),
                    "flicker_changed_stable": changed, "flicker_stable_opaque": stable,
                    "repair_px_mean": averages[variant]["mean_per_clip"][clip.id],
                    "repair_px_max": max(f["repair_px"] for f in group),
                    "stamp_visible_mean": round(sum(f["stamp"]["drawn"] / f["stamp"]["total"] for f in group) / len(group), 3),
                }
            )
    result = {
        "post_seconds": round(time.perf_counter() - started, 1),
        "render_timings_ms": meta["timings_ms"],
        "camera": meta["camera"], "seat": meta["seat"], "proxy": meta["proxy"], "variants": meta["variants"],
        "summary": summary, "subpixel": subpixel,
        "flicker": {k: {kk: vv for kk, vv in v.items() if kk != "per_pair"} for k, v in flicker.items()},
        "precheck": precheck, "calibration": calibration,
        "idle_flicker_by_part": by_part, "idle_flicker_groups": flicker_groups,
        "sheets": sheets, "playback": playback_files,
        "stamp_variants_used": dict(Counter(f["stamp"]["angle"] for f in facts if f["variant"] == "s3")),
        "colours_union": {v: len({c for f in facts if f["variant"] == v for c in f["colour_set"]}) for v in VARIANT_IDS},
        "cells": facts,
    }
    (out / "zeus-r3-results.json").write_text(json.dumps(result, indent=1) + "\n")
    print(json.dumps({"cells": len(facts), "precheck": {v: {"a": precheck[v]["a_idle_stable_change_le_6pct"]["max_percent"], "c": precheck[v]["c_sit_north_fits"]["pass"], "d_mean": averages[v]["mean_per_cell"], "d_clips": averages[v]["mean_per_clip"]} for v in VARIANT_IDS}, "canon": canon, "post_seconds": result["post_seconds"]}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

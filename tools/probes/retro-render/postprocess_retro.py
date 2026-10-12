"""Retro-render post step: 4x renders -> palette-exact cells (mode downscale, 1 px exterior outline, overlap lines, authored
stamps), per-cell measurements, boil (information only) and loop seams.

    python3 tools/probes/retro-render/postprocess_retro.py --tag r3 [--items zeus,mortal,...] [--scratch DIR]

Reads `<scratch>/render-<tag>/<item>/meta.json` from `render_retro.py --tag <tag>` and writes
`<scratch>/cells-<tag>/<item>/<variant>/<pose>.png` plus `<scratch>/report/retro-<tag>-<item>-results.json`. Exits 1, before
processing anything, when a requested item has no render (a wrong tag must not look like success). No frame is hand-edited; the
bolt and face stamps are authored art composited by script and are named as such in the results.

Two measurement scopes, labelled in every results file under `measured_on`: height, width, bottom row, outline and the envelope
are measured on the figure **without** the contact shadow; the colour count and the outside-palette check are measured on the
final cell **with** the shadow.
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
sys.path.insert(0, str(REPO / "tools/probes/blender-sprite"))
sys.path.insert(0, str(ROOT))

import bake_plan as bp  # noqa: E402  (blender-sprite: stamp placement)
import overlap  # noqa: E402  (blender-sprite)
import palette_plan as pal  # noqa: E402
import retro_paths as paths  # noqa: E402
import shadow_plan as sh  # noqa: E402
import retro_metrics as rm  # noqa: E402
import retro_plan as rp  # noqa: E402
import sprite_metrics as sm  # noqa: E402  (blender-sprite)
import stamp_plan as stp  # noqa: E402
import tile_geom as tg  # noqa: E402
from pipeline import Raster, decode_png, encode_png  # noqa: E402
from sprite_downscale import add_outline, downscale_figure, load_palette, measure, oklab  # noqa: E402

PALETTE_PATH = ROOT / "palette/scene-palette.json"
BOLT_STAMPS = REPO / "tools/probes/blender-sprite/stamps"
OVERLAP_THRESHOLD_M = {"character": 0.05, "prop": 0.05, "building": 0.10, "tile": 0.05}
VARIANT_IDS: tuple[str, ...] = ("toon",)  # round 2 uses toon only; set from --variants


def lightness(colour: tuple[int, int, int]) -> float:
    return oklab(colour)[0]


def rgb_at(image: Raster, i: int) -> tuple[int, int, int] | None:
    at = i * 4
    return None if image.rgba[at + 3] == 0 else (image.rgba[at], image.rgba[at + 1], image.rgba[at + 2])


# --- passes -> 1x maps ---------------------------------------------------------------------------------------------------


def depth_table(item: rp.Item) -> list[float]:
    near, far = item.depth_range
    return [rp.decode_depth(b, near, far) for b in range(256)]


def block_maps(id_img: Raster, depth_img: Raster, item: rp.Item) -> tuple[list[str | None], list[float], int]:
    """4x ID and depth passes -> per-pixel part (modal part of each 4x4 block) and its mean depth at 1x."""
    factor = rp.SUPERSAMPLE
    w, h = item.cell
    table = depth_table(item)
    ids, depth = id_img.rgba, depth_img.rgba
    width = id_img.width
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
                    part = rp.decode_id(ids[at])
                    if part is None:
                        unknown += 1
                        continue
                    votes[part] += 1
                    total[part] = total.get(part, 0.0) + table[depth[at]]
            if not votes:
                parts.append(None)
                depths.append(0.0)
            else:
                part = max(votes, key=lambda k: (votes[k], k))
                parts.append(part)
                depths.append(total[part] / votes[part])
    return parts, depths, unknown


# --- cell building --------------------------------------------------------------------------------------------------------


def diamond_crop(image: Raster) -> Raster:
    """Keep only the drawn diamond of a 64x32 tile (row 31 belongs to the neighbours); everything else is transparent."""
    mask = tg.diamond_mask()
    out = bytearray(image.width * image.height * 4)
    for y in range(image.height):
        for x in range(image.width):
            if mask[y][x]:
                at = (y * image.width + x) * 4
                out[at : at + 4] = image.rgba[at : at + 4]
                if out[at + 3] == 0:  # an edge pixel the downscale left empty: fill from the nearest opaque neighbour
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < image.width and 0 <= ny < image.height and image.rgba[(ny * image.width + nx) * 4 + 3]:
                            out[at : at + 4] = image.rgba[(ny * image.width + nx) * 4 : (ny * image.width + nx) * 4 + 4]
                            break
    return Raster(image.width, image.height, bytes(out))


def build_cell(item: rp.Item, src: Raster, parts: list | None, depths: list | None, palette) -> dict:
    """4x render -> 1x interior (mode downscale + selective overlap lines). The exterior outline is applied later, once, to the
    final silhouette that includes the stamps."""
    w, h = item.cell
    interior = downscale_figure(src, "mode", h, palette, bbox=(0, 0, src.width, src.height))
    if item.kind == "tile":
        return {"interior": diamond_crop(interior), "drawn": [], "candidates": 0}
    drawn: list[int] = []
    candidates = 0
    if item.overlap and parts is not None:
        pixels = [rgb_at(interior, i) for i in range(w * h)]
        lined = [p if px is not None else None for p, px in zip(parts, pixels, strict=True)]
        cand = overlap.candidate_lines(lined, depths, w, h, OVERLAP_THRESHOLD_M[item.kind])
        candidates = len(cand)
        recoloured, drawn = overlap.apply_lines(pixels, cand, palette.ramp_of, palette.darkest, lightness)
        out = bytearray(interior.rgba)
        for i in drawn:
            out[i * 4 : i * 4 + 4] = bytes((*recoloured[i], 255))
        interior = Raster(w, h, bytes(out))
    return {"interior": interior, "drawn": drawn, "candidates": candidates}


def finalise(item: rp.Item, interior: Raster, palette) -> Raster:
    """One exterior outline over the combined silhouette (render, face and bolt stamps), in the darkest shade of the local ramp."""
    return add_outline(interior, palette) if item.outline and item.kind != "tile" else interior


SHADOW_RAMP, SHADOW_SHADE = "olive", 1  # round 3: one solid shape a step lighter than the outline colour


def with_shadow(item: rp.Item, figure: Raster, palette_doc: dict) -> Raster:
    """The figure over a palette-bound contact shadow (drawn on empty pixels only, after the outline)."""
    if item.shadow is None:
        return figure
    colour = pal.ramp_shades(palette_doc, SHADOW_RAMP)[SHADOW_SHADE]
    shadow = sh.shadow_pixels(figure.width, figure.height, item.origin_px, *item.shadow)
    return Raster(figure.width, figure.height, sh.apply_shadow(figure.rgba, figure.width, figure.height, shadow, colour))


def measure_scopes(figure: Raster, cell: Raster, palette, interior: Raster) -> tuple[dict, dict]:
    """The two measurement scopes of a cell. Returns (figure facts, final-cell facts): the first is measured on the figure without
    the contact shadow (height, width, bottom row, outline), the second on the final cell with it (colours, outside-palette)."""
    on_figure = measure(figure, palette, interior)
    on_cell = measure(cell, palette, interior)
    on_figure.pop("palette_entries")
    on_cell.pop("palette_entries")
    return on_figure, on_cell


def opaque_box(image: Raster) -> tuple[int, int, int, int]:
    xs = [i % image.width for i in range(image.width * image.height) if image.rgba[i * 4 + 3]]
    ys = [i // image.width for i in range(image.width * image.height) if image.rgba[i * 4 + 3]]
    return (min(xs), min(ys), max(xs) + 1, max(ys) + 1)


# --- stamps ---------------------------------------------------------------------------------------------------------------


def hex_rgb(value: str) -> tuple[int, int, int]:
    return (int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16))


def load_bolt_stamps() -> dict[int, dict]:
    """The authored bolt orientations, split into core pixels and the stamp's own darkest-gold outline pixels. The outline pixels
    are drawn only where they overlap the body (a separation line); the exterior outline pass draws the rest."""
    info = json.loads((BOLT_STAMPS / "bolt-stamps.json").read_text())
    dark = hex_rgb(info["palette"]["dark"])
    out = {}
    for v in info["variants"]:
        image = decode_png(BOLT_STAMPS / v["file"])
        pixels = {(x, y): image.pixel(x, y)[:3] for y in range(image.height) for x in range(image.width) if image.pixel(x, y)[3]}
        out[v["angle_deg"]] = {
            "core": {k: c for k, c in pixels.items() if c != dark},
            "outline": {k: c for k, c in pixels.items() if c == dark},
            "anchor": tuple(v["anchor"]),
        }
    return out


def paint(cell: Raster, drawn: dict[int, tuple[int, int, int]]) -> Raster:
    out = bytearray(cell.rgba)
    for i, colour in drawn.items():
        out[i * 4 : i * 4 + 4] = bytes((*colour, 255))
    return Raster(cell.width, cell.height, bytes(out))


def apply_stamps(item: rp.Item, cell: Raster, entry: dict, parts: list, depths: list, bolt_stamps: dict | None, palette_doc: dict) -> tuple[Raster, dict]:
    """Authored face stamp (Zeus and the mortal) and bolt stamp (Zeus), composited by script onto the interior. Returns the
    cell and a record of what was drawn."""
    w, h = cell.width, cell.height
    record: dict = {}
    loc = entry["locators"]
    (eye_ramp, eye_shade), (brow_ramp, brow_shade) = stp.FACE_COLOURS[item.id]
    eye_rgb = pal.ramp_shades(palette_doc, eye_ramp)[eye_shade]
    brow_rgb = pal.ramp_shades(palette_doc, brow_ramp)[brow_shade]
    eyes = {k[-1]: (loc[k]["px"][0], loc[k]["px"][1], loc[k]["depth"]) for k in ("eyes_l", "eyes_r") if k in loc}
    if entry["facing"] != "north" and eyes:
        face = stp.face_pixels(entry["facing"], eyes, parts, w, h, eye_rgb, brow_rgb)
        cell = paint(cell, face["drawn"])
        record["face"] = {"planned": face["planned"], "drawn": len(face["drawn"]), "skipped": face["skipped"]}
    else:
        record["face"] = {"planned": 0, "drawn": 0, "skipped": 0}
    if bolt_stamps is not None and "bolt" in loc:
        b = loc["bolt"]
        angle = bp.nearest_angle(bp.screen_angle_deg(b["base_px"], b["tip_px"]))
        stamp = bolt_stamps[angle]
        origin = bp.stamp_origin(b["base_px"], b["tip_px"], stamp["anchor"])
        core = bp.composite_stamp(stamp["core"], origin, b["base_depth"], parts, depths, w, h)
        cell = paint(cell, core["drawn"])
        rim = bp.composite_stamp(stamp["outline"], origin, b["base_depth"], parts, depths, w, h)
        over_body = {i: c for i, c in rim["drawn"].items() if cell.rgba[i * 4 + 3]}  # a separation line only where it lies on the body
        cell = paint(cell, over_body)
        total = len(stamp["core"]) + len(stamp["outline"])
        record["bolt"] = {
            "angle": angle, "drawn": len(core["drawn"]) + len(over_body), "total": total, "core_drawn": len(core["drawn"]), "core_total": len(stamp["core"]),
            "occluded": core["occluded"], "protected": core["protected"], "clipped": core["clipped"], "outline_on_body": len(over_body),
        }
    return cell, record


# --- item processing ------------------------------------------------------------------------------------------------------


def process_item(item_id: str, render_dir: Path, cells_dir: Path, palette, palette_doc: dict) -> dict:
    item = rp.ITEMS[item_id]
    meta = json.loads((render_dir / item_id / "meta.json").read_text())
    root = render_dir / item_id
    has_face = item_id in stp.FACE_COLOURS
    bolt_stamps = load_bolt_stamps() if item_id.startswith("zeus") else None
    w, h = item.cell
    cells: dict = {}
    maps: dict = {}
    parts_by: dict = {}
    depths_by: dict = {}
    boxes: list = []
    facts: list[dict] = []
    t0 = time.perf_counter()
    for entry in meta["frames"]:
        parts = depths = None
        unknown = 0
        if "id" in entry["files"]:
            parts, depths, unknown = block_maps(decode_png(root / entry["files"]["id"]), decode_png(root / entry["files"]["depth"]), item)
        for variant in VARIANT_IDS:
            if variant not in entry["files"]:
                continue
            built = build_cell(item, decode_png(root / entry["files"][variant]), parts, depths, palette)
            interior = built["interior"]
            record: dict = {}
            if has_face and parts is not None:
                interior, record = apply_stamps(item, interior, entry, parts, depths, bolt_stamps, palette_doc)
            figure = finalise(item, interior, palette)
            cell = with_shadow(item, figure, palette_doc)
            key = (variant, entry["clip"], entry["facing"], entry["index"])
            cells[key] = cell
            maps[key] = sm.index_map(figure, palette.colours)  # the shadow is constant, so it is left out of the boil maps
            parts_by[key] = parts
            depths_by[key] = depths
            box = opaque_box(figure)
            boxes.append(box)
            path = cells_dir / item_id / variant / f"{entry['name']}.png"
            encode_png(cell, path)
            m, final = measure_scopes(figure, cell, palette, interior)
            alphas = {cell.rgba[a + 3] for a in range(0, len(cell.rgba), 4)}
            anchor = entry["anchor_px"]
            facts.append(
                {
                    "variant": variant, "clip": entry["clip"], "facing": entry["facing"], "index": entry["index"], "source_frame": entry["source_frame"],
                    "height": m["height"], "width": m["width"], "bottom_row": m["bottom_row"], "colours": final["colours"], "outside_palette": final["outside_palette"],
                    "colours_figure": m["colours"], "outside_palette_figure": m["outside_palette"],
                    "outline": m["outline"] if item.outline else None,
                    "binary_alpha": alphas <= {0, 255},
                    "anchor_px": anchor, "anchor_ok": abs(anchor[0] - item.origin_px[0]) < 1e-3 and abs(anchor[1] - item.origin_px[1]) < 1e-3,
                    "extent_px": entry["extent_px"], "overlap_px": len(built["drawn"]), "unknown_id_px": unknown, "stamps": record, "box": list(box),
                    "file": str(path.relative_to(REPO)),
                }
            )
    return {"item": item, "meta": meta, "cells": cells, "maps": maps, "parts": parts_by, "depths": depths_by, "boxes": boxes, "facts": facts, "seconds": round(time.perf_counter() - t0, 1)}


def envelope_report(done: dict) -> dict | None:
    """Standing body height, maximum action extent and canvas margin as separate numbers (round 2)."""
    item = done["item"]
    if not done["boxes"] or item.kind != "character":
        return None
    env = sh.envelope(done["boxes"], item.pivot_px, item.cell)
    standing = [f["height"] for f in done["facts"] if f["clip"] == "idle"]
    env["standing_height_px"] = [min(standing), max(standing)] if standing else None
    env["max_action_extent_px"] = {"up": env["up"], "down": env["down"], "left": env["left"], "right": env["right"]}
    env["pivot"] = list(item.pivot_px)
    env["cell"] = list(item.cell)
    try:
        env["suggested_pivot_with_margin_6"] = list(sh.pivot_for(env, item.cell, 6))
    except ValueError as e:
        env["suggested_pivot_with_margin_6"] = str(e)
    return env


def clip_series(done: dict, variant: str, clip: str, facing: str, count: int) -> list:
    return [done["maps"][(variant, clip, facing, i)] for i in range(count)]


def measurements(done: dict) -> dict:
    """Boil (information only) and loop seams per animated clip and facing.

    `boil` labels every change inside a part whose mask moved as motion, so it cannot see shading instability on a moving part;
    `surface` counts index changes only where the same part is still the visible surface at the same depth in both frames.
    """
    item = done["item"]
    w, h = item.cell
    out: dict = {}
    for clip in item.clips:
        for facing in clip.facings:
            for variant in VARIANT_IDS:
                keys = [(variant, clip.id, facing, i) for i in range(clip.frames)]
                if not all(k in done["maps"] for k in keys) or clip.frames < 2:
                    continue
                maps = [done["maps"][k] for k in keys]
                has_parts = done["parts"][keys[0]] is not None
                parts = [done["parts"][k] for k in keys] if has_parts else None
                entry = {"boil": rm.boil_series(maps, parts, w, h, clip.loop)}
                if has_parts:
                    entry["surface"] = rm.surface_series(maps, parts, [done["depths"][k] for k in keys], w, h, clip.loop)
                if clip.loop:
                    entry["seam"] = rm.loop_seam(maps)
                out[f"{variant}/{clip.id}/{facing}"] = entry
    return out


def seam_check(done: dict, render_dir: Path) -> dict | None:
    """Wind loop: frame N (the duplicate endpoint, rendered from the unreduced phase) must equal frame 0, in the finished cell
    and in the raw 4x render, for both shading variants."""
    item = done["item"]
    clip = next((c for c in item.clips if c.id == "wind"), None)
    if clip is None:
        return None
    out: dict = {"frames": clip.frames, "compared": f"frame {clip.frames} against frame 0"}
    for variant in VARIANT_IDS:
        a, b = done["cells"].get((variant, "wind", "south", 0)), done["cells"].get((variant, "wind", "south", clip.frames))
        raw_a = decode_png(render_dir / item.id / variant / f"wind_south_00.{variant}.png").rgba
        raw_b = decode_png(render_dir / item.id / variant / f"wind_south_{clip.frames:02d}.{variant}.png").rgba
        out[variant] = {"cell_identical": a is not None and b is not None and a.rgba == b.rgba, "raw_4x_identical": raw_a == raw_b}
    out["all_identical"] = all(out[v]["cell_identical"] and out[v]["raw_4x_identical"] for v in VARIANT_IDS)
    return out


MEASURED_ON = {
    "figure_without_shadow": ["height", "width", "bottom_row", "outline", "box", "envelope", "colours_figure", "outside_palette_figure"],
    "final_cell_with_shadow": ["colours", "outside_palette"],
}


def summarise(done: dict) -> list[dict]:
    rows = []
    groups: dict = {}
    for f in done["facts"]:
        groups.setdefault((f["variant"], f["clip"]), []).append(f)
    for (variant, clip), items in sorted(groups.items()):
        heights = [f["height"] for f in items]
        rows.append(
            {
                "item": done["item"].id, "variant": variant, "clip": clip, "cells": len(items),
                "height": f"{min(heights)}-{max(heights)}" if min(heights) != max(heights) else str(heights[0]),
                "bottom_row": f"{min(f['bottom_row'] for f in items)}-{max(f['bottom_row'] for f in items)}",
                "colours_max": max(f["colours"] for f in items),  # final cell, shadow included
                "colours_max_figure": max(f["colours_figure"] for f in items),  # shadow-free figure
                "outside_palette": sum(f["outside_palette"] for f in items),  # final cell, shadow included
                "outline_all": None if items[0]["outline"] is None else all(f["outline"] for f in items),
                "binary_alpha_all": all(f["binary_alpha"] for f in items),
                "anchor_ok_all": all(f["anchor_ok"] for f in items),
                "overlap_px_mean": round(sum(f["overlap_px"] for f in items) / len(items), 1),
            }
        )
    return rows


def main() -> int:
    global VARIANT_IDS
    ap = argparse.ArgumentParser()
    ap.add_argument("--scratch", default=str(paths.DEFAULT_SCRATCH))
    ap.add_argument("--items", default=",".join(paths.DEFAULT_ITEMS))
    ap.add_argument("--tag", default=paths.DEFAULT_TAG, help="selects scratch/render-<tag>, scratch/cells-<tag> and the report prefix retro-<tag>")
    ap.add_argument("--variants", default="toon")
    args = ap.parse_args()
    VARIANT_IDS = tuple(args.variants.split(","))
    scratch = Path(args.scratch)
    render_dir, cells_dir, report = paths.render_dir(scratch, args.tag), paths.cells_dir(scratch, args.tag), paths.report_dir(scratch)
    try:
        item_ids = paths.split_items(args.items)
    except ValueError as e:
        print(f"postprocess: {e}", file=sys.stderr)
        return 2
    missing = paths.missing_renders(render_dir, item_ids)
    if missing:
        expected = ", ".join(str(paths.meta_path(render_dir, i)) for i in missing)
        print(f"postprocess: no render input for {', '.join(missing)} (tag {args.tag!r}); expected {expected}. Render with render_retro.py --tag {args.tag} first.", file=sys.stderr)
        return 1
    palette_doc = json.loads(PALETTE_PATH.read_text())
    palette = load_palette(PALETTE_PATH, pal.FAMILY_ID)
    report.mkdir(parents=True, exist_ok=True)
    for item_id in item_ids:
        done = process_item(item_id, render_dir, cells_dir, palette, palette_doc)
        if not done["facts"]:
            print(f"postprocess: {item_id} has a render but no frames for variants {','.join(VARIANT_IDS)}", file=sys.stderr)
            return 1
        result = {
            "item": item_id, "cell": list(done["item"].cell), "seconds": done["seconds"], "measured_on": MEASURED_ON,
            "render": {"blender": done["meta"]["blender"], "timings_ms": done["meta"]["timings_ms"], "dims": done["meta"].get("dims"), "character": done["meta"].get("character"), "tree": done["meta"].get("tree"), "animal": done["meta"].get("animal")},
            "envelope": envelope_report(done),
            "summary": summarise(done), "boil_and_seams": measurements(done), "wind_seam": seam_check(done, render_dir), "cells": done["facts"],
        }
        (report / f"{paths.report_prefix(args.tag)}-{item_id}-results.json").write_text(json.dumps(result, indent=1) + "\n")
        print(json.dumps({"item": item_id, "cells": len(done["facts"]), "seconds": done["seconds"], "envelope": result["envelope"], "summary": result["summary"]}, indent=None)[:1800])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

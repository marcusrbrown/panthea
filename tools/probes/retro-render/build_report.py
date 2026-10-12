"""Builds the report outputs from the finished cells: per-item contact sheets (1x and 4x, canon Zeus beside), per-item timed GIFs,
the 8-frame against 16-frame walk comparison, Zeus key-pose sheets, and the scene mockup (stills at 1x and 3x, animated GIFs at
1x and 3x) once for each Zeus height variant.

    python3 tools/probes/retro-render/build_report.py [--tag r2] [--variants toon] [--skip-gifs]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
sys.path.insert(0, str(REPO / "tools/probes/art-edit"))
sys.path.insert(0, str(REPO / "tools/probes/blender-sprite"))
sys.path.insert(0, str(ROOT))

import postprocess as p1  # noqa: E402  (blender-sprite: canon atlas path)
import retro_plan as rp  # noqa: E402
import retro_sheets as rs  # noqa: E402
import scene_plan as sc  # noqa: E402
from pipeline import Raster, decode_png, encode_png  # noqa: E402

TOTAL_MS = sc.TOTAL_MS
SHEET_CLIPS = ("idle", "walk", "cast", "wind", "static", "path", "grass")  # walk16 has its own sheet: 17 columns would make a huge 4x image
KEY_POSES = (("idle", 0, "I0"), ("idle", 3, "I3"), ("cast", 0, "C0"), ("cast", 1, "C1"), ("cast", 2, "C2"), ("cast", 3, "C3"), ("cast", 4, "C4"), ("cast", 5, "C5"))
SCENE_ZEUS = {"std": "zeus", "tall": "zeus-tall"}


def canon_frames() -> list[Raster]:
    atlas = decode_png(p1.ZEUS_ATLAS)
    out = []
    for k in range(4):
        rows = b"".join(atlas.rgba[(y * atlas.width + 64 * k) * 4 : (y * atlas.width + 64 * k + 64) * 4] for y in range(80))
        out.append(Raster(64, 80, rows))
    return out


def load_cells(cells_dir: Path, item_id: str, variant: str) -> dict[tuple[str, str, int], Raster]:
    out: dict = {}
    base = cells_dir / item_id / variant
    if not base.exists():
        return out
    for path in sorted(base.glob("*.png")):
        clip, facing, idx = path.stem.rsplit("_", 2)
        out[(clip, facing, int(idx))] = decode_png(path)
    return out


def rows_for(item: rp.Item, cells: dict, clip_ids: tuple[str, ...]) -> list[rs.Row]:
    rows = []
    for clip in item.clips:
        if clip.id not in clip_ids:
            continue
        for facing in clip.facings:
            tiles = [rs.Tile(f"{facing[0].upper()}{i}", cells[(clip.id, facing, i)]) for i in range(clip.frames) if (clip.id, facing, i) in cells]
            if tiles:
                rows.append(rs.Row(f"{clip.id[0].upper()}{facing[0].upper()}", tuple(tiles)))
    return rows


def write_sheet(rows: list[rs.Row], canon: Raster, stem: Path) -> list[str]:
    sheet = rs.contact_sheet(rows, canon)
    paths = []
    for factor in (1, 4):
        p = Path(f"{stem}-{factor}x.png")
        encode_png(sheet if factor == 1 else rs.enlarge(sheet, factor), p)
        paths.append(str(p.relative_to(REPO)))
    return paths


def write_item_sheets(item: rp.Item, cells: dict, canon: Raster, out: Path, prefix: str) -> dict:
    written = {}
    main = [c for c in SHEET_CLIPS if any(cl.id == c for cl in item.clips)]
    if item.id == "tile":
        rows = [rs.Row("T", tuple(rs.Tile(c[:1].upper(), cells[(c, "south", 0)]) for c in ("path", "grass") if (c, "south", 0) in cells))]
    elif item.id in ("temple", "house"):
        rows = [rs.Row("B", (rs.Tile("S0", cells[("static", "south", 0)]),))]
    else:
        rows = rows_for(item, cells, tuple(main))
    written["contact"] = write_sheet(rows, canon, out / f"{prefix}-{item.id}-contact")
    if any(c.id == "walk16" for c in item.clips):
        written["walk16"] = write_sheet(rows_for(item, cells, ("walk16",)), canon, out / f"{prefix}-{item.id}-walk16-contact")
    return written


def write_keypose_sheet(item: rp.Item, cells: dict, canon: Raster, out: Path, prefix: str) -> list[str]:
    rows = []
    for facing in rp.DIRECTIONS:
        tiles = [rs.Tile(label, cells[(clip, facing, i)]) for clip, i, label in KEY_POSES if (clip, facing, i) in cells]
        rows.append(rs.Row(facing[0].upper(), tuple(tiles)))
    return write_sheet(rows, canon, out / f"{prefix}-{item.id}-keypose")


def write_item_gifs(item: rp.Item, cells: dict, canon: list[Raster], out: Path, prefix: str) -> dict:
    written = {}
    for clip in item.clips:
        if clip.frames < 2:
            continue
        facings = [f for f in clip.facings if all((clip.id, f, i) in cells for i in range(clip.frames))]
        if not facings:
            continue
        panels = [list(canon)] + [[cells[(clip.id, f, i)] for i in range(clip.frames)] for f in facings]
        schedules = [rp.CANON_IDLE_MS] + [clip.timing_ms] * len(facings)
        path = out / f"{prefix}-{item.id}-{clip.id}-3x.gif"
        info = rs.write_panel_gif(path, panels, schedules, 3, total_cs=TOTAL_MS // 10)
        info["panels"] = ["canon zeus idle"] + facings
        written[clip.id] = info
    return written


def write_walk_compare(item: rp.Item, cells: dict, out: Path, prefix: str) -> dict | None:
    """8-frame against 16-frame walk over the same 800 ms: south and east, 8 then 16, side by side."""
    c8 = next((c for c in item.clips if c.id == "walk"), None)
    c16 = next((c for c in item.clips if c.id == "walk16"), None)
    if c8 is None or c16 is None:
        return None
    panels, schedules, names = [], [], []
    for facing in c8.facings:
        if facing not in ("south", "east"):
            continue
        for clip in (c8, c16):
            panels.append([cells[(clip.id, facing, i)] for i in range(clip.frames)])
            schedules.append(clip.timing_ms)
            names.append(f"{facing} {clip.frames}")
    path = out / f"{prefix}-walk-compare-{item.id}-3x.gif"
    info = rs.write_panel_gif(path, panels, schedules, 3, total_cs=TOTAL_MS // 10)
    info["panels"] = names
    return info


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scratch", default=str(ROOT / "scratch"))
    ap.add_argument("--tag", default="r2")
    ap.add_argument("--variants", default="toon")
    ap.add_argument("--skip-gifs", action="store_true")
    args = ap.parse_args()
    scratch = Path(args.scratch)
    suffix = f"-{args.tag}" if args.tag else ""
    prefix = f"retro{suffix}"
    cells_dir, out = scratch / f"cells{suffix}", scratch / "report"
    out.mkdir(parents=True, exist_ok=True)
    variant = args.variants.split(",")[0]
    started = time.perf_counter()
    canon = canon_frames()
    result: dict = {"sheets": {}, "keypose": {}, "item_gifs": {}, "walk_compare": {}, "scene": {}}
    loaded: dict = {}
    for item in rp.ITEMS.values():
        cells = load_cells(cells_dir, item.id, variant)
        if not cells:
            continue
        loaded[(item.id, variant)] = cells
        result["sheets"][item.id] = write_item_sheets(item, cells, canon[0], out, prefix)
        if item.id.startswith("zeus"):
            result["keypose"][item.id] = write_keypose_sheet(item, cells, canon[0], out, prefix)
        if not args.skip_gifs and item.kind in ("character", "prop") and item.id != "canon":
            result["item_gifs"][item.id] = write_item_gifs(item, cells, canon, out, prefix)
            compare = write_walk_compare(item, cells, out, prefix)
            if compare:
                result["walk_compare"][item.id] = compare
    for label, zeus_item in SCENE_ZEUS.items():
        if (zeus_item, variant) not in loaded:
            continue
        scene = sc.build_scene(variant, loaded, canon, zeus_item)
        stills = {}
        for factor in (1, 3):
            p = out / f"{prefix}-scene-{label}-still-{factor}x.png"
            encode_png(scene["still"] if factor == 1 else rs.enlarge(scene["still"], factor), p)
            stills[f"{factor}x"] = str(p.relative_to(REPO))
        gifs = {}
        if not args.skip_gifs:
            for factor in (1, 3):
                p = out / f"{prefix}-scene-{label}-anim-{factor}x.gif"
                size = rs.write_png_gif_ffmpeg(scene["frames"], scene["delays_cs"], p, factor, scratch / "gif-tmp" / f"{args.tag}-{label}-{factor}x")
                gifs[f"{factor}x"] = {"path": str(p.relative_to(REPO)), "bytes": size, "sum_delay_cs": sum(scene["delays_cs"])}
        result["scene"][label] = {"still": stills, "gif": gifs, "size_1x": [scene["still"].width, scene["still"].height], "steps": len(scene["frames"]), "total_ms": TOTAL_MS, "layout": scene["layout"]}
    result["seconds"] = round(time.perf_counter() - started, 1)
    (out / f"{prefix}-report.json").write_text(json.dumps(result, indent=1) + "\n")
    print(json.dumps({"seconds": result["seconds"], "scene": {k: {"still": v["still"], "gif": v["gif"], "size_1x": v["size_1x"], "steps": v["steps"]} for k, v in result["scene"].items()}}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

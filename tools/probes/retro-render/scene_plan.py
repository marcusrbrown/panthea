"""Layout of the scene mockup: ground tiles, a path, the temple behind, a tree, Zeus, a mortal, a bull, a medieval house for
comparison and canon Zeus idle beside ours. Positions are tile coordinates (x down-right, y down-left) on the client's 64x32 grid.

Canon Zeus stands with the pivot its manifest declares, (32, 80), not the (32, 74) a 64x80 god cell would suggest.
"""

from __future__ import annotations

import sys
from collections.abc import Sequence
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import retro_plan as rp  # noqa: E402
import retro_sheets as rs  # noqa: E402
from pipeline import Raster  # noqa: E402

TOTAL_MS = 4000  # idle 1000, walk 800, tree 2000, bull 2000 and canon idle 1000 all divide it: the whole scene loops seamlessly
GRID_W, GRID_H = 6, 7
PATH_TILES = ((2, 2), (2, 3), (2, 4), (2, 5), (2, 6), (3, 6), (4, 6))
MORTAL_CLIP = "walk16"  # the 16-frame walk over the same 800 ms


def ground_entities() -> list[rs.Entity]:
    out = []
    for x in range(GRID_W):
        for y in range(GRID_H):
            kind = "path" if (x, y) in PATH_TILES else "grass"
            out.append(rs.Entity(f"tile_{x}_{y}", "tile", kind, "south", x, y, layer=0))
    return out


def object_entities(zeus_item: str = "zeus") -> list[rs.Entity]:
    return [
        rs.Entity("temple", "temple", "static", "south", 1, 0, (3, 2), layer=1),
        rs.Entity("house", "house", "static", "south", 0, 4, (2, 2), layer=1),
        rs.Entity("tree", "tree", "wind", "south", 5, 3, layer=1, animated=True),
        rs.Entity("zeus", zeus_item, "idle", "south", 3, 4, layer=2, animated=True),
        rs.Entity("canon", "canon", "idle", "south", 4, 3, layer=2, animated=True),
        rs.Entity("mortal", "mortal", MORTAL_CLIP, "south", 2, 5, layer=2, animated=True),
        rs.Entity("bull", "bull", "idle", "east", 4, 5, layer=2, animated=True),
    ]


def schedules(zeus_item: str = "zeus") -> tuple[tuple[str, tuple[int, ...]], ...]:
    return (
        ("zeus", rp.ITEMS[zeus_item].clips[0].timing_ms),
        ("mortal", next(c for c in rp.MORTAL.clips if c.id == MORTAL_CLIP).timing_ms),
        ("tree", rp.TREE.clips[0].timing_ms),
        ("bull", rp.BULL.clips[0].timing_ms),
        ("canon", rp.CANON_IDLE_MS),
    )


def scene_items() -> dict:
    items = dict(rp.ITEMS)
    items["canon"] = rp.CANON
    return items


def sprites_at(picks: dict[str, int], loaded: dict, variant: str, canon: Sequence[Raster], entities: Sequence[rs.Entity]) -> dict[str, Raster]:
    out: dict[str, Raster] = {}
    for e in entities:
        if e.item == "canon":
            out[e.key] = canon[picks["canon"]]
            continue
        cells = loaded[(e.item, variant)]
        index = picks.get(e.key, 0)
        out[e.key] = cells[(e.clip, e.facing, index)]
    return out


def build_scene(variant: str, loaded: dict, canon: Sequence[Raster], zeus_item: str = "zeus") -> dict:
    entities = ground_entities() + object_entities(zeus_item)
    items = scene_items()
    bounds = rs.canvas_bounds(entities, items)
    names = [n for n, _ in schedules(zeus_item)]
    steps = rs.timeline_ms([s for _, s in schedules(zeus_item)], TOTAL_MS)
    frames, delays = [], []
    cache: dict[tuple[int, ...], Raster] = {}
    for duration, picks in steps:
        if picks not in cache:
            cache[picks] = rs.compose(entities, sprites_at(dict(zip(names, picks, strict=True)), loaded, variant, canon, entities), items, bounds)
        frames.append(cache[picks])
        delays.append(duration)
    return {
        "still": frames[0],
        "frames": frames,
        "delays_cs": delays,
        "layout": {
            "bounds": list(bounds), "grid": [GRID_W, GRID_H], "path_tiles": [list(t) for t in PATH_TILES], "zeus_item": zeus_item, "mortal_clip": MORTAL_CLIP,
            "entities": {e.key: {"item": e.item, "tile": [e.x, e.y], "footprint": list(e.footprint)} for e in entities if e.layer > 0},
        },
    }

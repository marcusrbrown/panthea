"""Generic contact sheets, panel GIFs and the scene compositor for the retro-render probe. Standard library only (PNG IO and the
GIF encoder come from the existing probes).

A sheet row is a clip and facing; its tiles are the frames. Canon Zeus idle frame 0 sits at the left of the first column for
scale and style. The scene compositor draws ground tiles, then sprites in depth order (`x + y - z`, ties by layer), the way
`packages/renderer/src/iso.ts` orders them.
"""

from __future__ import annotations

import subprocess
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
sys.path.insert(0, str(REPO / "tools/probes/art-edit"))
sys.path.insert(0, str(REPO / "tools/probes/blender-sprite"))
sys.path.insert(0, str(ROOT))

import playback  # noqa: E402  (blender-sprite)
import retro_plan as rp  # noqa: E402
import tile_geom as tg  # noqa: E402
from pipeline import Raster, nearest_resize  # noqa: E402
from sheet import _GLYPHS, BACKDROP, LABEL_INK  # noqa: E402  (blender-sprite)

GUTTER = 2
LEFT_W = 12
STRIP_H = 7
SCENE_BACKDROP = (56, 45, 41)  # soil's darkest shade: a dark frame around the ground


@dataclass(frozen=True)
class Tile:
    label: str
    image: Raster | None


@dataclass(frozen=True)
class Row:
    label: str
    tiles: tuple[Tile, ...]


def blit(canvas: bytearray, cw: int, ch: int, sprite: Raster, x0: int, y0: int) -> None:
    """Draw a sprite's opaque pixels onto an RGBA canvas (binary alpha), clipping at the edges."""
    rgba = sprite.rgba
    for y in range(sprite.height):
        cy = y0 + y
        if not 0 <= cy < ch:
            continue
        for x in range(sprite.width):
            at = (y * sprite.width + x) * 4
            if rgba[at + 3]:
                cx = x0 + x
                if 0 <= cx < cw:
                    to = (cy * cw + cx) * 4
                    canvas[to : to + 4] = rgba[at : at + 4]


def draw_text(canvas: bytearray, width: int, x: int, y: int, text: str) -> None:
    for index, char in enumerate(text):
        for row, bits in enumerate(_GLYPHS.get(char, _GLYPHS[" "])):
            for col, bit in enumerate(bits):
                if bit == "1":
                    at = ((y + row) * width + x + index * 4 + col) * 4
                    canvas[at : at + 4] = bytes((*LABEL_INK, 255))


def slot_size(rows: Sequence[Row], canon: Raster | None) -> tuple[int, int]:
    sizes = [(t.image.width, t.image.height) for r in rows for t in r.tiles if t.image is not None]
    if canon is not None:
        sizes.append((canon.width, canon.height))
    return (max(s[0] for s in sizes), max(s[1] for s in sizes))


def contact_sheet(rows: Sequence[Row], canon: Raster | None) -> Raster:
    sw, sh = slot_size(rows, canon)
    columns = max(len(r.tiles) for r in rows) + (1 if canon is not None else 0)
    width = LEFT_W + columns * (sw + GUTTER)
    row_h = sh + STRIP_H + GUTTER
    height = len(rows) * row_h
    canvas = bytearray(bytes((*BACKDROP, 255)) * (width * height))
    for r, row in enumerate(rows):
        top = r * row_h
        draw_text(canvas, width, 2, top + sh // 2 - 2, row.label)
        left = LEFT_W
        if canon is not None:
            if r == 0:
                blit(canvas, width, height, canon, left + (sw - canon.width) // 2, top + sh - canon.height)
                draw_text(canvas, width, left + 1, top + sh + 1, "Z")
            left += sw + GUTTER
        for tile in row.tiles:
            if tile.image is not None:
                blit(canvas, width, height, tile.image, left + (sw - tile.image.width) // 2, top + sh - tile.image.height)
            draw_text(canvas, width, left + 1, top + sh + 1, tile.label)
            left += sw + GUTTER
    return Raster(width, height, bytes(canvas))


def enlarge(image: Raster, factor: int) -> Raster:
    return nearest_resize(image, image.width * factor, image.height * factor, integer_factor=True)


# --- panel GIFs (one item, canon Zeus idle first) -------------------------------------------------------------------------


def palette_of(frames: Sequence[Raster], extra: Sequence[tuple[int, int, int]] = ()) -> list[tuple[int, int, int]]:
    colours = set(extra)
    for r in frames:
        colours |= {tuple(r.rgba[a : a + 3]) for a in range(0, len(r.rgba), 4) if r.rgba[a + 3]}
    return sorted(colours)


def panel_indices(image: Raster, lookup: dict, factor: int, slot: tuple[int, int]) -> list[bytes]:
    """Rows of palette indices for one tile at `factor`x, bottom-aligned in a `slot`-sized box on the backdrop."""
    bg = lookup[BACKDROP]
    rows: list[bytes] = []
    pad_top = slot[1] - image.height
    left = (slot[0] - image.width) // 2
    for _ in range(pad_top * factor):
        rows.append(bytes([bg]) * (slot[0] * factor))
    for y in range(image.height):
        row = bytearray()
        row += bytes([bg]) * (left * factor)
        for x in range(image.width):
            px = image.pixel(x, y)
            row += bytes([lookup[px[:3] if px[3] else BACKDROP]]) * factor
        row += bytes([bg]) * ((slot[0] - image.width - left) * factor)
        rows += [bytes(row)] * factor
    return rows


def write_panel_gif(path: Path, panels: Sequence[Sequence[Raster]], schedules_ms: Sequence[Sequence[int]], factor: int, total_cs: int | None = None) -> dict:
    """Side-by-side looping panels, each cycling its frames at its own timing. Returns facts for the report."""
    slot = (max(r.width for p in panels for r in p), max(r.height for p in panels for r in p))
    total = (total_cs * 10) if total_cs else 4000
    steps = timeline_ms(list(schedules_ms), total)
    palette = palette_of([r for p in panels for r in p], [BACKDROP])
    lookup = {c: i for i, c in enumerate(palette)}
    gutter = GUTTER * factor
    cache: dict[tuple[int, ...], bytes] = {}
    tile_rows = [[panel_indices(r, lookup, factor, slot) for r in frames] for frames in panels]
    frames, delays = [], []
    height = slot[1] * factor
    sep = bytes([lookup[BACKDROP]]) * gutter
    for duration, picks in steps:
        if picks not in cache:
            rows = [sep.join(tile_rows[p][picks[p]][y] for p in range(len(picks))) for y in range(height)]
            cache[picks] = b"".join(rows)
        frames.append(cache[picks])
        delays.append(duration)
    width = len(frames[0]) // height
    size = playback.write_gif(path, width, height, palette, frames, delays)
    return {"path": str(path.relative_to(REPO)), "bytes": size, "steps": len(steps), "size": [width, height], "total_ms": total, "sum_delay_cs": sum(delays)}


# --- scene -------------------------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Entity:
    key: str
    item: str  # item id, or "canon"
    clip: str
    facing: str
    x: float
    y: float
    footprint: tuple[int, int] = (1, 1)
    layer: int = 0  # 0 ground, 1 structure, 2 actor
    animated: bool = False


def tile_centre(x: float, y: float) -> tuple[float, float]:
    ox, oy = tg.diamond_origin(0, 0)
    return (ox + (x - y) * (tg.TILE_W // 2) + tg.TILE_W / 2, oy + (x + y) * (tg.TILE_H // 2) + tg.DIAMOND_H / 2)


def sprite_position(entity: Entity, item: rp.Item) -> tuple[int, int]:
    """Top-left of a sprite for an entity at tile (x, y): the pivot lands on the footprint's bottom vertex for buildings and
    props and on the tile centre for characters (their anchor is the sole midpoint)."""
    if item.kind in ("character",):
        cx, cy = tile_centre(entity.x, entity.y)
        return (round(cx - item.pivot_px[0]), round(cy - item.pivot_px[1]))
    if item.kind == "prop":
        cx, cy = tile_centre(entity.x, entity.y)
        return (round(cx - item.pivot_px[0]), round(cy - item.pivot_px[1]))
    w, h = entity.footprint
    vx, vy = tg.bottom_vertex(int(entity.x), int(entity.y), 0, w, h)
    return (vx - round(item.pivot_px[0]), vy - round(item.pivot_px[1]))


def depth_key(entity: Entity) -> tuple[float, int]:
    w, h = entity.footprint
    return (entity.x + w - 1 + entity.y + h - 1, entity.layer)


def canvas_bounds(entities: Sequence[Entity], items: dict[str, rp.Item], margin: int = 6) -> tuple[int, int, int, int]:
    """(min_x, min_y, max_x, max_y) of every drawn sprite and tile box, in scene pixels."""
    xs, ys = [], []
    for e in entities:
        if e.layer == 0:
            ox, oy = tg.diamond_origin(int(e.x), int(e.y))
            xs += [ox, ox + tg.TILE_W]
            ys += [oy, oy + tg.TILE_H]
        else:
            item = items[e.item]
            px, py = sprite_position(e, item)
            xs += [px, px + item.cell[0]]
            ys += [py, py + item.cell[1]]
    return (min(xs) - margin, min(ys) - margin, max(xs) + margin, max(ys) + margin)


def compose(entities: Sequence[Entity], sprites: dict[str, Raster], items: dict[str, rp.Item], bounds: tuple[int, int, int, int]) -> Raster:
    """One scene frame at 1x. `sprites` maps entity key to the Raster to draw (already the right frame)."""
    x0, y0, x1, y1 = bounds
    w, h = x1 - x0, y1 - y0
    canvas = bytearray(bytes((*SCENE_BACKDROP, 255)) * (w * h))
    for e in sorted(entities, key=lambda e: (e.layer > 0, *depth_key(e))):
        img = sprites.get(e.key)
        if img is None:
            continue
        if e.layer == 0:
            ox, oy = tg.diamond_origin(int(e.x), int(e.y))
            blit(canvas, w, h, img, ox - x0, oy - y0)
        else:
            px, py = sprite_position(e, items[e.item])
            blit(canvas, w, h, img, px - x0, py - y0)
    return Raster(w, h, bytes(canvas))


def timeline_ms(schedules: Sequence[Sequence[int]], total_ms: int) -> list[tuple[int, tuple[int, ...]]]:
    """Merge independently looping schedules (per-frame hold times in ms) into steps of (duration in cs, frame per schedule).

    Boundaries are exact milliseconds and converted to centiseconds cumulatively, so rounding never accumulates across a loop.
    """
    marks = {0, total_ms}
    for sched in schedules:
        t, period = 0, sum(sched)
        while t < total_ms:
            for d in sched:
                t += d
                if t < total_ms:
                    marks.add(t)
            if period <= 0:
                break
    ordered = sorted(marks)
    steps = []
    for a, b in zip(ordered, ordered[1:], strict=False):
        cs = round(b / 10) - round(a / 10)
        if cs <= 0:
            continue
        steps.append((cs, tuple(rp.hold_index(tuple(s), a) for s in schedules)))
    return steps


def write_png_gif_ffmpeg(frames: Sequence[Raster], delays_cs: Sequence[int], path: Path, factor: int, tmp: Path) -> int:
    """Looping GIF through ffmpeg: nearest-neighbour upscale, exact global palette (no dither), per-frame delays."""
    from pipeline import encode_png

    tmp.mkdir(parents=True, exist_ok=True)
    lines = []
    for i, (frame, cs) in enumerate(zip(frames, delays_cs, strict=True)):
        p = tmp / f"f{i:04d}.png"
        encode_png(frame, p)
        lines.append(f"file '{p}'\nduration {cs / 100:.2f}")
    lines.append(f"file '{tmp / f'f{len(frames) - 1:04d}.png'}'")
    listing = tmp / "list.txt"
    listing.write_text("\n".join(lines) + "\n")
    path.parent.mkdir(parents=True, exist_ok=True)
    vf = f"scale=iw*{factor}:ih*{factor}:flags=neighbor,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-vf", vf, "-fps_mode", "passthrough", "-frames:v", str(len(frames)), "-loop", "0", str(path)], check=True)
    set_gif_delays(path, delays_cs)
    return path.stat().st_size


def set_gif_delays(path: Path, delays_cs: Sequence[int]) -> None:
    """Rewrite the per-frame delays of a GIF in place. ffmpeg's muxer gives the last frame its own duration guess, which
    loses a few centiseconds per loop; the delays are known exactly, so they are written back."""
    data = bytearray(path.read_bytes())
    i = 0
    found = 0
    while True:
        i = data.find(b"\x21\xf9\x04", i)
        if i < 0:
            break
        if found < len(delays_cs):
            data[i + 4 : i + 6] = int(delays_cs[found]).to_bytes(2, "little")
        found += 1
        i += 8
    if found != len(delays_cs):
        raise ValueError(f"GIF has {found} frames, expected {len(delays_cs)}")
    path.write_bytes(bytes(data))


def gif_delays(path: Path) -> list[int]:
    data = path.read_bytes()
    out, i = [], 0
    while True:
        i = data.find(b"\x21\xf9\x04", i)
        if i < 0:
            return out
        out.append(int.from_bytes(data[i + 4 : i + 6], "little"))
        i += 8

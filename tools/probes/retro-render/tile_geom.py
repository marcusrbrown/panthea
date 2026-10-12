"""Isometric tile geometry: a Python port of `packages/renderer/src/iso.ts` (64x32 tiles drawn as 64x31 diamonds) plus the
world-space size of a tile for the probe's fixed pixels-per-unit. Pure, standard library only."""

from __future__ import annotations

import math

TILE_W = 64
TILE_H = 32
DIAMOND_H = 31
ELEVATION_STEP = 16


def diamond_row(row: int) -> tuple[int, int] | None:
    """Pixel span (x0, x1 exclusive) of the diamond on `row` of a tile box, or None when the row carries no diamond."""
    if row < 0 or row >= DIAMOND_H:
        return None
    half = 2 * (1 + min(row, DIAMOND_H - 1 - row))
    return (TILE_W // 2 - half, TILE_W // 2 + half)


def diamond_mask() -> list[list[bool]]:
    """TILE_H rows by TILE_W columns; True inside the drawn diamond (row 31 belongs to the neighbours)."""
    rows = []
    for y in range(TILE_H):
        span = diamond_row(y)
        rows.append([span is not None and span[0] <= x < span[1] for x in range(TILE_W)])
    return rows


def diamond_origin(x: int, y: int, z: int = 0) -> tuple[int, int]:
    """Top-left of the cell's 64x32 box (cell (0,0,0) at (-32, 0))."""
    return ((x - y) * (TILE_W // 2) - TILE_W // 2, (x + y) * (TILE_H // 2) - z * ELEVATION_STEP)


def bottom_vertex(x: int, y: int, z: int = 0, w: int = 1, h: int = 1) -> tuple[int, int]:
    """Screen point of the footprint's bottom vertex (the manifest pivot of a sprite)."""
    bx, by = x + w - 1, y + h - 1
    return ((bx - by) * (TILE_W // 2), (bx + by) * (TILE_H // 2) + DIAMOND_H - z * ELEVATION_STEP)


def sprite_origin(x: int, y: int, pivot: tuple[int, int], z: int = 0, w: int = 1, h: int = 1) -> tuple[int, int]:
    vx, vy = bottom_vertex(x, y, z, w, h)
    return (vx - pivot[0], vy - pivot[1])


def depth_of(x: int, y: int, z: int = 0, w: int = 1, h: int = 1) -> int:
    """`x + y - z` of the footprint's bottom-vertex cell."""
    return (x + w - 1) + (y + h - 1) - z


def footprint_px(w: int, h: int) -> tuple[int, int]:
    """Pixel width and height of a w x h footprint's diamond, top vertex to bottom vertex."""
    return ((w + h) * (TILE_W // 2), (w + h - 2) * (TILE_H // 2) + DIAMOND_H)


def centre_to_bottom_vertex_px(w: int, h: int) -> float:
    """Distance from the footprint's centre to its bottom vertex, screen pixels (15.5 for one tile)."""
    return footprint_px(w, h)[1] / 2.0


def tile_world_side(ppu: float) -> float:
    """World side length (metres) of one ground tile for the 2:1 camera at `ppu` pixels per unit: the diamond is s*sqrt(2) wide."""
    return TILE_W / (math.sqrt(2.0) * ppu)


def iso_ground_to_px(gx: float, gy: float, ppu: float, axes_right: tuple[float, float], axes_up: tuple[float, float]) -> tuple[float, float]:
    """Pixel offset of a ground point (world x, y relative to the origin) for a camera whose right and up vectors are given."""
    return (ppu * (gx * axes_right[0] + gy * axes_right[1]), -ppu * (gx * axes_up[0] + gy * axes_up[1]))

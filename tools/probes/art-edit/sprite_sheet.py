"""Contact sheets for the sprite downscale probe: 64x80 tiles on a flat backdrop with a code strip under each."""

from __future__ import annotations

from pipeline import Raster, nearest_resize

BACKDROP = (120, 120, 120)
LABEL_INK = (240, 240, 240)
TILE_W, TILE_H = 64, 80
GUTTER = 2
STRIP_H = 7
LEFT_W = 8

_GLYPHS = {
    "A": ("010", "101", "111", "101", "101"),
    "K": ("101", "101", "110", "101", "101"),
    "M": ("101", "111", "111", "101", "101"),
    "C": ("011", "100", "100", "100", "011"),
    "D": ("110", "101", "101", "101", "110"),
    "S": ("011", "100", "010", "001", "110"),
    "0": ("111", "101", "101", "101", "111"),
    "1": ("010", "110", "010", "010", "111"),
    "2": ("111", "001", "111", "100", "111"),
    "3": ("111", "001", "111", "001", "111"),
    "4": ("101", "101", "111", "001", "001"),
    "5": ("111", "100", "111", "001", "111"),
    "6": ("111", "100", "111", "101", "111"),
    "7": ("111", "001", "001", "010", "010"),
    "8": ("111", "101", "111", "101", "111"),
    "9": ("111", "101", "111", "001", "111"),
}


def _draw_text(canvas: bytearray, width: int, x: int, y: int, text: str) -> None:
    for index, char in enumerate(text):
        rows = _GLYPHS[char]
        for row, bits in enumerate(rows):
            for col, bit in enumerate(bits):
                if bit == "1":
                    at = ((y + row) * width + x + index * 4 + col) * 4
                    canvas[at : at + 4] = bytes((*LABEL_INK, 255))


def contact_sheet(rows: list[list[tuple[str, Raster]]], row_labels: list[str]) -> Raster:
    """`rows[r][c]` is (code, 64x80 raster with alpha); the code is drawn in the strip under its tile."""
    columns = max(len(row) for row in rows)
    width = LEFT_W + columns * (TILE_W + GUTTER)
    height = len(rows) * (TILE_H + STRIP_H + GUTTER)
    canvas = bytearray(bytes((*BACKDROP, 255)) * (width * height))
    for r, row in enumerate(rows):
        top = r * (TILE_H + STRIP_H + GUTTER)
        _draw_text(canvas, width, 2, top + TILE_H // 2 - 2, row_labels[r])
        for c, (code, tile) in enumerate(row):
            left = LEFT_W + c * (TILE_W + GUTTER)
            for y in range(TILE_H):
                for x in range(TILE_W):
                    pixel = tile.pixel(x, y)
                    if pixel[3]:
                        at = ((top + y) * width + left + x) * 4
                        canvas[at : at + 4] = bytes((*pixel[:3], 255))
            _draw_text(canvas, width, left + 1, top + TILE_H + 1, code)
    return Raster(width, height, bytes(canvas))


def enlarge(sheet: Raster, factor: int) -> Raster:
    return nearest_resize(sheet, sheet.width * factor, sheet.height * factor, integer_factor=True)

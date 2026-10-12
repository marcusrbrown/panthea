"""Contact sheet for the Blender sprite probe: rows are clips, columns are directions x frames, canon Zeus at the left.

Standard library only. Layout is pure (no IO) so it can be tested; labels use a tiny 3x5 pixel font.
"""

from __future__ import annotations

import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "art-edit"))

from pipeline import Raster, nearest_resize  # noqa: E402

BACKDROP = (120, 120, 120)
LABEL_INK = (240, 240, 240)
GROUP_RULE = (84, 84, 84)
TILE_W, TILE_H = 64, 80
GUTTER = 2
GROUP_GAP = 6
STRIP_H = 7
LEFT_W = 10

_GLYPHS = {
    "S": ("011", "100", "010", "001", "110"),
    "E": ("111", "100", "110", "100", "111"),
    "N": ("110", "101", "101", "101", "101"),
    "W": ("101", "101", "111", "111", "101"),
    "Z": ("111", "001", "010", "100", "111"),
    "I": ("111", "010", "010", "010", "111"),
    "T": ("111", "010", "010", "010", "010"),
    "C": ("011", "100", "100", "100", "011"),
    "D": ("110", "101", "101", "101", "110"),
    "X": ("101", "101", "010", "101", "101"),
    "A": ("010", "101", "111", "101", "101"),
    "B": ("110", "101", "110", "101", "110"),
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
    " ": ("000", "000", "000", "000", "000"),
}


@dataclass(frozen=True)
class Tile:
    label: str
    image: Raster | None  # None leaves the slot empty
    group: int = 0  # tiles of one group sit together; a wider gap separates groups


def sheet_size(rows: Sequence[Sequence[Tile]]) -> tuple[int, int]:
    widths = [_row_width(row) for row in rows]
    return max(widths), len(rows) * (TILE_H + STRIP_H + GUTTER)


def _row_width(row: Sequence[Tile]) -> int:
    width = LEFT_W
    previous = None
    for tile in row:
        if previous is not None and tile.group != previous:
            width += GROUP_GAP
        width += TILE_W + GUTTER
        previous = tile.group
    return width


def _draw_text(canvas: bytearray, width: int, x: int, y: int, text: str) -> None:
    for index, char in enumerate(text):
        for row, bits in enumerate(_GLYPHS[char]):
            for col, bit in enumerate(bits):
                if bit == "1":
                    at = ((y + row) * width + x + index * 4 + col) * 4
                    canvas[at : at + 4] = bytes((*LABEL_INK, 255))


def contact_sheet(rows: Sequence[Sequence[Tile]], row_labels: Sequence[str]) -> Raster:
    width, height = sheet_size(rows)
    canvas = bytearray(bytes((*BACKDROP, 255)) * (width * height))
    for r, row in enumerate(rows):
        top = r * (TILE_H + STRIP_H + GUTTER)
        _draw_text(canvas, width, 2, top + TILE_H // 2 - 2, row_labels[r])
        left = LEFT_W
        previous = None
        for tile in row:
            if previous is not None and tile.group != previous:
                for y in range(TILE_H + STRIP_H):
                    at = ((top + y) * width + left + GROUP_GAP // 2 - 1) * 4
                    canvas[at : at + 4] = bytes((*GROUP_RULE, 255))
                left += GROUP_GAP
            previous = tile.group
            if tile.image is not None:
                for y in range(TILE_H):
                    for x in range(TILE_W):
                        pixel = tile.image.pixel(x, y)
                        if pixel[3]:
                            at = ((top + y) * width + left + x) * 4
                            canvas[at : at + 4] = bytes((*pixel[:3], 255))
            _draw_text(canvas, width, left + 1, top + TILE_H + 1, tile.label)
            left += TILE_W + GUTTER
    return Raster(width, height, bytes(canvas))


def enlarge(sheet: Raster, factor: int) -> Raster:
    return nearest_resize(sheet, sheet.width * factor, sheet.height * factor, integer_factor=True)


def tile_label(direction: str, index: int) -> str:
    """`S0`, `E3`, ... the facing initial and the frame index within the clip."""
    return f"{direction[0].upper()}{index}"

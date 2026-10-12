"""Measurement scopes of a finished cell: colours and palette on the final cell (shadow included), height and outline on the
shadow-free figure."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import palette_plan as pal
import postprocess_retro as pp
import retro_plan as rp
from pipeline import Raster
from sprite_downscale import add_outline, load_palette

PALETTE = load_palette(pp.PALETTE_PATH, pal.FAMILY_ID)
DOC = pp.json.loads(pp.PALETTE_PATH.read_text())


def figure_on_empty_cell(item: rp.Item) -> Raster:
    """A small block of one palette colour standing on the item's origin, outlined like a real figure."""
    w, h = item.cell
    ox, oy = int(item.origin_px[0]), int(item.origin_px[1])
    body = pal.ramp_shades(DOC, "marble")[3]
    out = bytearray(w * h * 4)
    for y in range(oy - 12, oy - 2):
        for x in range(ox - 3, ox + 3):
            out[(y * w + x) * 4 : (y * w + x) * 4 + 4] = bytes((*body, 255))
    return add_outline(Raster(w, h, bytes(out)), PALETTE)


class MeasureScopeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.item = rp.MORTAL
        self.figure = figure_on_empty_cell(self.item)
        self.cell = pp.with_shadow(self.item, self.figure, DOC)
        self.on_figure, self.on_cell = pp.measure_scopes(self.figure, self.cell, PALETTE, self.figure)

    def test_the_shadow_adds_its_colour_to_the_final_cell_count(self) -> None:
        self.assertEqual(self.on_figure["colours"], 2)  # body and outline
        self.assertEqual(self.on_cell["colours"], 3)  # plus the olive shadow

    def test_shadow_pixels_are_checked_against_the_palette(self) -> None:
        self.assertEqual(self.on_cell["outside_palette"], 0)
        stray = bytearray(self.cell.rgba)
        i = (self.item.cell[0] * (int(self.item.origin_px[1]) + 1) + int(self.item.origin_px[0])) * 4  # a pixel inside the shadow
        self.assertEqual(stray[i + 3], 255)
        stray[i : i + 3] = bytes((1, 2, 3))
        _, final = pp.measure_scopes(self.figure, Raster(self.cell.width, self.cell.height, bytes(stray)), PALETTE, self.figure)
        self.assertEqual(final["outside_palette"], 1)

    def test_height_and_outline_ignore_the_shadow(self) -> None:
        self.assertLess(self.on_figure["bottom_row"], self.on_cell["bottom_row"])  # the shadow reaches below the figure's last row
        self.assertLess(self.on_figure["height"], self.on_cell["height"])
        self.assertTrue(self.on_figure["outline"])

    def test_an_item_without_a_shadow_measures_the_same_on_both(self) -> None:
        item = rp.TEMPLE
        figure = figure_on_empty_cell(item)
        cell = pp.with_shadow(item, figure, DOC)
        on_figure, on_cell = pp.measure_scopes(figure, cell, PALETTE, figure)
        self.assertEqual(on_figure["colours"], on_cell["colours"])


if __name__ == "__main__":
    unittest.main()

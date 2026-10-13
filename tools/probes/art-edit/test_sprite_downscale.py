from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pipeline import Raster
from sprite_downscale import (
    area_average_rect,
    add_outline,
    coverage_alpha,
    downscale_figure,
    feet_midpoint_edge,
    key_foreground,
    kcentroid_rect,
    load_palette,
    measure,
    mode_rect,
    oklab,
    place_feet,
    snap_to_palette,
)

PALETTE_JSON = Path(__file__).resolve().parents[3] / "content/greek/palette/palette.json"
PALETTE = load_palette(PALETTE_JSON)

MARBLE_LIGHT = (0xF0, 0xEE, 0xE0)
MARBLE_DARK = (0x52, 0x64, 0x71)
GOLD_MID = (0xB3, 0x8B, 0x43)
GOLD_DARK = (0x76, 0x57, 0x2F)
LAPIS_DARK = (0x24, 0x3F, 0x63)
LAPIS_MID = (0x3C, 0x62, 0x90)


def grid(width: int, height: int, pixels: dict[tuple[int, int], tuple[int, ...]]) -> Raster:
    data = bytearray(width * height * 4)
    for (x, y), value in pixels.items():
        at = (y * width + x) * 4
        rgba = value if len(value) == 4 else (*value, 255)
        data[at : at + 4] = bytes(rgba)
    return Raster(width, height, bytes(data))


def opaque_points(image: Raster) -> set[tuple[int, int]]:
    return {(x, y) for y in range(image.height) for x in range(image.width) if image.pixel(x, y)[3]}


class PaletteTests(unittest.TestCase):
    def test_palette_is_the_sixteen_olympus_colours_with_their_ramps(self):
        self.assertEqual(len(PALETTE.colours), 16)
        self.assertEqual(PALETTE.ramp_of[LAPIS_DARK], "lapis")
        self.assertEqual(PALETTE.darkest["marble"], MARBLE_DARK)
        self.assertEqual(PALETTE.darkest["pale-gold"], GOLD_DARK)

    def test_oklab_places_black_and_white_on_the_lightness_axis(self):
        l0, a0, b0 = oklab((0, 0, 0))
        l1, a1, b1 = oklab((255, 255, 255))
        self.assertAlmostEqual(l0, 0.0, places=3)
        self.assertAlmostEqual(l1, 1.0, places=3)
        self.assertAlmostEqual(a1, 0.0, places=2)
        self.assertAlmostEqual(b1, 0.0, places=2)

    def test_snap_returns_palette_entries_and_maps_each_entry_to_itself(self):
        for colour in PALETTE.colours:
            self.assertEqual(snap_to_palette(colour, PALETTE), colour)
        for value in ((0, 0, 0), (255, 255, 255), (200, 120, 40), (10, 200, 90)):
            self.assertIn(snap_to_palette(value, PALETTE), PALETTE.colours)

    def test_snap_picks_the_perceptually_nearest_entry(self):
        near_dark_gold = (0x80, 0x5E, 0x34)
        self.assertEqual(snap_to_palette(near_dark_gold, PALETTE), GOLD_DARK)
        near_light_marble = (0xF5, 0xF2, 0xE8)
        self.assertEqual(snap_to_palette(near_light_marble, PALETTE), MARBLE_LIGHT)
        brightness_only = (0x30, 0x4A, 0x70)
        self.assertEqual(snap_to_palette(brightness_only, PALETTE), LAPIS_DARK)


    def test_snap_is_perceptual_not_rgb_euclidean(self):
        red_orange = (225, 44, 3)
        rgb_nearest = min(
            PALETTE.colours, key=lambda p: sum((red_orange[a] - p[a]) ** 2 for a in range(3))
        )
        self.assertEqual(rgb_nearest, GOLD_DARK)
        self.assertEqual(snap_to_palette(red_orange, PALETTE), GOLD_MID)


class CoverageTests(unittest.TestCase):
    def test_alpha_is_binary_with_half_coverage_opaque(self):
        self.assertEqual(coverage_alpha(0.0), 0)
        self.assertEqual(coverage_alpha(0.49), 0)
        self.assertEqual(coverage_alpha(0.5), 255)
        self.assertEqual(coverage_alpha(1.0), 255)

    def test_a_block_below_half_coverage_is_transparent_and_at_half_is_opaque(self):
        one_of_four = grid(2, 2, {(0, 0): (200, 30, 30)})
        self.assertEqual(area_average_rect(one_of_four, 0, 2, 0, 2)[1], 0.25)
        two_of_four = grid(2, 2, {(0, 0): (200, 30, 30), (1, 0): (200, 30, 30)})
        self.assertEqual(area_average_rect(two_of_four, 0, 2, 0, 2)[1], 0.5)
        figure = grid(2, 2, {(0, 0): (200, 30, 30)})
        out = downscale_figure(figure, "area", height=1, palette=PALETTE, bbox=(0, 0, 2, 2))
        self.assertEqual(opaque_points(out), set())
        figure = grid(2, 2, {(0, 0): (200, 30, 30), (1, 0): (200, 30, 30)})
        out = downscale_figure(figure, "area", height=1, palette=PALETTE, bbox=(0, 0, 2, 2))
        self.assertEqual(len(opaque_points(out)), 1)


class AnyRatioSamplerTests(unittest.TestCase):
    def test_a_known_row_at_two_thirds_averages_by_exact_overlap(self):
        row = grid(3, 1, {(0, 0): (0, 0, 0), (1, 0): (90, 90, 90), (2, 0): (180, 180, 180)})
        first, coverage_first = area_average_rect(row, 0.0, 1.5, 0, 1)
        second, coverage_second = area_average_rect(row, 1.5, 3.0, 0, 1)
        self.assertEqual(coverage_first, 1.0)
        self.assertEqual(coverage_second, 1.0)
        self.assertEqual(first, (30.0, 30.0, 30.0))
        self.assertEqual(second, (150.0, 150.0, 150.0))

    def test_non_integer_ratio_gives_the_requested_height_and_covers_the_source(self):
        pixels = {(x, y): (240, 238, 224) for x in range(6) for y in range(10)}
        figure = grid(6, 10, pixels)
        out = downscale_figure(figure, "area", height=6, palette=PALETTE, bbox=(0, 0, 6, 10))
        points = opaque_points(out)
        ys = [y for _, y in points]
        xs = [x for x, _ in points]
        self.assertEqual(max(ys) - min(ys) + 1, 6)
        self.assertEqual(max(xs) - min(xs) + 1, 4)
        self.assertEqual({out.pixel(x, y)[:3] for x, y in points}, {MARBLE_LIGHT})

    def test_mode_and_k_centroid_keep_a_dominant_colour_where_area_average_blends(self):
        a, b = (0xF0, 0xEE, 0xE0), (0x3C, 0x62, 0x90)
        pixels = {(x, y): (a if x < 3 else b) for x in range(5) for y in range(5)}
        block = grid(5, 5, pixels)
        blended, _ = area_average_rect(block, 0, 5, 0, 5)
        self.assertNotIn(tuple(round(v) for v in blended), (a, b))
        self.assertEqual(mode_rect(block, 0, 5, 0, 5, PALETTE)[0], MARBLE_LIGHT)
        self.assertEqual(kcentroid_rect(block, 0, 5, 0, 5, PALETTE, k=2)[0], MARBLE_LIGHT)

    def test_k_centroid_ignores_transparent_pixels_in_the_block(self):
        pixels = {(0, 0): GOLD_MID, (1, 0): GOLD_MID, (0, 1): GOLD_MID}
        block = grid(2, 2, pixels)
        colour, coverage = kcentroid_rect(block, 0, 2, 0, 2, PALETTE, k=3)
        self.assertEqual(coverage, 0.75)
        self.assertEqual(colour, GOLD_MID)


class OutlineTests(unittest.TestCase):
    def test_outline_is_exterior_only_four_connected_and_in_the_ramps_darkest_shade(self):
        canvas = grid(8, 8, {
            (3, 3): MARBLE_LIGHT, (4, 3): MARBLE_LIGHT,
            (3, 4): GOLD_MID, (4, 4): GOLD_MID,
        })
        out = add_outline(canvas, PALETTE)
        before = opaque_points(canvas)
        after = opaque_points(out)
        ring = {
            (3, 2), (4, 2), (2, 3), (5, 3), (2, 4), (5, 4), (3, 5), (4, 5),
        }
        self.assertEqual(after - before, ring)
        for point in before:
            self.assertEqual(out.pixel(*point), canvas.pixel(*point))
        self.assertEqual(out.pixel(3, 2)[:3], MARBLE_DARK)
        self.assertEqual(out.pixel(2, 3)[:3], MARBLE_DARK)
        self.assertEqual(out.pixel(3, 5)[:3], GOLD_DARK)
        self.assertEqual(out.pixel(5, 4)[:3], GOLD_DARK)
        self.assertNotIn((2, 2), after)

    def test_enclosed_holes_get_no_outline_and_no_interior_pixel_changes(self):
        ring = {(x, y): MARBLE_LIGHT for x in range(2, 7) for y in range(2, 7)}
        del ring[(4, 4)]
        canvas = grid(9, 9, ring)
        out = add_outline(canvas, PALETTE)
        self.assertEqual(out.pixel(4, 4)[3], 0)
        self.assertEqual(len(opaque_points(out) - opaque_points(canvas)), 20)

    def test_a_pixel_between_two_ramps_takes_the_darker_neighbours_ramp(self):
        canvas = grid(5, 3, {(1, 1): MARBLE_LIGHT, (3, 1): LAPIS_MID})
        out = add_outline(canvas, PALETTE)
        self.assertEqual(out.pixel(2, 1)[:3], LAPIS_DARK)
        self.assertEqual(out.pixel(0, 1)[:3], MARBLE_DARK)
        self.assertEqual(out.pixel(4, 1)[:3], LAPIS_DARK)


class FootPlacementTests(unittest.TestCase):
    def two_feet(self, left: tuple[int, int], right: tuple[int, int], y: int = 20):
        pixels: dict[tuple[int, int], tuple[int, ...]] = {}
        for x in range(left[0], left[1] + 1):
            pixels[(x, y)] = MARBLE_LIGHT
            pixels[(x, y - 1)] = MARBLE_LIGHT
        for x in range(right[0], right[1] + 1):
            pixels[(x, y)] = MARBLE_LIGHT
            pixels[(x, y - 1)] = MARBLE_LIGHT
        for x in range(left[0], right[1] + 1):
            for yy in range(y - 12, y - 1):
                pixels[(x, yy)] = GOLD_MID
        return grid(48, 40, pixels)

    def test_soles_land_on_row_78_so_the_outline_sits_on_row_79_and_the_midpoint_on_32(self):
        figure = self.two_feet((10, 11), (20, 21))
        self.assertEqual(feet_midpoint_edge(figure), 16.0)
        placed = place_feet(figure, cell=(64, 80))
        self.assertEqual((placed.width, placed.height), (64, 80))
        points = opaque_points(placed)
        self.assertEqual(max(y for _, y in points), 78)
        self.assertEqual(feet_midpoint_edge(placed), 32.0)

    def test_an_odd_parity_figure_is_within_half_a_pixel_of_the_pivot(self):
        figure = self.two_feet((10, 12), (20, 22))
        placed = place_feet(figure, cell=(64, 80))
        self.assertLessEqual(abs(feet_midpoint_edge(placed) - 32.0), 0.5)

    def test_outlined_figure_ends_on_row_79_and_fits_the_cell(self):
        placed = place_feet(self.two_feet((10, 11), (20, 21)), cell=(64, 80))
        outlined = add_outline(placed, PALETTE)
        points = opaque_points(outlined)
        self.assertEqual(max(y for _, y in points), 79)
        self.assertGreaterEqual(min(x for x, _ in points), 0)

    def test_the_measured_midpoint_uses_the_same_rows_as_placement_when_the_row_above_the_soles_is_wider(self):
        pixels = {(x, y): GOLD_MID for x in range(10, 26) for y in range(5, 18)}
        for x in (10, 11, 12, 20, 21):
            pixels[(x, 18)] = MARBLE_LIGHT
            pixels[(x, 19)] = MARBLE_LIGHT
        placed = place_feet(grid(48, 40, pixels), cell=(64, 80))
        measured = measure(add_outline(placed, PALETTE), PALETTE, interior=placed)
        self.assertEqual(measured["foot_midpoint"], feet_midpoint_edge(placed))
        self.assertEqual(measured["bottom_row"], 79)

    def test_a_figure_too_tall_for_the_cell_with_outline_is_refused(self):
        tall = grid(4, 80, {(x, y): MARBLE_LIGHT for x in range(4) for y in range(80)})
        with self.assertRaises(ValueError):
            place_feet(tall, cell=(64, 80))


class KeyingAndMeasurementTests(unittest.TestCase):
    def test_key_is_border_connected_and_reports_the_key_colour(self):
        bg = (230, 223, 191)
        pixels = {(x, y): bg for x in range(9) for y in range(9)}
        for x in range(2, 7):
            for y in range(2, 7):
                pixels[(x, y)] = GOLD_MID
        pixels[(4, 4)] = bg
        keyed, key = key_foreground(grid(9, 9, pixels), tolerance=10)
        self.assertEqual(key, bg)
        self.assertEqual(keyed.pixel(0, 0)[3], 0)
        self.assertEqual(keyed.pixel(4, 4)[3], 255)
        self.assertEqual(keyed.pixel(2, 2)[3], 255)

    def test_measure_reports_height_colours_outline_and_midpoint(self):
        placed = place_feet(FootPlacementTests().two_feet((10, 11), (20, 21)), cell=(64, 80))
        outlined = add_outline(placed, PALETTE)
        facts = measure(outlined, PALETTE, interior=placed)
        self.assertEqual(facts["height"], 15)
        self.assertEqual(facts["bottom_row"], 79)
        self.assertTrue(facts["outline"])
        self.assertEqual(facts["colours"], 4)
        self.assertEqual(facts["foot_midpoint"], 32.0)
        self.assertFalse(measure(placed, PALETTE)["outline"])

    def test_end_to_end_height_is_the_requested_total_with_outline(self):
        figure = grid(40, 100, {(x, y): MARBLE_LIGHT for x in range(10, 30) for y in range(100)})
        for method in ("area", "kcentroid", "mode"):
            out = downscale_figure(figure, method, height=50, palette=PALETTE, bbox=(10, 0, 30, 100))
            cell = add_outline(place_feet(out, cell=(64, 80)), PALETTE)
            facts = measure(cell, PALETTE)
            self.assertEqual(facts["height"], 52, method)
            self.assertEqual(facts["bottom_row"], 79, method)
            self.assertTrue(set(map(tuple, facts["palette_entries"])) <= set(PALETTE.colours), method)


if __name__ == "__main__":
    unittest.main()

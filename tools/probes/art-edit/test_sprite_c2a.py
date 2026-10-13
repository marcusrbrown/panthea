from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pipeline import Raster
from sprite_downscale import (
    clear_colour_in_rows,
    clear_light_grey_in_rows,
    foreground_bbox,
    keep_largest_component,
    place_by_soles,
    sole_clusters,
    sole_midpoint,
)

BODY = (240, 238, 224)
SHADOW = (190, 194, 195)
FOOT = (221, 150, 100)


def grid(width: int, height: int, pixels: dict[tuple[int, int], tuple[int, ...]]) -> Raster:
    data = bytearray(width * height * 4)
    for (x, y), value in pixels.items():
        at = (y * width + x) * 4
        data[at : at + 4] = bytes((*value[:3], value[3] if len(value) == 4 else 255))
    return Raster(width, height, bytes(data))


def rect(x0: int, y0: int, x1: int, y1: int, colour=BODY) -> dict[tuple[int, int], tuple[int, ...]]:
    return {(x, y): colour for x in range(x0, x1) for y in range(y0, y1)}


def opaque(image: Raster) -> set[tuple[int, int]]:
    return {(x, y) for y in range(image.height) for x in range(image.width) if image.pixel(x, y)[3]}


def two_foot_figure(left=(10, 16), right=(30, 38), bottom=40) -> Raster:
    pixels = rect(8, 5, 40, 30)
    pixels.update(rect(left[0], 30, left[1], bottom, FOOT))
    pixels.update(rect(right[0], 30, right[1], bottom - 1, FOOT))
    return grid(48, 48, pixels)


class KeepLargestComponentTests(unittest.TestCase):
    def test_small_components_are_dropped_with_their_sizes_and_boxes_and_the_largest_survives(self) -> None:
        pixels = rect(10, 10, 30, 40)
        pixels.update(rect(2, 44, 5, 46))
        pixels.update({(40, 3): BODY})
        source = grid(48, 48, pixels)
        kept, removed = keep_largest_component(source, min_size=10)
        self.assertEqual(opaque(kept), opaque(rect_raster(10, 10, 30, 40)))
        self.assertEqual(
            sorted((r["pixels"], tuple(r["box"])) for r in removed),
            [(1, (40, 3, 41, 4)), (6, (2, 44, 5, 46))],
        )

    def test_eight_connectivity_keeps_a_diagonal_neighbour_with_the_figure(self) -> None:
        pixels = rect(10, 10, 20, 20)
        pixels[(20, 20)] = BODY
        kept, removed = keep_largest_component(grid(32, 32, pixels), min_size=50)
        self.assertEqual(removed, [])
        self.assertIn((20, 20), opaque(kept))

    def test_a_second_component_at_or_over_the_threshold_is_kept(self) -> None:
        pixels = rect(2, 2, 22, 22)
        pixels.update(rect(26, 26, 30, 30))
        kept, removed = keep_largest_component(grid(32, 32, pixels), min_size=16)
        self.assertEqual(removed, [])
        self.assertEqual(len(opaque(kept)), 400 + 16)

    def test_the_largest_is_never_removed_even_below_the_threshold(self) -> None:
        kept, removed = keep_largest_component(grid(8, 8, rect(1, 1, 3, 3)), min_size=100)
        self.assertEqual(removed, [])
        self.assertEqual(len(opaque(kept)), 4)

    def test_an_empty_raster_is_returned_unchanged(self) -> None:
        empty = grid(4, 4, {})
        self.assertEqual(keep_largest_component(empty, 5), (empty, []))


def rect_raster(x0: int, y0: int, x1: int, y1: int) -> Raster:
    return grid(48, 48, rect(x0, y0, x1, y1))


class ClearColourTests(unittest.TestCase):
    def test_only_pixels_near_the_key_on_or_below_the_row_are_cleared(self) -> None:
        pixels = rect(0, 0, 10, 10, SHADOW)
        pixels.update({(3, 8): FOOT})
        source = grid(10, 10, pixels)
        cleared, count = clear_colour_in_rows(source, SHADOW, tolerance=8, from_row=6)
        self.assertEqual(count, 39)
        self.assertEqual(sum(1 for y in range(6) for x in range(10) if cleared.pixel(x, y)[3]), 60)
        self.assertEqual(cleared.pixel(3, 8)[3], 255)
        self.assertEqual(cleared.pixel(4, 8)[3], 0)


class ClearLightGreyTests(unittest.TestCase):
    def test_the_light_low_chroma_fringe_goes_while_feet_outline_and_rows_above_stay(self) -> None:
        pixels = {(x, 8): (225, 225, 215) for x in range(10)}
        pixels.update({(x, 2): (225, 225, 215) for x in range(10)})
        pixels.update({(1, 9): FOOT, (2, 9): (2, 5, 6), (3, 9): (90, 98, 96), (4, 9): (170, 170, 170)})
        source = grid(10, 10, pixels)
        cleared, count = clear_light_grey_in_rows(source, max_spread=14, min_luma=140, from_row=6)
        self.assertEqual(count, 11)
        self.assertEqual(sum(1 for x in range(10) if cleared.pixel(x, 2)[3]), 10)
        self.assertEqual(sum(1 for x in range(10) if cleared.pixel(x, 8)[3]), 0)
        self.assertEqual([cleared.pixel(x, 9)[3] for x in (1, 2, 3, 4)], [255, 255, 255, 0])


class SoleTests(unittest.TestCase):
    def test_two_foot_clusters_report_their_ranges_lowest_rows_and_midpoint(self) -> None:
        figure = two_foot_figure(left=(10, 16), right=(30, 38), bottom=40)
        clusters = sole_clusters(figure, band_rows=3, min_gap=4)
        self.assertEqual(
            [(c["x0"], c["x1"], c["bottom_row"]) for c in clusters],
            [(10, 16, 39), (30, 38, 38)],
        )
        self.assertEqual(sole_midpoint(figure, band_rows=3, min_gap=4), (13 + 34) / 2)

    def test_one_cluster_is_refused_for_a_midpoint(self) -> None:
        with self.assertRaises(ValueError):
            sole_midpoint(grid(16, 16, rect(4, 4, 12, 12)), band_rows=3, min_gap=2)

    def test_placement_puts_the_midpoint_between_the_soles_at_x_32_with_the_soles_on_row_78(self) -> None:
        figure = two_foot_figure(left=(10, 16), right=(30, 38), bottom=40)
        placed = place_by_soles(figure, cell=(64, 80))
        self.assertEqual(max(y for _, y in opaque(placed)), 78)
        self.assertLessEqual(abs(sole_midpoint(placed, 2, 2) - 32.0), 0.5)

    def test_placement_differs_from_bounding_box_centring_when_the_feet_are_off_centre(self) -> None:
        pixels = rect(8, 5, 44, 30)
        pixels.update(rect(10, 30, 16, 40, FOOT))
        pixels.update(rect(34, 30, 42, 39, FOOT))
        pixels.update(rect(1, 30, 6, 33))
        figure = grid(48, 48, pixels)
        x0, _, x1, _ = foreground_bbox(figure)
        self.assertGreaterEqual(abs((x0 + x1) / 2 - sole_midpoint(figure, 2, 2)), 2)
        placed = place_by_soles(figure, cell=(64, 80))
        self.assertLessEqual(abs(sole_midpoint(placed, 2, 2) - 32.0), 0.5)
        px0, _, px1, _ = foreground_bbox(placed)
        self.assertGreaterEqual(abs((px0 + px1) / 2 - 32.0), 2)


if __name__ == "__main__":
    unittest.main()

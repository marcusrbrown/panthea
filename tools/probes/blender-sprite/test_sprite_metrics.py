from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import sprite_metrics as sm
import sheet
from pipeline import Raster

T = sm.TRANSPARENT


def grid(rows: list[str]) -> list[int]:
    return [T if c == "." else int(c) for row in rows for c in row]


class FlickerTests(unittest.TestCase):
    def test_identical_frames_have_no_flicker(self) -> None:
        a = grid(["....", ".11.", ".12.", "...."])
        result = sm.flicker_pair(a, a, 4, 4)
        self.assertEqual(result["changed_stable"], 0)
        self.assertEqual(result["changed_any"], 0)
        self.assertTrue(result["exact_static"])

    def test_index_change_with_fixed_silhouette_counts(self) -> None:
        a = grid(["......", ".1111.", ".1111.", ".1111.", ".1111.", "......"])
        b = grid(["......", ".1111.", ".1221.", ".1111.", ".1111.", "......"])
        result = sm.flicker_pair(a, b, 6, 6)
        self.assertEqual(result["changed_any"], 2)
        self.assertEqual(result["changed_stable"], 2)
        self.assertTrue(result["exact_static"])

    def test_moved_silhouette_edge_is_not_counted_as_flicker(self) -> None:
        a = grid([".....", ".111.", ".111.", ".111.", "....."])
        b = grid([".....", ".1122", ".1122", ".1122", "....."])  # the right edge grew and recoloured
        result = sm.flicker_pair(a, b, 5, 5)
        self.assertFalse(result["exact_static"])
        self.assertGreater(result["silhouette_xor"], 0)
        # Recoloured pixels next to the moved edge have unstable neighbourhoods and are excluded.
        self.assertLessEqual(result["changed_stable"], result["changed_any"])

    def test_silhouette_xor_symmetric(self) -> None:
        a = grid(["1.", ".."])
        b = grid(["..", ".1"])
        self.assertEqual(sm.silhouette_xor(a, b), 2)
        self.assertEqual(sm.silhouette_xor(a, b), sm.silhouette_xor(b, a))

    def test_size_mismatch_rejected(self) -> None:
        with self.assertRaises(ValueError):
            sm.flicker_pair([T] * 4, [T] * 4, 3, 3)

    def test_series_loop_wraps(self) -> None:
        frames = [grid(["11", "11"]), grid(["11", "12"]), grid(["11", "11"])]
        open_run = sm.flicker_series(frames, 2, 2, loop=False)
        looped = sm.flicker_series(frames, 2, 2, loop=True)
        self.assertEqual(open_run["pairs"], 2)
        self.assertEqual(looped["pairs"], 3)
        self.assertEqual(open_run["changed_stable"], 2)
        self.assertEqual(looped["changed_stable"], 2)

    def test_series_of_one_frame(self) -> None:
        self.assertEqual(sm.flicker_series([grid(["1"])], 1, 1, loop=True)["pairs"], 0)

    def test_two_frame_loop_is_one_pair(self) -> None:
        frames = [grid(["1"]), grid(["2"])]
        self.assertEqual(sm.flicker_series(frames, 1, 1, loop=True)["pairs"], 1)


class IndexMapTests(unittest.TestCase):
    def test_transparent_palette_and_off_palette(self) -> None:
        palette = [(10, 20, 30), (40, 50, 60)]
        rgba = bytes((10, 20, 30, 255, 0, 0, 0, 0, 40, 50, 60, 255, 9, 9, 9, 255))
        self.assertEqual(sm.index_map(Raster(4, 1, rgba), palette), [0, sm.TRANSPARENT, 1, sm.OFF_PALETTE])


class StatsTests(unittest.TestCase):
    def test_range_stats(self) -> None:
        stats = sm.range_stats([1.0, 3.0])
        self.assertEqual(stats["range"], 2.0)
        self.assertEqual(stats["std"], 1.0)
        self.assertEqual(sm.range_stats([5.0])["range"], 0.0)

    def test_range_stats_empty(self) -> None:
        with self.assertRaises(ValueError):
            sm.range_stats([])

    def test_jitter(self) -> None:
        result = sm.jitter([(0.0, 0.0), (0.3, 0.4)])
        self.assertAlmostEqual(result["max_pair_distance"], 0.5)
        self.assertEqual(result["x"]["range"], 0.3)
        self.assertEqual(sm.jitter([(1.0, 2.0)] * 3)["max_pair_distance"], 0.0)

    def test_components_and_isolated(self) -> None:
        g = grid(["1...", "....", "..11", "..1."])
        self.assertEqual(sm.component_sizes(g, 4, 4), [3, 1])
        self.assertEqual(sm.isolated_pixels(g, 4, 4), 1)

    def test_diagonal_pixels_join_components_but_stay_isolated_for_4_neighbours(self) -> None:
        g = grid(["1.", ".1"])
        self.assertEqual(sm.component_sizes(g, 2, 2), [2])
        self.assertEqual(sm.isolated_pixels(g, 2, 2), 2)


class MirrorTests(unittest.TestCase):
    def test_mirror_reverses_rows(self) -> None:
        self.assertEqual(sm.mirror_x(grid(["1.2", "..3"]), 3, 2), grid(["2.1", "3.."]))

    def test_mirror_twice_is_identity(self) -> None:
        g = grid(["1.2.", "..33"])
        self.assertEqual(sm.mirror_x(sm.mirror_x(g, 4, 2), 4, 2), g)

    def test_symmetric_frame_matches_its_mirror(self) -> None:
        g = grid([".11.", "1221"])
        result = sm.flicker_pair(sm.mirror_x(g, 4, 2), g, 4, 2)
        self.assertEqual(result["changed_any"], 0)
        self.assertEqual(result["silhouette_xor"], 0)


class SheetTests(unittest.TestCase):
    def test_layout_size_counts_groups(self) -> None:
        tile = Raster(64, 80, bytes(64 * 80 * 4))
        row = [sheet.Tile("S0", tile, 0), sheet.Tile("S1", tile, 0), sheet.Tile("E0", tile, 1)]
        width, height = sheet.sheet_size([row])
        self.assertEqual(width, sheet.LEFT_W + 3 * (64 + sheet.GUTTER) + sheet.GROUP_GAP)
        self.assertEqual(height, 80 + sheet.STRIP_H + sheet.GUTTER)

    def test_contact_sheet_draws_opaque_pixels_and_enlarges(self) -> None:
        rgba = bytearray(64 * 80 * 4)
        rgba[0:4] = bytes((200, 10, 10, 255))
        tile = Raster(64, 80, bytes(rgba))
        image = sheet.contact_sheet([[sheet.Tile("S0", tile, 0)]], ["I"])
        at = (0 * image.width + sheet.LEFT_W) * 4
        self.assertEqual(tuple(image.rgba[at : at + 4]), (200, 10, 10, 255))
        big = sheet.enlarge(image, 4)
        self.assertEqual((big.width, big.height), (image.width * 4, image.height * 4))

    def test_labels_use_known_glyphs(self) -> None:
        for direction in ("south", "east", "north", "west"):
            for char in sheet.tile_label(direction, 9):
                self.assertIn(char, sheet._GLYPHS)


if __name__ == "__main__":
    unittest.main()

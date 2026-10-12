from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import postprocess as pp
import report_md
import sprite_plan as sp
from pipeline import Raster
from sprite_downscale import load_palette

PALETTE = load_palette(pp.PALETTE_JSON)
LIGHT = PALETTE.colours[2]


def solid(width: int, height: int, box: tuple[int, int, int, int], colour: tuple[int, int, int], alpha: int = 255) -> Raster:
    x0, y0, x1, y1 = box
    out = bytearray(width * height * 4)
    for y in range(y0, y1):
        for x in range(x0, x1):
            out[(y * width + x) * 4 : (y * width + x) * 4 + 4] = bytes((*colour, alpha))
    return Raster(width, height, bytes(out))


class CellTests(unittest.TestCase):
    def test_direct_snaps_to_palette_and_binarises_alpha(self) -> None:
        near = tuple(min(255, c + 2) for c in LIGHT)
        src = solid(64, 80, (10, 10, 20, 20), near)
        faint = solid(64, 80, (30, 30, 34, 34), near, alpha=60)
        merged = bytearray(src.rgba)
        for i in range(0, len(merged), 4):
            if faint.rgba[i + 3]:
                merged[i : i + 4] = faint.rgba[i : i + 4]
        interior = pp.direct_interior(Raster(64, 80, bytes(merged)), PALETTE)
        self.assertEqual(interior.pixel(12, 12), (*LIGHT, 255))
        self.assertEqual(interior.pixel(31, 31)[3], 0)  # alpha 60 is below the 128 cut
        self.assertTrue(all(interior.rgba[i + 3] in (0, 255) for i in range(0, len(interior.rgba), 4)))

    def test_x4_mode_over_aligned_blocks(self) -> None:
        # A 4x4 block that is mostly one colour comes out as that colour; one with under half coverage is transparent.
        src = solid(256, 320, (40, 40, 56, 56), LIGHT)
        interior = pp.x4_interior(src, PALETTE)
        self.assertEqual((interior.width, interior.height), sp.CELL)
        self.assertEqual(interior.pixel(10, 10), (*LIGHT, 255))
        self.assertEqual(interior.pixel(9, 10)[3], 0)
        self.assertEqual(interior.pixel(14, 10)[3], 0)

    def test_x4_half_covered_block_follows_the_coverage_rule(self) -> None:
        src = solid(256, 320, (40, 40, 42, 44), LIGHT)  # 2 of 4 columns, 4 of 4 rows: exactly half
        interior = pp.x4_interior(src, PALETTE)
        self.assertEqual(interior.pixel(10, 10)[3], 255)

    def test_build_cell_adds_a_one_pixel_outline_in_the_darkest_shade(self) -> None:
        src = solid(64, 80, (20, 30, 40, 70), LIGHT)
        cell, interior = pp.build_cell("direct", src, PALETTE)
        self.assertEqual(interior.pixel(19, 40)[3], 0)
        self.assertEqual(cell.pixel(19, 40)[3], 255)
        self.assertIn(cell.pixel(19, 40)[:3], set(PALETTE.darkest.values()))
        self.assertEqual(cell.pixel(18, 40)[3], 0)

    def test_wrong_size_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            pp.build_cell("direct", solid(32, 40, (4, 4, 8, 8), LIGHT), PALETTE)

    def test_input_stats_counts_partial_alpha_and_off_palette(self) -> None:
        src = solid(64, 80, (0, 0, 4, 4), (1, 2, 3), alpha=100)
        stats = pp.input_stats(src, PALETTE)
        self.assertEqual(stats["partial_alpha"], 16)
        self.assertEqual(stats["raw_off_palette"], 1)
        self.assertEqual(stats["raw_colours"], 1)


class ReportTests(unittest.TestCase):
    def test_render_time_stats(self) -> None:
        frames = [{"render_ms": {"direct": 100.0, "x4": 10.0}}, {"render_ms": {"direct": 10.0, "x4": 20.0}}, {"render_ms": {"direct": 30.0, "x4": 30.0}}]
        stats = report_md.render_time_stats(frames)
        self.assertEqual(stats["direct"]["first_ms"], 100.0)
        self.assertEqual(stats["direct"]["median_ms"], 30.0)
        self.assertEqual(stats["direct"]["steady_state_mean_ms"], 20.0)
        self.assertEqual(stats["x4"]["total_ms"], 60.0)

    def test_pct_handles_zero(self) -> None:
        self.assertEqual(report_md.pct(1, 4), "25.0%")
        self.assertEqual(report_md.pct(0, 0), "n/a")

    def test_table_shape(self) -> None:
        text = report_md.table(["a", "b"], [[1, 2]])
        self.assertEqual(text.splitlines(), ["| a | b |", "| --- | --- |", "| 1 | 2 |"])

    def test_span(self) -> None:
        self.assertEqual(pp.span([3, 3]), "3")
        self.assertEqual(pp.span([3, 5.5]), "3–5.5")


if __name__ == "__main__":
    unittest.main()

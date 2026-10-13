from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import sprite_plan as sp


class CameraTests(unittest.TestCase):
    def setUp(self) -> None:
        self.axes = sp.camera_axes()

    def test_axes_are_orthonormal(self) -> None:
        a = self.axes
        for v in (a.right, a.up, a.back):
            self.assertAlmostEqual(math.sqrt(sum(c * c for c in v)), 1.0)
        self.assertAlmostEqual(sum(x * y for x, y in zip(a.right, a.up, strict=True)), 0.0)
        self.assertAlmostEqual(sum(x * y for x, y in zip(a.up, a.back, strict=True)), 0.0)

    def test_camera_looks_down_30_degrees_from_horizontal(self) -> None:
        view = self.axes.view_direction
        elevation = math.degrees(math.asin(-view[2]))
        self.assertAlmostEqual(elevation, 30.0)

    def test_ground_diamond_is_two_to_one(self) -> None:
        self.assertAlmostEqual(sp.ground_diamond_ratio(self.axes), 0.5)

    def test_screen_right_is_horizontal(self) -> None:
        self.assertAlmostEqual(self.axes.right[2], 0.0)

    def test_pivot_projects_to_anchor_and_camera_offset_matches(self) -> None:
        ppu = 29.0
        anchor = (32.0, 73.5)
        pivot = (0.0, 0.0, 0.0)
        self.assertEqual(sp.project(pivot, pivot, self.axes, ppu, anchor), anchor)
        # A camera placed by camera_location sees the pivot at the anchor: invert the placement by hand.
        loc = sp.camera_location(pivot, self.axes, ppu, anchor)
        rel = tuple(p - c for p, c in zip(pivot, loc, strict=True))
        right = sum(r * a for r, a in zip(rel, self.axes.right, strict=True))
        up = sum(r * a for r, a in zip(rel, self.axes.up, strict=True))
        self.assertAlmostEqual(sp.CELL[0] / 2 + right * ppu, anchor[0])
        self.assertAlmostEqual(sp.CELL[1] / 2 - up * ppu, anchor[1])

    def test_vertical_unit_projects_by_cos_elevation(self) -> None:
        ppu = 10.0
        x, y = sp.project((0.0, 0.0, 1.0), (0.0, 0.0, 0.0), self.axes, ppu, (32.0, 79.0))
        self.assertAlmostEqual(x, 32.0)
        self.assertAlmostEqual(79.0 - y, 10.0 * math.cos(math.radians(30)))


class ScaleTests(unittest.TestCase):
    def test_px_per_unit_gives_target_height(self) -> None:
        ppu = sp.px_per_unit(50, 1.75)
        self.assertAlmostEqual(1.75 * ppu, 50.0)

    def test_ortho_scale_spans_the_cell_height(self) -> None:
        ppu = sp.px_per_unit(50, 1.75)
        self.assertAlmostEqual(sp.ortho_scale(80, ppu) * ppu, 80.0)

    def test_rejects_non_positive(self) -> None:
        with self.assertRaises(ValueError):
            sp.px_per_unit(50, 0)
        with self.assertRaises(ValueError):
            sp.px_per_unit(0, 1)

    def test_figure_total_height_is_in_the_god_range(self) -> None:
        total = sp.INTERIOR_HEIGHT_PX + sp.OUTLINE_ROWS
        self.assertTrue(48 <= total <= 56)

    def test_anchor_for_bottom_moves_lowest_point_to_target(self) -> None:
        anchor_y = sp.anchor_for_bottom(79.0, 84.3)
        self.assertAlmostEqual(anchor_y + (84.3 - 79.0), 79.0)

    def test_screen_extent_uses_up_axis(self) -> None:
        axes = sp.camera_axes()
        extent = sp.screen_extent_units([(0.0, 0.0, 0.0), (0.0, 0.0, 2.0)], axes)
        self.assertAlmostEqual(extent, 2.0 * math.cos(math.radians(30)))

    def test_output_cell_sizes(self) -> None:
        self.assertEqual(sp.render_size("direct"), (64, 80))
        self.assertEqual(sp.render_size("x4"), (256, 320))


class LightAndFacingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.axes = sp.camera_axes()

    def test_key_light_is_upper_left_of_the_screen_and_above_ground(self) -> None:
        toward = sp.key_light_toward(self.axes)
        right = sum(t * a for t, a in zip(toward, self.axes.right, strict=True))
        up = sum(t * a for t, a in zip(toward, self.axes.up, strict=True))
        self.assertLess(right, 0)
        self.assertGreater(up, 0)
        self.assertGreater(toward[2], 0)
        self.assertAlmostEqual(math.sqrt(sum(c * c for c in toward)), 1.0)

    def test_facings_are_screen_relative(self) -> None:
        f = sp.facing_vectors(self.axes)
        right_xy = (self.axes.right[0], self.axes.right[1])
        back_xy = (self.axes.back[0], self.axes.back[1])
        norm = math.hypot(*back_xy)
        self.assertAlmostEqual(f["east"][0], right_xy[0])
        self.assertAlmostEqual(f["south"][0], back_xy[0] / norm)
        for a, b in (("south", "north"), ("east", "west")):
            self.assertAlmostEqual(f[a][0], -f[b][0])
            self.assertAlmostEqual(f[a][1], -f[b][1])

    def test_yaw_turns_forward_onto_target(self) -> None:
        for forward in ((0.0, -1.0), (0.3, 0.4), (-1.0, 0.0)):
            for target in sp.facing_vectors(self.axes).values():
                yaw = math.radians(sp.yaw_to_face(forward, target))
                fx, fy = forward
                rx = fx * math.cos(yaw) - fy * math.sin(yaw)
                ry = fx * math.sin(yaw) + fy * math.cos(yaw)
                norm = math.hypot(fx, fy)
                self.assertAlmostEqual(rx / norm, target[0])
                self.assertAlmostEqual(ry / norm, target[1])

    def test_model_facing_minus_y_needs_45_degrees_for_south(self) -> None:
        self.assertAlmostEqual(sp.yaw_to_face((0.0, -1.0), sp.facing_vectors(self.axes)["south"]), 45.0)

    def test_yaw_range(self) -> None:
        for angle in range(0, 360, 15):
            rad = math.radians(angle)
            yaw = sp.yaw_to_face((1.0, 0.0), (math.cos(rad), math.sin(rad)))
            self.assertGreater(yaw, -180.0 - 1e-9)
            self.assertLessEqual(yaw, 180.0)


class FrameSamplingTests(unittest.TestCase):
    def test_loop_excludes_the_end(self) -> None:
        self.assertEqual(sp.sample_frames(0, 60, 4, True), [0, 15, 30, 45])

    def test_one_shot_includes_both_ends(self) -> None:
        self.assertEqual(sp.sample_frames(0, 12, 5, False), [0, 3, 6, 9, 12])

    def test_fractional_frames_are_kept_and_rounded_stably(self) -> None:
        frames = sp.sample_frames(0, 32, 6, True)
        self.assertEqual(len(frames), 6)
        self.assertAlmostEqual(frames[1], 32 / 6, places=5)
        self.assertEqual(frames, sp.sample_frames(0, 32, 6, True))

    def test_nonzero_start(self) -> None:
        self.assertEqual(sp.sample_frames(10, 20, 2, True), [10, 15])

    def test_single_frame(self) -> None:
        self.assertEqual(sp.sample_frames(5, 9, 1, True), [5.0])

    def test_samples_are_inside_the_range_and_increasing(self) -> None:
        for loop in (True, False):
            frames = sp.sample_frames(0, 40, 6, loop)
            self.assertEqual(frames, sorted(frames))
            self.assertGreaterEqual(frames[0], 0)
            self.assertLessEqual(frames[-1], 40)
            if loop:
                self.assertLess(frames[-1], 40)

    def test_rejects_bad_input(self) -> None:
        with self.assertRaises(ValueError):
            sp.sample_frames(0, 10, 0, True)
        with self.assertRaises(ValueError):
            sp.sample_frames(10, 0, 3, True)

    def test_clip_specs_match_the_brief(self) -> None:
        by_id = {c.id: c for c in sp.CLIPS}
        self.assertEqual(by_id["idle"].frames, 4)
        self.assertEqual(by_id["walk"].frames, 6)
        self.assertTrue(4 <= by_id["cast"].frames <= 6)
        self.assertEqual(by_id["sit"].action, "Sitting_Idle_Loop")


class NamingAndColourTests(unittest.TestCase):
    def test_deterministic_names(self) -> None:
        self.assertEqual(sp.output_name("walk", "east", 3, "direct"), "walk_east_03.direct.png")
        self.assertEqual(sp.output_name("walk", "east", 3, "x4"), "walk_east_03.x4.png")

    def test_unknown_direction_or_variant(self) -> None:
        with self.assertRaises(ValueError):
            sp.output_name("walk", "up", 0, "direct")
        with self.assertRaises(ValueError):
            sp.output_name("walk", "east", 0, "x8")

    def test_hex_to_linear(self) -> None:
        self.assertEqual(sp.hex_to_linear("#000000"), (0.0, 0.0, 0.0))
        r, g, b = sp.hex_to_linear("#ffffff")
        self.assertAlmostEqual(r, 1.0)
        self.assertAlmostEqual(g, 1.0)
        self.assertAlmostEqual(b, 1.0)
        self.assertAlmostEqual(sp.hex_to_linear("#808080")[0], 0.2158605, places=5)


if __name__ == "__main__":
    unittest.main()

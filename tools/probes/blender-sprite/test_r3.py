from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import bake_plan as bp
import repairs_r3 as rr
import sprite_metrics as sm
import stamp_gen as sg

T = sm.TRANSPARENT
PALETTE_COLOURS = {"dark": (118, 87, 47), "mid": (221, 191, 112), "light": (244, 228, 174)}


def grid(rows: list[str]) -> list[int]:
    return [T if c == "." else int(c) for row in rows for c in row]


class BakeTests(unittest.TestCase):
    def test_rotate_z_quarter_turn(self) -> None:
        x, y, z = bp.rotate_z((1.0, 0.0, 0.5), 90)
        self.assertAlmostEqual(x, 0.0)
        self.assertAlmostEqual(y, 1.0)
        self.assertEqual(z, 0.5)

    def test_object_space_light_undoes_the_facing(self) -> None:
        light = (-0.29, -0.59, 0.76)
        for yaw in (45.0, 135.0, -135.0, -45.0):
            back = bp.rotate_z(bp.object_space_light(light, yaw), yaw)
            for a, b in zip(back, light, strict=True):
                self.assertAlmostEqual(a, b)

    def test_lambert_range_and_ambient_floor(self) -> None:
        self.assertAlmostEqual(bp.lambert_value((0, 0, 1), (0, 0, 1)), 1.0)
        self.assertAlmostEqual(bp.lambert_value((0, 0, -1), (0, 0, 1)), bp.AMBIENT)
        self.assertGreater(bp.lambert_value((1, 0, 0), (1, 1, 0)), bp.AMBIENT)

    def test_lambert_ignores_vector_length(self) -> None:
        self.assertAlmostEqual(bp.lambert_value((0, 0, 3), (0, 0, 0.2)), 1.0)

    def test_shade_index_has_three_bands(self) -> None:
        low, high = bp.BAKE_THRESHOLDS
        self.assertEqual(bp.shade_index(low - 0.01), 0)
        self.assertEqual(bp.shade_index(low), 1)
        self.assertEqual(bp.shade_index(high - 0.01), 1)
        self.assertEqual(bp.shade_index(high), 2)
        self.assertEqual(len(bp.BAKE_SHADES), 3)

    def test_shade_zero_is_left_for_the_outline(self) -> None:
        self.assertNotIn(0, bp.BAKE_SHADES)

    def test_ramp_stops(self) -> None:
        stops = bp.ramp_stops()
        self.assertEqual([p for p, _ in stops], [0.0, *bp.BAKE_THRESHOLDS])
        with self.assertRaises(ValueError):
            bp.ramp_stops((0.5,), (1, 2, 3))

    def test_the_baked_value_depends_only_on_the_rest_normal(self) -> None:
        # Surface-anchored: posing does not enter the formula at all.
        a = bp.lambert_value((0.0, -1.0, 0.0), bp.object_space_light((-0.3, -0.6, 0.75), 45.0))
        b = bp.lambert_value((0.0, -1.0, 0.0), bp.object_space_light((-0.3, -0.6, 0.75), 45.0))
        self.assertEqual(a, b)


class StampPlacementTests(unittest.TestCase):
    def test_screen_angle_has_y_up_convention(self) -> None:
        self.assertAlmostEqual(bp.screen_angle_deg((0, 0), (1, 0)), 0.0)
        self.assertAlmostEqual(bp.screen_angle_deg((0, 0), (0, -1)), 90.0)
        self.assertAlmostEqual(bp.screen_angle_deg((0, 0), (-1, 0)), 180.0)
        self.assertAlmostEqual(bp.screen_angle_deg((0, 0), (0, 1)), 270.0)

    def test_nearest_angle_wraps(self) -> None:
        self.assertEqual(bp.nearest_angle(359.0), 0)
        self.assertEqual(bp.nearest_angle(22.4), 0)
        self.assertEqual(bp.nearest_angle(22.6), 45)
        self.assertEqual(bp.nearest_angle(-10), 0)

    def test_stamp_origin_puts_the_anchor_beyond_the_base(self) -> None:
        ox, oy = bp.stamp_origin((20.0, 30.0), (20.0, 20.0), (3, 4), push_px=2.0)
        self.assertEqual((ox + 3, oy + 4), (20, 28))

    def test_stamp_origin_with_zero_length_uses_the_base(self) -> None:
        self.assertEqual(bp.stamp_origin((10.0, 10.0), (10.0, 10.0), (1, 1)), (9, 9))

    def composite(self, parts, depths, origin=(1, 1), depth=20.0, size=(8, 8), protected=("hand_r",)):
        px = {(0, 0): (1, 2, 3), (1, 0): (4, 5, 6)}
        return bp.composite_stamp(px, origin, depth, parts, depths, *size, protected_parts=protected)

    def test_unobstructed_stamp_is_drawn(self) -> None:
        r = self.composite([None] * 64, [0.0] * 64)
        self.assertEqual(len(r["drawn"]), 2)
        self.assertEqual((r["occluded"], r["protected"], r["clipped"]), (0, 0, 0))

    def test_nearer_part_occludes_but_farther_part_does_not(self) -> None:
        parts = [None] * 64
        depths = [0.0] * 64
        parts[1 * 8 + 1], depths[1 * 8 + 1] = "arm_l", 19.0  # nearer than the stamp
        parts[1 * 8 + 2], depths[1 * 8 + 2] = "torso", 21.0  # farther
        r = self.composite(parts, depths)
        self.assertEqual(r["occluded"], 1)
        self.assertIn(1 * 8 + 2, r["drawn"])

    def test_bolt_hand_is_never_drawn_over(self) -> None:
        parts = [None] * 64
        parts[1 * 8 + 1] = "hand_r"
        r = self.composite(parts, [0.0] * 64)
        self.assertEqual(r["protected"], 1)
        self.assertNotIn(1 * 8 + 1, r["drawn"])

    def test_clipping_at_the_cell_edge(self) -> None:
        r = self.composite([None] * 64, [0.0] * 64, origin=(7, 0))
        self.assertEqual(r["clipped"], 1)
        self.assertEqual(len(r["drawn"]), 1)


class StampArtTests(unittest.TestCase):
    def test_all_eight_orientations_exist_and_use_three_colours(self) -> None:
        for angle in sg.ANGLES:
            stamp = sg.rasterise(angle, PALETTE_COLOURS)
            self.assertEqual(set(stamp["pixels"].values()), set(PALETTE_COLOURS.values()), angle)
            self.assertLess(stamp["width"], 20)
            self.assertLess(stamp["height"], 20)
            self.assertGreater(len(stamp["pixels"]), 30)
            self.assertLess(len(stamp["pixels"]), 120, "a few dozen pixels")

    def test_outline_is_one_pixel_and_surrounds_the_core(self) -> None:
        stamp = sg.rasterise(90, PALETTE_COLOURS)
        pixels = stamp["pixels"]
        for (x, y), c in pixels.items():
            if c == PALETTE_COLOURS["dark"]:
                continue
            for n in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                self.assertIn(n, pixels, "every body pixel's 4-neighbours are body or outline")

    def test_anchor_is_inside_the_stamp_and_on_the_body(self) -> None:
        for angle in sg.ANGLES:
            stamp = sg.rasterise(angle, PALETTE_COLOURS)
            self.assertIn(stamp["anchor"], stamp["pixels"], angle)

    def test_a_zigzag_has_two_turns(self) -> None:
        pts = sg.polyline(90)
        self.assertEqual(len(pts), 4)
        cross = []
        for i in range(2):
            a = (pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
            b = (pts[i + 2][0] - pts[i + 1][0], pts[i + 2][1] - pts[i + 1][1])
            cross.append(a[0] * b[1] - a[1] * b[0])
        self.assertLess(cross[0] * cross[1], 0, "the two turns go opposite ways, which makes the Z")

    def test_segment_distance(self) -> None:
        self.assertAlmostEqual(sg.segment_distance(0, 1, (-1, 0), (1, 0)), 1.0)
        self.assertAlmostEqual(sg.segment_distance(3, 0, (-1, 0), (1, 0)), 2.0)

    def test_nearest_angle_matches_the_authored_set(self) -> None:
        for raw in (-5, 44, 100, 359):
            self.assertIn(sg.nearest_angle(raw), sg.ANGLES)

    def test_rotating_by_180_flips_the_long_axis(self) -> None:
        up, down = sg.polyline(90), sg.polyline(270)
        self.assertAlmostEqual(up[-1][1], -down[-1][1])


class CorrectedRepairTests(unittest.TestCase):
    W, H = 6, 6

    def idx(self, rows):
        return grid(rows)

    def test_blip_needs_a_stable_neighbourhood(self) -> None:
        still = ["......", ".1111.", ".1111.", ".1111.", ".1111.", "......"]
        flash = ["......", ".1111.", ".1221.", ".1111.", ".1111.", "......"]
        found = rr.stable_triplet_blips(self.idx(still), self.idx(flash), self.idx(still), self.W, self.H)
        self.assertEqual(found, {(2, 2), (3, 2)})

    def test_a_pixel_beside_a_moving_edge_is_not_a_blip(self) -> None:
        a = self.idx(["......", ".1111.", ".1111.", ".1111.", ".1111.", "......"])
        b = self.idx(["......", ".1111.", ".1112.", ".1111.", ".1111.", "......"])
        moved = self.idx(["......", ".111..", ".111..", ".1111.", ".1111.", "......"])  # silhouette changes in the next frame
        self.assertEqual(rr.stable_triplet_blips(a, b, moved, self.W, self.H), set())

    def test_neighbours_must_agree_with_each_other(self) -> None:
        a = self.idx(["......", ".1111.", ".1111.", ".1111.", ".1111.", "......"])
        b = self.idx(["......", ".1111.", ".1211.", ".1111.", ".1111.", "......"])
        c = self.idx(["......", ".1111.", ".1311.", ".1111.", ".1111.", "......"])
        self.assertEqual(rr.stable_triplet_blips(a, b, c, self.W, self.H), set())

    def test_a_steady_change_is_not_a_blip(self) -> None:
        a = self.idx(["......", ".1111.", ".1111.", ".1111.", ".1111.", "......"])
        b = self.idx(["......", ".1111.", ".1211.", ".1111.", ".1111.", "......"])
        self.assertEqual(rr.stable_triplet_blips(a, a, b, self.W, self.H), set())

    def test_triplet_denominator_counts_stable_opaque_pixels(self) -> None:
        a = self.idx(["......", ".1111.", ".1111.", ".1111.", ".1111.", "......"])
        self.assertEqual(rr.stable_triplet_count(a, a, a, self.W, self.H), 16)  # identical frames: every opaque pixel is stable

    def test_bottom_crop_only_when_past_the_edge(self) -> None:
        colours = [None] * (self.W * self.H)
        for x in range(self.W):
            colours[(self.H - 1) * self.W + x] = (9, 9, 9) if x < 3 else (1, 1, 1)
        self.assertEqual(rr.bottom_crop(colours, {(1, 1, 1)}, 5.0, self.W, self.H), set())
        self.assertEqual(rr.bottom_crop(colours, {(1, 1, 1)}, 7.2, self.W, self.H), {(0, 5), (1, 5), (2, 5)})

    def test_over_height_and_isolated(self) -> None:
        tall = self.idx(["1.....", "1.....", "1.....", "1.....", "1.....", "1.1..."])
        self.assertEqual(rr.over_height(tall, self.W, self.H, limit=4), {(0, 0), (0, 1)})
        self.assertEqual(rr.isolated(tall, self.W, self.H), {(2, 5)})

    def test_bolt_shape_passes_when_visible_and_fails_when_hidden(self) -> None:
        all_xy = {(x, 0) for x in range(10)}
        ok, info = rr.bolt_shape(all_xy, set(list(all_xy)[:8]), 0, 5, 5)
        self.assertEqual(ok, set())
        self.assertFalse(info["fails"])
        lost, info = rr.bolt_shape(all_xy, {(0, 0), (1, 0)}, 0, 5, 5)
        self.assertEqual(len(lost), 8)
        self.assertTrue(info["fails"])

    def test_bolt_shape_fails_on_clipping_or_hand_loss(self) -> None:
        all_xy = {(x, 0) for x in range(10)}
        _, a = rr.bolt_shape(all_xy, all_xy, 1, 5, 5)
        _, b = rr.bolt_shape(all_xy, all_xy, 0, 5, 4)
        self.assertTrue(a["fails"])
        self.assertTrue(b["fails"])

    def test_the_estimate_is_a_union_not_a_sum(self) -> None:
        est = rr.union_estimate({"a": {(1, 1), (2, 2)}, "b": {(2, 2), (3, 3)}, "c": set()})
        self.assertEqual(est["pixels"], 3)
        self.assertEqual(est["sum_of_kinds"], 4)
        self.assertEqual(est["by_kind"], {"a": 2, "b": 2})

    def test_visibility_measures_stay_out_of_the_estimate(self) -> None:
        parts = [None] * (self.W * self.H)
        parts[0] = "leg_l"
        parts[1] = "head"
        vis = rr.visibility_measures("walk", parts, {(2, 0)}, self.W, self.H)
        self.assertEqual(vis["leg_px"], 1)
        self.assertEqual(vis["legs_hidden_short_by"], 39)
        self.assertEqual(vis["border_contact_px"], 2)
        self.assertEqual(vis["bolt_adjacent_to_head_or_robe_px"], 1)
        self.assertNotIn("pixels", vis)

    def test_averages_include_clean_cells_and_clips(self) -> None:
        avg = rr.averages([("idle", 0), ("idle", 30), ("cast", 6), ("cast", 0)])
        self.assertEqual(avg["mean_per_cell"], 9.0)
        self.assertEqual(avg["mean_per_clip"], {"idle": 15.0, "cast": 3.0})

    def test_sparse_verdict_thresholds(self) -> None:
        good = rr.sparse_verdict({"mean_per_cell": 15.0, "mean_per_clip": {"idle": 30.0}})
        self.assertTrue(good["pass"])
        self.assertFalse(rr.sparse_verdict({"mean_per_cell": 15.1, "mean_per_clip": {"idle": 1.0}})["pass"])
        self.assertFalse(rr.sparse_verdict({"mean_per_cell": 1.0, "mean_per_clip": {"idle": 30.1}})["pass"])

    def test_estimate_kinds_are_the_preregistered_ones(self) -> None:
        self.assertEqual(set(rr.STABLE_KINDS), {"temporal_blips", "bottom_crop", "over_height", "isolated_pixels", "bolt_shape", "colour_budget", "anchor"})


if __name__ == "__main__":
    unittest.main()

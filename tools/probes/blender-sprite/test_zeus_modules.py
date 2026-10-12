from __future__ import annotations

import math
import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import overlap
import playback
import proxy_plan as pp
import repairs
import sprite_metrics as sm
import sprite_plan as sp

T = sm.TRANSPARENT


class PartIdTests(unittest.TestCase):
    def test_bone_to_part(self) -> None:
        for bone, part in (
            ("Head", "head"),
            ("neck_01", "torso"),
            ("pelvis", "torso"),
            ("clavicle_l", "torso"),
            ("upperarm_r", "arm_r"),
            ("lowerarm_l", "arm_l"),
            ("hand_r", "hand_r"),
            ("index_02_l", "hand_l"),
            ("thumb_01_r", "hand_r"),
            ("thigh_l", "leg_l"),
            ("ball_leaf_r", "leg_r"),
        ):
            self.assertEqual(pp.part_for_bone(bone), part, bone)

    def test_id_bytes_round_trip_with_rounding_error(self) -> None:
        for part in pp.PART_IDS:
            byte = pp.id_byte(part)
            for wobble in (-2, -1, 0, 1, 2):
                self.assertEqual(pp.decode_id(byte + wobble), part)

    def test_bytes_between_ids_decode_to_none(self) -> None:
        self.assertIsNone(pp.decode_id(pp.id_byte("torso") + 4))
        self.assertIsNone(pp.decode_id(0))
        self.assertIsNone(pp.decode_id(255))

    def test_ids_are_distinct_and_in_byte_range(self) -> None:
        bytes_ = [pp.id_byte(p) for p in pp.PART_IDS]
        self.assertEqual(len(set(bytes_)), len(bytes_))
        self.assertLess(max(bytes_), 255)

    def test_depth_round_trip_within_a_centimetre_per_byte_step(self) -> None:
        for d in (18.5, 19.2, 20.0, 20.7, 21.9):
            self.assertAlmostEqual(pp.decode_depth(pp.encode_depth(d)), d, delta=0.06)

    def test_depth_is_monotonic(self) -> None:
        values = [pp.encode_depth(18.0 + i * 0.1) for i in range(40)]
        self.assertEqual(values, sorted(values))


class BodyAndRobeTests(unittest.TestCase):
    def test_widen_moves_shoulders_outward_and_leaves_the_centre(self) -> None:
        self.assertEqual(pp.widen_dx(0.0, 1.4, 0.05), 0.0)
        self.assertGreater(pp.widen_dx(0.3, 1.4, 0.05), 0.04)
        self.assertLess(pp.widen_dx(-0.3, 1.4, 0.05), -0.04)

    def test_widen_does_not_stretch_arms(self) -> None:
        # Two points on the same arm shift by the same amount, so the arm keeps its length.
        self.assertAlmostEqual(pp.widen_dx(0.5, 1.44, 0.05), pp.widen_dx(0.8, 1.44, 0.05))

    def test_widen_fades_with_height(self) -> None:
        self.assertGreater(pp.widen_dx(0.3, 1.38, 0.05), pp.widen_dx(0.3, 0.3, 0.05) * 5)

    def test_scale_about_axis_keeps_length_and_thickens(self) -> None:
        a, b = (0.0, 0.0, 0.0), (1.0, 0.0, 0.0)
        out = pp.scale_about_axis((0.4, 0.1, 0.0), a, b, 1.5)
        self.assertAlmostEqual(out[0], 0.4)
        self.assertAlmostEqual(out[1], 0.15)

    def test_robe_rings_run_neck_to_hem_and_flare(self) -> None:
        rings = pp.robe_rings()
        zs = [r.z for r in rings]
        self.assertEqual(zs, sorted(zs, reverse=True))
        self.assertGreater(rings[-1].half_w, rings[3].half_w)
        self.assertGreater(rings[0].z, 1.4)
        self.assertLess(rings[-1].z, 0.4)  # hem above the ankles' sandals, below the knee

    def test_ring_points_are_a_closed_ring_with_folds(self) -> None:
        ring = pp.Ring(1.0, 0.2, 0.1, 0.0, fold=0.1)
        pts = pp.ring_points(ring, 16, 5)
        self.assertEqual(len(pts), 16)
        self.assertTrue(all(abs(p[2] - 1.0) < 1e-9 for p in pts))
        radii = [math.hypot(p[0] / 0.2, p[1] / 0.1) for p in pts]
        self.assertGreater(max(radii) - min(radii), 0.1)

    def test_open_arc_leaves_a_gap(self) -> None:
        ring = pp.Ring(1.0, 0.2, 0.1, 0.0)
        pts = pp.ring_points(ring, 8, 0, arc=(0.0, math.pi))
        self.assertAlmostEqual(pts[0][0], 0.2)
        self.assertAlmostEqual(pts[-1][0], -0.2)

    def test_zigzag_alternates_sides_with_grip_on_the_axis(self) -> None:
        pts = pp.zigzag_points(4, 0.1, 0.12, plane_deg=0)
        self.assertEqual(pts[0][1:], (0.0, 0.0))
        self.assertEqual(pts[-1][1:], (0.0, 0.0))
        self.assertGreater(pts[1][1], 0)
        self.assertLess(pts[2][1], 0)
        self.assertAlmostEqual(pts[-1][0], 0.4)

    def test_zigzag_plane_turn_keeps_amplitude(self) -> None:
        pts = pp.zigzag_points(4, 0.1, 0.12, plane_deg=45)
        self.assertAlmostEqual(math.hypot(pts[1][1], pts[1][2]), 0.12)

    def test_seat_is_a_plain_block_under_the_pelvis(self) -> None:
        w, d, h = pp.seat_size(0.55)
        self.assertAlmostEqual(h, 0.48)
        self.assertLess(0.5 * math.hypot(w, d) * sp.FIXED_ANCHOR[1] / 100, 1)


class VariantTests(unittest.TestCase):
    def test_variants_have_consistent_band_counts(self) -> None:
        for v in pp.VARIANTS:
            for role in pp.ROLES:
                stops = pp.band_positions(v, role)
                self.assertEqual(len(stops), len(v.thresholds) + 1)
                self.assertEqual(stops[0][0], 0.0)
                self.assertTrue(all(shade >= 1 for _, shade in stops), "shade 0 is reserved for the outline")

    def test_variants_are_distinct_and_named(self) -> None:
        self.assertEqual([v.id for v in pp.VARIANTS], ["a3", "b2"])
        self.assertEqual(len(pp.VARIANT_A.thresholds), 2)
        self.assertEqual(len(pp.VARIANT_B.thresholds), 1)
        self.assertGreater(pp.VARIANT_B.fill, pp.VARIANT_A.fill)

    def test_bad_band_counts_are_rejected(self) -> None:
        bad = pp.ShadingVariant("x", "x", {r: (1, 2) for r in pp.ROLES}, (0.3, 0.6), 1, 0, 0)
        with self.assertRaises(ValueError):
            pp.band_positions(bad, "skin")

    def test_anchor_is_the_fixed_one(self) -> None:
        self.assertEqual(sp.FIXED_ANCHOR, (32.0, 74.0))


class OverlapTests(unittest.TestCase):
    def grid(self, rows: list[list[str | None]]):
        return [p for row in rows for p in row]

    def test_line_goes_on_the_far_side_of_a_depth_jump(self) -> None:
        parts = self.grid([["arm", "torso"]])
        depth = [19.0, 19.5]
        lines = overlap.candidate_lines(parts, depth, 2, 1, 0.05)
        self.assertEqual(lines, {1: 0})

    def test_no_line_without_a_depth_jump_or_for_the_same_part(self) -> None:
        self.assertEqual(overlap.candidate_lines(self.grid([["arm", "torso"]]), [19.0, 19.02], 2, 1, 0.05), {})
        self.assertEqual(overlap.candidate_lines(self.grid([["arm", "arm"]]), [19.0, 19.5], 2, 1, 0.05), {})

    def test_transparent_pixels_are_ignored(self) -> None:
        self.assertEqual(overlap.candidate_lines(self.grid([["arm", None]]), [19.0, 25.0], 2, 1, 0.05), {})

    def test_far_side_takes_the_biggest_gap(self) -> None:
        parts = self.grid([["a", "c", "b"]])
        depth = [19.0, 19.5, 19.2]
        self.assertEqual(overlap.candidate_lines(parts, depth, 3, 1, 0.05)[1], 0)

    LIGHT = (200, 200, 200)
    MID = (120, 120, 120)
    DARK = (40, 40, 40)
    GOLD = (220, 190, 110)
    RAMPS = {LIGHT: "cloud", MID: "cloud", DARK: "cloud", GOLD: "gold"}
    DARKEST = {"cloud": DARK, "gold": (80, 60, 30)}

    @staticmethod
    def lum(c) -> float:
        return sum(c) / (3 * 255)

    def test_same_ramp_touching_needs_a_line(self) -> None:
        self.assertTrue(overlap.needs_line(self.MID, self.LIGHT, self.RAMPS, self.DARKEST, self.lum))

    def test_far_pixel_already_darkest_needs_none(self) -> None:
        self.assertFalse(overlap.needs_line(self.DARK, self.LIGHT, self.RAMPS, self.DARKEST, self.lum))

    def test_clearly_different_ramps_need_none_but_close_ones_do(self) -> None:
        self.assertFalse(overlap.needs_line(self.MID, self.GOLD, self.RAMPS, self.DARKEST, self.lum, 0.05))
        self.assertTrue(overlap.needs_line(self.MID, self.GOLD, self.RAMPS, self.DARKEST, self.lum, 0.9))

    def test_apply_lines_uses_the_darkest_of_the_far_ramp(self) -> None:
        pixels = [self.LIGHT, self.MID]
        out, drawn = overlap.apply_lines(pixels, {1: 0}, self.RAMPS, self.DARKEST, self.lum)
        self.assertEqual(drawn, [1])
        self.assertEqual(out[1], self.DARK)
        self.assertEqual(out[0], self.LIGHT)
        self.assertEqual(pixels[1], self.MID)

    def test_lines_are_one_pixel_thick(self) -> None:
        parts = self.grid([["a", "a", "b", "b"], ["a", "a", "b", "b"]])
        depth = [19.0, 19.0, 19.6, 19.6, 19.0, 19.0, 19.6, 19.6]
        lines = overlap.candidate_lines(parts, depth, 4, 2, 0.05)
        self.assertEqual(sorted(lines), [2, 6])


class PlaybackTests(unittest.TestCase):
    def test_ms_to_cs(self) -> None:
        self.assertEqual([playback.ms_to_cs(m) for m in (333, 167, 83, 100, 500)], [33, 17, 8, 10, 50])

    def test_timeline_follows_each_panel(self) -> None:
        steps = playback.timeline([(333, 167, 333, 167), (500, 500)], 100)
        self.assertEqual(steps, [(33, (0, 0)), (17, (1, 0)), (33, (2, 1)), (17, (3, 1))])

    def test_timeline_covers_the_total(self) -> None:
        steps = playback.timeline([(333, 167, 333, 167), (83, 100, 83, 83, 100)], 300)
        self.assertEqual(sum(d for d, _ in steps), 300)
        self.assertGreater(len(steps), 20)

    def test_single_panel_matches_its_schedule(self) -> None:
        self.assertEqual(playback.timeline([(100, 200)], 60), [(10, (0,)), (20, (1,)), (10, (0,)), (20, (1,))])

    @staticmethod
    def lzw_decode(data: bytes, min_code_size: int) -> bytes:
        clear = 1 << min_code_size
        eoi = clear + 1
        out = bytearray()
        bitpos = 0
        size = min_code_size + 1
        table: list[bytes] = []
        prev: bytes | None = None

        def reset() -> None:
            nonlocal table, prev, size
            table = [bytes([i]) for i in range(clear)] + [b"", b""]
            prev = None
            size = min_code_size + 1

        reset()
        while True:
            if bitpos + size > len(data) * 8:
                break
            code = 0
            for i in range(size):
                byte = data[(bitpos + i) // 8]
                code |= ((byte >> ((bitpos + i) % 8)) & 1) << i
            bitpos += size
            if code == clear:
                reset()
                continue
            if code == eoi:
                break
            if prev is None:
                entry = table[code]
            elif code < len(table):
                entry = table[code]
                table.append(prev + entry[:1])
            else:
                entry = prev + prev[:1]
                table.append(entry)
            out += entry
            prev = entry
            if len(table) == (1 << size) and size < 12:
                size += 1
        return bytes(out)

    def test_lzw_round_trips_flat_noisy_and_long_data(self) -> None:
        rng = random.Random(7)
        for n, colours in ((10, 2), (500, 4), (5000, 16), (30000, 3), (20000, 200)):
            data = bytes(rng.randrange(colours) for _ in range(n))
            bits = max(2, (colours - 1).bit_length())
            self.assertEqual(self.lzw_decode(playback.lzw_compress(data, bits), bits), data, (n, colours))

    def test_lzw_round_trips_long_runs(self) -> None:
        data = bytes([3] * 10000 + [1] * 5000 + [2, 3] * 2000)
        self.assertEqual(self.lzw_decode(playback.lzw_compress(data, 2), 2), data)

    def test_gif_header_delays_and_trailer(self) -> None:
        palette = [(1, 2, 3), (200, 100, 50)]
        frames = [bytes([0, 1, 1, 0]), bytes([1, 0, 0, 1])]
        data = playback.encode_gif(2, 2, palette, frames, [33, 17])
        self.assertTrue(data.startswith(b"GIF89a"))
        self.assertEqual(data[6:10], bytes((2, 0, 2, 0)))
        self.assertTrue(data.endswith(b"\x3b"))
        self.assertEqual(data.count(b"\x21\xf9\x04\x04"), 2)
        self.assertIn(b"\x21\xf9\x04\x04" + bytes((33, 0)), data)
        self.assertIn(b"\x21\xf9\x04\x04" + bytes((17, 0)), data)

    def test_gif_rejects_bad_input(self) -> None:
        with self.assertRaises(ValueError):
            playback.encode_gif(2, 2, [(0, 0, 0)], [bytes(4)], [1, 2])
        with self.assertRaises(ValueError):
            playback.encode_gif(2, 2, [(0, 0, 0)], [bytes(3)], [1])
        with self.assertRaises(ValueError):
            playback.encode_gif(2, 2, [], [bytes(4)], [1])


class RepairDetectorTests(unittest.TestCase):
    W, H = 8, 10

    def blank(self):
        return [T] * (self.W * self.H)

    def test_clean_cell_has_no_issue(self) -> None:
        idx = self.blank()
        for y in range(2, 8):
            for x in range(2, 6):
                idx[y * self.W + x] = 1
        self.assertIsNone(repairs.edge_crop(idx, self.W, self.H))
        self.assertIsNone(repairs.isolated(idx, self.W, self.H))
        self.assertIsNone(repairs.over_height(idx, self.W, self.H, limit=12))

    def test_edge_crop_counts_border_pixels(self) -> None:
        idx = self.blank()
        idx[0 * self.W + 3] = 1
        idx[4 * self.W + 0] = 1
        self.assertEqual(repairs.edge_crop(idx, self.W, self.H)["pixels"], 2)

    def test_over_height_counts_the_excess_rows(self) -> None:
        idx = self.blank()
        for y in range(0, 10):
            idx[y * self.W + 3] = 1
        issue = repairs.over_height(idx, self.W, self.H, limit=7)
        self.assertEqual(issue["pixels"], 3)

    def test_isolated(self) -> None:
        idx = self.blank()
        idx[5 * self.W + 5] = 1
        self.assertEqual(repairs.isolated(idx, self.W, self.H)["pixels"], 1)

    def test_bolt_readability(self) -> None:
        parts = [None] * 100
        self.assertEqual(repairs.bolt_readability(parts)["pixels"], repairs.MIN_BOLT_PX)
        for i in range(30):
            parts[i] = "bolt"
        self.assertIsNone(repairs.bolt_readability(parts))

    def test_bolt_touch(self) -> None:
        parts = [None] * (self.W * self.H)
        for y in range(2, 9):
            parts[y * self.W + 2] = "bolt"
            parts[y * self.W + 3] = "head"
        self.assertEqual(repairs.bolt_touch(parts, self.W, self.H)["pixels"], 7)

    def test_blips(self) -> None:
        n = self.W * self.H
        prev, nxt = [1] * n, [1] * n
        cur = [1] * n
        for i in range(12):
            cur[i] = 2
        self.assertEqual(repairs.blips(prev, cur, nxt, self.W, self.H)["pixels"], 12)
        self.assertIsNone(repairs.blips(prev, prev, nxt, self.W, self.H))

    def test_cell_issues_flags_anchor_and_colour_budget(self) -> None:
        idx = self.blank()
        found = repairs.cell_issues(idx, [None] * len(idx), [(0, 0, 0)] * len(idx), {}, set(), self.W, self.H, 17, (31, 74), False)
        kinds = {f["kind"] for f in found}
        self.assertIn("colour_budget", kinds)
        self.assertIn("anchor", kinds)


if __name__ == "__main__":
    unittest.main()

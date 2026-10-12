from __future__ import annotations

import json
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import palette_plan as pal
import retro_metrics as rm
import retro_plan as rp
import stamp_plan as stp
import tile_geom as tg
import wind_plan as wp

T = rm.TRANSPARENT


class PaletteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.source = json.loads(pal.SOURCE_PALETTE.read_text())
        self.doc = pal.build(self.source)

    def test_oklab_round_trip(self) -> None:
        for rgb in ((0, 0, 0), (255, 255, 255), (82, 100, 113), (244, 228, 174), (36, 63, 99)):
            self.assertEqual(pal.from_oklab(pal.oklab(rgb)), rgb)

    def test_extension_keeps_originals_in_order(self) -> None:
        original = [pal.from_hex(h) for h in ("#76572f", "#b38b43", "#ddbf70", "#f4e4ae")]
        ext = pal.extend_ramp(original, 6)
        self.assertEqual(len(ext), 6)
        self.assertEqual([c for c in ext if c in original], original)

    def test_extension_is_monotonic_in_lightness(self) -> None:
        for _, ramp in pal.SCENE_RAMPS:
            shades = pal.ramp_shades(self.doc, ramp)
            lightness = [pal.oklab(c)[0] for c in shades]
            self.assertEqual(lightness, sorted(lightness), ramp)

    def test_extension_splits_the_widest_gap_first(self) -> None:
        dark, mid, light = (0, 0, 0), (230, 230, 230), (255, 255, 255)
        ext = pal.extend_ramp([dark, mid, light], 4)
        self.assertEqual(len(ext), 4)
        self.assertEqual([ext[0], ext[2], ext[3]], [dark, mid, light])
        self.assertTrue(pal.oklab(dark)[0] < pal.oklab(ext[1])[0] < pal.oklab(mid)[0], "the new shade sits in the dark-to-mid gap")

    def test_extension_rejects_shrinking(self) -> None:
        with self.assertRaises(ValueError):
            pal.extend_ramp([(0, 0, 0)] * 5, 4)

    def test_scene_palette_limits(self) -> None:
        colours = pal.all_colours(self.doc)
        self.assertLessEqual(len(colours), pal.MAX_SCENE_COLOURS)
        self.assertEqual(len(colours), len(set(colours)))
        self.assertTrue(all(len(r["shades"]) == pal.SHADES_PER_RAMP for r in self.doc["families"][0]["ramps"]))

    def test_every_original_olympus_colour_survives(self) -> None:
        scene = set(pal.all_colours(self.doc))
        for fam in self.source["families"]:
            if fam["id"] != "olympus":
                continue
            for ramp in fam["ramps"]:
                for h in ramp["shades"]:
                    self.assertIn(pal.from_hex(h), scene, h)

    def test_the_round_three_bolt_colours_are_in_the_palette(self) -> None:
        stamps = json.loads((pal.REPO / "tools/probes/blender-sprite/stamps/bolt-stamps.json").read_text())["palette"]
        scene = {pal.to_hex(c) for c in pal.all_colours(self.doc)}
        for key in ("dark", "mid", "light"):
            self.assertIn(stamps[key], scene)

    def test_nearest_ramp_maps_a_kit_green_to_olive(self) -> None:
        self.assertEqual(pal.nearest_ramp(self.doc, (104, 118, 74)), "olive")
        self.assertEqual(pal.nearest_ramp(self.doc, (206, 118, 81)), "terracotta")

    def test_build_is_deterministic_and_loadable_by_the_existing_loader(self) -> None:
        self.assertEqual(pal.build(self.source), self.doc)
        sys.path.insert(0, str(pal.REPO / "tools/probes/art-edit"))
        from sprite_downscale import load_palette

        loaded = load_palette(pal.OUT_PALETTE, pal.FAMILY_ID)
        self.assertEqual(len(loaded.colours), len(pal.all_colours(self.doc)))
        self.assertEqual(loaded.darkest["marble"], pal.from_hex("#526471"))


class TileGeometryTests(unittest.TestCase):
    def test_diamond_rows_match_the_renderer(self) -> None:
        self.assertEqual(tg.diamond_row(0), (30, 34))
        self.assertEqual(tg.diamond_row(15), (0, 64))
        self.assertEqual(tg.diamond_row(30), (30, 34))
        self.assertIsNone(tg.diamond_row(31))
        self.assertIsNone(tg.diamond_row(-1))

    def test_diamond_mask_has_the_drawn_pixels_only(self) -> None:
        mask = tg.diamond_mask()
        self.assertEqual(len(mask), tg.TILE_H)
        self.assertEqual(sum(row.count(True) for row in mask), sum(tg.diamond_row(r)[1] - tg.diamond_row(r)[0] for r in range(31)))
        self.assertFalse(any(mask[31]))

    def test_origin_and_bottom_vertex(self) -> None:
        self.assertEqual(tg.diamond_origin(0, 0), (-32, 0))
        self.assertEqual(tg.diamond_origin(1, 0), (0, 16))
        self.assertEqual(tg.diamond_origin(0, 1), (-64, 16))
        self.assertEqual(tg.bottom_vertex(0, 0), (0, 31))
        self.assertEqual(tg.bottom_vertex(0, 0, 0, 2, 2), (0, 63))
        self.assertEqual(tg.bottom_vertex(0, 0, 1), (0, 15))

    def test_depth_and_sprite_origin(self) -> None:
        self.assertEqual(tg.depth_of(2, 3), 5)
        self.assertEqual(tg.depth_of(2, 3, 1, 2, 2), 5 + 2 - 1)
        self.assertEqual(tg.sprite_origin(0, 0, (32, 74)), (-32, 31 - 74))

    def test_footprint_pixels(self) -> None:
        self.assertEqual(tg.footprint_px(1, 1), (64, 31))
        self.assertEqual(tg.footprint_px(4, 3), (224, 111))
        self.assertAlmostEqual(tg.centre_to_bottom_vertex_px(1, 1), 15.5)
        self.assertAlmostEqual(tg.centre_to_bottom_vertex_px(4, 3), 55.5)

    def test_tile_world_side_makes_a_two_to_one_diamond(self) -> None:
        side = tg.tile_world_side(rp.PPU)
        width_px = side * math.sqrt(2.0) * rp.PPU
        self.assertAlmostEqual(width_px, tg.TILE_W)
        self.assertAlmostEqual(side, 1.5563, places=3)
        self.assertAlmostEqual(rp.ground_diamond_ratio(), 0.5)

    def test_ground_projection(self) -> None:
        r2 = math.sqrt(2.0) / 2.0
        right, up = (r2, r2), (-0.3535533905932738, 0.35355339059327384)
        x, y = tg.iso_ground_to_px(1.0, 0.0, rp.PPU, right, up)
        self.assertGreater(x, 0)
        self.assertAlmostEqual(y, x / 2, places=6)  # world +X goes down-right at 2:1


class WindTests(unittest.TestCase):
    def test_phase_is_two_pi_over_n_per_frame(self) -> None:
        self.assertAlmostEqual(wp.phase(3, 12), math.pi / 2)
        self.assertAlmostEqual(wp.phase(12, 12), 2 * math.pi)

    def test_weight_rises_toward_the_canopy_and_is_clamped(self) -> None:
        self.assertEqual(wp.sway_weight(0.0), 0.0)
        self.assertEqual(wp.sway_weight(1.0), 1.0)
        self.assertLess(wp.sway_weight(0.3), wp.sway_weight(0.6))
        self.assertEqual(wp.sway_weight(1.7), 1.0)
        self.assertEqual(wp.sway_weight(-0.2), 0.0)

    def test_base_does_not_move(self) -> None:
        self.assertEqual(wp.displacement(0.2, 0.1, 0.0, 4.0, 5, 12, 0.14), (0.0, 0.0, 0.0))

    def test_amplitude_grows_with_height(self) -> None:
        low = max(abs(wp.displacement(0, 0, 1.0, 4.0, f, 12, 0.14)[0]) for f in range(12))
        high = max(abs(wp.displacement(0, 0, 3.9, 4.0, f, 12, 0.14)[0]) for f in range(12))
        self.assertGreater(high, low * 3)

    def test_the_loop_closes_frame_n_equals_frame_zero(self) -> None:
        for z in (0.5, 2.0, 3.9):
            a = wp.displacement(0.1, -0.2, z, 4.0, 0, 12, 0.14)
            b = wp.displacement(0.1, -0.2, z, 4.0, 12, 12, 0.14)
            for u, v in zip(a, b, strict=True):
                self.assertAlmostEqual(u, v, places=12)

    def test_two_cycles_also_close(self) -> None:
        a = wp.displacement(0, 0, 3.0, 4.0, 0, 12, 0.1, cycles=2)
        b = wp.displacement(0, 0, 3.0, 4.0, 12, 12, 0.1, cycles=2)
        self.assertTrue(all(abs(u - v) < 1e-12 for u, v in zip(a, b, strict=True)))

    def test_the_crown_lags_the_trunk(self) -> None:
        # same frame, different height: the phase differs by lag * dz / height, so the normalised sway is not equal
        trunk = wp.displacement(0, 0, 1.0, 4.0, 2, 12, 0.14)[0] / wp.sway_weight(1.0 / 4.0)
        crown = wp.displacement(0, 0, 3.9, 4.0, 2, 12, 0.14)[0] / wp.sway_weight(3.9 / 4.0)
        self.assertNotAlmostEqual(trunk, crown, places=4)

    def test_frames_exclude_the_duplicate_endpoint(self) -> None:
        self.assertEqual(wp.loop_frames(12), list(range(12)))
        self.assertNotIn(12, wp.loop_frames(12))

    def test_timing_sums_exactly(self) -> None:
        for n in (12, 7, 8):
            self.assertEqual(sum(wp.timing_ms(n)), 2000)
        self.assertEqual(sum(rp.TREE.clips[0].timing_ms), 2000)

    def test_one_loop_has_no_net_drift(self) -> None:
        mean = sum(wp.displacement(0, 0, 3.0, 4.0, f, 12, 0.14)[0] for f in range(12)) / 12
        self.assertAlmostEqual(mean, 0.0, places=12)


class RetroPlanTests(unittest.TestCase):
    def test_gods_keep_the_standing_height_and_pivot_equals_origin(self) -> None:
        self.assertEqual(rp.ZEUS.cell, rp.GOD_CELL)
        self.assertEqual(rp.ZEUS.pivot_px, rp.GOD_ANCHOR)
        self.assertEqual(rp.ZEUS.origin_px, rp.GOD_ANCHOR)
        self.assertTrue(48 <= rp.GOD_INTERIOR_PX + 2 <= 56)
        self.assertTrue(40 <= rp.MORTAL_INTERIOR_PX + 2 <= 48)
        self.assertEqual(rp.MORTAL.cell, (64, 64))

    def test_bands_are_five_and_start_at_zero(self) -> None:
        self.assertEqual(rp.BANDS, 5)
        self.assertEqual(len(rp.BAND_STARTS), 5)
        self.assertEqual(len(rp.BAND_SHADES), 5)
        self.assertEqual(rp.BAND_STARTS[0], 0.0)
        self.assertEqual(sorted(rp.BAND_STARTS), list(rp.BAND_STARTS))
        self.assertNotIn(0, rp.BAND_SHADES, "shade 0 is the outline's")

    def test_band_index(self) -> None:
        for i, start in enumerate(rp.BAND_STARTS):
            self.assertEqual(rp.band_index(start + 1e-6), i)
        self.assertEqual(rp.band_index(5.0), 4)
        self.assertEqual(rp.band_index(0.1, offset=0.35), 1)

    def test_bayer_matrix_is_a_valid_ordered_dither(self) -> None:
        flat = sorted(v for row in rp.BAYER4 for v in row)
        self.assertEqual(flat, list(range(16)))
        values = {rp.bayer_threshold(x, y) for x in range(4) for y in range(4)}
        self.assertEqual(len(values), 16)
        self.assertTrue(all(0 < v < 1 for v in values))
        self.assertAlmostEqual(sum(values) / 16, 0.5)

    def test_dither_offset_is_centred_and_bounded(self) -> None:
        offs = [rp.dither_offset(x, y) for x in range(4) for y in range(4)]
        self.assertAlmostEqual(sum(offs), 0.0, places=9)
        self.assertLess(max(abs(o) for o in offs), rp.DITHER_WIDTH / 2)
        self.assertEqual(rp.dither_offset(5, 6), rp.dither_offset(1, 2), "the pattern tiles every four pixels")

    def test_dither_only_changes_pixels_near_a_band_edge(self) -> None:
        mid = (rp.BAND_STARTS[1] + rp.BAND_STARTS[2]) / 2
        bands = {rp.band_index(mid, rp.dither_offset(x, y)) for x in range(4) for y in range(4)}
        self.assertEqual(bands, {1}, "the middle of a band is stable")
        edge = rp.BAND_STARTS[2]
        bands = {rp.band_index(edge, rp.dither_offset(x, y)) for x in range(4) for y in range(4)}
        self.assertEqual(bands, {1, 2}, "a band edge dithers between its two bands")

    def test_bias_is_clamped_and_signed(self) -> None:
        self.assertEqual(rp.bias_for(0.9, 0.5), 0.3)
        self.assertEqual(rp.bias_for(0.1, 0.9), -0.3)
        self.assertEqual(rp.bias_for(0.5, 0.5), 0.0)

    def test_part_ids_round_trip_and_stay_in_a_byte(self) -> None:
        for part in rp.PART_IDS:
            self.assertEqual(rp.decode_id(rp.id_byte(part)), part)
            self.assertLessEqual(rp.id_byte(part), 255)
        self.assertEqual(len(set(rp.id_byte(p) for p in rp.PART_IDS)), len(rp.PART_IDS))

    def test_id_decoding_tolerates_rounding_but_not_garbage(self) -> None:
        self.assertEqual(rp.decode_id(rp.id_byte("hair") + 2), "hair")
        self.assertEqual(rp.decode_id(rp.id_byte("hair") - 2), "hair")
        self.assertIsNone(rp.decode_id(rp.id_byte("hair") + 4))
        self.assertIsNone(rp.decode_id(3))

    def test_depth_round_trip(self) -> None:
        for d in (14.2, 18.0, 20.0, 25.5):
            self.assertAlmostEqual(rp.decode_depth(rp.encode_depth(d, 13, 27), 13, 27), d, delta=0.1)

    def test_bone_to_part(self) -> None:
        self.assertEqual(rp.part_for_bone("Head"), "head")
        self.assertEqual(rp.part_for_bone("upperarm_l"), "arm_l")
        self.assertEqual(rp.part_for_bone("index_01_r"), "hand_r")
        self.assertEqual(rp.part_for_bone("calf_r"), "leg_r")
        self.assertEqual(rp.part_for_bone("spine_02"), "torso")

    def test_sample_frames(self) -> None:
        self.assertEqual(rp.sample_frames(0, 60, 4, True), [0, 15, 30, 45])
        self.assertEqual(rp.sample_frames(0, 12, 5, False), [0, 3, 6, 9, 12])
        self.assertEqual(rp.sample_frames(3, 9, 1, True), [3])
        with self.assertRaises(ValueError):
            rp.sample_frames(0, 1, 0, True)

    def test_hold_index_and_timing_sums(self) -> None:
        timing = (333, 167, 333, 167)
        self.assertEqual([rp.hold_index(timing, t) for t in (0, 332, 333, 499, 500, 832, 833, 999, 1000)], [0, 0, 1, 1, 2, 2, 3, 3, 0])
        for clip in rp.ZEUS.clips:
            self.assertEqual(len(clip.timing_ms), clip.frames)
        self.assertEqual(sum(rp.ZEUS.clips[0].timing_ms), 1000)
        self.assertEqual(sum(rp.MORTAL.clips[1].timing_ms), 800)

    def test_fit_scale(self) -> None:
        self.assertAlmostEqual(rp.fit_scale(50, 100), 0.5)
        with self.assertRaises(ValueError):
            rp.fit_scale(50, 0)
        self.assertAlmostEqual(rp.mortal_scale_ratio(), 0.84)

    def test_footprint_items_put_the_pivot_on_the_bottom_vertex(self) -> None:
        t = rp.TEMPLE
        self.assertEqual(t.origin_px[0], t.pivot_px[0])
        self.assertAlmostEqual(t.pivot_px[1] - t.origin_px[1], 39.5)
        self.assertEqual(t.footprint, (3, 2))
        self.assertLessEqual(t.pivot_px[1], t.cell[1])
        self.assertAlmostEqual(rp.HOUSE.pivot_px[1] - rp.HOUSE.origin_px[1], 31.5)

    def test_the_tile_cell_is_the_client_tile(self) -> None:
        self.assertEqual(rp.TILE.cell, (64, 32))
        self.assertEqual(rp.TILE.origin_px, (32.0, 15.5))

    def test_render_size_and_names(self) -> None:
        self.assertEqual(rp.render_size((64, 80)), (256, 320))
        self.assertEqual(rp.pose_name("zeus", "idle", "south", 3), "idle_south_03")

    def test_the_iso_camera_scale_is_round_ones(self) -> None:
        self.assertAlmostEqual(rp.PPU, 29.0788)
        self.assertEqual(rp.CAMERA_ROT_DEG, (60.0, 0.0, 45.0))


class StampTests(unittest.TestCase):
    EYE, BROW = (36, 63, 99), (82, 100, 113)

    def parts(self, head_box):
        w, h = 20, 20
        parts: list = [None] * (w * h)
        x0, y0, x1, y1 = head_box
        for y in range(y0, y1):
            for x in range(x0, x1):
                parts[y * w + x] = "head"
        return parts, w, h

    def test_north_has_no_face(self) -> None:
        self.assertEqual(stp.stamp_pixel_count("north"), 0)
        self.assertEqual(stp.preview("north"), ["(none)"])

    def test_a_few_pixels_per_facing(self) -> None:
        for facing, expected in (("south", 6), ("east", 3), ("west", 3)):
            self.assertEqual(stp.stamp_pixel_count(facing), expected)
            self.assertLessEqual(stp.stamp_pixel_count(facing), 8, "a few pixels")

    def test_pixel_of_floors_edge_coordinates(self) -> None:
        self.assertEqual(stp.pixel_of(5.99, 7.0), (5, 7))
        self.assertEqual(stp.pixel_of(-0.2, 3.5), (-1, 3))

    def test_south_draws_two_eyes_and_two_brows(self) -> None:
        parts, w, h = self.parts((5, 5, 15, 15))
        eyes = {"l": (11.5, 10.5, 20.0), "r": (7.5, 10.5, 20.0)}
        out = stp.face_pixels("south", eyes, parts, w, h, self.EYE, self.BROW)
        self.assertEqual(out["planned"], 6)
        self.assertEqual(out["skipped"], 0)
        self.assertEqual(out["drawn"][10 * w + 11], self.EYE)
        self.assertEqual(out["drawn"][10 * w + 7], self.EYE)
        self.assertEqual(out["drawn"][9 * w + 12], self.BROW)  # left eye's brow tips outward (screen right)
        self.assertEqual(out["drawn"][9 * w + 6], self.BROW)

    def test_profile_uses_only_the_eye_nearer_the_camera(self) -> None:
        parts, w, h = self.parts((5, 5, 15, 15))
        eyes = {"l": (11.5, 10.5, 20.12), "r": (9.5, 10.5, 19.98)}
        out = stp.face_pixels("east", eyes, parts, w, h, self.EYE, self.BROW)
        self.assertIn(10 * w + 9, out["drawn"])
        self.assertNotIn(10 * w + 11, out["drawn"])
        self.assertEqual(stp.near_eye(eyes), "r")

    def test_hair_and_beard_cover_the_stamp(self) -> None:
        parts, w, h = self.parts((5, 5, 15, 15))
        for x in range(5, 15):
            parts[9 * w + x] = "hair"
        eyes = {"l": (11.5, 10.5, 20.0), "r": (7.5, 10.5, 20.0)}
        out = stp.face_pixels("south", eyes, parts, w, h, self.EYE, self.BROW)
        self.assertEqual(out["skipped"], 4)
        self.assertEqual(len(out["drawn"]), 2)

    def test_pixels_outside_the_cell_are_skipped_not_wrapped(self) -> None:
        parts, w, h = self.parts((0, 0, 20, 20))
        out = stp.face_pixels("west", {"l": (0.2, 0.2, 20.0), "r": (3.0, 0.2, 20.1)}, parts, w, h, self.EYE, self.BROW)
        self.assertGreaterEqual(out["skipped"], 1)
        self.assertTrue(all(0 <= i < w * h for i in out["drawn"]))

    def test_the_stamp_colours_are_palette_entries(self) -> None:
        doc = pal.build(json.loads(pal.SOURCE_PALETTE.read_text()))
        eye = pal.ramp_shades(doc, stp.EYE_RAMP)[stp.EYE_SHADE]
        brow = pal.ramp_shades(doc, stp.BROW_RAMP)[stp.BROW_SHADE]
        self.assertIn(eye, pal.all_colours(doc))
        self.assertIn(brow, pal.all_colours(doc))


class MetricsTests(unittest.TestCase):
    W, H = 6, 6

    def grid(self, rows: list[str]) -> list[int]:
        return [T if c == "." else int(c) for row in rows for c in row]

    def test_mask_iou(self) -> None:
        self.assertEqual(rm.mask_iou({1, 2}, {1, 2}), 1.0)
        self.assertEqual(rm.mask_iou(set(), set()), 1.0)
        self.assertAlmostEqual(rm.mask_iou({1, 2, 3}, {2, 3, 4}), 0.5)

    def test_noise_inside_a_still_part_is_separated_from_motion(self) -> None:
        a = self.grid(["......", ".1111.", ".1111.", ".1111.", ".1111.", "......"])
        b = self.grid(["......", ".1211.", ".1111.", ".1131.", ".1111.", "......"])
        pa = [None] * 36
        for y in range(1, 5):
            for x in range(1, 5):
                pa[y * 6 + x] = "legs" if y >= 3 else "arm"
        # the arm's mask changes (one pixel gone), the legs' mask is identical
        pb = list(pa)
        pb[1 * 6 + 4] = None
        r = rm.boil_pair(a, b, pa, pb, self.W, self.H)
        self.assertEqual(r["changed_px"], 2)
        self.assertEqual(r["noise_px"], 1, "the change at (3,3) is inside the legs, which did not move")
        self.assertEqual(r["unclassified_px"] + r["motion_px"], 1)

    def test_a_moving_part_counts_as_motion(self) -> None:
        a = self.grid(["......", ".1111.", ".1111.", ".1111.", ".1111.", "......"])
        b = self.grid(["......", ".1111.", ".1121.", ".1111.", ".1111.", "......"])
        pa = [None] * 36
        for y in range(1, 5):
            for x in range(1, 5):
                pa[y * 6 + x] = "arm"
        pb = [None] * 36
        for y in range(1, 5):
            for x in range(1, 4):
                pb[y * 6 + x] = "arm"
        r = rm.boil_pair(a, b, pa, pb, self.W, self.H)
        self.assertEqual(r["motion_px"], 1)
        self.assertEqual(r["noise_px"], 0)

    def test_pixels_next_to_a_moving_silhouette_are_not_counted(self) -> None:
        a = self.grid(["......", ".111..", ".111..", ".111..", "......", "......"])
        b = self.grid(["......", ".1111.", ".1111.", ".1111.", "......", "......"])
        r = rm.boil_pair(a, b, None, None, self.W, self.H)
        self.assertEqual(r["changed_px"], 0)

    def test_without_a_part_pass_changes_are_unclassified(self) -> None:
        a = self.grid(["......", ".1111.", ".1111.", ".1111.", ".1111.", "......"])
        b = self.grid(["......", ".1111.", ".1211.", ".1111.", ".1111.", "......"])
        r = rm.boil_pair(a, b, None, None, self.W, self.H)
        self.assertEqual((r["changed_px"], r["unclassified_px"], r["noise_px"], r["motion_px"]), (1, 1, 0, 0))

    def test_series_loops_over_the_wrap(self) -> None:
        a = self.grid(["......", ".1111.", ".1111.", ".1111.", ".1111.", "......"])
        b = self.grid(["......", ".1111.", ".1211.", ".1111.", ".1111.", "......"])
        self.assertEqual(rm.boil_series([a, b], None, self.W, self.H, True)["pairs"], 2)
        self.assertEqual(rm.boil_series([a, b], None, self.W, self.H, False)["pairs"], 1)
        self.assertEqual(rm.boil_series([a, b], None, self.W, self.H, True)["changed_px"], 2)

    def test_loop_seam_ratio(self) -> None:
        a = [1, 1, 1, 1]
        b = [1, 2, 1, 1]
        c = [1, 2, 3, 1]
        seamless = rm.loop_seam([a, b, c, b])
        self.assertAlmostEqual(seamless["wrap_ratio"], 0.25 / ((0.25 + 0.25 + 0.25) / 3))
        jump = rm.loop_seam([a, b, [2, 2, 3, 3]])
        self.assertGreater(jump["wrap_ratio"], 1.5)

    def test_pair_change_ignores_pixels_empty_in_both(self) -> None:
        self.assertEqual(rm.pair_change([T, 1, 1], [T, 1, 2]), 0.5)
        self.assertEqual(rm.pair_change([T, T], [T, T]), 0.0)

    def test_bbox_and_rows(self) -> None:
        g = self.grid(["......", "..1...", "..11..", "......", "......", "......"])
        self.assertEqual(rm.bbox(g, 6, 6), (2, 1, 4, 3))
        self.assertEqual(rm.rows_used(g, 6, 6), 2)
        self.assertIsNone(rm.bbox([T] * 36, 6, 6))


if __name__ == "__main__":
    unittest.main()

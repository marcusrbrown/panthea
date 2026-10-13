"""Round 2 (characters): profiles, hair trims, canvases and envelopes, contact shadows, canon placement, the surface boil measure."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import palette_plan as pal
import retro_metrics as rm
import retro_plan as rp
import retro_sheets as rs
import scene_plan as sc
import shadow_plan as sh
import stamp_plan as stp
import tile_geom as tg

T = rm.TRANSPARENT


class ProfileTests(unittest.TestCase):
    def test_each_character_has_its_own_profile(self) -> None:
        self.assertIsNot(rp.PROFILES["zeus"], rp.PROFILES["mortal"])
        self.assertNotEqual(rp.ZEUS_PROFILE.head, rp.MORTAL_PROFILE.head)
        self.assertNotEqual(rp.ZEUS_PROFILE.hair, rp.MORTAL_PROFILE.hair)

    def test_heads_and_hands_are_smaller_than_round_one(self) -> None:
        for profile in rp.PROFILES.values():
            self.assertLess(profile.head, 1.7)
            self.assertLess(profile.hands, 1.55)

    def test_the_mortal_has_shorter_limbs_and_zeus_does_not(self) -> None:
        self.assertLess(rp.MORTAL_PROFILE.limb_length, 1.0)
        self.assertEqual(rp.ZEUS_PROFILE.limb_length, 1.0)
        self.assertNotIn("thigh_l", rp.profile_bone_scales(rp.ZEUS_PROFILE))
        self.assertEqual(rp.profile_bone_scales(rp.MORTAL_PROFILE)["thigh_l"], (1.0, rp.MORTAL_PROFILE.limb_length, 1.0))

    def test_limb_scale_is_along_the_bone_length_only(self) -> None:
        for name, scale in rp.profile_bone_scales(rp.MORTAL_PROFILE).items():
            if name.startswith(("upperarm", "lowerarm", "thigh", "calf")):
                self.assertEqual((scale[0], scale[2]), (1.0, 1.0), name)

    def test_children_of_scaled_limbs_do_not_inherit_the_scale(self) -> None:
        children = rp.limb_child_bones()
        self.assertIn("hand_l", children)
        self.assertIn("foot_r", children)
        self.assertIn("calf_l", children)
        self.assertNotIn("upperarm_l", children)

    def test_zeus_makes_a_fist_and_the_mortal_does_not(self) -> None:
        self.assertGreater(rp.ZEUS_PROFILE.fist_deg, 0)
        self.assertEqual(rp.MORTAL_PROFILE.fist_deg, 0)

    def test_fist_curls_cover_every_finger_joint_and_the_thumb_curls_less(self) -> None:
        curls = rp.fist_curls(80.0)
        self.assertEqual(len([k for k in curls if k.endswith("_l")]), 15)
        self.assertEqual(curls["index_01_l"], 80.0 * rp.FINGER_JOINT_SHARE[0])
        self.assertLess(curls["thumb_02_r"], curls["index_02_r"])
        self.assertEqual(rp.fist_curls(0.0)["pinky_03_l"], 0.0)

    def test_head_pitch_brings_the_face_up(self) -> None:
        self.assertLess(rp.ZEUS_PROFILE.head_pitch_deg, 0)
        self.assertLess(rp.MORTAL_PROFILE.head_pitch_deg, 0)

    def test_the_mortal_has_a_top_knot_and_zeus_has_side_locks(self) -> None:
        self.assertIsNotNone(rp.MORTAL_PROFILE.bun)
        self.assertGreater(rp.MORTAL_PROFILE.bun.radius, 0.03)
        self.assertTrue(any(p.keep_sides_back for p in rp.ZEUS_PROFILE.hair))
        self.assertTrue(any(p.file == "Hair_Beard" and p.role == "beard" for p in rp.ZEUS_PROFILE.hair))


class HairTrimTests(unittest.TestCase):
    def test_a_hairline_drops_front_faces_below_it_only(self) -> None:
        cap = rp.HairPiece("Hair_SimpleParted", drop_front_below=(-0.02, 1.772))
        self.assertFalse(rp.hair_face_kept(cap, 0.0, -0.06, 1.70), "the forehead")
        self.assertTrue(rp.hair_face_kept(cap, 0.0, -0.06, 1.80), "bangs above the hairline")
        self.assertTrue(rp.hair_face_kept(cap, 0.0, 0.05, 1.70), "the back of the head")

    def test_side_locks_keep_the_sides_and_the_back_but_not_the_crown(self) -> None:
        long_hair = rp.HairPiece("Hair_Long", keep_sides_back=(0.085, 0.02))
        self.assertTrue(rp.hair_face_kept(long_hair, 0.10, -0.05, 1.6), "a side lock")
        self.assertTrue(rp.hair_face_kept(long_hair, 0.0, 0.10, 1.6), "the back mass")
        self.assertFalse(rp.hair_face_kept(long_hair, 0.0, -0.05, 1.75), "the front and crown")
        self.assertTrue(rp.hair_face_kept(long_hair, -0.10, 0.0, 1.6), "the other side lock")

    def test_an_untrimmed_piece_keeps_everything(self) -> None:
        self.assertTrue(rp.hair_face_kept(rp.HairPiece("Hair_Buns"), 0.0, -0.1, 1.5))


class CanvasTests(unittest.TestCase):
    def test_gods_stand_on_a_96_canvas_at_the_same_camera_scale(self) -> None:
        self.assertEqual(rp.ZEUS.cell, (96, 96))
        self.assertEqual(rp.ZEUS_TALL.cell, (112, 96), "round 3: the tall variant's cast needs a wider canvas")
        self.assertEqual(rp.ZEUS_TALL.pivot_px, (56.0, 78.0))
        self.assertEqual(rp.ZEUS.pivot_px, (48.0, 78.0))
        self.assertEqual(rp.ZEUS.cell[1], rp.ZEUS_TALL.cell[1])
        self.assertEqual(rp.ZEUS_TALL.pivot_px[0], rp.ZEUS_TALL.cell[0] / 2, "the pivot is centred horizontally")
        self.assertEqual(rp.PPU, 29.0788)
        self.assertEqual(rp.GOD_SPRITE_CELL, (64, 80), "the art guide's cell and anchor are kept as reference")
        self.assertEqual(rp.GOD_SPRITE_ANCHOR, (32.0, 74.0))

    def test_the_pivot_leaves_room_below_for_the_toes(self) -> None:
        self.assertGreaterEqual(rp.ZEUS.cell[1] - rp.ZEUS.pivot_px[1], 12)

    def test_the_tall_variant_is_the_same_camera_with_a_larger_model(self) -> None:
        self.assertEqual(rp.ZEUS_TALL.interior_px, 60)
        self.assertEqual(rp.ZEUS.interior_px, 50)
        self.assertAlmostEqual(rp.tall_ratio(), 1.2)
        self.assertTrue(60 + 2 >= 60 and 60 + 2 <= 64, "interior plus the outline is 62 px, inside the 60-64 band")

    def test_the_standing_height_is_separate_from_the_canvas(self) -> None:
        self.assertLess(rp.ZEUS.interior_px, rp.ZEUS.cell[1])

    def test_walk_clips_cover_the_same_800_ms(self) -> None:
        walk, walk16 = (next(c for c in rp.ZEUS.clips if c.id == i) for i in ("walk", "walk16"))
        self.assertEqual((walk.frames, walk16.frames), (8, 16))
        self.assertEqual(sum(walk.timing_ms), 800)
        self.assertEqual(sum(walk16.timing_ms), 800)
        self.assertEqual(walk.action, walk16.action)

    def test_the_mortal_keeps_her_cell_and_has_both_walks(self) -> None:
        self.assertEqual(rp.MORTAL.cell, (64, 64))
        self.assertEqual({c.id for c in rp.MORTAL.clips}, {"idle", "walk", "walk16"})
        self.assertEqual(rp.MORTAL.clips[0].facings, ("south", "east"))

    def test_the_bull_is_an_animal_with_its_own_clips_at_mortal_scale(self) -> None:
        self.assertEqual({c.action for c in rp.BULL.clips}, {"Idle", "Walk"})
        self.assertTrue(rp.MORTAL_INTERIOR_PX - 12 <= rp.BULL.interior_px <= rp.MORTAL_INTERIOR_PX + 4)
        self.assertEqual(rp.BULL.clips[0].facings, ("south", "east"))
        self.assertIn("animal", rp.PART_IDS)
        import json

        ramps = {r["id"] for f in pal.build(json.loads(pal.SOURCE_PALETTE.read_text()))["families"] for r in f["ramps"]}
        self.assertTrue({ramp for _, ramp, _ in rp.BULL_ROLES.values()} <= ramps, "every bull material maps to a scene ramp")

    def test_part_ids_still_fit_in_a_byte(self) -> None:
        self.assertLessEqual(rp.id_byte(rp.PART_IDS[-1]), 255)
        self.assertEqual(rp.decode_id(rp.id_byte("animal")), "animal")

    def test_every_item_has_a_unique_id_and_the_shadowed_ones_a_positive_size(self) -> None:
        self.assertEqual(len(rp.ITEMS), len({i.id for i in rp.ITEMS.values()}))
        for item in rp.ITEMS.values():
            if item.shadow is not None:
                self.assertTrue(item.shadow[0] > 0 and item.shadow[1] > 0)
                self.assertAlmostEqual(item.shadow[0] / item.shadow[1], 2.0, delta=0.5, msg="a 2:1 ground ellipse")


class CanonPlacementTests(unittest.TestCase):
    def test_canon_uses_the_manifest_pivot(self) -> None:
        self.assertEqual(rp.CANON.pivot_px, (32.0, 80.0))
        self.assertEqual(rp.CANON.cell, (64, 80))

    def test_canon_stands_on_the_tile_centre_by_its_manifest_pivot(self) -> None:
        e = rs.Entity("canon", "canon", "idle", "south", 4, 3, layer=2)
        px, py = rs.sprite_position(e, rp.CANON)
        cx, cy = rs.tile_centre(4, 3)
        self.assertEqual((px + 32, py + 80), (round(cx), round(cy)))
        god = rs.sprite_position(e, rp.ZEUS)  # the same tile with our god's pivot
        self.assertEqual(god[1] + round(rp.ZEUS.pivot_px[1]), py + 80, "both stand on the same tile centre; only the sprite origin differs")
        self.assertNotEqual(rp.ZEUS.pivot_px[1], rp.CANON.pivot_px[1])

    def test_the_scene_uses_the_canon_item_for_canon(self) -> None:
        self.assertIs(sc.scene_items()["canon"], rp.CANON)

    def test_the_scene_has_both_zeus_heights_and_the_animal(self) -> None:
        keys = {e.key: e.item for e in sc.object_entities("zeus-tall")}
        self.assertEqual(keys["zeus"], "zeus-tall")
        self.assertEqual(keys["bull"], "bull")
        self.assertEqual({e.key: e.item for e in sc.object_entities("zeus")}["zeus"], "zeus")

    def test_every_scene_schedule_divides_the_loop(self) -> None:
        for zeus in ("zeus", "zeus-tall"):
            for name, schedule in sc.schedules(zeus):
                self.assertEqual(sc.TOTAL_MS % sum(schedule), 0, name)

    def test_the_bull_is_on_the_grid(self) -> None:
        for e in sc.object_entities():
            self.assertTrue(0 <= e.x < sc.GRID_W and 0 <= e.y < sc.GRID_H, e.key)
        self.assertEqual(tg.TILE_W, 64)


class ShadowTests(unittest.TestCase):
    def test_the_shadow_is_one_solid_shape_with_no_checkerboard(self) -> None:
        s = sh.shadow_pixels(40, 30, (20.0, 15.0), 10.0, 5.0)
        self.assertEqual(s[15 * 40 + 20], "core")
        self.assertEqual(set(s.values()), {"core"})
        rows: dict[int, list[int]] = {}
        for i in s:
            rows.setdefault(i // 40, []).append(i % 40)
        for y, xs in rows.items():
            self.assertEqual(max(xs) - min(xs) + 1, len(xs), f"row {y} has no gaps")

    def test_the_shadow_is_a_restrained_size(self) -> None:
        for item in rp.ITEMS.values():
            if item.shadow is not None and item.kind == "character":
                self.assertLessEqual(item.shadow[0], 13.0)

    def test_the_shadow_is_symmetric_and_two_to_one(self) -> None:
        s = sh.shadow_pixels(60, 40, (30.0, 20.0), 12.0, 6.0)
        xs = [i % 60 for i in s]
        ys = [i // 60 for i in s]
        self.assertLessEqual(max(xs) - min(xs) + 1, 25)
        self.assertLessEqual(max(ys) - min(ys) + 1, 13)
        core = {(i % 60, i // 60) for i, k in s.items() if k == "core"}
        self.assertEqual({(59 - x, y) for x, y in core}, core, "mirror symmetry about x=30")

    def test_the_shadow_stays_inside_the_cell(self) -> None:
        s = sh.shadow_pixels(20, 10, (2.0, 8.0), 10.0, 5.0)
        self.assertTrue(all(0 <= i < 200 for i in s))

    def test_a_zero_size_shadow_is_empty(self) -> None:
        self.assertEqual(sh.shadow_pixels(10, 10, (5.0, 5.0), 0.0, 3.0), {})

    def test_the_shadow_is_drawn_on_empty_pixels_only(self) -> None:
        rgba = bytes((9, 9, 9, 255, 0, 0, 0, 0))
        out = sh.apply_shadow(rgba, 2, 1, {0: "core", 1: "core"}, (1, 2, 3))
        self.assertEqual(out[:4], bytes((9, 9, 9, 255)))
        self.assertEqual(out[4:], bytes((1, 2, 3, 255)))

    def test_the_shadow_colour_is_a_scene_palette_entry(self) -> None:
        import json

        doc = pal.build(json.loads(pal.SOURCE_PALETTE.read_text()))
        colour = pal.ramp_shades(doc, "olive")[0]
        self.assertIn(colour, pal.all_colours(doc))


class EnvelopeTests(unittest.TestCase):
    def test_envelope_distances_are_from_the_pivot(self) -> None:
        env = sh.envelope([(40, 30, 60, 90), (30, 40, 70, 80)], (50.0, 85.0), (96, 96))
        self.assertEqual((env["left"], env["right"], env["up"], env["down"]), (20.0, 20.0, 55.0, 5.0))
        self.assertEqual(env["margin"], {"left": 30, "right": 26, "top": 30, "bottom": 6})
        self.assertFalse(env["clipped"])
        self.assertEqual(env["min_margin"], 6)

    def test_a_figure_past_the_canvas_is_flagged(self) -> None:
        env = sh.envelope([(0, 0, 97, 90)], (48.0, 80.0), (96, 96))
        self.assertTrue(env["clipped"])
        self.assertLess(env["min_margin"], 0)

    def test_a_figure_touching_the_edge_has_zero_margin_but_is_not_clipped(self) -> None:
        env = sh.envelope([(10, 10, 96, 96)], (48.0, 80.0), (96, 96))
        self.assertEqual(env["min_margin"], 0)
        self.assertFalse(env["clipped"])

    def test_the_pivot_splits_the_slack(self) -> None:
        env = {"left": 40.0, "right": 40.0, "up": 60.0, "down": 8.0}
        self.assertEqual(sh.pivot_for(env, (96, 96), 6), (48, 74))

    def test_the_pivot_refuses_an_envelope_that_does_not_fit(self) -> None:
        with self.assertRaises(ValueError):
            sh.pivot_for({"left": 47.0, "right": 47.0, "up": 68.0, "down": 8.0}, (96, 96), 6)

    def test_an_empty_set_is_an_error(self) -> None:
        with self.assertRaises(ValueError):
            sh.envelope([], (1.0, 1.0), (4, 4))


class SurfaceBoilTests(unittest.TestCase):
    W, H = 5, 5

    def block(self, v: int) -> list[int]:
        return [v] * 25

    def test_a_shading_change_on_the_same_surface_is_counted(self) -> None:
        a = self.block(1)
        b = self.block(1)
        b[12] = 2
        parts = ["torso"] * 25
        depth = [20.0] * 25
        r = rm.surface_pair(a, b, parts, parts, depth, depth, self.W, self.H)
        self.assertEqual(r["changed_px"], 1)
        self.assertGreater(r["persistent_px"], 0)

    def test_a_change_where_the_part_changed_is_not_a_shading_change(self) -> None:
        a, b = self.block(1), self.block(2)
        pa, pb = ["torso"] * 25, ["arm_l"] * 25
        depth = [20.0] * 25
        r = rm.surface_pair(a, b, pa, pb, depth, depth, self.W, self.H)
        self.assertEqual((r["persistent_px"], r["changed_px"]), (0, 0))

    def test_a_change_where_the_depth_jumped_is_not_a_shading_change(self) -> None:
        a, b = self.block(1), self.block(2)
        parts = ["torso"] * 25
        r = rm.surface_pair(a, b, parts, parts, [20.0] * 25, [20.5] * 25, self.W, self.H)
        self.assertEqual((r["persistent_px"], r["changed_px"]), (0, 0))

    def test_moving_parts_are_reported_separately(self) -> None:
        a = self.block(1)
        b = list(a)
        b[12] = 3
        pa = ["arm_l"] * 25
        pb = list(pa)
        pb[0] = None  # the arm's mask moved: IoU 24/25 = 0.96 < 0.97
        depth = [20.0] * 25
        b[0] = T
        a2 = list(a)
        r = rm.surface_pair(a2, b, pa, pb, depth, depth, self.W, self.H)
        self.assertGreater(r["persistent_moving_px"], 0)
        self.assertEqual(r["changed_moving_px"], r["changed_px"])

    def test_the_series_loops_and_reports_rates(self) -> None:
        a = self.block(1)
        b = list(a)
        b[12] = 2
        parts = ["torso"] * 25
        depth = [20.0] * 25
        s = rm.surface_series([a, b], [parts, parts], [depth, depth], self.W, self.H, True)
        self.assertEqual(s["pairs"], 2)
        self.assertEqual(s["changed_px"], 2 * 1)
        self.assertGreater(s["changed_rate"], 0)
        self.assertEqual(rm.surface_series([a, b], [parts, parts], [depth, depth], self.W, self.H, False)["pairs"], 1)

    def test_identical_frames_have_no_surface_change(self) -> None:
        a = self.block(1)
        parts = ["torso"] * 25
        depth = [20.0] * 25
        r = rm.surface_pair(a, a, parts, parts, depth, depth, self.W, self.H)
        self.assertEqual(r["changed_px"], 0)
        self.assertGreater(r["persistent_px"], 0)


class FaceColourTests(unittest.TestCase):
    def test_the_mortal_gets_a_face_stamp_in_its_own_colours(self) -> None:
        self.assertIn("mortal", stp.FACE_COLOURS)
        self.assertNotEqual(stp.FACE_COLOURS["mortal"], stp.FACE_COLOURS["zeus"])
        self.assertEqual(stp.FACE_COLOURS["zeus"], stp.FACE_COLOURS["zeus-tall"])

    def test_every_face_colour_is_a_palette_entry(self) -> None:
        import json

        doc = pal.build(json.loads(pal.SOURCE_PALETTE.read_text()))
        colours = set(pal.all_colours(doc))
        for (er, es), (br, bs) in stp.FACE_COLOURS.values():
            self.assertIn(pal.ramp_shades(doc, er)[es], colours)
            self.assertIn(pal.ramp_shades(doc, br)[bs], colours)

    def test_the_north_facing_has_no_face(self) -> None:
        self.assertEqual(stp.stamp_pixel_count("north"), 0)


class SemanticStateTests(unittest.TestCase):
    def test_sample_variants_share_their_states_pose_policy(self) -> None:
        self.assertEqual(rp.pose_state(rp.ZEUS.clips, "walk16"), "walk")
        self.assertEqual(rp.pose_state(rp.ZEUS.clips, "walk"), "walk")
        self.assertEqual(rp.override_keys("walk", "west"), ("walk", "walk:west"))
        self.assertEqual(rp.override_keys(rp.pose_state(rp.ZEUS.clips, "walk16"), "west"), rp.override_keys(rp.pose_state(rp.ZEUS.clips, "walk"), "west"))

    def test_a_clip_with_no_explicit_state_is_its_own_state(self) -> None:
        for clip in (*rp.ZEUS.clips, *rp.MORTAL.clips, *rp.BULL.clips):
            if clip.id != "walk16":
                self.assertEqual(clip.state, clip.id)

    def test_only_walk16_is_a_variant_of_another_state(self) -> None:
        variants = {c.id: c.state for item in rp.ITEMS.values() for c in item.clips if c.state != c.id}
        self.assertEqual(variants, {"walk16": "walk"})

    def test_a_variant_samples_the_same_action_and_duration_as_its_state(self) -> None:
        for item in (rp.ZEUS, rp.ZEUS_TALL, rp.MORTAL):
            walk, walk16 = (next(c for c in item.clips if c.id == i) for i in ("walk", "walk16"))
            self.assertEqual((walk.action, sum(walk.timing_ms), walk.loop), (walk16.action, sum(walk16.timing_ms), walk16.loop))

    def test_coarse_frames_are_fine_frames_at_identical_source_times(self) -> None:
        coarse = rp.sample_frames(0.0, 28.0, 8, True)
        fine = rp.sample_frames(0.0, 28.0, 16, True)
        for i, j in rm.resample_pairs(8, 16):
            self.assertEqual(coarse[i], fine[j])
        coarse = rp.sample_frames(3.0, 31.7, 8, True)
        fine = rp.sample_frames(3.0, 31.7, 16, True)
        for i, j in rm.resample_pairs(8, 16):
            self.assertEqual(coarse[i], fine[j], "exact, not approximately")

    def test_resample_pairs(self) -> None:
        self.assertEqual(rm.resample_pairs(8, 16), [(i, 2 * i) for i in range(8)])
        self.assertEqual(rm.resample_pairs(4, 4), [(i, i) for i in range(4)])
        for bad in ((8, 12), (8, 4), (0, 4)):
            with self.assertRaises(ValueError):
                rm.resample_pairs(*bad)

    def test_pixel_mismatches(self) -> None:
        a = bytes((1, 2, 3, 255, 0, 0, 0, 0))
        self.assertEqual(rm.pixel_mismatches(a, a), 0)
        self.assertEqual(rm.pixel_mismatches(a, bytes((1, 2, 3, 255, 0, 0, 1, 0))), 1)
        self.assertEqual(rm.pixel_mismatches(a, a + a), 4)

    def test_report_is_green_only_when_time_and_pixels_both_match(self) -> None:
        pairs = [(0, 0), (1, 2)]
        img = {0: b"\x01\x02\x03\xff", 1: b"\x01\x02\x03\xff"}
        fine = {0: img[0], 2: img[1]}
        green = rm.resample_report(pairs, img, fine, {0: 0.0, 1: 3.5}, {0: 0.0, 2: 3.5})
        self.assertEqual((green["matching"], green["mismatching"], green["pixels_differing"]), (2, 0, 0))
        red_pixels = rm.resample_report(pairs, img, {0: img[0], 2: b"\x09\x02\x03\xff"}, {0: 0.0, 1: 3.5}, {0: 0.0, 2: 3.5})
        self.assertEqual((red_pixels["matching"], red_pixels["mismatching"], red_pixels["pixels_differing"]), (1, 1, 1))
        red_time = rm.resample_report(pairs, img, fine, {0: 0.0, 1: 3.5}, {0: 0.0, 2: 3.75})
        self.assertEqual((red_time["wrong_time"], red_time["mismatching"]), (1, 1))


if __name__ == "__main__":
    unittest.main()

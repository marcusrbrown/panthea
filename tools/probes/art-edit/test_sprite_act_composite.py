"""Rules for the act composite (`sprite_act_composite.py`). They pin what a set of act frames may and may not do.

Most tests use a small synthetic idle with an attached arm, so each rule has a case that breaks it; the last class runs
the same machinery on the real C2c frame (gitignored scratch) and skips when it is absent.
"""

from __future__ import annotations

import contextlib
import copy
import io
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pipeline import Raster, decode_png
from sprite_act_composite import (
    PROTECTED_ROWS,
    SLOT,
    NeedsRulings,
    SpecError,
    build_frame,
    build_frames,
    changed_pixels,
    cross_frame_problems,
    duration_problems,
    frame_spec,
    gif_bytes,
    gif_delay_cs,
    hcat,
    kept_of,
    load_act_spec,
    main,
)
from sprite_cleanup_c2b import rgb
from sprite_seated_composite import IDLE_FRAME0, opaque_cells
from test_sprite_seated_composite import C0, C1, C2, G0, G2, block, colour, raster

ARM = (42, 34, 47, 52)  # the idle arm of the synthetic figure, apart from the body
REGION = [40, 10, 60, 60]
DURATIONS = [85, 100, 100, 85, 85, 85]


def hexed(c) -> str:
    return "#%02x%02x%02x" % tuple(c)


def idle_arm() -> Raster:
    """A tiny idle: head, body, an arm attached on the right, two gold feet on row 79 (midpoint x=32). Five colours."""
    pixels = {}
    pixels.update(block(26, 20, 37, 31, C2, C0))
    pixels.update(block(24, 32, 39, 73, C2, C0))
    pixels[(28, 24)] = C1
    pixels[(25, 40)] = C1
    pixels.update(block(24, 74, 29, 79, G2, G0))
    pixels.update(block(34, 74, 39, 79, G2, G0))
    pixels.update(block(*ARM, C1, C0))
    return raster(pixels)


def arm(x0: int, y0: int, x1: int, y1: int, fill=C1, edge=C0) -> list[list]:
    """A boxed arm as patches: edge colour on the border, fill inside."""
    return [
        [x, y, hexed(edge if x in (x0, x1) or y in (y0, y1) else fill)]
        for y in range(y0, y1 + 1)
        for x in range(x0, x1 + 1)
    ]


def good_spec() -> dict:
    return {
        "schema": 1,
        "slot": SLOT,
        "keep": {"rows": [0, 79], "exclude_boxes": [list(ARM)]},
        "regions": [REGION],
        "frames": [
            {"name": "up", "patches": arm(42, 22, 47, 40), "budget": {"new_pixels": 200}},
            {"name": "back", "patches": arm(42, 12, 47, 30), "budget": {"new_pixels": 200}},
            {"name": "out", "patches": arm(42, 34, 47, 52), "budget": {"new_pixels": 200}},
            {"name": "rest", "identical_to_idle": True},
        ],
    }


def settled(spec: dict | None = None, idle: Raster | None = None, reference: Raster | None = None) -> dict:
    """The spec with each ruling the outline rules ask for added, as the reviewer does with `NeedsRulings`."""
    spec = copy.deepcopy(spec or good_spec())
    idle = idle or idle_arm()
    for _ in range(40):
        try:
            build_frames(idle, spec, reference)
            return spec
        except NeedsRulings as error:
            frame = spec["frames"][error.frame]  # type: ignore[attr-defined]
            frame.setdefault("rulings", [])
            frame["rulings"] += [[x, y, hexed(C0)] for x, y in error.pixels if [x, y] not in [r[:2] for r in frame["rulings"]]]
            frame["budget"]["rulings"] = len(frame["rulings"])
    raise AssertionError("rulings did not settle")


def build_good() -> tuple[list[Raster], list[dict]]:
    return build_frames(idle_arm(), settled())


class SpecIsChecked(unittest.TestCase):
    def refused(self, spec: dict) -> None:
        with self.assertRaises(SpecError):
            load_act_spec(spec)

    def test_unknown_keys_a_wrong_schema_and_a_wrong_slot_are_refused(self) -> None:
        self.refused({**good_spec(), "extra": 1})
        self.refused({**good_spec(), "schema": 2})
        self.refused({**good_spec(), "slot": "act/south/pronouncement"})
        load_act_spec({**good_spec(), "slot": SLOT})

    def test_four_to_six_frames_are_required(self) -> None:
        frames = good_spec()["frames"]
        for count in (3, 7):
            self.refused({**good_spec(), "frames": (frames * 2)[:count]})
        for count in (4, 5, 6):
            load_act_spec({**good_spec(), "frames": (frames * 2)[:count]})

    def test_regions_and_keep_are_required_and_boxes_must_be_boxes(self) -> None:
        for key in ("regions", "keep"):
            spec = good_spec()
            del spec[key]
            self.refused(spec)
        self.refused({**good_spec(), "regions": []})
        self.refused({**good_spec(), "regions": [[10, 10, 5, 5]]})
        self.refused({**good_spec(), "regions": [[0, 0, 64, 10]]})
        self.refused({**good_spec(), "keep": {"rows": [0, 79], "exclude_boxes": [[3, 3, 1, 1]]}})
        self.refused({**good_spec(), "keep": {"rows": [0, 79], "stray": 1}})

    def test_a_frame_needs_a_budget_unless_it_is_idle_and_idle_takes_nothing_else(self) -> None:
        spec = good_spec()
        del spec["frames"][0]["budget"]
        self.refused(spec)
        for extra in ({"patches": []}, {"adopt": []}, {"rulings": []}, {"budget": {"new_pixels": 1}}):
            spec = good_spec()
            spec["frames"][3].update(extra)
            self.refused(spec)
        spec = good_spec()
        spec["frames"][0]["extra"] = 1
        self.refused(spec)
        spec = good_spec()
        spec["frames"][0]["identical_to_idle"] = "yes"
        self.refused(spec)


class TheKeptRegionIsShared(unittest.TestCase):
    def test_the_arm_box_is_cut_out_and_the_rest_of_idle_is_kept(self) -> None:
        idle = idle_arm()
        kept = kept_of(idle, good_spec())
        arm_cells = {(x, y) for x in range(ARM[0], ARM[2] + 1) for y in range(ARM[1], ARM[3] + 1)}
        self.assertFalse(kept & arm_cells)
        self.assertEqual(kept, opaque_cells(idle) - arm_cells)

    def test_the_shared_keep_reaches_every_frame_spec_with_dy_zero(self) -> None:
        idle = idle_arm()
        for index in range(3):
            projected = frame_spec(idle, good_spec(), index)
            self.assertEqual(projected["dy"], 0)
            self.assertEqual(projected["regions"], [REGION])
            self.assertEqual(projected["keep"]["rows"], [0, 79])
            self.assertIn([ARM[0], ARM[1]], projected["keep"]["exclude"])

    def test_dropping_body_pixels_outside_every_region_is_refused(self) -> None:
        spec = good_spec()
        spec["keep"] = {"rows": [0, 60], "exclude_boxes": [list(ARM)]}  # the feet on rows 74-79 are not kept
        with self.assertRaisesRegex(SpecError, "neither kept nor inside a region"):
            kept_of(idle_arm(), spec)
        with self.assertRaisesRegex(SpecError, "neither kept nor inside a region"):
            build_frame(idle_arm(), spec, 0)

    def test_cutting_a_box_that_is_not_in_a_region_is_refused(self) -> None:
        spec = good_spec()
        spec["keep"]["exclude_boxes"] = [[20, 34, 45, 52]]  # takes body pixels the region does not cover
        with self.assertRaisesRegex(SpecError, "neither kept nor inside a region"):
            kept_of(idle_arm(), spec)


class FramesFollowTheRules(unittest.TestCase):
    def test_the_good_spec_builds_every_frame_and_the_body_is_idle(self) -> None:
        frames, reports = build_good()
        idle = idle_arm()
        self.assertEqual(len(frames), 4)
        body = opaque_cells(idle) - {(x, y) for x in range(ARM[0], ARM[2] + 1) for y in range(ARM[1], ARM[3] + 1)}
        for frame in frames:
            for p in body:
                self.assertEqual(colour(frame, p), colour(idle, p), p)
        self.assertEqual([r["identical_to_idle"] for r in reports], [False, False, False, True])

    def test_each_frame_has_its_own_arm(self) -> None:
        frames, _ = build_good()
        self.assertIsNotNone(colour(frames[0], (44, 25)))
        self.assertIsNone(colour(frames[0], (44, 45)))
        self.assertIsNotNone(colour(frames[1], (44, 15)))
        self.assertIsNone(colour(frames[1], (44, 35)))
        self.assertEqual(frames[2].rgba, idle_arm().rgba)

    def test_a_pixel_outside_the_regions_is_refused(self) -> None:
        spec = settled()
        spec["frames"][0]["patches"].append([5, 5, hexed(C0)])
        with self.assertRaisesRegex(SpecError, "outside the declared regions"):
            build_frames(idle_arm(), spec)

    def test_a_pixel_on_a_kept_pixel_is_refused(self) -> None:
        spec = settled()
        spec["regions"] = [[24, 10, 60, 60]]  # now a region reaches the body
        spec["frames"][0]["patches"].append([30, 40, hexed(C1)])
        with self.assertRaisesRegex(SpecError, "lies on a kept pixel"):
            build_frames(idle_arm(), spec)

    def test_a_frame_over_its_budget_is_refused_and_the_ceiling_itself_passes(self) -> None:
        spec = settled()
        count = len(spec["frames"][0]["patches"])
        spec["frames"][0]["budget"]["new_pixels"] = count
        build_frames(idle_arm(), spec)
        spec["frames"][0]["budget"]["new_pixels"] = count - 1
        with self.assertRaisesRegex(SpecError, r"frames\[0\] \(up\).*new_pixels"):
            build_frames(idle_arm(), spec)

    def test_budgets_are_per_frame(self) -> None:
        spec = settled()
        spec["frames"][1]["budget"]["new_pixels"] = 1
        with self.assertRaisesRegex(SpecError, r"frames\[1\] \(back\)"):
            build_frames(idle_arm(), spec)

    def test_a_colour_idle_does_not_use_is_refused(self) -> None:
        spec = settled()
        spec["frames"][0]["patches"][0] = [40, 22, "#ff00ff"]
        with self.assertRaisesRegex(SpecError, "not one of idle's colours"):
            build_frames(idle_arm(), spec)

    def test_outline_rules_apply_to_the_new_pixels(self) -> None:
        spec = settled()
        # a patch that puts the fill colour on the arm's outer edge: the outline rule makes it the darkest shade
        spec["frames"][0]["patches"] = [q if q[:2] != [44, 22] else [44, 22, hexed(C1)] for q in spec["frames"][0]["patches"]]
        frames, _ = build_frames(idle_arm(), spec)
        self.assertEqual(colour(frames[0], (44, 22)), tuple(C0))

    def test_a_ruling_wins_over_the_outline_rules(self) -> None:
        spec = settled()
        spec["frames"][0]["patches"] = [q if q[:2] != [44, 22] else [44, 22, hexed(C1)] for q in spec["frames"][0]["patches"]]
        spec["frames"][0]["rulings"].append([44, 22, hexed(C1)])
        spec["frames"][0]["budget"]["rulings"] += 1
        frames, _ = build_frames(idle_arm(), spec)
        self.assertEqual(colour(frames[0], (44, 22)), tuple(C1))

    def test_pixels_the_outline_rules_cannot_decide_name_their_frame(self) -> None:
        with self.assertRaises(NeedsRulings) as caught:
            build_frames(idle_arm(), good_spec())
        self.assertEqual(caught.exception.frame, 0)  # type: ignore[attr-defined]
        self.assertIn((42, 22), caught.exception.pixels)

    def test_a_ruling_must_sit_on_a_new_pixel(self) -> None:
        spec = settled()
        spec["frames"][0]["rulings"].append([50, 50, hexed(C0)])
        spec["frames"][0]["budget"]["rulings"] += 1
        with self.assertRaisesRegex(SpecError, "ruling at"):
            build_frames(idle_arm(), spec)

    def test_the_feet_rule_holds_in_every_frame(self) -> None:
        spec = settled()
        spec["keep"] = {"rows": [0, 79], "exclude_boxes": [list(ARM), [24, 74, 39, 79]]}
        spec["regions"] = [REGION, [24, 74, 39, 79]]  # the feet may be redrawn, and frame 0 does not
        with self.assertRaisesRegex(ValueError, r"(?s)frames\[0\].*lowest opaque row"):
            build_frames(idle_arm(), spec)

    def test_the_arm_may_not_move_the_feet_midpoint(self) -> None:
        spec = settled()
        spec["regions"] = [REGION, [24, 74, 47, 79]]
        spec["frames"][0]["patches"] += arm(42, 74, 47, 79, G2, G0)  # a third foot on the lowest row
        spec["frames"][0]["budget"]["new_pixels"] = 400
        with self.assertRaises((ValueError, SpecError)):
            build_frames(idle_arm(), spec)


class FramesAdoptFromTheReference(unittest.TestCase):
    def reference(self) -> Raster:
        pixels = block(10, 5, 15, 25, (208, 224, 222), (99, 123, 137))  # off-palette arm, not idle's colours
        return raster(pixels)

    def adopting_spec(self) -> dict:
        spec = good_spec()
        spec["frames"][0] = {
            "name": "adopted",
            "adopt": [{"box": [10, 5, 15, 25], "dx": 32, "dy": 15}],
            "budget": {"new_pixels": 200, "adopted": 200},
        }
        return spec

    def test_an_adopting_frame_needs_the_reference(self) -> None:
        with self.assertRaisesRegex(SpecError, "needs the reference cell"):
            build_frame(idle_arm(), self.adopting_spec(), 0)

    def test_adopted_pixels_move_by_dx_dy_and_are_snapped_to_idles_colours(self) -> None:
        spec = settled(self.adopting_spec(), reference=self.reference())
        frames, reports = build_frames(idle_arm(), spec, self.reference())
        self.assertEqual(reports[0]["adopted_pixels"], 6 * 21 - len(spec["frames"][0].get("patches", [])))
        for x in range(42, 48):
            for y in range(20, 41):
                self.assertIn(tuple(frames[0].pixel(x, y)[:3]), {tuple(C0), tuple(C1), tuple(C2), tuple(G0), tuple(G2)})
        self.assertEqual(colour(frames[0], (44, 30)), tuple(C2))  # (208, 224, 222) snaps to idle's C2

    def test_the_adopted_ceiling_is_held(self) -> None:
        spec = settled(self.adopting_spec(), reference=self.reference())
        spec["frames"][0]["budget"]["adopted"] = 10
        with self.assertRaisesRegex(SpecError, "adopted"):
            build_frames(idle_arm(), spec, self.reference())


class IdenticalFramesAndCrossFrameRules(unittest.TestCase):
    def test_an_identical_frame_is_idle_byte_for_byte(self) -> None:
        frames, _ = build_good()
        self.assertEqual(frames[3].rgba, idle_arm().rgba)
        self.assertEqual(cross_frame_problems(frames, idle_arm(), settled()), [])

    def test_an_identical_frame_that_drifted_is_reported(self) -> None:
        frames, _ = build_good()
        data = bytearray(frames[3].rgba)
        data[(5 * 64 + 5) * 4 : (5 * 64 + 5) * 4 + 4] = bytes((1, 2, 3, 255))
        frames[3] = Raster(64, 80, bytes(data))
        problems = cross_frame_problems(frames, idle_arm(), settled())
        self.assertTrue(any("declared identical_to_idle" in p for p in problems), problems)

    def test_a_body_pixel_that_changed_in_a_frame_is_reported(self) -> None:
        frames, _ = build_good()
        data = bytearray(frames[0].rgba)
        data[(40 * 64 + 30) * 4 : (40 * 64 + 30) * 4 + 3] = bytes(C0)
        frames[0] = Raster(64, 80, bytes(data))
        problems = cross_frame_problems(frames, idle_arm(), settled())
        self.assertTrue(any("frame 0" in p and "(30, 40)" in p and "another colour" in p for p in problems), problems)

    def test_a_pixel_drawn_or_missing_outside_the_regions_is_reported(self) -> None:
        frames, _ = build_good()
        drawn = bytearray(frames[1].rgba)
        drawn[(2 * 64 + 2) * 4 : (2 * 64 + 2) * 4 + 4] = bytes((*C0, 255))
        frames[1] = Raster(64, 80, bytes(drawn))
        missing = bytearray(frames[2].rgba)
        missing[(40 * 64 + 30) * 4 + 3] = 0
        frames[2] = Raster(64, 80, bytes(missing))
        problems = cross_frame_problems(frames, idle_arm(), settled())
        self.assertTrue(any("frame 1" in p and "(2, 2)" in p and "drawn" in p for p in problems), problems)
        self.assertTrue(any("frame 2" in p and "(30, 40)" in p and "missing" in p for p in problems), problems)

    def test_changes_inside_the_regions_are_not_reported(self) -> None:
        frames, _ = build_good()
        self.assertGreater(changed_pixels(idle_arm(), frames[0]), 0)
        self.assertEqual(cross_frame_problems(frames, idle_arm(), settled()), [])

    def test_the_frame_count_must_match_the_spec(self) -> None:
        frames, _ = build_good()
        self.assertTrue(cross_frame_problems(frames[:3], idle_arm(), settled()))

    def test_a_wrong_sized_frame_is_reported(self) -> None:
        frames, _ = build_good()
        frames[0] = Raster(2, 2, bytes(16))
        self.assertTrue(any("is 2x2" in p for p in cross_frame_problems(frames, idle_arm(), settled())))


class OcclusionLetsAPatchOverwriteTheRobe(unittest.TestCase):
    """`occlude`: boxes where a frame's patches may overwrite kept idle pixels (an arm in front of the robe)."""

    BOX = [30, 50, 36, 56]  # inside the synthetic body's cloth, below the protected head-to-beard rows

    def spec(self, box=None, patch=(33, 53), colour_=C1, frame=0) -> dict:
        spec = settled()
        spec["frames"][frame]["occlude"] = [box or self.BOX]
        spec["frames"][frame]["patches"].append([patch[0], patch[1], hexed(colour_)])
        spec["frames"][frame]["budget"]["new_pixels"] += 1
        return spec

    def test_without_occlude_a_patch_on_the_robe_is_refused(self) -> None:
        spec = self.spec()
        del spec["frames"][0]["occlude"]
        with self.assertRaisesRegex(SpecError, "lies on a kept pixel"):
            build_frames(idle_arm(), spec)

    def test_inside_an_occlude_box_a_patch_overwrites_the_kept_pixel(self) -> None:
        frames, reports = build_frames(idle_arm(), self.spec())
        self.assertEqual(colour(idle_arm(), (33, 53)), tuple(C2))
        self.assertEqual(colour(frames[0], (33, 53)), tuple(C1))
        self.assertEqual(reports[0]["occluded_pixels"], 1)
        self.assertEqual(reports[1]["occluded_pixels"], 0)

    def test_the_rest_of_the_box_keeps_idles_own_pixels(self) -> None:
        frames, _ = build_frames(idle_arm(), self.spec())
        idle = idle_arm()
        for x in range(30, 37):
            for y in range(50, 57):
                if (x, y) != (33, 53):
                    self.assertEqual(colour(frames[0], (x, y)), colour(idle, (x, y)), (x, y))

    def test_a_patch_on_the_robe_outside_every_occlude_box_is_still_refused(self) -> None:
        with self.assertRaisesRegex(SpecError, "lies on a kept pixel"):
            build_frames(idle_arm(), self.spec(patch=(27, 60)))

    def test_occlusion_belongs_to_its_own_frame(self) -> None:
        spec = self.spec()
        spec["frames"][1]["patches"].append([33, 53, hexed(C1)])
        spec["frames"][1]["budget"]["new_pixels"] += 1
        with self.assertRaisesRegex(SpecError, r"frames\[1\].*lies on a kept pixel"):
            build_frames(idle_arm(), spec)

    def test_the_occluding_pixel_counts_against_the_budget(self) -> None:
        spec = self.spec()
        spec["frames"][0]["budget"]["new_pixels"] = len(spec["frames"][0]["patches"]) - 1
        with self.assertRaisesRegex(SpecError, "new_pixels"):
            build_frames(idle_arm(), spec)

    def test_a_box_touching_the_head_beard_or_shoulder_rows_is_refused(self) -> None:
        for y0, y1 in ((20, 30), (47, 60), (30, 47), (40, 41)):
            spec = self.spec(box=[30, y0, 36, y1])
            with self.assertRaisesRegex(SpecError, "protected rows"):
                load_act_spec(spec)

    def test_a_box_touching_the_feet_rows_is_refused(self) -> None:
        for y0, y1 in ((60, 76), (76, 79), (79, 79)):
            with self.assertRaisesRegex(SpecError, "protected rows"):
                load_act_spec(self.spec(box=[30, y0, 36, y1]))

    def test_boxes_between_the_protected_rows_are_accepted(self) -> None:
        load_act_spec(self.spec(box=[30, 48, 36, 75]))
        self.assertEqual(PROTECTED_ROWS, ((30, 47), (76, 79)))

    def test_an_identical_frame_takes_no_occlude(self) -> None:
        spec = good_spec()
        spec["frames"][3]["occlude"] = [self.BOX]
        with self.assertRaises(SpecError):
            load_act_spec(spec)

    def test_occlude_must_be_a_list_of_boxes(self) -> None:
        for bad in ("x", [[1, 2, 3]], [[40, 50, 30, 56]], [[0, 50, 64, 56]]):
            spec = good_spec()
            spec["frames"][0]["occlude"] = bad
            with self.assertRaises(SpecError):
                load_act_spec(spec)

    def test_cross_frame_allows_changes_inside_the_declared_occlude_only(self) -> None:
        spec = self.spec()
        frames, _ = build_frames(idle_arm(), spec)
        self.assertEqual(cross_frame_problems(frames, idle_arm(), spec), [])
        data = bytearray(frames[0].rgba)
        data[(60 * 64 + 27) * 4 : (60 * 64 + 27) * 4 + 3] = bytes(C0)  # robe pixel outside the box
        tampered = [Raster(64, 80, bytes(data)), *frames[1:]]
        problems = cross_frame_problems(tampered, idle_arm(), spec)
        self.assertTrue(any("(27, 60)" in p and "outside the regions" in p for p in problems), problems)

    def test_cross_frame_reports_an_unpatched_change_inside_the_box(self) -> None:
        spec = self.spec()
        frames, _ = build_frames(idle_arm(), spec)
        data = bytearray(frames[0].rgba)
        data[(52 * 64 + 31) * 4 : (52 * 64 + 31) * 4 + 3] = bytes(C0)
        problems = cross_frame_problems([Raster(64, 80, bytes(data)), *frames[1:]], idle_arm(), spec)
        self.assertTrue(any("(31, 52)" in p and "not patched" in p for p in problems), problems)

    def test_cross_frame_reports_a_pixel_erased_inside_the_box(self) -> None:
        spec = self.spec()
        frames, _ = build_frames(idle_arm(), spec)
        data = bytearray(frames[0].rgba)
        data[(52 * 64 + 31) * 4 + 3] = 0
        problems = cross_frame_problems([Raster(64, 80, bytes(data)), *frames[1:]], idle_arm(), spec)
        self.assertTrue(any("(31, 52)" in p and "erased" in p for p in problems), problems)


class DurationsAreChecked(unittest.TestCase):
    def test_the_owners_durations_pass(self) -> None:
        self.assertEqual(duration_problems(DURATIONS, 6), [])
        self.assertEqual(sum(DURATIONS), 540)

    def test_the_bounds_are_the_act_states_10_to_12_fps(self) -> None:
        self.assertEqual(duration_problems([83] * 4, 4), [])
        self.assertEqual(duration_problems([100] * 4, 4), [])
        self.assertTrue(duration_problems([82, 100, 100, 100], 4))
        self.assertTrue(duration_problems([101, 100, 100, 100], 4))

    def test_a_count_mismatch_and_non_integers_are_reported(self) -> None:
        self.assertTrue(duration_problems([85, 100], 4))
        self.assertTrue(duration_problems([85.0, 100, 100, 100], 4))  # type: ignore[list-item]
        self.assertTrue(duration_problems([True, 100, 100, 100], 4))  # type: ignore[list-item]


class PicturesAndSheet(unittest.TestCase):
    def test_the_gif_has_one_block_per_frame_with_half_up_centisecond_delays(self) -> None:
        frames, _ = build_good()
        data = gif_bytes(frames + frames[:2], DURATIONS)
        self.assertEqual(data[:6], b"GIF89a")
        self.assertEqual(struct.unpack("<HH", data[6:10]), (256, 320))
        blocks = [i for i in range(len(data) - 3) if data[i : i + 3] == b"\x21\xf9\x04"]
        self.assertEqual(len(blocks), 6)
        self.assertEqual([struct.unpack("<H", data[i + 4 : i + 6])[0] for i in blocks], [9, 10, 10, 9, 9, 9])
        self.assertEqual(data[-1:], b"\x3b")

    def test_85_ms_is_9_cs_in_the_preview(self) -> None:
        self.assertEqual([gif_delay_cs(ms) for ms in (83, 85, 100)], [8, 9, 10])

    def test_the_strip_beside_idle_has_idle_then_each_frame(self) -> None:
        frames, _ = build_good()
        strip = hcat([idle_arm(), *frames])
        self.assertEqual((strip.width, strip.height), (64 * 5 + 2 * 4, 80))


class CommandLine(unittest.TestCase):
    def run_main(self, spec: dict, durations: list[int]) -> tuple[int, Path]:
        tmp = Path(tempfile.mkdtemp())
        from pipeline import encode_png

        encode_png(idle_arm(), tmp / "idle.png")
        spec = settled(spec)
        (tmp / "spec.json").write_text(json.dumps(spec))
        argv = ["--spec", str(tmp / "spec.json"), "--idle", str(tmp / "idle.png"), "--durations", ",".join(map(str, durations)), "--out", str(tmp / "out")]
        with contextlib.redirect_stdout(io.StringIO()):
            return main(argv), tmp / "out"

    def test_it_writes_the_sheet_the_strips_the_gif_and_the_report(self) -> None:
        code, out = self.run_main(good_spec(), [85, 100, 100, 85])
        self.assertEqual(code, 0)
        for name in ("act-f0.png", "act-f3.png", "sheet.png", "sheet.json", "act-1x.png", "act-4x.png", "vs-idle-1x.png", "vs-idle-4x.png", "act.gif", "report-act.json"):
            self.assertTrue((out / name).exists(), name)
        sheet = decode_png(out / "sheet.png")
        self.assertEqual((sheet.width, sheet.height), (256, 80))
        meta = json.loads((out / "sheet.json").read_text())
        self.assertEqual([f["duration"] for f in meta["frames"]], [85, 100, 100, 85])
        self.assertEqual(meta["meta"]["frameTags"][0], {"name": SLOT, "from": 0, "to": 3, "direction": "forward"})
        self.assertEqual(meta["meta"]["slices"][0]["name"], f"pivot:{SLOT}")
        report = json.loads((out / "report-act.json").read_text())
        self.assertEqual(report["total_ms"], 370)
        self.assertEqual(report["gif_delays_cs"], [9, 10, 10, 9])
        self.assertEqual([f["changed_vs_idle"] > 0 for f in report["frames"]], [True, True, False, False])
        self.assertEqual(report["frames"][3]["identical_to_idle"], True)

    def test_durations_outside_the_bounds_are_refused_before_anything_is_written(self) -> None:
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            self.run_main(good_spec(), [85, 120, 100, 85])


@unittest.skipUnless(IDLE_FRAME0.exists(), "the real C2c frame is gitignored scratch")
class OnTheRealIdleFrame(unittest.TestCase):
    """The machinery on canon idle frame 0 (C2c): the body stays, an identical frame is exactly idle."""

    BOX = [10, 24, 50, 45]

    def setUp(self) -> None:
        self.idle = decode_png(IDLE_FRAME0)

    def round_trip_spec(self) -> dict:
        """Cut a box out of idle and adopt the same pixels back from idle itself, ruling every pixel the outline rules would
        otherwise recolour (C2c's ties, and the pixels its 2 px band thinning would change), as the reviewer would."""
        spec = {
            "schema": 1,
            "keep": {"rows": [0, 79], "exclude_boxes": [self.BOX]},
            "regions": [self.BOX],
            "frames": [
                {"adopt": [{"box": self.BOX}], "budget": {"new_pixels": 2000}, "rulings": []},
                {"identical_to_idle": True},
                {"adopt": [{"box": self.BOX}], "budget": {"new_pixels": 2000}, "rulings": []},
                {"adopt": [{"box": self.BOX}], "budget": {"new_pixels": 2000}, "rulings": []},
            ],
        }
        ruled: dict[tuple[int, int], list] = {}
        for _ in range(12):
            for index in (0, 2, 3):
                spec["frames"][index]["rulings"] = list(ruled.values())
            try:
                frames, _ = build_frames(self.idle, spec, self.idle)
            except NeedsRulings as error:
                ruled.update({p: [*p, hexed(self.idle.pixel(*p)[:3])] for p in error.pixels})
                continue
            wrong = [
                (x, y)
                for y in range(self.idle.height)
                for x in range(self.idle.width)
                if colour(frames[0], (x, y)) != colour(self.idle, (x, y)) and self.idle.pixel(x, y)[3]
            ]
            if not wrong:
                return spec
            ruled.update({p: [*p, hexed(self.idle.pixel(*p)[:3])] for p in wrong})
        raise AssertionError("rulings did not settle")

    def test_adopting_the_box_back_from_idle_itself_reproduces_idle(self) -> None:
        spec = self.round_trip_spec()
        frames, reports = build_frames(self.idle, spec, self.idle)
        for frame in frames:
            self.assertEqual(changed_pixels(self.idle, frame), 0)
        self.assertGreater(reports[0]["new_pixels"], 100)
        self.assertEqual(frames[1].rgba, self.idle.rgba)

    def test_a_changed_pixel_in_the_box_shows_and_the_body_does_not_move(self) -> None:
        spec = self.round_trip_spec()
        x, y = next(p for p in sorted(opaque_cells(self.idle)) if 12 <= p[0] <= 48 and 30 <= p[1] <= 44)
        spec["frames"][0]["patches"] = [[x, y, hexed(self.idle.pixel(x, y)[:3])]]
        frames, _ = build_frames(self.idle, spec, self.idle)
        self.assertEqual(cross_frame_problems(frames, self.idle, spec), [])

    def test_losing_the_feet_is_refused_on_the_real_frame(self) -> None:
        spec = self.round_trip_spec()
        spec["keep"] = {"rows": [0, 60], "exclude_boxes": [self.BOX]}
        with self.assertRaisesRegex(SpecError, "neither kept nor inside a region"):
            build_frames(self.idle, spec, self.idle)

    def test_the_real_frame_fails_the_cross_frame_rule_when_the_head_changes(self) -> None:
        spec = self.round_trip_spec()
        frames, _ = build_frames(self.idle, spec, self.idle)
        head = next(p for p in sorted(opaque_cells(self.idle), key=lambda p: (p[1], p[0])) if p[1] >= 50)
        data = bytearray(frames[0].rgba)
        at = (head[1] * 64 + head[0]) * 4
        data[at : at + 3] = bytes(rgb("#000000"))
        frames[0] = Raster(64, 80, bytes(data))
        self.assertTrue(cross_frame_problems(frames, self.idle, spec))


if __name__ == "__main__":
    unittest.main()

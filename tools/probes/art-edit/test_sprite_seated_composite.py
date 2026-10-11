"""Rules for the seated composite (`sprite_seated_composite.py`). They pin what a composite may and may not do, not a design.

Most tests use a small synthetic idle frame and seated cell so each rule has a case that breaks it; the last classes
run the same rules on the real C2c frame (gitignored scratch) and skip when it is absent.
"""

from __future__ import annotations

import contextlib
import copy
import io
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pipeline import Raster, decode_png
from sprite_cleanup_c2b import rgb
from sprite_idle_c2 import F2_CHEST_HOLD, REPAIRS, build as build_idle
from sprite_seated_composite import (
    IDLE_FRAME0,
    NeedsRulings,
    SpecError,
    build,
    build_with_report,
    changed_cells,
    colour_set,
    frame2,
    keep_cells,
    opaque_cells,
    rise_problems,
    sheet_json,
    sheet_png,
    verify,
)
from sprite_downscale import sole_clusters, sole_midpoint

C0, C1, C2 = rgb("#637b89"), rgb("#9fb5bf"), rgb("#d6e1df")
G0, G1, G2 = rgb("#76572f"), rgb("#b38b43"), rgb("#ddbf70")
Pixels = dict[tuple[int, int], tuple[int, ...]]


def raster(pixels: Pixels) -> Raster:
    data = bytearray(64 * 80 * 4)
    for (x, y), value in pixels.items():
        at = (y * 64 + x) * 4
        data[at : at + 4] = bytes((*value[:3], value[3] if len(value) == 4 else 255))
    return Raster(64, 80, bytes(data))


def block(x0: int, y0: int, x1: int, y1: int, fill, edge=None) -> Pixels:
    out: Pixels = {}
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            on_edge = x in (x0, x1) or y in (y0, y1)
            out[(x, y)] = edge if (edge is not None and on_edge) else fill
    return out


def idle_cell() -> Raster:
    """A tiny idle: a head, a body, two gold feet on row 79 with their midpoint at x=32. Five colours."""
    pixels: Pixels = {}
    pixels.update(block(26, 20, 37, 31, C2, C0))
    pixels.update(block(24, 32, 39, 73, C2, C0))
    pixels[(28, 24)] = C1
    pixels[(25, 40)] = C1
    pixels.update(block(24, 74, 29, 79, G2, G0))
    pixels.update(block(34, 74, 39, 79, G2, G0))
    return raster(pixels)


OFF_CLOTH = (208, 224, 222)  # snaps to C2
OFF_GOLD = (220, 190, 110)  # snaps to G2


def seated_cell(extra: Pixels | None = None) -> Raster:
    """The generated seated cell stand-in: a body block and two feet in colours that are not idle's, with no outline."""
    pixels: Pixels = {}
    pixels.update(block(24, 52, 39, 73, OFF_CLOTH))
    pixels.update(block(24, 74, 29, 79, OFF_GOLD))
    pixels.update(block(34, 74, 39, 79, OFF_GOLD))
    pixels.update(extra or {})
    return raster(pixels)


def corner_rulings() -> list[list]:
    """The pixels the outline rules cannot decide in the synthetic composite (C2c's table B kind): foot corners."""
    return [[x, y, "#76572f"] for x, y in ((24, 79), (29, 79), (34, 79), (39, 79), (29, 74), (34, 74))]


def good_spec() -> dict:
    return {
        "schema": 1,
        "dy": 6,
        "keep": {"rows": [20, 45]},
        "regions": [[20, 52, 50, 79]],
        "adopt": [{"box": [24, 52, 39, 79]}],
        "rulings": corner_rulings(),
        "budget": {"new_pixels": 500, "adopted": 500, "rulings": 12},
        "rise": {"rows": [26, 45], "left_column": 24},
    }


def built(seated: Raster | None = None, **over) -> Raster:
    spec = good_spec()
    spec.update(over)
    return build(seated or seated_cell(), idle_cell(), spec)


def with_rulings(spec: dict, seated: Raster | None = None) -> Raster:
    """Builds, asking for rulings the way the reviewer would: each pixel the rules cannot decide gets its ramp's darkest shade."""
    spec = copy.deepcopy(spec)
    spec["rulings"] = []
    for _ in range(8):
        try:
            return build(seated or seated_cell(), idle_cell(), spec)
        except NeedsRulings as error:
            spec["rulings"] += [[x, y, "#76572f" if y >= 74 else "#637b89"] for x, y in error.pixels]
    raise AssertionError("rulings did not settle")


def colour(image: Raster, p: tuple[int, int]):
    px = image.pixel(*p)
    return tuple(px[:3]) if px[3] else None


class SpecIsChecked(unittest.TestCase):
    def test_unknown_keys_and_a_wrong_schema_are_refused(self) -> None:
        for bad in ({**good_spec(), "extra": 1}, {**good_spec(), "schema": 2}):
            with self.assertRaises(SpecError):
                build(seated_cell(), idle_cell(), bad)

    def test_regions_and_budget_are_required(self) -> None:
        for key in ("regions", "budget"):
            spec = good_spec()
            del spec[key]
            with self.assertRaises(SpecError):
                build(seated_cell(), idle_cell(), spec)

    def test_dy_must_keep_the_kept_pixels_inside_the_cell(self) -> None:
        with self.assertRaisesRegex(SpecError, "below the cell"):
            build(seated_cell(), idle_cell(), {**good_spec(), "keep": {"rows": [20, 79]}, "dy": 10})

    def test_a_keep_region_with_no_opaque_pixel_is_refused(self) -> None:
        with self.assertRaisesRegex(SpecError, "no opaque idle pixel"):
            keep_cells(idle_cell(), {"rows": [0, 5]})

    def test_a_colour_that_is_not_lower_case_hex_is_refused(self) -> None:
        with self.assertRaisesRegex(SpecError, "#rrggbb"):
            build(seated_cell(), idle_cell(), {**good_spec(), "patches": [[30, 60, "#76572F"]]})

    def test_a_spec_may_be_a_path_to_a_json_file(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "spec.json"
            path.write_text(json.dumps(good_spec()))
            self.assertEqual(build(seated_cell(), idle_cell(), path).rgba, built().rgba)

    def test_the_keep_region_can_be_a_mask_of_single_cells_minus_exclusions(self) -> None:
        idle = idle_cell()
        cells = keep_cells(idle, {"mask": [[26, 20], [27, 20], [0, 0]], "exclude": [[27, 20]]})
        self.assertEqual(cells, {(26, 20)})


class KeptPixelsAreIdles(unittest.TestCase):
    def test_every_kept_pixel_is_idles_colour_dy_rows_lower(self) -> None:
        idle, out = idle_cell(), built()
        kept = keep_cells(idle, good_spec()["keep"])
        self.assertTrue(kept)
        for x, y in kept:
            self.assertEqual(out.pixel(x, y + 6), idle.pixel(x, y), (x, y))

    def test_the_head_sits_dy_rows_lower(self) -> None:
        idle, out = idle_cell(), built()
        top = lambda image: min(y for _, y in opaque_cells(image))
        self.assertEqual(top(out) - top(idle), 6)

    def test_verify_fails_when_a_kept_pixel_is_changed(self) -> None:
        out = bytearray(built().rgba)
        at = (30 * 64 + 30) * 4
        out[at : at + 3] = bytes(G1)
        problems = verify(Raster(64, 80, bytes(out)), idle_cell(), good_spec())
        self.assertTrue(any("kept pixel" in p and "not identical" in p for p in problems), problems)

    def test_verify_fails_when_a_kept_pixel_is_missing(self) -> None:
        out = bytearray(built().rgba)
        out[(30 * 64 + 30) * 4 + 3] = 0
        problems = verify(Raster(64, 80, bytes(out)), idle_cell(), good_spec())
        self.assertTrue(any("kept pixel" in p for p in problems), problems)

    def test_a_good_composite_verifies_clean(self) -> None:
        self.assertEqual(verify(built(), idle_cell(), good_spec()), [])


class NewPixelsStayInTheirRegions(unittest.TestCase):
    def test_a_patch_outside_every_region_is_refused(self) -> None:
        with self.assertRaisesRegex(SpecError, r"outside the declared regions"):
            built(patches=[[5, 5, "#637b89"]])

    def test_an_adopted_pixel_outside_every_region_is_refused(self) -> None:
        with self.assertRaisesRegex(SpecError, r"outside the declared regions"):
            built(regions=[[20, 52, 50, 70]])

    def test_a_new_pixel_on_a_kept_pixel_is_refused(self) -> None:
        with self.assertRaisesRegex(SpecError, "lies on a kept pixel"):
            built(patches=[[30, 30, "#637b89"]], regions=[[20, 20, 50, 79]])

    def test_a_ruling_on_a_cell_with_no_new_pixel_is_refused(self) -> None:
        with self.assertRaisesRegex(SpecError, "on no new pixel"):
            built(rulings=[*corner_rulings(), [45, 60, "#637b89"]])

    def test_verify_fails_when_a_pixel_appears_outside_the_regions(self) -> None:
        out = bytearray(built().rgba)
        out[(5 * 64 + 5) * 4 : (5 * 64 + 5) * 4 + 4] = bytes((*C0, 255))
        problems = verify(Raster(64, 80, bytes(out)), idle_cell(), good_spec())
        self.assertTrue(any("(5, 5)" in p and "outside the declared regions" in p for p in problems), problems)

    def test_the_new_pixels_are_exactly_what_the_regions_hold(self) -> None:
        out = built()
        moved = {(x, y + 6) for x, y in keep_cells(idle_cell(), good_spec()["keep"])}
        new = opaque_cells(out) - moved
        self.assertTrue(new)
        self.assertTrue(all(20 <= x <= 50 and 52 <= y <= 79 for x, y in new))


class Budget(unittest.TestCase):
    def test_new_pixels_over_the_ceiling_are_refused(self) -> None:
        with self.assertRaisesRegex(SpecError, "new_pixels: .* over the budget of 10"):
            built(budget={"new_pixels": 10})

    def test_the_adopted_and_ruling_ceilings_are_checked_on_their_own(self) -> None:
        with self.assertRaisesRegex(SpecError, "adopted: .* over the budget of 3"):
            built(budget={"new_pixels": 500, "adopted": 3})
        with self.assertRaisesRegex(SpecError, "rulings: 6 is over the budget of 2"):
            built(budget={"new_pixels": 500, "rulings": 2})

    def test_the_report_counts_what_was_spent(self) -> None:
        _, report = build_with_report(seated_cell(), idle_cell(), good_spec())
        self.assertEqual(report["new_pixels"], 16 * 22 + 2 * 36)
        self.assertEqual(report["adopted_pixels"], report["new_pixels"])
        self.assertEqual(report["rulings"], 6)


class ColoursAndAlpha(unittest.TestCase):
    def test_adopted_colours_are_snapped_to_idles_colours(self) -> None:
        out = built()
        self.assertTrue(colour_set(out) <= colour_set(idle_cell()))
        self.assertEqual(colour(out, (30, 60)), C2)
        self.assertEqual(colour(out, (26, 77)), G2)

    def test_a_colour_idle_does_not_use_is_snapped_not_kept(self) -> None:
        out = built(seated_cell({(30, 60): (255, 0, 255)}))
        self.assertIn(colour(out, (30, 60)), colour_set(idle_cell()))

    def test_a_patch_in_a_colour_idle_does_not_use_is_refused(self) -> None:
        with self.assertRaisesRegex(SpecError, "not one of idle's colours"):
            built(patches=[[30, 60, "#b38b43"]])

    def test_a_ruling_in_a_colour_idle_does_not_use_is_refused(self) -> None:
        rulings = [*corner_rulings()[:-1], [34, 74, "#b38b43"]]
        with self.assertRaisesRegex(SpecError, "not one of idle's colours"):
            built(rulings=rulings)

    def test_verify_fails_on_a_colour_outside_idles(self) -> None:
        out = bytearray(built().rgba)
        at = (60 * 64 + 30) * 4
        out[at : at + 3] = bytes(G1)
        problems = verify(Raster(64, 80, bytes(out)), idle_cell(), good_spec())
        self.assertTrue(any("colours outside idle's" in p for p in problems), problems)

    def test_alpha_is_binary_a_half_covered_pixel_is_in_or_out_at_128(self) -> None:
        extra = {(40, 60): (*OFF_CLOTH, 129), (40, 62): (*OFF_CLOTH, 127)}
        out = built(seated_cell(extra), adopt=[{"box": [24, 52, 41, 79]}])
        self.assertEqual(out.pixel(40, 60)[3], 255)
        self.assertEqual(out.pixel(40, 62)[3], 0)
        self.assertEqual({a for a in out.rgba[3::4]}, {0, 255})

    def test_verify_fails_on_a_partial_alpha(self) -> None:
        out = bytearray(built().rgba)
        out[(60 * 64 + 30) * 4 + 3] = 100
        problems = verify(Raster(64, 80, bytes(out)), idle_cell(), good_spec())
        self.assertTrue(any("alpha is not binary" in p for p in problems), problems)


class OutlineRulesApplyToNewPixels(unittest.TestCase):
    def test_new_exterior_pixels_become_the_darkest_shade_of_the_ramp_they_bound(self) -> None:
        out = built()
        for p in [(24, 60), (39, 60), (24, 52), (31, 73), (32, 73)]:
            self.assertEqual(colour(out, p), C0, p)
        for p in [(24, 76), (29, 77), (26, 79), (37, 79)]:
            self.assertEqual(colour(out, p), G0, p)

    def test_the_inside_of_a_new_form_keeps_its_fill(self) -> None:
        out = built()
        self.assertEqual(colour(out, (30, 62)), C2)
        self.assertEqual(colour(out, (26, 77)), G2)

    def test_the_rules_leave_kept_pixels_alone_even_when_they_are_light_and_exterior_in_idle(self) -> None:
        idle = idle_cell()
        out = built()
        self.assertEqual(colour(out, (25, 46)), colour(idle, (25, 40)))

    def test_pixels_the_rules_cannot_decide_need_rulings_and_all_are_named_at_once(self) -> None:
        with self.assertRaises(NeedsRulings) as raised:
            built(rulings=[])
        self.assertEqual(
            raised.exception.pixels,
            [(29, 74), (34, 74), (24, 79), (29, 79), (34, 79), (39, 79)],
        )

    def test_a_ruling_beats_the_rule(self) -> None:
        rulings = [*corner_rulings(), [24, 60, "#9fb5bf"]]
        out = built(rulings=rulings)
        self.assertEqual(colour(out, (24, 60)), C1)
        self.assertEqual(colour(out, (24, 61)), C0)

    def test_verify_fails_when_a_new_exterior_pixel_is_not_the_darkest_shade(self) -> None:
        out = bytearray(built().rgba)
        at = (60 * 64 + 24) * 4
        out[at : at + 3] = bytes(C2)
        problems = verify(Raster(64, 80, bytes(out)), idle_cell(), good_spec())
        self.assertTrue(any("outline R1 at (24, 60)" in p for p in problems), problems)

    def test_verify_fails_on_a_two_pixel_dark_band_inside_a_new_form(self) -> None:
        out = bytearray(built().rgba)
        for x in (24, 25):
            at = (62 * 64 + x) * 4
            out[at : at + 3] = bytes(C0)
        problems = verify(Raster(64, 80, bytes(out)), idle_cell(), good_spec())
        self.assertTrue(any("outline R3 at (25, 62)" in p for p in problems), problems)

    def test_a_kept_pixel_the_composite_exposes_needs_an_outline_outside_it(self) -> None:
        spec = good_spec()
        spec["adopt"] = [{"box": [24, 74, 39, 79]}]
        spec["rulings"] = []
        spec["budget"] = {"new_pixels": 500}
        with self.assertRaisesRegex(ValueError, "exposed at .* without an outline"):
            with_rulings(spec)


class TheFeetStayPut(unittest.TestCase):
    def feet_spec(self, dx: int = 0, dy: int = 0, left_only: bool = False) -> dict:
        spec = good_spec()
        spec["adopt"] = [
            {"box": [24, 52, 39, 73]},
            {"box": [24, 74, 29 if left_only else 39, 79], "dx": dx, "dy": dy},
        ]
        return spec

    def test_the_synthetic_composite_has_both_feet_on_row_79_with_midpoint_32(self) -> None:
        out = built()
        clusters = sole_clusters(out, 2, 2)
        self.assertEqual([(c["x0"], c["x1"] - 1, c["bottom_row"]) for c in clusters], [(24, 29, 79), (34, 39, 79)])
        self.assertEqual(sole_midpoint(out, 2, 2), 32.0)

    def test_feet_ending_above_row_79_are_refused(self) -> None:
        with self.assertRaisesRegex(ValueError, "lowest opaque row is 78"):
            with_rulings(self.feet_spec(dy=-1))

    def test_feet_with_their_midpoint_off_32_are_refused(self) -> None:
        with self.assertRaisesRegex(ValueError, "midpoint between the feet is x=33"):
            with_rulings(self.feet_spec(dx=1))

    def test_one_foot_is_refused(self) -> None:
        with self.assertRaisesRegex(ValueError, "two feet"):
            with_rulings(self.feet_spec(left_only=True))

    def test_verify_fails_when_the_feet_move(self) -> None:
        out = bytearray(built().rgba)
        for x in range(64):
            out[(79 * 64 + x) * 4 + 3] = 0
        problems = verify(Raster(64, 80, bytes(out)), idle_cell(), good_spec())
        self.assertTrue(any("lowest opaque row is 78" in p for p in problems), problems)


class SecondFrame(unittest.TestCase):
    def setUp(self) -> None:
        self.frame0 = built()
        self.spec = good_spec()

    def test_the_upper_body_rises_one_pixel_and_nothing_else_moves(self) -> None:
        frame1 = frame2(self.frame0, self.spec)
        for x in range(64):
            for y in range(26, 46):
                if self.frame0.pixel(x, y)[3] and x >= 24:
                    self.assertEqual(frame1.pixel(x, y - 1), self.frame0.pixel(x, y), (x, y))
        below = {p for p in changed_cells(self.frame0, frame1) if p[1] > 45}
        self.assertEqual(below, set())
        self.assertEqual(min(y for _, y in opaque_cells(frame1)), min(y for _, y in opaque_cells(self.frame0)) - 1)

    def test_the_feet_are_unchanged(self) -> None:
        frame1 = frame2(self.frame0, self.spec)
        self.assertEqual(
            [(c["x0"], c["x1"] - 1, c["bottom_row"]) for c in sole_clusters(frame1, 2, 2)],
            [(24, 29, 79), (34, 39, 79)],
        )
        self.assertEqual(sole_midpoint(frame1, 2, 2), 32.0)

    def test_a_repair_is_applied_and_counted_as_declared(self) -> None:
        spec = copy.deepcopy(self.spec)
        spec["rise"]["repairs"] = [[30, 50, "#9fb5bf"]]
        frame1 = frame2(self.frame0, spec)
        self.assertEqual(colour(frame1, (30, 50)), C1)

    def test_the_rise_is_limited_to_one_pixel(self) -> None:
        spec = copy.deepcopy(self.spec)
        spec["rise"]["amount"] = 2
        with self.assertRaisesRegex(SpecError, "1 px"):
            frame2(self.frame0, spec)

    def test_a_changed_pixel_budget_is_enforced(self) -> None:
        spec = copy.deepcopy(self.spec)
        spec["rise"]["max_changed"] = 5
        with self.assertRaisesRegex(ValueError, "over the budget of 5"):
            frame2(self.frame0, spec)

    def test_a_rise_may_not_reach_the_last_row_where_the_feet_stand(self) -> None:
        spec = copy.deepcopy(self.spec)
        spec["rise"]["rows"] = [26, 79]
        with self.assertRaisesRegex(SpecError, "above the last row"):
            frame2(self.frame0, spec)

    def test_rise_problems_fail_on_a_pixel_changed_outside_the_rise(self) -> None:
        frame1 = frame2(self.frame0, self.spec)
        out = bytearray(frame1.rgba)
        at = (60 * 64 + 30) * 4
        out[at : at + 3] = bytes(C1)
        problems = rise_problems(self.frame0, Raster(64, 80, bytes(out)), self.spec)
        self.assertTrue(any("(30, 60) changed outside the rise" in p for p in problems), problems)

    def test_rise_problems_fail_on_a_colour_outside_the_set(self) -> None:
        frame1 = frame2(self.frame0, self.spec)
        out = bytearray(frame1.rgba)
        at = (30 * 64 + 30) * 4
        out[at : at + 3] = bytes(G1)
        problems = rise_problems(self.frame0, Raster(64, 80, bytes(out)), self.spec)
        self.assertTrue(any("colours outside idle's" in p for p in problems), problems)

    def test_rise_problems_fail_on_a_frame_that_did_not_move(self) -> None:
        problems = rise_problems(self.frame0, self.frame0, self.spec)
        self.assertTrue(any("identical to frame 0" in p for p in problems), problems)

    def test_a_cell_that_did_not_rise_is_named(self) -> None:
        frame1 = frame2(self.frame0, self.spec)
        out = bytearray(frame1.rgba)
        at = (29 * 64 + 30) * 4
        out[at : at + 3] = bytes(G1 if tuple(out[at : at + 3]) != G1 else C1)
        problems = rise_problems(self.frame0, Raster(64, 80, bytes(out)), self.spec)
        self.assertTrue(any("did not rise" in p for p in problems), problems)


class SheetFiles(unittest.TestCase):
    def test_the_sheet_png_is_the_frames_side_by_side(self) -> None:
        a, b = built(), frame2(built(), good_spec())
        sheet = sheet_png([a, b])
        self.assertEqual((sheet.width, sheet.height), (128, 80))
        self.assertEqual(sheet.pixel(30, 60), a.pixel(30, 60))
        self.assertEqual(sheet.pixel(64 + 30, 30), b.pixel(30, 30))

    def test_the_sheet_json_has_the_durations_the_tag_and_the_pivot_slice(self) -> None:
        document = json.loads(sheet_json("seated/south", [500, 400]))
        self.assertEqual([f["duration"] for f in document["frames"]], [500, 400])
        self.assertEqual([f["frame"]["x"] for f in document["frames"]], [0, 64])
        meta = document["meta"]
        self.assertEqual(meta["size"], {"w": 128, "h": 80})
        self.assertEqual(meta["frameTags"], [{"name": "seated/south", "from": 0, "to": 1, "direction": "forward"}])
        self.assertEqual(meta["slices"][0]["name"], "pivot:seated/south")
        self.assertEqual(meta["slices"][0]["keys"][0]["pivot"], {"x": 32, "y": 80})


@unittest.skipUnless(IDLE_FRAME0.exists(), "the C2c frame is gitignored scratch and is absent")
class OnTheRealIdleFrame(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.idle = decode_png(IDLE_FRAME0)

    def hex_at(self, x: int, y: int) -> str:
        return "#%02x%02x%02x" % tuple(self.idle.pixel(x, y)[:3])

    def test_keeping_everything_with_no_offset_is_idle_itself(self) -> None:
        spec = {
            "schema": 1,
            "dy": 0,
            "keep": {"rows": [26, 79]},
            "regions": [[0, 76, 63, 79]],
            "budget": {"new_pixels": 0},
        }
        out, report = build_with_report(self.idle, self.idle, spec)
        self.assertEqual(out.rgba, self.idle.rgba)
        self.assertEqual((report["new_pixels"], report["soles"]), (0, [[22, 29, 79], [34, 41, 79]]))

    def test_the_rules_and_c2cs_own_rulings_rebuild_idles_lower_body_pixel_for_pixel(self) -> None:
        pinned = [(40, 60), (24, 75), (39, 75), (30, 76), (34, 77)]
        layer_order = [(36, 56), (37, 58), (37, 59), (37, 60), (37, 61), (37, 62)]
        spec = {
            "schema": 1,
            "dy": 0,
            "keep": {"rows": [26, 55]},
            "regions": [[0, 56, 63, 79]],
            "adopt": [{"box": [0, 56, 63, 79]}],
            "rulings": [[x, y, self.hex_at(x, y)] for x, y in [*pinned, *layer_order]],
            "budget": {"new_pixels": 2000},
        }
        out = build(self.idle, self.idle, spec)
        self.assertEqual(out.rgba, self.idle.rgba)

    def test_without_the_layer_order_rulings_the_rules_alone_differ_from_c2c_only_there(self) -> None:
        pinned = [(40, 60), (24, 75), (39, 75), (30, 76), (34, 77)]
        spec = {
            "schema": 1,
            "dy": 0,
            "keep": {"rows": [26, 55]},
            "regions": [[0, 56, 63, 79]],
            "adopt": [{"box": [0, 56, 63, 79]}],
            "rulings": [[x, y, self.hex_at(x, y)] for x, y in pinned],
            "budget": {"new_pixels": 2000},
        }
        differing = changed_cells(build(self.idle, self.idle, spec), self.idle)
        self.assertEqual(differing, {(36, 56), (37, 58), (37, 59), (37, 60), (37, 61), (37, 62)})

    def test_the_upper_body_dropped_by_dy_is_idles_and_the_lower_body_is_redrawn_under_it(self) -> None:
        pinned = [(40, 60), (24, 75), (39, 75), (30, 76), (34, 77)]
        layer_order = [(37, 58), (37, 59), (37, 60), (37, 61), (37, 62)]
        spec = {
            "schema": 1,
            "dy": 4,
            "keep": {"rows": [26, 52]},
            "regions": [[0, 57, 63, 79]],
            "adopt": [{"box": [0, 57, 63, 79]}],
            "rulings": [[x, y, self.hex_at(x, y)] for x, y in [*pinned, *layer_order]],
            "budget": {"new_pixels": 800},
        }
        out, report = build_with_report(self.idle, self.idle, spec)
        for x, y in keep_cells(self.idle, spec["keep"]):
            self.assertEqual(out.pixel(x, y + 4), self.idle.pixel(x, y), (x, y))
        self.assertEqual(report["top_row"], 30)
        self.assertEqual(verify(out, self.idle, spec), [])
        self.assertTrue(colour_set(out) <= colour_set(self.idle))

    def test_frame2_with_idles_own_rise_values_is_the_idle_loops_peak_frame(self) -> None:
        spec = {
            "schema": 1,
            "rise": {
                "rows": [30, 45],
                "left_column": 25,
                "arm": {"column": 38, "from_row": 43},
                "repairs": [[x, y, c] for x, y, c in [*REPAIRS, *F2_CHEST_HOLD]],
            },
        }
        self.assertEqual(frame2(self.idle, spec).rgba, build_idle()[2].rgba)

    def test_the_command_writes_both_frames_the_two_frame_sheet_and_its_metadata(self) -> None:
        import tempfile

        from sprite_seated_composite import main

        pinned = [(40, 60), (24, 75), (39, 75), (30, 76), (34, 77), (37, 58), (37, 59), (37, 60), (37, 61), (37, 62)]
        spec = {
            "schema": 1,
            "dy": 4,
            "keep": {"rows": [26, 52]},
            "regions": [[0, 57, 63, 79]],
            "adopt": [{"box": [0, 57, 63, 79]}],
            "rulings": [[x, y, self.hex_at(x, y)] for x, y in pinned],
            "budget": {"new_pixels": 800},
            "rise": {"rows": [34, 49], "left_column": 29, "arm": {"column": 42, "from_row": 47}, "max_changed": 150},
        }
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "spec.json").write_text(json.dumps(spec))
            with contextlib.redirect_stdout(io.StringIO()):
                code = main(
                    ["--seated", str(IDLE_FRAME0), "--spec", str(root / "spec.json"), "--durations", "500,400", "--out", str(root / "out")]
                )
            self.assertEqual(code, 0)
            sheet = decode_png(root / "out" / "sheet.png")
            frame0 = decode_png(root / "out" / "seated-f0.png")
            frame1 = decode_png(root / "out" / "seated-f1.png")
            self.assertEqual((sheet.width, sheet.height), (128, 80))
            self.assertEqual(sheet.pixel(30, 60), frame0.pixel(30, 60))
            self.assertEqual(sheet.pixel(64 + 30, 40), frame1.pixel(30, 40))
            document = json.loads((root / "out" / "sheet.json").read_text())
            self.assertEqual([f["duration"] for f in document["frames"]], [500, 400])
            self.assertEqual(document["meta"]["slices"][0]["keys"][0]["pivot"], {"x": 32, "y": 80})
            report = json.loads((root / "out" / "report-seated.json").read_text())
            self.assertEqual((report["new_pixels"], report["top_row"], report["sole_midpoint"]), (386, 30, 32.0))
            self.assertLessEqual(report["frame1_changed_pixels"], 150)

    def test_the_command_refuses_durations_that_are_not_two_whole_milliseconds(self) -> None:
        from sprite_seated_composite import main

        with self.assertRaises(SystemExit):
            main(["--seated", "x.png", "--spec", "x.json", "--durations", "500", "--out", "o"])

    def test_the_real_seated_pair_shares_idles_colour_set_and_feet(self) -> None:
        spec = {
            "schema": 1,
            "dy": 0,
            "keep": {"rows": [26, 79]},
            "regions": [[0, 76, 63, 79]],
            "budget": {"new_pixels": 0},
            "rise": {
                "rows": [30, 45],
                "left_column": 25,
                "arm": {"column": 38, "from_row": 43},
                "repairs": [[x, y, c] for x, y, c in [*REPAIRS, *F2_CHEST_HOLD]],
            },
        }
        frame0 = build(self.idle, self.idle, spec)
        frame1 = frame2(frame0, spec, colour_set(self.idle))
        self.assertTrue(colour_set(frame1) <= colour_set(self.idle))
        self.assertEqual(sole_midpoint(frame1, 2, 2), 32.0)


if __name__ == "__main__":
    unittest.main()

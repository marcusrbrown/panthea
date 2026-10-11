"""Rules for the seated driver (`run_sprite_seated.py`): the helpers that are new, on small synthetic renders.

PNG I/O goes through `load` and `save` seams, so nothing here runs ffmpeg or a model.
"""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pipeline import Raster
from run_sprite_seated import (
    IDLE_STEP,
    PALETTE_JSON,
    Config,
    check_feet,
    downscale_at_ratio,
    estimate_shadow_key,
    load_config,
    make_cell,
    parse_ratio,
    process,
    read_jobs,
    rekey,
    run,
)
from sprite_downscale import (
    downscale_figure,
    foreground_bbox,
    key_foreground,
    load_palette,
    snap_to_palette,
)

BACKGROUND = (246, 242, 231)
SHADOW = (189, 193, 194)
CLOTH = (230, 228, 214)
SKIN = (221, 190, 112)
BOOT = (150, 100, 50)
PALETTE = load_palette(PALETTE_JSON)
# Small renders: the figure is a few hundred pixels, so the component floor and the shadow minimum shrink with it.
SMALL = Config(min_component=50, shadow_auto_min_pixels=20)


def render(width=160, height=200, parts=None, shadow=True) -> Raster:
    data = bytearray(bytes((*BACKGROUND, 255)) * (width * height))

    def paint(x0: int, y0: int, x1: int, y1: int, colour) -> None:
        for y in range(y0, y1):
            for x in range(x0, x1):
                data[(y * width + x) * 4 : (y * width + x) * 4 + 3] = bytes(colour)

    if shadow:
        paint(40, 191, 121, 196, SHADOW)
    for x0, y0, x1, y1, colour in parts or []:
        paint(x0, y0, x1, y1, colour)
    return Raster(width, height, bytes(data))


# A head, a torso, a lap and two boots on rows 181-190 with a gap of 20 px between them.
SEATED = [
    (70, 20, 91, 60, SKIN),
    (50, 60, 111, 150, CLOTH),
    (50, 150, 111, 181, CLOTH),
    (50, 181, 71, 191, BOOT),
    (91, 181, 112, 191, BOOT),
]
# The same, but a hem is the lowest thing: no feet.
HEMMED = [(70, 20, 91, 60, SKIN), (50, 60, 111, 191, CLOTH)]


class Ratio(unittest.TestCase):
    def test_the_idles_ratio_is_580_over_52_source_pixels_per_sprite_pixel(self) -> None:
        self.assertEqual(IDLE_STEP, Fraction(145, 13))
        self.assertAlmostEqual(float(IDLE_STEP), 11.153846, places=6)
        self.assertAlmostEqual(1 / float(IDLE_STEP), 0.089655, places=6)

    def test_a_ratio_parses_from_a_fraction_or_a_decimal_and_must_downscale(self) -> None:
        self.assertEqual(parse_ratio("145/13"), IDLE_STEP)
        self.assertEqual(parse_ratio("5"), Fraction(5))
        self.assertAlmostEqual(float(parse_ratio(2.5)), 2.5)
        for bad in ("1", "1/2", 0.5):
            with self.assertRaises(ValueError):
                parse_ratio(bad)

    def test_the_default_config_carries_the_idles_ratio_and_the_c2a_rules(self) -> None:
        cfg = load_config(None)
        self.assertEqual(parse_ratio(cfg.source_px_per_sprite_px), IDLE_STEP)
        self.assertEqual(
            (cfg.key_tolerance, cfg.shadow_tolerance, cfg.fringe_max_spread, cfg.fringe_min_luma),
            (24, 30, 14, 140),
        )
        self.assertEqual(
            (cfg.min_component, cfg.sole_band_rows, cfg.sole_min_gap, cfg.ground_zone_fraction),
            (500, 8, 20, 0.03),
        )

    def test_a_config_with_an_unknown_key_a_bad_box_a_bad_method_or_a_bad_ratio_is_refused(self) -> None:
        for bad in (
            {"nope": 1},
            {"shadow_sample": [1, 2, 3]},
            {"methods": ["bilinear"]},
            {"source_px_per_sprite_px": "1/2"},
        ):
            with self.assertRaises(ValueError):
                load_config(bad)
        cfg = load_config({"shadow_sample": [1, 2, 3, 4], "methods": ["mode", "kcentroid"]})
        self.assertEqual(cfg.shadow_sample, (1, 2, 3, 4))


class FixedRatioDownscale(unittest.TestCase):
    def test_with_step_equal_to_height_over_rows_it_is_downscale_figure_exactly(self) -> None:
        keyed, _ = rekey(render(parts=SEATED, shadow=False), SMALL)
        bbox = foreground_bbox(keyed)
        rows = 20
        mine = downscale_at_ratio(keyed, "mode", Fraction(bbox[3] - bbox[1], rows), PALETTE, bbox)
        theirs = downscale_figure(keyed, "mode", rows, PALETTE, bbox)
        self.assertEqual((mine.width, mine.height), (theirs.width, theirs.height))
        self.assertEqual(mine.rgba, theirs.rgba)

    def test_a_feature_keeps_its_size_whatever_the_height_of_the_figure(self) -> None:
        skin = snap_to_palette(SKIN, PALETTE)

        def head_rows(extra: int) -> int:
            parts = [(70, 20, 90, 40, SKIN), (60, 40, 100, 100 + extra, CLOTH)]
            keyed, _ = rekey(render(parts=parts, shadow=False), SMALL)
            cell = downscale_at_ratio(keyed, "mode", Fraction(5), PALETTE)
            column = cell.width // 2
            return sum(
                1 for y in range(cell.height) if cell.pixel(column, y)[3] and tuple(cell.pixel(column, y)[:3]) == skin
            )

        self.assertEqual(head_rows(0), head_rows(40))
        self.assertEqual(head_rows(0), 4)

    def test_the_grid_covers_the_figure_and_a_partial_last_row_follows_the_coverage_rule(self) -> None:
        keyed, _ = rekey(render(parts=[(20, 20, 60, 63, CLOTH)], shadow=False), SMALL)
        cell = downscale_at_ratio(keyed, "mode", Fraction(10), PALETTE)
        self.assertEqual((cell.width, cell.height), (4, 5))
        self.assertTrue(all(cell.pixel(x, 3)[3] for x in range(4)))
        self.assertTrue(all(cell.pixel(x, 4)[3] == 0 for x in range(4)))  # 3 of 10 source rows: under half coverage


class KeyingGeneralisesC2a(unittest.TestCase):
    def test_the_ground_shadow_and_its_pocket_between_the_legs_are_removed_and_the_figure_is_kept(self) -> None:
        final, facts = rekey(render(parts=SEATED), SMALL)
        _, y0, _, y1 = foreground_bbox(final)
        self.assertEqual((y0, y1), (20, 191))
        self.assertEqual(facts["shadow"]["how"], "estimated from the ground zone")
        self.assertEqual(facts["shadow"]["rgb"], list(SHADOW))
        self.assertGreater(facts["shadow"]["pixels_cleared"], 0)
        gap = [(x, y) for y in range(181, 191) for x in range(72, 91) if final.pixel(x, y)[3]]
        self.assertEqual(gap, [])
        self.assertTrue(final.pixel(60, 185)[3] and final.pixel(100, 185)[3])

    def test_a_sample_box_names_the_shadow_colour_instead_of_estimating_it(self) -> None:
        cfg = Config(min_component=50, shadow_sample=(45, 192, 60, 195))
        final, facts = rekey(render(parts=SEATED), cfg)
        self.assertEqual(facts["shadow"]["how"], "sample box")
        self.assertEqual(foreground_bbox(final)[3], 191)

    def test_with_no_shadow_nothing_is_estimated_and_the_figure_is_untouched(self) -> None:
        final, facts = rekey(render(parts=SEATED, shadow=False), SMALL)
        self.assertEqual(facts["shadow"]["how"], "none found")
        self.assertEqual(facts["shadow"]["pixels_cleared"], 0)
        self.assertEqual(foreground_bbox(final), (50, 20, 112, 191))

    def test_the_estimate_needs_enough_low_chroma_pixels(self) -> None:
        source = render(parts=SEATED)
        masked, _ = key_foreground(source, 24)
        zone_top = foreground_bbox(masked)[3] - 6
        key, count = estimate_shadow_key(masked, source, zone_top, 24, 10**6)
        self.assertIsNone(key)
        self.assertGreater(count, 0)
        self.assertEqual(estimate_shadow_key(masked, source, zone_top, 24, 20)[0], SHADOW)

    def test_specks_are_dropped_and_the_largest_component_kept(self) -> None:
        final, facts = rekey(render(parts=[*SEATED, (2, 2, 4, 4, CLOTH)]), SMALL)
        self.assertEqual(foreground_bbox(final)[0], 50)
        self.assertEqual([r["pixels"] for r in facts["components_removed"]], [4])


class FeetMustBeTheLowestRows(unittest.TestCase):
    def test_two_boots_on_the_lowest_rows_are_the_feet(self) -> None:
        final, _ = rekey(render(parts=SEATED), SMALL)
        verdict = check_feet(final, SMALL)
        self.assertTrue(verdict["ok"], verdict)
        self.assertEqual([(c["x0"], c["x1"]) for c in verdict["clusters"]], [(50, 71), (91, 112)])
        self.assertEqual(verdict["sole_midpoint"], 81.0)

    def test_a_hem_that_is_lowest_is_not_two_feet_and_the_reason_is_recorded(self) -> None:
        final, _ = rekey(render(parts=HEMMED, shadow=False), SMALL)
        verdict = check_feet(final, SMALL)
        self.assertFalse(verdict["ok"])
        self.assertTrue(any("1 foot clusters" in r for r in verdict["reasons"]), verdict)

    def test_a_footstool_wider_than_the_feet_is_a_seat_not_a_foot(self) -> None:
        parts = [*SEATED[:3], (40, 181, 71, 191, BOOT), (91, 181, 122, 191, BOOT)]
        final, _ = rekey(render(parts=parts, shadow=False), SMALL)
        verdict = check_feet(final, Config(min_component=50, max_foot_fraction=0.3))
        self.assertFalse(verdict["ok"])
        self.assertTrue(any("a hem or a seat, not a foot" in r for r in verdict["reasons"]), verdict)

    def test_a_foot_that_stops_short_of_the_lowest_row_is_flagged(self) -> None:
        parts = [(70, 20, 91, 60, SKIN), (50, 60, 111, 150, CLOTH), (50, 150, 71, 184, BOOT), (91, 150, 112, 191, BOOT)]
        final, _ = rekey(render(parts=parts, shadow=False), SMALL)
        verdict = check_feet(final, SMALL)
        self.assertFalse(verdict["ok"])
        self.assertTrue(any("not the lowest row 190" in r for r in verdict["reasons"]), verdict)


class CellsLandOnTheTile(unittest.TestCase):
    def test_a_seated_render_becomes_a_cell_with_the_outline_on_row_79_and_the_midpoint_at_32(self) -> None:
        _, _, cells, anchor = process(render(parts=SEATED), SMALL, PALETTE, Fraction(5))
        self.assertTrue(anchor["ok"])
        self.assertEqual([code for code, _, _ in cells], ["M"])
        _, cell, facts = cells[0]
        self.assertEqual(facts["bottom_row"], 79)
        self.assertEqual(facts["sole_midpoint"], 32.0)
        self.assertEqual(facts["outside_palette"], 0)
        self.assertTrue(facts["outline"])
        self.assertEqual(len(facts["soles"]), 2)
        self.assertEqual([row for _, _, row in facts["soles"]], [79, 79])
        self.assertEqual({a for a in cell.rgba[3::4]}, {0, 255})

    def test_make_cell_reports_where_the_figure_stands(self) -> None:
        final, _ = rekey(render(parts=SEATED), SMALL)
        _, facts = make_cell(final, "mode", Fraction(5), PALETTE)
        self.assertEqual(facts["top_row"], 79 - facts["height"] + 1)
        self.assertLessEqual(facts["colours"], 16)

    def test_a_candidate_whose_feet_are_not_lowest_gets_no_cell_and_says_why(self) -> None:
        _, _, cells, anchor = process(render(parts=HEMMED, shadow=False), SMALL, PALETTE, Fraction(5))
        self.assertEqual(cells, [])
        self.assertFalse(anchor["ok"])
        self.assertTrue(anchor["reasons"])

    def test_both_methods_make_a_cell_each(self) -> None:
        cfg = Config(min_component=50, shadow_auto_min_pixels=20, methods=("mode", "kcentroid"))
        _, _, cells, _ = process(render(parts=SEATED), cfg, PALETTE, Fraction(5))
        self.assertEqual([code for code, _, _ in cells], ["M", "K"])

    def test_a_figure_too_big_for_the_cell_at_the_ratio_is_reported_not_placed(self) -> None:
        _, _, cells, anchor = process(render(parts=SEATED), SMALL, PALETTE, Fraction(2))
        self.assertEqual(cells, [])
        self.assertIn("mode", anchor["cell_errors"])


class TheRun(unittest.TestCase):
    def store(self, folder: Path, jobs: list[tuple[str, str, int]]) -> dict[str, Raster]:
        (folder / "jobs").mkdir()
        (folder / "blobs").mkdir()
        rasters = {}
        for job_id, status, seed in jobs:
            blob = f"blob of {job_id}".encode()
            digest = hashlib.sha256(blob).hexdigest()
            (folder / "blobs" / f"{digest}.png").write_bytes(blob)
            record = {
                "job": {
                    "id": job_id,
                    "status": status,
                    "request": {"seed": seed},
                    **({"outputs": [{"hash": digest}]} if status == "succeeded" else {}),
                },
                "engine": {"settings": {"prompt": "seated pose"}},
            }
            (folder / "jobs" / f"{job_id}.json").write_text(json.dumps(record))
            rasters[digest] = render(parts=SEATED if job_id.endswith("0") else HEMMED, shadow=False)
        return rasters

    def test_a_request_is_processed_in_job_order_with_the_c1_layout_and_the_idles_ratio_recorded(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            rasters = self.store(
                root,
                [("seat-0000", "succeeded", 20261060), ("seat-0001", "succeeded", 20261061), ("seat-0002", "failed", 20261062)],
            )
            saved: dict[str, Raster] = {}
            config = Config(min_component=50, shadow_auto_min_pixels=20, source_px_per_sprite_px="5")
            summary = run(
                root,
                config,
                root / "out",
                request="seat",
                load=lambda path: rasters[path.stem],
                save=lambda image, path: saved.__setitem__(str(path.relative_to(root / "out")), image),
            )
            self.assertEqual([j["id"] for j in summary["jobs"]], ["seat-0000", "seat-0001", "seat-0002"])
            self.assertEqual(summary["ratio"]["source_px_per_sprite_px"], "5")
            first, second, third = summary["jobs"]
            self.assertTrue(first["anchor"]["ok"])
            self.assertEqual(first["cells"][0]["bottom_row"], 79)
            self.assertEqual(first["cells"][0]["sole_midpoint"], 32.0)
            self.assertFalse(second["anchor"]["ok"])
            self.assertTrue(second["skipped"].startswith("no cell:"))
            self.assertEqual(third["skipped"], "job did not succeed")
            self.assertEqual(
                sorted(saved),
                [
                    "cells/seat-0000/M.png",
                    "contact-1x.png",
                    "contact-4x.png",
                    "keyed/seat-0000.png",
                    "keyed/seat-0001.png",
                ],
            )
            written = json.loads((root / "out" / "results.json").read_text())
            self.assertEqual(written["jobs"][0]["seed"], 20261060)
            self.assertEqual(written["config"]["methods"], ["mode"])

    def test_the_default_run_records_the_idles_ratio_with_its_derivation(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            rasters = self.store(root, [("seat-0000", "succeeded", 1)])
            summary = run(
                root, SMALL, root / "out", job_ids=["seat-0000"], load=lambda path: rasters[path.stem], save=lambda *_: None
            )
            ratio = summary["ratio"]
            self.assertEqual((ratio["source_px_per_sprite_px"], ratio["decimal"]), ("145/13", 11.153846))
            self.assertEqual(ratio["sprite_px_per_source_px"], 0.089655)
            self.assertIn("580/52", ratio["derivation"])

    def test_named_jobs_are_read_in_the_order_given(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.store(root, [("seat-0000", "succeeded", 1), ("seat-0001", "succeeded", 2)])
            ids = [j["id"] for j in read_jobs(root, ["seat-0001", "seat-0000"], None)]
            self.assertEqual(ids, ["seat-0001", "seat-0000"])

    def test_a_missing_job_and_a_request_with_no_jobs_are_refused(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.store(root, [("seat-0000", "succeeded", 1)])
            with self.assertRaisesRegex(ValueError, "no job record"):
                read_jobs(root, ["nope"], None)
            with self.assertRaisesRegex(ValueError, "no jobs"):
                read_jobs(root, None, "other")

    def test_a_blob_that_does_not_match_its_recorded_hash_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            rasters = self.store(root, [("seat-0000", "succeeded", 1)])
            next((root / "blobs").iterdir()).write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "hash does not match"):
                run(
                    root,
                    SMALL,
                    root / "out",
                    job_ids=["seat-0000"],
                    load=lambda path: next(iter(rasters.values())),
                    save=lambda *_: None,
                )


if __name__ == "__main__":
    unittest.main()

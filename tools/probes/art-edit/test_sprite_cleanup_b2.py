"""Rules for the Phase B frame-2 light-touch cleanup. They pin measurable limits, not a design.

The same rules run against B2 (`sprite_cleanup_b2.build()`) and against its grip revision B2c
(`sprite_cleanup_b2c.build()`). Set B2_TARGET=base to run them all against the untouched S3-M54
tile (a gitignored scratch file) and see which fail, or B2C_TARGET=b2 to run the B2c-only checks
against B2.
"""

from __future__ import annotations

import os
import sys
import unittest
from collections import deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pipeline import Raster, decode_png
from sprite_cleanup_b2 import (
    BASE,
    BOLT_RECT,
    FACE_KEEP,
    FEET_RECT,
    PALETTE_JSON,
    SPECKS,
    build,
    changed_pixels,
    inside,
)
from sprite_cleanup_b2c import GRIP_EDITS
from sprite_cleanup_b2c import build as build_b2c
from sprite_downscale import load_palette

PALETTE = load_palette(PALETTE_JSON)
SYMBOLS = dict(zip("0123456789abcdef", PALETTE.colours))
BOLT_FILL_COLOURS = {SYMBOLS["7"], SYMBOLS["f"]}
SKIN = {SYMBOLS["6"], SYMBOLS["5"]}
BUDGET = 0.20
NEIGHBOURS4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
NEIGHBOURS8 = NEIGHBOURS4 + ((1, 1), (-1, -1), (1, -1), (-1, 1))
HAND_ROWS = (54, 57)

if not BASE.exists():
    raise unittest.SkipTest("the S3-M54 base tile is gitignored scratch and is absent")

BASE_IMAGE = decode_png(BASE)


def target(revision: str = "b2") -> Raster:
    if os.environ.get("B2_TARGET") == "base":
        return BASE_IMAGE
    if revision == "b2c" and os.environ.get("B2C_TARGET") != "b2":
        return build_b2c()
    return build()


def colour(image: Raster, x: int, y: int) -> tuple[int, int, int] | None:
    px = image.pixel(x, y)
    return tuple(px[:3]) if px[3] else None  # type: ignore[return-value]


def opaque(image: Raster) -> set[tuple[int, int]]:
    return {(x, y) for y in range(image.height) for x in range(image.width) if image.pixel(x, y)[3]}


def bolt_pixels(image: Raster) -> set[tuple[int, int]]:
    return {
        (x, y)
        for x, y in changed_pixels(BASE_IMAGE, image)
        if inside(BOLT_RECT, x, y) and colour(image, x, y) in BOLT_FILL_COLOURS
    }


def singletons(image: Raster) -> set[tuple[int, int]]:
    points = opaque(image)
    return {
        p
        for p in points
        if not any(
            (p[0] + dx, p[1] + dy) in points and colour(image, p[0] + dx, p[1] + dy) == colour(image, *p)
            for dx, dy in NEIGHBOURS8
        )
    }


def largest_filled_square(points: set[tuple[int, int]]) -> int:
    best = 0
    for x, y in points:
        size = 1
        while all((x + i, y + j) in points for i in range(size + 1) for j in range(size + 1)):
            size += 1
        best = max(best, size)
    return best


class RuleChecks:
    revision = "b2"

    def setUp(self) -> None:
        self.image = target(self.revision)
        self.changed = changed_pixels(BASE_IMAGE, self.image)

    def test_at_most_twenty_percent_of_the_bases_opaque_pixels_change(self) -> None:
        base_opaque = len(opaque(BASE_IMAGE))
        self.assertLessEqual(len(self.changed), int(BUDGET * base_opaque))

    def test_most_of_the_base_survives_in_place_and_the_figure_is_not_mirrored(self) -> None:
        points = opaque(self.image)
        unchanged = sum(1 for p in opaque(BASE_IMAGE) if p not in self.changed)
        self.assertGreaterEqual(unchanged, int((1 - BUDGET) * len(opaque(BASE_IMAGE))))
        mirrored = sum(
            1 for x, y in points if colour(self.image, 63 - x, y) != colour(self.image, x, y)
        )
        self.assertGreater(mirrored / len(points), 0.2)

    def test_nothing_changes_outside_the_declared_regions(self) -> None:
        allowed = {(x, y, ) for x, y, _ in SPECKS}
        stray = {
            p
            for p in self.changed
            if not inside(BOLT_RECT, *p) and not inside(FEET_RECT, *p) and p not in allowed
        }
        self.assertEqual(stray, set())

    def test_face_features_and_the_silhouette_outside_the_edit_regions_are_the_bases(self) -> None:
        for p in FACE_KEEP:
            self.assertEqual(colour(self.image, *p), colour(BASE_IMAGE, *p), p)
        for y in range(80):
            for x in range(64):
                if inside(BOLT_RECT, x, y) or inside(FEET_RECT, x, y):
                    continue
                self.assertEqual(
                    bool(self.image.pixel(x, y)[3]), bool(BASE_IMAGE.pixel(x, y)[3]), (x, y)
                )

    def test_only_the_sixteen_olympus_colours(self) -> None:
        used = {colour(self.image, x, y) for x, y in opaque(self.image)}
        self.assertEqual(used - set(PALETTE.colours), set())

    def test_alpha_is_binary_and_the_cell_is_64_by_80(self) -> None:
        self.assertEqual((self.image.width, self.image.height), (64, 80))
        self.assertEqual({self.image.pixel(x, y)[3] for x in range(64) for y in range(80)} - {0, 255}, set())

    def test_height_with_outline_is_48_to_56(self) -> None:
        ys = [y for _, y in opaque(self.image)]
        self.assertTrue(48 <= max(ys) - min(ys) + 1 <= 56, max(ys) - min(ys) + 1)

    def test_two_distinct_soles_on_row_79_with_their_midpoint_at_32(self) -> None:
        row = [x for x in range(64) if self.image.pixel(x, 79)[3]]
        self.assertTrue(row)
        groups: list[list[int]] = [[row[0]]]
        for x in row[1:]:
            if x == groups[-1][-1] + 1:
                groups[-1].append(x)
            else:
                groups.append([x])
        self.assertEqual(len(groups), 2, f"row 79 has {len(groups)} runs")
        left, right = groups
        self.assertGreaterEqual(right[0] - left[-1] - 1, 2)
        self.assertGreaterEqual(len(left), 3)
        self.assertGreaterEqual(len(right), 3)
        self.assertEqual((left[0] + right[-1] + 1) / 2, 32.0)

    def test_new_edges_are_outlined_in_the_darkest_ramp_shade_and_nothing_is_reoutlined(self) -> None:
        darkest = set(PALETTE.darkest.values())
        points = opaque(self.image)
        exterior_edge = {
            p
            for p in points
            if any((p[0] + dx, p[1] + dy) not in points for dx, dy in NEIGHBOURS4)
            and any(
                not (0 <= p[0] + dx < 64 and 0 <= p[1] + dy < 80) or (p[0] + dx, p[1] + dy) not in points
                for dx, dy in NEIGHBOURS4
            )
        }
        new_edge = {p for p in exterior_edge if p in self.changed}
        self.assertEqual({colour(self.image, *p) for p in new_edge} - darkest, set())
        outlined_before = {p for p in opaque(BASE_IMAGE) if colour(BASE_IMAGE, *p) in darkest}
        recoloured_outline = {p for p in outlined_before if p in self.changed and p in points}
        self.assertLessEqual(len(recoloured_outline), len(outlined_before) // 4)

    def test_no_isolated_single_pixel_flecks_outside_the_kept_face_features(self) -> None:
        self.assertEqual(sorted(singletons(self.image) - set(FACE_KEEP)), [])

    def test_a_tapered_zigzag_bolt_crosses_the_fist_and_clears_the_skirt(self) -> None:
        bolt = bolt_pixels(self.image)
        self.assertGreaterEqual(len(bolt), 30, "bolt fill pixels")
        rows = sorted({y for _, y in bolt})
        self.assertGreaterEqual(rows[-1] - rows[0] + 1, 12, "bolt height in rows")

        self.assertLessEqual(largest_filled_square(bolt), 3, "stroke thickness: no solid square wider than 3")

        per_row = {y: sorted(x for x, yy in bolt if yy == y) for y in rows}
        self.assertLessEqual(len(per_row[rows[-1]]), 1, "the far tip is one pixel wide")
        self.assertGreater(max(len(v) for v in per_row.values()), len(per_row[rows[-1]]))

        centre = [(y, sum(per_row[y]) / len(per_row[y])) for y in rows]
        steps = [b[1] - a[1] for a, b in zip(centre, centre[1:])]
        down_left_runs, current = [], 0
        for step in steps:
            if step < 0:
                current += 1
            else:
                if current:
                    down_left_runs.append(current)
                current = 0
        if current:
            down_left_runs.append(current)
        self.assertGreaterEqual(len([r for r in down_left_runs if r >= 3]), 2, "two down-left strokes")
        first = next(i for i, r in enumerate(steps) if r < 0)
        self.assertGreaterEqual(max(centre[i][1] for i in range(first, len(centre))) - min(c for _, c in centre[: first + 4]), 3, "a jog to the right between them")

        top, bottom = HAND_ROWS
        self.assertTrue(any(y < top for _, y in bolt), "bolt above the fist")
        self.assertTrue(any(y > bottom for _, y in bolt), "bolt below the fist")
        self.assertTrue(any(top - 2 <= y < top for _, y in bolt), "bolt reaches the top of the fist")
        self.assertTrue(any(bottom < y <= bottom + 2 for _, y in bolt), "bolt leaves the bottom of the fist")
        overlap = {
            (x, y)
            for x in range(19, 23)
            for y in range(top + 1, bottom)
            if colour(self.image, x, y) in SKIN
        }
        self.assertGreaterEqual(len(overlap), 4, "hand pixels sit over the shaft between the two segments")

        skirt = {
            p
            for p in opaque(BASE_IMAGE)
            if p[0] >= 24 and p[1] > bottom and p not in self.changed
        }
        nearest = min(
            max(abs(x - sx), abs(y - sy)) for x, y in bolt if y > bottom for sx, sy in skirt
        )
        self.assertGreaterEqual(nearest, 3, "fill, outline and at least one clear pixel before the skirt")

    def test_the_bolt_is_outlined_in_the_darkest_pale_gold_shade(self) -> None:
        bolt = bolt_pixels(self.image)
        edge = {
            (x + dx, y + dy)
            for x, y in bolt
            for dx, dy in NEIGHBOURS4
            if (x + dx, y + dy) not in bolt and (x + dx, y + dy) in opaque(self.image)
        }
        base_free = {p for p in edge if p not in opaque(BASE_IMAGE)}
        grip = {p for p in base_free if 19 <= p[0] <= 23 and HAND_ROWS[0] <= p[1] <= HAND_ROWS[1]}
        self.assertEqual({colour(self.image, *p) for p in base_free - grip}, {PALETTE.darkest["pale-gold"]})
        self.assertLessEqual({colour(self.image, *p) for p in grip}, SKIN | {PALETTE.darkest["pale-gold"]})


class B2Rules(RuleChecks, unittest.TestCase):
    revision = "b2"


class B2cRules(RuleChecks, unittest.TestCase):
    revision = "b2c"

    def test_the_five_grip_pixels_are_exactly_as_specified_and_are_the_only_change_from_b2(self) -> None:
        expected = {
            (19, 54): (244, 228, 174),
            (19, 57): (244, 228, 174),
            (18, 54): (118, 87, 47),
            (20, 54): (221, 191, 112),
            (20, 57): (179, 139, 67),
        }
        self.assertEqual({(x, y) for x, y, _ in GRIP_EDITS}, set(expected))
        for point, rgb in expected.items():
            self.assertEqual(colour(self.image, *point), rgb, point)
        b2 = target("b2") if os.environ.get("B2_TARGET") == "base" else build()
        self.assertEqual(
            {p for p in changed_pixels(b2, self.image)}, set(expected), "B2c differs from B2 in those five only"
        )

    def test_the_shaft_between_the_entrance_and_exit_stays_hidden(self) -> None:
        for y in (55, 56):
            for x in range(19, 23):
                self.assertNotIn(colour(self.image, x, y), BOLT_FILL_COLOURS, (x, y))

    def test_the_five_edits_add_one_changed_pixel_against_the_base(self) -> None:
        self.assertEqual(len(self.changed), 146)
        self.assertLess(len(self.changed), int(BUDGET * len(opaque(BASE_IMAGE))))
        self.assertAlmostEqual(100 * len(self.changed) / len(opaque(BASE_IMAGE)), 16.3, places=1)


if __name__ == "__main__":
    unittest.main()

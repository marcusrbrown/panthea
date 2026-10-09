"""Pins the measurable rules for the Phase B frame-1 cleanup.

By default the rules run against the edit rebuilt from `sprite_cleanup_b1.build()`.
Set B1_TARGET=base to run the same rules against the untouched S3-M54 tile (a
gitignored scratch file) and see which of them it breaks.
"""

from __future__ import annotations

import os
import sys
import unittest
from collections import deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pipeline import Raster, decode_png
from sprite_cleanup_b1 import BASE, PALETTE_JSON, build
from sprite_downscale import load_palette, measure

PALETTE = load_palette(PALETTE_JSON)
SYMBOLS = dict(zip("0123456789abcdef", PALETTE.colours))
MARBLE_LIGHT, MARBLE_MID = SYMBOLS["3"], SYMBOLS["2"]
SKIN, SKIN_SHADE, GOLD_LINE = SYMBOLS["6"], SYMBOLS["5"], SYMBOLS["4"]
BOLT_COLOURS = {SYMBOLS["7"], SYMBOLS["6"]}
DARKEST = set(PALETTE.darkest.values())
NEIGHBOURS4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
NEIGHBOURS8 = NEIGHBOURS4 + ((1, 1), (-1, -1), (1, -1), (-1, 1))


def target() -> Raster:
    if os.environ.get("B1_TARGET") == "base":
        if not BASE.exists():
            raise unittest.SkipTest("the S3-M54 base tile is gitignored scratch and is absent")
        return decode_png(BASE)
    return build()


def colour(image: Raster, x: int, y: int) -> tuple[int, int, int] | None:
    px = image.pixel(x, y)
    return tuple(px[:3]) if px[3] else None  # type: ignore[return-value]


def opaque(image: Raster) -> list[tuple[int, int]]:
    return [(x, y) for y in range(image.height) for x in range(image.width) if image.pixel(x, y)[3]]


def components(
    image: Raster, points: set[tuple[int, int]], same_colour: bool, steps=NEIGHBOURS8
) -> list[set[tuple[int, int]]]:
    seen: set[tuple[int, int]] = set()
    found = []
    for start in sorted(points):
        if start in seen:
            continue
        group = {start}
        queue = deque([start])
        seen.add(start)
        while queue:
            x, y = queue.popleft()
            for dx, dy in steps:
                n = (x + dx, y + dy)
                if n in points and n not in seen and (
                    not same_colour or colour(image, *n) == colour(image, x, y)
                ):
                    seen.add(n)
                    group.add(n)
                    queue.append(n)
        found.append(group)
    return found


def exterior(image: Raster) -> set[tuple[int, int]]:
    w, h = image.width, image.height
    seen: set[tuple[int, int]] = set()
    queue = deque(
        (x, y) for y in range(h) for x in range(w) if x in (0, w - 1) or y in (0, h - 1)
    )
    while queue:
        x, y = queue.popleft()
        if (x, y) in seen or not (0 <= x < w and 0 <= y < h) or image.pixel(x, y)[3]:
            continue
        seen.add((x, y))
        queue.extend((x + dx, y + dy) for dx, dy in NEIGHBOURS4)
    return seen


class B1Rules(unittest.TestCase):
    def setUp(self) -> None:
        self.image = target()

    def test_only_the_sixteen_olympus_colours(self) -> None:
        stray = {colour(self.image, x, y) for x, y in opaque(self.image)} - set(PALETTE.colours)
        self.assertEqual(stray, set())
        self.assertLessEqual(len({colour(self.image, x, y) for x, y in opaque(self.image)}), 16)

    def test_alpha_is_binary_and_the_cell_is_64_by_80(self) -> None:
        self.assertEqual((self.image.width, self.image.height), (64, 80))
        self.assertEqual({self.image.pixel(x, y)[3] for x in range(64) for y in range(80)} - {0, 255}, set())

    def test_height_with_outline_is_48_to_56(self) -> None:
        ys = [y for _, y in opaque(self.image)]
        self.assertTrue(48 <= max(ys) - min(ys) + 1 <= 56, max(ys) - min(ys) + 1)

    def test_two_explicit_soles_on_row_79_with_their_midpoint_at_32(self) -> None:
        row = [x for x in range(64) if self.image.pixel(x, 79)[3]]
        self.assertTrue(row, "nothing on row 79")
        self.assertEqual(max(y for _, y in opaque(self.image)), 79)
        runs, run = [], [row[0]]
        for x in row[1:]:
            if x == run[-1] + 1:
                run.append(x)
            else:
                runs.append(run)
                run = [x]
        runs.append(run)
        self.assertEqual(len(runs), 2, f"row 79 has {len(runs)} runs")
        left, right = runs
        self.assertGreaterEqual(right[0] - left[-1] - 1, 2, "the soles touch or nearly touch")
        self.assertEqual((left[0] + right[-1] + 1) / 2, 32.0)

    def test_outline_is_exterior_and_in_the_darkest_ramp_shade_only(self) -> None:
        outside = exterior(self.image)
        holes = {(x, y) for y in range(80) for x in range(64) if not self.image.pixel(x, y)[3]} - outside
        self.assertEqual(holes, set(), "enclosed transparent pixels have no outline and are not exterior")
        boundary = [
            (x, y)
            for x, y in opaque(self.image)
            if any((x + dx, y + dy) in outside for dx, dy in NEIGHBOURS4)
        ]
        self.assertTrue(boundary)
        self.assertEqual({colour(self.image, x, y) for x, y in boundary} - DARKEST, set())
        self.assertTrue(measure(self.image, PALETTE)["outline"])

    def test_no_isolated_single_pixel_flecks(self) -> None:
        points = set(opaque(self.image))
        flecks = [next(iter(g)) for g in components(self.image, points, same_colour=True) if len(g) == 1]
        self.assertEqual(flecks, [])

    def test_face_is_brow_eyes_nose_and_the_beard_one_white_mass_with_one_shadow_cluster(self) -> None:
        head = {(x, y) for x, y in opaque(self.image) if 26 <= x <= 37 and 31 <= y <= 41}
        white = {p for p in head if colour(self.image, *p) == MARBLE_LIGHT}
        shade = {p for p in head if colour(self.image, *p) == MARBLE_MID}
        masses = [g for g in components(self.image, white, same_colour=True) if len(g) >= 6]
        self.assertEqual(len(masses), 1, "the beard and hair are one white mass")
        self.assertGreaterEqual(len(white), 40)
        clusters = components(self.image, shade, same_colour=True)
        self.assertEqual(len(clusters), 1, "one beard shadow cluster")
        self.assertGreaterEqual(len(clusters[0]), 4)
        face = {(x, y) for x, y in opaque(self.image) if 28 <= x <= 35 and 31 <= y <= 34}
        self.assertLessEqual({colour(self.image, *p) for p in face}, {
            SKIN, SKIN_SHADE, SYMBOLS["1"], SYMBOLS["8"], MARBLE_LIGHT,
        })

    def test_chest_is_two_large_skin_clusters_without_highlights(self) -> None:
        chest = {(x, y) for x in range(27, 37) for y in range(42, 53) if self.image.pixel(x, y)[3]}
        self.assertEqual(len(chest), 10 * 11)
        self.assertLessEqual({colour(self.image, *p) for p in chest}, {SKIN, SKIN_SHADE})
        clusters = components(self.image, chest, same_colour=True)
        self.assertLessEqual(len(clusters), 2)
        self.assertGreaterEqual(min(len(c) for c in clusters), 20)

    def test_arms_are_cut_from_the_torso_by_a_dark_overlap_line(self) -> None:
        for y in range(40, 58):
            for x in (26, 37):
                self.assertEqual(colour(self.image, x, y), GOLD_LINE, (x, y))
        for y in range(40, 53):
            self.assertIn(colour(self.image, 25, y), {SKIN, SKIN_SHADE})
            self.assertIn(colour(self.image, 27, y), {SKIN, SKIN_SHADE})

    def test_beard_overlaps_the_chest_through_a_dark_line_not_a_second_perimeter(self) -> None:
        line = [(28, 38), (29, 39), (30, 40), (31, 41), (32, 41), (33, 40), (34, 39), (35, 38)]
        for point in line:
            self.assertEqual(colour(self.image, *point), PALETTE.darkest["marble"], point)

    def test_a_zigzag_thunderbolt_hangs_left_of_the_skirt_with_clear_space(self) -> None:
        bolt = {
            (x, y)
            for x, y in opaque(self.image)
            if 8 <= x <= 23 and 58 <= y <= 74 and colour(self.image, x, y) in BOLT_COLOURS
        }
        self.assertGreaterEqual(len(bolt), 60)
        left, right = {}, {}
        for x, y in bolt:
            left[y] = min(left.get(y, 99), x)
            right[y] = max(right.get(y, -1), x)
        rows = sorted(left)
        self.assertEqual(rows, list(range(rows[0], rows[0] + len(rows))), "the bolt is one run of rows")
        self.assertGreaterEqual(len(rows), 12)
        jogs = [y for y in rows[1:] if left[y] - left[y - 1] >= 3]
        self.assertEqual(len(jogs), 1, "exactly one rightward jog between two strokes")
        jog = jogs[0]
        upper = [y for y in rows if y < jog]
        lower = [y for y in rows if y >= jog]
        for stroke in (upper, lower):
            self.assertGreaterEqual(len(stroke), 4)
            self.assertTrue(all(left[b] - left[a] <= -1 for a, b in zip(stroke, stroke[1:])), "strokes run down-left")
        self.assertLess(left[rows[-1]], left[rows[0]] - 4, "the tip ends well left of where the bolt starts")
        for y in rows:
            skirt = min(x for x in range(24, 40) if self.image.pixel(x, y)[3] and colour(self.image, x, y) in {MARBLE_LIGHT, MARBLE_MID})
            self.assertGreaterEqual(skirt - right[y] - 1, 3, f"row {y}: outlines plus at least one clear pixel")
        grip = {colour(self.image, x, y) for x in range(21, 26) for y in range(55, 58)}
        self.assertLessEqual(grip, {SKIN, SKIN_SHADE})
        self.assertEqual({colour(self.image, 21, 58), colour(self.image, 22, 58)}, {GOLD_LINE})


if __name__ == "__main__":
    unittest.main()

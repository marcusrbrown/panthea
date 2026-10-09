"""Rules for the C2b hand-pixelled revision of the C2a M50 tile.

The rules run against `sprite_cleanup_c2b.build()`. Set C2B_TARGET=base to run them against the untouched
M50 tile (gitignored scratch) and see which fail.
"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pipeline import Raster, decode_png
from sprite_cleanup_c2b import (
    BASE,
    CEILINGS,
    PALETTE_JSON,
    REGIONS,
    REMOVAL_BOX,
    TOTAL_CEILING,
    apply,
    build,
    inside,
    region_of,
    rgb,
)
from sprite_downscale import load_palette, sole_clusters, sole_midpoint

if not BASE.exists():
    raise unittest.SkipTest("the M50 tile is gitignored scratch and is absent")

PALETTE = set(load_palette(PALETTE_JSON).colours)
BASE_IMAGE = decode_png(BASE)
BOLT_LIGHT, BOLT_SHADE, OUTLINE = rgb("#f4e4ae"), rgb("#ddbf70"), rgb("#76572f")


def target() -> Raster:
    return BASE_IMAGE if os.environ.get("C2B_TARGET") == "base" else build()


def colour(image: Raster, x: int, y: int) -> tuple[int, int, int] | None:
    px = image.pixel(x, y)
    return tuple(px[:3]) if px[3] else None  # type: ignore[return-value]


def opaque(image: Raster) -> set[tuple[int, int]]:
    return {(x, y) for y in range(image.height) for x in range(image.width) if image.pixel(x, y)[3]}


def changed(image: Raster) -> set[tuple[int, int]]:
    return {
        (x, y)
        for y in range(image.height)
        for x in range(image.width)
        if (colour(image, x, y) or None) != (colour(BASE_IMAGE, x, y) or None)
    }


def bolt_fill(image: Raster) -> set[tuple[int, int]]:
    x0, y0, x1, _ = REGIONS["bolt-and-grip"]
    return {
        (x, y)
        for y in range(y0, 39)
        for x in range(x0, x1 + 1)
        if colour(image, x, y) in (BOLT_LIGHT, BOLT_SHADE)
    }


def components(points: set[tuple[int, int]]) -> list[set[tuple[int, int]]]:
    left, found = set(points), []
    while left:
        stack = [left.pop()]
        group = {stack[0]}
        while stack:
            x, y = stack.pop()
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    n = (x + dx, y + dy)
                    if n in left:
                        left.discard(n)
                        group.add(n)
                        stack.append(n)
        found.append(group)
    return found


def largest_filled_square(points: set[tuple[int, int]]) -> int:
    best = 0
    for x, y in points:
        size = 1
        while all((x + i, y + j) in points for i in range(size + 1) for j in range(size + 1)):
            size += 1
        best = max(best, size)
    return best


def row_xs(points: set[tuple[int, int]], y: int) -> list[int]:
    return sorted(x for x, yy in points if yy == y)


class C2bRules(unittest.TestCase):
    def setUp(self) -> None:
        self.image = target()
        self.changed = changed(self.image)

    def test_each_region_and_the_total_stay_inside_their_ceilings(self) -> None:
        per_region = {name: {p for p in self.changed if inside(rect, *p)} for name, rect in REGIONS.items()}
        for name, points in per_region.items():
            self.assertLessEqual(len(points), CEILINGS[name], name)
        self.assertLessEqual(len(self.changed), TOTAL_CEILING)

    def test_nothing_changes_outside_the_declared_regions(self) -> None:
        self.assertEqual({p for p in self.changed if region_of(*p) is None}, set())

    def test_the_frozen_parts_are_the_bases_feet_hem_head_outline_and_cape(self) -> None:
        frozen_rows = range(72, 80)
        for y in frozen_rows:
            for x in range(64):
                self.assertEqual(colour(self.image, x, y), colour(BASE_IMAGE, x, y), (x, y))
        for y in range(26, 72):
            for x in range(64):
                if region_of(x, y) is None:
                    self.assertEqual(colour(self.image, x, y), colour(BASE_IMAGE, x, y), (x, y))

    def test_only_palette_colours_and_binary_alpha(self) -> None:
        self.assertEqual({colour(self.image, *p) for p in opaque(self.image)} - PALETTE, set())
        self.assertEqual({self.image.pixel(x, y)[3] for y in range(80) for x in range(64)} - {0, 255}, set())

    def test_the_soles_are_unchanged_and_their_midpoint_is_32(self) -> None:
        clusters = sole_clusters(self.image, 2, 2)
        self.assertEqual([(c["x0"], c["x1"] - 1, c["bottom_row"]) for c in clusters], [(22, 29, 79), (34, 41, 79)])
        self.assertEqual(sole_midpoint(self.image, 2, 2), 32.0)

    def test_total_height_is_at_most_56_and_the_bolt_is_on_row_26_or_lower(self) -> None:
        ys = [y for _, y in opaque(self.image)]
        self.assertLessEqual(max(ys) - min(ys) + 1, 56)
        self.assertGreaterEqual(min(ys), 26)

    def test_the_face_pixels_are_exactly_as_specified(self) -> None:
        expected = {
            (29, 35): "#243f63", (32, 35): "#243f63",
            (29, 34): "#f0eee0", (32, 34): "#f0eee0",
            (30, 35): "#ddbf70", (31, 35): "#ddbf70",
            (31, 36): "#b38b43",
            **{(x, 37): "#d6e1df" for x in range(28, 34)},
            (28, 35): "#d6e1df", (33, 35): "#d6e1df", (28, 36): "#9fb5bf",
        }
        for point, hex_colour in expected.items():
            self.assertEqual(colour(self.image, *point), rgb(hex_colour), point)
        face = {p for p in self.changed if inside(REGIONS["face"], *p)}
        self.assertLessEqual(len(face), 12)
        self.assertEqual(face - set(expected), set())

    def test_the_old_prop_is_gone_from_its_box_and_nothing_of_the_figure_was_in_it(self) -> None:
        x0, y0, x1, y1 = REMOVAL_BOX
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if colour(BASE_IMAGE, x, y) is not None:
                    self.assertTrue(
                        colour(self.image, x, y) in (BOLT_LIGHT, BOLT_SHADE, OUTLINE)
                        or colour(self.image, x, y) is None,
                        (x, y),
                    )

    def test_the_bolt_is_one_connected_shape_with_a_one_pixel_tip_and_nothing_below_the_fist_root(self) -> None:
        fill = bolt_fill(self.image)
        self.assertGreater(len(fill), 20)
        self.assertEqual(len(components(fill)), 1)
        top = min(y for _, y in fill)
        self.assertEqual(row_xs(fill, top), [23])
        self.assertEqual(top, 27)
        self.assertEqual(max(y for _, y in fill), 38)
        self.assertEqual(row_xs(fill, 38), [19])
        below = {
            (x, y)
            for y in range(39, 50)
            for x in range(15, 25)
            if colour(self.image, x, y) == BOLT_LIGHT
        }
        self.assertEqual(below, set())

    def test_the_bolt_has_three_straight_segments_and_its_fill_is_at_most_three_thick(self) -> None:
        fill = bolt_fill(self.image)
        self.assertLessEqual(largest_filled_square(fill), 3)
        upper = [row_xs(fill, y) for y in range(27, 32)]
        jog = [row_xs(fill, y) for y in (32, 33)]
        lower = [row_xs(fill, y) for y in range(34, 39)]
        for xs in upper + lower:
            self.assertTrue(1 <= len(xs) <= 3, xs)
            self.assertEqual(xs, list(range(xs[0], xs[-1] + 1)))
        for xs in jog:
            self.assertGreaterEqual(len(xs), 7)
            self.assertEqual(xs, list(range(xs[0], xs[-1] + 1)))
        centres = lambda rows: [sum(r) / len(r) for r in rows]  # noqa: E731
        for rows in (upper, lower):
            c = centres(rows)
            steps = [b - a for a, b in zip(c, c[1:])]
            self.assertTrue(all(s <= 0 for s in steps), c)
            self.assertTrue(all(s >= -2.0 for s in steps), c)
            self.assertLessEqual(c[-1] - c[0], -2.5, c)
        self.assertGreater(min(jog[0]) - 1, 0)
        self.assertLess(centres(upper)[-1], centres(jog)[0])
        self.assertGreater(centres(lower)[0], centres(upper)[-1])

    def test_the_bolt_is_outlined_on_its_exterior_in_the_darkest_gold(self) -> None:
        fill = bolt_fill(self.image)
        ring = {
            (x + dx, y + dy)
            for x, y in fill
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            if (x + dx, y + dy) not in fill
        }
        outside_hand = {p for p in ring if p[1] <= 37 or p[0] != 19}
        self.assertTrue(outside_hand)
        self.assertEqual({colour(self.image, *p) for p in outside_hand if colour(self.image, *p)}, {OUTLINE})

    def test_the_grip_is_as_specified(self) -> None:
        expected = {
            **{(x, 38): "#76572f" for x in (17, 18, 20, 21)},
            (19, 38): "#f4e4ae",
            (17, 39): "#76572f", (17, 40): "#76572f", (17, 41): "#76572f",
            (18, 42): "#76572f", (19, 42): "#ddbf70", (19, 43): "#ddbf70",
        }
        for point, hex_colour in expected.items():
            self.assertEqual(colour(self.image, *point), rgb(hex_colour), point)
        self.assertIsNone(colour(self.image, 16, 40))
        self.assertIsNone(colour(self.image, 16, 41))

    def test_apply_refuses_a_write_outside_its_region_and_a_region_over_its_ceiling(self) -> None:
        import sprite_cleanup_c2b as module

        original = module.FACE[:]
        try:
            module.FACE.append((10, 10, "#243f63"))
            with self.assertRaises(ValueError):
                apply(BASE_IMAGE)
            module.FACE[:] = original
            module.CEILINGS["face"] = 1
            with self.assertRaises(ValueError):
                apply(BASE_IMAGE)
        finally:
            module.FACE[:] = original
            module.CEILINGS["face"] = 12


if __name__ == "__main__":
    unittest.main()

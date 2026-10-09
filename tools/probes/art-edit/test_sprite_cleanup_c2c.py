"""Rules for the C2c outline fix of the accepted C2b frame.

The rules run against `sprite_cleanup_c2c.build()`. Set C2C_TARGET=base to run them against C2b itself
(gitignored scratch) and see which fail.
"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pipeline import Raster, decode_png
from sprite_cleanup_c2b import rgb
from sprite_cleanup_c2c import (
    GOLD_RAMP,
    NEIGHBOURS,
    OVERRIDES,
    PALETTE_JSON,
    SOURCE,
    Figure,
    build,
    frozen_points,
    ramps,
)
from sprite_downscale import load_palette, sole_clusters, sole_midpoint

if not SOURCE.exists():
    raise unittest.SkipTest("the C2b frame is gitignored scratch and is absent")

PALETTE = load_palette(PALETTE_JSON)
BEFORE = decode_png(SOURCE)
FIGURE = Figure(BEFORE)
SHADES = ramps()
DARKEST = {shade[0] for shade in SHADES.values()}
FROZEN = frozen_points()
OVERRIDDEN = {(x, y): rgb(c) for table in OVERRIDES.values() for x, y, c in table}


def colour(image: Raster, x: int, y: int) -> tuple[int, int, int] | None:
    px = image.pixel(x, y)
    return tuple(px[:3]) if px[3] else None  # type: ignore[return-value]


def form_of(c: tuple[int, int, int]) -> str:
    return "gold" if PALETTE.ramp_of[c] == GOLD_RAMP else "cloud"


def target() -> Raster:
    return BEFORE if os.environ.get("C2C_TARGET") == "base" else build()


class C2cRules(unittest.TestCase):
    def setUp(self) -> None:
        self.image = target()

    def test_the_alpha_mask_is_identical_to_c2b(self) -> None:
        self.assertEqual(self.image.rgba[3::4], BEFORE.rgba[3::4])

    def test_the_bolt_fist_grip_and_face_feature_pixels_are_c2bs(self) -> None:
        for x, y in FROZEN:
            self.assertEqual(colour(self.image, x, y), colour(BEFORE, x, y), (x, y))

    def test_the_override_pixels_are_exactly_as_listed(self) -> None:
        for point, expected in OVERRIDDEN.items():
            self.assertEqual(colour(self.image, *point), expected, point)

    def test_a_few_rulings_are_pinned_by_hand(self) -> None:
        pinned = {
            (37, 48): "#637b89", (36, 49): "#637b89", (37, 49): "#9fb5bf",
            (36, 51): "#76572f", (37, 51): "#9fb5bf", (36, 54): "#637b89", (37, 54): "#9fb5bf",
            (37, 57): "#9fb5bf", (37, 60): "#637b89", (38, 60): "#9fb5bf",
            (35, 36): "#637b89", (25, 52): "#76572f", (22, 78): "#76572f", (40, 79): "#76572f",
            (24, 41): "#9fb5bf", (24, 48): "#9fb5bf", (23, 48): "#76572f", (29, 76): "#b38b43",
            (41, 59): "#76572f",
            (28, 40): "#637b89", (31, 42): "#637b89", (21, 43): "#76572f", (22, 43): "#b38b43",
        }
        for point, hex_colour in pinned.items():
            self.assertEqual(colour(self.image, *point), rgb(hex_colour), point)

    def test_every_exterior_pixel_is_a_darkest_shade_and_the_ramp_of_the_form_it_bounds(self) -> None:
        for p, distance in FIGURE.distance.items():
            if distance != 1 or p in FROZEN:
                continue
            actual = colour(self.image, *p)
            self.assertIn(actual, DARKEST, p)
            if p in OVERRIDDEN:
                self.assertEqual(actual, OVERRIDDEN[p], p)
                continue
            inward = [
                colour(BEFORE, p[0] + dx, p[1] + dy)
                for dx, dy in NEIGHBOURS
                if FIGURE.distance.get((p[0] + dx, p[1] + dy)) == 2
                and colour(BEFORE, p[0] + dx, p[1] + dy) not in DARKEST
            ]
            forms = {form_of(c) for c in inward if c is not None}
            if len(forms) == 1:
                expected = SHADES["pale-gold" if forms == {"gold"} else "cloud"][0]
                self.assertEqual(actual, expected, p)

    def test_no_two_pixel_darkest_band_remains_on_an_interior_border(self) -> None:
        for p, distance in FIGURE.distance.items():
            if distance != 2 or p in FROZEN or p in OVERRIDDEN:
                continue
            if colour(self.image, *p) not in DARKEST:
                continue
            outer = [
                (p[0] + dx, p[1] + dy)
                for dx, dy in NEIGHBOURS
                if FIGURE.distance.get((p[0] + dx, p[1] + dy)) == 1
                and colour(self.image, p[0] + dx, p[1] + dy) in DARKEST
            ]
            ahead = [
                colour(self.image, p[0] + dx, p[1] + dy)
                for dx, dy in NEIGHBOURS
                if FIGURE.distance.get((p[0] + dx, p[1] + dy)) == 3
                and colour(self.image, p[0] + dx, p[1] + dy) not in DARKEST
            ]
            self.assertFalse(outer and ahead, f"{p} is a second darkest pixel behind {outer}")

    def test_only_palette_colours_and_at_most_sixteen_of_them(self) -> None:
        used = {colour(self.image, *p) for p in FIGURE.opaque}
        self.assertEqual(used - set(PALETTE.colours), set())
        self.assertLessEqual(len(used), 16)

    def test_the_soles_the_midpoint_and_the_height_are_unchanged(self) -> None:
        clusters = sole_clusters(self.image, 2, 2)
        self.assertEqual([(c["x0"], c["x1"] - 1, c["bottom_row"]) for c in clusters], [(22, 29, 79), (34, 41, 79)])
        self.assertEqual(sole_midpoint(self.image, 2, 2), 32.0)
        ys = [y for _, y in FIGURE.opaque]
        self.assertEqual(max(ys) - min(ys) + 1, 54)
        self.assertEqual(min(ys), 26)


if __name__ == "__main__":
    unittest.main()

"""Rules for the C2 idle loop. They pin measurable limits and the declared regions, not a design.

The rules run against `sprite_idle_c2.build()`. Set IDLE_TARGET=missing to run them against four copies of C2c
with only F0 correct (the frames missing) and see which fail.
"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pipeline import Raster, decode_png
from sprite_cleanup_c2b import rgb
from sprite_idle_c2 import (
    BOTTOM_ROW,
    CHEST_DOWN,
    CHEST_UP,
    F2_CHEST_HOLD,
    FRAME_MS,
    PALETTE_JSON,
    REPAIRS,
    RISE,
    SOURCE,
    TOP_ROW,
    build,
    cells_of_move,
    gif_delays_cs,
    changed,
    movable_cells,
    repair_cells,
)
from sprite_downscale import load_palette, sole_clusters, sole_midpoint

if not SOURCE.exists():
    raise unittest.SkipTest("the C2c frame is gitignored scratch and is absent")

PALETTE = set(load_palette(PALETTE_JSON).colours)
BASE = decode_png(SOURCE)
DECLARED = cells_of_move(BASE) | repair_cells(BASE)
MOVED = movable_cells(BASE)


def frames() -> list[Raster]:
    if os.environ.get("IDLE_TARGET") == "missing":
        return [BASE, BASE, BASE, BASE]
    return build()


def colour(image: Raster, x: int, y: int) -> tuple[int, int, int] | None:
    px = image.pixel(x, y)
    return tuple(px[:3]) if px[3] else None  # type: ignore[return-value]


def opaque(image: Raster) -> set[tuple[int, int]]:
    return {(x, y) for y in range(image.height) for x in range(image.width) if image.pixel(x, y)[3]}


class IdleRules(unittest.TestCase):
    def setUp(self) -> None:
        self.frames = frames()

    def test_there_are_four_frames_and_f0_is_c2c_exactly(self) -> None:
        self.assertEqual(len(self.frames), 4)
        self.assertEqual(self.frames[0].rgba, BASE.rgba)

    def test_every_frame_changes_something_but_f0(self) -> None:
        for image in self.frames[1:]:
            self.assertTrue(changed(BASE, image))

    def test_fixed_pixels_are_identical_to_c2c_in_every_frame(self) -> None:
        for index, image in enumerate(self.frames):
            stray = {p for p in changed(BASE, image) if p not in DECLARED}
            self.assertEqual(stray, set(), f"F{index}")

    def test_the_bolt_fist_grip_forearm_belt_robe_hem_and_feet_never_change(self) -> None:
        fixed = {
            (x, y)
            for y in range(80)
            for x in range(64)
            if x <= 24 or y >= 50 or (x >= 38 and y >= 43)
        }
        for index, image in enumerate(self.frames):
            moved = {p for p in changed(BASE, image) if p in fixed}
            self.assertEqual(moved, set(), f"F{index}")

    def test_f1_and_f3_change_only_the_chest_fold_pixels(self) -> None:
        self.assertEqual(changed(BASE, self.frames[1]), {(x, y) for x, y, _ in CHEST_UP})
        self.assertEqual(changed(BASE, self.frames[3]), {(x, y) for x, y, _ in CHEST_DOWN})

    def test_f1_and_f3_stay_at_rest_height(self) -> None:
        for image in (self.frames[1], self.frames[3]):
            ys = [y for _, y in opaque(image)]
            self.assertEqual((min(ys), max(ys)), (min(y for _, y in opaque(BASE)), 79))

    def test_f2_is_the_movable_block_shifted_up_one_apart_from_listed_repairs(self) -> None:
        f2 = self.frames[2]
        repaired = {(x, y) for x, y, _ in REPAIRS}
        head_and_beard = {p for p in MOVED if TOP_ROW <= p[1] <= 40}
        self.assertTrue(head_and_beard)
        for x, y in head_and_beard:
            if (x, y - RISE) in repaired:
                continue
            self.assertEqual(colour(f2, x, y - RISE), colour(BASE, x, y), (x, y))
        self.assertEqual(min(y for x, y in opaque(f2) if 29 <= x <= 32 and y < 36), TOP_ROW - RISE)

    def test_f2_moves_the_whole_block_and_nothing_below_the_band(self) -> None:
        f2 = self.frames[2]
        for x, y in MOVED:
            if (x, y - RISE) not in {(a, b) for a, b, _ in REPAIRS}:
                self.assertEqual(colour(f2, x, y - RISE), colour(BASE, x, y), (x, y))
        held = {(x, y) for x, y, _ in F2_CHEST_HOLD}
        self.assertEqual({p for p in changed(BASE, f2) if p[1] > BOTTOM_ROW and p not in held}, set())

    def test_the_repair_pixels_are_exactly_as_listed(self) -> None:
        for x, y, hex_colour in REPAIRS:
            self.assertEqual(colour(self.frames[2], x, y), rgb(hex_colour), (x, y))

    def test_f2_holds_f1s_raised_chest_fold_at_the_two_pinned_pixels(self) -> None:
        pinned = {(26, 49): "#f3f0dc", (29, 46): "#c7d8d4"}
        self.assertEqual({(x, y) for x, y, _ in F2_CHEST_HOLD}, set(pinned))
        for (x, y), hex_colour in pinned.items():
            self.assertEqual(colour(self.frames[2], x, y), rgb(hex_colour), (x, y))
            self.assertEqual(colour(self.frames[2], x, y), colour(self.frames[1], x, y), (x, y))
            self.assertIn((x, y), changed(BASE, self.frames[2]))

    def test_only_palette_colours_at_most_sixteen_and_binary_alpha_in_every_frame(self) -> None:
        for index, image in enumerate(self.frames):
            used = {colour(image, *p) for p in opaque(image)}
            self.assertEqual(used - PALETTE, set(), f"F{index}")
            self.assertLessEqual(len(used), 16)
            self.assertEqual({image.pixel(x, y)[3] for y in range(80) for x in range(64)} - {0, 255}, set())

    def test_the_soles_and_their_midpoint_are_unchanged_in_every_frame(self) -> None:
        for index, image in enumerate(self.frames):
            clusters = sole_clusters(image, 2, 2)
            self.assertEqual(
                [(c["x0"], c["x1"] - 1, c["bottom_row"]) for c in clusters], [(22, 29, 79), (34, 41, 79)], f"F{index}"
            )
            self.assertEqual(sole_midpoint(image, 2, 2), 32.0)

    def test_every_frame_is_at_most_56_tall_and_one_connected_silhouette(self) -> None:
        for index, image in enumerate(self.frames):
            points = opaque(image)
            ys = [y for _, y in points]
            self.assertLessEqual(max(ys) - min(ys) + 1, 56, f"F{index}")
            left, groups = set(points), 0
            while left:
                groups += 1
                stack = [left.pop()]
                while stack:
                    x, y = stack.pop()
                    for dx in (-1, 0, 1):
                        for dy in (-1, 0, 1):
                            n = (x + dx, y + dy)
                            if n in left:
                                left.discard(n)
                                stack.append(n)
            self.assertEqual(groups, 1, f"F{index}")

    def test_exterior_pixels_keep_the_darkest_shade_rule_in_every_frame(self) -> None:
        darkest = set(load_palette(PALETTE_JSON).darkest.values())
        for index, image in enumerate(self.frames):
            points = opaque(image)
            base_points = opaque(BASE)
            for p in points:
                if any((p[0] + dx, p[1] + dy) not in points for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    if p in base_points and any(
                        (p[0] + dx, p[1] + dy) not in base_points for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                    ):
                        continue
                    self.assertIn(colour(image, *p), darkest, f"F{index} {p}")


class IdleTiming(unittest.TestCase):
    def test_the_per_frame_durations_are_the_owners_hold_timing(self) -> None:
        self.assertEqual(FRAME_MS, (333, 167, 333, 167))
        self.assertEqual(sum(FRAME_MS), 1000)

    def test_gif_delays_are_whole_centiseconds_that_keep_the_loop_at_one_second(self) -> None:
        self.assertEqual(gif_delays_cs(FRAME_MS), (33, 17, 33, 17))
        self.assertEqual(sum(gif_delays_cs(FRAME_MS)), 100)


if __name__ == "__main__":
    unittest.main()

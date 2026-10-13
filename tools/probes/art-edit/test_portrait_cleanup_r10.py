import unittest

from portrait_cleanup_r10 import (
    BACKGROUND,
    BROWN,
    CREAM,
    EXTERIOR,
    EYE_RECTS,
    KEEP,
    MOUTH_BOX,
    ORANGE,
    OUTLINE,
    apply_changes,
    bounding_boxes,
    mouth_protected,
    plan_frame,
)

SKIN = (244, 228, 174)  # J
GOLD = (221, 191, 112)  # G
GREY = (143, 166, 173)  # F, a cool mid-tone


def blank(colour=SKIN):
    return [[colour for _ in range(96)] for _ in range(96)]


def put(frame, x, y, colour):
    frame[y][x] = colour


def changed_at(changes):
    return {(c["x"], c["y"]): c for c in changes}


def refused(exclusions, rule, x, y):
    return [e["reason"] for e in exclusions if (e["rule"], e["x"], e["y"]) == (rule, x, y)]


class IsolatedPixel(unittest.TestCase):
    def test_a_lone_pixel_takes_the_majority_of_its_four_neighbours(self):
        frame = blank()
        put(frame, 20, 70, ORANGE)
        put(frame, 20, 69, GOLD)
        put(frame, 21, 70, GOLD)
        put(frame, 19, 70, GOLD)
        changes, _ = plan_frame(frame)
        hit = changed_at(changes)[(20, 70)]
        self.assertEqual((hit["rule"], tuple(hit["to"])), ("isolated", GOLD))

    def test_a_diagonal_stroke_is_kept(self):
        frame = blank()
        put(frame, 20, 70, ORANGE)
        put(frame, 21, 71, ORANGE)
        changes, exclusions = plan_frame(frame)
        self.assertEqual(changes, [])
        self.assertEqual(refused(exclusions, "isolated", 20, 70), ["diagonal"])

    def test_a_pixel_touching_a_line_is_kept(self):
        frame = blank()
        put(frame, 20, 70, GREY)
        put(frame, 21, 70, OUTLINE)
        changes, exclusions = plan_frame(frame)
        self.assertEqual(changes, [])
        self.assertEqual(refused(exclusions, "isolated", 20, 70), ["line"])

    def test_line_colours_are_never_replaced(self):
        frame = blank()
        put(frame, 20, 70, OUTLINE)
        put(frame, 30, 70, BROWN)
        self.assertEqual(plan_frame(frame)[0], [])


class Protection(unittest.TestCase):
    def test_nothing_inside_the_eye_rectangles_changes(self):
        for x0, y0, x1, y1 in EYE_RECTS:
            frame = blank()
            put(frame, (x0 + x1) // 2, (y0 + y1) // 2, ORANGE)
            changes, exclusions = plan_frame(frame)
            self.assertEqual(changes, [])
            self.assertEqual(
                refused(exclusions, "isolated", (x0 + x1) // 2, (y0 + y1) // 2), ["eye"]
            )

    def test_a_mouth_line_and_the_pixels_touching_it_stay(self):
        frame = blank()
        for x in range(52, 60):
            put(frame, x, 50, OUTLINE)
        put(frame, 55, 51, CREAM)
        put(frame, 55, 49, ORANGE)
        changes, exclusions = plan_frame(frame)
        self.assertEqual(changes, [])
        self.assertEqual(refused(exclusions, "isolated", 55, 51), ["mouth"])
        self.assertEqual(refused(exclusions, "isolated", 55, 49), ["mouth"])

    def test_a_lone_grey_speck_in_the_mouth_box_is_not_a_line(self):
        frame = blank()
        x, y = MOUTH_BOX[0] + 4, MOUTH_BOX[1] + 4
        put(frame, x, y, GREY)
        changes, _ = plan_frame(frame)
        self.assertEqual([(c["x"], c["y"]) for c in changes], [(x, y)])
        self.assertEqual(tuple(changes[0]["to"]), SKIN)


class MouthGuardAndBackground(unittest.TestCase):
    def contour(self):
        """A skin face with its navy contour at x=67 and background beyond, across the mouth box."""
        frame = blank()
        for y in range(36, 60):
            put(frame, 67, y, OUTLINE)
            for x in range(68, 80):
                put(frame, x, y, BACKGROUND)
        return frame

    def test_background_pixels_are_never_mouth_line_candidates(self):
        frame = self.contour()
        protected = mouth_protected(frame)
        # Background two or more pixels from the contour would only be shielded
        # if background pixels counted as lines and spread their own halo.
        for y in range(MOUTH_BOX[1], MOUTH_BOX[3] + 1):
            for x in range(69, MOUTH_BOX[2] + 1):
                self.assertNotIn((x, y), protected)
        # The pixel above the box beside the contour is not reached either.
        self.assertNotIn((68, MOUTH_BOX[1] - 1), protected)
        # The navy contour in the box is still a line, so its skin side stays shielded.
        self.assertIn((67, 50), protected)
        self.assertIn((66, 50), protected)

    def test_a_grey_spur_just_above_the_box_is_not_shielded_by_background_below_it(self):
        frame = self.contour()
        put(frame, 68, 40, (99, 123, 137))  # the spur outside the contour
        changes, exclusions = plan_frame(frame)
        hit = changed_at(changes)[(68, 40)]
        self.assertEqual((hit["rule"], tuple(hit["to"])), ("outline", BACKGROUND))
        self.assertEqual(refused(exclusions, "outline", 68, 40), [])

    def test_a_cool_pixel_touching_only_background_is_not_a_line(self):
        frame = blank()
        x, y = MOUTH_BOX[0] + 4, MOUTH_BOX[1] + 4
        put(frame, x, y, GREY)
        put(frame, x + 1, y, BACKGROUND)
        self.assertNotIn((x, y), mouth_protected(frame))


class Exceptions(unittest.TestCase):
    def lone_gold(self, x, y):
        frame = blank(CREAM)
        put(frame, x, y, GOLD)
        return frame

    def test_every_kept_pixel_is_left_as_generated_and_logged_with_its_reason(self):
        self.assertEqual(len(KEEP), 4)
        for (name, x, y), reason in KEEP.items():
            self.assertTrue(reason)
            changes, exclusions = plan_frame(self.lone_gold(x, y), name)
            self.assertEqual(changes, [], (name, x, y))
            self.assertEqual(
                refused(exclusions, "isolated", x, y), [f"exception: {reason}"]
            )

    def test_a_kept_pixel_is_only_kept_in_its_own_frame(self):
        (name, x, y) = next(iter(KEEP))
        other = "neutral" if name != "neutral" else "angry"
        changes, _ = plan_frame(self.lone_gold(x, y), other)
        self.assertEqual([(c["x"], c["y"]) for c in changes], [(x, y)])
        changes, _ = plan_frame(self.lone_gold(x, y))
        self.assertEqual([(c["x"], c["y"]) for c in changes], [(x, y)])

    def test_the_exterior_pixel_becomes_background_in_every_frame(self):
        x, y, _ = EXTERIOR[0]
        for name in ("neutral", "angry", "awed"):
            frame = blank(BACKGROUND)
            put(frame, x, y, GREY)
            put(frame, x, y - 1, OUTLINE)
            put(frame, x - 1, y, BROWN)
            put(frame, x + 1, y, GREY)
            changes, _ = plan_frame(frame, name)
            hit = changed_at(changes)[(x, y)]
            self.assertEqual(
                (hit["rule"], tuple(hit["to"])), ("exterior", BACKGROUND), name
            )

    def test_an_exterior_pixel_that_is_not_a_cool_mid_tone_is_left_and_logged(self):
        x, y, _ = EXTERIOR[0]
        frame = blank(BACKGROUND)
        put(frame, x, y, SKIN)
        changes, exclusions = plan_frame(frame)
        self.assertNotIn((x, y), changed_at(changes))
        self.assertEqual(len(refused(exclusions, "exterior", x, y)), 1)


class Fleck(unittest.TestCase):
    def test_a_small_orange_group_in_the_beard_takes_its_ring_colour(self):
        frame = blank()
        put(frame, 40, 75, ORANGE)
        put(frame, 41, 75, ORANGE)
        changes, _ = plan_frame(frame)
        self.assertEqual(
            {(c["x"], c["y"], c["rule"], tuple(c["to"])) for c in changes},
            {(40, 75, "fleck", SKIN), (41, 75, "fleck", SKIN)},
        )

    def test_a_cream_cluster_over_the_limit_is_kept(self):
        frame = blank()
        for x in range(40, 45):
            put(frame, x, 75, CREAM)
        self.assertEqual(plan_frame(frame)[0], [])

    def test_a_group_outside_the_beard_zone_is_kept(self):
        frame = blank()
        put(frame, 10, 75, ORANGE)
        put(frame, 11, 75, ORANGE)
        self.assertEqual(plan_frame(frame)[0], [])

    def test_a_group_touching_a_line_is_kept(self):
        frame = blank()
        put(frame, 40, 75, ORANGE)
        put(frame, 41, 75, ORANGE)
        put(frame, 42, 75, OUTLINE)
        changes, exclusions = plan_frame(frame)
        self.assertEqual(changes, [])
        self.assertEqual(refused(exclusions, "fleck", 40, 75), ["line"])


class Outline(unittest.TestCase):
    def edge(self):
        frame = blank(BACKGROUND)
        for y in range(10, 30):
            put(frame, 30, y, OUTLINE)
            for x in range(10, 30):
                put(frame, x, y, SKIN)
        return frame

    def test_a_mid_tone_pixel_doubling_the_outline_becomes_background(self):
        frame = self.edge()
        put(frame, 31, 20, GREY)
        changes, _ = plan_frame(frame)
        hit = changed_at(changes)[(31, 20)]
        self.assertEqual((hit["rule"], tuple(hit["to"])), ("outline", BACKGROUND))

    def test_a_mid_tone_gap_in_a_straight_outline_becomes_outline(self):
        frame = self.edge()
        put(frame, 30, 20, GREY)
        changes, _ = plan_frame(frame)
        hit = changed_at(changes)[(30, 20)]
        self.assertEqual((hit["rule"], tuple(hit["to"])), ("outline", OUTLINE))

    def test_a_clean_outline_is_untouched(self):
        self.assertEqual(plan_frame(self.edge())[0], [])


class Plan(unittest.TestCase):
    def test_the_plan_is_deterministic_and_from_one_frame_alone(self):
        frame = blank()
        put(frame, 20, 70, ORANGE)
        put(frame, 40, 75, CREAM)
        put(frame, 41, 75, CREAM)
        self.assertEqual(plan_frame(frame), plan_frame([row[:] for row in frame]))

    def test_applying_the_plan_changes_exactly_the_listed_pixels(self):
        frame = blank()
        put(frame, 20, 70, ORANGE)
        put(frame, 40, 75, CREAM)
        put(frame, 41, 75, CREAM)
        changes, _ = plan_frame(frame)
        after = apply_changes(frame, changes)
        differing = {
            (x, y) for y in range(96) for x in range(96) if frame[y][x] != after[y][x]
        }
        self.assertEqual(differing, {(c["x"], c["y"]) for c in changes})
        self.assertEqual(plan_frame(after)[0], [])

    def test_boxes_cover_the_connected_groups(self):
        changes = [
            {"x": 5, "y": 5},
            {"x": 6, "y": 6},
            {"x": 20, "y": 30},
        ]
        boxes = bounding_boxes(changes)
        self.assertEqual(boxes["all"], {"x0": 5, "y0": 5, "x1": 20, "y1": 30})
        self.assertEqual(
            sorted(g["pixels"] for g in boxes["groups"]), [1, 2]
        )
        self.assertEqual(bounding_boxes([]), {"all": None, "groups": []})


if __name__ == "__main__":
    unittest.main()

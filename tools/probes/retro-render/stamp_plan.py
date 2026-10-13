"""Authored face stamps for Zeus (brow and eyes only, a few pixels, none on the north facing) and their placement.

Pure, standard library only. The stamp is authored pixel art, not rendered: its pixels are fixed offsets from a locator, the
projected centre of the (hidden) eye mesh in each pose. A stamp pixel is drawn only on a pixel the render left as `head`, so
hair and beard that cover the face also cover the stamp.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

EYE_RAMP, EYE_SHADE = "lapis", 0
BROW_RAMP, BROW_SHADE = "marble", 0
# (ramp, shade) of the eye and the brow per character: Zeus has lapis eyes under white brows, the mortal dark eyes under dark brows.
FACE_COLOURS = {"zeus": (("lapis", 0), ("marble", 0)), "zeus-tall": (("lapis", 0), ("marble", 0)), "mortal": (("soil", 0), ("soil", 1))}

# Offsets (dx, dy) from the eye's pixel. "l" is the character's left eye. In the south view the character's left is
# screen-right, so each brow tips outward and up; in profile a single near eye gets a two-pixel brow reaching forward.
FACE = {
    "south": {"eyes": ("l", "r"), "brow": {"l": ((0, -1), (1, -1)), "r": ((-1, -1), (0, -1))}},
    "east": {"eyes": ("near",), "brow": {"near": ((0, -1), (1, -1))}},
    "west": {"eyes": ("near",), "brow": {"near": ((-1, -1), (0, -1))}},
    "north": {"eyes": (), "brow": {}},
}
EYE_PIXEL = ((0, 0),)


def pixel_of(px: float, py: float) -> tuple[int, int]:
    """Pixel containing a point given in pixel-edge coordinates."""
    return (math.floor(px), math.floor(py))


def near_eye(eyes: dict[str, tuple[float, float, float]]) -> str:
    """The eye the camera sees in profile: the one with the smaller camera depth."""
    return min(eyes, key=lambda k: eyes[k][2])


def face_pixels(
    facing: str,
    eyes: dict[str, tuple[float, float, float]],
    parts: Sequence[str | None],
    width: int,
    height: int,
    eye_rgb: tuple[int, int, int],
    brow_rgb: tuple[int, int, int],
) -> dict:
    """Draw plan for one pose. `eyes` maps "l"/"r" to (x, y, depth) in cell pixels. Returns the pixels to draw by cell
    index, plus counts of planned and skipped pixels (covered by hair, beard or outside the head)."""
    spec = FACE[facing]
    drawn: dict[int, tuple[int, int, int]] = {}
    planned = skipped = 0
    for slot in spec["eyes"]:
        key = near_eye(eyes) if slot == "near" else slot
        ex, ey, _ = eyes[key]
        bx, by = pixel_of(ex, ey)
        for colour, offsets in ((eye_rgb, EYE_PIXEL), (brow_rgb, spec["brow"][slot])):
            for dx, dy in offsets:
                x, y = bx + dx, by + dy
                planned += 1
                if 0 <= x < width and 0 <= y < height and parts[y * width + x] == "head":
                    drawn[y * width + x] = colour
                else:
                    skipped += 1
    return {"drawn": drawn, "planned": planned, "skipped": skipped}


def stamp_pixel_count(facing: str) -> int:
    spec = FACE[facing]
    return sum(len(EYE_PIXEL) + len(spec["brow"][slot]) for slot in spec["eyes"])


def preview(facing: str, scale: int = 1) -> list[str]:
    """ASCII preview of the stamp around the eye pixel: E eye, B brow, . empty."""
    spec = FACE[facing]
    cells: dict[tuple[int, int], str] = {}
    shift = {"l": 3, "r": -3, "near": 0}
    for slot in spec["eyes"]:
        ox = shift[slot]
        for dx, dy in EYE_PIXEL:
            cells[(ox + dx, dy)] = "E"
        for dx, dy in spec["brow"][slot]:
            cells[(ox + dx, dy)] = "B"
    if not cells:
        return ["(none)"]
    xs, ys = [c[0] for c in cells], [c[1] for c in cells]
    return ["".join(cells.get((x, y), ".") for x in range(min(xs), max(xs) + 1)) for y in range(min(ys), max(ys) + 1)]

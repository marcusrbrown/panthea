"""Contact shadows and canvas envelopes for the retro-render probe. Pure; standard library only.

A contact shadow is a small solid ground ellipse under a character or a tree trunk, in one palette colour (binary alpha). Round 2
gave it a checkerboard rim; that read as noise at 3x, so round 3 keeps only the solid shape. It is drawn only on pixels the figure
left empty, after the exterior outline, so it is never outlined and never hides the figure.
"""

from __future__ import annotations

import math
from collections.abc import Sequence



def shadow_pixels(width: int, height: int, centre: tuple[float, float], rx: float, ry: float) -> dict[int, str]:
    """Cell index -> "core" for every pixel whose centre lies inside a 2:1 ground ellipse centred on `centre` (pixel-edge coordinates)."""
    out: dict[int, str] = {}
    if rx <= 0 or ry <= 0:
        return out
    for y in range(max(0, math.floor(centre[1] - ry)), min(height, math.ceil(centre[1] + ry) + 1)):
        for x in range(max(0, math.floor(centre[0] - rx)), min(width, math.ceil(centre[0] + rx) + 1)):
            d = ((x + 0.5 - centre[0]) / rx) ** 2 + ((y + 0.5 - centre[1]) / ry) ** 2
            if d <= 1.0:
                out[y * width + x] = "core"
    return out


def apply_shadow(rgba: bytes, width: int, height: int, shadow: dict[int, str], colour: tuple[int, int, int]) -> bytes:
    """Draw the shadow on transparent pixels only."""
    out = bytearray(rgba)
    for i in shadow:
        if out[i * 4 + 3] == 0:
            out[i * 4 : i * 4 + 4] = bytes((*colour, 255))
    return bytes(out)


# --- envelope ---------------------------------------------------------------------------------------------------------


def envelope(boxes: Sequence[tuple[int, int, int, int]], pivot: tuple[float, float], cell: tuple[int, int]) -> dict:
    """Extent of every figure in a set of cells, as distances from the pivot, plus the margin left to each canvas edge.

    `boxes` are opaque bounding boxes (x0, y0, x1, y1), exclusive upper bounds. Distances are positive outward: `up` is how far
    the highest pixel is above the pivot, `down` how far the lowest is below it.
    """
    if not boxes:
        raise ValueError("no boxes")
    x0 = min(b[0] for b in boxes)
    y0 = min(b[1] for b in boxes)
    x1 = max(b[2] for b in boxes)
    y1 = max(b[3] for b in boxes)
    out = {"left": pivot[0] - x0, "right": x1 - pivot[0], "up": pivot[1] - y0, "down": y1 - pivot[1]}
    out["margin"] = {"left": x0, "right": cell[0] - x1, "top": y0, "bottom": cell[1] - y1}
    out["clipped"] = min(out["margin"].values()) < 0 or x0 < 0 or y0 < 0 or x1 > cell[0] or y1 > cell[1]
    out["min_margin"] = min(out["margin"].values())
    return out


def pivot_for(env: dict, cell: tuple[int, int], margin: int) -> tuple[float, float]:
    """Pivot that gives `margin` px clear of the envelope on the tighter axis sides, centring the slack on each axis.

    Horizontal: the envelope is centred (equal slack left and right). Vertical: equal slack above and below.
    """
    width_span = env["left"] + env["right"]
    height_span = env["up"] + env["down"]
    if width_span + 2 * margin > cell[0] or height_span + 2 * margin > cell[1]:
        raise ValueError("the envelope does not fit the canvas with that margin")
    px = env["left"] + (cell[0] - width_span) / 2
    py = env["up"] + (cell[1] - height_span) / 2
    return (round(px), round(py))

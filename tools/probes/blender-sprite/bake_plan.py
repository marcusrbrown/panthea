"""Pure helpers for the surface-anchored shading (round 3) and the bolt-stamp placement. Standard library only.

Surface-anchored shading: a fixed upper-left light is baked, in rest pose and object space, into a per-corner value
on every mesh; the material turns that value into palette shades with a constant ramp and renders it unlit. The value
rides on the surface, so it moves with the cloth and limbs instead of crawling across them.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

Vec = tuple[float, float, float]

AMBIENT = 0.42
# Shadow / mid / light cut points on the baked value (owner direction: 3 shades per material plus the outline).
BAKE_THRESHOLDS = (0.46, 0.64)
# Ramp shades used for shadow, mid, light. Shade 0, the darkest, is kept for the outline.
BAKE_SHADES = (1, 2, 3)
ROLE_RAMP_S3 = {"skin": "pale-gold", "robe": "cloud", "trim": "pale-gold", "hair": "marble", "bolt": "pale-gold", "seat": "marble"}


@dataclass(frozen=True)
class Variant:
    id: str
    label: str


S3 = Variant("s3", "surface-anchored: fixed upper-left light baked in rest pose, 3 shades per material, unlit")
B2 = Variant("b2", "round 2 two-tone light-threshold shading (compared, not redone)")
VARIANTS = (S3, B2)


def rotate_z(v: Vec, degrees: float) -> Vec:
    a = math.radians(degrees)
    c, s = math.cos(a), math.sin(a)
    return (v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2])


def object_space_light(toward_light_world: Vec, yaw_deg: float) -> Vec:
    """Light direction in the figure's own rest space for a figure turned `yaw_deg` about the vertical axis.

    The light is fixed on screen (upper left), so each facing needs its own bake: object-space light is the world-space
    light turned back by the facing's yaw.
    """
    return rotate_z(toward_light_world, -yaw_deg)


def lambert_value(normal: Vec, light: Vec, ambient: float = AMBIENT) -> float:
    """Baked value in [ambient, 1]: ambient plus the clamped cosine to the light."""
    n = math.sqrt(sum(c * c for c in normal)) or 1.0
    l = math.sqrt(sum(c * c for c in light)) or 1.0
    cosine = sum(a * b for a, b in zip(normal, light, strict=True)) / (n * l)
    return ambient + (1.0 - ambient) * max(0.0, cosine)


def shade_index(value: float, thresholds: Sequence[float] = BAKE_THRESHOLDS) -> int:
    """0 shadow, 1 mid, 2 light."""
    return sum(1 for t in thresholds if value >= t)


def ramp_stops(thresholds: Sequence[float] = BAKE_THRESHOLDS, shades: Sequence[int] = BAKE_SHADES) -> list[tuple[float, int]]:
    if len(shades) != len(thresholds) + 1:
        raise ValueError("one shade per band")
    return list(zip((0.0, *thresholds), shades, strict=True))


# --- bolt stamp placement ---------------------------------------------------------------------------------------


def screen_angle_deg(base: Sequence[float], tip: Sequence[float]) -> float:
    """Direction from base to tip in degrees counter-clockwise from screen right (screen y points down)."""
    return math.degrees(math.atan2(-(tip[1] - base[1]), tip[0] - base[0])) % 360.0


def nearest_angle(angle_deg: float, step: int = 45) -> int:
    return int(round((angle_deg % 360) / step) * step) % 360


def stamp_origin(base: Sequence[float], tip: Sequence[float], anchor: Sequence[int], push_px: float = 2.0) -> tuple[int, int]:
    """Top-left cell position of a stamp whose grip anchor sits `push_px` beyond the hand's bolt base, toward the tip."""
    dx, dy = tip[0] - base[0], tip[1] - base[1]
    length = math.hypot(dx, dy)
    ux, uy = (dx / length, dy / length) if length > 1e-6 else (0.0, 0.0)
    gx, gy = base[0] + ux * push_px, base[1] + uy * push_px
    return (round(gx) - anchor[0], round(gy) - anchor[1])


def composite_stamp(
    stamp_pixels: dict[tuple[int, int], tuple[int, int, int]],
    origin: tuple[int, int],
    stamp_depth: float,
    parts: Sequence[str | None],
    depths: Sequence[float],
    width: int,
    height: int,
    depth_tolerance: float = 0.06,
    protected_parts: Sequence[str] = ("hand_r",),
) -> dict:
    """Place a stamp using the part-ID and depth maps for occlusion.

    A stamp pixel is hidden where a body part nearer than the stamp (by more than `depth_tolerance`, metres) covers the
    cell pixel, and is never drawn over `protected_parts` (the bolt hand stays distinct). Pixels outside the cell are
    clipped. Returns the drawn pixels by cell index, and counts of drawn, occluded, protected and clipped pixels.
    """
    drawn: dict[int, tuple[int, int, int]] = {}
    occluded = protected = clipped = 0
    for (sx, sy), colour in stamp_pixels.items():
        x, y = origin[0] + sx, origin[1] + sy
        if not (0 <= x < width and 0 <= y < height):
            clipped += 1
            continue
        i = y * width + x
        if parts[i] in protected_parts:
            protected += 1
            continue
        if parts[i] is not None and depths[i] < stamp_depth - depth_tolerance:
            occluded += 1
            continue
        drawn[i] = colour
    return {"drawn": drawn, "occluded": occluded, "protected": protected, "clipped": clipped, "total": len(stamp_pixels)}

"""Pure helpers for the Blender sprite probe: camera maths, frame sampling, output names.

Standard library only, so Blender's bundled Python can import it from render.py and the
unit tests can run without Blender. Nothing here touches bpy.

Coordinates: world is Blender's (X right, Y forward, Z up). Screen pixels are (x right,
y down) in the 64x80 cell, with the pivot at ANCHOR.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

Vec = tuple[float, float, float]

CELL = (64, 80)
SUPERSAMPLE = 4
# The sole midpoint goes to x=32. Vertically the figure's lowest screen point (the toe of the foot nearest the
# camera, which sits below the sole midpoint in an oblique view) goes to y=79 in pixel-edge coordinates: the 1 px
# outline the post step adds then sits on row 79 and the bounding box ends on y=80, the pivot the atlas declares.
PIVOT_X = 32.0
BOTTOM_EDGE_Y = 79.0
ANCHOR = (PIVOT_X, BOTTOM_EDGE_Y)  # provisional; anchor_for_bottom() moves y so the whole clip set fits
# Figure height without outline. Plus the outline row above and below it gives the 52 px total (guide: 48-56).
INTERIOR_HEIGHT_PX = 50
OUTLINE_ROWS = 2
# 2:1 game isometric: the camera looks down 30 degrees (X 60 from straight down), turned 45 degrees about Z.
CAMERA_ROT_DEG = (60.0, 0.0, 45.0)
CAMERA_DISTANCE = 20.0
# Key light from the upper left of the screen, a little toward the viewer: (right, up, toward-camera) weights.
KEY_LIGHT_SCREEN = (-0.62, 0.55, 0.56)

DIRECTIONS = ("south", "east", "north", "west")


@dataclass(frozen=True)
class ClipSpec:
    id: str
    action: str
    frames: int
    loop: bool


CLIPS = (
    ClipSpec("idle", "Idle_Loop", 4, True),
    ClipSpec("walk", "Walk_Loop", 6, True),
    ClipSpec("cast", "Spell_Simple_Shoot", 5, False),
    ClipSpec("sit", "Sitting_Idle_Loop", 2, True),
)


def _dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _norm(v: Vec) -> Vec:
    length = math.sqrt(_dot(v, v))
    if length == 0:
        raise ValueError("zero-length vector")
    return (v[0] / length, v[1] / length, v[2] / length)


def _matvec(m: tuple[Vec, Vec, Vec], v: Vec) -> Vec:
    return (_dot(m[0], v), _dot(m[1], v), _dot(m[2], v))


def euler_xyz_matrix(deg: tuple[float, float, float]) -> tuple[Vec, Vec, Vec]:
    """Rotation matrix for Blender's default XYZ euler order (R = Rz Ry Rx), rows as tuples."""
    ax, ay, az = (math.radians(d) for d in deg)
    cx, sx, cy, sy, cz, sz = math.cos(ax), math.sin(ax), math.cos(ay), math.sin(ay), math.cos(az), math.sin(az)
    return (
        (cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx),
        (sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx),
        (-sy, cy * sx, cy * cx),
    )


@dataclass(frozen=True)
class CameraAxes:
    right: Vec
    up: Vec
    back: Vec  # from the scene toward the camera

    @property
    def view_direction(self) -> Vec:
        return (-self.back[0], -self.back[1], -self.back[2])


def camera_axes(rot_deg: tuple[float, float, float] = CAMERA_ROT_DEG) -> CameraAxes:
    """Camera basis in world space. A Blender camera looks down its local -Z with +Y up and +X right."""
    m = euler_xyz_matrix(rot_deg)
    return CameraAxes(
        right=_matvec(m, (1.0, 0.0, 0.0)),
        up=_matvec(m, (0.0, 1.0, 0.0)),
        back=_matvec(m, (0.0, 0.0, 1.0)),
    )


def ground_diamond_ratio(axes: CameraAxes) -> float:
    """Height over width of the on-screen diamond a ground tile makes (2:1 isometric gives 0.5).

    A tile's diagonals run along the screen-right axis and along the ground part of the view direction.
    Width is the unit step along screen-right; height is the screen-vertical extent of a unit step along
    the ground projection of the view direction.
    """
    flat = _norm((axes.back[0], axes.back[1], 0.0))
    return abs(_dot(flat, axes.up)) / abs(_dot(axes.right, (axes.right[0], axes.right[1], 0.0)))


def px_per_unit(interior_px: float, extent_units: float) -> float:
    """Pixels per world unit so a figure whose screen-vertical extent is `extent_units` spans `interior_px`."""
    if extent_units <= 0 or interior_px <= 0:
        raise ValueError("extent and target must be positive")
    return interior_px / extent_units


def ortho_scale(cell_h_px: int, ppu: float) -> float:
    """Blender ortho_scale with sensor_fit VERTICAL: world units spanned by the cell height."""
    return cell_h_px / ppu


def anchor_for_bottom(provisional_y: float, lowest_y: float, target_y: float = BOTTOM_EDGE_Y) -> float:
    """Anchor row that puts the lowest screen point (measured with `provisional_y`) at `target_y`."""
    return provisional_y + (target_y - lowest_y)


def camera_location(
    pivot: Vec,
    axes: CameraAxes,
    ppu: float,
    anchor: tuple[float, float] = ANCHOR,
    cell: tuple[int, int] = CELL,
    distance: float = CAMERA_DISTANCE,
) -> Vec:
    """Camera position that puts `pivot` at pixel `anchor`.

    The pivot sits at the image centre when the camera looks straight at it. Moving the camera up along its own
    up axis moves the subject down the image by the same distance, so offset by the anchor's distance from centre.
    """
    dx = (anchor[0] - cell[0] / 2) / ppu
    dy = (anchor[1] - cell[1] / 2) / ppu
    return (
        pivot[0] + axes.back[0] * distance + axes.up[0] * dy - axes.right[0] * dx,
        pivot[1] + axes.back[1] * distance + axes.up[1] * dy - axes.right[1] * dx,
        pivot[2] + axes.back[2] * distance + axes.up[2] * dy - axes.right[2] * dx,
    )


def project(
    point: Vec,
    pivot: Vec,
    axes: CameraAxes,
    ppu: float,
    anchor: tuple[float, float] = ANCHOR,
) -> tuple[float, float]:
    """Pixel (x right, y down, edge coordinates) of a world point in the 1x cell."""
    rel = (point[0] - pivot[0], point[1] - pivot[1], point[2] - pivot[2])
    return (anchor[0] + _dot(rel, axes.right) * ppu, anchor[1] - _dot(rel, axes.up) * ppu)


def screen_extent_units(points: list[Vec], axes: CameraAxes) -> float:
    """Screen-vertical extent of a point set in world units."""
    heights = [_dot(p, axes.up) for p in points]
    return max(heights) - min(heights)


def key_light_toward(axes: CameraAxes, weights: Vec = KEY_LIGHT_SCREEN) -> Vec:
    """Unit world vector from the scene toward the key light (a sun shines along its negative)."""
    wr, wu, wb = weights
    return _norm(
        (
            axes.right[0] * wr + axes.up[0] * wu + axes.back[0] * wb,
            axes.right[1] * wr + axes.up[1] * wu + axes.back[1] * wb,
            axes.right[2] * wr + axes.up[2] * wu + axes.back[2] * wb,
        )
    )


def facing_vectors(axes: CameraAxes) -> dict[str, tuple[float, float]]:
    """Unit world XY heading for each screen-relative facing.

    south faces the viewer (down the screen), north faces away, east is screen right and west screen left, so
    east and west are exact mirror images of each other on screen.
    """
    back = _norm((axes.back[0], axes.back[1], 0.0))
    right = _norm((axes.right[0], axes.right[1], 0.0))
    return {
        "south": (back[0], back[1]),
        "east": (right[0], right[1]),
        "north": (-back[0], -back[1]),
        "west": (-right[0], -right[1]),
    }


def heading_deg(xy: tuple[float, float]) -> float:
    return math.degrees(math.atan2(xy[1], xy[0]))


def yaw_to_face(model_forward_xy: tuple[float, float], target_xy: tuple[float, float]) -> float:
    """Rotation about +Z (degrees, counter-clockwise from above, in (-180, 180]) that turns the model's forward onto the target."""
    delta = heading_deg(target_xy) - heading_deg(model_forward_xy)
    delta = (delta + 180.0) % 360.0 - 180.0
    return 180.0 if delta == -180.0 else delta


def sample_frames(start: float, end: float, count: int, loop: bool) -> list[float]:
    """Source frames to render from an action spanning [start, end].

    A loop's last frame is its first again, so the samples are evenly spaced over [start, end) and the end is left out.
    A one-shot includes both ends. Fractional frames are kept; Blender evaluates sub-frames.
    """
    if count < 1:
        raise ValueError("count must be at least 1")
    if end < start:
        raise ValueError("end before start")
    if count == 1:
        return [float(start)]
    span = end - start
    divisor = count if loop else count - 1
    return [round(start + span * i / divisor, 6) for i in range(count)]


def output_name(clip: str, direction: str, index: int, variant: str) -> str:
    """Deterministic file name, e.g. `walk_east_03.direct.png`."""
    if direction not in DIRECTIONS:
        raise ValueError(f"unknown direction {direction!r}")
    if variant not in ("direct", "x4", "id", "depth"):
        raise ValueError(f"unknown variant {variant!r}")
    return f"{clip}_{direction}_{index:02d}.{variant}.png"


def render_size(variant: str, cell: tuple[int, int] = CELL) -> tuple[int, int]:
    factor = SUPERSAMPLE if variant == "x4" else 1
    return cell[0] * factor, cell[1] * factor


def srgb_to_linear(channel: int) -> float:
    c = channel / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(value: str) -> tuple[float, float, float]:
    raw = bytes.fromhex(value.removeprefix("#"))
    return (srgb_to_linear(raw[0]), srgb_to_linear(raw[1]), srgb_to_linear(raw[2]))


def linear_to_srgb(value: float) -> float:
    v = min(1.0, max(0.0, value))
    return v * 12.92 if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055


# Round 2: one fixed per-asset anchor, never refitted. The sole midpoint renders exactly here (owner decision).
FIXED_ANCHOR = (32.0, 74.0)

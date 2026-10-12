"""Pure helpers for the Zeus proxy: part IDs, depth encoding, body and robe geometry plans, shading variants.

Standard library only; Blender's Python imports it from zeus_proxy.py and the unit tests import it without bpy.
Coordinates are the UAL rig's rest space: X right (character's left is +X), Y backward (the figure faces -Y), Z up.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import sprite_plan as sp

# --- part IDs (the overlap-outline pass) ------------------------------------------------------------------------

PART_IDS = (
    "head",
    "torso",
    "arm_l",
    "hand_l",
    "arm_r",
    "hand_r",
    "leg_l",
    "leg_r",
    "robe_upper",
    "robe_skirt",
    "belt",
    "beard",
    "hair",
    "bolt",
    "seat",
)
ID_BASE, ID_STEP = 16, 8
FINGERS = ("index_", "middle_", "ring_", "pinky_", "thumb_")


def part_for_bone(name: str) -> str:
    """Body part a skinning group (bone name) belongs to. Limbs are one part each so joints draw no lines."""
    side = name[-1] if name.endswith(("_l", "_r")) else ""
    if name == "Head":
        return "head"
    if name.startswith(("upperarm_", "lowerarm_")):
        return f"arm_{side}"
    if name.startswith("hand_") or name.startswith(FINGERS):
        return f"hand_{side}"
    if name.startswith(("thigh_", "calf_", "foot_", "ball_")):
        return f"leg_{side}"
    return "torso"  # root, pelvis, spine_*, neck_01, clavicle_*


def id_byte(part: str) -> int:
    return ID_BASE + ID_STEP * PART_IDS.index(part)


def decode_id(byte: int) -> str | None:
    """Part for a rendered ID byte, tolerating the +-2 an 8-bit round trip can add; None when nothing is that close."""
    index, remainder = divmod(byte - ID_BASE + ID_STEP // 2, ID_STEP)
    if byte < ID_BASE - 2 or index >= len(PART_IDS) or abs(remainder - ID_STEP // 2) > 2:
        return None
    return PART_IDS[index]


# --- depth pass ----------------------------------------------------------------------------------------------

DEPTH_NEAR, DEPTH_FAR = 18.0, 22.0  # camera-axis distance (m) mapped to 0..1 before the sRGB curve


def encode_depth(distance: float) -> int:
    unit = (distance - DEPTH_NEAR) / (DEPTH_FAR - DEPTH_NEAR)
    return round(sp.linear_to_srgb(unit) * 255)


def decode_depth(byte: int) -> float:
    return DEPTH_NEAR + sp.srgb_to_linear(byte) * (DEPTH_FAR - DEPTH_NEAR)


# --- body ----------------------------------------------------------------------------------------------------


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    t = min(1.0, max(0.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)


def widen_dx(x: float, z: float, amp: float, z_centre: float = 1.38, z_sigma: float = 0.22, x_ramp: float = 0.28) -> float:
    """Outward shift along X for a rest-pose vertex: shoulders and chest broaden, arms shift out rigidly (no stretch)."""
    bump = math.exp(-(((z - z_centre) / z_sigma) ** 2))
    return math.copysign(1.0, x) * amp * bump * smoothstep(0.0, x_ramp, abs(x)) if x else 0.0


def scale_about_axis(point, a, b, factor):
    """Scale `point` radially about the line through a and b (limb thickening that keeps length)."""
    ax, ay, az = a
    dx, dy, dz = b[0] - ax, b[1] - ay, b[2] - az
    length2 = dx * dx + dy * dy + dz * dz
    t = ((point[0] - ax) * dx + (point[1] - ay) * dy + (point[2] - az) * dz) / length2
    foot = (ax + dx * t, ay + dy * t, az + dz * t)
    return tuple(f + (p - f) * factor for p, f in zip(point, foot, strict=True))


# --- robe, beard, hair, bolt, seat ------------------------------------------------------------------------


@dataclass(frozen=True)
class Ring:
    z: float
    half_w: float
    half_d: float
    centre_y: float
    fold: float = 0.0  # fold amplitude as a fraction of the radius
    material: int = 0  # 0 main, 1 trim


def ring_points(ring: Ring, count: int, folds: int, phase: float = 0.0, arc: tuple[float, float] = (0.0, 2 * math.pi)):
    """Points of one ring, y negative toward the front. Angle 0 is screen-right (+X); the arc is open unless it spans 2 pi."""
    full = abs((arc[1] - arc[0]) - 2 * math.pi) < 1e-9
    steps = count if full else count - 1
    points = []
    for i in range(count):
        theta = arc[0] + (arc[1] - arc[0]) * i / steps
        radial = 1.0 + ring.fold * math.cos(folds * theta + phase)
        points.append((ring.half_w * radial * math.cos(theta), ring.centre_y + ring.half_d * radial * math.sin(theta), ring.z))
    return points


def robe_rings() -> list[Ring]:
    """Neck to hem, broad folds growing toward the hem. Tuned against the widened rest-pose body (see README)."""
    return [
        Ring(1.515, 0.105, 0.105, 0.015),
        Ring(1.465, 0.215, 0.140, 0.020),
        Ring(1.360, 0.225, 0.150, 0.020, 0.02),
        Ring(1.230, 0.215, 0.150, 0.020, 0.03),
        Ring(1.110, 0.195, 0.145, 0.020, 0.03, 1),
        Ring(1.040, 0.200, 0.150, 0.020, 0.03, 1),
        Ring(0.930, 0.225, 0.165, 0.020, 0.04),
        Ring(0.760, 0.250, 0.190, 0.020, 0.05),
        Ring(0.560, 0.270, 0.210, 0.020, 0.06),
        Ring(0.360, 0.290, 0.230, 0.020, 0.07),
        Ring(0.335, 0.292, 0.232, 0.020, 0.07, 1),
        Ring(0.300, 0.295, 0.235, 0.020, 0.07, 1),
    ]


def beard_rings() -> list[Ring]:
    return [
        Ring(1.650, 0.090, 0.060, -0.085),
        Ring(1.610, 0.105, 0.075, -0.110),
        Ring(1.570, 0.100, 0.080, -0.135),
        Ring(1.490, 0.080, 0.070, -0.155),
        Ring(1.420, 0.055, 0.055, -0.165),
        Ring(1.360, 0.020, 0.020, -0.170),
    ]


def zigzag_points(segments: int, step: float, amp: float, plane_deg: float = 45.0) -> list[tuple[float, float, float]]:
    """A planar zigzag along +X, alternating sides of the axis, with its plane turned `plane_deg` about the axis.

    A planar zigzag is edge-on from one viewing azimuth; at 45 degrees it keeps about 0.7 of its width from all four
    facings of a figure turned in 90 degree steps. Returns (along, a, b); ends sit on the axis so the grip is centred.
    """
    cos, sin = math.cos(math.radians(plane_deg)), math.sin(math.radians(plane_deg))
    points = []
    for i in range(segments + 1):
        lateral = 0.0 if i in (0, segments) else amp * (1 if i % 2 else -1)
        points.append((i * step, lateral * cos, lateral * sin))
    return points


def seat_size(pelvis_z: float) -> tuple[float, float, float]:
    """(width, depth, height) of the stone block: top just under the seated pelvis, wider than the hips, a plain cube."""
    return 0.40, 0.32, max(0.2, pelvis_z - 0.07)


# --- shading variants --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class ShadingVariant:
    id: str
    label: str
    shade_indices: dict[str, tuple[int, ...]]  # per material role: which ramp shades (0 darkest, kept for the outline)
    thresholds: tuple[float, ...]  # lit-value cut points between bands
    sun: float
    ambient: float
    fill: float  # strength of a second, opposing sun


ROLES = ("skin", "robe", "trim", "hair", "bolt", "seat")

VARIANT_A = ShadingVariant(
    id="a3",
    label="3-band ramp (round 1 shading)",
    shade_indices={role: (1, 2, 3) for role in ROLES},
    thresholds=(0.50, 0.78),
    sun=3.0,
    ambient=0.22,
    fill=0.0,
)
VARIANT_B = ShadingVariant(
    id="b2",
    label="2-tone, canon-like shades, higher ambient plus opposing fill",
    shade_indices={"skin": (1, 2), "robe": (2, 3), "trim": (2, 3), "hair": (1, 2), "bolt": (2, 3), "seat": (1, 2)},
    thresholds=(0.55,),
    sun=3.0,
    ambient=0.30,
    fill=0.5,
)
VARIANTS = (VARIANT_A, VARIANT_B)


def band_positions(variant: ShadingVariant, role: str) -> list[tuple[float, int]]:
    """(ramp stop position, ramp shade index) pairs for a role under a variant."""
    indices = variant.shade_indices[role]
    if len(indices) != len(variant.thresholds) + 1:
        raise ValueError(f"{variant.id}: {role} has {len(indices)} shades for {len(variant.thresholds)} thresholds")
    return list(zip((0.0, *variant.thresholds), indices, strict=True))


# --- animation timing (canon) ---------------------------------------------------------------------------------

CANON_TIMING_MS = {
    "idle": (333, 167, 333, 167),
    "sit": (500, 500),
    "cast": (83, 100, 83, 83, 100),
    "walk": (100, 100, 100, 100, 100, 100),
}

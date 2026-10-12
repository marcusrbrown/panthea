"""Pure plan data and helpers for the retro-render probe: item specs, shading bands, ordered dither, part IDs, depth
encoding, clip timings. Standard library only; Blender's Python and the unit tests both import it.

Provisional target for this probe (does not change the art guide): gods keep a 48-56 px standing figure (round 2 also tries
60-64 px) on a 96x96 pose canvas whose pivot comes from the measured envelope, with the 64x80 sprite cell and anchor (32, 74)
kept as GOD_SPRITE_*; mortals use the guide's 64x64 cell and 40-48 px; up to 48 colours per sprite from a shared palette
of at most 64; five lit-toon bands, optionally with a light 4x4 ordered dither.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import tile_geom as tg

# --- shared camera scale ------------------------------------------------------------------------------------------
# Round 1's calibration of the 2:1 camera on the unmodified UAL mannequin (50 px interior for a 1.83 m figure).
PPU = 29.0788
SUPERSAMPLE = 4
CAMERA_ROT_DEG = (60.0, 0.0, 45.0)
DIRECTIONS = ("south", "east", "north", "west")

# Round 2: gods are posed on a larger canvas so the whole action envelope (raised arm, bolt stamp, wide stride) fits at the same
# world and camera scale. The pivot (sole midpoint) is set from the measured envelope, not from the 64x80 sprite-sheet cell.
GOD_CELL, GOD_ANCHOR = (96, 96), (48.0, 78.0)  # measured: see README (started at 48, 88; the toes reached the bottom edge)
# Round 3: the tall Zeus's cast spans 94 px, so it gets a wider canvas (candidate pivot (56, 78); the standard Zeus stays 96x96).
GOD_TALL_CELL, GOD_TALL_ANCHOR = (112, 96), (56.0, 78.0)
GOD_SPRITE_CELL, GOD_SPRITE_ANCHOR = (64, 80), (32.0, 74.0)  # the art guide's cell and the anchor round 1 used; canon is 64x80
CANON_CELL, CANON_PIVOT = (64, 80), (32.0, 80.0)  # the zeus-sprite manifest declares pivot (32, 80), not (32, 74)
MORTAL_CELL, MORTAL_ANCHOR = (64, 64), (32.0, 58.0)
GOD_INTERIOR_PX = 50  # standing body height without the outline; the outline adds 2 -> 52
GOD_TALL_INTERIOR_PX = 60  # -> 62 with the outline: the 60-64 px variant, made by enlarging the model, not the camera scale
MORTAL_INTERIOR_PX = 42  # -> 44 with the outline


# --- shading ------------------------------------------------------------------------------------------------------

BANDS = 5
# Ramp shades used by the five bands (shade 0, the darkest, is the outline's).
BAND_SHADES = (1, 2, 3, 4, 5)
# Lower edge of each band on the diffuse value (ambient + sun * cos). Band 0 starts at 0.
BAND_STARTS = (0.0, 0.40, 0.58, 0.76, 0.92)
SUN_STRENGTH = 3.6
AMBIENT_STRENGTH = 0.32
DITHER_WIDTH = 0.16  # total span of the ordered-dither offset on the diffuse value

BAYER4 = (
    (0, 8, 2, 10),
    (12, 4, 14, 6),
    (3, 11, 1, 9),
    (15, 7, 13, 5),
)


def bayer_threshold(x: int, y: int) -> float:
    """Ordered-dither threshold in (0, 1) for cell pixel (x, y): (b + 0.5) / 16 from the 4x4 Bayer matrix."""
    return (BAYER4[y % 4][x % 4] + 0.5) / 16.0


def dither_offset(x: int, y: int, width: float = DITHER_WIDTH) -> float:
    """Offset added to the diffuse value: centred on zero, total span `width`."""
    return (bayer_threshold(x, y) - 0.5) * width


def band_index(value: float, offset: float = 0.0, starts: tuple[float, ...] = BAND_STARTS) -> int:
    """Band 0..len(starts)-1 for a diffuse value (plus an optional dither offset)."""
    v = value + offset
    return sum(1 for s in starts[1:] if v >= s)


def bias_for(material_lightness: float, ramp_mid_lightness: float, gain: float = 0.8) -> float:
    """Band bias (added to the diffuse value) so a material lighter or darker than its ramp's middle keeps its relative tone."""
    return max(-0.3, min(0.3, (material_lightness - ramp_mid_lightness) * gain))


# --- variants -----------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Variant:
    id: str
    label: str
    dither: bool


A_TOON = Variant("toon", "lit toon, 5 bands", False)
B_DITHER = Variant("dither", "lit toon, 5 bands + light 4x4 ordered dither", True)
VARIANTS = (A_TOON, B_DITHER)


# --- part IDs for the overlap-outline pass -------------------------------------------------------------------------

PART_IDS = (
    "head", "torso", "arm_l", "hand_l", "arm_r", "hand_r", "leg_l", "leg_r",
    "robe_upper", "robe_skirt", "belt", "beard", "hair", "tunic", "tunic_skirt", "bolt",
    "trunk", "foliage",
    "stylobate", "column", "entablature", "pediment", "cella", "roof",
    "wall", "door", "prop",
    "ground", "animal",
)  # fmt: skip
ID_BASE, ID_STEP = 16, 8
FINGERS = ("index_", "middle_", "ring_", "pinky_", "thumb_")


def part_for_bone(name: str) -> str:
    side = name[-1] if name.endswith(("_l", "_r")) else ""
    if name == "Head":
        return "head"
    if name.startswith(("upperarm_", "lowerarm_")):
        return f"arm_{side}"
    if name.startswith("hand_") or name.startswith(FINGERS):
        return f"hand_{side}"
    if name.startswith(("thigh_", "calf_", "foot_", "ball_")):
        return f"leg_{side}"
    return "torso"


def id_byte(part: str) -> int:
    return ID_BASE + ID_STEP * PART_IDS.index(part)


def decode_id(byte: int) -> str | None:
    """Part for a rendered ID byte, tolerating the +-2 an 8-bit round trip can add."""
    index, remainder = divmod(byte - ID_BASE + ID_STEP // 2, ID_STEP)
    if byte < ID_BASE - 2 or index >= len(PART_IDS) or abs(remainder - ID_STEP // 2) > 2:
        return None
    return PART_IDS[index]


def _srgb(v: float) -> float:
    return 12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055


def _lin(v: float) -> float:
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def encode_depth(distance: float, near: float, far: float) -> int:
    unit = min(1.0, max(0.0, (distance - near) / (far - near)))
    return round(_srgb(unit) * 255)


def decode_depth(byte: int, near: float, far: float) -> float:
    return near + _lin(byte / 255.0) * (far - near)


# --- items --------------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Clip:
    id: str
    action: str
    frames: int
    timing_ms: tuple[int, ...]
    loop: bool = True
    facings: tuple[str, ...] = DIRECTIONS
    state: str = ""  # the semantic animation state (walk, idle, cast); sample variants of one state share it. Defaults to the id

    def __post_init__(self) -> None:
        if not self.state:
            object.__setattr__(self, "state", self.id)


@dataclass(frozen=True)
class Item:
    id: str
    kind: str  # character | prop | building | tile
    cell: tuple[int, int]
    origin_px: tuple[float, float]  # where the world origin projects in the 1x cell
    pivot_px: tuple[float, float]  # sprite pivot (sole midpoint, footprint bottom vertex)
    outline: bool = True
    overlap: bool = True
    depth_range: tuple[float, float] = (18.0, 22.0)
    clips: tuple[Clip, ...] = ()
    footprint: tuple[int, int] = (1, 1)
    interior_px: float = 0.0  # characters: standing height the model is fitted to (without the outline)
    shadow: tuple[float, float] | None = None  # contact shadow half-axes in px (rx, ry), centred on the origin


def _split(total: int, n: int) -> tuple[int, ...]:
    base, extra = divmod(total, n)
    return tuple(base + (1 if i < extra else 0) for i in range(n))


def footprint_item(item_id: str, kind: str, w: int, h: int, cell: tuple[int, int], pivot: tuple[float, float], depth_range: tuple[float, float], **kw) -> Item:
    """Item whose world origin is its footprint centre and whose pivot is the footprint's bottom vertex."""
    drop = tg.centre_to_bottom_vertex_px(w, h)
    return Item(item_id, kind, cell, (pivot[0], pivot[1] - drop), pivot, depth_range=depth_range, footprint=(w, h), **kw)


CHAR_CLIPS = (
    Clip("idle", "Idle_Loop", 6, _split(1000, 6)),
    Clip("walk", "Walk_Loop", 8, _split(800, 8)),
    Clip("walk16", "Walk_Loop", 16, _split(800, 16), state="walk"),  # the same state sampled at twice the frames: one pose policy
)
CAST_CLIP = Clip("cast", "Spell_Simple_Shoot", 6, _split(500, 6), loop=False)
GOD_SHADOW = (9.0, 4.5)
ZEUS = Item("zeus", "character", GOD_CELL, GOD_ANCHOR, GOD_ANCHOR, clips=(*CHAR_CLIPS, CAST_CLIP), interior_px=GOD_INTERIOR_PX, shadow=GOD_SHADOW)
ZEUS_TALL = Item("zeus-tall", "character", GOD_TALL_CELL, GOD_TALL_ANCHOR, GOD_TALL_ANCHOR, clips=(*CHAR_CLIPS, CAST_CLIP), interior_px=GOD_TALL_INTERIOR_PX, shadow=(10.0, 5.0))
MORTAL = Item(
    "mortal", "character", MORTAL_CELL, MORTAL_ANCHOR, MORTAL_ANCHOR,
    clips=tuple(Clip(c.id, c.action, c.frames, c.timing_ms, facings=("south", "east")) for c in CHAR_CLIPS),
    interior_px=MORTAL_INTERIOR_PX, shadow=(6.5, 3.25),
)  # fmt: skip
CANON = Item("canon", "character", CANON_CELL, CANON_PIVOT, CANON_PIVOT, overlap=False, outline=False)
BULL = Item(
    "bull", "character", (80, 56), (34.0, 37.0), (34.0, 37.0), overlap=False,  # canvas and pivot from the measured envelope (first pass 96x64, 48/52)
    clips=(Clip("idle", "Idle", 6, _split(2000, 6), facings=("south", "east")), Clip("walk", "Walk", 8, _split(800, 8), facings=("south", "east"))),
    interior_px=34, shadow=(13.0, 5.5),
)  # fmt: skip
TREE_FRAMES = 12
TREE = Item(
    "tree", "prop", (64, 128), (32.0, 120.0), (32.0, 120.0), overlap=False, depth_range=(17.0, 23.0),
    clips=(Clip("wind", "wind", TREE_FRAMES, _split(2000, TREE_FRAMES), facings=("south",)),), shadow=(8.0, 4.0),
)  # fmt: skip
TEMPLE_FOOTPRINT = (3, 2)
TEMPLE = footprint_item("temple", "building", *TEMPLE_FOOTPRINT, (192, 232), (96.0, 222.0), (14.0, 26.0))
HOUSE_FOOTPRINT = (2, 2)
HOUSE = footprint_item("house", "building", *HOUSE_FOOTPRINT, (192, 176), (96.0, 168.0), (15.0, 25.0))
TILE_CELL = (tg.TILE_W, tg.TILE_H)
TILE_ORIGIN = (tg.TILE_W / 2, (tg.DIAMOND_H) / 2)
TILE = Item("tile", "tile", TILE_CELL, TILE_ORIGIN, (tg.TILE_W / 2, float(tg.DIAMOND_H)), outline=False, overlap=False, depth_range=(19.0, 21.0))
ITEMS = {i.id: i for i in (ZEUS, ZEUS_TALL, MORTAL, BULL, TREE, TEMPLE, HOUSE, TILE)}

CANON_IDLE_MS = (333, 167, 333, 167)


def override_keys(state: str, facing: str) -> tuple[str, str]:
    """Pose-override table keys for an animation state and facing, least specific first. Keyed by the semantic state, never by a
    sample variant, so walk and walk16 share one pose policy."""
    return (state, f"{state}:{facing}")


def pose_state(clips: tuple["Clip", ...], clip_id: str) -> str:
    return next(c.state for c in clips if c.id == clip_id)


def render_size(cell: tuple[int, int]) -> tuple[int, int]:
    return (cell[0] * SUPERSAMPLE, cell[1] * SUPERSAMPLE)


def pose_name(item: str, clip: str, facing: str, index: int) -> str:
    return f"{clip}_{facing}_{index:02d}"


def sample_frames(start: float, end: float, count: int, loop: bool) -> list[float]:
    """Source frames for `count` output frames. A loop excludes the duplicate endpoint; a one-shot includes both ends."""
    if count < 1:
        raise ValueError("count must be positive")
    if count == 1:
        return [start]
    span = end - start
    divisor = count if loop else count - 1
    return [start + span * i / divisor for i in range(count)]


# --- scale fitting ---------------------------------------------------------------------------------------------------


def fit_scale(target_interior_px: float, extent_px: float) -> float:
    """Uniform object scale that makes a figure whose screen extent is `extent_px` span `target_interior_px`."""
    if extent_px <= 0:
        raise ValueError("extent must be positive")
    return target_interior_px / extent_px


def mortal_scale_ratio() -> float:
    return MORTAL_INTERIOR_PX / GOD_INTERIOR_PX


def tall_ratio() -> float:
    """How much larger the tall Zeus model is than the standard one (the camera scale is the same)."""
    return GOD_TALL_INTERIOR_PX / GOD_INTERIOR_PX


@dataclass
class Ramps:
    """Material role -> (ramp id, bias) for one item; kept as data so the render script and the README agree."""

    roles: dict[str, tuple[str, float]] = field(default_factory=dict)


@dataclass(frozen=True)
class HairPiece:
    """A hair mesh from the base-character pack, optionally trimmed in rest space (x right, y back, z up, metres)."""

    file: str
    role: str = "hair"
    part: str = "hair"
    drop_front_below: tuple[float, float] | None = None  # (y_max, z_max): drop faces in front of y_max and below z_max (the hairline)
    keep_sides_back: tuple[float, float] | None = None  # (x_min, y_min): keep only faces at |x| >= x_min or y >= y_min (side locks)


def hair_face_kept(piece: HairPiece, x: float, y: float, z: float) -> bool:
    """Whether a face centred at rest-space (x, y, z) survives the piece's trims."""
    if piece.drop_front_below is not None and y < piece.drop_front_below[0] and z < piece.drop_front_below[1]:
        return False
    if piece.keep_sides_back is not None and not (abs(x) >= piece.keep_sides_back[0] or y >= piece.keep_sides_back[1]):
        return False
    return True


@dataclass(frozen=True)
class Bun:
    """A hair knot: a low-poly sphere bound to the head bone."""

    centre: tuple[float, float, float]
    radius: float


@dataclass(frozen=True)
class Profile:
    """Proportions of one character, applied to the existing base mesh through the rig (no mesh swap)."""

    body_scale: tuple[float, float, float]  # x width, y depth, z height of the whole armature, before the uniform fit
    head: float  # uniform scale of the head bone (the hair and beard follow it)
    hands: float  # uniform scale of each hand bone (the fingers follow it)
    feet: float
    limb_length: float = 1.0  # length scale of the upper arm, forearm, thigh and shin; their children keep their own size
    fist_deg: float = 0.0  # finger curl for a simple fist; 0 leaves the clip's fingers alone
    head_pitch_deg: float = 0.0  # extra head pitch about the bone's X axis (the clips bow the head toward the camera)
    hair: tuple[HairPiece, ...] = ()
    bun: Bun | None = None


# Round 1 used head 1.7 and hands 1.55 for both characters (the head read as a helmet, the hands as gloves).
ZEUS_PROFILE = Profile(
    body_scale=(1.28, 1.18, 0.9), head=1.5, hands=1.1, feet=1.0, fist_deg=75.0, head_pitch_deg=-25.0,
    hair=(
        HairPiece("Hair_Beard", "beard", "beard"),
        HairPiece("Hair_SimpleParted", drop_front_below=(-0.02, 1.772)),  # a high hairline: the forehead and eyes show
        HairPiece("Hair_Long", keep_sides_back=(0.085, 0.02)),  # side locks and a back mass that frame the face
    ),
)  # fmt: skip
MORTAL_PROFILE = Profile(
    body_scale=(1.15, 1.08, 0.95), head=1.25, hands=1.1, feet=1.0, limb_length=0.88, head_pitch_deg=-20.0,
    hair=(HairPiece("Hair_SimpleParted", drop_front_below=(-0.02, 1.772)),),
    bun=Bun((0.0, 0.05, 1.835), 0.062),  # a top knot, as the Greeks wore it
)  # fmt: skip
PROFILES = {"zeus": ZEUS_PROFILE, "mortal": MORTAL_PROFILE}
LIMB_BONES = ("upperarm", "lowerarm", "thigh", "calf")
LIMB_CHILDREN = ("lowerarm", "hand", "calf", "foot")  # bones that must not inherit their parent's length scale


def profile_bone_scales(profile: Profile) -> dict[str, tuple[float, float, float]]:
    """Pose-bone scale per bone name for a profile (limb scales are along the bone's own Y axis, its length)."""
    out: dict[str, tuple[float, float, float]] = {"Head": (profile.head,) * 3}
    for side in ("l", "r"):
        out[f"hand_{side}"] = (profile.hands,) * 3
        out[f"foot_{side}"] = (profile.feet,) * 3
        if profile.limb_length != 1.0:
            for bone in LIMB_BONES:
                out[f"{bone}_{side}"] = (1.0, profile.limb_length, 1.0)
    return out


def limb_child_bones() -> tuple[str, ...]:
    return tuple(f"{b}_{side}" for b in LIMB_CHILDREN for side in ("l", "r"))


FINGER_CHAINS = ("index", "middle", "ring", "pinky")
FINGER_JOINT_SHARE = (0.55, 1.0, 0.8)  # share of the full curl at the knuckle, middle and tip joints


def fist_curls(fist_deg: float) -> dict[str, float]:
    """Curl in degrees per finger bone (`<finger>_0<joint>_<side>`) for a simple fist; thumbs curl half as far."""
    out: dict[str, float] = {}
    for side in ("l", "r"):
        for finger in FINGER_CHAINS:
            for joint, share in enumerate(FINGER_JOINT_SHARE, start=1):
                out[f"{finger}_0{joint}_{side}"] = fist_deg * share
        for joint, share in enumerate(FINGER_JOINT_SHARE, start=1):
            out[f"thumb_0{joint}_{side}"] = fist_deg * 0.5 * share
    return out


ZEUS_RAMPS = Ramps({"skin": ("pale-gold", 0.0), "robe": ("cloud", 0.0), "trim": ("pale-gold", 0.0), "hair": ("marble", 0.15), "beard": ("cloud", 0.05), "bolt": ("pale-gold", 0.0)})
# Quaternius Bull material -> (role, ramp, bias). The kit's colours are linear and nearly black, so each role is mapped by hand.
BULL_ROLES = {
    "Main": ("hide", "soil", -0.30),
    "Main_Light": ("hide_light", "soil", 0.05),
    "Hooves": ("hoof", "bone", -0.30),
    "Muzzle": ("muzzle", "terracotta", -0.15),
    "Eye_Black": ("eye", "soil", -0.60),
    "Eye_White": ("eye_white", "bone", 0.40),
    "Horns": ("horn", "bone", 0.30),
}
BULL_LOWER_LEG_BONES = ("FrontLowerLeg.L", "FrontLowerLeg.R", "BackLowerLeg.L", "BackLowerLeg.R")  # their tails are the hooves
MORTAL_RAMPS = Ramps({"skin": ("terracotta", 0.28), "tunic": ("bone", 0.0), "belt": ("pale-gold", -0.1), "hair": ("soil", -0.5)})


def hold_index(timing_ms: tuple[int, ...], t_ms: float) -> int:
    """Frame index at time `t_ms` into a looping clip with per-frame hold times."""
    total = sum(timing_ms)
    t = t_ms % total
    acc = 0.0
    for i, d in enumerate(timing_ms):
        acc += d
        if t < acc:
            return i
    return len(timing_ms) - 1


def ground_diamond_ratio() -> float:
    return math.cos(math.radians(CAMERA_ROT_DEG[0]))

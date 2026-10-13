# SPDX-License-Identifier: GPL-3.0-or-later
"""Headless Blender render script of the retro sprite pipeline (ADR-0012). The only new code that imports bpy.

    Blender --background --factory-startup --python-exit-code 1 --python render.py -- --recipe recipe.json

The recipe is the JSON of `RenderRecipe` in packages/assets/src/render/script-contract.ts; this file and that
module share one contract (the recipe input, the per-slot `done.json`, the exit codes). The recipe embeds the
camera and the model profile, so the script reads nothing from the repository: kit files come from the
recipe's staging root only, laid out `<staging>/<kit>/<path>`, and import skips textures because staging holds
none (Blender logs the missing images and goes on; U1 measured the output as pixel-identical).

For each slot the script poses one figure through ONE pose function keyed by the semantic state (never by an
output clip name, so a walk at 8 and at 16 frames is the same walk), renders colour, part-ID and depth (8-bit
RGBA PNG) per frame at the camera's supersample, writes them to `<outDir>.partial`, moves that to `<outDir>` and
only then writes `done.json` through a temporary file. The runner ingests a slot only when the sentinel matches.

Exit codes: 0 ok, 1 uncaught exception, 10 no GPU context, 11 Blender version or build mismatch, 12 input error.
Everything is built from a factory start in the process; nothing is saved as a .blend.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import sys
import threading
import time
import traceback
from pathlib import Path

import bmesh
import bpy
import mathutils
import numpy as np
from mathutils import Vector, kdtree

# --- the script contract (mirrored by packages/assets/src/render/script-contract.ts; a test compares them) ----

EXIT_OK = 0
EXIT_SCRIPT_ERROR = 1
EXIT_NO_GPU = 10
EXIT_VERSION = 11
EXIT_INPUT = 12
FIRST_LINE_MARKER = "RENDER start"
SENTINEL_NAME = "done.json"
ROLES = ("colour", "id", "depth")
PART_IDS = (
    "head", "torso", "arm_l", "hand_l", "arm_r", "hand_r", "leg_l", "leg_r",
    "robe_upper", "robe_skirt", "belt", "beard", "hair", "tunic", "tunic_skirt", "reserved_15",
    "trunk", "foliage",
    "stylobate", "column", "entablature", "pediment", "cella", "roof",
    "wall", "door", "prop",
    "ground", "animal",
    "himation",
)  # fmt: skip
ID_BASE, ID_STEP = 16, 8

# --- rig facts of the Universal Base Characters / Universal Animation Library skeleton -------------------------

FINGERS = ("index_", "middle_", "ring_", "pinky_", "thumb_")
ARM_NAMES = ("upperarm_", "lowerarm_", "hand_", "clavicle_")
FOOT_BONES = ("foot_l", "foot_r", "ball_l", "ball_r")
LIMB_CHILDREN = ("lowerarm", "hand", "calf", "foot")  # bones that must not inherit their parent's length scale
AIM_ORDER = ("clavicle_r", "upperarm_r", "lowerarm_r", "hand_r")  # parents first
FINGER_CHAINS = ("index", "middle", "ring", "pinky")
FINGER_JOINT_SHARE = (0.55, 1.0, 0.8)  # share of the full curl at the knuckle, middle and tip joints
FIST_AXIS = (1.0, 0.0, 0.0)  # finger curl axis in each finger bone's own space
DIRECTIONS = ("south", "east", "north", "west")
BODY_ROLE = "skin"  # the material role of the base body; the profile must define it


class InputError(Exception):
    """A recipe field, kit file or clip is missing or wrong. Exits with EXIT_INPUT."""


# --- small maths -------------------------------------------------------------------------------------------------


def srgb_to_linear(channel: int) -> float:
    c = channel / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(value: str) -> tuple[float, float, float]:
    raw = bytes.fromhex(value.removeprefix("#"))
    return (srgb_to_linear(raw[0]), srgb_to_linear(raw[1]), srgb_to_linear(raw[2]))


def euler_xyz_matrix(deg):
    ax, ay, az = (math.radians(d) for d in deg)
    cx, sx, cy, sy, cz, sz = math.cos(ax), math.sin(ax), math.cos(ay), math.sin(ay), math.cos(az), math.sin(az)
    return (
        (cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx),
        (sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx),
        (-sy, cy * sx, cy * cx),
    )  # fmt: skip


def _dot(a, b) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _norm(v):
    length = math.sqrt(_dot(v, v))
    if length == 0:
        raise InputError("zero-length vector")
    return (v[0] / length, v[1] / length, v[2] / length)


class Axes:
    """Camera basis in world space: a Blender camera looks down its local -Z with +Y up and +X right."""

    def __init__(self, rotation_deg):
        m = euler_xyz_matrix(rotation_deg)
        self.right = tuple(_dot(row, (1.0, 0.0, 0.0)) for row in m)
        self.up = tuple(_dot(row, (0.0, 1.0, 0.0)) for row in m)
        self.back = tuple(_dot(row, (0.0, 0.0, 1.0)) for row in m)  # from the scene toward the camera
        self.view = tuple(-c for c in self.back)


def facing_vectors(axes: Axes) -> dict:
    """Unit world XY heading per screen-relative facing: south faces the viewer, east is screen right."""
    back = _norm((axes.back[0], axes.back[1], 0.0))
    right = _norm((axes.right[0], axes.right[1], 0.0))
    return {"south": (back[0], back[1]), "east": (right[0], right[1]), "north": (-back[0], -back[1]), "west": (-right[0], -right[1])}


def yaw_to_face(forward, target) -> float:
    delta = math.degrees(math.atan2(target[1], target[0])) - math.degrees(math.atan2(forward[1], forward[0]))
    delta = (delta + 180.0) % 360.0 - 180.0
    return 180.0 if delta == -180.0 else delta


def sample_frames(start: float, end: float, count: int, loop: bool) -> list:
    """Source frames for `count` output frames. A loop excludes the duplicate endpoint; a one-shot includes both ends.

    The same arithmetic as `sourceFrameTimes` in profile.ts: the 8-frame walk is every second time of the 16-frame walk.
    """
    if count < 1:
        raise InputError("a slot needs at least one frame")
    if count == 1:
        return [start]
    span = end - start
    divisor = count if loop else count - 1
    return [start + span * i / divisor for i in range(count)]


def id_byte(part: str) -> int:
    return ID_BASE + ID_STEP * PART_IDS.index(part)


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


# --- pose policy (the same merge as `posePolicy` in profile.ts) -------------------------------------------------------


def pose_policy(profile: dict, state: str, facing: str) -> dict:
    """The state's entry refined by its facing entry; bones merge one by one."""
    if state not in profile["clips"]:
        raise InputError(f"{state!r} is not a semantic state of profile {profile['id']!r}; pose policy is keyed by state")
    merged: dict = {}
    for k in (state, f"{state}:{facing}"):
        entry = profile["pose"].get(k)
        if entry is None:
            continue
        for field in ("aims", "rotations", "damp", "dampLocation"):
            if field in entry:
                merged[field] = {**merged.get(field, {}), **entry[field]}
        if "groundFeet" in entry:
            merged["groundFeet"] = entry["groundFeet"]
    return merged


# --- scene, camera, materials, passes ---------------------------------------------------------------------------------


def fresh_scene(camera: dict):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 24
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 15
    scene.render.dither_intensity = 0.0
    scene.render.filter_size = 0.0  # no pixel filter: a sample lands in exactly one pixel
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1.0
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.display_settings.display_device = "sRGB"
    ev = scene.eevee
    for attr, value in (
        ("taa_render_samples", 1),
        ("taa_samples", 1),
        ("use_raytracing", False),
        ("use_shadows", False),
        ("use_volumetric_shadows", False),
    ):
        if hasattr(ev, attr):
            setattr(ev, attr, value)
    scene.render.use_motion_blur = False
    world = bpy.data.worlds.new("flat")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bg.inputs["Strength"].default_value = camera["light"]["ambientStrength"]
    sun = bpy.data.lights.new("key", "SUN")
    sun.energy = camera["light"]["sunStrength"]
    sun.angle = 0.0
    sun.use_shadow = False
    key = bpy.data.objects.new("key", sun)
    scene.collection.objects.link(key)
    axes = Axes(camera["rotationDeg"])
    wr, wu, wb = camera["light"]["keyScreen"]
    toward = _norm(tuple(axes.right[i] * wr + axes.up[i] * wu + axes.back[i] * wb for i in range(3)))
    key.rotation_euler = Vector(toward).to_track_quat("Z", "Y").to_euler()
    return scene, axes


def make_camera(scene, axes: Axes, camera: dict):
    cell = camera["cell"]
    ppu = camera["pixelsPerUnit"]
    data = bpy.data.cameras.new("iso")
    data.type = "ORTHO"
    data.sensor_fit = "VERTICAL"
    data.ortho_scale = cell["height"] / ppu
    data.clip_start, data.clip_end = camera["clip"]
    obj = bpy.data.objects.new("iso", data)
    scene.collection.objects.link(obj)
    obj.rotation_euler = tuple(math.radians(d) for d in camera["rotationDeg"])
    # The pivot sits at the image centre when the camera looks straight at it; moving the camera up along its own up
    # axis moves the subject down the image by the same distance.
    dx = (cell["pivot"][0] - cell["width"] / 2) / ppu
    dy = (cell["pivot"][1] - cell["height"] / 2) / ppu
    d = camera["distance"]
    obj.location = tuple(axes.back[i] * d + axes.up[i] * dy - axes.right[i] * dx for i in range(3))
    scene.camera = obj
    return obj


def toon_material(name: str, shades_hex, starts, shade_indices, bias: float):
    """Diffuse -> Shader to RGB -> value (+ bias) -> constant ramp of the camera's bands -> Emission."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    new = tree.nodes.new
    diffuse = new("ShaderNodeBsdfDiffuse")
    diffuse.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    to_rgb = new("ShaderNodeShaderToRGB")
    to_bw = new("ShaderNodeRGBToBW")
    add_bias = new("ShaderNodeMath")
    add_bias.operation = "ADD"
    add_bias.inputs[1].default_value = bias
    ramp = new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    elements = ramp.color_ramp.elements
    while len(elements) < len(starts):
        elements.new(0.5)
    for element, start, shade in zip(elements, starts, shade_indices, strict=True):
        element.position = start
        r, g, b = hex_to_linear(shades_hex[shade])
        element.color = (r, g, b, 1.0)
    emission = new("ShaderNodeEmission")
    out = new("ShaderNodeOutputMaterial")
    link = tree.links.new
    link(diffuse.outputs["BSDF"], to_rgb.inputs["Shader"])
    link(to_rgb.outputs["Color"], to_bw.inputs["Color"])
    link(to_bw.outputs["Val"], add_bias.inputs[0])
    link(add_bias.outputs["Value"], ramp.inputs["Fac"])
    link(ramp.outputs["Color"], emission.inputs["Color"])
    link(emission.outputs["Emission"], out.inputs["Surface"])
    return mat


class MaterialBook:
    """Role -> (ramp, bias, band shades) from the profile, ramps from the recipe palette; one toon material per role.

    A role may name its own `bandShades` (one ramp shade per camera band): hair and beard use fewer distinct tones than
    the large surfaces, which keep the camera's five."""

    def __init__(self, profile: dict, palette: dict, camera: dict):
        ramps = {r["id"]: r["shades"] for r in palette["ramps"]}
        self.starts = camera["shading"]["bandStarts"]
        self.camera_shades = camera["shading"]["bandShades"]
        self.roles = {}
        for role, spec in profile["materials"].items():
            if spec["ramp"] not in ramps:
                raise InputError(f"the palette has no ramp {spec['ramp']!r} (role {role!r})")
            shades = spec.get("bandShades", self.camera_shades)
            if len(shades) != len(self.starts):
                raise InputError(f"role {role!r} lists {len(shades)} band shades for the camera's {len(self.starts)} bands")
            self.roles[role] = (ramps[spec["ramp"]], spec["bias"], shades)
        self.slots = []
        self.cache = {}

    def material(self, role: str):
        if role not in self.cache:
            shades, bias, band_shades = self.roles[role]
            self.cache[role] = toon_material(f"toon_{role}", shades, self.starts, band_shades, bias)
        return self.cache[role]

    def bind(self, obj, role_per_slot) -> None:
        """Assign a role to each material slot. Slots are never cleared: removing a slot resets face material indices."""
        mats = obj.data.materials
        while len(mats) < len(role_per_slot):
            mats.append(None)
        for i, role in enumerate(role_per_slot):
            if role not in self.roles:
                raise InputError(f"material role {role!r} is not in the profile")
            self.slots.append((obj, i, role))

    def use(self) -> None:
        for obj, i, role in self.slots:
            obj.data.materials[i] = self.material(role)


def id_override_material():
    mat = bpy.data.materials.new("id_override")
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    attr = tree.nodes.new("ShaderNodeAttribute")
    attr.attribute_type = "GEOMETRY"
    attr.attribute_name = "partid"
    emission = tree.nodes.new("ShaderNodeEmission")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(attr.outputs["Color"], emission.inputs["Color"])
    tree.links.new(emission.outputs["Emission"], out.inputs["Surface"])
    return mat


def depth_material(near: float, far: float):
    mat = bpy.data.materials.new("depth_override")
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    cam = tree.nodes.new("ShaderNodeCameraData")
    ramp = tree.nodes.new("ShaderNodeMapRange")
    ramp.inputs["From Min"].default_value = near
    ramp.inputs["From Max"].default_value = far
    ramp.inputs["To Min"].default_value, ramp.inputs["To Max"].default_value = 0.0, 1.0
    ramp.clamp = True
    emission = tree.nodes.new("ShaderNodeEmission")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(cam.outputs["View Z Depth"], ramp.inputs["Value"])
    tree.links.new(ramp.outputs["Result"], emission.inputs["Color"])
    tree.links.new(emission.outputs["Emission"], out.inputs["Surface"])
    return mat


def set_ids(obj, parts) -> None:
    """Flat per-face part ID in a corner colour attribute that renders back to the ID byte through the Standard view."""
    mesh = obj.data
    if isinstance(parts, str):
        parts = [parts] * len(mesh.polygons)
    for part in set(parts):
        if part not in PART_IDS:
            raise InputError(f"part {part!r} is not a known part id")
    attr = mesh.color_attributes.get("partid") or mesh.color_attributes.new("partid", "FLOAT_COLOR", "CORNER")
    values = []
    for poly, part in zip(mesh.polygons, parts, strict=True):
        lin = srgb_to_linear(id_byte(part))
        values.extend([(lin, lin, lin, 1.0)] * poly.loop_total)
    attr.data.foreach_set("color", [c for rgba in values for c in rgba])


def render_pass(scene, path: Path, size, override=None) -> float:
    layer = bpy.context.view_layer
    layer.material_override = override
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.filepath = str(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    layer.material_override = None
    return (time.perf_counter() - started) * 1000.0


# --- meshes and rig helpers ---------------------------------------------------------------------------------------------


def mesh_points(obj) -> np.ndarray:
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        count = len(mesh.vertices)
        co = np.empty(count * 3, dtype=np.float32)
        mesh.vertices.foreach_get("co", co)
    finally:
        evaluated.to_mesh_clear()
    matrix = np.array(evaluated.matrix_world, dtype=np.float64)
    return co.reshape(count, 3).astype(np.float64) @ matrix[:3, :3].T + matrix[:3, 3]


def all_points(objs) -> np.ndarray:
    return np.vstack([mesh_points(o) for o in objs if not o.hide_render])


def dominant_groups(obj) -> list:
    names = {g.index: g.name for g in obj.vertex_groups}
    return [names[max(v.groups, key=lambda g: g.weight).group] if v.groups else "root" for v in obj.data.vertices]


def body_face_parts(body) -> list:
    """Part per face of a skinned body: the part most of its vertices' dominant bones belong to."""
    dominant = dominant_groups(body)
    out = []
    for poly in body.data.polygons:
        votes: dict = {}
        for vi in poly.vertices:
            p = part_for_bone(dominant[vi])
            votes[p] = votes.get(p, 0) + 1
        out.append(max(votes, key=lambda k: (votes[k], k)))
    return out


def set_action(armature, name: str):
    action = bpy.data.actions.get(name)
    if action is None:
        raise InputError(f"the animation library has no action {name!r}")
    ad = armature.animation_data or armature.animation_data_create()
    ad.action = action
    if hasattr(ad, "action_slot") and getattr(action, "slots", None):
        ad.action_slot = action.slots[0]
    return action


def go_to(scene, frame: float) -> None:
    whole = math.floor(frame)
    scene.frame_set(whole, subframe=frame - whole)


def bone_head(arm_eval, name: str):
    v = arm_eval.matrix_world @ arm_eval.pose.bones[name].head
    return (v.x, v.y, v.z)


def evaluated(armature, body):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    return armature.evaluated_get(depsgraph), body.evaluated_get(depsgraph)


def place_armature(armature, yaw_deg: float, sole_mid_local, ground_z: float) -> None:
    """Turn the figure about the vertical axis through its sole midpoint, which stays at world (0, 0)."""
    rot = mathutils.Matrix.Rotation(math.radians(yaw_deg), 2)
    shifted = rot @ mathutils.Vector(sole_mid_local)
    armature.rotation_mode = "XYZ"  # the glTF importer leaves objects in quaternion mode, which ignores rotation_euler
    armature.rotation_euler = (0.0, 0.0, math.radians(yaw_deg))
    armature.location = (-shifted.x, -shifted.y, -ground_z)
    bpy.context.view_layer.update()


def aim_bones(arm, aims: dict) -> None:
    """Swing each bone (parents first) so its head-to-tail axis points along a direction in rig space (X toward the
    character's left, -Y forward, Z up). Minimal rotation, so roll is whatever the pose had."""
    for name, direction in aims.items():
        pb = arm.pose.bones[name]
        current = (pb.tail - pb.head).normalized()
        rot = current.rotation_difference(Vector(direction).normalized()).to_matrix().to_4x4()
        head = pb.head.copy()
        pb.matrix = mathutils.Matrix.Translation(head) @ rot @ mathutils.Matrix.Translation(-head) @ pb.matrix
        bpy.context.view_layer.update()


def rotate_bones(arm, rotations: dict) -> None:
    """Post-multiply each bone's animated local rotation by an XYZ euler offset in degrees (about its own axes)."""
    for name, degrees in rotations.items():
        pb = arm.pose.bones.get(name)
        if pb is None:
            raise InputError(f"rotation names bone {name!r}, which the rig does not have")
        pb.rotation_mode = "QUATERNION"
        offset = mathutils.Euler(tuple(math.radians(d) for d in degrees), "XYZ").to_quaternion()
        pb.rotation_quaternion = pb.rotation_quaternion @ offset
    bpy.context.view_layer.update()


# --- lofted garment, draped himation -------------------------------------------------------------------------------------


def ring_points(ring: dict, count: int, folds: int):
    """Points of one ring, y negative toward the front. Angle 0 is screen-right (+X)."""
    points = []
    for i in range(count):
        theta = 2 * math.pi * i / count
        radial = 1.0 + ring["fold"] * math.cos(folds * theta)
        points.append((ring.get("centreX", 0.0) + ring["halfWidth"] * radial * math.cos(theta), ring["centreY"] + ring["halfDepth"] * radial * math.sin(theta), ring["z"]))
    return points


def loft(name: str, rings, count: int, folds: int):
    bm = bmesh.new()
    rows = [[bm.verts.new(p) for p in ring_points(ring, count, folds)] for ring in rings]
    for i in range(len(rows) - 1):
        for j in range(count):
            j2 = (j + 1) % count
            face = bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][j2], rows[i][j2]))  # outward winding, top to bottom
            face.smooth = True
            face.material_index = rings[i]["material"] if rings[i]["material"] == rings[i + 1]["material"] else 0
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def skin(obj, arm, weights: dict) -> None:
    names = {n for w in weights.values() for n in w}
    groups = {n: obj.vertex_groups.new(name=n) for n in sorted(names)}
    for vi, w in weights.items():
        total = sum(w.values())
        for n, x in w.items():
            groups[n].add([vi], x / total, "REPLACE")
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    obj.parent = arm


def build_garment(arm, body, garment: dict, ring_count=None, name=None):
    """Lofted, bone-weighted garment: weights come from the nearest torso and leg vertices of the body. With
    `ring_count` only the first rings are lofted (the torso of the seated garment)."""
    rings = garment["rings"] if ring_count is None else garment["rings"][:ring_count]
    obj = loft(name or garment["name"], rings, garment["segments"], garment["folds"])
    groups = dominant_groups(body)
    tree = kdtree.KDTree(len(body.data.vertices))
    for i, v in enumerate(body.data.vertices):
        if groups[i].startswith(ARM_NAMES) or groups[i] == "Head" or groups[i].startswith(FINGERS):
            continue
        tree.insert(v.co, i)
    tree.balance()
    body_w = [{body.vertex_groups[g.group].name: g.weight for g in v.groups} for v in body.data.vertices]
    weights = {}
    for vi, v in enumerate(obj.data.vertices):
        mix: dict = {}
        for _, idx, dist in tree.find_n(v.co, 4):
            for n, x in body_w[idx].items():
                mix[n] = mix.get(n, 0.0) + x / (dist + 0.02)
        t = min(1.0, max(0.0, (0.95 - v.co.z) / 0.5)) * garment["pelvisShare"]  # below the hips, the share that follows the pelvis rather than the nearest leg
        total = sum(mix.values())
        mix = {n: x / total * (1 - t) for n, x in mix.items()}
        mix["pelvis"] = mix.get("pelvis", 0.0) + t
        weights[vi] = mix
    skin(obj, arm, weights)
    belt_lo, belt_hi = garment["belt"]
    parts = []
    for poly in obj.data.polygons:
        z = sum(obj.data.vertices[i].co.z for i in poly.vertices) / len(poly.vertices)
        parts.append("belt" if poly.material_index == 1 and belt_lo < z < belt_hi else "robe_skirt" if z < garment["skirtBelow"] else "robe_upper")
    set_ids(obj, parts)
    while len(obj.data.materials) < 2:  # never clear(): it resets every face's material index to 0
        obj.data.materials.append(None)
    return obj


def crease_depth(u: float, creases: list) -> float:
    """Total groove depth at a position across the arc: each crease a smooth cosine dip of its width."""
    depth = 0.0
    for crease in creases:
        half = crease["width"] / 2.0
        d = abs(u - crease["at"])
        if d < half:
            depth += crease["depth"] * 0.5 * (1.0 + math.cos(math.pi * d / half))
    return depth


def arc_points(row: dict, count: int, folds: int, creases=()):
    """Points of one open arc of an ellipse about the torso axis, y negative toward the front. 0 degrees is the
    character's left (+X), -90 the front, 90 the back; `count` points from `fromDeg` to `toDeg`, folded radially
    and grooved by the creases (each pulls the point toward the arc's centre by its depth)."""
    points = []
    for j in range(count):
        u = j / (count - 1)
        theta = math.radians(row["fromDeg"] + (row["toDeg"] - row["fromDeg"]) * u)
        radial = 1.0 + row["fold"] * math.cos(2 * math.pi * folds * u)
        x = row["halfWidth"] * radial * math.cos(theta)
        y = row["halfDepth"] * radial * math.sin(theta)
        groove = crease_depth(u, creases)
        if groove:
            length = math.hypot(x, y)
            shrink = max(0.0, length - groove) / length if length > 1e-9 else 1.0
            x, y = x * shrink, y * shrink
        points.append((x, row["centreY"] + y, row["z"]))
    return points


def weights_at(table: list, z: float) -> dict:
    """Bone weights at a height from a top-to-bottom table: linear between two entries, clamped beyond the ends."""
    if z >= table[0]["z"]:
        return dict(table[0]["bones"])
    for upper, lower in zip(table, table[1:]):
        if z >= lower["z"]:
            t = (upper["z"] - z) / (upper["z"] - lower["z"])
            return {
                b: upper["bones"].get(b, 0.0) * (1 - t) + lower["bones"].get(b, 0.0) * t
                for b in set(upper["bones"]) | set(lower["bones"])
            }
    return dict(table[-1]["bones"])


def build_himation(arm, himation: dict, columns: int = 14, name: str = "himation", part: str = "himation"):
    """An open draped mesh of strips of arcs (never a closed ring), each skinned to the bones its weight table names by
    height. The himation hangs over the character's left shoulder; the beard is the same construction on the head. Faces
    across a crease keep their own normals (a crisp facet); the rest of the strip shades smooth. One object, one part id,
    one material."""
    bm = bmesh.new()
    weights: dict = {}
    index = 0
    for strip in himation["strips"]:
        creases = strip.get("creases", [])
        rows = [[bm.verts.new(p) for p in arc_points(row, columns, strip["folds"], creases)] for row in strip["rows"]]
        for row, verts in zip(strip["rows"], rows):
            for _ in verts:
                weights[index] = weights_at(strip["weights"], row["z"])
                index += 1
        for i in range(len(rows) - 1):
            for j in range(columns - 1):
                face = bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]))
                u0, u1 = j / (columns - 1), (j + 1) / (columns - 1)
                grooved = any(abs((u0 + u1) / 2 - c["at"]) < c["width"] / 2 + 1e-9 for c in creases)
                face.smooth = not grooved
                face.material_index = 0
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    skin(obj, arm, weights)
    set_ids(obj, part)
    while len(obj.data.materials) < 1:
        obj.data.materials.append(None)
    return obj


def build_seated_legs(arm, garment: dict, side: str):
    """One leg of the seated garment: a closed tube from the hip to the hem, skinned to the thigh, the shin and the
    pelvis by its row weights (a lap over the thigh, a knee transition, a shin drape). `side` is `l` or `r`; the right
    leg mirrors the left's offset from the centre line."""
    sign = 1.0 if side == "l" else -1.0
    seated = garment["seated"]
    rings = [
        {**row, "centreX": row["centreX"] * sign, "material": row["material"]}
        for row in seated["legs"]
    ]
    obj = loft(f"{garment['name']}_leg_{side}", rings, garment["segments"], garment["folds"])
    count = garment["segments"]
    weights = {}
    for ring_index, row in enumerate(seated["legs"]):
        named = {(f"{b}_{side}" if b in ("thigh", "calf") else b): w for b, w in row["weights"].items()}
        for k in range(count):
            weights[ring_index * count + k] = named
    skin(obj, arm, weights)
    set_ids(obj, "robe_skirt")
    while len(obj.data.materials) < 2:
        obj.data.materials.append(None)
    return obj


def smooth_piece(mesh, iterations: int, taper, scale, offset) -> None:
    """Smooths a hair piece's geometry and shading into one mass, optionally scaled about its top centre and tapered
    in width toward the bottom."""
    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    if scale:
        top = max(v.co.z for v in bm.verts)
        mid_y = sum(v.co.y for v in bm.verts) / len(bm.verts)
        for v in bm.verts:
            v.co.x *= scale[0]
            v.co.y = mid_y + (v.co.y - mid_y) * scale[1]
            v.co.z = top + (v.co.z - top) * scale[2]
    if iterations:
        for _ in range(iterations):
            bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    if taper:
        zs = [v.co.z for v in bm.verts]
        top, bottom = max(zs), min(zs)
        for v in bm.verts:
            t = (top - v.co.z) / max(top - bottom, 1e-6)
            v.co.x *= taper[0] + (taper[1] - taper[0]) * t
    if offset:
        for v in bm.verts:
            v.co.x += offset[0]
            v.co.y += offset[1]
            v.co.z += offset[2]
    for f in bm.faces:
        f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh.data)
    bm.free()
    mesh.data.update()


# --- kit import (staging only) -----------------------------------------------------------------------------------------


class Staging:
    """Resolves `<kit>/<path>` under the staging root and nothing else."""

    def __init__(self, root: str):
        self.root = Path(root).resolve()
        if not self.root.is_dir():
            raise InputError(f"staging root {root!r} is not a directory")

    def file(self, kit: str, path: str) -> Path:
        resolved = (self.root / kit / path).resolve()
        if self.root not in resolved.parents:
            raise InputError(f"{kit}/{path} resolves outside the staging root")
        if not resolved.is_file():
            raise InputError(f"{kit}/{path} is not staged")
        return resolved


def import_gltf(path: Path) -> list:
    before = set(bpy.data.objects)
    try:
        bpy.ops.import_scene.gltf(filepath=str(path))
    except RuntimeError as e:
        raise InputError(f"glTF import failed for {path.name}: {e}") from e
    for image in list(bpy.data.images):  # textures were never staged; nothing renders from an image
        bpy.data.images.remove(image)
    return [o for o in bpy.data.objects if o not in before]


# --- the figure ----------------------------------------------------------------------------------------------------------


class Figure:
    """The profile's character: base body, chiton, himation and hair, posed through `pose`."""

    def __init__(self, profile: dict, camera: dict, staging: Staging, scene, axes: Axes, book: MaterialBook):
        self.profile, self.camera, self.scene, self.axes, self.book = profile, camera, scene, axes, book
        self.ppu = camera["pixelsPerUnit"]
        models = profile["models"]
        # Animation source: the library's actions (same bone names as the base character rig).
        for o in import_gltf(staging.file(models["animations"]["kit"], models["animations"]["path"])):
            bpy.data.objects.remove(o, do_unlink=True)
        objs = import_gltf(staging.file(models["body"]["kit"], models["body"]["path"]))
        self.arm = next((o for o in objs if o.type == "ARMATURE"), None)
        if self.arm is None:
            raise InputError("the body model has no armature")
        meshes = {o.name: o for o in objs if o.type == "MESH"}
        self.body = next((o for n, o in meshes.items() if n.lower().startswith("superhero")), None)
        if self.body is None:
            raise InputError("the body model has no Superhero mesh")
        self.locators = {n: o for n, o in meshes.items() if n in ("Eyes", "Eyebrows")}
        for n, o in meshes.items():
            if o is not self.body and n not in self.locators:
                bpy.data.objects.remove(o, do_unlink=True)
        for o in self.locators.values():
            o.hide_render = True
        ad = self.arm.animation_data
        if ad is not None:
            for track in list(ad.nla_tracks):
                ad.nla_tracks.remove(track)
        for side in ("l", "r"):  # a scaled limb must not scale the hand or foot hanging off it
            for name in LIMB_CHILDREN:
                bone = self.arm.data.bones.get(f"{name}_{side}")
                if bone is not None:
                    bone.inherit_scale = "NONE"
        self.render_objs = [self.body]

        roles = list(profile["garment"]["roles"])
        garment = build_garment(self.arm, self.body, profile["garment"])
        book.bind(garment, roles)
        self.render_objs.append(garment)
        self.standing_garment = [garment]
        self.seated_garment = []
        seated = profile["garment"].get("seated")
        if seated is not None:  # a garment of its own for the seated state: the torso, then a lap and the shin drapes
            torso = build_garment(self.arm, self.body, profile["garment"], seated["keepRings"], f"{profile['garment']['name']}_seated")
            self.seated_garment = [torso, *(build_seated_legs(self.arm, profile["garment"], side) for side in ("l", "r"))]
            for piece in self.seated_garment:
                book.bind(piece, roles)
                piece.hide_render = True
                self.render_objs.append(piece)
        if "himation" in profile:
            himation = build_himation(self.arm, profile["himation"])
            book.bind(himation, [profile["himation"]["role"]])
            self.render_objs.append(himation)
        if "beard" in profile:
            beard = build_himation(self.arm, profile["beard"], 16, "beard_mesh", "beard")
            book.bind(beard, [profile["beard"]["role"]])
            self.render_objs.append(beard)
        self.neutral = {}
        for piece in profile["models"]["hair"]:
            self.render_objs.append(self.add_hair(staging, piece))
        book.bind(self.body, [BODY_ROLE] * max(1, len(self.body.data.materials)))
        set_ids(self.body, body_face_parts(self.body))
        self.calibrate()
        self.fit_scale(profile["body"]["standingHeightPx"])

    def add_hair(self, staging: Staging, piece: dict):
        objs = import_gltf(staging.file(piece["model"]["kit"], piece["model"]["path"]))
        mesh = next((o for o in objs if o.type == "MESH" and o.name.startswith(("Hair", "Beard"))), None)
        if mesh is None:
            raise InputError(f"{piece['model']['path']} holds no hair mesh")
        for o in objs:
            if o is not mesh:
                bpy.data.objects.remove(o, do_unlink=True)
        for m in mesh.modifiers:
            if m.type == "ARMATURE":
                m.object = self.arm
        drop, keep, cut = piece.get("dropFrontBelow"), piece.get("keepSidesBack"), piece.get("cutBelow")
        if drop or keep or cut is not None:
            bm = bmesh.new()
            bm.from_mesh(mesh.data)
            doomed = []
            for f in bm.faces:
                x, y, z = f.calc_center_median()
                if drop and y < drop[0] and z < drop[1]:
                    doomed.append(f)
                elif keep and not (abs(x) >= keep[0] or y >= keep[1]):
                    doomed.append(f)
                elif cut is not None and z < cut:
                    doomed.append(f)
            bmesh.ops.delete(bm, geom=doomed, context="FACES")
            bm.to_mesh(mesh.data)
            bm.free()
        if piece.get("smooth") or piece.get("taper") or piece.get("scale") or piece.get("offset"):
            smooth_piece(mesh, piece.get("smooth", 0), piece.get("taper"), piece.get("scale"), piece.get("offset"))
        mesh.parent = self.arm
        mesh.matrix_parent_inverse = mathutils.Matrix.Identity(4)
        set_ids(mesh, piece["part"])
        self.book.bind(mesh, [piece["role"]] * max(1, len(mesh.data.materials)))
        return mesh

    # --- calibration ---

    def calibrate(self) -> None:
        """Facing, then the sole midpoint and ground height of the FINAL idle pose: the bearing, proportions and leg
        policy are all applied, so the figure's feet stand on the pivot whatever the profile does to the legs."""
        profile = self.profile
        rest = profile["models"]["restAction"]
        set_action(self.arm, rest)
        go_to(self.scene, 0.0)
        self.arm.scale = (1.0, 1.0, 1.0)
        place_armature(self.arm, 0.0, (0.0, 0.0), 0.0)
        arm_eval, _ = evaluated(self.arm, self.body)
        left = tuple(a - b for a, b in zip(bone_head(arm_eval, "thigh_l"), bone_head(arm_eval, "thigh_r"), strict=True))
        forward = (left[1], -left[0])  # the rest pose is symmetric, so the facing is exact
        facing = facing_vectors(self.axes)
        self.yaws = {d: yaw_to_face(forward, facing[d]) for d in DIRECTIONS}
        idle = self.clip("idle")
        start = bpy.data.actions[idle["action"]].frame_range[0]
        self.scale = 1.0
        self.apply_pose("idle", "south", start)
        self.arm.rotation_mode = "XYZ"
        self.arm.rotation_euler = (0.0, 0.0, 0.0)
        self.arm.scale = (1.0, 1.0, 1.0)
        self.arm.location = (0.0, 0.0, 0.0)
        bpy.context.view_layer.update()
        arm_eval, _ = evaluated(self.arm, self.body)
        heads = [bone_head(arm_eval, n) for n in FOOT_BONES]
        self.sole_local = (sum(h[0] for h in heads) / 4, sum(h[1] for h in heads) / 4)
        self.ground_local = float(mesh_points(self.body)[:, 2].min())

    def clip(self, state: str) -> dict:
        clip = self.profile["clips"].get(state)
        if clip is None:
            raise InputError(f"the profile has no clip for state {state!r}")
        return clip

    def fit_scale(self, target_px: float) -> None:
        """The same camera scale for everyone: only the model is enlarged, to the profile's standing height."""
        self.scale = 1.0
        idle = self.clip("idle")
        self.pose("idle", "south", bpy.data.actions[idle["action"]].frame_range[0])
        pts = all_points(self.render_objs)
        up = pts @ np.array(self.axes.up)
        self.fit_extent_px = float((up.max() - up.min()) * self.ppu)
        self.scale = target_px / self.fit_extent_px

    def place(self, yaw: float) -> None:
        s = self.scale
        sx, sy, sz = (s * k for k in self.profile["body"]["scale"])
        rot = mathutils.Matrix.Rotation(math.radians(yaw), 2)
        shifted = rot @ Vector((self.sole_local[0] * sx, self.sole_local[1] * sy))
        self.arm.rotation_mode = "XYZ"
        self.arm.rotation_euler = (0.0, 0.0, math.radians(yaw))
        self.arm.scale = (sx, sy, sz)
        self.arm.location = (-shifted.x, -shifted.y, -self.ground_local * sz)
        bpy.context.view_layer.update()

    # --- the one pose function ---

    def bone_scales(self) -> dict:
        body = self.profile["body"]
        out = {"Head": (body["headScale"],) * 3}
        for side in ("l", "r"):
            out[f"hand_{side}"] = (body["handScale"],) * 3
            out[f"foot_{side}"] = (body["footScale"],) * 3
            legs = body["legs"]
            for bone in ("thigh", "calf"):
                if legs["length"] != 1.0 or legs["thickness"] != 1.0:
                    out[f"{bone}_{side}"] = (legs["thickness"], legs["length"], legs["thickness"])
            if body["armLength"] != 1.0:
                for bone in ("upperarm", "lowerarm"):
                    out[f"{bone}_{side}"] = (1.0, body["armLength"], 1.0)
        return out

    def neutral_pose(self, action_name: str, bones) -> dict:
        """Mean local rotation and location of each bone over the whole clip: the neutral pose a tempered gait scales
        about. Sampled at 16 loop times, cached per action and bone."""
        action = bpy.data.actions[action_name]
        missing = [b for b in bones if (action_name, b) not in self.neutral]
        if missing:
            frames = sample_frames(*action.frame_range, 16, True)
            quats = {b: [] for b in missing}
            locs = {b: [] for b in missing}
            for f in frames:
                go_to(self.scene, f)
                for b in missing:
                    pb = self.arm.pose.bones[b]
                    q = pb.rotation_quaternion.copy()
                    if quats[b] and quats[b][0].dot(q) < 0:
                        q.negate()  # one hemisphere, so the mean is not cancelled by a double cover
                    quats[b].append(q)
                    locs[b].append(pb.location.copy())
            for b in missing:
                total = mathutils.Quaternion((0.0, 0.0, 0.0, 0.0))
                for q in quats[b]:
                    total = mathutils.Quaternion((total.w + q.w, total.x + q.x, total.y + q.y, total.z + q.z))
                total.normalize()
                self.neutral[(action_name, b)] = (total, sum(locs[b], Vector((0.0, 0.0, 0.0))) / len(locs[b]))
        return {b: self.neutral[(action_name, b)] for b in bones}

    def apply_pose(self, state: str, facing: str, frame: float) -> None:
        """Pose every clip, sample variant and control: keyed by the semantic state, never by an output clip name."""
        profile = self.profile
        clip = self.clip(state)
        set_action(self.arm, clip["action"])
        policy = pose_policy(profile, state, facing)
        damp, damp_location = policy.get("damp", {}), policy.get("dampLocation", {})
        for name in [*damp, *damp_location]:
            if name not in self.arm.pose.bones:
                raise InputError(f"damp names bone {name!r}, which the rig does not have")
        mean = self.neutral_pose(clip["action"], sorted({*damp, *damp_location})) if damp or damp_location else {}
        go_to(self.scene, frame)
        for name, factor in damp.items():
            pb = self.arm.pose.bones[name]
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = mean[name][0].slerp(pb.rotation_quaternion, factor)
        for name, factor in damp_location.items():
            pb = self.arm.pose.bones[name]
            pb.location = mean[name][1] + (pb.location - mean[name][1]) * factor
        seated = state == "seated" and bool(self.seated_garment)  # the seated garment replaces the standing one
        for piece in self.standing_garment:
            piece.hide_render = seated
        for piece in self.seated_garment:
            piece.hide_render = not seated
        aims = policy.get("aims", {})
        order = sorted(aims, key=lambda b: AIM_ORDER.index(b) if b in AIM_ORDER else len(AIM_ORDER))
        for bone in order:
            if bone not in self.arm.pose.bones:
                raise InputError(f"aim names bone {bone!r}, which the rig does not have")
        aim_bones(self.arm, {b: aims[b] for b in order})
        rotate_bones(self.arm, profile["body"]["stance"])  # the bearing, then the state's own refinement on top of it
        rotate_bones(self.arm, policy.get("rotations", {}))
        for name, scale in self.bone_scales().items():
            if name in self.arm.pose.bones:
                self.arm.pose.bones[name].scale = scale
        head = self.arm.pose.bones.get("Head")
        pitch = profile["body"]["headPitchDeg"]
        if pitch and head is not None:
            head.rotation_mode = "QUATERNION"
            head.rotation_quaternion = head.rotation_quaternion @ mathutils.Quaternion((1.0, 0.0, 0.0), math.radians(pitch))
        curl = profile["body"]["curlDeg"]
        if curl:
            for finger in FINGER_CHAINS:
                for side in ("l", "r"):
                    for joint, share in enumerate(FINGER_JOINT_SHARE, start=1):
                        self.curl(f"{finger}_0{joint}_{side}", curl * share)
            for side in ("l", "r"):
                for joint, share in enumerate(FINGER_JOINT_SHARE, start=1):
                    self.curl(f"thumb_0{joint}_{side}", curl * 0.5 * share)
        self.arm.animation_data.action = None  # freeze the pose; a render must not re-evaluate the action

    def foot_mask(self):
        if not hasattr(self, "_foot_mask"):
            groups = dominant_groups(self.body)
            self._foot_mask = np.array([g in FOOT_BONES for g in groups])
        return self._foot_mask

    def pose(self, state: str, facing: str, frame: float) -> None:
        self.apply_pose(state, facing, frame)
        self.place(self.yaws[facing])
        if pose_policy(self.profile, state, facing).get("groundFeet"):
            # a tempered gait: this frame's lowest sole stands on the ground plane, so the figure never floats
            lowest = float(mesh_points(self.body)[self.foot_mask()][:, 2].min())
            self.arm.location = (self.arm.location.x, self.arm.location.y, self.arm.location.z - lowest)
            bpy.context.view_layer.update()

    def curl(self, bone: str, degrees: float) -> None:
        pb = self.arm.pose.bones.get(bone)
        if pb is not None:
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = tuple(math.radians(degrees) * a for a in FIST_AXIS)

    # --- facts for the post step ---

    def project_px(self, point) -> list:
        cell = self.camera["cell"]
        x = cell["pivot"][0] + float(np.dot(point, self.axes.right)) * self.ppu
        y = cell["pivot"][1] - float(np.dot(point, self.axes.up)) * self.ppu
        return [round(x, 4), round(y, 4)]

    def camera_depth(self, point, cam) -> float:
        return round(float((np.array(point, dtype=np.float64) - np.array(cam.location)) @ np.array(self.axes.view)), 4)

    def extent(self) -> dict:
        pts = all_points(self.render_objs)
        cell = self.camera["cell"]
        ys = cell["pivot"][1] - pts @ np.array(self.axes.up) * self.ppu
        xs = cell["pivot"][0] + pts @ np.array(self.axes.right) * self.ppu
        return {"top": round(float(ys.min()), 3), "bottom": round(float(ys.max()), 3), "left": round(float(xs.min()), 3), "right": round(float(xs.max()), 3)}

    def locator_facts(self, cam) -> dict:
        facts: dict = {"points": {}}
        for name, obj in self.locators.items():
            world = mesh_points(obj)
            rest = np.array([v.co for v in obj.data.vertices])
            side = rest[:, 0] > 0  # the character's left is +X in the rig
            for label, mask in (("l", side), ("r", ~side)):
                c = world[mask].mean(axis=0)
                facts["points"][f"{name.lower()}_{label}"] = {"px": self.project_px(c), "depth": self.camera_depth(c, cam)}
        return facts


# --- GPU probe, pin, parent guard -----------------------------------------------------------------------------------


def gpu_context_probe() -> None:
    """Create the EEVEE context by rendering one tiny frame. Raises when no context can be created."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 8
    scene.render.resolution_percentage = 100
    cam = bpy.data.objects.new("probe-cam", bpy.data.cameras.new("probe-cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    bpy.ops.render.render(write_still=False)


def start_parent_guard() -> None:
    """Exit when the parent dies, so a killed sidecar does not leave a render running."""
    parent = os.getppid()

    def watch() -> None:
        while True:
            time.sleep(1.0)
            if os.getppid() != parent:
                os._exit(EXIT_SCRIPT_ERROR)

    threading.Thread(target=watch, name="parent-guard", daemon=True).start()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# --- slots ------------------------------------------------------------------------------------------------------------------


def render_slot(slot: dict, figure: Figure, book: MaterialBook, recipe: dict, id_mat, depth_mat) -> dict:
    scene, camera = figure.scene, recipe["camera"]
    state, facing, count = slot["state"], slot["facing"], slot["frames"]
    clip = figure.clip(state)
    action = bpy.data.actions.get(clip["action"])
    if action is None:
        raise InputError(f"the animation library has no action {clip['action']!r}")
    sources = sample_frames(*action.frame_range, count, clip["loop"])
    size = (camera["cell"]["width"] * camera["supersample"], camera["cell"]["height"] * camera["supersample"])
    out_dir = Path(slot["outDir"])
    partial = out_dir.with_name(out_dir.name + ".partial")
    if out_dir.exists():
        raise InputError(f"slot directory {out_dir} already exists")
    if partial.exists():
        shutil.rmtree(partial)
    partial.mkdir(parents=True)
    book.use()
    files = {role: [] for role in ROLES}
    extents, locators = [], []
    started = time.perf_counter()
    for index, frame in enumerate(sources):
        figure.pose(state, facing, frame)
        bpy.context.view_layer.update()  # the camera's matrix must be current before it is queried
        extents.append(figure.extent())
        locators.append(figure.locator_facts(scene.camera))
        for role, override in (("colour", None), ("id", id_mat), ("depth", depth_mat)):
            name = f"{role}/{index:02d}.png"
            render_pass(scene, partial / name, size, override)
            files[role].append({"name": name})
    for role in ROLES:
        for entry in files[role]:
            entry["sha256"] = sha256_file(partial / entry["name"])
    os.replace(partial, out_dir)  # the frames are in place; the sentinel below is the commit
    done = {
        "schemaVersion": 1,
        "slot": slot["id"],
        "blender": {"version": recipe["blender"]["version"], "buildHash": recipe["blender"]["buildHash"]},
        "frames": count,
        "files": files,
        "sourceFrames": [round(float(s), 6) for s in sources],
        "extentPx": extents,
        "locators": locators,
    }
    tmp = out_dir / (SENTINEL_NAME + ".tmp")
    tmp.write_text(json.dumps(done, indent=2) + "\n")
    os.replace(tmp, out_dir / SENTINEL_NAME)
    return {"slot": slot["id"], "frames": count, "render_ms": round((time.perf_counter() - started) * 1000.0, 1)}


# --- main ------------------------------------------------------------------------------------------------------------------------


def parse_args() -> Path:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) != 2 or argv[0] != "--recipe":
        raise InputError("usage: --recipe <recipe.json>")
    return Path(argv[1])


def read_recipe(path: Path) -> dict:
    try:
        recipe = json.loads(path.read_text())
    except (OSError, ValueError) as e:
        raise InputError(f"cannot read the recipe {path}: {e}") from e
    for key in ("schemaVersion", "blender", "stagingRoot", "camera", "profile", "palette", "slots"):
        if key not in recipe:
            raise InputError(f"the recipe has no {key!r}")
    if recipe["schemaVersion"] != 1:
        raise InputError(f"unsupported recipe schema version {recipe['schemaVersion']!r}")
    return recipe


def check_pin(recipe: dict) -> None:
    version = bpy.app.version_string.split()[0]
    build = bpy.app.build_hash.decode()
    if version != recipe["blender"]["version"] or build != recipe["blender"]["buildHash"]:
        print(f"RENDER version mismatch: got {version!r} {build!r}, the recipe pins {recipe['blender']['version']!r} {recipe['blender']['buildHash']!r}", flush=True)
        sys.exit(EXIT_VERSION)


def main() -> int:
    started = time.perf_counter()
    print(f"{FIRST_LINE_MARKER} {json.dumps({'version': bpy.app.version_string, 'buildHash': bpy.app.build_hash.decode()})}", flush=True)
    start_parent_guard()
    try:
        recipe = read_recipe(parse_args())
    except InputError as e:
        print(f"RENDER input error: {e}", flush=True)
        return EXIT_INPUT
    check_pin(recipe)
    try:
        gpu_context_probe()
    except Exception as e:  # reported and mapped; the exit code table is the contract
        print(f"RENDER no GPU context: {e!r}", flush=True)
        return EXIT_NO_GPU
    try:
        camera, profile = recipe["camera"], recipe["profile"]
        staging = Staging(recipe["stagingRoot"])
        scene, axes = fresh_scene(camera)
        make_camera(scene, axes, camera)
        book = MaterialBook(profile, recipe["palette"], camera)
        figure = Figure(profile, camera, staging, scene, axes, book)
        id_mat = id_override_material()
        depth_mat = depth_material(*camera["depthRange"])
        built = time.perf_counter()
        print(f"RENDER scene {json.dumps({'build_ms': round((built - started) * 1000.0, 1), 'scale': round(figure.scale, 5), 'fit_extent_px_at_scale_1': round(figure.fit_extent_px, 3)})}", flush=True)
        for slot in recipe["slots"]:
            print(f"RENDER slot {json.dumps(render_slot(slot, figure, book, recipe, id_mat, depth_mat))}", flush=True)
    except InputError as e:
        print(f"RENDER input error: {e}", flush=True)
        return EXIT_INPUT
    print(f"RENDER done {json.dumps({'wall_ms': round((time.perf_counter() - started) * 1000.0, 1)})}", flush=True)
    return EXIT_OK


if __name__ == "__main__":
    try:
        code = main()
    except SystemExit:
        raise
    except BaseException:
        traceback.print_exc()
        code = EXIT_SCRIPT_ERROR
    sys.stdout.flush()
    sys.exit(code)

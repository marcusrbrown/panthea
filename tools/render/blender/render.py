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
        for field in ("aims", "rotations", "damp", "dampLocation", "breath"):
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


ROW_FIELDS = ("z", "halfWidth", "halfDepth", "centreY", "fromDeg", "toDeg", "fold")


def seated_rows(rows: list, spec: dict) -> list:
    """The rows of a mantle strip as it hangs over a seat: they end at `hemZ` in a lip that flares outward, and the rows
    below the hips narrow toward the hem (linearly from 1 at z 1.0 to `narrow`), so the chiton shows at the sides."""
    hem, flare, narrow = spec["hemZ"], spec["flare"], spec["narrow"]
    kept = [r for r in rows if r["z"] > hem]
    out = [dict(r) for r in kept]
    if len(kept) < len(rows):
        hi, lo = kept[-1], rows[len(kept)]
        t = (hi["z"] - hem) / (hi["z"] - lo["z"])
        out.append({k: hi[k] + (lo[k] - hi[k]) * t for k in ROW_FIELDS})
        out[-1]["z"] = hem
        out.append({**out[-1], "z": hem - 0.05})
    for r in out:
        shrink = 1.0 + (narrow - 1.0) * min(1.0, max(0.0, (1.0 - r["z"]) / max(1.0 - hem, 1e-6)))
        r["halfWidth"] *= shrink
        r["halfDepth"] *= shrink
    if len(kept) < len(rows):
        out[-1]["halfWidth"] *= flare
        out[-1]["halfDepth"] *= flare
    return out


def build_himation(arm, himation: dict, default_columns: int = 14, name: str = "himation", part: str = "himation", seated: bool = False):
    """An open draped mesh of strips of arcs (never a closed ring), each skinned to the bones its weight table names by
    height. The himation hangs over the character's left shoulder; the beard is the same construction on the head. Faces
    across a crease keep their own normals (a crisp facet); the rest of the strip shades smooth. One object, one part id,
    one material."""
    bm = bmesh.new()
    weights: dict = {}
    index = 0
    for strip in himation["strips"]:
        creases = strip.get("creases", [])
        columns = strip.get("columns", default_columns)
        strip_rows = seated_rows(strip["rows"], himation["seated"]) if seated else strip["rows"]
        rows = [[bm.verts.new(p) for p in arc_points(row, columns, strip["folds"], creases)] for row in strip_rows]
        for row, verts in zip(strip_rows, rows):
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
        self.standing_mantle, self.seated_mantle = [], []
        if "himation" in profile:
            himation = build_himation(self.arm, profile["himation"])
            book.bind(himation, [profile["himation"]["role"]])
            self.render_objs.append(himation)
            self.standing_mantle = [himation]
            if "seated" in profile["himation"]:  # the same strips as they hang over a seat
                lap = build_himation(self.arm, profile["himation"], 14, "himation_seated", "himation", True)
                book.bind(lap, [profile["himation"]["role"]])
                lap.hide_render = True
                self.render_objs.append(lap)
                self.seated_mantle = [lap]
        if "beard" in profile:
            beard = build_himation(self.arm, profile["beard"], 16, "beard_mesh", "beard")
            book.bind(beard, [profile["beard"]["role"]])
            self.render_objs.append(beard)
        for key, name, columns in (("hair", "hair_mesh", 28), ("fillet", "fillet_mesh", 28)):  # built for the purpose, weighted to the head
            if key in profile:
                mesh = build_himation(self.arm, profile[key], columns, name, "hair")
                book.bind(mesh, [profile[key]["role"]])
                self.render_objs.append(mesh)
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
        drop, keep = piece.get("dropFrontBelow"), piece.get("keepSidesBack")
        if drop or keep:
            bm = bmesh.new()
            bm.from_mesh(mesh.data)
            doomed = []
            for f in bm.faces:
                x, y, z = f.calc_center_median()
                if drop and y < drop[0] and z < drop[1]:
                    doomed.append(f)
                elif keep and not (abs(x) >= keep[0] or y >= keep[1]):
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

    def sources(self, state: str, count: int) -> list:
        """Source frames of the state's action, sampled `count` times."""
        clip = self.clip(state)
        action = bpy.data.actions.get(clip["action"])
        if action is None:
            raise InputError(f"the animation library has no action {clip['action']!r}")
        return sample_frames(*action.frame_range, count, clip["loop"])

    def prepare(self, state: str) -> None:
        """A figure is built once; nothing changes with the state."""

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
        seated_cloak = state == "seated" and bool(self.seated_mantle)
        for piece in self.standing_mantle:
            piece.hide_render = seated_cloak
        for piece in self.seated_mantle:
            piece.hide_render = not seated_cloak
        aims = policy.get("aims", {})
        order = sorted(aims, key=lambda b: AIM_ORDER.index(b) if b in AIM_ORDER else len(AIM_ORDER))
        for bone in order:
            if bone not in self.arm.pose.bones:
                raise InputError(f"aim names bone {bone!r}, which the rig does not have")
        aim_bones(self.arm, {b: aims[b] for b in order})
        rotate_bones(self.arm, profile["body"]["stance"])  # the bearing, then the state's own refinement on top of it
        rotate_bones(self.arm, policy.get("rotations", {}))
        breath = policy.get("breath")
        if breath:  # the chest lifts and settles once per loop, 0 at the seam; the pelvis and the legs are not named
            start, end = bpy.data.actions[clip["action"]].frame_range
            weight = 0.5 * (1.0 - math.cos(2.0 * math.pi * (frame - start) / (end - start)))
            for bone, offset in breath.items():
                pb = self.arm.pose.bones.get(bone)
                if pb is None:
                    raise InputError(f"breath names bone {bone!r}, which the rig does not have")
                pb.location = pb.location + Vector(offset) * weight
            bpy.context.view_layer.update()
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


# --- structures: a building or a tree, one static scene ---------------------------------------------------------------


def ground_basis(axes: Axes):
    """World unit directions of the ground axes a 2:1 view draws as a diamond's edges: +X runs screen down-right, +Y down-left."""
    m = np.array([[axes.right[0], axes.right[1]], [axes.up[0], axes.up[1]]])
    ex = np.linalg.solve(m, np.array([1.0, -0.5]))
    ey = np.linalg.solve(m, np.array([-1.0, -0.5]))
    ex, ey = ex / np.linalg.norm(ex), ey / np.linalg.norm(ey)
    return Vector((float(ex[0]), float(ex[1]), 0.0)), Vector((float(ey[0]), float(ey[1]), 0.0))


def hash_unit(i: int) -> float:
    """A fixed pseudo-random number in [0, 1) for index i, so a ruin breaks the same way on every render."""
    return (math.sin(i * 12.9898 + 78.233) * 43758.5453) % 1.0


class MeshBuilder:
    """Closed solids added in groups, each with a material role and a part id; `finish` makes the object."""

    def __init__(self):
        self.bm = bmesh.new()
        self.roles: list = []
        self.parts: list = []

    def add(self, faces, role: str, part: str) -> None:
        if role not in self.roles:
            self.roles.append(role)
        slot = self.roles.index(role)
        for face in faces:
            face.material_index = slot
            self.parts.append(part)

    @staticmethod
    def turned(verts, centre, turns) -> None:
        """Turns the vertices about `centre`, one (degrees, axis) after another."""
        centre = Vector(centre)
        for degrees, axis in turns:
            rot = mathutils.Matrix.Rotation(math.radians(degrees), 3, axis)
            for v in verts:
                v.co = centre + rot @ (v.co - centre)

    def solid(self, verts, quads, role: str, part: str) -> None:
        self.add([self.bm.faces.new([verts[i] for i in quad]) for quad in quads], role, part)

    def box(self, centre, size, role: str, part: str, tilt=()):
        """Axis-aligned box, then turned about its own centre by `tilt`, a sequence of (degrees, axis)."""
        cx, cy, cz = centre
        sx, sy, sz = (s / 2 for s in size)
        verts = [self.bm.verts.new((cx + dx * sx, cy + dy * sy, cz + dz * sz)) for dx in (-1, 1) for dy in (-1, 1) for dz in (-1, 1)]
        self.turned(verts, centre, tilt)
        self.solid(verts, ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)), role, part)

    def column(self, centre, radius: float, height: float, role: str, part: str, taper: float = 1.0, segments: int = 10):
        cx, cy, cz = centre
        ring = lambda r, z: [self.bm.verts.new((cx + r * math.cos(2 * math.pi * i / segments), cy + r * math.sin(2 * math.pi * i / segments), z)) for i in range(segments)]  # noqa: E731
        bottom, top = ring(radius, cz), ring(radius * taper, cz + height)
        faces = [self.bm.faces.new((bottom[i], bottom[(i + 1) % segments], top[(i + 1) % segments], top[i])) for i in range(segments)]
        faces.append(self.bm.faces.new(top[::-1]))
        faces.append(self.bm.faces.new(bottom))
        self.add(faces, role, part)

    def limb(self, a, b, r0: float, r1: float, role: str, part: str, segments: int = 7):
        """A tapering round limb from point a (radius r0) to point b (radius r1), capped at both ends."""
        a, b = Vector(a), Vector(b)
        axis = (b - a).normalized()
        side = axis.cross(Vector((0.0, 0.0, 1.0)) if abs(axis.z) < 0.9 else Vector((1.0, 0.0, 0.0))).normalized()
        up = axis.cross(side)
        ring = lambda c, r: [self.bm.verts.new(c + r * (math.cos(2 * math.pi * i / segments) * side + math.sin(2 * math.pi * i / segments) * up)) for i in range(segments)]  # noqa: E731
        start, end = ring(a, r0), ring(b, r1)
        faces = [self.bm.faces.new((start[i], start[(i + 1) % segments], end[(i + 1) % segments], end[i])) for i in range(segments)]
        faces.append(self.bm.faces.new(end[::-1]))
        faces.append(self.bm.faces.new(start))
        self.add(faces, role, part)

    def prism(self, axis: str, along0: float, along1: float, half_w: float, z0: float, rise: float, role: str, part: str):
        """Triangular prism, its ridge along `axis` ("x" or "y"): base at z0 spanning ±half_w across the ridge, apex at z0 + rise."""
        at = (lambda a, c, z: (a, c, z)) if axis == "x" else (lambda a, c, z: (c, a, z))
        v = [self.bm.verts.new(at(a, c, z)) for a in (along0, along1) for c, z in ((-half_w, z0), (half_w, z0), (0.0, z0 + rise))]
        self.solid(v, ((0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)), role, part)

    def finish(self, name: str, ex: Vector, ey: Vector):
        mesh = bpy.data.meshes.new(name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for poly in mesh.polygons:
            poly.use_smooth = False
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        # Authored in house coordinates (+X along the ridge, +Y toward the front); laid onto the ground axes.
        mesh.transform(mathutils.Matrix(((ex.x, ey.x, 0.0, 0.0), (ex.y, ey.y, 0.0, 0.0), (0.0, 0.0, 1.0, 0.0), (0.0, 0.0, 0.0, 1.0))))
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()
        set_ids(obj, self.parts)
        return obj, self.roles


class Structure:
    """A tree or a building in one static scene: built for a state, posed by the wind (or not at all), never rigged."""

    def __init__(self, profile: dict, camera: dict, staging: Staging, scene, axes: Axes, book: MaterialBook):
        self.profile, self.camera, self.scene, self.axes, self.book = profile, camera, scene, axes, book
        self.staging = staging
        self.ppu = camera["pixelsPerUnit"]
        self.ex, self.ey = ground_basis(axes)
        self.objs: list = []
        self.state = None

    def clip(self, state: str) -> dict:
        clip = self.profile["clips"].get(state)
        if clip is None:
            raise InputError(f"the profile has no clip for state {state!r}")
        return clip

    def sources(self, state: str, count: int) -> list:
        """Source frames: the frame numbers of a wind loop, or the one frame of a still state."""
        clip = self.clip(state)
        if not clip["loop"]:
            return [0.0] * count
        return [float(i) for i in range(count)]

    def look(self, clip: dict, role: str) -> str:
        """The profile material this state draws a model role in."""
        return clip["materials"].get(role, role)

    def prepare(self, state: str) -> None:
        """Builds the state's scene; the materials are bound by `book.use()` after this."""
        if state == self.state:
            return
        for obj in self.objs:
            bpy.data.objects.remove(obj, do_unlink=True)
        self.objs = []
        self.book.slots.clear()
        self.state = state
        self.build(state, self.clip(state))

    def attach(self, builder: MeshBuilder, name: str, clip: dict) -> None:
        obj, roles = builder.finish(name, self.ex, self.ey)
        self.book.bind(obj, [self.look(clip, role) for role in roles])
        self.objs.append(obj)

    def build(self, state: str, clip: dict) -> None:
        raise NotImplementedError

    def pose(self, state: str, facing: str, frame: float) -> None:
        bpy.context.view_layer.update()

    def extent(self) -> dict:
        pts = all_points(self.objs)
        cell = self.camera["cell"]
        ys = cell["pivot"][1] - pts @ np.array(self.axes.up) * self.ppu
        xs = cell["pivot"][0] + pts @ np.array(self.axes.right) * self.ppu
        return {"top": round(float(ys.min()), 3), "bottom": round(float(ys.max()), 3), "left": round(float(xs.min()), 3), "right": round(float(xs.max()), 3)}

    def locator_facts(self, cam) -> dict:
        return {"points": {}}


class House(Structure):
    """A Greek town house from script geometry: whitewashed walls on a stone plinth, a low-pitch roof of tile courses,
    a columned porch with a pediment on the +Y front (the door side), windows with shutters, a gable end on +X.

    Damaged is this mesh with its marks added as decals: the silhouette is the whole house's. The ruin breaks the
    walls, the porch and the roof."""

    LENGTH, DEPTH = 4.2, 3.0  # footprint, metres
    PLINTH, WALL, CORNICE = 0.3, 2.4, 0.16
    EAVE, PITCH, COURSES, COURSE_T = 0.35, 20.0, 9, 0.09
    PORCH_W, PORCH_D, COLUMN_H = 2.3, 1.2, 2.25
    DOOR_W, DOOR_H = 0.95, 1.85
    WINDOW_X, WINDOW_Z, WINDOW_W, WINDOW_H = 1.5, 1.5, 0.5, 0.8

    def build(self, state: str, clip: dict) -> None:
        if clip["ruin"]:
            self.build_ruin(clip)
        else:
            self.build_whole(clip)

    @property
    def wall_top(self) -> float:
        return self.PLINTH + self.WALL

    def wall_box(self, mb: MeshBuilder, wall: str, a: float, n: float, z: float, along: float, depth: float, high: float, role: str, part: str, tilt=()):
        """A box on a wall: `a` along it (x on the front, y on the side), `n` out from its plane, `z` its centre height."""
        L, D = self.LENGTH, self.DEPTH
        if wall == "front":
            mb.box((a, D / 2 + n, z), (along, depth, high), role, part, tilt)
        else:
            mb.box((L / 2 + n, a, z), (depth, along, high), role, part, tilt)

    def plinth(self, mb: MeshBuilder) -> None:
        L, D, P, p = self.LENGTH, self.DEPTH, self.PLINTH, self.PORCH_D
        mb.box((0, 0, P / 2), (L + 0.5, D + 0.5, P), "plinth", "stylobate")
        # The porch's floor and the step up to it.
        mb.box((0, D / 2 + (p + 0.3) / 2 - 0.1, P / 2), (self.PORCH_W + 0.5, p + 0.3, P), "plinth", "stylobate")
        mb.box((0, D / 2 + p + 0.45, 0.08), (1.5, 0.4, 0.16), "plinth", "stylobate")

    def window(self, mb: MeshBuilder, wall: str, a: float) -> None:
        w, h, z = self.WINDOW_W, self.WINDOW_H, self.WINDOW_Z
        self.wall_box(mb, wall, a, 0.01, z, w, 0.03, h, "window", "door")
        # A deep frame around a dark opening, a sill and a lintel, and a shutter either side.
        self.wall_box(mb, wall, a - w / 2 - 0.035, 0.05, z, 0.07, 0.1, h + 0.14, "trim", "entablature")
        self.wall_box(mb, wall, a + w / 2 + 0.035, 0.05, z, 0.07, 0.1, h + 0.14, "trim", "entablature")
        self.wall_box(mb, wall, a, 0.05, z + h / 2 + 0.035, w + 0.14, 0.1, 0.07, "trim", "entablature")
        self.wall_box(mb, wall, a, 0.09, z - h / 2 - 0.05, w + 0.3, 0.18, 0.07, "trim", "entablature")
        self.wall_box(mb, wall, a, 0.03, z + h / 2 + 0.16, w + 0.34, 0.07, 0.1, "trim", "entablature")
        for side in (-1, 1):
            self.wall_box(mb, wall, a + side * (w / 2 + 0.22), 0.035, z, 0.24, 0.05, h + 0.1, "shutter", "door")

    def whole_walls(self, mb: MeshBuilder) -> None:
        L, D, P, p = self.LENGTH, self.DEPTH, self.PLINTH, self.PORCH_D
        mb.box((0, 0, P + self.WALL / 2), (L, D, self.WALL), "wall", "wall")
        mb.box((0, 0, self.wall_top + self.CORNICE / 2), (L + 0.22, D + 0.22, self.CORNICE), "trim", "entablature")
        # The door under the porch: a dark leaf in a stone frame.
        d = self.DOOR_W
        self.wall_box(mb, "front", 0.0, 0.02, P + self.DOOR_H / 2, d, 0.05, self.DOOR_H, "door", "door")
        for side in (-1, 1):
            self.wall_box(mb, "front", side * (d / 2 + 0.07), 0.05, P + self.DOOR_H / 2, 0.14, 0.1, self.DOOR_H + 0.14, "trim", "entablature")
        self.wall_box(mb, "front", 0.0, 0.05, P + self.DOOR_H + 0.07, d + 0.42, 0.1, 0.14, "trim", "entablature")
        for side in (-1, 1):
            self.window(mb, "front", side * self.WINDOW_X)
        self.window(mb, "side", 0.0)
        # The porch: two columns on a plinth carrying an architrave and a pediment.
        cx = self.PORCH_W / 2 - 0.15
        cy = D / 2 + p - 0.2
        shaft = self.COLUMN_H - 0.22
        for side in (-1, 1):
            mb.box((side * cx, cy, P + 0.05), (0.42, 0.42, 0.1), "column", "column")
            mb.column((side * cx, cy, P + 0.1), 0.15, shaft, "column", "column", taper=0.82, segments=10)
            mb.box((side * cx, cy, P + 0.1 + shaft + 0.06), (0.42, 0.42, 0.12), "column", "column")
        top = P + self.COLUMN_H
        mb.box((0, cy, top + 0.13), (self.PORCH_W + 0.2, 0.36, 0.26), "trim", "entablature")
        mb.box((0, (D / 2 + cy) / 2, top + 0.13), (self.PORCH_W - 0.2, p - 0.2, 0.26), "trim", "entablature")

    def roof_slopes(self, mb: MeshBuilder, axis: str, along0: float, along1: float, half_w: float, z_eave: float, rise: float, courses: int) -> None:
        """Both slopes of a gable roof as courses of tile slabs, each higher one stepped up so its lower lip shows, and a ridge cap."""
        theta = math.degrees(math.atan2(rise, half_w))
        length = math.hypot(half_w, rise)
        pitch = length / courses
        mid, span = (along0 + along1) / 2, along1 - along0
        for side in (-1, 1):
            for k in range(courses):
                s = (k + 0.5) * pitch
                across = side * (half_w - s * math.cos(math.radians(theta)))
                z = z_eave + s * math.sin(math.radians(theta))
                lift = self.COURSE_T / 2 + (0.07 if k % 2 else 0.0)
                across += side * lift * math.sin(math.radians(theta))
                z += lift * math.cos(math.radians(theta))
                if axis == "x":
                    mb.box((mid, across, z), (span, pitch * 1.4, self.COURSE_T), "roof", "roof", tilt=[(-side * theta, "X")])
                else:
                    mb.box((across, mid, z), (pitch * 1.4, span, self.COURSE_T), "roof", "roof", tilt=[(side * theta, "Y")])
        ridge_z = z_eave + rise + 0.05
        if axis == "x":
            mb.box((mid, 0.0, ridge_z), (span + 0.12, 0.3, 0.16), "ridge", "roof")
        else:
            mb.box((0.0, mid, ridge_z), (0.3, span + 0.12, 0.16), "ridge", "roof")

    def whole_roof(self, mb: MeshBuilder) -> None:
        L, D, e = self.LENGTH, self.DEPTH, self.EAVE
        tan = math.tan(math.radians(self.PITCH))
        half_w = D / 2 + e
        z_eave = self.wall_top + self.CORNICE - 0.02
        # Whitewashed gable fill under the slabs, so the end of the house is a wall to the ridge.
        wall_hw = D / 2 + 0.05
        z0 = z_eave + (half_w - wall_hw) * tan - self.COURSE_T - 0.05
        mb.prism("x", -L / 2, L / 2, wall_hw, z0, wall_hw * tan, "gable", "pediment")
        self.roof_slopes(mb, "x", -(L / 2 + 0.3), L / 2 + 0.3, half_w, z_eave, half_w * tan, self.COURSES)
        # The porch's own small gable: a pediment on the columns' front line, slabs over it, running into the main roof.
        D2, p, top = D / 2, self.PORCH_D, self.PLINTH + self.COLUMN_H + 0.26
        pw = self.PORCH_W / 2 + 0.15
        porch_z0 = top - 0.02
        rise = pw * tan * 0.9
        mb.prism("y", D2 + 0.05, D2 + p - 0.05, pw - 0.1, porch_z0, (pw - 0.1) * 0.9 * tan, "gable", "pediment")
        self.roof_slopes(mb, "y", D2 + 0.0, D2 + p + 0.05, pw, porch_z0 + 0.12, rise, 4)

    def build_whole(self, clip: dict) -> None:
        mb = MeshBuilder()
        self.plinth(mb)
        self.whole_walls(mb)
        self.whole_roof(mb)
        self.attach(mb, "house", clip)
        self.decals(clip)

    def decals(self, clip: dict) -> None:
        """Flat marks proud of the walls and roof and inside their edges: the silhouette stays the whole house's."""
        if not clip["decals"]:
            return
        mb = MeshBuilder()
        L, D, e = self.LENGTH, self.DEPTH, self.EAVE
        thick = 0.024
        tan = math.tan(math.radians(self.PITCH))
        half_w = D / 2 + e
        theta = self.PITCH
        z_eave = self.wall_top + self.CORNICE - 0.02
        for decal in clip["decals"]:
            u, v = decal["at"]
            w, h = decal["size"]
            turn = [(decal.get("angle", 0.0), "Y" if decal["wall"] == "front" else "X" if decal["wall"] == "side" else "Z")]
            if decal["wall"] == "front":
                mb.box((u - L / 2, D / 2 + 0.1 + thick / 2, v), (w, thick, h), decal["material"], "prop", tilt=turn)
            elif decal["wall"] == "side":
                mb.box((L / 2 + 0.1 + thick / 2, D / 2 - u, v), (thick, w, h), decal["material"], "prop", tilt=turn)
            else:
                # On the front slope, over the tile courses: along the ridge from the roof's left end, up the slope from the eave.
                x = u - (L / 2 + 0.3)
                lift = self.COURSE_T + 0.13
                y = half_w - v * math.cos(math.radians(theta)) + lift * math.sin(math.radians(theta))
                z = z_eave + v * math.sin(math.radians(theta)) + lift * math.cos(math.radians(theta))
                mb.box((x, y, z), (w, h, thick), decal["material"], "prop", tilt=[*turn, (-theta, "X")])
        obj, roles = mb.finish("decals", self.ex, self.ey)
        self.book.bind(obj, roles)
        self.objs.append(obj)

    def build_ruin(self, clip: dict) -> None:
        L, D, P, T = self.LENGTH, self.DEPTH, self.PLINTH, 0.28
        p, cy = self.PORCH_D, self.DEPTH / 2 + self.PORCH_D - 0.2
        mb = MeshBuilder()
        self.plinth(mb)
        mb.box((0, 0, P + 0.03), (L - 0.1, D - 0.1, 0.06), "rubble", "ground")  # the floor
        seg = 0.6
        index = 0

        def course(length: float, fixed: float, along: str, low: float, high: float, gap=None):
            """A broken wall: slabs of fixed length whose heights fall between `low` and `high`."""
            nonlocal index
            count = max(1, round(length / seg))
            width = length / count
            for k in range(count):
                centre = -length / 2 + width * (k + 0.5)
                if gap is not None and gap[0] < centre < gap[1]:
                    continue
                index += 1
                h = low + (high - low) * hash_unit(index)
                pos = (centre, fixed, P + h / 2) if along == "x" else (fixed, centre, P + h / 2)
                size = (width * 0.98, T, h) if along == "x" else (T, width * 0.98, h)
                mb.box(pos, size, "wall", "wall")

        course(L, -D / 2 + T / 2, "x", 1.6, 2.4)  # the far long wall stands highest
        course(D, -L / 2 + T / 2, "y", 1.3, 2.3)  # the far gable wall
        course(L, D / 2 - T / 2, "x", 0.3, 1.1, gap=(-self.DOOR_W / 2 - 0.1, self.DOOR_W / 2 + 0.1))
        course(D, L / 2 - T / 2, "y", 0.3, 1.2)
        # A charred door post, a run of cornice on the far wall, and what is left of the porch.
        mb.box((-self.DOOR_W / 2 - 0.12, D / 2, P + 0.85), (0.14, 0.16, 1.7), "timber", "door", tilt=[(4, "Y")])
        mb.box((-L / 2 + 0.2, -D / 4, P + 2.5), (0.5, 1.1, self.CORNICE), "trim", "entablature")
        mb.column((-self.PORCH_W / 2 + 0.15, cy, P + 0.1), 0.15, 1.1, "column", "column", taper=0.9, segments=10)
        mb.box((-self.PORCH_W / 2 + 0.15, cy, P + 0.05), (0.42, 0.42, 0.1), "column", "column")
        mb.box((self.PORCH_W / 2 - 0.15, cy, P + 0.05), (0.42, 0.42, 0.1), "column", "column")
        mb.box((self.PORCH_W / 2 - 0.15, cy + 0.2, P + 0.5), (0.3, 0.3, 0.9), "column", "column", tilt=[(78, "X")])  # a shaft that fell forward
        mb.box((0.5, cy + 0.85, 0.18), (1.2, 0.34, 0.24), "trim", "entablature", tilt=[(-8, "Z")])  # the architrave on the ground
        mb.box((-0.4, cy + 0.9, 0.2), (0.44, 0.44, 0.12), "column", "column", tilt=[(12, "Z")])  # a capital
        # Burnt roof timbers fallen into the house and slabs of tile on them.
        mb.box((-0.7, -0.5, P + 0.7), (0.16, 3.0, 0.16), "timber", "entablature", tilt=[(34, "X")])
        mb.box((0.7, 0.1, P + 0.45), (0.16, 2.6, 0.16), "timber", "entablature", tilt=[(-26, "X")])
        mb.box((-0.2, -0.2, P + 0.8), (1.6, 1.3, 0.1), "roof", "roof", tilt=[(28, "X")])
        mb.box((1.3, 0.5, P + 0.24), (1.2, 0.9, 0.1), "roof", "roof", tilt=[(-14, "Y")])
        # Rubble inside and about the plinth.
        for k in range(18):
            ux, uy = hash_unit(100 + k * 3), hash_unit(101 + k * 3)
            size = 0.22 + 0.34 * hash_unit(102 + k * 3)
            outside = k % 3 == 0
            x = (ux - 0.5) * (L + 1.0 if outside else L - 0.7)
            y = (uy - 0.5) * (D + 1.0 if outside else D - 0.7)
            mb.box((x, y, P + size / 2 * 0.8), (size, size * (0.7 + hash_unit(k)), size * 0.8), "rubble", "prop", tilt=[(hash_unit(k + 40) * 40 - 20, "Z")])
        self.attach(mb, "ruin", clip)


class Tree(Structure):
    """One kit model made into an old oak: its trunk and roots, limbs added by the script, and its crown copied into
    clusters. It sways in a seamless wind loop; damaged keeps fewer, scorched clusters and glowing embers; the ruin
    is the trunk cut down to a charred stump with broken limb stubs."""

    # Cluster layout as fractions of the tree's height: x, y, z of the centre and the width.
    CLUSTERS = (
        (0.00, 0.00, 0.69, 0.47),
        (0.24, 0.02, 0.53, 0.36),
        (0.08, 0.23, 0.57, 0.37),
        (-0.20, 0.15, 0.55, 0.36),
        (-0.22, -0.12, 0.53, 0.35),
        (0.05, -0.24, 0.58, 0.37),
        (0.20, -0.20, 0.55, 0.34),
        (-0.03, -0.02, 0.84, 0.33),
        (0.17, 0.14, 0.77, 0.30),
        (-0.14, -0.02, 0.76, 0.30),
    )
    TRUNK_TOP = 0.34  # fraction of the height where the limbs leave the trunk
    TRUNK_GIRTH = 1.7  # how much thicker than the kit's the trunk is
    STUMP = 0.27  # fraction of the height of trunk left standing in the ruin

    def __init__(self, profile: dict, camera: dict, staging: Staging, scene, axes: Axes, book: MaterialBook):
        super().__init__(profile, camera, staging, scene, axes, book)
        build = profile["build"]
        self.height = build["heightM"]
        objs = import_gltf(staging.file(build["model"]["kit"], build["model"]["path"]))
        mesh = next((o for o in objs if o.type == "MESH"), None)
        if mesh is None:
            raise InputError(f"{build['model']['path']} holds no mesh")
        mesh.data.transform(mesh.matrix_world)
        count = len(mesh.data.vertices)
        co = np.empty(count * 3, dtype=np.float64)
        mesh.data.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        names = [(m.name if m else "").lower() for m in mesh.data.materials]
        polys = [(tuple(p.vertices), "trunk" if any(k in names[min(p.material_index, len(names) - 1)] for k in ("wood", "bark")) else "leaf") for p in mesh.data.polygons]
        for o in objs:
            bpy.data.objects.remove(o, do_unlink=True)
        trunk_idx = sorted({i for verts, role in polys if role == "trunk" for i in verts})
        crown_idx = sorted({i for verts, role in polys if role == "leaf" for i in verts})
        ground = co[trunk_idx, 2].min()
        trunk_top = co[trunk_idx, 2].max()
        # The trunk, standing on the ground with its roots about the origin, sized so its top is TRUNK_TOP of the tree's height.
        self.trunk_scale = self.TRUNK_TOP * self.height / (trunk_top - ground)
        foot = co[[i for i in trunk_idx if co[i, 2] < ground + 0.05 * (trunk_top - ground)]]
        self.trunk_origin = np.array([foot[:, 0].mean(), foot[:, 1].mean(), ground])
        self.template = (co, polys)
        # The crown, centred on the origin and one unit wide: each cluster is a copy of it.
        crown = co[crown_idx]
        self.crown_centre = (crown.min(axis=0) + crown.max(axis=0)) / 2
        self.crown_width = float(max(crown[:, 0].max() - crown[:, 0].min(), crown[:, 1].max() - crown[:, 1].min()))
        right = _norm((axes.right[0], axes.right[1], 0.0))
        back = _norm((axes.back[0], axes.back[1], 0.0))
        self.sway_axes = (np.array(right), np.array(back))
        self.rest = None
        self.frames = 0
        self.wind = profile.get("wind")

    def trunk_point(self, p) -> tuple:
        """A template trunk point on the tree: sized to the height, and thicker than the kit's, for an old oak."""
        x, y, z = (np.asarray(p) - self.trunk_origin) * self.trunk_scale
        return (x * self.TRUNK_GIRTH, y * self.TRUNK_GIRTH, z)

    def add_trunk(self, mb: MeshBuilder, cut: float | None) -> None:
        co, polys = self.template
        verts = {}
        faces = []
        for idx, role in polys:
            if role != "trunk":
                continue
            for i in idx:
                if i not in verts:
                    verts[i] = mb.bm.verts.new(self.trunk_point(co[i]))
            faces.append(mb.bm.faces.new([verts[i] for i in idx]))
        if cut is not None:
            geom = list(verts.values()) + list({e for f in faces for e in f.edges}) + faces
            result = bmesh.ops.bisect_plane(mb.bm, geom=geom, dist=1e-6, plane_co=(0.0, 0.0, cut), plane_no=(0.0, 0.0, 1.0), clear_outer=True)
            edges = [g for g in result["geom_cut"] if isinstance(g, bmesh.types.BMEdge)]
            filled = bmesh.ops.edgenet_fill(mb.bm, edges=edges)
            faces = [f for f in mb.bm.faces if f.is_valid]
            for k, v in enumerate(v for v in mb.bm.verts if abs(v.co.z - cut) < 1e-4):  # a broken top, the same on every render
                v.co.z -= 0.08 * self.height * hash_unit(k + 31)
            faces = list(mb.bm.faces)
        mb.add(faces, "trunk", "trunk")

    def lobes(self) -> list:
        """(centre, width) of each leaf cluster, in metres."""
        h = self.height
        return [((x * h, y * h, z * h), w * h) for x, y, z, w in self.CLUSTERS]

    def add_cluster(self, mb: MeshBuilder, centre, width: float, role: str) -> None:
        co, polys = self.template
        scale = width / self.crown_width
        verts = {}
        faces = []
        for idx, kind in polys:
            if kind != "leaf":
                continue
            for i in idx:
                if i not in verts:
                    verts[i] = mb.bm.verts.new(tuple((co[i] - self.crown_centre) * scale + np.asarray(centre)))
            faces.append(mb.bm.faces.new([verts[i] for i in idx]))
        mb.add(faces, role, "foliage")

    def build(self, state: str, clip: dict) -> None:
        h = self.height
        mb = MeshBuilder()
        if clip["ruin"]:
            self.add_trunk(mb, self.STUMP * h)
            top = self.STUMP * h
            for k, (angle, rise, length) in enumerate(((20, 0.45, 0.9), (150, 0.25, 0.7), (265, 0.55, 0.6))):
                a = math.radians(angle)
                start = (0.1 * math.cos(a), 0.1 * math.sin(a), top - 0.45 - 0.2 * k)
                end = (start[0] + length * math.cos(a), start[1] + length * math.sin(a), start[2] + rise)
                mb.limb(start, end, 0.17, 0.11, "trunk", "trunk")
            self.embers(mb, clip, [(0.12, -0.18, top - 0.1), (-0.17, 0.12, top - 0.3), (0.0, 0.2, top - 0.55)])
        else:
            self.add_trunk(mb, None)
            kept = self.kept_clusters(clip)
            limb_top = self.TRUNK_TOP * h
            for k, (centre, width) in kept:
                start = (0.04 * centre[0], 0.04 * centre[1], limb_top - 0.2)
                mid = (centre[0] * 0.45 + 0.1 * hash_unit(k), centre[1] * 0.45 + 0.1 * hash_unit(k + 9), limb_top + (centre[2] - limb_top) * 0.45)
                end = (centre[0], centre[1], centre[2] - 0.08 * h)
                mb.limb(start, mid, 0.05 * h, 0.032 * h, "trunk", "trunk")
                mb.limb(mid, end, 0.032 * h, 0.018 * h, "trunk", "trunk")
            for k, (centre, width) in kept:
                role = "leaf" if k % 3 else "leaf-deep"
                self.add_cluster(mb, centre, width * self.cluster_shrink(clip), role)
            # Embers glow first on the trunk, on the side the viewer sees, then on limbs and crown.
            spots = [(0.33, 0.33, 0.35 * h * 0.5), (0.30, 0.36, 0.35 * h * 0.8), (0.36, 0.28, 0.25 * h)]
            for k, (centre, width) in kept:
                spots.append((centre[0] * 0.5 + 0.25, centre[1] * 0.5 + 0.25, limb_top + (centre[2] - limb_top) * 0.5))
                spots.append((centre[0] + 0.32 * width, centre[1] + 0.32 * width, centre[2] - 0.12 * width))
            self.embers(mb, clip, spots)
        obj, roles = mb.finish("tree", Vector((1.0, 0.0, 0.0)), Vector((0.0, 1.0, 0.0)))
        self.book.bind(obj, [self.look(clip, role) for role in roles])
        self.objs.append(obj)
        mesh = obj.data
        self.rest = None
        if clip["loop"]:
            rest = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
            mesh.vertices.foreach_get("co", rest)
            self.rest = rest.reshape(-1, 3)
            self.frames = clip["frames"]
            self.check_loop()

    def kept_clusters(self, clip: dict) -> list:
        """The clusters this state keeps: fewer as `leaves` falls, the ones kept never the same two renders over."""
        lobes = list(enumerate(self.lobes()))
        keep = clip.get("leaves", 1.0)
        if keep >= 1.0:
            return lobes
        count = max(1, round(len(lobes) * keep))
        # The centre cluster and a high one hold the crown together; the rest go by a fixed order.
        order = sorted(lobes[1:], key=lambda item: hash_unit(item[0] * 17 + 3))
        return [lobes[0], *order[: count - 1]]

    @staticmethod
    def cluster_shrink(clip: dict) -> float:
        return 1.0 if clip.get("leaves", 1.0) >= 1.0 else 0.7

    def embers(self, mb: MeshBuilder, clip: dict, spots: list) -> None:
        """Small glowing blocks on the trunk, limbs and crown: the first `embers` of `spots`."""
        for rank, spot in enumerate(spots[: clip.get("embers", 0)]):
            size = 0.2 + 0.1 * hash_unit(rank + 60)
            mb.box(spot, (size, size, size), "ember", "prop", tilt=[(hash_unit(rank + 3) * 80, "Z")])

    def displaced(self, frame: float) -> np.ndarray:
        """The rest vertices swayed to `frame` of the loop: a travelling wave up the tree, planted at the foot, along the screen's horizontal."""
        wind = self.wind
        z = self.rest[:, 2]
        rel = z / self.height
        weight = np.clip(rel, 0.0, 1.0) ** 2.0
        phase = wind["cycles"] * 2.0 * math.pi * frame / self.frames - wind["lag"] * rel
        along = wind["amplitudeM"] * weight * np.sin(phase)
        across = wind["amplitudeM"] * weight * wind["swirl"] * np.sin(phase + math.pi / 2.0)
        sink = np.where(z > 1e-6, -(along * along + across * across) / (2.0 * np.maximum(z, 1e-6)), 0.0)
        right, back = self.sway_axes
        out = self.rest.copy()
        out[:, :2] += np.outer(along, right[:2]) + np.outer(across, back[:2])
        out[:, 2] += sink
        return out

    def check_loop(self) -> None:
        """The frame after the last is the first again: frame N must land exactly on frame 0."""
        gap = float(np.abs(self.displaced(float(self.frames)) - self.displaced(0.0)).max())
        if gap > 1e-9:
            raise InputError(f"the wind loop does not close: frame {self.frames} differs from frame 0 by {gap}")

    def pose(self, state: str, facing: str, frame: float) -> None:
        if self.rest is not None:
            mesh = self.objs[0].data
            mesh.vertices.foreach_set("co", self.displaced(frame).reshape(-1))
            mesh.update()
        bpy.context.view_layer.update()


def make_structure(profile: dict, camera: dict, staging: Staging, scene, axes: Axes, book: MaterialBook) -> Structure:
    kind = profile["build"]["kind"]
    if kind == "house":
        return House(profile, camera, staging, scene, axes, book)
    if kind == "tree":
        return Tree(profile, camera, staging, scene, axes, book)
    raise InputError(f"unknown structure build {kind!r}")


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


def render_slot(slot: dict, figure, book: MaterialBook, recipe: dict, id_mat, depth_mat) -> dict:
    scene, camera = figure.scene, recipe["camera"]
    state, facing, count = slot["state"], slot["facing"], slot["frames"]
    sources = figure.sources(state, count)
    size = (camera["cell"]["width"] * camera["supersample"], camera["cell"]["height"] * camera["supersample"])
    out_dir = Path(slot["outDir"])
    partial = out_dir.with_name(out_dir.name + ".partial")
    if out_dir.exists():
        raise InputError(f"slot directory {out_dir} already exists")
    if partial.exists():
        shutil.rmtree(partial)
    partial.mkdir(parents=True)
    figure.prepare(state)
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
        if profile.get("kind") == "structure":
            figure = make_structure(profile, camera, staging, scene, axes, book)
            facts = {}
        else:
            figure = Figure(profile, camera, staging, scene, axes, book)
            facts = {"scale": round(figure.scale, 5), "fit_extent_px_at_scale_1": round(figure.fit_extent_px, 3)}
        id_mat = id_override_material()
        depth_mat = depth_material(*camera["depthRange"])
        built = time.perf_counter()
        print(f"RENDER scene {json.dumps({'build_ms': round((built - started) * 1000.0, 1), **facts})}", flush=True)
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

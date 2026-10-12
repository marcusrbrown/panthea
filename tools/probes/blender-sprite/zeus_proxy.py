"""Zeus-shaped proxy on the UAL rig, built entirely by script from a factory start (bpy). No .blend is saved.

Body broadening, a bone-weighted low-poly robe, beard, hair, a bolt in the right hand, a stone seat, toon materials
per shading variant, part-ID vertex attributes for the overlap-outline pass, and rig pose offsets.
"""

from __future__ import annotations

import math
from pathlib import Path

import bmesh
import bpy
import mathutils
from mathutils import Quaternion, Vector, kdtree

import proxy_plan as pp
import sprite_plan as sp

ARM_NAMES = ("upperarm_", "lowerarm_", "hand_", "clavicle_")
ROLE_RAMP = {"skin": "pale-gold", "robe": "cloud", "trim": "pale-gold", "hair": "cloud", "bolt": "pale-gold", "seat": "marble"}

# Tunables recorded in meta.json.
WIDEN_AMP = 0.05
HAND_SCALE = 1.45
HEAD_SCALE = 1.12
ARM_THICKEN = 1.3
LEG_THICKEN = 1.15
BOLT_SEGMENTS, BOLT_STEP, BOLT_AMP, BOLT_THICK = 4, 0.10, 0.14, 0.085


# --- helpers --------------------------------------------------------------------------------------------


def dominant_groups(obj) -> list[str]:
    names = {g.index: g.name for g in obj.vertex_groups}
    out = []
    for v in obj.data.vertices:
        out.append(names[max(v.groups, key=lambda g: g.weight).group] if v.groups else "root")
    return out


def bone_axis(arm, name: str):
    bone = arm.data.bones[name]
    return tuple(bone.head_local), tuple(bone.tail_local)


def set_attribute_ids(obj, face_parts: list[str]) -> None:
    """Flat per-face part ID in a corner-domain float colour attribute (linear values that render back to the ID byte)."""
    mesh = obj.data
    attr = mesh.color_attributes.new("partid", "FLOAT_COLOR", "CORNER")
    values = []
    for poly, part in zip(mesh.polygons, face_parts, strict=True):
        lin = sp.srgb_to_linear(pp.id_byte(part))
        values.extend([(lin, lin, lin, 1.0)] * poly.loop_total)
    flat = [c for rgba in values for c in rgba]
    attr.data.foreach_set("color", flat)


# --- body ----------------------------------------------------------------------------------------------


def broaden(arm, body) -> dict:
    """Mass for Zeus: broad shoulders, thicker arms and legs, bigger hands and head. Standing height is held: the head
    grows about its top and outward only."""
    groups = dominant_groups(body)
    verts = body.data.vertices
    head_idx = [i for i, g in enumerate(groups) if g == "Head"]
    head_top = max(verts[i].co.z for i in head_idx)
    head_xy = (arm.data.bones["Head"].head_local.x, sum(verts[i].co.y for i in head_idx) / len(head_idx))
    axes = {n: bone_axis(arm, n) for n in ("upperarm_l", "lowerarm_l", "upperarm_r", "lowerarm_r", "thigh_l", "calf_l", "thigh_r", "calf_r")}
    hand_heads = {n: tuple(arm.data.bones[n].head_local) for n in ("hand_l", "hand_r")}
    before_top = head_top
    for i, v in enumerate(verts):
        g = groups[i]
        co = (v.co.x, v.co.y, v.co.z)
        co = (co[0] + pp.widen_dx(co[0], co[2], WIDEN_AMP), co[1], co[2])
        if g.startswith(("upperarm_", "lowerarm_")):
            a, b = axes[g]
            co = pp.scale_about_axis(co, (a[0] + pp.widen_dx(a[0], a[2], WIDEN_AMP), *a[1:]), (b[0] + pp.widen_dx(b[0], b[2], WIDEN_AMP), *b[1:]), ARM_THICKEN)
        elif g.startswith(("thigh_", "calf_")):
            a, b = axes[g]
            co = pp.scale_about_axis(co, a, b, LEG_THICKEN)
        elif g.startswith("hand_") or g.startswith(pp.FINGERS):
            h = hand_heads["hand_" + g[-1]]
            h = (h[0] + pp.widen_dx(h[0], h[2], WIDEN_AMP), h[1], h[2])
            co = tuple(hc + (c - hc) * HAND_SCALE for c, hc in zip(co, h, strict=True))
        elif g == "Head":
            co = (head_xy[0] + (co[0] - head_xy[0]) * HEAD_SCALE, head_xy[1] + (co[1] - head_xy[1]) * HEAD_SCALE, head_top - (head_top - co[2]) * HEAD_SCALE)
        v.co = co
    body.data.update()
    return {"widen_amp": WIDEN_AMP, "hand_scale": HAND_SCALE, "head_scale": HEAD_SCALE, "arm_thicken": ARM_THICKEN, "leg_thicken": LEG_THICKEN, "head_top_before": before_top}


# --- lofted meshes -----------------------------------------------------------------------------------------


def _loft(name: str, rings, count: int, folds: int, arcs=None, phase: float = 0.0):
    bm = bmesh.new()
    arcs = arcs or [(0.0, 2 * math.pi)] * len(rings)
    rows = []
    for ring, arc in zip(rings, arcs, strict=True):
        rows.append([bm.verts.new(p) for p in pp.ring_points(ring, count, folds, phase, arc)])
    mat_of_face = []
    for i in range(len(rows) - 1):
        full = abs((arcs[i][1] - arcs[i][0]) - 2 * math.pi) < 1e-9 and abs((arcs[i + 1][1] - arcs[i + 1][0]) - 2 * math.pi) < 1e-9
        span = count if full else count - 1
        for j in range(span):
            j2 = (j + 1) % count
            # Outward winding for rings listed top to bottom, angle counter-clockwise from above.
            face = bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][j2], rows[i][j2]))
            face.smooth = True
            m = rings[i].material if rings[i].material == rings[i + 1].material else 0
            face.material_index = m
            mat_of_face.append(m)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _skin(obj, arm, weights: dict[int, dict[str, float]]) -> None:
    names = {n for w in weights.values() for n in w}
    groups = {n: obj.vertex_groups.new(name=n) for n in sorted(names)}
    for vi, w in weights.items():
        total = sum(w.values())
        for n, x in w.items():
            groups[n].add([vi], x / total, "REPLACE")
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    obj.parent = arm


def build_robe(arm, body) -> object:
    robe = _loft("robe", pp.robe_rings(), 16, 5)
    names = dominant_groups(body)
    tree = kdtree.KDTree(len(body.data.vertices))
    count = 0
    for i, v in enumerate(body.data.vertices):
        if names[i].startswith(ARM_NAMES) or names[i] == "Head" or names[i].startswith(pp.FINGERS):
            continue
        tree.insert(v.co, i)
        count += 1
    tree.balance()
    body_w = [{body.vertex_groups[g.group].name: g.weight for g in v.groups} for v in body.data.vertices]
    weights = {}
    for vi, v in enumerate(robe.data.vertices):
        near = tree.find_n(v.co, 4)
        mix: dict[str, float] = {}
        for _, idx, dist in near:
            for n, x in body_w[idx].items():
                mix[n] = mix.get(n, 0.0) + x / (dist + 0.02)
        t = min(1.0, max(0.0, (0.95 - v.co.z) / 0.5)) * 0.45  # below the hips the robe follows the pelvis more than the legs
        total = sum(mix.values())
        mix = {n: x / total * (1 - t) for n, x in mix.items()}
        mix["pelvis"] = mix.get("pelvis", 0.0) + t
        weights[vi] = mix
    _skin(robe, arm, weights)
    parts = []
    z_of_poly = [sum(robe.data.vertices[i].co.z for i in p.vertices) / len(p.vertices) for p in robe.data.polygons]
    for p, z in zip(robe.data.polygons, z_of_poly, strict=True):
        parts.append("belt" if p.material_index == 1 and 1.0 < z < 1.15 else "robe_skirt" if z < 1.0 else "robe_upper")
    set_attribute_ids(robe, parts)
    robe.data.materials.append(None)
    robe.data.materials.append(None)
    return robe


def build_beard(arm) -> object:
    beard = _loft("beard", pp.beard_rings(), 10, 3)
    _skin(beard, arm, {i: {"Head": 1.0} for i in range(len(beard.data.vertices))})
    set_attribute_ids(beard, ["beard"] * len(beard.data.polygons))
    beard.data.materials.append(None)
    return beard


def build_hair(arm, body) -> object:
    groups = dominant_groups(body)
    pts = [v.co for i, v in enumerate(body.data.vertices) if groups[i] == "Head"]
    top = max(p.z for p in pts)
    cx = sum(p.x for p in pts) / len(pts)
    cy = (max(p.y for p in pts) + min(p.y for p in pts)) / 2
    hw = (max(p.x for p in pts) - min(p.x for p in pts)) / 2
    hd = (max(p.y for p in pts) - min(p.y for p in pts)) / 2
    rings, arcs = [], []
    # (drop below the head top, scale of the head half-extents, gap angle left open at the front for the face)
    spec = [(0.016, 0.28, 0.01), (0.040, 0.78, 0.01), (0.075, 1.0, 1.9), (0.125, 1.04, 2.5), (0.175, 1.04, 2.9), (0.235, 0.98, 3.2)]
    for drop, scale, gap in spec:
        rings.append(pp.Ring(top - drop + 0.012, hw * scale + 0.012, hd * scale + 0.012, cy))
        a0 = -math.pi / 2 + gap / 2
        arcs.append((a0, a0 + 2 * math.pi - gap))
    hair = _loft("hair", rings, 14, 0, arcs)
    for v in hair.data.vertices:
        v.co.x += cx
    _skin(hair, arm, {i: {"Head": 1.0} for i in range(len(hair.data.vertices))})
    set_attribute_ids(hair, ["hair"] * len(hair.data.polygons))
    hair.data.materials.append(None)
    return hair


def build_bolt(arm) -> object:
    """Thick helical zigzag along the right hand's axis (-X in rest), so the carry pose points it up."""
    hand = arm.data.bones["hand_r"]
    start = hand.head_local + Vector((-0.07, 0.0, 0.0))
    path = [Vector((start.x - along, start.y + a, start.z + b)) for along, a, b in pp.zigzag_points(BOLT_SEGMENTS, BOLT_STEP, BOLT_AMP)]
    bm = bmesh.new()
    half = BOLT_THICK / 2
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        axis = (b - a).normalized()
        side = axis.cross(Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((0, 1, 0))).normalized()
        up = axis.cross(side).normalized()
        k_end = 0.35 if i == len(path) - 2 else 1.0
        ends = []
        for centre, k in ((a - axis * half * 0.6, 1.0), (b + axis * half * 0.6, k_end)):
            ends.append([bm.verts.new(centre + side * half * k * sx + up * half * k * sy) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))])
        for j in range(4):
            bm.faces.new((ends[0][j], ends[0][(j + 1) % 4], ends[1][(j + 1) % 4], ends[1][j]))
        bm.faces.new(ends[0][::-1])
        bm.faces.new(ends[1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new("bolt")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("bolt", mesh)
    bpy.context.scene.collection.objects.link(obj)
    for poly in mesh.polygons:
        poly.use_smooth = False
    _skin(obj, arm, {i: {"hand_r": 1.0} for i in range(len(mesh.vertices))})
    set_attribute_ids(obj, ["bolt"] * len(mesh.polygons))
    obj.data.materials.append(None)
    return obj


def build_seat(arm, pelvis_xy_z, size=None, dy: float = 0.0) -> object:
    width, depth, height = size or pp.seat_size(pelvis_xy_z[2])
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = (v.co.x * width, v.co.y * depth, v.co.z * height)
    mesh = bpy.data.meshes.new("seat")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("seat", mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = (pelvis_xy_z[0], pelvis_xy_z[1] + dy, height / 2)
    obj.parent = arm
    set_attribute_ids(obj, ["seat"] * len(mesh.polygons))
    obj.data.materials.append(None)
    return obj


# --- materials -----------------------------------------------------------------------------------------------


def toon(name: str, shades_hex: list[str], variant: pp.ShadingVariant, role: str):
    stops = pp.band_positions(variant, role)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    diffuse = tree.nodes.new("ShaderNodeBsdfDiffuse")
    diffuse.inputs["Color"].default_value = (1, 1, 1, 1)
    to_rgb = tree.nodes.new("ShaderNodeShaderToRGB")
    to_bw = tree.nodes.new("ShaderNodeRGBToBW")
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    elements = ramp.color_ramp.elements
    while len(elements) < len(stops):
        elements.new(0.5)
    for element, (position, shade) in zip(elements, stops, strict=True):
        element.position = position
        r, g, b = sp.hex_to_linear(shades_hex[shade])
        element.color = (r, g, b, 1.0)
    emission = tree.nodes.new("ShaderNodeEmission")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    links = tree.links
    links.new(diffuse.outputs["BSDF"], to_rgb.inputs["Shader"])
    links.new(to_rgb.outputs["Color"], to_bw.inputs["Color"])
    links.new(to_bw.outputs["Val"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], out.inputs["Surface"])
    return mat


def role_slots(objs: dict) -> list[tuple[object, int, str]]:
    """(object, slot, role) for every material slot of the proxy."""
    return [
        (objs["body"], 0, "skin"),
        (objs["body"], 1, "skin"),
        (objs["robe"], 0, "robe"),
        (objs["robe"], 1, "trim"),
        (objs["beard"], 0, "hair"),
        (objs["hair"], 0, "hair"),
        (objs["bolt"], 0, "bolt"),
        (objs["seat"], 0, "seat"),
    ]


def apply_variant_materials(objs: dict, palette_json: dict, family: str, variant: pp.ShadingVariant) -> list:
    """Build (object, slot, material) for a variant without assigning, so variants can be swapped cheaply."""
    ramps = {r["id"]: r["shades"] for r in next(f for f in palette_json["families"] if f["id"] == family)["ramps"]}
    made = []
    for obj, slot, role in role_slots(objs):
        made.append((obj, slot, toon(f"toon_{variant.id}_{role}_{slot}", ramps[ROLE_RAMP[role]], variant, role)))
    return made


def use_variant_materials(made: list) -> None:
    for obj, slot, mat in made:
        if slot < len(obj.data.materials):
            obj.data.materials[slot] = mat
        else:
            obj.data.materials.append(mat)


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


def depth_override_material():
    mat = bpy.data.materials.new("depth_override")
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    cam = tree.nodes.new("ShaderNodeCameraData")
    ramp = tree.nodes.new("ShaderNodeMapRange")
    ramp.inputs["From Min"].default_value = pp.DEPTH_NEAR
    ramp.inputs["From Max"].default_value = pp.DEPTH_FAR
    ramp.inputs["To Min"].default_value = 0.0
    ramp.inputs["To Max"].default_value = 1.0
    ramp.clamp = True
    emission = tree.nodes.new("ShaderNodeEmission")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(cam.outputs["View Z Depth"], ramp.inputs["Value"])
    tree.links.new(ramp.outputs["Result"], emission.inputs["Color"])
    tree.links.new(emission.outputs["Emission"], out.inputs["Surface"])
    return mat


# --- pose offsets ---------------------------------------------------------------------------------------------

AXES = {"x": Vector((1, 0, 0)), "y": Vector((0, 1, 0)), "z": Vector((0, 0, 1))}


def apply_offsets(arm, offsets: dict[str, list[tuple[str, float]]]) -> None:
    """Post-multiply each bone's animated local rotation by rotations about its own local axes (degrees)."""
    for name, steps in offsets.items():
        pb = arm.pose.bones[name]
        pb.rotation_mode = "QUATERNION"
        q = pb.rotation_quaternion.copy()
        for axis, degrees in steps:
            q = q @ Quaternion(AXES[axis], math.radians(degrees))
        pb.rotation_quaternion = q
    bpy.context.view_layer.update()


def aim_bones(arm, aims: dict[str, list[float]]) -> None:
    """Swing each bone (parents first, in dict order) so its head-to-tail axis points along a direction given in rig
    space (X toward the character's left, -Y forward, Z up). Minimal rotation, so roll is whatever the pose had."""
    for name, direction in aims.items():
        pb = arm.pose.bones[name]
        current = (pb.tail - pb.head).normalized()
        rot = current.rotation_difference(Vector(direction).normalized()).to_matrix().to_4x4()
        head = pb.head.copy()
        pb.matrix = mathutils.Matrix.Translation(head) @ rot @ mathutils.Matrix.Translation(-head) @ pb.matrix
        bpy.context.view_layer.update()


def mirror_pose(arm) -> None:
    """Flip the current pose left for right (Blender's paste-flipped). The library's cast clip uses the left hand; Zeus's
    bolt is in the right, so the whole clip is mirrored, which also mirrors weight shift and torso twist."""
    view = bpy.context.view_layer
    view.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.copy()
    bpy.ops.pose.paste(flipped=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    view.update()


def build_all(arm, body, sit_pelvis, seat_size=None, seat_dy: float = 0.0) -> tuple[dict, dict]:
    info = broaden(arm, body)
    objs = {"body": body, "robe": build_robe(arm, body), "beard": build_beard(arm), "hair": build_hair(arm, body), "bolt": build_bolt(arm), "seat": build_seat(arm, sit_pelvis, seat_size, seat_dy)}
    groups = dominant_groups(body)
    parts = []
    for poly in body.data.polygons:
        votes = [pp.part_for_bone(groups[i]) for i in poly.vertices]
        parts.append(max(set(votes), key=votes.count))
    set_attribute_ids(body, parts)
    info["objects"] = {k: len(v.data.vertices) for k, v in objs.items()}
    return objs, info


def load_palette_json(path: str) -> dict:
    import json

    return json.loads(Path(path).read_text())


# --- round 3: surface-anchored shading -----------------------------------------------------------------------


def baked_material(name: str, shades_hex: list[str]):
    """Unlit: baked per-corner value -> constant ramp -> Emission. No diffuse BSDF, no light dependence."""
    import bake_plan as bp

    stops = bp.ramp_stops()
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    attr = tree.nodes.new("ShaderNodeAttribute")
    attr.attribute_type = "GEOMETRY"
    attr.attribute_name = "bake"
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    elements = ramp.color_ramp.elements
    while len(elements) < len(stops):
        elements.new(0.5)
    for element, (position, shade) in zip(elements, stops, strict=True):
        element.position = position
        r, g, b = sp.hex_to_linear(shades_hex[shade])
        element.color = (r, g, b, 1.0)
    emission = tree.nodes.new("ShaderNodeEmission")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(attr.outputs["Fac"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], emission.inputs["Color"])
    tree.links.new(emission.outputs["Emission"], out.inputs["Surface"])
    return mat


def baked_variant_materials(objs: dict, palette_json: dict, family: str) -> list:
    import bake_plan as bp

    ramps = {r["id"]: r["shades"] for r in next(f for f in palette_json["families"] if f["id"] == family)["ramps"]}
    return [(obj, slot, baked_material(f"baked_{role}_{slot}", ramps[bp.ROLE_RAMP_S3[role]])) for obj, slot, role in role_slots(objs)]


def rest_corner_normals(obj):
    """Rest-pose, object-space corner normals of a mesh as an (n, 3) array."""
    import numpy as np

    mesh = obj.data
    n = np.empty(len(mesh.loops) * 3, dtype=np.float32)
    mesh.corner_normals.foreach_get("vector", n)
    return n.reshape(-1, 3)


def bake_values(normals, light, ambient: float):
    """Vectorised `bake_plan.lambert_value` over an (n, 3) normal array."""
    import numpy as np

    length = np.linalg.norm(normals, axis=1)
    length[length == 0] = 1.0
    cosine = (normals @ np.array(light, dtype=np.float32)) / (length * float(np.linalg.norm(light)))
    return (ambient + (1.0 - ambient) * np.maximum(cosine, 0.0)).astype(np.float32)


def set_bake(obj, values) -> None:
    mesh = obj.data
    attr = mesh.attributes.get("bake") or mesh.attributes.new("bake", "FLOAT", "CORNER")
    attr.data.foreach_set("value", values)

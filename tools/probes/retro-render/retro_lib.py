# SPDX-License-Identifier: GPL-3.0-or-later
"""Blender-side helpers for the retro-render probe (bpy). Reuses blender-sprite's `render.py` for the scene, camera maths and
pose helpers, and its `zeus_proxy.py` for lofting, skinning and the bolt locator. Nothing is saved as a .blend.
"""

from __future__ import annotations

import json
import math
import re
import sys
import time
from pathlib import Path

import bmesh
import bpy
import mathutils
import numpy as np
from bpy_extras.object_utils import world_to_camera_view

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO / "tools/probes/blender-sprite"))
import palette_plan as pal  # noqa: E402
import render as base  # noqa: E402  (blender-sprite)
import retro_plan as rp  # noqa: E402
import sprite_plan as sp  # noqa: E402  (blender-sprite)
import zeus_proxy as zp  # noqa: E402  (blender-sprite)

MAIN_MODELS = "<main-checkout>/tools/probes"  # documentation placeholder; the real root is passed as --models


# --- scene ------------------------------------------------------------------------------------------------------


def fresh_scene() -> tuple:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 24
    configured = base.configure_scene(scene, rp.SUN_STRENGTH, rp.AMBIENT_STRENGTH)
    axes = sp.camera_axes(rp.CAMERA_ROT_DEG)
    base.aim_key_light(configured["key"], axes)
    return scene, configured, axes


def make_camera(scene, axes, item: rp.Item):
    cam_data = bpy.data.cameras.new("iso")
    cam_data.type = "ORTHO"
    cam_data.sensor_fit = "VERTICAL"
    cam_data.ortho_scale = sp.ortho_scale(item.cell[1], rp.PPU)
    cam_data.clip_start, cam_data.clip_end = 0.1, 100.0
    cam = bpy.data.objects.new("iso", cam_data)
    scene.collection.objects.link(cam)
    cam.rotation_euler = tuple(math.radians(d) for d in rp.CAMERA_ROT_DEG)
    cam.location = sp.camera_location((0.0, 0.0, 0.0), axes, rp.PPU, item.origin_px, item.cell)
    scene.camera = cam
    return cam


def project_px(point, axes, item: rp.Item) -> tuple[float, float]:
    return sp.project((float(point[0]), float(point[1]), float(point[2])), (0.0, 0.0, 0.0), axes, rp.PPU, item.origin_px)


def camera_depth(point, cam) -> float:
    view = np.array(sp.camera_axes(rp.CAMERA_ROT_DEG).view_direction)
    return float((np.array(point, dtype=np.float64) - np.array(cam.location)) @ view)


# --- materials --------------------------------------------------------------------------------------------------


def _bayer_image():
    img = bpy.data.images.get("bayer4") or bpy.data.images.new("bayer4", 4, 4, alpha=False, float_buffer=True, is_data=True)
    pixels = []
    for y in range(4):
        for x in range(4):
            v = rp.bayer_threshold(x, y)
            pixels += [v, v, v, 1.0]
    img.pixels = pixels
    img.colorspace_settings.name = "Non-Color"
    return img


def toon_material(name: str, shades_hex: list[str], bias: float, dither: bool, size: tuple[int, int]):
    """Diffuse -> Shader to RGB -> value (+ bias, + ordered dither) -> constant 5-stop ramp -> Emission."""
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
    while len(elements) < rp.BANDS:
        elements.new(0.5)
    for element, start, shade in zip(elements, rp.BAND_STARTS, rp.BAND_SHADES, strict=True):
        element.position = start
        r, g, b = sp.hex_to_linear(shades_hex[shade])
        element.color = (r, g, b, 1.0)
    emission = new("ShaderNodeEmission")
    out = new("ShaderNodeOutputMaterial")
    link = tree.links.new
    link(diffuse.outputs["BSDF"], to_rgb.inputs["Shader"])
    link(to_rgb.outputs["Color"], to_bw.inputs["Color"])
    link(to_bw.outputs["Val"], add_bias.inputs[0])
    value = add_bias.outputs["Value"]
    if dither:
        coord = new("ShaderNodeTexCoord")
        scale = new("ShaderNodeVectorMath")
        scale.operation = "MULTIPLY"
        scale.inputs[1].default_value = (size[0] / 16.0, size[1] / 16.0, 1.0)  # one Bayer texel per 1x pixel (4 render pixels)
        tex = new("ShaderNodeTexImage")
        tex.image = _bayer_image()
        tex.interpolation = "Closest"
        tex.extension = "REPEAT"
        centre = new("ShaderNodeMath")
        centre.operation = "SUBTRACT"
        centre.inputs[1].default_value = 0.5
        spread = new("ShaderNodeMath")
        spread.operation = "MULTIPLY"
        spread.inputs[1].default_value = rp.DITHER_WIDTH
        add_dither = new("ShaderNodeMath")
        add_dither.operation = "ADD"
        dither_bw = new("ShaderNodeRGBToBW")
        link(coord.outputs["Window"], scale.inputs[0])
        link(scale.outputs["Vector"], tex.inputs["Vector"])
        link(tex.outputs["Color"], dither_bw.inputs["Color"])
        link(dither_bw.outputs["Val"], centre.inputs[0])
        link(centre.outputs["Value"], spread.inputs[0])
        link(value, add_dither.inputs[0])
        link(spread.outputs["Value"], add_dither.inputs[1])
        value = add_dither.outputs["Value"]
    link(value, ramp.inputs["Fac"])
    link(ramp.outputs["Color"], emission.inputs["Color"])
    link(emission.outputs["Emission"], out.inputs["Surface"])
    return mat


class MaterialBook:
    """Role -> (ramp, bias) per item, and one toon material per (role, variant). Slots are (object, index, role)."""

    def __init__(self, palette_doc: dict, roles: dict[str, tuple[str, float]], cell: tuple[int, int]):
        self.doc = palette_doc
        self.roles = dict(roles)
        self.size = rp.render_size(cell)
        self.slots: list[tuple[object, int, str]] = []
        self.cache: dict[tuple[str, str], object] = {}

    def add_role(self, role: str, ramp: str, bias: float = 0.0) -> None:
        self.roles[role] = (ramp, bias)

    def material(self, role: str, variant: rp.Variant):
        key = (role, variant.id)
        if key not in self.cache:
            ramp, bias = self.roles[role]
            shades = next(r for f in self.doc["families"] for r in f["ramps"] if r["id"] == ramp)["shades"]
            self.cache[key] = toon_material(f"toon_{role}_{variant.id}", shades, bias, variant.dither, self.size)
        return self.cache[key]

    def bind(self, obj, role_per_slot: list[str]) -> None:
        """Assign a role to each material slot. Slots are never cleared: removing a slot resets face material indices."""
        mats = obj.data.materials
        while len(mats) < len(role_per_slot):
            mats.append(None)
        for i, role in enumerate(role_per_slot):
            self.slots.append((obj, i, role))

    def use(self, variant: rp.Variant) -> None:
        for obj, i, role in self.slots:
            obj.data.materials[i] = self.material(role, variant)


def color_to_ramp(doc: dict, rgb255: tuple[int, int, int]) -> str:
    return pal.nearest_ramp(doc, rgb255)


# --- part IDs and passes ------------------------------------------------------------------------------------------


def set_ids(obj, parts: list[str] | str) -> None:
    """Flat per-face part ID in a corner colour attribute that renders back to the ID byte through the Standard view."""
    mesh = obj.data
    if isinstance(parts, str):
        parts = [parts] * len(mesh.polygons)
    attr = mesh.color_attributes.get("partid") or mesh.color_attributes.new("partid", "FLOAT_COLOR", "CORNER")
    values = []
    for poly, part in zip(mesh.polygons, parts, strict=True):
        lin = sp.srgb_to_linear(rp.id_byte(part))
        values.extend([(lin, lin, lin, 1.0)] * poly.loop_total)
    attr.data.foreach_set("color", [c for rgba in values for c in rgba])


def body_face_parts(body) -> list[str]:
    """Part per face of a skinned body: the part most of its vertices' dominant bones belong to."""
    dominant = zp.dominant_groups(body)
    out = []
    for poly in body.data.polygons:
        votes: dict[str, int] = {}
        for vi in poly.vertices:
            p = rp.part_for_bone(dominant[vi])
            votes[p] = votes.get(p, 0) + 1
        out.append(max(votes, key=lambda k: (votes[k], k)))
    return out


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


def render_to(scene, path: Path, size: tuple[int, int], override=None) -> float:
    layer = bpy.context.view_layer
    layer.material_override = override
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.filepath = str(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    layer.material_override = None
    return (time.perf_counter() - started) * 1000.0


# --- meshes ---------------------------------------------------------------------------------------------------------


def mesh_points(obj) -> np.ndarray:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    return base.mesh_world_points(obj.evaluated_get(depsgraph))


def all_points(objs: list) -> np.ndarray:
    return np.vstack([mesh_points(o) for o in objs if not o.hide_render])


def screen_extent_px(objs: list, axes, item: rp.Item) -> dict:
    pts = all_points(objs)
    ys = item.origin_px[1] - pts @ np.array(axes.up) * rp.PPU
    xs = item.origin_px[0] + pts @ np.array(axes.right) * rp.PPU
    return {"top": round(float(ys.min()), 3), "bottom": round(float(ys.max()), 3), "left": round(float(xs.min()), 3), "right": round(float(xs.max()), 3)}


def box(bm, centre, size, part_material: int = 0):
    """Axis-aligned box (centre, size) added to a bmesh; returns its faces."""
    cx, cy, cz = centre
    sx, sy, sz = (s / 2 for s in size)
    verts = [bm.verts.new((cx + dx * sx, cy + dy * sy, cz + dz * sz)) for dx in (-1, 1) for dy in (-1, 1) for dz in (-1, 1)]
    faces = []
    for idx in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        f = bm.faces.new([verts[i] for i in idx])
        f.material_index = part_material
        faces.append(f)
    return faces


def prism_pediment(bm, y0: float, y1: float, half_w: float, z0: float, rise: float):
    """Triangular prism: base at z0 spanning x in [-half_w, half_w], apex at z0+rise, extruded along y from y0 to y1."""
    a = [bm.verts.new((-half_w, y0, z0)), bm.verts.new((half_w, y0, z0)), bm.verts.new((0.0, y0, z0 + rise))]
    b = [bm.verts.new((-half_w, y1, z0)), bm.verts.new((half_w, y1, z0)), bm.verts.new((0.0, y1, z0 + rise))]
    faces = [bm.faces.new(a[::-1]), bm.faces.new(b)]
    for i in range(3):
        faces.append(bm.faces.new((a[i], a[(i + 1) % 3], b[(i + 1) % 3], b[i])))
    return faces


def cylinder(bm, centre, radius, height, segments=12, taper=1.0):
    """Vertical cylinder (optionally tapering to `taper` x radius at the top); returns faces (side first)."""
    cx, cy, cz = centre
    bottom = [bm.verts.new((cx + radius * math.cos(2 * math.pi * i / segments), cy + radius * math.sin(2 * math.pi * i / segments), cz)) for i in range(segments)]
    top = [bm.verts.new((cx + radius * taper * math.cos(2 * math.pi * i / segments), cy + radius * taper * math.sin(2 * math.pi * i / segments), cz + height)) for i in range(segments)]
    faces = [bm.faces.new((bottom[i], bottom[(i + 1) % segments], top[(i + 1) % segments], top[i])) for i in range(segments)]
    faces.append(bm.faces.new(top[::-1]))
    faces.append(bm.faces.new(bottom))
    return faces


def new_object(name: str, bm, smooth: bool = False):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = smooth
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def import_gltf(path: str) -> list:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def import_obj(path: str) -> list:
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def material_rgb(mat) -> tuple[int, int, int] | None:
    """Base colour of an imported material (sRGB 0-255), if it has a Principled node with a plain colour."""
    if mat is None or not mat.use_nodes:
        return None
    nodes = [n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"]
    if not nodes:
        return None
    c = nodes[0].inputs["Base Color"].default_value
    return tuple(round(sp.linear_to_srgb(v) * 255) for v in c[:3])  # type: ignore[return-value]


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1) + "\n")


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")

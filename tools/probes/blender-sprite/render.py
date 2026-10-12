"""Headless Blender renderer: UAL mannequin -> isometric sprite cells, 4 facings, direct 64x80 and 4x.

Run (no UI state; every setting is in this file or on the command line):

    blender --background --factory-startup --python-exit-code 1 --python render.py -- \\
        --model <UAL1_Standard.glb> --palette <palette.json> --out <dir>

Writes `<out>/<variant>/<clip>_<direction>_<NN>.<variant>.png` plus `<out>/meta.json` (settings, calibration,
source frame and projected pivot/foot positions for every output, timings).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import bpy
import mathutils
import numpy as np
from bpy_extras.object_utils import world_to_camera_view

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sprite_plan as sp  # noqa: E402

# Toon bands: Shader-to-RGB lighting value thresholds between ramp shades 1|2 and 2|3. Shade 0 (darkest) is left
# for the outline the post step draws, as the art guide's outline rule wants.
DEFAULT_BANDS = (0.50, 0.78)
DEFAULT_SUN = 3.0
DEFAULT_AMBIENT = 0.22
MATERIAL_RAMPS = {"M_Main": "marble", "M_Joints": "lapis"}
FOOT_BONES = ("foot_l", "foot_r", "ball_l", "ball_r")
SUBPIXEL_OFFSETS = ((0.0, 0.0), (0.25, 0.0), (0.5, 0.0), (0.75, 0.0), (0.0, 0.25), (0.0, 0.5))


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="render.py")
    ap.add_argument("--model", required=True)
    ap.add_argument("--palette", required=True)
    ap.add_argument("--family", default="olympus")
    ap.add_argument("--out", required=True)
    ap.add_argument("--clips", default=",".join(c.id for c in sp.CLIPS))
    ap.add_argument("--directions", default=",".join(sp.DIRECTIONS))
    ap.add_argument("--variants", default="direct,x4")
    ap.add_argument("--sun", type=float, default=DEFAULT_SUN)
    ap.add_argument("--ambient", type=float, default=DEFAULT_AMBIENT)
    ap.add_argument("--bands", default=",".join(str(b) for b in DEFAULT_BANDS))
    ap.add_argument("--repeat-check", action="store_true", help="render one frame twice and compare hashes")
    ap.add_argument("--subpixel", action="store_true", help="render idle/south/0 at fractional pixel offsets (palette-stability test)")
    return ap.parse_args(argv)


# --- scene -------------------------------------------------------------------------------------------------


def import_model(path: str):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    armature = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    body = next(o for o in meshes if o.name == "Mannequin")
    for stray in [o for o in meshes if o is not body]:  # the library ships a helper icosphere
        bpy.data.objects.remove(stray, do_unlink=True)
    ad = armature.animation_data
    if ad is not None:
        for track in list(ad.nla_tracks):
            ad.nla_tracks.remove(track)
    return armature, body


def toon_material(name: str, shades_hex: list[str], bands: tuple[float, float]):
    """Diffuse -> Shader to RGB -> constant ColorRamp -> Emission. Ramp shades 1..3 only; shade 0 is the outline's."""
    mat = bpy.data.materials.new(f"toon_{name}")
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    diffuse = tree.nodes.new("ShaderNodeBsdfDiffuse")
    diffuse.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    to_rgb = tree.nodes.new("ShaderNodeShaderToRGB")
    to_bw = tree.nodes.new("ShaderNodeRGBToBW")
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    elements = ramp.color_ramp.elements
    while len(elements) < 3:
        elements.new(0.5)
    for element, position, shade in zip(elements, (0.0, bands[0], bands[1]), shades_hex[1:4], strict=True):
        element.position = position
        r, g, b = sp.hex_to_linear(shade)
        element.color = (r, g, b, 1.0)
    emission = tree.nodes.new("ShaderNodeEmission")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(diffuse.outputs["BSDF"], to_rgb.inputs["Shader"])
    tree.links.new(to_rgb.outputs["Color"], to_bw.inputs["Color"])
    tree.links.new(to_bw.outputs["Val"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], emission.inputs["Color"])
    tree.links.new(emission.outputs["Emission"], out.inputs["Surface"])
    return mat


def apply_toon(body, palette_path: str, family: str, bands: tuple[float, float]) -> dict:
    data = json.loads(Path(palette_path).read_text())
    fam = next(f for f in data["families"] if f["id"] == family)
    ramps = {r["id"]: r["shades"] for r in fam["ramps"]}
    used = {}
    for slot in body.material_slots:
        source_name = slot.material.name
        ramp_id = MATERIAL_RAMPS[source_name]
        slot.material = toon_material(source_name, ramps[ramp_id], bands)
        used[source_name] = ramp_id
    return used


def configure_scene(scene, sun_strength: float, ambient: float) -> dict:
    scene.render.engine = "BLENDER_EEVEE"
    applied = {"engine": scene.render.engine}
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
            applied[f"eevee.{attr}"] = value
    scene.render.use_motion_blur = False
    applied["view_transform"] = scene.view_settings.view_transform
    applied["filter_size"] = scene.render.filter_size
    applied["film_transparent"] = scene.render.film_transparent

    world = bpy.data.worlds.new("flat")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bg.inputs["Strength"].default_value = ambient
    applied["ambient"] = ambient

    sun = bpy.data.lights.new("key", "SUN")
    sun.energy = sun_strength
    sun.angle = 0.0
    sun.use_shadow = False
    key = bpy.data.objects.new("key", sun)
    scene.collection.objects.link(key)
    applied["sun_strength"] = sun_strength
    return {"settings": applied, "key": key}


def build_camera(scene, axes: sp.CameraAxes, ppu: float, anchor: tuple[float, float]):
    cam_data = bpy.data.cameras.new("iso")
    cam_data.type = "ORTHO"
    cam_data.sensor_fit = "VERTICAL"
    cam_data.ortho_scale = sp.ortho_scale(sp.CELL[1], ppu)
    cam_data.clip_start = 0.1
    cam_data.clip_end = 100.0
    cam = bpy.data.objects.new("iso", cam_data)
    scene.collection.objects.link(cam)
    cam.rotation_euler = tuple(math.radians(d) for d in sp.CAMERA_ROT_DEG)
    cam.location = sp.camera_location((0.0, 0.0, 0.0), axes, ppu, anchor)
    scene.camera = cam
    return cam


def aim_key_light(key, axes: sp.CameraAxes) -> None:
    toward = mathutils.Vector(sp.key_light_toward(axes))
    key.rotation_euler = toward.to_track_quat("Z", "Y").to_euler()


# --- pose and measurement ----------------------------------------------------------------------------------


def set_action(armature, name: str):
    action = bpy.data.actions[name]
    ad = armature.animation_data or armature.animation_data_create()
    ad.action = action
    if hasattr(ad, "action_slot") and getattr(action, "slots", None):
        ad.action_slot = action.slots[0]
    return action


def go_to(scene, frame: float) -> None:
    whole = math.floor(frame)
    scene.frame_set(whole, subframe=frame - whole)


def place_armature(armature, yaw_deg: float, sole_mid_local: tuple[float, float], ground_z: float) -> None:
    """Turn the figure about the vertical axis through its sole midpoint, which stays at world (0, 0)."""
    rot = mathutils.Matrix.Rotation(math.radians(yaw_deg), 2)
    shifted = rot @ mathutils.Vector(sole_mid_local)
    armature.rotation_mode = "XYZ"  # the glTF importer leaves objects in quaternion mode, which ignores rotation_euler
    armature.rotation_euler = (0.0, 0.0, math.radians(yaw_deg))
    armature.location = (-shifted.x, -shifted.y, -ground_z)
    bpy.context.view_layer.update()


def evaluated(armature, body):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    return armature.evaluated_get(depsgraph), body.evaluated_get(depsgraph)


def mesh_world_points(body_eval) -> np.ndarray:
    mesh = body_eval.to_mesh()
    try:
        count = len(mesh.vertices)
        co = np.empty(count * 3, dtype=np.float32)
        mesh.vertices.foreach_get("co", co)
    finally:
        body_eval.to_mesh_clear()
    matrix = np.array(body_eval.matrix_world, dtype=np.float64)
    return co.reshape(count, 3).astype(np.float64) @ matrix[:3, :3].T + matrix[:3, 3]


def bone_head(arm_eval, name: str) -> tuple[float, float, float]:
    v = arm_eval.matrix_world @ arm_eval.pose.bones[name].head
    return (v.x, v.y, v.z)


def loop_closure_error(scene, armature, body, action_name: str) -> float:
    """Largest bone-head distance (m) between an action's first and last frame."""
    action = set_action(armature, action_name)
    start, end = action.frame_range
    heads = []
    for frame in (start, end):
        go_to(scene, frame)
        arm_eval, _ = evaluated(armature, body)
        heads.append([bone_head(arm_eval, b.name) for b in armature.data.bones])
    return max(math.dist(a, b) for a, b in zip(*heads, strict=True))


def pose_facts(armature, body, axes, ppu, anchor) -> dict:
    arm_eval, body_eval = evaluated(armature, body)
    points = mesh_world_points(body_eval)
    low = points[np.argmin(points[:, 2])]
    root = bone_head(arm_eval, "root")
    feet = {name: bone_head(arm_eval, name) for name in FOOT_BONES}
    mid_xy = (sum(p[0] for p in feet.values()) / 4, sum(p[1] for p in feet.values()) / 4)
    origin = (0.0, 0.0, 0.0)
    xs = anchor[0] + points @ np.array(axes.right) * ppu
    ys = anchor[1] - points @ np.array(axes.up) * ppu
    top, bottom, left, right = float(ys.min()), float(ys.max()), float(xs.min()), float(xs.max())

    def px(point):
        x, y = sp.project(tuple(float(c) for c in point), origin, axes, ppu, anchor)
        return [round(x, 4), round(y, 4)]

    return {
        "lowest_z": round(float(low[2]), 5),
        "lowest_px": px(low),
        "root_ground_px": px((root[0], root[1], 0.0)),
        "sole_mid_px": px((mid_xy[0], mid_xy[1], float(low[2]))),
        "foot_px": {name: px(p) for name, p in feet.items()},
        "extent_px": {"top": round(top, 3), "bottom": round(bottom, 3), "left": round(left, 3), "right": round(right, 3)},
    }


# --- main --------------------------------------------------------------------------------------------------


def render_to(scene, path: Path, variant: str) -> float:
    width, height = sp.render_size(variant)
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.filepath = str(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    return (time.perf_counter() - started) * 1000.0


def pixel_hash(path: Path) -> str:
    """sha256 of the decoded pixels; the PNG container itself is not byte-stable between renders."""
    image = bpy.data.images.load(str(path))
    try:
        data = np.empty(len(image.pixels), dtype=np.float32)
        image.pixels.foreach_get(data)
    finally:
        bpy.data.images.remove(image)
    return hashlib.sha256(data.tobytes()).hexdigest()


def main() -> int:
    args = parse_args()
    t_start = time.perf_counter()
    out = Path(args.out)
    bands = tuple(float(b) for b in args.bands.split(","))
    clips = [c for c in sp.CLIPS if c.id in args.clips.split(",")]
    directions = [d for d in sp.DIRECTIONS if d in args.directions.split(",")]
    variants = [v for v in ("direct", "x4") if v in args.variants.split(",")]

    armature, body = import_model(args.model)
    scene = bpy.context.scene
    scene.render.fps = 24
    ramps_used = apply_toon(body, args.palette, args.family, bands)
    configured = configure_scene(scene, args.sun, args.ambient)
    axes = sp.camera_axes()
    aim_key_light(configured["key"], axes)

    # Calibration: the idle rest frame facing the model's own forward gives the sole midpoint, ground level and
    # forward vector; the south-facing figure's screen height then fixes one pixels-per-unit for every clip.
    # The T-pose is symmetric, so the character's facing is exact there: forward = (thigh_l - thigh_r) x up.
    set_action(armature, "A_TPose")
    go_to(scene, 0.0)
    place_armature(armature, 0.0, (0.0, 0.0), 0.0)
    arm_eval, _ = evaluated(armature, body)
    left = tuple(a - b for a, b in zip(bone_head(arm_eval, "thigh_l"), bone_head(arm_eval, "thigh_r"), strict=True))
    forward = (left[1], -left[0])
    set_action(armature, "Idle_Loop")
    go_to(scene, bpy.data.actions["Idle_Loop"].frame_range[0])
    place_armature(armature, 0.0, (0.0, 0.0), 0.0)
    arm_eval, body_eval = evaluated(armature, body)
    heads = {n: bone_head(arm_eval, n) for n in FOOT_BONES}
    sole_mid = (sum(h[0] for h in heads.values()) / 4, sum(h[1] for h in heads.values()) / 4)
    ground_z = float(mesh_world_points(body_eval)[:, 2].min())
    facing = sp.facing_vectors(axes)
    yaws = {d: sp.yaw_to_face(forward, facing[d]) for d in sp.DIRECTIONS}

    place_armature(armature, yaws["south"], sole_mid, ground_z)
    _, body_eval = evaluated(armature, body)
    extent = sp.screen_extent_units([tuple(p) for p in mesh_world_points(body_eval)], axes)
    ppu = sp.px_per_unit(sp.INTERIOR_HEIGHT_PX, extent)

    # Camera fit, over every clip, facing and sampled frame (whatever --clips selects, so the camera never depends on it):
    # the lowest screen point of any pose goes to row 79, so no frame is cropped and one fixed camera serves them all.
    provisional = sp.ANCHOR
    lowest = {}
    for clip in sp.CLIPS:
        action = set_action(armature, clip.action)
        for direction in sp.DIRECTIONS:
            for frame in sp.sample_frames(*action.frame_range, clip.frames, clip.loop):
                go_to(scene, frame)
                place_armature(armature, yaws[direction], sole_mid, ground_z)
                lowest[(clip.id, direction, frame)] = pose_facts(armature, body, axes, ppu, provisional)["extent_px"]["bottom"]
    anchor = (sp.PIVOT_X, sp.anchor_for_bottom(provisional[1], max(lowest.values())))
    build_camera(scene, axes, ppu, anchor)

    # Cross-check the pure projection against Blender's own camera projection on the rest-pose bounding points.
    set_action(armature, "Idle_Loop")
    go_to(scene, 0.0)
    place_armature(armature, yaws["south"], sole_mid, ground_z)
    probe = mesh_world_points(evaluated(armature, body)[1])[::97]
    worst = 0.0
    scene.render.resolution_x, scene.render.resolution_y = sp.CELL
    for p in probe:
        v = world_to_camera_view(scene, scene.camera, mathutils.Vector(p))
        bx, by = v.x * sp.CELL[0], (1.0 - v.y) * sp.CELL[1]
        mx, my = sp.project(tuple(float(c) for c in p), (0.0, 0.0, 0.0), axes, ppu, anchor)
        worst = max(worst, abs(bx - mx), abs(by - my))

    meta = {
        "blender": {"version": bpy.app.version_string, "build_hash": bpy.app.build_hash.decode(), "build_date": bpy.app.build_date.decode()},
        "model": str(args.model),
        "settings": configured["settings"],
        "toon": {"ramps": ramps_used, "bands": list(bands), "shades_used": "ramp shades 1..3; shade 0 reserved for the outline"},
        "camera": {
            "rotation_deg": list(sp.CAMERA_ROT_DEG),
            "projection": "orthographic",
            "ortho_scale": sp.ortho_scale(sp.CELL[1], ppu),
            "sensor_fit": "VERTICAL",
            "px_per_unit": ppu,
            "sole_mid_anchor_px": [round(anchor[0], 4), round(anchor[1], 4)],
            "lowest_point_target_y": sp.BOTTOM_EDGE_Y,
            "lowest_point_by_pose_before_fit": {f"{k[0]}/{k[1]}/{k[2]}": round(v, 3) for k, v in lowest.items()},
            "ground_diamond_ratio": sp.ground_diamond_ratio(axes),
            "projection_check_max_px_error": round(worst, 6),
        },
        "light": {
            "toward_light_world": [round(c, 5) for c in sp.key_light_toward(axes)],
            "screen_weights_right_up_back": list(sp.KEY_LIGHT_SCREEN),
        },
        "calibration": {
            "model_forward_xy": [round(c, 5) for c in forward],
            "sole_mid_xy": [round(c, 5) for c in sole_mid],
            "ground_z": round(ground_z, 5),
            "south_screen_extent_units": round(extent, 5),
            "interior_target_px": sp.INTERIOR_HEIGHT_PX,
            "yaw_deg": {d: round(v, 4) for d, v in yaws.items()},
        },
        "clips": {},
        "frames": [],
        "timings_ms": {},
    }

    totals = {v: 0.0 for v in variants}
    counts = {v: 0 for v in variants}
    for clip in clips:
        action = set_action(armature, clip.action)
        start, end = action.frame_range
        closure = loop_closure_error(scene, armature, body, clip.action) if clip.loop else None
        set_action(armature, clip.action)
        sources = sp.sample_frames(start, end, clip.frames, clip.loop)
        meta["clips"][clip.id] = {
            "action": clip.action,
            "frame_range": [start, end],
            "loop": clip.loop,
            "loop_closure_error_m": None if closure is None else round(closure, 5),
            "source_frames": sources,
        }
        clip_ms = {v: 0.0 for v in variants}
        for direction in directions:
            for index, frame in enumerate(sources):
                go_to(scene, frame)
                place_armature(armature, yaws[direction], sole_mid, ground_z)
                facts = pose_facts(armature, body, axes, ppu, anchor)
                entry = {"clip": clip.id, "action": clip.action, "direction": direction, "index": index, "source_frame": frame, **facts, "files": {}, "render_ms": {}}
                for variant in variants:
                    name = sp.output_name(clip.id, direction, index, variant)
                    ms = render_to(scene, out / variant / name, variant)
                    entry["files"][variant] = f"{variant}/{name}"
                    entry["render_ms"][variant] = round(ms, 2)
                    clip_ms[variant] += ms
                    totals[variant] += ms
                    counts[variant] += 1
                meta["frames"].append(entry)
        meta["timings_ms"][clip.id] = {v: round(ms, 1) for v, ms in clip_ms.items()}
        print(f"clip {clip.id}: {clip.frames} frames x {len(directions)} directions, "
              + ", ".join(f"{v} {clip_ms[v]:.0f} ms" for v in variants), flush=True)

    if args.subpixel:
        cam = scene.camera
        base = cam.location.copy()
        set_action(armature, "Idle_Loop")
        go_to(scene, 0.0)
        place_armature(armature, yaws["south"], sole_mid, ground_z)
        meta["subpixel"] = []
        for dx, dy in SUBPIXEL_OFFSETS:
            # Subject moves right by dx px and down by dy px: move the camera left along its right axis and up along its up axis.
            cam.location = (
                base.x - axes.right[0] * dx / ppu + axes.up[0] * dy / ppu,
                base.y - axes.right[1] * dx / ppu + axes.up[1] * dy / ppu,
                base.z - axes.right[2] * dx / ppu + axes.up[2] * dy / ppu,
            )
            bpy.context.view_layer.update()
            record = {"dx": dx, "dy": dy, "files": {}}
            for variant in variants:
                name = f"idle_south_00_dx{int(dx * 100):02d}_dy{int(dy * 100):02d}.{variant}.png"
                render_to(scene, out / "subpixel" / variant / name, variant)
                record["files"][variant] = f"subpixel/{variant}/{name}"
            meta["subpixel"].append(record)
        cam.location = base

    if args.repeat_check:
        set_action(armature, "Idle_Loop")
        go_to(scene, 0.0)
        place_armature(armature, yaws["south"], sole_mid, ground_z)
        hashes = []
        for n in range(2):
            path = out / "repeat" / f"idle_south_00.repeat{n}.direct.png"
            render_to(scene, path, "direct")
            hashes.append(pixel_hash(path))
        meta["repeat_check"] = {"pixel_sha256": hashes, "identical": hashes[0] == hashes[1]}

    meta["timings_ms"]["total_render_only"] = {v: round(totals[v], 1) for v in variants}
    meta["timings_ms"]["per_image_mean"] = {v: round(totals[v] / max(1, counts[v]), 2) for v in variants}
    meta["timings_ms"]["wall_clock_total"] = round((time.perf_counter() - t_start) * 1000.0, 1)
    (out / "meta.json").parent.mkdir(parents=True, exist_ok=True)
    (out / "meta.json").write_text(json.dumps(meta, indent=1) + "\n")
    print("done", json.dumps(meta["timings_ms"]["total_render_only"]), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

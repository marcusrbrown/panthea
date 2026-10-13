# SPDX-License-Identifier: GPL-3.0-or-later
"""Round 2 renderer: the Zeus-shaped proxy on the UAL rig, x4 route only, two shading variants, ID and depth passes.

    blender --background --factory-startup --python-exit-code 1 --python render_zeus.py -- \\
        --model <UAL1_Standard.glb> --palette <palette.json> --out <dir>

Everything is built from a factory start in this process; nothing is saved as a .blend. The camera is round 1's, with
the same pixels-per-unit (calibrated on the unmodified mannequin), and the sole midpoint renders exactly at the fixed
per-asset anchor (32, 74): there is no per-frame or per-clip refit.
"""

from __future__ import annotations

import argparse
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
import proxy_plan as pp  # noqa: E402
import render as base  # noqa: E402
import sprite_plan as sp  # noqa: E402
import zeus_proxy as zp  # noqa: E402

DIRECTIONS_BY_CLIP = {"idle": sp.DIRECTIONS, "cast": sp.DIRECTIONS, "sit": sp.DIRECTIONS, "walk": ("south", "east")}
SUBPIXEL_OFFSETS = ((0.0, 0.0), (0.25, 0.0), (0.5, 0.0), (0.75, 0.0), (0.0, 0.25), (0.0, 0.5))

# Rig pose offsets: bone -> [(local axis, degrees)], post-multiplied on the animated local rotation. Facing-specific
# cast corrections are keyed ("cast", facing). Calibrated by trial; every attempt is counted in README "tuning log".
CARRY = {}  # filled from pose_offsets.json beside this file when present (see load_offsets)
OFFSETS_FILE = Path(__file__).resolve().parent / "pose_offsets.json"


def load_offsets() -> dict:
    return json.loads(OFFSETS_FILE.read_text()) if OFFSETS_FILE.exists() else {}


def offsets_for(table: dict, clip: str, direction: str, index: int = 0) -> dict:
    merged: dict = {}
    for key in ("all", clip, f"{clip}:{direction}", f"{clip}:{direction}:{index}"):
        for bone, steps in table.get(key, {}).items():
            merged.setdefault(bone, [])
            merged[bone] = merged[bone] + [tuple(s) for s in steps]
    return merged


def aims_for(table: dict, clip: str, direction: str, index: int) -> dict:
    """Aim directions for the bolt arm; later keys override earlier ones, bone order kept parent first."""
    merged: dict = {}
    for key in (clip, f"{clip}:{direction}", f"{clip}:{direction}:{index}"):
        merged.update(table.get("aim", {}).get(key, {}))
    order = ("clavicle_r", "upperarm_r", "lowerarm_r", "hand_r")
    return {b: merged[b] for b in order if b in merged}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="render_zeus.py")
    ap.add_argument("--model", required=True)
    ap.add_argument("--palette", required=True)
    ap.add_argument("--family", default="olympus")
    ap.add_argument("--out", required=True)
    ap.add_argument("--variants", default="a3,b2")
    ap.add_argument("--clips", default="idle,walk,cast,sit")
    ap.add_argument("--only", default="", help="clip:direction:index, render just that pose (debug)")
    ap.add_argument("--no-passes", action="store_true")
    ap.add_argument("--subpixel", action="store_true")
    ap.add_argument(
        "--check-subpixel",
        action="store_true",
        help="render idle/south/0 and the zero-offset sub-pixel cell, compare them pixel for pixel per variant, exit 1 on any difference",
    )
    args = ap.parse_args(argv)
    if args.check_subpixel:
        args.subpixel, args.clips, args.only, args.no_passes = True, "idle", "idle:south:0", True
    return args


def go_to(scene, frame: float) -> None:
    """Set the time, forcing a re-evaluation even when the frame number is unchanged (a freshly assigned action is not
    evaluated by frame_set to the same frame)."""
    scene.frame_set(math.floor(frame) + 7)
    base.go_to(scene, frame)


def calibrate(scene, armature, body, axes) -> dict:
    """Round 1's calibration on the unmodified mannequin: forward vector, sole midpoint, ground, pixels per unit."""
    base.set_action(armature, "A_TPose")
    go_to(scene, 0.0)
    base.place_armature(armature, 0.0, (0.0, 0.0), 0.0)
    arm_eval, _ = base.evaluated(armature, body)
    left = tuple(a - b for a, b in zip(base.bone_head(arm_eval, "thigh_l"), base.bone_head(arm_eval, "thigh_r"), strict=True))
    forward = (left[1], -left[0])
    base.set_action(armature, "Idle_Loop")
    go_to(scene, bpy.data.actions["Idle_Loop"].frame_range[0])
    base.place_armature(armature, 0.0, (0.0, 0.0), 0.0)
    arm_eval, body_eval = base.evaluated(armature, body)
    heads = {n: base.bone_head(arm_eval, n) for n in base.FOOT_BONES}
    sole_mid = (sum(h[0] for h in heads.values()) / 4, sum(h[1] for h in heads.values()) / 4)
    ground_z = float(base.mesh_world_points(body_eval)[:, 2].min())
    facing = sp.facing_vectors(axes)
    yaws = {d: sp.yaw_to_face(forward, facing[d]) for d in sp.DIRECTIONS}
    base.place_armature(armature, yaws["south"], sole_mid, ground_z)
    _, body_eval = base.evaluated(armature, body)
    extent = sp.screen_extent_units([tuple(p) for p in base.mesh_world_points(body_eval)], axes)
    return {"forward": forward, "sole_mid": sole_mid, "ground_z": ground_z, "yaws": yaws, "extent": extent, "ppu": sp.px_per_unit(sp.INTERIOR_HEIGHT_PX, extent)}


def all_points(objs: dict) -> np.ndarray:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    chunks = []
    for name, obj in objs.items():
        if obj.hide_render:
            continue
        chunks.append(base.mesh_world_points(obj.evaluated_get(depsgraph)))
    return np.vstack(chunks)


def render_pass(scene, path: Path, override, resolution=sp.render_size("x4")) -> float:
    layer = bpy.context.view_layer
    layer.material_override = override
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.filepath = str(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    layer.material_override = None
    return (time.perf_counter() - started) * 1000.0


def main() -> int:
    args = parse_args()
    t0 = time.perf_counter()
    out = Path(args.out)
    palette_json = zp.load_palette_json(args.palette)
    variants = [v for v in pp.VARIANTS if v.id in args.variants.split(",")]
    clips = [c for c in sp.CLIPS if c.id in args.clips.split(",")]
    only = args.only.split(":") if args.only else None

    armature, body = base.import_model(args.model)
    scene = bpy.context.scene
    scene.render.fps = 24
    configured = base.configure_scene(scene, variants[0].sun, variants[0].ambient)
    axes = sp.camera_axes()
    base.aim_key_light(configured["key"], axes)
    fill_data = bpy.data.lights.new("fill", "SUN")
    fill_data.angle = 0.0
    fill_data.use_shadow = False
    fill = bpy.data.objects.new("fill", fill_data)
    scene.collection.objects.link(fill)
    toward = mathutils.Vector(sp.key_light_toward(axes, (0.62, -0.35, 0.56)))
    fill.rotation_euler = toward.to_track_quat("Z", "Y").to_euler()

    cal = calibrate(scene, armature, body, axes)
    ppu, yaws, sole_mid, ground_z = cal["ppu"], cal["yaws"], cal["sole_mid"], cal["ground_z"]
    anchor = sp.FIXED_ANCHOR

    # Seat position: under the seated pelvis in the unmodified rig (the proxy only changes the mesh).
    sit = bpy.data.actions["Sitting_Idle_Loop"]
    base.set_action(armature, "Sitting_Idle_Loop")
    go_to(scene, sit.frame_range[0])
    base.place_armature(armature, 0.0, (0.0, 0.0), 0.0)
    arm_eval, _ = base.evaluated(armature, body)
    pelvis = base.bone_head(arm_eval, "pelvis")

    objs, proxy_info = zp.build_all(armature, body, pelvis)
    palettes = {v.id: zp.apply_variant_materials(objs, palette_json, args.family, v) for v in variants}
    id_mat, depth_mat = zp.id_override_material(), zp.depth_override_material()
    cam = base.build_camera(scene, axes, ppu, anchor)
    offsets = load_offsets()

    # Standing height check on the proxy (body, robe, beard, hair; the bolt is excluded): idle south frame 0.
    base.set_action(armature, "Idle_Loop")
    go_to(scene, 0.0)
    base.place_armature(armature, yaws["south"], sole_mid, ground_z)
    for name in ("seat",):
        objs[name].hide_render = True
    standing = {k: v for k, v in objs.items() if k != "bolt"}
    pts = all_points(standing)
    sy = anchor[1] - pts @ np.array(axes.up) * ppu
    standing_height_px = float(sy.max() - sy.min())
    origin_px = world_to_camera_view(scene, cam, mathutils.Vector((0, 0, 0)))
    scene.render.resolution_x, scene.render.resolution_y = sp.CELL
    origin_px = world_to_camera_view(scene, cam, mathutils.Vector((0, 0, 0)))
    anchor_check = (origin_px.x * sp.CELL[0], (1 - origin_px.y) * sp.CELL[1])

    meta = {
        "blender": {"version": bpy.app.version_string, "build_hash": bpy.app.build_hash.decode()},
        "route": "x4 only",
        "camera": {"px_per_unit": ppu, "ortho_scale": sp.ortho_scale(sp.CELL[1], ppu), "anchor_px": list(anchor), "anchor_check_px": [round(c, 6) for c in anchor_check], "rotation_deg": list(sp.CAMERA_ROT_DEG), "ground_diamond_ratio": sp.ground_diamond_ratio(axes)},
        "calibration": {"extent_units": cal["extent"], "yaw_deg": {d: round(v, 4) for d, v in yaws.items()}, "sole_mid_xy": [round(c, 5) for c in sole_mid], "ground_z": round(ground_z, 5), "round1_ppu_reused": True},
        "proxy": {**proxy_info, "standing_height_px_excluding_bolt": round(standing_height_px, 3), "pose_offsets_file": OFFSETS_FILE.name if OFFSETS_FILE.exists() else None, "pose_offsets": offsets},
        "variants": {v.id: {"label": v.label, "thresholds": list(v.thresholds), "sun": v.sun, "ambient": v.ambient, "fill": v.fill, "shade_indices": {k: list(i) for k, i in v.shade_indices.items()}} for v in variants},
        "frames": [],
        "timings_ms": {},
    }

    totals = {v.id: 0.0 for v in variants}
    totals.update(id=0.0, depth=0.0)
    counts = {k: 0 for k in totals}

    def pose_zeus(clip, direction: str, index: int, frame: float) -> None:
        """The one pose sequence for every Zeus render (main cells and the sub-pixel control): action frame, mirror,
        bone offsets, bolt-arm aims, freeze, place."""
        base.set_action(armature, clip.action)
        go_to(scene, frame)
        if clip.id in offsets.get("_mirror", []):
            zp.mirror_pose(armature)
        zp.apply_offsets(armature, offsets_for(offsets, clip.id, direction, index))
        zp.aim_bones(armature, aims_for(offsets, clip.id, direction, index))
        armature.animation_data.action = None  # freeze the offset pose; render would re-evaluate the action
        base.place_armature(armature, yaws[direction], sole_mid, ground_z)

    def set_variant(v: pp.ShadingVariant) -> None:
        zp.use_variant_materials(palettes[v.id])
        configured["key"].data.energy = v.sun
        fill.data.energy = v.fill
        scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = v.ambient

    def render_pose(entry: dict, tag: str) -> None:
        for v in variants:
            set_variant(v)
            name = f"{tag}.{v.id}.png"
            ms = base.render_to(scene, out / v.id / name, "x4")
            entry["files"][v.id] = f"{v.id}/{name}"
            entry["render_ms"][v.id] = round(ms, 2)
            totals[v.id] += ms
            counts[v.id] += 1
        if not args.no_passes:
            for kind, mat in (("id", id_mat), ("depth", depth_mat)):
                name = f"{tag}.{kind}.png"
                ms = render_pass(scene, out / kind / name, mat)
                entry["files"][kind] = f"{kind}/{name}"
                entry["render_ms"][kind] = round(ms, 2)
                totals[kind] += ms
                counts[kind] += 1

    for clip in clips:
        action = bpy.data.actions[clip.action]
        sources = sp.sample_frames(*action.frame_range, clip.frames, clip.loop)
        meta.setdefault("clips", {})[clip.id] = {"action": clip.action, "source_frames": sources, "timing_ms": list(pp.CANON_TIMING_MS[clip.id])}
        objs["seat"].hide_render = clip.id != "sit"
        for direction in DIRECTIONS_BY_CLIP[clip.id]:
            for index, frame in enumerate(sources):
                if only and (only[0], only[1], only[2]) != (clip.id, direction, str(index)):
                    continue
                pose_zeus(clip, direction, index, frame)
                pts = all_points(objs)
                ys = anchor[1] - pts @ np.array(axes.up) * ppu
                xs = anchor[0] + pts @ np.array(axes.right) * ppu
                arm_eval, _ = base.evaluated(armature, body)
                feet = {n: base.bone_head(arm_eval, n) for n in base.FOOT_BONES}
                low = pts[np.argmin(pts[:, 2])]
                scene.render.resolution_x, scene.render.resolution_y = sp.CELL
                o = world_to_camera_view(scene, cam, mathutils.Vector((0, 0, 0)))
                entry = {
                    "clip": clip.id, "action": clip.action, "direction": direction, "index": index, "source_frame": frame,
                    "anchor_px": [round(o.x * sp.CELL[0], 6), round((1 - o.y) * sp.CELL[1], 6)],
                    "extent_px": {"top": round(float(ys.min()), 3), "bottom": round(float(ys.max()), 3), "left": round(float(xs.min()), 3), "right": round(float(xs.max()), 3)},
                    "lowest_z": round(float(low[2]), 5),
                    "foot_px": {n: [round(sp.project(p, (0, 0, 0), axes, ppu, anchor)[0], 4), round(sp.project(p, (0, 0, 0), axes, ppu, anchor)[1], 4)] for n, p in feet.items()},
                    "files": {}, "render_ms": {},
                }
                render_pose(entry, f"{clip.id}_{direction}_{index:02d}")
                meta["frames"].append(entry)
        print(f"clip {clip.id} done", flush=True)

    if args.subpixel:
        base_loc = cam.location.copy()
        objs["seat"].hide_render = True
        idle = next(c for c in sp.CLIPS if c.id == "idle")
        idle_first_frame = sp.sample_frames(*bpy.data.actions[idle.action].frame_range, idle.frames, idle.loop)[0]
        pose_zeus(idle, "south", 0, idle_first_frame)  # the same pose as the main idle/south/0 cell
        meta["subpixel"] = []
        for dx, dy in ((0.0, 0.0),) if args.check_subpixel else SUBPIXEL_OFFSETS:
            cam.location = (
                base_loc.x - axes.right[0] * dx / ppu + axes.up[0] * dy / ppu,
                base_loc.y - axes.right[1] * dx / ppu + axes.up[1] * dy / ppu,
                base_loc.z - axes.right[2] * dx / ppu + axes.up[2] * dy / ppu,
            )
            bpy.context.view_layer.update()
            rec = {"dx": dx, "dy": dy, "files": {}, "render_ms": {}}
            render_pose(rec, f"subpixel/idle_south_00_dx{int(dx * 100):02d}_dy{int(dy * 100):02d}")
            meta["subpixel"].append(rec)
        cam.location = base_loc

    mismatch = 0
    if args.check_subpixel:
        for v in variants:
            differing, total = base.count_pixel_diffs(out / meta["frames"][0]["files"][v.id], out / meta["subpixel"][0]["files"][v.id])
            mismatch += differing
            print(f"check-subpixel {v.id}: {differing} of {total} pixels differ between idle/south/0 and the zero-offset sub-pixel cell", flush=True)
        print("check-subpixel " + ("FAIL" if mismatch else "OK"), flush=True)

    meta["timings_ms"] = {k: {"total": round(totals[k], 1), "images": counts[k], "mean": round(totals[k] / max(1, counts[k]), 2)} for k in totals}
    meta["timings_ms"]["wall_clock_total"] = round((time.perf_counter() - t0) * 1000.0, 1)
    out.mkdir(parents=True, exist_ok=True)
    (out / "meta.json").write_text(json.dumps(meta, indent=1) + "\n")
    print("done", json.dumps(meta["timings_ms"]), flush=True)
    return 1 if mismatch else 0


if __name__ == "__main__":
    raise SystemExit(main())

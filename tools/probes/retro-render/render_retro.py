"""Retro-render renderer: one item per Blender process, 4x beauty renders in two shading variants plus part-ID and depth passes.

    blender --background --factory-startup --python-exit-code 1 --python render_retro.py -- \\
        --item zeus --models <main-checkout>/tools/probes --out <dir>

Items: zeus, mortal (Universal Base Characters on UAL clips), tree (Kenney, wind loop), temple (primitives), house (Quaternius
medieval), tile (path and grass). Everything is built from a factory start in the process; nothing is saved as a .blend.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from pathlib import Path

import bmesh
import bpy
import mathutils
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector, kdtree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import retro_lib as rl  # noqa: E402
from retro_lib import base, pal, rp, sp, zp  # noqa: E402
import tile_geom as tg  # noqa: E402
import wind_plan as wp  # noqa: E402

REPO = rl.REPO
UBC = "Universal Base Characters[Standard]/Universal Base Characters[Standard]"
UAL = "blender-sprite/models/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb"
POSE_OFFSETS = REPO / "tools/probes/blender-sprite/pose_offsets.json"
ARM_NAMES = zp.ARM_NAMES
FIST_AXIS = (1.0, 0.0, 0.0)  # finger curl axis in each finger bone's own space (X; the sign is the curl direction)
FIST_SIGN = 1.0


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="render_retro.py")
    ap.add_argument("--item", required=True, choices=sorted(rp.ITEMS))
    ap.add_argument("--models", required=True, help="the main checkout's tools/probes directory")
    ap.add_argument("--palette", default=str(Path(__file__).resolve().parent / "palette/scene-palette.json"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--variants", default="toon")
    ap.add_argument("--only", default="", help="clip:facing:index, one pose")
    ap.add_argument("--no-passes", action="store_true")
    ap.add_argument("--hair", default="", help="override the profile hair, comma separated")
    ap.add_argument("--fist", type=float, default=None, help="override the fist curl in degrees")
    ap.add_argument("--pitch", type=float, default=None, help="override the extra head pitch in degrees")
    ap.add_argument("--tree", default="tree_cone")
    ap.add_argument("--house", default="House_1")
    return ap.parse_args(argv)


class Pose:
    def __init__(self, clip: str, facing: str, index: int, source_frame: float, apply, extra: dict | None = None):
        self.clip, self.facing, self.index, self.source_frame, self.apply, self.extra = clip, facing, index, source_frame, apply, extra or {}


# --- characters (Universal Base Characters on UAL clips) -------------------------------------------------------------


def blend_aims(a: dict, b: dict, t: float) -> dict:
    out = {}
    for bone in a:
        va, vb = Vector(a[bone]).normalized(), Vector(b.get(bone, a[bone])).normalized()
        out[bone] = list(va.lerp(vb, t).normalized())
    return out


def build_garment(arm, body, name: str, rings, count: int, folds: int, part_of, materials: int = 2, neckline: tuple[float, float, float] | None = None):
    """Lofted, bone-weighted garment (copy of zeus_proxy.build_robe with the rings and part names as parameters)."""
    garment = zp._loft(name, rings, count, folds)
    if neckline is not None:  # (z_min, y_max, half_width): drop the front faces above z_min, an open neckline
        z_min, y_max, half = neckline
        bm = bmesh.new()
        bm.from_mesh(garment.data)
        doomed = [f for f in bm.faces if (c := f.calc_center_median()).z > z_min and c.y < y_max and abs(c.x) < half]
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        bm.to_mesh(garment.data)
        bm.free()
    groups = zp.dominant_groups(body)
    tree = kdtree.KDTree(len(body.data.vertices))
    for i, v in enumerate(body.data.vertices):
        if groups[i].startswith(ARM_NAMES) or groups[i] == "Head" or groups[i].startswith(rp.FINGERS):
            continue
        tree.insert(v.co, i)
    tree.balance()
    body_w = [{body.vertex_groups[g.group].name: g.weight for g in v.groups} for v in body.data.vertices]
    weights = {}
    for vi, v in enumerate(garment.data.vertices):
        mix: dict[str, float] = {}
        for _, idx, dist in tree.find_n(v.co, 4):
            for n, x in body_w[idx].items():
                mix[n] = mix.get(n, 0.0) + x / (dist + 0.02)
        t = min(1.0, max(0.0, (0.95 - v.co.z) / 0.5)) * 0.45
        total = sum(mix.values())
        mix = {n: x / total * (1 - t) for n, x in mix.items()}
        mix["pelvis"] = mix.get("pelvis", 0.0) + t
        weights[vi] = mix
    zp._skin(garment, arm, weights)
    parts = []
    for poly in garment.data.polygons:
        z = sum(garment.data.vertices[i].co.z for i in poly.vertices) / len(poly.vertices)
        parts.append(part_of(poly.material_index, z))
    rl.set_ids(garment, parts)
    while len(garment.data.materials) < materials:  # never clear(): it resets every face's material index to 0 (found in round 2: the belt and hem trim were never drawn)
        garment.data.materials.append(None)
    return garment


class Character:
    def __init__(self, args, item: rp.Item, scene, axes, cam, book: rl.MaterialBook, kind: str):
        self.scene, self.axes, self.cam, self.item, self.book, self.kind = scene, axes, cam, item, book, kind
        models = Path(args.models)
        bpy.context.view_layer.update()
        # animation source: the UAL actions (same bone names as the Universal Base Characters rig)
        ual_objs = rl.import_gltf(str(models / UAL))
        for o in ual_objs:
            bpy.data.objects.remove(o, do_unlink=True)
        base_dir = models / "retro-render/models" / UBC / "Base Characters/Godot - UE"
        self.profile = rp.PROFILES[kind]
        gender = "Male" if kind == "zeus" else "Female"
        objs = rl.import_gltf(str(base_dir / f"Superhero_{gender}_FullBody.gltf"))
        self.arm = next(o for o in objs if o.type == "ARMATURE")
        meshes = {o.name: o for o in objs if o.type == "MESH"}
        self.body = next(o for n, o in meshes.items() if n.startswith("SuperHero") or n.startswith("Superhero"))
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
        for name in rp.limb_child_bones():  # a shortened limb must not shrink the hand or foot hanging off it
            if name in self.arm.data.bones:
                self.arm.data.bones[name].inherit_scale = "NONE"
        self.args = args
        self.offsets = json.loads(POSE_OFFSETS.read_text())
        self.extras: list = []  # garment, hair, beard
        self.render_objs = [self.body]
        self.bolt = None

    # --- accessories ------------------------------------------------------------------------------------------------

    def add_bun(self, bun: rp.Bun):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=bun.radius, matrix=mathutils.Matrix.Translation(bun.centre))
        mesh = bpy.data.meshes.new("bun")
        for f in bm.faces:
            f.smooth = False
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new("bun", mesh)
        bpy.context.scene.collection.objects.link(obj)
        zp._skin(obj, self.arm, {i: {"Head": 1.0} for i in range(len(mesh.vertices))})
        rl.set_ids(obj, "hair")
        self.book.bind(obj, ["hair"])
        self.render_objs.append(obj)
        return obj

    def add_hair(self, models: Path, piece: rp.HairPiece):
        file, role, part = piece.file, piece.role, piece.part
        hair_dir = models / "retro-render/models" / UBC / "Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)"
        objs = rl.import_gltf(str(hair_dir / f"{file}.gltf"))
        mesh = next(o for o in objs if o.type == "MESH" and o.name.startswith(("Hair", "Beard")))
        for o in objs:
            if o is not mesh:
                bpy.data.objects.remove(o, do_unlink=True)
        for m in mesh.modifiers:
            if m.type == "ARMATURE":
                m.object = self.arm
        if piece.drop_front_below or piece.keep_sides_back:
            bm = bmesh.new()
            bm.from_mesh(mesh.data)
            doomed = [f for f in bm.faces if not rp.hair_face_kept(piece, *f.calc_center_median())]
            bmesh.ops.delete(bm, geom=doomed, context="FACES")
            bm.to_mesh(mesh.data)
            bm.free()
        mesh.parent = self.arm
        mesh.matrix_parent_inverse = mathutils.Matrix.Identity(4)
        rl.set_ids(mesh, part)
        self.book.bind(mesh, [role] * max(1, len(mesh.data.materials)))
        self.render_objs.append(mesh)
        return mesh

    def finish_materials(self) -> None:
        self.book.bind(self.body, ["skin"] * max(1, len(self.body.data.materials)))
        rl.set_ids(self.body, rl.body_face_parts(self.body))

    # --- calibration ------------------------------------------------------------------------------------------------

    def calibrate(self) -> None:
        axes = self.axes
        base.set_action(self.arm, "A_TPose")
        base.go_to(self.scene, 0.0)
        self.arm.scale = (1.0, 1.0, 1.0)
        base.place_armature(self.arm, 0.0, (0.0, 0.0), 0.0)
        arm_eval, _ = base.evaluated(self.arm, self.body)
        left = tuple(a - b for a, b in zip(base.bone_head(arm_eval, "thigh_l"), base.bone_head(arm_eval, "thigh_r"), strict=True))
        forward = (left[1], -left[0])
        base.set_action(self.arm, "Idle_Loop")
        base.go_to(self.scene, bpy.data.actions["Idle_Loop"].frame_range[0])
        base.place_armature(self.arm, 0.0, (0.0, 0.0), 0.0)
        arm_eval, _ = base.evaluated(self.arm, self.body)
        heads = [base.bone_head(arm_eval, n) for n in base.FOOT_BONES]
        self.sole_local = (sum(h[0] for h in heads) / 4, sum(h[1] for h in heads) / 4)
        self.ground_local = float(rl.mesh_points(self.body)[:, 2].min())
        facing = sp.facing_vectors(axes)
        self.yaws = {d: sp.yaw_to_face(forward, facing[d]) for d in sp.DIRECTIONS}

    def place(self, yaw: float) -> None:
        s = self.scale
        sx, sy, sz = (s * k for k in self.profile.body_scale)
        rot = mathutils.Matrix.Rotation(math.radians(yaw), 2)
        shifted = rot @ Vector((self.sole_local[0] * sx, self.sole_local[1] * sy))
        self.arm.rotation_mode = "XYZ"
        self.arm.rotation_euler = (0.0, 0.0, math.radians(yaw))
        self.arm.scale = (sx, sy, sz)
        self.arm.location = (-shifted.x, -shifted.y, -self.ground_local * sz)
        bpy.context.view_layer.update()

    def fit_scale(self, target_px: float) -> float:
        self.scale = 1.0
        self.set_pose("Idle_Loop", bpy.data.actions["Idle_Loop"].frame_range[0], "idle", "south", 0, 1)
        pts = rl.all_points([o for o in self.render_objs if o is not self.bolt])
        extent_px = float(((pts @ np.array(self.axes.up)).max() - (pts @ np.array(self.axes.up)).min()) * rp.PPU)
        self.scale = rp.fit_scale(target_px, extent_px)  # the same camera scale for everyone: only the model is enlarged
        self.fit_extent_px = extent_px
        return self.scale

    # --- posing ------------------------------------------------------------------------------------------------------

    def aims(self, state: str, facing: str, index: int, count: int) -> dict:
        """Pose overrides for an animation *state* (walk, idle, ...), never for a sample variant such as walk16."""
        table = self.offsets.get("aim", {})
        merged: dict = {}
        for key in rp.override_keys(state, facing):
            merged.update(table.get(key, {}))
        return merged

    def cast_aims(self, facing: str, index: int, count: int) -> dict:
        table = self.offsets["aim"]

        def key(i: int) -> dict:
            merged: dict = {}
            for k in ("cast", f"cast:{facing}", f"cast:{facing}:{i}"):
                merged.update(table.get(k, {}))
            return merged

        carry, windup, release = key(0), key(1), key(2)
        schedule = [(carry, carry, 0.0), (carry, windup, 1.0), (windup, release, 1.0), (release, release, 0.0), (release, carry, 0.5), (carry, carry, 0.0)]
        a, b, t = schedule[min(index, len(schedule) - 1)]
        return blend_aims(a, b, t)  # round 1 pulled the south and north aims forward to fit a 64 px cell; the 96 px canvas needs no cheat

    def set_pose(self, action: str, frame: float, state: str, facing: str, index: int, count: int) -> None:
        base.set_action(self.arm, action)
        base.go_to(self.scene, frame)
        if self.kind == "zeus":
            if state == "cast":
                zp.mirror_pose(self.arm)
            aims = self.cast_aims(facing, index, count) if state == "cast" else self.aims(state, facing, index, count)
            order = ("clavicle_r", "upperarm_r", "lowerarm_r", "hand_r")
            zp.aim_bones(self.arm, {b: aims[b] for b in order if b in aims})
        for name, scale in rp.profile_bone_scales(self.profile).items():
            if name in self.arm.pose.bones:
                self.arm.pose.bones[name].scale = scale
        pitch = self.profile.head_pitch_deg if self.args.pitch is None else self.args.pitch
        head = self.arm.pose.bones.get("Head")
        if pitch and head is not None:
            head.rotation_mode = "QUATERNION"
            head.rotation_quaternion = head.rotation_quaternion @ mathutils.Quaternion((1.0, 0.0, 0.0), math.radians(pitch))
        fist = self.profile.fist_deg if self.args.fist is None else self.args.fist
        if fist:
            for name, deg in rp.fist_curls(fist).items():
                pb = self.arm.pose.bones.get(name)
                if pb is not None:
                    pb.rotation_mode = "XYZ"
                    pb.rotation_euler = tuple(math.radians(deg) * FIST_SIGN * a for a in FIST_AXIS)
        self.arm.animation_data.action = None  # freeze the pose; a render must not re-evaluate the action
        self.place(self.yaws[facing] if hasattr(self, "yaws") else 0.0)

    def poses(self):
        item = self.item
        for clip in item.clips:
            action = bpy.data.actions[clip.action]
            frames = rp.sample_frames(*action.frame_range, clip.frames, clip.loop)
            for facing in clip.facings:
                for index, frame in enumerate(frames):
                    def apply(c=clip, a=clip.action, f=frame, d=facing, i=index):
                        self.set_pose(a, f, c.state, d, i, c.frames)

                    yield Pose(clip.id, facing, index, frame, apply)

    def locator_facts(self) -> dict:
        facts: dict = {}
        if self.bolt is not None:
            pts = rl.mesh_points(self.bolt)
            b0, b1 = pts[:4].mean(axis=0), pts[-4:].mean(axis=0)
            facts["bolt"] = {
                "base_px": [round(v, 4) for v in rl.project_px(b0, self.axes, self.item)],
                "tip_px": [round(v, 4) for v in rl.project_px(b1, self.axes, self.item)],
                "base_depth": round(rl.camera_depth(b0, self.cam), 4),
            }
        for name, obj in self.locators.items():
            pts = rl.mesh_points(obj)
            rest = np.array([v.co for v in obj.data.vertices])
            side = rest[:, 0] > 0  # the character's left is +X in the rig
            for label, mask in (("l", side), ("r", ~side)):
                c = pts[mask].mean(axis=0)
                facts[f"{name.lower()}_{label}"] = {"px": [round(v, 4) for v in rl.project_px(c, self.axes, self.item)], "depth": round(rl.camera_depth(c, self.cam), 4)}
        return facts


def zeus_rings() -> list:
    """Neck to hem. Round 2: a straighter column (the hem is only 8% wider than the hips) and broad folds."""
    R = lambda z, w, d, c, f=0.0, m=0: zp.pp.Ring(z, w, d, c, f, m)  # noqa: E731
    return [
        R(1.515, 0.110, 0.110, 0.015),
        R(1.465, 0.225, 0.150, 0.020),
        R(1.360, 0.235, 0.158, 0.020, 0.02),
        R(1.230, 0.225, 0.158, 0.020, 0.03),
        R(1.150, 0.206, 0.152, 0.020, 0.03, 1),
        R(1.040, 0.208, 0.155, 0.020, 0.03, 1),
        R(0.930, 0.214, 0.170, 0.020, 0.05),
        R(0.760, 0.218, 0.178, 0.020, 0.07),
        R(0.560, 0.222, 0.186, 0.020, 0.08),
        R(0.400, 0.225, 0.188, 0.020, 0.08, 1),
        R(0.320, 0.227, 0.190, 0.020, 0.08, 1),
    ]


def mortal_rings() -> list:
    """A belted chiton: an open neckline (cut in the loft), a waist, a flared skirt with broad folds and a trimmed hem."""
    R = lambda z, w, d, c, f=0.0, m=0: zp.pp.Ring(z, w, d, c, f, m)  # noqa: E731
    return [
        R(1.400, 0.150, 0.105, 0.015),
        R(1.360, 0.185, 0.120, 0.018),
        R(1.240, 0.188, 0.140, 0.018, 0.02),
        R(1.150, 0.186, 0.152, 0.018, 0.02, 1),
        R(1.060, 0.190, 0.154, 0.018, 0.02, 1),
        R(0.960, 0.210, 0.175, 0.020, 0.07),
        R(0.800, 0.220, 0.165, 0.020, 0.09),
        R(0.660, 0.226, 0.170, 0.020, 0.09, 1),
        R(0.570, 0.229, 0.172, 0.020, 0.09, 1),
    ]


def hair_pieces(args, profile: rp.Profile) -> list[rp.HairPiece]:
    if args.hair:  # debugging override: whole meshes, no trims
        return [rp.HairPiece(h, *(("beard", "beard") if h == "Hair_Beard" else ("hair", "hair"))) for h in args.hair.split(",") if h]
    return list(profile.hair)


def add_profile_hair(ch, args, models: Path) -> None:
    for piece in hair_pieces(args, ch.profile):
        ch.add_hair(models, piece)
    if ch.profile.bun is not None and not args.hair:
        ch.add_bun(ch.profile.bun)


def build_zeus(args, scene, axes, cam, item, book):
    ch = Character(args, item, scene, axes, cam, book, "zeus")
    models = Path(args.models)
    book.roles.update(rp.ZEUS_RAMPS.roles)
    rings = zeus_rings()
    garment = build_garment(
        ch.arm, ch.body, "robe", rings, 20, 5,
        lambda m, z: "belt" if m == 1 and 1.0 < z < 1.15 else "robe_skirt" if z < 1.0 else "robe_upper",
    )  # fmt: skip
    book.bind(garment, ["robe", "trim"])
    ch.render_objs.append(garment)
    add_profile_hair(ch, args, models)
    ch.bolt = zp.build_bolt(ch.arm)
    ch.bolt.hide_render = True
    ch.finish_materials()
    ch.calibrate()
    ch.fit_scale(item.interior_px)
    return ch


def build_mortal(args, scene, axes, cam, item, book):
    ch = Character(args, item, scene, axes, cam, book, "mortal")
    models = Path(args.models)
    book.roles.update(rp.MORTAL_RAMPS.roles)
    garment = build_garment(
        ch.arm, ch.body, "tunic", mortal_rings(), 16, 4,
        lambda m, z: "belt" if m == 1 else "tunic_skirt" if z < 0.95 else "tunic",
        neckline=(1.31, -0.01, 0.10),
    )  # fmt: skip
    book.bind(garment, ["tunic", "belt"])
    ch.render_objs.append(garment)
    add_profile_hair(ch, args, models)
    ch.finish_materials()
    ch.calibrate()
    ch.fit_scale(item.interior_px)
    return ch


# --- animal (Quaternius Ultimate Animated Animals: Bull) -------------------------------------------------------------

ANIMALS_DIR = "Ultimate Animated Animals - July 2021-20261012T171708Z-1-001/Ultimate Animated Animals - July 2021/glTF"


class Animal:
    """The Bull with its own rig and clips (Idle, Walk), at mortal scale. Forward is -Y in the rig."""

    def __init__(self, args, item: rp.Item, scene, axes, cam, book: rl.MaterialBook):
        self.scene, self.axes, self.cam, self.item, self.book = scene, axes, cam, item, book
        objs = rl.import_gltf(str(Path(args.models) / "retro-render/models" / ANIMALS_DIR / "Bull.gltf"))
        self.arm = next(o for o in objs if o.type == "ARMATURE")
        self.body = next(o for o in objs if o.type == "MESH" and o.parent is self.arm)
        for o in objs:
            if o.type == "MESH" and o is not self.body:
                bpy.data.objects.remove(o, do_unlink=True)  # a stray icosphere ships in the glTF
        ad = self.arm.animation_data
        if ad is not None:
            for track in list(ad.nla_tracks):
                ad.nla_tracks.remove(track)
        roles = []
        for m in self.body.data.materials:
            role, ramp, bias = rp.BULL_ROLES[m.name]
            book.add_role(role, ramp, bias)
            roles.append(role)
        book.bind(self.body, roles)
        rl.set_ids(self.body, "animal")
        self.render_objs = [self.body]
        self.calibrate()
        self.fit_scale(item.interior_px)

    def calibrate(self) -> None:
        bones = self.arm.data.bones
        tails = [bones[n].tail_local for n in rp.BULL_LOWER_LEG_BONES]
        self.sole_local = (sum(t[0] for t in tails) / 4, sum(t[1] for t in tails) / 4)
        self.ground_local = float(rl.mesh_points(self.body)[:, 2].min())
        forward = (bones["Head"].head_local[0] - bones["Torso"].head_local[0], bones["Head"].head_local[1] - bones["Torso"].head_local[1])
        facing = sp.facing_vectors(self.axes)
        self.yaws = {d: sp.yaw_to_face(forward, facing[d]) for d in sp.DIRECTIONS}
        self.forward = forward

    def place(self, yaw: float) -> None:
        s = self.scale
        rot = mathutils.Matrix.Rotation(math.radians(yaw), 2)
        shifted = rot @ Vector((self.sole_local[0] * s, self.sole_local[1] * s))
        self.arm.rotation_mode = "XYZ"
        self.arm.rotation_euler = (0.0, 0.0, math.radians(yaw))
        self.arm.scale = (s, s, s)
        self.arm.location = (-shifted.x, -shifted.y, -self.ground_local * s)
        bpy.context.view_layer.update()

    def set_pose(self, action: str, frame: float, facing: str) -> None:
        base.set_action(self.arm, action)
        base.go_to(self.scene, frame)
        self.arm.animation_data.action = None
        self.place(self.yaws[facing])

    def fit_scale(self, target_px: float) -> float:
        self.scale = 1.0
        self.set_pose("Idle", 0.0, "south")
        pts = rl.all_points(self.render_objs)
        extent_px = float(((pts @ np.array(self.axes.up)).max() - (pts @ np.array(self.axes.up)).min()) * rp.PPU)
        self.scale = rp.fit_scale(target_px, extent_px)
        self.fit_extent_px = extent_px
        return self.scale

    def poses(self):
        for clip in self.item.clips:
            action = bpy.data.actions[clip.action]
            frames = rp.sample_frames(*action.frame_range, clip.frames, clip.loop)
            for facing in clip.facings:
                for index, frame in enumerate(frames):
                    def apply(a=clip.action, f=frame, d=facing):
                        self.set_pose(a, f, d)

                    yield Pose(clip.id, facing, index, frame, apply)


def build_bull(args, scene, axes, cam, item, book):
    return Animal(args, item, scene, axes, cam, book)


# --- tree -------------------------------------------------------------------------------------------------------------

TREE_HEIGHT_M = 4.0
TREE_AMPLITUDE_M = 0.14


class Tree:
    def __init__(self, args, scene, axes, cam, item, book):
        self.scene, self.axes, self.cam, self.item, self.book = scene, axes, cam, item, book
        path = Path(args.models) / f"retro-render/models/kenney_nature-kit/Models/GLTF format/{args.tree}.glb"
        objs = rl.import_gltf(str(path))
        mesh = next(o for o in objs if o.type == "MESH")
        mesh.data.transform(mesh.matrix_world)
        mesh.parent = None
        mesh.matrix_world = mathutils.Matrix.Identity(4)
        for o in objs:
            if o is not mesh:
                bpy.data.objects.remove(o, do_unlink=True)
        co = np.empty(len(mesh.data.vertices) * 3, dtype=np.float64)
        mesh.data.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        co[:, 2] -= co[:, 2].min()  # base on the ground
        scale = TREE_HEIGHT_M / co[:, 2].max()
        co *= scale
        self.rest = co.copy()
        self.height = float(co[:, 2].max())
        mesh.data.vertices.foreach_set("co", co.reshape(-1))
        mesh.data.update()
        self.obj = mesh
        names = [m.name.lower() if m else "" for m in mesh.data.materials]
        roles = []
        for n in names:
            role = "trunk" if ("wood" in n or "bark" in n) else "leaf"
            roles.append(role)
        book.add_role("trunk", "soil", -0.3)
        book.add_role("leaf", "olive", -0.3)
        book.bind(mesh, roles)
        rl.set_ids(mesh, "foliage")
        self.name = args.tree

    def displaced(self, frame: float, frames: int) -> np.ndarray:
        x, y, z = self.rest[:, 0], self.rest[:, 1], self.rest[:, 2]
        h = self.height
        w = np.clip(z / h, 0.0, 1.0) ** 2.0
        p = 1 * wp.TWO_PI * frame / frames - 1.2 * (z / h)
        dx = TREE_AMPLITUDE_M * w * np.sin(p)
        dy = TREE_AMPLITUDE_M * w * 0.45 * np.sin(p + math.pi / 2)
        dz = np.where(z > 1e-6, -(dx * dx + dy * dy) / (2.0 * np.maximum(z, 1e-6)), 0.0)
        return self.rest + np.stack([dx, dy, dz], axis=1)

    def set_frame(self, frame: float, frames: int) -> None:
        co = self.displaced(frame, frames)
        self.obj.data.vertices.foreach_set("co", co.reshape(-1))
        self.obj.data.update()
        bpy.context.view_layer.update()

    def verify_vectorised(self) -> float:
        """Max difference between the numpy sway and the pure-Python `wind_plan.displacement` on a vertex sample."""
        worst = 0.0
        co = self.displaced(3.0, rp.TREE_FRAMES)
        for i in range(0, len(self.rest), max(1, len(self.rest) // 25)):
            x, y, z = self.rest[i]
            d = wp.displacement(x, y, z, self.height, 3.0, rp.TREE_FRAMES, TREE_AMPLITUDE_M, lag=1.2, cycles=1, swirl=0.45)
            worst = max(worst, max(abs(a - b) for a, b in zip(co[i] - self.rest[i], d, strict=True)))
        return worst

    def poses(self):
        clip = self.item.clips[0]
        for i in range(clip.frames):
            yield Pose("wind", "south", i, float(i), lambda i=i: self.set_frame(float(i), clip.frames))
        # the seam check frame: the duplicate endpoint (frame N), evaluated with the unreduced phase
        yield Pose("wind", "south", clip.frames, float(clip.frames), lambda: self.set_frame(float(clip.frames), clip.frames), {"seam": True})

    def objects(self):
        return [self.obj]


# --- footprint buildings --------------------------------------------------------------------------------------------


def tile_basis(axes) -> tuple[Vector, Vector, float]:
    """World directions of the tile +x and +y steps (screen down-right and down-left) and the world tile side."""
    right_xy, up_xy = (axes.right[0], axes.right[1]), (axes.up[0], axes.up[1])
    m = np.array([[right_xy[0], right_xy[1]], [-up_xy[0], -up_xy[1]]]) * rp.PPU
    ex = np.linalg.solve(m, np.array([tg.TILE_W / 2, tg.TILE_H / 2]))
    ey = np.linalg.solve(m, np.array([-tg.TILE_W / 2, tg.TILE_H / 2]))
    side = float(np.linalg.norm(ex))
    return Vector((ex[0] / side, ex[1] / side, 0.0)), Vector((ey[0] / side, ey[1] / side, 0.0)), side


def to_world(obj, ux: Vector, uy: Vector) -> None:
    """Rotate a mesh authored in tile-local coordinates (+X along tile x, +Y along tile y) into the world."""
    m = mathutils.Matrix(((ux.x, uy.x, 0.0, 0.0), (ux.y, uy.y, 0.0, 0.0), (0.0, 0.0, 1.0, 0.0), (0.0, 0.0, 0.0, 1.0)))
    obj.data.transform(m)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()


class Temple:
    """Peripteral temple from primitives: stylobate steps, columns, entablature, pediment and roof, a cella with a door."""

    def __init__(self, args, scene, axes, cam, item, book):
        self.scene, self.axes, self.cam, self.item, self.book = scene, axes, cam, item, book
        ux, uy, s = tile_basis(axes)
        self.side = s
        w, d = item.footprint
        W, D = w * s, d * s
        parts, roles = [], []

        def part(name: str, bm_builder, role: str, pid: str):
            bm = bmesh.new()
            bm_builder(bm)
            obj = rl.new_object(name, bm, smooth=False)
            to_world(obj, ux, uy)
            rl.set_ids(obj, pid)
            book.bind(obj, [role])
            parts.append(obj)

        step = 0.16
        inset = 0.30

        def steps(bm):
            rl.box(bm, (0, 0, step / 2), (W * 0.985, D * 0.985, step))
            rl.box(bm, (0, 0, step * 1.5), (W * 0.985 - 2 * inset, D * 0.985 - 2 * inset, step))
            rl.box(bm, (0, 0, step * 2.5), (W * 0.985 - 4 * inset * 0.8, D * 0.985 - 4 * inset * 0.8, step))

        part("stylobate", steps, "step", "stylobate")
        base_z = step * 3
        pw, pd = W * 0.985 - 4 * inset * 0.8 - 0.25, D * 0.985 - 4 * inset * 0.8 - 0.25
        col_h, col_r = 2.55, 0.17
        xs = [-pw / 2 + pw * i / 3 for i in range(4)]
        ys = [-pd / 2, 0.0, pd / 2]
        positions = [(x, y) for x in xs for y in (ys[0], ys[2])] + [(x, 0.0) for x in (xs[0], xs[3])]

        def columns(bm):
            for cx, cy in positions:
                rl.cylinder(bm, (cx, cy, base_z), col_r, 0.14, 10, 1.15)
                rl.cylinder(bm, (cx, cy, base_z + 0.14), col_r * 0.92, col_h - 0.14, 10, 0.88)
                rl.box(bm, (cx, cy, base_z + col_h + 0.07), (col_r * 3.0, col_r * 3.0, 0.14))

        part("columns", columns, "column", "column")
        top = base_z + col_h + 0.14
        arch_h, frieze_h, cornice_h = 0.26, 0.30, 0.10
        ow, od = pw + col_r * 2.0 + 0.1, pd + col_r * 2.0 + 0.1

        def entablature(bm):
            rl.box(bm, (0, 0, top + arch_h / 2), (ow, od, arch_h))
            rl.box(bm, (0, 0, top + arch_h + frieze_h / 2), (ow - 0.06, od - 0.06, frieze_h))
            rl.box(bm, (0, 0, top + arch_h + frieze_h + cornice_h / 2), (ow + 0.24, od + 0.24, cornice_h))

        part("entablature", entablature, "frieze", "entablature")
        roof_z = top + arch_h + frieze_h + cornice_h
        rise = 1.5
        half = (ow + 0.24) / 2

        def roof(bm):
            rl.prism_pediment(bm, -(od + 0.24) / 2, (od + 0.24) / 2, half, roof_z, rise)

        obj_faces = bmesh.new()
        roof(obj_faces)
        # end faces (normal along y) are the pediment, slopes are roof tiles
        roles_per_face, ids = [], []
        for f in obj_faces.faces:
            f.normal_update()
            ends = abs(f.normal.y) > 0.9
            f.material_index = 0 if ends else 1
            ids.append("pediment" if ends else "roof")
        pr = rl.new_object("roof", obj_faces, smooth=False)
        to_world(pr, ux, uy)
        rl.set_ids(pr, ids)
        book.bind(pr, ["tympanum", "tile"])
        parts.append(pr)

        cw, cd = pw - 0.5, pd - 0.2

        def cella(bm):
            rl.box(bm, (0, 0, base_z + col_h / 2), (cw, cd, col_h))

        part("cella", cella, "wall", "cella")
        door_w, door_h = 0.85, 1.7

        def door(bm):
            rl.box(bm, (0, cd / 2 + 0.01, base_z + door_h / 2), (door_w, 0.06, door_h))

        part("door", door, "door", "door")
        book.add_role("step", "stone-sky", 0.0)
        book.add_role("column", "marble", 0.1)
        book.add_role("frieze", "terracotta", 0.1)
        book.add_role("tympanum", "lapis", 0.0)
        book.add_role("tile", "terracotta", 0.0)
        book.add_role("wall", "cloud", 0.0)
        book.add_role("door", "lapis", -0.25)
        self.parts = parts
        self.dims = {"width_m": round(W, 3), "depth_m": round(D, 3), "top_m": round(roof_z + rise, 3), "columns": len(positions)}

    def poses(self):
        yield Pose("static", "south", 0, 0.0, lambda: None)

    def objects(self):
        return self.parts


class House:
    def __init__(self, args, scene, axes, cam, item, book):
        self.scene, self.axes, self.cam, self.item, self.book = scene, axes, cam, item, book
        ux, uy, s = tile_basis(axes)
        path = Path(args.models) / f"retro-render/models/Medieval Village Pack - Dec 2020-20261012T081001Z-1-001/Medieval Village Pack - Dec 2020/Buildings/OBJ/{args.house}.obj"
        objs = rl.import_obj(str(path))
        meshes = [o for o in objs if o.type == "MESH"]
        for o in meshes:
            o.data.transform(o.matrix_world)
            o.parent = None
            o.matrix_world = mathutils.Matrix.Identity(4)
        pts = np.vstack([np.array([v.co for v in o.data.vertices]) for o in meshes])
        lo, hi = pts.min(axis=0), pts.max(axis=0)
        target = min(item.footprint) * s * 0.92
        scale = float(target / max(hi[0] - lo[0], hi[1] - lo[1]))
        centre = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]])
        self.objs = meshes
        for o in meshes:
            for v in o.data.vertices:
                v.co = (v.co - Vector(centre)) * scale
            o.data.update()
            to_world(o, ux, uy)
            roles, ids = [], []
            for m in o.data.materials:
                n = (m.name if m else "").lower()
                rgb = rl.material_rgb(m)
                ramp = "terracotta" if "roof" in n else "soil" if ("wood" in n or "door" in n) else (pal.nearest_ramp(book.doc, rgb) if rgb else "bone")
                role = f"{rl.slug(n)}"
                book.add_role(role, ramp, 0.0)
                roles.append(role)
            book.bind(o, roles or ["wall"])
            mats = [m.name.lower() if m else "" for m in o.data.materials]
            ids = ["roof" if "roof" in mats[min(p.material_index, len(mats) - 1)] else "door" if "door" in mats[min(p.material_index, len(mats) - 1)] else "wall" for p in o.data.polygons] if mats else ["wall"] * len(o.data.polygons)
            rl.set_ids(o, ids)
        self.dims = {"scale": round(scale, 4), "size_m": [round(float((hi - lo)[i] * scale), 3) for i in range(3)], "materials": sorted({m.name for o in meshes for m in o.data.materials if m})}

    def poses(self):
        yield Pose("static", "south", 0, 0.0, lambda: None)

    def objects(self):
        return self.objs


class Tiles:
    """A 2:1 ground tile: a flagstone path on dirt, and a grass variant. Details stay inside the tile so neighbours lock."""

    def __init__(self, args, scene, axes, cam, item, book):
        self.scene, self.axes, self.cam, self.item, self.book = scene, axes, cam, item, book
        self.ux, self.uy, self.side = tile_basis(axes)
        s = self.side
        book.add_role("dirt", "soil", -0.28)
        for i, bias in enumerate((-0.4, -0.3, -0.2)):
            book.add_role(f"stone{i}", "stone-sky", bias)
        book.add_role("pebble", "soil", -0.5)
        book.add_role("grass", "olive", -0.4)
        book.add_role("tuft", "olive", -0.28)
        book.add_role("tuft_dark", "olive", -0.5)
        book.add_role("bloom", "pale-gold", -0.2)
        self.groups: dict[str, list] = {"path": [], "grass": []}
        self._ground("path", "dirt")
        self._flagstones()
        self._ground("grass", "grass")
        self._tufts()
        for objs in self.groups.values():
            for o in objs:
                o.hide_render = True

    def _obj(self, group: str, name: str, bm, role: str):
        obj = rl.new_object(name, bm, smooth=False)
        to_world(obj, self.ux, self.uy)
        rl.set_ids(obj, "ground")
        self.book.bind(obj, [role])
        self.groups[group].append(obj)
        return obj

    def _ground(self, group: str, role: str):
        bm = bmesh.new()
        rl.box(bm, (0, 0, -0.1), (self.side * 1.2, self.side * 1.2, 0.2))
        self._obj(group, f"{group}_base", bm, role)

    def _flagstones(self):
        rng = random.Random(7)
        s = self.side
        cell = s * 0.8 / 3
        for gx in range(3):
            for gy in range(3):
                if (gx + gy) % 2 == 1 and rng.random() < 0.25:
                    continue
                cx, cy = (gx - 1) * cell, (gy - 1) * cell
                w, d = cell * rng.uniform(0.74, 0.9), cell * rng.uniform(0.74, 0.9)
                cx += rng.uniform(-0.04, 0.04)
                cy += rng.uniform(-0.04, 0.04)
                bm = bmesh.new()
                rl.box(bm, (cx, cy, 0.035), (w, d, 0.07))
                self._obj("path", f"flag_{gx}{gy}", bm, f"stone{(gx * 3 + gy) % 3}")
        for i in range(7):
            bm = bmesh.new()
            rl.box(bm, (rng.uniform(-0.4, 0.4) * s, rng.uniform(-0.4, 0.4) * s, 0.015), (0.07, 0.07, 0.03))
            self._obj("path", f"pebble_{i}", bm, "pebble")

    def _tufts(self):
        rng = random.Random(11)
        s = self.side
        for i in range(16):
            cx, cy = rng.uniform(-0.38, 0.38) * s, rng.uniform(-0.38, 0.38) * s
            bm = bmesh.new()
            h = rng.uniform(0.12, 0.2)
            rl.cylinder(bm, (cx, cy, 0.0), 0.06, h, 4, 0.2)
            self._obj("grass", f"tuft_{i}", bm, "tuft" if i % 3 else "tuft_dark")
        for i in range(3):
            bm = bmesh.new()
            rl.box(bm, (rng.uniform(-0.3, 0.3) * s, rng.uniform(-0.3, 0.3) * s, 0.14), (0.06, 0.06, 0.06))
            self._obj("grass", f"bloom_{i}", bm, "bloom")

    def poses(self):
        for name in ("path", "grass"):
            def apply(n=name):
                for g, objs in self.groups.items():
                    for o in objs:
                        o.hide_render = g != n

            yield Pose(name, "south", 0, 0.0, apply)

    def objects(self):
        return [o for objs in self.groups.values() for o in objs]


# --- main ---------------------------------------------------------------------------------------------------------------


def main() -> int:
    args = parse_args()
    item = rp.ITEMS[args.item]
    started = time.perf_counter()
    scene, configured, axes = rl.fresh_scene()
    cam = rl.make_camera(scene, axes, item)
    palette_doc = json.loads(Path(args.palette).read_text())
    book = rl.MaterialBook(palette_doc, {}, item.cell)
    variants = [v for v in rp.VARIANTS if v.id in args.variants.split(",")]
    builders = {"zeus": build_zeus, "zeus-tall": build_zeus, "mortal": build_mortal, "bull": build_bull}
    if item.id in builders:
        subject = builders[item.id](args, scene, axes, cam, item, book)
    else:
        subject = {"tree": Tree, "temple": Temple, "house": House, "tile": Tiles}[item.id](args, scene, axes, cam, item, book)
    objs = subject.render_objs if isinstance(subject, (Character, Animal)) else subject.objects()
    out = Path(args.out) / item.id
    size = rp.render_size(item.cell)
    id_mat = zp.id_override_material()
    depth_mat = rl.depth_material(*item.depth_range)
    want_passes = item.overlap and not args.no_passes
    only = args.only.split(":") if args.only else None
    meta = {
        "item": item.id,
        "blender": {"version": bpy.app.version_string, "build_hash": bpy.app.build_hash.decode()},
        "cell": list(item.cell), "origin_px": list(item.origin_px), "pivot_px": list(item.pivot_px), "depth_range": list(item.depth_range),
        "ppu": rp.PPU, "variants": {v.id: v.label for v in variants},
        "palette": {"id": palette_doc["id"], "digest": palette_doc["derivedFrom"]["familiesDigest"]},
        "shading": {"band_starts": list(rp.BAND_STARTS), "band_shades": list(rp.BAND_SHADES), "sun": rp.SUN_STRENGTH, "ambient": rp.AMBIENT_STRENGTH, "dither_width": rp.DITHER_WIDTH},
        "frames": [], "timings_ms": {},
    }
    if isinstance(subject, Character):
        meta["character"] = {"scale": round(subject.scale, 5), "fit_extent_px_at_scale_1": round(subject.fit_extent_px, 3), "yaws": {k: round(v, 3) for k, v in subject.yaws.items()}, "profile": {"body_scale": list(subject.profile.body_scale), "bone_scales": {k: list(v) for k, v in rp.profile_bone_scales(subject.profile).items() if k in ("Head", "hand_l", "thigh_l")}, "limb_length": subject.profile.limb_length, "fist_deg": subject.profile.fist_deg, "hair": [h.file for h in hair_pieces(args, subject.profile)], "bun": subject.profile.bun is not None}, "interior_px": item.interior_px}
    if isinstance(subject, Animal):
        meta["animal"] = {"model": "Bull", "scale": round(subject.scale, 5), "fit_extent_px_at_scale_1": round(subject.fit_extent_px, 3), "forward_rig_xy": [round(v, 3) for v in subject.forward], "yaws": {k: round(v, 3) for k, v in subject.yaws.items()}, "interior_px": item.interior_px}
    if isinstance(subject, Tree):
        meta["tree"] = {"model": subject.name, "height_m": subject.height, "amplitude_m": TREE_AMPLITUDE_M, "vectorised_vs_pure_max_diff": subject.verify_vectorised(), "frames": rp.TREE_FRAMES}
    if hasattr(subject, "dims"):
        meta["dims"] = subject.dims
    totals: dict[str, float] = {}
    counts: dict[str, int] = {}

    def timed(key: str, ms: float) -> None:
        totals[key] = totals.get(key, 0.0) + ms
        counts[key] = counts.get(key, 0) + 1

    for pose in subject.poses():
        if only and (pose.clip, pose.facing, str(pose.index)) != tuple(only):
            continue
        pose.apply()
        name = rp.pose_name(item.id, pose.clip, pose.facing, pose.index)
        scene.render.resolution_x, scene.render.resolution_y = size
        bpy.context.view_layer.update()  # the camera's matrix must be current before it is queried
        o = world_to_camera_view(scene, cam, Vector((0, 0, 0)))
        entry = {
            "clip": pose.clip, "facing": pose.facing, "index": pose.index, "source_frame": pose.source_frame, "name": name,
            "anchor_px": [round(o.x * item.cell[0], 6), round((1 - o.y) * item.cell[1], 6)],
            "extent_px": rl.screen_extent_px([x for x in objs if not x.hide_render and x is not getattr(subject, "bolt", None)], axes, item),
            "files": {}, "render_ms": {}, **pose.extra,
        }
        if isinstance(subject, Character):
            entry["locators"] = subject.locator_facts()
        for v in variants:
            book.use(v)
            ms = rl.render_to(scene, out / v.id / f"{name}.{v.id}.png", size)
            entry["files"][v.id] = f"{v.id}/{name}.{v.id}.png"
            entry["render_ms"][v.id] = round(ms, 2)
            timed(v.id, ms)
        if want_passes:
            for kind, mat in (("id", id_mat), ("depth", depth_mat)):
                ms = rl.render_to(scene, out / kind / f"{name}.{kind}.png", size, mat)
                entry["files"][kind] = f"{kind}/{name}.{kind}.png"
                entry["render_ms"][kind] = round(ms, 2)
                timed(kind, ms)
        meta["frames"].append(entry)
    meta["timings_ms"] = {k: {"total": round(totals[k], 1), "images": counts[k], "mean": round(totals[k] / counts[k], 2)} for k in totals}
    meta["timings_ms"]["wall_clock_total"] = round((time.perf_counter() - started) * 1000.0, 1)
    rl.write_json(out / "meta.json", meta)
    print(json.dumps({"item": item.id, "poses": len(meta["frames"]), "timings_ms": meta["timings_ms"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())

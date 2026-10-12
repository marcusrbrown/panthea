# SPDX-License-Identifier: GPL-3.0-or-later
"""Blender-side entry point of the studio-render probe (U1). Run by the Bun driver, never by hand:

    Blender --background --factory-startup --python-exit-code 1 --python probe_render.py -- --mode MODE [args]

Modes:
  slot      render one Zeus slot (all frames, colour + part-ID + depth) by driving the retro-render probe's own render_retro.main()
  gpu       create the EEVEE context by rendering one 8x8 frame; exit 0, or 10 when no context can be created
  terminal  report whether the process has a terminal and what its process group looks like
  clips     measure animation-library clip loops (first-to-last pose displacement) on the animation library rig
  read      try to open one file and report the result (a sanity probe for the sandbox observation)
  version   report bpy.app.version_string and build hash

Exit codes (the shape the render engine's script contract will need): 0 ok, 10 no GPU context, 11 version or build mismatch, 12 input error.
Anything else (a Python exception) exits 1 through --python-exit-code.
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import os
import resource
import sys
import time
from pathlib import Path

T0 = time.time()
sys.dont_write_bytecode = True

import bpy  # noqa: E402

HERE = Path(__file__).resolve().parent
RETRO = HERE.parents[1] / "retro-render"

EXIT_OK, EXIT_NO_GPU, EXIT_VERSION, EXIT_INPUT = 0, 10, 11, 12
PPU = 29.0788
WALK16_FRAMES = 16


class InputError(Exception):
    """A kit file is missing, unreadable or refers outside the staging directory."""


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="probe_render.py")
    ap.add_argument("--mode", required=True, choices=("slot", "gpu", "terminal", "clips", "read", "version"))
    ap.add_argument("--models", default="", help="directory laid out like the main checkout's tools/probes (the kit root)")
    ap.add_argument("--out", default="", help="directory this run writes into")
    ap.add_argument("--clip", default="walk16", help="clip id of the slot (walk16, idle, cast, or seated)")
    ap.add_argument("--facing", default="south")
    ap.add_argument("--item", default="zeus-tall")
    ap.add_argument("--extra-clip", default="", help="id:action:frames:loop|once, a clip added to the item (used for the seated clip)")
    ap.add_argument("--depth16", action="store_true", help="also write each depth frame as a 16-bit greyscale PNG next to the 8-bit one")
    ap.add_argument("--expect-version", default="5.2.2")
    ap.add_argument("--expect-build", default="d13f752e3b9c")
    ap.add_argument("--path", default="", help="read mode: the file to try to open")
    return ap.parse_args(argv)


def terminal_facts() -> dict:
    facts: dict = {"stdin_tty": os.isatty(0), "stdout_tty": os.isatty(1), "stderr_tty": os.isatty(2)}
    try:
        fd = os.open("/dev/tty", os.O_RDWR)
        os.close(fd)
        facts["dev_tty_opens"] = True
    except OSError as e:
        facts["dev_tty_opens"] = False
        facts["dev_tty_error"] = e.strerror
    facts.update(pid=os.getpid(), ppid=os.getppid(), pgid=os.getpgrp(), sid=os.getsid(0), leads_group=os.getpgrp() == os.getpid())
    facts["env_names"] = sorted(os.environ)
    return facts


def pin_facts() -> dict:
    return {
        "version_string": bpy.app.version_string,
        "build_hash": bpy.app.build_hash.decode(),
        "build_date": bpy.app.build_date.decode(),
        "build_time": bpy.app.build_time.decode(),
        "background": bool(bpy.app.background),
    }


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=1) + "\n")
    tmp.replace(path)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def gpu_context_probe() -> dict:
    """Create the EEVEE context by rendering one tiny frame. Raises on failure; the caller maps that to exit 10."""
    started = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 8
    scene.render.resolution_percentage = 100
    cam = bpy.data.objects.new("probe-cam", bpy.data.cameras.new("probe-cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    bpy.ops.render.render(write_still=False)
    info: dict = {"engine": scene.render.engine, "render_s": round(time.time() - started, 3)}
    try:
        import gpu

        info["gpu_backend"] = gpu.platform.backend_type_get()
        info["gpu_renderer"] = gpu.platform.renderer_get()
        info["gpu_vendor"] = gpu.platform.vendor_get()
        info["gpu_version"] = gpu.platform.version_get()
    except Exception as e:  # reported, not fatal: the render itself already succeeded
        info["gpu_info_error"] = repr(e)
    return info


def rusage_v4() -> dict:
    """This process's own kernel footprint figures (proc_pid_rusage, flavor 4), which do not depend on any sampling tick."""
    import ctypes

    mib = 1024 * 1024
    buf = (ctypes.c_uint64 * 64)()
    libc = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
    status = libc.proc_pid_rusage(os.getpid(), 4, ctypes.byref(buf))
    if status != 0:
        return {"error": f"proc_pid_rusage returned {status}"}
    return {
        "phys_footprint_mib": round(buf[9] / mib, 2),  # ri_phys_footprint (word 9; words 0-1 are the uuid)
        "lifetime_max_phys_footprint_mib": round(buf[30] / mib, 2),  # ri_lifetime_max_phys_footprint
        "ru_maxrss_mib": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / mib, 2),  # bytes on macOS
    }


def check_pin(args, facts: dict) -> None:
    if not facts["version_string"].startswith(args.expect_version) or facts["build_hash"] != args.expect_build:
        print(f"PROBE version mismatch: got {facts['version_string']!r} {facts['build_hash']!r}", flush=True)
        sys.exit(EXIT_VERSION)


# --- slot mode ------------------------------------------------------------------------------------------------------------


def required_kit_files(models: Path) -> list[Path]:
    """The files the Zeus recipe imports, through the retro-render probe's own path functions."""
    sys.path.insert(0, str(RETRO))
    import retro_assets as assets
    import retro_plan as rp

    files = [models / assets.character_gltf("zeus"), models / assets.UAL]
    files += [models / assets.hair_gltf(p.file) for p in rp.PROFILES["zeus"].hair]
    out = []
    for f in files:
        out.append(f)
        companion = assets.companions(str(f.relative_to(models)))
        out += [models / c for c in companion]
    return out


def restrict_item(args) -> None:
    import retro_plan as rp

    item = rp.ITEMS[args.item]
    clips = list(item.clips)
    if args.extra_clip:
        cid, action, frames, mode = args.extra_clip.split(":")
        clips.append(rp.Clip(cid, action, int(frames), rp._split(1000, int(frames)), loop=(mode == "loop")))
    chosen = [dataclasses.replace(c, facings=(args.facing,)) for c in clips if c.id == args.clip]
    if len(chosen) != 1:
        raise InputError(f"clip {args.clip!r} is not one of {[c.id for c in clips]}")
    rp.ITEMS[args.item] = dataclasses.replace(item, clips=tuple(chosen))


def install_hooks(args, timeline: dict) -> None:
    import retro_lib as rl

    original_import = rl.import_gltf
    original_render = rl.render_to
    renders = timeline.setdefault("renders", [])

    def import_gltf(path: str):
        try:
            return original_import(path)
        except RuntimeError as e:
            raise InputError(f"glTF import failed for {Path(path).name}: {e}") from e

    def render_to(scene, path: Path, size, override=None):
        ms = original_render(scene, path, size, override)
        now = time.time()
        renders.append({"file": path.name, "ms": round(ms, 2), "epoch": now})
        timeline.setdefault("first_render_epoch", now)
        if str(path).endswith(".toon.png"):
            timeline.setdefault("first_colour_epoch", now)
        if args.depth16 and str(path).endswith(".depth.png"):
            fmt = scene.render.image_settings
            before = (fmt.color_mode, fmt.color_depth)
            fmt.color_mode, fmt.color_depth = "BW", "16"
            original_render(scene, path.with_name(path.name.replace(".depth.png", ".depth16.png")), size, override)
            fmt.color_mode, fmt.color_depth = before
        return ms

    rl.import_gltf = import_gltf
    rl.render_to = render_to


def run_slot(args, start: dict) -> int:
    models = Path(args.models)
    out = Path(args.out)
    missing = [str(f.relative_to(models)) for f in required_kit_files(models) if not f.is_file()]
    if missing:
        print(f"PROBE input error: missing kit files: {missing}", flush=True)
        return EXIT_INPUT
    restrict_item(args)
    timeline: dict = {"t_script_start": T0}
    install_hooks(args, timeline)
    import render_retro

    argv_before = sys.argv
    render_args = ["--item", args.item, "--models", str(models), "--out", str(out / "render"), "--variants", "toon"]
    sys.argv = [argv_before[0], "--", *render_args]
    timeline["t_main_start"] = time.time()
    try:
        code = render_retro.main()
    except InputError as e:
        print(f"PROBE input error: {e}", flush=True)
        return EXIT_INPUT
    finally:
        sys.argv = argv_before
    timeline["t_main_end"] = time.time()
    root = out / "render" / args.item
    meta = json.loads((root / "meta.json").read_text())
    files = sorted(p for p in root.rglob("*.png"))
    done = {
        "frames": len(meta["frames"]),
        "files": {str(p.relative_to(root)): sha256_file(p) for p in files},
        "extent_px": [f["extent_px"] for f in meta["frames"]],
    }
    write_json(out / "probe-done.json", done)
    write_json(out / "probe-timeline.json", timeline)
    return code


# --- clips mode -----------------------------------------------------------------------------------------------------------


def run_clips(args) -> int:
    models = Path(args.models)
    sys.path.insert(0, str(RETRO))
    import retro_assets as assets

    ual = models / assets.UAL
    if not ual.is_file():
        print(f"PROBE input error: missing {ual.name}", flush=True)
        return EXIT_INPUT
    bpy.ops.wm.read_factory_settings(use_empty=True)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(ual))
    arm = next(o for o in bpy.data.objects if o not in before and o.type == "ARMATURE")
    scene = bpy.context.scene
    arm.animation_data_create()
    report: dict = {"actions": sorted(a.name for a in bpy.data.actions), "clips": {}}

    def pose(action, frame: float) -> dict:
        arm.animation_data.action = action
        scene.frame_set(int(frame), subframe=frame - int(frame))
        bpy.context.view_layer.update()
        return {b.name: tuple(b.head) for b in arm.pose.bones}

    def displacement(a: dict, b: dict) -> tuple[float, str]:
        worst, name = 0.0, ""
        for bone, pa in a.items():
            d = sum((x - y) ** 2 for x, y in zip(pa, b[bone], strict=True)) ** 0.5
            if d > worst:
                worst, name = d, bone
        return worst, name

    for name in ("Idle_Loop", "Walk_Loop", "Sitting_Idle_Loop", "Sitting_Enter", "Sitting_Exit", "Sitting_Talking_Loop"):
        action = bpy.data.actions.get(name)
        if action is None:
            report["clips"][name] = {"present": False}
            continue
        start, end = action.frame_range
        first, last, mid = pose(action, start), pose(action, end), pose(action, (start + end) / 2)
        loop_m, loop_bone = displacement(first, last)
        mid_m, mid_bone = displacement(first, mid)
        report["clips"][name] = {
            "present": True,
            "frame_range": [start, end],
            "first_to_last_m": round(loop_m, 5),
            "first_to_last_bone": loop_bone,
            "first_to_last_px": round(loop_m * PPU, 3),
            "first_to_mid_m": round(mid_m, 5),
            "first_to_mid_bone": mid_bone,
        }
    write_json(Path(args.out) / "clips.json", report)
    print("PROBE clips ok", flush=True)
    return EXIT_OK


# --- main -----------------------------------------------------------------------------------------------------------------


def main() -> int:
    args = parse_args()
    out = Path(args.out) if args.out else None
    start = {"t_script_start": T0, "mode": args.mode, "terminal": terminal_facts(), "pin": pin_facts()}
    if out is not None:
        write_json(out / "probe-start.json", start)
    print("PROBE start", json.dumps({k: start[k] for k in ("mode", "pin")}), flush=True)
    check_pin(args, start["pin"])

    if args.mode == "version":
        return EXIT_OK
    if args.mode == "terminal":
        if out is not None:
            write_json(out / "probe-meta.json", start)
        return EXIT_OK
    if args.mode == "read":
        try:
            with open(args.path, "rb") as f:
                n = len(f.read(16))
            print(f"PROBE read ok {n} bytes", flush=True)
        except OSError as e:
            print(f"PROBE read failed: {e.strerror}", flush=True)
        return EXIT_OK
    if args.mode == "clips":
        return run_clips(args)

    try:
        gpu_info = gpu_context_probe()
    except Exception as e:
        print(f"PROBE no GPU context: {e!r}", flush=True)
        return EXIT_NO_GPU
    start["gpu"] = gpu_info
    print("PROBE gpu", json.dumps(gpu_info), flush=True)
    if args.mode == "gpu":
        if out is not None:
            write_json(out / "probe-meta.json", start)
        return EXIT_OK

    code = run_slot(args, start)
    repo = str(HERE.parents[3])
    start["repo_files_loaded"] = sorted(  # the repo scripts this run imported, for the sandbox allow-list
        os.path.relpath(m.__file__, repo) for m in list(sys.modules.values()) if str(getattr(m, "__file__", None) or "").startswith(repo)
    )
    try:
        start["rusage"] = rusage_v4()
    except Exception as e:  # reported, not fatal
        start["rusage"] = {"error": repr(e)}
    start["t_end"] = time.time()
    if out is not None:
        write_json(out / "probe-meta.json", start)
    return code


if __name__ == "__main__":
    sys.exit(main())

"""Writes the studio's Zeus stamp set (tools/render/stamps/) from the probe's authored stamps (retro build-out U5).

    python3 tools/probes/retro-render/export_stamp_set.py --out tools/render/stamps

The eight bolt orientations are copied byte for byte from tools/probes/blender-sprite/stamps/. The face stamps are `stamp_plan.FACE`
(eye pixel plus brow offsets per facing) written out as small PNGs: the eye pixel is the stamp's anchor, so a stamp is placed by the
projected eye locator's pixel minus the anchor. Eye and brow colours are the first shade of the `greek-retro` lapis and marble ramps,
the pair `stamp_plan.FACE_COLOURS` gives Zeus. `stamps.json` records every file's size, anchor and sha256, which `validate:assets`
checks. Standard library plus the probe's modules (the PNG writer needs ffmpeg).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
sys.path.insert(0, str(REPO / "tools/probes/art-edit"))
sys.path.insert(0, str(REPO / "tools/probes/blender-sprite"))
sys.path.insert(0, str(ROOT))

import stamp_plan as stp  # noqa: E402
from pipeline import Raster, encode_png  # noqa: E402

BOLT_SOURCE = REPO / "tools/probes/blender-sprite/stamps"
PALETTE = REPO / "content/greek/palette/greek-retro/palette.json"
SET_ID = "zeus"
EYE_RAMP, BROW_RAMP = "lapis", "marble"  # shade 0 of each, see stamp_plan.FACE_COLOURS["zeus-tall"]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def hex_rgb(value: str) -> tuple[int, int, int]:
    return (int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16))


def ramp_first(doc: dict, ramp_id: str) -> tuple[int, int, int]:
    ramp = next(r for f in doc["families"] for r in f["ramps"] if r["id"] == ramp_id)
    return hex_rgb(ramp["shades"][0])


def face_raster(spec_brows: tuple, eye: tuple, brow: tuple) -> tuple[Raster, tuple[int, int]]:
    """A raster holding the eye at offset (0, 0) and the brow offsets; returns it and the eye's position in it."""
    offsets = [(0, 0), *spec_brows]
    min_x, min_y = min(o[0] for o in offsets), min(o[1] for o in offsets)
    width, height = max(o[0] for o in offsets) - min_x + 1, max(o[1] for o in offsets) - min_y + 1
    rgba = bytearray(width * height * 4)
    for (dx, dy), colour in zip(offsets, (eye, *[brow] * len(spec_brows)), strict=True):
        at = ((dy - min_y) * width + (dx - min_x)) * 4
        rgba[at : at + 4] = bytes((*colour, 255))
    return Raster(width, height, bytes(rgba)), (-min_x, -min_y)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    out = Path(args.out) / SET_ID
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    doc = json.loads(PALETTE.read_text())
    eye, brow = ramp_first(doc, EYE_RAMP), ramp_first(doc, BROW_RAMP)

    info = json.loads((BOLT_SOURCE / "bolt-stamps.json").read_text())
    bolt = []
    for v in info["variants"]:
        shutil.copyfile(BOLT_SOURCE / v["file"], out / v["file"])
        bolt.append({"angle": v["angle_deg"], "file": f"{SET_ID}/{v['file']}", "sha256": sha256(out / v["file"]), "size": v["size"], "anchor": v["anchor"]})

    face = []
    for facing, spec in stp.FACE.items():
        for slot in spec["eyes"]:
            raster, anchor = face_raster(spec["brow"][slot], eye, brow)
            name = f"face-{facing}-{slot}.png"
            encode_png(raster, out / name)
            face.append({"facing": facing, "slot": slot, "file": f"{SET_ID}/{name}", "sha256": sha256(out / name), "size": [raster.width, raster.height], "anchor": list(anchor)})

    document = {
        "schemaVersion": 1,
        "sets": [{"id": SET_ID, "palette": "greek-retro", "bolt": {"outline": info["palette"]["dark"], "variants": bolt}, "face": {"variants": face}}],
    }
    (Path(args.out) / "stamps.json").write_text(json.dumps(document, indent=2) + "\n")
    print(f"wrote {len(bolt)} bolt and {len(face)} face stamps to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

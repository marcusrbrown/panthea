"""Exports the TypeScript post step's parity fixture from the probe's own post step (retro build-out U5).

    python3 tools/probes/retro-render/export_parity_fixture.py \
        --scratch /path/to/tools/probes/retro-render/scratch --tag r3 --item zeus-tall --clip cast --facing west

Runs `postprocess_retro.process_item` unmodified, over one slot (a clip and a facing) of an existing `render_retro.py` run, with the
palette read from a palette directory instead of the probe's scene palette. The Python post step snaps to the palette in the order the
palette lists its colours, and a mode tie goes to the earliest colour, so the palette order is part of the result; the studio flattens
`greek-retro` (families in file order, first occurrence wins) and this script does the same. It writes, under `--out`:

    frames/<name>.{colour,id,depth}.png   the probe's raw 4x passes, byte for byte
    frames.json                           slot settings and the stamp locators, in the shape the TypeScript step reads
    expected/<name>.png                   the probe's cells
    expected.json                         per-cell facts and decoded-pixel hashes, and the slot envelope
    palette/                              a copy of the palette directory it used

The decoded-pixel hash is sha256 of "<w>x<h>:" followed by the RGBA bytes with the RGB of alpha-0 pixels zeroed. The probe's own post
step is not changed and not imported by the studio. Standard library plus the probe's modules (which need ffmpeg to read and write PNGs).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import postprocess_retro as pr  # noqa: E402  (also puts the probe's helper modules on sys.path)
import shadow_plan as sh  # noqa: E402
from pipeline import decode_png  # noqa: E402
from sprite_downscale import Palette  # noqa: E402

DEFAULT_PALETTE = ROOT.parents[2] / "content/greek/palette/greek-retro"


def hex_rgb(value: str) -> tuple[int, int, int]:
    return (int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16))


def flatten_palette(doc: dict) -> Palette:
    """Every family in file order; a colour keeps the ramp that lists it first; a ramp's darkest shade is its lowest OKLab lightness."""
    colours: list = []
    ramp_of: dict = {}
    darkest: dict = {}
    for family in doc["families"]:
        for ramp in family["ramps"]:
            shades = [hex_rgb(s) for s in ramp["shades"]]
            darkest.setdefault(ramp["id"], min(shades, key=lambda c: pr.oklab(c)[0]))
            for shade in shades:
                if shade not in ramp_of:
                    colours.append(shade)
                    ramp_of[shade] = ramp["id"]
    return Palette(tuple(colours), ramp_of, darkest)


def pixel_hash(width: int, height: int, rgba: bytes) -> str:
    canonical = bytearray(rgba)
    for at in range(0, len(canonical), 4):
        if canonical[at + 3] == 0:
            canonical[at : at + 3] = b"\x00\x00\x00"
    return hashlib.sha256(f"{width}x{height}:".encode() + bytes(canonical)).hexdigest()


def locators_of(entry: dict) -> dict:
    loc = entry["locators"]
    out: dict = {}
    if "bolt" in loc:
        b = loc["bolt"]
        out["bolt"] = {"basePx": b["base_px"], "tipPx": b["tip_px"], "baseDepth": b["base_depth"]}
    eyes = {k[-1]: {"px": loc[k]["px"], "depth": loc[k]["depth"]} for k in ("eyes_l", "eyes_r") if k in loc}
    if eyes:
        out["eyes"] = eyes
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scratch", required=True, help="the probe scratch directory holding render-<tag>/<item>/")
    ap.add_argument("--tag", default="r3")
    ap.add_argument("--item", default="zeus-tall")
    ap.add_argument("--clip", default="cast")
    ap.add_argument("--facing", default="west")
    ap.add_argument("--palette", default=str(DEFAULT_PALETTE), help="a palette directory (palette.json, master.gpl, master.hex)")
    ap.add_argument("--drop-bolt", action="store_true", help="remove the bolt locator from every frame, so the probe's own post step makes cells with no bolt stamp (the studio has no prop stamps)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--work", default=str(ROOT / "scratch/fixture-run"), help="where the probe writes its cells (inside the repository)")
    args = ap.parse_args()

    scratch, out, palette_dir, work = Path(args.scratch), Path(args.out), Path(args.palette), Path(args.work)
    source = scratch / f"render-{args.tag}" / args.item
    meta = json.loads((source / "meta.json").read_text())
    frames = [f for f in meta["frames"] if f["clip"] == args.clip and f["facing"] == args.facing]
    if not frames:
        print(f"no frames for {args.clip}/{args.facing} in {source}", file=sys.stderr)
        return 1
    frames.sort(key=lambda f: f["index"])
    if args.drop_bolt:
        frames = [{**f, "locators": {k: v for k, v in f["locators"].items() if k != "bolt"}} for f in frames]

    # The probe reads one meta.json and the pass files next to it: give it a directory holding just this slot.
    render_dir, cells_dir = work / "render", work / "cells"
    for stale in (render_dir, cells_dir):
        shutil.rmtree(stale, ignore_errors=True)
    item_dir = render_dir / args.item
    item_dir.mkdir(parents=True)
    for sub in ("toon", "id", "depth"):
        (item_dir / sub).symlink_to(source / sub)
    (item_dir / "meta.json").write_text(json.dumps({**meta, "frames": frames}))

    palette_doc = json.loads((palette_dir / "palette.json").read_text())
    palette = flatten_palette(palette_doc)
    done = pr.process_item(args.item, render_dir, cells_dir, palette, palette_doc)
    item = done["item"]

    (out / "frames").mkdir(parents=True, exist_ok=True)
    (out / "expected").mkdir(parents=True, exist_ok=True)
    (out / "palette").mkdir(parents=True, exist_ok=True)
    for name in ("palette.json", "master.gpl", "master.hex"):
        shutil.copyfile(palette_dir / name, out / "palette" / name)

    colour_ramp, colour_shade = pr.SHADOW_RAMP, pr.SHADOW_SHADE
    slot = {
        "item": args.item,
        "slot": f"{args.clip}/{args.facing}",
        "cell": list(item.cell),
        "originPx": list(item.origin_px),
        "pivotPx": list(item.pivot_px),
        "depthRange": list(item.depth_range),
        "overlapThresholdM": pr.OVERLAP_THRESHOLD_M[item.kind],
        "shadow": {"rx": item.shadow[0], "ry": item.shadow[1], "ramp": colour_ramp, "shade": colour_shade},
        "frames": [],
    }
    expected = []
    boxes = []
    for entry, fact in zip(frames, done["facts"], strict=True):
        name = entry["name"]
        for role, key in (("colour", "toon"), ("id", "id"), ("depth", "depth")):
            shutil.copyfile(source / entry["files"][key], out / "frames" / f"{name}.{role}.png")
        cell_path = cells_dir / args.item / "toon" / f"{name}.png"
        shutil.copyfile(cell_path, out / "expected" / f"{name}.png")
        cell = decode_png(cell_path)
        slot["frames"].append({"name": name, "facing": entry["facing"], "locators": locators_of(entry)})
        boxes.append(tuple(fact["box"]))
        expected.append(
            {
                "name": name,
                "pixelHash": pixel_hash(cell.width, cell.height, cell.rgba),
                "height": fact["height"], "width": fact["width"], "bottomRow": fact["bottom_row"],
                "colours": fact["colours"], "outsidePalette": fact["outside_palette"],
                "coloursFigure": fact["colours_figure"], "outsidePaletteFigure": fact["outside_palette_figure"],
                "outline": fact["outline"], "binaryAlpha": fact["binary_alpha"],
                "box": fact["box"], "overlapPx": fact["overlap_px"], "unknownIdPx": fact["unknown_id_px"],
                "stamps": fact["stamps"],
            }
        )
    envelope = sh.envelope(boxes, item.pivot_px, item.cell)
    (out / "frames.json").write_text(json.dumps(slot, indent=1) + "\n")
    (out / "expected.json").write_text(
        json.dumps({"envelope": {k: envelope[k] for k in ("left", "right", "up", "down", "margin", "min_margin")}, "cells": expected}, indent=1) + "\n"
    )

    # Reproduction check against the cells the probe wrote with its own palette order, when the tag has them.
    probe_cells = scratch / f"cells-{args.tag}" / args.item / "toon"
    if probe_cells.exists():
        same = [e["name"] for e in expected if (probe_cells / f"{e['name']}.png").exists()
                and pixel_hash(*(lambda c: (c.width, c.height, c.rgba))(decode_png(probe_cells / f"{e['name']}.png"))) == e["pixelHash"]]
        print(f"identical to the probe's {probe_cells.name} cells: {len(same)}/{len(expected)}")
    print(f"wrote {len(expected)} cells to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

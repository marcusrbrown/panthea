"""Phase A driver: key, downscale at any ratio onto the Olympus palette, outline, place, conform, sheet.

Run with the probe venv's interpreter so the unfake comparison is available:
    tools/probes/art-edit/.venv/bin/python tools/probes/art-edit/run_sprite_downscale.py
No model runs; every input is an already-generated image.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pipeline import Raster, decode_png, encode_png
from sprite_downscale import (
    OUTLINE_PX,
    add_outline,
    downscale_figure,
    drop_specks,
    foreground_bbox,
    key_foreground,
    load_palette,
    measure,
    place_feet,
)
from sprite_sheet import contact_sheet, enlarge

REPO = Path(__file__).resolve().parents[3]
STORE_BLOBS = REPO / ".context/studio-pipeline/u7-creative/studio/blobs"
EDIT_OUTPUTS = REPO / ".context/studio-pipeline/art-edit/outputs"
OUT = REPO / ".context/studio-pipeline/sprite-downscale"
PALETTE_JSON = REPO / "content/greek/palette/palette.json"

HEIGHTS = (50, 54, 56)
SPECK_FRACTION = 0.001

SOURCES = [
    {
        "id": "zimage-r4c-0001",
        "label": "Z-Image r4c candidate 0001, seed 20261033, 512x640",
        "path": STORE_BLOBS / "f7f548b015690f98c02418c03ac21c6d349f3c1a5fe1d7275a3e2027bcf3779c.png",
        "tolerance": 24,
    },
    {
        "id": "sdxl-b2-r1-20261007",
        "label": "SDXL + pixel-art-xl B2 round 1, seed 20261007, 1024x1280",
        "path": EDIT_OUTPUTS / "b2-sdxl-20261007.png",
        "tolerance": 16,
    },
    {
        "id": "sdxl-b2-r2-20261007",
        "label": "SDXL + pixel-art-xl B2 round 2 base, seed 20261007, 512x640",
        "path": EDIT_OUTPUTS / "b2-r2-base-20261007.png",
        "tolerance": 16,
    },
    {
        "id": "zimage-r8-s075-20261023",
        "label": "Z-Image r8 full mask strength 0.75, seed 20261023, 512x640",
        "path": STORE_BLOBS / "db95d09f58f358038eb179193a58c5da8b6419b2b7156317fe0aaafa6c4343fb.png",
        "tolerance": 135,
    },
]

METHODS = [
    ("A", "area-average, snap to palette"),
    ("K", "k-centroid (k=3), dominant cluster, snap"),
    ("M", "mode of palette-snapped pixels"),
    ("C", "unfake content-adaptive at the same target size, fixed palette"),
    ("D", "unfake dominant at the nearest whole-number block, fixed palette"),
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def keyed_preview(source: Raster) -> Raster:
    out = bytearray(source.rgba)
    for at in range(0, len(out), 4):
        if out[at + 3]:
            out[at + 3] = 255
        else:
            out[at : at + 4] = bytes((255, 0, 255, 255))
    return Raster(source.width, source.height, bytes(out))


def figure_for(source_spec: dict) -> tuple[Raster, dict]:
    original = decode_png(source_spec["path"])
    keyed, key = key_foreground(original, source_spec["tolerance"])
    keyed, dropped = drop_specks(keyed, SPECK_FRACTION)
    bbox = foreground_bbox(keyed)
    facts = {
        "size": [original.width, original.height],
        "key_rgb": list(key),
        "key_tolerance": source_spec["tolerance"],
        "specks_dropped": dropped,
        "figure_bbox": list(bbox),
        "figure_height": bbox[3] - bbox[1],
        "figure_width": bbox[2] - bbox[0],
        "touches_bottom_edge": bbox[3] == original.height,
    }
    return keyed, facts


def build_cell(keyed: Raster, bbox, method: str, total_height: int, palette):
    interior = total_height - OUTLINE_PX
    notes: dict = {}
    if method in "AKM":
        name = {"A": "area", "K": "kcentroid", "M": "mode"}[method]
        figure = downscale_figure(keyed, name, interior, palette, bbox)
    else:
        import unfake_compare

        fn = unfake_compare.content_adaptive if method == "C" else unfake_compare.block_dominant
        figure, notes = fn(keyed, bbox, interior, palette)
    placed = place_feet(figure)
    return add_outline(placed, palette), placed, notes


def conform(paths: list[Path]) -> dict:
    result = subprocess.run(
        ["bun", str(Path(__file__).parent / "conform_report.ts"), *map(str, paths)],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def main() -> int:
    palette = load_palette(PALETTE_JSON)
    (OUT / "cells").mkdir(parents=True, exist_ok=True)
    (OUT / "keyed").mkdir(parents=True, exist_ok=True)
    rows: list[list[tuple[str, Raster]]] = []
    results = []
    sources_facts = {}
    for spec in SOURCES:
        keyed, facts = figure_for(spec)
        facts["sha256"] = sha256(spec["path"])
        facts["label"] = spec["label"]
        sources_facts[spec["id"]] = facts
        encode_png(keyed_preview(keyed), OUT / "keyed" / f"{spec['id']}.png")
        bbox = tuple(facts["figure_bbox"])
        row = []
        for code, _ in METHODS:
            for height in HEIGHTS:
                cell, interior, notes = build_cell(keyed, bbox, code, height, palette)
                path = OUT / "cells" / spec["id"] / f"{code}{height}.png"
                encode_png(cell, path)
                measured = measure(cell, palette, interior)
                measured.pop("palette_entries")
                results.append(
                    {"source": spec["id"], "method": code, "target_height": height, "file": str(path.relative_to(REPO)),
                     "notes": notes, **measured}
                )
                row.append((f"{code}{height}", cell))
                print(spec["id"], code, height, measured["height"], measured["colours"], flush=True)
        rows.append(row)
    report = conform([REPO / r["file"] for r in results])
    for entry in results:
        verdict = report[str(REPO / entry["file"])]
        entry["conform"] = verdict["status"]
        entry["conform_failed"] = [
            f"{c['check']}: {c['message']}" for c in verdict.get("checks", []) if c["status"] != "pass"
        ]
        entry["conform_pixels_changed"] = verdict.get("pixelsChanged")
    sheet = contact_sheet(rows, [f"S{i + 1}" for i in range(len(rows))])
    encode_png(sheet, OUT / "contact-1x.png")
    encode_png(enlarge(sheet, 4), OUT / "contact-4x.png")
    legend = ["# Sprite downscale, Phase A: contact sheet legend", "", "Rows (S1..S4), top to bottom:", ""]
    legend += [f"- S{i + 1}: {s['label']} (sha256 {sources_facts[s['id']]['sha256']})" for i, s in enumerate(SOURCES)]
    legend += ["", "Columns, left to right: method letter + total figure height with outline, in pixels.", ""]
    legend += [f"- {code}: {text}" for code, text in METHODS]
    legend += ["", f"Heights: {', '.join(map(str, HEIGHTS))}. Each method appears at each height in that order."]
    (OUT / "legend.md").write_text("\n".join(legend) + "\n")
    (OUT / "results.json").write_text(json.dumps({"sources": sources_facts, "tiles": results}, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Checks that walk[i] equals walk16[2i] pixel for pixel, at identical source times, for every facing of every character.

    python3 tools/probes/retro-render/check_resample.py --tag r2     # RED on the round-2 cells (the bug)
    python3 tools/probes/retro-render/check_resample.py --tag r3     # GREEN on the fixed cells (needs postprocess --tag r3 first)

Exit status 1 when any pair differs. Writes scratch/report/retro-<tag>-resample-check.json.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
sys.path.insert(0, str(REPO / "tools/probes/art-edit"))
sys.path.insert(0, str(ROOT))

import retro_metrics as rm  # noqa: E402
import retro_paths as paths  # noqa: E402
import retro_plan as rp  # noqa: E402
from pipeline import decode_png  # noqa: E402


def check_item(item_id: str, scratch: Path, tag: str, variant: str) -> dict:
    item = rp.ITEMS[item_id]
    results = json.loads((paths.report_dir(scratch) / f"{paths.report_prefix(tag)}-{item_id}-results.json").read_text())
    times = {(f["clip"], f["facing"], f["index"]): f["source_frame"] for f in results["cells"] if f["variant"] == variant}
    cells_dir = paths.cells_dir(scratch, tag) / item_id / variant
    coarse_clip = next(c for c in item.clips if c.id == "walk")
    fine_clip = next(c for c in item.clips if c.id == "walk16")
    out: dict = {"facings": {}, "matching": 0, "mismatching": 0, "pixels_differing": 0}
    for facing in coarse_clip.facings:
        pairs = rm.resample_pairs(coarse_clip.frames, fine_clip.frames)
        coarse = {i: decode_png(cells_dir / f"walk_{facing}_{i:02d}.png").rgba for i, _ in pairs}
        fine = {j: decode_png(cells_dir / f"walk16_{facing}_{j:02d}.png").rgba for _, j in pairs}
        rep = rm.resample_report(pairs, coarse, fine, {i: times[("walk", facing, i)] for i, _ in pairs}, {j: times[("walk16", facing, j)] for _, j in pairs})
        out["facings"][facing] = {k: v for k, v in rep.items() if k != "rows"} | {"differing_cells": [r["coarse"] for r in rep["rows"] if r["pixels_differing"] or not r["same_time"]]}
        out["matching"] += rep["matching"]
        out["mismatching"] += rep["mismatching"]
        out["pixels_differing"] += rep["pixels_differing"]
    out["pairs"] = out["matching"] + out["mismatching"]
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scratch", default=str(paths.DEFAULT_SCRATCH))
    ap.add_argument("--tag", default=paths.DEFAULT_TAG)
    ap.add_argument("--variant", default="toon")
    ap.add_argument("--items", default="zeus,zeus-tall,mortal")
    args = ap.parse_args()
    scratch = Path(args.scratch)
    missing = [i for i in args.items.split(",") if not (paths.report_dir(scratch) / f"{paths.report_prefix(args.tag)}-{i}-results.json").exists()]
    if missing:
        print(f"check_resample: no postprocess results for {', '.join(missing)} (tag {args.tag!r}); run postprocess_retro.py --tag {args.tag} first.", file=sys.stderr)
        return 1
    report = {item: check_item(item, scratch, args.tag, args.variant) for item in args.items.split(",")}
    report["all_match"] = all(v["mismatching"] == 0 for v in report.values() if isinstance(v, dict))
    (paths.report_dir(scratch) / f"{paths.report_prefix(args.tag)}-resample-check.json").write_text(json.dumps(report, indent=1) + "\n")
    for item, v in report.items():
        if isinstance(v, dict):
            print(f"{item}: {v['matching']}/{v['pairs']} walk[i] == walk16[2i]; {v['mismatching']} mismatching cells, {v['pixels_differing']} pixels differ")
    print("GREEN" if report["all_match"] else "RED")
    return 0 if report["all_match"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

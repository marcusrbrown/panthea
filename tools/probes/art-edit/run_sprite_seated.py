#!/usr/bin/env python3
"""Zeus `seated/south`: key, downscale and place every generated candidate of a studio request, at the idle's ratio.

The reusable form of `run_sprite_c1.py` and `run_sprite_c2a.py`: it is not pinned to the idle job. It takes any studio
job ids (or every succeeded job of a request), a studio root and a config, keys each 512x640 render at source
resolution by the c2a rules (a border flood key; the ground shadow colour and its low-chroma fringe cleared in the
lowest rows; the flood again, which frees the gap between the legs; the largest 8-connected component), downscales it
onto the Olympus palette at the idle's own source-to-sprite ratio, adds the 1 px exterior outline and places the feet
on row 79 (soles on row 78, outline under them) with the midpoint between them at x=32.

The ratio. `run_sprite_c2a.py` recorded the idle's M50 tile as 52 interior rows for a 580-row figure box (the keyed
box with the raised bolt, rows 28-608 of the 512x640 render): each sprite pixel covers 580/52 = 145/13 = 11.1538
source pixels (0.089655 sprite pixels per source pixel). The 0.08955 in `c2/results.json` is the body target
(50 - 2 outline rows over a 536-row body) that chose the 52 rows; the downscale itself ran at 52/580. That 145/13 is
the default here, so a head the generator draws at the idle's size lands at the idle's size.

The soles. A front-view seated figure has its feet lowest, so sole anchoring still applies. When a candidate's feet are
not the lowest opaque rows (a hem, a seat or a footstool is lower, or the lowest rows are not two separate feet) the
result entry says so under `anchor` and the candidate gets no cell: nothing is guessed.

Writes `<repo>/.context/studio-pipeline/seated/<run>/`: `contact-1x.png` and `contact-4x.png` (a row per candidate,
S1, S2, ... in job order; columns are the methods, M mode and K k-centroid), `cells/<job>/<code>.png`,
`keyed/<job>.png` (magenta marks transparent) and `results.json`. The studio store is read only. No model runs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
import subprocess
import sys
from dataclasses import dataclass, fields
from fractions import Fraction
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline import Raster, decode_png, encode_png
from run_sprite_c2a import magenta_view
from sprite_downscale import (
    OUTLINE_PX,
    Palette,
    add_outline,
    area_average_rect,
    clear_colour_in_rows,
    clear_light_grey_in_rows,
    coverage_alpha,
    foreground_bbox,
    keep_largest_component,
    key_foreground,
    kcentroid_rect,
    load_palette,
    measure,
    mode_rect,
    place_by_soles,
    snap_to_palette,
    sole_clusters,
    sole_midpoint,
)
from sprite_sheet import contact_sheet, enlarge

REPO = Path(__file__).resolve().parents[3]
PALETTE_JSON = REPO / "content/greek/palette/palette.json"
OUT_ROOT = REPO / ".context/studio-pipeline/seated"
METHOD_CODES = {"mode": "M", "kcentroid": "K", "area": "A"}
IDLE_STEP = Fraction(580, 52)  # source pixels per sprite pixel: c2a's M50 tile, 52 interior rows for a 580-row box

Rgb = tuple[int, int, int]
Load = Callable[[Path], Raster]
Save = Callable[[Raster, Path], None]


@dataclass(frozen=True)
class Config:
    """Keying and sampling rules. The defaults are the c2a values that produced the idle."""

    key_tolerance: int = 24
    ground_zone_fraction: float = 0.03
    shadow_sample: tuple[int, int, int, int] | None = None  # a box of pure ground shadow; None estimates the colour
    shadow_tolerance: int = 30
    shadow_auto_max_spread: int = 24
    shadow_auto_min_pixels: int = 200
    fringe_max_spread: int = 14
    fringe_min_luma: int = 140
    min_component: int = 500
    sole_band_rows: int = 8
    sole_min_gap: int = 20
    max_foot_fraction: float = 0.45
    sole_row_tolerance: int = 6
    source_px_per_sprite_px: str = "145/13"
    methods: tuple[str, ...] = ("mode",)


def parse_ratio(text: str | int | float) -> Fraction:
    """Source pixels per sprite pixel from "145/13" or a decimal; it must be above 1 (a downscale)."""
    value = Fraction(text) if not isinstance(text, float) else Fraction(text).limit_denominator(100000)
    if value <= 1:
        raise ValueError(f"the ratio {text} is not a downscale: source pixels per sprite pixel must be above 1")
    return value


def load_config(source: dict | str | Path | None) -> Config:
    data = {} if source is None else source if isinstance(source, dict) else json.loads(Path(source).read_text())
    known = {f.name for f in fields(Config)}
    unknown = set(data) - known
    if unknown:
        raise ValueError(f"unknown config keys: {sorted(unknown)}")
    data = dict(data)
    if data.get("shadow_sample") is not None:
        box = tuple(data["shadow_sample"])
        if len(box) != 4:
            raise ValueError("shadow_sample must be [x0, y0, x1, y1]")
        data["shadow_sample"] = box
    if "methods" in data:
        data["methods"] = tuple(data["methods"])
        for method in data["methods"]:
            if method not in ("mode", "kcentroid"):
                raise ValueError(f"unknown method {method!r}: use mode or kcentroid")
    cfg = Config(**data)
    parse_ratio(cfg.source_px_per_sprite_px)
    return cfg


# --- the generalised c2a keying -------------------------------------------------------------------------------


def median_colour(raster: Raster, box: tuple[int, int, int, int]) -> Rgb:
    x0, y0, x1, y1 = box
    samples = [
        tuple(raster.rgba[(y * raster.width + x) * 4 : (y * raster.width + x) * 4 + 3])
        for y in range(y0, y1)
        for x in range(x0, x1)
    ]
    if not samples:
        raise ValueError("the shadow sample box is empty")
    return tuple(int(statistics.median(s[c] for s in samples)) for c in range(3))  # type: ignore[return-value]


def estimate_shadow_key(keyed: Raster, raw: Raster, zone_top: int, max_spread: int, min_pixels: int) -> tuple[Rgb | None, int]:
    """The ground shadow's colour, when no sample box is given: the median of the low-chroma opaque pixels in the
    ground zone (channel spread at most `max_spread`). None when fewer than `min_pixels` qualify, which means there
    is no flat grey shadow to clear."""
    samples = []
    for y in range(zone_top, keyed.height):
        for x in range(keyed.width):
            at = (y * keyed.width + x) * 4
            if keyed.rgba[at + 3]:
                r, g, b = raw.rgba[at], raw.rgba[at + 1], raw.rgba[at + 2]
                if max(r, g, b) - min(r, g, b) <= max_spread:
                    samples.append((r, g, b))
    if len(samples) < min_pixels:
        return None, len(samples)
    return tuple(int(statistics.median(s[c] for s in samples)) for c in range(3)), len(samples)  # type: ignore[return-value]


def rekey(raw: Raster, cfg: Config) -> tuple[Raster, dict]:
    """Keeps only the figure of a render, by the c2a rules. Returns the keyed raster and what each step removed."""
    keyed, key = key_foreground(raw, cfg.key_tolerance)
    first_bbox = foreground_bbox(keyed)
    first_height = first_bbox[3] - first_bbox[1]
    zone_top = first_bbox[3] - round(cfg.ground_zone_fraction * first_height)
    if cfg.shadow_sample is not None:
        shadow_key: Rgb | None = median_colour(raw, cfg.shadow_sample)
        shadow_how, estimated = "sample box", None
    else:
        shadow_key, estimated = estimate_shadow_key(
            keyed, raw, zone_top, cfg.shadow_auto_max_spread, cfg.shadow_auto_min_pixels
        )
        shadow_how = "estimated from the ground zone" if shadow_key is not None else "none found"
    cleared, shadow_pixels = (
        clear_colour_in_rows(keyed, shadow_key, cfg.shadow_tolerance, zone_top) if shadow_key else (keyed, 0)
    )
    cleared, fringe_pixels = clear_light_grey_in_rows(cleared, cfg.fringe_max_spread, cfg.fringe_min_luma, zone_top)
    reflooded = bytearray(raw.rgba)
    for at in range(0, len(reflooded), 4):
        if keyed.rgba[at + 3] and not cleared.rgba[at + 3]:
            reflooded[at : at + 3] = bytes(key)
    rekeyed, _ = key_foreground(Raster(raw.width, raw.height, bytes(reflooded)), cfg.key_tolerance, key)
    freed = (
        sum(1 for at in range(0, len(keyed.rgba), 4) if keyed.rgba[at + 3] and not rekeyed.rgba[at + 3])
        - shadow_pixels
        - fringe_pixels
    )
    final, removed = keep_largest_component(rekeyed, cfg.min_component)
    facts = {
        "key_rgb": list(key),
        "key_tolerance": cfg.key_tolerance,
        "first_pass_bbox": list(first_bbox),
        "ground_zone_from_row": zone_top,
        "shadow": {
            "how": shadow_how,
            "rgb": None if shadow_key is None else list(shadow_key),
            "tolerance": cfg.shadow_tolerance,
            "pixels_cleared": shadow_pixels,
            **({} if estimated is None else {"estimate_from_pixels": estimated}),
        },
        "fringe_pixels_cleared": fringe_pixels,
        "pocket_pixels_freed_by_rekey": freed,
        "components_removed": removed,
        "foreground_pixels_before": sum(1 for a in keyed.rgba[3::4] if a),
        "foreground_pixels_after": sum(1 for a in final.rgba[3::4] if a),
    }
    return final, facts


# --- the soles -----------------------------------------------------------------------------------------------------


def check_feet(final: Raster, cfg: Config) -> dict:
    """Whether the feet are the lowest opaque rows: two separate foot clusters in the lowest rows, each narrower than
    `max_foot_fraction` of the figure and ending within `sole_row_tolerance` of the lowest row. Reports, never guesses."""
    x0, y0, x1, y1 = foreground_bbox(final)
    clusters = sole_clusters(final, cfg.sole_band_rows, cfg.sole_min_gap)
    reasons = []
    if len(clusters) != 2:
        reasons.append(f"{len(clusters)} foot clusters in the lowest {cfg.sole_band_rows} rows, not 2")
    else:
        for c in clusters:
            if (c["x1"] - c["x0"]) > cfg.max_foot_fraction * (x1 - x0):
                reasons.append(
                    f"the cluster at x {c['x0']}-{c['x1']} is {c['x1'] - c['x0']} px wide, over {cfg.max_foot_fraction:.0%}"
                    f" of the figure's {x1 - x0}: a hem or a seat, not a foot"
                )
            if c["bottom_row"] < y1 - 1 - cfg.sole_row_tolerance:
                reasons.append(f"the cluster at x {c['x0']}-{c['x1']} ends on row {c['bottom_row']}, not the lowest row {y1 - 1}")
    return {
        "ok": not reasons,
        "reasons": reasons,
        "lowest_row": y1 - 1,
        "clusters": [
            {"x0": c["x0"], "x1": c["x1"], "lowest_row": c["bottom_row"], "centre": c["centre"]} for c in clusters
        ],
        "sole_midpoint": (clusters[0]["centre"] + clusters[-1]["centre"]) / 2 if len(clusters) >= 2 else None,
    }


# --- the fixed-ratio downscale ----------------------------------------------------------------------------------------


def downscale_at_ratio(
    source: Raster, method: str, step: Fraction | float, palette: Palette, bbox: tuple[int, int, int, int] | None = None
) -> Raster:
    """Samples the foreground onto a grid at a fixed source-to-sprite ratio: each output pixel covers a `step` x `step`
    source rectangle anchored at the bounding box's left and top edges, whatever the figure's size. With
    `step = figure_height / rows` it is `downscale_figure` exactly; a rectangle that runs past the figure is covered
    only where the figure is, and `coverage_alpha` decides it."""
    x0, y0, x1, y1 = bbox if bbox is not None else foreground_bbox(source)
    step = float(step)
    columns = max(1, math.ceil((x1 - x0) / step - 1e-9))
    rows = max(1, math.ceil((y1 - y0) / step - 1e-9))
    out = bytearray(columns * rows * 4)
    for j in range(rows):
        ya, yb = y0 + j * step, y0 + (j + 1) * step
        for i in range(columns):
            xa, xb = x0 + i * step, x0 + (i + 1) * step
            if method == "area":
                mean, coverage = area_average_rect(source, xa, xb, ya, yb)
                colour = snap_to_palette(mean, palette) if coverage else palette.colours[0]
            elif method == "kcentroid":
                colour, coverage = kcentroid_rect(source, xa, xb, ya, yb, palette)
            elif method == "mode":
                colour, coverage = mode_rect(source, xa, xb, ya, yb, palette)
            else:
                raise ValueError(f"unknown method {method!r}")
            if coverage_alpha(coverage):
                at = (j * columns + i) * 4
                out[at : at + 4] = bytes((*colour, 255))
    return Raster(columns, rows, bytes(out))


def make_cell(final: Raster, method: str, step: Fraction, palette: Palette) -> tuple[Raster, dict]:
    """A 64x80 cell from a keyed figure: downscale at `step`, place by the soles, add the outline."""
    figure = downscale_at_ratio(final, method, step, palette, foreground_bbox(final))
    placed = place_by_soles(figure)
    cell = add_outline(placed, palette)
    facts = measure(cell, palette, placed)
    facts.pop("palette_entries")
    clusters = sole_clusters(cell, 2, 2)
    facts["soles"] = [[c["x0"], c["x1"] - 1, c["bottom_row"]] for c in clusters]
    facts["sole_midpoint"] = sole_midpoint(cell, 2, 2)
    facts["top_row"] = facts["bottom_row"] - facts["height"] + 1
    return cell, facts


# --- the store -----------------------------------------------------------------------------------------------------


def read_jobs(store: Path, job_ids: list[str] | None, request: str | None) -> list[dict]:
    """The recorded jobs, in job order: the named ones, or every job of `request`."""
    paths = (
        [store / "jobs" / f"{job}.json" for job in job_ids]
        if job_ids
        else sorted((store / "jobs").glob(f"{request}-*.json"))
    )
    if not paths:
        raise ValueError("no jobs: name --job ids or a --request with jobs in the store")
    jobs = []
    for path in paths:
        if not path.exists():
            raise ValueError(f"no job record {path.name} in {store / 'jobs'}")
        record = json.loads(path.read_text())
        job = record["job"]
        outputs = job.get("outputs") or []
        jobs.append(
            {
                "id": job["id"],
                "seed": job["request"].get("seed"),
                "status": job["status"],
                "output": outputs[0]["hash"] if outputs else None,
                "prompt": record["engine"]["settings"]["prompt"] if "engine" in record else None,
            }
        )
    return jobs


def blob_path(store: Path, job: dict) -> Path:
    path = store / "blobs" / f"{job['output']}.png"
    if hashlib.sha256(path.read_bytes()).hexdigest() != job["output"]:
        raise ValueError(f"{path.name}: hash does not match its record")
    return path


# --- the run ------------------------------------------------------------------------------------------------------------


def process(raw: Raster, cfg: Config, palette: Palette, step: Fraction) -> tuple[Raster, dict, list[tuple[str, Raster, dict]], dict]:
    """One render: its keyed figure, the keying facts, the cells (code, raster, facts) and the anchor verdict."""
    final, keying = rekey(raw, cfg)
    bbox = foreground_bbox(final)
    anchor = check_feet(final, cfg)
    keying["figure_bbox"] = list(bbox)
    keying["figure_height"] = bbox[3] - bbox[1]
    keying["figure_width"] = bbox[2] - bbox[0]
    keying["at_ratio"] = {
        "columns": math.ceil((bbox[2] - bbox[0]) / float(step) - 1e-9),
        "rows": math.ceil((bbox[3] - bbox[1]) / float(step) - 1e-9),
    }
    cells: list[tuple[str, Raster, dict]] = []
    if not anchor["ok"]:
        return final, keying, cells, anchor
    for method in cfg.methods:
        try:
            cell, facts = make_cell(final, method, step, palette)
        except ValueError as error:
            anchor.setdefault("cell_errors", {})[method] = str(error)
            continue
        cells.append((METHOD_CODES[method], cell, facts))
    return final, keying, cells, anchor


def conform(paths: list[Path]) -> dict:
    result = subprocess.run(
        ["bun", str(Path(__file__).parent / "conform_report.ts"), *map(str, paths)],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=True,
        timeout=120,
    )
    return json.loads(result.stdout)


def run(
    store: Path,
    cfg: Config,
    out: Path,
    job_ids: list[str] | None = None,
    request: str | None = None,
    palette_json: Path = PALETTE_JSON,
    load: Load = decode_png,
    save: Save = encode_png,
    run_conform: bool = False,
) -> dict:
    palette = load_palette(palette_json)
    step = parse_ratio(cfg.source_px_per_sprite_px)
    jobs = read_jobs(store, job_ids, request)
    (out / "cells").mkdir(parents=True, exist_ok=True)
    (out / "keyed").mkdir(parents=True, exist_ok=True)
    rows: list[list[tuple[str, Raster]]] = []
    labels: list[str] = []
    results = []
    for number, job in enumerate(jobs, 1):
        if job["status"] != "succeeded" or job["output"] is None:
            results.append({**job, "skipped": "job did not succeed"})
            continue
        raw = load(blob_path(store, job))
        final, keying, cells, anchor = process(raw, cfg, palette, step)
        save(magenta_view(final), out / "keyed" / f"{job['id']}.png")
        entry = {**job, "raw_size": [raw.width, raw.height], "keying": keying, "anchor": anchor, "cells": []}
        if not cells:
            entry["skipped"] = "no cell: " + ("; ".join(anchor["reasons"]) or "placement failed")
        paths = []
        for code, cell, facts in cells:
            path = out / "cells" / job["id"] / f"{code}.png"
            save(cell, path)
            paths.append((path, facts, code))
            entry["cells"].append({"tile": code, "file": str(path.relative_to(out)), **facts})
        if run_conform and paths:
            report = conform([p for p, _, _ in paths])
            for cell_entry, (path, _, _) in zip(entry["cells"], paths):
                verdict = report[str(path)]
                cell_entry["conform"] = verdict["status"]
                cell_entry["conform_failed"] = [
                    f"{c['check']}: {c['message']}" for c in verdict.get("checks", []) if c["status"] != "pass"
                ]
        if cells:
            rows.append([(code, cell) for code, cell, _ in cells])
            labels.append(f"S{number}")
        results.append(entry)
    if rows:
        sheet = contact_sheet(rows, labels)
        save(sheet, out / "contact-1x.png")
        save(enlarge(sheet, 4), out / "contact-4x.png")
    summary = {
        "store": str(store),
        "ratio": {
            "source_px_per_sprite_px": str(step),
            "decimal": round(float(step), 6),
            "sprite_px_per_source_px": round(1 / float(step), 6),
            "derivation": "run_sprite_c2a.py M50 tile: 52 interior rows for the 580-row keyed figure box = 580/52 = 145/13",
        },
        "config": {f.name: getattr(cfg, f.name) for f in fields(cfg)},
        "outline_px": OUTLINE_PX,
        "jobs": results,
    }
    (out / "results.json").write_text(json.dumps(summary, indent=1) + "\n")
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--store", required=True, type=Path, help="the studio root (read only)")
    parser.add_argument("--config", type=Path, help="keying and sampling config JSON; the defaults are the idle's")
    parser.add_argument("--job", action="append", default=[], help="a job id; repeat for more")
    parser.add_argument("--request", help="every job of this request id, in job order")
    parser.add_argument("--run", required=True, help="the run name: output goes to .context/studio-pipeline/seated/<run>/")
    parser.add_argument("--out", type=Path, help="override the output folder")
    parser.add_argument("--conform", action="store_true", help="also run report-only conformance on each cell (needs bun)")
    args = parser.parse_args(argv)
    if bool(args.job) == bool(args.request):
        parser.error("give --job ids or --request, not both and not neither")
    cfg = load_config(args.config)
    out = args.out or OUT_ROOT / args.run
    summary = run(args.store, cfg, out, args.job or None, args.request, run_conform=args.conform)
    for job in summary["jobs"]:
        print(job["id"], job.get("skipped") or [c["tile"] for c in job["cells"]], flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

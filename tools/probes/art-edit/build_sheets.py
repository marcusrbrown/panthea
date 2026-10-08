#!/usr/bin/env python3
"""Rebuild art-probe crops, pixel-snapped cells and review sheets with ffmpeg."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from pipeline import (
    Raster,
    binary_mask,
    compose_grid,
    content_bands,
    decode_png,
    encode_png,
    fit_bbox_to_cell,
    nearest_resize,
    olympus_palette,
    opaque_bbox,
    process_sprite,
    silhouette,
)


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SCRATCH = REPO / ".context/studio-pipeline/art-edit"
EXPRESSIONS = ("pleased", "angry", "grieving", "scheming", "awed")
SEEDS = (20261010, 20261011, 20261012, 20261013)


def opaque_bbox(image: Raster) -> tuple[int, int, int, int]:
    points = [(x, y) for y in range(image.height) for x in range(image.width) if image.pixel(x, y)[3]]
    if not points:
        raise ValueError("image has no opaque pixels")
    return (min(x for x, _ in points), min(y for _, y in points),
            max(x for x, _ in points) + 1, max(y for _, y in points) + 1)


def white_background(image: Raster) -> Raster:
    data = bytearray(image.rgba)
    for at in range(0, len(data), 4):
        if data[at + 3] == 0:
            data[at : at + 4] = bytes((255, 255, 255, 255))
    return Raster(image.width, image.height, bytes(data))


def save_1x_4x(image: Raster, stem: Path) -> None:
    encode_png(image, stem.with_name(stem.name + "-1x.png"))
    encode_png(nearest_resize(image, image.width * 4, image.height * 4, integer_factor=True),
               stem.with_name(stem.name + "-4x.png"))


def build_b1(raw_dir: Path, evidence: Path) -> None:
    evidence.mkdir(parents=True, exist_ok=True)
    seeds = (20261006, 20261007, 20261008, 20261009)
    cells: list[Raster] = []
    raw_cells: list[Raster] = []
    records = []
    for seed in seeds:
        source = decode_png(raw_dir / f"b1-single-lora-{seed}.png")
        raw_cells.append(nearest_resize(source, 64, 80, integer_factor=True))
        bands = content_bands(source, threshold=30)
        if not bands:
            raise ValueError(f"no single-figure content found for seed {seed}")
        chosen = bands[-1]  # lower figure where the model returned two
        cells.append(fit_bbox_to_cell(source, chosen, figure_height=56))
        records.append({"kind": "single", "seed": seed, "bands": bands, "selected_bbox": chosen,
                        "method": "border-colour distance >30, lowest vertical content band, nearest-neighbour fit to 56px height, centered and bottom-aligned in 64x80"})

    for seed in seeds:
        source = decode_png(raw_dir / f"b1-sheet-lora-{seed}.png")
        # The LoRA training sheet is 4x4; first row/first column is the down-facing frame.
        first_cell = Raster(128, 128, b"".join(
            source.rgba[(y * source.width) * 4 : (y * source.width + 128) * 4]
            for y in range(128)
        ))
        bands = content_bands(first_cell, threshold=30)
        if not bands:
            raise ValueError(f"no first-cell figure found for seed {seed}")
        cells.append(fit_bbox_to_cell(first_cell, bands[-1], figure_height=56))
        records.append({"kind": "native-sheet-first-cell", "seed": seed, "sheet_cell": [0, 0, 128, 128],
                        "content_bbox": bands[-1],
                        "method": "crop first 128x128 cell, detect content with threshold 30, nearest-neighbour fit to 56px height, center/bottom-align in 64x80"})

    grid = compose_grid(cells, columns=4)
    save_1x_4x(grid, evidence / "b1-round1-rebuilt")
    save_1x_4x(compose_grid(raw_cells, columns=4), evidence / "b1-round1-raw")
    (evidence / "b1-round1-crops.json").write_text(json.dumps(records, indent=2) + "\n")


def build_a1_masks(scratch: Path) -> None:
    mask_dir = scratch / "inputs"
    brows = [
        (371, 225, 94, 24),  # left brow, above the iris/pupil
        (478, 221, 62, 28),  # right brow, above the eye
        (389, 248, 27, 4),   # upper lid to the left of the large iris
        (439, 248, 21, 4),   # upper lid to the right of the large iris
        (495, 246, 29, 4),   # upper edge of the far eye; ends before its pupil
    ]
    mouth = [(397, 337, 153, 100)]
    masks = {
        "a1-r2-brows-mask.png": brows,
        "a1-r2-mouth-mask.png": mouth,
        "a1-r2-combined-mask.png": brows + mouth,
    }
    for filename, rectangles in masks.items():
        encode_png(binary_mask(768, 768, rectangles), mask_dir / filename)
    (mask_dir / "a1-r2-mask-coordinates.json").write_text(json.dumps({
        "canvas": [768, 768],
        "brows_only": brows,
        "mouth_beard_front": mouth,
        "combined": brows + mouth,
        "rectangles": "[x, y, width, height], half-open extent; white=edit, black=preserve",
    }, indent=2) + "\n")


def build_b2_mask(scratch: Path) -> None:
    rectangle = (112, 336, 120, 136)  # viewer-left (Zeus's right) lowered hand and space for bolt
    inputs = scratch / "inputs"
    encode_png(binary_mask(512, 640, [rectangle]), inputs / "b2-r2-bolt-mask.png")
    (inputs / "b2-r2-bolt-mask-coordinates.json").write_text(json.dumps({
        "canvas": [512, 640],
        "viewer_left_hand_bolt_area": rectangle,
        "rectangles": "[x, y, width, height], half-open extent; white=edit, black=preserve",
    }, indent=2) + "\n")


def build_a1(raw_dir: Path, evidence: Path, config: str, picks_path: Path) -> None:
    picks = json.loads(picks_path.read_text())[config]
    if set(picks) != set(EXPRESSIONS) or any(seed not in SEEDS for seed in picks.values()):
        raise ValueError(f"picks for {config} must select one of {SEEDS} for every expression")
    tiles, selected = [], set()
    for row, expression in enumerate(EXPRESSIONS):
        base = decode_png(raw_dir.parent / "inputs/base.png")
        tiles.append(nearest_resize(base, 96, 96, integer_factor=True))
        for col, seed in enumerate(SEEDS):
            image = decode_png(raw_dir / f"a1-r2-{config}-{expression}-{seed}.png")
            if (image.width, image.height) != (768, 768):
                raise ValueError(f"unexpected portrait size for {expression}/{seed}: {image.width}x{image.height}")
            tile = nearest_resize(image, 96, 96, integer_factor=True)
            tiles.append(tile)
            if seed == picks[expression]:
                selected.add(row * (len(SEEDS) + 1) + 1 + col)
    sheet = compose_grid(tiles, columns=len(SEEDS) + 1, picked=selected)
    save_1x_4x(sheet, evidence / f"a1-r2-{config}")


def build_b2(raw_dir: Path, evidence: Path, palette_path: Path) -> None:
    evidence.mkdir(parents=True, exist_ok=True)
    palette = olympus_palette(palette_path)
    records = []
    cells: list[Raster] = []
    for backend in ("sdxl", "zimage"):
        for seed in range(20261014, 20261018) if backend == "sdxl" else range(20261018, 20261022):
            name = f"b2-r2-{backend}-bolt-{seed}"
            result = process_sprite(decode_png(raw_dir / f"{name}.png"), palette)
            filename = evidence / "b2-r2-candidates" / f"{name}.png"
            encode_png(result, filename)
            cells.append(result)
            records.append({"name": name, "cell": [64, 80], "opaque_bbox": opaque_bbox(result),
                            "figure_height": opaque_bbox(result)[3] - opaque_bbox(result)[1],
                            "output": os.path.relpath(filename, REPO)})
    grid = compose_grid([white_background(cell) for cell in cells], columns=4)
    save_1x_4x(grid, evidence / "b2-r2")
    silhouette_grid = compose_grid([silhouette(cell) for cell in cells], columns=4)
    save_1x_4x(silhouette_grid, evidence / "b2-r2-silhouette")
    (evidence / "b2-r2-order.json").write_text(json.dumps(records, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("b1", "a1", "b2", "masks", "b2-mask"))
    parser.add_argument("--raw-dir", type=Path, default=SCRATCH / "outputs")
    parser.add_argument("--evidence", type=Path, default=ROOT / "evidence")
    parser.add_argument("--config", choices=("brows", "mouth", "combined"))
    parser.add_argument("--picks", type=Path)
    parser.add_argument("--palette", type=Path, default=REPO / "content/greek/palette/palette.json")
    args = parser.parse_args()
    if args.mode == "b1":
        build_b1(args.raw_dir, args.evidence)
    elif args.mode == "masks":
        build_a1_masks(SCRATCH)
    elif args.mode == "b2-mask":
        build_b2_mask(SCRATCH)
    elif args.mode == "a1":
        if not args.config or not args.picks:
            parser.error("a1 requires --config and --picks")
        build_a1(args.raw_dir, args.evidence, args.config, args.picks)
    else:
        build_b2(args.raw_dir, args.evidence, args.palette)


if __name__ == "__main__":
    main()

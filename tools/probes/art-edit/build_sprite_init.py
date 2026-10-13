#!/usr/bin/env python3
"""Draw the hand-blocked 64x80 Zeus idle and prepare Z-Image inputs."""

from __future__ import annotations

import json
from pathlib import Path

from pipeline import Raster, binary_mask, encode_png, nearest_resize, olympus_palette, opaque_bbox


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SCRATCH = REPO / ".context/studio-pipeline/art-edit/sprite-init"
EVIDENCE = ROOT / "evidence"
CELL_SIZE = (64, 80)
UPSCALE = 8
HEAD_BBOX = (24, 26, 40, 40)
BOLT_PROTECT_BBOX = (11, 52, 10, 17)
MASK_MARGIN = 2


def fill_rect(canvas: bytearray, color: tuple[int, int, int], x0: int, y0: int, x1: int, y1: int) -> None:
    """Fill a clipped half-open rectangle in a 64x80 RGB canvas."""
    x0, x1 = max(0, x0), min(CELL_SIZE[0], x1)
    y0, y1 = max(0, y0), min(CELL_SIZE[1], y1)
    if x0 >= x1 or y0 >= y1:
        return
    rgba = bytes((*color, 255))
    for y in range(y0, y1):
        for x in range(x0, x1):
            at = (y * CELL_SIZE[0] + x) * 4
            canvas[at : at + 4] = rgba


def create_sprite_1x(palette: list[tuple[int, int, int]]) -> Raster:
    """Compose flat color blocks directly on the target 64x80 pixel grid."""
    if len(palette) != 16:
        raise ValueError(f"expected 16 Olympus ramp colors, got {len(palette)}")

    background, robe, robe_shadow = palette[8], palette[3], palette[1]
    gold_shadow, sash, gold = palette[4], palette[5], palette[7]
    skin, hair_shadow, hair = palette[6], palette[13], palette[15]
    canvas = bytearray(bytes((*background, 255)) * (CELL_SIZE[0] * CELL_SIZE[1]))

    # Head: plain hair mass, laurel band, face block and a broad grey-white beard.
    fill_rect(canvas, hair_shadow, 24, 27, 40, 36)
    fill_rect(canvas, hair, 25, 26, 39, 31)
    fill_rect(canvas, gold_shadow, 25, 27, 39, 29)
    fill_rect(canvas, gold, 26, 27, 38, 28)
    fill_rect(canvas, skin, 27, 30, 37, 36)
    fill_rect(canvas, hair_shadow, 26, 35, 38, 39)
    fill_rect(canvas, hair, 27, 36, 37, 39)
    fill_rect(canvas, hair_shadow, 23, 30, 27, 37)
    fill_rect(canvas, hair_shadow, 37, 30, 41, 37)

    # Neck and chiton: broad, simple blocks with a single shadow plane.
    fill_rect(canvas, skin, 30, 38, 34, 43)
    fill_rect(canvas, robe, 24, 42, 40, 47)
    fill_rect(canvas, robe_shadow, 21, 45, 25, 52)
    fill_rect(canvas, robe_shadow, 39, 45, 43, 52)
    fill_rect(canvas, robe, 23, 46, 41, 62)
    fill_rect(canvas, robe_shadow, 23, 62, 26, 71)
    fill_rect(canvas, robe, 26, 62, 38, 73)
    fill_rect(canvas, robe_shadow, 38, 62, 41, 71)
    fill_rect(canvas, sash, 23, 59, 41, 63)
    fill_rect(canvas, gold, 24, 59, 40, 60)

    # Both arms hang at the sides; skin is a single flat ramp color.
    fill_rect(canvas, skin, 21, 51, 24, 63)
    fill_rect(canvas, skin, 40, 51, 43, 63)
    fill_rect(canvas, skin, 20, 62, 24, 66)
    fill_rect(canvas, skin, 40, 62, 44, 66)

    # A large, angular lightning bolt is held low in Zeus's right hand (viewer-left).
    fill_rect(canvas, gold_shadow, 14, 53, 18, 56)
    fill_rect(canvas, gold, 15, 53, 18, 55)
    fill_rect(canvas, gold, 12, 56, 16, 59)
    fill_rect(canvas, gold_shadow, 14, 58, 20, 61)
    fill_rect(canvas, gold, 15, 58, 19, 60)
    fill_rect(canvas, gold, 14, 61, 18, 64)
    fill_rect(canvas, gold_shadow, 11, 64, 16, 68)
    fill_rect(canvas, gold, 12, 64, 15, 67)
    fill_rect(canvas, skin, 18, 61, 22, 66)

    # Feet are separated symmetrically around x=32, with their bottom pixels on row 79.
    fill_rect(canvas, skin, 27, 76, 32, 80)
    fill_rect(canvas, skin, 33, 76, 38, 80)
    return Raster(CELL_SIZE[0], CELL_SIZE[1], bytes(canvas))


def figure_bbox(image: Raster) -> tuple[int, int, int, int]:
    background = image.pixel(0, 0)[:3]
    points = [
        (x, y)
        for y in range(image.height)
        for x in range(image.width)
        if image.pixel(x, y)[:3] != background
    ]
    if not points:
        raise ValueError("init image has no figure")
    return min(x for x, _ in points), min(y for _, y in points), max(x for x, _ in points) + 1, max(y for _, y in points) + 1


def create_masks(sprite: Raster) -> tuple[Raster, Raster]:
    """Return full-figure and bolt-protected binary masks at 1x cell size."""
    x0, y0, x1, y1 = figure_bbox(sprite)
    x0, y0 = max(0, x0 - MASK_MARGIN), max(0, y0 - MASK_MARGIN)
    x1, y1 = min(sprite.width, x1 + MASK_MARGIN), min(sprite.height, y1 + MASK_MARGIN)
    full = binary_mask(sprite.width, sprite.height, [(x0, y0, x1 - x0, y1 - y0)])

    pixels = bytearray(full.rgba)
    bx0, by0, bw, bh = BOLT_PROTECT_BBOX
    for y in range(by0, by0 + bh):
        for x in range(bx0, bx0 + bw):
            at = (y * sprite.width + x) * 4
            pixels[at : at + 4] = bytes((0, 0, 0, 255))
    return full, Raster(sprite.width, sprite.height, bytes(pixels))


def white_bbox(mask: Raster) -> tuple[int, int, int, int]:
    points = [(x, y) for y in range(mask.height) for x in range(mask.width) if mask.pixel(x, y)[0] == 255]
    if not points:
        raise ValueError("mask contains no editable pixels")
    return min(x for x, _ in points), min(y for _, y in points), max(x for x, _ in points) + 1, max(y for _, y in points) + 1


def image_metrics(sprite: Raster) -> dict[str, int | float | tuple[int, int, int, int]]:
    bbox = figure_bbox(sprite)
    figure_height = bbox[3] - bbox[1]
    opaque_colors = {sprite.pixel(x, y)[:3] for y in range(sprite.height) for x in range(sprite.width)}
    feet_x = [x for x in range(sprite.width) if sprite.pixel(x, 79)[:3] == sprite.pixel(27, 79)[:3]]
    if len(feet_x) != 10:
        raise ValueError(f"expected two five-pixel feet on row 79, found {len(feet_x)}")
    left_foot = feet_x[:5]
    right_foot = feet_x[5:]
    foot_midpoint = ((left_foot[0] + left_foot[-1]) / 2 + (right_foot[0] + right_foot[-1]) / 2) / 2
    return {
        "figure_bbox": bbox,
        "height": figure_height,
        "head_bbox": HEAD_BBOX,
        "head_ratio": (HEAD_BBOX[3] - HEAD_BBOX[1]) / figure_height,
        "feet_row": 79,
        "feet_midpoint_x": int(foot_midpoint),
        "palette_count": len(opaque_colors),
    }


def build_assets(scratch: Path = SCRATCH, evidence: Path = EVIDENCE) -> dict[str, int | float | tuple[int, int, int, int]]:
    palette = olympus_palette(REPO / "content/greek/palette/palette.json")
    sprite = create_sprite_1x(palette)
    full_mask, protected_mask = create_masks(sprite)
    scratch.mkdir(parents=True, exist_ok=True)
    evidence.mkdir(parents=True, exist_ok=True)

    sprite_8x = nearest_resize(sprite, 512, 640, integer_factor=True)
    full_mask_8x = nearest_resize(full_mask, 512, 640, integer_factor=True)
    protected_mask_8x = nearest_resize(protected_mask, 512, 640, integer_factor=True)
    encode_png(sprite, scratch / "init-1x.png")
    encode_png(sprite_8x, scratch / "init-512x640.png")
    encode_png(full_mask, scratch / "mask-full-1x.png")
    encode_png(full_mask_8x, scratch / "mask-full-512x640.png")
    encode_png(protected_mask, scratch / "mask-bolt-protected-1x.png")
    encode_png(protected_mask_8x, scratch / "mask-bolt-protected-512x640.png")

    for label, image in (
        ("init", sprite),
        ("mask-full", full_mask),
        ("mask-bolt-protected", protected_mask),
    ):
        encode_png(image, evidence / f"sprite-init-{label}-1x.png")
        encode_png(nearest_resize(image, image.width * 4, image.height * 4, integer_factor=True),
                   evidence / f"sprite-init-{label}-4x.png")

    metrics = image_metrics(sprite)
    (scratch / "measurements.json").write_text(json.dumps(metrics, indent=2) + "\n")
    full_mask_bbox = white_bbox(full_mask)
    (scratch / "mask-coordinates.json").write_text(json.dumps({
        "canvas_1x": [64, 80],
        "canvas_8x": [512, 640],
        "scale": UPSCALE,
        "margin_1x": MASK_MARGIN,
        "full_figure_mask_bbox_1x": full_mask_bbox,
        "full_figure_mask_bbox_8x": [coordinate * UPSCALE for coordinate in full_mask_bbox],
        "bolt_protection_cutout_1x": BOLT_PROTECT_BBOX,
        "bolt_protection_cutout_8x": [coordinate * UPSCALE for coordinate in BOLT_PROTECT_BBOX],
        "mask_values": [0, 255],
        "rectangles": "[x, y, width, height], half-open; white=edit, black=preserve",
    }, indent=2) + "\n")
    (scratch / "generation-plan.md").write_text(
        "# Zeus idle sprite request (prep only)\n\n"
        "Prompt suffix: front view, standing at rest, full-body pixel-art sprite of Zeus; white chiton covering the torso with a gold sash; grey-white hair and beard; warm skin; both arms hanging naturally down; one large, clear gold zigzag thunderbolt held low in his right hand on the viewer-left; feet flat on the ground; clean connected silhouette, limited Olympus palette, plain flat background; no other weapons or props, no motion sheet, no text.\n\n"
        "Weights constraint: Z-Image Turbo and only Apache-licensed supporting weights; do not use SDXL or pixel-art-xl.\n\n"
        "Strength sweep: 0.45, 0.60, 0.75. For each strength, run seeds 20261022, 20261023, 20261024 and 20261025, serially, once GPU/memory are available. Total planned generations: 12. This is a plan only; no model or sd-cli was run during preparation.\n"
    )
    return metrics


if __name__ == "__main__":
    print(json.dumps(build_assets(), indent=2))

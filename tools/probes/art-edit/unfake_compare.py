"""unfake (MIT) as a comparison downscaler for the same keyed figures.

Needs the probe-local venv (`tools/probes/art-edit/.venv`, numpy, Pillow, OpenCV, unfake 1.0.7).
unfake's own downscalers work on whole-number blocks; only its content-adaptive downscaler takes
an arbitrary target size, so that is the any-ratio variant. The block variant uses the nearest
whole-number scale and is reported with whatever height that gives.
"""

from __future__ import annotations

import numpy as np
import unfake

from pipeline import Raster
from sprite_downscale import Palette, snap_to_palette

ALPHA_CUTOFF = 128


def _hex(colour: tuple[int, int, int]) -> str:
    return "#%02x%02x%02x" % colour


def crop_array(source: Raster, bbox: tuple[int, int, int, int]) -> np.ndarray:
    x0, y0, x1, y1 = bbox
    rows = [source.rgba[((y * source.width) + x0) * 4 : ((y * source.width) + x1) * 4] for y in range(y0, y1)]
    return np.frombuffer(b"".join(rows), dtype=np.uint8).reshape(y1 - y0, x1 - x0, 4).copy()


def bleed_colour_under_alpha(image: np.ndarray) -> np.ndarray:
    """Fills RGB under transparent pixels from the nearest opaque pixel, so no background colour is averaged in."""
    out = image.copy()
    opaque = out[:, :, 3] > 0
    height, width = opaque.shape
    filled = opaque.copy()
    frontier = np.argwhere(opaque)
    while frontier.size and not filled.all():
        nxt = []
        for y, x in frontier:
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < height and 0 <= nx < width and not filled[ny, nx]:
                    out[ny, nx, :3] = out[y, x, :3]
                    filled[ny, nx] = True
                    nxt.append((ny, nx))
        frontier = np.array(nxt)
    return out


def _to_raster(array: np.ndarray, palette: Palette) -> tuple[Raster, int]:
    """Converts to a Raster, snapping any colour off the palette with the shared snap step; returns how many pixels that moved."""
    height, width = array.shape[:2]
    out = bytearray(width * height * 4)
    moved = 0
    for y in range(height):
        for x in range(width):
            r, g, b, a = (int(v) for v in array[y, x])
            if a < ALPHA_CUTOFF:
                continue
            colour = (r, g, b)
            if colour not in palette.ramp_of:
                colour = snap_to_palette(colour, palette)
                moved += 1
            at = (y * width + x) * 4
            out[at : at + 4] = bytes((*colour, 255))
    return Raster(width, height, bytes(out)), moved


def content_adaptive(
    source: Raster, bbox: tuple[int, int, int, int], height: int, palette: Palette
) -> tuple[Raster, dict]:
    crop = bleed_colour_under_alpha(crop_array(source, bbox))
    scale = height / crop.shape[0]
    width = max(1, int(np.ceil(crop.shape[1] * scale - 1e-9)))
    reduced = unfake.content_adaptive_downscale(crop, width, height)
    reduced = unfake.alpha_binarization(reduced, ALPHA_CUTOFF)
    colours = [_hex(c) for c in palette.colours]
    mapped, _ = unfake.quantize_colors(reduced, len(colours), colours)
    mapped = unfake.finalize_pixels(mapped)
    raster, moved = _to_raster(mapped, palette)
    return raster, {"target": [width, height], "fixed_palette": True, "palette_pixels_moved_by_shared_snap": moved}


def block_dominant(
    source: Raster, bbox: tuple[int, int, int, int], height: int, palette: Palette
) -> tuple[Raster, dict]:
    crop = crop_array(source, bbox)
    figure_h, figure_w = crop.shape[:2]
    block = max(1, int(round(figure_h / height)))
    pad_top = (-figure_h) % block
    pad_right = (-figure_w) % block
    padded = np.pad(crop, ((pad_top, 0), (0, pad_right), (0, 0)))
    colours = [_hex(c) for c in palette.colours]
    result = unfake.process_image_sync(
        padded,
        max_colors=len(colours),
        manual_scale=block,
        downscale_method="dominant",
        fixed_palette=colours,
        snap_grid=False,
        alpha_threshold=ALPHA_CUTOFF,
        transparent_background=False,
    )
    raster, moved = _to_raster(result["image_array"], palette)
    return raster, {
        "block": block,
        "pad_top": pad_top,
        "pad_right": pad_right,
        "fixed_palette": True,
        "palette_pixels_moved_by_shared_snap": moved,
    }


def version() -> str:
    from importlib.metadata import version as installed

    return installed("unfake")

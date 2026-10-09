"""Any-ratio, palette-aware downscaling of a generated full-body figure to a 64x80 god cell.

Standard library only; PNG decode and encode go through pipeline.py. Nothing here runs a model.
"""

from __future__ import annotations

import json
import math
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from pipeline import Raster

RGB = tuple[int, int, int]
Lab = tuple[float, float, float]

CELL = (64, 80)
PIVOT_X = 32.0
SOLE_ROW = 78
OUTLINE_PX = 2


# --- colour -----------------------------------------------------------------


def _linear(channel: int) -> float:
    c = channel / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def oklab(rgb: tuple[float, float, float]) -> Lab:
    r, g, b = (_linear(int(round(v))) for v in rgb)
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = l ** (1 / 3), m ** (1 / 3), s ** (1 / 3)
    return (
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    )


def _distance(a: Lab, b: Lab) -> float:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2


@dataclass
class Palette:
    colours: tuple[RGB, ...]
    ramp_of: dict[RGB, str]
    darkest: dict[str, RGB]
    labs: tuple[Lab, ...] = ()
    _snap_cache: dict[RGB, RGB] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        self.labs = tuple(oklab(c) for c in self.colours)


def load_palette(path: str | Path, family: str = "olympus") -> Palette:
    data = json.loads(Path(path).read_text())
    chosen = next(f for f in data["families"] if f["id"] == family)
    colours: list[RGB] = []
    ramp_of: dict[RGB, str] = {}
    darkest: dict[str, RGB] = {}
    for ramp in chosen["ramps"]:
        shades = [tuple(bytes.fromhex(s.removeprefix("#"))) for s in ramp["shades"]]
        darkest[ramp["id"]] = min(shades, key=lambda c: oklab(c)[0])  # type: ignore[arg-type,return-value]
        for shade in shades:
            if shade not in ramp_of:
                colours.append(shade)  # type: ignore[arg-type]
                ramp_of[shade] = ramp["id"]  # type: ignore[index]
    return Palette(tuple(colours), ramp_of, darkest)


def snap_to_palette(rgb: tuple[float, float, float], palette: Palette) -> RGB:
    key = (int(round(rgb[0])), int(round(rgb[1])), int(round(rgb[2])))
    cached = palette._snap_cache.get(key)
    if cached is not None:
        return cached
    lab = oklab(key)
    best = min(range(len(palette.colours)), key=lambda i: (_distance(lab, palette.labs[i]), i))
    palette._snap_cache[key] = palette.colours[best]
    return palette.colours[best]


# --- coverage and rectangle sampling ------------------------------------------


def coverage_alpha(coverage: float) -> int:
    return 255 if coverage >= 0.5 - 1e-9 else 0


def _rect_pixels(source: Raster, xa: float, xb: float, ya: float, yb: float):
    """Opaque source pixels overlapping the half-open rectangle, with their exact overlap area."""
    rgba, width = source.rgba, source.width
    for y in range(max(0, int(math.floor(ya))), min(source.height, int(math.ceil(yb)))):
        wy = min(y + 1, yb) - max(y, ya)
        if wy <= 0:
            continue
        row = y * width
        for x in range(max(0, int(math.floor(xa))), min(width, int(math.ceil(xb)))):
            wx = min(x + 1, xb) - max(x, xa)
            if wx <= 0:
                continue
            at = (row + x) * 4
            if rgba[at + 3]:
                yield rgba[at], rgba[at + 1], rgba[at + 2], wx * wy


def area_average_rect(
    source: Raster, xa: float, xb: float, ya: float, yb: float
) -> tuple[tuple[float, float, float], float]:
    """Overlap-weighted mean colour of the opaque pixels, and the share of the rectangle they cover."""
    total = 0.0
    sums = [0.0, 0.0, 0.0]
    for r, g, b, w in _rect_pixels(source, xa, xb, ya, yb):
        total += w
        sums[0] += r * w
        sums[1] += g * w
        sums[2] += b * w
    if total == 0.0:
        return (0.0, 0.0, 0.0), 0.0
    return (sums[0] / total, sums[1] / total, sums[2] / total), total / ((xb - xa) * (yb - ya))


def mode_rect(
    source: Raster, xa: float, xb: float, ya: float, yb: float, palette: Palette
) -> tuple[RGB, float]:
    """The palette colour carrying most overlap area once each source pixel is snapped."""
    weights: dict[RGB, float] = {}
    total = 0.0
    for r, g, b, w in _rect_pixels(source, xa, xb, ya, yb):
        colour = snap_to_palette((r, g, b), palette)
        weights[colour] = weights.get(colour, 0.0) + w
        total += w
    if not weights:
        return palette.colours[0], 0.0
    order = {c: i for i, c in enumerate(palette.colours)}
    best = max(weights, key=lambda c: (weights[c], -order[c]))
    return best, total / ((xb - xa) * (yb - ya))


def kcentroid_rect(
    source: Raster, xa: float, xb: float, ya: float, yb: float, palette: Palette, k: int = 3
) -> tuple[RGB, float]:
    """k-means over the rectangle's opaque pixels in OKLab; the heaviest cluster's mean, snapped."""
    weights: dict[tuple[int, int, int], float] = {}
    total = 0.0
    for r, g, b, w in _rect_pixels(source, xa, xb, ya, yb):
        key = (r, g, b)
        weights[key] = weights.get(key, 0.0) + w
        total += w
    if not weights:
        return palette.colours[0], 0.0
    coverage = total / ((xb - xa) * (yb - ya))
    colours = sorted(weights, key=lambda c: (-weights[c], c))
    labs = {c: oklab(c) for c in colours}
    centres = [labs[colours[0]]]
    while len(centres) < min(k, len(colours)):
        farthest = max(colours, key=lambda c: (min(_distance(labs[c], m) for m in centres), -colours.index(c)))
        if min(_distance(labs[farthest], m) for m in centres) == 0.0:
            break
        centres.append(labs[farthest])
    assignment: dict[tuple[int, int, int], int] = {}
    for _ in range(8):
        assignment = {
            c: min(range(len(centres)), key=lambda i: (_distance(labs[c], centres[i]), i)) for c in colours
        }
        updated: list[Lab] = []
        for index in range(len(centres)):
            members = [c for c in colours if assignment[c] == index]
            mass = sum(weights[c] for c in members)
            if not members:
                updated.append(centres[index])
                continue
            updated.append(
                tuple(sum(labs[c][axis] * weights[c] for c in members) / mass for axis in range(3))  # type: ignore[arg-type]
            )
        if updated == centres:
            break
        centres = updated
    cluster_mass = [sum(weights[c] for c in colours if assignment[c] == i) for i in range(len(centres))]
    dominant = max(range(len(centres)), key=lambda i: (cluster_mass[i], -i))
    members = [c for c in colours if assignment[c] == dominant]
    mass = sum(weights[c] for c in members)
    mean = tuple(sum(c[axis] * weights[c] for c in members) / mass for axis in range(3))
    return snap_to_palette(mean, palette), coverage  # type: ignore[arg-type]


# --- foreground -------------------------------------------------------------------


def corner_key(source: Raster) -> RGB:
    corners = [
        source.pixel(0, 0),
        source.pixel(source.width - 1, 0),
        source.pixel(0, source.height - 1),
        source.pixel(source.width - 1, source.height - 1),
    ]
    return tuple(sum(p[c] for p in corners) // 4 for c in range(3))  # type: ignore[return-value]


def key_foreground(source: Raster, tolerance: int, key: RGB | None = None) -> tuple[Raster, RGB]:
    """Border-connected pixels within `tolerance` (RGB Euclidean) of the key become transparent."""
    key = key if key is not None else corner_key(source)
    limit = tolerance * tolerance
    width, height = source.width, source.height
    rgba = source.rgba
    seen = bytearray(width * height)
    stack = [(x, 0) for x in range(width)] + [(x, height - 1) for x in range(width)]
    stack += [(0, y) for y in range(1, height - 1)] + [(width - 1, y) for y in range(1, height - 1)]
    while stack:
        x, y = stack.pop()
        index = y * width + x
        if seen[index]:
            continue
        at = index * 4
        if (rgba[at] - key[0]) ** 2 + (rgba[at + 1] - key[1]) ** 2 + (rgba[at + 2] - key[2]) ** 2 > limit:
            continue
        seen[index] = 1
        if x:
            stack.append((x - 1, y))
        if x + 1 < width:
            stack.append((x + 1, y))
        if y:
            stack.append((x, y - 1))
        if y + 1 < height:
            stack.append((x, y + 1))
    out = bytearray(rgba)
    for index in range(width * height):
        out[index * 4 + 3] = 0 if seen[index] else 255
    return Raster(width, height, bytes(out)), key


def drop_specks(source: Raster, min_fraction: float) -> tuple[Raster, int]:
    """Removes 4-connected opaque components smaller than `min_fraction` of the largest; returns the count removed."""
    width, height = source.width, source.height
    label = [0] * (width * height)
    sizes: list[int] = [0]
    for start in range(width * height):
        if label[start] or not source.rgba[start * 4 + 3]:
            continue
        sizes.append(0)
        mark = len(sizes) - 1
        stack = [start]
        label[start] = mark
        while stack:
            index = stack.pop()
            sizes[mark] += 1
            x, y = index % width, index // width
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < width and 0 <= ny < height:
                    n = ny * width + nx
                    if not label[n] and source.rgba[n * 4 + 3]:
                        label[n] = mark
                        stack.append(n)
    if len(sizes) == 1:
        return source, 0
    floor = max(sizes) * min_fraction
    dropped = {m for m, size in enumerate(sizes) if m and size < floor}
    out = bytearray(source.rgba)
    for index, mark in enumerate(label):
        if mark in dropped:
            out[index * 4 + 3] = 0
    return Raster(width, height, bytes(out)), len(dropped)


def foreground_bbox(source: Raster) -> tuple[int, int, int, int]:
    alpha = source.rgba[3::4]
    width = source.width
    top = bottom = None
    left, right = width, 0
    for y in range(source.height):
        row = alpha[y * width : (y + 1) * width]
        stripped = row.lstrip(b"\x00")
        if not stripped:
            continue
        if top is None:
            top = y
        bottom = y
        left = min(left, width - len(stripped))
        right = max(right, len(row.rstrip(b"\x00")))
    if top is None or bottom is None:
        raise ValueError("image has no opaque pixels")
    return left, top, right, bottom + 1


def _band_extent(source: Raster, rows: range) -> tuple[int, int]:
    alpha = source.rgba[3::4]
    width = source.width
    low, high = width, 0
    for y in rows:
        row = alpha[y * width : (y + 1) * width]
        stripped = row.lstrip(b"\x00")
        if stripped:
            low = min(low, width - len(stripped))
            high = max(high, len(row.rstrip(b"\x00")))
    return low, high


# --- downscale ------------------------------------------------------------------------


def downscale_figure(
    source: Raster,
    method: str,
    height: int,
    palette: Palette,
    bbox: tuple[int, int, int, int] | None = None,
    k: int = 3,
) -> Raster:
    """Samples the foreground onto a grid of `height` rows at scale height/figure_height, any real ratio.

    Each output pixel covers one source rectangle anchored at the bounding box's left and top edges.
    """
    x0, y0, x1, y1 = bbox if bbox is not None else foreground_bbox(source)
    figure_h = y1 - y0
    scale = height / figure_h
    step = 1 / scale
    columns = max(1, int(math.ceil((x1 - x0) * scale - 1e-9)))
    out = bytearray(columns * height * 4)
    for j in range(height):
        ya, yb = y0 + j * step, y0 + (j + 1) * step
        for i in range(columns):
            xa, xb = x0 + i * step, x0 + (i + 1) * step
            if method == "area":
                mean, coverage = area_average_rect(source, xa, xb, ya, yb)
                colour = snap_to_palette(mean, palette) if coverage else palette.colours[0]
            elif method == "kcentroid":
                colour, coverage = kcentroid_rect(source, xa, xb, ya, yb, palette, k)
            elif method == "mode":
                colour, coverage = mode_rect(source, xa, xb, ya, yb, palette)
            else:
                raise ValueError(f"unknown method {method!r}")
            if coverage_alpha(coverage):
                at = (j * columns + i) * 4
                out[at : at + 4] = bytes((*colour, 255))
    return Raster(columns, height, bytes(out))


# --- outline, placement, measurement -----------------------------------------------------


def _opaque_bbox(image: Raster) -> tuple[int, int, int, int]:
    return foreground_bbox(image)


def feet_midpoint_edge(image: Raster) -> float:
    """Midpoint of the opaque width over the figure's lowest two rows, in pixel-edge coordinates."""
    _, _, _, y1 = _opaque_bbox(image)
    low, high = _band_extent(image, range(max(0, y1 - 2), y1))
    return (low + high) / 2


def place_feet(image: Raster, cell: tuple[int, int] = CELL) -> Raster:
    """Soles on row 78 (the outline then sits on row 79), feet midpoint nearest the pivot at x=32."""
    cell_w, cell_h = cell
    x0, y0, x1, y1 = _opaque_bbox(image)
    width, height = x1 - x0, y1 - y0
    if height + OUTLINE_PX > cell_h or width + OUTLINE_PX > cell_w:
        raise ValueError(f"{width}x{height} figure with outline does not fit the {cell_w}x{cell_h} cell")
    shift = int(math.floor(PIVOT_X - feet_midpoint_edge(image) + 0.5))
    new_x0 = max(1, min(cell_w - 1 - width, x0 + shift))
    new_y0 = SOLE_ROW - height + 1
    out = bytearray(cell_w * cell_h * 4)
    for y in range(height):
        src = ((y0 + y) * image.width + x0) * 4
        dst = ((new_y0 + y) * cell_w + new_x0) * 4
        out[dst : dst + width * 4] = image.rgba[src : src + width * 4]
    return Raster(cell_w, cell_h, bytes(out))


def _exterior(image: Raster) -> bytearray:
    width, height = image.width, image.height
    seen = bytearray(width * height)
    stack = [
        (x, y)
        for y in range(height)
        for x in range(width)
        if x in (0, width - 1) or y in (0, height - 1)
    ]
    while stack:
        x, y = stack.pop()
        index = y * width + x
        if seen[index] or image.rgba[index * 4 + 3]:
            continue
        seen[index] = 1
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height:
                stack.append((nx, ny))
    return seen


def add_outline(image: Raster, palette: Palette) -> Raster:
    """1 px exterior outline, 4-connected: each outline pixel takes the darkest shade of the ramp of its darkest adjacent pixel."""
    width, height = image.width, image.height
    exterior = _exterior(image)
    out = bytearray(image.rgba)
    for y in range(height):
        for x in range(width):
            if not exterior[y * width + x]:
                continue
            neighbours = []
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < width and 0 <= ny < height:
                    at = (ny * width + nx) * 4
                    if image.rgba[at + 3]:
                        neighbours.append(tuple(image.rgba[at : at + 3]))
            if not neighbours:
                continue
            darkest = min(neighbours, key=lambda c: (oklab(c)[0], c))
            ramp = palette.ramp_of.get(darkest)  # type: ignore[arg-type]
            if ramp is None:
                ramp = palette.ramp_of[snap_to_palette(darkest, palette)]
            at = (y * width + x) * 4
            out[at : at + 4] = bytes((*palette.darkest[ramp], 255))
    return Raster(width, height, bytes(out))


def measure(image: Raster, palette: Palette, interior: Raster | None = None) -> dict:
    """Facts about a finished cell. `interior` is the same cell before the outline, which the foot midpoint is read from."""
    x0, y0, x1, y1 = _opaque_bbox(image)
    colours = Counter(
        tuple(image.rgba[at : at + 3]) for at in range(0, len(image.rgba), 4) if image.rgba[at + 3]
    )
    exterior = _exterior(image)
    width, height = image.width, image.height
    boundary = []
    for y in range(height):
        for x in range(width):
            at = (y * width + x) * 4
            if not image.rgba[at + 3]:
                continue
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if not (0 <= nx < width and 0 <= ny < height) or exterior[ny * width + nx]:
                    boundary.append(tuple(image.rgba[at : at + 3]))
                    break
    shades = set(palette.darkest.values())
    return {
        "height": y1 - y0,
        "width": x1 - x0,
        "bottom_row": y1 - 1,
        "colours": len(colours),
        "palette_entries": sorted(colours),
        "outside_palette": sum(1 for c in colours if c not in palette.ramp_of),
        "outline": bool(boundary) and all(c in shades for c in boundary),
        "foot_midpoint": feet_midpoint_edge(interior if interior is not None else image),
    }


# --- ground cleanup and anatomical soles ---------------------------------------------------


def keep_largest_component(source: Raster, min_size: int) -> tuple[Raster, list[dict]]:
    """Keeps the largest 8-connected opaque component; every other component smaller than `min_size`
    pixels is made transparent. Returns the raster and one record per removed component."""
    width, height = source.width, source.height
    label = [0] * (width * height)
    boxes: list[tuple[int, int, int, int, int]] = []
    for start in range(width * height):
        if label[start] or not source.rgba[start * 4 + 3]:
            continue
        mark = len(boxes) + 1
        stack = [start]
        label[start] = mark
        size, x0, y0, x1, y1 = 0, width, height, 0, 0
        while stack:
            index = stack.pop()
            size += 1
            x, y = index % width, index // width
            x0, y0, x1, y1 = min(x0, x), min(y0, y), max(x1, x + 1), max(y1, y + 1)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nx, ny = x + dx, y + dy
                    if (dx or dy) and 0 <= nx < width and 0 <= ny < height:
                        n = ny * width + nx
                        if not label[n] and source.rgba[n * 4 + 3]:
                            label[n] = mark
                            stack.append(n)
        boxes.append((size, x0, y0, x1, y1))
    if not boxes:
        return source, []
    largest = max(range(len(boxes)), key=lambda i: (boxes[i][0], -i)) + 1
    dropped = {
        i + 1 for i, b in enumerate(boxes) if i + 1 != largest and b[0] < min_size
    }
    out = bytearray(source.rgba)
    for index, mark in enumerate(label):
        if mark in dropped:
            out[index * 4 + 3] = 0
    removed = [
        {"pixels": boxes[m - 1][0], "box": list(boxes[m - 1][1:])} for m in sorted(dropped)
    ]
    return Raster(width, height, bytes(out)), removed


def clear_colour_in_rows(
    source: Raster, key: RGB, tolerance: int, from_row: int
) -> tuple[Raster, int]:
    """Makes opaque pixels within `tolerance` (RGB Euclidean) of `key` transparent on rows >= from_row."""
    limit = tolerance * tolerance
    out = bytearray(source.rgba)
    cleared = 0
    for y in range(from_row, source.height):
        for x in range(source.width):
            at = (y * source.width + x) * 4
            if out[at + 3] and (
                (out[at] - key[0]) ** 2 + (out[at + 1] - key[1]) ** 2 + (out[at + 2] - key[2]) ** 2
            ) <= limit:
                out[at + 3] = 0
                cleared += 1
    return Raster(source.width, source.height, bytes(out)), cleared


def clear_light_grey_in_rows(
    source: Raster, max_spread: int, min_luma: int, from_row: int
) -> tuple[Raster, int]:
    """Makes opaque low-chroma light pixels transparent on rows >= from_row: the fringe a ground shadow
    leaves between its own colour and the background. Chroma is the spread of the channels; luma is Rec. 601."""
    out = bytearray(source.rgba)
    cleared = 0
    for y in range(from_row, source.height):
        for x in range(source.width):
            at = (y * source.width + x) * 4
            if not out[at + 3]:
                continue
            r, g, b = out[at], out[at + 1], out[at + 2]
            if max(r, g, b) - min(r, g, b) <= max_spread and 0.299 * r + 0.587 * g + 0.114 * b >= min_luma:
                out[at + 3] = 0
                cleared += 1
    return Raster(source.width, source.height, bytes(out)), cleared


def sole_clusters(image: Raster, band_rows: int, min_gap: int) -> list[dict]:
    """Foot clusters in the lowest `band_rows` rows of the figure: columns occupied in the band, joined
    when the gap between them is under `min_gap`. Each has its x range (half-open), its lowest row and its centre."""
    x0, y0, x1, y1 = foreground_bbox(image)
    top = max(y0, y1 - band_rows)
    columns = [
        x for x in range(image.width) if any(image.rgba[(y * image.width + x) * 4 + 3] for y in range(top, y1))
    ]
    groups: list[list[int]] = []
    for x in columns:
        if groups and x - groups[-1][-1] <= min_gap:
            groups[-1].append(x)
        else:
            groups.append([x])
    clusters = []
    for group in groups:
        lo, hi = group[0], group[-1] + 1
        rows = [
            y for y in range(top, y1) if any(image.rgba[(y * image.width + x) * 4 + 3] for x in range(lo, hi))
        ]
        clusters.append({"x0": lo, "x1": hi, "bottom_row": max(rows), "centre": (lo + hi) / 2})
    return clusters


def sole_midpoint(image: Raster, band_rows: int, min_gap: int) -> float:
    """Midpoint between the two soles: the mean of the two foot clusters' centres (the outer two if more)."""
    clusters = sole_clusters(image, band_rows, min_gap)
    if len(clusters) < 2:
        raise ValueError(f"expected two foot clusters, found {len(clusters)}")
    return (clusters[0]["centre"] + clusters[-1]["centre"]) / 2


def place_by_soles(image: Raster, cell: tuple[int, int] = CELL, band_rows: int = 2, min_gap: int = 2) -> Raster:
    """Like `place_feet`, but the midpoint between the two soles, not the figure's extent, goes to x=32."""
    cell_w, cell_h = cell
    x0, y0, x1, y1 = foreground_bbox(image)
    width, height = x1 - x0, y1 - y0
    if height + OUTLINE_PX > cell_h or width + OUTLINE_PX > cell_w:
        raise ValueError(f"{width}x{height} figure with outline does not fit the {cell_w}x{cell_h} cell")
    shift = int(math.floor(PIVOT_X - sole_midpoint(image, band_rows, min_gap) + 0.5))
    new_x0 = max(1, min(cell_w - 1 - width, x0 + shift))
    new_y0 = SOLE_ROW - height + 1
    out = bytearray(cell_w * cell_h * 4)
    for y in range(height):
        src = ((y0 + y) * image.width + x0) * 4
        dst = ((new_y0 + y) * cell_w + new_x0) * 4
        out[dst : dst + width * 4] = image.rgba[src : src + width * 4]
    return Raster(cell_w, cell_h, bytes(out))

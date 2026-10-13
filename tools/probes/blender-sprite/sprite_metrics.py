"""Pure measurements for the Blender sprite probe: palette-index maps, flicker, jitter. Standard library only."""

from __future__ import annotations

import math
import sys
from collections.abc import Sequence
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "art-edit"))

from pipeline import Raster  # noqa: E402

TRANSPARENT = -1
OFF_PALETTE = -2


def index_map(image: Raster, colours: Sequence[tuple[int, int, int]]) -> list[int]:
    """Per-pixel palette index: -1 transparent, -2 opaque but not an exact palette entry."""
    lookup = {c: i for i, c in enumerate(colours)}
    out: list[int] = []
    rgba = image.rgba
    for at in range(0, len(rgba), 4):
        if rgba[at + 3] == 0:
            out.append(TRANSPARENT)
        else:
            out.append(lookup.get((rgba[at], rgba[at + 1], rgba[at + 2]), OFF_PALETTE))
    return out


def silhouette_xor(a: Sequence[int], b: Sequence[int]) -> int:
    """Pixels opaque in exactly one of two index maps."""
    return sum(1 for x, y in zip(a, b, strict=True) if (x == TRANSPARENT) != (y == TRANSPARENT))


def flicker_pair(a: Sequence[int], b: Sequence[int], width: int, height: int) -> dict:
    """Palette-index changes between two frames, counted only where the silhouette has not moved.

    A pixel is silhouette-stable when it and its eight neighbours have the same opaque/transparent state in both
    frames. `changed_stable` counts stable opaque pixels whose palette index differs; it is the flicker. `exact_static`
    says the two silhouettes are identical outright.
    """
    if len(a) != width * height or len(b) != width * height:
        raise ValueError("index maps do not match the stated size")
    opaque_a = [v != TRANSPARENT for v in a]
    opaque_b = [v != TRANSPARENT for v in b]
    same = [x == y for x, y in zip(opaque_a, opaque_b, strict=True)]
    stable_opaque = 0
    changed_stable = 0
    changed_any = 0
    opaque_both = 0
    for y in range(height):
        for x in range(width):
            i = y * width + x
            if not (opaque_a[i] and opaque_b[i]):
                continue
            opaque_both += 1
            differs = a[i] != b[i]
            changed_any += differs
            if all(
                same[ny * width + nx]
                for ny in range(max(0, y - 1), min(height, y + 2))
                for nx in range(max(0, x - 1), min(width, x + 2))
            ):
                stable_opaque += 1
                changed_stable += differs
    return {
        "opaque_both": opaque_both,
        "changed_any": changed_any,
        "stable_opaque": stable_opaque,
        "changed_stable": changed_stable,
        "silhouette_xor": silhouette_xor(a, b),
        "exact_static": silhouette_xor(a, b) == 0,
    }


def flicker_series(maps: Sequence[Sequence[int]], width: int, height: int, loop: bool) -> dict:
    """Flicker over consecutive frame pairs of one clip and facing; a loop also pairs last with first."""
    if len(maps) < 2:
        return {"pairs": 0, "changed_stable": 0, "stable_opaque": 0, "changed_any": 0, "opaque_both": 0, "exact_static_pairs": 0, "exact_static_changed": 0, "per_pair": []}
    order = list(range(len(maps) - 1)) + ([len(maps) - 1] if loop and len(maps) > 2 else [])
    per_pair = []
    for i in order:
        j = (i + 1) % len(maps)
        per_pair.append(flicker_pair(maps[i], maps[j], width, height))
    return {
        "pairs": len(per_pair),
        "changed_stable": sum(p["changed_stable"] for p in per_pair),
        "stable_opaque": sum(p["stable_opaque"] for p in per_pair),
        "changed_any": sum(p["changed_any"] for p in per_pair),
        "opaque_both": sum(p["opaque_both"] for p in per_pair),
        "exact_static_pairs": sum(1 for p in per_pair if p["exact_static"]),
        "exact_static_changed": sum(p["changed_any"] for p in per_pair if p["exact_static"]),
        "per_pair": per_pair,
    }


def range_stats(values: Sequence[float]) -> dict:
    """min, max, peak-to-peak and population standard deviation of a series."""
    if not values:
        raise ValueError("no values")
    mean = sum(values) / len(values)
    return {
        "min": round(min(values), 4),
        "max": round(max(values), 4),
        "range": round(max(values) - min(values), 4),
        "std": round(math.sqrt(sum((v - mean) ** 2 for v in values) / len(values)), 4),
    }


def jitter(points: Sequence[Sequence[float]]) -> dict:
    """Spread of a series of (x, y) pixel positions: per-axis stats and the largest distance between any two."""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return {
        "x": range_stats(xs),
        "y": range_stats(ys),
        "max_pair_distance": round(max(math.dist(p, q) for p in points for q in points), 4),
    }


def component_sizes(indices: Sequence[int], width: int, height: int) -> list[int]:
    """Sizes of 8-connected opaque components, largest first."""
    seen = [False] * (width * height)
    sizes: list[int] = []
    for start in range(width * height):
        if seen[start] or indices[start] == TRANSPARENT:
            continue
        seen[start] = True
        stack = [start]
        size = 0
        while stack:
            i = stack.pop()
            size += 1
            x, y = i % width, i // width
            for ny in range(max(0, y - 1), min(height, y + 2)):
                for nx in range(max(0, x - 1), min(width, x + 2)):
                    n = ny * width + nx
                    if not seen[n] and indices[n] != TRANSPARENT:
                        seen[n] = True
                        stack.append(n)
        sizes.append(size)
    return sorted(sizes, reverse=True)


def isolated_pixels(indices: Sequence[int], width: int, height: int) -> int:
    """Opaque pixels with no opaque 4-neighbour: the single-pixel specks the art guide forbids."""
    count = 0
    for y in range(height):
        for x in range(width):
            if indices[y * width + x] == TRANSPARENT:
                continue
            neighbours = ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
            if not any(
                0 <= nx < width and 0 <= ny < height and indices[ny * width + nx] != TRANSPARENT for nx, ny in neighbours
            ):
                count += 1
    return count


def mirror_x(indices: Sequence[int], width: int, height: int) -> list[int]:
    """Horizontal mirror of an index map about the cell's vertical centre line (the pivot column)."""
    out: list[int] = []
    for y in range(height):
        row = indices[y * width : (y + 1) * width]
        out.extend(reversed(row))
    return out

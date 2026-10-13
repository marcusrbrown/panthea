"""Selective overlap outlines from a part-ID pass and a depth pass. Pure; no IO.

A line is a 1 px outline pixel on the FARTHER side of a boundary where two different parts meet and the depth
jumps (arm over torso, beard over chest, robe over leg). It is drawn only when the two sides would otherwise
read as one shape, and always in the darkest shade of the far pixel's own ramp.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence

Rgb = tuple[int, int, int]


def candidate_lines(
    parts: Sequence[str | None], depth: Sequence[float], width: int, height: int, threshold: float
) -> dict[int, int]:
    """Far pixel index -> the nearer pixel index it sits behind, for every 4-neighbour pair of different parts
    whose depth differs by more than `threshold` (metres). Transparent pixels have part None."""
    out: dict[int, tuple[float, int]] = {}
    for y in range(height):
        for x in range(width):
            p = y * width + x
            if parts[p] is None:
                continue
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if not (0 <= nx < width and 0 <= ny < height):
                    continue
                q = ny * width + nx
                if parts[q] is None or parts[q] == parts[p]:
                    continue
                gap = depth[q] - depth[p]  # q farther than p
                if gap > threshold and (q not in out or gap > out[q][0]):
                    out[q] = (gap, p)
    return {far: near for far, (_, near) in out.items()}


def needs_line(
    far: Rgb,
    near: Rgb,
    ramp_of: dict[Rgb, str],
    darkest: dict[str, Rgb],
    lightness: Callable[[Rgb], float],
    min_contrast: float = 0.12,
) -> bool:
    """A line is necessary only when the far pixel is not already its ramp's darkest shade and the two sides are
    not clearly different (different ramp and a lightness gap of at least `min_contrast`)."""
    ramp_far, ramp_near = ramp_of.get(far), ramp_of.get(near)
    if ramp_far is None or far == darkest.get(ramp_far):
        return False
    if ramp_far != ramp_near:
        return abs(lightness(far) - lightness(near)) < min_contrast
    return True


def apply_lines(
    pixels: Sequence[Rgb | None],
    lines: dict[int, int],
    ramp_of: dict[Rgb, str],
    darkest: dict[str, Rgb],
    lightness: Callable[[Rgb], float],
    min_contrast: float = 0.12,
) -> tuple[list[Rgb | None], list[int]]:
    """Recolour the needed far pixels; returns the new pixels and the indices that were drawn."""
    out = list(pixels)
    drawn = []
    for far, near in lines.items():
        f, n = pixels[far], pixels[near]
        if f is None or n is None:
            continue
        if needs_line(f, n, ramp_of, darkest, lightness, min_contrast):
            out[far] = darkest[ramp_of[f]]
            drawn.append(far)
    return out, sorted(drawn)

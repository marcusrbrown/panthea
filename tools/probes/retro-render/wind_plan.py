"""Seamless wind loop for a rigid-ish prop (a tree): weighted sinusoidal displacement that rises toward the canopy.

Pure, standard library only. Frame `f` of an `n`-frame loop has phase 2*pi*f/n; the duplicate endpoint (frame n, which is
frame 0 again) is not rendered. `displacement` takes the *unreduced* frame number so tests (and the render's seam check) can
evaluate frame n directly and compare it with frame 0.
"""

from __future__ import annotations

import math

TWO_PI = 2.0 * math.pi


def phase(frame: float, frames: int) -> float:
    return TWO_PI * frame / frames


def sway_weight(h_rel: float, power: float = 2.0) -> float:
    """0 at the base, 1 at the top, growing as h^power so the trunk stays put and the canopy moves most."""
    return min(1.0, max(0.0, h_rel)) ** power


def displacement(
    x: float,
    y: float,
    z: float,
    height: float,
    frame: float,
    frames: int,
    amplitude: float,
    lag: float = 1.2,
    cycles: int = 1,
    swirl: float = 0.45,
) -> tuple[float, float, float]:
    """World displacement of a vertex at rest position (x, y, z) in a tree of `height`.

    The sway is a travelling wave up the tree (phase lag `lag` radians per unit of relative height, so the crown lags the
    trunk), an integer number of `cycles` per loop so the end meets the start, weighted by height squared, with a
    quadrature component on y (`swirl`) so the crown traces a small ellipse rather than a line. A small downward term keeps
    branch length roughly constant.
    """
    w = sway_weight(z / height) if height > 0 else 0.0
    p = cycles * phase(frame, frames) - lag * (z / height if height > 0 else 0.0)
    dx = amplitude * w * math.sin(p)
    dy = amplitude * w * swirl * math.sin(p + math.pi / 2.0)
    dz = -(dx * dx + dy * dy) / (2.0 * max(z, 1e-6)) if z > 1e-6 else 0.0
    return (dx, dy, dz)


def loop_frames(n: int) -> list[int]:
    """Frames to render: 0..n-1. The endpoint n duplicates frame 0 and is excluded."""
    return list(range(n))


def timing_ms(n: int, total_ms: int = 2000) -> list[int]:
    """Per-frame hold times summing exactly to `total_ms`."""
    base, extra = divmod(total_ms, n)
    return [base + (1 if i < extra else 0) for i in range(n)]

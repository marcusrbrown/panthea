"""Corrected repair estimate (round 3). Pure; the repairs are estimated, never applied.

Differences from repairs.py (round 2), after the audit:
1. The bolt is an authored stamp, so its pixels are not repair pixels; `bolt_shape` checks only its own shape.
2. Temporal blips count a pixel only when its 3x3 neighbourhood has the same opacity in frames n-1, n and n+1 and its
   palette index differs from both neighbours, which agree with each other.
3. Every kind returns a set of unique (x, y) pixels; a cell's estimate is the size of the union, not the sum.
4. Visibility measures (leg visibility, border contact, bolt adjacency) are reported separately, outside the total.

Pixels are (x, y) tuples so that a stamp pixel that was hidden or clipped can still be counted in cell coordinates.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence

import sprite_metrics as sm

Pixel = tuple[int, int]
MAX_HEIGHT = 56
MIN_VISIBLE_FRACTION = 0.6
BOLT_ADJACENT_PARTS = ("head", "hair", "beard", "robe_upper", "robe_skirt", "belt")
LEG_FLOORS = {"walk": 40, "sit": 30}

STABLE_KINDS = ("temporal_blips", "bottom_crop", "over_height", "isolated_pixels", "bolt_shape", "colour_budget", "anchor")


def _xy(i: int, width: int) -> Pixel:
    return (i % width, i // width)


def stable_triplet_blips(prev: Sequence[int], cur: Sequence[int], nxt: Sequence[int], width: int, height: int) -> set[Pixel]:
    """Pixels of `cur` that flash for one frame: opaque, 3x3 opacity identical in all three frames, and the index
    differs from both neighbours, which agree with each other."""
    stable_state = [(a == sm.TRANSPARENT) == (b == sm.TRANSPARENT) == (c == sm.TRANSPARENT) for a, b, c in zip(prev, cur, nxt, strict=True)]
    out: set[Pixel] = set()
    for y in range(height):
        for x in range(width):
            i = y * width + x
            if cur[i] == sm.TRANSPARENT or not (prev[i] == nxt[i] != cur[i]):
                continue
            if all(
                stable_state[ny * width + nx]
                for ny in range(max(0, y - 1), min(height, y + 2))
                for nx in range(max(0, x - 1), min(width, x + 2))
            ):
                out.add((x, y))
    return out


def stable_triplet_count(prev: Sequence[int], cur: Sequence[int], nxt: Sequence[int], width: int, height: int) -> int:
    """How many pixels of `cur` had the triplet-stable neighbourhood (the denominator of the blip rate)."""
    stable_state = [(a == sm.TRANSPARENT) == (b == sm.TRANSPARENT) == (c == sm.TRANSPARENT) for a, b, c in zip(prev, cur, nxt, strict=True)]
    count = 0
    for y in range(height):
        for x in range(width):
            if cur[y * width + x] == sm.TRANSPARENT:
                continue
            if all(
                stable_state[ny * width + nx]
                for ny in range(max(0, y - 1), min(height, y + 2))
                for nx in range(max(0, x - 1), min(width, x + 2))
            ):
                count += 1
    return count


def bottom_crop(colours: Sequence, darkest: set, extent_bottom: float, width: int, height: int) -> set[Pixel]:
    """The figure or seat reaches past the bottom edge: the outline row holds cut-off pixels (any that are not outline shade)."""
    if extent_bottom <= height:
        return set()
    row = height - 1
    return {(x, row) for x in range(width) if colours[row * width + x] is not None and colours[row * width + x] not in darkest}


def over_height(indices: Sequence[int], width: int, height: int, limit: int = MAX_HEIGHT) -> set[Pixel]:
    rows = [y for y in range(height) if any(indices[y * width + x] != sm.TRANSPARENT for x in range(width))]
    if not rows or rows[-1] - rows[0] + 1 <= limit:
        return set()
    extra = rows[-1] - rows[0] + 1 - limit
    return {(x, y) for y in rows[:extra] for x in range(width) if indices[y * width + x] != sm.TRANSPARENT}


def isolated(indices: Sequence[int], width: int, height: int) -> set[Pixel]:
    out: set[Pixel] = set()
    for y in range(height):
        for x in range(width):
            if indices[y * width + x] == sm.TRANSPARENT:
                continue
            if not any(
                0 <= nx < width and 0 <= ny < height and indices[ny * width + nx] != sm.TRANSPARENT
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
            ):
                out.add((x, y))
    return out


def bolt_shape(all_xy: set[Pixel], drawn_xy: set[Pixel], clipped: int, hand_before: int, hand_after: int) -> tuple[set[Pixel], dict]:
    """Check the stamp's own shape. Repair pixels are the stamp pixels that did not survive (hidden, clipped or kept off
    the hand), and only when the stamp fails: under 60% visible, any clipped by the cell, or the hand lost pixels."""
    fraction = len(drawn_xy) / len(all_xy) if all_xy else 0.0
    failing = fraction < MIN_VISIBLE_FRACTION or clipped > 0 or hand_after < hand_before
    lost = (all_xy - drawn_xy) if failing else set()
    return lost, {"visible_fraction": round(fraction, 3), "clipped": clipped, "hand_px_before": hand_before, "hand_px_after": hand_after, "fails": failing}


def visibility_measures(clip: str, parts: Sequence[str | None], stamp_xy: set[Pixel], width: int, height: int) -> dict:
    """Reported separately, never in the repair total."""
    legs = sum(1 for p in parts if p in ("leg_l", "leg_r"))
    floor = LEG_FLOORS.get(clip)
    border = sum(1 for i, p in enumerate(parts) if p is not None and (i % width in (0, width - 1) or i // width == 0))
    adjacent = 0
    for (x, y) in stamp_xy:
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height and parts[ny * width + nx] in BOLT_ADJACENT_PARTS:
                adjacent += 1
                break
    return {
        "leg_px": legs,
        "legs_hidden_short_by": max(0, floor - legs) if floor else 0,
        "border_contact_px": border,
        "bolt_adjacent_to_head_or_robe_px": adjacent,
    }


def union_estimate(kinds: dict[str, set[Pixel]]) -> dict:
    union: set[Pixel] = set()
    for pixels in kinds.values():
        union |= pixels
    return {"pixels": len(union), "by_kind": {k: len(v) for k, v in kinds.items() if v}, "sum_of_kinds": sum(len(v) for v in kinds.values())}


def averages(per_cell: Sequence[tuple[str, int]]) -> dict:
    """(clip, pixels) per cell -> overall and per-clip mean over all cells, flagged or not."""
    total = sum(p for _, p in per_cell)
    clips: dict[str, list[int]] = {}
    for clip, p in per_cell:
        clips.setdefault(clip, []).append(p)
    return {
        "cells": len(per_cell),
        "mean_per_cell": round(total / len(per_cell), 2) if per_cell else 0.0,
        "mean_per_clip": {c: round(sum(v) / len(v), 2) for c, v in clips.items()},
        "total": total,
    }


def sparse_verdict(avg: dict, per_cell_max: float = 15.0, per_clip_max: float = 30.0) -> dict:
    worst_clip = max(avg["mean_per_clip"].values(), default=0.0)
    return {
        "mean_per_cell_ok": avg["mean_per_cell"] <= per_cell_max,
        "clips_ok": worst_clip <= per_clip_max,
        "pass": avg["mean_per_cell"] <= per_cell_max and worst_clip <= per_clip_max,
    }

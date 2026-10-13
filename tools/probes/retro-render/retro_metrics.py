"""Pure measurements for the retro-render probe: boil (noise versus motion), loop seams, cell facts. Standard library only.

An index map is a list with one palette index per pixel, `TRANSPARENT` (-1) where the pixel is empty. A parts map has the
part name per pixel or None. Boil is information only, never a gate.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence

TRANSPARENT = -1
STILL_IOU = 0.97  # a part whose mask overlaps its previous mask at least this much did not move


def _opaque(idx: int) -> bool:
    return idx != TRANSPARENT


def part_masks(parts: Sequence[str | None]) -> dict[str, set[int]]:
    masks: dict[str, set[int]] = {}
    for i, p in enumerate(parts):
        if p is not None:
            masks.setdefault(p, set()).add(i)
    return masks


def mask_iou(a: set[int], b: set[int]) -> float:
    if not a and not b:
        return 1.0
    return len(a & b) / len(a | b)


def stable_neighbourhood(a: Sequence[int], b: Sequence[int], x: int, y: int, width: int, height: int) -> bool:
    """True when the pixel and its 8 neighbours have the same opaque/transparent state in both frames."""
    for ny in range(max(0, y - 1), min(height, y + 2)):
        for nx in range(max(0, x - 1), min(width, x + 2)):
            k = ny * width + nx
            if _opaque(a[k]) != _opaque(b[k]):
                return False
    return True


def boil_pair(
    prev: Sequence[int],
    cur: Sequence[int],
    prev_parts: Sequence[str | None] | None,
    cur_parts: Sequence[str | None] | None,
    width: int,
    height: int,
) -> dict:
    """Index changes between two frames over silhouette-stable pixels, split by whether the pixel's part moved.

    A change inside a part that did not move (mask IoU >= STILL_IOU) is noise: shading or dither crawling over a static
    surface. A change inside a part that moved is motion. Pixels with no part (stamps, or an item without a part pass) are
    counted as `unclassified`.
    """
    still_parts: set[str] = set()
    moving_parts: set[str] = set()
    if prev_parts is not None and cur_parts is not None:
        a, b = part_masks(prev_parts), part_masks(cur_parts)
        for name in set(a) | set(b):
            (still_parts if mask_iou(a.get(name, set()), b.get(name, set())) >= STILL_IOU else moving_parts).add(name)
    out = {"stable_px": 0, "changed_px": 0, "noise_px": 0, "motion_px": 0, "unclassified_px": 0, "noise_stable_px": 0}
    for y in range(height):
        for x in range(width):
            k = y * width + x
            if not (_opaque(prev[k]) and _opaque(cur[k])):
                continue
            if not stable_neighbourhood(prev, cur, x, y, width, height):
                continue
            out["stable_px"] += 1
            part = cur_parts[k] if cur_parts is not None else None
            if part in still_parts:
                out["noise_stable_px"] += 1
            if prev[k] == cur[k]:
                continue
            out["changed_px"] += 1
            if part in still_parts:
                out["noise_px"] += 1
            elif part in moving_parts:
                out["motion_px"] += 1
            else:
                out["unclassified_px"] += 1
    return out


def boil_series(maps: Sequence[Sequence[int]], parts: Sequence[Sequence[str | None]] | None, width: int, height: int, loop: bool) -> dict:
    n = len(maps)
    pairs = [(i, (i + 1) % n) for i in range(n if loop else n - 1)]
    totals = Counter()
    for a, b in pairs:
        r = boil_pair(maps[a], maps[b], parts[a] if parts else None, parts[b] if parts else None, width, height)
        totals.update(r)
    d = dict(totals)
    d["pairs"] = len(pairs)
    d["changed_rate"] = round(d.get("changed_px", 0) / d["stable_px"], 4) if d.get("stable_px") else 0.0
    d["noise_rate_of_still"] = round(d.get("noise_px", 0) / d["noise_stable_px"], 4) if d.get("noise_stable_px") else 0.0
    return d


def pair_change(a: Sequence[int], b: Sequence[int]) -> float:
    """Fraction of pixels opaque in either frame whose opacity or palette index differs."""
    union = [(x, y) for x, y in zip(a, b, strict=True) if _opaque(x) or _opaque(y)]
    return sum(1 for x, y in union if x != y) / len(union) if union else 0.0


def loop_seam(maps: Sequence[Sequence[int]]) -> dict:
    """How the last-to-first step compares with the other steps of a loop: a ratio near 1 means no visible seam."""
    n = len(maps)
    steps = [pair_change(maps[i], maps[i + 1]) for i in range(n - 1)]
    wrap = pair_change(maps[-1], maps[0])
    mean = sum(steps) / len(steps) if steps else 0.0
    return {"frames": n, "mean_step_change": round(mean, 4), "wrap_change": round(wrap, 4), "wrap_ratio": round(wrap / mean, 3) if mean else None, "max_step_change": round(max(steps), 4) if steps else 0.0}


def identical(a: bytes, b: bytes) -> bool:
    return a == b


def bbox(indices: Sequence[int], width: int, height: int) -> tuple[int, int, int, int] | None:
    xs = [i % width for i, v in enumerate(indices) if _opaque(v)]
    ys = [i // width for i, v in enumerate(indices) if _opaque(v)]
    return (min(xs), min(ys), max(xs) + 1, max(ys) + 1) if xs else None


def rows_used(indices: Sequence[int], width: int, height: int) -> int:
    box = bbox(indices, width, height)
    return 0 if box is None else box[3] - box[1]


# --- shading instability on moving parts --------------------------------------------------------------------------------
# `boil_pair` labels every index change inside a part whose mask moved as "motion", so it cannot tell a limb sweeping across
# band edges from a surface whose shading flickers. This measure looks only at pixels where the same part is still the visible
# surface at about the same depth in both frames: there the geometry under the pixel barely changed, so an index change is
# shading (a surface turning through a band edge, or a band edge crawling), not a different thing arriving at the pixel.

DEPTH_SAME_M = 0.03  # surface depth difference below which two frames see "the same surface" at a pixel


def surface_pair(
    prev: Sequence[int],
    cur: Sequence[int],
    prev_parts: Sequence[str | None],
    cur_parts: Sequence[str | None],
    prev_depth: Sequence[float],
    cur_depth: Sequence[float],
    width: int,
    height: int,
    tol: float = DEPTH_SAME_M,
) -> dict:
    """Index changes on pixels whose part and depth did not change between two frames (silhouette-stable pixels only)."""
    moving = set()
    a, b = part_masks(prev_parts), part_masks(cur_parts)
    for name in set(a) | set(b):
        if mask_iou(a.get(name, set()), b.get(name, set())) < STILL_IOU:
            moving.add(name)
    out = {"persistent_px": 0, "changed_px": 0, "persistent_moving_px": 0, "changed_moving_px": 0}
    for y in range(height):
        for x in range(width):
            k = y * width + x
            if not (_opaque(prev[k]) and _opaque(cur[k])):
                continue
            if prev_parts[k] is None or prev_parts[k] != cur_parts[k] or abs(prev_depth[k] - cur_depth[k]) > tol:
                continue
            if not stable_neighbourhood(prev, cur, x, y, width, height):
                continue
            out["persistent_px"] += 1
            changed = prev[k] != cur[k]
            out["changed_px"] += changed
            if cur_parts[k] in moving:
                out["persistent_moving_px"] += 1
                out["changed_moving_px"] += changed
    return out


def surface_series(
    maps: Sequence[Sequence[int]],
    parts: Sequence[Sequence[str | None]],
    depths: Sequence[Sequence[float]],
    width: int,
    height: int,
    loop: bool,
) -> dict:
    n = len(maps)
    totals = Counter()
    pairs = [(i, (i + 1) % n) for i in range(n if loop else n - 1)]
    for i, j in pairs:
        totals.update(surface_pair(maps[i], maps[j], parts[i], parts[j], depths[i], depths[j], width, height))
    d = dict(totals)
    d["pairs"] = len(pairs)
    d["changed_rate"] = round(d.get("changed_px", 0) / d["persistent_px"], 4) if d.get("persistent_px") else 0.0
    d["changed_rate_moving"] = round(d.get("changed_moving_px", 0) / d["persistent_moving_px"], 4) if d.get("persistent_moving_px") else 0.0
    return d


# --- resampled clips --------------------------------------------------------------------------------------------------------
# A clip played at 8 and at 16 frames over the same time is one animation state sampled twice. Every coarse frame must be a fine
# frame: coarse[i] is fine[i * (fine_n / coarse_n)] at the same source time, in the same pose, so the images match pixel for pixel.


def resample_pairs(coarse_n: int, fine_n: int) -> list[tuple[int, int]]:
    """(coarse index, fine index) of the frames that sample the same source time. `fine_n` must be a multiple of `coarse_n`."""
    if coarse_n < 1 or fine_n < coarse_n or fine_n % coarse_n:
        raise ValueError("the fine clip must have a whole number of frames per coarse frame")
    k = fine_n // coarse_n
    return [(i, i * k) for i in range(coarse_n)]


def pixel_mismatches(a: bytes, b: bytes) -> int:
    """Number of pixels whose RGBA differs between two equally sized images (a size difference counts every pixel)."""
    if len(a) != len(b):
        return max(len(a), len(b)) // 4
    return sum(1 for i in range(0, len(a), 4) if a[i : i + 4] != b[i : i + 4])


def resample_report(pairs: Sequence[tuple[int, int]], coarse: dict[int, bytes], fine: dict[int, bytes], coarse_times: dict[int, float], fine_times: dict[int, float]) -> dict:
    """Per pair: same source time? how many pixels differ? Summarised as cells matching and total mismatching pixels."""
    rows = []
    for i, j in pairs:
        rows.append({"coarse": i, "fine": j, "same_time": abs(coarse_times[i] - fine_times[j]) < 1e-9, "pixels_differing": pixel_mismatches(coarse[i], fine[j])})
    return {
        "pairs": len(rows),
        "matching": sum(1 for r in rows if r["same_time"] and r["pixels_differing"] == 0),
        "mismatching": sum(1 for r in rows if not (r["same_time"] and r["pixels_differing"] == 0)),
        "wrong_time": sum(1 for r in rows if not r["same_time"]),
        "pixels_differing": sum(r["pixels_differing"] for r in rows),
        "rows": rows,
    }

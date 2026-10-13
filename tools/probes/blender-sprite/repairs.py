"""Detectors for frames that would need hand pixels. Pure; the repairs are logged, never applied.

Each detector returns {"kind", "pixels", "change", "why"} or None for one finished 64x80 cell, given its palette-index
map, its part map (None where transparent), and the set of pixels an overlap line was drawn on.
"""

from __future__ import annotations

from collections.abc import Sequence

import sprite_metrics as sm

MAX_HEIGHT = 56
MIN_BOLT_PX = 22
BOLT_TOUCH_LIMIT = 4
BLIP_LIMIT = 10
ISOLATED_LIMIT = 0
BOLT_NEIGHBOURS = ("head", "hair", "beard", "robe_upper", "robe_skirt", "belt")



def _issue(kind: str, pixels: int, change: str, why: str) -> dict:
    return {"kind": kind, "pixels": pixels, "change": change, "why": why}


def edge_crop(indices: Sequence[int], width: int, height: int) -> dict | None:
    """Opaque pixels on the top row or either side column: the cell clipped the figure (the bottom row holds the outline)."""
    hits = [i for i in range(width * height) if indices[i] != sm.TRANSPARENT and (i % width in (0, width - 1) or i // width == 0)]
    if not hits:
        return None
    return _issue("edge_crop", len(hits), "redraw the clipped limb or prop inside the cell, shortening it", "figure touches the cell border, so part of it was cut off by the 64x80 frame")


def over_height(indices: Sequence[int], width: int, height: int, limit: int = MAX_HEIGHT) -> dict | None:
    rows = [y for y in range(height) if any(indices[y * width + x] != sm.TRANSPARENT for x in range(width))]
    if not rows or rows[-1] - rows[0] + 1 <= limit:
        return None
    extra = rows[-1] - rows[0] + 1 - limit
    top_rows = rows[:extra]
    count = sum(1 for y in top_rows for x in range(width) if indices[y * width + x] != sm.TRANSPARENT)
    return _issue("over_height", count, f"lower the raised hand or prop by {extra} px", f"figure is {rows[-1] - rows[0] + 1} px tall, over the {limit} px god limit")


def isolated(indices: Sequence[int], width: int, height: int) -> dict | None:
    n = sm.isolated_pixels(indices, width, height)
    if n <= ISOLATED_LIMIT:
        return None
    return _issue("isolated_pixels", n, "delete or attach the single pixels", "the art guide forbids isolated pixels other than deliberate highlights")


def bolt_readability(parts: Sequence[str | None]) -> dict | None:
    n = sum(1 for p in parts if p == "bolt")
    if n >= MIN_BOLT_PX:
        return None
    return _issue("bolt_unreadable", MIN_BOLT_PX - n, "redraw the bolt as a thick zigzag" if n else "add the bolt", f"only {n} bolt px visible; the canon bolt is about 40 px")


def bolt_touch(parts: Sequence[str | None], width: int, height: int) -> dict | None:
    count = 0
    for y in range(height):
        for x in range(width):
            if parts[y * width + x] != "bolt":
                continue
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < width and 0 <= ny < height and parts[ny * width + nx] in BOLT_NEIGHBOURS:
                    count += 1
                    break
    if count <= BOLT_TOUCH_LIMIT:
        return None
    return _issue("bolt_touches_body", count, "move the bolt or hand pixels away from the head or robe", "the bolt touches the head or robe, so the two read as one shape")


def blips(prev: Sequence[int], cur: Sequence[int], nxt: Sequence[int], width: int, height: int) -> dict | None:
    """Pixels whose palette index differs from both neighbouring frames while those two agree: a one-frame flash."""
    count = 0
    for i in range(width * height):
        if cur[i] != sm.TRANSPARENT and prev[i] != sm.TRANSPARENT and nxt[i] != sm.TRANSPARENT and prev[i] == nxt[i] != cur[i]:
            count += 1
    if count <= BLIP_LIMIT:
        return None
    return _issue("temporal_blips", count, "set these pixels to the neighbouring frames' shade", "single-frame palette flashes read as shimmer")


def cell_issues(indices, parts, colours, ramp_of, drawn, width, height, colour_count, anchor, anchor_ok) -> list[dict]:
    found = [
        edge_crop(indices, width, height),
        over_height(indices, width, height),
        isolated(indices, width, height),
        bolt_readability(parts),
        bolt_touch(parts, width, height),
    ]
    if colour_count > 16:
        found.append(_issue("colour_budget", colour_count - 16, "merge shades", "more than 16 colours"))
    if not anchor_ok:
        found.append(_issue("anchor", 1, f"shift the cell to anchor (32, 74), found {anchor}", "anchor is not the fixed per-asset (32, 74)"))
    return [f for f in found if f]


# Visual-review findings turned into measurable rules (thresholds are review judgments, recorded in the log).
REVIEW_MIN_LEG_PX = {"walk": 40, "sit": 30}
REVIEW_BOLT_ABSENT_PX = 30


def review_issues(clip: str, parts: Sequence[str | None]) -> list[dict]:
    """Findings from looking at the sheets at 1x, as rules over the part map.

    R1 the bolt and the bolt hand share a ramp and touch, so the pair reads as one gold mass, never a zigzag;
    R2/R3 the robe hides the legs, so a walk's stride or a seated pose's knees are not visible below it.
    """
    counts: dict[str, int] = {}
    for p in parts:
        if p is not None:
            counts[p] = counts.get(p, 0) + 1
    out = []
    bolt = counts.get("bolt", 0)
    if bolt:
        out.append(_issue("review_bolt_reads_as_blob", bolt, "redraw the bolt as a thick zigzag in its own shade and separate it from the hand", "bolt and hand are the same pale-gold ramp and touch; at 1x they read as one mass"))
    else:
        out.append(_issue("review_bolt_hidden", REVIEW_BOLT_ABSENT_PX, "add the bolt", "the bolt is fully hidden from this facing"))
    legs = counts.get("leg_l", 0) + counts.get("leg_r", 0)
    floor = REVIEW_MIN_LEG_PX.get(clip)
    if floor and legs < floor:
        what = "draw the stride below the hem" if clip == "walk" else "draw the thighs and knees separate from the seat"
        out.append(_issue(f"review_{clip}_legs_hidden", floor - legs, what, f"only {legs} leg px visible under the robe; the {clip} pose does not read"))
    return out

#!/usr/bin/env python3
"""Round 10 light cleanup of the six generated Zeus portrait keyframes.

Deterministic, standard library plus the probe's own `pipeline.py` (which
shells out to ffmpeg for PNG I/O). It reads one 576x96 sheet of six 96x96
frames, removes only noise, and writes the cleaned sheet and a per-pixel
change list. It never paints a feature and never reads another frame: each
frame is planned from its own pixels alone, so nothing is restored from the
neutral.

What it may change (the same rules on all six frames):

  isolated   a single pixel whose four neighbours all differ from it, with no
             diagonal neighbour of its own colour (so it is not a stroke), that
             touches no line or background pixel. Replaced by the majority of
             its four neighbours.
  fleck      a stray orange (E) or bright cream (K) pixel group of 2-3 (E) or
             2-4 (K) pixels in the beard zone, ringed almost entirely by one
             warm colour. Replaced by that colour.
  outline    a cool mid-tone pixel that doubles the 1 px outline on the
             background side (replaced by the background), or breaks a straight
             outline run between two outline pixels (replaced by the outline
             colour).

Two explicit lists override the rules (round 10c, after review):

  KEEP       pixels a rule would change but that are transitional shading, not
             noise; each is left as generated, with its reason.
  EXTERIOR   exterior cool pixels no rule reaches (a grey halo at the robe
             corner), set to the background in every frame.

What it never changes, however a rule would score it (each such refusal is
written to the exclusion list with its reason):

  eye        every pixel in the eye-and-brow rectangles.
  mouth      every cool or dark pixel in the mouth box that touches another
             (the mouth, moustache and nose lines) and every pixel 4-adjacent
             to one, which keeps teeth and lip highlights that touch a line.
             Background pixels are never line pixels, so the exterior spur
             beside the contour is not shielded by the mouth box.
  diagonal   a pixel with a diagonal neighbour of its own colour (a stroke).
  line       a pixel 4-adjacent to line or background colour, for the isolated
             and fleck rules (the outline rule owns those).
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline import Raster, compose_grid, decode_png, encode_png, nearest_resize

CELL = 96
EXPRESSIONS = ("neutral", "pleased", "angry", "grieving", "scheming", "awed")

# greek-master olympus palette entries the portraits use.
OUTLINE = (36, 63, 99)  # A  navy outline and line colour
BROWN = (118, 87, 47)  # B  brown line colour
BACKGROUND = (159, 181, 191)  # H  flat background
ORANGE = (179, 139, 67)  # E  the stray orange fleck colour
CREAM = (243, 240, 220)  # K  the bright cream "teeth" colour
WARM = {
    (179, 139, 67),  # E
    (221, 191, 112),  # G
    (244, 228, 174),  # J
    (243, 240, 220),  # K
}
COOL = {
    (82, 100, 113),  # C
    (99, 123, 137),  # D
    (143, 166, 173),  # F
    (197, 209, 211),  # I
}
LINE = {OUTLINE, BROWN}

# Inclusive rectangles, in 96x96 frame coordinates.
EYE_RECTS = ((44, 22, 59, 38), (59, 22, 72, 38))  # brows, lids, irises
MOUTH_BOX = (48, 41, 70, 56)  # mouth, moustache and the base of the nose
BEARD_ZONE = (38, 40, 76, 84)  # where the fleck rule looks

# Pixels a rule would change but the review kept as generated: transitional
# shading between neighbouring tones, not noise. Keyed by (frame, x, y).
KEEP: dict[tuple[str, int, int], str] = {
    ("angry", 51, 47): "shading step between the gold moustache underside and the cream highlight",
    ("angry", 52, 51): "orange shading step at the edge of the cream beard highlight",
    ("angry", 59, 54): "skin-tone step where the beard highlight meets the cheek",
    ("awed", 49, 48): "orange shading step beside the lip highlight",
}

# Exterior cool pixels no rule reaches, set to the background in every frame:
# (x, y, reason). The pixel must be a cool mid-tone to be changed.
EXTERIOR: tuple[tuple[int, int, str], ...] = (
    (74, 82, "grey halo outside the robe corner"),
)

N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
D4 = ((1, 1), (1, -1), (-1, 1), (-1, -1))
N8 = N4 + D4

Frame = list[list[tuple[int, int, int]]]


def inside(rect: tuple[int, int, int, int], x: int, y: int) -> bool:
    return rect[0] <= x <= rect[2] and rect[1] <= y <= rect[3]


def in_eye(x: int, y: int) -> bool:
    return any(inside(rect, x, y) for rect in EYE_RECTS)


def luminance(colour: tuple[int, int, int]) -> int:
    return 2126 * colour[0] + 7152 * colour[1] + 722 * colour[2]


def distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
    return sum((p - q) ** 2 for p, q in zip(a, b))


def mouth_protected(frame: Frame) -> set[tuple[int, int]]:
    """The mouth lines in the mouth box, and their 4-neighbours.

    A line pixel is a cool or dark pixel with at least one cool or dark
    8-neighbour, so a lone grey speck in the skin is not a line. The flat
    background is neither warm nor a line: it never makes a pixel a line and is
    never one itself.
    """

    def is_line_colour(colour: tuple[int, int, int]) -> bool:
        return colour not in WARM and colour != BACKGROUND

    lines: set[tuple[int, int]] = set()
    for y in range(MOUTH_BOX[1], MOUTH_BOX[3] + 1):
        for x in range(MOUTH_BOX[0], MOUTH_BOX[2] + 1):
            if not is_line_colour(frame[y][x]):
                continue
            if any(is_line_colour(frame[y + dy][x + dx]) for dx, dy in N8):
                lines.add((x, y))
    protected = set(lines)
    for x, y in lines:
        for dx, dy in N4:
            protected.add((x + dx, y + dy))
    return protected


def plan_frame(
    frame: Frame,
    name: str = "",
) -> tuple[list[dict], list[dict]]:
    """Returns (changes, exclusions) for one frame, planned from its own pixels.

    `name` is the expression, used only to look the frame up in KEEP.
    """
    height, width = len(frame), len(frame[0])
    protected = mouth_protected(frame)
    changes: dict[tuple[int, int], dict] = {}
    exclusions: list[dict] = []

    def at(x: int, y: int) -> tuple[int, int, int]:
        return frame[y][x]

    def refuse(rule: str, x: int, y: int, reason: str) -> None:
        exclusions.append(
            {"rule": rule, "x": x, "y": y, "colour": list(at(x, y)), "reason": reason}
        )

    def blocked(rule: str, x: int, y: int) -> bool:
        if in_eye(x, y):
            refuse(rule, x, y, "eye")
            return True
        if (x, y) in protected:
            refuse(rule, x, y, "mouth")
            return True
        return False

    def propose(rule: str, x: int, y: int, new: tuple[int, int, int]) -> None:
        if (x, y) in changes or new == at(x, y):
            return
        kept = KEEP.get((name, x, y))
        if kept is not None:
            refuse(rule, x, y, f"exception: {kept}")
            return
        changes[(x, y)] = {
            "rule": rule,
            "x": x,
            "y": y,
            "from": list(at(x, y)),
            "to": list(new),
        }

    # outline: a cool mid-tone pixel doubling or breaking the 1 px outline.
    for y in range(1, height - 1):
        for x in range(1, width - 1):
            colour = at(x, y)
            if colour not in COOL:
                continue
            left, right = at(x - 1, y), at(x + 1, y)
            up, down = at(x, y - 1), at(x, y + 1)
            around = [left, right, up, down]
            if not (OUTLINE in around and BACKGROUND in around):
                continue
            gap = (left == OUTLINE and right == OUTLINE) or (
                up == OUTLINE and down == OUTLINE
            )
            # A gap sits between two outline pixels with background on one
            # side and skin on the other; a doubling pixel has no skin at all.
            if not gap and any(c in WARM or c == BROWN for c in around):
                continue
            if blocked("outline", x, y):
                continue
            propose("outline", x, y, OUTLINE if gap else BACKGROUND)

    # isolated: one pixel unlike all four neighbours and not part of a stroke.
    for y in range(1, height - 1):
        for x in range(1, width - 1):
            colour = at(x, y)
            if colour in LINE or colour == BACKGROUND or (x, y) in changes:
                continue
            around = [at(x + dx, y + dy) for dx, dy in N4]
            if any(c == colour for c in around):
                continue
            if blocked("isolated", x, y):
                continue
            if any(at(x + dx, y + dy) == colour for dx, dy in D4):
                refuse("isolated", x, y, "diagonal")
                continue
            if any(c in LINE or c == BACKGROUND for c in around):
                refuse("isolated", x, y, "line")
                continue
            tally = Counter(around)
            best = max(tally.values())
            tied = [c for c, n in tally.items() if n == best]
            if len(tied) > 1:
                eight = Counter(
                    at(x + dx, y + dy)
                    for dx, dy in N8
                    if at(x + dx, y + dy) in tied
                )
                top = max(eight.values()) if eight else 0
                tied = [c for c in tied if eight.get(c, 0) == top]
            tied.sort(key=lambda c: (distance(c, colour), luminance(c)))
            propose("isolated", x, y, tied[0])

    # fleck: small orange or cream groups in the beard, ringed by one warm colour.
    seen: set[tuple[int, int]] = set()
    for y in range(1, height - 1):
        for x in range(1, width - 1):
            colour = at(x, y)
            limit = {ORANGE: 3, CREAM: 4}.get(colour)
            if limit is None or (x, y) in seen or not inside(BEARD_ZONE, x, y):
                continue
            group = [(x, y)]
            seen.add((x, y))
            queue = deque(group)
            while queue:
                px, py = queue.popleft()
                for dx, dy in N4:
                    nx, ny = px + dx, py + dy
                    if (
                        0 <= nx < width
                        and 0 <= ny < height
                        and (nx, ny) not in seen
                        and at(nx, ny) == colour
                    ):
                        seen.add((nx, ny))
                        group.append((nx, ny))
                        queue.append((nx, ny))
            if len(group) < 2 or len(group) > limit:
                continue
            members = set(group)
            ring = [
                (px + dx, py + dy)
                for px, py in group
                for dx, dy in N4
                if (px + dx, py + dy) not in members
            ]
            ring = list(dict.fromkeys(ring))
            if any(not (0 <= rx < width and 0 <= ry < height) for rx, ry in ring):
                continue
            rim = Counter(at(rx, ry) for rx, ry in ring)
            top, count = rim.most_common(1)[0]
            if top not in WARM or count * 4 < len(ring) * 3:
                continue
            if any(at(rx, ry) in LINE or at(rx, ry) == BACKGROUND for rx, ry in ring):
                for px, py in group:
                    refuse("fleck", px, py, "line")
                continue
            if any(blocked("fleck", px, py) for px, py in group):
                continue
            for px, py in group:
                propose("fleck", px, py, top)

    # exterior: pixels no rule reaches, set to the background.
    for x, y, why in EXTERIOR:
        if (x, y) in changes:
            continue
        if at(x, y) not in COOL:
            refuse("exterior", x, y, f"not a cool mid-tone: {why}")
            continue
        if blocked("exterior", x, y):
            continue
        propose("exterior", x, y, BACKGROUND)

    ordered = sorted(changes.values(), key=lambda c: (c["y"], c["x"]))
    return ordered, exclusions


def apply_changes(frame: Frame, changes: list[dict]) -> Frame:
    out = [row[:] for row in frame]
    for change in changes:
        out[change["y"]][change["x"]] = tuple(change["to"])
    return out


def bounding_boxes(changes: list[dict]) -> dict:
    """The overall box and the boxes of the 8-connected changed groups."""
    if not changes:
        return {"all": None, "groups": []}
    cells = {(c["x"], c["y"]) for c in changes}
    seen: set[tuple[int, int]] = set()
    groups = []
    for cell in sorted(cells, key=lambda p: (p[1], p[0])):
        if cell in seen:
            continue
        seen.add(cell)
        queue = deque([cell])
        members = [cell]
        while queue:
            px, py = queue.popleft()
            for dx, dy in N8:
                near = (px + dx, py + dy)
                if near in cells and near not in seen:
                    seen.add(near)
                    members.append(near)
                    queue.append(near)
        xs = [m[0] for m in members]
        ys = [m[1] for m in members]
        groups.append(
            {"x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys), "pixels": len(members)}
        )
    xs = [x for x, _ in cells]
    ys = [y for _, y in cells]
    return {
        "all": {"x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys)},
        "groups": groups,
    }


def split_sheet(sheet: Raster) -> list[Frame]:
    if sheet.width != CELL * len(EXPRESSIONS) or sheet.height != CELL:
        raise ValueError(f"expected a {CELL * len(EXPRESSIONS)}x{CELL} sheet")
    frames = []
    for i in range(len(EXPRESSIONS)):
        frame = [
            [sheet.pixel(i * CELL + x, y)[:3] for x in range(CELL)] for y in range(CELL)
        ]
        if any(sheet.pixel(i * CELL + x, y)[3] != 255 for y in range(CELL) for x in range(CELL)):
            raise ValueError(f"frame {EXPRESSIONS[i]} is not fully opaque")
        frames.append(frame)
    return frames


def raster_of(frame: Frame) -> Raster:
    data = bytearray()
    for row in frame:
        for r, g, b in row:
            data += bytes((r, g, b, 255))
    return Raster(CELL, CELL, bytes(data))


def sheet_of(frames: list[Frame]) -> Raster:
    return compose_grid([raster_of(f) for f in frames], columns=len(frames))


def build_review(
    before: list[Frame], after: list[Frame], plans: list[list[dict]], review: Path
) -> None:
    review.mkdir(parents=True, exist_ok=True)
    before_sheet, after_sheet = sheet_of(before), sheet_of(after)
    for name, sheet in (("before", before_sheet), ("after", after_sheet)):
        encode_png(sheet, review / f"portraits-{name}-1x.png")
        encode_png(
            nearest_resize(sheet, sheet.width * 4, sheet.height * 4, integer_factor=True),
            review / f"portraits-{name}-4x.png",
        )
    for i, expression in enumerate(EXPRESSIONS):
        marked = {(c["x"], c["y"]) for c in plans[i]}
        tiles = [raster_of(before[i]), raster_of(after[i])]
        dim = [
            [
                ((r + 255) // 2, (g + 255) // 2, (b + 255) // 2)
                if (x, y) not in marked
                else (255, 0, 255)
                for x, (r, g, b) in enumerate(row)
            ]
            for y, row in enumerate(before[i])
        ]
        tiles.append(raster_of(dim))
        panel = compose_grid(tiles, columns=3)
        encode_png(
            nearest_resize(panel, panel.width * 4, panel.height * 4, integer_factor=True),
            review / f"diff-{expression}-4x.png",
        )


def run(
    before: list[Frame], out_sheet: Path, changes_path: Path, review: Path | None
) -> dict:
    plans, exclusions = [], []
    for name, frame in zip(EXPRESSIONS, before):
        changes, excluded = plan_frame(frame, name)
        plans.append(changes)
        exclusions.append(excluded)
    after = [apply_changes(f, p) for f, p in zip(before, plans)]

    for name, f_before, f_after, plan in zip(EXPRESSIONS, before, after, plans):
        for change in plan:
            if in_eye(change["x"], change["y"]):
                raise AssertionError(f"{name}: a change inside the eye rectangles")
            if (change["x"], change["y"]) in mouth_protected(f_before):
                raise AssertionError(f"{name}: a change on a mouth line")
        diff = sum(
            f_before[y][x] != f_after[y][x] for y in range(CELL) for x in range(CELL)
        )
        if diff != len(plan):
            raise AssertionError(f"{name}: change list and pixels disagree")

    for target in (out_sheet, changes_path):
        target.parent.mkdir(parents=True, exist_ok=True)
    encode_png(sheet_of(after), str(out_sheet))
    report = {
        "rules": {
            "eyeRects": [list(r) for r in EYE_RECTS],
            "mouthBox": list(MOUTH_BOX),
            "beardZone": list(BEARD_ZONE),
            "keep": [
                {"frame": f, "x": x, "y": y, "reason": why}
                for (f, x, y), why in sorted(KEEP.items())
            ],
            "exterior": [{"x": x, "y": y, "reason": why} for x, y, why in EXTERIOR],
        },
        "frames": {
            name: {
                "changed": len(plan),
                "byRule": dict(Counter(c["rule"] for c in plan)),
                "boxes": bounding_boxes(plan),
                "changes": plan,
                "excluded": exclusions[i],
            }
            for i, (name, plan) in enumerate(zip(EXPRESSIONS, plans))
        },
    }
    changes_path.write_text(json.dumps(report, indent=1) + "\n")
    if review is not None:
        build_review(before, after, plans, review)
    return report


def frames_from_store(store: Path, ids: list[str]) -> list[Frame]:
    """The six conformed candidates' images, read straight from the store."""
    frames = []
    for name, candidate_id in zip(EXPRESSIONS, ids):
        record = json.loads((store / "candidates" / f"{candidate_id}.json").read_text())
        image = decode_png(str(store / "blobs" / f"{record['result']['imageHash']}.png"))
        if (image.width, image.height) != (CELL, CELL):
            raise SystemExit(f"{name}: candidate {candidate_id} is not {CELL}x{CELL}")
        if any(image.pixel(x, y)[3] != 255 for y in range(CELL) for x in range(CELL)):
            raise SystemExit(f"{name}: candidate {candidate_id} is not fully opaque")
        frames.append(
            [[image.pixel(x, y)[:3] for x in range(CELL)] for y in range(CELL)]
        )
    return frames


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--sheet", type=Path, help="a 576x96 sheet of the six frames")
    source.add_argument(
        "--store",
        type=Path,
        help="read the six candidates from this studio store (with --candidate-ids)",
    )
    parser.add_argument("--candidate-ids", nargs=6)
    parser.add_argument("--out-sheet", type=Path, required=True)
    parser.add_argument("--changes", type=Path, required=True)
    parser.add_argument("--review-dir", type=Path)
    args = parser.parse_args()
    if args.store is not None:
        if args.candidate_ids is None:
            parser.error("--store needs --candidate-ids")
        before = frames_from_store(args.store, args.candidate_ids)
    else:
        before = split_sheet(decode_png(str(args.sheet)))
    report = run(before, args.out_sheet, args.changes, args.review_dir)
    for name, frame in report["frames"].items():
        print(name, frame["changed"], frame["byRule"], len(frame["excluded"]), "excluded")


if __name__ == "__main__":
    main()

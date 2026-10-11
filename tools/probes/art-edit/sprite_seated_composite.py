#!/usr/bin/env python3
"""Zeus `seated/south`: a scripted composite of the canon idle frame 0 and a generated seated cell.

Consistency with the canon idle is the priority. The head, crown, beard, shoulders and the bolt arm of the seated
sprite are the pixels of idle frame 0 (C2c), moved down by `dy` and otherwise untouched. The generated seated cell
(`run_sprite_seated.py` makes it) supplies only the lower-body pose; the legs and the seat are redrawn in idle's
colours and outline rules from a spec the independent reviewer writes. `build(seated_cell, idle_frame0, spec)` is
frame 0 and `frame2(frame0, spec)` is frame 1, a restrained 1 px rise of the upper body. Standard library plus the
probe's own modules. Nothing here runs a model.

The spec is a JSON object (all coordinates are cell pixels, x right and y down, ranges inclusive):

    {
      "schema": 1,
      "dy": 6,                                       // idle rows move down by this much (the seated head sits lower)
      "keep": {                                      // the idle region kept, in IDLE coordinates
        "rows": [26, 47], "columns": [16, 47],       //   a box (columns optional) ...
        "mask": [[20, 50]], "exclude": [[30, 40]]    //   ... plus single cells, minus single cells (all optional)
      },                                             //   only opaque idle pixels are kept
      "regions": [[14, 40, 50, 79]],                 // OUTPUT boxes where new pixels may exist; nothing else may change
      "adopt": [                                     // seated-cell regions copied in and snapped to idle's colours
        {"box": [10, 50, 54, 79], "dx": 0, "dy": 0}  //   `box` is in SEATED-CELL coordinates; dx, dy move it
      ],
      "patches": [[22, 78, "#76572f"]],              // output cell -> colour; drawn over what was adopted
      "rulings": [[28, 70, "#637b89"]],              // reviewer rulings: output cell -> colour, applied after the outline pass
      "budget": {"new_pixels": 400, "adopted": 380, "rulings": 12},   // ceilings; `new_pixels` is required
      "rise": {                                      // frame 1 (see `frame2`)
        "rows": [34, 51], "left_column": 25, "arm": {"column": 38, "from_row": 49},
        "repairs": [[25, 45, "#c7d8d4"]], "max_changed": 120
      }
    }

Rules `build` enforces (each has a test that fails when it is broken):

  1. Kept pixels are identical to idle frame 0 after the offset: the same colour, `dy` rows lower.
  2. New pixels (adopted, patched, ruled) exist only inside `regions`, never on a kept pixel, and within the budget.
  3. Every colour is one of idle frame 0's colours; adopted pixels are snapped to them in OKLab; alpha is binary.
  4. C2c's outline rules apply to the new pixels: each new exterior pixel is the darkest shade of the ramp of the
     form it bounds, a 2 px band is thinned, and an inside dark pixel is an overlap line or a seam (`plan` in
     `sprite_cleanup_c2c.py`, limited to the new pixels). A tie needs a ruling. Rulings are the reviewer's
     explicit pixels and win over the rules, as in C2c.
  5. The feet stay put: the lowest opaque row is 79, there are two foot clusters on it, and their midpoint is x=32.

`verify(frame, idle, spec, seated_cell=None)` rechecks these on a finished frame. It holds the budget (`new_pixels`
and `rulings` from the frame and the spec; `adopted` only when the seated cell is given, since only that tells an adopted
pixel from a patched one) and every ruled pixel's colour. See its docstring for what it does not re-derive.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline import Raster, decode_png, encode_png
from sprite_cleanup_c2b import rgb
from sprite_cleanup_c2c import plan as outline_plan
from sprite_downscale import Palette, load_palette, snap_to_palette, sole_clusters, sole_midpoint
from sprite_idle_c2 import Rise, cells_of_move_in, movable_in, raise_cluster

REPO = Path(__file__).resolve().parents[3]
PALETTE_JSON = REPO / "content/greek/palette/palette.json"
IDLE_FRAME0 = REPO / ".context/studio-pipeline/c2/c2c.png"
CELL = (64, 80)
FEET_ROW = 79
ALPHA_CUTOFF = 128
PIVOT = {"x": 32, "y": 80}
SPEC_KEYS = {"schema", "dy", "keep", "regions", "adopt", "patches", "rulings", "budget", "rise"}
KEEP_KEYS = {"rows", "columns", "mask", "exclude"}
ADOPT_KEYS = {"box", "dx", "dy"}
BUDGET_KEYS = {"new_pixels", "adopted", "rulings"}
RISE_KEYS = {"rows", "left_column", "arm", "repairs", "max_changed", "amount"}
HEX = re.compile(r"^#[0-9a-f]{6}$")

Point = tuple[int, int]
Colour = tuple[int, int, int]
Box = tuple[int, int, int, int]


class SpecError(ValueError):
    """The spec is malformed, or asks for something the rules refuse."""


class NeedsRulings(ValueError):
    """New pixels the outline rules cannot decide (ties and empties, as in C2c's table B): they need rulings."""

    def __init__(self, pixels: list[Point]) -> None:
        self.pixels = sorted(pixels, key=lambda p: (p[1], p[0]))
        super().__init__(f"{len(self.pixels)} new pixels need a ruling, the outline rules cannot decide them: {self.pixels}")


def outline_wanted(frame: Raster, new: set[Point], rulings: set[Point]) -> dict[Point, tuple[str, Colour]]:
    """What C2c's rules want for the new pixels that have no ruling. Raises NeedsRulings for those it cannot decide."""
    unresolved: list[Point] = []
    wanted = outline_plan(frame, only=new - rulings, frozen=set(), overridden=rulings, unresolved=unresolved)
    if unresolved:
        raise NeedsRulings(unresolved)
    return wanted


# --- spec parsing ---------------------------------------------------------------------------------------


def load_spec(spec: dict | str | Path) -> dict:
    data = spec if isinstance(spec, dict) else json.loads(Path(spec).read_text())
    if not isinstance(data, dict):
        raise SpecError("the spec must be a JSON object")
    unknown = set(data) - SPEC_KEYS
    if unknown:
        raise SpecError(f"unknown spec keys: {sorted(unknown)}")
    if data.get("schema") != 1:
        raise SpecError("spec.schema must be 1")
    return data


def _int(value: object, what: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise SpecError(f"{what} must be a whole number")
    return value


def _point(value: object, what: str) -> Point:
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise SpecError(f"{what} must be [x, y]")
    x, y = _int(value[0], what), _int(value[1], what)
    if not (0 <= x < CELL[0] and 0 <= y < CELL[1]):
        raise SpecError(f"{what} {[x, y]} is outside the {CELL[0]}x{CELL[1]} cell")
    return x, y


def _box(value: object, what: str) -> Box:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        raise SpecError(f"{what} must be [x0, y0, x1, y1]")
    x0, y0, x1, y1 = (_int(v, what) for v in value)
    if not (0 <= x0 <= x1 < CELL[0] and 0 <= y0 <= y1 < CELL[1]):
        raise SpecError(f"{what} {[x0, y0, x1, y1]} is not a box inside the {CELL[0]}x{CELL[1]} cell")
    return x0, y0, x1, y1


def _colour(value: object, what: str) -> Colour:
    if not isinstance(value, str) or not HEX.match(value):
        raise SpecError(f"{what} must be a lower-case #rrggbb colour")
    return rgb(value)


def _cells(value: object, what: str) -> list[tuple[Point, Colour]]:
    if not isinstance(value, list):
        raise SpecError(f"{what} must be a list of [x, y, colour]")
    out = []
    for entry in value:
        if not isinstance(entry, (list, tuple)) or len(entry) != 3:
            raise SpecError(f"{what} entries must be [x, y, colour]")
        out.append((_point(entry[:2], what), _colour(entry[2], what)))
    return out


def _in_box(p: Point, box: Box) -> bool:
    return box[0] <= p[0] <= box[2] and box[1] <= p[1] <= box[3]


# --- colours and the frame ---------------------------------------------------------------------------------


def opaque_cells(image: Raster) -> set[Point]:
    return {(x, y) for y in range(image.height) for x in range(image.width) if image.pixel(x, y)[3]}


def colour_at(image: Raster, p: Point) -> Colour | None:
    px = image.pixel(*p)
    return (px[0], px[1], px[2]) if px[3] else None


def colour_set(image: Raster) -> set[Colour]:
    return {c for p in opaque_cells(image) if (c := colour_at(image, p)) is not None}


def _require_cell(image: Raster, what: str) -> None:
    if (image.width, image.height) != CELL:
        raise SpecError(f"{what} is {image.width}x{image.height}, not {CELL[0]}x{CELL[1]}")


def _raster(pixels: dict[Point, Colour]) -> Raster:
    out = bytearray(CELL[0] * CELL[1] * 4)
    for (x, y), (r, g, b) in pixels.items():
        at = (y * CELL[0] + x) * 4
        out[at : at + 4] = bytes((r, g, b, 255))
    return Raster(CELL[0], CELL[1], bytes(out))


def snapping_palette(colours: set[Colour]) -> Palette:
    """The Olympus palette restricted to `colours`, so a snap can only land on a colour idle frame 0 uses."""
    base = load_palette(PALETTE_JSON)
    chosen = tuple(c for c in base.colours if c in colours)
    missing = colours - set(chosen)
    if missing:
        raise SpecError(f"idle frame 0 uses colours outside the Olympus palette: {sorted(missing)}")
    return Palette(chosen, {c: base.ramp_of[c] for c in chosen}, base.darkest)


# --- the kept region ---------------------------------------------------------------------------------------


def keep_cells(idle: Raster, keep: object) -> set[Point]:
    """The opaque idle pixels of the declared region, in idle coordinates."""
    if not isinstance(keep, dict):
        raise SpecError("spec.keep must be an object")
    unknown = set(keep) - KEEP_KEYS
    if unknown:
        raise SpecError(f"unknown keep keys: {sorted(unknown)}")
    if "rows" not in keep and "mask" not in keep:
        raise SpecError("spec.keep needs rows or a mask")
    cells: set[Point] = set()
    if "rows" in keep:
        rows = keep["rows"]
        if not isinstance(rows, list) or len(rows) != 2:
            raise SpecError("keep.rows must be [first, last]")
        first, last = _int(rows[0], "keep.rows"), _int(rows[1], "keep.rows")
        columns = keep.get("columns", [0, CELL[0] - 1])
        if not isinstance(columns, list) or len(columns) != 2:
            raise SpecError("keep.columns must be [first, last]")
        left, right = _int(columns[0], "keep.columns"), _int(columns[1], "keep.columns")
        box = _box([left, first, right, last], "keep box")
        cells |= {p for p in opaque_cells(idle) if _in_box(p, box)}
    for entry in keep.get("mask", []):
        p = _point(entry, "keep.mask")
        if idle.pixel(*p)[3]:
            cells.add(p)
    for entry in keep.get("exclude", []):
        cells.discard(_point(entry, "keep.exclude"))
    if not cells:
        raise SpecError("the kept region holds no opaque idle pixel")
    return cells


# --- verifying a finished frame -----------------------------------------------------------------------------


def _exposed(cells: set[Point], p: Point) -> bool:
    return any((p[0] + dx, p[1] + dy) not in cells for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))


def feet_problems(frame: Raster) -> list[str]:
    cells = opaque_cells(frame)
    if not cells:
        return ["the frame is empty"]
    problems = []
    bottom = max(y for _, y in cells)
    if bottom != FEET_ROW:
        problems.append(f"the lowest opaque row is {bottom}, not {FEET_ROW}")
    clusters = sole_clusters(frame, 2, 2)
    if len(clusters) != 2:
        problems.append(f"expected two feet on the lowest rows, found {len(clusters)}")
        return problems
    if any(c["bottom_row"] != FEET_ROW for c in clusters):
        problems.append(f"the feet end on rows {[c['bottom_row'] for c in clusters]}, not {FEET_ROW}")
    if sole_midpoint(frame, 2, 2) != PIVOT["x"]:
        problems.append(f"the midpoint between the feet is x={sole_midpoint(frame, 2, 2)}, not {PIVOT['x']}")
    return problems


def alpha_and_colour_problems(frame: Raster, allowed: set[Colour]) -> list[str]:
    problems = []
    odd = sorted({a for a in frame.rgba[3::4]} - {0, 255})
    if odd:
        problems.append(f"alpha is not binary: {odd}")
    outside = colour_set(frame) - allowed
    if outside:
        problems.append("colours outside idle's: " + ", ".join("#%02x%02x%02x" % c for c in sorted(outside)))
    return problems


def adopted_cells(seated_cell: Raster, spec: dict) -> set[Point]:
    """The output pixels the spec adopts from the seated cell: opaque seated pixels of each `adopt` box, moved by its
    dx and dy, less the cells a patch then overwrote. The same cells `build` counts as adopted."""
    adopted: set[Point] = set()
    for index, entry in enumerate(spec.get("adopt", [])):
        if not isinstance(entry, dict) or "box" not in entry:
            continue
        x0, y0, x1, y1 = _box(entry["box"], f"adopt[{index}].box")
        shift_x, shift_y = _int(entry.get("dx", 0), "adopt.dx"), _int(entry.get("dy", 0), "adopt.dy")
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if seated_cell.pixel(x, y)[3] >= ALPHA_CUTOFF:
                    adopted.add((x + shift_x, y + shift_y))
    return adopted - {p for p, _ in _cells(spec.get("patches", []), "spec.patches")}


def verify(frame: Raster, idle: Raster, spec: dict, seated_cell: Raster | None = None) -> list[str]:
    """The rules of the module docstring, checked on a finished frame 0 from the spec alone. Empty when they hold.

    From `frame`, `idle` and the spec it checks: kept pixels identical after the offset and not exposed; new pixels (the
    frame's opaque pixels that are not moved kept ones) inside the declared regions and no more than `budget.new_pixels`;
    the number of rulings no more than `budget.rulings`, and every ruled pixel drawn, new, and in the ruling's colour;
    binary alpha and idle's colours; C2c's outline rules; and the feet. Given `seated_cell` it also recovers the adopted
    pixels from the spec's `adopt` boxes and checks `budget.adopted`. Without it that ceiling is not checked: an adopted
    pixel and a patched one are both just new pixels in the frame, and only the seated cell tells them apart. It does
    not re-derive how an adopted pixel was snapped, only that its colour is one of idle's."""
    spec = load_spec(spec)
    dy = _int(spec.get("dy"), "spec.dy")
    kept = keep_cells(idle, spec.get("keep"))
    regions = [_box(b, "spec.regions") for b in spec.get("regions", [])]
    ruling_cells = _cells(spec.get("rulings", []), "spec.rulings")
    rulings = {p for p, _ in ruling_cells}
    problems = []
    moved = {(x, y + dy) for x, y in kept}
    here, was = opaque_cells(frame), opaque_cells(idle)
    for (x, y) in sorted(kept):
        if (x, y + dy) not in here or colour_at(frame, (x, y + dy)) != colour_at(idle, (x, y)):
            problems.append(f"kept pixel {(x, y)} of idle is not identical at {(x, y + dy)}")
    darkest = set(load_palette(PALETTE_JSON).darkest.values())
    for (x, y) in sorted(kept):
        at = (x, y + dy)
        if at in here and _exposed(here, at) and not _exposed(was, (x, y)) and colour_at(frame, at) not in darkest:
            problems.append(
                f"kept pixel {(x, y)} is exposed at {at} without an outline: draw the outline on the cell outside it"
            )
    new = here - moved
    for p in sorted(new):
        if not any(_in_box(p, box) for box in regions):
            problems.append(f"new pixel {p} is outside the declared regions")
    problems += budget_problems(spec, new, rulings, adopted_cells(seated_cell, spec) if seated_cell is not None else None)
    for p, colour in ruling_cells:
        if p not in new:
            problems.append(f"ruling at {p} is not on a new pixel of the frame")
        elif colour_at(frame, p) != colour:
            problems.append(
                f"ruling at {p} is #%02x%02x%02x, the spec rules #%02x%02x%02x" % (*colour_at(frame, p), *colour)  # type: ignore[misc]
            )
    problems += alpha_and_colour_problems(frame, colour_set(idle))
    problems += feet_problems(frame)
    try:
        wanted = outline_wanted(frame, new, rulings)
    except NeedsRulings as error:
        problems.append(f"outline: {error}")
        wanted = {}
    for p, (rule, colour) in sorted(wanted.items()):
        if colour_at(frame, p) != colour:
            problems.append(f"outline {rule} at {p}: expected #%02x%02x%02x" % colour)
    return problems


def budget_problems(spec: dict, new: set[Point], rulings: set[Point], adopted: set[Point] | None) -> list[str]:
    """Each ceiling of `spec.budget` against the count. `adopted` is None when it cannot be recovered."""
    budget = spec.get("budget")
    if not isinstance(budget, dict) or set(budget) - BUDGET_KEYS or "new_pixels" not in budget:
        return ["spec.budget needs new_pixels and may have adopted and rulings"]
    counts = {"new_pixels": len(new), "rulings": len(rulings)}
    if adopted is not None:
        counts["adopted"] = len(adopted)
    return [
        f"{key}: {counts[key]} is over the budget of {ceiling}"
        for key, ceiling in budget.items()
        if key in counts and counts[key] > _int(ceiling, f"budget.{key}")
    ]


# --- frame 0 ----------------------------------------------------------------------------------------------------


def build_with_report(seated_cell: Raster, idle_frame0: Raster, spec: dict | str | Path) -> tuple[Raster, dict]:
    """Frame 0 of seated/south and the facts about it. Raises SpecError for a malformed spec, ValueError for a rule."""
    spec = load_spec(spec)
    _require_cell(seated_cell, "the seated cell")
    _require_cell(idle_frame0, "idle frame 0")
    idle_colours = colour_set(idle_frame0)
    palette = snapping_palette(idle_colours)
    dy = _int(spec.get("dy"), "spec.dy")
    if not 0 <= dy <= 30:
        raise SpecError("spec.dy must be from 0 to 30")
    kept_idle = keep_cells(idle_frame0, spec.get("keep"))
    if any(y + dy >= CELL[1] for _, y in kept_idle):
        raise SpecError(f"dy {dy} moves kept pixels below the cell")
    kept = {(x, y + dy): colour_at(idle_frame0, (x, y)) for x, y in kept_idle}
    regions = [_box(b, "spec.regions") for b in spec.get("regions", [])]
    if not regions:
        raise SpecError("spec.regions must declare where new pixels may exist")

    new: dict[Point, Colour] = {}
    adopted: set[Point] = set()
    for index, entry in enumerate(spec.get("adopt", [])):
        if not isinstance(entry, dict) or set(entry) - ADOPT_KEYS or "box" not in entry:
            raise SpecError(f"adopt[{index}] needs a box and may have dx, dy")
        x0, y0, x1, y1 = _box(entry["box"], f"adopt[{index}].box")
        shift_x, shift_y = _int(entry.get("dx", 0), "adopt.dx"), _int(entry.get("dy", 0), "adopt.dy")
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                r, g, b, a = seated_cell.pixel(x, y)
                if a < ALPHA_CUTOFF:
                    continue
                target = (x + shift_x, y + shift_y)
                if not (0 <= target[0] < CELL[0] and 0 <= target[1] < CELL[1]):
                    raise SpecError(f"adopt[{index}] puts {(x, y)} outside the cell at {target}")
                new[target] = snap_to_palette((r, g, b), palette)
                adopted.add(target)
    for p, colour in _cells(spec.get("patches", []), "spec.patches"):
        if colour not in idle_colours:
            raise SpecError(f"patch colour #%02x%02x%02x at {p} is not one of idle's colours" % colour)
        new[p] = colour
        adopted.discard(p)
    ruling_cells = _cells(spec.get("rulings", []), "spec.rulings")
    rulings = {p for p, _ in ruling_cells}
    for p, colour in ruling_cells:
        if colour not in idle_colours:
            raise SpecError(f"ruling colour #%02x%02x%02x at {p} is not one of idle's colours" % colour)
        if p not in new:
            raise SpecError(f"ruling at {p} is on no new pixel")

    for p in sorted(new):
        if p in kept:
            raise SpecError(f"new pixel {p} lies on a kept pixel")
        if not any(_in_box(p, box) for box in regions):
            raise SpecError(f"new pixel {p} is outside the declared regions")
    budget = spec.get("budget")
    if not isinstance(budget, dict) or set(budget) - BUDGET_KEYS or "new_pixels" not in budget:
        raise SpecError("spec.budget needs new_pixels and may have adopted and rulings")
    counts = {"new_pixels": len(new), "adopted": len(adopted), "rulings": len(rulings)}
    for key, ceiling in budget.items():
        if counts[key] > _int(ceiling, f"budget.{key}"):
            raise SpecError(f"{key}: {counts[key]} is over the budget of {ceiling}")

    drawn = _raster({**new, **kept})
    planned = outline_wanted(drawn, set(new), rulings)
    pixels = {**new, **kept}
    for p, (rule, colour) in planned.items():
        if colour not in idle_colours:
            raise SpecError(f"the {rule} outline rule needs #%02x%02x%02x at {p}, which idle does not use" % colour)
        pixels[p] = colour
    for p, colour in ruling_cells:
        pixels[p] = colour
    frame = _raster(pixels)

    problems = verify(frame, idle_frame0, spec, seated_cell)
    if problems:
        raise ValueError("the composite breaks the rules:\n  " + "\n  ".join(problems))
    clusters = sole_clusters(frame, 2, 2)
    cells = opaque_cells(frame)
    report = {
        "dy": dy,
        "kept_pixels": len(kept),
        "new_pixels": len(new),
        "adopted_pixels": len(adopted),
        "patched_pixels": len(new) - len(adopted),
        "rulings": len(rulings),
        "outline_recoloured": len([p for p in planned if tuple(drawn.pixel(*p)[:3]) != pixels[p]]),
        "outline_rule_counts": {rule: sum(1 for r, _ in planned.values() if r == rule) for rule in sorted({r for r, _ in planned.values()})},
        "colours": len(colour_set(frame)),
        "top_row": min(y for _, y in cells),
        "bottom_row": max(y for _, y in cells),
        "height": max(y for _, y in cells) - min(y for _, y in cells) + 1,
        "soles": [[c["x0"], c["x1"] - 1, c["bottom_row"]] for c in clusters],
        "sole_midpoint": sole_midpoint(frame, 2, 2),
        "budget": budget,
    }
    return frame, report


def build(seated_cell: Raster, idle_frame0: Raster, spec: dict | str | Path) -> Raster:
    return build_with_report(seated_cell, idle_frame0, spec)[0]


# --- frame 1: the restrained rise ------------------------------------------------------------------------------


def rise_region(spec: dict) -> tuple[Rise, list[tuple[int, int, str]], int | None]:
    block = load_spec(spec).get("rise")
    if not isinstance(block, dict) or "rows" not in block or "left_column" not in block:
        raise SpecError("spec.rise needs rows and left_column")
    unknown = set(block) - RISE_KEYS
    if unknown:
        raise SpecError(f"unknown rise keys: {sorted(unknown)}")
    if _int(block.get("amount", 1), "rise.amount") != 1:
        raise SpecError("the rise is 1 px")
    rows = block["rows"]
    if not isinstance(rows, list) or len(rows) != 2:
        raise SpecError("rise.rows must be [first, last]")
    if _int(rows[1], "rise.rows") >= CELL[1] - 1:
        raise SpecError("rise.rows must end above the last row, where the feet stand")
    arm = block.get("arm")
    if arm is not None and (not isinstance(arm, dict) or set(arm) != {"column", "from_row"}):
        raise SpecError("rise.arm must be {column, from_row} or null")
    region = Rise(
        _int(rows[0], "rise.rows"),
        _int(rows[1], "rise.rows"),
        _int(block["left_column"], "rise.left_column"),
        None if arm is None else _int(arm["column"], "rise.arm.column"),
        None if arm is None else _int(arm["from_row"], "rise.arm.from_row"),
        1,
    )
    repairs = [
        (p[0], p[1], "#%02x%02x%02x" % c) for p, c in _cells(block.get("repairs", []), "rise.repairs")
    ]
    ceiling = block.get("max_changed")
    return region, repairs, None if ceiling is None else _int(ceiling, "rise.max_changed")


def changed_cells(a: Raster, b: Raster) -> set[Point]:
    def key(image: Raster, p: Point) -> tuple[int, ...]:
        px = image.pixel(*p)
        return (0, 0, 0, 0) if px[3] == 0 else tuple(px)

    return {(x, y) for y in range(a.height) for x in range(a.width) if key(a, (x, y)) != key(b, (x, y))}


def rise_problems(frame0: Raster, frame1: Raster, spec: dict, colours: set[Colour] | None = None) -> list[str]:
    region, repairs, ceiling = rise_region(spec)
    allowed = colour_set(frame0) if colours is None else colours
    declared = cells_of_move_in(frame0, region) | {(x, y) for x, y, _ in repairs}
    changed = changed_cells(frame0, frame1)
    problems = [f"{p} changed outside the rise" for p in sorted(changed - declared)]
    if not changed:
        problems.append("frame 1 is identical to frame 0")
    if ceiling is not None and len(changed) > ceiling:
        problems.append(f"{len(changed)} pixels changed, over the budget of {ceiling}")
    repaired = {(x, y) for x, y, _ in repairs}
    for x, y in sorted(movable_in(frame0, region)):
        if (x, y - 1) not in repaired and frame1.pixel(x, y - 1) != frame0.pixel(x, y):
            problems.append(f"{(x, y)} did not rise to {(x, y - 1)}")
    problems += alpha_and_colour_problems(frame1, allowed)
    problems += feet_problems(frame1)
    dark = set(load_palette(PALETTE_JSON).darkest.values())
    before, after = opaque_cells(frame0), opaque_cells(frame1)
    for p in sorted(after):
        if _exposed(after, p) and not (p in before and _exposed(before, p)) and colour_at(frame1, p) not in dark:
            problems.append(f"exterior pixel {p} is not a darkest shade")
    return problems


def frame2(frame0: Raster, spec: dict | str | Path, colours: set[Colour] | None = None) -> Raster:
    """Frame 1 of the seated pair: the upper body of frame 0 rises 1 px with its outline, the cells it vacates are
    filled from the fixed pixel below, and the spec's repairs fix what the move leaves wrong. `rise.rows` and
    `rise.left_column` (and `rise.arm`, the hanging arm that stays) are fixed by the spec, as the idle's are in
    `sprite_idle_c2.py`; the bolt arm and everything below the rows do not move."""
    spec = load_spec(spec)
    region, repairs, _ = rise_region(spec)
    frame1 = raise_cluster(frame0, region, repairs)
    problems = rise_problems(frame0, frame1, spec, colours)
    if problems:
        raise ValueError("the rise breaks the rules:\n  " + "\n  ".join(problems))
    return frame1


# --- sheet files for the studio ---------------------------------------------------------------------------------


def sheet_png(frames: list[Raster]) -> Raster:
    width = sum(f.width for f in frames)
    out = bytearray(width * frames[0].height * 4)
    left = 0
    for frame in frames:
        for y in range(frame.height):
            at = (y * width + left) * 4
            out[at : at + frame.width * 4] = frame.rgba[y * frame.width * 4 : (y + 1) * frame.width * 4]
        left += frame.width
    return Raster(width, frames[0].height, bytes(out))


def sheet_json(slot: str, durations_ms: list[int], pivot: dict[str, int] = PIVOT, cell: tuple[int, int] = CELL) -> str:
    """The Aseprite json-array document the studio's `finish --json` takes: the same shape as `sheetJson` in
    `packages/assets/src/studio/export-import.ts`, one tag for the slot and one pivot slice."""
    w, h = cell
    frames = [
        {
            "filename": f"studio {i}.aseprite",
            "frame": {"x": i * w, "y": 0, "w": w, "h": h},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h},
            "sourceSize": {"w": w, "h": h},
            "duration": d,
        }
        for i, d in enumerate(durations_ms)
    ]
    meta = {
        "app": "https://www.aseprite.org/",
        "format": "RGBA8888",
        "size": {"w": len(durations_ms) * w, "h": h},
        "scale": "1",
        "frameTags": [{"name": slot, "from": 0, "to": len(durations_ms) - 1, "direction": "forward"}],
        "slices": [
            {
                "name": f"pivot:{slot}",
                "keys": [{"frame": 0, "bounds": {"x": 0, "y": 0, "w": w, "h": h}, "pivot": dict(pivot)}],
            }
        ],
    }
    return json.dumps({"frames": frames, "meta": meta}, indent=2) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--seated", required=True, type=Path, help="the seated 64x80 cell (run_sprite_seated.py's cells/)")
    parser.add_argument("--spec", required=True, type=Path, help="the reviewer's spec JSON")
    parser.add_argument("--idle", type=Path, default=IDLE_FRAME0, help="idle frame 0 (default: C2c)")
    parser.add_argument("--durations", required=True, help="per-frame milliseconds, for example 500,500")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)
    durations = [int(v) for v in args.durations.split(",")]
    if len(durations) != 2 or any(d < 1 for d in durations):
        parser.error("--durations takes two whole millisecond values")
    idle, seated = decode_png(args.idle), decode_png(args.seated)
    frame0, report = build_with_report(seated, idle, args.spec)
    frame1 = frame2(frame0, args.spec, colour_set(idle))
    args.out.mkdir(parents=True, exist_ok=True)
    encode_png(frame0, args.out / "seated-f0.png")
    encode_png(frame1, args.out / "seated-f1.png")
    encode_png(sheet_png([frame0, frame1]), args.out / "sheet.png")
    (args.out / "sheet.json").write_text(sheet_json("seated/south", durations))
    report["frame1_changed_pixels"] = len(changed_cells(frame0, frame1))
    (args.out / "report-seated.json").write_text(json.dumps(report, indent=1) + "\n")
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Zeus `act/south/thunderbolt`: an N-frame scripted composite on the canon idle frame 0.

Consistency with the canon idle is the priority. In every frame the body (head, crown, beard, torso, robe, feet) is
the pixels of idle frame 0 (C2c), untouched and in place. Only the bolt arm and the bolt are redrawn, frame by frame,
inside boxes the spec declares; a frame may instead be declared exactly idle frame 0. One generated key-pose cell may
supply arm pixels to adopt (`run_sprite_seated.py` makes it, the same driver and anchor as any standing figure); the
reviewer's patches and rulings do the rest. There is no lightning effect here (Unit 10). Standard library plus the
probe's own modules; nothing here runs a model.

Each frame is built by `sprite_seated_composite.build_with_report` (and rechecked by its `verify`) from a spec this
module projects from the shared block and the frame's own block, so the rules of that module hold per frame: kept
pixels identical, new pixels only inside the declared regions and within the frame's budget, idle's colours only,
binary alpha, C2c's outline rules on the new pixels, feet on row 79 with their midpoint at x=32. On top of that
`cross_frame_problems` holds the rule that makes this an animation of ONE figure: outside the declared regions every
frame equals idle frame 0, and a frame declared exactly idle frame 0 is byte-identical to it.

THE ACT SPEC (JSON object; schema 1)
------------------------------------
All coordinates are cell pixels of the 64x80 god cell: x to the right from 0, y down from 0. A box is
[x0, y0, x1, y1] with BOTH corners inclusive. A point is [x, y]. A colour is a lower-case "#rrggbb" string and must be
one of the colours idle frame 0 uses. Keys not listed here are refused.

    {
      "schema": 1,                                   // required, must be 1
      "slot": "act/south/thunderbolt",               // optional; when given it must be exactly this
      "keep": {                                      // the idle region kept in EVERY frame, in idle coordinates
        "rows": [0, 79],                             //   [first, last] inclusive; with no "columns" all 64 columns
        "columns": [0, 63],                          //   optional [first, last] inclusive
        "mask": [[x, y]],                            //   optional extra single cells to keep (opaque idle pixels only)
        "exclude": [[x, y]],                         //   optional single cells to cut from the kept region
        "exclude_boxes": [[x0, y0, x1, y1]]          //   optional boxes cut from the kept region: the bolt arm and
      },                                             //     bolt of idle, which the frames redraw. Only opaque idle
                                                     //     pixels are ever kept; "rows" or "mask" must be present.
      "regions": [[x0, y0, x1, y1]],                 // required, at least one box: the ONLY cells where a frame may
                                                     //   differ from idle (the arm and bolt boxes, wide enough for
                                                     //   every frame's arm, bolt and their outlines)
      "frames": [                                    // required, 4 to 6 entries, in playing order
        {
          "name": "anticipation",                    // optional label for reports, a string
          "identical_to_idle": false,                // optional, default false. true = this frame is exactly idle
                                                     //   frame 0 (byte for byte); it then takes NO other key
          "adopt": [                                 // optional, needs the reference cell (--reference)
            {"box": [x0, y0, x1, y1], "dx": 0, "dy": 0}   // box is in REFERENCE-CELL coordinates; the opaque pixels
          ],                                         //   (alpha >= 128) of the box are copied to (x + dx, y + dy)
                                                     //   and snapped to the nearest of idle's colours in OKLab
          "patches": [[x, y, "#76572f"]],            // optional; output cell -> colour, drawn over what was adopted
          "rulings": [[x, y, "#637b89"]],            // optional; output cell -> colour, applied AFTER the outline pass
                                                     //   (the reviewer's say on a pixel the outline rules cannot
                                                     //   decide or decide wrongly). A ruling must sit on a new pixel
                                                     //   of the frame (adopted or patched); `build` names each pixel
                                                     //   the rules cannot decide so it can be ruled.
          "budget": {                                // required unless identical_to_idle; per FRAME ceilings
            "new_pixels": 120,                       //   required: adopted + patched pixels of this frame
            "adopted": 100,                          //   optional: pixels copied by `adopt` (less patched ones)
            "rulings": 8                             //   optional: number of rulings
          }
        }
      ]
    }

Rules `build_frames` enforces, each with a test that fails when it is broken:

  1. Kept pixels are identical to idle frame 0, in place (dy is always 0). Every opaque idle pixel is either kept or
     inside a region, so nothing of the body can be lost.
  2. New pixels exist only inside `regions`, never on a kept pixel, and within the frame's budget.
  3. Every colour is one of idle's; adopted pixels are snapped to them; alpha is binary.
  4. C2c's outline rules apply to each frame's new pixels (see `sprite_seated_composite.py`).
  5. Feet on row 79, two feet, midpoint at x=32 (kept from idle, rechecked per frame).
  6. Cross-frame: outside `regions` every frame equals idle frame 0 (opaque cells and colours), and an
     `identical_to_idle` frame equals it byte for byte.
  7. Durations (`--durations`, not in the spec): one whole number of milliseconds per frame, each from 83 to 100,
     the `act` state's 10 to 12 fps as the manifest contract measures it (`durationBounds`).

Outputs of the CLI (`--out`): `act-f<i>.png` per frame, `sheet.png` and `sheet.json` (the studio's import files, slot
`act/south/thunderbolt`, exact milliseconds), `act-1x.png`/`act-4x.png` (the transparent strip), `vs-idle-1x.png`/
`vs-idle-4x.png` (idle frame 0, then each frame, on a flat ground), `act.gif` (4x preview) and `report-act.json`.
GIF delays are whole centiseconds, so 85 ms is written as 9 cs (half up) in the preview only; the sheet keeps the
exact milliseconds. The preview loops so it can be watched; the sheet carries no loop information.
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline import Raster, decode_png, encode_png, nearest_resize
from sprite_seated_composite import (
    CELL,
    IDLE_FRAME0,
    KEEP_KEYS,
    NeedsRulings,
    SpecError,
    _box,
    _in_box,
    build_with_report,
    colour_at,
    keep_cells,
    opaque_cells,
    sheet_json,
    sheet_png,
)

SLOT = "act/south/thunderbolt"
SPEC_KEYS = {"schema", "slot", "keep", "regions", "frames"}
FRAME_KEYS = {"name", "identical_to_idle", "adopt", "patches", "rulings", "budget"}
MIN_FRAMES, MAX_FRAMES = 4, 6
MIN_MS, MAX_MS = 83, 100  # floor(1000 / 12), ceil(1000 / 10): `durationBounds` of the act state
GROUND = (96, 104, 120)

Point = tuple[int, int]


# --- the spec -----------------------------------------------------------------------------------------------


def load_act_spec(spec: dict | str | Path) -> dict:
    data = spec if isinstance(spec, dict) else json.loads(Path(spec).read_text())
    if not isinstance(data, dict):
        raise SpecError("the act spec must be a JSON object")
    unknown = set(data) - SPEC_KEYS
    if unknown:
        raise SpecError(f"unknown act spec keys: {sorted(unknown)}")
    if data.get("schema") != 1:
        raise SpecError("spec.schema must be 1")
    if "slot" in data and data["slot"] != SLOT:
        raise SpecError(f"spec.slot must be {SLOT!r}")
    regions = data.get("regions")
    if not isinstance(regions, list) or not regions:
        raise SpecError("spec.regions must declare at least one box where the frames may differ from idle")
    for box in regions:
        _box(box, "spec.regions")
    frames = data.get("frames")
    if not isinstance(frames, list) or not MIN_FRAMES <= len(frames) <= MAX_FRAMES:
        raise SpecError(f"spec.frames must hold {MIN_FRAMES} to {MAX_FRAMES} frames")
    for index, frame in enumerate(frames):
        if not isinstance(frame, dict):
            raise SpecError(f"frames[{index}] must be an object")
        unknown = set(frame) - FRAME_KEYS
        if unknown:
            raise SpecError(f"frames[{index}]: unknown keys {sorted(unknown)}")
        if "name" in frame and not isinstance(frame["name"], str):
            raise SpecError(f"frames[{index}].name must be a string")
        identical = frame.get("identical_to_idle", False)
        if not isinstance(identical, bool):
            raise SpecError(f"frames[{index}].identical_to_idle must be true or false")
        if identical:
            extra = sorted(set(frame) - {"name", "identical_to_idle"})
            if extra:
                raise SpecError(f"frames[{index}] is identical_to_idle and cannot take {extra}")
        elif "budget" not in frame:
            raise SpecError(f"frames[{index}] needs a budget")
    keep = data.get("keep")
    if not isinstance(keep, dict):
        raise SpecError("spec.keep must be an object")
    unknown = set(keep) - KEEP_KEYS - {"exclude_boxes"}
    if unknown:
        raise SpecError(f"unknown keep keys: {sorted(unknown)}")
    for box in keep.get("exclude_boxes", []):
        _box(box, "keep.exclude_boxes")
    return data


def regions_of(spec: dict) -> list[tuple[int, int, int, int]]:
    return [_box(b, "spec.regions") for b in spec["regions"]]


def projected_keep(idle: Raster, spec: dict) -> dict:
    """The shared `keep` as `sprite_seated_composite` reads it: `exclude_boxes` become the single cells they cut."""
    keep = dict(spec["keep"])
    boxes = [_box(b, "keep.exclude_boxes") for b in keep.pop("exclude_boxes", [])]
    cut = [[x, y] for x, y in sorted(opaque_cells(idle), key=lambda p: (p[1], p[0])) if any(_in_box((x, y), b) for b in boxes)]
    if cut:
        keep["exclude"] = [*keep.get("exclude", []), *cut]
    return keep


def kept_of(idle: Raster, spec: dict) -> set[Point]:
    """The idle pixels every frame keeps. Raises SpecError for an opaque idle pixel that is neither kept nor in a region."""
    spec = load_act_spec(spec)
    kept = keep_cells(idle, projected_keep(idle, spec))
    regions = regions_of(spec)
    lost = sorted(
        (p for p in opaque_cells(idle) - kept if not any(_in_box(p, b) for b in regions)),
        key=lambda p: (p[1], p[0]),
    )
    if lost:
        raise SpecError(
            f"{len(lost)} opaque idle pixels are neither kept nor inside a region (the body must stay): {lost[:6]}"
        )
    return kept


def frame_spec(idle: Raster, spec: dict, index: int) -> dict:
    """The `sprite_seated_composite` spec of frame `index`: dy 0, the shared keep and regions, the frame's own block."""
    spec = load_act_spec(spec)
    frame = spec["frames"][index]
    projected = {
        "schema": 1,
        "dy": 0,
        "keep": projected_keep(idle, spec),
        "regions": spec["regions"],
        "adopt": frame.get("adopt", []),
        "patches": frame.get("patches", []),
        "rulings": frame.get("rulings", []),
        "budget": frame["budget"],
    }
    return projected


# --- building frames ---------------------------------------------------------------------------------------


def build_frame(idle: Raster, spec: dict | str | Path, index: int, reference: Raster | None = None) -> tuple[Raster, dict]:
    """Frame `index` and its report. Raises SpecError for a malformed spec, ValueError for a rule that fails."""
    spec = load_act_spec(spec)
    frame = spec["frames"][index]
    label = f"frames[{index}]" + (f" ({frame['name']})" if "name" in frame else "")
    if frame.get("identical_to_idle", False):
        return Raster(idle.width, idle.height, bytes(idle.rgba)), {"identical_to_idle": True, "new_pixels": 0}
    kept_of(idle, spec)
    if frame.get("adopt") and reference is None:
        raise SpecError(f"{label} adopts pixels and needs the reference cell (--reference)")
    blank = Raster(CELL[0], CELL[1], bytes(CELL[0] * CELL[1] * 4))
    try:
        built, report = build_with_report(reference or blank, idle, frame_spec(idle, spec, index))
    except SpecError as error:
        raise SpecError(f"{label}: {error}") from error
    except NeedsRulings as error:
        error.frame = index  # type: ignore[attr-defined]
        raise
    except ValueError as error:
        raise ValueError(f"{label}: {error}") from error
    report["identical_to_idle"] = False
    return built, report


def build_frames(idle: Raster, spec: dict | str | Path, reference: Raster | None = None) -> tuple[list[Raster], list[dict]]:
    """Every frame of the spec, checked one by one and then against each other and idle."""
    spec = load_act_spec(spec)
    built = [build_frame(idle, spec, i, reference) for i in range(len(spec["frames"]))]
    frames = [b[0] for b in built]
    problems = cross_frame_problems(frames, idle, spec)
    if problems:
        raise ValueError("the frames break the cross-frame rules:\n  " + "\n  ".join(problems))
    return frames, [b[1] for b in built]


def cross_frame_problems(frames: list[Raster], idle: Raster, spec: dict) -> list[str]:
    """Rule 6: outside the regions every frame equals idle frame 0, and an identical_to_idle frame equals it exactly."""
    spec = load_act_spec(spec)
    regions = regions_of(spec)
    declared = spec["frames"]
    problems = []
    if len(frames) != len(declared):
        return [f"{len(frames)} frames were built for a spec of {len(declared)}"]
    for index, frame in enumerate(frames):
        if (frame.width, frame.height) != (idle.width, idle.height):
            problems.append(f"frame {index} is {frame.width}x{frame.height}, idle is {idle.width}x{idle.height}")
            continue
        if declared[index].get("identical_to_idle", False) and frame.rgba != idle.rgba:
            problems.append(f"frame {index} is declared identical_to_idle but its bytes differ from idle frame 0")
        here, was = opaque_cells(frame), opaque_cells(idle)
        for p in sorted(here | was, key=lambda p: (p[1], p[0])):
            if any(_in_box(p, box) for box in regions):
                continue
            if (p in here) != (p in was):
                problems.append(f"frame {index}: pixel {p} outside the regions is {'drawn' if p in here else 'missing'} against idle")
            elif colour_at(frame, p) != colour_at(idle, p):
                problems.append(f"frame {index}: pixel {p} outside the regions has another colour than idle")
    return problems


def duration_problems(durations_ms: list[int], count: int) -> list[str]:
    """Rule 7: one whole-millisecond duration per frame, each within the act state's 10 to 12 fps."""
    problems = []
    if len(durations_ms) != count:
        problems.append(f"{len(durations_ms)} durations for {count} frames")
    for index, ms in enumerate(durations_ms):
        if isinstance(ms, bool) or not isinstance(ms, int):
            problems.append(f"duration {index} must be a whole number of milliseconds")
        elif not MIN_MS <= ms <= MAX_MS:
            problems.append(f"duration {index} is {ms} ms, the act state takes {MIN_MS} to {MAX_MS} ms")
    return problems


# --- pictures for the owner and the reviewer ----------------------------------------------------------------


def flat(image: Raster, ground: tuple[int, int, int] = GROUND) -> Raster:
    px = bytearray(image.rgba)
    for i in range(image.width * image.height):
        if px[i * 4 + 3] < 128:
            px[i * 4 : i * 4 + 4] = bytes((*ground, 255))
        else:
            px[i * 4 + 3] = 255
    return Raster(image.width, image.height, bytes(px))


def hcat(images: list[Raster], gap: int = 2, ground: tuple[int, int, int] = GROUND) -> Raster:
    height = images[0].height
    width = sum(i.width for i in images) + gap * (len(images) - 1)
    out = bytearray(bytes((*ground, 255)) * (width * height))
    left = 0
    for image in images:
        for y in range(height):
            at = (y * width + left) * 4
            out[at : at + image.width * 4] = image.rgba[y * image.width * 4 : (y + 1) * image.width * 4]
        left += image.width + gap
    return Raster(width, height, bytes(out))


def enlarge(image: Raster, factor: int) -> Raster:
    return nearest_resize(image, image.width * factor, image.height * factor, integer_factor=True)


def gif_delay_cs(ms: int) -> int:
    """A GIF delay is whole centiseconds: milliseconds rounded half up, so 85 ms is 9 cs. Preview only."""
    return (ms + 5) // 10


def _lzw(indices: bytes, min_code: int = 8) -> bytes:
    clear, end = 1 << min_code, (1 << min_code) + 1
    table = {bytes([i]): i for i in range(clear)}
    nxt, size = end + 1, min_code + 1
    out, bitbuf, nbits = bytearray(), 0, 0

    def emit(code: int) -> None:
        nonlocal bitbuf, nbits
        bitbuf |= code << nbits
        nbits += size
        while nbits >= 8:
            out.append(bitbuf & 255)
            bitbuf >>= 8
            nbits -= 8

    emit(clear)
    cur = b""
    for v in indices:
        grown = cur + bytes([v])
        if grown in table:
            cur = grown
            continue
        emit(table[cur])
        if nxt < 4096:
            table[grown] = nxt
            nxt += 1
            if nxt > (1 << size) and size < 12:
                size += 1
        else:
            emit(clear)
            table = {bytes([i]): i for i in range(clear)}
            nxt, size = end + 1, min_code + 1
        cur = bytes([v])
    emit(table[cur])
    emit(end)
    if nbits:
        out.append(bitbuf & 255)
    return bytes(out)


def gif_bytes(frames: list[Raster], durations_ms: list[int], factor: int = 4) -> bytes:
    """A GIF89a of the frames at `factor`x, transparent where the frame is, looping, each delay `gif_delay_cs`."""
    big = [enlarge(f, factor) for f in frames]
    colours = sorted({tuple(f.rgba[i * 4 : i * 4 + 3]) for f in big for i in range(f.width * f.height) if f.rgba[i * 4 + 3] >= 128})
    if len(colours) > 255:
        raise ValueError("a GIF palette holds 255 colours besides the transparent one")
    palette = [(0, 0, 0)] + colours + [(0, 0, 0)] * (255 - len(colours))
    index = {c: i + 1 for i, c in enumerate(colours)}
    w, h = big[0].width, big[0].height
    out = bytearray(b"GIF89a") + struct.pack("<HHBBB", w, h, 0xF7, 0, 0) + b"".join(bytes(c) for c in palette)
    out += b"\x21\xFF\x0BNETSCAPE2.0\x03\x01\x00\x00\x00"
    for image, ms in zip(big, durations_ms):
        pixels = bytes(0 if image.rgba[i * 4 + 3] < 128 else index[tuple(image.rgba[i * 4 : i * 4 + 3])] for i in range(w * h))
        out += b"\x21\xF9\x04" + bytes([0b00001001]) + struct.pack("<H", gif_delay_cs(ms)) + b"\x00\x00"
        out += b"\x2C" + struct.pack("<HHHH", 0, 0, w, h) + b"\x00\x08"
        data = _lzw(pixels)
        for at in range(0, len(data), 255):
            chunk = data[at : at + 255]
            out += bytes([len(chunk)]) + chunk
        out += b"\x00"
    return bytes(out + b"\x3B")


def changed_pixels(a: Raster, b: Raster) -> int:
    def key(image: Raster, x: int, y: int) -> tuple[int, ...]:
        px = image.pixel(x, y)
        return (0, 0, 0, 0) if px[3] == 0 else tuple(px)

    return sum(1 for y in range(a.height) for x in range(a.width) if key(a, x, y) != key(b, x, y))


# --- the command line ---------------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--spec", required=True, type=Path, help="the reviewer's act spec JSON (schema in the module header)")
    parser.add_argument("--reference", type=Path, help="the generated key-pose cell (64x80) the spec's adopt boxes read")
    parser.add_argument("--idle", type=Path, default=IDLE_FRAME0, help="idle frame 0 (default: C2c)")
    parser.add_argument("--durations", required=True, help="per-frame milliseconds, for example 85,100,100,85,85,85")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)
    durations = [int(v) for v in args.durations.split(",")]
    idle = decode_png(args.idle)
    spec = load_act_spec(args.spec)
    problems = duration_problems(durations, len(spec["frames"]))
    if problems:
        parser.error("; ".join(problems))
    frames, reports = build_frames(idle, spec, decode_png(args.reference) if args.reference else None)
    args.out.mkdir(parents=True, exist_ok=True)
    for i, frame in enumerate(frames):
        encode_png(frame, args.out / f"act-f{i}.png")
    sheet = sheet_png(frames)
    encode_png(sheet, args.out / "sheet.png")
    (args.out / "sheet.json").write_text(sheet_json(SLOT, durations))
    encode_png(sheet, args.out / "act-1x.png")
    encode_png(enlarge(sheet, 4), args.out / "act-4x.png")
    versus = hcat([flat(idle), *map(flat, frames)])
    encode_png(versus, args.out / "vs-idle-1x.png")
    encode_png(enlarge(versus, 4), args.out / "vs-idle-4x.png")
    (args.out / "act.gif").write_bytes(gif_bytes(frames, durations))
    report = {
        "slot": SLOT,
        "durations_ms": durations,
        "total_ms": sum(durations),
        "gif_delays_cs": [gif_delay_cs(ms) for ms in durations],
        "frames": [
            {"index": i, "name": spec["frames"][i].get("name"), "changed_vs_idle": changed_pixels(idle, frames[i]), **reports[i]}
            for i in range(len(frames))
        ],
    }
    (args.out / "report-act.json").write_text(json.dumps(report, indent=1) + "\n")
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

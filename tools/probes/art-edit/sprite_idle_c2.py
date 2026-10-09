#!/usr/bin/env python3
"""Idle-south breathing loop for the accepted C2c frame: 4 frames held for FRAME_MS (333, 167, 333, 167 ms, a 1000 ms
loop), 64x80 cells, pivot (32, 80).

Standard library plus the probe's own modules (PNG I/O and the GIF step go through ffmpeg). Every frame is
C2c plus explicit operations:

  F0  rest: C2c, pixel-identical.
  F1  inhale: the diagonal chest fold shifts one pixel up and right (CHEST_UP: its lower end goes, one pixel
      is added at the top, so no pixel is left alone).
  F2  peak: the movable cluster (the head, hair, crown, beard, shoulders and upper chest, `is_movable`) moves
      up 1 px with its outline. The cells it vacates where a fixed pixel lies below are filled with that fixed
      pixel (the arm top, the cloth under the shoulder), and REPAIRS fix the pixels the move leaves wrong.
      F2_CHEST_HOLD keeps F1's raised chest fold at its two pixels, so the fold does not fall back at the peak.
  F3  exhale: the fold loses its upper-middle pixel (CHEST_DOWN), and loops into F0.

Fixed in every frame, pixel-identical to C2c: everything outside `cells_of_move()` and `repair_cells()`, which includes
the whole bolt and outline, the fist and grip, the raised forearm and upper-arm column (x <= 24), the right
arm and hanging hand (x >= 38 below row 42), the belt, waist, robe, cape, hem and feet.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline import Raster, decode_png, encode_png
from sprite_cleanup_c2b import rgb
from sprite_downscale import load_palette, measure, sole_clusters, sole_midpoint
from sprite_sheet import enlarge

REPO = Path(__file__).resolve().parents[3]
PALETTE_JSON = REPO / "content/greek/palette/palette.json"
SOURCE = REPO / ".context/studio-pipeline/c2/c2c.png"
OUT = REPO / ".context/studio-pipeline/idle"
FRAME_MS = (333, 167, 333, 167)

Point = tuple[int, int]
Edit = tuple[int, int, str]

TOP_ROW, BOTTOM_ROW = 30, 45
LEFT_COLUMN = 25
ARM_COLUMN, ARM_FROM_ROW = 38, 43
RISE = 1

CLOUD_DARK, CLOUD_SHADOW = "#637b89", "#9fb5bf"
CLOTH, CLOTH_FOLD = "#f3f0dc", "#c7d8d4"

REPAIRS: list[Edit] = [
    (25, 39, CLOUD_DARK),
    (25, 40, CLOUD_SHADOW),
    (25, 45, CLOTH),
]
CHEST_UP: list[Edit] = [
    (26, 49, CLOTH), (29, 46, CLOTH_FOLD),
]
F2_CHEST_HOLD: list[Edit] = [
    (26, 49, CLOTH), (29, 46, CLOTH_FOLD),
]
CHEST_DOWN: list[Edit] = [
    (28, 47, CLOTH),
]


def is_movable(image: Raster, x: int, y: int) -> bool:
    """The head, hair, crown, beard, shoulders and upper chest, down to just above the belt, without the left
    arm column (x < 25) or the right arm below the shoulder (x >= 38 from row 43)."""
    if not image.pixel(x, y)[3] or not TOP_ROW <= y <= BOTTOM_ROW or x < LEFT_COLUMN:
        return False
    return not (y >= ARM_FROM_ROW and x >= ARM_COLUMN)


def movable_cells(image: Raster) -> set[Point]:
    return {(x, y) for y in range(image.height) for x in range(image.width) if is_movable(image, x, y)}


def vacated_cells(image: Raster) -> set[Point]:
    moved = movable_cells(image)
    return {(x, y) for x, y in moved if (x, y + RISE) not in moved}


def cells_of_move(image: Raster) -> set[Point]:
    moved = movable_cells(image)
    return moved | {(x, y - RISE) for x, y in moved}


def repair_cells(image: Raster) -> set[Point]:
    return (
        {(x, y) for x, y, _ in REPAIRS}
        | {(x, y) for x, y, _ in CHEST_UP}
        | {(x, y) for x, y, _ in F2_CHEST_HOLD}
        | {(x, y) for x, y, _ in CHEST_DOWN}
        | vacated_cells(image)
    )


def _write(pixels: bytearray, width: int, x: int, y: int, value: bytes) -> None:
    at = (y * width + x) * 4
    pixels[at : at + 4] = value


def _recolour(image: Raster, edits: list[Edit]) -> Raster:
    palette = set(load_palette(PALETTE_JSON).colours)
    pixels = bytearray(image.rgba)
    for x, y, colour in edits:
        if rgb(colour) not in palette:
            raise ValueError(f"{colour} is not a palette colour")
        if not image.pixel(x, y)[3]:
            raise ValueError(f"{(x, y)} is transparent; an edit may not change alpha")
        _write(pixels, image.width, x, y, bytes((*rgb(colour), 255)))
    return Raster(image.width, image.height, bytes(pixels))


def frame_rest(base: Raster) -> Raster:
    return base


def frame_inhale(base: Raster) -> Raster:
    return _recolour(base, CHEST_UP)


def frame_peak(base: Raster) -> Raster:
    moved = movable_cells(base)
    pixels = bytearray(base.rgba)
    for x, y in moved:
        _write(pixels, base.width, x, y, bytes((0, 0, 0, 0)))
    for x, y in moved:
        _write(pixels, base.width, x, y - RISE, bytes(base.pixel(x, y)))
    for x, y in vacated_cells(base):
        _write(pixels, base.width, x, y, bytes(base.pixel(x, y + RISE)))
    return _recolour(Raster(base.width, base.height, bytes(pixels)), [*REPAIRS, *F2_CHEST_HOLD])


def frame_exhale(base: Raster) -> Raster:
    return _recolour(base, CHEST_DOWN)


def frames(base: Raster) -> list[Raster]:
    return [frame_rest(base), frame_inhale(base), frame_peak(base), frame_exhale(base)]


def build() -> list[Raster]:
    return frames(decode_png(SOURCE))


def changed(base: Raster, other: Raster) -> set[Point]:
    def key(image: Raster, x: int, y: int) -> tuple[int, ...]:
        px = image.pixel(x, y)
        return (0, 0, 0, 0) if px[3] == 0 else tuple(px)

    return {
        (x, y)
        for y in range(base.height)
        for x in range(base.width)
        if key(base, x, y) != key(other, x, y)
    }


def conform(paths: list[Path]) -> dict:
    result = subprocess.run(
        ["bun", str(Path(__file__).parent / "conform_report.ts"), *map(str, paths)],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=True,
        timeout=120,
    )
    return json.loads(result.stdout)


def sheet(images: list[Raster]) -> Raster:
    width = sum(i.width for i in images)
    out = bytearray(width * images[0].height * 4)
    left = 0
    for image in images:
        for y in range(image.height):
            at = (y * width + left) * 4
            out[at : at + image.width * 4] = image.rgba[y * image.width * 4 : (y + 1) * image.width * 4]
        left += image.width
    return Raster(width, images[0].height, bytes(out))


def on_grey(image: Raster, factor: int) -> Raster:
    grey = bytes((110, 110, 110, 255))
    out = bytearray(grey * (image.width * image.height))
    for i in range(image.width * image.height):
        if image.rgba[i * 4 + 3]:
            out[i * 4 : i * 4 + 4] = image.rgba[i * 4 : i * 4 + 4]
    flat = Raster(image.width, image.height, bytes(out))
    return flat if factor == 1 else enlarge(flat, factor)


def diff_sheet(base: Raster, images: list[Raster], factor: int = 4) -> Raster:
    tiles = []
    for image in images:
        marked = changed(base, image)
        w, h = base.width * factor, base.height * factor
        out = bytearray(bytes((70, 70, 70, 255)) * (w * h))
        for y in range(base.height):
            for x in range(base.width):
                here, was = image.pixel(x, y), base.pixel(x, y)
                if (x, y) in marked:
                    colour = (255, 0, 255, 255) if here[3] else (0, 220, 255, 255)
                elif here[3]:
                    gray = int(0.299 * here[0] + 0.587 * here[1] + 0.114 * here[2]) // 2 + 60
                    colour = (gray, gray, gray, 255)
                else:
                    continue
                for dy in range(factor):
                    at = ((y * factor + dy) * w + x * factor) * 4
                    for dx in range(factor):
                        out[at + dx * 4 : at + dx * 4 + 4] = bytes(colour)
        tiles.append(Raster(w, h, bytes(out)))
    return sheet(tiles)


def gif_delays_cs(durations_ms: tuple[int, ...]) -> tuple[int, ...]:
    """GIF delays are whole centiseconds: each duration rounded to the nearest one."""
    return tuple(round(ms / 10) for ms in durations_ms)


def set_gif_delays(path: Path, delays: tuple[int, ...]) -> None:
    """Writes the delay of each frame's graphic control block, the one place a GIF stores timing. ffmpeg cannot
    give the last frame its own delay, so every delay is set here and the block count is checked."""
    data = bytearray(path.read_bytes())
    blocks = [m.start() for m in re.finditer(b"\x21\xf9\x04", bytes(data))]
    if len(blocks) != len(delays):
        raise ValueError(f"{path.name} has {len(blocks)} frames, expected {len(delays)}")
    for at, delay in zip(blocks, delays):
        data[at + 4 : at + 6] = delay.to_bytes(2, "little")
    path.write_bytes(bytes(data))


def gif(scratch: Path, count: int, factor: int, out: Path) -> None:
    delays = gif_delays_cs(FRAME_MS)
    ticks = [index for index in range(count) for _ in range(delays[index])]
    for tick, index in enumerate(ticks):
        shutil.copyfile(scratch / f"g{index + 1}.png", scratch / f"s{tick:03d}.png")
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error", "-framerate", "100", "-i", str(scratch / "s%03d.png"),
            "-vf",
            f"mpdecimate=hi=1:lo=1:frac=1,scale=iw*{factor}:ih*{factor}:flags=neighbor,split[a][b];[a]palettegen=max_colors=32[p];[b][p]paletteuse=dither=none",
            "-fps_mode", "vfr", "-loop", "0", str(out),
        ],
        check=True,
        timeout=60,
    )
    for tick in range(len(ticks)):
        (scratch / f"s{tick:03d}.png").unlink()
    set_gif_delays(out, delays)


def main() -> int:
    palette = load_palette(PALETTE_JSON)
    base = decode_png(SOURCE)
    images = frames(base)
    OUT.mkdir(parents=True, exist_ok=True)
    paths = []
    for index, image in enumerate(images):
        path = OUT / f"f{index}.png"
        encode_png(image, path)
        paths.append(path)
    strip = sheet(images)
    encode_png(strip, OUT / "sheet.png")
    encode_png(enlarge(strip, 4), OUT / "sheet-4x.png")
    encode_png(diff_sheet(base, images), OUT / "diff-4x.png")
    scratch = OUT / "_gif"
    scratch.mkdir(exist_ok=True)
    for index, image in enumerate(images, 1):
        encode_png(on_grey(image, 1), scratch / f"g{index}.png")
    gif(scratch, len(images), 1, OUT / "idle-1x.gif")
    gif(scratch, len(images), 4, OUT / "idle-4x.gif")
    for leftover in scratch.iterdir():
        leftover.unlink()
    scratch.rmdir()
    verdicts = conform(paths)
    frames_report = []
    for index, (image, path) in enumerate(zip(images, paths)):
        facts = measure(image, palette)
        clusters = sole_clusters(image, 2, 2)
        marked = changed(base, image)
        verdict = verdicts[str(path)]
        frames_report.append(
            {
                "frame": index,
                "duration_ms": FRAME_MS[index],
                "file": str(path.relative_to(REPO)),
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "changed_vs_f0": len(marked),
                "changed_cells": sorted([x, y] for x, y in marked),
                "height": facts["height"],
                "top_row": facts["bottom_row"] - facts["height"] + 1,
                "bottom_row": facts["bottom_row"],
                "width": facts["width"],
                "colours": facts["colours"],
                "outside_palette": facts["outside_palette"],
                "soles": [[c["x0"], c["x1"] - 1, c["bottom_row"]] for c in clusters],
                "sole_midpoint": sole_midpoint(image, 2, 2),
                "conform": verdict["status"],
                "conform_failed": [
                    f"{c['check']}: {c['message']}" for c in verdict.get("checks", []) if c["status"] != "pass"
                ],
            }
        )
    summary = {
        "source": str(SOURCE.relative_to(REPO)),
        "source_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        "frame_ms": list(FRAME_MS),
        "loop_ms": sum(FRAME_MS),
        "gif_delays_cs": list(gif_delays_cs(FRAME_MS)),
        "regions": {
            "movable": {
                "rows": [TOP_ROW, BOTTOM_ROW],
                "left_column": LEFT_COLUMN,
                "excluded": f"x >= {ARM_COLUMN} from row {ARM_FROM_ROW} (the right arm and hand)",
                "pixels": len(movable_cells(base)),
                "rise": RISE,
            },
            "vacated_cells_filled_from_below": sorted([x, y] for x, y in vacated_cells(base)),
            "repairs": [[x, y, c] for x, y, c in REPAIRS],
            "chest_up": [[x, y, c] for x, y, c in CHEST_UP],
            "chest_down": [[x, y, c] for x, y, c in CHEST_DOWN],
        },
        "frames": frames_report,
        "gif_note": "GIF delays are whole centiseconds: 333 ms is stored as 33 cs and 167 ms as 17 cs",
    }
    (OUT / "report-idle.json").write_text(json.dumps(summary, indent=1) + "\n")
    print(json.dumps([{k: v for k, v in f.items() if k != "changed_cells"} for f in frames_report], indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

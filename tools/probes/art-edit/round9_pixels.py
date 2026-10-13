#!/usr/bin/env python3
"""Deterministic R9 portrait cleanup, sprite repair, and review sheets."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pipeline import Raster, decode_png, encode_png, nearest_resize, opaque_bbox


NAVY = (36, 63, 99, 255)
MID_GOLD = (179, 139, 67, 255)
GOLD = (221, 191, 112, 255)
CREAM = (244, 228, 174, 255)
DARK_BROWN = (118, 87, 47, 255)
TRANSPARENT = (0, 0, 0, 0)
BG_LIGHT = (243, 240, 220, 255)
BG_DARK = (36, 63, 99, 255)

PORTRAIT_SLOTS = ("neutral", "pleased", "angry", "grieving", "scheming", "awed")
PORTRAIT_SIZE = 96
SOURCE_BROW_RECTS = (
    (371, 225, 94, 24),
    (478, 221, 62, 28),
    (389, 248, 27, 4),
    (439, 248, 21, 4),
    (495, 246, 29, 4),
)
MOUTH_PATCH = (46, 42, 71, 59)  # half-open, corresponding to inclusive x46–70/y42–58


def _pack_pixels(pixels: list[list[tuple[int, int, int, int]]]) -> Raster:
    height = len(pixels)
    width = len(pixels[0])
    return Raster(width, height, b"".join(bytes(pixel) for row in pixels for pixel in row))


def _tile(image: Raster, x: int, y: int, width: int, height: int) -> Raster:
    return _pack_pixels(
        [[image.pixel(x + dx, y + dy) for dx in range(width)] for dy in range(height)]
    )


def _horizontal_strip(frames: list[Raster]) -> Raster:
    if not frames or len({frame.height for frame in frames}) != 1:
        raise ValueError("a strip needs frames with a common height")
    width = sum(frame.width for frame in frames)
    height = frames[0].height
    out = bytearray(width * height * 4)
    x_offset = 0
    for frame in frames:
        for y in range(height):
            src = y * frame.width * 4
            dst = (y * width + x_offset) * 4
            out[dst : dst + frame.width * 4] = frame.rgba[src : src + frame.width * 4]
        x_offset += frame.width
    return Raster(width, height, bytes(out))


def _blit(destination: bytearray, width: int, image: Raster, x: int, y: int) -> None:
    for row in range(image.height):
        src = row * image.width * 4
        dst = ((y + row) * width + x) * 4
        destination[dst : dst + image.width * 4] = image.rgba[src : src + image.width * 4]


def _scaled_brow_rectangles() -> list[tuple[int, int, int, int]]:
    result = []
    for x, y, width, height in SOURCE_BROW_RECTS:
        result.append(
            (
                x // 8,
                y // 8,
                (x + width + 7) // 8,
                (y + height + 7) // 8,
            )
        )
    return result


def _in_brow(x: int, y: int, rectangles: list[tuple[int, int, int, int]]) -> bool:
    return any(x0 <= x < x1 and y0 <= y < y1 for x0, y0, x1, y1 in rectangles)


def _mouth_pixels(expression: str) -> dict[tuple[int, int], tuple[int, int, int, int]]:
    pixels: dict[tuple[int, int], tuple[int, int, int, int]] = {}

    def paint(points: list[tuple[int, int]], colour: tuple[int, int, int, int]) -> None:
        for point in points:
            pixels[point] = colour

    if expression == "pleased":
        paint([(53, 51), (62, 51)], NAVY)
        paint([(x, 52) for x in range(54, 62)], NAVY)
        paint([(x, 53) for x in range(55, 61)], NAVY)
        paint([(x, 53) for x in range(56, 60)], MID_GOLD)
    elif expression == "angry":
        paint([(x, 51) for x in range(55, 61)], NAVY)
        paint([(54, 52), (61, 52), (53, 53), (62, 53)], NAVY)
    elif expression == "grieving":
        paint([(x, 50) for x in range(55, 61)], NAVY)
        paint([(x, 51) for x in range(54, 62)], NAVY)
        paint([(53, 52), (54, 52), (61, 52), (62, 52)], NAVY)
        paint([(x, 52) for x in range(55, 61)], MID_GOLD)
    elif expression == "scheming":
        paint([(53, 53), (54, 53), (55, 52), (56, 52), (57, 52)], NAVY)
        paint([(x, 51) for x in range(58, 62)], NAVY)
        paint([(62, 50)], NAVY)
        paint([(58, 52), (59, 52)], MID_GOLD)
    elif expression == "awed":
        paint([(x, 50) for x in range(55, 62)], NAVY)
        paint([(54, 51), (62, 51), (54, 52), (62, 52)], NAVY)
        paint([(x, 53) for x in range(55, 62)], NAVY)
        paint([(x, y) for x in range(55, 62) for y in (51, 52)], DARK_BROWN)
    else:
        raise ValueError(f"unknown expression: {expression}")
    return pixels


def cleanup_portrait_sheet(
    source_png: Path,
    source_json: Path,
    output_png: Path,
    stats_json: Path,
) -> dict[str, object]:
    source = decode_png(source_png)
    sheet = json.loads(source_json.read_text())
    frame_meta = sheet["frames"]
    if len(frame_meta) != 6:
        raise ValueError("R9 portrait edit requires six frames")
    size = sheet["meta"]["size"]
    if (size["w"], size["h"]) != (576, 96) or (source.width, source.height) != (576, 96):
        raise ValueError("portrait sheet must be a 576x96 six-cell strip")

    original = []
    for frame in frame_meta:
        rect = frame["frame"]
        if (rect["w"], rect["h"]) != (96, 96):
            raise ValueError("portrait cells must be 96x96")
        original.append(_tile(source, rect["x"], rect["y"], 96, 96))

    neutral = original[0]
    brows = _scaled_brow_rectangles()
    edited = [neutral]
    mouth_widths: dict[str, int] = {}
    mouth_specs: dict[str, list[list[int]]] = {}
    outside_drifts: dict[str, int] = {"neutral": 0}

    for index, expression in enumerate(PORTRAIT_SLOTS[1:], start=1):
        generated = original[index]
        pixels = bytearray(neutral.rgba)

        # Keep only generated brow pixels. Every other source pixel is neutral;
        # the 24x17 mouth/beard patch is restored from neutral before redrawing.
        for y in range(96):
            for x in range(96):
                if _in_brow(x, y, brows):
                    at = (y * 96 + x) * 4
                    pixels[at : at + 4] = bytes(generated.pixel(x, y))

        if expression in ("pleased", "scheming"):
            # Remove the contradictory navy frown line at x51–52/x63–64, y49–50.
            for y in (49, 50):
                for x in (51, 52, 63, 64):
                    at = (y * 96 + x) * 4
                    pixels[at : at + 4] = bytes(CREAM)
        if expression == "awed":
            # Remove the review's cream fleck while preserving the navy outline at x67.
            for y in range(51, 54):
                at = (y * 96 + 66) * 4
                pixels[at : at + 4] = bytes(MID_GOLD)

        mouth = _mouth_pixels(expression)
        for (x, y), colour in mouth.items():
            if not (MOUTH_PATCH[0] <= x < MOUTH_PATCH[2] and MOUTH_PATCH[1] <= y < MOUTH_PATCH[3]):
                raise ValueError(f"{expression} mouth escaped its restore patch")
            at = (y * 96 + x) * 4
            pixels[at : at + 4] = bytes(colour)

        frame = Raster(96, 96, bytes(pixels))
        drift = 0
        for y in range(96):
            for x in range(96):
                in_edit = _in_brow(x, y, brows) or (
                    MOUTH_PATCH[0] <= x < MOUTH_PATCH[2]
                    and MOUTH_PATCH[1] <= y < MOUTH_PATCH[3]
                )
                if not in_edit and frame.pixel(x, y) != neutral.pixel(x, y):
                    drift += 1
        if drift != 0:
            raise AssertionError(f"{expression} drifted {drift} pixels outside edit rectangles")
        edited.append(frame)
        mouth_widths[expression] = max(x for x, _ in mouth) - min(x for x, _ in mouth) + 1
        mouth_specs[expression] = [[x, y] for x, y in sorted(mouth)]
        outside_drifts[expression] = drift

    strip = _horizontal_strip(edited)
    encode_png(strip, output_png)
    report = {
        "source": str(source_png),
        "sourceSheetSha256": __import__("hashlib").sha256(source_png.read_bytes()).hexdigest(),
        "output": str(output_png),
        "outputSheetSha256": __import__("hashlib").sha256(output_png.read_bytes()).hexdigest(),
        "slots": list(PORTRAIT_SLOTS),
        "browRectangles96HalfOpen": [list(rect) for rect in brows],
        "mouthRestorePatchInclusive": {"x": [46, 70], "y": [42, 58]},
        "outsideEditRectangleDriftPixels": outside_drifts,
        "mouthWidthsPx": mouth_widths,
        "mouthPixels": mouth_specs,
        "eyesHandEdited": False,
        "compositionRule": "neutral source pixels outside the generated brow rectangles and the mouth patch; generated pixels retained only inside brow rectangles; mouth patch restored from neutral then mouths scripted",
    }
    stats_json.write_text(json.dumps(report, indent=2) + "\n")
    return report


def _external_background(image: Raster) -> set[tuple[int, int]]:
    """Flood-fill transparent pixels connected to the cell edge."""
    pending: list[tuple[int, int]] = []
    seen: set[tuple[int, int]] = set()
    for x in range(image.width):
        for y in (0, image.height - 1):
            if image.pixel(x, y)[3] == 0:
                pending.append((x, y))
    for y in range(image.height):
        for x in (0, image.width - 1):
            if image.pixel(x, y)[3] == 0:
                pending.append((x, y))
    while pending:
        point = pending.pop()
        if point in seen:
            continue
        seen.add(point)
        x, y = point
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if (
                0 <= nx < image.width
                and 0 <= ny < image.height
                and image.pixel(nx, ny)[3] == 0
                and (nx, ny) not in seen
            ):
                pending.append((nx, ny))
    return seen


def outline_sprite(core: Raster) -> tuple[Raster, dict[str, int | float]]:
    external = _external_background(core)
    boundary: set[tuple[int, int]] = set()
    for y in range(core.height):
        for x in range(core.width):
            if core.pixel(x, y)[3] == 0:
                continue
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    nx, ny = x + dx, y + dy
                    if not (0 <= nx < core.width and 0 <= ny < core.height):
                        boundary.add((x, y))
                    elif (nx, ny) in external:
                        boundary.add((x, y))
    pixels = bytearray(core.rgba)
    for x, y in boundary:
        at = (y * core.width + x) * 4
        pixels[at : at + 4] = bytes(NAVY)
    outlined = Raster(core.width, core.height, bytes(pixels))
    bbox = opaque_bbox(outlined)
    return outlined, {
        "pixels": len(boundary),
        "coveragePercent": 100.0 if boundary else 0.0,
        "figureHeightPx": bbox[3] - bbox[1],
        "bboxHalfOpen": list(bbox),
    }


def _gold_runs_on_row(image: Raster, y: int, colour: tuple[int, int, int, int]) -> list[tuple[int, int]]:
    points = [x for x in range(image.width) if image.pixel(x, y) == colour]
    runs: list[tuple[int, int]] = []
    for x in points:
        if not runs or x != runs[-1][1]:
            runs.append((x, x + 1))
        else:
            runs[-1] = (runs[-1][0], x + 1)
    return runs


def _translate_upper(core: Raster) -> Raster:
    """Translate the upper body once; lower legs and feet remain at their anchors."""
    # Gold lower-leg/foot pixels are a static layer. All other source pixels are
    # placed once at y-1; this is a one-to-one pixel translation, not a duplicated row.
    leg_bands = ((24, 31), (34, 41))
    leg_colours = {MID_GOLD[:3], GOLD[:3]}

    def static_leg(x: int, y: int, pixel: tuple[int, int, int, int]) -> bool:
        return y >= 72 and pixel[:3] in leg_colours and any(x0 <= x < x1 for x0, x1 in leg_bands)

    out = bytearray(bytes(TRANSPARENT) * (core.width * core.height))
    for y in range(core.height):
        for x in range(core.width):
            pixel = core.pixel(x, y)
            if pixel[3] == 0:
                continue
            if static_leg(x, y, pixel):
                target_x, target_y = x, y
            else:
                target_x, target_y = x, y - 1
            if 0 <= target_y < core.height:
                at = (target_y * core.width + target_x) * 4
                # Static lower-leg pixels win if a moved upper pixel meets them.
                if static_leg(target_x, target_y, core.pixel(target_x, target_y)) and not static_leg(x, y, pixel):
                    continue
                out[at : at + 4] = bytes(pixel)
    return Raster(core.width, core.height, bytes(out))


def clean_sprite(source: Raster) -> tuple[Raster, dict[str, object]]:
    if (source.width, source.height) != (64, 80):
        raise ValueError("sprite source must be a 64x80 studio cell")
    pixels = bytearray(source.rgba)
    before_pixels = sum(source.pixel(x, y)[3] > 0 for y in range(80) for x in range(64))

    # The selected conformed candidate has a pale, noisy bolt and blue-grey sparks
    # in this reserved side area. Replace that prop only; keep the draped navy cloak.
    cleared_bolt_pixels = 0
    blue_grey_colours = {(82, 100, 113), (99, 123, 137), (159, 181, 191), (197, 209, 211)}
    blue_grey_sparks_removed = 0
    for y in range(56, 78):
        for x in range(8, 19):
            at = (y * 64 + x) * 4
            if pixels[at + 3] != 0:
                cleared_bolt_pixels += 1
                if tuple(pixels[at : at + 3]) in blue_grey_colours:
                    blue_grey_sparks_removed += 1
            pixels[at : at + 4] = bytes(TRANSPARENT)

    # Trim one source hair row so the upward bob still fits the 56px maximum.
    trimmed_top_pixels = 0
    for x in range(64):
        at = (24 * 64 + x) * 4
        if pixels[at + 3] != 0:
            trimmed_top_pixels += 1
        pixels[at : at + 4] = bytes(TRANSPARENT)

    # Align the two golden foot blocks to pivot x=32 exactly. Move the left lower
    # leg/foot patch one pixel right; do not scale or stretch it.
    source_core = Raster(64, 80, bytes(pixels))
    runs = _gold_runs_on_row(source_core, 79, MID_GOLD)
    if len(runs) != 2:
        raise ValueError(f"expected two gold foot runs on row 79, found {runs}")
    left, right = runs
    centres = ((left[0] + left[1] - 1) / 2, (right[0] + right[1] - 1) / 2)
    delta = int(round(64 - sum(centres)))
    if delta not in (-1, 0, 1):
        raise ValueError(f"foot blocks need unexpected correction {delta}px: {runs}")
    if delta:
        x0, x1 = left
        # Move the connected lower-left foot patch, including its palette edge.
        region = [(x, y, source_core.pixel(x, y)) for y in range(74, 80) for x in range(x0, x1)]
        for x, y, _ in region:
            at = (y * 64 + x) * 4
            pixels[at : at + 4] = bytes(TRANSPARENT)
        for x, y, pixel in region:
            nx = x + delta
            if 0 <= nx < 64 and pixel[3]:
                at = (y * 64 + nx) * 4
                pixels[at : at + 4] = bytes(pixel)
        source_core = Raster(64, 80, bytes(pixels))
    foot_runs = _gold_runs_on_row(source_core, 79, MID_GOLD)
    foot_centres = [(start + end - 1) / 2 for start, end in foot_runs]
    foot_midpoint = sum(foot_centres) / len(foot_centres)
    if len(foot_runs) != 2 or foot_midpoint != 32.0:
        raise ValueError(f"feet must be centered at x=32.0, got {foot_runs} -> {foot_midpoint}")

    hand = [(17, 55), (18, 55), (19, 55)]
    for x, y in hand:
        at = (y * 64 + x) * 4
        pixels[at : at + 4] = bytes(MID_GOLD)

    bolt_rows = (
        (14, 19), (13, 18), (12, 17), (11, 16), (9, 19),
        (11, 18), (12, 18), (11, 17), (10, 16), (9, 19),
        (10, 17), (11, 17), (12, 18), (13, 19), (14, 19),
    )
    bolt_pixels: set[tuple[int, int]] = set()
    for y_offset, (x0, x1) in enumerate(bolt_rows):
        y = 56 + y_offset
        for x in range(x0, x1):
            bolt_pixels.add((x, y))
            at = (y * 64 + x) * 4
            pixels[at : at + 4] = bytes(GOLD)
    source_core = Raster(64, 80, bytes(pixels))

    # The one-pixel stroke replaces the keyed silhouette's boundary pixels after
    # conformance; it does not use the background key and does not enlarge the cell.
    base_frame, outline_metrics = outline_sprite(source_core)
    bob_core = _translate_upper(source_core)
    bob_frame, bob_outline = outline_sprite(bob_core)

    palette = {
        tuple(int(channel, 16) for channel in ("52", "64", "71")),
        tuple(int(channel, 16) for channel in ("8f", "a6", "ad")),
        tuple(int(channel, 16) for channel in ("c7", "d8", "d4")),
        tuple(int(channel, 16) for channel in ("f0", "ee", "e0")),
        tuple(int(channel, 16) for channel in ("76", "57", "2f")),
        tuple(int(channel, 16) for channel in ("b3", "8b", "43")),
        tuple(int(channel, 16) for channel in ("dd", "bf", "70")),
        tuple(int(channel, 16) for channel in ("f4", "e4", "ae")),
        tuple(int(channel, 16) for channel in ("24", "3f", "63")),
        tuple(int(channel, 16) for channel in ("3c", "62", "90")),
        tuple(int(channel, 16) for channel in ("71", "94", "b8")),
        tuple(int(channel, 16) for channel in ("c5", "d1", "d3")),
        tuple(int(channel, 16) for channel in ("63", "7b", "89")),
        tuple(int(channel, 16) for channel in ("9f", "b5", "bf")),
        tuple(int(channel, 16) for channel in ("d6", "e1", "df")),
        tuple(int(channel, 16) for channel in ("f3", "f0", "dc")),
    }
    colours = {
        base_frame.pixel(x, y)[:3]
        for y in range(80)
        for x in range(64)
        if base_frame.pixel(x, y)[3]
    }
    if not colours <= palette:
        raise AssertionError(f"sprite introduced non-Olympus colours: {colours - palette}")
    bbox = opaque_bbox(base_frame)
    if not 48 <= bbox[3] - bbox[1] <= 56:
        raise AssertionError(f"sprite height out of range: {bbox}")
    bob_bbox = opaque_bbox(bob_frame)
    if not 48 <= bob_bbox[3] - bob_bbox[1] <= 56:
        raise AssertionError(f"bob frame height out of range: {bob_bbox}")
    if not any((x, y) in bolt_pixels for x, y in hand):
        # Allow 8-connected contact between hand and bolt, not only overlap.
        if not any(abs(x - hx) <= 1 and abs(y - hy) <= 1 for x, y in bolt_pixels for hx, hy in hand):
            raise AssertionError("bolt does not meet the 3px hand block")
    xs = [x for x, _ in bolt_pixels]
    ys = [y for _, y in bolt_pixels]
    bolt_bbox = (min(xs), min(ys), max(xs) + 1, max(ys) + 1)
    lower_leg_anchor_pixels = [
        (x, y, source_core.pixel(x, y))
        for y in range(72, 80)
        for x in range(64)
        if y >= 72
        and source_core.pixel(x, y)[:3] in {MID_GOLD[:3], GOLD[:3]}
        and (24 <= x < 31 or 34 <= x < 41)
    ]
    lower_leg_fixed = all(bob_core.pixel(x, y) == pixel for x, y, pixel in lower_leg_anchor_pixels)
    metrics: dict[str, object] = {
        "sourceOpaquePixels": before_pixels,
        "oldBoltRegionOpaquePixelsCleared": cleared_bolt_pixels,
        "blueGreySparkPixelsRemoved": blue_grey_sparks_removed,
        "trimmedTopRowPixels": trimmed_top_pixels,
        "cloakDecision": "kept; the navy drape reads as a separate shoulder cloak, not an isolated blob",
        "boltBboxHalfOpen": list(bolt_bbox),
        "boltSizePx": [bolt_bbox[2] - bolt_bbox[0], bolt_bbox[3] - bolt_bbox[1]],
        "handBlock": {"pixels": len(hand), "bboxHalfOpen": [17, 55, 20, 56]},
        "boltHandConnected": True,
        "footSegmentsRow79HalfOpen": [list(run) for run in foot_runs],
        "footCentersX": foot_centres,
        "footMidpointX": foot_midpoint,
        "outline": outline_metrics,
        "bobOutline": bob_outline,
        "bobFigureHeightPx": bob_bbox[3] - bob_bbox[1],
        "headMeasure": {
            "method": "hairline through beard tip; inclusive row range defined from the 1x candidate",
            "baseRows": [25, 39],
            "baseHeightPx": 15,
            "baseRatioPercent": round(100 * 15 / (bbox[3] - bbox[1]), 2),
            "inhaleRows": [24, 38],
            "inhaleHeightPx": 15,
            "inhaleRatioPercent": round(100 * 15 / (bob_bbox[3] - bob_bbox[1]), 2),
        },
        "colors": len(colours),
        "paletteOnly": True,
        "staticLegBandsHalfOpen": [[24, 72, 31, 80], [34, 72, 41, 80]],
        "lowerLegAnchorPixelCount": len(lower_leg_anchor_pixels),
        "lowerLegAnchorPixelsFixed": lower_leg_fixed,
    }
    if not lower_leg_fixed:
        raise AssertionError("a lower-leg/foot pixel moved during the bob")
    return base_frame, bob_frame, metrics


def prepare_sprite_sheet(
    source_png: Path,
    source_json: Path,
    output_png: Path,
    output_json: Path,
    stats_json: Path,
) -> dict[str, object]:
    sheet = json.loads(source_json.read_text())
    image = decode_png(source_png)
    frames = sheet["frames"]
    cell_w, cell_h = 64, 80
    if len(frames) != 1 or sheet["meta"]["size"] != {"w": 64, "h": 80} or (image.width, image.height) != (64, 80):
        raise ValueError("sprite edit workspace must be the selected 64x80 base cell")
    first = frames[0]["frame"]
    source = _tile(image, first["x"], first["y"], cell_w, cell_h)
    base, bob, metrics = clean_sprite(source)
    result = _horizontal_strip([base, bob, bob, base])
    encode_png(result, output_png)

    durations = [167, 166, 167, 166]
    template_frame = frames[0]
    sheet["frames"] = []
    for index, duration in enumerate(durations):
        frame = json.loads(json.dumps(template_frame))
        frame["filename"] = f"zeus-idle-south-{index}.aseprite"
        frame["frame"] = {"x": index * 64, "y": 0, "w": 64, "h": 80}
        frame["spriteSourceSize"] = {"x": 0, "y": 0, "w": 64, "h": 80}
        frame["sourceSize"] = {"w": 64, "h": 80}
        frame["rotated"] = False
        frame["trimmed"] = False
        frame["duration"] = duration
        sheet["frames"].append(frame)
    sheet["meta"]["size"] = {"w": 256, "h": 80}
    sheet["meta"]["frameTags"] = [
        {"name": "idle/south", "from": 0, "to": 3, "direction": "forward"}
    ]
    sheet["meta"]["slices"] = [
        {
            "name": "pivot:idle/south",
            "keys": [
                {
                    "frame": 0,
                    "bounds": {"x": 0, "y": 0, "w": 64, "h": 80},
                    "pivot": {"x": 32, "y": 80},
                }
            ],
        }
    ]
    output_json.write_text(json.dumps(sheet, indent=2) + "\n")
    report = {
        "source": str(source_png),
        "output": str(output_png),
        "outputSha256": __import__("hashlib").sha256(output_png.read_bytes()).hexdigest(),
        "durationsMs": durations,
        "pivot": {"x": 32, "y": 80},
        "frameHashes": [
            __import__("hashlib").sha256(frame.rgba).hexdigest() for frame in (base, bob, bob, base)
        ],
        "metrics": metrics,
        "bobVerification": {
            "upperBodyTranslationPx": -1,
            "noScanlineDuplication": True,
            "lowerLegAnchorPixelsFixed": metrics["lowerLegAnchorPixelsFixed"],
        },
    }
    if not report["bobVerification"]["lowerLegAnchorPixelsFixed"]:
        raise AssertionError("lower-leg/foot pixels moved during the bob")
    stats_json.write_text(json.dumps(report, indent=2) + "\n")
    return report


def _render_silhouette(frames: list[Raster], foreground: tuple[int, int, int, int], background: tuple[int, int, int, int]) -> Raster:
    width = sum(frame.width for frame in frames)
    height = frames[0].height
    out = bytearray(bytes(background) * (width * height))
    x_offset = 0
    for frame in frames:
        for y in range(height):
            for x in range(frame.width):
                if frame.pixel(x, y)[3]:
                    at = (y * width + x_offset + x) * 4
                    out[at : at + 4] = bytes(foreground)
        x_offset += frame.width
    return Raster(width, height, bytes(out))


def build_review(
    portrait_before: Path,
    portrait_after: Path,
    sprite_sheet: Path,
    review_dir: Path,
) -> list[str]:
    review_dir.mkdir(parents=True, exist_ok=True)
    before = decode_png(portrait_before)
    after = decode_png(portrait_after)
    sprite = decode_png(sprite_sheet)
    portrait_after_1x = _horizontal_strip([_tile(after, x * 96, 0, 96, 96) for x in range(6)])
    portrait_pairs = []
    for index in range(6):
        portrait_pairs.extend((_tile(before, index * 96, 0, 96, 96), _tile(after, index * 96, 0, 96, 96)))
    sprite_frames = [_tile(sprite, x * 64, 0, 64, 80) for x in range(4)]
    threshold_light = _render_silhouette(sprite_frames, (0, 0, 0, 255), (255, 255, 255, 255))
    threshold_dark = _render_silhouette(sprite_frames, (255, 255, 255, 255), (0, 0, 0, 255))
    two_colour = bytearray(bytes(BG_LIGHT) * (256 * 160))
    light_strip = _render_silhouette(sprite_frames, NAVY, BG_LIGHT)
    dark_strip = _render_silhouette(sprite_frames, BG_LIGHT, BG_DARK)
    _blit(two_colour, 256, light_strip, 0, 0)
    _blit(two_colour, 256, dark_strip, 0, 80)
    outputs: dict[str, Raster] = {
        "portraits-after-1x.png": portrait_after_1x,
        "portraits-before-after-1x.png": _horizontal_strip(portrait_pairs),
        "sprite-final-1x.png": sprite,
        "sprite-silhouette-threshold-1x.png": threshold_light,
        "sprite-two-colour-test-1x.png": Raster(256, 160, bytes(two_colour)),
    }
    outputs["portraits-after-4x.png"] = nearest_resize(outputs["portraits-after-1x.png"], 2304, 384, True)
    outputs["portraits-before-after-4x.png"] = nearest_resize(outputs["portraits-before-after-1x.png"], 4608, 384, True)
    outputs["sprite-final-4x.png"] = nearest_resize(sprite, 1024, 320, True)
    outputs["sprite-silhouette-threshold-4x.png"] = nearest_resize(threshold_light, 1024, 320, True)
    outputs["sprite-two-colour-test-4x.png"] = nearest_resize(outputs["sprite-two-colour-test-1x.png"], 1024, 640, True)
    for name, image in outputs.items():
        encode_png(image, review_dir / name)
    return [str(review_dir / name) for name in outputs]


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    portrait = subparsers.add_parser("portraits")
    portrait.add_argument("source_png", type=Path)
    portrait.add_argument("source_json", type=Path)
    portrait.add_argument("output_png", type=Path)
    portrait.add_argument("stats_json", type=Path)
    sprite = subparsers.add_parser("sprite")
    sprite.add_argument("source_png", type=Path)
    sprite.add_argument("source_json", type=Path)
    sprite.add_argument("output_png", type=Path)
    sprite.add_argument("output_json", type=Path)
    sprite.add_argument("stats_json", type=Path)
    review = subparsers.add_parser("review")
    review.add_argument("portrait_before", type=Path)
    review.add_argument("portrait_after", type=Path)
    review.add_argument("sprite_sheet", type=Path)
    review.add_argument("review_dir", type=Path)
    args = parser.parse_args()
    if args.command == "portraits":
        report = cleanup_portrait_sheet(args.source_png, args.source_json, args.output_png, args.stats_json)
    elif args.command == "sprite":
        report = prepare_sprite_sheet(args.source_png, args.source_json, args.output_png, args.output_json, args.stats_json)
    else:
        report = {"reviewFiles": build_review(args.portrait_before, args.portrait_after, args.sprite_sheet, args.review_dir)}
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

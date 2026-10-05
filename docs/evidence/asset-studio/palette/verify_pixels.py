#!/usr/bin/env python3
"""Compare saved study-panel pixels with integer-expanded native crops."""

from pathlib import Path
import json
import struct
import sys
import zlib


def png_rgb(path: Path) -> tuple[int, int, list[bytes]]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"not a PNG: {path}")
    width = height = bit_depth = color_type = interlace = None
    compressed = bytearray()
    offset = 8
    while offset < len(data):
        length = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4 : offset + 8]
        body = data[offset + 8 : offset + 8 + length]
        if kind == b"IHDR":
            width, height, bit_depth, color_type, _, _, interlace = struct.unpack(
                ">IIBBBBB", body
            )
        elif kind == b"IDAT":
            compressed.extend(body)
        elif kind == b"IEND":
            break
        offset += length + 12

    if bit_depth != 8 or color_type not in (2, 6) or interlace != 0:
        raise ValueError(f"unsupported PNG encoding: bit={bit_depth}, type={color_type}")
    bpp = 3 if color_type == 2 else 4
    stride = width * bpp
    raw = zlib.decompress(compressed)
    rows: list[bytearray] = []
    cursor = 0
    prior = bytearray(stride)
    for _ in range(height):
        filter_kind = raw[cursor]
        cursor += 1
        row = bytearray(raw[cursor : cursor + stride])
        cursor += stride
        for i in range(stride):
            left = row[i - bpp] if i >= bpp else 0
            above = prior[i]
            upper_left = prior[i - bpp] if i >= bpp else 0
            if filter_kind == 1:
                row[i] = (row[i] + left) & 255
            elif filter_kind == 2:
                row[i] = (row[i] + above) & 255
            elif filter_kind == 3:
                row[i] = (row[i] + ((left + above) // 2)) & 255
            elif filter_kind == 4:
                p = left + above - upper_left
                pa, pb, pc = abs(p - left), abs(p - above), abs(p - upper_left)
                predictor = left if pa <= pb and pa <= pc else above if pb <= pc else upper_left
                row[i] = (row[i] + predictor) & 255
            elif filter_kind != 0:
                raise ValueError(f"unsupported PNG filter: {filter_kind}")
        rows.append(row)
        prior = row
    if bpp == 4:
        rows = [
            bytearray(channel for i in range(0, len(row), 4) for channel in row[i : i + 3])
            for row in rows
        ]
    return width, height, [bytes(row) for row in rows]


def compare(pixels, source_rect, zoom_rect, scale, label, sheet_size):
    sx, sy = source_rect["x"], source_rect["y"]
    zx, zy = zoom_rect["x"], zoom_rect["y"]
    width, height = source_rect["width"], source_rect["height"]
    assert (zoom_rect["width"], zoom_rect["height"]) == (width * scale, height * scale)
    assert sx >= 0 and sy >= 0 and sx + width <= sheet_size[0] and sy + height <= sheet_size[1]
    assert zx >= 0 and zy >= 0 and zx + width * scale <= sheet_size[0] and zy + height * scale <= sheet_size[1]
    errors = 0
    for y in range(height * scale):
        source_row = pixels[sy + y // scale]
        zoom_row = pixels[zy + y]
        for x in range(width * scale):
            expected = source_row[(sx + x // scale) * 3 : (sx + x // scale + 1) * 3]
            actual = zoom_row[(zx + x) * 3 : (zx + x + 1) * 3]
            errors += expected != actual
    total = width * height * scale * scale
    print(f"{label}: {errors}/{total} mismatching saved pixels")
    return errors


def rgb_at(rows, x, y):
    return tuple(rows[y][x * 3 : x * 3 + 3])


def accent_components(rows, figure_rect, accent):
    sx, sy = figure_rect["x"], figure_rect["y"]
    # Crown area, in native cell coordinates. Face/robe accents are below it.
    coords = {
        (x, y)
        for y in range(9, 19)
        for x in range(14, 50)
        if rgb_at(rows, sx + x, sy + y) == accent
    }
    components = 0
    while coords:
        components += 1
        pending = [coords.pop()]
        while pending:
            x, y = pending.pop()
            for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbor in coords:
                    coords.remove(neighbor)
                    pending.append(neighbor)
    return components


def main() -> int:
    root = Path("docs/evidence/asset-studio/palette")
    manifest = json.loads((root / "study-panels.json").read_text())
    assert manifest["schemaVersion"] == 1
    failures = 0
    for study in manifest["files"]:
        path = root / study["image"]
        width, height, pixels = png_rgb(path)
        assert (width, height) == (study["width"], study["height"]), f"unexpected PNG size: {path}"
        assert width <= 1024 and height <= 1024, f"oversized review image: {path}"
        size = (width, height)
        failures += compare(pixels, study["figure"]["source"], study["figure"]["zoom"],
                            study["figure"]["scale"], f'{study["image"]} figure', size)
        failures += compare(pixels, study["portrait"]["source"], study["portrait"]["zoom"],
                            study["portrait"]["scale"], f'{study["image"]} portrait', size)
        skin = rgb_at(pixels, 528, 271)
        laurel = rgb_at(pixels, 528, 439)
        if skin == laurel:
            print(f'{study["image"]} laurel/skin: same RGB {skin}')
            failures += 1
        else:
            print(f'{study["image"]} laurel/skin: distinct RGB {laurel} / {skin}')
        components = accent_components(pixels, study["figure"]["source"], laurel)
        print(f'{study["image"]} connected crown components: {components}')
        if components != 1:
            failures += 1
    print(f"total mismatching pixels: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

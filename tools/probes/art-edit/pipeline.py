"""Dependency-free pixel operations shared by the art probe's builders."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import subprocess


@dataclass(frozen=True)
class Raster:
    width: int
    height: int
    rgba: bytes

    def __post_init__(self) -> None:
        if self.width <= 0 or self.height <= 0:
            raise ValueError("raster dimensions must be positive")
        if len(self.rgba) != self.width * self.height * 4:
            raise ValueError("RGBA byte count does not match raster dimensions")

    def pixel(self, x: int, y: int) -> tuple[int, int, int, int]:
        if not (0 <= x < self.width and 0 <= y < self.height):
            raise IndexError((x, y))
        at = (y * self.width + x) * 4
        return tuple(self.rgba[at : at + 4])  # type: ignore[return-value]


def nearest_resize(source: Raster, width: int, height: int, integer_factor: bool = False) -> Raster:
    """Nearest resize, optionally requiring an integer scale on both axes."""
    x_down = source.width // width if source.width >= width else 1
    y_down = source.height // height if source.height >= height else 1
    x_up = width // source.width if width >= source.width else 1
    y_up = height // source.height if height >= source.height else 1
    if integer_factor and source.width >= width and source.width != width * x_down:
        raise ValueError("horizontal resize must use an integer factor")
    if integer_factor and source.height >= height and source.height != height * y_down:
        raise ValueError("vertical resize must use an integer factor")
    if integer_factor and width >= source.width and width != source.width * x_up:
        raise ValueError("horizontal resize must use an integer factor")
    if integer_factor and height >= source.height and height != source.height * y_up:
        raise ValueError("vertical resize must use an integer factor")

    result = bytearray(width * height * 4)
    for y in range(height):
        sy = min(source.height - 1, int((y + 0.5) * source.height / height))
        for x in range(width):
            sx = min(source.width - 1, int((x + 0.5) * source.width / width))
            src_at = (sy * source.width + sx) * 4
            dst_at = (y * width + x) * 4
            result[dst_at : dst_at + 4] = source.rgba[src_at : src_at + 4]
    return Raster(width, height, bytes(result))


def content_bands(source: Raster, threshold: int = 30) -> list[tuple[int, int, int, int]]:
    """Return half-open content boxes for vertically separated subjects."""
    corners = [source.pixel(0, 0), source.pixel(source.width - 1, 0),
               source.pixel(0, source.height - 1), source.pixel(source.width - 1, source.height - 1)]
    background = tuple(sum(p[c] for p in corners) // 4 for c in range(3))
    threshold_sq = threshold * threshold
    rows: list[tuple[int, int] | None] = []
    for y in range(source.height):
        xs = []
        for x in range(source.width):
            r, g, b, _ = source.pixel(x, y)
            if sum((value - background[channel]) ** 2 for channel, value in enumerate((r, g, b))) > threshold_sq:
                xs.append(x)
        rows.append((min(xs), max(xs) + 1) if xs else None)

    boxes = []
    start = None
    for y, row in enumerate(rows + [None]):
        if row is not None and start is None:
            start = y
        elif row is None and start is not None:
            band = [entry for entry in rows[start:y] if entry is not None]
            boxes.append((min(entry[0] for entry in band), start,
                          max(entry[1] for entry in band), y))
            start = None
    return boxes


def fit_bbox_to_cell(
    source: Raster,
    bbox: tuple[int, int, int, int],
    cell_size: tuple[int, int] = (64, 80),
    figure_height: int = 56,
) -> Raster:
    x0, y0, x1, y1 = bbox
    if not (0 <= x0 < x1 <= source.width and 0 <= y0 < y1 <= source.height):
        raise ValueError("bbox must be a non-empty half-open rectangle inside the source")
    cell_w, cell_h = cell_size
    box_w, box_h = x1 - x0, y1 - y0
    figure_w = max(1, round(box_w * figure_height / box_h))
    if figure_w > cell_w or figure_height > cell_h:
        raise ValueError("fitted figure does not fit in the target cell")
    crop_bytes = bytearray(box_w * box_h * 4)
    for y in range(box_h):
        start = ((y0 + y) * source.width + x0) * 4
        crop_bytes[y * box_w * 4 : (y + 1) * box_w * 4] = source.rgba[start : start + box_w * 4]
    figure = nearest_resize(Raster(box_w, box_h, bytes(crop_bytes)), figure_w, figure_height)
    canvas = bytearray(bytes((255, 255, 255, 255)) * (cell_w * cell_h))
    left = (cell_w - figure_w) // 2
    top = cell_h - figure_height
    for y in range(figure_height):
        src_at = y * figure_w * 4
        dst_at = ((top + y) * cell_w + left) * 4
        canvas[dst_at : dst_at + figure_w * 4] = figure.rgba[src_at : src_at + figure_w * 4]
    return Raster(cell_w, cell_h, bytes(canvas))


def olympus_palette(path: str | Path) -> list[tuple[int, int, int]]:
    data = json.loads(Path(path).read_text())
    family = next(f for f in data["families"] if f["id"] == "olympus")
    return [tuple(bytes.fromhex(shade.removeprefix("#"))) for ramp in family["ramps"] for shade in ramp["shades"]]


def decode_png(path: str | Path) -> Raster:
    dimensions = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
        "-of", "csv=s=x:p=0", str(path),
    ], text=True).strip()
    width, height = map(int, dimensions.split("x"))
    rgba = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(path), "-f", "rawvideo", "-pix_fmt", "rgba", "-",
    ])
    return Raster(width, height, rgba)


def encode_png(raster: Raster, path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        "ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s",
        f"{raster.width}x{raster.height}", "-i", "-", "-frames:v", "1", "-compression_level", "9", str(path),
    ], input=raster.rgba, check=True)


def binary_mask(width: int, height: int, rectangles: list[tuple[int, int, int, int]]) -> Raster:
    canvas = bytearray(bytes((0, 0, 0, 255)) * (width * height))
    for x, y, box_w, box_h in rectangles:
        if x < 0 or y < 0 or box_w <= 0 or box_h <= 0 or x + box_w > width or y + box_h > height:
            raise ValueError("mask rectangle is outside the canvas")
        for yy in range(y, y + box_h):
            for xx in range(x, x + box_w):
                at = (yy * width + xx) * 4
                canvas[at : at + 4] = bytes((255, 255, 255, 255))
    return Raster(width, height, bytes(canvas))


def process_sprite(source: Raster, palette: list[tuple[int, int, int]]) -> Raster:
    keyed = key_border_background(source, tolerance=36)
    if source.width != 512 or source.height != 640:
        raise ValueError("sprite processing expects a 512x640 generated source")
    padded = pad_center(keyed, 704, 880)
    reduced = nearest_resize(padded, 64, 80, integer_factor=True)
    bbox = opaque_bbox(reduced)
    figure_height = bbox[3] - bbox[1]
    if not 48 <= figure_height <= 56:
        raise ValueError(f"figure reduces to {figure_height}px tall; expected 48-56px")
    return quantize_palette(align_to_pivot(reduced, center_horizontally=False), palette)


def key_border_background(source: Raster, tolerance: int = 24) -> Raster:
    """Make border-connected pixels near the mean corner color transparent."""
    corners = [source.pixel(0, 0), source.pixel(source.width - 1, 0),
               source.pixel(0, source.height - 1), source.pixel(source.width - 1, source.height - 1)]
    reference = tuple(sum(p[c] for p in corners) // 4 for c in range(3))
    tolerance_sq = tolerance * tolerance
    seen = bytearray(source.width * source.height)
    stack = [(x, 0) for x in range(source.width)]
    stack.extend((x, source.height - 1) for x in range(source.width))
    stack.extend((0, y) for y in range(1, source.height - 1))
    stack.extend((source.width - 1, y) for y in range(1, source.height - 1))

    while stack:
        x, y = stack.pop()
        index = y * source.width + x
        if seen[index]:
            continue
        at = index * 4
        rgb = source.rgba[at : at + 3]
        if sum((rgb[c] - reference[c]) ** 2 for c in range(3)) > tolerance_sq:
            continue
        seen[index] = 1
        if x:
            stack.append((x - 1, y))
        if x + 1 < source.width:
            stack.append((x + 1, y))
        if y:
            stack.append((x, y - 1))
        if y + 1 < source.height:
            stack.append((x, y + 1))

    result = bytearray(source.rgba)
    for index, background in enumerate(seen):
        if background:
            result[index * 4 + 3] = 0
        else:
            result[index * 4 + 3] = 255
    return Raster(source.width, source.height, bytes(result))


def pad_center(source: Raster, width: int, height: int, fill: tuple[int, int, int, int] = (0, 0, 0, 0)) -> Raster:
    if width < source.width or height < source.height:
        raise ValueError("padding target must be at least as large as the source")
    left, top = (width - source.width) // 2, (height - source.height) // 2
    result = bytearray(bytes(fill) * (width * height))
    for y in range(source.height):
        src_at = y * source.width * 4
        dst_at = ((top + y) * width + left) * 4
        result[dst_at : dst_at + source.width * 4] = source.rgba[src_at : src_at + source.width * 4]
    return Raster(width, height, bytes(result))


def quantize_palette(source: Raster, palette: list[tuple[int, int, int]]) -> Raster:
    if not palette:
        raise ValueError("palette must contain at least one color")
    result = bytearray(source.rgba)
    for at in range(0, len(result), 4):
        if result[at + 3] == 0:
            result[at : at + 3] = bytes(palette[0])
            continue
        r, g, b = result[at : at + 3]
        nearest = min(palette, key=lambda p: (r - p[0]) ** 2 + (g - p[1]) ** 2 + (b - p[2]) ** 2)
        result[at : at + 3] = bytes(nearest)
        result[at + 3] = 255
    return Raster(source.width, source.height, bytes(result))


def silhouette(source: Raster) -> Raster:
    result = bytearray(len(source.rgba))
    for at in range(0, len(source.rgba), 4):
        color = 0 if source.rgba[at + 3] else 255
        result[at : at + 4] = bytes((color, color, color, 255))
    return Raster(source.width, source.height, bytes(result))


def opaque_bbox(image: Raster) -> tuple[int, int, int, int]:
    points = [(x, y) for y in range(image.height) for x in range(image.width) if image.pixel(x, y)[3]]
    if not points:
        raise ValueError("image has no opaque pixels")
    return (min(x for x, _ in points), min(y for _, y in points),
            max(x for x, _ in points) + 1, max(y for _, y in points) + 1)


def align_to_pivot(source: Raster, bottom_row: int = 79, center_horizontally: bool = True) -> Raster:
    x0, y0, x1, y1 = opaque_bbox(source)
    box_w, box_h = x1 - x0, y1 - y0
    if box_h > bottom_row + 1:
        raise ValueError(f"figure is {box_h}px high, too tall for pivot row {bottom_row}")
    left = (source.width - box_w) // 2 if center_horizontally else x0
    top = bottom_row - box_h + 1
    result = bytearray(bytes((0, 0, 0, 0)) * (source.width * source.height))
    for y in range(box_h):
        src_at = ((y0 + y) * source.width + x0) * 4
        dst_at = ((top + y) * source.width + left) * 4
        result[dst_at : dst_at + box_w * 4] = source.rgba[src_at : src_at + box_w * 4]
    return Raster(source.width, source.height, bytes(result))


def compose_grid(
    tiles: list[Raster],
    columns: int,
    picked: set[int] | None = None,
    marker: tuple[int, int, int] = (221, 191, 112),
) -> Raster:
    if not tiles or columns <= 0:
        raise ValueError("a non-empty tile list and positive column count are required")
    tile_w, tile_h = tiles[0].width, tiles[0].height
    if any(tile.width != tile_w or tile.height != tile_h for tile in tiles):
        raise ValueError("all tiles must have the same dimensions")
    rows = (len(tiles) + columns - 1) // columns
    result = bytearray(columns * tile_w * rows * tile_h * 4)
    picked = picked or set()
    for index, tile in enumerate(tiles):
        ox, oy = (index % columns) * tile_w, (index // columns) * tile_h
        for y in range(tile_h):
            for x in range(tile_w):
                if index in picked and (x == 0 or y == 0 or x == tile_w - 1 or y == tile_h - 1):
                    pixel = (*marker, 255)
                else:
                    pixel = tile.pixel(x, y)
                at = ((oy + y) * columns * tile_w + ox + x) * 4
                result[at : at + 4] = bytes(pixel)
    return Raster(columns * tile_w, rows * tile_h, bytes(result))

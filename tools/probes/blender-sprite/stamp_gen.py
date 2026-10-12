"""Authored bolt stamp: an angular zigzag in pale gold, rasterised by script at eight orientations.

This is authored pixel art, not a render. The shape is a three-segment polyline (a lightning-bolt Z) drawn with a
bright core, a mid-gold edge and a 1 px outline in the darkest shade of the pale-gold ramp, all three colours taken from
the Olympus family. Standard library only (PNG IO through pipeline.py, as in the earlier probes).

    python3 tools/probes/blender-sprite/stamp_gen.py    # rewrites stamps/bolt-<deg>.png and stamps/bolt-stamps.json
    bunx biome check --write tools/probes/blender-sprite/stamps    # the JSON is committed in biome style
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
sys.path.insert(0, str(REPO / "tools/probes/art-edit"))

STAMP_DIR = ROOT / "stamps"
LENGTH_PX = 13.0
CORE_RADIUS = 0.65  # pixel centres this close to the polyline are the bright core
EDGE_RADIUS = 1.0  # ... and this close the mid-gold body
ANGLES = tuple(range(0, 360, 45))
# (along, across) as fractions of the length: start at the grip, jog out, cross over, finish at the tip.
SHAPE = ((0.0, 0.10), (0.52, 0.30), (0.44, -0.12), (1.0, -0.28))

Rgb = tuple[int, int, int]


def polyline(angle_deg: float, length: float = LENGTH_PX) -> list[tuple[float, float]]:
    """Screen-space points (x right, y down) of the zigzag whose long axis points `angle_deg` counter-clockwise from right."""
    a = math.radians(angle_deg)
    ux, uy = math.cos(a), -math.sin(a)
    vx, vy = -uy, ux
    return [(length * (s * ux + t * vx), length * (s * uy + t * vy)) for s, t in SHAPE]


def segment_distance(px: float, py: float, a: tuple[float, float], b: tuple[float, float]) -> float:
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy
    t = 0.0 if length2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def rasterise(angle_deg: float, colours: dict[str, Rgb], length: float = LENGTH_PX) -> dict:
    """The stamp for one orientation: {"width", "height", "anchor": (x, y), "pixels": {(x, y): rgb}}.

    The anchor is the grip end of the zigzag in stamp pixel coordinates.
    """
    pts = polyline(angle_deg, length)
    pad = 3
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    x0, y0 = math.floor(min(xs)) - pad, math.floor(min(ys)) - pad
    x1, y1 = math.ceil(max(xs)) + pad, math.ceil(max(ys)) + pad
    core: dict[tuple[int, int], str] = {}
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            d = min(segment_distance(x + 0.5, y + 0.5, pts[i], pts[i + 1]) for i in range(len(pts) - 1))
            if d <= CORE_RADIUS:
                core[(x, y)] = "light"
            elif d <= EDGE_RADIUS:
                core[(x, y)] = "mid"
    pixels: dict[tuple[int, int], Rgb] = {p: colours[k] for p, k in core.items()}
    for (x, y) in core:
        for n in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if n not in core:
                pixels[n] = colours["dark"]
    left = min(x for x, _ in pixels)
    top = min(y for _, y in pixels)
    right = max(x for x, _ in pixels)
    bottom = max(y for _, y in pixels)
    shifted = {(x - left, y - top): c for (x, y), c in pixels.items()}
    anchor = (round(pts[0][0]) - left, round(pts[0][1]) - top)
    return {"width": right - left + 1, "height": bottom - top + 1, "anchor": anchor, "pixels": shifted}


def stamp_colours(palette_json: dict, family: str = "olympus", ramp: str = "pale-gold") -> dict[str, Rgb]:
    shades = next(r for f in palette_json["families"] if f["id"] == family for r in f["ramps"] if r["id"] == ramp)["shades"]
    rgb = [tuple(bytes.fromhex(s.removeprefix("#"))) for s in shades]
    return {"dark": rgb[0], "mid": rgb[2], "light": rgb[3]}  # type: ignore[dict-item]


def to_rgba(stamp: dict) -> bytes:
    out = bytearray(stamp["width"] * stamp["height"] * 4)
    for (x, y), c in stamp["pixels"].items():
        at = (y * stamp["width"] + x) * 4
        out[at : at + 4] = bytes((*c, 255))
    return bytes(out)


def nearest_angle(angle_deg: float) -> int:
    """Closest authored orientation, in degrees in [0, 360)."""
    return int(round((angle_deg % 360) / 45.0) * 45) % 360


def file_name(angle: int) -> str:
    return f"bolt-{angle:03d}.png"


def main() -> int:
    from pipeline import Raster, encode_png

    palette = json.loads((REPO / "content/greek/palette/palette.json").read_text())
    colours = stamp_colours(palette)
    variants = []
    STAMP_DIR.mkdir(parents=True, exist_ok=True)
    for angle in ANGLES:
        stamp = rasterise(angle, colours)
        encode_png(Raster(stamp["width"], stamp["height"], to_rgba(stamp)), STAMP_DIR / file_name(angle))
        variants.append(
            {"angle_deg": angle, "file": file_name(angle), "size": [stamp["width"], stamp["height"]], "anchor": list(stamp["anchor"]), "pixels": len(stamp["pixels"])}
        )
    (STAMP_DIR / "bolt-stamps.json").write_text(
        json.dumps(
            {
                "authored": True,
                "note": "Authored pixel art written by stamp_gen.py, not rendered. A three-segment zigzag polyline rasterised at eight orientations.",
                "method": "pixels within 0.65 px of the polyline are the bright core, within 1.0 px the mid-gold body, then a 1 px 4-neighbour outline",
                "palette": {"family": "olympus", "ramp": "pale-gold", "dark": "#%02x%02x%02x" % colours["dark"], "mid": "#%02x%02x%02x" % colours["mid"], "light": "#%02x%02x%02x" % colours["light"]},
                "length_px": LENGTH_PX,
                "anchor_meaning": "pixel of the grip end of the zigzag, in the stamp's own coordinates; it is placed on the projected bolt-hand point",
                "angle_meaning": "direction of the zigzag's long axis, degrees counter-clockwise from screen right",
                "variants": variants,
            },
            indent=1,
        )
        + "\n"
    )
    print(json.dumps({"variants": len(variants), "sizes": [v["size"] for v in variants]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

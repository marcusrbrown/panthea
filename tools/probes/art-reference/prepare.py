"""Cuts the canon idle-south and seated-south frame 0 out of the zeus-sprite atlas and upscales each x8 (nearest) to 512x640.

    python3 tools/probes/art-reference/prepare.py

Writes `.context/studio-pipeline/art-reference/refs/{idle,seated}-south-0-x8.png`. Standard library only.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "tools/probes/art-edit"))

from pipeline import Raster, decode_png, encode_png, nearest_resize  # noqa: E402

ATLAS = REPO / "content/greek/assets/registry/blobs/9976a62d051e1f0349a1f61d5f1cf2e3e673b8b06e97760290c8b99f5c626a69.png"
OUT = REPO / ".context/studio-pipeline/art-reference/refs"
# name -> atlas x of frame 0 (from the zeus-sprite manifest: idle south frame 0 at x=0, seated south frame 0 at x=256)
FRAMES = {"idle-south-0": 0, "seated-south-0": 256}
CELL_W, CELL_H = 64, 80


def crop(source: Raster, x: int, y: int, w: int, h: int) -> Raster:
    rows = [source.rgba[((y + j) * source.width + x) * 4 : ((y + j) * source.width + x + w) * 4] for j in range(h)]
    return Raster(w, h, b"".join(rows))


def main() -> int:
    atlas = decode_png(ATLAS)
    OUT.mkdir(parents=True, exist_ok=True)
    for name, x in FRAMES.items():
        big = nearest_resize(crop(atlas, x, 0, CELL_W, CELL_H), 512, 640)
        encode_png(big, OUT / f"{name}-x8.png")
        print(name, big.width, big.height)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

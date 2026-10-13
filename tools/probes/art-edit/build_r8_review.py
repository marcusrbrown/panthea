#!/usr/bin/env python3
"""Build review strips from the finished studio sprite working set."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline import Raster, compose_grid, decode_png, encode_png, nearest_resize

ROOT = Path(__file__).resolve().parents[3]
STORE = ROOT / ".context/studio-pipeline/u7-creative/studio"
REVIEW = ROOT / ".context/studio-pipeline/u7-creative/r8/review"
SET_ID = "zeus-idle-south-u7-r8-final"
SLOT = "idle/south"


def main() -> None:
    record = json.loads((STORE / "working-sets" / f"{SET_ID}.json").read_text())
    slot = record["frames"][SLOT]
    refs = slot["frames"]
    if len(refs) != 4 or [ref["durationMs"] for ref in refs] != [167, 166, 167, 166]:
        raise ValueError("expected the four specified idle frame durations")
    if slot["pivot"] != {"x": 32, "y": 80}:
        raise ValueError("expected the pivot at (32,80)")

    frames = [decode_png(STORE / "blobs" / f"{ref['hash']}.png") for ref in refs]
    if any(frame.width != 64 or frame.height != 80 for frame in frames):
        raise ValueError("all final frames must be 64x80")
    strip = compose_grid(frames, columns=4)
    encode_png(strip, REVIEW / "sprite-idle-final-1x.png")
    encode_png(
        nearest_resize(strip, strip.width * 4, strip.height * 4, integer_factor=True),
        REVIEW / "sprite-idle-final-4x.png",
    )

    threshold_frames: list[Raster] = []
    for frame in frames:
        rgba = bytearray(frame.width * frame.height * 4)
        for y in range(frame.height):
            for x in range(frame.width):
                offset = (y * frame.width + x) * 4
                colour = (255, 255, 255, 255) if frame.pixel(x, y)[3] >= 128 else (0, 0, 0, 255)
                rgba[offset : offset + 4] = bytes(colour)
        threshold_frames.append(Raster(frame.width, frame.height, bytes(rgba)))
    threshold_strip = compose_grid(threshold_frames, columns=4)
    encode_png(threshold_strip, REVIEW / "sprite-idle-silhouette-threshold-1x.png")
    encode_png(
        nearest_resize(
            threshold_strip,
            threshold_strip.width * 4,
            threshold_strip.height * 4,
            integer_factor=True,
        ),
        REVIEW / "sprite-idle-silhouette-threshold-4x.png",
    )

    (REVIEW / "sprite-idle-final-order.json").write_text(
        json.dumps(
            {
                "workingSetId": SET_ID,
                "slot": SLOT,
                "pivot": slot["pivot"],
                "durationsMs": [ref["durationMs"] for ref in refs],
                "frames": [
                    {"index": index + 1, "hash": ref["hash"], "durationMs": ref["durationMs"]}
                    for index, ref in enumerate(refs)
                ],
            },
            indent=2,
        )
        + "\n"
    )


if __name__ == "__main__":
    main()

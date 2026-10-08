from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pipeline import Raster, decode_png, encode_png, opaque_bbox
from round9_pixels import (
    CREAM,
    PORTRAIT_SLOTS,
    clean_sprite,
    cleanup_portrait_sheet,
    _horizontal_strip,
    _mouth_pixels,
    outline_sprite,
)


# The selected round 9 sprite candidate is a studio blob in gitignored scratch,
# so a fresh checkout does not have it.
ROOT = Path(__file__).resolve().parents[3]
SELECTED_SPRITE = (
    ROOT
    / ".context/studio-pipeline/u7-creative/studio/blobs"
    / "b1c15745f27ec67e80382f5d1d6ee19f139d33fca525e2401851134877b5c918.png"
)


class Round9PixelTests(unittest.TestCase):
    def test_expression_mouths_are_distinct_and_in_width_range(self) -> None:
        mouths = {name: _mouth_pixels(name) for name in PORTRAIT_SLOTS[1:]}
        signatures = {name: frozenset(mouth.items()) for name, mouth in mouths.items()}
        self.assertEqual(len(set(signatures.values())), 5)
        for mouth in mouths.values():
            width = max(x for x, _ in mouth) - min(x for x, _ in mouth) + 1
            self.assertGreaterEqual(width, 8)
            self.assertLessEqual(width, 12)

    def test_scripted_portraits_restore_all_non_edit_pixels(self) -> None:
        neutral = Raster(96, 96, bytes(CREAM) * (96 * 96))
        frames = [neutral]
        for index in range(1, 6):
            pixels = bytearray(neutral.rgba)
            for x, y in ((0, 0), (20, 20), (80, 80)):
                at = (y * 96 + x) * 4
                pixels[at : at + 4] = bytes((index, 0, 0, 255))
            frames.append(Raster(96, 96, bytes(pixels)))

        template = {
            "frames": [
                {
                    "filename": f"frame-{index}.png",
                    "frame": {"x": index * 96, "y": 0, "w": 96, "h": 96},
                    "rotated": False,
                    "trimmed": False,
                    "spriteSourceSize": {"x": 0, "y": 0, "w": 96, "h": 96},
                    "sourceSize": {"w": 96, "h": 96},
                    "duration": 100,
                }
                for index in range(6)
            ],
            "meta": {
                "size": {"w": 576, "h": 96},
                "frameTags": [
                    {"name": name, "from": index, "to": index, "direction": "forward"}
                    for index, name in enumerate(PORTRAIT_SLOTS)
                ],
                "slices": [],
            },
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            temp = Path(temp_dir)
            source_png = temp / "source.png"
            source_json = temp / "source.json"
            output_png = temp / "output.png"
            stats_json = temp / "stats.json"
            encode_png(_horizontal_strip(frames), source_png)
            source_json.write_text(json.dumps(template))
            stats = cleanup_portrait_sheet(source_png, source_json, output_png, stats_json)
            self.assertEqual(set(stats["outsideEditRectangleDriftPixels"].values()), {0})
            self.assertEqual(stats["mouthWidthsPx"], {
                "pleased": 10,
                "angry": 10,
                "grieving": 10,
                "scheming": 10,
                "awed": 9,
            })
            self.assertEqual((decode_png(output_png).width, decode_png(output_png).height), (576, 96))

    def test_outline_is_one_pixel_on_the_existing_outer_contour(self) -> None:
        pixels = bytearray(bytes((240, 238, 224, 255)) * (5 * 5))
        source = Raster(5, 5, bytes(pixels))
        outlined, metrics = outline_sprite(source)
        self.assertEqual(opaque_bbox(outlined), (0, 0, 5, 5))
        self.assertEqual(metrics["coveragePercent"], 100.0)
        self.assertEqual(outlined.pixel(0, 0), (36, 63, 99, 255))
        self.assertEqual(outlined.pixel(2, 2), (240, 238, 224, 255))

    @unittest.skipUnless(
        SELECTED_SPRITE.exists(),
        "needs the local studio blob .context/studio-pipeline/u7-creative/studio/"
        "blobs/b1c15745...png (gitignored scratch, absent on a fresh checkout)",
    )
    def test_selected_sprite_meets_round9_geometry(self) -> None:
        base, bob, metrics = clean_sprite(decode_png(SELECTED_SPRITE))
        self.assertEqual(metrics["footMidpointX"], 32.0)
        self.assertEqual(metrics["boltSizePx"], [10, 15])
        self.assertTrue(metrics["boltHandConnected"])
        self.assertEqual(metrics["outline"]["coveragePercent"], 100.0)
        self.assertEqual(opaque_bbox(base)[3] - opaque_bbox(base)[1], 55)
        self.assertEqual(opaque_bbox(bob)[3] - opaque_bbox(bob)[1], 56)
        self.assertTrue(metrics["lowerLegAnchorPixelsFixed"])


if __name__ == "__main__":
    unittest.main()

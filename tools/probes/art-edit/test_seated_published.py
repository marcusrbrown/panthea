"""The published Zeus seated cells against the committed spec, from repository files alone.

The seated frames in canon atlas 9060ecc7... were built by `sprite_seated_composite.py` from the committed spec
(`seated_spec_zeus.json`), idle frame 0 and a generated candidate cell. The candidate is scratch and is not in the
repository, so these tests check what can be checked without it: the published seated cells satisfy every rule of the spec
against the published idle frame 0, and `frame2` reproduces the published second frame from the published first.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pipeline import Raster, decode_png
from sprite_seated_composite import frame2, load_spec, rise_problems, verify

REPO = Path(__file__).resolve().parents[3]
ATLAS = REPO / "content/greek/assets/registry/blobs/9060ecc772da1fe4ed75d0f05ae6ae9e4b5fe3f2939dfa841097769e16fff6f8.png"
MANIFEST = REPO / "content/greek/assets/registry/manifests/1b14d579023e5f6a46d8052fa6d067a72ee97d6e9019157e2282bb8c143d4b3a.json"
SPEC = Path(__file__).parent / "seated_spec_zeus.json"
CELL_W, CELL_H = 64, 80


def cell_of(atlas: Raster, x: int) -> Raster:
    rows = bytearray()
    for y in range(CELL_H):
        rows += atlas.rgba[(y * atlas.width + x) * 4 : (y * atlas.width + x + CELL_W) * 4]
    return Raster(CELL_W, CELL_H, bytes(rows))


@unittest.skipUnless(ATLAS.exists() and MANIFEST.exists(), "the published canon revision is absent")
class PublishedSeated(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        manifest = json.loads(MANIFEST.read_text())
        cls.animations = {a["state"]: a["frames"] for a in manifest["animations"]}
        atlas = decode_png(ATLAS)
        cls.idle0 = cell_of(atlas, cls.animations["idle"][0]["rect"]["x"])
        cls.f0 = cell_of(atlas, cls.animations["seated"][0]["rect"]["x"])
        cls.f1 = cell_of(atlas, cls.animations["seated"][1]["rect"]["x"])
        cls.spec = load_spec(SPEC)

    def test_the_published_seated_state_is_two_frames_of_500_ms_beside_idle(self) -> None:
        self.assertEqual([f["durationMs"] for f in self.animations["seated"]], [500, 500])
        self.assertEqual([f["durationMs"] for f in self.animations["idle"]], [333, 167, 333, 167])

    def test_the_first_seated_frame_keeps_idle_frame_0_and_obeys_every_rule_of_the_spec(self) -> None:
        self.assertEqual(verify(self.f0, self.idle0, self.spec), [])

    def test_frame2_of_the_spec_reproduces_the_published_second_frame_pixel_for_pixel(self) -> None:
        self.assertEqual(frame2(self.f0, self.spec).rgba, self.f1.rgba)
        self.assertEqual(rise_problems(self.f0, self.f1, self.spec), [])

    def test_a_pixel_changed_in_the_kept_head_breaks_the_rules(self) -> None:
        data = bytearray(self.f0.rgba)
        # idle row 31 (the head top) moved down by dy sits in the kept region; recolour its first opaque pixel
        y = 31 + int(self.spec["dy"])
        x = next(x for x in range(CELL_W) if data[(y * CELL_W + x) * 4 + 3])
        at = (y * CELL_W + x) * 4
        data[at : at + 3] = bytes((1, 2, 3))
        problems = verify(Raster(CELL_W, CELL_H, bytes(data)), self.idle0, self.spec)
        self.assertTrue(problems)


if __name__ == "__main__":
    unittest.main()

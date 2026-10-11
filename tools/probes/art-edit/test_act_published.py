"""The committed Zeus act spec (`act_spec_zeus.json`) rebuilt from repository files alone.

The five frames of `act/south/thunderbolt` (83/100/83/83/100 ms, 449 ms) are assembled by `sprite_act_composite.py` from the
committed spec and the canon idle frame 0. The act is not published yet, so there is no published atlas to compare against;
this checks what repository files can: the spec builds and verifies against the published idle frame 0 (the idle cell of the
canon atlas), every rule of the composite holds, and the last frame is idle itself. Where the authoring scratch (the C2c frame
and the five source PNGs under `.context/`) exists, every frame is also compared byte for byte with its source. Once the act is
published, add a test that compares these frames with the published atlas cells.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pipeline import Raster, decode_png
from sprite_act_composite import (
    SLOT,
    build_frames,
    cross_frame_problems,
    duration_problems,
    load_act_spec,
)
from sprite_seated_composite import opaque_cells

REPO = Path(__file__).resolve().parents[3]
ATLAS = REPO / "content/greek/assets/registry/blobs/9060ecc772da1fe4ed75d0f05ae6ae9e4b5fe3f2939dfa841097769e16fff6f8.png"
MANIFEST = REPO / "content/greek/assets/registry/manifests/1b14d579023e5f6a46d8052fa6d067a72ee97d6e9019157e2282bb8c143d4b3a.json"
SPEC = Path(__file__).parent / "act_spec_zeus.json"
DURATIONS = [83, 100, 83, 83, 100]
CELL_W, CELL_H = 64, 80
SCRATCH = REPO / ".context/studio-pipeline"
SOURCES = [
    SCRATCH / "act/build/act-f0.png",
    SCRATCH / "act/build/act-f1.png",
    SCRATCH / "act/keypose/keypose.png",
    SCRATCH / "act/build/act-f3.png",
    SCRATCH / "c2/c2c.png",
]


def cell_of(atlas: Raster, x: int) -> Raster:
    rows = bytearray()
    for y in range(CELL_H):
        rows += atlas.rgba[(y * atlas.width + x) * 4 : (y * atlas.width + x + CELL_W) * 4]
    return Raster(CELL_W, CELL_H, bytes(rows))


@unittest.skipUnless(ATLAS.exists() and MANIFEST.exists(), "the published canon revision is absent")
class CommittedActSpec(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        manifest = json.loads(MANIFEST.read_text())
        animations = {a["state"]: a["frames"] for a in manifest["animations"]}
        cls.idle0 = cell_of(decode_png(ATLAS), animations["idle"][0]["rect"]["x"])
        cls.spec = load_act_spec(SPEC)
        cls.frames, cls.reports = build_frames(cls.idle0, cls.spec)

    def test_the_spec_is_five_frames_of_the_act_slot_and_the_owners_timing_passes(self) -> None:
        self.assertEqual(self.spec["slot"], SLOT)
        self.assertEqual([f["name"] for f in self.spec["frames"]], ["anticipation", "high-wind-up", "release-key-pose", "follow-through", "recover-idle"])
        self.assertEqual(duration_problems(DURATIONS, 5), [])
        self.assertEqual(sum(DURATIONS), 449)

    def test_every_frame_builds_and_verifies_against_the_published_idle_frame(self) -> None:
        self.assertEqual(len(self.frames), 5)
        self.assertEqual(cross_frame_problems(self.frames, self.idle0, self.spec), [])

    def test_the_frame_counts_are_the_reviewed_ones(self) -> None:
        self.assertEqual([r["new_pixels"] for r in self.reports], [166, 151, 224, 72, 0])
        self.assertEqual([r["occluded_pixels"] for r in self.reports], [0, 0, 116, 0, 0])
        self.assertEqual([r.get("rulings") for r in self.reports], [9, 7, 14, 5, None])
        self.assertEqual([r.get("colours") for r in self.reports], [13, 13, 13, 12, None])

    def test_only_the_release_frame_covers_the_robe_and_the_last_frame_is_idle_itself(self) -> None:
        self.assertEqual([bool(f.get("occlude")) for f in self.spec["frames"]], [False, False, True, False, False])
        self.assertTrue(self.spec["frames"][4]["identical_to_idle"])
        self.assertEqual(self.frames[4].rgba, self.idle0.rgba)

    def test_the_body_is_idle_in_every_frame(self) -> None:
        regions = [tuple(b) for b in self.spec["regions"]]
        occluded = [tuple(b) for f in self.spec["frames"] for b in f.get("occlude", [])]
        outside = [
            p
            for p in opaque_cells(self.idle0)
            if not any(b[0] <= p[0] <= b[2] and b[1] <= p[1] <= b[3] for b in regions + occluded)
        ]
        self.assertGreater(len(outside), 400)
        for frame in self.frames:
            for x, y in outside:
                self.assertEqual(frame.pixel(x, y), self.idle0.pixel(x, y), (x, y))

    def test_the_feet_stay_on_row_79_in_every_frame(self) -> None:
        for frame in self.frames:
            cells = opaque_cells(frame)
            self.assertEqual(max(y for _, y in cells), 79)

    def test_no_occlude_box_reaches_the_protected_rows(self) -> None:
        for frame in self.spec["frames"]:
            for _, y0, _, y1 in frame.get("occlude", []):
                self.assertTrue(48 <= y0 and y1 <= 75, (y0, y1))


@unittest.skipUnless(
    ATLAS.exists() and MANIFEST.exists() and all(p.exists() for p in SOURCES),
    "the authoring scratch (C2c and the five source PNGs) is gitignored and absent",
)
class AgainstTheAuthoringSources(unittest.TestCase):
    def test_every_frame_is_byte_identical_to_its_source_png(self) -> None:
        idle0 = decode_png(SOURCES[4])
        frames, _ = build_frames(idle0, SPEC)
        for index, (frame, source) in enumerate(zip(frames, SOURCES)):
            self.assertEqual(frame.rgba, decode_png(source).rgba, f"frame {index} differs from {source.name}")


if __name__ == "__main__":
    unittest.main()

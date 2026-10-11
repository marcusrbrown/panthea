"""The committed Zeus act spec (`act_spec_zeus.json`) against the published canon atlas, from repository files alone.

The five frames of `act/south/thunderbolt` (83/100/83/83/100 ms, 449 ms; key pose 1 is the release frame) were assembled by
`sprite_act_composite.py` from the committed spec and canon idle frame 0, and published in `zeus-sprite` revision 1382b7f7...
(atlas 9976a62d...). The spec is rebuilt here from the published idle cell, every rule of the composite is checked, and the five
published act cells are compared with the rebuilt frames. Where the authoring scratch (the C2c frame and the source PNGs under
`.context/`) exists, every frame is also compared with its source.
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
ATLAS = REPO / "content/greek/assets/registry/blobs/9976a62d051e1f0349a1f61d5f1cf2e3e673b8b06e97760290c8b99f5c626a69.png"
MANIFEST = REPO / "content/greek/assets/registry/manifests/1382b7f7604f3fed64721f7f1bb4ee99f474d1ddafed5bde2aa7a1487230a56d.json"
SPEC = Path(__file__).parent / "act_spec_zeus.json"
DURATIONS = [83, 100, 83, 83, 100]
CELL_W, CELL_H = 64, 80
SCRATCH = REPO / ".context/studio-pipeline"
SOURCES = [
    SCRATCH / "act/build/act-f0.png",
    SCRATCH / "act/build/act-f1.png",
    SCRATCH / "act/keypose/r1/keypose.png",
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
        cls.manifest = manifest
        animations = {a["state"]: a["frames"] for a in manifest["animations"]}
        atlas = decode_png(ATLAS)
        cls.animations = animations
        cls.idle0 = cell_of(atlas, animations["idle"][0]["rect"]["x"])
        cls.published = [cell_of(atlas, f["rect"]["x"]) for f in animations["act"]]
        cls.spec = load_act_spec(SPEC)
        cls.frames, cls.reports = build_frames(cls.idle0, cls.spec)

    def test_the_spec_is_five_frames_of_the_act_slot_and_the_owners_timing_passes(self) -> None:
        self.assertEqual(self.spec["slot"], SLOT)
        self.assertEqual([f["name"] for f in self.spec["frames"]], ["anticipation", "high-wind-up", "release-key-pose", "follow-through", "recover-idle"])
        self.assertEqual(duration_problems(DURATIONS, 5), [])
        self.assertEqual(sum(DURATIONS), 449)

    def test_the_published_act_is_five_frames_beside_idle_and_seated(self) -> None:
        act = self.animations["act"]
        self.assertEqual([a["state"] for a in self.manifest["animations"]], ["idle", "seated", "act"])
        self.assertEqual(self.manifest["animations"][2]["ability"], "thunderbolt")
        self.assertEqual([f["durationMs"] for f in act], DURATIONS)
        self.assertEqual([f["rect"]["x"] for f in act], [384, 448, 512, 576, 640])
        self.assertEqual([f["durationMs"] for f in self.animations["idle"]], [333, 167, 333, 167])
        self.assertEqual([f["durationMs"] for f in self.animations["seated"]], [500, 500])

    def test_the_published_act_cells_are_the_frames_the_committed_spec_builds(self) -> None:
        for index, (built, published) in enumerate(zip(self.frames, self.published)):
            self.assertEqual(built.rgba, published.rgba, f"act frame {index} differs from the published cell")

    def test_every_frame_builds_and_verifies_against_the_published_idle_frame(self) -> None:
        self.assertEqual(len(self.frames), 5)
        self.assertEqual(cross_frame_problems(self.frames, self.idle0, self.spec), [])

    def test_the_frame_counts_are_the_reviewed_ones(self) -> None:
        self.assertEqual([r["new_pixels"] for r in self.reports], [166, 151, 213, 72, 0])
        self.assertEqual([r["occluded_pixels"] for r in self.reports], [0, 0, 117, 0, 0])
        self.assertEqual([r.get("rulings") for r in self.reports], [9, 7, 21, 5, None])
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
        self.assertGreater(len(outside), 300)
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

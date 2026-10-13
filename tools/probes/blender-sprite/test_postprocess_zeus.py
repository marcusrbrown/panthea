from __future__ import annotations

import shutil
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import postprocess_zeus as pz
import proxy_plan as pp
import sprite_plan as sp
from pipeline import Raster
from sprite_downscale import load_palette

W4, H4 = sp.render_size("x4")
PALETTE = load_palette(pz.p1.PALETTE_JSON)


def id_image(blocks: dict[tuple[int, int], list[str]]) -> Raster:
    """4x ID image: block (bx, by) filled from a list of 16 part names (row-major), others transparent."""
    out = bytearray(W4 * H4 * 4)
    for (bx, by), names in blocks.items():
        for k, name in enumerate(names):
            x, y = bx * 4 + k % 4, by * 4 + k // 4
            b = pp.id_byte(name)
            out[(y * W4 + x) * 4 : (y * W4 + x) * 4 + 4] = bytes((b, b, b, 255))
    return Raster(W4, H4, bytes(out))


def depth_image(blocks: dict[tuple[int, int], int]) -> Raster:
    out = bytearray(W4 * H4 * 4)
    for (bx, by), byte in blocks.items():
        for k in range(16):
            x, y = bx * 4 + k % 4, by * 4 + k // 4
            out[(y * W4 + x) * 4 : (y * W4 + x) * 4 + 4] = bytes((byte, byte, byte, 255))
    return Raster(W4, H4, bytes(out))


class BlockMapTests(unittest.TestCase):
    def test_modal_part_and_its_mean_depth(self) -> None:
        names = ["arm_r"] * 10 + ["torso"] * 6
        parts, depths, unknown = pz.block_maps(id_image({(3, 2): names}), depth_image({(3, 2): pp.encode_depth(20.0)}))
        at = 2 * sp.CELL[0] + 3
        self.assertEqual(parts[at], "arm_r")
        self.assertAlmostEqual(depths[at], 20.0, delta=0.06)
        self.assertEqual(unknown, 0)
        self.assertIsNone(parts[0])

    def test_transparent_block_is_none_and_unknown_ids_are_counted(self) -> None:
        img = id_image({(1, 1): ["head"] * 16})
        rgba = bytearray(img.rgba)
        for k in range(4):  # corrupt four pixels of that block into an undecodable byte
            at = ((1 * 4) * W4 + 4 + k) * 4
            rgba[at : at + 4] = bytes((4, 4, 4, 255))
        parts, _, unknown = pz.block_maps(Raster(W4, H4, bytes(rgba)), depth_image({(1, 1): 100}))
        self.assertEqual(unknown, 4)
        self.assertEqual(parts[1 * sp.CELL[0] + 1], "head")


class PanelTests(unittest.TestCase):
    def test_panel_indices_scale_and_backdrop(self) -> None:
        rgba = bytearray(64 * 80 * 4)
        rgba[0:4] = bytes((10, 20, 30, 255))
        lookup = {(10, 20, 30): 0, pz.BACKDROP: 1}
        rows = pz.panel_indices(Raster(64, 80, bytes(rgba)), lookup, 4)
        self.assertEqual(len(rows), 320)
        self.assertEqual(rows[0][:4], bytes([0, 0, 0, 0]))
        self.assertEqual(rows[3][:4], bytes([0, 0, 0, 0]))
        self.assertEqual(rows[0][4], 1)
        self.assertEqual(rows[4][0], 1)

    def test_lightness_orders_shades(self) -> None:
        ramp = [tuple(bytes.fromhex(h)) for h in ("526471", "8fa6ad", "c7d8d4", "f0eee0")]
        values = [pz.lightness(c) for c in ramp]
        self.assertEqual(values, sorted(values))

    def test_rgb_at(self) -> None:
        img = Raster(2, 1, bytes((1, 2, 3, 255, 9, 9, 9, 0)))
        self.assertEqual(pz.rgb_at(img, 0), (1, 2, 3))
        self.assertIsNone(pz.rgb_at(img, 1))


class BuildCellTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg is not on PATH (PNG IO goes through it)")
    def test_overlap_line_is_drawn_inside_and_exterior_outline_outside(self) -> None:
        import tempfile

        from pipeline import encode_png

        light = PALETTE.colours[2]
        out = bytearray(W4 * H4 * 4)
        for y in range(40 * 4, 60 * 4):
            for x in range(20 * 4, 30 * 4):
                out[(y * W4 + x) * 4 : (y * W4 + x) * 4 + 4] = bytes((*light, 255))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "rgb.png"
            encode_png(Raster(W4, H4, bytes(out)), path)
            parts = [None] * (64 * 80)
            depths = [0.0] * (64 * 80)
            for y in range(40, 60):
                for x in range(20, 30):
                    parts[y * 64 + x] = "torso" if x < 25 else "arm_r"
                    depths[y * 64 + x] = 20.0 if x < 25 else 19.5  # arm_r in front
            built = pz.build_cell(path, parts, depths, PALETTE)
        cell = built["cell"]
        self.assertTrue(built["drawn"])
        self.assertTrue(all((i % 64) == 24 for i in built["drawn"]), "the line sits on the far (torso) side of the boundary")
        self.assertIn(cell.pixel(24, 50)[:3], set(PALETTE.darkest.values()))
        self.assertEqual(cell.pixel(19, 50)[3], 255)  # exterior outline
        self.assertEqual(cell.pixel(31, 50)[3], 0)


if __name__ == "__main__":
    unittest.main()

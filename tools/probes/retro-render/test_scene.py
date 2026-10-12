from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import retro_plan as rp
import retro_sheets as rs
import scene_plan as sc
import tile_geom as tg
from pipeline import Raster


def solid(w: int, h: int, rgb=(200, 10, 10)) -> Raster:
    return Raster(w, h, bytes((*rgb, 255)) * (w * h))


class TimelineTests(unittest.TestCase):
    def test_steps_cover_the_whole_loop_in_centiseconds(self) -> None:
        steps = rs.timeline_ms([rp.CANON_IDLE_MS, rp.ZEUS.clips[0].timing_ms], 4000)
        self.assertEqual(sum(cs for cs, _ in steps), 400)

    def test_frame_choice_follows_each_schedule(self) -> None:
        steps = rs.timeline_ms([(300, 700), (500, 500)], 1000)
        self.assertEqual(steps[0], (30, (0, 0)))
        self.assertEqual(steps[1], (20, (1, 0)))
        self.assertEqual(steps[2][1], (1, 1))

    def test_every_scene_schedule_divides_the_loop(self) -> None:
        for name, schedule in sc.schedules():
            self.assertEqual(sc.TOTAL_MS % sum(schedule), 0, name)

    def test_scene_steps_are_exact(self) -> None:
        steps = rs.timeline_ms([s for _, s in sc.schedules()], sc.TOTAL_MS)
        self.assertEqual(sum(cs for cs, _ in steps), sc.TOTAL_MS // 10)
        self.assertTrue(all(cs > 0 for cs, _ in steps))

    def test_rounding_does_not_accumulate(self) -> None:
        steps = rs.timeline_ms([rp.ZEUS.clips[0].timing_ms], 4000)
        self.assertEqual(sum(cs for cs, _ in steps), 400)  # six 166.67 ms holds, four loops


class GifDelayTests(unittest.TestCase):
    def test_delays_are_rewritten_exactly(self) -> None:
        import subprocess

        with tempfile.TemporaryDirectory() as tmp:
            frames = [solid(4, 4, (i * 40, 0, 0)) for i in range(4)]
            delays = [12, 4, 4, 12]
            path = Path(tmp) / "t.gif"
            try:
                rs.write_png_gif_ffmpeg(frames, delays, path, 1, Path(tmp) / "f")
            except (FileNotFoundError, subprocess.CalledProcessError):
                self.skipTest("ffmpeg is not available")
            self.assertEqual(rs.gif_delays(path), delays)

    def test_wrong_frame_count_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "t.gif"
            path.write_bytes(b"GIF89a" + b"\x21\xf9\x04\x04\x05\x00\x00\x00")
            with self.assertRaises(ValueError):
                rs.set_gif_delays(path, [1, 2])
            rs.set_gif_delays(path, [9])
            self.assertEqual(rs.gif_delays(path), [9])


class PlacementTests(unittest.TestCase):
    def test_tile_centre(self) -> None:
        self.assertEqual(rs.tile_centre(0, 0), (0.0, 15.5))
        self.assertEqual(rs.tile_centre(1, 0), (32.0, 31.5))
        self.assertEqual(rs.tile_centre(0, 1), (-32.0, 31.5))

    def test_a_character_stands_on_the_tile_centre(self) -> None:
        e = rs.Entity("z", "zeus", "idle", "south", 2, 3, layer=2)
        px, py = rs.sprite_position(e, rp.ZEUS)
        cx, cy = rs.tile_centre(2, 3)
        self.assertEqual((px + rp.ZEUS.pivot_px[0], py + rp.ZEUS.pivot_px[1]), (round(cx), round(cy)))

    def test_a_building_pivot_sits_on_its_bottom_vertex(self) -> None:
        e = rs.Entity("t", "temple", "static", "south", 1, 0, (3, 2), layer=1)
        px, py = rs.sprite_position(e, rp.TEMPLE)
        vx, vy = tg.bottom_vertex(1, 0, 0, 3, 2)
        self.assertEqual((px + rp.TEMPLE.pivot_px[0], py + rp.TEMPLE.pivot_px[1]), (vx, vy))

    def test_depth_is_the_bottom_cell_sum_with_layer_tiebreak(self) -> None:
        a = rs.Entity("a", "zeus", "idle", "south", 3, 4, layer=2)
        b = rs.Entity("b", "tree", "wind", "south", 3, 4, layer=1)
        self.assertGreater(rs.depth_key(a), rs.depth_key(b))
        t = rs.Entity("t", "temple", "static", "south", 1, 0, (3, 2), layer=1)
        self.assertEqual(rs.depth_key(t)[0], (1 + 2) + (0 + 1))

    def test_compose_draws_ground_first_then_depth_order(self) -> None:
        ground = rs.Entity("g", "tile", "path", "south", 0, 0, layer=0)
        near = rs.Entity("near", "zeus", "idle", "south", 1, 1, layer=2)
        far = rs.Entity("far", "mortal", "idle", "south", 0, 0, layer=2)
        items = {"tile": rp.TILE, "zeus": rp.ZEUS, "mortal": rp.MORTAL}
        ents = [near, far, ground]
        bounds = rs.canvas_bounds(ents, items)
        sprites = {"g": solid(64, 32, (1, 1, 1)), "near": solid(64, 80, (9, 9, 9)), "far": solid(64, 64, (5, 5, 5))}
        img = rs.compose(ents, sprites, items, bounds)
        self.assertEqual(img.width, bounds[2] - bounds[0])
        centre_near = rs.sprite_position(near, rp.ZEUS)
        x = centre_near[0] - bounds[0] + 32
        y = centre_near[1] - bounds[1] + 70
        self.assertEqual(img.pixel(x, y)[:3], (9, 9, 9))

    def test_bounds_contain_every_sprite(self) -> None:
        ents = sc.ground_entities() + sc.object_entities()
        items = dict(rp.ITEMS)
        items["canon"] = rp.ZEUS
        x0, y0, x1, y1 = rs.canvas_bounds(ents, items)
        for e in ents:
            if e.layer:
                px, py = rs.sprite_position(e, items[e.item])
                self.assertGreaterEqual(px, x0)
                self.assertGreaterEqual(py, y0)
                self.assertLessEqual(px + items[e.item].cell[0], x1)

    def test_scene_has_every_required_item(self) -> None:
        keys = {e.key for e in sc.object_entities()}
        self.assertTrue({"temple", "tree", "zeus", "mortal", "canon", "house"} <= keys)
        grounds = sc.ground_entities()
        self.assertEqual(len(grounds), sc.GRID_W * sc.GRID_H)
        self.assertEqual(sum(1 for g in grounds if g.clip == "path"), len(sc.PATH_TILES))

    def test_nothing_stands_on_a_tile_outside_the_grid(self) -> None:
        for e in sc.object_entities():
            self.assertTrue(0 <= e.x < sc.GRID_W and 0 <= e.y < sc.GRID_H, e.key)


class SheetTests(unittest.TestCase):
    def test_contact_sheet_puts_canon_in_the_first_column(self) -> None:
        rows = [rs.Row("I", (rs.Tile("S0", solid(10, 12, (9, 9, 9))),))]
        canon = solid(10, 12, (5, 5, 5))
        sheet = rs.contact_sheet(rows, canon)
        self.assertEqual(sheet.pixel(rs.LEFT_W + 5, 6)[:3], (5, 5, 5))
        self.assertEqual(sheet.pixel(rs.LEFT_W + 10 + rs.GUTTER + 5, 6)[:3], (9, 9, 9))

    def test_enlarge(self) -> None:
        self.assertEqual(rs.enlarge(solid(3, 2), 4).width, 12)

    def test_blit_clips_and_respects_binary_alpha(self) -> None:
        canvas = bytearray(4 * 4 * 4)
        sprite = Raster(2, 1, bytes((1, 2, 3, 255, 9, 9, 9, 0)))
        rs.blit(canvas, 4, 4, sprite, 3, 0)
        self.assertEqual(tuple(canvas[12:16]), (1, 2, 3, 255))
        rs.blit(canvas, 4, 4, sprite, -5, -5)  # entirely outside: no error
        self.assertEqual(sum(canvas) , 1 + 2 + 3 + 255)


if __name__ == "__main__":
    unittest.main()

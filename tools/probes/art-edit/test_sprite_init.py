import unittest

from build_sprite_init import create_masks, create_sprite_1x, image_metrics
from pipeline import nearest_resize, olympus_palette


class SpriteInitTests(unittest.TestCase):
    def setUp(self):
        from pathlib import Path

        palette_path = Path(__file__).resolve().parents[3] / "content/greek/palette/palette.json"
        self.palette = olympus_palette(palette_path)
        self.sprite = create_sprite_1x(self.palette)

    def test_sprite_meets_idle_cell_proportions_and_uses_olympus_colors(self):
        metrics = image_metrics(self.sprite)
        self.assertEqual((self.sprite.width, self.sprite.height), (64, 80))
        self.assertGreaterEqual(metrics["height"], 48)
        self.assertLessEqual(metrics["height"], 56)
        self.assertAlmostEqual(metrics["head_ratio"], 0.25, delta=0.03)
        self.assertEqual(metrics["feet_row"], 79)
        self.assertEqual(metrics["feet_midpoint_x"], 32)
        self.assertLessEqual(metrics["palette_count"], 16)
        self.assertGreaterEqual(metrics["palette_count"], 6)

    def test_full_and_bolt_protected_masks_are_binary_and_scale_by_eight(self):
        full_mask, bolt_protected_mask = create_masks(self.sprite)
        self.assertEqual((full_mask.width, full_mask.height), (64, 80))
        self.assertEqual((bolt_protected_mask.width, bolt_protected_mask.height), (64, 80))
        self.assertEqual({full_mask.rgba[i] for i in range(0, len(full_mask.rgba), 4)}, {0, 255})
        self.assertEqual({bolt_protected_mask.rgba[i] for i in range(0, len(bolt_protected_mask.rgba), 4)}, {0, 255})

        full_mask_8x = nearest_resize(full_mask, 512, 640, integer_factor=True)
        protected_mask_8x = nearest_resize(bolt_protected_mask, 512, 640, integer_factor=True)
        self.assertEqual((full_mask_8x.width, full_mask_8x.height), (512, 640))
        self.assertEqual(full_mask_8x.pixel(16 * 8, 58 * 8)[0], 255)
        self.assertEqual(protected_mask_8x.pixel(16 * 8, 58 * 8)[0], 0)
        self.assertEqual(protected_mask_8x.pixel(32 * 8, 58 * 8)[0], 255)


if __name__ == "__main__":
    unittest.main()

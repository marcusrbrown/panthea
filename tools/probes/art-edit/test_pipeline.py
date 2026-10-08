import unittest

from pipeline import (
    Raster,
    binary_mask,
    content_bands,
    compose_grid,
    fit_bbox_to_cell,
    key_border_background,
    nearest_resize,
    quantize_palette,
    align_to_pivot,
    process_sprite,
    opaque_bbox,
    silhouette,
)


class PixelPipelineTests(unittest.TestCase):
    def test_fit_bbox_keeps_aspect_and_aligns_feet_on_last_row(self):
        source = Raster(4, 8, bytes([1, 2, 3, 255] * 32))
        cell = fit_bbox_to_cell(source, (0, 0, 4, 8), cell_size=(8, 10), figure_height=6)
        content = [(x, y) for y in range(cell.height) for x in range(cell.width)
                   if cell.pixel(x, y)[:3] != (255, 255, 255)]
        self.assertEqual((min(x for x, _ in content), max(x for x, _ in content) + 1), (2, 5))
        self.assertEqual((min(y for _, y in content), max(y for _, y in content) + 1), (4, 10))

    def test_content_bands_separate_stacked_figures_and_return_half_open_boxes(self):
        pixels = bytearray([253, 253, 253, 255] * 10 * 12)
        for y0, y1, x0, x1 in ((1, 4, 2, 5), (7, 11, 6, 9)):
            for y in range(y0, y1):
                for x in range(x0, x1):
                    at = (y * 10 + x) * 4
                    pixels[at : at + 4] = bytes((30, 20, 10, 255))
        source = Raster(10, 12, bytes(pixels))
        self.assertEqual(content_bands(source, threshold=30), [(2, 1, 5, 4), (6, 7, 9, 11)])

    def test_nearest_downscale_uses_integer_block_centres(self):
        source = Raster(4, 4, bytes(sum(([v, 0, 0, 255] for v in range(16)), [])))
        result = nearest_resize(source, 2, 2)
        self.assertEqual([result.pixel(x, y)[0] for y in range(2) for x in range(2)], [5, 7, 13, 15])

    def test_background_key_only_removes_border_connected_near_white(self):
        pixels = bytearray()
        for y in range(3):
            for x in range(3):
                color = (250, 250, 250, 255)
                if (x, y) in {(1, 1)}:
                    color = (250, 250, 250, 255)  # enclosed white highlight remains opaque
                elif (x, y) in {(1, 0), (0, 1), (2, 1), (1, 2)}:
                    color = (20, 30, 40, 255)
                pixels.extend(color)
        result = key_border_background(Raster(3, 3, bytes(pixels)), tolerance=20)
        self.assertEqual(result.pixel(0, 0)[3], 0)
        self.assertEqual(result.pixel(1, 0)[3], 255)
        self.assertEqual(result.pixel(1, 1)[3], 255)

    def test_quantize_changes_only_opaque_pixels_to_palette(self):
        palette = [(10, 20, 30), (100, 110, 120)]
        source = Raster(2, 1, bytes([11, 19, 31, 255, 3, 4, 5, 0]))
        result = quantize_palette(source, palette)
        self.assertEqual(result.pixel(0, 0), (10, 20, 30, 255))
        self.assertEqual(result.pixel(1, 0), (10, 20, 30, 0))

    def test_contact_sheet_marks_picked_tiles_and_keeps_cell_order(self):
        red = Raster(1, 1, bytes([200, 0, 0, 255]))
        blue = Raster(1, 1, bytes([0, 0, 200, 255]))
        sheet = compose_grid([red, blue], columns=2, picked={1}, marker=(255, 220, 0))
        self.assertEqual((sheet.width, sheet.height), (2, 1))
        self.assertEqual(sheet.pixel(0, 0), (200, 0, 0, 255))
        self.assertEqual(sheet.pixel(1, 0), (255, 220, 0, 255))

    def test_silhouette_is_binary_and_preserves_cell_size(self):
        source = Raster(2, 1, bytes([10, 20, 30, 0, 200, 210, 220, 255]))
        result = silhouette(source)
        self.assertEqual((result.width, result.height), (2, 1))
        self.assertEqual(result.pixel(0, 0), (255, 255, 255, 255))
        self.assertEqual(result.pixel(1, 0), (0, 0, 0, 255))

    def test_binary_mask_is_white_only_inside_half_open_rectangles(self):
        result = binary_mask(4, 4, [(1, 1, 2, 2)])
        self.assertEqual(result.pixel(0, 0)[:3], (0, 0, 0))
        self.assertEqual(result.pixel(1, 1)[:3], (255, 255, 255))
        self.assertEqual(result.pixel(2, 2)[:3], (255, 255, 255))
        self.assertEqual(result.pixel(3, 2)[:3], (0, 0, 0))

    def test_align_to_pivot_centers_figure_and_places_feet_on_last_row(self):
        source = Raster(64, 80, bytes([255, 255, 255, 0] * (64 * 80)))
        data = bytearray(source.rgba)
        for y in range(1, 3):
            for x in range(1, 3):
                at = (y * 64 + x) * 4
                data[at : at + 4] = bytes((80, 90, 100, 255))
        result = align_to_pivot(Raster(64, 80, bytes(data)))
        opaque = [(x, y) for y in range(result.height) for x in range(result.width) if result.pixel(x, y)[3]]
        self.assertEqual((min(x for x, _ in opaque), max(x for x, _ in opaque) + 1), (31, 33))
        self.assertEqual(max(y for _, y in opaque), 79)

    def test_align_to_pivot_can_keep_body_center_when_side_prop_extends_bbox(self):
        pixels = bytearray(bytes((0, 0, 0, 0)) * (64 * 80))
        for y in range(60, 76):
            for x in range(30, 35):
                at = (y * 64 + x) * 4
                pixels[at : at + 4] = bytes((80, 90, 100, 255))
        for y in range(70, 77):
            for x in range(24, 30):
                at = (y * 64 + x) * 4
                pixels[at : at + 4] = bytes((150, 120, 30, 255))
        result = align_to_pivot(Raster(64, 80, bytes(pixels)), center_horizontally=False)
        self.assertEqual(opaque_bbox(result), (24, 63, 35, 80))

    def test_sprite_pipeline_keys_alpha_uses_exact_11x_scale_and_palette(self):
        pixels = bytearray(bytes((255, 255, 255, 255)) * (512 * 640))
        for y in range(40, 600):
            for x in range(240, 272):
                at = (y * 512 + x) * 4
                pixels[at : at + 4] = bytes((40, 50, 60, 255))
        palette = [(82, 100, 113), (240, 238, 224)]
        result = process_sprite(Raster(512, 640, bytes(pixels)), palette)
        self.assertEqual((result.width, result.height), (64, 80))
        self.assertEqual(result.pixel(0, 0)[3], 0)
        self.assertEqual(opaque_bbox(result)[3], 80)
        colors = {result.pixel(x, y)[:3] for y in range(80) for x in range(64) if result.pixel(x, y)[3]}
        self.assertLessEqual(colors, set(palette))
        all_rgb = {result.pixel(x, y)[:3] for y in range(80) for x in range(64)}
        self.assertNotIn((0, 0, 0), all_rgb)
        self.assertNotIn((255, 255, 255), all_rgb)


if __name__ == "__main__":
    unittest.main()

import { expect, test } from "bun:test";

import {
  crop,
  cutoutOver,
  digestRgba,
  fnv1a32,
  type Rgba,
  upscale,
} from "./digest";

const text = (value: string) => new TextEncoder().encode(value);
const hex = (n: number) => n.toString(16).padStart(8, "0");

test("fnv1a32 matches the published test vectors", () => {
  expect(hex(fnv1a32(text("")))).toBe("811c9dc5");
  expect(hex(fnv1a32(text("a")))).toBe("e40c292c");
  expect(hex(fnv1a32(text("foobar")))).toBe("bf9cf968");
});

function image(
  width: number,
  height: number,
  fill: (x: number, y: number) => number[],
): Rgba {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1)
      data.set(fill(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}

const gradient = (width: number, height: number) =>
  image(width, height, (x, y) => [x * 17, y * 31, (x + y) * 7, 255]);

test("the digest names the size as well as the bytes", () => {
  const wide = { width: 4, height: 1, data: new Uint8Array(16).fill(9) };
  const tall = { width: 1, height: 4, data: new Uint8Array(16).fill(9) };

  expect(digestRgba(wide)).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
  expect(digestRgba(wide)).not.toBe(digestRgba(tall));
});

test("the digest changes when any single byte does", () => {
  const base = gradient(5, 4);
  const reference = digestRgba(base);
  for (let index = 0; index < base.data.length; index += 7) {
    const data = base.data.slice();
    data[index] = (data[index] ?? 0) ^ 1;
    expect(digestRgba({ ...base, data })).not.toBe(reference);
  }
});

test("a frame shifted by one pixel has a different digest", () => {
  const sprite = image(6, 6, (x, y) =>
    x >= 2 && x < 5 && y >= 1 && y < 4 ? [200, 30, 30, 255] : [0, 0, 0, 0],
  );
  const shifted = image(6, 6, (x, y) =>
    x >= 3 && x < 6 && y >= 1 && y < 4 ? [200, 30, 30, 255] : [0, 0, 0, 0],
  );

  expect(digestRgba(shifted)).not.toBe(digestRgba(sprite));
});

test("upscale repeats each pixel zoom x zoom times, row by row", () => {
  const source = gradient(3, 2);

  for (const zoom of [1, 2, 3, 4]) {
    const enlarged = upscale(source, zoom);
    expect(enlarged.width).toBe(3 * zoom);
    expect(enlarged.height).toBe(2 * zoom);
    for (let y = 0; y < enlarged.height; y += 1) {
      for (let x = 0; x < enlarged.width; x += 1) {
        const from = (Math.floor(y / zoom) * 3 + Math.floor(x / zoom)) * 4;
        const to = (y * enlarged.width + x) * 4;
        expect([...enlarged.data.subarray(to, to + 4)]).toEqual([
          ...source.data.subarray(from, from + 4),
        ]);
      }
    }
  }
});

test("upscale by 1 is the same pixels, and a bad zoom is refused", () => {
  const source = gradient(2, 2);

  expect(upscale(source, 1).data).toEqual(source.data);
  expect(() => upscale(source, 0)).toThrow();
  expect(() => upscale(source, 1.5)).toThrow();
});

test("crop takes the rectangle, top row first, and refuses one outside the image", () => {
  const source = gradient(5, 4);

  const part = crop(source, { x: 1, y: 2, w: 3, h: 2 });

  expect(part.width).toBe(3);
  expect(part.height).toBe(2);
  expect([...part.data.subarray(0, 4)]).toEqual([
    ...source.data.subarray((2 * 5 + 1) * 4, (2 * 5 + 1) * 4 + 4),
  ]);
  expect(() => crop(source, { x: 3, y: 0, w: 3, h: 1 })).toThrow();
  expect(() => crop(source, { x: -1, y: 0, w: 1, h: 1 })).toThrow();
});

test("cutoutOver keeps a pixel at alpha 128 or more and shows the background through the rest", () => {
  const source = image(
    4,
    1,
    (x) =>
      [
        [10, 20, 30, 255],
        [11, 21, 31, 128],
        [12, 22, 32, 127],
        [13, 23, 33, 0],
      ][x] as number[],
  );

  const out = cutoutOver(source, [1, 2, 3]);

  expect([...out.data]).toEqual([
    10, 20, 30, 255, 11, 21, 31, 255, 1, 2, 3, 255, 1, 2, 3, 255,
  ]);
});

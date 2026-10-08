import { describe, expect, it } from "bun:test";
import {
  ALPHA_DRAWN_MIN,
  compareEnlargement,
  compareFrame,
  compareOverlap,
  diffPixels,
  type ExpectedLayer,
  type Pixels,
  renderExpected,
} from "./pixels";

function image(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly number[],
): Pixels {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1)
      data.set(pixel(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}

const gradient = (x: number, y: number) => [x * 20, y * 30, (x + y) * 7, 255];

function enlarge(source: Pixels, zoom: number): Pixels {
  return image(source.width * zoom, source.height * zoom, (x, y) =>
    gradient(Math.floor(x / zoom), Math.floor(y / zoom)),
  );
}

function at(pixels: Pixels, x: number, y: number): number[] {
  const offset = (y * pixels.width + x) * 4;
  return [...pixels.data.slice(offset, offset + 4)];
}

describe("compareEnlargement", () => {
  const source = image(5, 4, gradient);

  it.each([2, 3, 4])("accepts an exact %dx nearest enlargement", (zoom) => {
    const result = compareEnlargement(source, enlarge(source, zoom), zoom);
    expect(result.mismatches).toBe(0);
    expect(result.checked).toBe(5 * zoom * 4 * zoom);
    expect(result.first).toBeUndefined();
  });

  it("rejects an enlargement shifted by one pixel", () => {
    const exact = enlarge(source, 3);
    const shifted = image(exact.width, exact.height, (x, y) =>
      at(exact, Math.min(x + 1, exact.width - 1), y),
    );
    const result = compareEnlargement(source, shifted, 3);
    expect(result.mismatches).toBeGreaterThan(0);
    expect(result.first).toBeDefined();
  });

  it("rejects a blend at a block edge", () => {
    const exact = enlarge(source, 2);
    const blended = image(exact.width, exact.height, (x, y) => {
      const pixel = at(exact, x, y);
      return x === 3 && y === 0
        ? [pixel[0] as number, pixel[1] as number, pixel[2] as number, 200]
        : pixel;
    });
    const result = compareEnlargement(source, blended, 2);
    expect(result.mismatches).toBe(1);
    expect(result.first).toMatchObject({ x: 3, y: 0 });
  });

  it("maps the last row and column to the final source pixel without reading out of range", () => {
    const exact = enlarge(source, 4);
    expect(at(exact, exact.width - 1, exact.height - 1)).toEqual(
      gradient(4, 3),
    );
    const result = compareEnlargement(source, exact, 4);
    expect(result.mismatches).toBe(0);
  });

  it("fails on a size that is not source size x zoom", () => {
    const result = compareEnlargement(source, enlarge(source, 2), 3);
    expect(result.mismatches).toBeGreaterThan(0);
    expect(result.checked).toBe(0);
    expect(result.note).toMatch(/size/);
  });

  it("refuses a zoom that is not a positive integer", () => {
    expect(() => compareEnlargement(source, source, 1.5)).toThrow(/zoom/);
    expect(() => compareEnlargement(source, source, 0)).toThrow(/zoom/);
  });
});

describe("compareFrame", () => {
  const atlas = image(8, 4, (x, y) =>
    x < 4 ? [x * 10, y * 10, 5, 255] : [1, 2, 3, 0],
  );
  const rect = { x: 0, y: 0, w: 4, h: 4 };

  function target(place: (x: number, y: number) => readonly number[]): Pixels {
    return image(12, 10, place);
  }

  const painted = target((x, y) => {
    const fx = x - 3;
    const fy = y - 2;
    return fx >= 0 && fx < 4 && fy >= 0 && fy < 4
      ? [fx * 10, fy * 10, 5, 255]
      : [9, 9, 9, 255];
  });

  it("matches every drawn atlas pixel at its projected texel", () => {
    const result = compareFrame(painted, atlas, rect, { x: 3, y: 2 });
    expect(result).toMatchObject({ compared: 16, mismatches: 0, clipped: 0 });
  });

  it("skips atlas pixels with alpha 0", () => {
    const wide = { x: 0, y: 0, w: 8, h: 4 };
    const result = compareFrame(painted, atlas, wide, { x: 3, y: 2 });
    expect(result.compared).toBe(16);
    expect(result.skippedTransparent).toBe(16);
  });

  it("flags a pixel that differs", () => {
    const wrong = target((x, y) =>
      x === 4 && y === 3 ? [0, 0, 0, 255] : (at(painted, x, y) as number[]),
    );
    const result = compareFrame(wrong, atlas, rect, { x: 3, y: 2 });
    expect(result.mismatches).toBe(1);
    expect(result.first).toMatchObject({ x: 4, y: 3 });
  });

  it("flags a frame placed one pixel off", () => {
    const result = compareFrame(painted, atlas, rect, { x: 4, y: 2 });
    expect(result.mismatches).toBeGreaterThan(0);
  });

  it("counts drawn pixels that fall outside the target instead of reading out of range", () => {
    const result = compareFrame(painted, atlas, rect, { x: 10, y: 8 });
    expect(result.clipped).toBe(12);
    expect(result.compared).toBe(4);
  });

  it("treats alpha below the cutout as not drawn, and counts partial alpha apart", () => {
    const soft = image(2, 1, (x) =>
      x === 0 ? [7, 7, 7, ALPHA_DRAWN_MIN - 1] : [8, 8, 8, ALPHA_DRAWN_MIN],
    );
    const out = image(2, 1, () => [1, 1, 1, 255]);
    const result = compareFrame(
      out,
      soft,
      { x: 0, y: 0, w: 2, h: 1 },
      { x: 0, y: 0 },
    );
    expect(result.skippedTransparent).toBe(1);
    expect(result.partial).toBe(1);
    expect(result.compared).toBe(0);
  });

  it("refuses a rect outside the atlas and a fractional position", () => {
    expect(() =>
      compareFrame(painted, atlas, { x: 6, y: 0, w: 4, h: 4 }, { x: 0, y: 0 }),
    ).toThrow(/atlas/);
    expect(() => compareFrame(painted, atlas, rect, { x: 0.5, y: 0 })).toThrow(
      /integer/,
    );
  });
});

describe("renderExpected", () => {
  const background = [10, 20, 30] as const;
  const red = image(2, 2, () => [255, 0, 0, 255]);
  const blue = image(2, 2, (x) => (x === 0 ? [0, 0, 255, 255] : [0, 0, 0, 0]));
  const layer = (atlas: Pixels, x: number, y: number): ExpectedLayer => ({
    atlas,
    rect: { x: 0, y: 0, w: atlas.width, h: atlas.height },
    at: { x, y },
  });

  it("fills with the opaque background and paints layers back to front", () => {
    const out = renderExpected(4, 3, background, [
      layer(red, 0, 0),
      layer(blue, 1, 1),
    ]);
    expect(at(out, 3, 2)).toEqual([10, 20, 30, 255]);
    expect(at(out, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(at(out, 1, 1)).toEqual([0, 0, 255, 255]);
    expect(at(out, 2, 1)).toEqual([10, 20, 30, 255]);
  });

  it("lets the later layer win where both are drawn, and the earlier show where the later is clear", () => {
    const out = renderExpected(3, 3, background, [
      layer(red, 0, 0),
      layer(blue, 1, 0),
    ]);
    expect(at(out, 1, 0)).toEqual([0, 0, 255, 255]);
    expect(at(out, 2, 0)).toEqual([10, 20, 30, 255]);
    expect(at(out, 1, 1)).toEqual([0, 0, 255, 255]);
    const reversed = renderExpected(3, 3, background, [
      layer(blue, 1, 0),
      layer(red, 0, 0),
    ]);
    expect(at(reversed, 1, 0)).toEqual([255, 0, 0, 255]);
  });

  it("clips layers that leave the image", () => {
    const out = renderExpected(2, 2, background, [
      layer(red, -1, -1),
      layer(red, 1, 1),
    ]);
    expect(at(out, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(at(out, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(at(out, 1, 0)).toEqual([10, 20, 30, 255]);
  });
});

describe("diffPixels", () => {
  it("counts every pixel and reports the first difference", () => {
    const a = image(3, 2, () => [1, 2, 3, 255]);
    const b = image(3, 2, (x, y) =>
      x === 2 && y === 1 ? [1, 2, 4, 255] : [1, 2, 3, 255],
    );
    expect(diffPixels(a, a)).toMatchObject({ checked: 6, mismatches: 0 });
    expect(diffPixels(a, b)).toMatchObject({
      checked: 6,
      mismatches: 1,
      first: { x: 2, y: 1, expected: [1, 2, 3, 255], actual: [1, 2, 4, 255] },
    });
  });

  it("fails a size difference", () => {
    const result = diffPixels(
      image(2, 2, () => [0, 0, 0, 255]),
      image(3, 2, () => [0, 0, 0, 255]),
    );
    expect(result.mismatches).toBeGreaterThan(0);
    expect(result.note).toMatch(/size/);
  });
});

describe("compareOverlap", () => {
  const front = image(4, 4, () => [200, 0, 0, 255]);
  const back = image(4, 4, () => [0, 0, 200, 255]);
  const place = (atlas: Pixels, x: number, y: number) => ({
    atlas,
    rect: { x: 0, y: 0, w: 4, h: 4 },
    at: { x, y },
  });

  it("counts overlapping pixels the front layer wins", () => {
    const target = renderExpected(
      8,
      8,
      [0, 0, 0],
      [place(back, 0, 0), place(front, 2, 2)],
    );
    expect(
      compareOverlap(target, place(front, 2, 2), place(back, 0, 0)),
    ).toMatchObject({
      overlapping: 4,
      frontWins: 4,
      backWins: 0,
      other: 0,
    });
  });

  it("detects the wrong layer on top", () => {
    const target = renderExpected(
      8,
      8,
      [0, 0, 0],
      [place(front, 2, 2), place(back, 0, 0)],
    );
    expect(
      compareOverlap(target, place(front, 2, 2), place(back, 0, 0)),
    ).toMatchObject({
      overlapping: 4,
      frontWins: 0,
      backWins: 4,
    });
  });

  it("reports no overlap for separated layers", () => {
    const target = renderExpected(
      12,
      8,
      [0, 0, 0],
      [place(back, 0, 0), place(front, 6, 0)],
    );
    expect(
      compareOverlap(target, place(front, 6, 0), place(back, 0, 0)).overlapping,
    ).toBe(0);
  });

  it("calls identical colours ambiguous rather than a win", () => {
    const same = image(4, 4, () => [9, 9, 9, 255]);
    const target = renderExpected(
      8,
      8,
      [0, 0, 0],
      [place(same, 0, 0), place(same, 2, 2)],
    );
    expect(
      compareOverlap(target, place(same, 2, 2), place(same, 0, 0)),
    ).toMatchObject({
      overlapping: 4,
      ambiguous: 4,
    });
  });
});

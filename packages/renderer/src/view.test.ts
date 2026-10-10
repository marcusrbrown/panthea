import { describe, expect, it } from "bun:test";
import { cameraBounds, canvasMetrics, roundCamera } from "./view";

const STUDIO = { width: 480, height: 270 };

describe("canvas sizing", () => {
  it.each([
    [2, 1, 960, 540, 960, 540],
    [3, 1, 1440, 810, 1440, 810],
    [4, 1, 1920, 1080, 1920, 1080],
    [2, 2, 960, 540, 480, 270],
    [4, 2, 1920, 1080, 960, 540],
    [2, 1.5, 960, 540, 640, 360],
    [3, 1.5, 1440, 810, 960, 540],
    [4, 1.5, 1920, 1080, 1280, 720],
  ])(
    "480x270 at zoom %d, devicePixelRatio %d: backing %dx%d, CSS %dx%d",
    (zoom, dpr, bw, bh, cw, ch) => {
      expect(canvasMetrics(STUDIO, zoom as 2 | 3 | 4, dpr)).toEqual({
        backingWidth: bw,
        backingHeight: bh,
        cssWidth: cw,
        cssHeight: ch,
      });
    },
  );

  it("sizes the backing store from the logical size it is given", () => {
    const metrics = canvasMetrics({ width: 320, height: 180 }, 3, 1.25);
    expect(metrics.backingWidth).toBe(960);
    expect(metrics.backingHeight).toBe(540);
    expect(Number.isInteger(metrics.backingWidth)).toBe(true);
    expect(metrics.cssWidth).toBeCloseTo(768, 9);
    expect(metrics.cssWidth * 1.25).toBeCloseTo(metrics.backingWidth, 9);
  });

  it("treats a missing or invalid devicePixelRatio as 1", () => {
    for (const dpr of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(canvasMetrics(STUDIO, 2, dpr).cssWidth).toBe(960);
    }
  });
});

describe("camera", () => {
  it("rounds to whole logical pixels", () => {
    expect(roundCamera({ x: 10.4, y: -3.6 })).toEqual({ x: 10, y: -4 });
    expect(roundCamera({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("frames the logical viewport from its top-left in screen space", () => {
    expect(cameraBounds(STUDIO, { x: -240, y: 20 })).toEqual({
      left: -240,
      right: 240,
      top: -20,
      bottom: -290,
    });
    expect(cameraBounds({ width: 320, height: 180 }, { x: 8, y: -4 })).toEqual({
      left: 8,
      right: 328,
      top: 4,
      bottom: -176,
    });
  });
});

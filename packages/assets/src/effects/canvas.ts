// A small RGBA canvas and the colours an effect draws from.

import type { Rgb } from "../conformance";
import type { Palette } from "../palette";

export interface Canvas {
  readonly w: number;
  readonly h: number;
  readonly rgba: Uint8Array;
}

export const newCanvas = (w: number, h: number): Canvas => ({
  w,
  h,
  rgba: new Uint8Array(w * h * 4),
});

export function setPixel(canvas: Canvas, x: number, y: number, rgb: Rgb): void {
  if (x < 0 || y < 0 || x >= canvas.w || y >= canvas.h) return;
  const at = (y * canvas.w + x) * 4;
  canvas.rgba[at] = rgb[0];
  canvas.rgba[at + 1] = rgb[1];
  canvas.rgba[at + 2] = rgb[2];
  canvas.rgba[at + 3] = 255;
}

/** Shades of a ramp, or a message naming the missing ramp. */
export function rampOf(
  palette: Palette,
  family: string,
  ramp: string,
): { ok: true; shades: readonly Rgb[] } | { ok: false; message: string } {
  const shades = palette.families
    .find((f) => f.id === family)
    ?.ramps.find((r) => r.id === ramp)?.shades;
  return shades === undefined || shades.length < 6
    ? {
        ok: false,
        message: `palette "${palette.id}" has no six-shade ${family}/${ramp} ramp`,
      }
    : { ok: true, shades };
}

/** Pixels of a straight line from (x0, y0) to (x1, y1), both ends included (Bresenham). */
export function linePixels(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [number, number][] {
  const out: [number, number][] = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) return out;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

// The contact shadow and the canvas envelope. A contact shadow is a small solid ground ellipse
// under the figure in one palette colour (binary alpha). It is drawn only on pixels the figure
// left empty, after the exterior outline, so it is never outlined and never hides the figure. A
// port of the probe's `shadow_plan.py`.

import type { Rgb, RgbaImage } from "../conformance";
import type { Envelope } from "./post";

/** Cell indices whose pixel centre lies inside a 2:1 ground ellipse centred on `centre` (pixel-edge coordinates). */
export function shadowPixels(
  width: number,
  height: number,
  centre: readonly [number, number],
  rx: number,
  ry: number,
): number[] {
  const out: number[] = [];
  if (rx <= 0 || ry <= 0) return out;
  const yFrom = Math.max(0, Math.floor(centre[1] - ry));
  const yTo = Math.min(height, Math.ceil(centre[1] + ry) + 1);
  const xFrom = Math.max(0, Math.floor(centre[0] - rx));
  const xTo = Math.min(width, Math.ceil(centre[0] + rx) + 1);
  for (let y = yFrom; y < yTo; y += 1) {
    for (let x = xFrom; x < xTo; x += 1) {
      const dx = (x + 0.5 - centre[0]) / rx;
      const dy = (y + 0.5 - centre[1]) / ry;
      if (dx * dx + dy * dy <= 1.0) out.push(y * width + x);
    }
  }
  return out;
}

/** The figure over a shadow of one colour, drawn on transparent pixels only. */
export function withShadow(
  figure: RgbaImage,
  shadow: readonly number[],
  colour: Rgb,
): RgbaImage {
  const out = new Uint8Array(figure.rgba);
  for (const i of shadow) {
    if (out[i * 4 + 3] === 0)
      out.set([colour[0], colour[1], colour[2], 255], i * 4);
  }
  return { width: figure.width, height: figure.height, rgba: out };
}

/**
 * Extent of every figure in a set of cells as distances from the pivot (positive outward: `up`
 * is how far the highest pixel is above the pivot), plus the margin left to each canvas edge.
 * `boxes` are opaque bounding boxes with exclusive upper bounds. `clipped` is true when any
 * figure touches or crosses an edge, where no outline can be drawn: the probe's flag only
 * tested for a margin below zero, which a box inside the cell cannot have.
 */
export function envelopeOf(
  boxes: readonly (readonly [number, number, number, number])[],
  pivot: readonly [number, number],
  cell: { readonly w: number; readonly h: number },
): Envelope {
  const x0 = Math.min(...boxes.map((b) => b[0]));
  const y0 = Math.min(...boxes.map((b) => b[1]));
  const x1 = Math.max(...boxes.map((b) => b[2]));
  const y1 = Math.max(...boxes.map((b) => b[3]));
  const margin = { left: x0, right: cell.w - x1, top: y0, bottom: cell.h - y1 };
  const minMargin = Math.min(
    margin.left,
    margin.right,
    margin.top,
    margin.bottom,
  );
  return {
    left: pivot[0] - x0,
    right: x1 - pivot[0],
    up: pivot[1] - y0,
    down: y1 - pivot[1],
    margin,
    minMargin,
    clipped: minMargin <= 0,
  };
}

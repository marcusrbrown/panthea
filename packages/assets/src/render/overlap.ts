// Selective overlap lines. A line is a 1 px outline pixel on the FARTHER side of a boundary
// where two different parts meet and the depth jumps (arm over torso, beard over chest, robe over
// leg). It is drawn only when the two sides would otherwise read as one shape, and always in the
// darkest shade of the far pixel's own ramp. A port of the probe's `overlap.py`.

import type { Rgb } from "../conformance";
import type { PartId } from "./parts";
import { lightness, type PostPalette, packRgb } from "./post-palette";

/** A line is needed unless the sides already differ clearly: a different ramp and this much OKLab lightness. */
const MIN_CONTRAST = 0.12;

/**
 * Far pixel index to the nearer pixel index it sits behind, for every 4-neighbour pair of
 * different parts whose depth differs by more than `threshold` metres. A far pixel keeps its
 * largest gap; the first neighbour in left, right, up, down order wins a tie.
 */
export function candidateLines(
  parts: readonly (PartId | null)[],
  depth: readonly number[],
  width: number,
  height: number,
  threshold: number,
): Map<number, number> {
  const best = new Map<number, { gap: number; near: number }>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      if (parts[p] === null) continue;
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as const) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const q = ny * width + nx;
        if (parts[q] === null || parts[q] === parts[p]) continue;
        const gap = (depth[q] as number) - (depth[p] as number);
        const seen = best.get(q);
        if (gap > threshold && (seen === undefined || gap > seen.gap)) {
          best.set(q, { gap, near: p });
        }
      }
    }
  }
  return new Map([...best].map(([far, { near }]) => [far, near]));
}

function needsLine(far: Rgb, near: Rgb, palette: PostPalette): boolean {
  const rampFar = palette.rampOf.get(packRgb(far[0], far[1], far[2]));
  const rampNear = palette.rampOf.get(packRgb(near[0], near[1], near[2]));
  if (rampFar === undefined) return false;
  const darkest = palette.darkest.get(rampFar) as Rgb;
  if (far[0] === darkest[0] && far[1] === darkest[1] && far[2] === darkest[2]) {
    return false;
  }
  if (rampFar !== rampNear) {
    return Math.abs(lightness(far) - lightness(near)) < MIN_CONTRAST;
  }
  return true;
}

const pixelAt = (rgba: Uint8Array, i: number): Rgb | null =>
  rgba[i * 4 + 3] === 0
    ? null
    : [
        rgba[i * 4] as number,
        rgba[i * 4 + 1] as number,
        rgba[i * 4 + 2] as number,
      ];

/**
 * Draws the needed lines into a copy of an opaque-or-empty RGBA cell. Every decision reads the
 * cell as it was before any line, so the order lines are visited in cannot change the result.
 * Returns the new pixels and the indices drawn, ascending.
 */
export function applyOverlapLines(
  rgba: Uint8Array,
  parts: readonly (PartId | null)[],
  depth: readonly number[],
  width: number,
  height: number,
  threshold: number,
  palette: PostPalette,
): { readonly rgba: Uint8Array; readonly drawn: readonly number[] } {
  const lined = parts.map((part, i) => (rgba[i * 4 + 3] === 0 ? null : part));
  const lines = candidateLines(lined, depth, width, height, threshold);
  const out = new Uint8Array(rgba);
  const drawn: number[] = [];
  for (const [far, near] of lines) {
    const f = pixelAt(rgba, far);
    const n = pixelAt(rgba, near);
    if (f === null || n === null) continue;
    if (!needsLine(f, n, palette)) continue;
    const ramp = palette.rampOf.get(packRgb(f[0], f[1], f[2])) as string;
    const colour = palette.darkest.get(ramp) as Rgb;
    out.set([colour[0], colour[1], colour[2], 255], far * 4);
    drawn.push(far);
  }
  drawn.sort((a, b) => a - b);
  return { rgba: out, drawn };
}

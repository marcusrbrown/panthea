// Periodic value noise for the tile stamper. It follows `risingNoise` (effects/random.ts): hash2 at
// integer nodes, a smoothstep between them, and only + - * / and Math.floor, so the bytes are the
// same on any engine. Unlike it, the nodes are wrapped on both axes.

import { hash2 } from "../effects/random";

const wrap = (i: number, period: number): number =>
  ((i % period) + period) % period;

const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * Smooth noise in [0, 1) that repeats every `period` nodes along u and along v. The inputs are
 * in node units; on dyadic inputs (k / 16) the repeat is exact to the bit, because the fraction
 * of u and of u + period is the same number and the nodes are wrapped as integers.
 */
export function periodicValueNoise(
  seed: number,
  u: number,
  v: number,
  period: number,
): number {
  const u0 = Math.floor(u);
  const v0 = Math.floor(v);
  const fu = smooth(u - u0);
  const fv = smooth(v - v0);
  const ua = wrap(u0, period);
  const ub = wrap(u0 + 1, period);
  const va = wrap(v0, period);
  const vb = wrap(v0 + 1, period);
  const a = hash2(seed, ua, va);
  const b = hash2(seed, ub, va);
  const c = hash2(seed, ua, vb);
  const d = hash2(seed, ub, vb);
  const top = a + (b - a) * fu;
  const bottom = c + (d - c) * fu;
  return top + (bottom - top) * fv;
}

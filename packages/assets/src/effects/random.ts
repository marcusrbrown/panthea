// Seeded randomness and periodic noise for the effect generator. Everything
// here uses only + - * / and Math.floor/sqrt on doubles, which IEEE 754 fixes
// exactly, plus 32-bit integer maths. No Math.sin, Math.cos, Math.pow or
// Math.random: the output must be the same bytes on any engine.

/** A uint32 hash of a seed and a lattice point, as a number in [0, 1). */
export function hash2(seed: number, x: number, y: number): number {
  let h =
    Math.imul(x | 0, 0x27d4eb2d) ^
    Math.imul(y | 0, 0x165667b1) ^
    Math.imul(seed | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A small sequential generator (mulberry32); returns numbers in [0, 1). */
export function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Smooth value noise over the plane, in [0, 1). */
export function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash2(seed, x0, y0);
  const b = hash2(seed, x0 + 1, y0);
  const c = hash2(seed, x0, y0 + 1);
  const d = hash2(seed, x0 + 1, y0 + 1);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

const TAU = 6.283185307179586;

/**
 * Cosine and sine of a whole turn (`turns` = 1 is a full circle), from a
 * Taylor series after reducing to [-0.5, 0.5) turns. `turns` and `turns + 1`
 * reduce to the same value, so the pair is exactly periodic.
 */
export function cosSin(turns: number): readonly [number, number] {
  const wrapped = turns - Math.floor(turns);
  const x = (wrapped >= 0.5 ? wrapped - 1 : wrapped) * TAU;
  const x2 = x * x;
  const cos =
    1 +
    x2 *
      (-1 / 2 +
        x2 *
          (1 / 24 +
            x2 *
              (-1 / 720 +
                x2 *
                  (1 / 40320 + x2 * (-1 / 3628800 + x2 * (1 / 479001600))))));
  const sin =
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 *
                (-1 / 5040 +
                  x2 *
                    (1 / 362880 +
                      x2 * (-1 / 39916800 + x2 * (1 / 6227020800)))))));
  return [cos, sin];
}

/**
 * Value noise at (x, y) shifted around a circle of `radius` in the noise
 * plane as `turns` goes from 0 to 1. At `turns` 1 the shift is back at its
 * start, so any animation driven by it closes its own loop.
 */
export function loopNoise(
  seed: number,
  x: number,
  y: number,
  turns: number,
  radius: number,
): number {
  const [cos, sin] = cosSin(turns);
  return valueNoise(seed, x + radius * cos, y + radius * sin);
}

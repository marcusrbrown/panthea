// The fire loop: a few hand-shaped flame tongues anchored at the base of the
// cell, moved by noise that is sampled on a circle in time so the last frame
// flows back into the first. The terracotta ramp shades by heat, binary alpha,
// and a dark warm outline on the outer silhouette only.

import type { Rgb } from "../conformance";
import type { Palette } from "../palette";
import { type Canvas, newCanvas, rampOf, setPixel } from "./canvas";
import { loopNoise, sequence } from "./random";

export interface FireParams {
  readonly width: number;
  readonly height: number;
  readonly frames: number;
  readonly frameMs: number;
  readonly tongues: number;
}

export const FIRE_FAMILY = "town";

export interface FireColours {
  readonly heat: readonly Rgb[];
  readonly outline: Rgb;
}

export function fireColours(
  palette: Palette,
): { ok: true; colours: FireColours } | { ok: false; message: string } {
  const terracotta = rampOf(palette, FIRE_FAMILY, "terracotta");
  if (!terracotta.ok) return terracotta;
  const soil = rampOf(palette, FIRE_FAMILY, "soil");
  if (!soil.ok) return soil;
  return {
    ok: true,
    colours: {
      heat: terracotta.shades,
      outline: soil.shades[0] as Rgb,
    },
  };
}

interface Tongue {
  readonly cx: number;
  readonly halfW: number;
  readonly height: number;
  readonly lean: number;
  readonly seed: number;
}

/** The tongues of one fire: the middle one widest and tallest, the outer ones leaning away. */
function layTongues(seed: number, p: FireParams): Tongue[] {
  const rand = sequence(seed ^ 0xf1fe);
  const mid = (p.tongues - 1) / 2;
  return Array.from({ length: p.tongues }, (_, k) => {
    const off = k - mid;
    const centre = 1 - Math.abs(off) / (mid + 0.5);
    return {
      cx: p.width / 2 + off * p.width * 0.24 + (rand() - 0.5) * p.width * 0.04,
      halfW: p.width * (0.07 + 0.07 * centre),
      height: p.height * (0.5 + 0.38 * centre) * (0.95 + 0.1 * rand()),
      lean: off * p.width * 0.1 + (rand() - 0.5) * p.width * 0.05,
      seed: (seed * 31 + k * 977) | 0,
    };
  });
}

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * One frame of the fire at `turns` through its loop; `turns` and `turns + 1`
 * give the same frame. Returns RGBA with the colour under alpha 0 zeroed.
 */
export function renderFireFrame(
  seed: number,
  p: FireParams,
  turns: number,
  palette: Palette,
): Uint8Array {
  const found = fireColours(palette);
  if (!found.ok) throw new Error(found.message);
  const { heat: ramp, outline } = found.colours;
  const { width: w, height: h } = p;
  const canvas: Canvas = newCanvas(w, h);
  const mask = new Uint8Array(w * h);
  const level = new Array<number>(w * h).fill(-1);
  const sway = w * 0.09;

  for (const tongue of layTongues(seed, p)) {
    const now =
      tongue.height *
      (1 + 0.14 * (2 * loopNoise(tongue.seed, 3.1, 0.5, turns, 1) - 1));
    for (let y = 0; y < h; y += 1) {
      const above = h - 1 - y + 0.5;
      const s = above / now;
      if (s > 1) continue;
      const bend =
        (2 * loopNoise(tongue.seed, s * 2.2, 7.7, turns, 1.1) - 1) * sway * s;
      const xc = tongue.cx + tongue.lean * s * s + bend;
      const hw = Math.max(0.5, tongue.halfW * (1 - s) * (1 + 1.2 * s));
      for (let x = 0; x < w; x += 1) {
        const dx = Math.abs(x + 0.5 - xc);
        if (dx > hw) continue;
        const texture = loopNoise(
          seed ^ 0x77,
          x * 0.28,
          above * 0.28,
          turns,
          1.4,
        );
        const heat = 0.95 - 0.55 * (dx / hw) - 0.5 * s + 0.44 * (texture - 0.5);
        const shade = clamp(Math.round(heat * 5), 0, 5);
        const at = y * w + x;
        mask[at] = 1;
        if (shade > (level[at] as number)) level[at] = shade;
      }
    }
  }

  // Transparent pixels connected to the cell border; the cell's bottom edge is
  // the base the fire sits on, so it is not an outside.
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const reach = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const at = y * w + x;
    if (mask[at] === 1 || outside[at] === 1) return;
    outside[at] = 1;
    stack.push(at);
  };
  for (let x = 0; x < w; x += 1) reach(x, 0);
  for (let y = 0; y < h; y += 1) {
    reach(0, y);
    reach(w - 1, y);
  }
  while (stack.length > 0) {
    const at = stack.pop() as number;
    const x = at % w;
    const y = Math.floor(at / w);
    reach(x + 1, y);
    reach(x - 1, y);
    reach(x, y + 1);
    reach(x, y - 1);
  }

  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const at = y * w + x;
      if (mask[at] === 0) continue;
      const rim =
        (x + 1 < w && outside[at + 1] === 1) ||
        (x > 0 && outside[at - 1] === 1) ||
        (y + 1 < h && outside[at + w] === 1) ||
        (y > 0 && outside[at - w] === 1);
      setPixel(
        canvas,
        x,
        y,
        rim ? outline : (ramp[level[at] as number] as Rgb),
      );
    }
  return canvas.rgba;
}

// The fire loop: one connected flame mass, wide at the base and planted there,
// with tongues that sway, stretch and tear as noise slides up through them.
// Every moving part is periodic in the loop phase (noise on a circle, noise
// that repeats along its slide), so the last frame flows into the first.
// Heat shades the body in solid clusters of colour, from a dark red edge
// through orange and amber to yellow and cream lobes near the base, with no
// dithering. The foot is a shallow, irregular isometric footprint with small
// gaps where the roof shows through. A dark warm outline follows the silhouette
// above and beside the mass, not under its foot; a few torn-off tips rise as
// small flickers. Binary alpha.

import type { Rgb } from "../conformance";
import type { Palette } from "../palette";
import { type Canvas, newCanvas, rampOf, setPixel } from "./canvas";
import { loopNoise, risingNoise, sequence } from "./random";

export interface FireParams {
  readonly width: number;
  readonly height: number;
  readonly frames: number;
  readonly frameMs: number;
  readonly tongues: number;
}

export const FIRE_FAMILY = "town";

/** The hot colours the fire draws that are not in the palette, coolest first. */
export const FIRE_GLOW = {
  red: [184, 50, 28],
  orange: [240, 112, 30],
  amber: [255, 163, 40],
  yellow: [255, 210, 74],
  cream: [255, 244, 200],
} as const satisfies Record<string, Rgb>;

const HEAT_RAMP: readonly Rgb[] = [
  FIRE_GLOW.red,
  FIRE_GLOW.orange,
  FIRE_GLOW.amber,
  FIRE_GLOW.yellow,
  FIRE_GLOW.cream,
];

export interface FireColours {
  readonly outline: Rgb;
}

export function fireColours(
  palette: Palette,
): { ok: true; colours: FireColours } | { ok: false; message: string } {
  const soil = rampOf(palette, FIRE_FAMILY, "soil");
  if (!soil.ok) return soil;
  return { ok: true, colours: { outline: soil.shades[0] as Rgb } };
}

/** Flickers that tear off the tips and rise, each on its own phase of the loop. */
const FLICKERS = 3;

/** The hot lobes at the base: where each sits across the width, how high it burns, how wide it is. */
const LOBES = [
  { at: -0.23, height: 0.3, width: 0.1 },
  { at: 0, height: 0.46, width: 0.11 },
  { at: 0.23, height: 0.26, width: 0.09 },
] as const;

interface Tongue {
  readonly cx: number;
  readonly reach: number;
  readonly height: number;
  readonly seed: number;
}

/** The tongues of one fire: the middle ones tallest, the outer ones shorter and wider apart. */
function layTongues(seed: number, p: FireParams): Tongue[] {
  const rand = sequence(seed ^ 0xf1fe);
  const mid = (p.tongues - 1) / 2;
  return Array.from({ length: p.tongues }, (_, k) => {
    const off = k - mid;
    const centre = 1 - Math.abs(off) / (mid + 0.75);
    return {
      cx:
        p.width / 2 +
        (off * p.width * 0.4) / Math.max(1, p.tongues - 1) +
        (rand() - 0.5) * p.width * 0.05,
      reach: p.width * (0.12 + 0.05 * centre),
      height: p.height * (0.4 + 0.6 * centre) * (0.9 + 0.2 * rand()),
      seed: (seed * 31 + k * 977) | 0,
    };
  });
}

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;
const sq = (v: number) => v * v;

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
  const { outline } = found.colours;
  const { width: w, height: h } = p;
  const cx = w / 2;
  const canvas: Canvas = newCanvas(w, h);
  const mask = new Uint8Array(w * h);
  const level = new Int8Array(w * h);

  // The tongues as they stand at this phase: each sways and stretches.
  const tongues = layTongues(seed, p).map((t) => ({
    ...t,
    x: t.cx + (2 * loopNoise(t.seed, 0.5, 1.5, turns, 1.1) - 1) * w * 0.12,
    top:
      t.height * (1 + 0.38 * (2 * loopNoise(t.seed, 3.1, 0.5, turns, 1.3) - 1)),
  }));

  // The hot lobes sway and rise and fall on their own phases.
  const lobes = LOBES.map((lobe, k) => ({
    x:
      cx +
      lobe.at * w +
      (2 * loopNoise(seed ^ (0x31 + k * 7), 5.5, 0.5, turns, 1) - 1) * w * 0.03,
    height:
      lobe.height *
      h *
      (1 +
        0.3 * (2 * loopNoise(seed ^ (0x31 + k * 7), 2.2, 0.5, turns, 1) - 1)),
    reach: lobe.width * w,
  }));

  for (let y = 0; y < h; y += 1) {
    const above = h - 1 - y + 0.5;
    const v = above / h;
    for (let x = 0; x < w; x += 1) {
      const swell = risingNoise(seed ^ 0x51, x * 0.07, above * 0.09, 4, turns);
      const grain = risingNoise(seed ^ 0x77, x * 0.2, above * 0.2, 8, turns);
      // Tongues lean with height; the base stays where it is.
      const xw = x + 0.5 + (swell * 2 - 1) * w * 0.28 * v * v;
      const lean = Math.abs(xw - cx) / (w * 0.38);
      let top = h * 0.34 * Math.max(0, 1 - lean * Math.sqrt(lean));
      for (const t of tongues)
        top = Math.max(top, t.top * Math.max(0, 1 - sq((xw - t.x) / t.reach)));
      if (above >= top) continue;
      // The mass narrows as it rises.
      const across = Math.abs(x + 0.5 - cx);
      if (across > w * (0.46 - 0.2 * v)) continue;
      // The foot is a shallow ellipse seen from above, with a few notches where
      // the roof shows through; the middle of it always stands on the base.
      const edge = across / (w * 0.46);
      const footEdge = Math.min(1, across / (w * 0.4));
      const notch =
        5 *
        Math.max(
          0,
          (loopNoise(seed ^ 0x99, x * 0.28, 0.5, turns, 0.8) - 0.55) / 0.45,
        ) *
        clamp((footEdge - 0.2) * 3, 0, 1);
      if (above < h * 0.16 * (1 - Math.sqrt(1 - footEdge * footEdge)) + notch)
        continue;
      const toTip = 1 - above / top;
      // Tips and edges tear where the grain is high; the base never does.
      if (toTip + 0.3 * (grain - 0.5) * (0.3 + v) < 0.02) continue;
      let core = 0;
      for (const lobe of lobes)
        core = Math.max(
          core,
          Math.max(0, 1 - above / lobe.height) *
            Math.max(0, 1 - sq((x + 0.5 - lobe.x) / lobe.reach)),
        );
      const heat =
        0.12 +
        0.55 * toTip +
        0.9 * core +
        0.35 * (grain - 0.5) -
        0.7 * edge * edge;
      const at = y * w + x;
      mask[at] = 1;
      level[at] = clamp(Math.floor(heat * 5.2), 0, 4);
    }
  }

  // Flickers: a torn-off tip rises from a tongue and cools as it goes.
  const rand = sequence(seed ^ 0xf11c);
  for (let k = 0; k < FLICKERS; k += 1) {
    const tongue = tongues[
      Math.floor(rand() * tongues.length)
    ] as (typeof tongues)[number];
    const phase = rand();
    const side = (rand() - 0.5) * 2;
    const s = turns + phase - Math.floor(turns + phase);
    if (s > 0.75) continue;
    const above = tongue.top * 0.9 + s * h * 0.2;
    const fx = Math.floor(tongue.x + side * tongue.reach * 0.3 + (s - 0.4) * 3);
    const fy = Math.floor(h - 1 - above);
    const size = s < 0.35 ? 2 : 1;
    const cooled = s < 0.25 ? 2 : s < 0.5 ? 1 : 0;
    for (let dy = 0; dy < size; dy += 1)
      for (let dx = 0; dx < size; dx += 1) {
        const px = fx + dx;
        const py = fy + dy;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        mask[py * w + px] = 1;
        level[py * w + px] = cooled;
      }
  }

  // The flame mass is what touches the base; torn bits of one or two pixels go,
  // and the rest of what floats free is a flicker.
  const part = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const grounded: boolean[] = [];
  for (let start = 0; start < w * h; start += 1) {
    if (mask[start] === 0 || part[start] !== -1) continue;
    const id = sizes.length;
    const stack = [start];
    part[start] = id;
    let count = 0;
    let touchesBase = false;
    while (stack.length > 0) {
      const at = stack.pop() as number;
      count += 1;
      const x = at % w;
      const y = Math.floor(at / w);
      if (y === h - 1) touchesBase = true;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (mask[n] === 1 && part[n] === -1) {
          part[n] = id;
          stack.push(n);
        }
      }
    }
    sizes.push(count);
    grounded.push(touchesBase);
  }
  for (let at = 0; at < w * h; at += 1) {
    const id = part[at] as number;
    if (id !== -1 && !grounded[id] && (sizes[id] as number) < 2) mask[at] = 0;
  }

  // Transparent pixels connected to the cell border.
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

  // The outline: pixels of the flame mass beside or under open space on the
  // left, the right or above. Its foot, where the mass meets the surface, has none.
  const rim = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const at = y * w + x;
      if (mask[at] === 0 || grounded[part[at] as number] !== true) continue;
      if (
        (x + 1 < w && outside[at + 1] === 1) ||
        (x > 0 && outside[at - 1] === 1) ||
        (y > 0 && outside[at - w] === 1)
      )
        rim[at] = 1;
    }

  // Shades come in clusters: a pixel none of whose neighbours share its shade
  // takes the shade most of them have. Only flickers stay single pixels.
  for (let pass = 0; pass < 2; pass += 1)
    for (let y = 0; y < h; y += 1)
      for (let x = 0; x < w; x += 1) {
        const at = y * w + x;
        if (
          mask[at] === 0 ||
          rim[at] === 1 ||
          grounded[part[at] as number] !== true
        )
          continue;
        const near: number[] = [];
        for (const [nx, ny] of [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ] as const) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (mask[ny * w + nx] === 1 && rim[ny * w + nx] === 0)
            near.push(level[ny * w + nx] as number);
        }
        if (near.length === 0 || near.includes(level[at] as number)) continue;
        const counts = new Map<number, number>();
        for (const n of near) counts.set(n, (counts.get(n) ?? 0) + 1);
        level[at] = [...counts].sort(
          (a, b) => b[1] - a[1] || b[0] - a[0],
        )[0]?.[0] as number;
      }

  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const at = y * w + x;
      if (mask[at] === 0) continue;
      setPixel(
        canvas,
        x,
        y,
        rim[at] === 1 ? outline : (HEAT_RAMP[level[at] as number] as Rgb),
      );
    }
  return canvas.rgba;
}

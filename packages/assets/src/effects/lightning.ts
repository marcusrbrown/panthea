// The lightning strike: one midpoint-displacement bolt from the top of the cell
// to a target point, with a narrow bright core and a coloured band. It plays
// leader, a single peak, then the impact. The `full` version is bright and
// wide; the `calm` version draws the same bolt in palette colours only, thin
// and dithered, with fewer frames. Neither fills the cell or pulses twice.

import type { Rgb } from "../conformance";
import type { Palette } from "../palette";
import { type Canvas, linePixels, newCanvas, rampOf, setPixel } from "./canvas";
import { sequence } from "./random";

export interface LightningParams {
  readonly width: number;
  readonly height: number;
  readonly targetX: number;
  readonly targetY: number;
  /** Midpoint-displacement levels; the bolt has 2^depth segments. */
  readonly depth: number;
  /** Durations of the eight `full` frames, in ms. */
  readonly fullMs: readonly number[];
  /** Durations of the four `calm` frames, in ms. */
  readonly calmMs: readonly number[];
}

export const FULL_FRAMES = 8;
export const CALM_FRAMES = 4;
export const LIGHTNING_FAMILY = "olympus";

/** The colours the full strike draws that are not in the palette. */
export const LIGHTNING_GLOW = {
  core: [255, 246, 208],
  band: [140, 200, 244],
  edge: [74, 126, 191],
} as const satisfies Record<string, Rgb>;

type Point = readonly [number, number];

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

/** The bolt's pixels from the top row to the target, in order, each once. */
export function boltPath(seed: number, p: LightningParams): Point[] {
  const rand = sequence(seed ^ 0xb017);
  const start: Point = [
    clamp(p.targetX + Math.floor((rand() - 0.5) * 24), 2, p.width - 3),
    0,
  ];
  let points: Point[] = [start, [p.targetX, p.targetY]];
  for (let level = 0; level < p.depth; level += 1) {
    const next: Point[] = [points[0] as Point];
    for (let i = 0; i + 1 < points.length; i += 1) {
      const a = points[i] as Point;
      const b = points[i + 1] as Point;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      const offset = (rand() * 2 - 1) * len * 0.22;
      next.push([
        clamp((a[0] + b[0]) / 2 + (-dy / len) * offset, 1, p.width - 2),
        clamp((a[1] + b[1]) / 2 + (dx / len) * offset, 0, p.targetY),
      ]);
      next.push(b);
    }
    points = next;
  }
  const pixels: Point[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i] as Point;
    const b = points[i + 1] as Point;
    for (const [x, y] of linePixels(
      Math.round(a[0]),
      Math.round(a[1]),
      Math.round(b[0]),
      Math.round(b[1]),
    )) {
      const last = pixels[pixels.length - 1];
      if (last === undefined || last[0] !== x || last[1] !== y)
        pixels.push([x, y]);
    }
  }
  return pixels;
}

/** How a bolt is painted: a colour per ring around the path, or none to leave it out. */
interface BoltStyle {
  readonly core: Rgb | null;
  readonly band: Rgb | null;
  readonly edge: Rgb | null;
  /** Keep every other pixel of the band and edge, in a checkerboard. */
  readonly dither?: boolean;
  /** Draw only every nth path pixel. */
  readonly every?: number;
  /** The core is two pixels wide: each path pixel and the one to its right. */
  readonly wide?: boolean;
  /** Squared distance from the core out to which the band and then the edge reach. */
  readonly bandReach?: number;
  readonly edgeReach?: number;
}

function paintBolt(
  canvas: Canvas,
  path: readonly Point[],
  count: number,
  style: BoltStyle,
): void {
  const { w, h } = canvas;
  const bandReach = style.bandReach ?? 2;
  const edgeReach = style.edgeReach ?? 5;
  const outer =
    style.edge !== null ? edgeReach : style.band !== null ? bandReach : 0;
  const radius = Math.ceil(Math.sqrt(outer));
  const nearest = new Int32Array(w * h).fill(1 << 20);
  const every = style.every ?? 1;
  const stamp = (px: number, py: number) => {
    for (let dy = -radius; dy <= radius; dy += 1)
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = px + dx;
        const y = py + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const d2 = dx * dx + dy * dy;
        const at = y * w + x;
        if (d2 < (nearest[at] as number)) nearest[at] = d2;
      }
  };
  for (const [i, [px, py]] of path.slice(0, count).entries()) {
    if (i % every !== 0) continue;
    stamp(px, py);
    if (style.wide === true) stamp(px + 1, py);
  }
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const d2 = nearest[y * w + x] as number;
      if (d2 > outer) continue;
      const colour =
        d2 === 0 ? style.core : d2 <= bandReach ? style.band : style.edge;
      if (colour === null) continue;
      if (d2 > 0 && style.dither === true && (x + y) % 2 !== 0) continue;
      setPixel(canvas, x, y, colour);
    }
}

/** The pixels of a filled ellipse at (cx, cy). */
function ellipse(cx: number, cy: number, rx: number, ry: number): Point[] {
  const out: Point[] = [];
  for (let dy = -ry; dy <= ry; dy += 1)
    for (let dx = -rx; dx <= rx; dx += 1)
      if ((dx * dx) / (rx * rx || 1) + (dy * dy) / (ry * ry || 1) <= 1)
        out.push([cx + dx, cy + dy]);
  return out;
}

function paintShape(
  canvas: Canvas,
  shape: readonly Point[],
  colour: Rgb,
  keep: (x: number, y: number) => boolean = () => true,
): void {
  for (const [x, y] of shape) if (keep(x, y)) setPixel(canvas, x, y, colour);
}

/**
 * Short sparks leaving (cx, cy) along the roof's four slopes: `dist` pixels
 * out across, `len` pixels long, each step also moving half a pixel down or up.
 * `sides` picks which slopes: both downward ones, or all four.
 */
function sparks(
  cx: number,
  cy: number,
  dist: number,
  len: number,
  sides: "down" | "all" = "all",
): Point[] {
  const out: Point[] = [];
  for (const [sx, sy] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    if (sides === "down" && sy < 0) continue;
    for (let i = dist; i < dist + len; i += 1)
      out.push([cx + sx * i, cy + Math.round((sy * i) / 2)]);
  }
  return out;
}

export interface LightningColours {
  readonly glow: typeof LIGHTNING_GLOW;
  readonly cloud: readonly Rgb[];
  readonly lapis: readonly Rgb[];
}

export function lightningColours(
  palette: Palette,
): { ok: true; colours: LightningColours } | { ok: false; message: string } {
  const cloud = rampOf(palette, LIGHTNING_FAMILY, "cloud");
  if (!cloud.ok) return cloud;
  const lapis = rampOf(palette, LIGHTNING_FAMILY, "lapis");
  if (!lapis.ok) return lapis;
  return {
    ok: true,
    colours: { glow: LIGHTNING_GLOW, cloud: cloud.shades, lapis: lapis.shades },
  };
}

/** The frames of one version of the strike as RGBA, colour under alpha 0 zeroed. */
export function renderLightning(
  seed: number,
  p: LightningParams,
  version: "full" | "calm",
  palette: Palette,
): Uint8Array[] {
  const found = lightningColours(palette);
  if (!found.ok) throw new Error(found.message);
  const { glow, cloud, lapis } = found.colours;
  const path = boltPath(seed, p);
  const all = path.length;
  const draw = (paint: (canvas: Canvas) => void) => {
    const canvas = newCanvas(p.width, p.height);
    paint(canvas);
    return canvas.rgba;
  };
  const { targetX: tx, targetY: ty } = p;

  if (version === "full") {
    const leader = (share: number) =>
      draw((c) => {
        const count = Math.ceil(all * share);
        paintBolt(c, path, count, { core: glow.edge, band: null, edge: null });
        for (const [x, y] of path.slice(Math.max(0, count - 3), count))
          setPixel(c, x, y, glow.band);
      });
    return [
      leader(0.4),
      leader(0.85),
      // The peak: the one frame the bolt is at full strength. The contact core
      // then shrinks while a few sparks run outward along the roof.
      draw((c) => {
        paintBolt(c, path, all, {
          core: glow.core,
          band: glow.band,
          edge: glow.edge,
          wide: true,
          bandReach: 4,
          edgeReach: 10,
        });
        paintShape(c, sparks(tx, ty, 8, 3), glow.band);
        paintShape(c, ellipse(tx, ty, 5, 3), glow.core);
      }),
      draw((c) => {
        paintBolt(c, path, all, {
          core: glow.band,
          band: glow.edge,
          edge: null,
        });
        paintShape(c, sparks(tx, ty, 11, 3), glow.band);
        paintShape(c, ellipse(tx, ty, 4, 2), glow.core);
      }),
      draw((c) => {
        paintBolt(c, path, all, {
          core: glow.edge,
          band: glow.edge,
          edge: null,
          dither: true,
        });
        paintShape(c, sparks(tx, ty, 14, 2), glow.edge);
        paintShape(c, ellipse(tx, ty, 3, 1), glow.band);
      }),
      draw((c) => {
        paintBolt(c, path, all, {
          core: glow.edge,
          band: null,
          edge: null,
          every: 2,
        });
        paintShape(c, sparks(tx, ty, 16, 2), glow.edge);
        paintShape(c, ellipse(tx, ty, 2, 1), glow.edge);
      }),
      draw((c) => paintShape(c, sparks(tx, ty, 18, 2), glow.edge)),
      draw((c) => paintShape(c, sparks(tx, ty, 20, 1), glow.edge)),
    ];
  }

  const pale = cloud[4] as Rgb;
  const mid = lapis[3] as Rgb;
  return [
    draw((c) =>
      paintBolt(c, path, Math.ceil(all * 0.7), {
        core: mid,
        band: null,
        edge: null,
      }),
    ),
    // The peak: a compact pale cluster where the bolt lands and two short
    // sparks down the roof, then an immediate decay.
    draw((c) => {
      paintBolt(c, path, all, { core: pale, band: mid, edge: null });
      paintShape(c, ellipse(tx, ty, 2, 1), cloud[5] as Rgb);
      paintShape(c, sparks(tx, ty, 4, 2, "down"), pale);
    }),
    draw((c) => {
      paintBolt(c, path, all, { core: mid, band: null, edge: null, every: 2 });
      paintShape(c, ellipse(tx, ty, 1, 0), mid);
    }),
    draw((c) => paintShape(c, ellipse(tx, ty, 1, 0), lapis[2] as Rgb)),
  ];
}

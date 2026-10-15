// A periodic raw ground mosaic, drawn in TypeScript: the colour, id and depth passes the render
// script would write for one terrain, keyed on raw pixel coordinates taken modulo the period
// vectors, so it is exactly periodic by construction. The fake Blender writes it, and the patch
// gate runs over it in CI. Test support only; it lives outside src/.
//
// Raw pixels are 4x. One lattice step is (128, 64) raw pixels along the first axis and (-128, 64)
// along the second, so a raw pixel's lattice coordinates are (A, B) / 256 with A = dx + 2 dy and
// B = 2 dy - dx from the origin; the period is 256 N in both. Everything below is integer.

import type { RgbaImage } from "../../src/conformance";
import { encodeDepth, idByte } from "../../src/render/parts";

export const RAW_STEP = { x: 128, y: 64 } as const;

export type Colour = readonly [number, number, number];

export interface MosaicOptions {
  readonly role: "base" | "over";
  readonly period: number;
  /** Raw width and height of the frame. */
  readonly width: number;
  readonly height: number;
  /** The raw pixel the world origin (lattice point 0, 0) projects to. */
  readonly origin: readonly [number, number];
  readonly depthRange: readonly [number, number];
  /** Palette colours, dark to light, of the olive and stone-sky ramps. */
  readonly olive: readonly Colour[];
  readonly stone: readonly Colour[];
}

function mix(a: number, b: number, c: number): number {
  let h =
    (Math.imul(a | 0, 0x9e3779b1) ^
      Math.imul(b | 0, 0x85ebca6b) ^
      Math.imul(c | 0, 0xc2b2ae35)) >>>
    0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

const unit = (a: number, b: number, c: number) => mix(a, b, c) / 0x1_0000_0000;

const positiveModulo = (value: number, modulus: number) =>
  ((value % modulus) + modulus) % modulus;

/** The mosaic colour at lattice cell (ia, ib) of the period, at fractions (fa, fb) across it. */
function colourAt(
  options: MosaicOptions,
  ia: number,
  ib: number,
  fa: number,
  fb: number,
): Colour {
  const { olive, stone } = options;
  if (options.role === "over") {
    // Four slabs to a cell, split at jittered lines; the gaps are the mortar.
    const su = 0.5 + (unit(ia, ib, 1) - 0.5) * 0.3;
    const column = fa < su ? 0 : 1;
    const sv = 0.5 + (unit(ia, ib, 2 + column) - 0.5) * 0.3;
    const row = fb < sv ? 0 : 1;
    const a0 = column === 0 ? 0 : su;
    const a1 = column === 0 ? su : 1;
    const b0 = row === 0 ? 0 : sv;
    const b1 = row === 0 ? sv : 1;
    const gap = 0.04;
    const onSlab =
      fa > a0 + gap && fa < a1 - gap && fb > b0 + gap && fb < b1 - gap;
    if (!onSlab) return stone[unit(ia, ib, 9) < 0.5 ? 0 : 1] as Colour;
    return stone[
      2 + Math.floor(unit(ia, ib, 5 + column * 2 + row) * 3)
    ] as Colour;
  }
  for (let tuft = 0; tuft < 3; tuft += 1) {
    const ta = unit(ia, ib, 20 + tuft);
    const tb = unit(ia, ib, 30 + tuft);
    if (Math.abs(fa - ta) + Math.abs(fb - tb) < 0.07) return olive[4] as Colour;
  }
  return olive[2 + (unit(ia, ib, 40) < 0.3 ? 1 : 0)] as Colour;
}

/** The three raw passes of one terrain's patch. Depth rises down the frame and is not periodic. */
export function groundMosaic(options: MosaicOptions): {
  colour: RgbaImage;
  id: RgbaImage;
  depth: RgbaImage;
} {
  const { width, height, period, origin } = options;
  const size = width * height * 4;
  const colour = new Uint8Array(size);
  const id = new Uint8Array(size);
  const depth = new Uint8Array(size);
  const ground = idByte("ground");
  const span = 512 * period;
  for (let y = 0; y < height; y += 1) {
    const dy2 = 2 * (y - origin[1]) + 1;
    const depthByte = encodeDepth(
      options.depthRange[0] +
        ((options.depthRange[1] - options.depthRange[0]) * (y + 0.5)) / height,
      options.depthRange[0],
      options.depthRange[1],
    );
    for (let x = 0; x < width; x += 1) {
      const dx2 = 2 * (x - origin[0]) + 1;
      const a = positiveModulo(dx2 + 2 * dy2 + 256, span);
      const b = positiveModulo(2 * dy2 - dx2 + 256, span);
      const [r, g, bl] = colourAt(
        options,
        Math.floor(a / 512),
        Math.floor(b / 512),
        (a % 512) / 512,
        (b % 512) / 512,
      );
      const at = (y * width + x) * 4;
      colour.set([r, g, bl, 255], at);
      id.set([ground, 0, 0, 255], at);
      depth.set([depthByte, 0, 0, 255], at);
    }
  }
  return {
    colour: { width, height, rgba: colour },
    id: { width, height, rgba: id },
    depth: { width, height, rgba: depth },
  };
}

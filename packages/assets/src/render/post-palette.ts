// The palette as the post step reads it: the colours in a fixed order, the ramp each colour
// belongs to, each ramp's darkest shade, and a nearest-colour snap in OKLab. Built from a parsed
// palette (`PaletteSet` entry), so a draft palette works the same as an approved one.
//
// Order is part of the result. The nearest colour goes to the lowest index on a distance tie, and
// the mode downscale gives a tie in pixel count to the earliest colour. The order is every
// family in file order, ramp by ramp, shade by shade, and a colour that appears twice keeps the
// ramp that lists it first. The probe's post step flattens its palette the same way.
//
// Pure: no filesystem, no platform imports.

import { fail, ok, type ParseResult } from "@panthea/contracts";
import type { Rgb } from "../conformance";
import type { Palette, PaletteSet } from "../palette";

export type Lab = readonly [number, number, number];

export const packRgb = (r: number, g: number, b: number): number =>
  (r << 16) | (g << 8) | b;

const LINEAR = Array.from({ length: 256 }, (_, channel) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** OKLab of an 8-bit colour. Matches the probe's `sprite_downscale.oklab` on integer channels. */
export function oklab(rgb: Rgb): Lab {
  const r = LINEAR[rgb[0]] as number;
  const g = LINEAR[rgb[1]] as number;
  const b = LINEAR[rgb[2]] as number;
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  // Math.pow with 1/3, not Math.cbrt: it is the operation the probe performed.
  const l3 = l ** (1 / 3);
  const m3 = m ** (1 / 3);
  const s3 = s ** (1 / 3);
  return [
    0.2104542553 * l3 + 0.793617785 * m3 - 0.0040720468 * s3,
    1.9779984951 * l3 - 2.428592205 * m3 + 0.4505937099 * s3,
    0.0259040371 * l3 + 0.7827717662 * m3 - 0.808675766 * s3,
  ];
}

export const lightness = (rgb: Rgb): number => oklab(rgb)[0];

export interface PostPalette {
  readonly id: string;
  /** Flattened master list: the order ties are broken in. */
  readonly colours: readonly Rgb[];
  /** Packed colour to the id of the ramp that lists it first. */
  readonly rampOf: ReadonlyMap<number, string>;
  /** Ramp id to its darkest shade (lowest OKLab lightness; the earliest on a tie). */
  readonly darkest: ReadonlyMap<string, Rgb>;
  /** Ramp id to its shades, dark to light, as the palette lists them. */
  readonly ramps: ReadonlyMap<string, readonly Rgb[]>;
  /** The palette colour nearest to a colour in OKLab; the lowest index on a tie. */
  snap(rgb: Rgb): Rgb;
  /** Index in `colours` of the palette colour nearest to a colour. */
  snapIndex(rgb: Rgb): number;
  /** Index of a palette colour in `colours`, or undefined when the colour is not in the palette. */
  indexOf(rgb: Rgb): number | undefined;
}

export function postPaletteOf(palette: Palette): ParseResult<PostPalette> {
  const colours: Rgb[] = [];
  const rampOf = new Map<number, string>();
  const darkest = new Map<string, Rgb>();
  const ramps = new Map<string, readonly Rgb[]>();
  for (const family of palette.families) {
    for (const ramp of family.ramps) {
      const seen = ramps.get(ramp.id);
      if (seen !== undefined) {
        // The same ramp listed under two families is fine only when it is the same ramp.
        if (
          seen.length !== ramp.shades.length ||
          seen.some((c, i) => c.some((v, k) => v !== ramp.shades[i]?.[k]))
        ) {
          return fail(
            `palette ${palette.id}.families`,
            `ramp "${ramp.id}" is listed with different shades in two families`,
          );
        }
        continue;
      }
      ramps.set(ramp.id, ramp.shades);
      let dark: Rgb | undefined;
      let darkLightness = Number.POSITIVE_INFINITY;
      for (const shade of ramp.shades) {
        const l = lightness(shade);
        if (l < darkLightness) {
          dark = shade;
          darkLightness = l;
        }
        const key = packRgb(shade[0], shade[1], shade[2]);
        if (!rampOf.has(key)) {
          colours.push(shade);
          rampOf.set(key, ramp.id);
        }
      }
      if (dark !== undefined) darkest.set(ramp.id, dark);
    }
  }
  if (colours.length === 0) {
    return fail(`palette ${palette.id}.families`, "the palette has no colours");
  }
  const labs = colours.map(oklab);
  const index = new Map(
    colours.map((c, i) => [packRgb(c[0], c[1], c[2]), i] as const),
  );
  const cache = new Map<number, number>();
  const snapIndex = (rgb: Rgb): number => {
    const key = packRgb(rgb[0], rgb[1], rgb[2]);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const lab = oklab(rgb);
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < labs.length; i += 1) {
      const other = labs[i] as Lab;
      const d =
        (lab[0] - other[0]) ** 2 +
        (lab[1] - other[1]) ** 2 +
        (lab[2] - other[2]) ** 2;
      if (d < bestDistance) {
        best = i;
        bestDistance = d;
      }
    }
    cache.set(key, best);
    return best;
  };
  return ok({
    id: palette.id,
    colours,
    rampOf,
    darkest,
    ramps,
    indexOf: (rgb) => index.get(packRgb(rgb[0], rgb[1], rgb[2])),
    snap: (rgb) => colours[snapIndex(rgb)] as Rgb,
    snapIndex,
  });
}

/** The post-step palette for an asset's palette id, looked up in the palette set. */
export function postPaletteFrom(
  palettes: PaletteSet,
  paletteId: string,
): ParseResult<PostPalette> {
  const palette = palettes.get(paletteId);
  if (palette === undefined) {
    return fail("paletteId", `no palette "${paletteId}" in the palette set`);
  }
  return postPaletteOf(palette);
}

// The exterior outline and the facts measured on a finished image. A port of the probe's
// `add_outline`, `_exterior` and `measure`.

import type { Rgb, RgbaImage } from "../conformance";
import { lightness, type PostPalette, packRgb } from "./post-palette";

const NEIGHBOURS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

/** Transparent pixels connected to the image border through transparent pixels, 4-connected. */
export function exteriorMask(image: RgbaImage): Uint8Array {
  const { width, height, rgba } = image;
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        stack.push(y * width + x);
      }
    }
  }
  while (stack.length > 0) {
    const index = stack.pop() as number;
    if (seen[index] === 1 || rgba[index * 4 + 3] !== 0) continue;
    seen[index] = 1;
    const x = index % width;
    const y = (index - x) / width;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        stack.push(ny * width + nx);
      }
    }
  }
  return seen;
}

/**
 * A 1 px exterior outline, 4-connected: each outline pixel takes the darkest shade of the ramp
 * of its darkest adjacent figure pixel (lowest OKLab lightness; the lower colour on a tie).
 * Transparent pixels enclosed by the figure get none.
 */
export function addOutline(image: RgbaImage, palette: PostPalette): RgbaImage {
  const { width, height, rgba } = image;
  const exterior = exteriorMask(image);
  const out = new Uint8Array(rgba);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (exterior[y * width + x] !== 1) continue;
      let darkest: Rgb | undefined;
      let darkestLightness = Number.POSITIVE_INFINITY;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const at = (ny * width + nx) * 4;
        if (rgba[at + 3] === 0) continue;
        const colour: Rgb = [
          rgba[at] as number,
          rgba[at + 1] as number,
          rgba[at + 2] as number,
        ];
        const l = lightness(colour);
        if (
          darkest === undefined ||
          l < darkestLightness ||
          (l === darkestLightness && colourBefore(colour, darkest))
        ) {
          darkest = colour;
          darkestLightness = l;
        }
      }
      if (darkest === undefined) continue;
      const ramp =
        palette.rampOf.get(packRgb(darkest[0], darkest[1], darkest[2])) ??
        palette.rampOf.get(packRgb(...palette.snap(darkest)));
      const shade = palette.darkest.get(ramp as string) as Rgb;
      out.set([shade[0], shade[1], shade[2], 255], (y * width + x) * 4);
    }
  }
  return { width, height, rgba: out };
}

const colourBefore = (a: Rgb, b: Rgb): boolean =>
  a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];

/** The box of the opaque pixels, [x0, y0, x1, y1] with exclusive upper bounds; null when none is opaque. */
export function opaqueBox(
  image: RgbaImage,
): readonly [number, number, number, number] | null {
  let x0 = image.width;
  let y0 = image.height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.rgba[(y * image.width + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x + 1 > x1) x1 = x + 1;
      if (y + 1 > y1) y1 = y + 1;
    }
  }
  return x1 === 0 ? null : [x0, y0, x1, y1];
}

export interface ImageMeasure {
  readonly box: readonly [number, number, number, number];
  /** Distinct opaque colours. */
  readonly colours: number;
  /** Distinct opaque colours that are not in the palette. */
  readonly outsidePalette: number;
  /**
   * True when every opaque pixel on the boundary (next to the exterior or the image edge) is the
   * darkest shade of some ramp. A figure that touches the image edge fails this: the outline
   * cannot be drawn outside the cell.
   */
  readonly outline: boolean;
}

/** Facts about a finished image; null when it has no opaque pixel. */
export function measureImage(
  image: RgbaImage,
  palette: PostPalette,
): ImageMeasure | null {
  const box = opaqueBox(image);
  if (box === null) return null;
  const { width, height, rgba } = image;
  const colours = new Set<number>();
  for (let at = 0; at < rgba.length; at += 4) {
    if (rgba[at + 3] !== 0) {
      colours.add(
        packRgb(
          rgba[at] as number,
          rgba[at + 1] as number,
          rgba[at + 2] as number,
        ),
      );
    }
  }
  let outsidePalette = 0;
  for (const colour of colours)
    if (!palette.rampOf.has(colour)) outsidePalette += 1;

  const darkestShades = new Set(
    [...palette.darkest.values()].map((c) => packRgb(c[0], c[1], c[2])),
  );
  const exterior = exteriorMask(image);
  let boundary = 0;
  let allDarkest = true;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      if (rgba[at + 3] === 0) continue;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (
          nx < 0 ||
          nx >= width ||
          ny < 0 ||
          ny >= height ||
          exterior[ny * width + nx] === 1
        ) {
          boundary += 1;
          if (
            !darkestShades.has(
              packRgb(
                rgba[at] as number,
                rgba[at + 1] as number,
                rgba[at + 2] as number,
              ),
            )
          ) {
            allDarkest = false;
          }
          break;
        }
      }
    }
  }
  return {
    box,
    colours: colours.size,
    outsidePalette,
    outline: boundary > 0 && allDarkest,
  };
}

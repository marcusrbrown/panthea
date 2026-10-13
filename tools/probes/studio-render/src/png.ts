// PNG facts for the probe: header, structure, what the studio's decodePng makes
// of a file, pixel comparison, and a small reader for the 16-bit greyscale
// depth files decodePng does not accept (so the depth levels can be counted).

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import type { RgbaImage } from "../../../../packages/assets/src/conformance";
import { parsePng, readPngHeader } from "../../../../packages/assets/src/png";
import { decodePng } from "../../../../packages/assets/src/studio/png/decode";

export interface PngFacts {
  readonly bytes: number;
  readonly header: ReturnType<typeof readPngHeader>;
  readonly structure: { readonly ok: boolean; readonly reason?: string };
  readonly decodePng:
    | { readonly ok: true; readonly width: number; readonly height: number }
    | { readonly ok: false; readonly code: string; readonly message: string };
}

export function describePng(path: string): PngFacts {
  const bytes = new Uint8Array(readFileSync(path));
  const header = readPngHeader(bytes);
  const parsed = parsePng(bytes);
  const decoded = decodePng(bytes);
  return {
    bytes: bytes.length,
    header,
    structure: parsed.ok ? { ok: true } : { ok: false, reason: parsed.reason },
    decodePng: decoded.ok
      ? { ok: true, width: decoded.image.width, height: decoded.image.height }
      : { ok: false, code: decoded.code, message: decoded.message },
  };
}

/** The decoded RGBA pixels exactly as stored, or undefined when decodePng refuses the file. */
export function decodeRgba(path: string): RgbaImage | undefined {
  const decoded = decodePng(new Uint8Array(readFileSync(path)));
  return decoded.ok ? decoded.image : undefined;
}

export interface Comparison {
  readonly identical: boolean;
  readonly sizeMatch: boolean;
  readonly differingPixels: number;
  readonly pixels: number;
}

/** Pixel-for-pixel equality of two decoded images as stored (RGB under alpha 0 included). */
export function compareRgba(a: RgbaImage, b: RgbaImage): Comparison {
  const sizeMatch = a.width === b.width && a.height === b.height;
  if (!sizeMatch)
    return {
      identical: false,
      sizeMatch,
      differingPixels: -1,
      pixels: a.width * a.height,
    };
  let differing = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    if (
      a.rgba[i] !== b.rgba[i] ||
      a.rgba[i + 1] !== b.rgba[i + 1] ||
      a.rgba[i + 2] !== b.rgba[i + 2] ||
      a.rgba[i + 3] !== b.rgba[i + 3]
    )
      differing += 1;
  }
  return {
    identical: differing === 0,
    sizeMatch,
    differingPixels: differing,
    pixels: a.width * a.height,
  };
}

/** Distinct red-channel values among pixels with alpha > 0: the number of depth levels an 8-bit file holds. */
export function distinctLevels8(image: RgbaImage): number {
  const seen = new Set<number>();
  for (let i = 0; i < image.rgba.length; i += 4)
    if ((image.rgba[i + 3] as number) > 0) seen.add(image.rgba[i] as number);
  return seen.size;
}

export interface Grey16 {
  readonly width: number;
  readonly height: number;
  readonly samples: Uint16Array;
}

/** Reads a non-interlaced 16-bit greyscale PNG (colour type 0), filters 0-4. Undefined for anything else. */
export function readGrey16(path: string): Grey16 | undefined {
  const bytes = new Uint8Array(readFileSync(path));
  const header = readPngHeader(bytes);
  if (header === undefined) return undefined;
  if (header.bitDepth !== 16 || header.colorType !== 0) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "IDAT")
      parts.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = new Uint8Array(inflateSync(Buffer.concat(parts)));
  const { width, height } = header;
  const stride = width * 2;
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] as number;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x] as number;
      const left = x >= 2 ? (out[y * stride + x - 2] as number) : 0;
      const up = y > 0 ? (out[(y - 1) * stride + x] as number) : 0;
      const upLeft =
        x >= 2 && y > 0 ? (out[(y - 1) * stride + x - 2] as number) : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      out[y * stride + x] = (value + predictor) & 0xff;
    }
  }
  const samples = new Uint16Array(width * height);
  for (let i = 0; i < samples.length; i += 1)
    samples[i] = ((out[i * 2] as number) << 8) | (out[i * 2 + 1] as number);
  return { width, height, samples };
}

/** Distinct sample values greater than zero in a 16-bit grey image (zero is the empty background). */
export function distinctLevels16(image: Grey16): number {
  const seen = new Set<number>();
  for (const sample of image.samples) if (sample > 0) seen.add(sample);
  return seen.size;
}

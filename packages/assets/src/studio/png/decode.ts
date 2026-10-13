// Minimal PNG-to-RGBA decoder for the studio pipeline: 8-bit RGB (colour type
// 2) and RGBA (type 6), non-interlaced, filters 0-4, nothing else. Node-only
// (node:zlib). Structure, CRCs and scanline arithmetic come from ../../png.
// Pixels are returned as stored: no premultiplication, keying, quantization
// or resampling, and RGB hidden under alpha 0 is preserved.

import { constants } from "node:buffer";
import { inflateSync } from "node:zlib";
import type { RgbaImage } from "../../conformance";
import { inflatedLength, parsePng } from "../../png";

export type PngDecode =
  | { readonly ok: true; readonly image: RgbaImage }
  | {
      readonly ok: false;
      readonly code: "unsupported-png" | "corrupt-png";
      readonly message: string;
    };

const SUPPORTED = "8-bit RGB or RGBA, non-interlaced PNG without a tRNS chunk";

const unsupported = (what: string): PngDecode => ({
  ok: false,
  code: "unsupported-png",
  message: `${what}; re-export the image as an ${SUPPORTED}`,
});

const corrupt = (message: string): PngDecode => ({
  ok: false,
  code: "corrupt-png",
  message: `corrupt PNG: ${message}`,
});

/** True when a (structurally valid) PNG carries a tRNS chunk. */
function hasTransparencyChunk(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset < bytes.length) {
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "tRNS") return true;
    offset += 12 + view.getUint32(offset, false);
  }
  return false;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Reverses the row filters in place; returns the bad filter type's row, if any. */
function unfilter(
  raw: Uint8Array,
  height: number,
  stride: number,
  bpp: number,
): { row: number; type: number } | undefined {
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const type = raw[rowStart] as number;
    if (type > 4) return { row: y, type };
    const cur = rowStart + 1;
    const prev = y > 0 ? cur - (stride + 1) : -1;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? (raw[cur + i - bpp] as number) : 0;
      const b = prev >= 0 ? (raw[prev + i] as number) : 0;
      const c = prev >= 0 && i >= bpp ? (raw[prev + i - bpp] as number) : 0;
      const delta = raw[cur + i] as number;
      let value = delta;
      if (type === 1) value += a;
      else if (type === 2) value += b;
      else if (type === 3) value += (a + b) >> 1;
      else if (type === 4) value += paeth(a, b, c);
      raw[cur + i] = value & 255;
    }
  }
  return undefined;
}

export function decodePng(bytes: Uint8Array): PngDecode {
  const parsed = parsePng(bytes);
  if (!parsed.ok) {
    return parsed.reason.startsWith("unknown critical chunk")
      ? unsupported(`the PNG has an ${parsed.reason}`)
      : corrupt(parsed.reason);
  }
  const { png } = parsed;

  if (hasTransparencyChunk(bytes)) {
    return unsupported("the PNG has a tRNS transparency chunk");
  }
  if (png.colorType === 0 || png.colorType === 4) {
    return unsupported("grayscale PNGs are not supported");
  }
  if (png.colorType === 3) {
    return unsupported("indexed-colour PNGs are not supported");
  }
  if (png.bitDepth !== 8) {
    return unsupported(`${png.bitDepth}-bit PNGs are not supported`);
  }
  if (png.interlace !== 0) {
    return unsupported("interlaced PNGs are not supported");
  }

  const channels = png.colorType === 6 ? 4 : 3;
  const stride = png.width * channels;
  const pixelBytes = png.width * png.height * 4;
  const expected = inflatedLength(png);
  const limit = constants.MAX_LENGTH;
  if (
    !Number.isSafeInteger(expected) ||
    !Number.isSafeInteger(pixelBytes) ||
    expected > limit ||
    pixelBytes > limit
  ) {
    return unsupported(
      `the PNG dimensions ${png.width}x${png.height} are too large to decode`,
    );
  }

  let raw: Uint8Array;
  try {
    raw = inflateSync(Buffer.concat(png.idat), { maxOutputLength: expected });
  } catch (error) {
    return corrupt(
      `image data does not inflate to ${expected} bytes (${error instanceof Error ? error.message : "inflate failed"})`,
    );
  }
  if (raw.length !== expected) {
    return corrupt(
      `image data is ${raw.length} bytes but ${expected} are required`,
    );
  }

  const bad = unfilter(raw, png.height, stride, channels);
  if (bad) {
    return corrupt(`invalid filter type ${bad.type} on row ${bad.row}`);
  }

  const rgba = new Uint8Array(pixelBytes);
  for (let y = 0; y < png.height; y += 1) {
    const src = y * (stride + 1) + 1;
    const dst = y * png.width * 4;
    if (channels === 4) {
      rgba.set(raw.subarray(src, src + stride), dst);
    } else {
      for (let x = 0; x < png.width; x += 1) {
        rgba.set(raw.subarray(src + x * 3, src + x * 3 + 3), dst + x * 4);
        rgba[dst + x * 4 + 3] = 255;
      }
    }
  }
  return { ok: true, image: { width: png.width, height: png.height, rgba } };
}

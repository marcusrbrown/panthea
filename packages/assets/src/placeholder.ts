// Procedural placeholder art: a deterministic pixel-silhouette composed from
// a palette and named body/head/prop parts, encoded as real PNG bytes with a
// stable content-addressed logical URI (`panthea-asset://placeholder/<sha256>`). This is the
// "coherent temporary art while a job runs" piece of U06/U07 — it never
// depends on a model, never throws (an unknown part name silently falls
// back to a default silhouette for that slot), and returns instantly.
//
// Determinism contract: the same `{ palette, parts }` input always produces
// byte-identical PNG output (same URI, same image hash) — no RNG, no
// timestamp, no zlib entropy source. This lets a caller cache placeholders
// by input and lets placeholder.test.ts assert on exact bytes.

import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { placeholderUri, type Sha256 } from "@panthea/contracts";
import {
  type PlaceholderInput,
  renderPlaceholderPixels,
} from "./placeholder-pixels";
import { crc32 } from "./png";

export type { PlaceholderInput, PlaceholderParts } from "./placeholder-pixels";

const CHANNELS = 4; // RGBA

export interface PlaceholderAsset {
  /** Stable content-addressed logical URI: `panthea-asset://placeholder/<sha256-hex>`. */
  readonly uri: string;
  /** Full PNG file bytes. */
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

// --- Minimal PNG encoder (8-bit RGBA, no interlacing, filter type 0) ---
// Only what's needed to turn a pixel buffer into valid, deterministic PNG
// bytes: chunk framing + CRC32. Compression is `node:zlib`'s deflateSync,
// which is deterministic for identical input at a fixed level.

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) {
    typeBytes[i] = type.charCodeAt(i);
  }
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const crc = crc32(body);

  const out = new Uint8Array(4 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc, false);
  return out;
}

/**
 * Encodes a raw RGBA pixel buffer (row-major, 4 bytes/pixel, no padding) as
 * a PNG file. Shared by placeholder rendering and the art-local bench's
 * contact-sheet compositor so there is exactly one PNG writer. Uses node:zlib,
 * so it is a Node/Bun module, not a browser one.
 */
export function encodeRgbaPng(
  rgba: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = chunk("IHDR", ihdrData);

  // Raw scanlines: one filter-type byte (0 = none) prefixed per row.
  const stride = width * CHANNELS;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    raw.set(rgba.subarray(y * stride, y * stride + stride), rowStart + 1);
  }
  const compressed = deflateSync(raw, { level: 9 });
  const idat = chunk("IDAT", new Uint8Array(compressed));

  const iend = chunk("IEND", new Uint8Array(0));

  const total = new Uint8Array(
    signature.length + ihdr.length + idat.length + iend.length,
  );
  let offset = 0;
  total.set(signature, offset);
  offset += signature.length;
  total.set(ihdr, offset);
  offset += ihdr.length;
  total.set(idat, offset);
  offset += idat.length;
  total.set(iend, offset);
  return total;
}

/**
 * Composes a deterministic pixel-silhouette placeholder from a palette and
 * named body/head/prop parts. Never throws: an unrecognized part name
 * silently falls back to that slot's default shape. Same input always
 * yields byte-identical PNG output and the same content-addressed URI.
 * The pixels come from `renderPlaceholderPixels`; this adds the PNG
 * encoding and the sha256 URI.
 */
export function renderPlaceholder(input: PlaceholderInput): PlaceholderAsset {
  const { width, height, rgba } = renderPlaceholderPixels(input);
  const bytes = encodeRgbaPng(rgba, width, height);
  const hash = createHash("sha256").update(bytes).digest("hex");

  return {
    uri: placeholderUri(hash as Sha256),
    bytes,
    width,
    height,
  };
}

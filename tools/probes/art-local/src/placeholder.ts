// Procedural placeholder art: a deterministic pixel-silhouette composed from
// a palette and named body/head/prop parts, encoded as real PNG bytes with a
// stable content-addressed URI (`asset://placeholder/<sha256>`). This is the
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

const SIZE = 16;
const CHANNELS = 4; // RGBA

/** 16x16 boolean masks, one row per string, `#` = filled, any other char = empty. */
type Shape = readonly string[];

const BODY_SHAPES: Readonly<Record<string, Shape>> = {
  humanoid: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "....########....",
    "....########....",
    "....########....",
    "....########....",
    "....########....",
    "....##....##....",
    "....##....##....",
    "....##....##....",
  ],
  round: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "...##########...",
    "..############..",
    "..############..",
    "..############..",
    "...##########...",
    "....########....",
    "................",
    "................",
  ],
  tall: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    ".....######.....",
    ".....######.....",
    ".....######.....",
    ".....######.....",
    ".....######.....",
    ".....######.....",
    ".....######.....",
    ".....##..##.....",
    ".....##..##.....",
    ".....##..##.....",
  ],
};

const HEAD_SHAPES: Readonly<Record<string, Shape>> = {
  round: [
    "................",
    "................",
    ".....######.....",
    "....########....",
    "....########....",
    "....########....",
    "....########....",
    ".....######.....",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  crowned: [
    "....#.##.#......",
    "....########....",
    "....########....",
    "....########....",
    "....########....",
    "....########....",
    "....########....",
    ".....######.....",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  hooded: [
    "................",
    ".....######.....",
    "....########....",
    "...##########...",
    "...##......##...",
    "...##......##...",
    "....########....",
    ".....######.....",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
};

const PROP_SHAPES: Readonly<Record<string, Shape>> = {
  staff: [
    "..............#.",
    "..............#.",
    "............#...",
    "..............#.",
    "..............#.",
    "..............#.",
    "..............#.",
    "..............#.",
    "..............#.",
    "..............#.",
    "..............#.",
    "..............#.",
    "..............#.",
    "..............#.",
    "..............#.",
    "..............#.",
  ],
  sword: [
    "................",
    "................",
    "................",
    "................",
    "..............#.",
    ".............#..",
    "............#...",
    "...........#....",
    "..........#.....",
    ".........#......",
    "........#.......",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  none: Array.from({ length: SIZE }, () => ".".repeat(SIZE)),
};

const DEFAULT_BODY_SHAPE = "humanoid";
const DEFAULT_HEAD_SHAPE = "round";
const DEFAULT_PROP_SHAPE = "staff";
const DEFAULT_PALETTE: readonly string[] = [
  "#8b5e34",
  "#c9a35c",
  "#4a6fa5",
  "#b23a48",
  "#e8e0d5",
];

export interface PlaceholderParts {
  readonly body?: string;
  readonly head?: string;
  readonly prop?: string;
}

export interface PlaceholderInput {
  readonly palette: readonly string[];
  readonly parts: PlaceholderParts;
}

export interface PlaceholderAsset {
  /** Stable content-addressed URI: `asset://placeholder/<sha256-hex>`. */
  readonly uri: string;
  /** Full PNG file bytes. */
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** Looks up a named shape, falling back to `fallbackName`'s shape (never throws, never undefined). */
function resolveShape(
  registry: Readonly<Record<string, Shape>>,
  requested: string | undefined,
  fallbackName: string,
): Shape {
  const name = requested && registry[requested] ? requested : fallbackName;
  return registry[name] ?? registry[fallbackName]!;
}

/** FNV-1a over a UTF-8 string; used only to pick deterministic palette indices, not for crypto. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function pickColor(
  palette: readonly string[],
  seed: string,
): readonly [number, number, number] {
  const safePalette = palette.length > 0 ? palette : DEFAULT_PALETTE;
  const index = fnv1a(seed) % safePalette.length;
  const hex = safePalette[index]!.replace("#", "");
  const normalized =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex.padEnd(6, "0").slice(0, 6);
  const r = Number.parseInt(normalized.slice(0, 2), 16) || 0;
  const g = Number.parseInt(normalized.slice(2, 4), 16) || 0;
  const b = Number.parseInt(normalized.slice(4, 6), 16) || 0;
  return [r, g, b];
}

function paintLayer(
  buffer: Uint8Array,
  shape: Shape,
  color: readonly [number, number, number],
): void {
  for (let y = 0; y < SIZE; y += 1) {
    const row = shape[y] ?? "";
    for (let x = 0; x < SIZE; x += 1) {
      if (row[x] === "#") {
        const offset = (y * SIZE + x) * CHANNELS;
        buffer[offset] = color[0];
        buffer[offset + 1] = color[1];
        buffer[offset + 2] = color[2];
        buffer[offset + 3] = 255;
      }
    }
  }
}

// --- Minimal PNG encoder (8-bit RGBA, no interlacing, filter type 0) ---
// Only what's needed to turn a pixel buffer into valid, deterministic PNG
// bytes: chunk framing + CRC32. Compression is `node:zlib`'s deflateSync,
// which is deterministic for identical input at a fixed level.

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

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
 * a PNG file. Shared by placeholder rendering and bench.ts's contact-sheet
 * compositor so there is exactly one PNG writer in this probe.
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
 */
export function renderPlaceholder(input: PlaceholderInput): PlaceholderAsset {
  const bodyShape = resolveShape(
    BODY_SHAPES,
    input.parts.body,
    DEFAULT_BODY_SHAPE,
  );
  const headShape = resolveShape(
    HEAD_SHAPES,
    input.parts.head,
    DEFAULT_HEAD_SHAPE,
  );
  const propShape = resolveShape(
    PROP_SHAPES,
    input.parts.prop,
    DEFAULT_PROP_SHAPE,
  );

  const buffer = new Uint8Array(SIZE * SIZE * CHANNELS);
  paintLayer(buffer, bodyShape, pickColor(input.palette, "body"));
  paintLayer(buffer, headShape, pickColor(input.palette, "head"));
  paintLayer(buffer, propShape, pickColor(input.palette, "prop"));

  const bytes = encodeRgbaPng(buffer, SIZE, SIZE);
  const hash = createHash("sha256").update(bytes).digest("hex");

  return {
    uri: `asset://placeholder/${hash}`,
    bytes,
    width: SIZE,
    height: SIZE,
  };
}

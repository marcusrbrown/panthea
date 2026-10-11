// Pixel digests for the packaged inspection checks. Pure TypeScript with no
// imports, so the browser (which digests a read-back region) and Node (the
// generator that digests the decoded committed blobs) run the very same
// function. FNV-1a over 32 bits is not cryptographic and is not meant to be:
// it names a pixel region for an equality check, and the positive controls
// show that moving a frame one pixel changes it.
//
// Digested bytes: width and height as little-endian u32, then RGBA rows top
// first. Zoom is not a parameter. The digest at zoom N is the digest of the
// 1x pixels enlarged N times by `upscale`, so the generator stores one digest
// per zoom and the app digests the region it reads back at that zoom.

export const DIGEST_ALGORITHM = "fnv1a32";

/** The inspection scene's clear colour, as sRGB bytes. */
export const INSPECT_BACKGROUND = [96, 104, 120] as const;

/** The integer zooms the checks cover. */
export const CHECK_ZOOMS = [1, 2, 3, 4] as const;

export interface Rgba {
  readonly width: number;
  readonly height: number;
  /** RGBA, straight alpha, top row first. */
  readonly data: Uint8Array;
}

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function fnv1a32(bytes: Uint8Array, seed = FNV_OFFSET): number {
  let hash = seed >>> 0;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash;
}

function littleEndian(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

export function digestRgba(image: Rgba): string {
  let hash = fnv1a32(littleEndian(image.width));
  hash = fnv1a32(littleEndian(image.height), hash);
  hash = fnv1a32(image.data, hash);
  return `${DIGEST_ALGORITHM}:${hash.toString(16).padStart(8, "0")}`;
}

/** The rectangle, top row first. Throws if any of it lies outside the image. */
export function crop(image: Rgba, rect: PixelRect): Rgba {
  if (
    rect.w <= 0 ||
    rect.h <= 0 ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.w > image.width ||
    rect.y + rect.h > image.height
  ) {
    throw new Error(
      `region ${rect.x},${rect.y} ${rect.w}x${rect.h} lies outside the ${image.width}x${image.height} image`,
    );
  }
  const data = new Uint8Array(rect.w * rect.h * 4);
  for (let row = 0; row < rect.h; row += 1) {
    const from = ((rect.y + row) * image.width + rect.x) * 4;
    data.set(image.data.subarray(from, from + rect.w * 4), row * rect.w * 4);
  }
  return { width: rect.w, height: rect.h, data };
}

/** Nearest enlargement: each pixel becomes a zoom x zoom block. */
export function upscale(image: Rgba, zoom: number): Rgba {
  if (!Number.isInteger(zoom) || zoom < 1) {
    throw new Error(`zoom must be a whole number of at least 1, got ${zoom}`);
  }
  const width = image.width * zoom;
  const height = image.height * zoom;
  // Whole pixels move as one 32-bit word: the bytes are copied, never read as numbers.
  const from = new Uint32Array(image.width * image.height);
  new Uint8Array(from.buffer).set(image.data);
  const to = new Uint32Array(width * height);
  for (let row = 0; row < image.height; row += 1) {
    const first = row * zoom * width;
    for (let column = 0; column < image.width; column += 1) {
      to.fill(
        from[row * image.width + column] ?? 0,
        first + column * zoom,
        first + (column + 1) * zoom,
      );
    }
    for (let copy = 1; copy < zoom; copy += 1) {
      to.copyWithin(first + copy * width, first, first + width);
    }
  }
  return { width, height, data: new Uint8Array(to.buffer) };
}

/**
 * What the renderer leaves on an opaque target: a pixel with alpha of 128 or
 * more (the sprite material's 0.5 cutoff) keeps its colour, any other shows
 * the background. The result is fully opaque.
 */
export function cutoutOver(
  image: Rgba,
  background: readonly [number, number, number],
): Rgba {
  const data = new Uint8Array(image.data.length);
  for (let index = 0; index < image.data.length; index += 4) {
    const solid = (image.data[index + 3] ?? 0) >= 128;
    data[index] = solid ? (image.data[index] ?? 0) : background[0];
    data[index + 1] = solid ? (image.data[index + 1] ?? 0) : background[1];
    data[index + 2] = solid ? (image.data[index + 2] ?? 0) : background[2];
    data[index + 3] = 255;
  }
  return { width: image.width, height: image.height, data };
}

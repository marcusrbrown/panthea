// Pure pixel comparisons for the preview's in-page checks. Images are RGBA,
// top row first. Nothing here touches the DOM or a GPU, so the comparison
// logic itself is unit tested; the browser driver feeds it real readbacks.

export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Placed {
  readonly atlas: Pixels;
  /** The frame's rectangle in the atlas, top-left origin. */
  readonly rect: Rect;
  /** Where the frame's top-left lands in the target. */
  readonly at: { readonly x: number; readonly y: number };
}

export type ExpectedLayer = Placed;

export interface Mismatch {
  readonly x: number;
  readonly y: number;
  readonly expected: readonly number[];
  readonly actual: readonly number[];
}

export interface Comparison {
  readonly checked: number;
  readonly mismatches: number;
  readonly first: Mismatch | undefined;
  readonly note?: string;
}

/**
 * Atlas alpha at or above this is drawn: the cutout discards alpha below 0.5,
 * and byte 128 is the first one that reads as 0.5 or more.
 */
export const ALPHA_DRAWN_MIN = 128;

const OPAQUE = 255;

function pixelAt(pixels: Pixels, x: number, y: number): number[] {
  const offset = (y * pixels.width + x) * 4;
  return [
    pixels.data[offset] as number,
    pixels.data[offset + 1] as number,
    pixels.data[offset + 2] as number,
    pixels.data[offset + 3] as number,
  ];
}

const sameBytes = (a: readonly number[], b: readonly number[], count = 4) => {
  for (let i = 0; i < count; i += 1) if (a[i] !== b[i]) return false;
  return true;
};

function requireInteger(name: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${name}=${value} must be an integer`);
  }
}

function requireRectInside(pixels: Pixels, rect: Rect): void {
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.w < 0 ||
    rect.h < 0 ||
    rect.x + rect.w > pixels.width ||
    rect.y + rect.h > pixels.height
  ) {
    throw new Error(
      `rect ${rect.x},${rect.y} ${rect.w}x${rect.h} lies outside the ${pixels.width}x${pixels.height} atlas`,
    );
  }
}

/** Every enlarged pixel must equal the source pixel at the integer-divided position. */
export function compareEnlargement(
  source: Pixels,
  enlarged: Pixels,
  zoom: number,
): Comparison {
  if (!Number.isInteger(zoom) || zoom < 1) {
    throw new Error(`zoom=${zoom} must be a positive integer`);
  }
  if (
    enlarged.width !== source.width * zoom ||
    enlarged.height !== source.height * zoom
  ) {
    return {
      checked: 0,
      mismatches: 1,
      first: undefined,
      note: `size ${enlarged.width}x${enlarged.height} is not ${source.width}x${source.height} times ${zoom}`,
    };
  }
  let mismatches = 0;
  let first: Mismatch | undefined;
  for (let y = 0; y < enlarged.height; y += 1) {
    const sy = Math.floor(y / zoom);
    for (let x = 0; x < enlarged.width; x += 1) {
      const expected = pixelAt(source, Math.floor(x / zoom), sy);
      const actual = pixelAt(enlarged, x, y);
      if (sameBytes(expected, actual)) continue;
      mismatches += 1;
      first ??= { x, y, expected, actual };
    }
  }
  return { checked: enlarged.width * enlarged.height, mismatches, first };
}

export interface FrameComparison {
  /** Opaque atlas pixels compared with the target. */
  readonly compared: number;
  readonly mismatches: number;
  /** Atlas pixels below the cutout, never drawn. */
  readonly skippedTransparent: number;
  /** Drawn but not fully opaque; their RGB is not compared. */
  readonly partial: number;
  /** Opaque atlas pixels whose projected texel lies outside the target. */
  readonly clipped: number;
  readonly first: Mismatch | undefined;
}

/** Each opaque pixel of an atlas frame must appear unchanged at its projected texel. */
export function compareFrame(
  target: Pixels,
  atlas: Pixels,
  rect: Rect,
  at: { readonly x: number; readonly y: number },
): FrameComparison {
  requireInteger("x", at.x);
  requireInteger("y", at.y);
  requireRectInside(atlas, rect);
  let compared = 0;
  let mismatches = 0;
  let skippedTransparent = 0;
  let partial = 0;
  let clipped = 0;
  let first: Mismatch | undefined;
  for (let ry = 0; ry < rect.h; ry += 1) {
    for (let rx = 0; rx < rect.w; rx += 1) {
      const source = pixelAt(atlas, rect.x + rx, rect.y + ry);
      const alpha = source[3] as number;
      if (alpha < ALPHA_DRAWN_MIN) {
        skippedTransparent += 1;
        continue;
      }
      if (alpha < OPAQUE) {
        partial += 1;
        continue;
      }
      const x = at.x + rx;
      const y = at.y + ry;
      if (x < 0 || y < 0 || x >= target.width || y >= target.height) {
        clipped += 1;
        continue;
      }
      compared += 1;
      const actual = pixelAt(target, x, y);
      if (sameBytes(source, actual, 3)) continue;
      mismatches += 1;
      first ??= { x, y, expected: source, actual };
    }
  }
  return {
    compared,
    mismatches,
    skippedTransparent,
    partial,
    clipped,
    first,
  };
}

/** The image the cutout pipeline should produce: opaque background, layers painted back to front. */
export function renderExpected(
  width: number,
  height: number,
  background: readonly [number, number, number],
  layers: readonly ExpectedLayer[],
): Pixels {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = background[0];
    data[i + 1] = background[1];
    data[i + 2] = background[2];
    data[i + 3] = OPAQUE;
  }
  for (const { atlas, rect, at } of layers) {
    requireInteger("x", at.x);
    requireInteger("y", at.y);
    requireRectInside(atlas, rect);
    for (let ry = 0; ry < rect.h; ry += 1) {
      for (let rx = 0; rx < rect.w; rx += 1) {
        const source = pixelAt(atlas, rect.x + rx, rect.y + ry);
        if ((source[3] as number) < ALPHA_DRAWN_MIN) continue;
        const x = at.x + rx;
        const y = at.y + ry;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        data.set(
          [
            source[0] as number,
            source[1] as number,
            source[2] as number,
            OPAQUE,
          ],
          (y * width + x) * 4,
        );
      }
    }
  }
  return { width, height, data };
}

export function diffPixels(expected: Pixels, actual: Pixels): Comparison {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return {
      checked: 0,
      mismatches: 1,
      first: undefined,
      note: `size ${actual.width}x${actual.height} differs from ${expected.width}x${expected.height}`,
    };
  }
  let mismatches = 0;
  let first: Mismatch | undefined;
  for (let y = 0; y < expected.height; y += 1) {
    for (let x = 0; x < expected.width; x += 1) {
      const want = pixelAt(expected, x, y);
      const got = pixelAt(actual, x, y);
      if (sameBytes(want, got)) continue;
      mismatches += 1;
      first ??= { x, y, expected: want, actual: got };
    }
  }
  return { checked: expected.width * expected.height, mismatches, first };
}

export interface OverlapComparison {
  /** Pixels where both layers are drawn. */
  readonly overlapping: number;
  readonly frontWins: number;
  readonly backWins: number;
  /** The two layers have the same colour there, so the target cannot tell them apart. */
  readonly ambiguous: number;
  /** The target shows neither layer's colour. */
  readonly other: number;
}

/** Which of two drawn layers shows in the pixels they share. */
export function compareOverlap(
  target: Pixels,
  front: Placed,
  back: Placed,
): OverlapComparison {
  let overlapping = 0;
  let frontWins = 0;
  let backWins = 0;
  let ambiguous = 0;
  let other = 0;
  const drawnAt = (layer: Placed, x: number, y: number) => {
    const lx = x - layer.at.x;
    const ly = y - layer.at.y;
    if (lx < 0 || ly < 0 || lx >= layer.rect.w || ly >= layer.rect.h)
      return undefined;
    const pixel = pixelAt(layer.atlas, layer.rect.x + lx, layer.rect.y + ly);
    return (pixel[3] as number) >= ALPHA_DRAWN_MIN ? pixel : undefined;
  };
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const above = drawnAt(front, x, y);
      const below = drawnAt(back, x, y);
      if (above === undefined || below === undefined) continue;
      overlapping += 1;
      if (sameBytes(above, below, 3)) {
        ambiguous += 1;
        continue;
      }
      const shown = pixelAt(target, x, y);
      if (sameBytes(shown, above, 3)) frontWins += 1;
      else if (sameBytes(shown, below, 3)) backWins += 1;
      else other += 1;
    }
  }
  return { overlapping, frontWins, backWins, ambiguous, other };
}

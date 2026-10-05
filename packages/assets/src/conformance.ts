// Deterministic conformance: recover the pixel grid, prepare alpha, reduce to
// the palette, and report against the art guide. Pure functions over decoded
// RGBA: no filesystem, no PNG decoding, no randomness, no platform imports.
// Every threshold is a caller-supplied parameter.

import type { ConformanceReport } from "@panthea/contracts";

export type Rgb = readonly [number, number, number];

export interface RgbaImage {
  /** Row-major, 4 bytes per pixel, no padding. */
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
}

const MAX_ACCENTS = 4;

export type ConformanceKind = "sprite" | "portrait" | "effect";

/** How the background is removed: by existing alpha, or by an explicit key colour. */
export type BackgroundSpec =
  | { readonly type: "alpha" }
  | { readonly type: "key"; readonly rgb: Rgb; readonly tolerance: number };

export interface GridParams {
  /** Largest per-channel difference between neighbours that is not an edge. */
  readonly edgeTolerance: number;
  /** Smallest share of edges that must fall on the grid, 0 to 1. */
  readonly minConfidence: number;
  /** Fewest edges the evidence may rest on. */
  readonly minEdges: number;
}

export interface ConformanceInput extends RgbaImage {
  readonly kind: ConformanceKind;
  readonly mode: "auto" | "report-only";
  readonly cell: { readonly w: number; readonly h: number };
  readonly pivot?: { readonly x: number; readonly y: number };
  readonly paletteRgb: readonly Rgb[];
  /** Emissive accents declared by an effect; at most 4, effects only. */
  readonly accents?: readonly Rgb[];
  readonly background: BackgroundSpec;
  /** Alpha below this becomes 0, at or above becomes 255. */
  readonly alphaCutoff: number;
  readonly grid: GridParams;
  /** The scale the owner chose; skips detection but keeps the evidence. */
  readonly scale?: number;
  /** The previous version at the cell size, for an edit diff. */
  readonly previous?: RgbaImage;
  /** East and west frames at the cell size; west must be east flipped unless an asymmetry is declared. */
  readonly mirror?: {
    readonly east: RgbaImage;
    readonly west: RgbaImage;
    readonly asymmetry: boolean;
  };
}

export interface GridEvidence {
  readonly scale: number;
  readonly source: "dimensions" | "detected" | "supplied";
  /** Share of edges on the grid; null when the size already matches the cell. */
  readonly confidence: number | null;
  readonly onGridEdges: number;
  readonly offGridEdges: number;
  /** Edges fall only on multiples of twice the scale: the native grid is coarser. */
  readonly coarserThanCell: boolean;
}

export interface PixelDiff {
  readonly x: number;
  readonly y: number;
  /** `#rrggbbaa`; a transparent pixel is `#00000000`. */
  readonly before: string;
  readonly after: string;
}

export interface ColourMapEntry {
  readonly from: string;
  readonly to: string;
  readonly pixels: number;
}

export interface ConformanceMetrics {
  readonly resize: {
    readonly from: { readonly w: number; readonly h: number };
    readonly to: { readonly w: number; readonly h: number };
    readonly factor: number;
    readonly detected: boolean;
    readonly supplied: boolean;
  };
  readonly grid: GridEvidence;
  /** Source blocks whose pixels differ from the sampled pixel by more than the edge tolerance. */
  readonly blendedBlocks: number;
  /** Pixels made transparent by the key flood fill. */
  readonly keyedPixels: number;
  /** Pixels whose alpha was binarised, not counting keyed pixels. */
  readonly alphaChanged: number;
  /** Distinct opaque colours after background and alpha preparation, before reduction. */
  readonly coloursBefore: number;
  readonly coloursAfter: number;
  readonly coloursMerged: number;
  readonly iterations: number;
  /** Changed colours, most pixels first, then by source colour. */
  readonly colourMap: readonly ColourMapEntry[];
  /** Opaque pixels whose colour changed in reduction and palette mapping. */
  readonly pixelsRecoloured: number;
  /** Pixels that differ between the sampled 1x image and the result, whatever the cause. */
  readonly pixelsChanged: number;
}

export type ConformanceResult =
  | {
      readonly status: "invalid-input";
      readonly field: string;
      readonly message: string;
    }
  | {
      readonly status: "needs-scale";
      readonly grid: GridEvidence;
      readonly message: string;
    }
  | {
      readonly status: "done";
      readonly mode: "auto" | "report-only";
      /** Auto: the conformed image. Report-only: the input, unchanged. */
      readonly image: RgbaImage;
      /** What auto would produce, at the cell size. */
      readonly proposal: RgbaImage;
      readonly report: ConformanceReport;
      readonly metrics: ConformanceMetrics;
      /** Sampled 1x image against the proposal, row-major. */
      readonly diff: readonly PixelDiff[];
      /** Previous version against the sampled 1x image, when one was supplied. */
      readonly editDiff: readonly PixelDiff[] | null;
    };

export type GridResolution =
  | { readonly ok: true; readonly grid: GridEvidence }
  | {
      readonly ok: false;
      readonly status: "invalid-input";
      readonly field: string;
      readonly message: string;
    }
  | {
      readonly ok: false;
      readonly status: "needs-scale";
      readonly grid: GridEvidence;
      readonly message: string;
    };

const isInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);

const isByte = (value: unknown): value is number =>
  isInt(value) && value >= 0 && value <= 255;

const isRgb = (value: unknown): value is Rgb =>
  Array.isArray(value) && value.length === 3 && value.every(isByte);

interface InvalidInput {
  readonly field: string;
  readonly message: string;
}

function checkImage(
  image: Partial<RgbaImage> | undefined,
  field: string,
  expect?: { readonly w: number; readonly h: number },
): InvalidInput | undefined {
  if (image === undefined || !isInt(image.width) || image.width < 1) {
    return { field, message: "width must be a positive integer" };
  }
  if (!isInt(image.height) || image.height < 1) {
    return { field, message: "height must be a positive integer" };
  }
  if (
    !(image.rgba instanceof Uint8Array) ||
    image.rgba.length !== image.width * image.height * 4
  ) {
    return { field, message: "rgba must hold width x height x 4 bytes" };
  }
  if (
    expect !== undefined &&
    (image.width !== expect.w || image.height !== expect.h)
  ) {
    return {
      field,
      message: `must be ${expect.w}x${expect.h}, the cell size; got ${image.width}x${image.height}`,
    };
  }
  return undefined;
}

/** The first unusable field of the input, or undefined. */
function validate(input: ConformanceInput): InvalidInput | undefined {
  if (!isInt(input.width) || input.width < 1) {
    return { field: "width", message: "width must be a positive integer" };
  }
  if (!isInt(input.height) || input.height < 1) {
    return { field: "height", message: "height must be a positive integer" };
  }
  if (
    !(input.rgba instanceof Uint8Array) ||
    input.rgba.length !== input.width * input.height * 4
  ) {
    return {
      field: "rgba",
      message: `rgba must hold width x height x 4 = ${input.width * input.height * 4} bytes`,
    };
  }
  if (!["sprite", "portrait", "effect"].includes(input.kind)) {
    return {
      field: "kind",
      message: "kind must be sprite, portrait or effect",
    };
  }
  if (input.mode !== "auto" && input.mode !== "report-only") {
    return { field: "mode", message: "mode must be auto or report-only" };
  }
  const cell = input.cell;
  if (!isInt(cell?.w) || cell.w < 1 || !isInt(cell.h) || cell.h < 1) {
    return { field: "cell", message: "cell must be positive integers" };
  }
  if (
    input.pivot !== undefined &&
    (!isInt(input.pivot.x) || !isInt(input.pivot.y))
  ) {
    return { field: "pivot", message: "pivot must be integer coordinates" };
  }
  if (!Array.isArray(input.paletteRgb) || input.paletteRgb.length === 0) {
    return {
      field: "paletteRgb",
      message: "the palette needs at least one colour",
    };
  }
  const badPalette = input.paletteRgb.findIndex((entry) => !isRgb(entry));
  if (badPalette >= 0) {
    return {
      field: `paletteRgb[${badPalette}]`,
      message: "a palette entry is three integers from 0 to 255",
    };
  }
  if (input.accents !== undefined) {
    if (input.kind !== "effect") {
      return {
        field: "accents",
        message: "only effects declare emissive accents",
      };
    }
    if (input.accents.length > MAX_ACCENTS) {
      return {
        field: "accents",
        message: `an effect declares at most ${MAX_ACCENTS} accents; got ${input.accents.length}`,
      };
    }
    const badAccent = input.accents.findIndex((entry) => !isRgb(entry));
    if (badAccent >= 0) {
      return {
        field: `accents[${badAccent}]`,
        message: "an accent is three integers from 0 to 255",
      };
    }
  }
  if (
    !isInt(input.alphaCutoff) ||
    input.alphaCutoff < 1 ||
    input.alphaCutoff > 255
  ) {
    return {
      field: "alphaCutoff",
      message: "alphaCutoff is an integer from 1 to 255",
    };
  }
  const grid = input.grid;
  if (!isByte(grid?.edgeTolerance)) {
    return {
      field: "grid.edgeTolerance",
      message: "edgeTolerance is an integer from 0 to 255",
    };
  }
  if (
    typeof grid.minConfidence !== "number" ||
    !(grid.minConfidence > 0 && grid.minConfidence <= 1)
  ) {
    return {
      field: "grid.minConfidence",
      message: "minConfidence is above 0 and at most 1",
    };
  }
  if (!isInt(grid.minEdges) || grid.minEdges < 1) {
    return {
      field: "grid.minEdges",
      message: "minEdges is a positive integer",
    };
  }
  if (input.background?.type === "key") {
    if (!isRgb(input.background.rgb)) {
      return {
        field: "background.rgb",
        message: "the key colour is three integers from 0 to 255",
      };
    }
    if (!isByte(input.background.tolerance)) {
      return {
        field: "background.tolerance",
        message: "the key tolerance is an integer from 0 to 255",
      };
    }
  } else if (input.background?.type !== "alpha") {
    return { field: "background", message: "background is alpha or key" };
  }
  if (input.scale !== undefined && (!isInt(input.scale) || input.scale < 1)) {
    return {
      field: "scale",
      message: "a supplied scale is a positive integer",
    };
  }
  if (input.previous !== undefined) {
    const problem = checkImage(input.previous, "previous", cell);
    if (problem) return problem;
  }
  if (input.mirror !== undefined) {
    const east = checkImage(input.mirror.east, "mirror", cell);
    if (east) return east;
    const west = checkImage(input.mirror.west, "mirror", cell);
    if (west) return west;
  }
  return undefined;
}

/** True when any channel of the two RGBA pixels differs by more than `tolerance`. */
function pixelsDiffer(
  a: Uint8Array,
  ai: number,
  b: Uint8Array,
  bi: number,
  tolerance: number,
): boolean {
  for (let c = 0; c < 4; c += 1) {
    if (Math.abs((a[ai + c] as number) - (b[bi + c] as number)) > tolerance) {
      return true;
    }
  }
  return false;
}

/** Decides the integer scale between `image` and the cell, with the edge evidence behind it. */
export function recoverGrid(
  image: RgbaImage,
  cell: { readonly w: number; readonly h: number },
  params: GridParams,
  supplied?: number,
): GridResolution {
  const { width, height } = image;
  if (width === cell.w && height === cell.h) {
    if (supplied !== undefined && supplied !== 1) {
      return invalidScale(
        `scale ${supplied} does not fit a ${width}x${height} image on a ${cell.w}x${cell.h} cell`,
      );
    }
    return {
      ok: true,
      grid: {
        scale: 1,
        source: supplied === undefined ? "dimensions" : "supplied",
        confidence: null,
        onGridEdges: 0,
        offGridEdges: 0,
        coarserThanCell: false,
      },
    };
  }

  let scale: number;
  if (supplied !== undefined) {
    if (width !== supplied * cell.w || height !== supplied * cell.h) {
      return invalidScale(
        `scale ${supplied} on a ${cell.w}x${cell.h} cell is ${supplied * cell.w}x${supplied * cell.h}, not ${width}x${height}`,
      );
    }
    scale = supplied;
  } else {
    if (width % cell.w !== 0) {
      return {
        ok: false,
        status: "invalid-input",
        field: "width",
        message: `width ${width} is not a multiple of the cell width ${cell.w}`,
      };
    }
    if (height % cell.h !== 0 || height / cell.h !== width / cell.w) {
      return {
        ok: false,
        status: "invalid-input",
        field: "height",
        message: `height ${height} is not ${width / cell.w}x the cell height ${cell.h}`,
      };
    }
    scale = width / cell.w;
  }

  const evidence = edgeEvidence(image, scale, params.edgeTolerance);
  const total = evidence.onGridEdges + evidence.offGridEdges;
  const grid: GridEvidence = {
    scale,
    source: supplied === undefined ? "detected" : "supplied",
    confidence: total === 0 ? null : evidence.onGridEdges / total,
    onGridEdges: evidence.onGridEdges,
    offGridEdges: evidence.offGridEdges,
    coarserThanCell: evidence.coarserThanCell,
  };
  if (supplied !== undefined) return { ok: true, grid };

  const reason = needsScaleReason(grid, total, params);
  if (reason !== undefined) {
    return { ok: false, status: "needs-scale", grid, message: reason };
  }
  return { ok: true, grid };
}

function invalidScale(message: string): GridResolution {
  return { ok: false, status: "invalid-input", field: "scale", message };
}

function needsScaleReason(
  grid: GridEvidence,
  total: number,
  params: GridParams,
): string | undefined {
  const ask = "supply the scale";
  if (total < params.minEdges) {
    return `only ${total} edges, fewer than ${params.minEdges}; the ${grid.scale}x grid is unproven; ${ask}`;
  }
  if (grid.onGridEdges === 0) {
    return `no edge falls on a ${grid.scale}x grid; ${ask}`;
  }
  if (grid.coarserThanCell) {
    return `edges fall only on multiples of ${2 * grid.scale}: the native grid is coarser than a ${grid.scale}x cell; ${ask}`;
  }
  if ((grid.confidence as number) < params.minConfidence) {
    return `${(grid.confidence as number).toFixed(3)} of edges fall on a ${grid.scale}x grid, below ${params.minConfidence}; ${ask}`;
  }
  return undefined;
}

/** Counts neighbour edges on and off a grid of `scale`, starting at phase 0. */
function edgeEvidence(
  image: RgbaImage,
  scale: number,
  tolerance: number,
): { onGridEdges: number; offGridEdges: number; coarserThanCell: boolean } {
  const { rgba, width, height } = image;
  const canBeCoarser = width % (2 * scale) === 0 && height % (2 * scale) === 0;
  let on = 0;
  let off = 0;
  let oddMultiple = 0;
  const count = (boundary: number) => {
    if (boundary % scale === 0) {
      on += 1;
      if (boundary % (2 * scale) !== 0) oddMultiple += 1;
    } else {
      off += 1;
    }
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const here = (y * width + x) * 4;
      if (
        x + 1 < width &&
        pixelsDiffer(rgba, here, rgba, here + 4, tolerance)
      ) {
        count(x + 1);
      }
      if (
        y + 1 < height &&
        pixelsDiffer(rgba, here, rgba, here + width * 4, tolerance)
      ) {
        count(y + 1);
      }
    }
  }
  return {
    onGridEdges: on,
    offGridEdges: off,
    coarserThanCell: canBeCoarser && on > 0 && oddMultiple === 0,
  };
}

// --- Pixel helpers ------------------------------------------------------------

/** Centre sample of every `scale` block: source pixel floor((d + 0.5) * scale). */
function sampleCentres(
  image: RgbaImage,
  scale: number,
  cell: { readonly w: number; readonly h: number },
  tolerance: number,
): { rgba: Uint8Array; blendedBlocks: number } {
  if (scale === 1)
    return { rgba: Uint8Array.from(image.rgba), blendedBlocks: 0 };
  const rgba = new Uint8Array(cell.w * cell.h * 4);
  let blendedBlocks = 0;
  for (let by = 0; by < cell.h; by += 1) {
    for (let bx = 0; bx < cell.w; bx += 1) {
      const centre =
        (Math.floor((by + 0.5) * scale) * image.width +
          Math.floor((bx + 0.5) * scale)) *
        4;
      rgba.set(image.rgba.subarray(centre, centre + 4), (by * cell.w + bx) * 4);
      let blended = false;
      for (let y = 0; y < scale && !blended; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          const at = ((by * scale + y) * image.width + bx * scale + x) * 4;
          if (pixelsDiffer(image.rgba, at, image.rgba, centre, tolerance)) {
            blended = true;
            break;
          }
        }
      }
      if (blended) blendedBlocks += 1;
    }
  }
  return { rgba, blendedBlocks };
}

/**
 * Makes the background transparent and the alpha binary. A key background is
 * flood-filled 4-connected from the border over pixels within the tolerance of
 * the key colour; alpha then snaps to 0 or 255 at the cutoff. Transparent
 * pixels are stored as 0,0,0,0.
 */
function prepareAlpha(
  rgba: Uint8Array,
  width: number,
  height: number,
  background: BackgroundSpec,
  cutoff: number,
): { rgba: Uint8Array; keyedPixels: number; alphaChanged: number } {
  const out = Uint8Array.from(rgba);
  let keyedPixels = 0;
  const keyed = new Uint8Array(width * height);
  if (background.type === "key") {
    const [kr, kg, kb] = background.rgb;
    const matches = (p: number) =>
      Math.abs((out[p * 4] as number) - kr) <= background.tolerance &&
      Math.abs((out[p * 4 + 1] as number) - kg) <= background.tolerance &&
      Math.abs((out[p * 4 + 2] as number) - kb) <= background.tolerance;
    const stack: number[] = [];
    const push = (x: number, y: number) => {
      const p = y * width + x;
      if (keyed[p] === 0 && matches(p)) {
        keyed[p] = 1;
        stack.push(p);
      }
    };
    for (let x = 0; x < width; x += 1) {
      push(x, 0);
      push(x, height - 1);
    }
    for (let y = 0; y < height; y += 1) {
      push(0, y);
      push(width - 1, y);
    }
    while (stack.length > 0) {
      const p = stack.pop() as number;
      const x = p % width;
      const y = (p - x) / width;
      if (x > 0) push(x - 1, y);
      if (x + 1 < width) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y + 1 < height) push(x, y + 1);
    }
  }
  let alphaChanged = 0;
  for (let p = 0; p < width * height; p += 1) {
    const at = p * 4;
    if (keyed[p] === 1) {
      if (out[at + 3] !== 0) keyedPixels += 1;
      out.fill(0, at, at + 4);
      continue;
    }
    const alpha = out[at + 3] as number;
    if (alpha !== 0 && alpha !== 255) alphaChanged += 1;
    if (alpha < cutoff) out.fill(0, at, at + 4);
    else out[at + 3] = 255;
  }
  return { rgba: out, keyedPixels, alphaChanged };
}

const packedRgb = (rgba: Uint8Array, at: number): number =>
  (((rgba[at] as number) << 16) |
    ((rgba[at + 1] as number) << 8) |
    (rgba[at + 2] as number)) >>>
  0;

/** Distinct opaque colours as packed RGB with their pixel counts. */
function histogram(rgba: Uint8Array): Map<number, number> {
  const counts = new Map<number, number>();
  for (let at = 0; at < rgba.length; at += 4) {
    if (rgba[at + 3] === 0) continue;
    const key = packedRgb(rgba, at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

const unpack = (packed: number): Rgb => [
  (packed >>> 16) & 255,
  (packed >>> 8) & 255,
  packed & 255,
];

const packRgb = (rgb: Rgb): number =>
  ((rgb[0] << 16) | (rgb[1] << 8) | rgb[2]) >>> 0;

const hexRgb = (packed: number): string =>
  `#${packed.toString(16).padStart(6, "0")}`;

const sqDistance = (a: Rgb, b: Rgb): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

const SPRITE_COLOURS = 16;
const PORTRAIT_COLOURS = 32;
const KMEANS_PASSES = 32;

/** Most colours a kind may keep, or null when only the palette limits it. */
function colourBudget(kind: ConformanceKind): number | null {
  if (kind === "sprite") return SPRITE_COLOURS;
  return kind === "portrait" ? PORTRAIT_COLOURS : null;
}

/**
 * Weighted k-centroid over the distinct colours. Seeds: the most frequent
 * colour, then the colour with the largest weight x squared distance to its
 * nearest seed; ties go to the lower packed colour. Fixed passes, nearest
 * centroid by squared RGB distance with ties to the lower index, centroids
 * rounded half up.
 */
function clusterColours(
  counts: ReadonlyMap<number, number>,
  k: number,
): { map: Map<number, number>; passes: number } {
  const colours = [...counts.keys()].sort((a, b) => a - b);
  const rgb = colours.map(unpack);
  const weight = colours.map((c) => counts.get(c) as number);

  const seeds: number[] = [];
  let first = 0;
  for (let i = 1; i < colours.length; i += 1) {
    if ((weight[i] as number) > (weight[first] as number)) first = i;
  }
  seeds.push(first);
  while (seeds.length < k) {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < colours.length; i += 1) {
      if (seeds.includes(i)) continue;
      let nearest = Number.POSITIVE_INFINITY;
      for (const seed of seeds) {
        nearest = Math.min(
          nearest,
          sqDistance(rgb[i] as Rgb, rgb[seed] as Rgb),
        );
      }
      const score = (weight[i] as number) * nearest;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    seeds.push(best);
  }

  let centroids: Rgb[] = seeds.map((i) => rgb[i] as Rgb);
  let assignment: number[] = [];
  let passes = 0;
  for (let pass = 0; pass < KMEANS_PASSES; pass += 1) {
    passes += 1;
    const next = rgb.map((point) => {
      let nearest = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (let c = 0; c < centroids.length; c += 1) {
        const d = sqDistance(point, centroids[c] as Rgb);
        if (d < nearestDistance) {
          nearestDistance = d;
          nearest = c;
        }
      }
      return nearest;
    });
    const stable = next.every((value, i) => value === assignment[i]);
    assignment = next;
    if (stable) break;
    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < rgb.length; i += 1) {
      const sum = sums[assignment[i] as number] as number[];
      const w = weight[i] as number;
      sum[0] = (sum[0] as number) + w * (rgb[i] as Rgb)[0];
      sum[1] = (sum[1] as number) + w * (rgb[i] as Rgb)[1];
      sum[2] = (sum[2] as number) + w * (rgb[i] as Rgb)[2];
      sum[3] = (sum[3] as number) + w;
    }
    centroids = centroids.map((old, c) => {
      const [r, g, b, w] = sums[c] as number[];
      if (w === 0) return old;
      const half = (v: number) =>
        Math.floor((2 * v + (w as number)) / (2 * (w as number)));
      return [half(r as number), half(g as number), half(b as number)] as Rgb;
    });
  }
  const map = new Map<number, number>();
  for (let i = 0; i < colours.length; i += 1) {
    map.set(
      colours[i] as number,
      packRgb(centroids[assignment[i] as number] as Rgb),
    );
  }
  return { map, passes };
}

/** Nearest colour of `palette` by squared RGB distance; ties go to the lower index. */
function nearestInPalette(colour: number, palette: readonly Rgb[]): number {
  const point = unpack(colour);
  let best = palette[0] as Rgb;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of palette) {
    const d = sqDistance(point, entry);
    if (d < bestDistance) {
      bestDistance = d;
      best = entry;
    }
  }
  return packRgb(best);
}

/** Maps every distinct opaque colour to a palette colour: clustering first when over budget. */
function reduceToPalette(
  counts: ReadonlyMap<number, number>,
  budget: number | null,
  palette: readonly Rgb[],
): { map: Map<number, number>; iterations: number } {
  let working = new Map<number, number>([...counts.keys()].map((c) => [c, c]));
  let iterations = 0;
  if (budget !== null && counts.size > budget) {
    const clustered = clusterColours(counts, budget);
    working = clustered.map;
    iterations = clustered.passes;
  }
  const map = new Map<number, number>();
  for (const [original, centre] of working) {
    map.set(original, nearestInPalette(centre, palette));
  }
  return { map, iterations };
}

/** Pixel with transparency stored as zeros, for comparing images. */
const canonicalAt = (rgba: Uint8Array, at: number): string =>
  rgba[at + 3] === 0
    ? "00000000"
    : [0, 1, 2, 3]
        .map((c) => (rgba[at + c] as number).toString(16).padStart(2, "0"))
        .join("");

// --- Checks -------------------------------------------------------------------

type Check = { check: string; status: "pass" | "fail"; message: string };

const verdict = (
  check: string,
  pass: boolean,
  ok: string,
  bad: string,
): Check => ({
  check,
  status: pass ? "pass" : "fail",
  message: pass ? ok : bad,
});

const at = (x: number, y: number) => `${x},${y}`;
const MAX_LISTED = 8;
const listed = (items: readonly string[]) =>
  items.length > MAX_LISTED
    ? `${items.slice(0, MAX_LISTED).join(" ")} and ${items.length - MAX_LISTED} more`
    : items.join(" ");

/** Distinct opaque colours of an image as packed RGB. */
function opaqueColours(image: RgbaImage): Map<number, number> {
  return histogram(image.rgba);
}

/** Connected parts of the non-transparent pixels, 8-connected, in scan order of their first pixel. */
function shapeParts(
  image: RgbaImage,
): { size: number; x: number; y: number }[] {
  const { rgba, width, height } = image;
  const seen = new Uint8Array(width * height);
  const parts: { size: number; x: number; y: number }[] = [];
  for (let start = 0; start < width * height; start += 1) {
    if (seen[start] === 1 || rgba[start * 4 + 3] === 0) continue;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop() as number;
      size += 1;
      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (seen[n] === 1 || rgba[n * 4 + 3] === 0) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    parts.push({ size, x: start % width, y: Math.floor(start / width) });
  }
  return parts;
}

function buildChecks(
  input: ConformanceInput,
  grid: GridEvidence,
  blendedBlocks: number,
  evaluated: RgbaImage,
): Check[] {
  const { cell, kind } = input;
  const palette = [...input.paletteRgb, ...(input.accents ?? [])];
  const paletteSet = new Set(palette.map(packRgb));
  const checks: Check[] = [];

  const gridOk = input.mode === "auto" || blendedBlocks === 0;
  const evidence =
    grid.scale === 1 && grid.source !== "supplied"
      ? `size matches the ${cell.w}x${cell.h} cell`
      : `scale ${grid.scale}x ${grid.source}${grid.confidence === null ? "" : `, confidence ${grid.confidence.toFixed(3)}`}, ${blendedBlocks} blended blocks`;
  checks.push(
    verdict(
      "grid",
      gridOk,
      evidence,
      `${blendedBlocks} blocks blend colours; ${evidence}`,
    ),
  );

  const sized = evaluated.width === cell.w && evaluated.height === cell.h;
  checks.push(
    verdict(
      "canvas",
      sized,
      `${evaluated.width}x${evaluated.height} is the ${cell.w}x${cell.h} cell`,
      `${evaluated.width}x${evaluated.height} is not the ${cell.w}x${cell.h} cell`,
    ),
  );

  let fractional = 0;
  let firstFractional = "";
  for (let p = 0; p < evaluated.width * evaluated.height; p += 1) {
    const alpha = evaluated.rgba[p * 4 + 3] as number;
    if (alpha !== 0 && alpha !== 255) {
      if (fractional === 0) {
        firstFractional = at(
          p % evaluated.width,
          Math.floor(p / evaluated.width),
        );
      }
      fractional += 1;
    }
  }
  checks.push(
    verdict(
      "binary-alpha",
      fractional === 0,
      "alpha is 0 or 255",
      `${fractional} pixels have fractional alpha, first at ${firstFractional}`,
    ),
  );

  const colours = opaqueColours(evaluated);
  const outside = [...colours.keys()]
    .filter((c) => !paletteSet.has(c))
    .sort((a, b) => a - b);
  const scope =
    kind === "effect"
      ? "palette entries or declared accents"
      : "palette entries";
  checks.push(
    verdict(
      "palette",
      outside.length === 0,
      `every opaque colour is one of the ${scope}`,
      `${outside.length} colours are not ${scope}: ${listed(outside.map(hexRgb))}`,
    ),
  );

  const budget = colourBudget(kind);
  if (budget !== null) {
    checks.push(
      verdict(
        "colour-count",
        colours.size <= budget,
        `${colours.size} colours; ${kind} limit ${budget}`,
        `${colours.size} colours; ${kind} limit ${budget}`,
      ),
    );
  }

  if (kind === "sprite") {
    const extremes = [0x000000, 0xffffff].filter((c) => colours.has(c));
    checks.push(
      verdict(
        "pure-black-white",
        extremes.length === 0,
        "no pure black or white",
        extremes
          .map((c) => `pure ${hexRgb(c)} used by ${colours.get(c)} pixels`)
          .join("; "),
      ),
    );
  }

  if (input.pivot !== undefined) {
    const { x, y } = input.pivot;
    const inside = x >= 0 && y >= 0 && x <= cell.w && y <= cell.h;
    checks.push(
      verdict(
        "pivot",
        inside,
        `pivot ${at(x, y)} is inside the ${cell.w}x${cell.h} cell`,
        `pivot ${at(x, y)} is outside the ${cell.w}x${cell.h} cell`,
      ),
    );
  }

  if (kind === "sprite") {
    const parts = shapeParts(evaluated);
    const strays = parts
      .filter((part) => part.size === 1)
      .map((part) => at(part.x, part.y));
    if (parts.length === 0) {
      checks.push(verdict("silhouette", false, "", "no opaque pixels"));
    } else {
      checks.push(
        verdict(
          "silhouette",
          parts.length === 1,
          "one connected shape",
          `${parts.length} connected parts${strays.length > 0 ? `; single-pixel strays at ${listed(strays)}` : ""}`,
        ),
      );
    }
  }

  if (input.mirror !== undefined) {
    const { east, west, asymmetry } = input.mirror;
    if (asymmetry) {
      checks.push(
        verdict(
          "mirror",
          true,
          "asymmetry declared; east and west not compared",
          "",
        ),
      );
    } else {
      const bad: string[] = [];
      for (let y = 0; y < west.height; y += 1) {
        for (let x = 0; x < west.width; x += 1) {
          const w = canonicalAt(west.rgba, (y * west.width + x) * 4);
          const e = canonicalAt(
            east.rgba,
            (y * east.width + (east.width - 1 - x)) * 4,
          );
          if (w !== e) bad.push(at(x, y));
        }
      }
      checks.push(
        verdict(
          "mirror",
          bad.length === 0,
          "west is east flipped",
          `${bad.length} pixels differ from the flipped east frame, first at ${bad[0]}`,
        ),
      );
    }
  }

  if (kind === "effect") {
    const n = input.accents?.length ?? 0;
    checks.push(
      verdict(
        "accents",
        n <= MAX_ACCENTS,
        `${n} declared accent${n === 1 ? "" : "s"} of ${MAX_ACCENTS} allowed`,
        `${n} accents declared; ${MAX_ACCENTS} allowed`,
      ),
    );
  }
  return checks;
}

/** Row-major pixels that differ between two same-size RGBA buffers, transparency compared as zeros. */
function diffPixels(
  before: Uint8Array,
  after: Uint8Array,
  width: number,
): PixelDiff[] {
  const out: PixelDiff[] = [];
  for (let at = 0; at < before.length; at += 4) {
    const b = canonicalAt(before, at);
    const a = canonicalAt(after, at);
    if (b === a) continue;
    const p = at / 4;
    out.push({
      x: p % width,
      y: Math.floor(p / width),
      before: `#${b}`,
      after: `#${a}`,
    });
  }
  return out;
}

export function conformImage(input: ConformanceInput): ConformanceResult {
  const problem = validate(input);
  if (problem) return { status: "invalid-input", ...problem };
  const resolved = recoverGrid(input, input.cell, input.grid, input.scale);
  if (!resolved.ok) {
    return resolved.status === "needs-scale"
      ? {
          status: "needs-scale",
          grid: resolved.grid,
          message: resolved.message,
        }
      : {
          status: "invalid-input",
          field: resolved.field,
          message: resolved.message,
        };
  }
  const { grid } = resolved;
  const { cell } = input;

  const sampled = sampleCentres(
    input,
    grid.scale,
    cell,
    input.grid.edgeTolerance,
  );
  const prepared = prepareAlpha(
    sampled.rgba,
    cell.w,
    cell.h,
    input.background,
    input.alphaCutoff,
  );
  const counts = histogram(prepared.rgba);
  const palette = [...input.paletteRgb, ...(input.accents ?? [])];
  const reduction = reduceToPalette(counts, colourBudget(input.kind), palette);
  const final = Uint8Array.from(prepared.rgba);
  for (let at = 0; at < final.length; at += 4) {
    if (final[at + 3] === 0) continue;
    const mapped = unpack(reduction.map.get(packedRgb(final, at)) as number);
    final.set(mapped, at);
  }
  const colourMap: ColourMapEntry[] = [];
  let pixelsRecoloured = 0;
  for (const [from, to] of reduction.map) {
    if (from === to) continue;
    const pixels = counts.get(from) as number;
    pixelsRecoloured += pixels;
    colourMap.push({ from: hexRgb(from), to: hexRgb(to), pixels });
  }
  colourMap.sort((a, b) => b.pixels - a.pixels || (a.from < b.from ? -1 : 1));
  const coloursAfter = new Set(reduction.map.values()).size;
  const image: RgbaImage = { rgba: final, width: cell.w, height: cell.h };
  const diff = diffPixels(sampled.rgba, final, cell.w);
  const editDiff =
    input.previous === undefined
      ? null
      : diffPixels(input.previous.rgba, sampled.rgba, cell.w);
  const evaluated: RgbaImage =
    input.mode === "auto"
      ? image
      : {
          rgba: Uint8Array.from(input.rgba),
          width: input.width,
          height: input.height,
        };
  const checks = buildChecks(input, grid, sampled.blendedBlocks, evaluated);

  return {
    status: "done",
    mode: input.mode,
    image: evaluated,
    proposal: image,
    report: {
      schemaVersion: 1,
      status: checks.every((c) => c.status === "pass") ? "pass" : "fail",
      checks: checks.map(({ check, status, message }) => ({
        check,
        status,
        ...(message === "" ? {} : { message }),
      })),
    },
    metrics: {
      resize: {
        from: { w: input.width, h: input.height },
        to: { w: cell.w, h: cell.h },
        factor: grid.scale,
        detected: grid.source === "detected",
        supplied: grid.source === "supplied",
      },
      grid,
      blendedBlocks: sampled.blendedBlocks,
      keyedPixels: prepared.keyedPixels,
      alphaChanged: prepared.alphaChanged,
      coloursBefore: counts.size,
      coloursAfter,
      coloursMerged: counts.size - coloursAfter,
      iterations: reduction.iterations,
      colourMap,
      pixelsRecoloured,
      pixelsChanged: diff.length,
    },
    diff,
    editDiff,
  };
}

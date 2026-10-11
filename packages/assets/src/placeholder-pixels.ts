// Pure placeholder pixel generation: a deterministic RGBA silhouette composed
// from a palette and named body/head/prop parts. No platform imports, so the
// webview and the studio draw the same pixels. PNG encoding and the content
// hash live in ./placeholder (Node and Bun only).
//
// Determinism contract: the same `{ palette, parts }` input always produces
// identical pixels. Never throws: an unknown part name falls back to that
// slot's default silhouette.

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

/** Straight-alpha RGBA pixels, row-major, 4 bytes per pixel, no padding. */
export interface PlaceholderPixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
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

/**
 * Composes the placeholder silhouette as raw RGBA. A fresh buffer is returned
 * on every call.
 */
export function renderPlaceholderPixels(
  input: PlaceholderInput,
): PlaceholderPixels {
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

  const rgba = new Uint8Array(SIZE * SIZE * CHANNELS);
  paintLayer(rgba, bodyShape, pickColor(input.palette, "body"));
  paintLayer(rgba, headShape, pickColor(input.palette, "head"));
  paintLayer(rgba, propShape, pickColor(input.palette, "prop"));
  return { width: SIZE, height: SIZE, rgba };
}

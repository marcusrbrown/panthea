// The effect generator: a pure, seeded function from a recipe and a palette to
// frames. Same recipe and palette give the same bytes. Bump
// `EFFECT_GENERATOR.version` whenever a change here alters any pixel for the
// same recipe, because a published effect records the version it was made under
// and publish runs the generator again to compare.

import type { CanonicalJson, Sha256 } from "@panthea/contracts";
import type { Rgb } from "../conformance";
import { sha256Hex } from "../hash";
import type { Palette } from "../palette";
import { encodeRgbaPng } from "../placeholder";
import {
  FIRE_FAMILY,
  type FireParams,
  fireColours,
  renderFireFrame,
} from "./fire";
import {
  CALM_FRAMES,
  FULL_FRAMES,
  LIGHTNING_FAMILY,
  LIGHTNING_GLOW,
  type LightningParams,
  lightningColours,
  renderLightning,
} from "./lightning";

export { renderFireFrame } from "./fire";

export const EFFECT_GENERATOR = { id: "panthea-effects", version: 1 } as const;

export const EFFECT_NAMES = ["fire", "lightning"] as const;
export type EffectName = (typeof EFFECT_NAMES)[number];

export type EffectRecipe =
  | {
      readonly effect: "fire";
      readonly seed: number;
      readonly params: FireParams;
    }
  | {
      readonly effect: "lightning";
      readonly seed: number;
      readonly params: LightningParams;
    };

export interface GeneratedFrame {
  /** RGBA with the colour under alpha 0 zeroed. */
  readonly rgba: Uint8Array;
  /** The frame as `encodeRgbaPng` writes it. */
  readonly png: Uint8Array;
  /** SHA-256 of `png`. */
  readonly hash: Sha256;
  readonly durationMs: number;
}

export interface GeneratedAnimation {
  readonly name: string;
  readonly frames: readonly GeneratedFrame[];
}

export interface GeneratedEffect {
  readonly effect: EffectName;
  readonly cell: { readonly w: number; readonly h: number };
  /** Where the effect attaches in the world: the base of the fire, the strike's target. */
  readonly pivot: { readonly x: number; readonly y: number };
  /** The palette family the effect draws its palette colours from. */
  readonly paletteFamily: string;
  /** Colours outside the palette that the effect draws. */
  readonly glowColours: readonly Rgb[];
  readonly animations: readonly GeneratedAnimation[];
}

export type Generation =
  | { readonly ok: true; readonly effect: GeneratedEffect }
  | { readonly ok: false; readonly message: string };

// --- Recipes -------------------------------------------------------------------

/** The starting parameters; every number is tuned at the visual gate. */
export function defaultRecipe(effect: EffectName, seed: number): EffectRecipe {
  return effect === "fire"
    ? {
        effect,
        seed,
        params: { width: 48, height: 64, frames: 8, frameMs: 110, tongues: 3 },
      }
    : {
        effect,
        seed,
        params: {
          width: 64,
          height: 128,
          targetX: 32,
          targetY: 116,
          depth: 5,
          fullMs: [110, 90, 70, 90, 90, 100, 100, 100],
          calmMs: [150, 130, 130, 130],
        },
      };
}

/** The recipe's parameters as the JSON a provenance record stores: integers, strings and arrays of integers. */
export function recipeParams(recipe: EffectRecipe): {
  [key: string]: CanonicalJson;
} {
  return { effect: recipe.effect, ...recipe.params };
}

export type RecipeParse =
  | { readonly ok: true; readonly recipe: EffectRecipe }
  | { readonly ok: false; readonly message: string };

type Bounds = readonly [min: number, max: number];

const FIRE_BOUNDS = {
  width: [16, 128],
  height: [16, 192],
  frames: [4, 16],
  frameMs: [20, 500],
  tongues: [2, 3],
} as const satisfies Record<keyof FireParams, Bounds>;

const FRAME_MS: Bounds = [20, 500];

const isInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v);

function integer(
  record: Record<string, unknown>,
  key: string,
  [min, max]: Bounds,
): number | string {
  const v = record[key];
  return isInt(v) && v >= min && v <= max
    ? v
    : `${key} is an integer from ${min} to ${max}`;
}

function durations(
  record: Record<string, unknown>,
  key: string,
  length: number,
): number[] | string {
  const v = record[key];
  return Array.isArray(v) &&
    v.length === length &&
    v.every((n) => isInt(n) && n >= FRAME_MS[0] && n <= FRAME_MS[1])
    ? (v as number[])
    : `${key} is ${length} durations, each an integer from ${FRAME_MS[0]} to ${FRAME_MS[1]} ms`;
}

/** Parses a recipe's seed and stored parameters; the parameters must carry exactly the keys of their effect. */
export function parseEffectRecipe(seed: unknown, json: unknown): RecipeParse {
  const bad = (message: string): RecipeParse => ({ ok: false, message });
  if (!isInt(seed) || seed < 0 || seed > 0xffffffff)
    return bad("seed is an integer from 0 to 4294967295");
  if (typeof json !== "object" || json === null || Array.isArray(json))
    return bad("params must be an object");
  const record = json as Record<string, unknown>;
  const effect = record.effect;
  if (effect !== "fire" && effect !== "lightning")
    return bad(`effect is one of ${EFFECT_NAMES.join(", ")}`);
  const allowed =
    effect === "fire"
      ? ["effect", ...Object.keys(FIRE_BOUNDS)]
      : [
          "effect",
          "width",
          "height",
          "targetX",
          "targetY",
          "depth",
          "fullMs",
          "calmMs",
        ];
  const extra = Object.keys(record).find((k) => !allowed.includes(k));
  if (extra !== undefined) return bad(`unknown parameter "${extra}"`);

  if (effect === "fire") {
    const params: Record<string, number> = {};
    for (const key of Object.keys(FIRE_BOUNDS) as (keyof FireParams)[]) {
      const v = integer(record, key, FIRE_BOUNDS[key]);
      if (typeof v === "string") return bad(v);
      params[key] = v;
    }
    return {
      ok: true,
      recipe: { effect, seed, params: params as unknown as FireParams },
    };
  }
  const width = integer(record, "width", [32, 160]);
  if (typeof width === "string") return bad(width);
  const height = integer(record, "height", [64, 256]);
  if (typeof height === "string") return bad(height);
  const targetX = integer(record, "targetX", [4, width - 4]);
  if (typeof targetX === "string") return bad(targetX);
  const targetY = integer(record, "targetY", [16, height - 2]);
  if (typeof targetY === "string") return bad(targetY);
  const depth = integer(record, "depth", [3, 7]);
  if (typeof depth === "string") return bad(depth);
  const fullMs = durations(record, "fullMs", FULL_FRAMES);
  if (typeof fullMs === "string") return bad(fullMs);
  const calmMs = durations(record, "calmMs", CALM_FRAMES);
  if (typeof calmMs === "string") return bad(calmMs);
  return {
    ok: true,
    recipe: {
      effect,
      seed,
      params: { width, height, targetX, targetY, depth, fullMs, calmMs },
    },
  };
}

// --- Generation ------------------------------------------------------------------

function framed(
  rgbas: readonly Uint8Array[],
  ms: readonly number[],
  w: number,
  h: number,
): GeneratedFrame[] {
  return rgbas.map((rgba, i) => {
    const png = encodeRgbaPng(rgba, w, h);
    return {
      rgba,
      png,
      hash: sha256Hex(png),
      durationMs: ms[i] as number,
    };
  });
}

export function generateEffect(
  recipe: EffectRecipe,
  palette: Palette,
): Generation {
  if (recipe.effect === "fire") {
    const colours = fireColours(palette);
    if (!colours.ok) return colours;
    const p = recipe.params;
    const rgbas = Array.from({ length: p.frames }, (_, f) =>
      renderFireFrame(recipe.seed, p, f / p.frames, palette),
    );
    return {
      ok: true,
      effect: {
        effect: "fire",
        cell: { w: p.width, h: p.height },
        pivot: { x: p.width / 2, y: p.height },
        paletteFamily: FIRE_FAMILY,
        glowColours: [],
        animations: [
          {
            name: "burn",
            frames: framed(
              rgbas,
              Array.from({ length: p.frames }, () => p.frameMs),
              p.width,
              p.height,
            ),
          },
        ],
      },
    };
  }
  const colours = lightningColours(palette);
  if (!colours.ok) return colours;
  const p = recipe.params;
  const version = (name: "full" | "calm", ms: readonly number[]) => ({
    name,
    frames: framed(
      renderLightning(recipe.seed, p, name, palette),
      ms,
      p.width,
      p.height,
    ),
  });
  return {
    ok: true,
    effect: {
      effect: "lightning",
      cell: { w: p.width, h: p.height },
      pivot: { x: p.targetX, y: p.targetY },
      paletteFamily: LIGHTNING_FAMILY,
      glowColours: Object.values(LIGHTNING_GLOW),
      animations: [version("full", p.fullMs), version("calm", p.calmMs)],
    },
  };
}

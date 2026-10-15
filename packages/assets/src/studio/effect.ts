// A generated effect as the studio holds it: built from a recipe into a
// manifest, an atlas and a report-only conformance report, and audited at
// publish by running the generator again. Pure over its inputs.

import {
  type AssetManifest,
  type AssetVocabulary,
  type CanonicalJson,
  type ConformanceReport,
  canonicalManifestText,
  type LicenceRecord,
  parseAssetManifest,
} from "@panthea/contracts";
import { conformImage, type Rgb } from "../conformance";
import {
  defaultRecipe,
  EFFECT_GENERATOR,
  EFFECT_NAMES,
  type EffectName,
  type EffectRecipe,
  type GeneratedEffect,
  generateEffect,
  parseEffectRecipe,
  type RecipeParse,
  recipeParams,
} from "../effects/generate";
import { sha256Hex } from "../hash";
import { type Palette, type PaletteSet, paletteDigest } from "../palette";
import { encodeRgbaPng } from "../placeholder";
import { DEFAULT_CONFORM } from "./derivation";

/** What the effect op takes. Parameters override the effect's starting parameters. */
export interface EffectInput {
  /** The studio's own id for the draft record. */
  readonly id: string;
  readonly assetId: string;
  readonly effect: EffectName;
  readonly seed: number;
  readonly palette: string;
  readonly styleTag: string;
  /** Overrides over the starting parameters, in the stored form (integers and arrays of integers). */
  readonly params?: { readonly [key: string]: CanonicalJson };
}

export interface BuiltEffect {
  readonly manifest: AssetManifest;
  readonly atlas: Uint8Array;
  readonly report: ConformanceReport;
}

export type EffectBuild =
  | { readonly ok: true; readonly value: BuiltEffect }
  | { readonly ok: false; readonly message: string };

const hex = (rgb: Rgb): string =>
  `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

function familyColours(palette: Palette, family: string): Rgb[] {
  const seen = new Set<string>();
  const colours: Rgb[] = [];
  for (const ramp of palette.families.find((f) => f.id === family)?.ramps ?? [])
    for (const shade of ramp.shades) {
      const key = shade.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      colours.push(shade);
    }
  return colours;
}

/** One row of cells: every frame of every animation, in animation order. */
function atlasOf(effect: GeneratedEffect): {
  png: Uint8Array;
  width: number;
} {
  const { w, h } = effect.cell;
  const frames = effect.animations.flatMap((a) => a.frames);
  const width = frames.length * w;
  const rgba = new Uint8Array(width * h * 4);
  for (const [index, frame] of frames.entries())
    for (let row = 0; row < h; row += 1)
      rgba.set(
        frame.rgba.subarray(row * w * 4, (row + 1) * w * 4),
        (row * width + index * w) * 4,
      );
  return { png: encodeRgbaPng(rgba, width, h), width };
}

/** Builds the effect a recipe makes under a palette. */
export function buildEffect(args: {
  readonly recipe: EffectRecipe;
  readonly palette: Palette;
  readonly assetId: string;
  readonly styleTag: string;
  readonly licences: readonly LicenceRecord[];
  readonly vocabulary: AssetVocabulary;
}): EffectBuild {
  const { recipe, palette, vocabulary } = args;
  const generated = generateEffect(recipe, palette);
  if (!generated.ok) return generated;
  const effect = generated.effect;
  const { w, h } = effect.cell;
  const atlas = atlasOf(effect);

  const checks: { check: string; status: "pass" | "fail"; message?: string }[] =
    [];
  const colours = familyColours(palette, effect.paletteFamily);
  for (const animation of effect.animations)
    for (const [index, frame] of animation.frames.entries()) {
      const result = conformImage({
        rgba: frame.rgba,
        width: w,
        height: h,
        kind: "effect",
        mode: "report-only",
        cell: effect.cell,
        pivot: effect.pivot,
        paletteRgb: colours,
        glow: effect.glowColours,
        background: DEFAULT_CONFORM.background,
        alphaCutoff: DEFAULT_CONFORM.alphaCutoff,
        grid: DEFAULT_CONFORM.grid,
        scale: 1,
      });
      if (result.status !== "done")
        return {
          ok: false,
          message: `${animation.name}#${index} cannot be reported on: ${result.status === "invalid-input" ? `${result.field}: ${result.message}` : result.message}`,
        };
      for (const check of result.report.checks)
        checks.push({
          check: `${animation.name}#${index}:${check.check}`,
          status: check.status,
          ...(check.message === undefined ? {} : { message: check.message }),
        });
    }
  if (palette.approval.status !== "approved")
    checks.push({
      check: "palette-approval",
      status: "fail",
      message: `palette "${palette.id}" is a draft: this drafts, but only an approved palette's assets approve and publish`,
    });

  let cursor = 0;
  const json = {
    schemaVersion: 1,
    kind: "effect",
    id: args.assetId,
    cell: { w, h },
    pixelScale: 1,
    paletteFamily: effect.paletteFamily,
    paletteId: palette.id,
    styleTag: args.styleTag,
    atlas: { blob: sha256Hex(atlas.png), width: atlas.width, height: h },
    pivot: effect.pivot,
    footprint: { w: 1, h: 1 },
    glowColours: effect.glowColours.map(hex),
    animations: effect.animations.map((animation) => ({
      name: animation.name,
      frames: animation.frames.map((frame) => {
        const rect = { x: cursor * w, y: 0, w, h };
        cursor += 1;
        return { rect, durationMs: frame.durationMs };
      }),
    })),
    provenance: {
      method: "procedural",
      generator: EFFECT_GENERATOR,
      seed: recipe.seed,
      params: recipeParams(recipe),
      palette: { id: palette.id, digest: paletteDigest(palette) },
      frameHashes: Object.fromEntries(
        effect.animations.map((a) => [a.name, a.frames.map((f) => f.hash)]),
      ),
      licences: args.licences,
      relatedJobs: [],
      handEdits: [],
      sourceAssets: [],
    },
  };
  const manifest = parseAssetManifest(json, vocabulary);
  if (!manifest.ok)
    return {
      ok: false,
      message: `the effect manifest is not valid: ${manifest.path}: ${manifest.message}`,
    };
  return {
    ok: true,
    value: {
      manifest: manifest.value,
      atlas: atlas.png,
      report: {
        schemaVersion: 1,
        status: checks.some((c) => c.status === "fail") ? "fail" : "pass",
        checks,
      },
    },
  };
}

/** The recipe an effect input names: the starting parameters under its overrides. */
export function recipeOf(
  input: Pick<EffectInput, "effect" | "seed" | "params">,
): RecipeParse {
  if (!(EFFECT_NAMES as readonly string[]).includes(input.effect))
    return {
      ok: false,
      message: `effect is one of ${EFFECT_NAMES.join(", ")}`,
    };
  return parseEffectRecipe(input.seed, {
    ...recipeParams(defaultRecipe(input.effect, 0)),
    ...(input.params ?? {}),
    effect: input.effect,
  });
}

/**
 * Runs the generator again from what a procedural manifest records and
 * compares: the generator and palette are the ones it was made under, every
 * recorded frame hash is the recipe's, and the atlas and manifest are the
 * bytes the recipe makes. Returns the first mismatch, or undefined when all agree.
 */
export function auditEffect(args: {
  readonly manifest: AssetManifest;
  readonly atlas: Uint8Array;
  readonly palettes: PaletteSet;
  readonly vocabulary: AssetVocabulary;
}): string | undefined {
  const { manifest } = args;
  const recorded = manifest.provenance;
  if (manifest.kind !== "effect" || recorded.method !== "procedural")
    return "the manifest is not a procedural effect";
  if (
    recorded.generator.id !== EFFECT_GENERATOR.id ||
    recorded.generator.version !== EFFECT_GENERATOR.version
  )
    return `the effect was made by generator ${recorded.generator.id}@${recorded.generator.version}, this studio runs ${EFFECT_GENERATOR.id}@${EFFECT_GENERATOR.version}: generate it again`;
  const palette = args.palettes.get(recorded.palette.id);
  if (palette === undefined || recorded.palette.id !== manifest.paletteId)
    return `the palette "${recorded.palette.id}" the effect was generated under is not the manifest's palette on disk`;
  if (paletteDigest(palette) !== recorded.palette.digest)
    return `the palette "${palette.id}" changed since the effect was generated`;
  const parsed = parseEffectRecipe(recorded.seed, recorded.params);
  if (!parsed.ok) return `the recorded recipe is not valid: ${parsed.message}`;
  const generated = generateEffect(parsed.recipe, palette);
  if (!generated.ok) return generated.message;
  for (const animation of generated.effect.animations)
    for (const [index, frame] of animation.frames.entries())
      if (recorded.frameHashes[animation.name]?.[index] !== frame.hash)
        return `animation "${animation.name}" frame ${index} is not what the recorded recipe generates`;
  const rebuilt = buildEffect({
    recipe: parsed.recipe,
    palette,
    assetId: manifest.id,
    styleTag: manifest.styleTag,
    licences: recorded.licences,
    vocabulary: args.vocabulary,
  });
  if (!rebuilt.ok) return rebuilt.message;
  if (
    rebuilt.value.atlas.length !== args.atlas.length ||
    rebuilt.value.atlas.some((v, i) => v !== args.atlas[i])
  )
    return "the atlas is not the bytes the recorded recipe generates";
  if (
    canonicalManifestText(rebuilt.value.manifest) !==
    canonicalManifestText(manifest)
  )
    return "the manifest is not the one the recorded recipe makes";
  return undefined;
}

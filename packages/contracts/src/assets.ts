// Asset contracts: stable ids, logical URIs, the versioned vocabulary, strict
// kind-discriminated manifests and provenance. Pure: no filesystem, no
// hashing, no platform imports.
//
// Parsers return the shared ParseResult. Every asset record is strict: an
// unknown key is a failure, so a typo or a smuggled field never survives a
// parse. States, directions, expressions, palette families and cells are
// versioned content data (AssetVocabulary), not closed TypeScript unions.

import { canonicalJson } from "./canonical";
import {
  type Brand,
  fail,
  isRecord,
  ok,
  type ParseFailure,
  type ParseResult,
  parseArray,
  parseEnum,
  parseSchemaVersion,
  parseString,
} from "./ids";

export const ASSET_SCHEMA_VERSIONS = [1] as const;

export type AssetId = Brand<string, "AssetId">;
export type Sha256 = Brand<string, "Sha256">;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function parseAssetId(
  value: unknown,
  path: string,
): ParseResult<AssetId> {
  if (typeof value !== "string" || !SLUG.test(value)) {
    return fail(path, "expected a lowercase hyphenated id");
  }
  return ok(value as AssetId);
}

export function parseSha256(value: unknown, path: string): ParseResult<Sha256> {
  if (typeof value !== "string" || !SHA256.test(value)) {
    return fail(path, "expected a lowercase 64-character hex sha256");
  }
  return ok(value as Sha256);
}

// --- Logical URIs ------------------------------------------------------------
// panthea-asset:// is a logical identifier resolved through the registry. It
// is not a webview protocol and never collides with Tauri's asset: scheme.

export const ASSET_URI_SCHEME = "panthea-asset";

export type AssetUri =
  | { readonly kind: "asset"; readonly id: AssetId }
  | { readonly kind: "placeholder"; readonly sha256: Sha256 };

export function assetUri(id: AssetId): string {
  return `${ASSET_URI_SCHEME}://asset/${id}`;
}

export function placeholderUri(sha256: Sha256): string {
  return `${ASSET_URI_SCHEME}://placeholder/${sha256}`;
}

export function parseAssetUri(
  value: unknown,
  path: string,
): ParseResult<AssetUri> {
  const match =
    typeof value === "string"
      ? new RegExp(`^${ASSET_URI_SCHEME}://(asset|placeholder)/([^/]+)$`).exec(
          value,
        )
      : null;
  if (match === null) {
    return fail(
      path,
      `expected a ${ASSET_URI_SCHEME}:// asset or placeholder URI`,
    );
  }
  if (match[1] === "asset") {
    const id = parseAssetId(match[2], path);
    return id.ok ? ok({ kind: "asset", id: id.value }) : id;
  }
  const sha256 = parseSha256(match[2], path);
  return sha256.ok ? ok({ kind: "placeholder", sha256: sha256.value }) : sha256;
}

// --- Strict-record helpers (shared by the asset modules) ----------------------

export function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): ParseFailure | undefined {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      return fail(`${path}.${key}`, `unknown key "${key}"`);
    }
  }
  return undefined;
}

export function parsePositiveInteger(
  value: unknown,
  path: string,
): ParseResult<number> {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return fail(path, "expected a positive integer");
  }
  return ok(value);
}

export function parseIntegerAtLeast(
  value: unknown,
  path: string,
  min: number,
): ParseResult<number> {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    return fail(path, `expected an integer >= ${min}`);
  }
  return ok(value);
}

export function parseSlug(value: unknown, path: string): ParseResult<string> {
  if (typeof value !== "string" || !SLUG.test(value)) {
    return fail(path, "expected a lowercase hyphenated name");
  }
  return ok(value);
}

export function parseUniqueSlugs(
  value: unknown,
  path: string,
): ParseResult<readonly string[]> {
  const items = parseArray(value, path, parseSlug);
  if (!items.ok) return items;
  if (items.value.length === 0)
    return fail(path, "expected at least one entry");
  const seen = new Set<string>();
  for (const [index, item] of items.value.entries()) {
    if (seen.has(item)) return fail(`${path}[${index}]`, `duplicate "${item}"`);
    seen.add(item);
  }
  return items;
}

/** Runs `parse` on a strict record, rejecting keys outside `keys`. */
export function parseStrictRecord<T>(
  value: unknown,
  path: string,
  keys: readonly string[],
  parse: (record: Record<string, unknown>) => ParseResult<T>,
): ParseResult<T> {
  if (!isRecord(value)) return fail(path, "expected an object");
  return rejectUnknownKeys(value, keys, path) ?? parse(value);
}

// --- Vocabulary ----------------------------------------------------------------

export interface Range {
  readonly min: number;
  readonly max: number;
}

export const VOCABULARY_KINDS = ["sprite", "portrait", "effect"] as const;
export type VocabularyKind = (typeof VOCABULARY_KINDS)[number];

export interface CellClass {
  readonly id: string;
  readonly w: number;
  readonly h: number;
  readonly kinds: readonly VocabularyKind[];
}

/**
 * One rule for a state. A state id may carry several rules, each naming the
 * cell classes it applies to; a rule that names none applies to every class
 * and so is the only rule its state may have. Look rules up with `stateRuleFor`.
 */
export interface StateRule {
  readonly id: string;
  readonly frames: Range;
  /** Absent when the guide gives no frame rate for the state. */
  readonly fps?: Range;
  /** Cell classes the state is allowed on; absent means any. */
  readonly cellClasses?: readonly string[];
  /** True when each animation of the state is bound to one declared ability. */
  readonly perAbility: boolean;
}

export interface AssetVocabulary {
  readonly schemaVersion: number;
  /** Version of the data itself, bumped when the states or families change. */
  readonly version: number;
  readonly directions: readonly string[];
  readonly expressions: readonly string[];
  readonly paletteFamilies: readonly string[];
  readonly tiers: Range;
  readonly cells: readonly CellClass[];
  readonly states: readonly StateRule[];
  readonly effect: {
    readonly maxEmissiveAccents: number;
    readonly tierOneMaxMs: number;
  };
}

function parseRange(value: unknown, path: string): ParseResult<Range> {
  return parseStrictRecord(value, path, ["min", "max"], (record) => {
    const min = parsePositiveInteger(record.min, `${path}.min`);
    if (!min.ok) return min;
    const max = parsePositiveInteger(record.max, `${path}.max`);
    if (!max.ok) return max;
    if (min.value > max.value) return fail(path, "expected min <= max");
    return ok({ min: min.value, max: max.value });
  });
}

function parseCellClass(value: unknown, path: string): ParseResult<CellClass> {
  return parseStrictRecord(value, path, ["id", "w", "h", "kinds"], (record) => {
    const id = parseSlug(record.id, `${path}.id`);
    if (!id.ok) return id;
    const w = parsePositiveInteger(record.w, `${path}.w`);
    if (!w.ok) return w;
    const h = parsePositiveInteger(record.h, `${path}.h`);
    if (!h.ok) return h;
    const kinds = parseArray(record.kinds, `${path}.kinds`, (kind, kindPath) =>
      parseEnum(kind, kindPath, VOCABULARY_KINDS),
    );
    if (!kinds.ok) return kinds;
    if (kinds.value.length === 0) {
      return fail(`${path}.kinds`, "expected at least one kind");
    }
    return ok({ id: id.value, w: w.value, h: h.value, kinds: kinds.value });
  });
}

function parseStateRule(
  value: unknown,
  path: string,
  cellIds: ReadonlySet<string>,
): ParseResult<StateRule> {
  return parseStrictRecord(
    value,
    path,
    ["id", "frames", "fps", "cellClasses", "perAbility"],
    (record) => {
      const id = parseSlug(record.id, `${path}.id`);
      if (!id.ok) return id;
      const frames = parseRange(record.frames, `${path}.frames`);
      if (!frames.ok) return frames;
      const fps =
        record.fps === undefined
          ? undefined
          : parseRange(record.fps, `${path}.fps`);
      if (fps !== undefined && !fps.ok) return fps;
      let cellClasses: readonly string[] | undefined;
      if (record.cellClasses !== undefined) {
        const parsed = parseUniqueSlugs(
          record.cellClasses,
          `${path}.cellClasses`,
        );
        if (!parsed.ok) return parsed;
        for (const [index, cell] of parsed.value.entries()) {
          if (!cellIds.has(cell)) {
            return fail(
              `${path}.cellClasses[${index}]`,
              `unknown cell class "${cell}"`,
            );
          }
        }
        cellClasses = parsed.value;
      }
      const perAbility = record.perAbility ?? false;
      if (typeof perAbility !== "boolean") {
        return fail(`${path}.perAbility`, "expected a boolean");
      }
      return ok({
        id: id.value,
        frames: frames.value,
        ...(fps === undefined ? {} : { fps: fps.value }),
        ...(cellClasses === undefined ? {} : { cellClasses }),
        perAbility,
      });
    },
  );
}

function uniqueBy<T>(
  items: readonly T[],
  key: (item: T) => string,
  path: string,
): ParseFailure | undefined {
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const k = key(item);
    if (seen.has(k)) return fail(`${path}[${index}]`, `duplicate "${k}"`);
    seen.add(k);
  }
  return undefined;
}

const ANY_CELL_CLASS = "*";

/**
 * State rules are unique by (state id, cell class): two rules of one id may not
 * claim the same class, and a rule naming no class claims all of them.
 */
function uniqueStateRules(
  rules: readonly StateRule[],
  path: string,
): ParseFailure | undefined {
  const claimed = new Map<string, Set<string>>();
  for (const [index, rule] of rules.entries()) {
    const taken = claimed.get(rule.id) ?? new Set<string>();
    const wanted = rule.cellClasses ?? [ANY_CELL_CLASS];
    const clash = wanted.find(
      (cell) =>
        taken.has(cell) ||
        taken.has(ANY_CELL_CLASS) ||
        (cell === ANY_CELL_CLASS && taken.size > 0),
    );
    if (clash !== undefined) {
      return fail(
        `${path}[${index}]`,
        clash === ANY_CELL_CLASS
          ? `duplicate "${rule.id}": another rule already covers some cell class`
          : `duplicate "${rule.id}" for cell class "${clash}"`,
      );
    }
    for (const cell of wanted) taken.add(cell);
    claimed.set(rule.id, taken);
  }
  return undefined;
}

/** The rule for `stateId` on cell class `cellClassId`, or undefined when the class does not draw the state. */
export function stateRuleFor(
  vocabulary: AssetVocabulary,
  stateId: string,
  cellClassId: string | undefined,
): StateRule | undefined {
  return vocabulary.states.find(
    (rule) =>
      rule.id === stateId &&
      (rule.cellClasses === undefined ||
        (cellClassId !== undefined && rule.cellClasses.includes(cellClassId))),
  );
}

/** The distinct state ids, in the order the vocabulary first names them. */
export function stateIds(vocabulary: AssetVocabulary): readonly string[] {
  return [...new Set(vocabulary.states.map((rule) => rule.id))];
}

export function parseAssetVocabulary(
  input: unknown,
  path = "vocabulary",
): ParseResult<AssetVocabulary> {
  return parseStrictRecord(
    input,
    path,
    [
      "schemaVersion",
      "version",
      "directions",
      "expressions",
      "paletteFamilies",
      "tiers",
      "cells",
      "states",
      "effect",
    ],
    (record) => {
      const schemaVersion = parseSchemaVersion(
        record.schemaVersion,
        ASSET_SCHEMA_VERSIONS,
        `${path}.schemaVersion`,
      );
      if (!schemaVersion.ok) return schemaVersion;
      const version = parsePositiveInteger(record.version, `${path}.version`);
      if (!version.ok) return version;
      const directions = parseUniqueSlugs(
        record.directions,
        `${path}.directions`,
      );
      if (!directions.ok) return directions;
      const expressions = parseUniqueSlugs(
        record.expressions,
        `${path}.expressions`,
      );
      if (!expressions.ok) return expressions;
      const paletteFamilies = parseUniqueSlugs(
        record.paletteFamilies,
        `${path}.paletteFamilies`,
      );
      if (!paletteFamilies.ok) return paletteFamilies;
      const tiers = parseRange(record.tiers, `${path}.tiers`);
      if (!tiers.ok) return tiers;
      const cells = parseArray(record.cells, `${path}.cells`, parseCellClass);
      if (!cells.ok) return cells;
      if (cells.value.length === 0)
        return fail(`${path}.cells`, "expected at least one cell class");
      const dupCell = uniqueBy(cells.value, (c) => c.id, `${path}.cells`);
      if (dupCell) return dupCell;
      const cellIds = new Set(cells.value.map((c) => c.id));
      const states = parseArray(
        record.states,
        `${path}.states`,
        (state, statePath) => parseStateRule(state, statePath, cellIds),
      );
      if (!states.ok) return states;
      if (states.value.length === 0)
        return fail(`${path}.states`, "expected at least one state");
      const dupState = uniqueStateRules(states.value, `${path}.states`);
      if (dupState) return dupState;
      const effect = parseStrictRecord(
        record.effect,
        `${path}.effect`,
        ["maxEmissiveAccents", "tierOneMaxMs"],
        (e) => {
          const accents = parseIntegerAtLeast(
            e.maxEmissiveAccents,
            `${path}.effect.maxEmissiveAccents`,
            0,
          );
          if (!accents.ok) return accents;
          const tierOne = parsePositiveInteger(
            e.tierOneMaxMs,
            `${path}.effect.tierOneMaxMs`,
          );
          if (!tierOne.ok) return tierOne;
          return ok({
            maxEmissiveAccents: accents.value,
            tierOneMaxMs: tierOne.value,
          });
        },
      );
      if (!effect.ok) return effect;
      return ok({
        schemaVersion: schemaVersion.value,
        version: version.value,
        directions: directions.value,
        expressions: expressions.value,
        paletteFamilies: paletteFamilies.value,
        tiers: tiers.value,
        cells: cells.value,
        states: states.value,
        effect: effect.value,
      });
    },
  );
}

// --- Requests, provenance and manifests (types; parsers below) ------------------

export const ASSET_KINDS = [
  "sprite",
  "portrait",
  "effect",
  "tile",
  "sound",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export interface GenerationSlot {
  readonly state?: string;
  readonly direction?: string;
  readonly ability?: string;
  readonly expression?: string;
}

/**
 * What a masked edit starts from: an earlier job's output, named by the job and
 * the output hash used; a hand-authored image imported as a studio blob,
 * which no job made and which provenance records as hand work; or one frame
 * of a published revision (a frame ref), which repair edits from.
 */
export type EditBase =
  | { readonly kind: "job"; readonly jobId: string; readonly output: Sha256 }
  | {
      readonly kind: "hand";
      readonly image: Sha256;
      readonly description: string;
    }
  | {
      readonly kind: "published";
      readonly assetId: AssetId;
      readonly revision: Sha256;
      readonly slotKey: string;
      readonly frameIndex: number;
      readonly frameHash: Sha256;
    };

/**
 * A masked img2img edit of a base. The mask is a studio blob (white marks the
 * pixels the model may change). `cue` is the wording of the change.
 */
export interface GenerationEdit {
  readonly base: EditBase;
  readonly mask: Sha256;
  /** Denoising strength, greater than 0 and at most 1. */
  readonly strength: number;
  readonly cue: string;
}

/**
 * What a render recipe request adds to a sprite request: the render profile, the
 * palette and the declared pivot. There is no camera id (the one camera is a
 * committed file whose hash is in the revision recipe) and no seed or batch to
 * choose: a recipe request is stored with batch 1 and seed 0.
 */
export interface RecipeRequest {
  /** Render profile id, from the subject. */
  readonly profile: string;
  readonly palette: string;
  readonly pivot: Point;
}

export interface GenerationRequest {
  readonly schemaVersion: number;
  /** Subject id from the content pack, e.g. a god id. */
  readonly subject: string;
  readonly kind: AssetKind;
  readonly slots: readonly GenerationSlot[];
  readonly batch: number;
  readonly styleNote?: string;
  readonly seed?: number;
  /** Present when the generation edits an earlier job's output instead of drawing from noise. */
  readonly edit?: GenerationEdit;
  /**
   * Present on a recipe request, the variant a render engine runs. Then `batch`
   * is 1, `seed` is 0, and there is no style note or edit.
   */
  readonly recipe?: RecipeRequest;
}

/** A request that carries a recipe, with the fixed batch and seed its parse stores. */
export type RecipeGenerationRequest = GenerationRequest & {
  readonly recipe: RecipeRequest;
  readonly batch: 1;
  readonly seed: 0;
};

export function isRecipeRequest(
  request: GenerationRequest,
): request is RecipeGenerationRequest {
  return request.recipe !== undefined;
}

/** The seed a recipe request stores and every render job runs with. */
export const RECIPE_SEED = 0;

export const LICENCE_ROLES = [
  "model",
  "lora",
  "vae",
  "encoder",
  "runtime",
  "input",
  "original-work",
] as const;
export type LicenceRole = (typeof LICENCE_ROLES)[number];

export interface LicenceRecord {
  readonly subject: string;
  readonly role: LicenceRole;
  readonly licence: string;
  readonly attribution?: string;
}

export const JOB_REF_STATUSES = [
  "succeeded",
  "failed",
  "unavailable",
  "cancelled",
] as const;
export type JobRefStatus = (typeof JOB_REF_STATUSES)[number];

/** A job as the provenance of a published asset records it: self-contained, so no job ledger is needed to validate a manifest. */
export interface JobRef {
  readonly jobId: string;
  readonly status: JobRefStatus;
  /** Output hashes; present exactly when the job succeeded. */
  readonly outputs?: readonly Sha256[];
}

export interface AssetRevisionRef {
  readonly assetId: AssetId;
  readonly revision: Sha256;
}

/** How an edit step was made: by the owner's hand in an editor, or by a script that ran on the frames. */
export type HandEditMethod = "hand" | "script";

export interface HandEditStep {
  readonly description: string;
  readonly hash?: Sha256;
  /** Absent means "hand": steps recorded before scripted edits were told apart carry none. */
  readonly method?: HandEditMethod;
}

export interface OwnerException {
  readonly reason: string;
}

export interface ModelRef {
  readonly id: string;
  readonly sha256: Sha256;
}

export interface RuntimeRef {
  readonly name: string;
  readonly version: string;
}

export type SettingValue = string | number | boolean;

interface ProvenanceCommon {
  readonly licences: readonly LicenceRecord[];
  readonly relatedJobs: readonly JobRef[];
  readonly handEdits: readonly HandEditStep[];
  readonly sourceAssets: readonly AssetRevisionRef[];
  readonly ownerException?: OwnerException;
}

/** One succeeded job that contributed to an asset, with the exact narrowed request and engine that ran it. */
export interface GenerationRef {
  readonly jobId: string;
  readonly request: GenerationRequest;
  readonly runtime: RuntimeRef;
  readonly model: ModelRef;
  readonly loras: readonly ModelRef[];
  readonly encoder: ModelRef | null;
  readonly vae: ModelRef | null;
  readonly seed: number;
  readonly settings: Readonly<Record<string, SettingValue>>;
  /** The job outputs this asset actually uses; a non-empty subset of the job's outputs. */
  readonly used: readonly Sha256[];
}

export interface GeneratedProvenance extends ProvenanceCommon {
  readonly method: "generated";
  readonly generations: readonly GenerationRef[];
  /**
   * The steps of the derived cells and realm variants this revision carries
   * from its prior revision, so a drawn or repaired revision does not lose their
   * lineage. Absent when it carries none; when present, non-empty.
   */
  readonly steps?: readonly DerivedStep[];
}

export interface HandProvenance extends ProvenanceCommon {
  readonly method: "hand";
  readonly editor?: string;
}

/** JSON a recipe takes as parameters: integers only, so canonical text is stable. */
export type CanonicalJson =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

/** The published slot a derived slot was computed from. */
export interface DerivedSource {
  readonly assetId: AssetId;
  readonly revision: Sha256;
  readonly slotKey: string;
  /** SHA-256 over the source slot's frames' RGBA, in order, plus its duration list. */
  readonly slotHash: Sha256;
}

/** One recipe application: a slot listed here is derived; any other slot is carried or a hand step. */
export interface DerivedStep {
  readonly recipe: string;
  readonly version: number;
  readonly params: { readonly [key: string]: CanonicalJson };
  readonly source: DerivedSource;
  readonly outputSlot: string;
  readonly resultHash: Sha256;
}

export interface DerivedProvenance extends ProvenanceCommon {
  readonly method: "derived";
  readonly operation: string;
  readonly runtime: RuntimeRef;
  /** Non-empty: `method: "derived"` applies exactly when a manifest has steps. */
  readonly steps: readonly DerivedStep[];
  readonly resultHashes: readonly Sha256[];
}

export const RAW_FRAME_ROLES = ["colour", "id", "depth"] as const;
export type RawFrameRole = (typeof RAW_FRAME_ROLES)[number];

/** The Blender that rendered: a recorded tool fact, not an output licence record. */
export interface BlenderPin {
  readonly version: string;
  /** The build hash the binary reports. */
  readonly build: string;
  /** SHA-256 of the binary. */
  readonly sha256: Sha256;
}

/**
 * Everything shared by the slots of one rendered revision. `hash` is the
 * revision recipe hash over the other fields; a contract holds no hashing, so
 * the render audit recomputes it.
 */
export interface RenderedRevisionRecipe {
  readonly hash: Sha256;
  readonly profile: { readonly id: string; readonly hash: Sha256 };
  readonly camera: Sha256;
  readonly palette: { readonly id: string; readonly digest: Sha256 };
  readonly pivot: Point;
  readonly script: Sha256;
  /** POST_STEP_VERSION when the cells were made. */
  readonly postStep: number;
  readonly blender: BlenderPin;
  readonly kit: Sha256;
  readonly stamps: Sha256;
}

/** One slot of a rendered revision, from one job: its recipe, the raw frames it came from and its seed. */
export interface RenderedSlot {
  /** `state/facing[/ability]`, the manifest's slot key. */
  readonly slotKey: string;
  /** The slot recipe hash: the revision hash plus this slot's state, clip, facing and seed. */
  readonly recipeHash: Sha256;
  /** The revision recipe hash this slot was rendered under; equal across the revision's slots. */
  readonly revisionRecipeHash: Sha256;
  readonly state: string;
  /** The animation clip the profile's clip map chose for the state. */
  readonly clip: string;
  readonly facing: string;
  readonly ability?: string;
  /** Always 0: a recipe request has a fixed base seed. */
  readonly seed: 0;
  readonly frameCount: number;
  /** Blob hashes of the raw frames per role, one per frame, in frame order. */
  readonly raw: { readonly [role in RawFrameRole]: readonly Sha256[] };
}

export interface RenderedProvenance extends ProvenanceCommon {
  readonly method: "rendered";
  readonly revisionRecipe: RenderedRevisionRecipe;
  readonly slots: readonly RenderedSlot[];
}

export type Provenance =
  | GeneratedProvenance
  | HandProvenance
  | DerivedProvenance
  | RenderedProvenance;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Frame {
  /** Where the frame sits in the atlas; the atlas blob hash identifies its pixels. */
  readonly rect: Rect;
  readonly durationMs: number;
}

export interface Atlas {
  readonly blob: Sha256;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Footprint {
  readonly w: number;
  readonly h: number;
}

interface ManifestCommon {
  readonly schemaVersion: number;
  readonly id: AssetId;
  readonly cell: { readonly w: number; readonly h: number };
  readonly pixelScale: number;
  readonly paletteFamily: string;
  readonly paletteId: string;
  readonly styleTag: string;
  readonly atlas: Atlas;
  readonly provenance: Provenance;
}

export interface SpriteAnimation {
  readonly state: string;
  readonly direction: string;
  readonly ability?: string;
  readonly loopStart?: number;
  readonly frames: readonly Frame[];
}

/** A shade of a palette ramp. */
export interface RampShade {
  readonly ramp: string;
  readonly index: number;
}

/** One source shade and the shade it becomes in the variant's palette. */
export interface ColourMapping {
  readonly source: RampShade;
  readonly target: RampShade;
}

/**
 * A realm recolour of the whole asset: its own atlas (same size as the source
 * atlas, alpha preserved) and the map `(sourceRamp, index) → (targetRamp, index)`
 * it was recoloured under, so publish can rerun it from the source atlas.
 */
export interface RealmVariant {
  readonly paletteFamily: string;
  readonly paletteId: string;
  readonly atlas: Atlas;
  readonly map: readonly ColourMapping[];
}

export interface SpriteManifest extends ManifestCommon {
  readonly kind: "sprite";
  readonly pivot: Point;
  readonly footprint: Footprint;
  readonly directions: readonly string[];
  /** Present when the asset is drawn, not mirrored, on the west side. */
  readonly asymmetry?: { readonly feature: string };
  readonly realmVariants: readonly RealmVariant[];
  readonly animations: readonly SpriteAnimation[];
}

export interface PortraitExpression {
  readonly expression: string;
  readonly frame: Frame;
}

export interface PortraitManifest extends ManifestCommon {
  readonly kind: "portrait";
  readonly characterId: string;
  readonly expressions: readonly PortraitExpression[];
}

export interface EffectAnimation {
  readonly name: string;
  readonly loopStart?: number;
  readonly frames: readonly Frame[];
}

export interface EffectManifest extends ManifestCommon {
  readonly kind: "effect";
  readonly pivot: Point;
  readonly footprint: Footprint;
  readonly tier: number;
  readonly emissiveAccents: readonly string[];
  readonly animations: readonly EffectAnimation[];
}

export type AssetManifest = SpriteManifest | PortraitManifest | EffectManifest;

function parseOptionalSlug(
  value: unknown,
  path: string,
): ParseResult<string | undefined> {
  return value === undefined ? ok(undefined) : parseSlug(value, path);
}

function parseSlot(value: unknown, path: string): ParseResult<GenerationSlot> {
  return parseStrictRecord(
    value,
    path,
    ["state", "direction", "ability", "expression"],
    (record) => {
      const slot: { -readonly [K in keyof GenerationSlot]: string } = {};
      for (const key of [
        "state",
        "direction",
        "ability",
        "expression",
      ] as const) {
        const parsed = parseOptionalSlug(record[key], `${path}.${key}`);
        if (!parsed.ok) return parsed;
        if (parsed.value !== undefined) slot[key] = parsed.value;
      }
      if (Object.keys(slot).length === 0) {
        return fail(
          path,
          "expected at least one of state, direction, ability, expression",
        );
      }
      return ok(slot);
    },
  );
}

function parseEditBase(value: unknown, path: string): ParseResult<EditBase> {
  if (!isRecord(value)) return fail(path, "expected an object");
  const kind = parseEnum(value.kind, `${path}.kind`, [
    "job",
    "hand",
    "published",
  ] as const);
  if (!kind.ok) return kind;
  if (kind.value === "published")
    return parseStrictRecord<EditBase>(
      value,
      path,
      ["kind", "assetId", "revision", "slotKey", "frameIndex", "frameHash"],
      (record) => {
        const assetId = parseAssetId(record.assetId, `${path}.assetId`);
        if (!assetId.ok) return assetId;
        const revision = parseSha256(record.revision, `${path}.revision`);
        if (!revision.ok) return revision;
        const slotKey = parseString(record.slotKey, `${path}.slotKey`);
        if (!slotKey.ok) return slotKey;
        const frameIndex = parseIntegerAtLeast(
          record.frameIndex,
          `${path}.frameIndex`,
          0,
        );
        if (!frameIndex.ok) return frameIndex;
        const frameHash = parseSha256(record.frameHash, `${path}.frameHash`);
        if (!frameHash.ok) return frameHash;
        return ok({
          kind: "published",
          assetId: assetId.value,
          revision: revision.value,
          slotKey: slotKey.value,
          frameIndex: frameIndex.value,
          frameHash: frameHash.value,
        });
      },
    );
  if (kind.value === "job")
    return parseStrictRecord<EditBase>(
      value,
      path,
      ["kind", "jobId", "output"],
      (record) => {
        const jobId = parseSlug(record.jobId, `${path}.jobId`);
        if (!jobId.ok) return jobId;
        const output = parseSha256(record.output, `${path}.output`);
        if (!output.ok) return output;
        return ok({ kind: "job", jobId: jobId.value, output: output.value });
      },
    );
  return parseStrictRecord<EditBase>(
    value,
    path,
    ["kind", "image", "description"],
    (record) => {
      const image = parseSha256(record.image, `${path}.image`);
      if (!image.ok) return image;
      const description = parseString(
        record.description,
        `${path}.description`,
      );
      if (!description.ok) return description;
      return ok({
        kind: "hand",
        image: image.value,
        description: description.value,
      });
    },
  );
}

function parseGenerationEdit(
  value: unknown,
  path: string,
): ParseResult<GenerationEdit> {
  return parseStrictRecord(
    value,
    path,
    ["base", "mask", "strength", "cue"],
    (record) => {
      const base = parseEditBase(record.base, `${path}.base`);
      if (!base.ok) return base;
      const mask = parseSha256(record.mask, `${path}.mask`);
      if (!mask.ok) return mask;
      const { strength } = record;
      if (
        typeof strength !== "number" ||
        !Number.isFinite(strength) ||
        strength <= 0 ||
        strength > 1
      )
        return fail(
          `${path}.strength`,
          "expected a number above 0 and at most 1",
        );
      const cue = parseString(record.cue, `${path}.cue`);
      if (!cue.ok) return cue;
      return ok({
        base: base.value,
        mask: mask.value,
        strength,
        cue: cue.value,
      });
    },
  );
}

function parseNonNegativePoint(
  value: unknown,
  path: string,
): ParseResult<Point> {
  return parseStrictRecord(value, path, ["x", "y"], (record) => {
    const x = parseIntegerAtLeast(record.x, `${path}.x`, 0);
    if (!x.ok) return x;
    const y = parseIntegerAtLeast(record.y, `${path}.y`, 0);
    if (!y.ok) return y;
    return ok({ x: x.value, y: y.value });
  });
}

/**
 * A recipe request: the sprite request a render engine runs. It takes no style
 * note or edit, a batch of 1 and a seed of 0 (absent means those values), and
 * is stored with the fixed batch and seed. Whether the pivot lies inside the
 * cell is the request builder's check; a request does not know its cell.
 */
function parseRecipeRequest(
  record: Record<string, unknown>,
  path: string,
  schemaVersion: number,
  subject: string,
  kind: AssetKind,
  slots: readonly GenerationSlot[],
): ParseResult<GenerationRequest> {
  if (kind !== "sprite")
    return fail(`${path}.kind`, "a recipe request draws a sprite");
  for (const key of ["styleNote", "edit"] as const) {
    if (record[key] !== undefined)
      return fail(`${path}.${key}`, `a recipe request takes no ${key}`);
  }
  if (record.batch !== undefined && record.batch !== 1)
    return fail(`${path}.batch`, "a recipe request has batch 1");
  if (record.seed !== undefined && record.seed !== RECIPE_SEED)
    return fail(
      `${path}.seed`,
      `a recipe request has a fixed seed of ${RECIPE_SEED}`,
    );
  const recipe = parseStrictRecord(
    record.recipe,
    `${path}.recipe`,
    ["profile", "palette", "pivot"],
    (r): ParseResult<RecipeRequest> => {
      const profile = parseSlug(r.profile, `${path}.recipe.profile`);
      if (!profile.ok) return profile;
      const palette = parseSlug(r.palette, `${path}.recipe.palette`);
      if (!palette.ok) return palette;
      const pivot = parseNonNegativePoint(r.pivot, `${path}.recipe.pivot`);
      if (!pivot.ok) return pivot;
      return ok({
        profile: profile.value,
        palette: palette.value,
        pivot: pivot.value,
      });
    },
  );
  if (!recipe.ok) return recipe;
  return ok({
    schemaVersion,
    subject,
    kind,
    slots,
    batch: 1,
    seed: RECIPE_SEED,
    recipe: recipe.value,
  });
}

export function parseGenerationRequest(
  input: unknown,
  path = "request",
): ParseResult<GenerationRequest> {
  return parseStrictRecord(
    input,
    path,
    [
      "schemaVersion",
      "subject",
      "kind",
      "slots",
      "batch",
      "styleNote",
      "seed",
      "edit",
      "recipe",
    ],
    (record) => {
      const schemaVersion = parseSchemaVersion(
        record.schemaVersion,
        ASSET_SCHEMA_VERSIONS,
        `${path}.schemaVersion`,
      );
      if (!schemaVersion.ok) return schemaVersion;
      const subject = parseSlug(record.subject, `${path}.subject`);
      if (!subject.ok) return subject;
      const kind = parseEnum(record.kind, `${path}.kind`, ASSET_KINDS);
      if (!kind.ok) return { ...kind, reason: "unknown-kind" };
      const slots = parseArray(record.slots, `${path}.slots`, parseSlot);
      if (!slots.ok) return slots;
      if (slots.value.length === 0)
        return fail(`${path}.slots`, "expected at least one slot");
      const duplicate = uniqueBy(
        slots.value,
        (slot) => canonicalJson(slot),
        `${path}.slots`,
      );
      if (duplicate) return duplicate;
      if (record.recipe !== undefined) {
        return parseRecipeRequest(
          record,
          path,
          schemaVersion.value,
          subject.value,
          kind.value,
          slots.value,
        );
      }
      const batch = parsePositiveInteger(record.batch, `${path}.batch`);
      if (!batch.ok) return batch;
      let styleNote: string | undefined;
      if (record.styleNote !== undefined) {
        const parsed = parseString(record.styleNote, `${path}.styleNote`);
        if (!parsed.ok) return parsed;
        styleNote = parsed.value;
      }
      let seed: number | undefined;
      if (record.seed !== undefined) {
        const parsed = parseIntegerAtLeast(record.seed, `${path}.seed`, 0);
        if (!parsed.ok) return parsed;
        seed = parsed.value;
      }
      let edit: GenerationEdit | undefined;
      if (record.edit !== undefined) {
        const parsed = parseGenerationEdit(record.edit, `${path}.edit`);
        if (!parsed.ok) return parsed;
        edit = parsed.value;
      }
      return ok({
        schemaVersion: schemaVersion.value,
        subject: subject.value,
        kind: kind.value,
        slots: slots.value,
        batch: batch.value,
        ...(styleNote === undefined ? {} : { styleNote }),
        ...(seed === undefined ? {} : { seed }),
        ...(edit === undefined ? {} : { edit }),
      });
    },
  );
}

// --- Provenance -------------------------------------------------------------------

export function parseLicence(
  value: unknown,
  path: string,
): ParseResult<LicenceRecord> {
  return parseStrictRecord(
    value,
    path,
    ["subject", "role", "licence", "attribution"],
    (record) => {
      const subject = parseString(record.subject, `${path}.subject`);
      if (!subject.ok) return subject;
      const role = parseEnum(record.role, `${path}.role`, LICENCE_ROLES);
      if (!role.ok) return role;
      const licence = parseString(record.licence, `${path}.licence`);
      if (!licence.ok) return licence;
      let attribution: string | undefined;
      if (record.attribution !== undefined) {
        const parsed = parseString(record.attribution, `${path}.attribution`);
        if (!parsed.ok) return parsed;
        attribution = parsed.value;
      }
      return ok({
        subject: subject.value,
        role: role.value,
        licence: licence.value,
        ...(attribution === undefined ? {} : { attribution }),
      });
    },
  );
}

function parseSha256List(
  value: unknown,
  path: string,
): ParseResult<readonly Sha256[]> {
  const hashes = parseArray(value, path, parseSha256);
  if (!hashes.ok) return hashes;
  if (hashes.value.length === 0)
    return fail(path, "expected at least one hash");
  return hashes;
}

function parseJobRef(value: unknown, path: string): ParseResult<JobRef> {
  return parseStrictRecord<JobRef>(
    value,
    path,
    ["jobId", "status", "outputs"],
    (record) => {
      const jobId = parseSlug(record.jobId, `${path}.jobId`);
      if (!jobId.ok) return jobId;
      const status = parseEnum(
        record.status,
        `${path}.status`,
        JOB_REF_STATUSES,
      );
      if (!status.ok) return status;
      if (status.value !== "succeeded") {
        if (record.outputs !== undefined) {
          return fail(
            `${path}.outputs`,
            `a ${status.value} job has no outputs`,
          );
        }
        return ok({ jobId: jobId.value, status: status.value });
      }
      const outputs = parseSha256List(record.outputs, `${path}.outputs`);
      if (!outputs.ok) return outputs;
      return ok({
        jobId: jobId.value,
        status: status.value,
        outputs: outputs.value,
      });
    },
  );
}

function parseHandEdit(
  value: unknown,
  path: string,
): ParseResult<HandEditStep> {
  return parseStrictRecord(
    value,
    path,
    ["description", "hash", "method"],
    (record) => {
      const description = parseString(
        record.description,
        `${path}.description`,
      );
      if (!description.ok) return description;
      let method: HandEditMethod | undefined;
      if (record.method !== undefined) {
        const parsed = parseEnum(record.method, `${path}.method`, [
          "hand",
          "script",
        ] as const);
        if (!parsed.ok) return parsed;
        method = parsed.value;
      }
      let hash: Sha256 | undefined;
      if (record.hash !== undefined) {
        const parsed = parseSha256(record.hash, `${path}.hash`);
        if (!parsed.ok) return parsed;
        hash = parsed.value;
      }
      return ok({
        description: description.value,
        ...(hash === undefined ? {} : { hash }),
        ...(method === undefined ? {} : { method }),
      });
    },
  );
}

function parseRevisionRef(
  value: unknown,
  path: string,
): ParseResult<AssetRevisionRef> {
  return parseStrictRecord(value, path, ["assetId", "revision"], (record) => {
    const assetId = parseAssetId(record.assetId, `${path}.assetId`);
    if (!assetId.ok) return assetId;
    const revision = parseSha256(record.revision, `${path}.revision`);
    if (!revision.ok) return revision;
    return ok({ assetId: assetId.value, revision: revision.value });
  });
}

export function parseModelRef(
  value: unknown,
  path: string,
): ParseResult<ModelRef> {
  return parseStrictRecord(value, path, ["id", "sha256"], (record) => {
    const id = parseString(record.id, `${path}.id`);
    if (!id.ok) return id;
    const sha256 = parseSha256(record.sha256, `${path}.sha256`);
    if (!sha256.ok) return sha256;
    return ok({ id: id.value, sha256: sha256.value });
  });
}

function parseCanonicalJson(
  value: unknown,
  path: string,
): ParseResult<CanonicalJson> {
  if (value === null || typeof value === "boolean") return ok(value);
  if (typeof value === "string") {
    if (URL_VALUE.test(value))
      return fail(path, "params never carry credentials or endpoints");
    return ok(value);
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value)
      ? ok(value)
      : fail(path, "expected an integer");
  }
  if (Array.isArray(value)) return parseArray(value, path, parseCanonicalJson);
  if (isRecord(value)) return parseCanonicalParams(value, path);
  return fail(path, "expected JSON");
}

function parseCanonicalParams(
  value: unknown,
  path: string,
): ParseResult<{ readonly [key: string]: CanonicalJson }> {
  if (!isRecord(value)) return fail(path, "expected an object");
  const params: { [key: string]: CanonicalJson } = {};
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    // `params["__proto__"] = x` would reparent the object and drop the key, so the
    // canonical bytes would no longer cover what was recorded.
    if (key === "__proto__")
      return fail(entryPath, "params never carry a __proto__ key");
    if (SECRET_KEY.test(key))
      return fail(entryPath, "params never carry credentials or endpoints");
    const parsed = parseCanonicalJson(entry, entryPath);
    if (!parsed.ok) return parsed;
    params[key] = parsed.value;
  }
  return ok(params);
}

function parseDerivedSource(
  value: unknown,
  path: string,
): ParseResult<DerivedSource> {
  return parseStrictRecord(
    value,
    path,
    ["assetId", "revision", "slotKey", "slotHash"],
    (record) => {
      const assetId = parseAssetId(record.assetId, `${path}.assetId`);
      if (!assetId.ok) return assetId;
      const revision = parseSha256(record.revision, `${path}.revision`);
      if (!revision.ok) return revision;
      const slotKey = parseString(record.slotKey, `${path}.slotKey`);
      if (!slotKey.ok) return slotKey;
      const slotHash = parseSha256(record.slotHash, `${path}.slotHash`);
      if (!slotHash.ok) return slotHash;
      return ok({
        assetId: assetId.value,
        revision: revision.value,
        slotKey: slotKey.value,
        slotHash: slotHash.value,
      });
    },
  );
}

export function parseDerivedStep(
  value: unknown,
  path: string,
): ParseResult<DerivedStep> {
  return parseStrictRecord(
    value,
    path,
    ["recipe", "version", "params", "source", "outputSlot", "resultHash"],
    (record) => {
      const recipe = parseString(record.recipe, `${path}.recipe`);
      if (!recipe.ok) return recipe;
      const version = parsePositiveInteger(record.version, `${path}.version`);
      if (!version.ok) return version;
      const params = parseCanonicalParams(record.params, `${path}.params`);
      if (!params.ok) return params;
      const source = parseDerivedSource(record.source, `${path}.source`);
      if (!source.ok) return source;
      const outputSlot = parseString(record.outputSlot, `${path}.outputSlot`);
      if (!outputSlot.ok) return outputSlot;
      const resultHash = parseSha256(record.resultHash, `${path}.resultHash`);
      if (!resultHash.ok) return resultHash;
      return ok({
        recipe: recipe.value,
        version: version.value,
        params: params.value,
        source: source.value,
        outputSlot: outputSlot.value,
        resultHash: resultHash.value,
      });
    },
  );
}

export function parseRuntimeRef(
  value: unknown,
  path: string,
): ParseResult<RuntimeRef> {
  return parseStrictRecord(value, path, ["name", "version"], (record) => {
    const name = parseString(record.name, `${path}.name`);
    if (!name.ok) return name;
    const version = parseString(record.version, `${path}.version`);
    if (!version.ok) return version;
    return ok({ name: name.value, version: version.value });
  });
}

const SECRET_KEY =
  /(api[_-]?key|token|secret|password|credential|endpoint|authorization)/i;
const URL_VALUE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Generation settings are scalars; credential-like keys and endpoint-like values never enter a record. */
export function parseGenerationSettings(
  value: unknown,
  path: string,
): ParseResult<Readonly<Record<string, SettingValue>>> {
  if (!isRecord(value)) return fail(path, "expected an object");
  const settings: Record<string, SettingValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    if (SECRET_KEY.test(key)) {
      return fail(entryPath, "settings never carry credentials or endpoints");
    }
    if (typeof entry === "string") {
      if (URL_VALUE.test(entry)) {
        return fail(entryPath, "settings never carry credentials or endpoints");
      }
      settings[key] = entry;
    } else if (
      typeof entry === "boolean" ||
      (typeof entry === "number" && Number.isFinite(entry))
    ) {
      settings[key] = entry;
    } else {
      return fail(entryPath, "expected a string, number or boolean");
    }
  }
  return ok(settings);
}

const COMMON_PROVENANCE_KEYS = [
  "method",
  "licences",
  "relatedJobs",
  "handEdits",
  "sourceAssets",
  "ownerException",
] as const;

const PROVENANCE_METHODS = [
  "generated",
  "hand",
  "derived",
  "rendered",
] as const;

/**
 * The steps of a provenance record: each a valid step, one per slot (a palette
 * swap also names its realm, so a slot keeps its own step and one swap per
 * realm), each with its source among the record's source assets.
 */
function parseStepList(
  value: unknown,
  path: string,
  sourceAssets: readonly AssetRevisionRef[],
): ParseResult<readonly DerivedStep[]> {
  const steps = parseArray(value, `${path}.steps`, parseDerivedStep);
  if (!steps.ok) return steps;
  const duplicateSlot = uniqueBy(
    steps.value,
    (step) =>
      step.recipe === "palette-swap"
        ? `palette-swap:${String(step.params.targetFamily)}:${step.outputSlot}`
        : step.outputSlot,
    `${path}.steps`,
  );
  if (duplicateSlot) return duplicateSlot;
  for (const [index, step] of steps.value.entries()) {
    const { assetId, revision } = step.source;
    if (
      !sourceAssets.some(
        (ref) => ref.assetId === assetId && ref.revision === revision,
      )
    )
      return fail(
        `${path}.steps[${index}].source`,
        `the step's source ${assetId} ${revision} is not among sourceAssets`,
      );
  }
  return ok(steps.value);
}

const BLENDER_BUILD = /^[0-9a-f]{7,40}$/;

function parseBlenderPin(
  value: unknown,
  path: string,
): ParseResult<BlenderPin> {
  return parseStrictRecord(
    value,
    path,
    ["version", "build", "sha256"],
    (record) => {
      const version = parseString(record.version, `${path}.version`);
      if (!version.ok) return version;
      if (typeof record.build !== "string" || !BLENDER_BUILD.test(record.build))
        return fail(`${path}.build`, "expected a lowercase hex build hash");
      const sha256 = parseSha256(record.sha256, `${path}.sha256`);
      if (!sha256.ok) return sha256;
      return ok({
        version: version.value,
        build: record.build,
        sha256: sha256.value,
      });
    },
  );
}

function parseRenderedRevisionRecipe(
  value: unknown,
  path: string,
): ParseResult<RenderedRevisionRecipe> {
  return parseStrictRecord(
    value,
    path,
    [
      "hash",
      "profile",
      "camera",
      "palette",
      "pivot",
      "script",
      "postStep",
      "blender",
      "kit",
      "stamps",
    ],
    (record) => {
      const hash = parseSha256(record.hash, `${path}.hash`);
      if (!hash.ok) return hash;
      const profile = parseStrictRecord(
        record.profile,
        `${path}.profile`,
        ["id", "hash"],
        (p) => {
          const id = parseSlug(p.id, `${path}.profile.id`);
          if (!id.ok) return id;
          const profileHash = parseSha256(p.hash, `${path}.profile.hash`);
          if (!profileHash.ok) return profileHash;
          return ok({ id: id.value, hash: profileHash.value });
        },
      );
      if (!profile.ok) return profile;
      const camera = parseSha256(record.camera, `${path}.camera`);
      if (!camera.ok) return camera;
      const palette = parseStrictRecord(
        record.palette,
        `${path}.palette`,
        ["id", "digest"],
        (p) => {
          const id = parseSlug(p.id, `${path}.palette.id`);
          if (!id.ok) return id;
          const digest = parseSha256(p.digest, `${path}.palette.digest`);
          if (!digest.ok) return digest;
          return ok({ id: id.value, digest: digest.value });
        },
      );
      if (!palette.ok) return palette;
      const pivot = parseNonNegativePoint(record.pivot, `${path}.pivot`);
      if (!pivot.ok) return pivot;
      const script = parseSha256(record.script, `${path}.script`);
      if (!script.ok) return script;
      const postStep = parsePositiveInteger(
        record.postStep,
        `${path}.postStep`,
      );
      if (!postStep.ok) return postStep;
      const blender = parseBlenderPin(record.blender, `${path}.blender`);
      if (!blender.ok) return blender;
      const kit = parseSha256(record.kit, `${path}.kit`);
      if (!kit.ok) return kit;
      const stamps = parseSha256(record.stamps, `${path}.stamps`);
      if (!stamps.ok) return stamps;
      return ok({
        hash: hash.value,
        profile: profile.value,
        camera: camera.value,
        palette: palette.value,
        pivot: pivot.value,
        script: script.value,
        postStep: postStep.value,
        blender: blender.value,
        kit: kit.value,
        stamps: stamps.value,
      });
    },
  );
}

function parseRenderedSlot(
  revisionHash: Sha256,
): (value: unknown, path: string) => ParseResult<RenderedSlot> {
  return (value, path) =>
    parseStrictRecord(
      value,
      path,
      [
        "slotKey",
        "recipeHash",
        "revisionRecipeHash",
        "state",
        "clip",
        "facing",
        "ability",
        "seed",
        "frameCount",
        "raw",
      ],
      (record) => {
        const state = parseSlug(record.state, `${path}.state`);
        if (!state.ok) return state;
        const facing = parseSlug(record.facing, `${path}.facing`);
        if (!facing.ok) return facing;
        const ability = parseOptionalSlug(record.ability, `${path}.ability`);
        if (!ability.ok) return ability;
        const slotKey = parseString(record.slotKey, `${path}.slotKey`);
        if (!slotKey.ok) return slotKey;
        const expected = [state.value, facing.value, ability.value]
          .filter((part) => part !== undefined)
          .join("/");
        if (slotKey.value !== expected)
          return fail(
            `${path}.slotKey`,
            `expected "${expected}", the slot's state, facing and ability`,
          );
        const recipeHash = parseSha256(record.recipeHash, `${path}.recipeHash`);
        if (!recipeHash.ok) return recipeHash;
        const slotRevision = parseSha256(
          record.revisionRecipeHash,
          `${path}.revisionRecipeHash`,
        );
        if (!slotRevision.ok) return slotRevision;
        if (slotRevision.value !== revisionHash)
          return fail(
            `${path}.revisionRecipeHash`,
            "a revision's slots are rendered under one revision recipe hash",
          );
        const clip = parseString(record.clip, `${path}.clip`);
        if (!clip.ok) return clip;
        if (record.seed !== RECIPE_SEED)
          return fail(
            `${path}.seed`,
            `a rendered slot ran at the fixed seed ${RECIPE_SEED}`,
          );
        const frameCount = parsePositiveInteger(
          record.frameCount,
          `${path}.frameCount`,
        );
        if (!frameCount.ok) return frameCount;
        const raw = parseStrictRecord(
          record.raw,
          `${path}.raw`,
          RAW_FRAME_ROLES,
          (r) => {
            const roles: { -readonly [R in RawFrameRole]?: readonly Sha256[] } =
              {};
            for (const role of RAW_FRAME_ROLES) {
              const hashes = parseArray(
                r[role],
                `${path}.raw.${role}`,
                parseSha256,
              );
              if (!hashes.ok) return hashes;
              if (hashes.value.length !== frameCount.value)
                return fail(
                  `${path}.raw.${role}`,
                  `expected ${frameCount.value} hashes, one per frame`,
                );
              roles[role] = hashes.value;
            }
            return ok(roles as { [role in RawFrameRole]: readonly Sha256[] });
          },
        );
        if (!raw.ok) return raw;
        return ok({
          slotKey: slotKey.value,
          recipeHash: recipeHash.value,
          revisionRecipeHash: slotRevision.value,
          state: state.value,
          clip: clip.value,
          facing: facing.value,
          ...(ability.value === undefined ? {} : { ability: ability.value }),
          seed: RECIPE_SEED,
          frameCount: frameCount.value,
          raw: raw.value,
        });
      },
    );
}

function parseRenderedSlots(
  value: unknown,
  path: string,
  revisionHash: Sha256,
): ParseResult<readonly RenderedSlot[]> {
  const slots = parseArray(value, path, parseRenderedSlot(revisionHash));
  if (!slots.ok) return slots;
  if (slots.value.length === 0)
    return fail(path, "a rendered revision records at least one slot");
  const duplicate = uniqueBy(slots.value, (slot) => slot.slotKey, path);
  if (duplicate) return duplicate;
  return slots;
}

export function parseProvenance(
  input: unknown,
  path = "provenance",
): ParseResult<Provenance> {
  if (!isRecord(input)) return fail(path, "expected an object");
  const method = parseEnum(input.method, `${path}.method`, PROVENANCE_METHODS);
  if (!method.ok) return { ...method, reason: "unknown-kind" };
  const extraKeys = {
    generated: ["generations", "steps"],
    hand: ["editor"],
    derived: ["operation", "runtime", "steps", "resultHashes"],
    rendered: ["revisionRecipe", "slots"],
  }[method.value];
  const unknown = rejectUnknownKeys(
    input,
    [...COMMON_PROVENANCE_KEYS, ...extraKeys],
    path,
  );
  if (unknown) return unknown;

  const licences = parseArray(input.licences, `${path}.licences`, parseLicence);
  if (!licences.ok) return licences;
  if (licences.value.length === 0)
    return fail(`${path}.licences`, "expected at least one licence record");
  const relatedJobs = parseArray(
    input.relatedJobs,
    `${path}.relatedJobs`,
    parseJobRef,
  );
  if (!relatedJobs.ok) return relatedJobs;
  const duplicateJob = uniqueBy(
    relatedJobs.value,
    (job) => job.jobId,
    `${path}.relatedJobs`,
  );
  if (duplicateJob) return duplicateJob;
  const handEdits = parseArray(
    input.handEdits,
    `${path}.handEdits`,
    parseHandEdit,
  );
  if (!handEdits.ok) return handEdits;
  const sourceAssets = parseArray(
    input.sourceAssets,
    `${path}.sourceAssets`,
    parseRevisionRef,
  );
  if (!sourceAssets.ok) return sourceAssets;
  let ownerException: OwnerException | undefined;
  if (input.ownerException !== undefined) {
    const parsed = parseOwnerException(
      input.ownerException,
      `${path}.ownerException`,
    );
    if (!parsed.ok) return parsed;
    ownerException = parsed.value;
  }
  const common = {
    licences: licences.value,
    relatedJobs: relatedJobs.value,
    handEdits: handEdits.value,
    sourceAssets: sourceAssets.value,
    ...(ownerException === undefined ? {} : { ownerException }),
  };

  if (method.value === "hand") {
    if (handEdits.value.length === 0) {
      return fail(
        `${path}.handEdits`,
        "a hand-made asset records at least one edit step",
      );
    }
    let editor: string | undefined;
    if (input.editor !== undefined) {
      const parsed = parseString(input.editor, `${path}.editor`);
      if (!parsed.ok) return parsed;
      editor = parsed.value;
    }
    return ok({
      method: "hand",
      ...(editor === undefined ? {} : { editor }),
      ...common,
    });
  }

  if (method.value === "rendered") {
    const revisionRecipe = parseRenderedRevisionRecipe(
      input.revisionRecipe,
      `${path}.revisionRecipe`,
    );
    if (!revisionRecipe.ok) return revisionRecipe;
    const slots = parseRenderedSlots(
      input.slots,
      `${path}.slots`,
      revisionRecipe.value.hash,
    );
    if (!slots.ok) return slots;
    return ok({
      method: "rendered",
      revisionRecipe: revisionRecipe.value,
      slots: slots.value,
      ...common,
    });
  }

  if (method.value === "derived") {
    const resultHashes = parseSha256List(
      input.resultHashes,
      `${path}.resultHashes`,
    );
    if (!resultHashes.ok) return resultHashes;
    const runtime = parseRuntimeRef(input.runtime, `${path}.runtime`);
    if (!runtime.ok) return runtime;
    if (sourceAssets.value.length === 0) {
      return fail(
        `${path}.sourceAssets`,
        "a derived asset names its source assets",
      );
    }
    const operation = parseString(input.operation, `${path}.operation`);
    if (!operation.ok) return operation;
    const steps = parseStepList(input.steps, path, sourceAssets.value);
    if (!steps.ok) return steps;
    if (steps.value.length === 0)
      return fail(`${path}.steps`, "a derived asset records at least one step");
    return ok({
      method: "derived",
      operation: operation.value,
      runtime: runtime.value,
      steps: steps.value,
      resultHashes: resultHashes.value,
      ...common,
    });
  }

  const generations = parseArray(
    input.generations,
    `${path}.generations`,
    parseGenerationRef,
  );
  if (!generations.ok) return generations;
  if (generations.value.length === 0)
    return fail(`${path}.generations`, "expected at least one generation");
  const duplicate = uniqueBy(
    generations.value,
    (generation) => generation.jobId,
    `${path}.generations`,
  );
  if (duplicate) return duplicate;
  let carried: readonly DerivedStep[] | undefined;
  if (input.steps !== undefined) {
    const steps = parseStepList(input.steps, path, sourceAssets.value);
    if (!steps.ok) return steps;
    if (steps.value.length === 0)
      return fail(`${path}.steps`, "expected at least one step, or none");
    carried = steps.value;
  }
  for (const [index, generation] of generations.value.entries()) {
    const at = `${path}.generations[${index}]`;
    const job = relatedJobs.value.find((ref) => ref.jobId === generation.jobId);
    if (job === undefined)
      return fail(
        `${at}.jobId`,
        `job "${generation.jobId}" is not in relatedJobs`,
      );
    if (job.status !== "succeeded")
      return fail(
        `${at}.jobId`,
        `job "${generation.jobId}" is ${job.status}, not succeeded`,
      );
    const outputs = new Set<string>(job.outputs ?? []);
    const stray = generation.used.find((hash) => !outputs.has(hash));
    if (stray !== undefined)
      return fail(
        `${at}.used`,
        `used hash ${stray} is not an output of job "${generation.jobId}"`,
      );
    const { edit } = generation.request;
    if (edit?.base.kind === "job") {
      const { jobId, output } = edit.base;
      const base = relatedJobs.value.find((ref) => ref.jobId === jobId);
      if (base === undefined)
        return fail(
          `${at}.request.edit.base.jobId`,
          `base job "${jobId}" is not in relatedJobs`,
        );
      if (base.status !== "succeeded")
        return fail(
          `${at}.request.edit.base.jobId`,
          `base job "${jobId}" is ${base.status}, not succeeded`,
        );
      if (!(base.outputs ?? []).includes(output))
        return fail(
          `${at}.request.edit.base.output`,
          `base output ${output} is not an output of job "${jobId}"`,
        );
    }
    if (edit?.base.kind === "published") {
      const { assetId, revision } = edit.base;
      if (
        !sourceAssets.value.some(
          (ref) => ref.assetId === assetId && ref.revision === revision,
        )
      )
        return fail(
          `${at}.request.edit.base.revision`,
          `the published base ${assetId} ${revision} is not among sourceAssets`,
        );
    }
    if (edit?.base.kind === "hand") {
      const { image } = edit.base;
      if (!handEdits.value.some((step) => step.hash === image))
        return fail(
          `${at}.request.edit.base.image`,
          `the hand-authored base ${image} is not recorded in handEdits`,
        );
    }
    const licensed = (subject: string, role: LicenceRole) =>
      licences.value.some(
        (licence) => licence.subject === subject && licence.role === role,
      );
    const needs: [string, LicenceRole][] = [
      [generation.runtime.name, "runtime"],
      [generation.model.id, "model"],
      ...generation.loras.map((ref): [string, LicenceRole] => [ref.id, "lora"]),
      ...(generation.encoder === null
        ? []
        : [[generation.encoder.id, "encoder"] as [string, LicenceRole]]),
      ...(generation.vae === null
        ? []
        : [[generation.vae.id, "vae"] as [string, LicenceRole]]),
    ];
    for (const [subject, role] of needs) {
      if (!licensed(subject, role))
        return fail(
          `${path}.licences`,
          `no ${role} licence record for "${subject}"`,
        );
    }
  }
  return ok({
    method: "generated",
    generations: generations.value,
    ...(carried === undefined ? {} : { steps: carried }),
    ...common,
  });
}

function parseGenerationRef(
  value: unknown,
  path: string,
): ParseResult<GenerationRef> {
  return parseStrictRecord(
    value,
    path,
    [
      "jobId",
      "request",
      "runtime",
      "model",
      "loras",
      "encoder",
      "vae",
      "seed",
      "settings",
      "used",
    ],
    (record) => {
      const jobId = parseSlug(record.jobId, `${path}.jobId`);
      if (!jobId.ok) return jobId;
      const request = parseGenerationRequest(record.request, `${path}.request`);
      if (!request.ok) return request;
      if (request.value.slots.length !== 1 || request.value.batch !== 1)
        return fail(
          `${path}.request`,
          "a generation records the narrowed request: one slot, batch 1",
        );
      if (request.value.recipe !== undefined)
        return fail(
          `${path}.request`,
          "a render is recorded as rendered provenance, never as a generation",
        );
      if (request.value.seed === undefined)
        return fail(`${path}.request`, "a generation records the seed it ran");
      const runtime = parseRuntimeRef(record.runtime, `${path}.runtime`);
      if (!runtime.ok) return runtime;
      const model = parseModelRef(record.model, `${path}.model`);
      if (!model.ok) return model;
      const loras = parseArray(record.loras, `${path}.loras`, parseModelRef);
      if (!loras.ok) return loras;
      const encoder = parseOptionalModelRef(record.encoder, `${path}.encoder`);
      if (!encoder.ok) return encoder;
      const vae = parseOptionalModelRef(record.vae, `${path}.vae`);
      if (!vae.ok) return vae;
      const seed = parseIntegerAtLeast(record.seed, `${path}.seed`, 0);
      if (!seed.ok) return seed;
      if (seed.value !== request.value.seed)
        return fail(`${path}.seed`, "the seed differs from the request's seed");
      const settings = parseGenerationSettings(
        record.settings,
        `${path}.settings`,
      );
      if (!settings.ok) return settings;
      const used = parseSha256List(record.used, `${path}.used`);
      if (!used.ok) return used;
      if (new Set(used.value).size !== used.value.length)
        return fail(`${path}.used`, "expected unique hashes");
      return ok({
        jobId: jobId.value,
        request: request.value,
        runtime: runtime.value,
        model: model.value,
        loras: loras.value,
        encoder: encoder.value,
        vae: vae.value,
        seed: seed.value,
        settings: settings.value,
        used: used.value,
      });
    },
  );
}

function parseOptionalModelRef(
  value: unknown,
  path: string,
): ParseResult<ModelRef | null> {
  return value === null ? ok(null) : parseModelRef(value, path);
}

export function parseOwnerException(
  value: unknown,
  path: string,
): ParseResult<OwnerException> {
  return parseStrictRecord(value, path, ["reason"], (record) => {
    const reason = parseString(record.reason, `${path}.reason`);
    return reason.ok ? ok({ reason: reason.value }) : reason;
  });
}

// --- Manifests --------------------------------------------------------------------

const HEX_COLOUR = /^#[0-9a-f]{6}$/;

function parseAtlas(value: unknown, path: string): ParseResult<Atlas> {
  return parseStrictRecord(
    value,
    path,
    ["blob", "width", "height"],
    (record) => {
      const blob = parseSha256(record.blob, `${path}.blob`);
      if (!blob.ok) return blob;
      const width = parsePositiveInteger(record.width, `${path}.width`);
      if (!width.ok) return width;
      const height = parsePositiveInteger(record.height, `${path}.height`);
      if (!height.ok) return height;
      return ok({ blob: blob.value, width: width.value, height: height.value });
    },
  );
}

function parseSize(
  value: unknown,
  path: string,
): ParseResult<{ w: number; h: number }> {
  return parseStrictRecord(value, path, ["w", "h"], (record) => {
    const w = parsePositiveInteger(record.w, `${path}.w`);
    if (!w.ok) return w;
    const h = parsePositiveInteger(record.h, `${path}.h`);
    if (!h.ok) return h;
    return ok({ w: w.value, h: h.value });
  });
}

interface FrameContext {
  readonly cell: { readonly w: number; readonly h: number };
  readonly atlas: Atlas;
}

function parseFrame(
  value: unknown,
  path: string,
  context: FrameContext,
): ParseResult<Frame> {
  return parseStrictRecord(value, path, ["rect", "durationMs"], (record) => {
    const rect = parseStrictRecord(
      record.rect,
      `${path}.rect`,
      ["x", "y", "w", "h"],
      (r) => {
        const x = parseIntegerAtLeast(r.x, `${path}.rect.x`, 0);
        if (!x.ok) return x;
        const y = parseIntegerAtLeast(r.y, `${path}.rect.y`, 0);
        if (!y.ok) return y;
        const w = parsePositiveInteger(r.w, `${path}.rect.w`);
        if (!w.ok) return w;
        const h = parsePositiveInteger(r.h, `${path}.rect.h`);
        if (!h.ok) return h;
        return ok({ x: x.value, y: y.value, w: w.value, h: h.value });
      },
    );
    if (!rect.ok) return rect;
    const { x, y, w, h } = rect.value;
    if (w !== context.cell.w || h !== context.cell.h) {
      return fail(
        `${path}.rect`,
        `frame size ${w}x${h} differs from the cell ${context.cell.w}x${context.cell.h}`,
      );
    }
    if (x + w > context.atlas.width || y + h > context.atlas.height) {
      return fail(`${path}.rect`, "frame lies outside the atlas");
    }
    const durationMs = parsePositiveInteger(
      record.durationMs,
      `${path}.durationMs`,
    );
    if (!durationMs.ok) return durationMs;
    return ok({ rect: rect.value, durationMs: durationMs.value });
  });
}

function parseFrames(
  value: unknown,
  path: string,
  context: FrameContext,
): ParseResult<readonly Frame[]> {
  const frames = parseArray(value, path, (frame, framePath) =>
    parseFrame(frame, framePath, context),
  );
  if (!frames.ok) return frames;
  if (frames.value.length === 0)
    return fail(path, "expected at least one frame");
  return frames;
}

function parseLoopStart(
  value: unknown,
  path: string,
  frameCount: number,
): ParseResult<number | undefined> {
  if (value === undefined) return ok(undefined);
  const loopStart = parseIntegerAtLeast(value, path, 0);
  if (!loopStart.ok) return loopStart;
  if (loopStart.value >= frameCount)
    return fail(path, "loop start is past the last frame");
  return loopStart;
}

function parsePoint(
  value: unknown,
  path: string,
  cell: { readonly w: number; readonly h: number },
): ParseResult<Point> {
  return parseStrictRecord(value, path, ["x", "y"], (record) => {
    const x = parseIntegerAtLeast(record.x, `${path}.x`, 0);
    if (!x.ok) return x;
    const y = parseIntegerAtLeast(record.y, `${path}.y`, 0);
    if (!y.ok) return y;
    if (x.value > cell.w || y.value > cell.h) {
      return fail(path, `pivot lies outside the ${cell.w}x${cell.h} cell`);
    }
    return ok({ x: x.value, y: y.value });
  });
}

function parseFootprint(value: unknown, path: string): ParseResult<Footprint> {
  return parseSize(value, path);
}

function parsePalette(
  record: Record<string, unknown>,
  path: string,
  vocabulary: AssetVocabulary,
): ParseResult<{ paletteFamily: string; paletteId: string }> {
  const paletteFamily = parseSlug(
    record.paletteFamily,
    `${path}.paletteFamily`,
  );
  if (!paletteFamily.ok) return paletteFamily;
  if (!vocabulary.paletteFamilies.includes(paletteFamily.value)) {
    return fail(
      `${path}.paletteFamily`,
      `unknown palette family "${paletteFamily.value}"`,
    );
  }
  const paletteId = parseSlug(record.paletteId, `${path}.paletteId`);
  if (!paletteId.ok) return paletteId;
  return ok({ paletteFamily: paletteFamily.value, paletteId: paletteId.value });
}

export function parseColourMapping(
  value: unknown,
  path: string,
): ParseResult<ColourMapping> {
  return parseStrictRecord(value, path, ["source", "target"], (record) => {
    const source = parseRampShade(record.source, `${path}.source`);
    if (!source.ok) return source;
    const target = parseRampShade(record.target, `${path}.target`);
    if (!target.ok) return target;
    return ok({ source: source.value, target: target.value });
  });
}

function parseRampShade(value: unknown, path: string): ParseResult<RampShade> {
  return parseStrictRecord(value, path, ["ramp", "index"], (record) => {
    const ramp = parseSlug(record.ramp, `${path}.ramp`);
    if (!ramp.ok) return ramp;
    const index = parseIntegerAtLeast(record.index, `${path}.index`, 0);
    if (!index.ok) return index;
    return ok({ ramp: ramp.value, index: index.value });
  });
}

function parseRealmVariant(
  vocabulary: AssetVocabulary,
  sourceAtlas: Atlas,
): (value: unknown, path: string) => ParseResult<RealmVariant> {
  return (value, path) =>
    parseStrictRecord(
      value,
      path,
      ["paletteFamily", "paletteId", "atlas", "map"],
      (record) => {
        const palette = parsePalette(record, path, vocabulary);
        if (!palette.ok) return palette;
        const atlas = parseAtlas(record.atlas, `${path}.atlas`);
        if (!atlas.ok) return atlas;
        if (
          atlas.value.width !== sourceAtlas.width ||
          atlas.value.height !== sourceAtlas.height
        ) {
          return fail(
            `${path}.atlas`,
            `expected the source atlas size ${sourceAtlas.width}x${sourceAtlas.height}`,
          );
        }
        const map = parseArray(record.map, `${path}.map`, parseColourMapping);
        if (!map.ok) return map;
        if (map.value.length === 0)
          return fail(`${path}.map`, "expected at least one colour mapping");
        const duplicate = uniqueBy(
          map.value,
          (entry) => `${entry.source.ramp}/${entry.source.index}`,
          `${path}.map`,
        );
        if (duplicate) return duplicate;
        return ok({
          paletteFamily: palette.value.paletteFamily,
          paletteId: palette.value.paletteId,
          atlas: atlas.value,
          map: map.value,
        });
      },
    );
}

/** The frame durations, in ms, a state's frame rate range allows. */
export function durationBounds(fps: Range): Range {
  return { min: Math.floor(1000 / fps.max), max: Math.ceil(1000 / fps.min) };
}

function parseSpriteAnimation(
  vocabulary: AssetVocabulary,
  directions: readonly string[],
  cellClass: CellClass | undefined,
  context: FrameContext,
): (value: unknown, path: string) => ParseResult<SpriteAnimation> {
  return (value, path) =>
    parseStrictRecord(
      value,
      path,
      ["state", "direction", "ability", "loopStart", "frames"],
      (record) => {
        const state = parseSlug(record.state, `${path}.state`);
        if (!state.ok) return state;
        if (!vocabulary.states.some((s) => s.id === state.value)) {
          return fail(`${path}.state`, `unknown state "${state.value}"`);
        }
        const rule = stateRuleFor(vocabulary, state.value, cellClass?.id);
        if (rule === undefined) {
          return fail(
            `${path}.state`,
            `state "${state.value}" is not allowed on this cell class`,
          );
        }
        const direction = parseSlug(record.direction, `${path}.direction`);
        if (!direction.ok) return direction;
        if (!directions.includes(direction.value)) {
          return fail(
            `${path}.direction`,
            `direction "${direction.value}" is not declared by the asset`,
          );
        }
        let ability: string | undefined;
        if (rule.perAbility) {
          const parsed = parseSlug(record.ability, `${path}.ability`);
          if (!parsed.ok) return parsed;
          ability = parsed.value;
        } else if (record.ability !== undefined) {
          return fail(
            `${path}.ability`,
            `state "${state.value}" is not bound to an ability`,
          );
        }
        const frames = parseFrames(record.frames, `${path}.frames`, context);
        if (!frames.ok) return frames;
        if (
          frames.value.length < rule.frames.min ||
          frames.value.length > rule.frames.max
        ) {
          return fail(
            `${path}.frames`,
            `state "${state.value}" takes ${rule.frames.min}-${rule.frames.max} frames`,
          );
        }
        if (rule.fps !== undefined) {
          const bounds = durationBounds(rule.fps);
          for (const [index, frame] of frames.value.entries()) {
            if (
              frame.durationMs < bounds.min ||
              frame.durationMs > bounds.max
            ) {
              return fail(
                `${path}.frames[${index}].durationMs`,
                `expected ${bounds.min}-${bounds.max} ms for state "${state.value}"`,
              );
            }
          }
        }
        const loopStart = parseLoopStart(
          record.loopStart,
          `${path}.loopStart`,
          frames.value.length,
        );
        if (!loopStart.ok) return loopStart;
        return ok({
          state: state.value,
          direction: direction.value,
          ...(ability === undefined ? {} : { ability }),
          ...(loopStart.value === undefined
            ? {}
            : { loopStart: loopStart.value }),
          frames: frames.value,
        });
      },
    );
}

function parseSpriteBody(
  record: Record<string, unknown>,
  path: string,
  vocabulary: AssetVocabulary,
  cell: { w: number; h: number },
  cellClass: CellClass | undefined,
  atlas: Atlas,
  common: ManifestCommon,
): ParseResult<SpriteManifest> {
  const pivot = parsePoint(record.pivot, `${path}.pivot`, cell);
  if (!pivot.ok) return pivot;
  const footprint = parseFootprint(record.footprint, `${path}.footprint`);
  if (!footprint.ok) return footprint;
  const directions = parseUniqueSlugs(record.directions, `${path}.directions`);
  if (!directions.ok) return directions;
  for (const [index, direction] of directions.value.entries()) {
    if (!vocabulary.directions.includes(direction)) {
      return fail(
        `${path}.directions[${index}]`,
        `unknown direction "${direction}"`,
      );
    }
  }
  let asymmetry: { feature: string } | undefined;
  if (record.asymmetry !== undefined) {
    const parsed = parseStrictRecord(
      record.asymmetry,
      `${path}.asymmetry`,
      ["feature"],
      (a) => {
        const feature = parseString(a.feature, `${path}.asymmetry.feature`);
        return feature.ok ? ok({ feature: feature.value }) : feature;
      },
    );
    if (!parsed.ok) return parsed;
    asymmetry = parsed.value;
  }
  const realmVariants = parseArray(
    record.realmVariants,
    `${path}.realmVariants`,
    parseRealmVariant(vocabulary, atlas),
  );
  if (!realmVariants.ok) return realmVariants;
  const duplicateRealm = uniqueBy(
    realmVariants.value,
    (v) => v.paletteFamily,
    `${path}.realmVariants`,
  );
  if (duplicateRealm) return duplicateRealm;
  const animations = parseArray(
    record.animations,
    `${path}.animations`,
    parseSpriteAnimation(vocabulary, directions.value, cellClass, {
      cell,
      atlas,
    }),
  );
  if (!animations.ok) return animations;
  if (animations.value.length === 0)
    return fail(`${path}.animations`, "expected at least one animation");
  const duplicate = uniqueBy(
    animations.value,
    (a) => `${a.state}/${a.direction}/${a.ability ?? ""}`,
    `${path}.animations`,
  );
  if (duplicate) return duplicate;
  return ok({
    ...common,
    kind: "sprite",
    pivot: pivot.value,
    footprint: footprint.value,
    directions: directions.value,
    ...(asymmetry === undefined ? {} : { asymmetry }),
    realmVariants: realmVariants.value,
    animations: animations.value,
  });
}

function parsePortraitBody(
  record: Record<string, unknown>,
  path: string,
  vocabulary: AssetVocabulary,
  context: FrameContext,
  common: ManifestCommon,
): ParseResult<PortraitManifest> {
  const characterId = parseSlug(record.characterId, `${path}.characterId`);
  if (!characterId.ok) return characterId;
  const expressions = parseArray(
    record.expressions,
    `${path}.expressions`,
    (value, itemPath) =>
      parseStrictRecord(value, itemPath, ["expression", "frame"], (item) => {
        const expression = parseSlug(item.expression, `${itemPath}.expression`);
        if (!expression.ok) return expression;
        if (!vocabulary.expressions.includes(expression.value)) {
          return fail(
            `${itemPath}.expression`,
            `unknown expression "${expression.value}"`,
          );
        }
        const frame = parseFrame(item.frame, `${itemPath}.frame`, context);
        if (!frame.ok) return frame;
        return ok({ expression: expression.value, frame: frame.value });
      }),
  );
  if (!expressions.ok) return expressions;
  if (expressions.value.length === 0)
    return fail(`${path}.expressions`, "expected at least one expression");
  const duplicate = uniqueBy(
    expressions.value,
    (e) => e.expression,
    `${path}.expressions`,
  );
  if (duplicate) return duplicate;
  return ok({
    ...common,
    kind: "portrait",
    characterId: characterId.value,
    expressions: expressions.value,
  });
}

function parseEffectBody(
  record: Record<string, unknown>,
  path: string,
  vocabulary: AssetVocabulary,
  cell: { w: number; h: number },
  context: FrameContext,
  common: ManifestCommon,
): ParseResult<EffectManifest> {
  const pivot = parsePoint(record.pivot, `${path}.pivot`, cell);
  if (!pivot.ok) return pivot;
  const footprint = parseFootprint(record.footprint, `${path}.footprint`);
  if (!footprint.ok) return footprint;
  const tier = parseIntegerAtLeast(
    record.tier,
    `${path}.tier`,
    vocabulary.tiers.min,
  );
  if (!tier.ok) return tier;
  if (tier.value > vocabulary.tiers.max) {
    return fail(
      `${path}.tier`,
      `expected a tier from ${vocabulary.tiers.min} to ${vocabulary.tiers.max}`,
    );
  }
  const accents = parseArray(
    record.emissiveAccents,
    `${path}.emissiveAccents`,
    (value, itemPath) =>
      typeof value === "string" && HEX_COLOUR.test(value)
        ? ok(value)
        : fail(itemPath, "expected a lowercase #rrggbb colour"),
  );
  if (!accents.ok) return accents;
  if (accents.value.length > vocabulary.effect.maxEmissiveAccents) {
    return fail(
      `${path}.emissiveAccents`,
      `at most ${vocabulary.effect.maxEmissiveAccents} emissive accents`,
    );
  }
  const animations = parseArray(
    record.animations,
    `${path}.animations`,
    (value, itemPath) =>
      parseStrictRecord(
        value,
        itemPath,
        ["name", "loopStart", "frames"],
        (item) => {
          const name = parseSlug(item.name, `${itemPath}.name`);
          if (!name.ok) return name;
          const frames = parseFrames(
            item.frames,
            `${itemPath}.frames`,
            context,
          );
          if (!frames.ok) return frames;
          const loopStart = parseLoopStart(
            item.loopStart,
            `${itemPath}.loopStart`,
            frames.value.length,
          );
          if (!loopStart.ok) return loopStart;
          return ok({
            name: name.value,
            ...(loopStart.value === undefined
              ? {}
              : { loopStart: loopStart.value }),
            frames: frames.value,
          });
        },
      ),
  );
  if (!animations.ok) return animations;
  if (animations.value.length === 0)
    return fail(`${path}.animations`, "expected at least one animation");
  const duplicate = uniqueBy(
    animations.value,
    (a) => a.name,
    `${path}.animations`,
  );
  if (duplicate) return duplicate;
  if (tier.value === vocabulary.tiers.min) {
    for (const animation of animations.value) {
      const total = animation.frames.reduce(
        (sum, frame) => sum + frame.durationMs,
        0,
      );
      if (total >= vocabulary.effect.tierOneMaxMs) {
        return fail(
          `${path}.tier`,
          `a tier ${tier.value} effect runs under ${vocabulary.effect.tierOneMaxMs} ms; "${animation.name}" takes ${total} ms`,
        );
      }
    }
  }
  return ok({
    ...common,
    kind: "effect",
    pivot: pivot.value,
    footprint: footprint.value,
    tier: tier.value,
    emissiveAccents: accents.value,
    animations: animations.value,
  });
}

const MANIFEST_KEYS = [
  "schemaVersion",
  "kind",
  "id",
  "cell",
  "pixelScale",
  "paletteFamily",
  "paletteId",
  "styleTag",
  "atlas",
  "provenance",
] as const;

const KIND_KEYS = {
  sprite: [
    "pivot",
    "footprint",
    "directions",
    "asymmetry",
    "realmVariants",
    "animations",
  ],
  portrait: ["characterId", "expressions"],
  effect: ["pivot", "footprint", "tier", "emissiveAccents", "animations"],
} as const;

type ManifestKind = keyof typeof KIND_KEYS;

export function parseAssetManifest(
  input: unknown,
  vocabulary: AssetVocabulary,
  path = "manifest",
): ParseResult<AssetManifest> {
  if (!isRecord(input)) return fail(path, "expected an object");
  const kind = parseEnum(input.kind, `${path}.kind`, ASSET_KINDS);
  if (!kind.ok) return { ...kind, reason: "unknown-kind" };
  if (!(kind.value in KIND_KEYS)) {
    return fail(
      `${path}.kind`,
      `kind "${kind.value}" manifests arrive with a later unit`,
      "unknown-kind",
    );
  }
  const manifestKind = kind.value as ManifestKind;
  const unknown = rejectUnknownKeys(
    input,
    [...MANIFEST_KEYS, ...KIND_KEYS[manifestKind]],
    path,
  );
  if (unknown) return unknown;
  const schemaVersion = parseSchemaVersion(
    input.schemaVersion,
    ASSET_SCHEMA_VERSIONS,
    `${path}.schemaVersion`,
  );
  if (!schemaVersion.ok) return schemaVersion;
  const id = parseAssetId(input.id, `${path}.id`);
  if (!id.ok) return id;
  const cell = parseSize(input.cell, `${path}.cell`);
  if (!cell.ok) return cell;
  const classes = vocabulary.cells.filter((c) =>
    c.kinds.includes(manifestKind),
  );
  const cellClass = classes.find(
    (c) => c.w === cell.value.w && c.h === cell.value.h,
  );
  if (
    cellClass === undefined &&
    !(manifestKind === "effect" && classes.length === 0)
  ) {
    return fail(
      `${path}.cell`,
      `no ${manifestKind} cell class is ${cell.value.w}x${cell.value.h}`,
    );
  }
  const pixelScale = parsePositiveInteger(
    input.pixelScale,
    `${path}.pixelScale`,
  );
  if (!pixelScale.ok) return pixelScale;
  const palette = parsePalette(input, path, vocabulary);
  if (!palette.ok) return palette;
  const styleTag = parseString(input.styleTag, `${path}.styleTag`);
  if (!styleTag.ok) return styleTag;
  const atlas = parseAtlas(input.atlas, `${path}.atlas`);
  if (!atlas.ok) return atlas;
  const provenance = parseProvenance(input.provenance, `${path}.provenance`);
  if (!provenance.ok) return provenance;
  const common: ManifestCommon = {
    schemaVersion: schemaVersion.value,
    id: id.value,
    cell: cell.value,
    pixelScale: pixelScale.value,
    paletteFamily: palette.value.paletteFamily,
    paletteId: palette.value.paletteId,
    styleTag: styleTag.value,
    atlas: atlas.value,
    provenance: provenance.value,
  };
  const context: FrameContext = { cell: cell.value, atlas: atlas.value };
  const body = (): ParseResult<AssetManifest> => {
    switch (manifestKind) {
      case "sprite":
        return parseSpriteBody(
          input,
          path,
          vocabulary,
          cell.value,
          cellClass,
          atlas.value,
          common,
        );
      case "portrait":
        return parsePortraitBody(input, path, vocabulary, context, common);
      case "effect":
        return parseEffectBody(
          input,
          path,
          vocabulary,
          cell.value,
          context,
          common,
        );
    }
  };
  if (provenance.value.method === "rendered" && manifestKind !== "sprite") {
    return fail(
      `${path}.provenance.method`,
      `a ${manifestKind} is not rendered; only sprites are`,
    );
  }
  const manifest = body();
  if (!manifest.ok) return manifest;
  const recorded = manifest.value.provenance;
  if (recorded.method === "rendered" && manifest.value.kind === "sprite") {
    const { pivot, animations } = manifest.value;
    const recipePivot = recorded.revisionRecipe.pivot;
    if (recipePivot.x !== pivot.x || recipePivot.y !== pivot.y) {
      return fail(
        `${path}.provenance.revisionRecipe.pivot`,
        `the recipe's pivot (${recipePivot.x},${recipePivot.y}) is not the manifest's (${pivot.x},${pivot.y})`,
      );
    }
    for (const [index, slot] of recorded.slots.entries()) {
      const animation = animations.find(
        (a) =>
          a.state === slot.state &&
          a.direction === slot.facing &&
          a.ability === slot.ability,
      );
      if (animation === undefined) {
        return fail(
          `${path}.provenance.slots[${index}]`,
          `slot "${slot.slotKey}" is not in the manifest's animations`,
        );
      }
      if (animation.frames.length !== slot.frameCount) {
        return fail(
          `${path}.provenance.slots[${index}].frameCount`,
          `the manifest's "${slot.slotKey}" has ${animation.frames.length} frames, the render ${slot.frameCount}`,
        );
      }
    }
  }
  const carried =
    recorded.method === "derived" || recorded.method === "generated"
      ? recorded.steps
      : undefined;
  if (carried === undefined) return manifest;
  const slots = new Set(slotKeys(manifest.value));
  for (const [index, step] of carried.entries()) {
    if (!slots.has(step.outputSlot)) {
      return fail(
        `${path}.provenance.steps[${index}].outputSlot`,
        `slot "${step.outputSlot}" is not in the manifest's animations`,
      );
    }
  }
  return manifest;
}

/** The slot keys a manifest holds: `state/direction[/ability]`, an expression, or an effect animation's name. */
export function slotKeys(manifest: AssetManifest): readonly string[] {
  switch (manifest.kind) {
    case "sprite":
      return manifest.animations.map(
        (a) =>
          `${a.state}/${a.direction}${a.ability === undefined ? "" : `/${a.ability}`}`,
      );
    case "portrait":
      return manifest.expressions.map((e) => e.expression);
    case "effect":
      return manifest.animations.map((a) => a.name);
  }
}

/** The exact text a published manifest is stored as. */
export function canonicalManifestText(manifest: AssetManifest): string {
  return `${canonicalJson(manifest)}\n`;
}

// --- Registry index ------------------------------------------------------------------

export interface RegistryIndexEntry {
  readonly assetId: AssetId;
  readonly revision: Sha256;
}

export interface RegistryIndex {
  readonly schemaVersion: number;
  readonly entries: readonly RegistryIndexEntry[];
}

export function parseRegistryIndex(
  input: unknown,
  path = "index",
): ParseResult<RegistryIndex> {
  return parseStrictRecord(
    input,
    path,
    ["schemaVersion", "entries"],
    (record) => {
      const schemaVersion = parseSchemaVersion(
        record.schemaVersion,
        ASSET_SCHEMA_VERSIONS,
        `${path}.schemaVersion`,
      );
      if (!schemaVersion.ok) return schemaVersion;
      const entries = parseArray(
        record.entries,
        `${path}.entries`,
        (value, entryPath) =>
          parseStrictRecord(
            value,
            entryPath,
            ["assetId", "revision"],
            (entry) => {
              const assetId = parseAssetId(
                entry.assetId,
                `${entryPath}.assetId`,
              );
              if (!assetId.ok) return assetId;
              const revision = parseSha256(
                entry.revision,
                `${entryPath}.revision`,
              );
              if (!revision.ok) return revision;
              return ok({ assetId: assetId.value, revision: revision.value });
            },
          ),
      );
      if (!entries.ok) return entries;
      for (let i = 1; i < entries.value.length; i += 1) {
        const previous = entries.value[i - 1] as RegistryIndexEntry;
        const current = entries.value[i] as RegistryIndexEntry;
        if (previous.assetId >= current.assetId) {
          return fail(
            `${path}.entries[${i}]`,
            "entries are sorted by asset id, without duplicates",
          );
        }
      }
      return ok({ schemaVersion: schemaVersion.value, entries: entries.value });
    },
  );
}

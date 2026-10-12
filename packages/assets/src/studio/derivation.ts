// Derivation at the session level: the `derive` op that turns a published
// revision into a working set of derived slots, and the recompute that pack and
// publish share. The recipes themselves are pure (derive.ts); this module reads
// the published source, applies a recipe with the subject's declaration, and
// stores the result as a normal working set that pack, approve and publish run
// on as they do for drawn art.

import type {
  AssetId,
  AssetManifest,
  AssetVocabulary,
  ColourMapping,
  DerivedStep,
  Sha256,
} from "@panthea/contracts";
import { canonicalJson, parseAssetId, parseSlug } from "@panthea/contracts";
import type { RgbaImage } from "../conformance";
import { sha256Hex } from "../hash";
import { type Palette, type PaletteRamp, paletteDigest } from "../palette";
import { readRevision } from "../registry";
import type { CandidateParams } from "./candidates";
import {
  type BobParams,
  type Box,
  bobSlot,
  type Derivation,
  type DeriveRefusal,
  mirrorSlot,
  RECIPE_VERSION,
  type RefusalReason,
  type SlotInput,
  swapImage,
  swapPalette,
} from "./derive";
import type { EditHost } from "./edit-session";
import { decodePng } from "./png/decode";
import { newRequestRecord, type StudioContent } from "./request";
import type { Store } from "./store";
import {
  type DerivedEntry,
  deriveStatus,
  newWorkingSet,
  type VariantRequest,
  type WorkingSetRecord,
} from "./working-set";

export const DERIVE_OPS = ["mirror", "palette-swap", "bob"] as const;
export type DeriveOp = (typeof DERIVE_OPS)[number];

export interface DeriveInput {
  /** The published asset to derive from. */
  readonly asset: string;
  readonly op: string;
  /** The source slot key (mirror, bob), or for a palette swap the asset's own palette family. */
  readonly from: string;
  /** The output slot (mirror, bob: must be the one the recipe makes), or for a palette swap the target palette family. */
  readonly to?: string;
  /** Recipe params; a bob takes `BobParams`, a swap may name its ramp pairs, a mirror takes none. */
  readonly params?: unknown;
}

export type DeriveFailure =
  | "closed"
  | "not-found"
  | "wrong-state"
  | "invalid-params"
  | "write-failed"
  | RefusalReason;

export type DeriveResult =
  | {
      readonly ok: true;
      readonly workingSetId: string;
      /** False when the same inputs had already made this working set. */
      readonly created: boolean;
      /** The slots (or, for a swap, the realm palette families) the set derives. */
      readonly slots: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: DeriveFailure;
      readonly message: string;
    };

export interface DeriveOps {
  derive(
    input: DeriveInput,
    content: StudioContent,
    registryRoot: string,
  ): DeriveResult;
}

/** The conformance a derived cell is measured with when its source recorded none in this studio. */
const DEFAULT_CONFORM: CandidateParams = {
  background: { type: "alpha" },
  alphaCutoff: 128,
  grid: { edgeTolerance: 8, minConfidence: 0.6, minEdges: 20 },
  scale: null,
};

const failure = (reason: DeriveFailure, message: string) =>
  ({ ok: false, reason, message }) as const;

// --- Reading a published source -----------------------------------------------------------

export interface PublishedSource {
  readonly manifest: AssetManifest;
  readonly atlas: Uint8Array;
}

export function slotKeyOf(a: {
  readonly state: string;
  readonly direction: string;
  readonly ability?: string;
}): string {
  return `${a.state}/${a.direction}${a.ability === undefined ? "" : `/${a.ability}`}`;
}

function cropImage(
  image: RgbaImage,
  x: number,
  y: number,
  w: number,
  h: number,
): RgbaImage {
  const rgba = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row += 1)
    rgba.set(
      image.rgba.subarray(
        ((y + row) * image.width + x) * 4,
        ((y + row) * image.width + x + w) * 4,
      ),
      row * w * 4,
    );
  return { rgba, width: w, height: h };
}

/** A sprite slot of a published revision, cut from its atlas. */
export function readSlot(
  source: PublishedSource,
  key: string,
):
  | { readonly ok: true; readonly slot: SlotInput }
  | { readonly ok: false; readonly message: string } {
  const { manifest } = source;
  if (manifest.kind !== "sprite")
    return { ok: false, message: `${manifest.id} is not a sprite` };
  const animation = manifest.animations.find((a) => slotKeyOf(a) === key);
  if (animation === undefined)
    return { ok: false, message: `${manifest.id} has no slot ${key}` };
  const atlas = decodePng(source.atlas);
  if (!atlas.ok)
    return { ok: false, message: "the published atlas cannot be decoded" };
  return {
    ok: true,
    slot: {
      key,
      frames: animation.frames.map((frame) => ({
        image: cropImage(
          atlas.image,
          frame.rect.x,
          frame.rect.y,
          frame.rect.w,
          frame.rect.h,
        ),
        durationMs: frame.durationMs,
      })),
      ...(animation.loopStart === undefined
        ? {}
        : { loopStart: animation.loopStart }),
    },
  };
}

/** The ramps of a palette family by id. */
function rampsOf(palette: Palette, family: string): readonly PaletteRamp[] {
  return palette.families.find((f) => f.id === family)?.ramps ?? [];
}

/** Every ramp of the palette by id, across families. */
export function rampIndex(palette: Palette): ReadonlyMap<string, PaletteRamp> {
  return new Map(
    palette.families.flatMap((f) => f.ramps.map((r) => [r.id, r] as const)),
  );
}

// --- Subject and recipe parameters -------------------------------------------------------

/** The god whose stable sprite id is `asset`. */
function subjectOf(content: StudioContent, asset: string) {
  return content.gods.find((g) => g.sprite === asset);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isInt = (v: unknown): v is number => Number.isInteger(v);

function readBox(value: unknown): Box | undefined {
  if (!isObject(value)) return undefined;
  const { x, y, w, h } = value;
  return isInt(x) && isInt(y) && isInt(w) && isInt(h)
    ? { x, y, w, h }
    : undefined;
}

/** `BobParams` from stored or supplied JSON, or the reason it is not one. */
export function readBobParams(
  value: unknown,
): { ok: true; params: BobParams } | { ok: false; message: string } {
  const bad = (message: string) => ({ ok: false, message }) as const;
  if (!isObject(value)) return bad("bob params must be an object");
  const region = readBox(value.region);
  if (region === undefined) return bad("bob params need an integer region");
  if (!Array.isArray(value.exclude))
    return bad("bob params need an exclude list");
  const exclude = value.exclude.map(readBox);
  if (exclude.some((b) => b === undefined))
    return bad("bob exclude boxes must be integer boxes");
  if (!Array.isArray(value.dy) || !value.dy.every(isInt))
    return bad("bob params need integer dy values");
  if (!Array.isArray(value.durationsMs) || !value.durationsMs.every(isInt))
    return bad("bob params need integer durationsMs");
  if (value.seam !== "fill-from-fixed" && value.seam !== "none")
    return bad('bob seam must be "fill-from-fixed" or "none"');
  if (!Array.isArray(value.repairs))
    return bad("bob params need a repairs list");
  const repairs: BobParams["repairs"][number][] = [];
  for (const entry of value.repairs) {
    if (
      !isObject(entry) ||
      !isInt(entry.frame) ||
      !isInt(entry.x) ||
      !isInt(entry.y) ||
      typeof entry.colour !== "string"
    )
      return bad("each bob repair is {frame, x, y, colour}");
    repairs.push({
      frame: entry.frame,
      x: entry.x,
      y: entry.y,
      colour: entry.colour,
    });
  }
  if (value.loopStart !== undefined && !isInt(value.loopStart))
    return bad("bob loopStart must be an integer");
  return {
    ok: true,
    params: {
      region,
      exclude: exclude as Box[],
      dy: value.dy,
      durationsMs: value.durationsMs,
      seam: value.seam,
      repairs,
      ...(value.loopStart === undefined ? {} : { loopStart: value.loopStart }),
    },
  };
}

/** The frame count and duration bounds of the vocabulary's idle state. */
function idleLimits(vocabulary: AssetVocabulary) {
  const rule = vocabulary.states.find((s) => s.id === "idle");
  if (rule === undefined || rule.fps === undefined) return undefined;
  return {
    frames: rule.frames,
    durationMs: {
      min: Math.floor(1000 / rule.fps.max),
      max: Math.ceil(1000 / rule.fps.min),
    },
  };
}

/**
 * A breathing loop for a rest frame when the caller gives no params: the upper
 * part of the figure rises one pixel on the third frame, and the others hold.
 * The values are recorded in the step like any params.
 */
export function defaultBobParams(
  rest: RgbaImage,
  limits: NonNullable<ReturnType<typeof idleLimits>>,
): BobParams {
  let top = rest.height;
  let bottom = -1;
  for (let y = 0; y < rest.height; y += 1)
    for (let x = 0; x < rest.width; x += 1)
      if ((rest.rgba[(y * rest.width + x) * 4 + 3] as number) > 0) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  const height = Math.max(1, Math.floor(((bottom - top + 1) * 55) / 100));
  const count = limits.frames.min;
  const hold = Math.min(
    limits.durationMs.max,
    Math.max(limits.durationMs.min, 333),
  );
  const quick = Math.min(
    limits.durationMs.max,
    Math.max(limits.durationMs.min, 167),
  );
  return {
    region: { x: 0, y: Math.max(0, top), w: rest.width, h: height },
    exclude: [],
    dy: Array.from({ length: count }, (_, i) => (i === 2 ? -1 : 0)),
    durationsMs: Array.from({ length: count }, (_, i) =>
      i % 2 === 0 ? hold : quick,
    ),
    seam: "fill-from-fixed",
    repairs: [],
  };
}

// --- Recompute (shared by derive, pack and publish) -----------------------------------------

export interface RecomputeContext {
  readonly source: PublishedSource;
  readonly content: StudioContent;
  /** The god whose declaration governs the recipe. */
  readonly subject: string;
}

/**
 * Runs the recipe a step records over its published source and returns what the
 * recipe makes now. A step recorded under a recipe version this build does not
 * implement is refused, not recomputed under newer code.
 */
export function recomputeStep(
  step: DerivedStep,
  ctx: RecomputeContext,
): Derivation | DeriveRefusal {
  const refuse = (reason: RefusalReason, message: string): DeriveRefusal => ({
    ok: false,
    reason,
    message,
  });
  const { manifest } = ctx.source;
  if (manifest.kind !== "sprite")
    return refuse("non-derivable", `${manifest.id} is not a sprite`);
  const known = (RECIPE_VERSION as Record<string, number>)[step.recipe];
  if (known === undefined)
    return refuse("non-derivable", `unknown recipe "${step.recipe}"`);
  if (step.version !== known)
    return refuse(
      "non-derivable",
      `recipe ${step.recipe} was recorded at version ${step.version}; this build implements version ${known}`,
    );
  const read = readSlot(ctx.source, step.source.slotKey);
  if (!read.ok) return refuse("invalid-params", read.message);
  const source = {
    assetId: step.source.assetId,
    revision: step.source.revision,
  };
  const subject =
    ctx.content.visuals.find((v) => v.godId === ctx.subject) ?? {};
  const geometry = {
    cell: manifest.cell,
    pivot: manifest.pivot,
    footprint: manifest.footprint,
  };
  switch (step.recipe) {
    case "mirror":
      return mirrorSlot({
        source,
        slot: read.slot,
        subject,
        geometry,
        version: step.version,
      });
    case "bob": {
      const params = readBobParams(step.params);
      if (!params.ok) return refuse("invalid-params", params.message);
      const limits = idleLimits(ctx.content.vocabulary);
      if (limits === undefined)
        return refuse("non-derivable", "the vocabulary has no idle bounds");
      return bobSlot({
        source,
        slot: read.slot,
        geometry,
        limits,
        params: params.params,
        version: step.version,
      });
    }
    default: {
      const { sourceFamily, targetFamily, ramps } = step.params as {
        sourceFamily?: string;
        targetFamily?: string;
        ramps?: { source: string; target: string }[];
      };
      if (
        typeof sourceFamily !== "string" ||
        typeof targetFamily !== "string" ||
        !Array.isArray(ramps)
      )
        return refuse("invalid-params", "the swap step's params are malformed");
      const pairs = [];
      for (const pair of ramps) {
        const from = rampsOf(ctx.content.palette, sourceFamily).find(
          (r) => r.id === pair.source,
        );
        const to = rampsOf(ctx.content.palette, targetFamily).find(
          (r) => r.id === pair.target,
        );
        if (from === undefined || to === undefined)
          return refuse(
            "invalid-params",
            `the palette lacks ramp ${pair.source} of ${sourceFamily} or ${pair.target} of ${targetFamily}`,
          );
        pairs.push({ source: from, target: to });
      }
      return swapPalette({
        source,
        slots: [read.slot],
        sourceFamily,
        targetFamily,
        pairs,
        version: step.version,
      });
    }
  }
}

/** A step recomputed must equal the step recorded: recipe, params, source slot hash and result hash. */
export const sameStep = (a: DerivedStep, b: DerivedStep): boolean =>
  canonicalJson(a) === canonicalJson(b);

/**
 * Regenerates one realm variant's atlas from a source atlas under the
 * variant's recorded colour map; the variant is a recolour, never a redraw.
 */
export function regenerateVariantAtlas(
  atlasPng: Uint8Array,
  map: readonly ColourMapping[],
  palette: Palette,
):
  | { readonly ok: true; readonly png: Uint8Array }
  | {
      readonly ok: false;
      readonly reason: RefusalReason;
      readonly message: string;
    } {
  const decoded = decodePng(atlasPng);
  if (!decoded.ok)
    return {
      ok: false,
      reason: "invalid-params",
      message: "the atlas cannot be decoded",
    };
  const swapped = swapImage(decoded.image, map, rampIndex(palette));
  return swapped.ok
    ? { ok: true, png: swapped.png }
    : { ok: false, reason: swapped.reason, message: swapped.message };
}

const normalise = (rgba: Uint8Array): Uint8Array => {
  const out = Uint8Array.from(rgba);
  for (let at = 0; at < out.length; at += 4)
    if (out[at + 3] === 0) out.fill(0, at, at + 3);
  return out;
};

/** The pixels of one animation's frames in a manifest's atlas, RGB under alpha 0 taken as zero. */
function atlasFrames(
  manifest: AssetManifest,
  atlas: RgbaImage,
  key: string,
): { rgba: Uint8Array; durationMs: number }[] | undefined {
  if (manifest.kind !== "sprite") return undefined;
  const animation = manifest.animations.find((a) => slotKeyOf(a) === key);
  if (animation === undefined) return undefined;
  return animation.frames.map((frame) => ({
    rgba: normalise(
      cropImage(atlas, frame.rect.x, frame.rect.y, frame.rect.w, frame.rect.h)
        .rgba,
    ),
    durationMs: frame.durationMs,
  }));
}

export interface DerivationAudit {
  readonly manifest: AssetManifest;
  /** The packed atlas the manifest names. */
  readonly atlas: Uint8Array;
  /** The atlas of each realm variant, by hash. */
  readonly variantAtlases: ReadonlyMap<Sha256, Uint8Array>;
  /** The published revisions the manifest names as sources, by revision. */
  readonly sources: ReadonlyMap<Sha256, PublishedSource>;
  readonly content: StudioContent;
  readonly subject: string;
}

/**
 * Recomputes everything a manifest says was derived, through the pinned
 * encoder, and compares: every step from its published source (recipe, params,
 * source slot hash and result hash), the pixels and timings of the slot it made
 * (or, for a palette swap, of the variant cell), and every realm variant
 * regenerated from the packed atlas under its recorded map. Returns the first
 * mismatch, naming the step or the variant, or undefined when all agree.
 */
export function auditDerivation(audit: DerivationAudit): string | undefined {
  const { manifest } = audit;
  if (manifest.kind !== "sprite") return undefined;
  const packed = decodePng(audit.atlas);
  if (!packed.ok) return "the packed atlas cannot be decoded";

  if (manifest.provenance.method === "derived") {
    for (const step of manifest.provenance.steps) {
      const named = `derived step ${step.recipe} -> ${step.outputSlot}`;
      const source = audit.sources.get(step.source.revision);
      if (source === undefined || source.manifest.id !== step.source.assetId)
        return `${named}: its source revision ${step.source.assetId} ${step.source.revision} is not one of the manifest's source assets`;
      const again = recomputeStep(step, {
        source,
        content: audit.content,
        subject: audit.subject,
      });
      if (!again.ok) return `${named}: ${again.message}`;
      const made = again.steps[0];
      if (made === undefined || !sameStep(made, step))
        return `${named}: recomputing it from its published source gives a different step (result ${made?.resultHash ?? "none"}, recorded ${step.resultHash})`;
      const slot = again.slots[0];
      if (slot === undefined) return `${named}: the recipe made no slot`;
      let held: { rgba: Uint8Array; durationMs: number }[] | undefined;
      if (step.recipe === "palette-swap") {
        const variant = manifest.realmVariants.find(
          (v) =>
            v.paletteFamily ===
            (step.params as { targetFamily?: string }).targetFamily,
        );
        const bytes =
          variant === undefined
            ? undefined
            : audit.variantAtlases.get(variant.atlas.blob);
        const decoded = bytes === undefined ? undefined : decodePng(bytes);
        held =
          decoded?.ok === true
            ? atlasFrames(manifest, decoded.image, step.outputSlot)
            : undefined;
      } else {
        held = atlasFrames(manifest, packed.image, step.outputSlot);
      }
      if (held === undefined || held.length !== slot.frames.length)
        return `${named}: the manifest does not hold the frames the recipe makes`;
      for (const [index, frame] of slot.frames.entries()) {
        const have = held[index];
        if (
          have === undefined ||
          have.durationMs !== frame.durationMs ||
          have.rgba.length !== frame.image.rgba.length ||
          have.rgba.some((v, i) => v !== frame.image.rgba[i])
        )
          return `${named}: frame ${index} is not what the recipe makes from its source`;
      }
      if (step.recipe !== "palette-swap") {
        const animation = manifest.animations.find(
          (a) => slotKeyOf(a) === step.outputSlot,
        );
        if (animation?.loopStart !== slot.loopStart)
          return `${named}: the loop start is not what the recipe makes`;
      }
    }
  }

  const ramps = rampIndex(audit.content.palette);
  for (const variant of manifest.realmVariants) {
    const named = `the ${variant.paletteFamily} realm variant`;
    const held = audit.variantAtlases.get(variant.atlas.blob);
    if (held === undefined)
      return `${named}: its atlas ${variant.atlas.blob} is missing`;
    if (sha256Hex(held) !== variant.atlas.blob)
      return `${named}: its atlas does not match its hash`;
    const swapped = swapImage(packed.image, variant.map, ramps);
    if (!swapped.ok) return `${named}: ${swapped.message}`;
    if (
      swapped.png.length !== held.length ||
      swapped.png.some((v, i) => v !== held[i])
    )
      return `${named}: its atlas is not the packed atlas recoloured under its recorded map`;
  }
  return undefined;
}

// --- The derive op ---------------------------------------------------------------------------------

/** The working set id for these inputs: the same inputs always name the same set. */
function setIdFor(identity: unknown): string {
  const hash = sha256Hex(new TextEncoder().encode(canonicalJson(identity)));
  return `derive-${hash.slice(0, 12)}`;
}

/** The recorded conformance of a published slot in this studio, else the default. */
function conformanceOf(
  store: Store,
  assetId: string,
  revision: Sha256,
  slotKey: string,
  fallback: DerivedEntry["palette"],
): { params: CandidateParams; palette: DerivedEntry["palette"] } {
  for (const asset of store.status().assets) {
    if (asset.assetId !== assetId || asset.published?.revision !== revision)
      continue;
    const set = store.readWorkingSet(asset.workingSetId);
    if (set.kind !== "found") continue;
    const authored = set.value.frames[slotKey];
    if (authored !== undefined) {
      const edit = store.readEdit(authored.editId);
      const evidence =
        edit.kind === "found" ? edit.value.evidence[slotKey] : undefined;
      if (evidence !== undefined) return evidence;
    }
    const pick = set.value.picks[slotKey];
    if (pick !== undefined)
      return { params: pick.params, palette: pick.palette };
    const derived = set.value.derived?.[slotKey];
    if (derived !== undefined)
      return { params: derived.params, palette: derived.palette };
  }
  return { params: DEFAULT_CONFORM, palette: fallback };
}

const hexOf = (rgb: readonly number[]) =>
  `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

function paletteFacts(
  content: StudioContent,
  family: string,
): DerivedEntry["palette"] {
  const seen = new Set<string>();
  const colours: string[] = [];
  for (const ramp of rampsOf(content.palette, family))
    for (const shade of ramp.shades) {
      const colour = hexOf(shade);
      if (!seen.has(colour)) {
        seen.add(colour);
        colours.push(colour);
      }
    }
  return {
    id: content.palette.id,
    family,
    digest:
      content.palette.approval.status === "approved"
        ? paletteDigest(content.palette)
        : null,
    colours,
  };
}

export function createDeriveOps(
  host: EditHost,
  currentRevision: (
    root: string,
    assetId: string,
  ) => { ok: true; value: Sha256 | null } | { ok: false; message: string },
): DeriveOps {
  const { store } = host;

  function derive(
    input: DeriveInput,
    content: StudioContent,
    registryRoot: string,
  ): DeriveResult {
    if (host.isClosed())
      return failure("closed", "the session is closed; open a new one");
    const op = DERIVE_OPS.find((o) => o === input.op);
    if (op === undefined)
      return failure(
        "invalid-params",
        `op must be one of ${DERIVE_OPS.join(", ")}`,
      );
    const assetId = parseAssetId(input.asset, "asset");
    if (!assetId.ok)
      return failure("invalid-params", `${assetId.path}: ${assetId.message}`);
    const god = subjectOf(content, input.asset);
    if (god === undefined)
      return failure(
        "not-found",
        `no subject owns ${input.asset}: derivation reads the subject's declarations`,
      );
    const current = currentRevision(registryRoot, input.asset);
    if (!current.ok) return failure("wrong-state", current.message);
    if (current.value === null)
      return failure("not-found", `${input.asset} has no published revision`);
    const read = readRevision(
      registryRoot,
      assetId.value,
      current.value,
      content.vocabulary,
    );
    if (!read.ok)
      return failure(
        "wrong-state",
        `the published revision cannot be read: ${read.message}`,
      );
    const source: PublishedSource = {
      manifest: read.value.manifest,
      atlas: read.value.atlas,
    };
    const { manifest } = source;
    if (manifest.kind !== "sprite")
      return failure("non-derivable", `${input.asset} is not a sprite`);
    const revision = current.value;
    const refer = { assetId: assetId.value, revision };

    const subject = content.visuals.find((v) => v.godId === god.id) ?? {};
    let slots: SlotInput[] = [];
    let derivation: Derivation | DeriveRefusal;
    let outputKeys: string[] = [];
    let variant: VariantRequest | undefined;
    const geometry = {
      cell: manifest.cell,
      pivot: manifest.pivot,
      footprint: manifest.footprint,
    };

    if (op === "palette-swap") {
      if (input.from !== manifest.paletteFamily)
        return failure(
          "invalid-params",
          `${input.asset} is in the ${manifest.paletteFamily} palette family, not ${input.from}`,
        );
      const target = input.to;
      if (target === undefined)
        return failure(
          "invalid-params",
          "a palette swap needs the target palette family in `to`",
        );
      if (!content.vocabulary.paletteFamilies.includes(target))
        return failure("invalid-params", `unknown palette family "${target}"`);
      if (target === manifest.paletteFamily)
        return failure(
          "invalid-params",
          `${input.asset} is already in the ${target} palette family`,
        );
      const sourceRamps = rampsOf(content.palette, input.from);
      const targetRamps = rampsOf(content.palette, target);
      let pairs: { source: PaletteRamp; target: PaletteRamp }[];
      const given = isObject(input.params) ? input.params.ramps : undefined;
      if (given !== undefined) {
        if (!Array.isArray(given))
          return failure(
            "invalid-params",
            "ramps must be a list of [source, target]",
          );
        pairs = [];
        for (const entry of given) {
          const [s, t] = Array.isArray(entry) ? entry : [];
          const from = sourceRamps.find((r) => r.id === s);
          const to = targetRamps.find((r) => r.id === t);
          if (from === undefined || to === undefined)
            return failure(
              "invalid-params",
              `ramp pair ${String(s)} -> ${String(t)} is not in ${input.from} -> ${target}`,
            );
          pairs.push({ source: from, target: to });
        }
      } else {
        if (sourceRamps.length !== targetRamps.length)
          return failure(
            "ramp-length",
            `${input.from} has ${sourceRamps.length} ramps and ${target} has ${targetRamps.length}`,
          );
        pairs = sourceRamps.map((r, i) => ({
          source: r,
          target: targetRamps[i] as PaletteRamp,
        }));
      }
      const all: SlotInput[] = [];
      for (const animation of manifest.animations) {
        const slot = readSlot(source, slotKeyOf(animation));
        if (!slot.ok) return failure("wrong-state", slot.message);
        all.push(slot.slot);
      }
      slots = all;
      derivation = swapPalette({
        source: refer,
        slots: all,
        sourceFamily: input.from,
        targetFamily: target,
        pairs,
      });
      if (derivation.ok) {
        const swapped = derivation as Derivation & {
          map: readonly ColourMapping[];
        };
        variant = {
          paletteFamily: target,
          map: swapped.map,
          steps: derivation.steps,
        };
        outputKeys = [target];
      }
    } else {
      const read = readSlot(source, input.from);
      if (!read.ok) return failure("not-found", read.message);
      slots = [read.slot];
      if (op === "mirror") {
        if (
          input.params !== undefined &&
          !(isObject(input.params) && Object.keys(input.params).length === 0)
        )
          return failure("invalid-params", "a mirror takes no params");
        derivation = mirrorSlot({
          source: refer,
          slot: read.slot,
          subject,
          geometry,
        });
      } else {
        const limits = idleLimits(content.vocabulary);
        if (limits === undefined)
          return failure("non-derivable", "the vocabulary has no idle bounds");
        const first = read.slot.frames[0]?.image;
        let params: BobParams;
        if (input.params === undefined) {
          if (first === undefined)
            return failure(
              "invalid-params",
              `slot ${input.from} has no frames`,
            );
          params = defaultBobParams(first, limits);
        } else {
          const parsed = readBobParams(input.params);
          if (!parsed.ok) return failure("invalid-params", parsed.message);
          params = parsed.params;
        }
        derivation = bobSlot({
          source: refer,
          slot: read.slot,
          geometry,
          limits,
          params,
        });
      }
      if (derivation.ok) outputKeys = derivation.slots.map((s) => s.key);
    }
    if (!derivation.ok) return failure(derivation.reason, derivation.message);
    if (
      input.to !== undefined &&
      op !== "palette-swap" &&
      !outputKeys.includes(input.to)
    )
      return failure(
        "invalid-params",
        `${op} of ${input.from} makes ${outputKeys.join(", ")}, not ${input.to}`,
      );

    const setId = setIdFor({
      asset: input.asset,
      revision,
      op,
      from: input.from,
      to: input.to ?? null,
      steps: derivation.steps,
    });
    const existing = store.readWorkingSet(setId);
    if (existing.kind === "found")
      return {
        ok: true,
        workingSetId: setId,
        created: false,
        slots: outputKeys,
      };
    if (existing.kind === "invalid")
      return failure(
        "wrong-state",
        `working set ${setId} is invalid: ${existing.message}`,
      );
    if (!parseSlug(setId, "id").ok)
      return failure("invalid-params", "the derived working set id is invalid");

    // A request stands behind the set, as for drawn art; it queues no job.
    const requestSlots =
      op === "palette-swap"
        ? slots.map((s) => slotRequest(s.key))
        : derivation.slots.map((s) => slotRequest(s.key));
    const made = newRequestRecord(
      content,
      {
        id: setId,
        subject: god.id,
        kind: "sprite",
        slots: requestSlots,
        batch: 1,
        seed: 0,
      },
      () => 0,
    );
    if (!made.ok) return failure("invalid-params", JSON.stringify(made.error));
    const request = made.value.record;
    const opened = newWorkingSet(setId, request, content);
    if (!opened.ok) return failure(opened.reason, opened.message);
    const fallback = paletteFacts(content, manifest.paletteFamily);

    let record: WorkingSetRecord;
    const blobs: Uint8Array[] = [];
    if (variant !== undefined) {
      // A swap adds a realm variant; it replaces no slot, so the set requires none.
      record = {
        ...opened.record,
        required: [],
        limits: {},
        variants: { [variant.paletteFamily]: variant },
        status: deriveStatus("sprite", [], {}, {}, {}),
      };
    } else {
      const derived: Record<string, DerivedEntry> = {};
      for (const [index, slot] of derivation.slots.entries()) {
        const step = derivation.steps[index];
        if (step === undefined)
          return failure("wrong-state", "a step is missing");
        const recorded = conformanceOf(
          store,
          input.asset,
          revision,
          step.source.slotKey,
          fallback,
        );
        for (const frame of slot.frames) blobs.push(frame.png);
        derived[slot.key] = {
          step,
          frames: slot.frames.map((frame) => ({
            hash: sha256Hex(frame.png),
            durationMs: frame.durationMs,
          })),
          ...(slot.loopStart === undefined
            ? {}
            : { loopStart: slot.loopStart }),
          params: recorded.params,
          palette: recorded.palette,
        };
      }
      record = {
        ...opened.record,
        derived,
        status: deriveStatus(
          opened.record.kind,
          opened.record.required,
          opened.record.picks,
          opened.record.frames,
          opened.record.limits,
          derived,
        ),
      };
    }

    const stored = host.write(() => {
      for (const png of blobs) store.putBlob(png);
      store.putRequest(request);
    });
    if (!stored.ok)
      return failure(stored.reason as DeriveFailure, stored.message);
    const written = host.ledgered("derive", setId, () =>
      store.putWorkingSet(record),
    );
    if (!written.ok)
      return failure(written.reason as DeriveFailure, written.message);
    return { ok: true, workingSetId: setId, created: true, slots: outputKeys };
  }

  return { derive };
}

function slotRequest(key: string): {
  state: string;
  direction: string;
  ability?: string;
} {
  const [state = "", direction = "", ability] = key.split("/");
  return { state, direction, ...(ability === undefined ? {} : { ability }) };
}

export type { AssetId };

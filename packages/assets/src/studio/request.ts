// Request building: joins a god's core and visual profiles, the asset
// vocabulary and the master palette into an explicit generation spec, and
// expands a root request into narrowed per-slot jobs. Pure; the seed supplier
// is the only source of randomness and is called at most once per request.
// Same spec and seed give the same adapter inputs; nothing here promises the
// same output bytes from the model.

import type { GodProfile, GodVisualProfile } from "@panthea/content";
import {
  type AssetVocabulary,
  type GenerationEdit,
  type GenerationJob,
  type GenerationRequest,
  type GenerationSlot,
  isRecipeRequest,
  type Point,
  type ProviderDescriptor,
  parseGenerationRequest,
  parseSlug,
  RECIPE_SEED,
  stateIds,
  stateRuleFor,
} from "@panthea/contracts";
import type { Palette, PaletteRamp } from "../palette";
import { PROVIDER, RENDER_PROVIDER, SELECTED_PROFILE } from "./provider";
import { MAX_SEED } from "./seed";
import type { JobSource, RequestRecord } from "./store";

export const DEFAULT_BATCH = 4;

// The wording measured in the art-edit probe for masked img2img portraits:
// the edit keeps the head and changes only what the cue names.
const EDIT_PRESERVE =
  "preserve the same head, hairline, face shape, eyes, beard, skin and composition";
const EDIT_NEGATIVE_PROMPT =
  "different person, changed identity, changed hairline, new facial features, altered iris or pupil, photorealistic, blurry, antialiasing, round O mouth";

const KINDS = ["sprite", "portrait"] as const;
type StudioKind = (typeof KINDS)[number];

// docs/product/art-guide.md: world sprites use at most 16 colours including
// outline, portraits at most 32.
const MAX_COLOURS: Record<StudioKind, number> = { sprite: 16, portrait: 32 };

/**
 * An engine as the size gate sees it: the provider its jobs name, the sizes it
 * has been measured to produce, and the scale from a cell to a generated size.
 * Each engine declares its own; nothing here assumes one.
 */
export interface EngineCells {
  readonly provider: ProviderDescriptor;
  readonly measuredCells: readonly { readonly w: number; readonly h: number }[];
  readonly generationScale: number;
  /**
   * The cell class this engine draws sprites on when the request does not carry
   * a recipe. A recipe request takes its cell class from the subject's render
   * matrix instead.
   */
  readonly spriteCellClass?: string;
}

/** The image engine: the probe-selected sd profile, drawing gods on the god cell. */
export const SD_ENGINE: EngineCells = {
  provider: PROVIDER,
  measuredCells: SELECTED_PROFILE.measuredCells,
  generationScale: SELECTED_PROFILE.generationScale,
  spriteCellClass: "god",
};

export interface StudioContent {
  readonly vocabulary: AssetVocabulary;
  readonly gods: readonly GodProfile[];
  readonly visuals: readonly GodVisualProfile[];
  readonly palette: Palette;
}

export interface RequestInput {
  readonly subject: string;
  readonly kind: StudioKind;
  readonly slots: readonly GenerationSlot[];
  readonly batch?: number;
  readonly seed?: number;
  readonly styleNote?: string;
  readonly edit?: GenerationEdit;
  /**
   * Makes this a recipe request for a render engine: the palette and the
   * declared pivot. The render profile and cell class come from the subject, and
   * batch, seed, style note and edit are not taken.
   */
  readonly render?: { readonly palette: string; readonly pivot: Point };
}

export type RequestError =
  | {
      readonly kind: "invalid-edit";
      readonly field: string;
      readonly message: string;
    }
  | {
      readonly kind: "invalid-request";
      readonly path: string;
      readonly message: string;
    }
  | {
      readonly kind: "unsupported-kind";
      readonly requested: string;
      readonly valid: readonly string[];
    }
  | {
      readonly kind: "unknown-subject";
      readonly subject: string;
      readonly valid: readonly string[];
    }
  | {
      readonly kind: "unknown-state";
      readonly state: string;
      readonly valid: readonly string[];
    }
  | {
      readonly kind: "unknown-direction";
      readonly direction: string;
      readonly valid: readonly string[];
    }
  | {
      readonly kind: "unknown-ability";
      readonly ability: string;
      readonly valid: readonly string[];
    }
  | {
      readonly kind: "unknown-expression";
      readonly expression: string;
      readonly valid: readonly string[];
    }
  | {
      readonly kind: "unknown-palette-family";
      readonly family: string;
      readonly valid: readonly string[];
    }
  | {
      readonly kind: "invalid-slot";
      readonly slotKey: string;
      readonly message: string;
    }
  | {
      readonly kind: "unmeasured-size";
      readonly native: { readonly w: number; readonly h: number };
      readonly measured: readonly { readonly w: number; readonly h: number }[];
    }
  | {
      readonly kind: "unknown-palette";
      readonly palette: string;
      readonly valid: readonly string[];
    }
  | {
      readonly kind: "seed-overflow";
      readonly baseSeed: number;
      readonly lastOrdinal: number;
    }
  | { readonly kind: "reroll-refused"; readonly message: string };

export type RequestResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RequestError };

const good = <T>(value: T): RequestResult<T> => ({ ok: true, value });
const bad = (error: RequestError): RequestResult<never> => ({
  ok: false,
  error,
});

export interface SlotSpec {
  readonly key: string;
  readonly slot: GenerationSlot;
  readonly prompt: string;
}

export interface GenerationSpec {
  readonly subject: string;
  readonly name: string;
  readonly kind: StudioKind;
  readonly domains: readonly string[];
  readonly iconography: readonly string[];
  readonly cell: {
    readonly id: string;
    readonly w: number;
    readonly h: number;
  };
  readonly native: { readonly w: number; readonly h: number };
  readonly generated: { readonly w: number; readonly h: number };
  /** Set when the request edits an earlier job's output. */
  readonly edit?: GenerationEdit;
  /** Midpoint between the feet at the cell's bottom edge; portraits have none. */
  readonly pivot?: { readonly x: number; readonly y: number };
  readonly palette: {
    readonly id: string;
    readonly approval: Palette["approval"];
    readonly family: string;
    readonly ramps: readonly PaletteRamp[];
    readonly maxColours: number;
  };
  readonly slots: readonly SlotSpec[];
}

export interface AdapterInput {
  readonly prompt: string;
  readonly negativePrompt: string;
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly sampleMethod: string;
  readonly sampleSteps: number;
  readonly txtCfg: number;
  /** Sent only for an edit; plain generation sends no distilled guidance. */
  readonly distilledGuidance?: number;
}

export interface PlannedJob {
  readonly source: JobSource;
  readonly job: Extract<GenerationJob, { status: "queued" }>;
}

export function slotKey(slot: GenerationSlot): string {
  return [slot.state, slot.direction, slot.ability, slot.expression]
    .filter((part) => part !== undefined)
    .join("/");
}

const invalidSlot = (slot: GenerationSlot, message: string) =>
  bad({ kind: "invalid-slot", slotKey: slotKey(slot), message });

// The image model has no use for compass words; each direction is worded as the
// view it draws. Record<Direction, string> makes a direction added to the union
// without wording a type error; a vocabulary direction outside the union is a
// typed unknown-direction error in checkSlot, never a silent fallback.
const DIRECTIONS = ["south", "north", "east", "west"] as const;
type Direction = (typeof DIRECTIONS)[number];
const DIRECTION_VIEW: Record<Direction, string> = {
  south: "front view, facing the viewer",
  north: "back view, facing away from the viewer",
  east: "side view, facing right",
  west: "side view, facing left",
};
const isDirection = (value: string): value is Direction =>
  DIRECTIONS.some((direction) => direction === value);

interface SlotCheck {
  readonly ability: GodProfile["abilities"][number] | undefined;
  /** The wording of a sprite slot's direction; portraits have none. */
  readonly view: string | undefined;
}

function checkSlot(
  slot: GenerationSlot,
  kind: StudioKind,
  vocabulary: AssetVocabulary,
  god: GodProfile,
  cellId: string,
  deferred: readonly { state: string; ability?: string }[],
): RequestResult<SlotCheck> {
  if (kind === "portrait") {
    if (
      slot.state !== undefined ||
      slot.direction !== undefined ||
      slot.ability !== undefined
    )
      return invalidSlot(slot, "a portrait slot takes only an expression");
    if (slot.expression === undefined)
      return invalidSlot(slot, "a portrait slot needs an expression");
    if (!vocabulary.expressions.includes(slot.expression))
      return bad({
        kind: "unknown-expression",
        expression: slot.expression,
        valid: vocabulary.expressions,
      });
    return good({ ability: undefined, view: undefined });
  }
  if (slot.expression !== undefined)
    return invalidSlot(slot, "a sprite slot takes no expression");
  if (slot.state === undefined || slot.direction === undefined)
    return invalidSlot(slot, "a sprite slot needs a state and a direction");
  if (!vocabulary.states.some((state) => state.id === slot.state))
    return bad({
      kind: "unknown-state",
      state: slot.state,
      valid: stateIds(vocabulary),
    });
  const { direction } = slot;
  if (!isDirection(direction) || !vocabulary.directions.includes(direction))
    return bad({
      kind: "unknown-direction",
      direction,
      valid: vocabulary.directions.filter(isDirection),
    });
  const view = DIRECTION_VIEW[direction];
  const rule = stateRuleFor(vocabulary, slot.state, cellId);
  if (rule === undefined)
    return invalidSlot(
      slot,
      `${slot.state} is not drawn on the ${cellId} cell`,
    );
  if (
    deferred.some((d) => d.state === slot.state && d.ability === slot.ability)
  )
    return invalidSlot(
      slot,
      `${slotKey(slot)} is deferred in the subject's render matrix`,
    );
  if (!rule.perAbility) {
    return slot.ability === undefined
      ? good({ ability: undefined, view })
      : invalidSlot(slot, `${slot.state} takes no ability`);
  }
  if (slot.ability === undefined)
    return invalidSlot(slot, `${slot.state} needs an ability`);
  const ability = god.abilities.find((a) => a.id === slot.ability);
  if (ability === undefined)
    return bad({
      kind: "unknown-ability",
      ability: slot.ability,
      valid: god.abilities.map((a) => a.id),
    });
  return good({ ability, view });
}

function promptFor(
  name: string,
  iconography: readonly string[],
  slot: GenerationSlot,
  kind: StudioKind,
  abilityName: string | undefined,
  view: string | undefined,
  styleNote: string | undefined,
  edit: GenerationEdit | undefined,
): string {
  const subject = `${name}, Greek god, ${iconography.join(", ")}`;
  const style = styleNote === undefined ? "" : `, ${styleNote}`;
  if (edit !== undefined)
    return `same Greek god ${name}, ${EDIT_PRESERVE}; ${edit.cue}${style}`;
  if (kind === "portrait")
    return `pixel art portrait, ${subject}, bust, three-quarter view, ${slot.expression} expression, flat background, limited colour palette${style}`;
  const ability = abilityName === undefined ? "" : `, ${abilityName}`;
  return `pixel art, ${subject}, full body, ${view}, ${slot.state} pose${ability}, plain flat background, limited colour palette${style}`;
}

/**
 * The cell class a stored request draws on: a recipe request's from the
 * subject's render matrix, any other sprite request's from the image engine.
 */
export function spriteCellClassOf(
  content: StudioContent,
  request: GenerationRequest,
): string | undefined {
  if (request.recipe === undefined) return SD_ENGINE.spriteCellClass;
  return content.visuals.find((v) => v.godId === request.subject)?.render
    ?.matrix.cellClass;
}

/**
 * Joins the content for a root request; unknown or mismatched values are typed
 * errors. `engine` declares the sizes the size gate checks against; it defaults
 * to the image engine and is required for a recipe request, which no default
 * engine can serve.
 */
export function buildSpec(
  content: StudioContent,
  request: GenerationRequest,
  engine?: EngineCells,
): RequestResult<GenerationSpec> {
  const { vocabulary } = content;
  const kind = KINDS.find((k) => k === request.kind);
  if (kind === undefined)
    return bad({
      kind: "unsupported-kind",
      requested: request.kind,
      valid: KINDS,
    });
  const visual = content.visuals.find((v) => v.godId === request.subject);
  const god = content.gods.find((g) => g.id === request.subject);
  if (visual === undefined || god === undefined)
    return bad({
      kind: "unknown-subject",
      subject: request.subject,
      valid: content.visuals.map((v) => v.godId),
    });

  const { recipe } = request;
  if (recipe !== undefined && engine === undefined)
    return bad({
      kind: "invalid-request",
      path: "engine",
      message: "a recipe request needs the render engine's declared cells",
    });
  const { measuredCells, generationScale, spriteCellClass } =
    engine ?? SD_ENGINE;
  let spriteCell = spriteCellClass;
  if (recipe !== undefined) {
    if (visual.render === undefined)
      return bad({
        kind: "invalid-request",
        path: "recipe",
        message: `${request.subject} names no render profile`,
      });
    if (visual.render.profile !== recipe.profile)
      return bad({
        kind: "invalid-request",
        path: "request.recipe.profile",
        message: `${request.subject}'s render profile is ${visual.render.profile}, not ${recipe.profile}`,
      });
    spriteCell = visual.render.matrix.cellClass;
  }
  const cell = vocabulary.cells.find((c) =>
    kind === "sprite"
      ? c.id === spriteCell && c.kinds.includes("sprite")
      : c.kinds.includes("portrait"),
  );
  if (cell === undefined)
    return bad({
      kind: "invalid-request",
      path: "vocabulary.cells",
      message: `no cell for ${kind}`,
    });
  if (recipe !== undefined) {
    if (recipe.palette !== content.palette.id)
      return bad({
        kind: "unknown-palette",
        palette: recipe.palette,
        valid: [content.palette.id],
      });
    if (recipe.pivot.x > cell.w || recipe.pivot.y > cell.h)
      return bad({
        kind: "invalid-request",
        path: "request.recipe.pivot",
        message: `pivot lies outside the ${cell.w}x${cell.h} cell`,
      });
  }
  const generated = measuredCells.find(
    (m) => m.w === cell.w * generationScale && m.h === cell.h * generationScale,
  );
  if (generated === undefined)
    return bad({
      kind: "unmeasured-size",
      native: { w: cell.w, h: cell.h },
      measured: measuredCells,
    });
  const family = content.palette.families.find(
    (f) => f.id === visual.paletteFamily,
  );
  if (family === undefined)
    return bad({
      kind: "unknown-palette-family",
      family: visual.paletteFamily,
      valid: content.palette.families.map((f) => f.id),
    });

  const slots: SlotSpec[] = [];
  for (const slot of request.slots) {
    const checked = checkSlot(
      slot,
      kind,
      vocabulary,
      god,
      cell.id,
      recipe === undefined ? [] : (visual.render?.matrix.deferred ?? []),
    );
    if (!checked.ok) return checked;
    slots.push({
      key: slotKey(slot),
      slot,
      prompt: promptFor(
        god.name,
        visual.iconography,
        slot,
        kind,
        checked.value.ability?.name,
        checked.value.view,
        request.styleNote,
        request.edit,
      ),
    });
  }

  return good({
    subject: god.id,
    name: god.name,
    kind,
    domains: god.domains,
    iconography: visual.iconography,
    cell: { id: cell.id, w: cell.w, h: cell.h },
    native: { w: cell.w, h: cell.h },
    generated: { w: generated.w, h: generated.h },
    ...(request.edit === undefined ? {} : { edit: request.edit }),
    ...(kind === "sprite"
      ? { pivot: recipe?.pivot ?? { x: Math.floor(cell.w / 2), y: cell.h } }
      : {}),
    palette: {
      id: content.palette.id,
      approval: content.palette.approval,
      family: family.id,
      ramps: family.ramps,
      maxColours: MAX_COLOURS[kind],
    },
    slots,
  });
}

/**
 * Builds the durable root request. A supplied seed is the base seed; otherwise
 * `drawSeed` is called once, after the request is known valid. Jobs are not
 * expanded here: the record starts at ordinal 0. A recipe request takes its
 * render profile from the subject, is stored with batch 1 and seed 0, and
 * never draws a seed; `engine` declares the cells it is checked against.
 */
export function newRequestRecord(
  content: StudioContent,
  input: RequestInput & { readonly id: string },
  drawSeed: () => number,
  engine?: EngineCells,
): RequestResult<{ record: RequestRecord; spec: GenerationSpec }> {
  const id = parseSlug(input.id, "id");
  if (!id.ok)
    return bad({ kind: "invalid-request", path: id.path, message: id.message });
  const { id: _id, render, ...fields } = input;
  let stored: Record<string, unknown>;
  if (render === undefined) {
    stored = { ...fields, batch: input.batch ?? DEFAULT_BATCH };
  } else {
    const visual = content.visuals.find((v) => v.godId === input.subject);
    if (visual === undefined)
      return bad({
        kind: "unknown-subject",
        subject: input.subject,
        valid: content.visuals.map((v) => v.godId),
      });
    if (visual.render === undefined)
      return bad({
        kind: "invalid-request",
        path: "recipe",
        message: `${input.subject} names no render profile`,
      });
    stored = {
      ...fields,
      recipe: { profile: visual.render.profile, ...render },
    };
  }
  const parsed = parseGenerationRequest({ schemaVersion: 1, ...stored });
  if (!parsed.ok)
    return bad({
      kind: "invalid-request",
      path: parsed.path,
      message: parsed.message,
    });
  if (
    parsed.value.seed !== undefined &&
    !Number.isSafeInteger(parsed.value.seed)
  )
    return bad({
      kind: "invalid-request",
      path: "request.seed",
      message: "expected a safe integer",
    });
  const spec = buildSpec(content, parsed.value, engine);
  if (!spec.ok) return spec;

  const seed = parsed.value.seed ?? drawSeed();
  if (!Number.isSafeInteger(seed) || seed < 0)
    return bad({
      kind: "invalid-request",
      path: "request.seed",
      message: "expected a non-negative safe integer",
    });
  return good({
    record: {
      schemaVersion: 1,
      id: id.value,
      request: { ...parsed.value, seed },
      nextOrdinal: 0,
    },
    spec: spec.value,
  });
}

/**
 * Expands `perSlot` jobs for every slot, slot by slot, from the record's
 * `nextOrdinal`. Each job carries a strict one-slot, batch-1 request whose seed
 * is the base seed plus its ordinal. The caller persists `nextOrdinal` before
 * enqueueing so a retry or reroll never reuses an ordinal.
 */
export function planJobs(
  record: RequestRecord,
  perSlot: number,
  /** Plan only the request's slot with this key; every slot when absent. */
  onlySlotKey?: string,
): RequestResult<{ jobs: readonly PlannedJob[]; nextOrdinal: number }> {
  if (!Number.isInteger(perSlot) || perSlot < 1)
    return bad({
      kind: "invalid-request",
      path: "perSlot",
      message: "expected a positive integer",
    });
  const { request } = record;
  const recipe = request.recipe;
  if (recipe !== undefined && (perSlot !== 1 || record.nextOrdinal !== 0))
    return bad({
      kind: "reroll-refused",
      message:
        "a recipe request renders each slot once, at seed 0: there is nothing to reroll",
    });
  const baseSeed = request.seed;
  if (baseSeed === undefined)
    return bad({
      kind: "invalid-request",
      path: "request.seed",
      message: "a stored request has a base seed",
    });
  const slots =
    onlySlotKey === undefined
      ? request.slots
      : request.slots.filter((slot) => slotKey(slot) === onlySlotKey);
  if (slots.length === 0)
    return bad({
      kind: "invalid-request",
      path: "slotKey",
      message: "the request has no such slot",
    });
  const count = slots.length * perSlot;
  const lastOrdinal = record.nextOrdinal + count - 1;
  if (baseSeed + lastOrdinal > MAX_SEED)
    return bad({ kind: "seed-overflow", baseSeed, lastOrdinal });

  const jobs: PlannedJob[] = [];
  for (let index = 0; index < count; index += 1) {
    const ordinal = record.nextOrdinal + index;
    const slot = slots[Math.floor(index / perSlot)] as GenerationSlot;
    jobs.push({
      source: { requestId: record.id, slotKey: slotKey(slot), ordinal },
      job: {
        schemaVersion: 1,
        id: `${record.id}-${String(ordinal).padStart(4, "0")}`,
        request: {
          schemaVersion: 1,
          subject: request.subject,
          kind: request.kind,
          slots: [slot],
          batch: 1,
          seed: recipe === undefined ? baseSeed + ordinal : RECIPE_SEED,
          ...(request.styleNote === undefined
            ? {}
            : { styleNote: request.styleNote }),
          ...(request.edit === undefined ? {} : { edit: request.edit }),
          ...(recipe === undefined ? {} : { recipe }),
        },
        provider: isRecipeRequest(request) ? RENDER_PROVIDER : PROVIDER,
        status: "queued",
      },
    });
  }
  return good({ jobs, nextOrdinal: record.nextOrdinal + count });
}

/** The exact inputs the runtime sends for one slot at one seed. */
export function adapterInput(
  spec: GenerationSpec,
  key: string,
  seed: number,
): RequestResult<AdapterInput> {
  const slot = spec.slots.find((s) => s.key === key);
  if (slot === undefined)
    return bad({
      kind: "invalid-slot",
      slotKey: key,
      message: `the spec has no slot ${key}`,
    });
  return good({
    prompt: slot.prompt,
    negativePrompt:
      spec.edit === undefined
        ? SELECTED_PROFILE.negativePrompt
        : EDIT_NEGATIVE_PROMPT,
    width: spec.generated.w,
    height: spec.generated.h,
    seed,
    ...SELECTED_PROFILE.sampling,
    ...(spec.edit === undefined ? {} : SELECTED_PROFILE.edit),
  });
}

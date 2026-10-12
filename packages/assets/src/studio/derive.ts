// The derivation core: the only three things the art guide lets a program draw.
//
//   mirror        east -> west of idle, seated, hurt or down
//   palette swap  the whole asset to another realm palette, ramp by ramp
//   bob           an idle loop from a rest frame
//
// Pure functions over decoded RGBA frames: no filesystem, no clock, no
// randomness, no network. Each takes its source slots, the recipe's params and
// the subject's declaration, and returns either derived slots with the
// provenance steps that record them, or a typed refusal naming why the recipe
// does not apply. Everything that would be a drawing decision (walk, act,
// anything asymmetric) is refused here and belongs to the repair route.
//
// Determinism: the RGB under alpha 0 is zeroed before a frame is encoded, the
// encoder is `encodeRgbaPng`, and the recipe version and the encoder identity
// are named in the provenance `runtime` ref, so the same inputs give the same
// bytes and a different recipe or encoder gives a different, visible identity.

import { createHash } from "node:crypto";
import type {
  AssetId,
  CanonicalJson,
  ColourMapping,
  DerivedStep,
  Footprint,
  Point,
  Range,
  RuntimeRef,
  Sha256,
} from "@panthea/contracts";
import type { Rgb, RgbaImage } from "../conformance";
import type { PaletteRamp } from "../palette";
import { encodeRgbaPng } from "../placeholder";

// --- Identities ----------------------------------------------------------------

export type DerivationRecipe = "mirror" | "palette-swap" | "bob";

/** The current version of each recipe. A recorded step carries the version it ran under. */
export const RECIPE_VERSION = {
  mirror: 1,
  "palette-swap": 1,
  bob: 1,
} as const satisfies Record<DerivationRecipe, number>;

/** PNG writer identity: filter 0, deflate level 9, node:zlib. Bump when `encodeRgbaPng` output changes. */
export const ENCODER_IDENTITY = "encodeRgbaPng@1";

const RUNTIME_NAME = "panthea-derive";

/** The provenance `runtime` ref for a derivation: the recipe and its version, and the encoder. */
export function derivationRuntime(
  recipe: DerivationRecipe,
  version: number = RECIPE_VERSION[recipe],
): RuntimeRef {
  return {
    name: RUNTIME_NAME,
    version: `${recipe}@${version}+${ENCODER_IDENTITY}`,
  };
}

// --- Slots and results ------------------------------------------------------------

export interface SlotFrame {
  readonly image: RgbaImage;
  readonly durationMs: number;
}

/** A slot as the derivation reads it: its key (`state/direction[/ability]`), frames in order, and loop start. */
export interface SlotInput {
  readonly key: string;
  readonly frames: readonly SlotFrame[];
  readonly loopStart?: number;
}

/** The published revision a slot is read from. */
export interface SourceRef {
  readonly assetId: AssetId;
  readonly revision: Sha256;
}

/** What the subject declares that derivation depends on. Structurally a `GodVisualProfile` subset. */
export interface DerivationSubject {
  readonly asymmetry?: { readonly feature: string };
}

export interface Geometry {
  readonly cell: { readonly w: number; readonly h: number };
  readonly pivot: Point;
  readonly footprint: Footprint;
}

export interface DerivedFrame {
  /** The frame as encoded: RGB under alpha 0 is zero. */
  readonly image: RgbaImage;
  /** The PNG bytes of `image`, from `encodeRgbaPng`. */
  readonly png: Uint8Array;
  readonly durationMs: number;
}

export interface DerivedSlot {
  readonly key: string;
  readonly frames: readonly DerivedFrame[];
  readonly loopStart?: number;
  /** The slot hash of the result: its pixels and durations. */
  readonly slotHash: Sha256;
  /** What the step records: SHA-256 over the encoded PNG bytes in order, plus the duration list. */
  readonly resultHash: Sha256;
}

export const REFUSAL_REASONS = [
  "asymmetric",
  "off-centre-pivot",
  "non-square-footprint",
  "non-derivable",
  "unmapped-colour",
  "ramp-length",
  "invalid-params",
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

export interface DeriveRefusal {
  readonly ok: false;
  readonly reason: RefusalReason;
  readonly message: string;
  /** `unmapped-colour`: the first colour no ramp pair maps, as `#rrggbb`. */
  readonly colour?: string;
}

export interface Derivation {
  readonly ok: true;
  readonly slots: readonly DerivedSlot[];
  readonly steps: readonly DerivedStep[];
}

export interface MirrorDerivation extends Derivation {
  /** Carried through unchanged: a flip about the centred pivot moves neither. */
  readonly pivot: Point;
  readonly footprint: Footprint;
}

export interface SwapDerivation extends Derivation {
  /** The whole pair table as `(sourceRamp, index) -> (targetRamp, index)`, in pair order. */
  readonly map: readonly ColourMapping[];
}

const refuse = (
  reason: RefusalReason,
  message: string,
  extra: { colour?: string } = {},
): DeriveRefusal => ({ ok: false, reason, message, ...extra });

const REPAIR_ROUTE =
  "it is drawn or generated and repaired, so use the repair route";

// --- Hashing and encoding --------------------------------------------------------------

const hex = (rgb: Rgb): string =>
  `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** A copy of `rgba` with RGB zeroed wherever alpha is 0. */
function normalised(rgba: Uint8Array): Uint8Array {
  const out = Uint8Array.from(rgba);
  for (let at = 0; at < out.length; at += 4) {
    if (out[at + 3] === 0) out.fill(0, at, at + 3);
  }
  return out;
}

const durationList = (durations: readonly number[]): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(durations));

/**
 * The slot hash: SHA-256 over the frames' RGBA in order, with RGB under alpha 0
 * taken as zero, then the duration list as JSON.
 */
export function slotHash(slot: {
  readonly frames: readonly SlotFrame[];
}): Sha256 {
  const hash = createHash("sha256");
  for (const frame of slot.frames) hash.update(normalised(frame.image.rgba));
  hash.update(durationList(slot.frames.map((f) => f.durationMs)));
  return hash.digest("hex") as Sha256;
}

function derivedSlot(
  key: string,
  frames: readonly SlotFrame[],
  loopStart: number | undefined,
): DerivedSlot {
  const encoded: DerivedFrame[] = frames.map((frame) => {
    const rgba = normalised(frame.image.rgba);
    const { width, height } = frame.image;
    return {
      image: { rgba, width, height },
      png: encodeRgbaPng(rgba, width, height),
      durationMs: frame.durationMs,
    };
  });
  const result = createHash("sha256");
  for (const frame of encoded) result.update(frame.png);
  result.update(durationList(encoded.map((f) => f.durationMs)));
  return {
    key,
    frames: encoded,
    ...(loopStart === undefined ? {} : { loopStart }),
    slotHash: slotHash({ frames: encoded }),
    resultHash: result.digest("hex") as Sha256,
  };
}

function stepOf(
  recipe: DerivationRecipe,
  version: number,
  params: { readonly [key: string]: CanonicalJson },
  source: SourceRef,
  from: SlotInput,
  to: DerivedSlot,
): DerivedStep {
  return {
    recipe,
    version,
    params,
    source: {
      assetId: source.assetId,
      revision: source.revision,
      slotKey: from.key,
      slotHash: slotHash(from),
    },
    outputSlot: to.key,
    resultHash: to.resultHash,
  };
}

interface ParsedKey {
  readonly state: string;
  readonly direction: string;
  readonly ability?: string;
}

function parseKey(key: string): ParsedKey | undefined {
  const parts = key.split("/");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => p === ""))
    return undefined;
  const [state, direction, ability] = parts as [string, string, string?];
  return { state, direction, ...(ability === undefined ? {} : { ability }) };
}

const badKey = (key: string) =>
  refuse(
    "invalid-params",
    `slot key "${key}" is not state/direction[/ability]`,
  );

function checkFrames(
  slot: SlotInput,
  size: { readonly w: number; readonly h: number } | undefined,
): DeriveRefusal | undefined {
  if (slot.frames.length === 0)
    return refuse("invalid-params", `slot "${slot.key}" has no frames`);
  for (const [index, frame] of slot.frames.entries()) {
    const { width, height, rgba } = frame.image;
    if (rgba.length !== width * height * 4)
      return refuse(
        "invalid-params",
        `slot "${slot.key}" frame ${index} is not width * height RGBA bytes`,
      );
    if (size !== undefined && (width !== size.w || height !== size.h))
      return refuse(
        "invalid-params",
        `slot "${slot.key}" frame ${index} is ${width}x${height}, the cell is ${size.w}x${size.h}`,
      );
  }
  return undefined;
}

// --- Mirror -----------------------------------------------------------------------------

/** States whose west frames are their east frames flipped. Walk and act are drawn per direction. */
const MIRRORABLE = ["idle", "seated", "hurt", "down"] as const;

export interface MirrorInput {
  readonly source: SourceRef;
  /** The east slot. */
  readonly slot: SlotInput;
  readonly subject: DerivationSubject;
  readonly geometry: Geometry;
  /** The version recorded on the step; defaults to the current one. */
  readonly version?: number;
}

/**
 * West from east: every frame flipped about the cell's centre column, with
 * order, durations and `loopStart` kept. Refused when the state is not
 * mirrorable, the direction is not east, the subject declares an asymmetry, the
 * pivot is off the centre line (`2 * pivot.x = cell.w`) or the footprint is not
 * square.
 */
export function mirrorSlot(
  input: MirrorInput,
): DeriveRefusal | MirrorDerivation {
  const { slot, subject, geometry } = input;
  const key = parseKey(slot.key);
  if (key === undefined) return badKey(slot.key);
  if (!(MIRRORABLE as readonly string[]).includes(key.state))
    return refuse(
      "non-derivable",
      `${key.state} cannot be mirrored: ${REPAIR_ROUTE}`,
    );
  if (key.direction !== "east")
    return refuse(
      "non-derivable",
      `mirror derives west from east; "${slot.key}" is ${key.direction}`,
    );
  if (subject.asymmetry !== undefined)
    return refuse(
      "asymmetric",
      `the subject declares an asymmetry ("${subject.asymmetry.feature}"), so west is drawn, not mirrored`,
    );
  if (2 * geometry.pivot.x !== geometry.cell.w)
    return refuse(
      "off-centre-pivot",
      `pivot x ${geometry.pivot.x} is not the centre of a ${geometry.cell.w}-wide cell`,
    );
  if (geometry.footprint.w !== geometry.footprint.h)
    return refuse(
      "non-square-footprint",
      `footprint ${geometry.footprint.w}x${geometry.footprint.h} is not square`,
    );
  const invalid = checkFrames(slot, geometry.cell);
  if (invalid !== undefined) return invalid;

  const frames: SlotFrame[] = slot.frames.map((frame) => {
    const { width, height, rgba } = frame.image;
    const out = new Uint8Array(rgba.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const from = (y * width + (width - 1 - x)) * 4;
        out.set(rgba.subarray(from, from + 4), (y * width + x) * 4);
      }
    }
    return {
      image: { rgba: out, width, height },
      durationMs: frame.durationMs,
    };
  });
  const west = derivedSlot(`${key.state}/west`, frames, slot.loopStart);
  const version = input.version ?? RECIPE_VERSION.mirror;
  return {
    ok: true,
    slots: [west],
    steps: [
      stepOf(
        "mirror",
        version,
        { from: "east", to: "west" },
        input.source,
        slot,
        west,
      ),
    ],
    pivot: geometry.pivot,
    footprint: geometry.footprint,
  };
}

// --- Palette swap ---------------------------------------------------------------------------

export interface RampPair {
  readonly source: PaletteRamp;
  readonly target: PaletteRamp;
}

export interface SwapInput {
  readonly source: SourceRef;
  /** Every slot of the asset, act included. */
  readonly slots: readonly SlotInput[];
  readonly sourceFamily: string;
  readonly targetFamily: string;
  /** Source ramp to target ramp, shade by shade; each pair has equal-length ramps. */
  readonly pairs: readonly RampPair[];
  readonly version?: number;
}

/**
 * The whole asset recoloured from one family's ramps to another's: each shade
 * becomes the shade at the same index of its paired ramp. Alpha is untouched.
 * Refused when a pair's ramps differ in length, or when an opaque pixel's colour
 * is in no source ramp (the first such colour is named).
 */
export function swapPalette(input: SwapInput): DeriveRefusal | SwapDerivation {
  if (input.slots.length === 0 || input.pairs.length === 0)
    return refuse(
      "invalid-params",
      "a palette swap needs slots and ramp pairs",
    );
  for (const { source, target } of input.pairs) {
    if (source.shades.length !== target.shades.length)
      return refuse(
        "ramp-length",
        `ramp "${source.id}" has ${source.shades.length} shades and "${target.id}" has ${target.shades.length}`,
      );
  }
  const map: ColourMapping[] = [];
  const lookup = new Map<string, Rgb>();
  for (const { source, target } of input.pairs) {
    for (const [index, shade] of source.shades.entries()) {
      map.push({
        source: { ramp: source.id, index },
        target: { ramp: target.id, index },
      });
      const key = hex(shade);
      if (!lookup.has(key)) lookup.set(key, target.shades[index] as Rgb);
    }
  }
  for (const slot of input.slots) {
    if (parseKey(slot.key) === undefined) return badKey(slot.key);
    const invalid = checkFrames(slot, undefined);
    if (invalid !== undefined) return invalid;
  }

  const out: DerivedSlot[] = [];
  for (const slot of input.slots) {
    const frames: SlotFrame[] = [];
    for (const [index, frame] of slot.frames.entries()) {
      const { width, height, rgba } = frame.image;
      const recoloured = new Uint8Array(rgba.length);
      for (let at = 0; at < rgba.length; at += 4) {
        const alpha = rgba[at + 3] as number;
        if (alpha === 0) continue;
        const colour = hex([
          rgba[at] as number,
          rgba[at + 1] as number,
          rgba[at + 2] as number,
        ]);
        const target = lookup.get(colour);
        if (target === undefined) {
          const pixel = at / 4;
          return refuse(
            "unmapped-colour",
            `${colour} at ${pixel % width},${Math.floor(pixel / width)} of frame ${index} in "${slot.key}" is in none of the ${input.sourceFamily} ramps being swapped`,
            { colour },
          );
        }
        recoloured.set([target[0], target[1], target[2], alpha], at);
      }
      frames.push({
        image: { rgba: recoloured, width, height },
        durationMs: frame.durationMs,
      });
    }
    out.push(derivedSlot(slot.key, frames, slot.loopStart));
  }

  const version = input.version ?? RECIPE_VERSION["palette-swap"];
  const params = {
    sourceFamily: input.sourceFamily,
    targetFamily: input.targetFamily,
    ramps: input.pairs.map((p) => ({
      source: p.source.id,
      target: p.target.id,
    })),
  };
  return {
    ok: true,
    slots: out,
    steps: out.map((slot, i) =>
      stepOf(
        "palette-swap",
        version,
        params,
        input.source,
        input.slots[i] as SlotInput,
        slot,
      ),
    ),
    map,
  };
}

// --- Bob -----------------------------------------------------------------------------------------

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface BobRepair {
  /** The output frame the recolour applies to. */
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  /** `#rrggbb`. */
  readonly colour: string;
}

/**
 * What a bob does, as canonical JSON of integers and colour strings. The rest
 * frame is frame 0 of the source slot. Output frame `i` is that frame with the
 * opaque pixels of `region` (less every `exclude` box) moved down by `dy[i]`.
 * `seam` says what the cells the move vacates take: "fill-from-fixed" copies
 * the fixed pixel `dy` rows away on the side the region came from, "none"
 * leaves them transparent. `repairs` then recolour single opaque pixels.
 */
export type BobParams = {
  readonly region: Box;
  readonly exclude: readonly Box[];
  readonly dy: readonly number[];
  readonly durationsMs: readonly number[];
  readonly seam: "fill-from-fixed" | "none";
  readonly repairs: readonly BobRepair[];
  readonly loopStart?: number;
};

export interface BobInput {
  readonly source: SourceRef;
  /** The idle slot; its frame 0 is the rest frame. */
  readonly slot: SlotInput;
  readonly geometry: Pick<Geometry, "cell">;
  /** The idle state rule's frame count and duration bounds. */
  readonly limits: { readonly frames: Range; readonly durationMs: Range };
  readonly params: BobParams;
  readonly version?: number;
}

const isInt = (v: unknown): v is number => Number.isInteger(v);
const COLOUR = /^#[0-9a-f]{6}$/;

function boxProblem(
  box: Box,
  label: string,
  cell: { readonly w: number; readonly h: number },
): string | undefined {
  if (![box.x, box.y, box.w, box.h].every(isInt))
    return `${label} is not integers`;
  if (box.w < 1 || box.h < 1) return `${label} is empty`;
  if (
    box.x < 0 ||
    box.y < 0 ||
    box.x + box.w > cell.w ||
    box.y + box.h > cell.h
  )
    return `${label} leaves the ${cell.w}x${cell.h} cell`;
  return undefined;
}

function paramsProblem(
  params: BobParams,
  cell: { readonly w: number; readonly h: number },
): string | undefined {
  const frames = params.durationsMs.length;
  if (params.dy.length !== frames)
    return `dy has ${params.dy.length} entries and durationsMs ${frames}`;
  if (!params.dy.every(isInt) || !params.durationsMs.every(isInt))
    return "dy and durationsMs must be integers";
  if (params.seam !== "fill-from-fixed" && params.seam !== "none")
    return `unknown seam rule "${String(params.seam)}"`;
  const region = boxProblem(params.region, "region", cell);
  if (region !== undefined) return region;
  for (const [index, box] of params.exclude.entries()) {
    const problem = boxProblem(box, `exclude[${index}]`, cell);
    if (problem !== undefined) return problem;
  }
  for (const [index, repair] of params.repairs.entries()) {
    if (
      !isInt(repair.frame) ||
      repair.frame < 0 ||
      repair.frame >= frames ||
      !isInt(repair.x) ||
      !isInt(repair.y) ||
      repair.x < 0 ||
      repair.y < 0 ||
      repair.x >= cell.w ||
      repair.y >= cell.h
    )
      return `repairs[${index}] is outside the frames or the cell`;
    if (!COLOUR.test(repair.colour))
      return `repairs[${index}] colour "${repair.colour}" is not #rrggbb`;
  }
  if (
    params.loopStart !== undefined &&
    (!isInt(params.loopStart) ||
      params.loopStart < 0 ||
      params.loopStart >= frames)
  )
    return "loopStart is outside the frames";
  return undefined;
}

/**
 * An idle loop from one rest frame. Refused for any state but idle, and when
 * the frame count or a duration is outside the idle bounds; params that cannot
 * run (a move out of the cell, a repair on a transparent pixel) are
 * `invalid-params`.
 */
export function bobSlot(input: BobInput): DeriveRefusal | Derivation {
  const { slot, params, limits } = input;
  const cell = input.geometry.cell;
  const key = parseKey(slot.key);
  if (key === undefined) return badKey(slot.key);
  if (key.state !== "idle")
    return refuse(
      "non-derivable",
      `only idle can bob; ${key.state} cannot: ${REPAIR_ROUTE}`,
    );
  const count = params.durationsMs.length;
  if (count < limits.frames.min || count > limits.frames.max)
    return refuse(
      "non-derivable",
      `an idle bob has ${limits.frames.min}-${limits.frames.max} frames, not ${count}: ${REPAIR_ROUTE}`,
    );
  const slow = params.durationsMs.find(
    (d) => d < limits.durationMs.min || d > limits.durationMs.max,
  );
  if (slow !== undefined)
    return refuse(
      "non-derivable",
      `${slow} ms is outside the idle bounds ${limits.durationMs.min}-${limits.durationMs.max}: ${REPAIR_ROUTE}`,
    );
  const problem = paramsProblem(params, cell);
  if (problem !== undefined) return refuse("invalid-params", problem);
  const invalid = checkFrames(
    { key: slot.key, frames: slot.frames.slice(0, 1) },
    cell,
  );
  if (invalid !== undefined) return invalid;

  const base = (slot.frames[0] as SlotFrame).image;
  const { w, h } = cell;
  const inside = (x: number, y: number, box: Box) =>
    x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
  const cluster = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1)
      if (
        (base.rgba[(y * w + x) * 4 + 3] as number) > 0 &&
        inside(x, y, params.region) &&
        !params.exclude.some((box) => inside(x, y, box))
      )
        cluster[y * w + x] = 1;

  const frames: SlotFrame[] = [];
  for (let i = 0; i < count; i += 1) {
    const dy = params.dy[i] as number;
    const out = Uint8Array.from(base.rgba);
    if (dy !== 0) {
      for (let p = 0; p < w * h; p += 1)
        if (cluster[p] === 1) out.fill(0, p * 4, p * 4 + 4);
      for (let y = 0; y < h; y += 1)
        for (let x = 0; x < w; x += 1) {
          if (cluster[y * w + x] !== 1) continue;
          const to = y + dy;
          if (to < 0 || to >= h)
            return refuse(
              "invalid-params",
              `frame ${i} moves the pixel at ${x},${y} out of the cell`,
            );
          out.set(
            base.rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4),
            (to * w + x) * 4,
          );
        }
      if (params.seam === "fill-from-fixed")
        for (let y = 0; y < h; y += 1)
          for (let x = 0; x < w; x += 1) {
            if (cluster[y * w + x] !== 1) continue;
            const from = y - dy;
            if (from >= 0 && from < h && cluster[from * w + x] === 1) continue;
            if (from >= 0 && from < h)
              out.set(
                base.rgba.subarray((from * w + x) * 4, (from * w + x) * 4 + 4),
                (y * w + x) * 4,
              );
          }
    }
    for (const [index, repair] of params.repairs.entries()) {
      if (repair.frame !== i) continue;
      const at = (repair.y * w + repair.x) * 4;
      if (out[at + 3] === 0)
        return refuse(
          "invalid-params",
          `repairs[${index}] recolours the transparent pixel ${repair.x},${repair.y}; a repair never changes alpha`,
        );
      out.set(
        [
          Number.parseInt(repair.colour.slice(1, 3), 16),
          Number.parseInt(repair.colour.slice(3, 5), 16),
          Number.parseInt(repair.colour.slice(5, 7), 16),
        ],
        at,
      );
    }
    frames.push({
      image: { rgba: out, width: w, height: h },
      durationMs: params.durationsMs[i] as number,
    });
  }

  const result = derivedSlot(slot.key, frames, params.loopStart);
  const version = input.version ?? RECIPE_VERSION.bob;
  return {
    ok: true,
    slots: [result],
    steps: [
      stepOf(
        "bob",
        version,
        params as unknown as { readonly [key: string]: CanonicalJson },
        input.source,
        slot,
        result,
      ),
    ],
  };
}

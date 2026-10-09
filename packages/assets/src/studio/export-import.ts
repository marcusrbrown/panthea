import {
  type ConformanceReport,
  fail,
  ok,
  type ParseResult,
  parseArray,
  parseConformanceReport,
  parseEnum,
  parseIntegerAtLeast,
  parseSha256,
  parseSlug,
  parseStrictRecord,
  type Sha256,
} from "@panthea/contracts";
import {
  conformImage,
  type PixelDiff,
  type Rgb,
  type RgbaImage,
} from "../conformance";
import { sha256Hex } from "../hash";
import { encodeRgbaPng } from "../placeholder";
import {
  type CandidateParams,
  type CandidateTarget,
  parseCandidateParams,
  parseTargetPalette,
} from "./candidates";
import { decodePng } from "./png/decode";
import type { StudioContent } from "./request";
import {
  type AuthoredFrames,
  deriveStatus,
  type FrameLimits,
  type FrameRef,
  parseFrameRefs,
  parsePoint,
  parseSlotBasis,
  type SlotBasis,
  slotBasisOf,
  type WorkingSetRecord,
} from "./working-set";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Cell {
  readonly w: number;
  readonly h: number;
}

/** The slice of a slot's picks the reports are measured against. */
export interface EditEvidence {
  readonly params: CandidateParams;
  readonly palette: CandidateTarget["palette"];
}

export interface PreviewSlot {
  readonly frames: readonly FrameRef[];
  /**
   * The frames this save is measured against: the save it replaced, or the
   * frames the edit opened with. Absent on a record written before this was
   * kept, and when neither could be named. The blobs are never deleted, so the
   * hashes stay readable.
   */
  readonly against?: readonly FrameRef[];
  readonly pivot: Point | null;
  readonly reports: readonly {
    readonly report: ConformanceReport;
    readonly proposalHash: Sha256;
    readonly diff: readonly PixelDiff[];
  }[];
  readonly timing: readonly {
    readonly frame: number;
    readonly durationMs: number;
    readonly bounds: { readonly min: number; readonly max: number } | null;
  }[];
}

export interface EditPreview {
  readonly sheetHash: Sha256;
  readonly metadataHash: Sha256;
  readonly slots: Readonly<Record<string, PreviewSlot>>;
}

export interface SlotSignature {
  readonly frames: readonly FrameRef[];
  readonly pivot: Point | null;
}

export interface EditRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly workingSetId: string;
  readonly slots: readonly string[];
  readonly cell: Cell;
  readonly base: Readonly<Record<string, SlotBasis>>;
  readonly evidence: Readonly<Record<string, EditEvidence>>;
  /** What each slot looked like when the edit opened, compared as pixels and timing rather than as bytes. */
  readonly baseSignature: Readonly<Record<string, SlotSignature>>;
  readonly baseSheet: {
    readonly sheetHash: Sha256;
    readonly metadataHash: Sha256;
  };
  readonly status: "open" | "finished" | "discarded";
  readonly preview: EditPreview | null;
  /** How the edit was finished, when that is not the plain hand edit the studio would otherwise name. */
  readonly step?: FinishStep;
}

/**
 * Says how a finished edit is recorded in provenance. A hand edit may carry its own description; a script edit
 * must, because its description is the only record of what ran.
 */
export type FinishStep =
  | { readonly method: "hand"; readonly description?: string }
  | { readonly method: "script"; readonly description: string };

/** Checks a step that came from outside the SDK: a known method, and a non-empty description for a script. */
export function checkFinishStep(
  step: unknown,
): Checked<FinishStep | undefined> {
  if (step === undefined) return { ok: true, value: undefined };
  if (!isRecord(step)) return bad("the finish step must be an object");
  if (
    Object.keys(step).some((key) => key !== "method" && key !== "description")
  )
    return bad("the finish step takes only a method and a description");
  const { method, description } = step;
  if (method !== "hand" && method !== "script")
    return bad('the finish method must be "hand" or "script"');
  if (
    description !== undefined &&
    (typeof description !== "string" || description === "")
  )
    return bad("the finish description must be a non-empty string");
  if (method === "script" && description === undefined)
    return bad("a scripted finish needs a description of what ran");
  return {
    ok: true,
    value:
      method === "script"
        ? { method, description: description as string }
        : description === undefined
          ? { method }
          : { method, description },
  };
}

/** The provenance step an edit becomes: the plain "hand edit <id>" unless it was finished with its own step. */
export function handStepOf(edit: Pick<EditRecord, "id" | "step">): {
  readonly description: string;
  readonly method?: "script";
} {
  const step = edit.step;
  if (step?.method === "script")
    return { description: step.description, method: "script" };
  return { description: step?.description ?? `hand edit ${edit.id}` };
}

export type Checked<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

export interface SheetMeta {
  readonly size: Cell;
  readonly durations: readonly number[];
  readonly tags: readonly {
    readonly name: string;
    readonly from: number;
    readonly to: number;
  }[];
  readonly pivots: Readonly<Record<string, Point | null>>;
}

export interface SheetExpectation {
  readonly slots: readonly string[];
  readonly cell: Cell;
  readonly max: Readonly<Record<string, number>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);
const bad = (message: string): { ok: false; message: string } => ({
  ok: false,
  message,
});

const rectIs = (
  value: unknown,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean =>
  isRecord(value) &&
  value.x === x &&
  value.y === y &&
  value.w === w &&
  value.h === h;

const PIVOT_PREFIX = "pivot:";

/**
 * Reads the subset of an Aseprite json-array export that the studio owns: full
 * native frames, durations in whole milliseconds, one contiguous tag per slot
 * in slot order, and optional single-key `pivot:<slot>` slices. Anything the
 * studio does not model, such as trimming, rotation, reverse playback or extra
 * repeats, is refused rather than claimed.
 */
export function parseSheetJson(
  text: string,
  expect: SheetExpectation,
): Checked<SheetMeta> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return bad(`the metadata is not valid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(json) || !Array.isArray(json.frames) || !isRecord(json.meta))
    return bad("the metadata needs a frames array and a meta object");
  const { cell, slots } = expect;
  const count = json.frames.length;
  const totalMax = slots.reduce(
    (sum, slot) => sum + (expect.max[slot] ?? 0),
    0,
  );
  if (count < 1) return bad("the metadata has no frames");
  if (count > totalMax)
    return bad(
      `the metadata has ${count} frames; at most ${totalMax} fit these slots`,
    );
  const durations: number[] = [];
  for (const [index, frame] of json.frames.entries()) {
    if (!isRecord(frame)) return bad(`frame ${index} is not an object`);
    if (!rectIs(frame.frame, index * cell.w, 0, cell.w, cell.h))
      return bad(
        `frame ${index} is not the full ${cell.w}x${cell.h} cell at x ${index * cell.w}`,
      );
    if (frame.trimmed !== false) return bad(`frame ${index} is trimmed`);
    if (frame.rotated !== false) return bad(`frame ${index} is rotated`);
    if (!rectIs(frame.spriteSourceSize, 0, 0, cell.w, cell.h))
      return bad(`frame ${index} is not the full cell in its source`);
    if (
      !isRecord(frame.sourceSize) ||
      frame.sourceSize.w !== cell.w ||
      frame.sourceSize.h !== cell.h
    )
      return bad(`frame ${index} has a source size that is not the cell`);
    if (!isInt(frame.duration) || frame.duration < 1)
      return bad(`frame ${index} needs a positive whole-millisecond duration`);
    durations.push(frame.duration);
  }
  const { meta } = json;
  if (
    !isRecord(meta.size) ||
    meta.size.w !== count * cell.w ||
    meta.size.h !== cell.h
  )
    return bad(`the sheet size is not ${count} frames of ${cell.w}x${cell.h}`);

  if (!Array.isArray(meta.frameTags))
    return bad("the metadata has no frame tags");
  const tags: { name: string; from: number; to: number }[] = [];
  for (const [index, tag] of meta.frameTags.entries()) {
    if (!isRecord(tag) || typeof tag.name !== "string")
      return bad(`tag ${index} has no name`);
    if (!slots.includes(tag.name))
      return bad(`tag "${tag.name}" is not a slot of this edit`);
    if (tags.some((other) => other.name === tag.name))
      return bad(`tag "${tag.name}" appears twice`);
    if (
      !isInt(tag.from) ||
      !isInt(tag.to) ||
      tag.from < 0 ||
      tag.to < tag.from ||
      tag.to >= count
    )
      return bad(`tag "${tag.name}" has no valid frame range`);
    if (tag.direction !== undefined && tag.direction !== "forward")
      return bad(
        `tag "${tag.name}" plays ${String(tag.direction)}; only forward is supported`,
      );
    if (tag.repeat !== undefined && tag.repeat !== "0" && tag.repeat !== "1")
      return bad(
        `tag "${tag.name}" repeats ${JSON.stringify(tag.repeat)}; only once is supported`,
      );
    tags.push({ name: tag.name, from: tag.from, to: tag.to });
  }
  if (tags.length !== slots.length)
    return bad(
      `expected one tag per slot (${slots.length}); got ${tags.length}`,
    );
  let next = 0;
  for (const [index, tag] of tags.entries()) {
    if (tag.name !== slots[index])
      return bad(
        `tag ${index} is "${tag.name}"; slots run in the order ${slots.join(", ")}`,
      );
    if (tag.from !== next)
      return bad(
        `tag "${tag.name}" starts at frame ${tag.from}; expected ${next} (no gaps or overlaps)`,
      );
    if (tag.to - tag.from + 1 > (expect.max[tag.name] ?? 0))
      return bad(
        `slot "${tag.name}" has ${tag.to - tag.from + 1} frames; its maximum is ${expect.max[tag.name]}`,
      );
    next = tag.to + 1;
  }
  if (next !== count) return bad(`the tags cover ${next} of ${count} frames`);

  const pivots: Record<string, Point | null> = Object.fromEntries(
    slots.map((slot) => [slot, null]),
  );
  const seen = new Set<string>();
  const slices = Array.isArray(meta.slices) ? meta.slices : [];
  for (const slice of slices) {
    if (!isRecord(slice) || typeof slice.name !== "string") continue;
    if (!slice.name.startsWith(PIVOT_PREFIX)) continue;
    const slot = slice.name.slice(PIVOT_PREFIX.length);
    if (!slots.includes(slot))
      return bad(`pivot slice "${slice.name}" is not for a slot of this edit`);
    if (seen.has(slot)) return bad(`pivot slice "${slice.name}" appears twice`);
    seen.add(slot);
    if (!Array.isArray(slice.keys) || slice.keys.length !== 1)
      return bad(`pivot slice "${slice.name}" needs exactly one key`);
    const key = slice.keys[0];
    if (!isRecord(key) || key.frame !== 0)
      return bad(`pivot slice "${slice.name}" must key frame 0`);
    const bounds = key.bounds;
    if (
      !isRecord(bounds) ||
      !isInt(bounds.x) ||
      !isInt(bounds.y) ||
      !isInt(bounds.w) ||
      !isInt(bounds.h) ||
      bounds.x < 0 ||
      bounds.y < 0 ||
      bounds.w < 1 ||
      bounds.h < 1 ||
      bounds.x + bounds.w > cell.w ||
      bounds.y + bounds.h > cell.h
    )
      return bad(
        `pivot slice "${slice.name}" has bounds outside the ${cell.w}x${cell.h} cell`,
      );
    if (key.pivot === undefined) continue;
    // Aseprite keeps a slice's pivot relative to the slice's own bounds.
    const pivot = key.pivot;
    if (!isRecord(pivot) || !isInt(pivot.x) || !isInt(pivot.y))
      return bad(`pivot of "${slice.name}" needs whole-number coordinates`);
    const at = { x: bounds.x + pivot.x, y: bounds.y + pivot.y };
    if (at.x < 0 || at.x > cell.w || at.y < 0 || at.y > cell.h)
      return bad(
        `pivot of "${slice.name}" lands at ${at.x},${at.y}, outside 0..${cell.w}, 0..${cell.h}`,
      );
    pivots[slot] = at;
  }
  return {
    ok: true,
    value: {
      size: { w: meta.size.w, h: meta.size.h },
      durations,
      tags,
      pivots,
    },
  };
}

export const canonicalMeta = (meta: SheetMeta): string =>
  JSON.stringify({
    size: { w: meta.size.w, h: meta.size.h },
    durations: meta.durations,
    tags: meta.tags.map((t) => ({ name: t.name, from: t.from, to: t.to })),
    pivots: Object.keys(meta.pivots)
      .sort()
      .map((slot) => [slot, meta.pivots[slot] ?? null]),
  });

export const metadataHash = (meta: SheetMeta): Sha256 =>
  sha256Hex(new TextEncoder().encode(canonicalMeta(meta)));

export interface SheetSlotSpec {
  readonly slot: string;
  readonly durations: readonly number[];
  readonly pivot: Point | null;
}

/** An Aseprite-style json-array document for the given slots, in order. */
export function sheetJson(slots: readonly SheetSlotSpec[], cell: Cell): string {
  const durations = slots.flatMap((s) => s.durations);
  const frames = durations.map((duration, index) => ({
    filename: `studio ${index}.aseprite`,
    frame: { x: index * cell.w, y: 0, w: cell.w, h: cell.h },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: cell.w, h: cell.h },
    sourceSize: { w: cell.w, h: cell.h },
    duration,
  }));
  let from = 0;
  const frameTags = slots.map((s) => {
    const tag = {
      name: s.slot,
      from,
      to: from + s.durations.length - 1,
      direction: "forward",
    };
    from += s.durations.length;
    return tag;
  });
  const slices = slots.flatMap((s) =>
    s.pivot === null
      ? []
      : [
          {
            name: `${PIVOT_PREFIX}${s.slot}`,
            keys: [
              {
                frame: 0,
                bounds: { x: 0, y: 0, w: cell.w, h: cell.h },
                pivot: { x: s.pivot.x, y: s.pivot.y },
              },
            ],
          },
        ],
  );
  return `${JSON.stringify(
    {
      frames,
      meta: {
        app: "https://www.aseprite.org/",
        format: "RGBA8888",
        size: { w: durations.length * cell.w, h: cell.h },
        scale: "1",
        frameTags,
        slices,
      },
    },
    null,
    2,
  )}\n`;
}

const hexRgb = (hex: string): Rgb => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

/**
 * Placeholder length of a frame the owner has not timed yet: the slowest
 * duration the state's frame-rate range allows, and 100 ms where the guide
 * gives no rate. This is an editable placeholder (D23), not an owner default
 * and not a conformance rule.
 */
export function placeholderMs(
  content: StudioContent,
  kind: "sprite" | "portrait",
  slot: string,
): number {
  return timingBounds(content, kind, slot)?.max ?? 100;
}

/** Per-frame milliseconds the vocabulary's rate range allows; null where it names none. */
export function timingBounds(
  content: StudioContent,
  kind: "sprite" | "portrait",
  slot: string,
): { min: number; max: number } | null {
  if (kind === "portrait") return null;
  const rule = content.vocabulary.states.find(
    (state) => state.id === slot.split("/")[0],
  );
  if (rule?.fps === undefined) return null;
  return {
    min: Math.floor(1000 / rule.fps.max),
    max: Math.ceil(1000 / rule.fps.min),
  };
}

/**
 * A hash of a frame's pixels for comparison only: the RGB under a fully
 * transparent pixel is invisible, so it compares as zero. The frame's own
 * bytes are never rewritten.
 */
export function canonicalFrameHash(image: RgbaImage): Sha256 {
  const rgba = Uint8Array.from(image.rgba);
  for (let at = 0; at < rgba.length; at += 4)
    if (rgba[at + 3] === 0) rgba.fill(0, at, at + 3);
  const header = new TextEncoder().encode(`${image.width}x${image.height}:`);
  const bytes = new Uint8Array(header.length + rgba.length);
  bytes.set(header);
  bytes.set(rgba, header.length);
  return sha256Hex(bytes);
}

/** Each slot's frames as canonical pixels and durations, plus its pivot. */
export function sheetSignature(
  image: RgbaImage,
  meta: SheetMeta,
  cell: Cell,
): Record<string, SlotSignature> {
  const crops = cropFrames(image, cell);
  return Object.fromEntries(
    meta.tags.map((tag) => [
      tag.name,
      {
        frames: crops.slice(tag.from, tag.to + 1).map((crop, offset) => ({
          hash: canonicalFrameHash(crop),
          durationMs: meta.durations[tag.from + offset] as number,
        })),
        pivot: meta.pivots[tag.name] ?? null,
      },
    ]),
  );
}

export const sameSignature = (
  a: Readonly<Record<string, SlotSignature>>,
  b: Readonly<Record<string, SlotSignature>>,
): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The exact cells of a horizontal strip, hidden RGB included. */
export function cropFrames(image: RgbaImage, cell: Cell): RgbaImage[] {
  const count = Math.floor(image.width / cell.w);
  const frames: RgbaImage[] = [];
  for (let index = 0; index < count; index += 1) {
    const rgba = new Uint8Array(cell.w * cell.h * 4);
    for (let y = 0; y < cell.h; y += 1) {
      const from = (y * image.width + index * cell.w) * 4;
      rgba.set(image.rgba.subarray(from, from + cell.w * 4), y * cell.w * 4);
    }
    frames.push({ rgba, width: cell.w, height: cell.h });
  }
  return frames;
}

/**
 * The strip and metadata an editor opens: each slot's authored frames as they
 * are, else its single picked keyframe. A pick is never copied into extra
 * frames; the owner adds frames in the editor.
 */
export function startSheet(args: {
  readonly set: WorkingSetRecord;
  readonly slots: readonly string[];
  readonly readBlob: (hash: Sha256) => Uint8Array | undefined;
  readonly placeholderMs: (slot: string) => number;
}): Checked<{
  readonly png: Uint8Array;
  readonly json: string;
  readonly cell: Cell;
  readonly base: Record<string, SlotBasis>;
}> {
  const { set, slots } = args;
  if (slots.length === 0) return bad("an edit needs at least one slot");
  const images: RgbaImage[] = [];
  const specs: SheetSlotSpec[] = [];
  const base: Record<string, SlotBasis> = {};
  for (const slot of slots) {
    const slotBasis = slotBasisOf(set, slot);
    if (slotBasis === undefined)
      return bad(`slot ${slot} has neither a pick nor authored frames`);
    base[slot] = slotBasis;
    const authored = set.frames[slot];
    const refs = baseFrameRefs(set, slot, args.placeholderMs(slot)) ?? [];
    for (const ref of refs) {
      const bytes = args.readBlob(ref.hash);
      if (bytes === undefined)
        return bad(`the image ${ref.hash} of slot ${slot} is missing`);
      const decoded = decodePng(bytes);
      if (!decoded.ok)
        return bad(
          `the image ${ref.hash} of slot ${slot} does not decode: ${decoded.message}`,
        );
      images.push(decoded.image);
    }
    specs.push({
      slot,
      durations: refs.map((ref) => ref.durationMs),
      pivot: authored?.pivot ?? null,
    });
  }
  const first = images[0] as RgbaImage;
  const cell = { w: first.width, h: first.height };
  if (images.some((image) => image.width !== cell.w || image.height !== cell.h))
    return bad("the frames of these slots are not all the same size");
  const rgba = new Uint8Array(cell.w * images.length * cell.h * 4);
  images.forEach((image, index) => {
    for (let y = 0; y < cell.h; y += 1)
      rgba.set(
        image.rgba.subarray(y * cell.w * 4, (y + 1) * cell.w * 4),
        (y * cell.w * images.length + index * cell.w) * 4,
      );
  });
  return {
    ok: true,
    value: {
      png: encodeRgbaPng(rgba, cell.w * images.length, cell.h),
      json: sheetJson(specs, cell),
      cell,
      base,
    },
  };
}

/**
 * The frames an edit of `slot` starts from: the hand-finished frames, or else
 * the picked image as one frame. Undefined when the slot has neither.
 */
export function baseFrameRefs(
  set: WorkingSetRecord,
  slot: string,
  pickMs: number,
): readonly FrameRef[] | undefined {
  const authored = set.frames[slot];
  if (authored !== undefined) return authored.frames;
  const pick = set.picks[slot];
  return pick === undefined
    ? undefined
    : [{ hash: pick.imageHash, durationMs: pickMs }];
}

/**
 * Crops every frame, reports on it as it is against the slot's palette, and
 * proposes a conformed version beside it. Hand pixels are only ever stored as
 * drawn; the proposal and the report are separate.
 */
export function buildPreview(args: {
  readonly image: RgbaImage;
  readonly sheetHash: Sha256;
  readonly meta: SheetMeta;
  readonly edit: Pick<EditRecord, "slots" | "cell" | "evidence">;
  readonly kind: "sprite" | "portrait";
  readonly content: StudioContent;
  /** Per slot, the frames this save is measured against; a slot with none records none. */
  readonly against?: Readonly<Record<string, readonly FrameRef[]>>;
}): Checked<{
  readonly preview: EditPreview;
  readonly blobs: readonly Uint8Array[];
}> {
  const { image, meta, edit, kind, content } = args;
  const { cell } = edit;
  if (image.width !== meta.size.w || image.height !== meta.size.h)
    return bad(
      `the sheet is ${image.width}x${image.height}, the metadata says ${meta.size.w}x${meta.size.h}`,
    );
  const crops = cropFrames(image, cell);
  const blobs = new Map<string, Uint8Array>();
  const keep = (png: Uint8Array): Sha256 => {
    const hash = sha256Hex(png);
    blobs.set(hash, png);
    return hash;
  };
  const slots: Record<string, PreviewSlot> = {};
  for (const tag of meta.tags) {
    const evidence = edit.evidence[tag.name];
    if (evidence === undefined)
      return bad(`slot ${tag.name} has no report evidence`);
    const bounds = timingBounds(content, kind, tag.name);
    const pivot = meta.pivots[tag.name] ?? null;
    const frames: FrameRef[] = [];
    const reports: PreviewSlot["reports"][number][] = [];
    const timing: PreviewSlot["timing"][number][] = [];
    for (let frame = tag.from; frame <= tag.to; frame += 1) {
      const crop = crops[frame] as RgbaImage;
      const durationMs = meta.durations[frame] as number;
      const hash = keep(encodeRgbaPng(crop.rgba, crop.width, crop.height));
      const result = conformImage({
        rgba: crop.rgba,
        width: crop.width,
        height: crop.height,
        kind,
        mode: "report-only",
        cell,
        ...(pivot === null ? {} : { pivot }),
        paletteRgb: evidence.palette.colours.map(hexRgb),
        background: evidence.params.background,
        alphaCutoff: evidence.params.alphaCutoff,
        grid: evidence.params.grid,
      });
      if (result.status !== "done")
        return bad(
          `slot ${tag.name} frame ${frame} cannot be reported on: ${result.status === "invalid-input" ? `${result.field}: ${result.message}` : result.message}`,
        );
      const proposalHash = keep(
        encodeRgbaPng(
          result.proposal.rgba,
          result.proposal.width,
          result.proposal.height,
        ),
      );
      frames.push({ hash, durationMs });
      reports.push({ report: result.report, proposalHash, diff: result.diff });
      timing.push({ frame, durationMs, bounds });
    }
    const against = args.against?.[tag.name];
    slots[tag.name] = {
      frames,
      ...(against === undefined ? {} : { against }),
      pivot,
      reports,
      timing,
    };
  }
  return {
    ok: true,
    value: {
      preview: {
        sheetHash: args.sheetHash,
        metadataHash: metadataHash(meta),
        slots,
      },
      blobs: [...blobs.values()],
    },
  };
}

/** The working set with the edit's frames in, one more hand edit on each slot, and no approval. */
export function applyFinish(args: {
  readonly set: WorkingSetRecord;
  readonly edit: EditRecord;
  readonly preview: EditPreview;
}): Checked<WorkingSetRecord> {
  const { set, edit, preview } = args;
  const frames: Record<string, AuthoredFrames> = { ...set.frames };
  for (const slot of edit.slots) {
    const made = preview.slots[slot];
    const limit = set.limits[slot];
    const basis = edit.base[slot];
    if (made === undefined || limit === undefined || basis === undefined)
      return bad(`slot ${slot} is not part of this edit`);
    if (made.frames.length < limit.min)
      return bad(
        `slot ${slot} has ${made.frames.length} frames; it needs at least ${limit.min}`,
      );
    if (made.frames.length > limit.max)
      return bad(
        `slot ${slot} has ${made.frames.length} frames; it takes at most ${limit.max}`,
      );
    frames[slot] = {
      editId: edit.id,
      basis,
      sheetHash: preview.sheetHash,
      frames: made.frames,
      pivot: made.pivot,
      handEdits: [
        ...(set.frames[slot]?.handEdits ?? []),
        { ...handStepOf(edit), hash: preview.sheetHash },
      ],
    };
  }
  return {
    ok: true,
    value: {
      ...set,
      frames,
      status: deriveStatus(
        set.kind,
        set.required,
        set.picks,
        frames,
        set.limits,
      ),
    },
  };
}

const HEX8 = /^#[0-9a-f]{8}$/;

function parseDiff(value: unknown, path: string): ParseResult<PixelDiff> {
  return parseStrictRecord(
    value,
    path,
    ["x", "y", "before", "after"],
    (record) => {
      const x = parseIntegerAtLeast(record.x, `${path}.x`, 0);
      if (!x.ok) return x;
      const y = parseIntegerAtLeast(record.y, `${path}.y`, 0);
      if (!y.ok) return y;
      for (const key of ["before", "after"] as const)
        if (
          typeof record[key] !== "string" ||
          !HEX8.test(record[key] as string)
        )
          return fail(
            `${path}.${key}`,
            "expected a lowercase #rrggbbaa colour",
          );
      return ok({
        x: x.value,
        y: y.value,
        before: record.before as string,
        after: record.after as string,
      });
    },
  );
}

function parseSize(value: unknown, path: string): ParseResult<Cell> {
  return parseStrictRecord(value, path, ["w", "h"], (record) => {
    const w = parseIntegerAtLeast(record.w, `${path}.w`, 1);
    if (!w.ok) return w;
    const h = parseIntegerAtLeast(record.h, `${path}.h`, 1);
    if (!h.ok) return h;
    return ok({ w: w.value, h: h.value });
  });
}

function parseSlotMap<T>(
  value: unknown,
  path: string,
  slots: readonly string[],
  parse: (item: unknown, itemPath: string) => ParseResult<T>,
): ParseResult<Record<string, T>> {
  if (!isRecord(value)) return fail(path, "expected an object");
  const stray = Object.keys(value).find((key) => !slots.includes(key));
  if (stray !== undefined)
    return fail(`${path}.${stray}`, "not a slot of this edit");
  const out: Record<string, T> = {};
  for (const slot of slots) {
    const parsed = parse(value[slot], `${path}.${slot}`);
    if (!parsed.ok) return parsed;
    out[slot] = parsed.value;
  }
  return ok(out);
}

function parsePreviewSlot(
  value: unknown,
  path: string,
  offset: number,
): ParseResult<PreviewSlot> {
  return parseStrictRecord(
    value,
    path,
    ["frames", "against", "pivot", "reports", "timing"],
    (record) => {
      const frames = parseFrameRefs(record.frames, `${path}.frames`);
      if (!frames.ok) return frames;
      if (frames.value.length === 0)
        return fail(`${path}.frames`, "expected at least one frame");
      let against: readonly FrameRef[] | undefined;
      if (record.against !== undefined) {
        const parsedAgainst = parseFrameRefs(record.against, `${path}.against`);
        if (!parsedAgainst.ok) return parsedAgainst;
        if (parsedAgainst.value.length === 0)
          return fail(`${path}.against`, "expected at least one frame");
        against = parsedAgainst.value;
      }
      let pivot: Point | null = null;
      if (record.pivot !== null) {
        const parsed = parsePoint(record.pivot, `${path}.pivot`);
        if (!parsed.ok) return parsed;
        pivot = parsed.value;
      }
      const reports = parseArray(
        record.reports,
        `${path}.reports`,
        (item, itemPath) =>
          parseStrictRecord(
            item,
            itemPath,
            ["report", "proposalHash", "diff"],
            (entry) => {
              const report = parseConformanceReport(
                entry.report,
                `${itemPath}.report`,
              );
              if (!report.ok) return report;
              const proposalHash = parseSha256(
                entry.proposalHash,
                `${itemPath}.proposalHash`,
              );
              if (!proposalHash.ok) return proposalHash;
              const diff = parseArray(
                entry.diff,
                `${itemPath}.diff`,
                parseDiff,
              );
              if (!diff.ok) return diff;
              return ok({
                report: report.value,
                proposalHash: proposalHash.value,
                diff: diff.value,
              });
            },
          ),
      );
      if (!reports.ok) return reports;
      if (reports.value.length !== frames.value.length)
        return fail(`${path}.reports`, "expected one report per frame");
      const timing = parseArray(
        record.timing,
        `${path}.timing`,
        (item, itemPath) =>
          parseStrictRecord<PreviewSlot["timing"][number]>(
            item,
            itemPath,
            ["frame", "durationMs", "bounds"],
            (entry) => {
              const frame = parseIntegerAtLeast(
                entry.frame,
                `${itemPath}.frame`,
                0,
              );
              if (!frame.ok) return frame;
              const durationMs = parseIntegerAtLeast(
                entry.durationMs,
                `${itemPath}.durationMs`,
                1,
              );
              if (!durationMs.ok) return durationMs;
              if (entry.bounds === null)
                return ok({
                  frame: frame.value,
                  durationMs: durationMs.value,
                  bounds: null,
                });
              const bounds = parseStrictRecord(
                entry.bounds,
                `${itemPath}.bounds`,
                ["min", "max"],
                (b) => {
                  const min = parseIntegerAtLeast(
                    b.min,
                    `${itemPath}.bounds.min`,
                    1,
                  );
                  if (!min.ok) return min;
                  const max = parseIntegerAtLeast(
                    b.max,
                    `${itemPath}.bounds.max`,
                    min.value,
                  );
                  if (!max.ok) return max;
                  return ok({ min: min.value, max: max.value });
                },
              );
              if (!bounds.ok) return bounds;
              return ok({
                frame: frame.value,
                durationMs: durationMs.value,
                bounds: bounds.value,
              });
            },
          ),
      );
      if (!timing.ok) return timing;
      if (timing.value.length !== frames.value.length)
        return fail(`${path}.timing`, "expected one timing entry per frame");
      for (const [index, entry] of timing.value.entries())
        if (
          entry.frame !== offset + index ||
          entry.durationMs !== frames.value[index]?.durationMs
        )
          return fail(
            `${path}.timing`,
            "a timing entry does not match its frame",
          );
      return ok({
        frames: frames.value,
        ...(against === undefined ? {} : { against }),
        pivot,
        reports: reports.value,
        timing: timing.value,
      });
    },
  );
}

export function parseEditRecord(input: unknown): ParseResult<EditRecord> {
  return parseStrictRecord(
    input,
    "edit",
    [
      "schemaVersion",
      "id",
      "workingSetId",
      "slots",
      "cell",
      "base",
      "evidence",
      "baseSheet",
      "baseSignature",
      "status",
      "preview",
      "step",
    ],
    (record) => {
      if (record.schemaVersion !== 1)
        return fail("edit.schemaVersion", "expected 1");
      const id = parseSlug(record.id, "edit.id");
      if (!id.ok) return id;
      const workingSetId = parseSlug(record.workingSetId, "edit.workingSetId");
      if (!workingSetId.ok) return workingSetId;
      const slots = parseArray(record.slots, "edit.slots", (item, itemPath) =>
        typeof item === "string" && item !== ""
          ? ok(item)
          : fail(itemPath, "expected a slot key"),
      );
      if (!slots.ok) return slots;
      if (slots.value.length === 0)
        return fail("edit.slots", "expected at least one slot");
      if (new Set(slots.value).size !== slots.value.length)
        return fail("edit.slots", "expected unique slots");
      const cell = parseSize(record.cell, "edit.cell");
      if (!cell.ok) return cell;
      const base = parseSlotMap(
        record.base,
        "edit.base",
        slots.value,
        parseSlotBasis,
      );
      if (!base.ok) return base;
      const evidence = parseSlotMap(
        record.evidence,
        "edit.evidence",
        slots.value,
        (item, itemPath) =>
          parseStrictRecord(item, itemPath, ["params", "palette"], (entry) => {
            const params = parseCandidateParams(
              entry.params,
              `${itemPath}.params`,
            );
            if (!params.ok) return params;
            const palette = parseTargetPalette(
              entry.palette,
              `${itemPath}.palette`,
            );
            if (!palette.ok) return palette;
            return ok({ params: params.value, palette: palette.value });
          }),
      );
      if (!evidence.ok) return evidence;
      const baseSheet = parseStrictRecord(
        record.baseSheet,
        "edit.baseSheet",
        ["sheetHash", "metadataHash"],
        (entry) => {
          const sheetHash = parseSha256(
            entry.sheetHash,
            "edit.baseSheet.sheetHash",
          );
          if (!sheetHash.ok) return sheetHash;
          const metadata = parseSha256(
            entry.metadataHash,
            "edit.baseSheet.metadataHash",
          );
          if (!metadata.ok) return metadata;
          return ok({
            sheetHash: sheetHash.value,
            metadataHash: metadata.value,
          });
        },
      );
      if (!baseSheet.ok) return baseSheet;
      const baseSignature = parseSlotMap(
        record.baseSignature,
        "edit.baseSignature",
        slots.value,
        (item, itemPath) =>
          parseStrictRecord(item, itemPath, ["frames", "pivot"], (entry) => {
            const frames = parseFrameRefs(entry.frames, `${itemPath}.frames`);
            if (!frames.ok) return frames;
            if (frames.value.length === 0)
              return fail(`${itemPath}.frames`, "expected at least one frame");
            let pivot: Point | null = null;
            if (entry.pivot !== null) {
              const parsed = parsePoint(entry.pivot, `${itemPath}.pivot`);
              if (!parsed.ok) return parsed;
              pivot = parsed.value;
            }
            return ok({ frames: frames.value, pivot });
          }),
      );
      if (!baseSignature.ok) return baseSignature;
      const status = parseEnum(record.status, "edit.status", [
        "open",
        "finished",
        "discarded",
      ] as const);
      if (!status.ok) return status;
      let preview: EditPreview | null = null;
      if (record.preview !== null) {
        const parsed = parseStrictRecord<EditPreview>(
          record.preview,
          "edit.preview",
          ["sheetHash", "metadataHash", "slots"],
          (entry) => {
            const sheetHash = parseSha256(
              entry.sheetHash,
              "edit.preview.sheetHash",
            );
            if (!sheetHash.ok) return sheetHash;
            const metadata = parseSha256(
              entry.metadataHash,
              "edit.preview.metadataHash",
            );
            if (!metadata.ok) return metadata;
            let offset = 0;
            const previewSlots = parseSlotMap(
              entry.slots,
              "edit.preview.slots",
              slots.value,
              (item, itemPath) => {
                const parsedSlot = parsePreviewSlot(item, itemPath, offset);
                if (parsedSlot.ok) offset += parsedSlot.value.frames.length;
                return parsedSlot;
              },
            );
            if (!previewSlots.ok) return previewSlots;
            return ok({
              sheetHash: sheetHash.value,
              metadataHash: metadata.value,
              slots: previewSlots.value,
            });
          },
        );
        if (!parsed.ok) return parsed;
        preview = parsed.value;
      }
      let step: FinishStep | undefined;
      if (record.step !== undefined) {
        const checked = checkFinishStep(record.step);
        if (!checked.ok) return fail("edit.step", checked.message);
        step = checked.value;
      }
      return ok({
        schemaVersion: 1,
        id: id.value,
        workingSetId: workingSetId.value,
        slots: slots.value,
        cell: cell.value,
        base: base.value,
        evidence: evidence.value,
        baseSheet: baseSheet.value,
        baseSignature: baseSignature.value,
        status: status.value,
        preview,
        ...(step === undefined ? {} : { step }),
      });
    },
  );
}

export type { FrameLimits };

/** Frames timed outside the vocabulary's bounds: a warning for the owner, never a refusal. */
export function timingWarnings(preview: EditPreview): {
  slot: string;
  frame: number;
  durationMs: number;
  bounds: { min: number; max: number };
}[] {
  return Object.entries(preview.slots).flatMap(([slot, made]) =>
    made.timing.flatMap(({ frame, durationMs, bounds }) =>
      bounds !== null && (durationMs < bounds.min || durationMs > bounds.max)
        ? [{ slot, frame, durationMs, bounds }]
        : [],
    ),
  );
}

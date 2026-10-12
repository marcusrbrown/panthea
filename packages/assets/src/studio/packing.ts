// Packs a complete working set into a final manifest and atlas: one untrimmed
// row of native cells in vocabulary order, a fresh report-only conformance
// report per cell, and provenance traced from what actually happened in the
// studio. Pure over its inputs. It never makes, pads or repairs a frame: a
// slot's cells are the picked or hand-finished pixels exactly as stored.

import {
  type AssetManifest,
  type AssetVocabulary,
  type ConformanceReport,
  canonicalJson,
  type DerivedStep,
  type Frame,
  type GenerationRef,
  type JobRef,
  type LicenceRecord,
  parseAssetId,
  parseAssetManifest,
  type RealmVariant,
  type Sha256,
} from "@panthea/contracts";
import {
  type BackgroundSpec,
  conformImage,
  type GridParams,
  type Rgb,
  type RgbaImage,
} from "../conformance";
import { sha256Hex } from "../hash";
import type { Palette } from "../palette";
import { encodeRgbaPng } from "../placeholder";
import type { CandidateParams } from "./candidates";
import { regenerateVariantAtlas } from "./derivation";
import { derivationRuntime } from "./derive";
import { type EditRecord, handStepOf } from "./export-import";
import { cutFrame } from "./frame-ref";
import { decodePng } from "./png/decode";
import { buildSpec, type StudioContent } from "./request";
import type { CommandRecord, JobRecord, RequestRecord } from "./store";
import type { DerivedBasis, WorkingSetRecord } from "./working-set";

export interface PackInput {
  /** The studio's own id for this packed record. */
  readonly id: string;
  readonly workingSetId: string;
  readonly assetId: string;
  readonly styleTag: string;
  /** Sprites only. */
  readonly footprint?: { readonly w: number; readonly h: number };
  /** Portraits only: how long a picked, auto-conformed expression shows. */
  readonly stillFrameMs?: number;
  /** The licence and attribution of the owner's own hand work; required when the asset has hand edits. */
  readonly originalWork?: {
    readonly licence: string;
    readonly attribution?: string;
  };
}

export interface PriorRevision {
  readonly revision: Sha256;
  readonly manifest: AssetManifest;
  readonly atlas: Uint8Array;
}

export interface PackSources {
  readonly set: WorkingSetRecord;
  readonly edits: ReadonlyMap<string, EditRecord>;
  readonly jobs: ReadonlyMap<string, JobRecord>;
  readonly requests: ReadonlyMap<string, RequestRecord>;
  readonly commands: readonly CommandRecord[];
  readonly readBlob: (hash: Sha256) => Uint8Array | undefined;
  readonly content: StudioContent;
  readonly palette: Palette;
  readonly prior?: PriorRevision;
}

export interface Packed {
  readonly manifest: AssetManifest;
  readonly atlas: Uint8Array;
  /** The atlas of each realm variant, by blob hash: regenerated from `atlas` at every pack. */
  readonly variantAtlases: ReadonlyMap<Sha256, Uint8Array>;
  readonly report: ConformanceReport;
  readonly carried: readonly string[];
}

export type Packing =
  | { readonly ok: true; readonly value: Packed }
  | { readonly ok: false; readonly message: string };

const refuse = (message: string): Packing => ({ ok: false, message });

interface Cell {
  readonly slot: string;
  readonly image: RgbaImage;
  readonly durationMs: number;
  /** What the cell was conformed with. Absent for a cell carried from the published revision, which is not measured again. */
  readonly params?: {
    readonly background: BackgroundSpec;
    readonly alphaCutoff: number;
    readonly grid: GridParams;
  };
}

interface SlotKey {
  readonly state: string;
  readonly direction: string;
  readonly ability: string | undefined;
}

const parseSlotKey = (key: string): SlotKey => {
  const [state = "", direction = "", ability] = key.split("/");
  return { state, direction, ability };
};

/** Vocabulary order: states, then directions, then ability id; portraits by expression order. */
export function slotOrder(
  vocabulary: AssetVocabulary,
  kind: "sprite" | "portrait",
): (a: string, b: string) => number {
  if (kind === "portrait") {
    const at = (key: string) => vocabulary.expressions.indexOf(key);
    return (a, b) => at(a) - at(b);
  }
  const stateAt = (id: string) =>
    vocabulary.states.findIndex((s) => s.id === id);
  const directionAt = (id: string) => vocabulary.directions.indexOf(id);
  return (a, b) => {
    const x = parseSlotKey(a);
    const y = parseSlotKey(b);
    return (
      stateAt(x.state) - stateAt(y.state) ||
      directionAt(x.direction) - directionAt(y.direction) ||
      (x.ability ?? "").localeCompare(y.ability ?? "")
    );
  };
}

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

function crop(
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

/** The decoded pixels of a stored PNG, only when the bytes are the hash and the size is the cell's. */
function decoded(
  bytes: Uint8Array | undefined,
  hash: Sha256,
  cell: { w: number; h: number },
  what: string,
): { ok: true; image: RgbaImage } | { ok: false; message: string } {
  if (bytes === undefined)
    return {
      ok: false,
      message: `${what}: the stored image ${hash} is missing`,
    };
  if (sha256Hex(bytes) !== hash)
    return {
      ok: false,
      message: `${what}: the stored image does not match its hash ${hash}`,
    };
  const result = decodePng(bytes);
  if (!result.ok)
    return {
      ok: false,
      message: `${what}: the stored image cannot be decoded (${result.code})`,
    };
  const { width, height } = result.image;
  if (width !== cell.w || height !== cell.h)
    return {
      ok: false,
      message: `${what}: the image is ${width}x${height}, the cell is ${cell.w}x${cell.h}`,
    };
  return { ok: true, image: result.image };
}

interface Ancestry {
  /** Finished edit ids, oldest first. */
  readonly edits: readonly string[];
  /** The succeeded job a pick came from; absent for a slot that started from a derived slot. */
  readonly job?: JobRecord;
  readonly inputHash?: Sha256;
  /** Present when the slot's oldest edit started from a derived slot. */
  readonly derivedFrom?: DerivedBasis;
}

/** Follows a slot's frames back through its finished edits to the pick, and from the pick to its succeeded job. */
function trace(
  slot: string,
  sources: PackSources,
): { ok: true; value: Ancestry } | { ok: false; message: string } {
  const { set, edits, jobs, commands } = sources;
  const finished = (id: string) =>
    commands.some((c) => c.type === "finish-edit" && c.jobId === id);
  const chain: EditRecord[] = [];
  let derivedFrom: DerivedBasis | undefined;
  const authored = set.frames[slot];
  let basis =
    authored === undefined
      ? undefined
      : { kind: "frames" as const, editId: authored.editId };
  while (basis?.kind === "frames") {
    if (chain.length > edits.size)
      return { ok: false, message: `slot ${slot}: its edit history loops` };
    const edit = edits.get(basis.editId);
    if (edit === undefined)
      return {
        ok: false,
        message: `slot ${slot}: edit ${basis.editId} is missing`,
      };
    if (
      edit.status !== "finished" ||
      edit.preview === null ||
      !finished(edit.id)
    )
      return {
        ok: false,
        message: `slot ${slot}: edit ${edit.id} is not finished`,
      };
    if (!edit.slots.includes(slot))
      return {
        ok: false,
        message: `slot ${slot}: edit ${edit.id} does not cover it`,
      };
    chain.push(edit);
    const next = edit.base[slot];
    if (next === undefined)
      return {
        ok: false,
        message: `slot ${slot}: edit ${edit.id} records no basis for it`,
      };
    if (next.kind === "frames") {
      const previous = edits.get(next.editId);
      if (previous?.preview?.sheetHash !== next.sheetHash)
        return {
          ok: false,
          message: `slot ${slot}: edit ${edit.id} was made from a sheet that is not edit ${next.editId}'s`,
        };
      basis = next;
    } else if (next.kind === "derived") {
      derivedFrom = next;
      basis = undefined;
    } else {
      const pick = set.picks[slot];
      if (
        pick === undefined ||
        pick.candidateId !== next.candidateId ||
        pick.imageHash !== next.imageHash
      )
        return {
          ok: false,
          message: `slot ${slot}: its edits do not start from its pick`,
        };
      basis = undefined;
    }
  }
  const oldest = [...chain].reverse();
  if (authored !== undefined) {
    const steps = authored.handEdits.map(
      (step) => `${step.description}|${step.method ?? ""}|${step.hash}`,
    );
    const expected = oldest.map((edit) => {
      const made = handStepOf(edit);
      return `${made.description}|${made.method ?? ""}|${edit.preview?.sheetHash}`;
    });
    if (JSON.stringify(steps) !== JSON.stringify(expected))
      return {
        ok: false,
        message: `slot ${slot}: its recorded hand edits are not the edits it came from`,
      };
    if (authored.sheetHash !== chain[0]?.preview?.sheetHash)
      return {
        ok: false,
        message: `slot ${slot}: its frames are not from its last edit's sheet`,
      };
  }
  if (derivedFrom !== undefined)
    return { ok: true, value: { edits: oldest.map((e) => e.id), derivedFrom } };
  const pick = set.picks[slot];
  if (pick === undefined)
    return {
      ok: false,
      message: `slot ${slot}: there is no pick to trace its source from`,
    };
  const job = jobs.get(pick.candidateId);
  if (
    job === undefined ||
    job.job.status !== "succeeded" ||
    job.engine === undefined
  )
    return {
      ok: false,
      message: `slot ${slot}: its source job ${pick.candidateId} is not a recorded succeeded job`,
    };
  if (!job.job.outputs.some((output) => output.hash === pick.inputHash))
    return {
      ok: false,
      message: `slot ${slot}: ${pick.inputHash} is not an output of job ${pick.candidateId}`,
    };
  return {
    ok: true,
    value: { edits: oldest.map((e) => e.id), job, inputHash: pick.inputHash },
  };
}

/** The logical animations or expressions of a manifest, by slot key, with their frames. */
export function logicalCells(
  manifest: AssetManifest,
): { key: string; frames: readonly Frame[] }[] {
  if (manifest.kind === "portrait")
    return manifest.expressions.map((e) => ({
      key: e.expression,
      frames: [e.frame],
    }));
  if (manifest.kind === "sprite")
    return manifest.animations.map((a) => ({
      key: [a.state, a.direction, a.ability]
        .filter((p) => p !== undefined)
        .join("/"),
      frames: a.frames,
    }));
  return [];
}

export function packAsset(input: PackInput, sources: PackSources): Packing {
  const { set, content, palette, prior } = sources;
  const { vocabulary } = content;
  const assetId = parseAssetId(input.assetId, "assetId");
  if (!assetId.ok) return refuse(`${assetId.path}: ${assetId.message}`);
  if (set.status !== "complete")
    return refuse(`working set ${set.id} is not complete`);
  const request = sources.requests.get(set.sheetRequestId);
  if (request === undefined)
    return refuse(`the sheet request ${set.sheetRequestId} is missing`);
  const built = buildSpec(content, request.request);
  if (!built.ok)
    return refuse(
      `the generation spec cannot be built: ${JSON.stringify(built.error)}`,
    );
  const { spec } = { spec: built.value };
  const { kind } = spec;
  const cell = { w: spec.cell.w, h: spec.cell.h };
  const visual = content.visuals.find((v) => v.godId === set.subject);
  if (
    kind === "portrait" &&
    visual?.portrait !== undefined &&
    visual.portrait !== input.assetId
  )
    return refuse(
      `the portrait of ${set.subject} is mapped to "${visual.portrait}", not "${input.assetId}"`,
    );
  if (prior !== undefined) {
    if (prior.manifest.kind !== kind)
      return refuse(
        `the published ${input.assetId} is a ${prior.manifest.kind}, not a ${kind}`,
      );
    if (prior.manifest.cell.w !== cell.w || prior.manifest.cell.h !== cell.h)
      return refuse("the published revision has a different cell size");
    if (prior.manifest.paletteFamily !== spec.palette.family)
      return refuse("the published revision is in a different palette family");
  }

  const order = slotOrder(vocabulary, kind);
  const newSlots = [...set.required].sort(order);
  const cells: Cell[] = [];
  const spans = new Map<string, number[]>();
  const colours = familyColours(palette, spec.palette.family);
  const ancestry = new Map<string, Ancestry>();

  if (
    prior === undefined &&
    (Object.keys(set.derived ?? {}).length > 0 ||
      Object.keys(set.variants ?? {}).length > 0)
  )
    return refuse(
      "a derived working set packs against a published revision, and this asset has none",
    );
  for (const slot of newSlots) {
    const derivedEntry = set.derived?.[slot];
    if (derivedEntry !== undefined) {
      // A derived slot's pixels are the recipe's: stored when the set was
      // derived, recomputed from the published source again at publish.
      if (
        prior === undefined ||
        derivedEntry.step.source.assetId !== input.assetId ||
        derivedEntry.step.source.revision !== prior.revision
      )
        return refuse(
          `slot ${slot} was derived from ${derivedEntry.step.source.assetId} ${derivedEntry.step.source.revision}, which is no longer the published revision: derive it again`,
        );
      for (const [index, frame] of derivedEntry.frames.entries()) {
        const image = decoded(
          sources.readBlob(frame.hash),
          frame.hash,
          cell,
          `${slot} frame ${index}`,
        );
        if (!image.ok) return refuse(image.message);
        cells.push({
          slot,
          image: image.image,
          durationMs: frame.durationMs,
          params: {
            background: derivedEntry.params.background,
            alphaCutoff: derivedEntry.params.alphaCutoff,
            grid: derivedEntry.params.grid,
          },
        });
      }
      continue;
    }
    const authored = set.frames[slot];
    const pick = set.picks[slot];
    const stored: { hash: Sha256; durationMs: number }[] = [];
    let params: CandidateParams | undefined = pick?.params;
    if (authored !== undefined) {
      stored.push(...authored.frames);
      params = sources.edits.get(authored.editId)?.evidence[slot]?.params;
    } else if (kind === "portrait" && pick !== undefined) {
      if (input.stillFrameMs === undefined)
        return refuse(
          `${slot} is a picked frame: the still frame time must be given`,
        );
      stored.push({ hash: pick.imageHash, durationMs: input.stillFrameMs });
    } else return refuse(`slot ${slot} has no frames`);
    if (params === undefined)
      return refuse(`slot ${slot}: there is no conformance evidence for it`);
    for (const [index, frame] of stored.entries()) {
      const image = decoded(
        sources.readBlob(frame.hash),
        frame.hash,
        cell,
        `${slot} frame ${index}`,
      );
      if (!image.ok) return refuse(image.message);
      cells.push({
        slot,
        image: image.image,
        durationMs: frame.durationMs,
        params: {
          background: params.background,
          alphaCutoff: params.alphaCutoff,
          grid: params.grid,
        },
      });
    }
    const traced = trace(slot, sources);
    if (!traced.ok) return refuse(traced.message);
    ancestry.set(slot, traced.value);
  }

  // Derived and generated lineage never share a revision: a repair lands in its own.
  const derivedSlots = newSlots.filter(
    (slot) =>
      set.derived?.[slot] !== undefined ||
      ancestry.get(slot)?.derivedFrom !== undefined,
  );
  const generatedSlots = newSlots.filter(
    (slot) => ancestry.get(slot)?.job !== undefined,
  );
  if (derivedSlots.length > 0 && generatedSlots.length > 0)
    return refuse(
      `the working set mixes derived slots (${derivedSlots.join(", ")}) with generated slots (${generatedSlots.join(", ")}): pack them in separate revisions`,
    );
  for (const slot of newSlots) {
    const from = ancestry.get(slot)?.derivedFrom;
    if (
      from !== undefined &&
      (prior === undefined ||
        from.assetId !== input.assetId ||
        from.revision !== prior.revision)
    )
      return refuse(
        `slot ${slot} was hand-edited from a slot derived from ${from.assetId} ${from.revision}, which is no longer the published revision`,
      );
  }

  // Cells of the published revision that this working set does not replace.
  const carriedKeys: string[] = [];
  const carriedCells = new Map<
    string,
    { image: RgbaImage; durationMs: number }[]
  >();
  let atlasOfPrior: RgbaImage | undefined;
  const priorEntries = prior === undefined ? [] : logicalCells(prior.manifest);
  if (prior !== undefined) {
    const decodedPrior = decodePng(prior.atlas);
    if (!decodedPrior.ok)
      return refuse("the published atlas cannot be decoded");
    atlasOfPrior = decodedPrior.image;
    for (const entry of priorEntries) {
      if (set.required.includes(entry.key)) continue;
      carriedKeys.push(entry.key);
      carriedCells.set(
        entry.key,
        entry.frames.map((frame) => ({
          image: crop(
            atlasOfPrior as RgbaImage,
            frame.rect.x,
            frame.rect.y,
            cell.w,
            cell.h,
          ),
          durationMs: frame.durationMs,
        })),
      );
    }
  }
  for (const key of carriedKeys)
    for (const carried of carriedCells.get(key) ?? [])
      cells.push({
        slot: key,
        image: carried.image,
        durationMs: carried.durationMs,
      });

  const allKeys = [...new Set(cells.map((c) => c.slot))].sort(order);
  if (kind === "portrait") {
    const missing = vocabulary.expressions.filter((e) => !allKeys.includes(e));
    if (missing.length > 0)
      return refuse(
        `the portrait is missing ${missing.join(", ")}: it needs every expression, from this set or from the published revision`,
      );
  }
  const ordered: Cell[] = allKeys.flatMap((key) =>
    cells.filter((c) => c.slot === key),
  );
  for (const [index, entry] of ordered.entries()) {
    const list = spans.get(entry.slot) ?? [];
    list.push(index);
    spans.set(entry.slot, list);
  }

  // Pivot and footprint: one pivot for the sprite, which the hand work and the spec must agree on.
  let pivot: { x: number; y: number } | undefined;
  if (kind === "sprite") {
    const pivots = newSlots.flatMap((slot) => {
      const p = set.frames[slot]?.pivot;
      return p === null || p === undefined ? [] : [p];
    });
    const first = pivots[0];
    if (pivots.some((p) => p.x !== first?.x || p.y !== first?.y))
      return refuse("the hand-finished slots disagree on the pivot");
    pivot = first ?? spec.pivot;
    if (pivot === undefined) return refuse("the sprite has no pivot");
    if (input.footprint === undefined)
      return refuse("a sprite needs its footprint");
    if (prior?.manifest.kind === "sprite") {
      if (
        prior.manifest.pivot.x !== pivot.x ||
        prior.manifest.pivot.y !== pivot.y
      )
        return refuse("the published revision has a different pivot");
      if (
        prior.manifest.footprint.w !== input.footprint.w ||
        prior.manifest.footprint.h !== input.footprint.h
      )
        return refuse("the published revision has a different footprint");
    }
  }

  // Fresh report-only conformance for the cells this pack takes from the working
  // set. A carried cell keeps the pixels and timings its published revision
  // vouched for; it is not measured again, and the report names it instead.
  const checks: { check: string; status: "pass" | "fail"; message?: string }[] =
    [];
  for (const [index, entry] of ordered.entries()) {
    if (entry.params === undefined) continue;
    // A west cell is held to its east cell, flipped, unless the subject declares
    // an asymmetry (then the pair is not compared).
    const key = parseSlotKey(entry.slot);
    const east =
      kind === "sprite" && key.direction === "west"
        ? ordered.filter(
            (c) =>
              c.slot ===
              [key.state, "east", key.ability]
                .filter((p) => p !== undefined)
                .join("/"),
          )[(spans.get(entry.slot) ?? []).indexOf(index)]
        : undefined;
    const result = conformImage({
      rgba: entry.image.rgba,
      width: entry.image.width,
      height: entry.image.height,
      kind,
      mode: "report-only",
      cell,
      ...(pivot === undefined ? {} : { pivot }),
      paletteRgb: colours,
      background: entry.params.background,
      alphaCutoff: entry.params.alphaCutoff,
      grid: entry.params.grid,
      scale: 1,
      ...(east === undefined
        ? {}
        : {
            mirror: {
              east: east.image,
              west: entry.image,
              asymmetry: visual?.asymmetry !== undefined,
            },
          }),
    });
    if (result.status !== "done")
      return refuse(
        `${entry.slot} cannot be reported on: ${result.status === "invalid-input" ? `${result.field}: ${result.message}` : result.message}`,
      );
    const where = spans.get(entry.slot) ?? [];
    const name =
      kind === "portrait"
        ? `portrait/${entry.slot}`
        : `${entry.slot}#${where.indexOf(index)}`;
    for (const check of result.report.checks)
      checks.push({
        check: `${name}:${check.check}`,
        status: check.status,
        ...(check.message === undefined ? {} : { message: check.message }),
      });
  }
  const report: ConformanceReport = {
    schemaVersion: 1,
    status: checks.some((c) => c.status === "fail") ? "fail" : "pass",
    checks,
    ...(prior === undefined || carriedKeys.length === 0
      ? {}
      : {
          carried: carriedKeys
            .slice()
            .sort(order)
            .map((key) => ({ key, revision: prior.revision })),
        }),
  };

  // The atlas: one untrimmed row of native cells, pixels copied as they are.
  const width = ordered.length * cell.w;
  const rgba = new Uint8Array(width * cell.h * 4);
  for (const [index, entry] of ordered.entries())
    for (let row = 0; row < cell.h; row += 1)
      rgba.set(
        entry.image.rgba.subarray(row * cell.w * 4, (row + 1) * cell.w * 4),
        (row * width + index * cell.w) * 4,
      );
  const atlas = encodeRgbaPng(rgba, width, cell.h);
  const frameOf = (index: number) => ({
    rect: { x: index * cell.w, y: 0, w: cell.w, h: cell.h },
    durationMs: (ordered[index] as Cell).durationMs,
  });

  // Provenance from what the studio recorded.
  const generations = new Map<string, GenerationRef>();
  const editIds = new Set<string>();
  for (const slot of newSlots) {
    const found = ancestry.get(slot);
    if (found === undefined) continue;
    // A slot a hand edit took from a derived slot has no job behind it.
    if (found.job === undefined || found.inputHash === undefined) {
      for (const id of found.edits) editIds.add(id);
      continue;
    }
    const { job } = found;
    const engine = job.engine as NonNullable<JobRecord["engine"]>;
    const before = generations.get(job.job.id);
    const used = before?.used ?? [];
    generations.set(job.job.id, {
      jobId: job.job.id,
      request: job.job.request,
      runtime: engine.runtime,
      model: engine.model,
      loras: engine.loras,
      encoder: engine.encoder,
      vae: engine.vae,
      seed: job.job.request.seed as number,
      settings: engine.settings,
      used: used.includes(found.inputHash) ? used : [...used, found.inputHash],
    });
    for (const id of found.edits) editIds.add(id);
  }
  // An edit starts from an earlier job's output, so that job (and the one it
  // was itself edited from) is part of the asset's provenance. A hand-authored
  // base is recorded as hand work, with the stored image's hash.
  const baseJobs = new Map<string, JobRecord>();
  const handBases = new Map<Sha256, string>();
  let editsPublished = false;
  for (const generation of generations.values()) {
    let edit = generation.request.edit;
    while (edit !== undefined) {
      const { base: from } = edit;
      if (from.kind === "hand") {
        const stored = sources.readBlob(from.image);
        if (stored === undefined || sha256Hex(stored) !== from.image)
          return refuse(
            `job ${generation.jobId} edits the hand-authored image ${from.image}, which is not a stored blob`,
          );
        handBases.set(from.image, from.description);
        break;
      }
      if (from.kind === "published") {
        // A repair starts from a frame of the revision now published for this
        // asset, so the frame is checked against that revision's own atlas.
        const at = `job ${generation.jobId} edits frame ${from.frameIndex} of ${from.slotKey} in ${from.assetId} ${from.revision}`;
        if (
          prior === undefined ||
          from.assetId !== input.assetId ||
          from.revision !== prior.revision
        )
          return refuse(
            `${at}, which is no longer the published revision of ${input.assetId}: repair from the current revision`,
          );
        const cut = cutFrame(
          prior.manifest,
          prior.atlas,
          from.slotKey,
          from.frameIndex,
        );
        if (!cut.ok) return refuse(`${at}: ${cut.message}`);
        if (cut.hash !== from.frameHash)
          return refuse(
            `${at}: frame-hash-mismatch: the frame has hash ${cut.hash}, not ${from.frameHash}`,
          );
        editsPublished = true;
        break;
      }
      if (baseJobs.has(from.jobId)) break;
      const base = sources.jobs.get(from.jobId);
      if (
        base === undefined ||
        base.job.status !== "succeeded" ||
        base.engine === undefined ||
        !base.job.outputs.some((output) => output.hash === from.output)
      )
        return refuse(
          `job ${generation.jobId} edits ${from.output} of job ${from.jobId}, which is not a recorded succeeded job with that output`,
        );
      baseJobs.set(base.job.id, base);
      edit = base.job.request.edit;
    }
  }
  const licences: LicenceRecord[] = [];
  const derivedMode =
    derivedSlots.length > 0 || Object.keys(set.variants ?? {}).length > 0;
  // Derived work carries the licences of the revision it was made from.
  if ((derivedMode || editsPublished) && prior !== undefined)
    for (const licence of prior.manifest.provenance.licences)
      licences.push(licence);
  for (const record of [
    ...[...generations.keys()].map((id) => sources.jobs.get(id) as JobRecord),
    ...baseJobs.values(),
  ])
    for (const licence of record.engine?.licences ?? [])
      if (!licences.some((l) => canonicalJson(l) === canonicalJson(licence)))
        licences.push(licence);
  const seqOf = (id: string) =>
    sources.commands.find((c) => c.type === "finish-edit" && c.jobId === id)
      ?.seq ?? 0;
  const handEdits = [
    ...[...handBases].map(([hash, description]) => ({
      description: `hand-authored edit base: ${description}`,
      hash,
    })),
    ...[...editIds]
      .sort((a, b) => seqOf(a) - seqOf(b))
      .map((id) => {
        const edit = sources.edits.get(id) as EditRecord;
        return {
          ...handStepOf(edit),
          hash: edit.preview?.sheetHash as Sha256,
        };
      }),
  ];
  if (handEdits.length > 0) {
    if (input.originalWork === undefined)
      return refuse(
        "the asset has hand edits: the licence of the owner's hand work must be given",
      );
    licences.push({
      subject: input.assetId,
      role: "original-work",
      licence: input.originalWork.licence,
      ...(input.originalWork.attribution === undefined
        ? {}
        : { attribution: input.originalWork.attribution }),
    });
  }
  const sourceRequests = new Set(
    [...generations.keys()].map(
      (id) => (sources.jobs.get(id) as JobRecord).source.requestId,
    ),
  );
  const relatedJobs: JobRef[] = [...sources.jobs.values()]
    .filter(
      (record) =>
        sourceRequests.has(record.source.requestId) ||
        baseJobs.has(record.job.id),
    )
    .filter((record) =>
      ["succeeded", "failed", "unavailable", "cancelled"].includes(
        record.job.status,
      ),
    )
    .sort(
      (a, b) =>
        a.source.requestId.localeCompare(b.source.requestId) ||
        a.source.ordinal - b.source.ordinal,
    )
    .map((record) =>
      record.job.status === "succeeded"
        ? {
            jobId: record.job.id,
            status: "succeeded" as const,
            outputs: record.job.outputs.map((output) => output.hash),
          }
        : {
            jobId: record.job.id,
            status: record.job.status as "failed" | "unavailable" | "cancelled",
          },
    );

  // Derived provenance: every step the set records, ordered like the slots, then the variants'.
  const steps: DerivedStep[] = [
    ...newSlots.flatMap((slot) => {
      const step = set.derived?.[slot]?.step;
      return step === undefined ? [] : [step];
    }),
    ...Object.keys(set.variants ?? {})
      .sort()
      .flatMap((family) => set.variants?.[family]?.steps ?? []),
  ];
  const recipes = [...new Set(steps.map((step) => step.recipe))];
  if (recipes.length > 1)
    return refuse(
      `the working set derives with more than one recipe (${recipes.join(", ")}); derive them in separate revisions`,
    );
  const sourceAssets =
    (derivedMode || editsPublished || carriedKeys.length > 0) &&
    prior !== undefined
      ? [{ assetId: input.assetId, revision: prior.revision }]
      : [];
  let provenance: Record<string, unknown>;
  if (steps.length > 0) {
    const first = steps[0] as DerivedStep;
    provenance = {
      method: "derived",
      operation: first.recipe,
      runtime: derivationRuntime(
        first.recipe as Parameters<typeof derivationRuntime>[0],
        first.version,
      ),
      steps,
      resultHashes: [...new Set(steps.map((step) => step.resultHash))],
      licences,
      relatedJobs,
      handEdits,
      sourceAssets,
    };
  } else if (derivedMode) {
    // Every slot this set made started derived and was then redrawn by hand.
    provenance = {
      method: "hand",
      licences,
      relatedJobs,
      handEdits,
      sourceAssets,
    };
  } else {
    provenance = {
      method: "generated",
      generations: [...generations.values()],
      licences,
      relatedJobs,
      handEdits,
      sourceAssets,
    };
  }
  // Realm variants are recolours of this very atlas under a recorded map, made
  // fresh at every pack; a variant atlas is never carried from the prior revision.
  const variantAtlases = new Map<Sha256, Uint8Array>();
  const realmVariants: RealmVariant[] = [];
  if (kind === "sprite") {
    const wanted = new Map<string, RealmVariant["map"]>();
    if (prior?.manifest.kind === "sprite")
      for (const variant of prior.manifest.realmVariants)
        wanted.set(variant.paletteFamily, variant.map);
    for (const [family, request] of Object.entries(set.variants ?? {}))
      wanted.set(family, request.map);
    for (const family of [...wanted.keys()].sort()) {
      const map = wanted.get(family) as RealmVariant["map"];
      const made = regenerateVariantAtlas(atlas, map, palette);
      if (!made.ok)
        return refuse(
          `the ${family} realm variant cannot be regenerated: ${made.message}`,
        );
      const blob = sha256Hex(made.png);
      variantAtlases.set(blob, made.png);
      realmVariants.push({
        paletteFamily: family,
        paletteId: palette.id,
        atlas: { blob, width, height: cell.h },
        map,
      });
    }
  }
  const common = {
    schemaVersion: 1,
    id: input.assetId,
    cell,
    pixelScale: 1,
    paletteFamily: spec.palette.family,
    paletteId: palette.id,
    styleTag: input.styleTag,
    atlas: { blob: sha256Hex(atlas), width, height: cell.h },
    provenance,
  };
  const spans2 = (key: string) => (spans.get(key) ?? []).map(frameOf);
  const json =
    kind === "portrait"
      ? {
          ...common,
          kind: "portrait",
          characterId: set.subject,
          expressions: allKeys.map((key) => ({
            expression: key,
            frame: spans2(key)[0],
          })),
        }
      : {
          ...common,
          kind: "sprite",
          pivot,
          footprint: input.footprint,
          directions: vocabulary.directions.filter((d) =>
            allKeys.some((key) => parseSlotKey(key).direction === d),
          ),
          // The subject is authoritative; the prior revision's value is not carried.
          ...(visual?.asymmetry === undefined
            ? {}
            : { asymmetry: visual.asymmetry }),
          realmVariants,
          animations: allKeys.map((key) => {
            const slot = parseSlotKey(key);
            const carried =
              prior?.manifest.kind === "sprite"
                ? prior.manifest.animations.find(
                    (a) =>
                      carriedKeys.includes(key) &&
                      [a.state, a.direction, a.ability]
                        .filter((p) => p !== undefined)
                        .join("/") === key,
                  )
                : undefined;
            return {
              state: slot.state,
              direction: slot.direction,
              ...(slot.ability === undefined ? {} : { ability: slot.ability }),
              ...(carried?.loopStart === undefined &&
              set.derived?.[key]?.loopStart === undefined
                ? {}
                : {
                    loopStart:
                      carried?.loopStart ??
                      (set.derived?.[key]?.loopStart as number),
                  }),
              frames: spans2(key),
            };
          }),
        };
  const manifest = parseAssetManifest(json, vocabulary);
  if (!manifest.ok)
    return refuse(
      `the packed manifest is not valid: ${manifest.path}: ${manifest.message}`,
    );
  return {
    ok: true,
    value: {
      manifest: manifest.value,
      atlas,
      variantAtlases,
      report,
      carried: carriedKeys,
    },
  };
}

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
  type Frame,
  type GenerationRef,
  type JobRef,
  type LicenceRecord,
  parseAssetId,
  parseAssetManifest,
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
import type { EditRecord } from "./export-import";
import { decodePng } from "./png/decode";
import { buildSpec, type StudioContent } from "./request";
import type { CommandRecord, JobRecord, RequestRecord } from "./store";
import type { WorkingSetRecord } from "./working-set";

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
  /** The conformance settings cells carried from an earlier revision are reported with. */
  readonly carriedParams?: {
    readonly background: BackgroundSpec;
    readonly alphaCutoff: number;
    readonly grid: GridParams;
  };
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
  readonly params: NonNullable<PackInput["carriedParams"]>;
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
  readonly job: JobRecord;
  readonly inputHash: Sha256;
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
      (step) => `${step.description}|${step.hash}`,
    );
    const expected = oldest.map(
      (edit) => `hand edit ${edit.id}|${edit.preview?.sheetHash}`,
    );
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

  for (const slot of newSlots) {
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
      if (input.carriedParams === undefined)
        return refuse(
          `${entry.key} is carried from the published revision: its conformance settings must be given`,
        );
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
        params: input.carriedParams as NonNullable<PackInput["carriedParams"]>,
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

  // Fresh report-only conformance per final cell.
  const checks: { check: string; status: "pass" | "fail"; message?: string }[] =
    [];
  for (const [index, entry] of ordered.entries()) {
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
    const found = ancestry.get(slot) as Ancestry;
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
  const licences: LicenceRecord[] = [];
  for (const generation of generations.values()) {
    const engine = (sources.jobs.get(generation.jobId) as JobRecord).engine;
    for (const licence of engine?.licences ?? [])
      if (!licences.some((l) => canonicalJson(l) === canonicalJson(licence)))
        licences.push(licence);
  }
  const seqOf = (id: string) =>
    sources.commands.find((c) => c.type === "finish-edit" && c.jobId === id)
      ?.seq ?? 0;
  const handEdits = [...editIds]
    .sort((a, b) => seqOf(a) - seqOf(b))
    .map((id) => ({
      description: `hand edit ${id}`,
      hash: (sources.edits.get(id) as EditRecord).preview?.sheetHash as Sha256,
    }));
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
    .filter((record) => sourceRequests.has(record.source.requestId))
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

  const provenance = {
    method: "generated",
    generations: [...generations.values()],
    licences,
    relatedJobs,
    handEdits,
    sourceAssets:
      carriedKeys.length > 0 && prior !== undefined
        ? [{ assetId: input.assetId, revision: prior.revision }]
        : [],
  };
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
          ...(prior?.manifest.kind === "sprite" && prior.manifest.asymmetry
            ? { asymmetry: prior.manifest.asymmetry }
            : {}),
          realmVariants:
            prior?.manifest.kind === "sprite"
              ? prior.manifest.realmVariants
              : [],
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
              ...(carried?.loopStart === undefined
                ? {}
                : { loopStart: carried.loopStart }),
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
    value: { manifest: manifest.value, atlas, report, carried: carriedKeys },
  };
}

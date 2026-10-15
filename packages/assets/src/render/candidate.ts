// The rendered candidate: a succeeded render job read back through its role manifest, with every
// post-step cell measured (report-only) against the asset's palette limits and the declared pivot.
// It is a separate record from an image candidate because `conformCandidate` takes exactly one
// image, and a render job has all the frames of a slot. A pick keeps a snapshot of it.
//
// Nothing here makes or changes a pixel: the cells are the post step's, stored as they are.

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
  parseString,
  type Sha256,
  stateRuleFor,
} from "@panthea/contracts";
import { conformImage } from "../conformance";
import { sha256Hex } from "../hash";
import {
  buildTarget,
  type CandidateParams,
  type CandidateTarget,
  paletteColours,
  parseCandidateParams,
  parseCandidateTarget,
} from "../studio/candidates";
import { DEFAULT_CONFORM } from "../studio/derivation";
import { decodePng } from "../studio/png/decode";
import { buildSpec, type StudioContent } from "../studio/request";
import type { JobRecord, RequestRecord } from "../studio/store";
import {
  type JobSource,
  parseJobSource,
  parseStudioVersion,
} from "../studio/workspace";
import { parseRenderJobManifest } from "./job-manifest";
import { cellPixelHash } from "./post";

export interface RenderedFrame {
  readonly hash: Sha256;
  readonly durationMs: number;
  readonly report: ConformanceReport;
}

export interface RenderedCandidate {
  readonly schemaVersion: 1;
  /** The id of the succeeded render job. */
  readonly id: string;
  readonly source: JobSource;
  readonly subject: string;
  readonly kind: "sprite" | "tile";
  /** `state/facing[/ability]`, or a tile's role. */
  readonly slotKey: string;
  /** The job's role manifest blob. */
  readonly manifest: Sha256;
  readonly revisionRecipeHash: Sha256;
  readonly slotRecipeHash: Sha256;
  readonly postStepVersion: number;
  readonly frames: readonly RenderedFrame[];
  /** Set for a looping clip; absent for a one-shot. */
  readonly loopStart?: number;
  readonly params: CandidateParams;
  readonly target: CandidateTarget;
}

function parseFrame(value: unknown, path: string): ParseResult<RenderedFrame> {
  return parseStrictRecord(
    value,
    path,
    ["hash", "durationMs", "report"],
    (r) => {
      const hash = parseSha256(r.hash, `${path}.hash`);
      if (!hash.ok) return hash;
      const durationMs = parseIntegerAtLeast(
        r.durationMs,
        `${path}.durationMs`,
        1,
      );
      if (!durationMs.ok) return durationMs;
      const report = parseConformanceReport(r.report, `${path}.report`);
      if (!report.ok) return report;
      return ok({
        hash: hash.value,
        durationMs: durationMs.value,
        report: report.value,
      });
    },
  );
}

export function parseRenderedCandidate(
  input: unknown,
): ParseResult<RenderedCandidate> {
  return parseStrictRecord(
    input,
    "renderedCandidate",
    [
      "schemaVersion",
      "id",
      "source",
      "subject",
      "kind",
      "slotKey",
      "manifest",
      "revisionRecipeHash",
      "slotRecipeHash",
      "postStepVersion",
      "frames",
      "loopStart",
      "params",
      "target",
    ],
    (r) => {
      const version = parseStudioVersion(r.schemaVersion, "renderedCandidate");
      if (!version.ok) return version;
      const id = parseSlug(r.id, "renderedCandidate.id");
      if (!id.ok) return id;
      const source = parseJobSource(r.source, "renderedCandidate.source");
      if (!source.ok) return source;
      const subject = parseSlug(r.subject, "renderedCandidate.subject");
      if (!subject.ok) return subject;
      const kind = parseEnum(r.kind, "renderedCandidate.kind", [
        "sprite",
        "tile",
      ] as const);
      if (!kind.ok) return kind;
      const slotKey = parseString(r.slotKey, "renderedCandidate.slotKey");
      if (!slotKey.ok) return slotKey;
      const manifest = parseSha256(r.manifest, "renderedCandidate.manifest");
      if (!manifest.ok) return manifest;
      const revision = parseSha256(
        r.revisionRecipeHash,
        "renderedCandidate.revisionRecipeHash",
      );
      if (!revision.ok) return revision;
      const slotHash = parseSha256(
        r.slotRecipeHash,
        "renderedCandidate.slotRecipeHash",
      );
      if (!slotHash.ok) return slotHash;
      const postStep = parseIntegerAtLeast(
        r.postStepVersion,
        "renderedCandidate.postStepVersion",
        1,
      );
      if (!postStep.ok) return postStep;
      const frames = parseArray(
        r.frames,
        "renderedCandidate.frames",
        parseFrame,
      );
      if (!frames.ok) return frames;
      if (frames.value.length === 0)
        return fail("renderedCandidate.frames", "expected at least one frame");
      let loopStart: number | undefined;
      if (r.loopStart !== undefined) {
        const parsed = parseIntegerAtLeast(
          r.loopStart,
          "renderedCandidate.loopStart",
          0,
        );
        if (!parsed.ok) return parsed;
        if (parsed.value >= frames.value.length)
          return fail("renderedCandidate.loopStart", "expected a frame index");
        loopStart = parsed.value;
      }
      const params = parseCandidateParams(r.params, "renderedCandidate.params");
      if (!params.ok) return params;
      const target = parseCandidateTarget(r.target, "renderedCandidate.target");
      if (!target.ok) return target;
      return ok({
        schemaVersion: 1,
        id: id.value,
        source: source.value,
        subject: subject.value,
        kind: kind.value,
        slotKey: slotKey.value,
        manifest: manifest.value,
        revisionRecipeHash: revision.value,
        slotRecipeHash: slotHash.value,
        postStepVersion: postStep.value,
        frames: frames.value,
        ...(loopStart === undefined ? {} : { loopStart }),
        params: params.value,
        target: target.value,
      });
    },
  );
}

export type RenderedCandidateOutcome =
  | { readonly ok: true; readonly candidate: RenderedCandidate }
  | {
      readonly ok: false;
      readonly reason: "wrong-state" | "corrupt-blob";
      readonly message: string;
    };

const refuse = (
  reason: "wrong-state" | "corrupt-blob",
  message: string,
): RenderedCandidateOutcome => ({ ok: false, reason, message });

/** Whether a job record is a render job: a succeeded job of an engine with no model. */
export const isRenderJob = (job: JobRecord): boolean =>
  job.engine !== undefined && job.engine.model === null;

/**
 * Builds the candidate of a succeeded render job. Every frame must be the cell its manifest names
 * (the stored bytes hash to it and decode to the recorded pixels), and is measured report-only
 * against the request's palette family, colour limit and declared pivot.
 */
export function buildRenderedCandidate(args: {
  readonly job: JobRecord;
  readonly request: RequestRecord;
  readonly content: StudioContent;
  readonly readBlob: (hash: Sha256) => Uint8Array | undefined;
}): RenderedCandidateOutcome {
  const { job, request, content, readBlob } = args;
  if (job.job.status !== "succeeded" || !isRenderJob(job))
    return refuse(
      "wrong-state",
      `job ${job.job.id} is not a succeeded render job`,
    );
  const manifestHash = job.engine?.settings.manifest;
  if (typeof manifestHash !== "string")
    return refuse("wrong-state", `job ${job.job.id} records no role manifest`);
  const bytes = readBlob(manifestHash as Sha256);
  if (bytes === undefined || sha256Hex(bytes) !== manifestHash)
    return refuse(
      "corrupt-blob",
      `the role manifest ${manifestHash} of job ${job.job.id} is missing or altered`,
    );
  const manifest = parseRenderJobManifest(bytes);
  if (!manifest.ok)
    return refuse(
      "corrupt-blob",
      `the role manifest of job ${job.job.id}: ${manifest.path}: ${manifest.message}`,
    );
  const m = manifest.value;
  if (m.jobId !== job.job.id || m.slotKey !== job.source.slotKey)
    return refuse(
      "wrong-state",
      `the role manifest is not job ${job.job.id}'s`,
    );
  const outputs = job.job.outputs;
  if (outputs.length !== m.frames.length)
    return refuse(
      "wrong-state",
      `job ${job.job.id} has ${outputs.length} outputs, its manifest ${m.frames.length} frames`,
    );

  const spec = buildSpec(content, request.request);
  if (!spec.ok)
    return refuse(
      "wrong-state",
      `the generation spec cannot be built: ${JSON.stringify(spec.error)}`,
    );
  const target = buildTarget(spec.value);
  const rule = stateRuleFor(
    content.vocabulary,
    m.slot.state,
    spec.value.cell.id,
  );
  if (rule === undefined)
    return refuse(
      "wrong-state",
      `${m.slot.state} is not drawn on the ${spec.value.cell.id} cell`,
    );
  // Manifest timing: the profile's own durations, recorded in the role manifest.

  const colours = paletteColours(spec.value);
  const frames: RenderedFrame[] = [];
  for (const [index, frame] of m.frames.entries()) {
    const output = outputs[index];
    if (output?.hash !== frame.cell)
      return refuse(
        "wrong-state",
        `job ${job.job.id} output ${index} is not the cell its manifest names`,
      );
    const png = readBlob(frame.cell);
    if (png === undefined || sha256Hex(png) !== frame.cell)
      return refuse(
        "corrupt-blob",
        `cell ${index} (${frame.cell}) of job ${job.job.id} is missing or altered`,
      );
    const decoded = decodePng(png);
    if (!decoded.ok)
      return refuse(
        "corrupt-blob",
        `cell ${index} of job ${job.job.id} does not decode: ${decoded.code}`,
      );
    if (cellPixelHash(decoded.image) !== frame.cellPixels)
      return refuse(
        "corrupt-blob",
        `cell ${index} of job ${job.job.id} is not the pixels its manifest recorded`,
      );
    // A tile's frame is the patch the stamper reads, not a tile cell: it is measured as a picture of
    // its own size, and the tile conformance runs on every atlas cell at pack.
    const tile = spec.value.kind === "tile";
    const result = conformImage({
      rgba: decoded.image.rgba,
      width: decoded.image.width,
      height: decoded.image.height,
      kind: "sprite",
      mode: "report-only",
      cell: tile
        ? { w: decoded.image.width, h: decoded.image.height }
        : { w: spec.value.cell.w, h: spec.value.cell.h },
      ...(spec.value.pivot === undefined ? {} : { pivot: spec.value.pivot }),
      paletteRgb: colours,
      colourLimit: spec.value.palette.maxColours,
      background: DEFAULT_CONFORM.background,
      alphaCutoff: DEFAULT_CONFORM.alphaCutoff,
      grid: DEFAULT_CONFORM.grid,
      scale: 1,
    });
    if (result.status !== "done")
      return refuse(
        "wrong-state",
        `cell ${index} of job ${job.job.id} cannot be reported on: ${result.status === "invalid-input" ? `${result.field}: ${result.message}` : result.message}`,
      );
    frames.push({
      hash: frame.cell,
      durationMs: m.slot.frameMs[index] as number,
      report: result.report,
    });
  }
  return {
    ok: true,
    candidate: {
      schemaVersion: 1,
      id: job.job.id,
      source: job.source,
      subject: request.request.subject,
      kind: spec.value.kind === "tile" ? "tile" : "sprite",
      slotKey: job.source.slotKey,
      manifest: manifestHash as Sha256,
      revisionRecipeHash: m.revisionRecipeHash,
      slotRecipeHash: m.slotRecipeHash,
      postStepVersion: m.postStepVersion,
      frames,
      ...(m.slot.loop ? { loopStart: 0 } : {}),
      params: DEFAULT_CONFORM,
      target,
    },
  };
}

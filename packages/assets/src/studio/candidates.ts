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
} from "@panthea/contracts";
import {
  type BackgroundSpec,
  type ConformanceMetrics,
  conformImage,
  type GridEvidence,
  type GridParams,
  type PixelDiff,
  type Rgb,
} from "../conformance";
import { sha256Hex } from "../hash";
import { encodeRgbaPng } from "../placeholder";
import { decodePng } from "./png/decode";
import { buildSpec, type GenerationSpec, type StudioContent } from "./request";
import type { JobRecord, RequestRecord } from "./store";
import {
  type JobSource,
  parseJobSource,
  parseStudioVersion,
} from "./workspace";

export interface ConformParams {
  readonly background: BackgroundSpec;
  readonly alphaCutoff: number;
  readonly grid: GridParams;
  readonly scale?: number;
}

export interface CandidateParams {
  readonly background: BackgroundSpec;
  readonly alphaCutoff: number;
  readonly grid: GridParams;
  readonly scale: number | null;
}

export interface CandidateTarget {
  readonly cell: {
    readonly id: string;
    readonly w: number;
    readonly h: number;
  };
  readonly pivot: { readonly x: number; readonly y: number } | null;
  readonly palette: {
    readonly id: string;
    readonly family: string;
    readonly digest: Sha256 | null;
    readonly colours: readonly string[];
  };
}

export type CandidateResult =
  | {
      readonly status: "needs-scale";
      readonly grid: GridEvidence;
      readonly message: string;
    }
  | {
      readonly status: "done";
      readonly imageHash: Sha256;
      readonly proposalHash: Sha256;
      readonly report: ConformanceReport;
      readonly metrics: ConformanceMetrics;
      readonly diff: readonly PixelDiff[];
    };

export interface CandidateRecord {
  readonly schemaVersion: 1;
  /** The id of the succeeded job whose output this is. */
  readonly id: string;
  readonly source: JobSource;
  readonly subject: string;
  readonly kind: "sprite" | "portrait";
  readonly input: {
    readonly hash: Sha256;
    readonly width: number;
    readonly height: number;
    readonly decodedSha256: string;
  };
  readonly params: CandidateParams;
  readonly target: CandidateTarget;
  readonly result: CandidateResult;
}

const HEX6 = /^#[0-9a-f]{6}$/;
const HEX8 = /^#[0-9a-f]{8}$/;

const hex =
  (re: RegExp, what: string) =>
  (value: unknown, path: string): ParseResult<string> =>
    typeof value === "string" && re.test(value)
      ? ok(value)
      : fail(path, `expected ${what}`);
const parseHex6 = hex(HEX6, "a lowercase #rrggbb colour");
const parseHex8 = hex(HEX8, "a lowercase #rrggbbaa colour");

const parseNonNegative = (value: unknown, path: string) =>
  parseIntegerAtLeast(value, path, 0);
const parsePositive = (value: unknown, path: string) =>
  parseIntegerAtLeast(value, path, 1);

function parseBoolean(value: unknown, path: string): ParseResult<boolean> {
  return typeof value === "boolean"
    ? ok(value)
    : fail(path, "expected a boolean");
}

function parseByte(value: unknown, path: string): ParseResult<number> {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 255
    ? ok(value)
    : fail(path, "expected an integer from 0 to 255");
}

function parseRgb(value: unknown, path: string): ParseResult<Rgb> {
  const parts = parseArray(value, path, parseByte);
  if (!parts.ok) return parts;
  if (parts.value.length !== 3) return fail(path, "expected three channels");
  return ok(parts.value as unknown as Rgb);
}

function parseBackground(
  value: unknown,
  path: string,
): ParseResult<BackgroundSpec> {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "alpha"
  )
    return parseStrictRecord(value, path, ["type"], () =>
      ok({ type: "alpha" } as const),
    );
  return parseStrictRecord(
    value,
    path,
    ["type", "rgb", "tolerance"],
    (record) => {
      if (record.type !== "key")
        return fail(`${path}.type`, 'expected "alpha" or "key"');
      const rgb = parseRgb(record.rgb, `${path}.rgb`);
      if (!rgb.ok) return rgb;
      const tolerance = parseByte(record.tolerance, `${path}.tolerance`);
      if (!tolerance.ok) return tolerance;
      return ok({
        type: "key",
        rgb: rgb.value,
        tolerance: tolerance.value,
      } as const);
    },
  );
}

function parseGridParams(
  value: unknown,
  path: string,
): ParseResult<GridParams> {
  return parseStrictRecord(
    value,
    path,
    ["edgeTolerance", "minConfidence", "minEdges"],
    (record) => {
      const edgeTolerance = parseByte(
        record.edgeTolerance,
        `${path}.edgeTolerance`,
      );
      if (!edgeTolerance.ok) return edgeTolerance;
      const confidence = record.minConfidence;
      if (
        typeof confidence !== "number" ||
        !(confidence > 0 && confidence <= 1)
      )
        return fail(
          `${path}.minConfidence`,
          "expected a number above 0 and at most 1",
        );
      const minEdges = parsePositive(record.minEdges, `${path}.minEdges`);
      if (!minEdges.ok) return minEdges;
      return ok({
        edgeTolerance: edgeTolerance.value,
        minConfidence: confidence,
        minEdges: minEdges.value,
      });
    },
  );
}

export function parseCandidateParams(
  value: unknown,
  path: string,
): ParseResult<CandidateParams> {
  return parseStrictRecord(
    value,
    path,
    ["background", "alphaCutoff", "grid", "scale"],
    (record) => {
      const background = parseBackground(
        record.background,
        `${path}.background`,
      );
      if (!background.ok) return background;
      const cutoff = parseIntegerAtLeast(
        record.alphaCutoff,
        `${path}.alphaCutoff`,
        1,
      );
      if (!cutoff.ok) return cutoff;
      if (cutoff.value > 255)
        return fail(`${path}.alphaCutoff`, "expected an integer from 1 to 255");
      const grid = parseGridParams(record.grid, `${path}.grid`);
      if (!grid.ok) return grid;
      let scale: number | null = null;
      if (record.scale !== null) {
        const parsed = parsePositive(record.scale, `${path}.scale`);
        if (!parsed.ok) return parsed;
        scale = parsed.value;
      }
      return ok({
        background: background.value,
        alphaCutoff: cutoff.value,
        grid: grid.value,
        scale,
      });
    },
  );
}

function parseGridEvidence(
  value: unknown,
  path: string,
): ParseResult<GridEvidence> {
  return parseStrictRecord(
    value,
    path,
    [
      "scale",
      "source",
      "confidence",
      "onGridEdges",
      "offGridEdges",
      "coarserThanCell",
    ],
    (record) => {
      const scale = parsePositive(record.scale, `${path}.scale`);
      if (!scale.ok) return scale;
      const source = parseEnum(record.source, `${path}.source`, [
        "dimensions",
        "detected",
        "supplied",
      ] as const);
      if (!source.ok) return source;
      let confidence: number | null = null;
      if (record.confidence !== null) {
        if (
          typeof record.confidence !== "number" ||
          !(record.confidence >= 0 && record.confidence <= 1)
        )
          return fail(
            `${path}.confidence`,
            "expected null or a number from 0 to 1",
          );
        confidence = record.confidence;
      }
      const on = parseNonNegative(record.onGridEdges, `${path}.onGridEdges`);
      if (!on.ok) return on;
      const off = parseNonNegative(record.offGridEdges, `${path}.offGridEdges`);
      if (!off.ok) return off;
      const coarser = parseBoolean(
        record.coarserThanCell,
        `${path}.coarserThanCell`,
      );
      if (!coarser.ok) return coarser;
      return ok({
        scale: scale.value,
        source: source.value,
        confidence,
        onGridEdges: on.value,
        offGridEdges: off.value,
        coarserThanCell: coarser.value,
      });
    },
  );
}

function parseSize(
  value: unknown,
  path: string,
): ParseResult<{ w: number; h: number }> {
  return parseStrictRecord(value, path, ["w", "h"], (record) => {
    const w = parsePositive(record.w, `${path}.w`);
    if (!w.ok) return w;
    const h = parsePositive(record.h, `${path}.h`);
    if (!h.ok) return h;
    return ok({ w: w.value, h: h.value });
  });
}

function parseMetrics(
  value: unknown,
  path: string,
): ParseResult<ConformanceMetrics> {
  return parseStrictRecord(
    value,
    path,
    [
      "resize",
      "grid",
      "blendedBlocks",
      "keyedPixels",
      "alphaChanged",
      "coloursBefore",
      "coloursAfter",
      "coloursMerged",
      "iterations",
      "colourMap",
      "pixelsRecoloured",
      "pixelsChanged",
    ],
    (record) => {
      const resize = parseStrictRecord(
        record.resize,
        `${path}.resize`,
        ["from", "to", "factor", "detected", "supplied"],
        (r) => {
          const from = parseSize(r.from, `${path}.resize.from`);
          if (!from.ok) return from;
          const to = parseSize(r.to, `${path}.resize.to`);
          if (!to.ok) return to;
          const factor = parsePositive(r.factor, `${path}.resize.factor`);
          if (!factor.ok) return factor;
          const detected = parseBoolean(r.detected, `${path}.resize.detected`);
          if (!detected.ok) return detected;
          const supplied = parseBoolean(r.supplied, `${path}.resize.supplied`);
          if (!supplied.ok) return supplied;
          return ok({
            from: from.value,
            to: to.value,
            factor: factor.value,
            detected: detected.value,
            supplied: supplied.value,
          });
        },
      );
      if (!resize.ok) return resize;
      const grid = parseGridEvidence(record.grid, `${path}.grid`);
      if (!grid.ok) return grid;
      const counts: Record<string, number> = {};
      for (const key of [
        "blendedBlocks",
        "keyedPixels",
        "alphaChanged",
        "coloursBefore",
        "coloursAfter",
        "coloursMerged",
        "iterations",
        "pixelsRecoloured",
        "pixelsChanged",
      ] as const) {
        const count = parseNonNegative(record[key], `${path}.${key}`);
        if (!count.ok) return count;
        counts[key] = count.value;
      }
      const colourMap = parseArray(
        record.colourMap,
        `${path}.colourMap`,
        (entry, entryPath) =>
          parseStrictRecord(
            entry,
            entryPath,
            ["from", "to", "pixels"],
            (item) => {
              const from = parseHex6(item.from, `${entryPath}.from`);
              if (!from.ok) return from;
              const to = parseHex6(item.to, `${entryPath}.to`);
              if (!to.ok) return to;
              const pixels = parseNonNegative(
                item.pixels,
                `${entryPath}.pixels`,
              );
              if (!pixels.ok) return pixels;
              return ok({
                from: from.value,
                to: to.value,
                pixels: pixels.value,
              });
            },
          ),
      );
      if (!colourMap.ok) return colourMap;
      return ok({
        resize: resize.value,
        grid: grid.value,
        blendedBlocks: counts.blendedBlocks as number,
        keyedPixels: counts.keyedPixels as number,
        alphaChanged: counts.alphaChanged as number,
        coloursBefore: counts.coloursBefore as number,
        coloursAfter: counts.coloursAfter as number,
        coloursMerged: counts.coloursMerged as number,
        iterations: counts.iterations as number,
        colourMap: colourMap.value,
        pixelsRecoloured: counts.pixelsRecoloured as number,
        pixelsChanged: counts.pixelsChanged as number,
      });
    },
  );
}

function parseDiff(value: unknown, path: string): ParseResult<PixelDiff> {
  return parseStrictRecord(
    value,
    path,
    ["x", "y", "before", "after"],
    (record) => {
      const x = parseNonNegative(record.x, `${path}.x`);
      if (!x.ok) return x;
      const y = parseNonNegative(record.y, `${path}.y`);
      if (!y.ok) return y;
      const before = parseHex8(record.before, `${path}.before`);
      if (!before.ok) return before;
      const after = parseHex8(record.after, `${path}.after`);
      if (!after.ok) return after;
      return ok({
        x: x.value,
        y: y.value,
        before: before.value,
        after: after.value,
      });
    },
  );
}

export function parseTargetPalette(
  value: unknown,
  path: string,
): ParseResult<CandidateTarget["palette"]> {
  return parseStrictRecord(
    value,
    path,
    ["id", "family", "digest", "colours"],
    (p) => {
      const id = parseSlug(p.id, `${path}.id`);
      if (!id.ok) return id;
      const family = parseSlug(p.family, `${path}.family`);
      if (!family.ok) return family;
      let digest: Sha256 | null = null;
      if (p.digest !== null) {
        const parsed = parseSha256(p.digest, `${path}.digest`);
        if (!parsed.ok) return parsed;
        digest = parsed.value;
      }
      const colours = parseArray(p.colours, `${path}.colours`, parseHex6);
      if (!colours.ok) return colours;
      if (colours.value.length === 0)
        return fail(`${path}.colours`, "expected at least one colour");
      return ok({
        id: id.value,
        family: family.value,
        digest,
        colours: colours.value,
      });
    },
  );
}

export function parseCandidateTarget(
  value: unknown,
  path: string,
): ParseResult<CandidateTarget> {
  return parseStrictRecord(
    value,
    path,
    ["cell", "pivot", "palette"],
    (record) => {
      const cell = parseStrictRecord(
        record.cell,
        `${path}.cell`,
        ["id", "w", "h"],
        (c) => {
          const id = parseString(c.id, `${path}.cell.id`);
          if (!id.ok) return id;
          const size = parseSize({ w: c.w, h: c.h }, `${path}.cell`);
          if (!size.ok) return size;
          return ok({ id: id.value, ...size.value });
        },
      );
      if (!cell.ok) return cell;
      let pivot: { x: number; y: number } | null = null;
      if (record.pivot !== null) {
        const parsed = parseStrictRecord(
          record.pivot,
          `${path}.pivot`,
          ["x", "y"],
          (p) => {
            const x = parseNonNegative(p.x, `${path}.pivot.x`);
            if (!x.ok) return x;
            const y = parseNonNegative(p.y, `${path}.pivot.y`);
            if (!y.ok) return y;
            return ok({ x: x.value, y: y.value });
          },
        );
        if (!parsed.ok) return parsed;
        pivot = parsed.value;
      }
      const palette = parseTargetPalette(record.palette, `${path}.palette`);
      if (!palette.ok) return palette;
      return ok({ cell: cell.value, pivot, palette: palette.value });
    },
  );
}

function parseResult(
  value: unknown,
  path: string,
): ParseResult<CandidateResult> {
  const status =
    typeof value === "object" && value !== null
      ? (value as { status?: unknown }).status
      : undefined;
  if (status === "needs-scale")
    return parseStrictRecord(
      value,
      path,
      ["status", "grid", "message"],
      (record) => {
        const grid = parseGridEvidence(record.grid, `${path}.grid`);
        if (!grid.ok) return grid;
        const message = parseString(record.message, `${path}.message`);
        if (!message.ok) return message;
        return ok({
          status: "needs-scale",
          grid: grid.value,
          message: message.value,
        } as const);
      },
    );
  return parseStrictRecord(
    value,
    path,
    ["status", "imageHash", "proposalHash", "report", "metrics", "diff"],
    (record) => {
      if (record.status !== "done")
        return fail(`${path}.status`, 'expected "done" or "needs-scale"');
      const imageHash = parseSha256(record.imageHash, `${path}.imageHash`);
      if (!imageHash.ok) return imageHash;
      const proposalHash = parseSha256(
        record.proposalHash,
        `${path}.proposalHash`,
      );
      if (!proposalHash.ok) return proposalHash;
      const report = parseConformanceReport(record.report, `${path}.report`);
      if (!report.ok) return report;
      const metrics = parseMetrics(record.metrics, `${path}.metrics`);
      if (!metrics.ok) return metrics;
      const diff = parseArray(record.diff, `${path}.diff`, parseDiff);
      if (!diff.ok) return diff;
      return ok({
        status: "done",
        imageHash: imageHash.value,
        proposalHash: proposalHash.value,
        report: report.value,
        metrics: metrics.value,
        diff: diff.value,
      } as const);
    },
  );
}

export function parseCandidateRecord(
  input: unknown,
): ParseResult<CandidateRecord> {
  return parseStrictRecord(
    input,
    "candidate",
    [
      "schemaVersion",
      "id",
      "source",
      "subject",
      "kind",
      "input",
      "params",
      "target",
      "result",
    ],
    (record) => {
      const version = parseStudioVersion(record.schemaVersion, "candidate");
      if (!version.ok) return version;
      const id = parseSlug(record.id, "candidate.id");
      if (!id.ok) return id;
      const source = parseJobSource(record.source, "candidate.source");
      if (!source.ok) return source;
      const subject = parseSlug(record.subject, "candidate.subject");
      if (!subject.ok) return subject;
      const kind = parseEnum(record.kind, "candidate.kind", [
        "sprite",
        "portrait",
      ] as const);
      if (!kind.ok) return kind;
      const inputRecord = parseStrictRecord(
        record.input,
        "candidate.input",
        ["hash", "width", "height", "decodedSha256"],
        (i) => {
          const hash = parseSha256(i.hash, "candidate.input.hash");
          if (!hash.ok) return hash;
          const size = parseSize(
            { w: i.width, h: i.height },
            "candidate.input",
          );
          if (!size.ok) return size;
          const decoded = parseSha256(
            i.decodedSha256,
            "candidate.input.decodedSha256",
          );
          if (!decoded.ok) return decoded;
          return ok({
            hash: hash.value,
            width: size.value.w,
            height: size.value.h,
            decodedSha256: decoded.value,
          });
        },
      );
      if (!inputRecord.ok) return inputRecord;
      const params = parseCandidateParams(record.params, "candidate.params");
      if (!params.ok) return params;
      const target = parseCandidateTarget(record.target, "candidate.target");
      if (!target.ok) return target;
      const result = parseResult(record.result, "candidate.result");
      if (!result.ok) return result;
      return ok({
        schemaVersion: version.value,
        id: id.value,
        source: source.value,
        subject: subject.value,
        kind: kind.value,
        input: inputRecord.value,
        params: params.value,
        target: target.value,
        result: result.value,
      });
    },
  );
}

const hexOf = (rgb: Rgb): string =>
  `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** The subject's palette family ramps as colours, each once, in first-seen order. */
export function paletteColours(spec: GenerationSpec): Rgb[] {
  const seen = new Set<string>();
  const colours: Rgb[] = [];
  for (const ramp of spec.palette.ramps)
    for (const shade of ramp.shades) {
      const key = hexOf(shade);
      if (seen.has(key)) continue;
      seen.add(key);
      colours.push(shade);
    }
  return colours;
}

export function buildTarget(spec: GenerationSpec): CandidateTarget {
  const { approval } = spec.palette;
  return {
    cell: { id: spec.cell.id, w: spec.cell.w, h: spec.cell.h },
    pivot:
      spec.pivot === undefined ? null : { x: spec.pivot.x, y: spec.pivot.y },
    palette: {
      id: spec.palette.id,
      family: spec.palette.family,
      digest: approval.status === "approved" ? approval.digest : null,
      colours: paletteColours(spec).map(hexOf),
    },
  };
}

export type ChainFailure =
  | "wrong-state"
  | "invalid-params"
  | "unsupported-png"
  | "corrupt-png";

export type ConformOutcome =
  | {
      readonly ok: true;
      readonly candidate: CandidateRecord;
      /** Encoded PNGs to store before the record; none for needs-scale. */
      readonly blobs: readonly Uint8Array[];
    }
  | {
      readonly ok: false;
      readonly reason: ChainFailure;
      readonly message: string;
    };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The options as conformance will use and the record will keep: only the known
 * fields, copied. A value that is not the right shape passes through untouched
 * so that conformance still refuses it.
 */
function effectiveParams(params: ConformParams): ConformParams {
  const { background, grid } = params;
  let kept: ConformParams["background"] = background;
  if (isObject(background) && background.type === "alpha") {
    kept = { type: "alpha" };
  } else if (isObject(background) && background.type === "key") {
    const { rgb } = background;
    kept = {
      type: "key",
      rgb:
        Array.isArray(rgb) && rgb.length === 3 ? [rgb[0], rgb[1], rgb[2]] : rgb,
      tolerance: background.tolerance,
    } as ConformParams["background"];
  }
  return {
    background: kept,
    alphaCutoff: params.alphaCutoff,
    grid: isObject(grid)
      ? {
          edgeTolerance: grid.edgeTolerance,
          minConfidence: grid.minConfidence,
          minEdges: grid.minEdges,
        }
      : grid,
    ...(params.scale === undefined ? {} : { scale: params.scale }),
  } as ConformParams;
}

const refuse = (reason: ChainFailure, message: string): ConformOutcome => ({
  ok: false,
  reason,
  message,
});

/**
 * Conforms a succeeded job's original image with exactly the caller's options.
 * The original bytes are checked against the job's output hash and decoded by
 * the bounded decoder; nothing the runtime handed back is trusted.
 */
export function conformCandidate(args: {
  readonly job: JobRecord;
  readonly request: RequestRecord;
  readonly original: Uint8Array | undefined;
  readonly content: StudioContent;
  readonly params: ConformParams;
}): ConformOutcome {
  const { job, request, original, content } = args;
  const params = effectiveParams(args.params);
  if (job.job.status !== "succeeded")
    return refuse(
      "wrong-state",
      `job ${job.job.id} is ${job.job.status}, not succeeded`,
    );
  const [output] = job.job.outputs;
  if (job.job.outputs.length !== 1 || output?.medium !== "image")
    return refuse(
      "wrong-state",
      `job ${job.job.id} needs exactly one image output`,
    );
  if (original === undefined)
    return refuse(
      "corrupt-png",
      `the original image ${output.hash} is missing`,
    );
  if (sha256Hex(original) !== output.hash)
    return refuse(
      "corrupt-png",
      `the original image does not match its recorded hash ${output.hash}`,
    );
  const decoded = decodePng(original);
  if (!decoded.ok) return refuse(decoded.code, decoded.message);

  const spec = buildSpec(content, request.request);
  if (!spec.ok)
    return refuse(
      "wrong-state",
      `cannot rebuild the generation spec: ${JSON.stringify(spec.error)}`,
    );
  if (!spec.value.slots.some((slot) => slot.key === job.source.slotKey))
    return refuse("wrong-state", `the spec has no slot ${job.source.slotKey}`);
  const { width, height } = decoded.image;
  if (width !== output.width || height !== output.height)
    return refuse(
      "corrupt-png",
      `the image is ${width}x${height}, the job output says ${output.width}x${output.height}`,
    );
  const { generated } = spec.value;
  if (width !== generated.w || height !== generated.h)
    return refuse(
      "corrupt-png",
      `the image is ${width}x${height}, expected ${generated.w}x${generated.h}`,
    );

  const target = buildTarget(spec.value);
  const result = conformImage({
    rgba: decoded.image.rgba,
    width,
    height,
    kind: spec.value.kind,
    mode: "auto",
    cell: { w: spec.value.cell.w, h: spec.value.cell.h },
    ...(spec.value.pivot === undefined ? {} : { pivot: spec.value.pivot }),
    paletteRgb: paletteColours(spec.value),
    background: params.background,
    alphaCutoff: params.alphaCutoff,
    grid: params.grid,
    ...(params.scale === undefined ? {} : { scale: params.scale }),
  });
  if (result.status === "invalid-input")
    return refuse("invalid-params", `${result.field}: ${result.message}`);

  const base = {
    schemaVersion: 1 as const,
    id: job.job.id,
    source: job.source,
    subject: spec.value.subject,
    kind: spec.value.kind,
    input: {
      hash: output.hash,
      width,
      height,
      decodedSha256: sha256Hex(decoded.image.rgba),
    },
    params: {
      background: params.background,
      alphaCutoff: params.alphaCutoff,
      grid: params.grid,
      scale: params.scale ?? null,
    },
    target,
  };
  if (result.status === "needs-scale")
    return {
      ok: true,
      blobs: [],
      candidate: {
        ...base,
        result: {
          status: "needs-scale",
          grid: result.grid,
          message: result.message,
        },
      },
    };
  const image = encodeRgbaPng(
    result.image.rgba,
    result.image.width,
    result.image.height,
  );
  const proposal = encodeRgbaPng(
    result.proposal.rgba,
    result.proposal.width,
    result.proposal.height,
  );
  return {
    ok: true,
    blobs: [image, proposal],
    candidate: {
      ...base,
      result: {
        status: "done",
        imageHash: sha256Hex(image),
        proposalHash: sha256Hex(proposal),
        report: result.report,
        metrics: result.metrics,
        diff: result.diff,
      },
    },
  };
}

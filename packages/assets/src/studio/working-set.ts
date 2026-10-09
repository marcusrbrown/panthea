import {
  type ConformanceReport,
  fail,
  type HandEditStep,
  isRecord,
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
  type CandidateParams,
  type CandidateRecord,
  type CandidateTarget,
  parseCandidateParams,
  parseTargetPalette,
} from "./candidates";
import { type StudioContent, slotKey } from "./request";
import type { RequestRecord } from "./store";
import {
  type JobSource,
  parseJobSource,
  parseStudioVersion,
} from "./workspace";

/** What a pick keeps: a snapshot, never a pointer to the candidate that may be re-conformed. */
export interface Keyframe {
  readonly candidateId: string;
  readonly source: JobSource;
  readonly inputHash: Sha256;
  readonly decodedSha256: string;
  readonly imageHash: Sha256;
  readonly params: CandidateParams;
  readonly palette: CandidateTarget["palette"];
  readonly report: ConformanceReport;
}

/** What a slot's frames were made from: a picked keyframe or an earlier edit's frames. */
export type SlotBasis =
  | {
      readonly kind: "keyframe";
      readonly candidateId: string;
      readonly imageHash: Sha256;
    }
  | {
      readonly kind: "frames";
      readonly editId: string;
      readonly sheetHash: Sha256;
    };

export interface FrameRef {
  readonly hash: Sha256;
  readonly durationMs: number;
}

/** The hand-finished frames of one slot; they stand in for the pick. */
export interface AuthoredFrames {
  readonly editId: string;
  readonly basis: SlotBasis;
  readonly sheetHash: Sha256;
  readonly frames: readonly FrameRef[];
  readonly pivot: { readonly x: number; readonly y: number } | null;
  readonly handEdits: readonly HandEditStep[];
}

export interface FrameLimits {
  readonly min: number;
  readonly max: number;
}

export interface WorkingSetRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly subject: string;
  readonly kind: "sprite" | "portrait";
  /** The request whose candidates the sheet currently shows; replaceable. */
  readonly sheetRequestId: string;
  readonly required: readonly string[];
  /** How many frames each required slot takes, from the vocabulary at open time. */
  readonly limits: Readonly<Record<string, FrameLimits>>;
  readonly picks: Readonly<Record<string, Keyframe>>;
  readonly frames: Readonly<Record<string, AuthoredFrames>>;
  readonly status: "open" | "complete";
}

/**
 * A portrait is complete when every expression has a pick or authored frames;
 * a sprite is complete when every required slot has authored frames within its
 * frame limits. Picks alone never complete a sprite.
 */
export function deriveStatus(
  kind: "sprite" | "portrait",
  required: readonly string[],
  picks: Readonly<Record<string, Keyframe>>,
  frames: Readonly<Record<string, AuthoredFrames>>,
  limits: Readonly<Record<string, FrameLimits>>,
): "open" | "complete" {
  const done = (slot: string) => {
    const authored = frames[slot];
    const limit = limits[slot];
    if (authored !== undefined && limit !== undefined)
      return (
        authored.frames.length >= limit.min &&
        authored.frames.length <= limit.max
      );
    return kind === "portrait" && picks[slot] !== undefined;
  };
  return required.every(done) ? "complete" : "open";
}

/** What a slot's current frames came from: its authored frames, else its pick. */
export function slotBasisOf(
  set: WorkingSetRecord,
  slot: string,
): SlotBasis | undefined {
  const authored = set.frames[slot];
  if (authored !== undefined)
    return {
      kind: "frames",
      editId: authored.editId,
      sheetHash: authored.sheetHash,
    };
  const pick = set.picks[slot];
  if (pick !== undefined)
    return {
      kind: "keyframe",
      candidateId: pick.candidateId,
      imageHash: pick.imageHash,
    };
  return undefined;
}

export function parsePoint(
  value: unknown,
  path: string,
): ParseResult<{ x: number; y: number }> {
  return parseStrictRecord(value, path, ["x", "y"], (record) => {
    const x = parseIntegerAtLeast(record.x, `${path}.x`, 0);
    if (!x.ok) return x;
    const y = parseIntegerAtLeast(record.y, `${path}.y`, 0);
    if (!y.ok) return y;
    return ok({ x: x.value, y: y.value });
  });
}

export function parseSlotBasis(
  value: unknown,
  path: string,
): ParseResult<SlotBasis> {
  const kind = isRecord(value) ? value.kind : undefined;
  if (kind === "keyframe")
    return parseStrictRecord(
      value,
      path,
      ["kind", "candidateId", "imageHash"],
      (record) => {
        const candidateId = parseSlug(
          record.candidateId,
          `${path}.candidateId`,
        );
        if (!candidateId.ok) return candidateId;
        const imageHash = parseSha256(record.imageHash, `${path}.imageHash`);
        if (!imageHash.ok) return imageHash;
        return ok({
          kind: "keyframe",
          candidateId: candidateId.value,
          imageHash: imageHash.value,
        } as const);
      },
    );
  return parseStrictRecord(
    value,
    path,
    ["kind", "editId", "sheetHash"],
    (record) => {
      if (record.kind !== "frames")
        return fail(`${path}.kind`, 'expected "keyframe" or "frames"');
      const editId = parseSlug(record.editId, `${path}.editId`);
      if (!editId.ok) return editId;
      const sheetHash = parseSha256(record.sheetHash, `${path}.sheetHash`);
      if (!sheetHash.ok) return sheetHash;
      return ok({
        kind: "frames",
        editId: editId.value,
        sheetHash: sheetHash.value,
      } as const);
    },
  );
}

export function parseFrameRefs(
  value: unknown,
  path: string,
): ParseResult<readonly FrameRef[]> {
  return parseArray(value, path, (item, itemPath) =>
    parseStrictRecord(item, itemPath, ["hash", "durationMs"], (record) => {
      const hash = parseSha256(record.hash, `${itemPath}.hash`);
      if (!hash.ok) return hash;
      const durationMs = parseIntegerAtLeast(
        record.durationMs,
        `${itemPath}.durationMs`,
        1,
      );
      if (!durationMs.ok) return durationMs;
      return ok({ hash: hash.value, durationMs: durationMs.value });
    }),
  );
}

export function parseHandEdits(
  value: unknown,
  path: string,
): ParseResult<readonly HandEditStep[]> {
  return parseArray(value, path, (item, itemPath) =>
    parseStrictRecord(
      item,
      itemPath,
      ["description", "hash", "method"],
      (record) => {
        const description = parseString(
          record.description,
          `${itemPath}.description`,
        );
        if (!description.ok) return description;
        let method: HandEditStep["method"];
        if (record.method !== undefined) {
          const parsed = parseEnum(record.method, `${itemPath}.method`, [
            "hand",
            "script",
          ] as const);
          if (!parsed.ok) return parsed;
          method = parsed.value;
        }
        let hash: Sha256 | undefined;
        if (record.hash !== undefined) {
          const parsed = parseSha256(record.hash, `${itemPath}.hash`);
          if (!parsed.ok) return parsed;
          hash = parsed.value;
        }
        return ok({
          description: description.value,
          ...(hash === undefined ? {} : { hash }),
          ...(method === undefined ? {} : { method }),
        });
      },
    ),
  );
}

export function parseAuthoredFrames(
  value: unknown,
  path: string,
): ParseResult<AuthoredFrames> {
  return parseStrictRecord(
    value,
    path,
    ["editId", "basis", "sheetHash", "frames", "pivot", "handEdits"],
    (record) => {
      const editId = parseSlug(record.editId, `${path}.editId`);
      if (!editId.ok) return editId;
      const basis = parseSlotBasis(record.basis, `${path}.basis`);
      if (!basis.ok) return basis;
      const sheetHash = parseSha256(record.sheetHash, `${path}.sheetHash`);
      if (!sheetHash.ok) return sheetHash;
      const frames = parseFrameRefs(record.frames, `${path}.frames`);
      if (!frames.ok) return frames;
      let pivot: { x: number; y: number } | null = null;
      if (record.pivot !== null) {
        const parsed = parsePoint(record.pivot, `${path}.pivot`);
        if (!parsed.ok) return parsed;
        pivot = parsed.value;
      }
      const handEdits = parseHandEdits(record.handEdits, `${path}.handEdits`);
      if (!handEdits.ok) return handEdits;
      return ok({
        editId: editId.value,
        basis: basis.value,
        sheetHash: sheetHash.value,
        frames: frames.value,
        pivot,
        handEdits: handEdits.value,
      });
    },
  );
}

function parseLimits(
  value: unknown,
  required: readonly string[],
): ParseResult<Record<string, FrameLimits>> {
  if (!isRecord(value)) return fail("workingSet.limits", "expected an object");
  const stray = Object.keys(value).find((slot) => !required.includes(slot));
  if (stray !== undefined)
    return fail(
      `workingSet.limits.${stray}`,
      "limits for a slot that is not required",
    );
  const limits: Record<string, FrameLimits> = {};
  for (const slot of required) {
    const path = `workingSet.limits.${slot}`;
    const parsed = parseStrictRecord(
      value[slot],
      path,
      ["min", "max"],
      (record) => {
        const min = parseIntegerAtLeast(record.min, `${path}.min`, 1);
        if (!min.ok) return min;
        const max = parseIntegerAtLeast(record.max, `${path}.max`, min.value);
        if (!max.ok) return max;
        return ok({ min: min.value, max: max.value });
      },
    );
    if (!parsed.ok) return parsed;
    limits[slot] = parsed.value;
  }
  return ok(limits);
}

function parseKeyframe(value: unknown, path: string): ParseResult<Keyframe> {
  return parseStrictRecord(
    value,
    path,
    [
      "candidateId",
      "source",
      "inputHash",
      "decodedSha256",
      "imageHash",
      "params",
      "palette",
      "report",
    ],
    (record) => {
      const candidateId = parseSlug(record.candidateId, `${path}.candidateId`);
      if (!candidateId.ok) return candidateId;
      const source = parseJobSource(record.source, `${path}.source`);
      if (!source.ok) return source;
      const inputHash = parseSha256(record.inputHash, `${path}.inputHash`);
      if (!inputHash.ok) return inputHash;
      const decoded = parseSha256(
        record.decodedSha256,
        `${path}.decodedSha256`,
      );
      if (!decoded.ok) return decoded;
      const imageHash = parseSha256(record.imageHash, `${path}.imageHash`);
      if (!imageHash.ok) return imageHash;
      const params = parseCandidateParams(record.params, `${path}.params`);
      if (!params.ok) return params;
      const palette = parseTargetPalette(record.palette, `${path}.palette`);
      if (!palette.ok) return palette;
      const report = parseConformanceReport(record.report, `${path}.report`);
      if (!report.ok) return report;
      return ok({
        candidateId: candidateId.value,
        source: source.value,
        inputHash: inputHash.value,
        decodedSha256: decoded.value,
        imageHash: imageHash.value,
        params: params.value,
        palette: palette.value,
        report: report.value,
      });
    },
  );
}

export function parseWorkingSetRecord(
  input: unknown,
): ParseResult<WorkingSetRecord> {
  return parseStrictRecord(
    input,
    "workingSet",
    [
      "schemaVersion",
      "id",
      "subject",
      "kind",
      "sheetRequestId",
      "required",
      "limits",
      "picks",
      "frames",
      "status",
    ],
    (record) => {
      const version = parseStudioVersion(record.schemaVersion, "workingSet");
      if (!version.ok) return version;
      const id = parseSlug(record.id, "workingSet.id");
      if (!id.ok) return id;
      const subject = parseSlug(record.subject, "workingSet.subject");
      if (!subject.ok) return subject;
      const kind = parseEnum(record.kind, "workingSet.kind", [
        "sprite",
        "portrait",
      ] as const);
      if (!kind.ok) return kind;
      const sheet = parseSlug(
        record.sheetRequestId,
        "workingSet.sheetRequestId",
      );
      if (!sheet.ok) return sheet;
      const required = parseArray(
        record.required,
        "workingSet.required",
        parseString,
      );
      if (!required.ok) return required;
      if (required.value.length === 0)
        return fail("workingSet.required", "expected at least one slot");
      if (new Set(required.value).size !== required.value.length)
        return fail("workingSet.required", "expected unique slots");
      const limits = parseLimits(record.limits, required.value);
      if (!limits.ok) return limits;
      if (!isRecord(record.picks))
        return fail("workingSet.picks", "expected an object");
      if (!isRecord(record.frames))
        return fail("workingSet.frames", "expected an object");
      const strayFrames = Object.keys(record.frames).find(
        (slot) => !required.value.includes(slot),
      );
      if (strayFrames !== undefined)
        return fail(
          `workingSet.frames.${strayFrames}`,
          "frames for a slot that is not required",
        );
      const stray = Object.keys(record.picks).find(
        (slot) => !required.value.includes(slot),
      );
      if (stray !== undefined)
        return fail(
          `workingSet.picks.${stray}`,
          "a pick for a slot that is not required",
        );
      const picks: Record<string, Keyframe> = {};
      for (const slot of required.value) {
        const value = record.picks[slot];
        if (value === undefined) continue;
        const frame = parseKeyframe(value, `workingSet.picks.${slot}`);
        if (!frame.ok) return frame;
        picks[slot] = frame.value;
      }
      const frames: Record<string, AuthoredFrames> = {};
      for (const slot of required.value) {
        const value = record.frames[slot];
        if (value === undefined) continue;
        const authored = parseAuthoredFrames(
          value,
          `workingSet.frames.${slot}`,
        );
        if (!authored.ok) return authored;
        const limit = limits.value[slot] as FrameLimits;
        if (
          authored.value.frames.length < limit.min ||
          authored.value.frames.length > limit.max
        )
          return fail(
            `workingSet.frames.${slot}`,
            `expected ${limit.min}-${limit.max} frames, got ${authored.value.frames.length}`,
          );
        frames[slot] = authored.value;
      }
      const status = parseEnum(record.status, "workingSet.status", [
        "open",
        "complete",
      ] as const);
      if (!status.ok) return status;
      if (
        status.value !==
        deriveStatus(kind.value, required.value, picks, frames, limits.value)
      )
        return fail(
          "workingSet.status",
          `status ${status.value} disagrees with the picks`,
        );
      return ok({
        schemaVersion: version.value,
        id: id.value,
        subject: subject.value,
        kind: kind.value,
        sheetRequestId: sheet.value,
        required: required.value,
        limits: limits.value,
        picks,
        frames,
        status: status.value,
      });
    },
  );
}

export type WorkingSetResult =
  | { readonly ok: true; readonly record: WorkingSetRecord }
  | {
      readonly ok: false;
      readonly reason: "wrong-state";
      readonly message: string;
    };

const refuse = (message: string): WorkingSetResult => ({
  ok: false,
  reason: "wrong-state",
  message,
});

/** A new, empty working set for a request: its kind and subject, and the slots it needs. */
export function newWorkingSet(
  id: string,
  request: RequestRecord,
  content: StudioContent,
): WorkingSetResult {
  const { kind, subject, slots } = request.request;
  if (kind !== "sprite" && kind !== "portrait")
    return refuse(`a ${kind} request has no working set`);
  const chosen = slots.map(slotKey);
  const unknown =
    kind === "portrait"
      ? chosen.find((slot) => !content.vocabulary.expressions.includes(slot))
      : undefined;
  if (unknown !== undefined)
    return refuse(`expression ${unknown} is not in the vocabulary`);
  const required =
    kind === "portrait"
      ? content.vocabulary.expressions.filter((slot) => chosen.includes(slot))
      : chosen;
  const limits: Record<string, FrameLimits> = {};
  for (const slot of required) {
    if (kind === "portrait") {
      limits[slot] = { min: 1, max: 1 };
      continue;
    }
    const rule = content.vocabulary.states.find(
      (state) => state.id === slot.split("/")[0],
    );
    if (rule === undefined) return refuse(`slot ${slot} names no known state`);
    limits[slot] = { min: rule.frames.min, max: rule.frames.max };
  }
  return {
    ok: true,
    record: {
      schemaVersion: 1,
      id,
      subject,
      kind,
      sheetRequestId: request.id,
      required,
      limits,
      picks: {},
      frames: {},
      status: "open",
    },
  };
}

/** Points the set at another request's candidates; picks stay as they are. */
export function replaceSheetOf(
  set: WorkingSetRecord,
  request: RequestRecord,
): WorkingSetResult {
  if (
    request.request.kind !== set.kind ||
    request.request.subject !== set.subject
  )
    return refuse(
      `request ${request.id} is a ${request.request.kind} for ${request.request.subject}, not a ${set.kind} for ${set.subject}`,
    );
  return {
    ok: true,
    record: {
      ...set,
      sheetRequestId: request.id,
      status: deriveStatus(
        set.kind,
        set.required,
        set.picks,
        set.frames,
        set.limits,
      ),
    },
  };
}

/**
 * Snapshots a done candidate of the current sheet into a slot, replacing an
 * earlier pick. The slot defaults to the candidate's own. A portrait may take a
 * candidate from another expression (every expression is edited from one
 * face); a sprite slot only takes a candidate drawn for it. Either way the
 * keyframe keeps the candidate's real source, so lineage is never rewritten.
 */
export function pickKeyframe(
  set: WorkingSetRecord,
  candidate: CandidateRecord,
  target?: string,
): WorkingSetResult {
  if (candidate.result.status !== "done")
    return refuse(
      `candidate ${candidate.id} needs a scale and cannot be picked`,
    );
  if (candidate.kind !== set.kind || candidate.subject !== set.subject)
    return refuse(
      `candidate ${candidate.id} is a ${candidate.kind} for ${candidate.subject}, not a ${set.kind} for ${set.subject}`,
    );
  if (candidate.source.requestId !== set.sheetRequestId)
    return refuse(
      `candidate ${candidate.id} is from request ${candidate.source.requestId}, not the current sheet ${set.sheetRequestId}`,
    );
  const slot = target ?? candidate.source.slotKey;
  if (slot !== candidate.source.slotKey && set.kind !== "portrait")
    return refuse(
      `candidate ${candidate.id} was drawn for ${candidate.source.slotKey}; a ${set.kind} slot only takes a candidate drawn for it, not ${slot}`,
    );
  if (!set.required.includes(slot))
    return refuse(`slot ${slot} is not one this working set needs`);
  if (set.frames[slot] !== undefined)
    return refuse(
      `slot ${slot} has authored frames; a pick would not replace them`,
    );
  const frame: Keyframe = {
    candidateId: candidate.id,
    source: candidate.source,
    inputHash: candidate.input.hash,
    decodedSha256: candidate.input.decodedSha256,
    imageHash: candidate.result.imageHash,
    params: candidate.params,
    palette: candidate.target.palette,
    report: candidate.result.report,
  };
  const picks: Record<string, Keyframe> = {};
  for (const required of set.required) {
    const kept = required === slot ? frame : set.picks[required];
    if (kept !== undefined) picks[required] = kept;
  }
  return {
    ok: true,
    record: {
      ...set,
      picks,
      status: deriveStatus(
        set.kind,
        set.required,
        picks,
        set.frames,
        set.limits,
      ),
    },
  };
}

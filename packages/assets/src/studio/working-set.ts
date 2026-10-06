import {
  type ConformanceReport,
  fail,
  isRecord,
  ok,
  type ParseResult,
  parseArray,
  parseConformanceReport,
  parseEnum,
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

export interface WorkingSetRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly subject: string;
  readonly kind: "sprite" | "portrait";
  /** The request whose candidates the sheet currently shows; replaceable. */
  readonly sheetRequestId: string;
  readonly required: readonly string[];
  readonly picks: Readonly<Record<string, Keyframe>>;
  readonly status: "open" | "complete";
}

/** A portrait is complete when every required expression is picked; sprites stay open until full authored frames exist. */
export const deriveStatus = (
  kind: "sprite" | "portrait",
  required: readonly string[],
  picks: Readonly<Record<string, Keyframe>>,
): "open" | "complete" =>
  kind === "portrait" && required.every((slot) => picks[slot] !== undefined)
    ? "complete"
    : "open";

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
      "picks",
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
      if (!isRecord(record.picks))
        return fail("workingSet.picks", "expected an object");
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
      const status = parseEnum(record.status, "workingSet.status", [
        "open",
        "complete",
      ] as const);
      if (!status.ok) return status;
      if (status.value !== deriveStatus(kind.value, required.value, picks))
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
        picks,
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
  const required =
    kind === "portrait"
      ? [...content.vocabulary.expressions]
      : slots.map(slotKey);
  return {
    ok: true,
    record: {
      schemaVersion: 1,
      id,
      subject,
      kind,
      sheetRequestId: request.id,
      required,
      picks: {},
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
      status: deriveStatus(set.kind, set.required, set.picks),
    },
  };
}

/** Snapshots a done candidate of the current sheet into its slot, replacing an earlier pick. */
export function pickKeyframe(
  set: WorkingSetRecord,
  candidate: CandidateRecord,
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
  const { slotKey: slot } = candidate.source;
  if (!set.required.includes(slot))
    return refuse(`slot ${slot} is not one this working set needs`);
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
      status: deriveStatus(set.kind, set.required, picks),
    },
  };
}

import type {
  CandidateRecord,
  EditRecord,
  JobRecord,
  RequestRecord,
  StudioAssetRecord,
  StudioStatus,
  WorkingSetRecord,
} from "@panthea/assets/studio";

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export interface Failure {
  readonly code: string;
  readonly message: string;
  readonly [key: string]: Json;
}

export type Outcome =
  | { readonly ok: true; readonly result: Json }
  | { readonly ok: false; readonly error: Failure };

const USAGE_CODES: readonly string[] = [
  "invalid-arguments",
  "unknown-op",
  "invalid-request",
  "missing-config",
  "invalid-config",
  "invalid-content",
];

/** 0 success, 64 usage or config problems, 1 every other refusal or failure. */
export const exitOf = (outcome: Outcome): 0 | 1 | 64 =>
  outcome.ok ? 0 : USAGE_CODES.includes(outcome.error.code) ? 64 : 1;

export const done = (result: Json): Outcome => ({ ok: true, result });

export const refuse = (
  code: string,
  message: string,
  extra: Record<string, Json> = {},
): Outcome => ({ ok: false, error: { ...extra, code, message } });

const MAX_MESSAGE = 200;

/** A message safe to print: its first line, without a captured output tail, bounded. */
export function safeMessage(text: string): string {
  const head = (text.split("\n")[0] ?? "").split(" Output:")[0] ?? "";
  const trimmed = head.trim();
  return trimmed.length <= MAX_MESSAGE
    ? trimmed
    : `${trimmed.slice(0, MAX_MESSAGE - 1)}…`;
}

/** The candidate record a job has, if any: a candidate's id is its job's id. */
export type CandidateKinds = ReadonlyMap<string, "done" | "needs-scale">;

/**
 * `candidates`, when given, adds `candidate` to a succeeded job: `"done"`,
 * `"needs-scale"`, or null when it has not been conformed. Without it the
 * summary is what it always was.
 */
export function jobSummary(
  record: JobRecord,
  candidates?: CandidateKinds,
): Json {
  const { job, source } = record;
  const base = {
    id: job.id,
    status: job.status,
    requestId: source.requestId,
    slotKey: source.slotKey,
    ordinal: source.ordinal,
    seed: job.request.seed ?? null,
  };
  switch (job.status) {
    case "succeeded":
      return {
        ...base,
        ...(candidates === undefined
          ? {}
          : { candidate: candidates.get(job.id) ?? null }),
        outputs: job.outputs.map(
          (o): Json =>
            o.medium === "image"
              ? { hash: o.hash, width: o.width, height: o.height }
              : { hash: o.hash },
        ),
      };
    case "failed":
      return { ...base, error: safeMessage(job.error) };
    case "unavailable":
      return {
        ...base,
        reason: safeMessage(job.reason),
        staging: safeMessage(job.staging),
      };
    case "cancelled":
      return { ...base, cancelledBy: job.cancelledBy };
    default:
      return base;
  }
}

export function requestSummary(record: RequestRecord): Json {
  const { request } = record;
  return {
    id: record.id,
    subject: request.subject,
    kind: request.kind,
    slots: request.slots.map((s) =>
      [s.state, s.direction, s.ability, s.expression]
        .filter((p) => p !== undefined)
        .join("/"),
    ),
    batch: request.batch,
    seed: request.seed ?? null,
    nextOrdinal: record.nextOrdinal,
  };
}

export function candidateSummary(record: CandidateRecord): Json {
  const { result } = record;
  const base = {
    id: record.id,
    requestId: record.source.requestId,
    slotKey: record.source.slotKey,
    ordinal: record.source.ordinal,
    input: {
      hash: record.input.hash,
      width: record.input.width,
      height: record.input.height,
    },
  };
  if (result.status === "needs-scale")
    return {
      ...base,
      status: "needs-scale",
      message: safeMessage(result.message),
      report: null,
      scale: null,
      coloursMerged: null,
      pixelsChanged: null,
    };
  return {
    ...base,
    status: "done",
    imageHash: result.imageHash,
    proposalHash: result.proposalHash,
    report: {
      status: result.report.status,
      failedChecks: result.report.checks
        .filter((c) => c.status === "fail")
        .map((c) => c.check),
    },
    scale: result.metrics.resize.factor,
    coloursMerged: result.metrics.coloursMerged,
    pixelsChanged: result.metrics.pixelsChanged,
  };
}

export function setSummary(record: WorkingSetRecord): Json {
  return {
    id: record.id,
    subject: record.subject,
    kind: record.kind,
    sheetRequestId: record.sheetRequestId,
    status: record.status,
    required: [...record.required],
    picks: Object.fromEntries(
      Object.entries(record.picks).map(([slot, pick]) => [
        slot,
        pick.candidateId,
      ]),
    ),
    authored: Object.fromEntries(
      Object.entries(record.frames).map(([slot, frames]) => [
        slot,
        { editId: frames.editId, frames: frames.frames.length },
      ]),
    ),
  };
}

export function editSummary(record: EditRecord): Json {
  return {
    id: record.id,
    workingSetId: record.workingSetId,
    slots: [...record.slots],
    status: record.status,
    previewSheetHash: record.preview?.sheetHash ?? null,
  };
}

export function assetSummary(record: StudioAssetRecord): Json {
  const state = record.record;
  const report =
    state.state === "candidate" || state.state === "draft"
      ? state.report
      : undefined;
  return {
    id: record.id,
    workingSetId: record.workingSetId,
    assetId: record.assetId,
    state: state.state,
    manifestRevision: record.manifestRevision,
    prior: record.prior,
    published: record.published?.revision ?? null,
    report:
      report === undefined
        ? null
        : {
            status: report.status,
            failedChecks: report.checks
              .filter((c) => c.status === "fail")
              .map((c) => c.check),
          },
    licences: record.licenceReview.entries.map((e) => ({
      subject: e.subject,
      role: e.role,
      status: e.status,
    })),
  };
}

/**
 * `open` means the session was not ended and its owner process is still alive;
 * a session whose owner died without ending it is not open.
 */
export function statusSummary(
  status: StudioStatus,
  isAlive: (pid: number) => boolean,
): Json {
  const jobs: Record<string, number> = {};
  for (const { job } of status.jobs)
    jobs[job.status] = (jobs[job.status] ?? 0) + 1;
  return {
    owner:
      status.session === undefined
        ? null
        : {
            pid: status.session.pid,
            startedAt: status.session.startedAt,
            open:
              status.session.endedAt === undefined &&
              isAlive(status.session.pid),
          },
    counts: {
      requests: status.requests.length,
      jobs: status.jobs.length,
      candidates: status.candidates.length,
      workingSets: status.workingSets.length,
      edits: status.edits.length,
      assets: status.assets.length,
    },
    jobs,
    invalid: status.invalid.map((p) => ({ file: p.file })),
  };
}

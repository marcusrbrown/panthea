import type { StudioOp } from "../host/client";
import type {
  CandidateSummary,
  EditReport,
  HostStatus,
  StudioSnapshot,
  SummaryRecord,
} from "../host/types";

export type QueueState =
  | "queued"
  | "running"
  | "aborting"
  | "restarting"
  | "cancelled"
  | "removed"
  | "failed"
  | "unavailable"
  | "completed";

export interface QueueJob {
  readonly id: string;
  readonly requestId?: string;
  readonly slotKey?: string;
  readonly status: QueueState;
  readonly reason?: string;
  readonly raw: SummaryRecord;
}

export interface WorkflowState {
  readonly host: HostStatus;
  readonly configured: boolean;
  readonly lockOwner?: number;
  /** The host's own answer to whether a release would be accepted now (`status.idle`). */
  readonly idle: boolean;
  /** Why it is not, when the host said. */
  readonly idleReason?: string;
  /** Why the last release failed while the lock was kept, when one did. */
  readonly releaseFailure?: string;
  /** The last write another process's lock refused, kept so Retry can send it again. */
  readonly lockedWrite?: {
    readonly op: StudioOp;
    readonly args: Readonly<Record<string, unknown>>;
  };
  readonly status?: Readonly<Record<string, unknown>> | null;
  readonly requests: readonly SummaryRecord[];
  readonly jobs: readonly QueueJob[];
  readonly candidates: readonly SummaryRecord[];
  readonly edits: readonly SummaryRecord[];
  readonly editReports: Readonly<Record<string, EditReport>>;
  readonly workingSets: readonly SummaryRecord[];
  readonly assets: readonly SummaryRecord[];
  readonly errors: Readonly<Record<string, { code: string; message?: string }>>;
  readonly tombstones: Readonly<Record<string, "cancelled" | "removed">>;
  readonly restartPending: boolean;
  readonly selectedAssetId?: string;
  readonly sheet?: unknown;
  readonly resolution?: unknown;
  readonly refusal?: string;
}

export type WorkflowAction =
  | { readonly type: "snapshot"; readonly snapshot: StudioSnapshot }
  | { readonly type: "configured"; readonly configured: boolean }
  | {
      readonly type: "write-locked";
      readonly op: StudioOp;
      readonly args: Readonly<Record<string, unknown>>;
    }
  | { readonly type: "write-unlocked" }
  | { readonly type: "job-aborting"; readonly jobId: string }
  | { readonly type: "job-abort-failed"; readonly jobId: string }
  | { readonly type: "job-cancelled"; readonly jobId: string }
  | { readonly type: "job-removed"; readonly jobId: string }
  | { readonly type: "resolution"; readonly value: unknown }
  | { readonly type: "refusal"; readonly message: string }
  | { readonly type: "sheet"; readonly value: unknown }
  | { readonly type: "select-asset"; readonly assetId: string }
  | { readonly type: "edit-report"; readonly report: EditReport }
  | {
      readonly type: "candidate-conformed";
      readonly candidate: CandidateSummary;
    };

const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

function queueJob(raw: SummaryRecord, tombstone?: "cancelled" | "removed") {
  const value = raw as Record<string, unknown>;
  const native = text(value.status);
  let status: QueueState;
  if (tombstone !== undefined) status = tombstone;
  else if (native === "succeeded") status = "completed";
  else if (
    native === "queued" ||
    native === "running" ||
    native === "cancelled" ||
    native === "failed" ||
    native === "unavailable" ||
    native === "aborting" ||
    native === "restarting" ||
    native === "removed" ||
    native === "completed"
  )
    status = native;
  else status = "queued";
  return {
    id: raw.id,
    ...(text(value.requestId) === undefined
      ? {}
      : { requestId: text(value.requestId) }),
    ...(text(value.slotKey) === undefined
      ? {}
      : { slotKey: text(value.slotKey) }),
    status,
    ...((text(value.staging) ?? text(value.reason) ?? text(value.error))
      ? {
          reason:
            text(value.staging) ?? text(value.reason) ?? text(value.error),
        }
      : {}),
    raw,
  } satisfies QueueJob;
}

/** The header's lock state: held by this app, free, or held by pid N. Nothing before the sidecar has said. */
export function lockLabel(state: WorkflowState): string | undefined {
  const { host } = state;
  if (host.state === "read-only") return `Held by pid ${host.lockHolder}`;
  if (host.state !== "running") return undefined;
  if (host.lock === "held") return "Held by this app";
  return host.lock === "free" ? "Free" : undefined;
}

/** Release gives back a lock this app holds, and only when the host says it is idle. */
export function canRelease(state: WorkflowState): boolean {
  return (
    state.configured &&
    state.host.state === "running" &&
    state.host.lock === "held" &&
    state.idle
  );
}

/** A write another process's lock refused, as opposed to any other refusal. */
export function refusedByLock(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "root-locked"
  );
}

export function initialWorkflowState(): WorkflowState {
  return {
    host: { state: "starting" },
    configured: false,
    idle: false,
    restartPending: false,
    requests: [],
    jobs: [],
    candidates: [],
    edits: [],
    editReports: {},
    workingSets: [],
    assets: [],
    errors: {},
    tombstones: {},
  };
}

export function workflowReducer(
  state: WorkflowState,
  action: WorkflowAction,
): WorkflowState {
  switch (action.type) {
    case "configured":
      return { ...state, configured: action.configured };
    case "snapshot": {
      const snapshot = action.snapshot;
      // Another session's lock is the host's read-only state, which the
      // sidecar reports from the lock itself; never inferred from pids here.
      const pid =
        snapshot.host.state === "read-only"
          ? snapshot.host.lockHolder
          : undefined;
      const status =
        snapshot.status === undefined ? state.status : snapshot.status;
      const reported = object(status);
      const tombstones = { ...state.tombstones };
      const jobs = (snapshot.jobs ?? []).map((raw) => {
        const protectedState = tombstones[raw.id];
        const job = queueJob(raw, protectedState);
        if (job.status === "cancelled" || job.status === "removed")
          tombstones[job.id] = job.status;
        return job;
      });
      return {
        ...state,
        host: snapshot.host,
        configured: snapshot.host.state !== "not-configured",
        status,
        idle: reported.idle === true,
        idleReason: text(reported.idleReason),
        releaseFailure: text(reported.releaseFailure),
        ...(pid === undefined ? { lockOwner: undefined } : { lockOwner: pid }),
        requests: snapshot.requests ?? [],
        jobs,
        restartPending:
          state.restartPending &&
          jobs.some((job) => job.status === "queued") &&
          !jobs.some((job) => job.status === "running"),
        candidates: snapshot.candidates ?? [],
        edits: snapshot.edits ?? [],
        workingSets: snapshot.workingSets ?? [],
        assets: snapshot.assets ?? [],
        errors: snapshot.errors ?? {},
      };
    }
    case "write-locked":
      return { ...state, lockedWrite: { op: action.op, args: action.args } };
    case "write-unlocked":
      return { ...state, lockedWrite: undefined };
    case "job-aborting":
      return {
        ...state,
        jobs: state.jobs.map((job) =>
          job.id === action.jobId && job.status === "running"
            ? { ...job, status: "aborting" }
            : job,
        ),
      };
    case "job-abort-failed":
      return {
        ...state,
        jobs: state.jobs.map((job) =>
          job.id === action.jobId && job.status === "aborting"
            ? { ...job, status: "running" }
            : job,
        ),
      };
    case "job-cancelled":
      return {
        ...state,
        restartPending: state.jobs.some(
          (job) => job.id !== action.jobId && job.status === "queued",
        ),
        tombstones: { ...state.tombstones, [action.jobId]: "cancelled" },
        jobs: state.jobs.map((job) =>
          job.id === action.jobId ? { ...job, status: "cancelled" } : job,
        ),
      };
    case "job-removed": {
      const jobs = state.jobs.map((job) =>
        job.id === action.jobId ? { ...job, status: "removed" as const } : job,
      );
      return {
        ...state,
        tombstones: { ...state.tombstones, [action.jobId]: "removed" },
        jobs,
        restartPending:
          state.restartPending && jobs.some((job) => job.status === "queued"),
      };
    }
    case "resolution":
      return { ...state, resolution: action.value, refusal: undefined };
    case "refusal":
      return { ...state, refusal: action.message, resolution: undefined };
    case "sheet":
      return { ...state, sheet: action.value };
    case "select-asset":
      return { ...state, selectedAssetId: action.assetId };
    case "edit-report":
      return {
        ...state,
        editReports: {
          ...state.editReports,
          [action.report.editId]: action.report,
        },
      };
    case "candidate-conformed": {
      const candidate = action.candidate as SummaryRecord;
      return {
        ...state,
        candidates: [
          ...state.candidates.filter((item) => item.id !== candidate.id),
          candidate,
        ],
        jobs: state.jobs.map((job) =>
          job.id === candidate.id
            ? {
                ...job,
                raw: { ...job.raw, candidate: action.candidate.status },
              }
            : job,
        ),
      };
    }
  }
}

export const recordValue = (record: SummaryRecord, key: string): unknown =>
  object(record)[key];

export const recordText = (
  record: SummaryRecord,
  key: string,
): string | undefined => text(recordValue(record, key));

export const recordObject = (
  record: SummaryRecord,
  key: string,
): Record<string, unknown> => object(recordValue(record, key));

/**
 * The record the asset panel acts on. A requested id that is not in `assets` is pending, never another record: the
 * lists arrive on the next poll, so a record the window just selected (a fresh pack) may not be there yet, and falling
 * back to the first or the previous record would let Approve, Reject or Publish act on one the owner did not choose.
 * With nothing requested the first record is shown.
 */
export type ActiveRecord =
  | { readonly kind: "none" }
  | { readonly kind: "pending"; readonly id: string }
  | { readonly kind: "record"; readonly asset: SummaryRecord };

export function resolveActiveRecord(
  assets: readonly SummaryRecord[],
  requestedId: string | undefined,
): ActiveRecord {
  if (requestedId === undefined) {
    const first = assets[0];
    return first === undefined
      ? { kind: "none" }
      : { kind: "record", asset: first };
  }
  const found = assets.find((asset) => asset.id === requestedId);
  return found === undefined
    ? { kind: "pending", id: requestedId }
    : { kind: "record", asset: found };
}

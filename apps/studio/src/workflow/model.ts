import type {
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
  readonly requests: readonly SummaryRecord[];
  readonly jobs: readonly QueueJob[];
  readonly candidates: readonly SummaryRecord[];
  readonly edits: readonly SummaryRecord[];
  readonly editReports: Readonly<Record<string, EditReport>>;
  readonly workingSets: readonly SummaryRecord[];
  readonly assets: readonly SummaryRecord[];
  readonly errors: Readonly<Record<string, { code: string; message?: string }>>;
  readonly tombstones: Readonly<Record<string, "cancelled" | "removed">>;
  readonly selectedAssetId?: string;
  readonly sheet?: unknown;
  readonly resolution?: unknown;
  readonly refusal?: string;
}

export type WorkflowAction =
  | { readonly type: "snapshot"; readonly snapshot: StudioSnapshot }
  | { readonly type: "configured"; readonly configured: boolean }
  | { readonly type: "job-aborting"; readonly jobId: string }
  | { readonly type: "job-abort-failed"; readonly jobId: string }
  | { readonly type: "job-cancelled"; readonly jobId: string }
  | { readonly type: "job-removed"; readonly jobId: string }
  | { readonly type: "resolution"; readonly value: unknown }
  | { readonly type: "refusal"; readonly message: string }
  | { readonly type: "sheet"; readonly value: unknown }
  | { readonly type: "select-asset"; readonly assetId: string }
  | { readonly type: "edit-report"; readonly report: EditReport };

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

export function initialWorkflowState(): WorkflowState {
  return {
    host: { state: "starting" },
    configured: false,
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
        ...(pid === undefined ? { lockOwner: undefined } : { lockOwner: pid }),
        requests: snapshot.requests ?? [],
        jobs,
        candidates: snapshot.candidates ?? [],
        edits: snapshot.edits ?? [],
        workingSets: snapshot.workingSets ?? [],
        assets: snapshot.assets ?? [],
        errors: snapshot.errors ?? {},
      };
    }
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
        tombstones: { ...state.tombstones, [action.jobId]: "cancelled" },
        jobs: state.jobs.map((job) =>
          job.id === action.jobId ? { ...job, status: "cancelled" } : job,
        ),
      };
    case "job-removed":
      return {
        ...state,
        tombstones: { ...state.tombstones, [action.jobId]: "removed" },
        jobs: state.jobs.map((job) =>
          job.id === action.jobId ? { ...job, status: "removed" } : job,
        ),
      };
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

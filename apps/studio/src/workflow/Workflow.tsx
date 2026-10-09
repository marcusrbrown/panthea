import {
  type Dispatch,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { StudioHost } from "../host/client";
import { tauriHost } from "../host/tauri";
import type { StudioSnapshot, SummaryRecord } from "../host/types";
import { CandidatePixels } from "./CandidatePixelCell";
import { EditPanel } from "./EditPanel";
import {
  initialWorkflowState,
  type QueueJob,
  recordObject,
  recordText,
  recordValue,
  type WorkflowAction,
  type WorkflowState,
  workflowReducer,
} from "./model";
import "./workflow.css";

export interface PreviewSelection {
  readonly source: "canon" | "draft" | "approved";
  readonly id: string;
}

export interface WorkflowViewProps {
  readonly state: WorkflowState;
  readonly host: StudioHost;
  readonly onConfigChoose?: () => void;
  readonly dispatch?: Dispatch<WorkflowAction>;
  readonly renderPreview?: (selection?: PreviewSelection) => ReactNode;
}

const text = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;
const recordState = (record: SummaryRecord) =>
  recordText(record, "state") ?? recordText(record, "status");
const candidateChangeCount = (candidate: SummaryRecord) => {
  const metrics = recordObject(candidate, "metrics");
  const count =
    recordValue(candidate, "pixelsMoved") ??
    recordValue(candidate, "pixelsChanged") ??
    metrics.pixelsMoved ??
    metrics.pixelsChanged;
  return typeof count === "number" && Number.isFinite(count)
    ? count
    : Number.POSITIVE_INFINITY;
};
const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
const entries = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const label = (status: string) =>
  status === "completed"
    ? "Completed"
    : status === "unavailable"
      ? "Unavailable / staging"
      : status[0]?.toUpperCase() + status.slice(1);
const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function slotSpecs(source: string): Record<string, string>[] {
  return source
    .split("\n")
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [state, direction, ability, expression] = row
        .split("/")
        .map((part) => part.trim());
      return {
        ...(state ? { state } : {}),
        ...(direction ? { direction } : {}),
        ...(ability ? { ability } : {}),
        ...(expression ? { expression } : {}),
      };
    });
}

function detailText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function canMutate(state: WorkflowState) {
  return (
    state.configured &&
    state.host.state === "running" &&
    state.lockOwner === undefined
  );
}

function QueueItem({
  job,
  state,
  busy,
  onRemove,
  onAbort,
  onRetry,
}: {
  job: QueueJob;
  state: WorkflowState;
  busy: boolean;
  onRemove: (id: string) => void;
  onAbort: (id: string) => void;
  onRetry: (job: QueueJob) => void;
}) {
  const restartRemoval =
    state.lockOwner === undefined &&
    state.host.state === "restarting" &&
    (job.status === "queued" || job.status === "aborting");
  const enabled = (canMutate(state) || restartRemoval) && !busy;
  const canRemove = job.status === "queued" || job.status === "aborting";
  const reason = job.reason;
  const progress =
    recordValue(job.raw, "progress") ?? recordValue(job.raw, "phase");
  return (
    <li className={`queue-row queue-${job.status}`}>
      <div className="queue-row-main">
        <strong>{job.slotKey ?? job.id}</strong>
        <span className={`state-label state-${job.status}`}>
          {label(job.status)}
        </span>
      </div>
      <small>
        {job.id}
        {job.requestId ? ` · ${job.requestId}` : ""}
      </small>
      {job.status === "aborting" && (
        <p className="queue-note">
          Stopping and restarting the image server (about 37 seconds).
        </p>
      )}
      {state.host.state === "restarting" && job.status === "queued" && (
        <p className="queue-note">
          Waiting for server restart, attempt {state.host.attempt} of{" "}
          {state.host.maxAttempts}.
        </p>
      )}
      {reason && (
        <p className="queue-note">
          {job.status === "unavailable"
            ? `Missing or unavailable: ${reason}`
            : reason}
        </p>
      )}
      {progress !== undefined && job.status === "running" && (
        <p className="queue-note">Progress: {detailText(progress)}</p>
      )}
      <div className="queue-actions">
        {canRemove && (
          <button
            type="button"
            disabled={!enabled}
            onClick={() => onRemove(job.id)}
          >
            Remove
          </button>
        )}
        {job.status === "running" && (
          <button
            type="button"
            disabled={!enabled}
            onClick={() => onAbort(job.id)}
          >
            Abort
          </button>
        )}
        {(job.status === "failed" || job.status === "cancelled") && (
          <button
            type="button"
            disabled={!enabled || !job.requestId}
            onClick={() => onRetry(job)}
          >
            Retry
          </button>
        )}
      </div>
    </li>
  );
}

export function WorkflowView({
  state,
  host,
  onConfigChoose,
  dispatch,
  renderPreview,
}: WorkflowViewProps) {
  const [subject, setSubject] = useState("zeus");
  const [kind, setKind] = useState<"sprite" | "portrait">("sprite");
  const [slots, setSlots] = useState("idle/south\nwalk/south");
  const [batch, setBatch] = useState(1);
  const [styleNote, setStyleNote] = useState("");
  const [requestId, setRequestId] = useState("");
  const [resolvedArgs, setResolvedArgs] = useState<Record<string, unknown>>();
  const [workingSetId, setWorkingSetId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [styleTag, setStyleTag] = useState("greek-master");
  const [exception, setException] = useState("");
  const [busy, setBusy] = useState(false);
  const [queueBusy, setQueueBusy] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  const [refusalDetails, setRefusalDetails] = useState("");
  const [activeEditId, setActiveEditId] = useState<string>();
  const [openedEdit, setOpenedEdit] = useState<SummaryRecord>();
  const [editorSessions, setEditorSessions] = useState<
    Record<
      string,
      {
        readonly launched: boolean;
        readonly reason?: string;
        readonly durationsMs: readonly number[];
      }
    >
  >({});
  const reopenedEdits = useRef(new Set<string>());

  const selectedAsset =
    state.assets.find((asset) => asset.id === state.selectedAssetId) ??
    state.assets[0];
  const selectedSet =
    state.workingSets.find((set) => set.id === workingSetId) ??
    state.workingSets[0];
  const sortedCandidates = [...state.candidates].sort(
    (left, right) => candidateChangeCount(left) - candidateChangeCount(right),
  );
  const requestIdForSet = selectedSet
    ? (recordText(selectedSet, "sheetRequestId") ??
      recordText(selectedSet, "requestId"))
    : undefined;
  const sheetCandidates =
    requestIdForSet === undefined
      ? sortedCandidates
      : sortedCandidates.filter(
          (candidate) => recordText(candidate, "requestId") === requestIdForSet,
        );
  const reportedCandidateCount = object(state.sheet).candidateCount;
  const sheetCandidateCount =
    typeof reportedCandidateCount === "number"
      ? reportedCandidateCount
      : sheetCandidates.length;
  const mutationsEnabled = canMutate(state) && !busy;
  const readsEnabled =
    state.configured && state.host.state === "running" && !busy;

  const call = async (
    op: Parameters<StudioHost["call"]>[0],
    args: Record<string, unknown>,
    readOnly = false,
    allowRestarting = false,
    nonBlocking = false,
  ) => {
    if (
      !(readOnly
        ? readsEnabled
        : canMutate(state) ||
          (allowRestarting &&
            state.configured &&
            state.lockOwner === undefined &&
            state.host.state === "restarting"))
    )
      return undefined;
    if (!nonBlocking) setBusy(true);
    setMessage("");
    setRefusalDetails("");
    try {
      const result = await host.call(op, args);
      setMessage(`${op} complete`);
      return result;
    } catch (error) {
      const errorRecord = object(error);
      const detail = errorRecord.detail;
      setMessage(error instanceof Error ? error.message : String(error));
      if (detail !== undefined) setRefusalDetails(detailText(detail));
      return undefined;
    } finally {
      if (!nonBlocking) setBusy(false);
    }
  };

  const formArgs = () => {
    const id =
      requestId || `${slug(subject)}-${crypto.randomUUID().slice(0, 8)}`;
    const parsedSlots = slotSpecs(slots);
    if (!slug(subject) || parsedSlots.length === 0)
      throw new Error("Enter a subject and at least one slot.");
    const args: Record<string, unknown> = {
      id,
      subject: slug(subject),
      kind,
      slots: parsedSlots,
      batch: Math.max(1, Math.floor(batch)),
    };
    if (styleNote.trim()) args.styleNote = styleNote.trim();
    return args;
  };

  const resolveRequest = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const args = formArgs();
      setRequestId(text(args.id));
      setResolvedArgs(args);
      const result = await call("resolve", args, true);
      if (result !== undefined)
        dispatch?.({ type: "resolution", value: result });
      else {
        setResolvedArgs(undefined);
      }
      if (result !== undefined)
        setMessage(
          "Request resolved. Review the specification before generating.",
        );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const resolveResult = state.resolution as Record<string, unknown> | undefined;
  const resolvedSpec =
    resolveResult?.spec ?? resolveResult?.resolution ?? resolveResult;
  const resolvedRequest = resolveResult?.request;

  const generate = async () => {
    if (!resolvedSpec || !resolvedArgs) return;
    const args = { ...resolvedArgs };
    const resolved = object(resolvedRequest);
    if (typeof resolved.seed === "number") args.seed = resolved.seed;
    const result = await call("generate", args, false, false, true);
    if (result !== undefined) {
      dispatch?.({ type: "resolution", value: undefined });
      setResolvedArgs(undefined);
      setRequestId("");
      setMessage("Request added to the queue.");
    }
  };

  const remove = async (jobId: string) => {
    setQueueBusy((previous) => ({ ...previous, [jobId]: true }));
    try {
      const result = await call(
        "remove",
        { jobId },
        false,
        state.host.state === "restarting",
        true,
      );
      if (result !== undefined) dispatch?.({ type: "job-removed", jobId });
    } finally {
      setQueueBusy((previous) => ({ ...previous, [jobId]: false }));
    }
  };
  const abort = async (jobId: string) => {
    dispatch?.({ type: "job-aborting", jobId });
    const result = await call("abort", { jobId }, false, false, true);
    if (result !== undefined) {
      dispatch?.({ type: "job-cancelled", jobId });
      setMessage("Job cancelled. Restarting the image server.");
    } else dispatch?.({ type: "job-abort-failed", jobId });
  };
  const retry = (job: QueueJob) => {
    if (job.requestId)
      void call(
        "reroll",
        { requestId: job.requestId, perSlot: 1 },
        false,
        false,
        true,
      );
  };

  const loadSheet = async (request: SummaryRecord) => {
    if (!readsEnabled) return;
    const requestKey = request.id;
    dispatchSheet(undefined);
    const existing = state.workingSets.find(
      (set) =>
        recordText(set, "sheetRequestId") === requestKey ||
        recordText(set, "requestId") === requestKey,
    );
    const targetId = existing?.id ?? `set-${slug(requestKey)}`;
    setWorkingSetId(targetId);
    try {
      if (!existing) {
        if (!canMutate(state)) return;
        const setup = await call("set-create", {
          id: targetId,
          requestId: requestKey,
        });
        if (setup === undefined) return;
      }
      const sheet = await host.call("sheet", { workingSetId: targetId });
      dispatchSheet(sheet);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const dispatchSheet = (sheet: unknown) => {
    // The command result is shown as supplied by the host; no candidate outcome is inferred here.
    dispatch?.({ type: "sheet", value: sheet });
  };

  const pickCandidate = async (candidate: SummaryRecord) => {
    if (!selectedSet) return;
    const slot =
      recordText(candidate, "slot") ?? recordText(candidate, "slotKey");
    if (!slot) return;
    await call("pick", {
      workingSetId: selectedSet.id,
      candidateId: candidate.id,
      slot,
    });
  };
  const rejectCandidate = async (candidate: SummaryRecord) => {
    const why = window.prompt("Reason for rejecting this candidate")?.trim();
    if (why) await call("reject", { id: candidate.id, reason: why });
  };

  const [localAssetId, setLocalAssetId] = useState<string | undefined>(
    state.selectedAssetId,
  );
  const activeAsset =
    state.assets.find((asset) => asset.id === localAssetId) ?? selectedAsset;
  const activeReport = activeAsset ? recordObject(activeAsset, "report") : {};
  const activeReportStatus = text(activeReport.status);
  const activeFailedChecks = entries(activeReport.failedChecks)
    .map((check) => text(check))
    .filter(Boolean) as string[];
  const activeRevision = activeAsset
    ? recordText(activeAsset, "manifestRevision")
    : undefined;
  const activeAssetState = activeAsset
    ? recordText(activeAsset, "state")
    : undefined;
  const activePreview = activeAsset
    ? {
        source:
          activeAssetState === "approved"
            ? ("approved" as const)
            : activeAssetState === "draft"
              ? ("draft" as const)
              : ("canon" as const),
        id: recordText(activeAsset, "assetId") ?? activeAsset.id,
      }
    : undefined;

  const activeEdit =
    state.edits.find((edit) => edit.id === activeEditId) ??
    state.edits.find((edit) => recordState(edit) === "open") ??
    openedEdit;
  const editSignature = state.edits
    .filter((edit) => recordState(edit) !== "discarded")
    .map(
      (edit) =>
        `${edit.id}:${recordText(edit, "previewSheetHash") ?? "base"}:${recordState(edit) ?? "open"}`,
    )
    .join("|");
  const reportableEdits = useMemo(
    () => state.edits.filter((edit) => recordState(edit) !== "discarded"),
    [state.edits],
  );
  const canReopenEdit = canMutate(state);

  useEffect(() => {
    if (!dispatch || !editSignature) return;
    let live = true;
    for (const edit of reportableEdits) {
      if (
        recordState(edit) === "open" &&
        canReopenEdit &&
        !reopenedEdits.current.has(edit.id)
      ) {
        reopenedEdits.current.add(edit.id);
        const workingSetId = recordText(edit, "workingSetId");
        const slots = entries(recordValue(edit, "slots")).filter(
          (slot): slot is string => typeof slot === "string",
        );
        if (workingSetId) {
          void host
            .editOpen(edit.id, workingSetId, slots)
            .then((opened) => {
              if (!live) return;
              setEditorSessions((previous) => ({
                ...previous,
                [edit.id]: {
                  launched: opened.editor.launched,
                  ...(opened.editor.reason === undefined
                    ? {}
                    : { reason: opened.editor.reason }),
                  durationsMs: opened.workspace.durationsMs,
                },
              }));
            })
            .catch((error: unknown) => {
              reopenedEdits.current.delete(edit.id);
              if (live)
                setMessage(
                  error instanceof Error ? error.message : String(error),
                );
            });
        }
      }
      void host
        .editReport(edit.id)
        .then((report) => {
          if (live) dispatch({ type: "edit-report", report });
        })
        .catch((error: unknown) => {
          if (live)
            setMessage(error instanceof Error ? error.message : String(error));
        });
    }
    return () => {
      live = false;
    };
  }, [canReopenEdit, dispatch, editSignature, host, reportableEdits]);
  const makeWorkingSet = async (request: SummaryRecord) => loadSheet(request);
  const pack = async () => {
    if (!selectedSet || !assetId.trim() || !styleTag.trim()) return;
    await call("pack", {
      id: `record-${slug(assetId)}`,
      workingSetId: selectedSet.id,
      assetId: slug(assetId),
      styleTag: slug(styleTag),
    });
  };
  const approve = async (withException: boolean) => {
    if (!activeAsset || !activeRevision) return;
    const args: Record<string, unknown> = {
      id: activeAsset.id,
      confirm: activeRevision,
    };
    if (withException) args.exception = { reason: exception.trim() };
    await call(withException ? "approve-with-exception" : "approve", args);
  };
  const publish = async () => {
    if (!activeAsset || !activeRevision) return;
    await call("publish", { id: activeAsset.id, confirm: activeRevision });
  };
  const rejectAsset = async () => {
    if (!activeAsset) return;
    const reason = window.prompt("Reason for rejecting this asset")?.trim();
    if (reason) await call("reject", { id: activeAsset.id, reason });
  };

  const readEditReport = async (editId: string) => {
    try {
      const report = await host.editReport(editId);
      dispatch?.({ type: "edit-report", report });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const openEdit = async () => {
    if (!activeAsset || !canMutate(state)) return;
    const setId = recordText(activeAsset, "workingSetId") ?? selectedSet?.id;
    if (!setId) return;
    const existingEdit =
      state.edits.find((entry) => entry.id === activeEditId) ?? activeEdit;
    const currentSet =
      state.workingSets.find((entry) => entry.id === setId) ?? selectedSet;
    const required = currentSet
      ? entries(recordValue(currentSet, "required")).filter(
          (slot): slot is string => typeof slot === "string",
        )
      : [];
    const picks = currentSet ? recordObject(currentSet, "picks") : {};
    const slots = required.length > 0 ? required : Object.keys(picks);
    const editId =
      existingEdit?.id ??
      `edit-${slug(activeAsset.id)}-${crypto.randomUUID().slice(0, 6)}`;
    setBusy(true);
    setMessage("");
    try {
      const opened = await host.editOpen(editId, setId, slots);
      reopenedEdits.current.add(opened.editId);
      const rawEdit: SummaryRecord = {
        id: opened.editId,
        workingSetId: setId,
        slots: opened.slots,
        status: "open",
        previewSheetHash: null,
      };
      setOpenedEdit(rawEdit);
      setActiveEditId(opened.editId);
      setEditorSessions((previous) => ({
        ...previous,
        [opened.editId]: {
          launched: opened.editor.launched,
          ...(opened.editor.reason === undefined
            ? {}
            : { reason: opened.editor.reason }),
          durationsMs: opened.workspace.durationsMs,
        },
      }));
      await readEditReport(opened.editId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const lockMessage =
    state.lockOwner === undefined
      ? undefined
      : `Locked by another studio session (pid ${state.lockOwner})`;
  const restartMessage =
    state.host.state === "restarting"
      ? `Image server restarting, attempt ${state.host.attempt} of ${state.host.maxAttempts}. Jobs can still be removed.`
      : undefined;

  return (
    <main className="studio-workspace">
      <header className="studio-header">
        <div>
          <p className="eyebrow">Panthea / asset desk</p>
          <h1>Studio workflow</h1>
        </div>
        <div className="host-indicator" aria-live="polite">
          <span className={`host-dot host-${state.host.state}`} />
          {hostLabel(state.host)}
        </div>
      </header>

      {!state.configured || state.host.state === "not-configured" ? (
        <section className="setup-panel" aria-labelledby="setup-title">
          <p className="eyebrow">First connection</p>
          <h2 id="setup-title">Choose a studio config</h2>
          <p>
            The config points to the local studio root, content, registry and
            staged runtime.
          </p>
          <button type="button" className="primary" onClick={onConfigChoose}>
            Choose config file
          </button>
        </section>
      ) : (
        <>
          {lockMessage && (
            <p className="notice notice-lock" role="status">
              {lockMessage}. This window is read-only.
            </p>
          )}
          {restartMessage && (
            <p className="notice notice-restart" role="status">
              {restartMessage}
            </p>
          )}
          {(message || state.refusal) && (
            <p className="notice" role="status">
              {state.refusal ?? message}
            </p>
          )}
          {refusalDetails && (
            <pre className="refusal-details">{refusalDetails}</pre>
          )}
          <div className="workflow-grid">
            <section
              className="workspace-column request-column"
              aria-labelledby="request-heading"
            >
              <div className="section-heading">
                <span className="step-number">01</span>
                <div>
                  <h2 id="request-heading">Request &amp; queue</h2>
                  <p>Resolve the request before it enters the queue.</p>
                </div>
              </div>
              <form
                className="request-form"
                onSubmit={(event) => void resolveRequest(event)}
              >
                <label>
                  Subject
                  <input
                    value={subject}
                    onChange={(event) => {
                      setSubject(event.target.value);
                      setRequestId("");
                      dispatch?.({ type: "resolution", value: undefined });
                      setResolvedArgs(undefined);
                    }}
                  />
                </label>
                <label>
                  Kind
                  <select
                    value={kind}
                    onChange={(event) => {
                      setKind(event.target.value as "sprite" | "portrait");
                      setRequestId("");
                      dispatch?.({ type: "resolution", value: undefined });
                      setResolvedArgs(undefined);
                    }}
                  >
                    <option value="sprite">Sprite</option>
                    <option value="portrait">Portrait</option>
                  </select>
                </label>
                <label>
                  Slots{" "}
                  <span className="field-hint">
                    one state/direction per line
                  </span>
                  <textarea
                    rows={2}
                    value={slots}
                    onChange={(event) => {
                      setSlots(event.target.value);
                      setRequestId("");
                      dispatch?.({ type: "resolution", value: undefined });
                      setResolvedArgs(undefined);
                    }}
                  />
                </label>
                <label>
                  Batch
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={batch}
                    onChange={(event) => {
                      setBatch(Number(event.target.value));
                      setRequestId("");
                      dispatch?.({ type: "resolution", value: undefined });
                      setResolvedArgs(undefined);
                    }}
                  />
                </label>
                <label>
                  Style note <span className="field-hint">optional</span>
                  <textarea
                    rows={2}
                    value={styleNote}
                    onChange={(event) => {
                      setStyleNote(event.target.value);
                      setRequestId("");
                      dispatch?.({ type: "resolution", value: undefined });
                      setResolvedArgs(undefined);
                    }}
                  />
                </label>
                <button type="submit" disabled={!readsEnabled}>
                  Resolve request
                </button>
                {resolvedSpec && (
                  <button
                    type="button"
                    className="primary"
                    disabled={!mutationsEnabled}
                    onClick={() => void generate()}
                  >
                    Generate
                  </button>
                )}
              </form>
              {resolvedSpec && (
                <section className="resolved-spec">
                  <h3>Resolved spec</h3>
                  <p>
                    Review this input. Generation uses the resolved seed and
                    request.
                  </p>
                  <pre>{detailText(resolvedSpec)}</pre>
                </section>
              )}
              {state.resolution !== undefined &&
                state.resolution !== null &&
                !resolvedSpec && (
                  <section className="resolved-spec">
                    <h3>Resolved request</h3>
                    <pre>{detailText(state.resolution)}</pre>
                  </section>
                )}
              <div className="queue-heading">
                <h3>Queue</h3>
                <span>{state.jobs.length} jobs</span>
              </div>
              {state.jobs.length === 0 ? (
                <p className="empty-state">Queue is empty</p>
              ) : (
                <ol className="queue-list">
                  {state.jobs.map((job) => (
                    <QueueItem
                      key={job.id}
                      job={job}
                      state={state}
                      busy={queueBusy[job.id] === true}
                      onRemove={(id) => void remove(id)}
                      onAbort={(id) => void abort(id)}
                      onRetry={retry}
                    />
                  ))}
                </ol>
              )}
            </section>

            <section
              className="workspace-column candidate-column"
              aria-labelledby="candidate-heading"
            >
              <div className="section-heading">
                <span className="step-number">02</span>
                <div>
                  <h2 id="candidate-heading">Candidate sheet</h2>
                  <p>
                    Load a request’s candidates when you are ready to review.
                  </p>
                </div>
              </div>
              <div className="request-shortlist">
                {state.requests.length === 0 ? (
                  <p className="muted">Resolved requests will appear here.</p>
                ) : (
                  state.requests.map((request) => (
                    <div className="request-line" key={request.id}>
                      <div>
                        <strong>
                          {recordText(request, "subject") ?? request.id}
                        </strong>
                        <small>
                          {request.id} ·{" "}
                          {recordText(request, "kind") ?? "request"}
                        </small>
                      </div>
                      <button
                        type="button"
                        disabled={
                          !state.workingSets.some(
                            (set) =>
                              recordText(set, "sheetRequestId") ===
                                request.id ||
                              recordText(set, "requestId") === request.id,
                          ) && !mutationsEnabled
                        }
                        onClick={() => void makeWorkingSet(request)}
                      >
                        {state.workingSets.some(
                          (set) =>
                            recordText(set, "sheetRequestId") === request.id ||
                            recordText(set, "requestId") === request.id,
                        )
                          ? "View sheet"
                          : "Create sheet"}
                      </button>
                    </div>
                  ))
                )}
              </div>
              {state.sheet !== undefined && (
                <div className="sheet-summary" role="status">
                  <strong>Sheet loaded</strong>
                  <span>
                    {sheetCandidateCount} candidate
                    {sheetCandidateCount === 1 ? "" : "s"} ·{" "}
                    {requestIdForSet ?? "selected request"}
                  </span>
                </div>
              )}
              {state.candidates.length > 0 && state.sheet === undefined && (
                <p className="muted">
                  Load a request sheet to view candidate pixels.
                </p>
              )}
              <div className="candidate-list">
                {state.sheet === undefined ? null : sheetCandidates.length ===
                  0 ? (
                  <p className="empty-state">No candidate records yet.</p>
                ) : (
                  sheetCandidates.map((candidate) => (
                    <CandidateRow
                      key={candidate.id}
                      host={host}
                      candidate={candidate}
                      showPixels={state.sheet !== undefined}
                      enabled={mutationsEnabled}
                      onPick={() => void pickCandidate(candidate)}
                      canPick={Boolean(
                        recordText(candidate, "slot") ??
                          recordText(candidate, "slotKey"),
                      )}
                      onReject={() => void rejectCandidate(candidate)}
                    />
                  ))
                )}
              </div>
              {state.workingSets.length > 0 && (
                <label className="working-set-select">
                  Working set
                  <select
                    value={selectedSet?.id ?? ""}
                    onChange={(event) => setWorkingSetId(event.target.value)}
                  >
                    {state.workingSets.map((set) => (
                      <option key={set.id} value={set.id}>
                        {set.id} · {recordText(set, "status") ?? "open"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {selectedSet && (
                <div className="pack-form">
                  <h3>Pack a selected set</h3>
                  <p>
                    Only selected frames in an open working set can be packed.
                  </p>
                  <label>
                    Asset ID
                    <input
                      value={assetId}
                      onChange={(event) => setAssetId(event.target.value)}
                    />
                  </label>
                  <label>
                    Style tag
                    <input
                      value={styleTag}
                      onChange={(event) => setStyleTag(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={
                      !mutationsEnabled || !assetId.trim() || !styleTag.trim()
                    }
                    onClick={() => void pack()}
                  >
                    Pack draft
                  </button>
                </div>
              )}
            </section>

            <section
              className="workspace-column asset-column"
              aria-labelledby="asset-heading"
            >
              <div className="section-heading">
                <span className="step-number">03</span>
                <div>
                  <h2 id="asset-heading">Selected asset</h2>
                  <p>Review the record, then confirm each lifecycle change.</p>
                </div>
              </div>
              {state.assets.length === 0 ? (
                <p className="empty-state">
                  Packed drafts and approved records will appear here.
                </p>
              ) : (
                <>
                  <label className="asset-select">
                    Record
                    <select
                      value={activeAsset?.id ?? ""}
                      onChange={(event) => {
                        setLocalAssetId(event.target.value);
                        setException("");
                        dispatch?.({
                          type: "select-asset",
                          assetId: event.target.value,
                        });
                      }}
                    >
                      {state.assets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {recordText(asset, "assetId") ?? asset.id} ·{" "}
                          {recordText(asset, "state") ?? "record"}
                        </option>
                      ))}
                    </select>
                  </label>
                  {activeAsset && (
                    <div className="asset-record">
                      <div className="asset-title">
                        <h3>
                          {recordText(activeAsset, "assetId") ?? activeAsset.id}
                        </h3>
                        <span
                          className={`state-label state-${activeAssetState}`}
                        >
                          {activeAssetState}
                        </span>
                      </div>
                      <p>
                        Record {activeAsset.id} · revision{" "}
                        <code>{activeRevision ?? "not available"}</code>
                      </p>
                      {activeReportStatus && (
                        <div className="report-summary">
                          <strong>Report: {activeReportStatus}</strong>
                          {activeFailedChecks.length > 0 && (
                            <ul>
                              {activeFailedChecks.map((check) => (
                                <li key={check}>{check}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                      {activeAssetState === "draft" && (
                        <div className="asset-actions">
                          <button
                            type="button"
                            disabled={!mutationsEnabled}
                            onClick={() => void openEdit()}
                          >
                            Edit draft
                          </button>
                          <label>
                            Exception reason{" "}
                            <input
                              value={exception}
                              onChange={(event) =>
                                setException(event.target.value)
                              }
                            />
                          </label>
                          {activeReportStatus === "pass" && (
                            <button
                              type="button"
                              disabled={!mutationsEnabled || !activeRevision}
                              onClick={() => void approve(false)}
                            >
                              Approve
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={
                              !mutationsEnabled ||
                              !activeRevision ||
                              !exception.trim()
                            }
                            onClick={() => void approve(true)}
                          >
                            Approve with exception
                          </button>
                          <button
                            type="button"
                            disabled={!mutationsEnabled}
                            onClick={() => void rejectAsset()}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                      {activeAssetState === "approved" && (
                        <div className="asset-actions">
                          <p>
                            Publish confirms revision{" "}
                            <code>{activeRevision}</code>.
                          </p>
                          <button
                            type="button"
                            className="primary"
                            disabled={
                              !mutationsEnabled ||
                              !activeRevision ||
                              Boolean(recordText(activeAsset, "blockedReason"))
                            }
                            onClick={() => void publish()}
                          >
                            Publish this revision
                          </button>
                          {recordText(activeAsset, "blockedReason") && (
                            <p className="gate-reason">
                              Publish blocked:{" "}
                              {recordText(activeAsset, "blockedReason")}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
              <section className="preview-area">
                <div className="preview-heading">
                  <h3>Isometric preview</h3>
                  <span>integer zoom · nearest pixels</span>
                </div>
                {activePreview && renderPreview ? (
                  renderPreview(activePreview)
                ) : (
                  <p className="muted">
                    Select a draft or approved record to preview it.
                  </p>
                )}
              </section>
              {activeEdit && (
                <EditPanel
                  host={host}
                  edit={activeEdit}
                  report={state.editReports[activeEdit.id]}
                  editorLaunched={editorSessions[activeEdit.id]?.launched}
                  editorReason={editorSessions[activeEdit.id]?.reason}
                  durationsMs={editorSessions[activeEdit.id]?.durationsMs}
                  canMutate={canMutate(state)}
                  onOpen={() => void openEdit()}
                  onChange={(result) => {
                    setMessage(result);
                    void readEditReport(activeEdit.id);
                  }}
                />
              )}
            </section>
          </div>
        </>
      )}
      {Object.entries(state.errors).map(([section, error]) => (
        <p className="notice notice-warn" role="status" key={section}>
          {section} unavailable: {detailText(error)}
        </p>
      ))}
    </main>
  );
}

function hostLabel(host: WorkflowState["host"]): string {
  switch (host.state) {
    case "not-configured":
      return "Not configured";
    case "starting":
      return "Starting";
    case "running":
      return "Connected";
    case "read-only":
      return `Read-only (held by pid ${host.lockHolder})`;
    case "restarting":
      return `Restarting ${host.attempt}/${host.maxAttempts}`;
    case "unavailable":
      return `Unavailable ${host.attempt}/${host.maxAttempts}`;
    case "stopped":
      return "Stopped";
  }
}

function CandidateRow({
  host,
  candidate,
  showPixels,
  enabled,
  onPick,
  onReject,
  canPick,
}: {
  host: StudioHost;
  candidate: SummaryRecord;
  showPixels: boolean;
  enabled: boolean;
  onPick: () => void;
  onReject: () => void;
  canPick: boolean;
}) {
  const report = recordObject(candidate, "report");
  const metrics = recordObject(candidate, "metrics");
  const reportStatus =
    text(report.status) ??
    recordText(candidate, "reportStatus") ??
    "not reported";
  const checks = entries(report.failedChecks ?? report.checks)
    .map((check) => text(check))
    .filter(Boolean) as string[];
  const pixels =
    recordValue(candidate, "pixelsMoved") ??
    recordValue(candidate, "pixelsChanged") ??
    metrics.pixelsMoved ??
    metrics.pixelsChanged;
  const scale =
    recordValue(candidate, "detectedScale") ??
    metrics.detectedScale ??
    recordValue(candidate, "scale");
  const merged =
    recordValue(candidate, "coloursMerged") ??
    metrics.coloursMerged ??
    metrics.colorsMerged;
  return (
    <article className="candidate-row">
      <div className="candidate-title">
        <div>
          <strong>{candidate.id}</strong>
          <small>
            {recordText(candidate, "slotKey") ?? "slot not reported"} ·{" "}
            {recordText(candidate, "status") ?? "candidate"}
          </small>
        </div>
        <span className={`state-label state-${reportStatus}`}>
          {reportStatus}
        </span>
      </div>
      {showPixels && <CandidatePixels host={host} candidateId={candidate.id} />}
      <dl>
        <div>
          <dt>Scale</dt>
          <dd>{scale === undefined ? "not reported" : detailText(scale)}</dd>
        </div>
        <div>
          <dt>Colours merged</dt>
          <dd>{merged === undefined ? "not reported" : detailText(merged)}</dd>
        </div>
        <div>
          <dt>Pixels moved</dt>
          <dd>{pixels === undefined ? "not reported" : detailText(pixels)}</dd>
        </div>
      </dl>
      {checks.length > 0 && (
        <ul className="report-failures">
          {checks.map((check) => (
            <li key={check}>{check}</li>
          ))}
        </ul>
      )}
      <div className="candidate-actions">
        <button type="button" disabled={!enabled || !canPick} onClick={onPick}>
          Pick
        </button>
        <button type="button" disabled={!enabled} onClick={onReject}>
          Reject
        </button>
      </div>
    </article>
  );
}

export function WorkflowApp({
  host = tauriHost(),
  initialSnapshot,
  renderPreview,
}: {
  readonly host?: StudioHost;
  readonly initialSnapshot?: StudioSnapshot;
  readonly renderPreview?: WorkflowViewProps["renderPreview"];
}) {
  const initialState = useMemo(() => {
    const initial = initialWorkflowState();
    return initialSnapshot
      ? workflowReducer(initial, {
          type: "snapshot",
          snapshot: initialSnapshot,
        })
      : initial;
  }, [initialSnapshot]);
  const [state, dispatch] = useReducer(workflowReducer, initialState);

  useEffect(() => {
    let active = true;
    void host
      .configStatus()
      .then((config) => {
        if (!active || initialSnapshot) return;
        dispatch({ type: "configured", configured: config.configured });
        if (!config.configured)
          dispatch({
            type: "snapshot",
            snapshot: { host: { state: "not-configured" } },
          });
      })
      .catch(() => undefined);
    const unsubscribe = host.snapshots.subscribe({
      onSnapshot: (snapshot) => {
        if (active) dispatch({ type: "snapshot", snapshot });
      },
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [host, initialSnapshot]);

  const chooseConfig = async () => {
    try {
      const result = await host.configChoose();
      if (!result.cancelled && result.configured) {
        dispatch({ type: "configured", configured: true });
      }
    } catch {
      // The host snapshot is authoritative and will describe a failed launch.
    }
  };

  return (
    <WorkflowView
      state={state}
      host={host}
      dispatch={dispatch}
      onConfigChoose={() => void chooseConfig()}
      renderPreview={renderPreview}
    />
  );
}

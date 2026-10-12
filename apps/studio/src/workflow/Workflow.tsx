import {
  type Dispatch,
  type FormEvent,
  memo,
  type ReactNode,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import type { StudioHost } from "../host/client";
import { tauriHost } from "../host/tauri";
import type {
  CandidateSummary,
  ConformHow,
  StudioSnapshot,
  SummaryRecord,
} from "../host/types";
import {
  approvalArgsForAsset,
  buildPackArgs,
  buildRequestArgs,
  callTrackingLock,
  checkResolvedSeed,
  chooseConfigGuarded,
  conformJob,
  createLatest,
  createStableHandlers,
  deriveChoices,
  deriveGuarded,
  detailText,
  type EditorSession,
  editableSlotsForSet,
  editOpenTarget,
  editorSessionOf,
  editReportSignature,
  editsForReports,
  readEditReport as fetchEditReport,
  type GuardUi,
  generateReady,
  guardedAction,
  openWorkingSetEdit,
  packNeedsOriginalWork,
  packNeedsStillFrameMs,
  packWorkingSetGuarded,
  parseInlineConformDraft,
  pickCandidateGuarded,
  previewForAsset,
  readExistingSheet,
  releaseWriterLock,
  reopenEditor,
  reopenWorkingSetEdit,
  requestJobCount,
  requestSignature,
  rerollArgs,
  resolveFlow,
  retryLockedWrite,
  sheetFlow,
  slotHint,
  subjectSlug,
} from "./actions";
import { CandidatePixels } from "./CandidatePixelCell";
import { EditPanel } from "./EditPanel";
import {
  canMutate,
  canRelease,
  initialWorkflowState,
  lockLabel,
  type QueueJob,
  type QueueRowContext,
  queueRowContext,
  recordObject,
  recordText,
  recordValue,
  resolveActiveRecord,
  reuseRowContext,
  type WorkflowAction,
  type WorkflowState,
  workflowReducer,
} from "./model";
import "./workflow.css";

export interface PreviewSelection {
  readonly source: "canon" | "draft" | "approved";
  readonly id: string;
  readonly kind?: "sprite" | "portrait";
  /** The record that replaced the selected canon record; the preview draws nothing of the selected one. */
  readonly supersededBy?: string;
}

export interface WorkflowViewProps {
  readonly state: WorkflowState;
  readonly host: StudioHost;
  readonly onConfigChoose?: () => void;
  /** A message from outside the view, such as a refused config choice. */
  readonly notice?: string;
  readonly dispatch?: Dispatch<WorkflowAction>;
  readonly renderPreview?: (selection?: PreviewSelection) => ReactNode;
}

const text = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;
const recordState = (record: SummaryRecord) =>
  recordText(record, "state") ?? recordText(record, "status");
const recordRevision = (record: SummaryRecord) =>
  Number(record.id.match(/-(\d+)$/)?.[1] ?? -1);
const orderedAssetRecords = (assets: readonly SummaryRecord[]) =>
  [...assets].sort((left, right) => {
    const leftDraft = recordState(left) === "draft";
    const rightDraft = recordState(right) === "draft";
    if (leftDraft !== rightDraft) return leftDraft ? -1 : 1;

    const assetOrder = (recordText(left, "assetId") ?? "").localeCompare(
      recordText(right, "assetId") ?? "",
    );
    if (assetOrder !== 0) return assetOrder;
    if (leftDraft) return recordRevision(right) - recordRevision(left);
    return left.id.localeCompare(right.id);
  });
const candidateChangeCount = (candidate: SummaryRecord) => {
  const count = recordValue(candidate, "pixelsChanged");
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

/**
 * One queue row. It is given its own job and a few primitives (`ctx`), never
 * the window's state, and its handlers are stable, so typing in the form or a
 * poll that changes nothing about this job does not render it again.
 */
export const QueueItem = memo(function QueueItem({
  job,
  ctx,
  busy,
  onRemove,
  onAbort,
  onRetry,
  conformSet,
  onConform,
  candidate,
  conformBusy,
}: {
  job: QueueJob;
  ctx: QueueRowContext;
  busy: boolean;
  onRemove: (id: string) => void;
  onAbort: (id: string) => void;
  onRetry: (job: QueueJob) => void;
  conformSet: string;
  onConform: (jobId: string, how: ConformHow) => void;
  candidate?: SummaryRecord;
  conformBusy: boolean;
}) {
  const candidateSummary = candidate as CandidateSummary | undefined;
  const restartRemoval =
    ctx.restartRemovable &&
    (job.status === "queued" || job.status === "aborting");
  const enabled = (ctx.mutable || restartRemoval) && !busy;
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
      {(job.status === "aborting" ||
        (ctx.restartPending &&
          (job.status === "cancelled" || job.status === "queued"))) && (
        <p className="queue-note">
          Restarting the image server. The next job reloads the model.
        </p>
      )}
      {ctx.hostRestarting && job.status === "queued" && (
        <p className="queue-note">
          Waiting for server restart, attempt {ctx.attempt} of {ctx.maxAttempts}
          .
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
        {job.status === "completed" && job.raw.candidate === null && (
          <div className="conform-job">
            {conformSet && (
              <button
                type="button"
                disabled={!enabled || conformBusy}
                onClick={() => onConform(job.id, { set: conformSet })}
              >
                Conform
              </button>
            )}
            <ScaleConformForm
              disabled={!enabled || conformBusy}
              onConform={(params) => onConform(job.id, params)}
            />
          </div>
        )}
      </div>
      {candidateSummary?.status === "needs-scale" && (
        <ScaleConformForm
          candidate={candidateSummary}
          disabled={!enabled || conformBusy}
          onConform={(params) => onConform(job.id, params)}
        />
      )}
    </li>
  );
});

function ScaleConformForm({
  candidate,
  disabled,
  onConform,
}: {
  candidate?: Extract<CandidateSummary, { status: "needs-scale" }>;
  disabled: boolean;
  onConform: (how: ConformHow) => void;
}) {
  const [scale, setScale] = useState("");
  const [backgroundType, setBackgroundType] = useState<"" | "alpha" | "key">(
    "",
  );
  const [alphaCutoff, setAlphaCutoff] = useState("");
  const [edgeTolerance, setEdgeTolerance] = useState("");
  const [minConfidence, setMinConfidence] = useState("");
  const [minEdges, setMinEdges] = useState("");
  const [rgb, setRgb] = useState("");
  const [tolerance, setTolerance] = useState("");

  const params = parseInlineConformDraft(
    {
      backgroundType,
      rgb,
      tolerance,
      alphaCutoff,
      edgeTolerance,
      minConfidence,
      minEdges,
      scale,
    },
    candidate !== undefined,
  );

  const submit = () => {
    if (disabled || !params) return;
    onConform(params);
  };

  return (
    <form
      className="scale-conform-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {candidate && <p className="queue-note">{candidate.message}</p>}
      <h4>
        {candidate ? "Inline conform settings" : "Inline conform parameters"}
      </h4>
      <p className="muted">
        {candidate
          ? "Set every threshold and choose a scale to retry."
          : "Set every threshold. Leave scale empty to auto-detect."}
      </p>
      <label className="workflow-field">
        Scale
        <input
          type="number"
          className="workflow-control"
          min={1}
          step={1}
          required={candidate !== undefined}
          value={scale}
          onChange={(event) => setScale(event.target.value)}
        />
      </label>
      <label className="workflow-field">
        Background
        <select
          className="workflow-control"
          required
          value={backgroundType}
          onChange={(event) =>
            setBackgroundType(event.target.value as "" | "alpha" | "key")
          }
        >
          <option value="">Choose a background</option>
          <option value="alpha">Alpha</option>
          <option value="key">Colour key</option>
        </select>
      </label>
      {backgroundType === "key" && (
        <>
          <label className="workflow-field">
            Key RGB
            <input
              className="workflow-control"
              required
              value={rgb}
              placeholder="r, g, b"
              onChange={(event) => setRgb(event.target.value)}
            />
          </label>
          <label className="workflow-field">
            Key tolerance
            <input
              type="number"
              className="workflow-control"
              required
              min={0}
              step={1}
              value={tolerance}
              onChange={(event) => setTolerance(event.target.value)}
            />
          </label>
        </>
      )}
      <label className="workflow-field">
        Alpha cutoff
        <input
          type="number"
          className="workflow-control"
          required
          min={1}
          max={255}
          step={1}
          value={alphaCutoff}
          onChange={(event) => setAlphaCutoff(event.target.value)}
        />
      </label>
      <label className="workflow-field">
        Grid edge tolerance
        <input
          type="number"
          className="workflow-control"
          required
          min={0}
          step={1}
          value={edgeTolerance}
          onChange={(event) => setEdgeTolerance(event.target.value)}
        />
      </label>
      <label className="workflow-field">
        Grid minimum confidence
        <input
          type="number"
          className="workflow-control"
          required
          min={0}
          max={1}
          step="any"
          value={minConfidence}
          onChange={(event) => setMinConfidence(event.target.value)}
        />
      </label>
      <label className="workflow-field">
        Grid minimum edges
        <input
          type="number"
          className="workflow-control"
          required
          min={1}
          step={1}
          value={minEdges}
          onChange={(event) => setMinEdges(event.target.value)}
        />
      </label>
      <button type="submit" disabled={disabled || !params}>
        {candidate ? "Run with scale" : "Conform with params"}
      </button>
    </form>
  );
}

export function WorkflowView({
  state,
  host,
  onConfigChoose,
  notice,
  dispatch,
  renderPreview,
}: WorkflowViewProps) {
  const [subject, setSubject] = useState("zeus");
  const [kind, setKind] = useState<"sprite" | "portrait">("sprite");
  const [slots, setSlots] = useState("idle/south\nwalk/south");
  const [batch, setBatch] = useState(1);
  const [styleNote, setStyleNote] = useState("");
  const [seedText, setSeedText] = useState("");
  const [requestId, setRequestId] = useState("");
  const [resolvedArgs, setResolvedArgs] = useState<Record<string, unknown>>();
  /** The form text the resolve on screen was made from. */
  const [resolvedFrom, setResolvedFrom] = useState<string>();
  const [workingSetId, setWorkingSetId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [styleTag, setStyleTag] = useState("");
  const [footprintWidth, setFootprintWidth] = useState("");
  const [footprintHeight, setFootprintHeight] = useState("");
  const [stillFrameMs, setStillFrameMs] = useState("");
  const [originalWorkLicence, setOriginalWorkLicence] = useState("");
  const [originalWorkAttribution, setOriginalWorkAttribution] = useState("");
  const [exception, setException] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [deriveKey, setDeriveKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [conformBusy, setConformBusy] = useState<Record<string, boolean>>({});
  const [conformSet, setConformSet] = useState("");
  const [fetchedStatus, setFetchedStatus] = useState<
    Record<string, unknown> | undefined
  >();
  const [queueBusy, setQueueBusy] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  const [refusalDetails, setRefusalDetails] = useState("");
  const [activeEditId, setActiveEditId] = useState<string>();
  const [openedEdit, setOpenedEdit] = useState<SummaryRecord>();
  const [editorSessions, setEditorSessions] = useState<
    Record<string, EditorSession>
  >({});
  const reopenedEdits = useRef(new Set<string>());

  const selectedSet =
    state.workingSets.find((set) => set.id === workingSetId) ??
    state.workingSets[0];
  const sortedCandidates = [...state.candidates].sort(
    (left, right) => candidateChangeCount(left) - candidateChangeCount(right),
  );
  const statusData = state.status ?? fetchedStatus;
  const conformSets = entries(object(statusData).conformSets).filter(
    (set): set is string => typeof set === "string",
  );
  const originalWorkRequired =
    selectedSet !== undefined && packNeedsOriginalWork(selectedSet);
  const packArgs = selectedSet
    ? buildPackArgs({
        selectedSet,
        assets: state.assets,
        assetId,
        styleTag,
        footprintWidth,
        footprintHeight,
        stillFrameMs,
        originalWorkLicence,
        originalWorkAttribution,
      })
    : undefined;
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
    state.configured &&
    (state.host.state === "running" || state.host.state === "read-only") &&
    !busy;

  useEffect(() => {
    if (
      !readsEnabled ||
      (state.status !== undefined && state.status !== null) ||
      fetchedStatus
    )
      return;
    let live = true;
    void host
      .call("status")
      .then((value) => {
        if (live) setFetchedStatus(object(value));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [fetchedStatus, host, readsEnabled, state.status]);

  // One guard for every host action the window runs: refusals are shown with
  // their details and the pending state always ends (see `guardedAction`).
  const guardUi = (allowed: () => boolean): GuardUi => ({
    allowed,
    setBusy,
    setMessage,
    setRefusalDetails,
  });
  const mayMutate = () => canMutate(state);
  const call = async (
    op: Parameters<StudioHost["call"]>[0],
    args: Record<string, unknown>,
    readOnly = false,
    allowRestarting = false,
    nonBlocking = false,
  ) =>
    guardedAction(
      guardUi(() =>
        readOnly
          ? readsEnabled
          : canMutate(state) ||
            (allowRestarting &&
              state.configured &&
              state.lockOwner === undefined &&
              state.host.state === "restarting"),
      ),
      { label: op, nonBlocking },
      () =>
        callTrackingLock(host, op, args, {
          readOnly,
          lockedWritePending: state.lockedWrite !== undefined,
          dispatch,
        }),
    );

  const release = async () => {
    const outcome = await releaseWriterLock(state, (op, args) =>
      call(op, args, false, false, true),
    );
    if (outcome.kind === "released") setMessage(outcome.message);
  };

  const formArgs = () =>
    buildRequestArgs(
      { subject, kind, slots, batch, styleNote, seedText },
      requestId || `${subjectSlug(subject)}-${crypto.randomUUID().slice(0, 8)}`,
    );

  // A resolve reply is only for the form it was sent from: the form's current
  // text is compared with the text it had at the click.
  const formSignature = useRef("");
  formSignature.current = requestSignature({
    subject,
    kind,
    slots,
    batch,
    styleNote,
    seed: seedText,
  });
  const latestResolve = useRef(createLatest());
  const latestSheet = useRef(createLatest());
  const workingSetIdRef = useRef(workingSetId);
  workingSetIdRef.current = workingSetId;

  const resolveRequest = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const args = formArgs();
      const sentFrom = formSignature.current;
      setRequestId(text(args.id));
      setResolvedArgs(args);
      await resolveFlow({
        latest: latestResolve.current,
        isCurrent: () => formSignature.current === sentFrom,
        call: async () => call("resolve", args, true),
        onResolved: (result) => {
          // A seed the host drew is held to the same range as one typed.
          const drawn = checkResolvedSeed(
            object(object(result).request).seed,
            requestJobCount(slots, kind, batch),
          );
          if (drawn !== undefined) {
            setResolvedArgs(undefined);
            setResolvedFrom(undefined);
            dispatch?.({ type: "refusal", message: drawn });
            return;
          }
          setResolvedFrom(sentFrom);
          dispatch?.({ type: "resolution", value: result });
          setMessage(
            "Request resolved. Review the specification before generating.",
          );
        },
        onRefused: () => {
          setResolvedArgs(undefined);
          setResolvedFrom(undefined);
        },
      });
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
    if (!generateReady(resolvedFrom, formSignature.current)) return;
    const args = { ...resolvedArgs };
    const resolved = object(resolvedRequest);
    if (typeof resolved.seed === "number") args.seed = resolved.seed;
    const result = await call("generate", args, false, false, true);
    if (result !== undefined) {
      dispatch?.({ type: "resolution", value: undefined });
      setResolvedArgs(undefined);
      setResolvedFrom(undefined);
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
    const args = rerollArgs(job);
    if (args) void call("reroll", args, false, false, true);
  };
  // The write the lock refused is sent again. A generate goes back through the
  // form's own handler, so it ends the way a first try does.
  const retryRefusedWrite = () =>
    void retryLockedWrite(state.lockedWrite, {
      call: (op, args) => call(op, args, false, false, true),
      generate,
    });

  const runConform = async (jobId: string, how: ConformHow) => {
    if (!mutationsEnabled) return;
    setConformBusy((previous) => ({ ...previous, [jobId]: true }));
    setMessage("");
    try {
      const candidate = await conformJob(host, jobId, how);
      dispatch?.({ type: "candidate-conformed", candidate });
      if (candidate.status === "done")
        setMessage(`Candidate ${candidate.id} is ready for review.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setConformBusy((previous) => ({ ...previous, [jobId]: false }));
    }
  };

  // The rows get handlers that never change identity and always call the
  // latest of these, and the few facts they need as one object that changes
  // only when one of those facts does.
  const rowLatest = useRef({
    onRemove: (_id: string): void => undefined,
    onAbort: (_id: string): void => undefined,
    onRetry: (_job: QueueJob): void => undefined,
    onConform: (_jobId: string, _how: ConformHow): void => undefined,
  });
  rowLatest.current = {
    onRemove: (id) => void remove(id),
    onAbort: (id) => void abort(id),
    onRetry: retry,
    onConform: (jobId, how) => void runConform(jobId, how),
  };
  const rowHandlers = useMemo(() => createStableHandlers(rowLatest), []);
  const rowContext = useRef(queueRowContext(state));
  rowContext.current = reuseRowContext(
    rowContext.current,
    queueRowContext(state),
  );
  const candidatesById = useMemo(
    () =>
      new Map(state.candidates.map((candidate) => [candidate.id, candidate])),
    [state.candidates],
  );

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
    setStillFrameMs("");
    workingSetIdRef.current = targetId;
    if (!existing && !canMutate(state)) return;
    await sheetFlow({
      latest: latestSheet.current,
      isCurrent: () => workingSetIdRef.current === targetId,
      ...(existing
        ? {}
        : {
            create: async () =>
              call("set-create", { id: targetId, requestId: requestKey }),
          }),
      read: async () => readExistingSheet(host, targetId, readsEnabled),
      onSheet: dispatchSheet,
      onError: setMessage,
    });
  };

  const dispatchSheet = (sheet: unknown) => {
    // The command result is shown as supplied by the host; no candidate outcome is inferred here.
    dispatch?.({ type: "sheet", value: sheet });
  };

  const pickCandidate = async (candidate: SummaryRecord) => {
    if (!selectedSet) return;
    await pickCandidateGuarded(
      host,
      guardUi(mayMutate),
      selectedSet.id,
      candidate,
    );
  };
  const [localAssetId, setLocalAssetId] = useState<string | undefined>(
    state.selectedAssetId,
  );
  // A requested record that is not in the snapshot yet (a pack just returned its id) is pending; it never falls back
  // to another record, so no lifecycle action can reach one the owner did not select.
  const activeRecord = resolveActiveRecord(
    state.assets,
    localAssetId ?? state.selectedAssetId,
  );
  const activeAsset =
    activeRecord.kind === "record" ? activeRecord.asset : undefined;
  const pendingAssetId =
    activeRecord.kind === "pending" ? activeRecord.id : undefined;
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
  const assetWorkingSet = activeAsset
    ? state.workingSets.find(
        (set) => set.id === recordText(activeAsset, "workingSetId"),
      )
    : undefined;
  const activeAssetKind =
    (activeAsset ? recordText(activeAsset, "kind") : undefined) ??
    (assetWorkingSet ? recordText(assetWorkingSet, "kind") : undefined);
  // What the preview is asked to draw for this record: see `previewForAsset`.
  const activePreview: PreviewSelection | undefined = activeAsset
    ? previewForAsset(activeAsset, state.assets)
    : undefined;
  const activePreviewWithKind: PreviewSelection | undefined =
    activePreview &&
    (activeAssetKind === "portrait" || activeAssetKind === "sprite")
      ? {
          ...activePreview,
          kind: activeAssetKind as "portrait" | "sprite",
        }
      : activePreview;

  const activeEdit =
    state.edits.find((edit) => edit.id === activeEditId) ??
    (openedEdit?.id === activeEditId ? openedEdit : undefined) ??
    (activeEditId
      ? undefined
      : state.edits.find((edit) => recordState(edit) === "open")) ??
    openedEdit;
  const reportableEdits = editsForReports(state.edits, activeEdit?.id);
  const editSignature = editReportSignature(reportableEdits);
  const reportableEditsRef = useRef(reportableEdits);
  reportableEditsRef.current = reportableEdits;
  const canReopenEdit = canMutate(state);

  useEffect(() => {
    if (!dispatch || !editSignature || !readsEnabled) return;
    let live = true;
    for (const edit of reportableEditsRef.current) {
      if (
        recordState(edit) === "open" &&
        canReopenEdit &&
        !reopenedEdits.current.has(edit.id)
      ) {
        reopenedEdits.current.add(edit.id);
        void reopenEditor(host, edit, {
          isLive: () => live,
          onSession: (id, session) =>
            setEditorSessions((previous) => ({ ...previous, [id]: session })),
          onForget: () => reopenedEdits.current.delete(edit.id),
          onError: setMessage,
        });
      }
      void fetchEditReport(host, edit.id)
        .then((report) => {
          if (live && report) dispatch({ type: "edit-report", report });
        })
        .catch((error: unknown) => {
          if (live)
            setMessage(error instanceof Error ? error.message : String(error));
        });
    }
    return () => {
      live = false;
    };
  }, [canReopenEdit, dispatch, editSignature, host, readsEnabled]);
  const makeWorkingSet = async (request: SummaryRecord) => loadSheet(request);
  const pack = async () => {
    if (!packArgs) return;
    await packWorkingSetGuarded(
      host,
      guardUi(mayMutate),
      packArgs,
      (recordId) => {
        setLocalAssetId(recordId);
        setException("");
        dispatch?.({ type: "select-asset", assetId: recordId });
      },
    );
  };
  const derive = async (choices: ReturnType<typeof deriveChoices>) => {
    const choice = choices.find((c) => c.key === deriveKey) ?? choices[0];
    if (!choice) return;
    await deriveGuarded(host, guardUi(mayMutate), choice.args, (reply) => {
      // The derived set is the one the pack form acts on next, packed over the same asset.
      setWorkingSetId(reply.workingSetId);
      setAssetId(choice.args.asset);
      setStillFrameMs("");
    });
  };
  const approve = async (withException: boolean) => {
    if (!activeAsset) return;
    const target = approvalArgsForAsset(activeAsset);
    if (!target) return;
    const args: Record<string, unknown> = { ...target };
    if (withException) args.exception = { reason: exception.trim() };
    await call(withException ? "approve-with-exception" : "approve", args);
  };
  const publish = async () => {
    if (!activeAsset) return;
    const target = approvalArgsForAsset(activeAsset);
    if (!target) return;
    await call("publish", target);
  };
  const rejectAsset = async () => {
    if (!activeAsset || !rejectReason.trim()) return;
    await call("reject", { id: activeAsset.id, reason: rejectReason.trim() });
    setRejectReason("");
  };

  const readEditReport = async (editId: string) => {
    try {
      const report = await fetchEditReport(host, editId);
      if (report) dispatch?.({ type: "edit-report", report });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const openEdit = async (
    requestedSet?: SummaryRecord,
    requestedEdit?: SummaryRecord,
  ) => {
    if (!canMutate(state)) return;
    const editTarget = requestedEdit
      ? editOpenTarget(requestedEdit, state.workingSets)
      : undefined;
    if (requestedEdit && !editTarget) return;
    const assetSetId = activeAsset
      ? recordText(activeAsset, "workingSetId")
      : undefined;
    const currentSet =
      (editTarget
        ? state.workingSets.find(
            (entry) => entry.id === editTarget.workingSetId,
          )
        : undefined) ??
      requestedSet ??
      (assetSetId
        ? state.workingSets.find((entry) => entry.id === assetSetId)
        : undefined) ??
      selectedSet;
    if (!currentSet) return;
    const slots = editTarget?.slots ?? editableSlotsForSet(currentSet);
    if (slots.length === 0) {
      setMessage("Pick a candidate before opening this set in the editor.");
      return;
    }
    const existingEdit =
      (editTarget ? requestedEdit : undefined) ??
      state.edits.find(
        (entry) =>
          recordText(entry, "workingSetId") === currentSet.id &&
          recordState(entry) === "open",
      ) ??
      (activeEdit &&
      recordText(activeEdit, "workingSetId") === currentSet.id &&
      recordState(activeEdit) === "open"
        ? activeEdit
        : undefined);
    const existingSlots = existingEdit
      ? recordValue(existingEdit, "slots")
      : undefined;
    const requestedSlots = Array.isArray(existingSlots)
      ? existingSlots.filter((slot): slot is string => typeof slot === "string")
      : slots;
    const editId =
      existingEdit?.id ??
      `edit-${slug(currentSet.id)}-${crypto.randomUUID().slice(0, 6)}`;
    setBusy(true);
    setMessage("");
    try {
      const opened = requestedEdit
        ? await reopenWorkingSetEdit(host, requestedEdit, state.workingSets)
        : await openWorkingSetEdit(host, currentSet, editId, requestedSlots);
      if (!opened) return;
      reopenedEdits.current.add(opened.editId);
      const rawEdit: SummaryRecord = {
        id: opened.editId,
        workingSetId: currentSet.id,
        slots: opened.slots,
        status: "open",
        previewSheetHash: null,
      };
      setOpenedEdit(rawEdit);
      setActiveEditId(opened.editId);
      setEditorSessions((previous) => ({
        ...previous,
        [opened.editId]: editorSessionOf(opened),
      }));
      await readEditReport(opened.editId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const reopenActiveEdit = async () => {
    if (!activeEdit) return;
    const target = editOpenTarget(activeEdit, state.workingSets);
    if (!target) return;
    const workingSet = state.workingSets.find(
      (entry) => entry.id === target.workingSetId,
    );
    if (workingSet) await openEdit(workingSet, activeEdit);
  };

  const lockMessage =
    state.lockOwner === undefined
      ? undefined
      : `Locked by another studio session (pid ${state.lockOwner})`;
  const lockIndicator = lockLabel(state);
  const restartMessage = state.restartPending
    ? "Image server restarting after abort. Queued jobs can still be removed."
    : state.host.state === "restarting"
      ? `Image server restarting, attempt ${state.host.attempt} of ${state.host.maxAttempts}. Jobs can still be removed.`
      : undefined;

  return (
    <main className="studio-workspace">
      <header className="studio-header">
        <div>
          <p className="eyebrow">Panthea / asset desk</p>
          <h1>Studio workflow</h1>
        </div>
        <div className="header-actions">
          <div className="host-indicator" aria-live="polite">
            <span className={`host-dot host-${state.host.state}`} />
            {hostLabel(state.host)}
          </div>
          {lockIndicator && (
            <div className="host-indicator" aria-live="polite">
              {lockIndicator}
            </div>
          )}
          {state.configured && (
            <button
              type="button"
              disabled={!canRelease(state) || busy}
              title={
                canRelease(state)
                  ? "Give the writer lock back so a CLI step can write"
                  : (state.idleReason ??
                    "Nothing to release: this app does not hold the lock")
              }
              onClick={() => void release()}
            >
              Release
            </button>
          )}
          {onConfigChoose && (
            <button
              type="button"
              className={
                state.host.state === "unavailable" ? "primary" : undefined
              }
              onClick={onConfigChoose}
            >
              Change config
            </button>
          )}
        </div>
      </header>

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

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
          {state.lockedWrite && (
            <p className="notice notice-lock" role="status">
              The write was refused: another process holds the writer lock. Your
              form is unchanged.{" "}
              <button
                type="button"
                disabled={!mutationsEnabled}
                onClick={retryRefusedWrite}
              >
                Retry
              </button>
            </p>
          )}
          {state.releaseFailure && (
            <p className="notice notice-warn" role="status">
              Releasing the writer lock failed and the lock was kept:{" "}
              {state.releaseFailure}. Release again, or quit the app.
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
                <label className="workflow-field">
                  Subject
                  <input
                    className="workflow-control"
                    value={subject}
                    onChange={(event) => {
                      setSubject(event.target.value);
                      setRequestId("");
                      dispatch?.({ type: "resolution", value: undefined });
                      setResolvedArgs(undefined);
                    }}
                  />
                </label>
                <label className="workflow-field">
                  Kind
                  <select
                    className="workflow-control"
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
                <label className="workflow-field">
                  Slots <span className="field-hint">{slotHint(kind)}</span>
                  <textarea
                    className="workflow-control"
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
                <label className="workflow-field">
                  Batch
                  <input
                    type="number"
                    className="workflow-control"
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
                <label className="workflow-field">
                  Base seed{" "}
                  <span className="field-hint">
                    digits only, 0 to 4294967295; empty draws one
                  </span>
                  <input
                    className="workflow-control"
                    inputMode="numeric"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="draw one"
                    value={seedText}
                    onChange={(event) => {
                      setSeedText(event.target.value);
                      setRequestId("");
                      dispatch?.({ type: "resolution", value: undefined });
                      setResolvedArgs(undefined);
                      setResolvedFrom(undefined);
                    }}
                  />
                </label>
                <label className="workflow-field">
                  Style note <span className="field-hint">optional</span>
                  <textarea
                    className="workflow-control"
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
                    disabled={
                      !mutationsEnabled ||
                      resolvedArgs === undefined ||
                      !generateReady(resolvedFrom, formSignature.current)
                    }
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
                  {typeof object(resolvedRequest).seed === "number" && (
                    <p className="resolved-seed">
                      Base seed:{" "}
                      <strong>{String(object(resolvedRequest).seed)}</strong>
                      {seedText === "" ? " (drawn for this request)" : ""}
                    </p>
                  )}
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
              {state.jobs.some(
                (job) =>
                  job.status === "completed" && job.raw.candidate === null,
              ) && (
                <div className="conform-set-control">
                  {conformSets.length > 0 ? (
                    <label className="workflow-field working-set-select">
                      Conform set
                      <select
                        className="workflow-control"
                        value={conformSet}
                        onChange={(event) => setConformSet(event.target.value)}
                      >
                        <option value="">Choose a set</option>
                        {conformSets.map((set) => (
                          <option key={set} value={set}>
                            {set}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <p className="muted">
                      Conform needs either a config set or explicit parameters.
                    </p>
                  )}
                </div>
              )}
              {state.jobs.length === 0 ? (
                <p className="empty-state">Queue is empty</p>
              ) : (
                <ol className="queue-list">
                  {state.jobs.map((job) => (
                    <QueueItem
                      key={job.id}
                      job={job}
                      ctx={rowContext.current}
                      busy={queueBusy[job.id] === true}
                      onRemove={rowHandlers.onRemove}
                      onAbort={rowHandlers.onAbort}
                      onRetry={rowHandlers.onRetry}
                      conformSet={conformSet}
                      onConform={rowHandlers.onConform}
                      candidate={candidatesById.get(job.id)}
                      conformBusy={conformBusy[job.id] === true}
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
                          !readsEnabled ||
                          (!state.workingSets.some(
                            (set) =>
                              recordText(set, "sheetRequestId") ===
                                request.id ||
                              recordText(set, "requestId") === request.id,
                          ) &&
                            !mutationsEnabled)
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
                    />
                  ))
                )}
              </div>
              {state.workingSets.length > 0 && (
                <label className="workflow-field working-set-select">
                  Working set
                  <select
                    className="workflow-control"
                    value={selectedSet?.id ?? ""}
                    onChange={(event) => {
                      setWorkingSetId(event.target.value);
                      setStillFrameMs("");
                    }}
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
                <div className="working-set-actions">
                  <button
                    type="button"
                    disabled={
                      !mutationsEnabled ||
                      editableSlotsForSet(selectedSet).length === 0
                    }
                    onClick={() => void openEdit(selectedSet)}
                  >
                    Open editor
                  </button>
                  {editableSlotsForSet(selectedSet).length === 0 && (
                    <p className="muted">
                      Pick a candidate before opening this set in the editor.
                    </p>
                  )}
                </div>
              )}
              {selectedSet && (
                <div className="pack-form">
                  <h3>Pack a selected set</h3>
                  <p>Pack requires a complete working set.</p>
                  <label className="workflow-field">
                    Asset ID
                    <input
                      className="workflow-control"
                      required
                      maxLength={128}
                      value={assetId}
                      onChange={(event) => setAssetId(event.target.value)}
                    />
                  </label>
                  <label className="workflow-field">
                    Style tag
                    <input
                      className="workflow-control"
                      required
                      maxLength={128}
                      value={styleTag}
                      onChange={(event) => setStyleTag(event.target.value)}
                    />
                  </label>
                  {recordText(selectedSet, "kind") === "sprite" && (
                    <div className="footprint-fields">
                      <label className="workflow-field">
                        Footprint width
                        <input
                          className="workflow-control"
                          type="number"
                          min={1}
                          step={1}
                          required
                          value={footprintWidth}
                          onChange={(event) =>
                            setFootprintWidth(event.target.value)
                          }
                        />
                      </label>
                      <label className="workflow-field">
                        Footprint height
                        <input
                          className="workflow-control"
                          type="number"
                          min={1}
                          step={1}
                          required
                          value={footprintHeight}
                          onChange={(event) =>
                            setFootprintHeight(event.target.value)
                          }
                        />
                      </label>
                    </div>
                  )}
                  {packNeedsStillFrameMs(selectedSet) && (
                    <label className="workflow-field">
                      Still-frame time (ms)
                      <input
                        className="workflow-control"
                        type="number"
                        min={1}
                        step={1}
                        required
                        value={stillFrameMs}
                        onChange={(event) =>
                          setStillFrameMs(event.target.value)
                        }
                      />
                    </label>
                  )}
                  {originalWorkRequired && (
                    <div className="original-work-fields">
                      <label className="workflow-field">
                        Original-work licence
                        <input
                          className="workflow-control"
                          required
                          value={originalWorkLicence}
                          onChange={(event) =>
                            setOriginalWorkLicence(event.target.value)
                          }
                        />
                      </label>
                      <label className="workflow-field">
                        Author / method description{" "}
                        <span className="field-hint">optional</span>
                        <textarea
                          className="workflow-control"
                          rows={2}
                          value={originalWorkAttribution}
                          onChange={(event) =>
                            setOriginalWorkAttribution(event.target.value)
                          }
                        />
                      </label>
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={!mutationsEnabled || packArgs === undefined}
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
              <section className="preview-area">
                <div className="preview-heading">
                  <h3>Isometric preview</h3>
                  <span>integer zoom · nearest pixels</span>
                </div>
                {activePreviewWithKind &&
                renderPreview &&
                activeAsset &&
                activeAssetState === "draft" &&
                recordText(activeAsset, "method") === "derived" ? (
                  <div className="derive-compare">
                    <figure>
                      <figcaption>
                        Source: published{" "}
                        {recordText(activeAsset, "assetId") ?? activeAsset.id}
                      </figcaption>
                      {renderPreview({
                        source: "canon",
                        id:
                          recordText(activeAsset, "assetId") ?? activeAsset.id,
                        kind: "sprite",
                      })}
                    </figure>
                    <figure>
                      <figcaption>Derived: this draft</figcaption>
                      {renderPreview(activePreviewWithKind)}
                    </figure>
                  </div>
                ) : activePreviewWithKind && renderPreview ? (
                  renderPreview(activePreviewWithKind)
                ) : (
                  <p className="muted">
                    {pendingAssetId === undefined
                      ? "Select a draft or approved record to preview it."
                      : `Waiting for ${pendingAssetId}; no other record is previewed.`}
                  </p>
                )}
              </section>
              {state.assets.length === 0 && pendingAssetId === undefined ? (
                <p className="empty-state">
                  Packed drafts and approved records will appear here.
                </p>
              ) : (
                <>
                  <label className="asset-select workflow-field">
                    Record
                    <select
                      className="workflow-control"
                      value={pendingAssetId ?? activeAsset?.id ?? ""}
                      onChange={(event) => {
                        setLocalAssetId(event.target.value);
                        setException("");
                        dispatch?.({
                          type: "select-asset",
                          assetId: event.target.value,
                        });
                      }}
                    >
                      {pendingAssetId !== undefined && (
                        <option value={pendingAssetId} disabled>
                          Waiting for {pendingAssetId}…
                        </option>
                      )}
                      {orderedAssetRecords(state.assets).map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {recordText(asset, "assetId") ?? asset.id} ·{" "}
                          {recordText(asset, "state") ?? "record"}
                          {" · "}
                          {asset.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  {pendingAssetId !== undefined && (
                    <div className="asset-record asset-pending">
                      <p role="status">
                        Waiting for {pendingAssetId}… It is not in the studio's
                        lists yet; nothing is shown or changed until it is.
                      </p>
                      <div className="asset-actions">
                        {[
                          "Edit draft",
                          "Approve",
                          "Approve with exception",
                          "Reject",
                          "Publish this revision",
                        ].map((label) => (
                          <button key={label} type="button" disabled>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
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
                      {activeAssetState === "canon" &&
                        (() => {
                          const choices = deriveChoices(activeAsset);
                          return choices.length === 0 ? null : (
                            <div className="derive-panel">
                              <h3>Derive from this revision</h3>
                              <p className="muted">
                                Makes a working set from the published pixels.
                                Nothing is changed until you pack, approve and
                                publish it.
                              </p>
                              <label className="workflow-field">
                                Derivation
                                <select
                                  className="workflow-control"
                                  value={
                                    choices.find((c) => c.key === deriveKey)
                                      ?.key ?? choices[0]?.key
                                  }
                                  onChange={(event) =>
                                    setDeriveKey(event.target.value)
                                  }
                                >
                                  {choices.map((choice) => (
                                    <option key={choice.key} value={choice.key}>
                                      {choice.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <button
                                type="button"
                                disabled={!mutationsEnabled}
                                onClick={() => void derive(choices)}
                              >
                                Derive
                              </button>
                            </div>
                          );
                        })()}
                      {activeAssetState === "draft" && (
                        <div className="asset-actions">
                          <button
                            type="button"
                            disabled={!mutationsEnabled}
                            onClick={() => void openEdit()}
                          >
                            Edit draft
                          </button>
                          <label className="workflow-field">
                            Exception reason{" "}
                            <input
                              className="workflow-control"
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
                          <label className="workflow-field">
                            Rejection reason
                            <input
                              className="workflow-control"
                              value={rejectReason}
                              onChange={(event) =>
                                setRejectReason(event.target.value)
                              }
                            />
                          </label>
                          <button
                            type="button"
                            disabled={!mutationsEnabled || !rejectReason.trim()}
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
              {activeEdit && (
                <EditPanel
                  host={host}
                  edit={activeEdit}
                  report={state.editReports[activeEdit.id]}
                  editorLaunched={editorSessions[activeEdit.id]?.launched}
                  editorReason={editorSessions[activeEdit.id]?.reason}
                  durationsMs={editorSessions[activeEdit.id]?.durationsMs}
                  canMutate={canMutate(state)}
                  onOpen={() => void reopenActiveEdit()}
                  onStale={() => void readEditReport(activeEdit.id)}
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
      return "Read-only";
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
  canPick,
}: {
  host: StudioHost;
  candidate: SummaryRecord;
  showPixels: boolean;
  enabled: boolean;
  onPick: () => void;
  canPick: boolean;
}) {
  const candidateStatus = recordText(candidate, "status");
  const needsScale = candidateStatus === "needs-scale";
  const report = recordObject(candidate, "report");
  const reportStatus = needsScale
    ? undefined
    : report.status === "pass" || report.status === "fail"
      ? report.status
      : undefined;
  const checks = entries(report.failedChecks)
    .map((check) => text(check))
    .filter(Boolean) as string[];
  const pixels = recordValue(candidate, "pixelsChanged");
  const scale = recordValue(candidate, "scale");
  const merged = recordValue(candidate, "coloursMerged");
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
        {reportStatus && (
          <span className={`state-label state-${reportStatus}`}>
            {reportStatus}
          </span>
        )}
      </div>
      {needsScale && (
        <p className="queue-note">{recordText(candidate, "message")}</p>
      )}
      {showPixels && !needsScale && (
        <CandidatePixels host={host} candidateId={candidate.id} />
      )}
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
          <dt>Pixels changed</dt>
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

  const [configNotice, setConfigNotice] = useState("");
  const chooseConfig = () =>
    chooseConfigGuarded(host, {
      onConfigured: () => dispatch({ type: "configured", configured: true }),
      onNotice: setConfigNotice,
    });

  return (
    <WorkflowView
      state={state}
      host={host}
      dispatch={dispatch}
      onConfigChoose={() => void chooseConfig()}
      notice={configNotice}
      renderPreview={renderPreview}
    />
  );
}

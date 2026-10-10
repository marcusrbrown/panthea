import { HostError, type StudioHost } from "../host/client";
import type {
  CandidateSummary,
  ConformHow,
  ConformParams,
  EditOpened,
  EditReport,
  SummaryRecord,
} from "../host/types";
import { recordText, recordValue } from "./model";

export function parseSlotSpecs(
  source: string,
  kind: "sprite" | "portrait",
): Record<string, string>[] {
  return source
    .split("\n")
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      if (kind === "portrait") return { expression: row };
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

export function slotHint(kind: "sprite" | "portrait"): string {
  return kind === "portrait"
    ? "one expression per line"
    : "one state/direction per line";
}

export function rerollArgs(job: {
  readonly requestId?: string;
  readonly slotKey?: string;
}) {
  if (!job.requestId) return undefined;
  return {
    requestId: job.requestId,
    perSlot: 1,
    ...(job.slotKey === undefined ? {} : { slotKey: job.slotKey }),
  };
}

export function readExistingSheet(
  host: StudioHost,
  workingSetId: string,
  readsEnabled: boolean,
): Promise<unknown> | undefined {
  if (!readsEnabled) return undefined;
  return host.call("sheet", { workingSetId });
}

export function conformJob(
  host: StudioHost,
  jobId: string,
  how: ConformHow,
): Promise<CandidateSummary> {
  return host.conform(jobId, how);
}

export function inlineParamsAtScale(
  params: ConformParams,
  scale: number | undefined,
): ConformHow {
  return { params: scale === undefined ? params : { ...params, scale } };
}

export interface InlineConformDraft {
  readonly backgroundType: "" | "alpha" | "key";
  readonly rgb: string;
  readonly tolerance: string;
  readonly alphaCutoff: string;
  readonly edgeTolerance: string;
  readonly minConfidence: string;
  readonly minEdges: string;
  readonly scale: string;
}

export function parseInlineConformDraft(
  draft: InlineConformDraft,
  scaleRequired = false,
): ConformHow | undefined {
  const alphaCutoff = Number(draft.alphaCutoff);
  const edgeTolerance = Number(draft.edgeTolerance);
  const minConfidence = Number(draft.minConfidence);
  const minEdges = Number(draft.minEdges);
  const scale = draft.scale.trim() === "" ? undefined : Number(draft.scale);

  if (
    !draft.alphaCutoff.trim() ||
    !Number.isInteger(alphaCutoff) ||
    alphaCutoff < 1 ||
    alphaCutoff > 255 ||
    !draft.edgeTolerance.trim() ||
    !Number.isInteger(edgeTolerance) ||
    edgeTolerance < 0 ||
    !draft.minConfidence.trim() ||
    !Number.isFinite(minConfidence) ||
    minConfidence < 0 ||
    minConfidence > 1 ||
    !draft.minEdges.trim() ||
    !Number.isInteger(minEdges) ||
    minEdges <= 0 ||
    (scaleRequired && scale === undefined) ||
    (scale !== undefined && (!Number.isInteger(scale) || scale <= 0))
  ) {
    return undefined;
  }

  let background: ConformParams["background"];
  if (draft.backgroundType === "alpha") {
    background = { type: "alpha" };
  } else if (draft.backgroundType === "key") {
    const rgb = draft.rgb.split(",").map((part) => Number(part.trim()));
    const tolerance = Number(draft.tolerance);
    if (
      rgb.length !== 3 ||
      rgb.some(
        (part, index) =>
          !draft.rgb.split(",")[index]?.trim() ||
          !Number.isInteger(part) ||
          part < 0 ||
          part > 255,
      ) ||
      !draft.tolerance.trim() ||
      !Number.isInteger(tolerance) ||
      tolerance < 0
    ) {
      return undefined;
    }
    background = {
      type: "key",
      rgb: rgb as [number, number, number],
      tolerance,
    };
  } else {
    return undefined;
  }

  return inlineParamsAtScale(
    {
      background,
      alphaCutoff,
      grid: { edgeTolerance, minConfidence, minEdges },
    },
    scale,
  );
}

export function editsForReports(
  edits: readonly SummaryRecord[],
  activeEditId: string | undefined,
): readonly SummaryRecord[] {
  const active = activeEditId
    ? edits.find((edit) => edit.id === activeEditId)
    : undefined;
  return edits.filter(
    (edit) =>
      recordText(edit, "status") === "open" ||
      (edit === active && recordText(edit, "status") === "finished"),
  );
}

export function editReportSignature(edits: readonly SummaryRecord[]): string {
  return JSON.stringify(
    [...edits]
      .map((edit) => [edit.id, recordText(edit, "previewSheetHash") ?? null])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
}

export async function readEditReport(
  host: StudioHost,
  editId: string,
): Promise<EditReport | undefined> {
  try {
    return await host.editReport(editId);
  } catch (error) {
    if (error instanceof HostError && error.code === "wrong-state")
      return undefined;
    throw error;
  }
}

/** What the host said about the editor when it opened an edit. */
export interface EditorSession {
  readonly launched: boolean;
  readonly reason?: string;
  readonly durationsMs: readonly number[];
}

export const editorSessionOf = (opened: EditOpened): EditorSession => ({
  launched: opened.editor.launched,
  ...(opened.editor.reason === undefined
    ? {}
    : { reason: opened.editor.reason }),
  durationsMs: opened.workspace.durationsMs,
});

export interface ReopenHooks {
  /** Whether the effect that asked is still the current one. */
  readonly isLive: () => boolean;
  readonly onSession: (editId: string, session: EditorSession) => void;
  /** The reopen failed: the edit may be reopened again. */
  readonly onForget: () => void;
  readonly onError: (message: string) => void;
}

/**
 * Reopens an open edit that the host does not know this window has opened (after
 * a restart or a reload) to learn whether the editor launched. The answer is
 * recorded by edit id whether or not the effect that asked is still current.
 */
export async function reopenEditor(
  host: StudioHost,
  edit: SummaryRecord,
  hooks: ReopenHooks,
): Promise<void> {
  const workingSetId = recordText(edit, "workingSetId");
  if (!workingSetId) return;
  const raw = recordValue(edit, "slots");
  const slots = (Array.isArray(raw) ? raw : []).filter(
    (slot): slot is string => typeof slot === "string",
  );
  try {
    const opened = await host.editOpen(edit.id, workingSetId, slots);
    hooks.onSession(edit.id, editorSessionOf(opened));
  } catch (error) {
    hooks.onForget();
    if (hooks.isLive())
      hooks.onError(error instanceof Error ? error.message : String(error));
  }
}

/** Tells a reply whether a newer request of the same kind began after its own. */
export interface Latest {
  /** Starts a request; the returned check is false once another has begun. */
  begin(): () => boolean;
}

export function createLatest(): Latest {
  let count = 0;
  return {
    begin() {
      count += 1;
      const mine = count;
      return () => count === mine;
    },
  };
}

/**
 * Resolves a request form. A reply that comes back after the form changed or a
 * newer resolve began is dropped: it describes input the owner no longer has.
 */
export async function resolveFlow<T>(input: {
  readonly latest: Latest;
  readonly isCurrent: () => boolean;
  readonly call: () => Promise<T | undefined>;
  readonly onResolved: (value: T) => void;
  readonly onRefused: () => void;
}): Promise<void> {
  const newest = input.latest.begin();
  const result = await input.call();
  if (!newest() || !input.isCurrent()) return;
  if (result === undefined) input.onRefused();
  else input.onResolved(result);
}

/**
 * Loads a request's sheet, creating its working set first when it has none. A
 * reply that comes back after the owner chose another sheet or set is dropped.
 */
export async function sheetFlow<T>(input: {
  readonly latest: Latest;
  readonly isCurrent: () => boolean;
  /** Creates the working set; `undefined` when there is nothing to create. */
  readonly create?: () => Promise<unknown | undefined>;
  readonly read: () => Promise<T | undefined>;
  readonly onSheet: (sheet: T) => void;
  readonly onError: (message: string) => void;
}): Promise<void> {
  const newest = input.latest.begin();
  const current = () => newest() && input.isCurrent();
  try {
    if (input.create) {
      const created = await input.create();
      if (created === undefined || !current()) return;
    }
    const sheet = await input.read();
    if (sheet === undefined || !current()) return;
    input.onSheet(sheet);
  } catch (error) {
    if (current())
      input.onError(error instanceof Error ? error.message : String(error));
  }
}

export const STALE_REVIEW_MESSAGE =
  "The workspace changed since this report. Review the new version, then finish.";

export type FinishOutcome =
  | { readonly kind: "finished" }
  | { readonly kind: "stale"; readonly message: string };

/**
 * Finishes an edit with the version the owner reviewed. With the editor, the
 * finish names the sheet hash of the report on screen, and the session refuses
 * (`stale-review`) if the workspace was saved again since: that is a plain
 * message, and the caller refreshes the report. Without an editor the owner
 * picks the files to finish with in the same step, so there is no earlier
 * save for them to have missed and no hash to name.
 */
export async function finishReviewedEdit(
  host: StudioHost,
  editId: string,
  report: EditReport,
  editorLaunched: boolean | undefined,
): Promise<FinishOutcome> {
  try {
    if (editorLaunched === false) await host.editImport(editId, true);
    else await host.call("finish", { id: editId, reviewed: report.sheetHash });
    return { kind: "finished" };
  } catch (error) {
    if (error instanceof HostError && error.code === "stale-review")
      return { kind: "stale", message: STALE_REVIEW_MESSAGE };
    throw error;
  }
}

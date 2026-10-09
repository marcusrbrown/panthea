import { HostError, type StudioHost } from "../host/client";
import type {
  CandidateSummary,
  ConformHow,
  ConformParams,
  EditReport,
  SummaryRecord,
} from "../host/types";
import { recordText } from "./model";

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

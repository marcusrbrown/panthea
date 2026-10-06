import {
  type ConformanceResult,
  conformImage,
  type RgbaImage,
} from "../conformance";
import {
  type CandidateRecord,
  type ConformParams,
  paletteColours,
} from "./candidates";
import type { GenerationSpec } from "./request";
import type { StudioStatus } from "./store";
import type { Keyframe, WorkingSetRecord } from "./working-set";

export interface SheetSlot {
  readonly slotKey: string;
  readonly candidates: readonly CandidateRecord[];
  readonly pick: Keyframe | undefined;
}

export interface SheetView {
  readonly workingSet: WorkingSetRecord;
  readonly slots: readonly SheetSlot[];
}

export interface SheetSummary {
  readonly workingSetId: string;
  readonly status: "open" | "complete";
  readonly required: number;
  readonly picked: number;
  readonly slots: readonly {
    readonly slotKey: string;
    readonly candidates: number;
    readonly done: number;
    readonly passing: number;
    readonly needsScale: number;
    readonly picked: boolean;
  }[];
}

const rank = (c: CandidateRecord): number =>
  c.result.status === "needs-scale"
    ? 2
    : c.result.report.status === "pass"
      ? 0
      : 1;

const changed = (c: CandidateRecord): number =>
  c.result.status === "done" ? c.result.metrics.pixelsChanged : 0;

/** Passing candidates, then failing, then those that need a scale; fewest pixels changed, then ordinal, then id. */
export const sortSheet = (
  candidates: readonly CandidateRecord[],
): CandidateRecord[] =>
  [...candidates].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      changed(a) - changed(b) ||
      a.source.ordinal - b.source.ordinal ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

/** The working set's slots with the current sheet's candidates; picks from earlier sheets stay visible. */
export function sheet(
  status: Pick<StudioStatus, "candidates" | "workingSets">,
  workingSetId: string,
): SheetView | undefined {
  const workingSet = status.workingSets.find((w) => w.id === workingSetId);
  if (workingSet === undefined) return undefined;
  return {
    workingSet,
    slots: workingSet.required.map((slotKey) => ({
      slotKey,
      candidates: sortSheet(
        status.candidates.filter(
          (c) =>
            c.source.requestId === workingSet.sheetRequestId &&
            c.source.slotKey === slotKey,
        ),
      ),
      pick: workingSet.picks[slotKey],
    })),
  };
}

export function summarizeSheet(view: SheetView): SheetSummary {
  return {
    workingSetId: view.workingSet.id,
    status: view.workingSet.status,
    required: view.slots.length,
    picked: view.slots.filter((slot) => slot.pick !== undefined).length,
    slots: view.slots.map((slot) => ({
      slotKey: slot.slotKey,
      candidates: slot.candidates.length,
      done: slot.candidates.filter((c) => c.result.status === "done").length,
      passing: slot.candidates.filter(
        (c) => c.result.status === "done" && c.result.report.status === "pass",
      ).length,
      needsScale: slot.candidates.filter(
        (c) => c.result.status === "needs-scale",
      ).length,
      picked: slot.pick !== undefined,
    })),
  };
}

/** Evaluates an image as it is, against the subject's target: the raw pixels come back unchanged and nothing is stored. */
export function reportOnly(
  image: RgbaImage,
  spec: GenerationSpec,
  params: ConformParams,
): ConformanceResult {
  return conformImage({
    rgba: image.rgba,
    width: image.width,
    height: image.height,
    kind: spec.kind,
    mode: "report-only",
    cell: { w: spec.cell.w, h: spec.cell.h },
    ...(spec.pivot === undefined ? {} : { pivot: spec.pivot }),
    paletteRgb: paletteColours(spec),
    background: params.background,
    alphaCutoff: params.alphaCutoff,
    grid: params.grid,
    ...(params.scale === undefined ? {} : { scale: params.scale }),
  });
}

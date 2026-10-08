import type { ConformanceReport, Sha256 } from "@panthea/contracts";
import {
  type ConformanceResult,
  conformImage,
  type PixelDiff,
  type RgbaImage,
} from "../conformance";
import { sha256Hex } from "../hash";
import {
  type CandidateParams,
  type CandidateRecord,
  type ConformParams,
  paletteColours,
} from "./candidates";
import { decodePng } from "./png/decode";
import { buildSpec, type GenerationSpec, type StudioContent } from "./request";
import { openStore, type StudioStatus } from "./store";
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

export type SlotConformanceFailure =
  | "not-found"
  | "corrupt-blob"
  | "corrupt-png"
  | "unsupported-png"
  | "invalid";

export type SlotConformance =
  | {
      readonly ok: true;
      readonly source: "hand" | "pick";
      readonly frames: readonly {
        readonly index: number;
        readonly report: ConformanceReport;
        readonly diff: readonly PixelDiff[];
      }[];
    }
  | {
      readonly ok: false;
      readonly reason: SlotConformanceFailure;
      readonly message: string;
    };

/**
 * A fresh report-only conformance of one slot's stored pixels against the
 * current content: the hand-finished frames, or else the picked native image,
 * with the conformance settings stored beside them and the family colours of
 * `content.palette`. It reads the durable records without the writer lock and
 * writes nothing, so a changed palette shows up here and a stored report never
 * stands in for it.
 */
export function slotConformance(
  root: string,
  workingSetId: string,
  slot: string,
  content: StudioContent,
): SlotConformance {
  const failure = (
    reason: SlotConformanceFailure,
    message: string,
  ): SlotConformance => ({ ok: false, reason, message });
  const store = openStore(root);
  const status = store.status();
  const set = status.workingSets.find((w) => w.id === workingSetId);
  if (set === undefined)
    return failure("not-found", `no working set ${workingSetId}`);
  if (!set.required.includes(slot))
    return failure(
      "not-found",
      `working set ${workingSetId} has no slot ${slot}`,
    );
  const request = status.requests.find((r) => r.id === set.sheetRequestId);
  if (request === undefined)
    return failure(
      "invalid",
      `the sheet request ${set.sheetRequestId} is missing`,
    );
  const built = buildSpec(content, request.request);
  if (!built.ok)
    return failure(
      "invalid",
      `the generation spec cannot be built: ${built.error.kind}`,
    );

  const authored = set.frames[slot];
  const pick = set.picks[slot];
  let source: "hand" | "pick";
  let hashes: readonly Sha256[];
  let params: CandidateParams | undefined;
  let pivot = built.value.pivot;
  if (authored !== undefined) {
    source = "hand";
    hashes = authored.frames.map((f) => f.hash);
    params = status.edits.find((e) => e.id === authored.editId)?.evidence[slot]
      ?.params;
    if (authored.pivot !== null) pivot = authored.pivot;
  } else if (pick !== undefined) {
    source = "pick";
    hashes = [pick.imageHash];
    params = pick.params;
  } else return failure("not-found", `${slot} has no stored frames`);
  if (params === undefined)
    return failure("not-found", `${slot} has no stored conformance settings`);

  const spec: GenerationSpec = {
    ...built.value,
    ...(pivot === undefined ? {} : { pivot }),
  };
  const frames: {
    index: number;
    report: ConformanceReport;
    diff: PixelDiff[];
  }[] = [];
  for (const [index, hash] of hashes.entries()) {
    const bytes = store.readBlob(hash);
    if (bytes === undefined || sha256Hex(bytes) !== hash)
      return failure(
        "corrupt-blob",
        `frame ${index} of ${slot} is missing or does not match its hash`,
      );
    const decoded = decodePng(bytes);
    if (!decoded.ok)
      return failure(
        decoded.code,
        `frame ${index} of ${slot} cannot be decoded`,
      );
    const { width, height } = decoded.image;
    if (width !== spec.cell.w || height !== spec.cell.h)
      return failure(
        "invalid",
        `frame ${index} of ${slot} is ${width}x${height}, not the ${spec.cell.w}x${spec.cell.h} cell`,
      );
    const result = reportOnly(decoded.image, spec, {
      background: params.background,
      alphaCutoff: params.alphaCutoff,
      grid: params.grid,
      scale: 1,
    });
    if (result.status !== "done")
      return failure(
        "invalid",
        `frame ${index} of ${slot} cannot be reported on`,
      );
    frames.push({ index, report: result.report, diff: [...result.diff] });
  }
  return { ok: true, source, frames };
}

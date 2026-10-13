import { MAX_SEED } from "@panthea/assets/browser";
import { FOOTPRINT_MAX } from "@panthea/renderer";
import type { Dispatch } from "react";
import { HostError, type StudioHost, type StudioOp } from "../host/client";
import type {
  CandidateSummary,
  ConformHow,
  ConformParams,
  EditBrought,
  EditExport,
  EditOpened,
  EditReport,
  FinishStepInput,
  SummaryRecord,
} from "../host/types";
import {
  canRelease,
  recordObject,
  recordText,
  recordValue,
  refusedByLock,
  type WorkflowAction,
  type WorkflowState,
} from "./model";

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

/** The example lines the slot hint shows. Each parses, and a test keeps it so. */
export const SLOT_EXAMPLES = {
  sprite: ["idle/south", "walk/east", "act/south/thunderbolt"],
  portrait: ["neutral", "angry"],
} as const;

export function slotHint(kind: "sprite" | "portrait"): string {
  return kind === "portrait"
    ? `one expression name per line, for example ${SLOT_EXAMPLES.portrait.join(", ")}`
    : `state/direction[/ability] per line, for example ${SLOT_EXAMPLES.sprite.join(", ")} (act needs an ability)`;
}

/**
 * What is wrong with the first bad slot line, in words, or undefined when the
 * lines are well formed. Whether a state, direction, ability or expression
 * exists is the host's to say; this catches the shapes that parse into
 * something other than what was typed (`act//thunderbolt` would otherwise lose
 * its direction without a word).
 */
export function slotProblem(
  source: string,
  kind: "sprite" | "portrait",
): string | undefined {
  for (const row of source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)) {
    if (kind === "portrait") {
      if (row.includes("/"))
        return `Slot "${row}": a portrait slot is one expression name, not state/direction. Write one expression name per line, for example neutral.`;
      continue;
    }
    const [state = "", direction, ability] = row
      .split("/")
      .map((part) => part.trim());
    const shape =
      state === "act"
        ? "state/direction/ability, for example act/south/thunderbolt"
        : "state/direction, for example idle/south";
    if (state === "")
      return `Slot "${row}": the state is empty. Write ${shape}.`;
    if (direction === undefined)
      return `Slot "${row}": ${state} needs a direction. Write ${shape}.`;
    if (direction === "")
      return `Slot "${row}": the direction is empty. Write ${shape}.`;
    if (ability === "")
      return `Slot "${row}": the ability is empty. Write ${shape}, or drop the last slash.`;
    if (state === "act" && ability === undefined)
      return `Slot "${row}": act needs an ability. Write act/${direction}/thunderbolt.`;
  }
  return undefined;
}

export { MAX_SEED };

export type BaseSeed =
  | { readonly ok: true; readonly seed: number | undefined }
  | { readonly ok: false; readonly message: string };

const jobs = (count: number) => `${count} job${count === 1 ? "" : "s"}`;

/**
 * Reads the base-seed field. Empty means a seed is drawn; anything else is
 * ASCII digits only, with no sign, fraction, exponent, space or other digits.
 * Jobs take the base seed plus their ordinals 0..jobCount-1, and the last of
 * them must still be at most 2^32-1, so a bad seed is refused here, before any
 * record is written.
 */
export function parseBaseSeed(text: string, jobCount: number): BaseSeed {
  if (text === "") return { ok: true, seed: undefined };
  if (!/^\d+$/.test(text))
    return {
      ok: false,
      message: `The base seed is whole digits only, from 0 to ${MAX_SEED}.`,
    };
  const count = Math.max(1, jobCount);
  const last = BigInt(count - 1);
  const base = BigInt(text);
  if (base + last > BigInt(MAX_SEED))
    return {
      ok: false,
      message: `The last job's seed would be ${base + last}, past ${MAX_SEED}. Use a base seed of at most ${BigInt(MAX_SEED) - last} for ${jobs(count)}.`,
    };
  return { ok: true, seed: Number(base) };
}

/** A seed the resolve step drew is held to the same range; undefined when it is fine. */
export function checkResolvedSeed(
  seed: unknown,
  jobCount: number,
): string | undefined {
  if (typeof seed !== "number" || !Number.isSafeInteger(seed) || seed < 0)
    return "The resolve step returned no seed. Resolve again.";
  const count = Math.max(1, jobCount);
  if (seed + count - 1 > MAX_SEED)
    return `The drawn seed ${seed} is too high for ${jobs(count)}: the last would pass ${MAX_SEED}. Resolve again.`;
  return undefined;
}

/** The number of jobs a request makes: one per slot, `batch` of each. */
export function requestJobCount(
  slots: string,
  kind: "sprite" | "portrait",
  batch: number,
): number {
  return (
    parseSlotSpecs(slots, kind).length *
    Math.max(1, Math.floor(Number.isFinite(batch) ? batch : 1))
  );
}

/** The recipe request's own fields: the palette and the declared pivot, as typed. The render profile comes from the subject. */
export interface RecipeForm {
  readonly palette: string;
  readonly pivotX: string;
  readonly pivotY: string;
}

export interface RequestForm {
  readonly subject: string;
  readonly kind: string;
  readonly slots: string;
  readonly batch: number;
  readonly styleNote: string;
  readonly seed: string;
  readonly recipe?: RecipeForm;
}

/** What the request form said, as one string: a resolve is only for the form it was sent from. */
export function requestSignature(form: RequestForm): string {
  const fields = [
    form.subject,
    form.kind,
    form.slots,
    form.batch,
    form.styleNote,
    form.seed,
  ];
  return JSON.stringify(
    form.recipe === undefined
      ? fields
      : [
          ...fields,
          form.recipe.palette,
          form.recipe.pivotX,
          form.recipe.pivotY,
        ],
  );
}

/** Generate is ready only while the form still says what the resolve was made from. */
export function generateReady(
  resolvedFrom: string | undefined,
  current: string,
): boolean {
  return resolvedFrom !== undefined && resolvedFrom === current;
}

/**
 * Handlers that keep their identity for the life of the window while always
 * calling the latest implementation, so a memoized row is not rendered again
 * because the window was.
 */
export function createStableHandlers<
  T extends Record<string, (...args: never[]) => unknown>,
>(latest: { readonly current: T }): T {
  const stable: Record<string, unknown> = {};
  for (const key of Object.keys(latest.current))
    stable[key] = (...args: unknown[]) =>
      (latest.current[key] as (...inner: unknown[]) => unknown)(...args);
  return stable as T;
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

export interface PackDraftInput {
  readonly selectedSet: SummaryRecord;
  readonly assets: readonly { readonly id: string }[];
  readonly assetId: string;
  readonly styleTag: string;
  readonly footprintWidth: string;
  readonly footprintHeight: string;
  readonly originalWorkLicence: string;
  readonly originalWorkAttribution: string;
  readonly stillFrameMs?: string;
}

export interface PackDraftArgs {
  readonly id: string;
  readonly workingSetId: string;
  readonly assetId: string;
  readonly styleTag: string;
  readonly footprint?: { readonly w: number; readonly h: number };
  readonly stillFrameMs?: number;
  readonly originalWork?: {
    readonly licence: string;
    readonly attribution?: string;
  };
}

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function packNeedsOriginalWork(selectedSet: SummaryRecord): boolean {
  return Object.keys(recordObject(selectedSet, "authored")).length > 0;
}

/** Picked portrait candidates are still frames; authored expressions already carry their own timing. */
export function packNeedsStillFrameMs(selectedSet: SummaryRecord): boolean {
  if (recordText(selectedSet, "kind") !== "portrait") return false;
  const picks = recordObject(selectedSet, "picks");
  const authored = recordObject(selectedSet, "authored");
  return Object.keys(picks).some((slot) => !Object.hasOwn(authored, slot));
}

/** The slots that currently have a picked or authored image to open in Aseprite. */
export function editableSlotsForSet(workingSet: SummaryRecord): string[] {
  const rawRequired = recordValue(workingSet, "required");
  const required = Array.isArray(rawRequired)
    ? rawRequired.filter((slot): slot is string => typeof slot === "string")
    : [];
  const available = new Set([
    ...Object.keys(recordObject(workingSet, "picks")),
    ...Object.keys(recordObject(workingSet, "authored")),
    ...Object.keys(recordObject(workingSet, "frames")),
  ]);
  const slots = required.length > 0 ? required : [...available];
  return slots.filter((slot) => available.has(slot));
}

/** Resolve an open edit to its own set, never to the set currently selected in the UI. */
export function editOpenTarget(
  edit: SummaryRecord,
  workingSets: readonly SummaryRecord[],
):
  | {
      readonly editId: string;
      readonly workingSetId: string;
      readonly slots: string[];
    }
  | undefined {
  if (recordText(edit, "status") !== "open") return undefined;
  const workingSetId = recordText(edit, "workingSetId");
  const slotsValue = recordValue(edit, "slots");
  const slots = Array.isArray(slotsValue)
    ? slotsValue.filter((slot): slot is string => typeof slot === "string")
    : [];
  if (
    !workingSetId ||
    !workingSets.some((set) => set.id === workingSetId) ||
    slots.length === 0
  )
    return undefined;
  return { editId: edit.id, workingSetId, slots };
}

/** Relaunch an existing edit through its own working set and original slots. */
export function reopenWorkingSetEdit(
  host: StudioHost,
  edit: SummaryRecord,
  workingSets: readonly SummaryRecord[],
): Promise<EditOpened> | undefined {
  const target = editOpenTarget(edit, workingSets);
  if (!target) return undefined;
  return host.editOpen(target.editId, target.workingSetId, target.slots);
}

export function detailText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** The window state a guarded action reads and writes. */
export interface GuardUi {
  /** Whether the window may run this action now (configured, unlocked, running). */
  readonly allowed: () => boolean;
  readonly setBusy: (busy: boolean) => void;
  readonly setMessage: (message: string) => void;
  readonly setRefusalDetails: (details: string) => void;
}

/**
 * The one place a host action's refusal is handled: the window shows the
 * refusal's message and details, and the pending state always ends. A blocking
 * action holds the window busy while it runs; a non-blocking one does not.
 * Answers `undefined` when the action was refused or was not allowed to run.
 */
export async function guardedAction<T>(
  ui: GuardUi,
  options: { readonly label: string; readonly nonBlocking?: boolean },
  act: () => Promise<T>,
): Promise<T | undefined> {
  if (!ui.allowed()) return undefined;
  if (!options.nonBlocking) ui.setBusy(true);
  ui.setMessage("");
  ui.setRefusalDetails("");
  try {
    const result = await act();
    ui.setMessage(`${options.label} complete`);
    return result;
  } catch (error) {
    ui.setMessage(error instanceof Error ? error.message : String(error));
    const detail =
      typeof error === "object" && error !== null
        ? (error as { detail?: unknown }).detail
        : undefined;
    if (detail !== undefined) ui.setRefusalDetails(detailText(detail));
    return undefined;
  } finally {
    if (!options.nonBlocking) ui.setBusy(false);
  }
}

/** The click handler behind a candidate's Pick button. */
export async function pickCandidateGuarded(
  host: StudioHost,
  ui: GuardUi,
  workingSetId: string,
  candidate: SummaryRecord,
): Promise<unknown> {
  const slot =
    recordText(candidate, "slot") ?? recordText(candidate, "slotKey");
  if (!slot) return undefined;
  return guardedAction(ui, { label: "pick" }, () =>
    host.call("pick", { workingSetId, candidateId: candidate.id, slot }),
  );
}

/** The realm palette families a swap can target: the greek-master palette's three. */
export const REALM_FAMILIES = ["town", "olympus", "underworld"] as const;

/** The states whose west cell is their east cell flipped. Walk and act are drawn per direction. */
const MIRRORABLE_STATES = ["idle", "seated", "hurt", "down"];

export interface DeriveArgs {
  readonly asset: string;
  readonly op: "mirror" | "palette-swap" | "bob";
  readonly from: string;
  readonly to?: string;
}

export interface DeriveChoice {
  readonly key: string;
  readonly label: string;
  readonly args: DeriveArgs;
}

/** Keep a derivation choice tied to the record it was selected for. */
export function activeDeriveChoiceKey(
  choices: readonly DeriveChoice[],
  selection: { readonly recordId: string; readonly key: string },
  recordId: string,
): string {
  return selection.recordId === recordId &&
    choices.some((choice) => choice.key === selection.key)
    ? selection.key
    : (choices[0]?.key ?? "");
}

/**
 * What can be derived from a published sprite, in plain words. A mirror is
 * offered for an east slot of idle, seated, hurt or down with no west yet; a
 * bob only for an idle slot; a palette swap for each realm other than the
 * asset's own. Nothing is offered for a portrait or a record that is not
 * published.
 */
export function deriveChoices(asset: SummaryRecord): DeriveChoice[] {
  if (recordText(asset, "state") !== "canon") return [];
  if (recordText(asset, "kind") !== "sprite") return [];
  const id = recordText(asset, "assetId");
  if (id === undefined) return [];
  const rawSlots = recordValue(asset, "slots");
  const slots = Array.isArray(rawSlots)
    ? rawSlots.filter((slot): slot is string => typeof slot === "string")
    : [];
  const choices: DeriveChoice[] = [];
  for (const slot of slots) {
    const [state = "", direction = ""] = slot.split("/");
    if (
      MIRRORABLE_STATES.includes(state) &&
      direction === "east" &&
      !slots.includes(`${state}/west`)
    )
      choices.push({
        key: `mirror:${slot}`,
        label: `Mirror ${slot} to ${state}/west`,
        args: { asset: id, op: "mirror", from: slot },
      });
    if (state === "idle")
      choices.push({
        key: `bob:${slot}`,
        label: `Bob ${slot} (rebuild the idle loop from its rest frame)`,
        args: { asset: id, op: "bob", from: slot },
      });
  }
  const own = recordText(asset, "paletteFamily");
  if (own !== undefined)
    for (const family of REALM_FAMILIES)
      if (family !== own)
        choices.push({
          key: `palette-swap:${family}`,
          label: `Palette swap to ${family}`,
          args: { asset: id, op: "palette-swap", from: own, to: family },
        });
  return choices;
}

/** What a derive replied: the working set it made (or already had) and its slots or realm. */
export interface DeriveReply {
  readonly workingSetId: string;
  readonly created: boolean;
  readonly slots: readonly string[];
}

export function readDeriveReply(value: unknown): DeriveReply | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { workingSetId, created, slots } = value as Record<string, unknown>;
  if (
    typeof workingSetId !== "string" ||
    typeof created !== "boolean" ||
    !Array.isArray(slots)
  )
    return undefined;
  return {
    workingSetId,
    created,
    slots: slots.filter((slot): slot is string => typeof slot === "string"),
  };
}

/** The click handler behind Derive: a refusal (asymmetric, non-derivable, ...) is shown as the window's message. */
export function deriveGuarded(
  host: StudioHost,
  ui: GuardUi,
  args: DeriveArgs,
  onDerived?: (reply: DeriveReply) => void,
): Promise<unknown> {
  return guardedAction(ui, { label: "derive" }, () =>
    host.call("derive", { ...args }),
  ).then((result) => {
    const reply = readDeriveReply(result);
    if (reply !== undefined) {
      onDerived?.(reply);
      ui.setMessage(
        reply.created
          ? `Derived ${reply.slots.join(", ")} into working set ${reply.workingSetId}. Pack it to review the result.`
          : `Working set ${reply.workingSetId} already holds this derivation. Pack it to review the result.`,
      );
    }
    return result;
  });
}

/** The click handler behind Pack draft. */
export function packWorkingSetGuarded(
  host: StudioHost,
  ui: GuardUi,
  args: PackDraftArgs,
  onPacked?: (recordId: string) => void,
): Promise<unknown> {
  return guardedAction(ui, { label: "pack" }, () =>
    packWorkingSet(host, args),
  ).then((result) => {
    const recordId =
      typeof result === "object" &&
      result !== null &&
      typeof (result as { id?: unknown }).id === "string"
        ? (result as { id: string }).id
        : undefined;
    if (recordId !== undefined) {
      onPacked?.(recordId);
      ui.setMessage(
        `Packed draft ${recordId} for ${args.assetId}. Review it, then approve.`,
      );
    }
    return result;
  });
}

/** The action behind the candidate's Pick button. */
export function pickCandidateForSet(
  host: StudioHost,
  workingSetId: string,
  candidate: SummaryRecord,
): Promise<unknown> | undefined {
  const slot =
    recordText(candidate, "slot") ?? recordText(candidate, "slotKey");
  if (!slot) return undefined;
  return host.call("pick", {
    workingSetId,
    candidateId: candidate.id,
    slot,
  });
}

/** The action behind Open editor for a set or Edit draft for one of its records. */
export function openWorkingSetEdit(
  host: StudioHost,
  workingSet: SummaryRecord,
  editId: string,
  requestedSlots = editableSlotsForSet(workingSet),
): Promise<EditOpened> {
  return host.editOpen(editId, workingSet.id, requestedSlots);
}

export function exportEditFallback(
  host: StudioHost,
  editId: string,
): Promise<EditExport> {
  return host.editExport(editId);
}

export function importEditFallback(
  host: StudioHost,
  editId: string,
): Promise<EditBrought> {
  return host.editImport(editId, false);
}

/** The action behind Pack draft; arguments are built from the visible form first. */
export function packWorkingSet(
  host: StudioHost,
  args: PackDraftArgs,
): Promise<unknown> {
  return host.call("pack", { ...args });
}

export function buildPackArgs(
  input: PackDraftInput,
): PackDraftArgs | undefined {
  const assetId = slug(input.assetId);
  const styleTag = slug(input.styleTag);
  if (
    assetId === "" ||
    assetId.length > 128 ||
    styleTag === "" ||
    styleTag.length > 128
  )
    return undefined;

  const kind = recordText(input.selectedSet, "kind");
  if (kind !== "sprite" && kind !== "portrait") return undefined;

  let footprint: PackDraftArgs["footprint"];
  if (kind === "sprite") {
    const w = Number(input.footprintWidth);
    const h = Number(input.footprintHeight);
    if (
      input.footprintWidth.trim() === "" ||
      input.footprintHeight.trim() === "" ||
      !Number.isInteger(w) ||
      !Number.isInteger(h) ||
      w < 1 ||
      h < 1 ||
      w > FOOTPRINT_MAX ||
      h > FOOTPRINT_MAX
    )
      return undefined;
    footprint = { w, h };
  }

  let originalWork: PackDraftArgs["originalWork"];
  if (packNeedsOriginalWork(input.selectedSet)) {
    const licence = input.originalWorkLicence.trim();
    const attribution = input.originalWorkAttribution.trim();
    if (licence === "") return undefined;
    originalWork = {
      licence,
      ...(attribution === "" ? {} : { attribution }),
    };
  }

  let stillFrameMs: PackDraftArgs["stillFrameMs"];
  if (packNeedsStillFrameMs(input.selectedSet)) {
    const value = Number(input.stillFrameMs);
    if (
      input.stillFrameMs === undefined ||
      input.stillFrameMs.trim() === "" ||
      !Number.isSafeInteger(value) ||
      value < 1
    )
      return undefined;
    stillFrameMs = value;
  }

  const nextRecordId = (base: string) => {
    const existing = new Set(input.assets.map((asset) => asset.id));
    let revision = 1;
    while (existing.has(`record-${base}-${revision}`)) revision += 1;
    return `record-${base}-${revision}`;
  };
  const id = nextRecordId(assetId);
  if (id.length > 128) return undefined;

  return {
    id,
    workingSetId: input.selectedSet.id,
    assetId,
    styleTag,
    ...(footprint === undefined ? {} : { footprint }),
    ...(originalWork === undefined ? {} : { originalWork }),
    ...(stillFrameMs === undefined ? {} : { stillFrameMs }),
  };
}

export function routePreviewSelection(selection: {
  readonly source: "canon" | "draft" | "approved";
  readonly id: string;
  readonly kind: "portrait" | "sprite";
}): Record<string, string> {
  const key = `${selection.source}:${selection.id}`;
  return selection.kind === "portrait"
    ? { source: selection.source, portraitKey: key }
    : { source: selection.source, subjectKey: key };
}

/** What the preview is asked to draw for the record selected in the asset list. */
export interface AssetPreview {
  readonly source: "canon" | "draft" | "approved";
  /**
   * Canon is keyed by asset id; drafts and approved records by record id. A
   * superseded canon record is named by its own record id, which no canon entry
   * is listed under.
   */
  readonly id: string;
  /** Set when the selected record is a canon revision a later one replaced: the preview has nothing of its own to draw for it. */
  readonly supersededBy?: string;
}

/**
 * The preview selection for an asset record. The preview source keys drafts and
 * approved records by record id and canon by asset id, and holds only the
 * current canon revision of an asset: asking for the asset id of a draft would
 * draw another record, and so would asking for the asset id of a canon revision
 * that a later one replaced (the preview would show the later record's pixels
 * under the earlier one's name).
 */
export function previewForAsset(
  asset: SummaryRecord,
  assets: readonly SummaryRecord[],
): AssetPreview {
  const state = recordText(asset, "state");
  if (state === "approved" || state === "draft")
    return { source: state, id: asset.id };
  const assetId = recordText(asset, "assetId") ?? asset.id;
  const published = recordText(asset, "published");
  const successor =
    published === undefined
      ? undefined
      : assets.find(
          (other) =>
            other.id !== asset.id &&
            recordText(other, "state") === "canon" &&
            (recordText(other, "assetId") ?? other.id) === assetId &&
            recordText(other, "prior") === published,
        );
  return successor === undefined
    ? { source: "canon", id: assetId }
    : { source: "canon", id: asset.id, supersededBy: successor.id };
}

export function approvalArgsForAsset(
  asset: SummaryRecord,
): { readonly id: string; readonly confirm: string } | undefined {
  const revision = recordText(asset, "manifestRevision");
  return revision === undefined
    ? undefined
    : { id: asset.id, confirm: revision };
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
  | { readonly kind: "cancelled" }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "stale"; readonly message: string };

export const SCRIPTED_NEEDS_REVIEW_MESSAGE =
  "A scripted finish needs the saved version you reviewed. Save in the editor, review the report, then finish.";

export type BuiltStep =
  | { readonly ok: true; readonly step: FinishStepInput | undefined }
  | { readonly ok: false; readonly message: string };

/** The step the Scripted toggle and its description make: none when off; when on, words that will be published. */
export function buildFinishStep(
  scripted: boolean,
  description: string,
): BuiltStep {
  if (!scripted) return { ok: true, step: undefined };
  const words = description.trim();
  if (words === "")
    return {
      ok: false,
      message:
        "Say what ran: a scripted finish is recorded with this description, and it is published with the asset.",
    };
  return { ok: true, step: { method: "script", description: words } };
}

export function finishOutcomeMessage(
  outcome: FinishOutcome,
): string | undefined {
  return outcome.kind === "finished"
    ? "Edit finished. The reviewed pixels were kept."
    : undefined;
}

/**
 * Finishes an edit with the version the owner reviewed. With the editor, the
 * finish names the sheet hash of the report on screen, and the session refuses
 * (`stale-review`) if the workspace was saved again since: that is a plain
 * message, and the caller refreshes the report. Without an editor the owner
 * picks the files to finish with in the same step; the finish names the same
 * hash, so the session refuses (`stale-review`) files that are not the sheet
 * the report on screen was made from.
 */
export async function finishReviewedEdit(
  host: StudioHost,
  editId: string,
  report: EditReport,
  editorLaunched: boolean | undefined,
  step?: FinishStepInput,
): Promise<FinishOutcome> {
  // A script's description is published, so a scripted finish only goes ahead
  // for a version that was reviewed: the report on screen must name its hash.
  if (step !== undefined && !/^[0-9a-f]{64}$/.test(report.sheetHash))
    return { kind: "refused", message: SCRIPTED_NEEDS_REVIEW_MESSAGE };
  try {
    if (editorLaunched === false) {
      const imported = await host.editImport(
        editId,
        true,
        step,
        report.sheetHash,
      );
      if (imported.cancelled) return { kind: "cancelled" };
    } else
      await host.call("finish", {
        id: editId,
        reviewed: report.sheetHash,
        ...(step === undefined
          ? {}
          : { method: step.method, description: step.description }),
      });
    return { kind: "finished" };
  } catch (error) {
    if (error instanceof HostError && error.code === "stale-review")
      return { kind: "stale", message: STALE_REVIEW_MESSAGE };
    throw error;
  }
}

/**
 * Picks a config through the host. A refusal (a file that is not a usable
 * config) is shown through `onNotice`; a new pick clears the last notice. The
 * host's snapshot describes the launch that follows a good pick.
 */
export async function chooseConfigGuarded(
  host: StudioHost,
  hooks: {
    readonly onConfigured: () => void;
    readonly onNotice: (message: string) => void;
  },
): Promise<void> {
  hooks.onNotice("");
  try {
    const result = await host.configChoose();
    if (!result.cancelled && result.configured) hooks.onConfigured();
  } catch (error) {
    hooks.onNotice(error instanceof Error ? error.message : String(error));
  }
}

/** The host's name for a lowercase, dash-separated subject. */
export const subjectSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export interface GenerateForm {
  readonly subject: string;
  readonly kind: "sprite" | "portrait";
  readonly slots: string;
  readonly batch: number;
  readonly styleNote: string;
  readonly seedText: string;
  /** Set for a recipe request to the render engine; batch, seed and style note are then not sent. */
  readonly recipe?: RecipeForm;
}

/** The subjects the host says have a render profile (its `status` lists them), as slugs. */
export function renderSubjectsOf(status: unknown): readonly string[] {
  const listed =
    typeof status === "object" && status !== null
      ? (status as { renderSubjects?: unknown }).renderSubjects
      : undefined;
  return Array.isArray(listed)
    ? listed.filter((id): id is string => typeof id === "string")
    : [];
}

/**
 * The arguments of a resolve and a generate, from the form. Bad input throws
 * here, with the words to show, before the host is called and before any record
 * is written: no slot, a slot that parses into something other than what was
 * typed, a seed that is not digits, or one whose last job would pass the
 * ceiling.
 */
export function buildRequestArgs(
  form: GenerateForm,
  id: string,
): Record<string, unknown> {
  const parsedSlots = parseSlotSpecs(form.slots, form.kind);
  if (!subjectSlug(form.subject) || parsedSlots.length === 0)
    throw new Error("Enter a subject and at least one slot.");
  const problem = slotProblem(form.slots, form.kind);
  if (problem !== undefined) throw new Error(problem);
  if (form.recipe !== undefined) {
    if (form.kind !== "sprite") throw new Error("Only a sprite is rendered.");
    const palette = form.recipe.palette.trim();
    const [x, y] = [form.recipe.pivotX, form.recipe.pivotY].map((text) =>
      /^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN,
    );
    if (!palette) throw new Error("Enter the palette id for the render.");
    if (!Number.isInteger(x) || !Number.isInteger(y))
      throw new Error("The pivot is two whole numbers, x and y.");
    // A recipe request renders each slot once at the fixed seed: no batch, seed or style note.
    return {
      id,
      subject: subjectSlug(form.subject),
      kind: form.kind,
      slots: parsedSlots,
      palette,
      pivot: { x, y },
    };
  }
  const baseSeed = parseBaseSeed(
    form.seedText,
    requestJobCount(form.slots, form.kind, form.batch),
  );
  if (!baseSeed.ok) throw new Error(baseSeed.message);
  const args: Record<string, unknown> = {
    id,
    subject: subjectSlug(form.subject),
    kind: form.kind,
    slots: parsedSlots,
    batch: Math.max(1, Math.floor(form.batch)),
  };
  if (baseSeed.seed !== undefined) args.seed = baseSeed.seed;
  if (form.styleNote.trim()) args.styleNote = form.styleNote.trim();
  return args;
}

export type ReleaseOutcome =
  | { readonly kind: "released"; readonly message: string }
  | { readonly kind: "refused" }
  | { readonly kind: "skipped" };

/**
 * The Release button: sends `release` with no arguments, and only while the
 * window says the app holds the lock and is idle. The host decides again and
 * refuses `not-idle` if it is not; that refusal reaches the caller.
 */
export async function releaseWriterLock(
  state: WorkflowState,
  call: (op: "release", args: Record<string, never>) => Promise<unknown>,
): Promise<ReleaseOutcome> {
  if (!canRelease(state)) return { kind: "skipped" };
  const result = await call("release", {});
  return result === undefined
    ? { kind: "refused" }
    : { kind: "released", message: "Released the writer lock." };
}

/**
 * A host call that keeps track of the lock. A write another process's lock
 * refused is remembered with its op and arguments (the form is left as it is);
 * a write that succeeds while one is remembered clears it.
 */
export async function callTrackingLock(
  host: StudioHost,
  op: StudioOp,
  args: Record<string, unknown>,
  track: {
    readonly readOnly: boolean;
    readonly lockedWritePending: boolean;
    readonly dispatch: Dispatch<WorkflowAction> | undefined;
  },
): Promise<unknown> {
  try {
    const result = await host.call(op, args);
    if (!track.readOnly && track.lockedWritePending)
      track.dispatch?.({ type: "write-unlocked" });
    return result;
  } catch (error) {
    if (!track.readOnly && op !== "release" && refusedByLock(error))
      track.dispatch?.({ type: "write-locked", op, args });
    throw error;
  }
}

/**
 * Sends the write the lock refused again, identically: the same op and a copy
 * of the same arguments. A generate goes back through the form's own handler so
 * it ends the way a first try does.
 */
export async function retryLockedWrite(
  refused: WorkflowState["lockedWrite"],
  handlers: {
    readonly call: (
      op: StudioOp,
      args: Record<string, unknown>,
    ) => Promise<unknown>;
    readonly generate: () => Promise<void>;
  },
): Promise<void> {
  if (refused === undefined) return;
  if (refused.op === "generate") await handlers.generate();
  else await handlers.call(refused.op, { ...refused.args });
}

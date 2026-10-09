import type { Sha256 } from "@panthea/contracts";
import { parseSlug } from "@panthea/contracts";
import type { RgbaImage } from "../conformance";
import { sha256Hex } from "../hash";
import {
  applyFinish,
  baseFrameRefs,
  buildPreview,
  checkFinishStep,
  type EditEvidence,
  type EditRecord,
  type FinishStep,
  handStepOf,
  metadataHash,
  parseSheetJson,
  placeholderMs,
  type SheetMeta,
  type SlotSignature,
  sameSignature,
  sheetSignature,
  startSheet,
} from "./export-import";
import { decodePng } from "./png/decode";
import type { StudioContent } from "./request";
import type { CommandType, Store } from "./store";
import {
  type FrameRef,
  type SlotBasis,
  slotBasisOf,
  type WorkingSetRecord,
} from "./working-set";

export type EditFailure =
  | "closed"
  | "not-found"
  | "wrong-state"
  | "write-failed"
  | "invalid-params"
  | "unsupported-png"
  | "corrupt-png";

export type EditResult =
  | { readonly ok: true; readonly changed: boolean }
  | {
      readonly ok: false;
      readonly reason: EditFailure;
      readonly message: string;
    };

export type EditCommandResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: EditFailure;
      readonly message: string;
    };

export interface EditHost {
  readonly store: Store;
  readonly isClosed: () => boolean;
  /** Writes the ledger entry, then runs the effect; a failure of either is a write-failed refusal. */
  readonly ledgered: (
    type: CommandType,
    id: string,
    effect: () => void,
  ) => EditCommandResult;
  readonly hasLedgered: (type: CommandType, id: string) => boolean;
  /** Runs a write without a ledger entry; a failure is a write-failed refusal. */
  readonly write: (effect: () => void) => EditCommandResult;
}

export interface EditOps {
  openEdit(
    id: string,
    workingSetId: string,
    slots: readonly string[],
    content: StudioContent,
  ): EditCommandResult;
  importEdit(
    id: string,
    png: Uint8Array,
    json: string,
    content: StudioContent,
  ): EditResult;
  finishEdit(
    id: string,
    png: Uint8Array,
    json: string,
    content: StudioContent,
    step?: FinishStep,
  ): EditResult;
  discardEdit(id: string): EditCommandResult;
}

const refused = <R extends EditFailure>(reason: R, message: string) =>
  ({ ok: false, reason, message }) as const;

const CLOSED = "the session is closed; open a new one";

export function createEditOps(host: EditHost): EditOps {
  const { store } = host;

  const readSet = (id: string) => {
    if (!parseSlug(id, "working set").ok)
      return refused("not-found", `no working set ${id}`);
    const found = store.readWorkingSet(id);
    if (found.kind === "missing")
      return refused("not-found", `no working set ${id}`);
    if (found.kind === "invalid")
      return refused(
        "wrong-state",
        `working set ${id} is invalid: ${found.message}`,
      );
    return found.value;
  };

  function openEdit(
    id: string,
    workingSetId: string,
    requested: readonly string[],
    content: StudioContent,
  ): EditCommandResult {
    if (host.isClosed()) return refused("closed", CLOSED);
    if (!parseSlug(id, "edit").ok)
      return refused(
        "invalid-params",
        "an edit id is a lowercase hyphenated name",
      );
    if (store.readEdit(id).kind !== "missing")
      return refused("wrong-state", `edit ${id} already exists`);
    const set = readSet(workingSetId);
    if ("ok" in set) return set;
    if (requested.length === 0)
      return refused("invalid-params", "an edit needs at least one slot");
    if (new Set(requested).size !== requested.length)
      return refused("invalid-params", "an edit names each slot once");
    const stray = requested.find((slot) => !set.required.includes(slot));
    if (stray !== undefined)
      return refused(
        "invalid-params",
        `slot ${stray} is not one this working set needs`,
      );
    const ordered = set.required.filter((slot) => requested.includes(slot));
    const busy = store
      .status()
      .edits.find(
        (e) =>
          e.status === "open" &&
          e.workingSetId === set.id &&
          e.slots.some((slot) => ordered.includes(slot)),
      );
    if (busy !== undefined)
      return refused(
        "wrong-state",
        `edit ${busy.id} already has some of these slots open`,
      );

    const started = startSheet({
      set,
      slots: ordered,
      readBlob: (hash) => store.readBlob(hash),
      placeholderMs: (slot) => placeholderMs(content, set.kind, slot),
    });
    if (!started.ok) return refused("wrong-state", started.message);
    const max = Object.fromEntries(
      ordered.map((slot) => [slot, set.limits[slot]?.max ?? 0]),
    );
    const meta = parseSheetJson(started.value.json, {
      slots: ordered,
      cell: started.value.cell,
      max,
    });
    if (!meta.ok)
      return refused(
        "wrong-state",
        `the starting sheet is not valid: ${meta.message}`,
      );

    const evidence: Record<string, EditEvidence> = {};
    for (const slot of ordered) {
      const authored = set.frames[slot];
      if (authored !== undefined) {
        const earlier = store.readEdit(authored.editId);
        const carried =
          earlier.kind === "found" ? earlier.value.evidence[slot] : undefined;
        if (carried === undefined)
          return refused(
            "wrong-state",
            `the edit ${authored.editId} that made slot ${slot} is not available`,
          );
        evidence[slot] = carried;
        continue;
      }
      const pick = set.picks[slot];
      if (pick === undefined)
        return refused("wrong-state", `slot ${slot} has nothing to start from`);
      evidence[slot] = { params: pick.params, palette: pick.palette };
    }
    const startImage = decodePng(started.value.png);
    if (!startImage.ok)
      return refused(
        "wrong-state",
        `the starting sheet does not decode: ${startImage.message}`,
      );
    const record: EditRecord = {
      schemaVersion: 1,
      id,
      workingSetId: set.id,
      slots: ordered,
      cell: started.value.cell,
      base: started.value.base,
      evidence,
      baseSheet: {
        sheetHash: sha256Hex(started.value.png),
        metadataHash: metadataHash(meta.value),
      },
      baseSignature: sheetSignature(
        startImage.image,
        meta.value,
        started.value.cell,
      ),
      status: "open",
      preview: null,
    };
    try {
      store.putEditFile(id, "sheet.png", started.value.png);
      store.putEditFile(
        id,
        "sheet.json",
        new TextEncoder().encode(started.value.json),
      );
    } catch (error) {
      return refused("write-failed", (error as Error).message);
    }
    return host.ledgered("open-edit", id, () => store.putEdit(record));
  }

  const sameBasis = (a: SlotBasis | undefined, b: SlotBasis | undefined) =>
    a !== undefined &&
    b !== undefined &&
    JSON.stringify(a) === JSON.stringify(b);

  type Loaded = { edit: EditRecord; set: WorkingSetRecord };

  /** The open edit and its working set, or the refusal. */
  function load(id: string): Loaded | ReturnType<typeof refused> {
    if (!parseSlug(id, "edit").ok) return refused("not-found", `no edit ${id}`);
    const found = store.readEdit(id);
    if (found.kind === "missing") return refused("not-found", `no edit ${id}`);
    if (found.kind === "invalid")
      return refused("wrong-state", `edit ${id} is invalid: ${found.message}`);
    if (found.value.status !== "open")
      return refused("wrong-state", `edit ${id} is ${found.value.status}`);
    const set = readSet(found.value.workingSetId);
    if ("ok" in set) return set;
    return { edit: found.value, set };
  }

  const isStale = ({ edit, set }: Loaded) =>
    edit.slots.some(
      (slot) => !sameBasis(slotBasisOf(set, slot), edit.base[slot]),
    );

  interface Checked {
    readonly signature: Record<string, SlotSignature>;
    readonly image: RgbaImage;
    readonly meta: SheetMeta;
    readonly sheetHash: Sha256;
    readonly metaHash: Sha256;
  }

  /** Everything about an exported sheet that can be checked without writing. */
  function check(
    { edit, set }: Loaded,
    png: Uint8Array,
    json: string,
  ): Checked | ReturnType<typeof refused> {
    const decoded = decodePng(png);
    if (!decoded.ok) return refused(decoded.code, decoded.message);
    const meta = parseSheetJson(json, {
      slots: edit.slots,
      cell: edit.cell,
      max: Object.fromEntries(
        edit.slots.map((slot) => [slot, set.limits[slot]?.max ?? 0]),
      ),
    });
    if (!meta.ok) return refused("invalid-params", meta.message);
    if (
      decoded.image.width !== meta.value.size.w ||
      decoded.image.height !== meta.value.size.h
    )
      return refused(
        "invalid-params",
        `the sheet is ${decoded.image.width}x${decoded.image.height}; the metadata says ${meta.value.size.w}x${meta.value.size.h}`,
      );
    return {
      signature: sheetSignature(decoded.image, meta.value, edit.cell),
      image: decoded.image,
      meta: meta.value,
      sheetHash: sha256Hex(png),
      metaHash: metadataHash(meta.value),
    };
  }

  /**
   * What each slot of a save is measured against. Saving the very sheet the
   * current preview was built from keeps what that save was measured against,
   * so finishing it does not erase the diff its author saw. Any other save
   * names the preview it replaces; with none, the frames the edit opened with,
   * which only the working set can name while this edit has not yet written
   * its own frames into it. A slot neither can name is left out.
   */
  function againstOf(
    { edit, set }: Loaded,
    checked: Checked,
    content: StudioContent,
  ): Record<string, readonly FrameRef[]> {
    const earlier = edit.preview;
    const sameSave =
      earlier?.sheetHash === checked.sheetHash &&
      earlier.metadataHash === checked.metaHash;
    const against: Record<string, readonly FrameRef[]> = {};
    for (const slot of edit.slots) {
      const named =
        earlier !== null
          ? sameSave
            ? earlier.slots[slot]?.against
            : earlier.slots[slot]?.frames
          : set.frames[slot]?.editId === edit.id
            ? undefined
            : baseFrameRefs(set, slot, placeholderMs(content, set.kind, slot));
      if (named !== undefined) against[slot] = named;
    }
    return against;
  }

  const preview = (loaded: Loaded, checked: Checked, content: StudioContent) =>
    buildPreview({
      image: checked.image,
      sheetHash: checked.sheetHash,
      meta: checked.meta,
      edit: loaded.edit,
      kind: loaded.set.kind,
      content,
      against: againstOf(loaded, checked, content),
    });

  const storeBlobs = (png: Uint8Array, blobs: readonly Uint8Array[]) => {
    store.putBlob(png);
    for (const blob of blobs) store.putBlob(blob);
  };

  /** The very sheet and metadata the current preview was built from. */
  const isPreview = ({ edit }: Loaded, checked: Checked) =>
    edit.preview?.sheetHash === checked.sheetHash &&
    edit.preview.metadataHash === checked.metaHash;

  /** The same frames, durations and pivots as the edit opened with, however they were encoded. */
  const isBase = ({ edit }: Loaded, checked: Checked) =>
    sameSignature(checked.signature, edit.baseSignature);

  function importEdit(
    id: string,
    png: Uint8Array,
    json: string,
    content: StudioContent,
  ): EditResult {
    if (host.isClosed()) return refused("closed", CLOSED);
    const loaded = load(id);
    if ("ok" in loaded) return loaded;
    if (isStale(loaded))
      return refused(
        "wrong-state",
        `edit ${id} is stale: its slots have changed since it was opened`,
      );
    const checked = check(loaded, png, json);
    if ("ok" in checked) return checked;
    if (isPreview(loaded, checked)) return { ok: true, changed: false };
    if (isBase(loaded, checked)) {
      if (loaded.edit.preview === null) return { ok: true, changed: false };
      const cleared = host.write(() =>
        store.putEdit({ ...loaded.edit, preview: null }),
      );
      return cleared.ok ? { ok: true, changed: true } : cleared;
    }
    const built = preview(loaded, checked, content);
    if (!built.ok) return refused("invalid-params", built.message);
    const written = host.write(() => {
      storeBlobs(png, built.value.blobs);
      store.putEdit({ ...loaded.edit, preview: built.value.preview });
    });
    return written.ok ? { ok: true, changed: true } : written;
  }

  function finishEdit(
    id: string,
    png: Uint8Array,
    json: string,
    content: StudioContent,
    how?: FinishStep,
  ): EditResult {
    if (host.isClosed()) return refused("closed", CLOSED);
    const step = checkFinishStep(how);
    if (!step.ok) return refused("invalid-params", step.message);
    const loaded = load(id);
    if ("ok" in loaded) return loaded;
    const { edit, set } = loaded;
    const checked = check(loaded, png, json);
    // A retry after the set was written but the edit was not marked finished.
    const applied = edit.slots.every((slot) => set.frames[slot]?.editId === id);
    if (!applied) {
      if (isStale(loaded))
        return refused(
          "wrong-state",
          `edit ${id} is stale: its slots have changed since it was opened`,
        );
      if ("ok" in checked) return checked;
      if (isBase(loaded, checked))
        return refused(
          "wrong-state",
          `edit ${id} has no changes to finish; discard it instead`,
        );
    } else if ("ok" in checked) return checked;
    const built = preview(loaded, checked, content);
    if (!built.ok) return refused("invalid-params", built.message);
    const finished: EditRecord = {
      ...edit,
      status: "finished",
      preview: built.value.preview,
      ...(step.value === undefined ? {} : { step: step.value }),
    };
    if (applied) {
      const same = edit.slots.every(
        (slot) => set.frames[slot]?.sheetHash === checked.sheetHash,
      );
      if (!same)
        return refused(
          "wrong-state",
          `edit ${id} was finished with a different sheet`,
        );
      const recorded = handStepOf(finished);
      const alike = edit.slots.every((slot) => {
        const last = set.frames[slot]?.handEdits.at(-1);
        return (
          last?.description === recorded.description &&
          last?.method === recorded.method
        );
      });
      if (!alike)
        return refused(
          "wrong-state",
          `edit ${id} was finished with a different step; repeat it as it was`,
        );
      const written = host.write(() => {
        storeBlobs(png, built.value.blobs);
        store.putEdit(finished);
      });
      return written.ok ? { ok: true, changed: true } : written;
    }
    const next = applyFinish({
      set,
      edit: finished,
      preview: built.value.preview,
    });
    if (!next.ok) return refused("invalid-params", next.message);
    const write = () => {
      storeBlobs(png, built.value.blobs);
    };
    const prepared = host.write(write);
    if (!prepared.ok) return prepared;
    const effect = () => {
      store.putWorkingSet(next.value);
      store.putEdit(finished);
    };
    const done = host.hasLedgered("finish-edit", id)
      ? host.write(effect)
      : host.ledgered("finish-edit", id, effect);
    return done.ok ? { ok: true, changed: true } : done;
  }

  function discardEdit(id: string): EditCommandResult {
    if (host.isClosed()) return refused("closed", CLOSED);
    const loaded = load(id);
    if ("ok" in loaded) return loaded;
    return host.ledgered("discard-edit", id, () =>
      store.putEdit({ ...loaded.edit, status: "discarded" }),
    );
  }

  return { openEdit, importEdit, finishEdit, discardEdit };
}

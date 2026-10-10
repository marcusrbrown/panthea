import { describe, expect, test } from "bun:test";

import { fakeTransport, hostError } from "../host/_testkit";
import { createStudioHost } from "../host/client";
import type { ConformParams } from "../host/types";
import * as workflowActions from "./actions";
import {
  buildPackArgs,
  conformJob,
  createLatest,
  editReportSignature,
  editsForReports,
  finishOutcomeMessage,
  finishReviewedEdit,
  inlineParamsAtScale,
  parseInlineConformDraft,
  parseSlotSpecs,
  readEditReport,
  readExistingSheet,
  reopenEditor,
  rerollArgs,
  resolveFlow,
  STALE_REVIEW_MESSAGE,
  sheetFlow,
  slotHint,
} from "./actions";

const configure = (
  studioCall: (args: Readonly<Record<string, unknown>> | undefined) => unknown,
) => {
  const transport = fakeTransport({ studio_call: studioCall });
  return { host: createStudioHost(transport), transport };
};

describe("workflow host actions", () => {
  test("blank scale is omitted from inline conform params", () => {
    const params: ConformParams = {
      background: { type: "alpha" },
      alphaCutoff: 128,
      grid: { edgeTolerance: 8, minConfidence: 0.6, minEdges: 20 },
    };
    expect(inlineParamsAtScale(params, undefined)).toEqual({ params });
  });

  test("filled scale is included in inline conform params", () => {
    const params: ConformParams = {
      background: { type: "alpha" },
      alphaCutoff: 128,
      grid: { edgeTolerance: 8, minConfidence: 0.6, minEdges: 20 },
    };
    expect(inlineParamsAtScale(params, 8)).toEqual({
      params: { ...params, scale: 8 },
    });
  });

  test("a selected portrait record routes to the preview portrait key", () => {
    const routePreviewSelection = (
      workflowActions as unknown as {
        routePreviewSelection?: (selection: {
          source: "draft" | "approved" | "canon";
          id: string;
          kind: "portrait" | "sprite";
        }) => Record<string, string | undefined>;
      }
    ).routePreviewSelection;
    expect(routePreviewSelection).toBeFunction();
    if (!routePreviewSelection) return;
    expect(
      routePreviewSelection({
        source: "draft",
        id: "face-b",
        kind: "portrait",
      }),
    ).toEqual({ source: "draft", portraitKey: "draft:face-b" });
  });

  test("pack arguments reject style tags beyond the manifest slug limit", () => {
    expect(
      buildPackArgs({
        selectedSet: { id: "w", kind: "sprite", authored: {} },
        assets: [],
        assetId: "zeus",
        styleTag: "a".repeat(129),
        footprintWidth: "1",
        footprintHeight: "1",
        originalWorkLicence: "",
        originalWorkAttribution: "",
      }),
    ).toBeUndefined();
  });

  test("pack arguments reject a generated record id beyond the record slug limit", () => {
    expect(
      buildPackArgs({
        selectedSet: { id: "w", kind: "portrait", authored: {} },
        assets: [],
        assetId: "a".repeat(120),
        styleTag: "u5-test",
        footprintWidth: "",
        footprintHeight: "",
        originalWorkLicence: "",
        originalWorkAttribution: "",
      }),
    ).toBeUndefined();
  });

  test("unedited sets do not add original-work metadata", () => {
    const args = buildPackArgs({
      selectedSet: { id: "w", kind: "portrait", authored: {} },
      assets: [],
      assetId: "zeus-face",
      styleTag: "u5-test",
      footprintWidth: "",
      footprintHeight: "",
      originalWorkLicence: "",
      originalWorkAttribution: "",
    });
    expect(args).toEqual({
      id: "record-zeus-face-1",
      workingSetId: "w",
      assetId: "zeus-face",
      styleTag: "u5-test",
    });
  });

  test("hand-edited packs are enabled with a licence and blank attribution", () => {
    const args = buildPackArgs({
      selectedSet: {
        id: "w",
        kind: "sprite",
        authored: { "idle/south": { editId: "e1", frames: 4 } },
      },
      assets: [],
      assetId: "zeus-idle",
      styleTag: "u5-test",
      footprintWidth: "1",
      footprintHeight: "2",
      originalWorkLicence: "MIT",
      originalWorkAttribution: "",
    });

    expect(args).toBeDefined();
  });

  test("blank author or method omits attribution from pack arguments", () => {
    const args = buildPackArgs({
      selectedSet: {
        id: "w",
        kind: "sprite",
        authored: { "idle/south": { editId: "e1", frames: 4 } },
      },
      assets: [],
      assetId: "zeus-idle",
      styleTag: "u5-test",
      footprintWidth: "1",
      footprintHeight: "2",
      originalWorkLicence: "MIT",
      originalWorkAttribution: "  ",
    });

    expect(args?.originalWork).toEqual({ licence: "MIT" });
    expect(Object.hasOwn(args?.originalWork ?? {}, "attribution")).toBe(false);
  });

  test("a filled author or method is passed through as attribution", () => {
    const args = buildPackArgs({
      selectedSet: {
        id: "w",
        kind: "sprite",
        authored: { "idle/south": { editId: "e1", frames: 4 } },
      },
      assets: [],
      assetId: "zeus-idle",
      styleTag: "u5-test",
      footprintWidth: "1",
      footprintHeight: "2",
      originalWorkLicence: "MIT",
      originalWorkAttribution: "Hand-edited in Aseprite",
    });

    expect(args?.originalWork).toEqual({
      licence: "MIT",
      attribution: "Hand-edited in Aseprite",
    });
  });

  test("inline params require every threshold and an explicit background", () => {
    const draft = {
      backgroundType: "alpha" as const,
      rgb: "",
      tolerance: "",
      alphaCutoff: "128",
      edgeTolerance: "8",
      minConfidence: "0.6",
      minEdges: "20",
      scale: "",
    };
    expect(parseInlineConformDraft(draft)).toEqual({
      params: {
        background: { type: "alpha" },
        alphaCutoff: 128,
        grid: { edgeTolerance: 8, minConfidence: 0.6, minEdges: 20 },
      },
    });
    expect(
      parseInlineConformDraft({ ...draft, backgroundType: "" }),
    ).toBeUndefined();
    for (const key of [
      "alphaCutoff",
      "edgeTolerance",
      "minConfidence",
      "minEdges",
    ] as const) {
      expect(
        parseInlineConformDraft({ ...draft, [key]: "" }),
        `${key} is required`,
      ).toBeUndefined();
    }
    expect(
      parseInlineConformDraft({ ...draft, scale: "" }, true),
    ).toBeUndefined();
    expect(parseInlineConformDraft({ ...draft, scale: "8" }, true)).toEqual({
      params: {
        background: { type: "alpha" },
        alphaCutoff: 128,
        grid: { edgeTolerance: 8, minConfidence: 0.6, minEdges: 20 },
        scale: 8,
      },
    });
  });

  test("read-only mode reads an existing sheet without trying to create a set", async () => {
    const { host, transport } = configure((payload) => {
      expect(payload?.op).toBe("sheet");
      return { workingSetId: "w1", candidates: [] };
    });

    const sheet = await readExistingSheet(host, "w1", true);

    expect(sheet).toEqual({ workingSetId: "w1", candidates: [] });
    expect(transport.to("studio_call")).toHaveLength(1);
  });

  test("does not make a host call when the app is not configured for reads", async () => {
    const { host, transport } = configure(() => {
      throw new Error("must not call host");
    });

    expect(await readExistingSheet(host, "w1", false)).toBeUndefined();
    expect(transport.calls).toHaveLength(0);
  });

  test("portrait slots are expressions while sprite slots are state and direction", () => {
    expect(parseSlotSpecs("neutral\nangry", "portrait")).toEqual([
      { expression: "neutral" },
      { expression: "angry" },
    ]);
    expect(parseSlotSpecs("idle/south\nwalk/north", "sprite")).toEqual([
      { state: "idle", direction: "south" },
      { state: "walk", direction: "north" },
    ]);
    expect(slotHint("portrait")).toBe("one expression per line");
    expect(slotHint("sprite")).toBe("one state/direction per line");
  });

  test("reroll targets exactly the failed job request and slot", () => {
    expect(rerollArgs({ requestId: "r1", slotKey: "walk/south" })).toEqual({
      requestId: "r1",
      perSlot: 1,
      slotKey: "walk/south",
    });
  });

  test("scale conformance uses full inline params with the chosen scale", async () => {
    const params: ConformParams = {
      background: { type: "alpha" },
      alphaCutoff: 112,
      grid: { edgeTolerance: 4, minConfidence: 0.7, minEdges: 16 },
    };
    const { host, transport } = configure((payload) => {
      expect(payload?.op).toBe("conform");
      return {
        status: "needs-scale",
        id: "j1",
        requestId: "r1",
        slotKey: "idle/south",
        ordinal: 0,
        input: { hash: "a".repeat(64), width: 64, height: 80 },
        message: "Choose a scale.",
        report: null,
        scale: null,
        coloursMerged: null,
        pixelsChanged: null,
      };
    });

    await conformJob(host, "j1", {
      params: { ...params, scale: 2 },
    });

    expect(transport.to("studio_call")[0]?.args).toEqual({
      op: "conform",
      args: {
        jobId: "j1",
        params: { ...params, scale: 2 },
      },
    });
  });

  test("named-set conformance passes the selected set unchanged", async () => {
    const { host, transport } = configure(() => ({
      status: "needs-scale",
      id: "j1",
      requestId: "r1",
      slotKey: "idle/south",
      ordinal: 0,
      input: { hash: "a".repeat(64), width: 64, height: 80 },
      message: "Choose a scale.",
      report: null,
      scale: null,
      coloursMerged: null,
      pixelsChanged: null,
    }));

    await conformJob(host, "j1", { set: "standard" });

    expect(transport.to("studio_call")[0]?.args).toEqual({
      op: "conform",
      args: { jobId: "j1", set: "standard" },
    });
  });

  test("no-save wrong-state edit reports are a quiet empty result", async () => {
    const { host, transport } = configure(() => {
      throw hostError("wrong-state", "no save yet");
    });

    expect(await readEditReport(host, "edit-1")).toBeUndefined();
    expect(transport.to("studio_call")).toHaveLength(1);
  });

  test("report reads include open edits and the active finished edit only", () => {
    expect(
      editsForReports(
        [
          { id: "open", status: "open" },
          { id: "finished-active", status: "finished" },
          { id: "finished-other", status: "finished" },
          { id: "discarded", status: "discarded" },
        ],
        "finished-active",
      ).map((edit) => edit.id),
    ).toEqual(["open", "finished-active"]);
  });

  test("edit report signature changes only with ids or save hashes", () => {
    const first = [{ id: "e1", status: "open", previewSheetHash: "save-1" }];
    const sameSave = [{ id: "e1", status: "open", previewSheetHash: "save-1" }];
    const nextSave = [{ id: "e1", status: "open", previewSheetHash: "save-2" }];
    expect(editReportSignature(first)).toBe(editReportSignature(sameSave));
    expect(editReportSignature(first)).not.toBe(editReportSignature(nextSave));
  });
});

describe("reopening an open edit's editor", () => {
  const opened = (launched: boolean, reason?: string) => ({
    editId: "e1",
    slots: ["idle/south"],
    workspace: { size: { w: 64, h: 80 }, durationsMs: [167], tags: [] },
    editor: { launched, ...(reason === undefined ? {} : { reason }) },
  });
  const edit = { id: "e1", workingSetId: "w1", slots: ["idle/south"] };

  function hooks(live: () => boolean) {
    const sessions: [string, unknown][] = [];
    const log = { forgot: 0, errors: [] as string[] };
    return {
      sessions,
      log,
      hooks: {
        isLive: live,
        onSession: (id: string, session: unknown) =>
          sessions.push([id, session]),
        onForget: () => {
          log.forgot += 1;
        },
        onError: (message: string) => log.errors.push(message),
      },
    };
  }

  test("records the editor's answer under the edit id", async () => {
    const transport = fakeTransport({
      edit_open: () => opened(false, "no-workspace"),
    });
    const run = hooks(() => true);

    await reopenEditor(createStudioHost(transport), edit, run.hooks);

    expect(transport.calls[0]?.args).toEqual({
      editId: "e1",
      workingSetId: "w1",
      slots: ["idle/south"],
    });
    expect(run.sessions).toEqual([
      ["e1", { launched: false, reason: "no-workspace", durationsMs: [167] }],
    ]);
  });

  test("records the answer even when the effect that asked was cleaned up while the open was in flight", async () => {
    let live = true;
    const transport = fakeTransport({
      edit_open: () => {
        live = false;
        return opened(false, "launch-failed");
      },
    });
    const run = hooks(() => live);

    await reopenEditor(createStudioHost(transport), edit, run.hooks);

    expect(run.sessions).toEqual([
      ["e1", { launched: false, reason: "launch-failed", durationsMs: [167] }],
    ]);
  });

  test("a failure lets the edit be reopened again and is shown only to a live effect", async () => {
    const failing = fakeTransport({
      edit_open: () => {
        throw hostError("root-locked", "locked");
      },
    });
    const live = hooks(() => true);
    const stale = hooks(() => false);

    await reopenEditor(createStudioHost(failing), edit, live.hooks);
    await reopenEditor(createStudioHost(failing), edit, stale.hooks);

    expect(live.log).toEqual({ forgot: 1, errors: [expect.any(String)] });
    expect(stale.log).toEqual({ forgot: 1, errors: [] });
    expect(live.sessions).toEqual([]);
  });

  test("an edit with no working set is not opened", async () => {
    const transport = fakeTransport({ edit_open: () => opened(true) });
    const run = hooks(() => true);

    await reopenEditor(
      createStudioHost(transport),
      { id: "e1", slots: [] },
      run.hooks,
    );

    expect(transport.calls).toEqual([]);
  });
});

/** A promise the test settles by hand, so replies can arrive in any order. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("late replies to the request form", () => {
  function run(over: Partial<Parameters<typeof resolveFlow<string>>[0]>) {
    const seen: string[] = [];
    const flow = resolveFlow<string>({
      latest: createLatest(),
      isCurrent: () => true,
      call: async () => "spec",
      onResolved: (value) => seen.push(`resolved ${value}`),
      onRefused: () => seen.push("refused"),
      ...over,
    });
    return { seen, flow };
  }

  test("a reply for the current form is applied, and a refusal is reported", async () => {
    const ok = run({});
    await ok.flow;
    const refused = run({ call: async () => undefined });
    await refused.flow;

    expect(ok.seen).toEqual(["resolved spec"]);
    expect(refused.seen).toEqual(["refused"]);
  });

  test("a reply that arrives after the form changed is dropped, success or refusal", async () => {
    const ok = run({ isCurrent: () => false });
    await ok.flow;
    const refused = run({
      isCurrent: () => false,
      call: async () => undefined,
    });
    await refused.flow;

    expect(ok.seen).toEqual([]);
    expect(refused.seen).toEqual([]);
  });

  test("when two resolves overlap, only the newer one's reply is applied, whichever comes back first", async () => {
    const latest = createLatest();
    const first = deferred<string | undefined>();
    const second = deferred<string | undefined>();
    const seen: string[] = [];
    const start = (reply: Promise<string | undefined>, name: string) =>
      resolveFlow<string>({
        latest,
        isCurrent: () => true,
        call: () => reply,
        onResolved: (value) => seen.push(`${name} resolved ${value}`),
        onRefused: () => seen.push(`${name} refused`),
      });
    const a = start(first.promise, "a");
    const b = start(second.promise, "b");

    second.resolve("b-spec");
    await b;
    first.resolve(undefined);
    await a;

    expect(seen).toEqual(["b resolved b-spec"]);
  });
});

describe("late replies to loading a sheet", () => {
  test("a sheet for the sheet still chosen is shown", async () => {
    const shown: unknown[] = [];

    await sheetFlow({
      latest: createLatest(),
      isCurrent: () => true,
      read: async () => ({ id: "sheet-a" }),
      onSheet: (sheet) => shown.push(sheet),
      onError: () => {},
    });

    expect(shown).toEqual([{ id: "sheet-a" }]);
  });

  test("a sheet that arrives after the owner chose another set is dropped", async () => {
    const shown: unknown[] = [];

    await sheetFlow({
      latest: createLatest(),
      isCurrent: () => false,
      read: async () => ({ id: "sheet-a" }),
      onSheet: (sheet) => shown.push(sheet),
      onError: () => {},
    });

    expect(shown).toEqual([]);
  });

  test("when two loads overlap, the earlier one's late sheet never replaces the later one's", async () => {
    const latest = createLatest();
    const slow = deferred<string | undefined>();
    const shown: string[] = [];
    const load = (reply: Promise<string | undefined>) =>
      sheetFlow<string>({
        latest,
        isCurrent: () => true,
        read: () => reply,
        onSheet: (sheet) => shown.push(sheet),
        onError: () => {},
      });
    const first = load(slow.promise);
    const second = load(Promise.resolve("sheet-b"));

    await second;
    slow.resolve("sheet-a");
    await first;

    expect(shown).toEqual(["sheet-b"]);
  });

  test("a stale create does not go on to read, and a stale failure is not shown", async () => {
    const created = deferred<unknown>();
    const reads: string[] = [];
    const errors: string[] = [];
    let current = true;

    const flow = sheetFlow<string>({
      latest: createLatest(),
      isCurrent: () => current,
      create: () => created.promise,
      read: async () => {
        reads.push("read");
        throw new Error("late failure");
      },
      onSheet: () => {},
      onError: (message) => errors.push(message),
    });
    current = false;
    created.resolve({ id: "set" });
    await flow;

    expect(reads).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe("finishing the version that was reviewed", () => {
  test("a cancelled import is not reported as a successful finish", () => {
    expect(finishOutcomeMessage({ kind: "cancelled" })).toBeUndefined();
    expect(finishOutcomeMessage({ kind: "finished" })).toBe(
      "Edit finished. The reviewed pixels were kept.",
    );
  });

  const report = {
    editId: "e1",
    workingSetId: "w1",
    state: "open",
    sheetHash: "c".repeat(64),
    metadataHash: "d".repeat(64),
    slots: [],
  } as const;

  test("with the editor, finish names the sheet hash of the report on screen", async () => {
    const transport = fakeTransport({
      studio_call: () => ({ editId: "e1", state: "finished", changed: true }),
    });

    const outcome = await finishReviewedEdit(
      createStudioHost(transport),
      "e1",
      report,
      true,
    );

    expect(outcome).toEqual({ kind: "finished" });
    expect(transport.calls[0]).toEqual({
      command: "studio_call",
      args: { op: "finish", args: { id: "e1", reviewed: "c".repeat(64) } },
    });
  });

  test("a workspace saved again since the report is a plain message, not an error", async () => {
    const transport = fakeTransport({
      studio_call: () => {
        throw hostError("stale-review", "edit e1 was saved again");
      },
    });

    const outcome = await finishReviewedEdit(
      createStudioHost(transport),
      "e1",
      report,
      true,
    );

    expect(outcome).toEqual({ kind: "stale", message: STALE_REVIEW_MESSAGE });
    expect(STALE_REVIEW_MESSAGE).toBe(
      "The workspace changed since this report. Review the new version, then finish.",
    );
  });

  test("any other refusal is still an error for the caller to show", async () => {
    const transport = fakeTransport({
      studio_call: () => {
        throw hostError("wrong-state", "edit e1 is finished");
      },
    });

    await expect(
      finishReviewedEdit(createStudioHost(transport), "e1", report, true),
    ).rejects.toMatchObject({ code: "wrong-state" });
  });

  test("with no editor the owner picks the files to finish with, so no hash is named and none applies", async () => {
    const transport = fakeTransport({
      edit_import: () => ({ editId: "e1", state: "finished", changed: true }),
    });

    const outcome = await finishReviewedEdit(
      createStudioHost(transport),
      "e1",
      report,
      false,
    );

    expect(outcome).toEqual({ kind: "finished" });
    expect(transport.calls.map((call) => call.command)).toEqual([
      "edit_import",
    ]);
    expect(transport.calls[0]?.args).toEqual({ editId: "e1", finish: true });
  });

  test("cancelling the fallback file picker leaves the edit open", async () => {
    const transport = fakeTransport({
      edit_import: () => ({ cancelled: true }),
    });

    const outcome = await finishReviewedEdit(
      createStudioHost(transport),
      "e1",
      report,
      false,
    );

    expect(outcome).toEqual({ kind: "cancelled" });
  });
});

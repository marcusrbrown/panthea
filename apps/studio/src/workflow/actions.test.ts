import { describe, expect, test } from "bun:test";

import { fakeTransport, hostError } from "../host/_testkit";
import { createStudioHost, HostError } from "../host/client";
import type { ConformParams } from "../host/types";
import * as workflowActions from "./actions";
import {
  buildFinishStep,
  buildPackArgs,
  checkResolvedSeed,
  chooseConfigGuarded,
  conformJob,
  createLatest,
  createStableHandlers,
  editReportSignature,
  editsForReports,
  finishOutcomeMessage,
  finishReviewedEdit,
  type GuardUi,
  generateReady,
  guardedAction,
  inlineParamsAtScale,
  MAX_SEED,
  packWorkingSetGuarded,
  parseBaseSeed,
  parseInlineConformDraft,
  parseSlotSpecs,
  pickCandidateGuarded,
  readEditReport,
  readExistingSheet,
  reopenEditor,
  requestSignature,
  rerollArgs,
  resolveFlow,
  SLOT_EXAMPLES,
  STALE_REVIEW_MESSAGE,
  sheetFlow,
  slotHint,
  slotProblem,
} from "./actions";
import { initialWorkflowState, workflowReducer } from "./model";

const configure = (
  studioCall: (args: Readonly<Record<string, unknown>> | undefined) => unknown,
) => {
  const transport = fakeTransport({ studio_call: studioCall });
  return { host: createStudioHost(transport), transport };
};

const packNeedsStillFrameMs = (
  workflowActions as unknown as {
    packNeedsStillFrameMs?: (set: Record<string, unknown>) => boolean;
  }
).packNeedsStillFrameMs;
const buildPackArgsWithStillFrame = buildPackArgs as unknown as (
  input: Record<string, unknown>,
) => { readonly stillFrameMs?: number } | undefined;

describe("workflow host actions", () => {
  test("Open editor again uses the active edit's set, not the selected set", async () => {
    const setA = { id: "working-set-a", kind: "sprite" };
    const selectedSetB = { id: "working-set-b", kind: "portrait" };
    const activeEdit = {
      id: "edit-a",
      workingSetId: setA.id,
      status: "open",
      slots: ["idle/south"],
    };
    const reopen = (
      workflowActions as unknown as {
        reopenWorkingSetEdit?: (
          host: ReturnType<typeof createStudioHost>,
          edit: typeof activeEdit,
          sets: readonly (typeof setA)[],
        ) => Promise<unknown> | undefined;
      }
    ).reopenWorkingSetEdit;

    expect(reopen).toBeFunction();
    if (!reopen) return;
    const transport = fakeTransport({
      edit_open: () => ({
        editId: "edit-a",
        slots: ["idle/south"],
        workspace: { size: { w: 64, h: 80 }, durationsMs: [167], tags: [] },
        editor: { launched: true },
      }),
    });
    await reopen(createStudioHost(transport), activeEdit, [setA, selectedSetB]);

    expect(transport.calls[0]?.args).toEqual({
      editId: "edit-a",
      workingSetId: "working-set-a",
      slots: ["idle/south"],
    });
  });

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

  test("picked portrait slots require a still-frame time", () => {
    expect(packNeedsStillFrameMs).toBeFunction();
    if (!packNeedsStillFrameMs) return;

    expect(
      packNeedsStillFrameMs({
        id: "faces",
        kind: "portrait",
        required: ["neutral"],
        picks: { neutral: { candidateId: "neutral-candidate" } },
        authored: {},
      }),
    ).toBe(true);
    expect(
      packNeedsStillFrameMs({
        id: "faces-edited",
        kind: "portrait",
        required: ["neutral"],
        picks: { neutral: { candidateId: "neutral-candidate" } },
        authored: { neutral: { editId: "e1", frames: 1 } },
      }),
    ).toBe(false);
    expect(
      packNeedsStillFrameMs({
        id: "sprite",
        kind: "sprite",
        required: ["idle/south"],
        picks: { "idle/south": { candidateId: "sprite-candidate" } },
        authored: {},
      }),
    ).toBe(false);
  });

  test("picked portrait pack args are refused without a still-frame time", () => {
    const input = {
      selectedSet: {
        id: "faces",
        kind: "portrait",
        required: ["neutral"],
        picks: { neutral: { candidateId: "neutral-candidate" } },
        authored: {},
      },
      assets: [],
      assetId: "zeus-face",
      styleTag: "u5-test",
      footprintWidth: "",
      footprintHeight: "",
      originalWorkLicence: "",
      originalWorkAttribution: "",
      stillFrameMs: "",
    };

    expect(buildPackArgsWithStillFrame(input)).toBeUndefined();
  });

  test("picked portrait pack args include a positive integer still-frame time", () => {
    const input = {
      selectedSet: {
        id: "faces",
        kind: "portrait",
        required: ["neutral"],
        picks: { neutral: { candidateId: "neutral-candidate" } },
        authored: {},
      },
      assets: [],
      assetId: "zeus-face",
      styleTag: "u5-test",
      footprintWidth: "",
      footprintHeight: "",
      originalWorkLicence: "",
      originalWorkAttribution: "",
      stillFrameMs: "500",
    };

    expect(buildPackArgsWithStillFrame(input)).toMatchObject({
      stillFrameMs: 500,
    });
    expect(
      buildPackArgsWithStillFrame({ ...input, stillFrameMs: "1.5" }),
    ).toBeUndefined();
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
  });

  describe("the slot hint", () => {
    test("sprites take state/direction[/ability] and act needs an ability; portraits take an expression name", () => {
      expect(slotHint("sprite")).toContain("state/direction[/ability]");
      expect(slotHint("sprite")).toContain("act needs an ability");
      expect(slotHint("portrait")).toContain("expression");
    });

    test("every example line the hint shows parses and has no problem", () => {
      for (const kind of ["sprite", "portrait"] as const) {
        expect(SLOT_EXAMPLES[kind].length).toBeGreaterThan(0);
        for (const example of SLOT_EXAMPLES[kind]) {
          expect(slotHint(kind), example).toContain(example);
          const parsed = parseSlotSpecs(example, kind);
          expect(parsed, example).toHaveLength(1);
          expect(slotProblem(example, kind), example).toBeUndefined();
        }
        expect(
          slotProblem(SLOT_EXAMPLES[kind].join("\n"), kind),
        ).toBeUndefined();
      }
      expect(parseSlotSpecs("act/south/thunderbolt", "sprite")).toEqual([
        { state: "act", direction: "south", ability: "thunderbolt" },
      ]);
    });

    test("act//thunderbolt says the direction is missing, and act without an ability says it needs one", () => {
      expect(slotProblem("act//thunderbolt", "sprite")).toBe(
        'Slot "act//thunderbolt": the direction is empty. Write state/direction/ability, for example act/south/thunderbolt.',
      );
      expect(slotProblem("act/south", "sprite")).toBe(
        'Slot "act/south": act needs an ability. Write act/south/thunderbolt.',
      );
      expect(slotProblem("idle/south/", "sprite")).toContain(
        "ability is empty",
      );
      expect(slotProblem("/south", "sprite")).toContain("state is empty");
      expect(slotProblem("idle", "sprite")).toContain("needs a direction");
      expect(slotProblem("idle/south\nact//thunderbolt", "sprite")).toContain(
        "act//thunderbolt",
      );
      expect(slotProblem("neutral\nidle/south", "portrait")).toContain(
        "one expression name",
      );
      expect(slotProblem("", "sprite")).toBeUndefined();
    });
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

/** What the window's state setters would record, with the order they were called in. */
function recordingUi(allowed = true) {
  const log: string[] = [];
  const ui: GuardUi = {
    allowed: () => allowed,
    setBusy: (busy) => log.push(`busy ${busy}`),
    setMessage: (message) => log.push(`message ${message}`),
    setRefusalDetails: (details) => log.push(`details ${details}`),
  };
  return { ui, log };
}

describe("a scripted finish", () => {
  const report = {
    editId: "e1",
    workingSetId: "w1",
    state: "open",
    sheetHash: "c".repeat(64),
    metadataHash: "d".repeat(64),
    slots: [],
  } as const;
  const step = {
    method: "script",
    description: "idle loop (art-edit/idle.py)",
  } as const;

  test("the step is the toggle and the description: off is no step, on needs words that will be published", () => {
    expect(buildFinishStep(false, "ignored")).toEqual({
      ok: true,
      step: undefined,
    });
    expect(buildFinishStep(true, "  idle loop  ")).toEqual({
      ok: true,
      step: { method: "script", description: "idle loop" },
    });
    for (const empty of ["", "   ", "\n"])
      expect(buildFinishStep(true, empty)).toEqual({
        ok: false,
        message:
          "Say what ran: a scripted finish is recorded with this description, and it is published with the asset.",
      });
  });

  test("through the editor path the finish names the reviewed hash and carries the step", async () => {
    const transport = fakeTransport({
      studio_call: () => ({ editId: "e1", state: "finished", changed: true }),
    });

    const outcome = await finishReviewedEdit(
      createStudioHost(transport),
      "e1",
      report,
      true,
      step,
    );

    expect(outcome).toEqual({ kind: "finished" });
    expect(transport.calls[0]).toEqual({
      command: "studio_call",
      args: {
        op: "finish",
        args: {
          id: "e1",
          reviewed: "c".repeat(64),
          method: "script",
          description: step.description,
        },
      },
    });
  });

  test("through the no-editor path the picked-files finish carries the step", async () => {
    const transport = fakeTransport({
      edit_import: () => ({ editId: "e1", state: "finished", changed: true }),
    });

    const outcome = await finishReviewedEdit(
      createStudioHost(transport),
      "e1",
      report,
      false,
      step,
    );

    expect(outcome).toEqual({ kind: "finished" });
    expect(transport.calls[0]).toEqual({
      command: "edit_import",
      args: {
        editId: "e1",
        finish: true,
        method: "script",
        description: step.description,
      },
    });
  });

  test("a scripted finish without the reviewed hash is refused before the host is called", async () => {
    const transport = fakeTransport({});
    for (const sheetHash of ["", "abc", "C".repeat(64)])
      for (const editorLaunched of [true, false]) {
        const outcome = await finishReviewedEdit(
          createStudioHost(transport),
          "e1",
          { ...report, sheetHash },
          editorLaunched,
          step,
        );

        expect(outcome, `${sheetHash} ${editorLaunched}`).toEqual({
          kind: "refused",
          message:
            "A scripted finish needs the saved version you reviewed. Save in the editor, review the report, then finish.",
        });
      }
    expect(transport.calls).toEqual([]);
  });

  test("a stale hash is refused as a plain message, and the retry resends the identical step", async () => {
    let attempts = 0;
    const transport = fakeTransport({
      studio_call: () => {
        attempts += 1;
        if (attempts === 1) throw hostError("stale-review", "saved again");
        return { editId: "e1", state: "finished", changed: true };
      },
    });
    const host = createStudioHost(transport);

    const first = await finishReviewedEdit(host, "e1", report, true, step);
    const retry = await finishReviewedEdit(host, "e1", report, true, step);

    expect(first).toEqual({ kind: "stale", message: STALE_REVIEW_MESSAGE });
    expect(retry).toEqual({ kind: "finished" });
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[1]).toEqual(transport.calls[0]);
  });

  test("a plain finish sends no method or description", async () => {
    const transport = fakeTransport({
      studio_call: () => ({ editId: "e1", state: "finished", changed: true }),
    });

    await finishReviewedEdit(createStudioHost(transport), "e1", report, true);

    expect(transport.calls[0]?.args).toEqual({
      op: "finish",
      args: { id: "e1", reviewed: "c".repeat(64) },
    });
  });
});

describe("the base seed", () => {
  test("only ASCII digits are a seed; empty means draw one", () => {
    expect(parseBaseSeed("", 1)).toEqual({ ok: true, seed: undefined });
    expect(parseBaseSeed("0", 1)).toEqual({ ok: true, seed: 0 });
    expect(parseBaseSeed("20261007", 3)).toEqual({ ok: true, seed: 20261007 });
    expect(parseBaseSeed("007", 1)).toEqual({ ok: true, seed: 7 });
  });

  test("the last job seed, base plus the last ordinal, may reach 2^32-1 and no further", () => {
    expect(MAX_SEED).toBe(4294967295);
    // Four jobs have ordinals 0..3.
    expect(parseBaseSeed("4294967292", 4)).toEqual({
      ok: true,
      seed: 4294967292,
    });
    expect(parseBaseSeed("4294967295", 1)).toEqual({
      ok: true,
      seed: 4294967295,
    });
    const over = parseBaseSeed("4294967295", 4);
    expect(over).toEqual({
      ok: false,
      message:
        "The last job's seed would be 4294967298, past 4294967295. Use a base seed of at most 4294967292 for 4 jobs.",
    });
    expect(parseBaseSeed("4294967293", 4).ok).toBe(false);
    expect(parseBaseSeed("99999999999999999999999", 1).ok).toBe(false);
  });

  test("anything else is refused with one message: sign, fraction, exponent, whitespace, non-ASCII digits, hex", () => {
    const message = "The base seed is whole digits only, from 0 to 4294967295.";
    for (const bad of [
      "-1",
      "+1",
      "1.5",
      "1e3",
      " 1",
      "1 ",
      "1\n",
      "\t1",
      "٣",
      "１２３",
      "0x10",
      "1_000",
      "abc",
      "NaN",
      "1,000",
    ])
      expect(parseBaseSeed(bad, 1), JSON.stringify(bad)).toEqual({
        ok: false,
        message,
      });
  });

  test("a drawn seed is held to the same range, so the resolve step never shows one that would overflow", () => {
    expect(checkResolvedSeed(12345, 4)).toBeUndefined();
    expect(checkResolvedSeed(4294967292, 4)).toBeUndefined();
    expect(checkResolvedSeed(4294967295, 4)).toContain("Resolve again");
    expect(checkResolvedSeed(undefined, 4)).toContain("no seed");
    expect(checkResolvedSeed("5", 4)).toContain("no seed");
    expect(checkResolvedSeed(1.5, 1)).toContain("no seed");
  });

  test("editing the seed after a resolve makes Generate not ready until the next resolve", () => {
    const form = {
      subject: "zeus",
      kind: "sprite",
      slots: "idle/south",
      batch: 1,
      styleNote: "",
      seed: "",
    };
    const resolvedFrom = requestSignature(form);

    expect(generateReady(resolvedFrom, requestSignature(form))).toBe(true);
    expect(
      generateReady(resolvedFrom, requestSignature({ ...form, seed: "5" })),
    ).toBe(false);
    expect(
      generateReady(
        resolvedFrom,
        requestSignature({ ...form, subject: "hera" }),
      ),
    ).toBe(false);
    expect(generateReady(undefined, requestSignature(form))).toBe(false);
    // Resolving again from the edited form makes it ready again.
    const edited = { ...form, seed: "5" };
    expect(
      generateReady(requestSignature(edited), requestSignature(edited)),
    ).toBe(true);
  });
});

describe("stable row handlers", () => {
  test("a handler keeps its identity while the latest implementation changes under it", () => {
    const calls: string[] = [];
    const latest = {
      current: { remove: (id: string) => calls.push(`old ${id}`) },
    };
    const stable = createStableHandlers(latest);
    const remove = stable.remove;

    latest.current = { remove: (id: string) => calls.push(`new ${id}`) };
    remove("j1");

    expect(stable.remove).toBe(remove);
    expect(calls).toEqual(["new j1"]);
  });
});

describe("the window's refusal and pending handling", () => {
  test("a refusal's message and details are shown and the pending state ends", async () => {
    const { ui, log } = recordingUi();

    const result = await guardedAction(ui, { label: "pack" }, async () => {
      throw new HostError({
        code: "wrong-state",
        message: "working set w is not complete",
        retryable: false,
        detail: { slot: "idle/south" },
      });
    });

    expect(result).toBeUndefined();
    expect(log).toEqual([
      "busy true",
      "message ",
      "details ",
      "message working set w is not complete",
      expect.stringContaining("details "),
      "busy false",
    ]);
    expect(log.find((line) => line.startsWith("details {"))).toContain(
      "idle/south",
    );
  });

  test("a success says so and ends the pending state; a non-blocking action never sets it", async () => {
    const blocking = recordingUi();
    const quiet = recordingUi();

    expect(
      await guardedAction(blocking.ui, { label: "pick" }, async () => 7),
    ).toBe(7);
    await guardedAction(
      quiet.ui,
      { label: "generate", nonBlocking: true },
      async () => 1,
    );

    expect(blocking.log).toContain("message pick complete");
    expect(blocking.log.at(-1)).toBe("busy false");
    expect(quiet.log.some((line) => line.startsWith("busy"))).toBe(false);
  });

  test("an action the window is not allowed to run does nothing", async () => {
    const { ui, log } = recordingUi(false);
    let ran = false;

    const result = await guardedAction(ui, { label: "pack" }, async () => {
      ran = true;
    });

    expect(result).toBeUndefined();
    expect(ran).toBe(false);
    expect(log).toEqual([]);
  });

  test("Pack draft on an incomplete set leaves the selected record unchanged", async () => {
    const transport = fakeTransport({
      studio_call: () => {
        throw hostError("wrong-state", "working set w is not complete");
      },
    });
    const { ui, log } = recordingUi();

    const initial = workflowReducer(initialWorkflowState(), {
      type: "select-asset",
      assetId: "previous-record",
    });
    let state = initial;
    const result = await packWorkingSetGuarded(
      createStudioHost(transport),
      ui,
      {
        id: "record-zeus-1",
        workingSetId: "w",
        assetId: "zeus",
        styleTag: "u5",
      },
      (recordId) => {
        state = workflowReducer(state, {
          type: "select-asset",
          assetId: recordId,
        });
      },
    );

    expect(result).toBeUndefined();
    expect(transport.calls[0]?.args).toMatchObject({
      op: "pack",
      args: { id: "record-zeus-1", workingSetId: "w" },
    });
    expect(log).toContain("message working set w is not complete");
    expect(log.at(0)).toBe("busy true");
    expect(log.at(-1)).toBe("busy false");
    expect(state.selectedAssetId).toBe(initial.selectedAssetId);
  });

  test("Pick on a refused candidate shows the host's refusal and clears pending", async () => {
    const transport = fakeTransport({
      studio_call: () => {
        throw hostError("wrong-state", "candidate c1 needs a conformance pass");
      },
    });
    const { ui, log } = recordingUi();

    const result = await pickCandidateGuarded(
      createStudioHost(transport),
      ui,
      "w",
      { id: "c1", slotKey: "idle/south" },
    );

    expect(result).toBeUndefined();
    expect(transport.calls[0]?.args).toEqual({
      op: "pick",
      args: { workingSetId: "w", candidateId: "c1", slot: "idle/south" },
    });
    expect(log).toContain("message candidate c1 needs a conformance pass");
    expect(log.at(-1)).toBe("busy false");
  });

  test("a candidate with no slot is not sent and shows nothing", async () => {
    const transport = fakeTransport();
    const { ui, log } = recordingUi();

    await pickCandidateGuarded(createStudioHost(transport), ui, "w", {
      id: "c1",
    });

    expect(transport.calls).toEqual([]);
    expect(log).toEqual([]);
  });

  test("a successful Pack draft selects its returned record id", async () => {
    const transport = fakeTransport({
      studio_call: () => ({ id: "record-zeus-sprite-1" }),
    });
    const { ui, log } = recordingUi();
    let state = workflowReducer(initialWorkflowState(), {
      type: "select-asset",
      assetId: "placeholder-zeus",
    });

    await packWorkingSetGuarded(
      createStudioHost(transport),
      ui,
      {
        id: "record-zeus-sprite-1",
        workingSetId: "w",
        assetId: "zeus-sprite",
        styleTag: "u5",
      },
      (recordId) => {
        state = workflowReducer(state, {
          type: "select-asset",
          assetId: recordId,
        });
      },
    );

    expect(state.selectedAssetId).toBe("record-zeus-sprite-1");
    expect(log).toContain(
      "message Packed draft record-zeus-sprite-1 for zeus-sprite. Review it, then approve.",
    );
    expect(log).toContain("busy false");
  });
});

describe("choosing a config", () => {
  test("a refused config is shown to the owner, not swallowed", async () => {
    const transport = fakeTransport({
      config_choose: () => {
        throw hostError("invalid-config", "the config file is not JSON");
      },
    });
    const shown: string[] = [];
    let configured = 0;

    await chooseConfigGuarded(createStudioHost(transport), {
      onConfigured: () => {
        configured += 1;
      },
      onNotice: (message) => shown.push(message),
    });

    expect(shown).toEqual(["", "the config file is not JSON"]);
    expect(configured).toBe(0);
  });

  test("a chosen config is reported and clears the notice; a cancelled pick changes nothing", async () => {
    const chosen = fakeTransport({
      config_choose: () => ({
        cancelled: false,
        configured: true,
        state: "starting",
      }),
    });
    const cancelled = fakeTransport({
      config_choose: () => ({ cancelled: true }),
    });
    const shown: string[] = [];
    let configured = 0;
    const hooks = {
      onConfigured: () => {
        configured += 1;
      },
      onNotice: (message: string) => shown.push(message),
    };

    await chooseConfigGuarded(createStudioHost(chosen), hooks);
    await chooseConfigGuarded(createStudioHost(cancelled), hooks);

    expect(configured).toBe(1);
    expect(shown).toEqual(["", ""]);
  });
});

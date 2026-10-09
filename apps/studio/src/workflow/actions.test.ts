import { describe, expect, test } from "bun:test";
import { fakeTransport, hostError } from "../host/_testkit";
import { createStudioHost } from "../host/client";
import type { ConformParams } from "../host/types";
import {
  conformJob,
  editReportSignature,
  editsForReports,
  inlineParamsAtScale,
  parseInlineConformDraft,
  parseSlotSpecs,
  readEditReport,
  readExistingSheet,
  rerollArgs,
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

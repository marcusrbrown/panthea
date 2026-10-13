import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PackInput } from "@panthea/assets/studio";
import {
  type AssetRig,
  assetRig,
  finishSheet,
  paintFigure,
  removeTempRoots,
  runSlots,
  sheetOf,
  spriteSet,
} from "../../../../packages/assets/src/studio/_test-fixtures";
import { decodePng } from "../../../../packages/assets/src/studio/png/decode";
import { editReport as sdkEditReport } from "../../../../packages/assets/src/studio/reports";
import { fakeTransport, hostError } from "../host/_testkit";
import { createStudioHost } from "../host/client";
import * as workflowActions from "./actions";

const buildPackArgs = (
  workflowActions as unknown as {
    buildPackArgs?: (input: {
      readonly selectedSet: Record<string, unknown>;
      readonly assets: readonly { readonly id: string }[];
      readonly assetId: string;
      readonly styleTag: string;
      readonly footprintWidth: string;
      readonly footprintHeight: string;
      readonly originalWorkLicence: string;
      readonly originalWorkAttribution: string;
      readonly stillFrameMs?: string;
    }) => PackInput | undefined;
  }
).buildPackArgs;

const windowActions = workflowActions as unknown as {
  pickCandidateForSet?: (
    host: ReturnType<typeof createStudioHost>,
    workingSetId: string,
    candidate: { readonly id: string; readonly slotKey: string },
  ) => Promise<unknown>;
  openWorkingSetEdit?: (
    host: ReturnType<typeof createStudioHost>,
    workingSet: ReturnType<typeof setSummary>,
    editId: string,
  ) => Promise<{
    readonly editId: string;
    readonly editor: { readonly launched: boolean };
  }>;
  exportEditFallback?: (
    host: ReturnType<typeof createStudioHost>,
    editId: string,
  ) => Promise<{ readonly cancelled: boolean }>;
  importEditFallback?: (
    host: ReturnType<typeof createStudioHost>,
    editId: string,
  ) => Promise<{ readonly cancelled: boolean }>;
  readEditReport?: (
    host: ReturnType<typeof createStudioHost>,
    editId: string,
  ) => Promise<import("../host/types").EditReport | undefined>;
  finishReviewedEdit?: typeof workflowActions.finishReviewedEdit;
  buildPackArgs?: typeof workflowActions.buildPackArgs;
  packWorkingSet?: (
    host: ReturnType<typeof createStudioHost>,
    args: PackInput,
  ) => Promise<unknown>;
};

const rigs: AssetRig[] = [];
const registryCopies: string[] = [];
const repositoryRegistry = join(
  import.meta.dir,
  "../../../../content/greek/assets/registry",
);

afterEach(() => {
  for (const rig of rigs.splice(0)) rig.session.close();
  removeTempRoots();
  for (const directory of registryCopies.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function newRig() {
  const tempRoot = mkdtempSync(join(tmpdir(), "studio-pack-registry-"));
  const registryRoot = join(tempRoot, "registry");
  cpSync(repositoryRegistry, registryRoot, { recursive: true });
  registryCopies.push(tempRoot);
  const rig = assetRig({ registryRoot });
  rigs.push(rig);
  return rig;
}

function setSummary(rig: AssetRig, id: string) {
  const result = rig.session.store.readWorkingSet(id);
  if (result.kind !== "found") throw new Error(`working set ${id} is missing`);
  return {
    id,
    kind: result.value.kind,
    required: result.value.required,
    picks: result.value.picks,
    authored: Object.fromEntries(
      Object.entries(result.value.frames).map(([slot, frames]) => [
        slot,
        { editId: frames.editId, frames: frames.frames.length },
      ]),
    ),
  };
}

function packThroughSession(
  rig: AssetRig,
  workingSetId: string,
  values: {
    readonly assetId: string;
    readonly styleTag: string;
    readonly footprintWidth?: string;
    readonly footprintHeight?: string;
    readonly originalWorkAttribution?: string;
    readonly stillFrameMs?: string;
  },
) {
  expect(buildPackArgs).toBeFunction();
  if (!buildPackArgs) throw new Error("buildPackArgs is not implemented");
  const set = setSummary(rig, workingSetId);
  const input = buildPackArgs({
    selectedSet: set,
    assets: rig.session.store
      .status()
      .assets.map((asset) => ({ id: asset.id })),
    assetId: values.assetId,
    styleTag: values.styleTag,
    footprintWidth: values.footprintWidth ?? "1",
    footprintHeight: values.footprintHeight ?? "1",
    originalWorkLicence: "MIT",
    originalWorkAttribution:
      values.originalWorkAttribution ??
      "Marcus R. Brown, hand-edited in Aseprite",
    stillFrameMs: values.stillFrameMs ?? "",
  });
  if (!input) throw new Error("The valid pack form did not produce arguments");
  const result = rig.session.pack(
    input,
    rig.content,
    rig.palettes,
    rig.registryRoot,
  );
  if (!result.ok) throw new Error(`The SDK refused pack: ${result.message}`);
  return { input, asset: result.asset };
}

describe("pack form arguments against an in-process StudioSession", () => {
  test("packs a complete four-frame sprite with its hand-work details", () => {
    const rig = newRig();
    spriteSet(rig);

    const { input, asset } = packThroughSession(rig, "w", {
      assetId: "placeholder-zeus",
      styleTag: "u5-test",
      footprintWidth: "1",
      footprintHeight: "2",
    });

    expect(input.footprint).toEqual({ w: 1, h: 2 });
    expect(input.originalWork).toEqual({
      licence: "MIT",
      attribution: "Marcus R. Brown, hand-edited in Aseprite",
    });
    expect(asset.record.manifest.kind).toBe("sprite");
    if (asset.record.manifest.kind !== "sprite")
      throw new Error("expected a sprite manifest");
    expect(asset.record.manifest.animations[0]?.frames).toHaveLength(4);
  });

  test("packs a hand-edited portrait without a sprite footprint", () => {
    const rig = newRig();
    const expressions = [...rig.content.vocabulary.expressions];
    const jobs = runSlots(
      rig,
      "zeus-faces",
      "portrait",
      expressions.map((expression) => ({ expression })),
    );
    if (!rig.session.openWorkingSet("wp", "zeus-faces", rig.content).ok)
      throw new Error("working set could not be opened");
    for (const id of jobs)
      if (!rig.session.pick("wp", id).ok)
        throw new Error(`could not pick ${id}`);
    const cell = { w: 96, h: 96 };
    finishSheet(
      rig,
      "portrait-edit",
      "wp",
      cell,
      expressions.map((expression, index) => ({
        slot: expression,
        frames: [paintFigure(rig.content, cell, index)],
      })),
    );

    const { input, asset } = packThroughSession(rig, "wp", {
      assetId: "zeus-portrait",
      styleTag: "u5-test",
      originalWorkAttribution: "",
    });

    expect(input.footprint).toBeUndefined();
    expect(input.originalWork).toEqual({ licence: "MIT" });
    expect(
      asset.record.manifest.provenance.licences.find(
        (licence) => licence.role === "original-work",
      ),
    ).toEqual({
      subject: "zeus-portrait",
      role: "original-work",
      licence: "MIT",
    });
    expect(asset.record.manifest.kind).toBe("portrait");
  });

  test("picked portrait frames require a still time in window args and pack when given", () => {
    const rig = newRig();
    const expressions = [...rig.content.vocabulary.expressions];
    const jobs = runSlots(
      rig,
      "picked-faces",
      "portrait",
      expressions.map((expression) => ({ expression })),
    );
    if (
      !rig.session.openWorkingSet(
        "picked-faces-set",
        "picked-faces",
        rig.content,
      ).ok
    )
      throw new Error("portrait working set could not be opened");
    for (const jobId of jobs)
      if (!rig.session.pick("picked-faces-set", jobId).ok)
        throw new Error(`could not pick ${jobId}`);

    const input = {
      selectedSet: setSummary(rig, "picked-faces-set"),
      assets: [],
      assetId: "zeus-portrait",
      styleTag: "u5-test",
      footprintWidth: "",
      footprintHeight: "",
      originalWorkLicence: "",
      originalWorkAttribution: "",
      stillFrameMs: "",
    };
    expect(buildPackArgs?.(input as never)).toBeUndefined();

    const { input: packedInput, asset } = packThroughSession(
      rig,
      "picked-faces-set",
      {
        assetId: "zeus-portrait",
        styleTag: "u5-test",
        stillFrameMs: "500",
      },
    );
    expect(packedInput.stillFrameMs).toBe(500);
    expect(asset.record.manifest.kind).toBe("portrait");
  });

  test("fresh sprite window actions pick, open, export/import, finish and pack without an asset", async () => {
    expect(windowActions.pickCandidateForSet).toBeFunction();
    expect(windowActions.openWorkingSetEdit).toBeFunction();
    expect(windowActions.exportEditFallback).toBeFunction();
    expect(windowActions.importEditFallback).toBeFunction();
    expect(windowActions.readEditReport).toBeFunction();
    expect(windowActions.finishReviewedEdit).toBeFunction();
    expect(windowActions.packWorkingSet).toBeFunction();
    if (
      !windowActions.pickCandidateForSet ||
      !windowActions.openWorkingSetEdit ||
      !windowActions.exportEditFallback ||
      !windowActions.importEditFallback ||
      !windowActions.readEditReport ||
      !windowActions.finishReviewedEdit ||
      !windowActions.buildPackArgs ||
      !windowActions.packWorkingSet
    )
      return;

    const rig = newRig();
    const [jobId] = runSlots(rig, "fresh-sprite", "sprite", [
      { state: "idle", direction: "south" },
    ]);
    if (!jobId) throw new Error("sprite request has no job");
    if (
      !rig.session.openWorkingSet(
        "fresh-sprite-set",
        "fresh-sprite",
        rig.content,
      ).ok
    )
      throw new Error("fresh sprite working set could not be opened");
    expect(rig.session.store.status().assets).toHaveLength(0);

    const cell = { w: 64, h: 80 };
    const exportedSheet = sheetOf(cell, [
      {
        slot: "idle/south",
        frames: [0, 1, 2, 3].map((marker) =>
          paintFigure(rig.content, cell, marker),
        ),
      },
    ]);
    const transport = fakeTransport();
    transport.answer("studio_call", (callArgs) => {
      const op = callArgs?.op;
      const args = (callArgs?.args ?? {}) as Record<string, unknown>;
      if (op === "pick") {
        const result = rig.session.pick(
          String(args.workingSetId),
          String(args.candidateId),
          String(args.slot),
        );
        if (!result.ok) throw hostError(result.reason, result.message);
        return result;
      }
      if (op === "edit-report") {
        const result = sdkEditReport(rig.root, String(args.id));
        if (!result.ok) throw hostError(result.reason, result.message);
        const { ok: _ok, ...report } = result;
        return report;
      }
      if (op === "pack") {
        const result = rig.session.pack(
          args as unknown as PackInput,
          rig.content,
          rig.palettes,
          rig.registryRoot,
        );
        if (!result.ok) throw hostError(result.reason, result.message);
        return result;
      }
      throw hostError("unknown-op", String(op));
    });
    transport.answer("edit_open", (args) => {
      const editId = String(args?.editId);
      const workingSetId = String(args?.workingSetId);
      const slots = (args?.slots as readonly string[]) ?? [];
      const result = rig.session.openEdit(
        editId,
        workingSetId,
        slots,
        rig.content,
      );
      if (!result.ok) throw hostError(result.reason, result.message);
      const opened = rig.session.store.readEdit(editId);
      if (opened.kind !== "found") throw new Error("SDK did not persist edit");
      return {
        editId,
        slots,
        workspace: { size: opened.value.cell, durationsMs: [167], tags: [] },
        editor: { launched: false, reason: "editor-unavailable" },
      };
    });
    transport.answer("edit_export", (args) => ({
      cancelled: false,
      editId: String(args?.editId),
      files: ["sheet.png", "sheet.json"],
    }));
    transport.answer("edit_import", (args) => {
      const editId = String(args?.editId);
      const finish = args?.finish === true;
      const result = finish
        ? rig.session.finishEdit(
            editId,
            exportedSheet.png,
            exportedSheet.json,
            rig.content,
            undefined,
            // The hash the app named, as the real session checks it against the picked sheet.
            args?.reviewed as never,
          )
        : rig.session.importEdit(
            editId,
            exportedSheet.png,
            exportedSheet.json,
            rig.content,
          );
      if (!result.ok) throw hostError(result.reason, result.message);
      return {
        cancelled: false,
        editId,
        state: finish ? "finished" : "imported",
        changed: result.changed,
      };
    });
    const host = createStudioHost(transport);

    const candidateId = rig.session.store.status().candidates[0]?.id;
    if (!candidateId) throw new Error("generated job has no candidate");
    await windowActions.pickCandidateForSet(host, "fresh-sprite-set", {
      id: candidateId,
      slotKey: "idle/south",
    });
    expect(transport.to("studio_call")[0]?.args).toEqual({
      op: "pick",
      args: {
        workingSetId: "fresh-sprite-set",
        candidateId,
        slot: "idle/south",
      },
    });
    const set = setSummary(rig, "fresh-sprite-set");
    const opened = await windowActions.openWorkingSetEdit(
      host,
      set,
      "edit-fresh-sprite",
    );
    expect(opened.editor.launched).toBe(false);
    expect(transport.to("edit_open")[0]?.args).toEqual({
      editId: "edit-fresh-sprite",
      workingSetId: "fresh-sprite-set",
      slots: ["idle/south"],
    });
    await windowActions.exportEditFallback(host, opened.editId);
    await windowActions.importEditFallback(host, opened.editId);
    expect(transport.to("edit_export")).toHaveLength(1);
    expect(transport.to("edit_import")[0]?.args).toEqual({
      editId: opened.editId,
      finish: false,
    });
    const report = await windowActions.readEditReport(host, opened.editId);
    if (!report) throw new Error("fallback import produced no edit report");
    expect(
      await windowActions.finishReviewedEdit(
        host,
        opened.editId,
        report,
        false,
      ),
    ).toEqual({ kind: "finished" });

    const finishedSet = setSummary(rig, "fresh-sprite-set");
    const packArgs = windowActions.buildPackArgs({
      selectedSet: finishedSet,
      assets: [],
      assetId: "zeus-idle-south",
      styleTag: "u5-test",
      footprintWidth: "1",
      footprintHeight: "1",
      originalWorkLicence: "MIT",
      originalWorkAttribution: "",
      stillFrameMs: "",
    } as never);
    if (!packArgs) throw new Error("fresh pack form args were refused");
    await windowActions.packWorkingSet(host, packArgs);
    expect(transport.to("edit_import")[1]?.args).toEqual({
      editId: opened.editId,
      finish: true,
      reviewed: report.sheetHash,
    });
    expect(rig.session.store.status().assets).toHaveLength(1);
    expect(rig.session.store.status().workingSets[0]?.status).toBe("complete");
  });

  test("packs a second revision of the same asset with a fresh record id", () => {
    const rig = newRig();
    spriteSet(rig);

    const first = packThroughSession(rig, "w", {
      assetId: "placeholder-zeus",
      styleTag: "u5-test",
    });
    const second = packThroughSession(rig, "w", {
      assetId: "placeholder-zeus",
      styleTag: "u5-test",
    });

    expect(first.input.id).toBe("record-placeholder-zeus-1");
    expect(second.input.id).toBe("record-placeholder-zeus-2");
    expect(second.asset.assetId).toBe(first.asset.assetId);
  });
});

/** The published zeus-sprite in the registry copy the rig packs against. */
function canonSprite(rig: AssetRig) {
  const index = JSON.parse(
    readFileSync(join(rig.registryRoot, "index.json"), "utf8"),
  ) as { entries: { assetId: string; revision: string }[] };
  const revision = index.entries.find((e) => e.assetId === "zeus-sprite")
    ?.revision as string;
  const manifest = JSON.parse(
    readFileSync(
      join(rig.registryRoot, "manifests", `${revision}.json`),
      "utf8",
    ),
  );
  const atlas = decodePng(
    new Uint8Array(
      readFileSync(
        join(rig.registryRoot, "blobs", `${manifest.atlas.blob}.png`),
      ),
    ),
  );
  if (!atlas.ok) throw new Error("the canon atlas does not decode");
  return { revision, manifest, atlas: atlas.image };
}

function cellBytes(image: { rgba: Uint8Array; width: number }, x: number) {
  const cell = { w: 64, h: 80 };
  const out = new Uint8Array(cell.w * cell.h * 4);
  for (let row = 0; row < cell.h; row += 1)
    out.set(
      image.rgba.subarray(
        (row * image.width + x) * 4,
        (row * image.width + x + cell.w) * 4,
      ),
      row * cell.w * 4,
    );
  return out;
}

/** A finished seated/south working set of two frames: a new state for the published zeus-sprite. */
function seatedSet(rig: AssetRig) {
  const [jobId] = runSlots(rig, "zeus-seated", "sprite", [
    { state: "seated", direction: "south" },
  ]);
  if (!jobId) throw new Error("seated request has no job");
  if (!rig.session.openWorkingSet("seated-set", "zeus-seated", rig.content).ok)
    throw new Error("seated working set could not be opened");
  if (!rig.session.pick("seated-set", jobId).ok) throw new Error("pick");
  const cell = { w: 64, h: 80 };
  finishSheet(
    rig,
    "seated-edit",
    "seated-set",
    cell,
    [
      {
        slot: "seated/south",
        frames: [0, 1].map((marker) => paintFigure(rig.content, cell, marker)),
        durations: [500, 500],
        pivot: { x: 32, y: 80 },
      },
    ],
    { method: "script", description: "stand-in for a scripted composite" },
  );
}

describe("adding a state to a published asset through the window's pack args", () => {
  test("the carried idle cells and timings are byte-identical to canon and the report credits the published revision", () => {
    const rig = newRig();
    seatedSet(rig);
    const canon = canonSprite(rig);

    const { input, asset } = packThroughSession(rig, "seated-set", {
      assetId: "zeus-sprite",
      styleTag: "panthea-pixel-v1",
    });

    expect(Object.keys(input).sort()).toEqual([
      "assetId",
      "footprint",
      "id",
      "originalWork",
      "styleTag",
      "workingSetId",
    ]);
    expect<string | null>(asset.prior).toBe(canon.revision);
    const manifest = asset.record.manifest;
    if (manifest.kind !== "sprite") throw new Error("expected a sprite");
    expect<unknown>(manifest.provenance.sourceAssets).toEqual([
      { assetId: "zeus-sprite", revision: canon.revision },
    ]);
    const idle = manifest.animations.find((a) => a.state === "idle");
    const was = canon.manifest.animations.find(
      (a: { state: string }) => a.state === "idle",
    );
    expect(idle?.frames.map((f) => f.durationMs)).toEqual([333, 167, 333, 167]);
    expect(idle?.frames.map((f) => f.durationMs)).toEqual(
      was.frames.map((f: { durationMs: number }) => f.durationMs),
    );
    const atlas = decodePng(
      rig.session.store.readBlob(manifest.atlas.blob) as Uint8Array,
    );
    if (!atlas.ok) throw new Error("the packed atlas does not decode");
    idle?.frames.forEach((frame, index) => {
      expect(cellBytes(atlas.image, frame.rect.x)).toEqual(
        cellBytes(canon.atlas, was.frames[index].rect.x),
      );
    });
    expect(
      manifest.animations.find((a) => a.state === "seated")?.frames,
    ).toHaveLength(2);

    const report =
      asset.record.state === "draft" ? asset.record.report : undefined;
    if (!report) throw new Error("the packed record has no report");
    // canon now also holds the thunderbolt act: it is carried beside idle, and the set's own seated replaces canon's
    expect<unknown>(report.carried).toEqual([
      { key: "idle/south", revision: canon.revision },
      { key: "act/south/thunderbolt", revision: canon.revision },
    ]);
    const act = manifest.animations.find((a) => a.state === "act");
    const wasAct = canon.manifest.animations.find(
      (a: { state: string }) => a.state === "act",
    );
    expect(act?.frames.map((f) => f.durationMs)).toEqual([
      83, 100, 83, 83, 100,
    ]);
    expect(act?.frames.map((f) => f.durationMs)).toEqual(
      wasAct.frames.map((f: { durationMs: number }) => f.durationMs),
    );
    act?.frames.forEach((frame, index) => {
      expect(cellBytes(atlas.image, frame.rect.x)).toEqual(
        cellBytes(canon.atlas, wasAct.frames[index].rect.x),
      );
    });
    const names = report.checks.map((c) => c.check);
    expect(names.some((n) => n.startsWith("seated/south#0:"))).toBe(true);
    expect(names.some((n) => n.startsWith("idle/south"))).toBe(false);
    expect(names.some((n) => n.startsWith("act/south/thunderbolt"))).toBe(
      false,
    );
  });

  test("the pack command sends no conformance settings for the carried cells", async () => {
    const rig = newRig();
    seatedSet(rig);
    const transport = fakeTransport();
    transport.answer("studio_call", (callArgs) => {
      const result = rig.session.pack(
        (callArgs?.args ?? {}) as unknown as PackInput,
        rig.content,
        rig.palettes,
        rig.registryRoot,
      );
      if (!result.ok) throw hostError(result.reason, result.message);
      return result;
    });
    const host = createStudioHost(transport);
    const args = buildPackArgs?.({
      selectedSet: setSummary(rig, "seated-set"),
      assets: [],
      assetId: "zeus-sprite",
      styleTag: "panthea-pixel-v1",
      footprintWidth: "1",
      footprintHeight: "1",
      originalWorkLicence: "MIT",
      originalWorkAttribution: "",
    });
    if (!args || !windowActions.packWorkingSet)
      throw new Error("the window produced no pack args");

    await windowActions.packWorkingSet(host, args);

    const sent = transport.to("studio_call")[0]?.args as {
      op: string;
      args: Record<string, unknown>;
    };
    expect(sent.op).toBe("pack");
    expect("carriedParams" in sent.args).toBe(false);
    expect(rig.session.store.status().assets).toHaveLength(1);
  });
});

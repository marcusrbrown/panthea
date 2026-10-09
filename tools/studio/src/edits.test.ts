import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  type EditorAdapter,
  readStudioStatus,
  type StudioSession,
} from "@panthea/assets/studio";
import {
  type AssetRig,
  paintFigure,
  runSlots,
  sheetOf,
} from "../../../packages/assets/src/studio/_test-fixtures";
import {
  assetRig,
  capture,
  depsFor,
  removeTempRoots,
  run,
  waitFor,
} from "./_testkit";
import { execute } from "./commands";
import type { StudioConfig } from "./config";
import { exitOf } from "./format";
import { Studio } from "./host";

afterEach(removeTempRoots);

const CELL = { w: 64, h: 80 };
const scratch = () => mkdtempSync(join(tmpdir(), "studio-cli-edit-"));

/** A picked idle/south set, ready for an edit; the SDK session is closed so the CLI owns the root. */
function pickedSet() {
  const rig = assetRig();
  const [id] = runSlots(rig, "zeus-idle", "sprite", [
    { state: "idle", direction: "south" },
  ]);
  rig.session.openWorkingSet("w", "zeus-idle", rig.content);
  rig.session.pick("w", id as string);
  rig.session.close();
  const config: StudioConfig = {
    studioRoot: rig.root,
    contentRoot: "/content",
    editor: { timeoutMs: 1000, editPollMs: 15 },
  };
  const over = {
    loadContent: () => ({ ok: true as const, content: rig.content }),
  };
  return { rig, config, over };
}

const four = (rig: AssetRig, n = 0) =>
  [0, 1, 2, 3].map((i) => paintFigure(rig.content, CELL, i + n));

/** An editor adapter that builds a workspace file and records what the CLI asks of it. */
function fakeEditor(
  session: StudioSession,
  calls: string[],
  failure?: { reason: string; message: string },
): EditorAdapter {
  return {
    openWorkspace: async (id) => {
      calls.push(`open ${id}`);
      if (failure !== undefined) return { ok: false, ...failure } as never;
      session.store.putEditFile(
        id,
        "workspace.aseprite",
        new TextEncoder().encode("workspace-v1"),
      );
      return {
        ok: true,
        readback: {
          rgb: true,
          size: { w: 64, h: 80 },
          durationsMs: [167],
          tags: [{ name: "idle/south", from: 1, to: 1, repeats: 0 }],
          pivots: {},
          palette: [],
        },
      };
    },
    refresh: async (id, _content, mode) => {
      calls.push(`${mode} ${id}`);
      return { ok: true, changed: true };
    },
    refreshFallback: () => ({
      ok: false,
      reason: "wrong-state",
      message: "unused",
    }),
    close: async () => {
      calls.push("close");
    },
  };
}

describe("editing with files and no editor", () => {
  test("export writes the stored sheet and metadata, the owner edits them, and finish takes the files back with no editor configured", async () => {
    const { rig, config, over } = pickedSet();
    const dir = scratch();
    const open = new Studio(config, depsFor(capture(), over), "oneshot");
    const session = open.owner();
    if ("ok" in session) throw new Error("busy");
    session.openEdit("e1", "w", ["idle/south"], rig.content);
    await open.teardown();

    const exported = await run(config, "export", { id: "e1", dir }, over);

    expect(exported.outcome).toMatchObject({
      ok: true,
      result: { editId: "e1", files: ["sheet.png", "sheet.json"] },
    });
    expect(readFileSync(join(dir, "sheet.json"), "utf8")).toBe(
      readFileSync(join(rig.root, "edits", "e1", "sheet.json"), "utf8"),
    );
    const sheet = sheetOf(CELL, [
      { slot: "idle/south", frames: four(rig, 20) },
    ]);
    writeFileSync(join(dir, "edited.png"), sheet.png);
    writeFileSync(join(dir, "edited.json"), sheet.json);

    const imported = await run(
      config,
      "import",
      {
        id: "e1",
        png: join(dir, "edited.png"),
        json: join(dir, "edited.json"),
      },
      over,
    );
    const finished = await run(
      config,
      "finish",
      {
        id: "e1",
        png: join(dir, "edited.png"),
        json: join(dir, "edited.json"),
      },
      over,
    );

    expect(imported.outcome).toMatchObject({
      ok: true,
      result: { state: "imported", changed: true },
    });
    expect(finished.outcome).toMatchObject({
      ok: true,
      result: { state: "finished", changed: true },
    });
    const set = readStudioStatus(rig.root).workingSets[0];
    expect(
      set?.frames["idle/south"]?.handEdits.map((h) => h.description),
    ).toEqual(["hand edit e1"]);
    expect(set?.status).toBe("complete");
  });

  test("finish with --method script and a --description records a script step; the default stays a hand edit", async () => {
    const { rig, config, over } = pickedSet();
    const dir = scratch();
    const open = new Studio(config, depsFor(capture(), over), "oneshot");
    const session = open.owner();
    if ("ok" in session) throw new Error("busy");
    session.openEdit("e1", "w", ["idle/south"], rig.content);
    await open.teardown();
    const sheet = sheetOf(CELL, [
      { slot: "idle/south", frames: four(rig, 20) },
    ]);
    writeFileSync(join(dir, "edited.png"), sheet.png);
    writeFileSync(join(dir, "edited.json"), sheet.json);
    const files = {
      png: join(dir, "edited.png"),
      json: join(dir, "edited.json"),
    };
    const description =
      "scripted idle loop (tools/probes/art-edit/sprite_idle_c2.py)";

    const finished = await run(
      config,
      "finish",
      { id: "e1", ...files, method: "script", description },
      over,
    );

    expect(finished.outcome).toMatchObject({
      ok: true,
      result: { state: "finished", changed: true },
    });
    const step = readStudioStatus(rig.root).workingSets[0]?.frames["idle/south"]
      ?.handEdits[0];
    expect(step).toMatchObject({ description, method: "script" });
  });

  test("a scripted finish needs a description, an unknown method is refused, and method or description need the files", async () => {
    const { config, over } = pickedSet();
    const files = { png: "/x.png", json: "/x.json" };

    const noDescription = await run(
      config,
      "finish",
      { id: "e1", ...files, method: "script" },
      over,
    );
    const unknown = await run(
      config,
      "finish",
      { id: "e1", ...files, method: "magic", description: "x" },
      over,
    );
    const noFiles = await run(
      config,
      "finish",
      { id: "e1", method: "script", description: "x" },
      over,
    );
    const emptyDescription = await run(
      config,
      "finish",
      { id: "e1", ...files, method: "hand", description: "" },
      over,
    );

    for (const result of [noDescription, unknown, noFiles, emptyDescription]) {
      expect(result.outcome).toMatchObject({
        ok: false,
        error: { code: "invalid-arguments" },
      });
      expect(exitOf(result.outcome)).toBe(64);
    }
  });

  test("finish and import need both files or neither, and a missing editor config is a usage error when no files are given", async () => {
    const { config, over } = pickedSet();
    const { editor: _editor, ...noEditor } = config;

    const half = await run(config, "finish", { id: "e1", png: "/x.png" }, over);
    const other = await run(
      config,
      "import",
      { id: "e1", json: "/x.json" },
      over,
    );
    const unreadable = await run(
      config,
      "finish",
      { id: "e1", png: "/nope.png", json: "/nope.json" },
      over,
    );
    const none = await run(noEditor, "finish", { id: "e1" }, over);

    expect(half.outcome).toMatchObject({
      ok: false,
      error: { code: "invalid-arguments" },
    });
    expect(other.outcome).toMatchObject({
      ok: false,
      error: { code: "invalid-arguments" },
    });
    expect(unreadable.outcome).toMatchObject({
      ok: false,
      error: { code: "invalid-arguments" },
    });
    expect(none.outcome).toMatchObject({
      ok: false,
      error: { code: "missing-config", field: "editor" },
    });
    expect(exitOf(none.outcome)).toBe(64);
  });

  test("an unedited export is refused by finish, as is a sheet the SDK does not accept", async () => {
    const { rig, config, over } = pickedSet();
    const dir = scratch();
    const open = new Studio(config, depsFor(capture(), over), "oneshot");
    const session = open.owner();
    if ("ok" in session) throw new Error("busy");
    session.openEdit("e1", "w", ["idle/south"], rig.content);
    await open.teardown();
    await run(config, "export", { id: "e1", dir }, over);
    writeFileSync(join(dir, "bad.png"), "not a png");

    const unedited = await run(
      config,
      "finish",
      { id: "e1", png: join(dir, "sheet.png"), json: join(dir, "sheet.json") },
      over,
    );
    const bad = await run(
      config,
      "finish",
      { id: "e1", png: join(dir, "bad.png"), json: join(dir, "sheet.json") },
      over,
    );

    expect(unedited.outcome).toMatchObject({
      ok: false,
      error: { code: "wrong-state" },
    });
    expect(bad.outcome.ok).toBe(false);
    expect(readStudioStatus(rig.root).workingSets[0]?.frames).toEqual({});
  });

  test("discard ends the edit and leaves the working set byte-identical", async () => {
    const { rig, config, over } = pickedSet();
    const open = new Studio(config, depsFor(capture(), over), "oneshot");
    const session = open.owner();
    if ("ok" in session) throw new Error("busy");
    session.openEdit("e1", "w", ["idle/south"], rig.content);
    await open.teardown();
    const before = readFileSync(
      join(rig.root, "working-sets", "w.json"),
      "utf8",
    );

    const discarded = await run(config, "discard", { id: "e1" }, over);

    expect(discarded.outcome).toMatchObject({
      ok: true,
      result: { editId: "e1", state: "discarded" },
    });
    expect(readFileSync(join(rig.root, "working-sets", "w.json"), "utf8")).toBe(
      before,
    );
    expect(readStudioStatus(rig.root).edits[0]?.status).toBe("discarded");
  });
});

describe("opening an edit in the editor", () => {
  test("builds the workspace, answers with its public metadata, and imports a changed workspace once by content hash until the edit is finished", async () => {
    const { rig, config, over } = pickedSet();
    const calls: string[] = [];
    const cap = capture();
    const studio = new Studio(
      config,
      depsFor(cap, {
        ...over,
        createEditor: (session) => fakeEditor(session, calls),
      }),
      "session",
    );
    try {
      const opened = await execute(studio, "open", {
        id: "e1",
        workingSetId: "w",
        slots: ["idle/south"],
      });
      expect(opened).toMatchObject({
        ok: true,
        result: {
          editId: "e1",
          slots: ["idle/south"],
          workspace: { durationsMs: [167], tags: [{ name: "idle/south" }] },
        },
      });
      const file = join(rig.root, "edits", "e1", "workspace.aseprite");
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(calls).toEqual(["open e1"]);

      writeFileSync(file, "workspace-v1");
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(calls).toEqual(["open e1"]);

      writeFileSync(file, "workspace-v2");
      await waitFor(() => calls.includes("import e1"));
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(calls.filter((c) => c === "import e1")).toHaveLength(1);
      expect(studio.hasWatches).toBe(true);

      const finished = await execute(studio, "finish", { id: "e1" });
      expect(finished).toMatchObject({
        ok: true,
        result: { state: "finished" },
      });
      expect(studio.hasWatches).toBe(false);
      writeFileSync(file, "workspace-v3");
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(calls.filter((c) => c === "import e1")).toHaveLength(1);
      expect(calls).toContain("finish e1");
    } finally {
      await studio.teardown();
    }
    expect(calls.at(-1)).toBe("close");
    expect(cap.err.join("\n")).toContain("edit e1 imported");
  });

  test("replies with the workspace file's location for a host that launches the editor itself, and keeps every other reply field", async () => {
    const { rig, config, over } = pickedSet();

    const { outcome } = await run(
      config,
      "open",
      { id: "e1", workingSetId: "w", slots: ["idle/south"] },
      { ...over, createEditor: (session) => fakeEditor(session, []) },
    );

    const file = join(rig.root, "edits", "e1", "workspace.aseprite");
    expect(outcome).toEqual({
      ok: true,
      result: {
        editId: "e1",
        slots: ["idle/south"],
        workspace: {
          size: { w: 64, h: 80 },
          durationsMs: [167],
          tags: [{ name: "idle/south", from: 1, to: 1 }],
        },
        workspacePath: file,
      },
    });
    expect(isAbsolute(file)).toBe(true);
    expect(existsSync(file)).toBe(true);
  });

  test("an editor that is not there is reported with fallback guidance, no editor output leaks, and the edit stays open for a hand export", async () => {
    const { rig, config, over } = pickedSet();
    const { outcome } = await run(
      config,
      "open",
      { id: "e1", workingSetId: "w", slots: ["idle/south"] },
      {
        ...over,
        createEditor: (session) =>
          fakeEditor(session, [], {
            reason: "editor-failed",
            message:
              "the editor exited (exit code 3). Output: SECRET-EDITOR-TAIL",
          }),
      },
    );

    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: "editor-failed",
        editId: "e1",
        guidance: expect.stringContaining("export"),
      },
    });
    expect(exitOf(outcome)).toBe(1);
    expect(JSON.stringify(outcome)).not.toContain("SECRET-EDITOR-TAIL");
    expect(readStudioStatus(rig.root).edits[0]?.status).toBe("open");
  });

  test("slots must be an array of slot keys and an unknown working set is refused", async () => {
    const { config, over } = pickedSet();
    const make = (session: StudioSession) => fakeEditor(session, []);

    const bad = await run(
      config,
      "open",
      { id: "e1", workingSetId: "w", slots: [1] },
      { ...over, createEditor: make },
    );
    const unknown = await run(
      config,
      "open",
      { id: "e1", workingSetId: "nope", slots: ["idle/south"] },
      { ...over, createEditor: make },
    );

    expect(bad.outcome).toMatchObject({
      ok: false,
      error: { code: "invalid-arguments" },
    });
    expect(unknown.outcome).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });
});

void existsSync;
void mkdirSync;

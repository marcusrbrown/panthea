// Opening an edit with no editor, and relaunching an edit that is already
// open. `open` creates an edit; `edit-workspace` is the idempotent path for an
// existing one: it names the workspace file again, rebuilds it only when it is
// gone, and makes sure the session is watching it.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  heldBy,
  removeTempRoots,
  run,
  waitFor,
} from "./_testkit";
import { execute, opSpec, READ_ONLY } from "./commands";
import type { StudioConfig } from "./config";
import { exitOf } from "./format";
import { Studio } from "./host";

afterEach(removeTempRoots);

const CELL = { w: 64, h: 80 };

function pickedSet() {
  const rig = assetRig();
  const [id] = runSlots(rig, "zeus-idle", "sprite", [
    { state: "idle", direction: "south" },
  ]);
  rig.session.openWorkingSet("w", "zeus-idle", rig.content);
  rig.session.pick("w", id as string);
  rig.session.close();
  const over = {
    loadContent: () => ({ ok: true as const, content: rig.content }),
  };
  const base: StudioConfig = { studioRoot: rig.root, contentRoot: "/content" };
  return {
    rig,
    over,
    withEditor: {
      ...base,
      editor: { timeoutMs: 1000, editPollMs: 15 },
    } satisfies StudioConfig,
    noEditor: base,
  };
}

/** An editor adapter that builds a workspace file and records what is asked of it. */
function fakeEditor(session: StudioSession, calls: string[]): EditorAdapter {
  return {
    openWorkspace: async (id) => {
      calls.push(`build ${id}`);
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
    close: async () => {},
  };
}

const sessionStudio = (
  config: StudioConfig,
  over: object,
  calls: string[],
  mode: "session" | "oneshot" = "session",
) =>
  new Studio(
    config,
    depsFor(capture(), {
      ...over,
      createEditor: (session: StudioSession) => fakeEditor(session, calls),
    }),
    mode,
  );

const OPEN = (editId = "e1") => ({
  id: editId,
  workingSetId: "w",
  slots: ["idle/south"],
});

type Reply = {
  editId: string;
  slots: string[];
  workspace: {
    size: { w: number; h: number };
    durationsMs: number[];
    tags: { name: string; from: number; to: number }[];
  };
  workspacePath: string | null;
};
const replyOf = (outcome: Awaited<ReturnType<typeof execute>>): Reply => {
  if (!outcome.ok) throw new Error(JSON.stringify(outcome));
  return outcome.result as unknown as Reply;
};

describe("open with no editor configured", () => {
  test("creates the edit and replies without a workspace, so export and import can be offered", async () => {
    const { rig, over, noEditor } = pickedSet();

    const opened = await run(noEditor, "open", OPEN(), over);

    expect(opened.outcome.ok).toBe(true);
    const reply = replyOf(opened.outcome);
    expect(reply).toEqual({
      editId: "e1",
      slots: ["idle/south"],
      workspace: {
        size: { w: 64, h: 80 },
        durationsMs: expect.any(Array),
        tags: [{ name: "idle/south", from: 1, to: 1 }],
      },
      workspacePath: null,
    });
    expect(reply.workspace.durationsMs).toHaveLength(1);
    expect(JSON.stringify(reply)).not.toContain(rig.root);
    const edit = readStudioStatus(rig.root).edits.find((e) => e.id === "e1");
    expect(edit?.status).toBe("open");
    expect(existsSync(join(rig.root, "edits", "e1", "sheet.png"))).toBe(true);
    expect(
      existsSync(join(rig.root, "edits", "e1", "workspace.aseprite")),
    ).toBe(false);
  });

  test("the files path then works end to end: export, edit by hand, finish", async () => {
    const { rig, over, noEditor } = pickedSet();
    await run(noEditor, "open", OPEN(), over);
    const dir = join(rig.root, "..", "exported");

    const exported = await run(noEditor, "export", { id: "e1", dir }, over);
    const sheet = sheetOf(CELL, [
      {
        slot: "idle/south",
        frames: [0, 1, 2, 3].map((i) => paintFigure(rig.content, CELL, i + 20)),
      },
    ]);
    writeFileSync(join(dir, "edited.png"), sheet.png);
    writeFileSync(join(dir, "edited.json"), sheet.json);
    const finished = await run(
      noEditor,
      "finish",
      {
        id: "e1",
        png: join(dir, "edited.png"),
        json: join(dir, "edited.json"),
      },
      over,
    );
    rmSync(dir, { recursive: true, force: true });

    expect(exported.outcome).toMatchObject({
      ok: true,
      result: { editId: "e1", files: ["sheet.png", "sheet.json"] },
    });
    expect(finished.outcome).toMatchObject({ ok: true });
    expect(readStudioStatus(rig.root).edits[0]?.status).toBe("finished");
  });

  test("a session starts no watch for it, and a second open of the same id is still refused", async () => {
    const { over, noEditor } = pickedSet();
    const calls: string[] = [];
    const studio = sessionStudio(noEditor, over, calls);
    try {
      expect((await execute(studio, "open", OPEN())).ok).toBe(true);
      expect(studio.hasWatches).toBe(false);
      expect(await execute(studio, "open", OPEN())).toMatchObject({
        ok: false,
        error: { code: "wrong-state" },
      });
      expect(calls).toEqual([]);
    } finally {
      await studio.teardown();
    }
  });
});

describe("edit-workspace on an edit that is already open", () => {
  test("is a write op that is not read-only, takes an id and nothing else, and is in the op table", () => {
    expect(opSpec("edit-workspace")).toBeDefined();
    expect(READ_ONLY.has("edit-workspace")).toBe(false);
    expect(Object.keys(opSpec("edit-workspace")?.spec ?? {})).toEqual(["id"]);
  });

  test("names the existing workspace file again without rebuilding it, and starts watching it", async () => {
    const { rig, over, withEditor } = pickedSet();
    const calls: string[] = [];
    const studio = sessionStudio(withEditor, over, calls);
    try {
      await execute(studio, "open", OPEN());
      const file = join(rig.root, "edits", "e1", "workspace.aseprite");
      writeFileSync(file, "saved-by-the-owner");
      studio.unwatchEdit("e1");
      expect(studio.hasWatches).toBe(false);
      calls.length = 0;

      const again = await execute(studio, "edit-workspace", { id: "e1" });

      const reply = replyOf(again);
      expect(reply).toMatchObject({
        editId: "e1",
        slots: ["idle/south"],
        workspace: { size: { w: 64, h: 80 } },
      });
      expect(reply.workspacePath).toBe(file);
      expect(readFileSync(file, "utf8")).toBe("saved-by-the-owner");
      expect(calls).toEqual([]);
      expect(studio.hasWatches).toBe(true);

      writeFileSync(file, "saved-again");
      await waitFor(() => calls.includes("import e1"));
    } finally {
      await studio.teardown();
    }
  });

  test("asking twice keeps one watch: a change is imported once", async () => {
    const { rig, over, withEditor } = pickedSet();
    const calls: string[] = [];
    const studio = sessionStudio(withEditor, over, calls);
    try {
      await execute(studio, "open", OPEN());
      await execute(studio, "edit-workspace", { id: "e1" });
      await execute(studio, "edit-workspace", { id: "e1" });
      calls.length = 0;

      writeFileSync(
        join(rig.root, "edits", "e1", "workspace.aseprite"),
        "changed once",
      );
      await waitFor(() => calls.includes("import e1"));
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(calls.filter((c) => c === "import e1")).toHaveLength(1);
    } finally {
      await studio.teardown();
    }
  });

  test("rebuilds the workspace only when the file is gone", async () => {
    const { rig, over, withEditor } = pickedSet();
    const calls: string[] = [];
    const studio = sessionStudio(withEditor, over, calls);
    try {
      await execute(studio, "open", OPEN());
      rmSync(join(rig.root, "edits", "e1", "workspace.aseprite"));
      calls.length = 0;

      const again = await execute(studio, "edit-workspace", { id: "e1" });

      expect(calls).toEqual(["build e1"]);
      expect(replyOf(again).workspacePath).toBe(
        join(rig.root, "edits", "e1", "workspace.aseprite"),
      );
    } finally {
      await studio.teardown();
    }
  });

  test("answers from the latest save: its frame timing and the strip's size", async () => {
    const { rig, over, withEditor } = pickedSet();
    const calls: string[] = [];
    const studio = sessionStudio(withEditor, over, calls);
    try {
      await execute(studio, "open", OPEN());
      const edited = sheetOf(CELL, [
        {
          slot: "idle/south",
          frames: [0, 1, 2].map((i) => paintFigure(rig.content, CELL, i + 30)),
          durations: [123, 167, 250],
        },
      ]);
      const owner = studio.owner() as StudioSession;
      expect(
        owner.importEdit("e1", edited.png, edited.json, rig.content),
      ).toMatchObject({ ok: true });

      const again = replyOf(
        await execute(studio, "edit-workspace", { id: "e1" }),
      );

      expect(again.workspace.durationsMs).toEqual([123, 167, 250]);
      expect(again.workspace.size).toEqual({ w: 192, h: 80 });
      expect(again.workspace.tags).toEqual([
        { name: "idle/south", from: 1, to: 3 },
      ]);
    } finally {
      await studio.teardown();
    }
  });

  test("with no editor configured it replies without a workspace and watches nothing", async () => {
    const { over, noEditor } = pickedSet();
    const calls: string[] = [];
    const studio = sessionStudio(noEditor, over, calls);
    try {
      await execute(studio, "open", OPEN());

      const again = replyOf(
        await execute(studio, "edit-workspace", { id: "e1" }),
      );

      expect(again.workspacePath).toBeNull();
      expect(again.workspace.tags).toEqual([
        { name: "idle/south", from: 1, to: 1 },
      ]);
      expect(studio.hasWatches).toBe(false);
      expect(calls).toEqual([]);
    } finally {
      await studio.teardown();
    }
  });

  test("an unknown or malformed id is not-found; a finished or discarded edit is wrong-state; each writes nothing", async () => {
    const { rig, over, withEditor } = pickedSet();
    const calls: string[] = [];
    const studio = sessionStudio(withEditor, over, calls);
    try {
      const owner = studio.owner() as StudioSession;
      owner.openEdit("e2", "w", ["idle/south"], rig.content);
      expect(owner.discardEdit("e2")).toMatchObject({ ok: true });
      await execute(studio, "open", OPEN());
      const sheet = sheetOf(CELL, [
        {
          slot: "idle/south",
          frames: [0, 1, 2, 3].map((i) =>
            paintFigure(rig.content, CELL, i + 5),
          ),
        },
      ]);
      expect(
        owner.finishEdit("e1", sheet.png, sheet.json, rig.content),
      ).toMatchObject({ ok: true });
      const before = JSON.stringify(readStudioStatus(rig.root));
      calls.length = 0;

      const code = async (id: string) => {
        const outcome = await execute(studio, "edit-workspace", { id });
        return outcome.ok ? "ok" : outcome.error.code;
      };

      expect(await code("nope")).toBe("not-found");
      expect(await code("../../etc")).toBe("not-found");
      expect(await code("e1")).toBe("wrong-state");
      expect(await code("e2")).toBe("wrong-state");
      expect(
        exitOf(await execute(studio, "edit-workspace", { id: "e1" })),
      ).toBe(1);
      expect(JSON.stringify(readStudioStatus(rig.root))).toBe(before);
      expect(calls).toEqual([]);
    } finally {
      await studio.teardown();
    }
  });

  test("a session on a root another process holds refuses it as root-locked", async () => {
    const { rig, withEditor } = pickedSet();
    const studio = new Studio(
      withEditor,
      depsFor(capture(), heldBy(4242)),
      "session",
    );

    const outcome = await execute(studio, "edit-workspace", { id: "e1" });

    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "root-locked", holder: 4242 },
    });
    expect(rig.root).toBeString();
    await studio.teardown();
  });

  test("it never reveals more than the reply: no argument but the id is accepted", async () => {
    const { over, withEditor } = pickedSet();
    for (const args of [
      {},
      { id: "" },
      { id: "e1", path: "/tmp/x" },
      { id: "e1", dir: "/tmp" },
      { id: 4 },
    ]) {
      const { outcome } = await run(withEditor, "edit-workspace", args, over);
      expect(outcome.ok).toBe(false);
      expect(exitOf(outcome)).toBe(64);
    }
  });
});

export type { AssetRig };

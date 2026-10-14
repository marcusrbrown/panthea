// Releasing the writer lock when idle (plan U7). Everything here runs on fake
// dependencies: the clock is `Deps.schedule`, the runtime and the editor are
// fakes that record what they were asked, and the lock holder is a flag. No real
// timer, process or server is involved; the session and its store are real, so
// the lock, the queue and the records behave as they do in the app.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type DrainResult,
  type EditorAdapter,
  loadStudioContent,
  newRequestRecord,
  openStudioSession,
  readStudioStatus,
  renderEngineFor,
  type StudioRuntime,
  type StudioSession,
  type StudioStatus,
  studioPaths,
  type TeardownResult,
} from "@panthea/assets/studio";
import {
  capture,
  depsFor,
  REAL_CONTENT,
  removeTempRoots,
  tempRoot,
} from "../test/kit";
import { execute, opNames, READ_ONLY } from "./commands";

import type { StudioConfig } from "./config";
import { type Deps, RELEASE_GRACE_MS, Studio } from "./host";

afterEach(removeTempRoots);

const POLL_MS = 15;
const EDIT_POLL_MS = 10;
const TERM_GRACE_MS = 100;
const KILL_MS = 200;
/** What quit waits for a stopping server, plus the same 3 s margin. */
const RELEASE_BOUND_MS = TERM_GRACE_MS + KILL_MS + 3000;
const HOLDER = 4242;

const defer = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const flush = async () => {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
};

/** The injected clock: nothing runs unless a test fires it. */
function fakeClock() {
  const timers = new Map<number, { run: () => void; delayMs: number }>();
  let next = 1;
  const scheduled: number[] = [];
  let cancelled = 0;
  return {
    schedule: (run: () => void, delayMs: number) => {
      const id = next;
      next += 1;
      scheduled.push(delayMs);
      timers.set(id, { run, delayMs });
      return () => {
        if (timers.delete(id)) cancelled += 1;
      };
    },
    pending: (delayMs: number) =>
      [...timers.values()].filter((t) => t.delayMs === delayMs).length,
    scheduledCount: (delayMs: number) =>
      scheduled.filter((d) => d === delayMs).length,
    cancelledCount: () => cancelled,
    /** Runs every pending timer with this delay, once each. */
    fire(delayMs: number) {
      for (const [id, t] of [...timers])
        if (t.delayMs === delayMs) {
          timers.delete(id);
          t.run();
        }
    },
  };
}

interface FakeRuntime extends StudioRuntime {
  readonly index: number;
  shutdowns: number;
  drains: number;
}

interface FakeEditor extends EditorAdapter {
  readonly index: number;
  closes: number;
  readonly refreshes: { editId: string; mode: string; bytes: string }[];
}

type RefreshResult = Awaited<ReturnType<EditorAdapter["refresh"]>>;

function world() {
  const base = dirname(tempRoot());
  const root = join(base, "studio");
  const config: StudioConfig = {
    studioRoot: root,
    contentRoot: REAL_CONTENT,
    registryRoot: join(base, "registry"),
    artifactRoot: join(base, "artifacts"),
    runtime: {
      port: 1,
      pollMs: POLL_MS,
      deadlines: {
        httpMs: 1,
        startupMs: 1,
        generationMs: 1,
        termGraceMs: TERM_GRACE_MS,
        killMs: KILL_MS,
      },
    },
    editor: { timeoutMs: 1000, editPollMs: EDIT_POLL_MS },
  };
  const clock = fakeClock();
  const cap = capture();
  const state = {
    /** The pid of a fake CLI that holds the lock, if one does. */
    holder: undefined as number | undefined,
    opens: 0,
    runtimes: [] as FakeRuntime[],
    editors: [] as FakeEditor[],
    previews: { opened: 0, closed: 0 },
    /** When set, the next session open throws it (once), as a failing disk would. */
    openThrows: undefined as Error | undefined,
    drainGate: Promise.resolve() as Promise<void>,
    drainRefusal: undefined as DrainResult | undefined,
    /** Replaces the fake drain; gets the 1-based drain number and the session. */
    drainHook: undefined as
      | ((n: number, session: StudioSession) => DrainResult)
      | undefined,
    abortGate: Promise.resolve() as Promise<void>,
    shutdownCalls: 0,
    sleeps: 0,
    /** What each shutdown does; the n-th call (1-based, across runtimes) gets `n`. */
    shutdown: (async () => ({ ok: true })) as (
      n: number,
    ) => Promise<TeardownResult>,
    refresh: (async () => ({
      ok: true,
      changed: true,
    })) as unknown as () => Promise<RefreshResult>,
  };
  const fakeRuntime = (session: StudioSession): FakeRuntime => {
    const runtime: FakeRuntime = {
      index: state.runtimes.length,
      shutdowns: 0,
      drains: 0,
      async drain() {
        runtime.drains += 1;
        if (state.drainRefusal !== undefined) return state.drainRefusal;
        if (state.drainHook !== undefined)
          return state.drainHook(runtime.drains, session);
        await state.drainGate;
        const queued = session.queued();
        const results: Extract<DrainResult, { ok: true }>["results"][number][] =
          [];
        for (const { job } of queued.ok ? queued.jobs : []) {
          session.start(job.id);
          session.fail(job.id, "fixture failure");
          results.push({
            jobId: job.id,
            outcome: "failed",
            error: "fixture failure",
          });
        }
        return { ok: true, results, stopped: "empty" };
      },
      async abort() {
        await state.abortGate;
        return { ok: true };
      },
      close: async () => ({ ok: true }),
      async shutdown() {
        runtime.shutdowns += 1;
        state.shutdownCalls += 1;
        const result = await state.shutdown(state.shutdownCalls);
        if (result.ok) session.close();
        return result;
      },
    };
    return runtime;
  };
  const fakeEditor = (session: StudioSession): FakeEditor => {
    const editor: FakeEditor = {
      index: state.editors.length,
      closes: 0,
      refreshes: [],
      openWorkspace: async () => {
        throw new Error("not used");
      },
      async refresh(editId, _content, mode) {
        editor.refreshes.push({
          editId,
          mode,
          bytes: readFileSync(
            join(
              studioPaths(session.store.root).edits,
              editId,
              "workspace.aseprite",
            ),
            "utf8",
          ),
        });
        return state.refresh();
      },
      refreshFallback: () => {
        throw new Error("not used");
      },
      async close() {
        editor.closes += 1;
      },
    };
    return editor;
  };
  const over: Partial<Deps> = {
    schedule: clock.schedule,
    sleep: () => {
      state.sleeps += 1;
      return Promise.resolve();
    },
    isAlive: (pid) => pid === state.holder,
    openSession: (path) => {
      if (state.openThrows !== undefined) {
        const error = state.openThrows;
        state.openThrows = undefined;
        throw error;
      }
      state.opens += 1;
      return state.holder === undefined
        ? openStudioSession(path)
        : { kind: "busy" };
    },
    readStatus: (path): StudioStatus => {
      const real = readStudioStatus(path);
      return state.holder === undefined
        ? real
        : {
            ...real,
            session: {
              schemaVersion: 1,
              id: "other-session",
              pid: state.holder,
              startedAt: "2026-10-09T00:00:00.000Z",
            },
          };
    },
    openRuntime: (session) => {
      const runtime = fakeRuntime(session);
      state.runtimes.push(runtime);
      return runtime;
    },
    createEditor: (session) => {
      const editor = fakeEditor(session);
      state.editors.push(editor);
      return editor;
    },
    // A preview source watches two roots; counting the studio root's watcher counts the sources.
    watchRoot: (path) => {
      const mine = path === config.studioRoot;
      if (mine) state.previews.opened += 1;
      return () => {
        if (mine) state.previews.closed += 1;
      };
    },
  };
  const studio = new Studio(config, depsFor(cap, over), "session");
  return { studio, state, clock, cap, root, config };
}

type World = ReturnType<typeof world>;

const SOUTH = [{ state: "idle", direction: "south" }];
const generate = (w: World, id: string) =>
  execute(w.studio, "generate", {
    id,
    subject: "zeus",
    kind: "sprite",
    slots: SOUTH,
    batch: 1,
    seed: 1,
  });
const listJobs = (w: World) => execute(w.studio, "list", { kind: "jobs" });
const status = async (w: World) => {
  const outcome = await execute(w.studio, "status", {});
  if (!outcome.ok) throw new Error("status refused");
  return outcome.result as Record<string, unknown> & {
    rootLock: { holder: string; pid: number | null };
    idle: boolean;
    idleReason: string | null;
    releaseFailure: string | null;
  };
};
/** A write that needs the lock but no runtime, and is refused for a reason of its own. */
const touch = (w: World) => execute(w.studio, "remove", { jobId: "nope" });

/** A generation that has run and whose result the client has read: the app is idle. */
async function settled(w: World) {
  await generate(w, "zeus-idle");
  await w.studio.idle();
  await listJobs(w);
  await flush();
}

const lockIsFree = (root: string) => {
  const opened = openStudioSession(root);
  if (opened.kind === "opened") opened.session.close();
  return opened.kind === "opened";
};

describe("the lock is released when the app is idle", () => {
  test("the queue empties, the grace elapses, the lock is released, and the next generate re-acquires and runs on a new runtime", async () => {
    const w = world();
    await settled(w);
    expect(w.state.runtimes).toHaveLength(1);
    expect(w.clock.pending(RELEASE_GRACE_MS)).toBe(1);
    expect((await status(w)).rootLock.holder).toBe("self");
    // The preview source is up before the release.
    expect((await execute(w.studio, "source-list", {})).ok).toBe(true);
    expect(w.state.previews.opened).toBe(1);

    w.clock.fire(RELEASE_GRACE_MS);
    await flush();

    expect(w.state.runtimes[0]?.shutdowns).toBe(1);
    expect(w.state.previews.closed).toBe(1);
    expect((await status(w)).rootLock).toEqual({ holder: "none", pid: null });
    expect(lockIsFree(w.root)).toBe(true);
    expect(w.studio.stopping).toBe(false);

    const again = await generate(w, "zeus-idle-2");
    await w.studio.idle();

    expect(again).toMatchObject({ ok: true, result: { state: "queued" } });
    expect(w.state.runtimes).toHaveLength(2);
    expect(w.state.runtimes[1]?.drains).toBe(1);
    expect((await status(w)).rootLock.holder).toBe("self");
    // The preview source is rebuilt, so it reloads from the roots.
    expect((await execute(w.studio, "source-list", {})).ok).toBe(true);
    expect(w.state.previews.opened).toBe(2);
    await w.studio.teardown();
  });

  test("the grace is the injected scheduler's, and the status says when the app is idle", async () => {
    const w = world();
    await generate(w, "zeus-idle");
    await w.studio.idle();

    // The result has not reached the client: not idle, nothing scheduled.
    expect(await status(w)).toMatchObject({ idle: false });
    expect((await status(w)).idleReason).toMatch(/result/);
    expect(w.clock.pending(RELEASE_GRACE_MS)).toBe(0);

    await listJobs(w);

    expect(await status(w)).toMatchObject({ idle: true, idleReason: null });
    expect(w.clock.pending(RELEASE_GRACE_MS)).toBe(1);
    await w.studio.teardown();
  });

  test("a burst of writes inside the grace re-arms it and never releases and re-acquires", async () => {
    const w = world();
    await touch(w);
    expect(w.clock.scheduledCount(RELEASE_GRACE_MS)).toBe(1);

    await touch(w);
    await touch(w);

    // Reads between writes neither cancel nor re-arm the grace.
    const cancelled = w.clock.cancelledCount();
    await status(w);
    await execute(w.studio, "list", { kind: "jobs" });
    expect(w.clock.cancelledCount()).toBe(cancelled);
    expect(w.clock.scheduledCount(RELEASE_GRACE_MS)).toBe(3);
    expect(w.clock.pending(RELEASE_GRACE_MS)).toBe(1);
    expect(w.state.opens).toBe(1);
    expect(lockIsFree(w.root)).toBe(false);

    w.clock.fire(RELEASE_GRACE_MS);
    await flush();

    expect(lockIsFree(w.root)).toBe(true);
    expect(w.state.opens).toBe(1);
    await w.studio.teardown();
  });

  test("the grace is re-checked when it fires: work that started meanwhile blocks the release", async () => {
    const w = world();
    await touch(w);
    const gate = defer();
    w.state.drainGate = gate.promise;

    await generate(w, "zeus-idle");
    w.clock.fire(RELEASE_GRACE_MS);
    await flush();

    expect(lockIsFree(w.root)).toBe(false);
    gate.resolve();
    await w.studio.teardown();
  });

  test("a grace that fires while an op is running releases nothing, and the op's end arms a new one that does", async () => {
    const w = world();
    await settled(w);
    // One grace is armed, the app is idle, and then an op starts without ending.
    expect(w.clock.pending(RELEASE_GRACE_MS)).toBe(1);
    const gate = defer();
    w.state.abortGate = gate.promise;
    const abort = execute(w.studio, "abort", { jobId: "zeus-idle-0000" });
    await flush();
    expect(w.clock.pending(RELEASE_GRACE_MS)).toBe(1);

    w.clock.fire(RELEASE_GRACE_MS);
    await flush();

    // The re-check at fire time saw the op and kept the lock.
    expect(w.state.runtimes[0]?.shutdowns).toBe(0);
    expect(lockIsFree(w.root)).toBe(false);
    expect(w.cap.err.join("\n")).not.toContain("automatic release");

    gate.resolve();
    expect((await abort).ok).toBe(true);
    await flush();
    expect(w.clock.pending(RELEASE_GRACE_MS)).toBe(1);

    w.clock.fire(RELEASE_GRACE_MS);
    await flush();

    expect(w.state.runtimes[0]?.shutdowns).toBe(1);
    expect(lockIsFree(w.root)).toBe(true);
    await w.studio.teardown();
  });
});

describe("release is refused unless the app is idle", () => {
  const refused = async (w: World, pattern: RegExp) => {
    const outcome = await execute(w.studio, "release", {});
    expect(outcome).toMatchObject({ ok: false, error: { code: "not-idle" } });
    expect(JSON.stringify(outcome)).toMatch(pattern);
    expect((await status(w)).idle).toBe(false);
    expect(lockIsFree(w.root)).toBe(false);
    for (const runtime of w.state.runtimes) expect(runtime.shutdowns).toBe(0);
  };

  test("while a job is queued or running and the drain is running", async () => {
    const w = world();
    const gate = defer();
    w.state.drainGate = gate.promise;
    await generate(w, "zeus-idle");
    await flush();

    await refused(w, /drain|job/);

    gate.resolve();
    await w.studio.idle();
    await w.studio.teardown();
  });

  test("while an op is in flight", async () => {
    const w = world();
    await settled(w);
    const gate = defer();
    w.state.abortGate = gate.promise;
    const abort = execute(w.studio, "abort", { jobId: "zeus-idle-0000" });
    await flush();

    await refused(w, /op is in flight/);

    gate.resolve();
    expect((await abort).ok).toBe(true);
    // With the op done the same call now succeeds.
    expect(await execute(w.studio, "release", {})).toMatchObject({
      ok: true,
      result: { state: "released" },
    });
    await w.studio.teardown();
  });

  test("while a terminal result has not reached the client", async () => {
    const w = world();
    await generate(w, "zeus-idle");
    await w.studio.idle();

    await refused(w, /result/);

    await listJobs(w);
    expect(await execute(w.studio, "release", {})).toMatchObject({
      ok: true,
      result: { state: "released" },
    });
    await w.studio.teardown();
  });

  test("while an edit import is in flight, but not for an open edit alone", async () => {
    const w = world();
    const session = await w.studio.owner();
    if ("ok" in session) throw new Error("no session");
    w.studio.editorFor(session);
    w.studio.loadedContent();
    const file = join(studioPaths(w.root).edits, "e1", "workspace.aseprite");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "v1");
    w.studio.watchEdit("e1", w.studio.workspaceHash("e1"));
    await touch(w);
    expect((await status(w)).idle).toBe(true);

    const gate = defer<RefreshResult>();
    w.state.refresh = () => gate.promise;
    writeFileSync(file, "v2");
    w.clock.fire(EDIT_POLL_MS);
    await flush();

    await refused(w, /import/);

    gate.resolve({ ok: true, changed: true } as unknown as RefreshResult);
    await flush();
    expect((await status(w)).idle).toBe(true);
    await w.studio.teardown();
  });

  test("after a drain stopped on a refusal", async () => {
    const w = world();
    w.state.drainRefusal = {
      ok: false,
      reason: "write-failed",
      message: "the disk is full",
    };
    await generate(w, "zeus-idle");
    await w.studio.idle();
    await listJobs(w);
    await flush();

    await refused(w, /refus|stopped/);
    expect(w.clock.pending(RELEASE_GRACE_MS)).toBe(0);
    await w.studio.teardown();
  });

  test("there is nothing to release when this app holds nothing, and another holder's lock is never touched", async () => {
    const w = world();
    expect(await execute(w.studio, "release", {})).toMatchObject({
      ok: true,
      result: { state: "free" },
    });
    expect(w.state.opens).toBe(0);

    w.state.holder = HOLDER;
    expect(await execute(w.studio, "release", {})).toMatchObject({
      ok: true,
      result: { state: "free" },
    });
    expect(w.state.opens).toBe(0);
    await w.studio.teardown();
  });

  test("the op is on every table and is not itself a write that takes the lock", () => {
    expect(opNames()).toContain("release");
    expect(READ_ONLY.has("release")).toBe(true);
  });
});

describe("release is its own path", () => {
  test("it closes the editor, then shuts the runtime down, and clears the refs; it never sets stopping and never unwatches edits", async () => {
    const w = world();
    await settled(w);
    const session = await w.studio.owner();
    if ("ok" in session) throw new Error("no session");
    w.studio.editorFor(session);
    const edits = join(studioPaths(w.root).edits, "e1");
    mkdirSync(edits, { recursive: true });
    writeFileSync(join(edits, "workspace.aseprite"), "v1");
    w.studio.watchEdit("e1", w.studio.workspaceHash("e1"));
    const order: string[] = [];
    const editor = w.state.editors[0] as FakeEditor;
    const runtime = w.state.runtimes[0] as FakeRuntime;
    const closeEditor = editor.close;
    editor.close = async () => {
      order.push("editor");
      await closeEditor();
    };
    const real = w.state.shutdown;
    w.state.shutdown = async (n) => {
      order.push("runtime");
      return real(n);
    };

    const outcome = await execute(w.studio, "release", {});

    expect(outcome).toMatchObject({ ok: true, result: { state: "released" } });
    expect(order).toEqual(["editor", "runtime"]);
    expect(editor.closes).toBe(1);
    expect(runtime.shutdowns).toBe(1);
    expect(w.studio.stopping).toBe(false);
    expect(w.studio.hasWatches).toBe(true);
    expect(w.clock.pending(EDIT_POLL_MS)).toBe(1);
    expect(lockIsFree(w.root)).toBe(true);
    // The refs are gone: the next use builds a new runtime and a new editor.
    expect(w.studio.runtimeIfStarted()).toBeUndefined();
    await w.studio.teardown();
  });

  test("a write that arrives mid-release waits, then re-acquires and succeeds", async () => {
    const w = world();
    await settled(w);
    const gate = defer();
    w.state.shutdown = async () => {
      await gate.promise;
      return { ok: true };
    };
    const releasing = execute(w.studio, "release", {});
    await flush();
    let done = false;
    const write = generate(w, "zeus-idle-2").then((outcome) => {
      done = true;
      return outcome;
    });
    await flush();

    expect(done).toBe(false);
    expect(w.state.opens).toBe(1);

    gate.resolve();
    await releasing;
    const outcome = await write;

    expect(outcome).toMatchObject({ ok: true, result: { state: "queued" } });
    expect(w.state.opens).toBe(2);
    expect(w.state.runtimes).toHaveLength(2);
    await w.studio.idle();
    await w.studio.teardown();
  });

  test("a preview request and a kick wait for the release too", async () => {
    const w = world();
    await settled(w);
    await execute(w.studio, "source-list", {});
    const gate = defer();
    w.state.shutdown = async () => {
      await gate.promise;
      return { ok: true };
    };
    const releasing = w.studio.release();
    await flush();
    const drains = (w.state.runtimes[0] as FakeRuntime).drains;
    let source: unknown;
    void w.studio.previewSource().then((s) => {
      source = s;
    });

    w.studio.kick();
    await flush();

    expect(source).toBeUndefined();
    expect((w.state.runtimes[0] as FakeRuntime).drains).toBe(drains);

    gate.resolve();
    await releasing;
    await flush();

    expect(source).toBeDefined();
    expect("ok" in (source as object)).toBe(false);
    expect(w.state.previews.opened).toBe(2);
    await w.studio.teardown();
  });

  test("teardown during a release waits for it and does not close anything twice", async () => {
    const w = world();
    await settled(w);
    const session = await w.studio.owner();
    if ("ok" in session) throw new Error("no session");
    w.studio.editorFor(session);
    const gate = defer();
    w.state.shutdown = async () => {
      await gate.promise;
      return { ok: true };
    };
    const releasing = w.studio.release();
    await flush();

    const tearing = w.studio.teardown();
    await flush();
    gate.resolve();
    await Promise.all([releasing, tearing]);

    expect((w.state.runtimes[0] as FakeRuntime).shutdowns).toBe(1);
    expect((w.state.editors[0] as FakeEditor).closes).toBe(1);
    expect(lockIsFree(w.root)).toBe(true);
    expect(w.studio.stopping).toBe(true);
  });
});

describe("a release that does not finish", () => {
  const failure: TeardownResult = {
    ok: false,
    reason: "teardown-incomplete",
    message: "processes 1234 of group 1234 survived",
  };

  test("a failed shutdown keeps the lock, reports it, and refuses the pending write with a typed error; teardown still retries", async () => {
    const w = world();
    await settled(w);
    const gate = defer<TeardownResult>();
    const answers: (() => Promise<TeardownResult>)[] = [
      () => gate.promise,
      async () => failure,
      async () => ({ ok: true }),
    ];
    w.state.shutdown = (n) => (answers[n - 1] ?? answers[2])?.() as never;
    const releasing = execute(w.studio, "release", {});
    await flush();
    const pending = generate(w, "zeus-idle-2");
    await flush();

    gate.resolve(failure);
    const outcome = await releasing;
    const refusal = await pending;

    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "release-failed" },
    });
    expect(refusal).toMatchObject({
      ok: false,
      error: { code: "release-failed" },
    });
    expect(lockIsFree(w.root)).toBe(false);
    expect((await status(w)).releaseFailure).toMatch(/runtime did not stop/);
    expect((await status(w)).rootLock.holder).toBe("self");
    expect(w.cap.err.join("\n")).not.toContain("1234");
    // A generation cannot use the runtime a failed shutdown left closed.
    expect(await generate(w, "zeus-idle-3")).toMatchObject({
      ok: false,
      error: { code: "release-failed" },
    });

    // Teardown keeps its own retry loop: the second shutdown fails, the third succeeds.
    await w.studio.teardown();
    expect(w.state.shutdownCalls).toBe(3);
    expect(lockIsFree(w.root)).toBe(true);
  });

  test("a release is one attempt bounded like quit, and a shutdown that never answers is reported and the lock is kept", async () => {
    const w = world();
    await settled(w);
    w.state.shutdown = () => new Promise<TeardownResult>(() => {});

    const releasing = execute(w.studio, "release", {});
    await flush();

    expect(w.clock.pending(RELEASE_BOUND_MS)).toBe(1);
    w.clock.fire(RELEASE_BOUND_MS);
    const outcome = await releasing;

    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "release-failed" },
    });
    expect(w.state.shutdownCalls).toBe(1);
    expect(lockIsFree(w.root)).toBe(false);
    expect((await status(w)).releaseFailure).not.toBeNull();
    // The failed grace does not spin: it is not re-armed by itself.
    expect(w.clock.pending(RELEASE_GRACE_MS)).toBe(0);
  });

  test("a release whose bound fired while its steps still run hands out no session and starts no second release; a late success then frees the lock and says so", async () => {
    const w = world();
    await settled(w);
    const gate = defer<TeardownResult>();
    w.state.shutdown = () => gate.promise;
    const releasing = execute(w.studio, "release", {});
    await flush();
    w.clock.fire(RELEASE_BOUND_MS);
    expect(await releasing).toMatchObject({
      ok: false,
      error: { code: "release-failed" },
    });
    const opens = w.state.opens;

    // The steps are still open: nobody gets the old session or a new one.
    const owner = await w.studio.owner();
    const write = await generate(w, "zeus-idle-2");
    const second = await w.studio.release();

    expect(owner).toMatchObject({
      ok: false,
      error: { code: "release-failed" },
    });
    expect(write).toMatchObject({
      ok: false,
      error: { code: "release-failed" },
    });
    expect(second).toMatchObject({
      ok: false,
      error: { code: "release-failed" },
    });
    expect(w.state.opens).toBe(opens);
    expect(w.state.shutdownCalls).toBe(1);
    expect(lockIsFree(w.root)).toBe(false);

    // The shutdown answers late and succeeds: the lock is free, and the log says so.
    gate.resolve({ ok: true });
    await flush();

    expect(lockIsFree(w.root)).toBe(true);
    expect(w.cap.err.join("\n")).toContain("the writer lock is now free");
    expect((await status(w)).releaseFailure).toBeNull();
    const again = await generate(w, "zeus-idle-3");
    expect(again).toMatchObject({ ok: true, result: { state: "queued" } });
    await w.studio.idle();
    await w.studio.teardown();
  });

  test("an automatic release that fails is logged and keeps the lock", async () => {
    const w = world();
    await settled(w);
    w.state.shutdown = async () => failure;

    w.clock.fire(RELEASE_GRACE_MS);
    await flush();

    expect(lockIsFree(w.root)).toBe(false);
    expect(w.cap.err.join("\n")).toContain("release failed");
    expect(w.cap.err.join("\n")).not.toContain("1234");
    w.state.shutdown = async () => ({ ok: true });
    await w.studio.teardown();
  });
});

describe("the edit watcher is a lazy writer", () => {
  const SAVED = "saved in aseprite";

  async function watching(w: World) {
    const session = await w.studio.owner();
    if ("ok" in session) throw new Error("no session");
    w.studio.editorFor(session);
    w.studio.loadedContent();
    const file = join(studioPaths(w.root).edits, "e1", "workspace.aseprite");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "v1");
    w.studio.watchEdit("e1", w.studio.workspaceHash("e1"));
    await touch(w);
    return file;
  }

  const imports = (w: World) =>
    w.state.editors.flatMap((editor) => editor.refreshes);

  test("it survives a release, and after the holder exits the next poll imports exactly once, with the saved bytes", async () => {
    const w = world();
    const file = await watching(w);
    w.clock.fire(RELEASE_GRACE_MS);
    await flush();
    expect(lockIsFree(w.root)).toBe(true);
    expect(w.studio.hasWatches).toBe(true);

    // A CLI takes the lock; the owner saves in Aseprite.
    w.state.holder = HOLDER;
    writeFileSync(file, SAVED);
    w.clock.fire(EDIT_POLL_MS);
    await flush();
    w.clock.fire(EDIT_POLL_MS);
    await flush();

    expect(imports(w)).toEqual([]);
    expect(w.clock.pending(EDIT_POLL_MS)).toBe(1);

    w.state.holder = undefined;
    w.clock.fire(EDIT_POLL_MS);
    await flush();
    w.clock.fire(EDIT_POLL_MS);
    await flush();
    w.clock.fire(EDIT_POLL_MS);
    await flush();

    expect(imports(w)).toEqual([
      { editId: "e1", mode: "import", bytes: SAVED },
    ]);
    // The import went through the new session's editor.
    expect(w.state.editors).toHaveLength(2);
    expect((await status(w)).rootLock.holder).toBe("self");
    await w.studio.teardown();
  });

  test("the baseline advances after a terminal refusal, and the import is not retried", async () => {
    const w = world();
    const file = await watching(w);
    w.state.refresh = async () =>
      ({ ok: false, reason: "invalid", message: "bad sheet" }) as never;

    writeFileSync(file, "v2");
    w.clock.fire(EDIT_POLL_MS);
    await flush();
    w.clock.fire(EDIT_POLL_MS);
    await flush();
    w.clock.fire(EDIT_POLL_MS);
    await flush();

    expect(imports(w)).toHaveLength(1);
    await w.studio.teardown();
  });

  test("root-locked and shutting-down leave the baseline alone so the next poll retries", async () => {
    const w = world();
    const file = await watching(w);
    w.clock.fire(RELEASE_GRACE_MS);
    await flush();
    w.state.holder = HOLDER;
    writeFileSync(file, "v2");

    for (let i = 0; i < 3; i += 1) {
      w.clock.fire(EDIT_POLL_MS);
      await flush();
    }
    expect(imports(w)).toEqual([]);

    w.state.holder = undefined;
    w.clock.fire(EDIT_POLL_MS);
    await flush();

    expect(imports(w)).toHaveLength(1);
    await w.studio.teardown();
  });

  describe("a poll that cannot import", () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    afterEach(() => {
      process.off("unhandledRejection", onRejection);
    });

    test("a session open that throws is logged, rejects nothing, keeps the baseline and the watch, and the next poll imports", async () => {
      process.on("unhandledRejection", onRejection);
      const w = world();
      const file = await watching(w);
      w.clock.fire(RELEASE_GRACE_MS);
      await flush();
      writeFileSync(file, SAVED);
      w.state.openThrows = new Error("the disk went away");

      w.clock.fire(EDIT_POLL_MS);
      await flush();
      // Let a rejection, if there is one, reach the process hook.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(rejections).toEqual([]);
      expect(w.cap.err.join("\n")).toContain(
        "edit e1 not imported: the disk went away",
      );
      expect(w.studio.hasWatches).toBe(true);
      expect(w.clock.pending(EDIT_POLL_MS)).toBe(1);
      expect(imports(w)).toEqual([]);

      w.clock.fire(EDIT_POLL_MS);
      await flush();
      w.clock.fire(EDIT_POLL_MS);
      await flush();

      expect(imports(w)).toEqual([
        { editId: "e1", mode: "import", bytes: SAVED },
      ]);
      await w.studio.teardown();
    });

    test("a workspace file that vanishes between the check and the read is logged and the watch stays armed", async () => {
      process.on("unhandledRejection", onRejection);
      const w = world();
      const file = await watching(w);
      writeFileSync(file, SAVED);
      // The file is a directory when read: existsSync passes, readFileSync throws.
      rmSync(file);
      mkdirSync(file);

      w.clock.fire(EDIT_POLL_MS);
      await flush();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(rejections).toEqual([]);
      expect(w.cap.err.join("\n")).toContain("edit e1 not imported:");
      expect(w.clock.pending(EDIT_POLL_MS)).toBe(1);
      rmSync(file, { recursive: true });
      writeFileSync(file, SAVED);
      w.clock.fire(EDIT_POLL_MS);
      await flush();
      w.clock.fire(EDIT_POLL_MS);
      await flush();
      expect(imports(w)).toHaveLength(1);
      await w.studio.teardown();
    });
  });

  test("an editor that is unavailable leaves the baseline so the next poll retries once the file is unchanged; a failed export is terminal", async () => {
    const w = world();
    const file = await watching(w);
    w.state.refresh = async () =>
      ({
        ok: false,
        reason: "editor-unavailable",
        message: "aseprite is not installed",
      }) as never;
    writeFileSync(file, SAVED);

    w.clock.fire(EDIT_POLL_MS);
    await flush();
    expect(imports(w)).toHaveLength(1);

    // The editor comes back; the file has not changed since.
    w.state.refresh = async () => ({ ok: true, changed: true }) as never;
    w.clock.fire(EDIT_POLL_MS);
    await flush();
    w.clock.fire(EDIT_POLL_MS);
    await flush();
    w.clock.fire(EDIT_POLL_MS);
    await flush();

    expect(imports(w)).toHaveLength(2);
    expect(w.cap.err.join("\n")).toContain("edit e1 imported");

    // export-incomplete is terminal: it is logged and not retried.
    writeFileSync(file, "v3");
    w.state.refresh = async () =>
      ({
        ok: false,
        reason: "export-incomplete",
        message: "half-written",
      }) as never;
    w.clock.fire(EDIT_POLL_MS);
    await flush();
    w.clock.fire(EDIT_POLL_MS);
    await flush();
    w.clock.fire(EDIT_POLL_MS);
    await flush();

    expect(imports(w)).toHaveLength(3);
    await w.studio.teardown();
  });

  test("only finishing or discarding the edit ends the watch", async () => {
    const w = world();
    await watching(w);
    w.clock.fire(RELEASE_GRACE_MS);
    await flush();
    expect(w.studio.hasWatches).toBe(true);

    w.studio.unwatchEdit("e1");

    expect(w.studio.hasWatches).toBe(false);
    expect(w.clock.pending(EDIT_POLL_MS)).toBe(0);
    await w.studio.teardown();
  });
});

describe("a CLI holds the lock while the app is idle", () => {
  test("a write from the app is refused as root-locked naming the holder, and succeeds once the lock is free", async () => {
    const w = world();
    await settled(w);
    w.clock.fire(RELEASE_GRACE_MS);
    await flush();
    w.state.holder = HOLDER;

    const refused = await generate(w, "zeus-idle-2");

    expect(refused).toMatchObject({
      ok: false,
      error: { code: "root-locked", holder: HOLDER },
    });
    expect((await status(w)).rootLock).toEqual({
      holder: "other",
      pid: HOLDER,
    });

    w.state.holder = undefined;
    const retried = await generate(w, "zeus-idle-2");

    expect(retried).toMatchObject({ ok: true, result: { state: "queued" } });
    await w.studio.idle();
    await w.studio.teardown();
  });
});

describe("render jobs in the host", () => {
  const loadedContent = loadStudioContent(REAL_CONTENT);
  if (!loadedContent.ok) throw new Error("content does not load");
  const REAL_LOADED = loadedContent.content;
  const renderRequest = (id: string) => {
    const built = newRequestRecord(
      REAL_LOADED,
      {
        id,
        subject: "zeus",
        kind: "sprite",
        slots: [{ state: "idle", direction: "west" }],
        render: { palette: "greek-retro", pivot: { x: 56, y: 78 } },
      },
      () => 0,
      renderEngineFor(join(REAL_CONTENT, "..", "..", "tools", "render")),
    );
    if (!built.ok) throw new Error(JSON.stringify(built.error));
    return built.value.record;
  };
  const submitRender = async (w: World, id: string) => {
    const session = await w.studio.owner();
    if ("ok" in session) throw new Error("no session");
    const runtime = w.studio.runtimeFor(session);
    if ("ok" in runtime) throw new Error("no runtime");
    const result = session.submitRequest(renderRequest(id));
    if (!result.ok) throw new Error(result.message);
    w.studio.kick();
    return result.jobIds;
  };

  test("idle release is refused while a render job is queued or running", async () => {
    const w = world();
    const gate = defer();
    w.state.drainGate = gate.promise;
    const [job] = await submitRender(w, "zeus-retro");
    await flush();

    const outcome = await execute(w.studio, "release", {});
    expect(outcome).toMatchObject({ ok: false, error: { code: "not-idle" } });
    expect((await status(w)).idle).toBe(false);
    expect((await status(w)).idleReason).toMatch(/drain|job/);
    expect(lockIsFree(w.root)).toBe(false);
    expect(w.state.runtimes[0]?.shutdowns).toBe(0);

    gate.resolve();
    await w.studio.idle();
    expect(job).toBeDefined();
    await w.studio.teardown();
  });

  test("an unavailable engine's stop does not end the host's drain while jobs remain queued", async () => {
    const w = world();
    const seen: number[] = [];
    w.state.drainHook = (n, session) => {
      seen.push(n);
      const queued = session.queued();
      const jobs = queued.ok ? queued.jobs : [];
      const results: Extract<DrainResult, { ok: true }>["results"][number][] =
        [];
      if (n === 1) {
        // The render engine is unavailable: only its jobs are marked, the image job stays queued.
        for (const { job } of jobs)
          if (job.provider.id === "blender-eevee") {
            session.unavailable(job.id, "no Blender", "install Blender");
            results.push({
              jobId: job.id,
              outcome: "unavailable",
              reason: "no Blender",
              staging: "install Blender",
            });
          }
        return { ok: true, results, stopped: "unavailable" };
      }
      for (const { job } of jobs) {
        session.start(job.id);
        session.fail(job.id, "fixture failure");
      }
      return { ok: true, results, stopped: "empty" };
    };
    await generate(w, "zeus-idle");
    const session = await w.studio.owner();
    if ("ok" in session) throw new Error("no session");
    const jobs = session.submitRequest(renderRequest("zeus-retro"));
    if (!jobs.ok) throw new Error(jobs.message);
    w.studio.kick();
    await w.studio.idle();

    expect(seen.length).toBeGreaterThanOrEqual(2);
    const queued = session.queued();
    expect(queued.ok && queued.jobs).toEqual([]);
    await w.studio.teardown();
  });

  test("a drain deferred by critical memory pressure is retried after a poll, not spun on and not given up", async () => {
    const w = world();
    w.state.drainHook = (n, session) => {
      if (n <= 2)
        return {
          ok: true,
          results: [],
          stopped: "deferred",
          guidance: "System memory pressure is critical",
        };
      const queued = session.queued();
      for (const { job } of queued.ok ? queued.jobs : []) {
        session.start(job.id);
        session.fail(job.id, "fixture failure");
      }
      return { ok: true, results: [], stopped: "empty" };
    };
    await generate(w, "zeus-idle");
    await w.studio.idle();

    expect(w.state.runtimes[0]?.drains).toBe(3);
    expect(w.state.sleeps).toBe(2);
    expect(w.cap.err.join("\n")).toMatch(
      /drain deferred: System memory pressure is critical/,
    );
    await w.studio.teardown();
  });
});

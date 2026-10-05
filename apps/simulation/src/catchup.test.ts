import type { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatchUpSummary } from "@panthea/contracts";
import {
  closeStore,
  exportArchive,
  getExternalProposal,
  insertExternalProposal,
  listEvents,
  openStore,
  commitTick as persistCommitTick,
  readCatchUpProgress,
  readCatchUpSummary,
  readClock,
  readLiveProjections,
  readPrngState,
} from "@panthea/persistence";
import { ensureTraceSchema, recordObservation } from "@panthea/telemetry";
import { createPrng } from "@panthea/world";
import { runCatchUp } from "./catchup";
import { refreshStatusAfterCatchUp } from "./index";
import { applyLiveTick, createServiceStatusRef } from "./server";
import type { TickDeps } from "./tick";
import { buildRoutineQueue } from "./tick";
import {
  createWorldProjectionReducers,
  deserializePrngState,
  loadGreekWorldState,
  restoreWorldTime,
  worldImportReducers,
} from "./world-store";
import { importWorldArchive } from "./worlds";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("a world that is currently paused runs no catch-up at all: paused wall time never becomes catch-up", async () => {
  const storeDir = tempDir("panthea-sim-catchup-paused-");
  try {
    const storePath = join(storeDir, "world.sqlite");
    const seeded = loadGreekWorldState();
    const reducers = createWorldProjectionReducers(seeded);
    const store = openStore(storePath, reducers);
    ensureTraceSchema(store.db);
    store.db.run("UPDATE clock SET paused = 1 WHERE id = 1");

    const nowWallMs = readClock(store.db).cursorWallMs + 5 * 60 * 60 * 1000;
    const result = await runCatchUp(
      seeded,
      createPrng(1),
      { store, reducers, traceDb: store.db },
      {
        nowWallMs,
      },
    );

    expect(result.summary).toEqual({
      appliedMs: 0,
      skippedMs: 0,
      majorOutcomes: [],
    });
    expect(result.state).toEqual(seeded);
    expect(readClock(store.db).tick).toBe(0);

    closeStore(store);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

test("a trace write failure rolls back the whole chunk: the clock is unchanged and catch-up reports degraded without throwing", async () => {
  const storeDir = tempDir("panthea-sim-catchup-trace-fail-");
  try {
    const storePath = join(storeDir, "world.sqlite");
    const seeded = loadGreekWorldState();
    const reducers = createWorldProjectionReducers(seeded);
    const store = openStore(storePath, reducers);
    // Deliberately not calling ensureTraceSchema: the trace tables don't
    // exist, so the first chunk's own trace write genuinely fails.

    const beforeClock = readClock(store.db);
    const nowWallMs = beforeClock.cursorWallMs + 5 * 60 * 1000;

    const result = await runCatchUp(
      seeded,
      createPrng(1),
      { store, reducers, traceDb: store.db },
      {
        nowWallMs,
      },
    );

    expect(result.degraded).toBeDefined();
    expect(readClock(store.db)).toEqual(beforeClock);

    closeStore(store);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

test("catch-up appends to the trace in id order: every observation, outcome, and link lands at the end of its index, never in the middle of it", async () => {
  const storeDir = tempDir("panthea-sim-catchup-order-");
  try {
    const storePath = join(storeDir, "world.sqlite");
    const seeded = loadGreekWorldState();
    const reducers = createWorldProjectionReducers(seeded);
    const store = openStore(storePath, reducers);
    ensureTraceSchema(store.db);

    const nowWallMs = readClock(store.db).cursorWallMs + 4 * 60 * 1000;
    const result = await runCatchUp(
      seeded,
      createPrng(1),
      { store, reducers, traceDb: store.db },
      { nowWallMs },
    );
    expect(result.degraded).toBeUndefined();

    const inInsertOrder = (sql: string) =>
      (store.db.query(sql).all() as { id: string }[]).map((row) => row.id);
    const observations = inInsertOrder(
      "SELECT id FROM trace_observations ORDER BY rowid",
    );
    const outcomes = inInsertOrder(
      "SELECT proposal_id AS id FROM trace_proposal_outcomes ORDER BY rowid",
    );
    // Enough rows that a random key could not satisfy this by luck.
    expect(observations.length).toBeGreaterThan(200);
    expect(outcomes.length).toBeGreaterThan(200);
    const links = store.db
      .query(
        "SELECT proposal_id AS id FROM trace_outcome_events ORDER BY rowid",
      )
      .all() as { id: string }[];
    // A tick writes its committed proposals before its rejected ones, so within one
    // tick the order is not exact. What matters is that nothing lands far behind the
    // tail: each row sorts after every row written more than two ticks' worth (60,
    // at 27 proposals a tick at most) before it.
    const WINDOW = 60;
    const behindTheTail = (ids: readonly string[]) => {
      let worst = 0;
      let bar = "";
      ids.forEach((id, at) => {
        if (at >= WINDOW) {
          const older = ids[at - WINDOW] as string;
          if (older > bar) bar = older;
        }
        if (id < bar) worst += 1;
      });
      return worst;
    };
    expect(behindTheTail(observations)).toBe(0);
    expect(behindTheTail(outcomes)).toBe(0);
    expect(behindTheTail(links.map((link) => link.id))).toBe(0);

    closeStore(store);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

test("missed time above the cap: exactly one hour is applied and the excess is reported as skipped", async () => {
  const storeDir = tempDir("panthea-sim-catchup-cap-");
  try {
    const storePath = join(storeDir, "world.sqlite");
    const seeded = loadGreekWorldState();
    const reducers = createWorldProjectionReducers(seeded);
    const store = openStore(storePath, reducers);
    ensureTraceSchema(store.db);

    const startCursor = readClock(store.db).cursorWallMs;
    const nowWallMs = startCursor + 5 * 60 * 60 * 1000;

    const result = await runCatchUp(
      seeded,
      createPrng(1),
      { store, reducers, traceDb: store.db },
      {
        nowWallMs,
      },
    );

    expect(result.degraded).toBeUndefined();
    expect(result.summary.appliedMs).toBe(60 * 60 * 1000);
    expect(result.summary.skippedMs).toBe(4 * 60 * 60 * 1000);
    expect(result.state.tick).toBe(3600);

    const clock = readClock(store.db);
    // The persisted cursor jumps to the sampled "now", not merely
    // startCursor + appliedMs: otherwise the 4 discarded hours would
    // still look like missed time to a later catch-up call and get
    // applied a second time.
    expect(clock.cursorWallMs).toBe(nowWallMs);
    expect(clock.tick).toBe(3600);
    expect(clock.paused).toBe(false);

    const live = restoreWorldTime(readLiveProjections(store, reducers), clock);
    expect(live).toEqual(result.state);

    closeStore(store);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
  // The one test that applies the authored hour whole, so it is also the heavy
  // one: 3.7 s alone, 14 to 16 s with thirty busy loops on ten cores. The bound
  // only stops a hang.
}, 60_000);

test("a capped catch-up run's discarded excess is never replayed by a later catch-up call", async () => {
  const storeDir = tempDir("panthea-sim-catchup-no-replay-");
  try {
    const storePath = join(storeDir, "world.sqlite");
    // The property is about the discard, not the cap's size (the authored hour
    // is applied whole by the test above), so this world's cap is ten minutes
    // and the run applies 600 ticks, not 3,600.
    const capMs = 10 * 60 * 1000;
    const loaded = loadGreekWorldState();
    const seeded = {
      ...loaded,
      rules: { ...loaded.rules, catchUpCapMs: capMs },
    };
    const reducers = createWorldProjectionReducers(seeded);
    const store = openStore(storePath, reducers);
    ensureTraceSchema(store.db);

    const startCursor = readClock(store.db).cursorWallMs;
    const firstNow = startCursor + 5 * capMs;

    const firstRun = await runCatchUp(
      seeded,
      createPrng(1),
      { store, reducers, traceDb: store.db },
      { nowWallMs: firstNow },
    );
    expect(firstRun.degraded).toBeUndefined();
    expect(firstRun.summary.appliedMs).toBe(capMs);
    expect(firstRun.state.tick).toBe(capMs / 1000);
    // The run closed its own backlog in its final commit, so a later call
    // starts from nothing.
    expect(readCatchUpProgress(store.db)).toBeUndefined();

    // A live-loop-style second call, moments later: the cursor already
    // sits at (approximately) now, so this applies essentially nothing --
    // never another hour of ticks for the same already-discarded gap.
    const secondNow = firstNow + 500;
    const secondRun = await runCatchUp(
      firstRun.state,
      firstRun.prng,
      { store, reducers, traceDb: store.db },
      { nowWallMs: secondNow },
    );

    expect(secondRun.summary.appliedMs).toBe(0);
    expect(secondRun.state.tick).toBe(capMs / 1000);
    // Total simulated advance across both calls stays exactly the cap.
    expect(firstRun.summary.appliedMs + secondRun.summary.appliedMs).toBe(
      capMs,
    );

    closeStore(store);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
}, 20_000);

test("pause during catch-up stops at the chunk boundary, persists paused, and reports the remainder as skipped", async () => {
  const storeDir = tempDir("panthea-sim-catchup-pause-mid-");
  try {
    const storePath = join(storeDir, "world.sqlite");
    const seeded = loadGreekWorldState();
    const reducers = createWorldProjectionReducers(seeded);
    const store = openStore(storePath, reducers);
    ensureTraceSchema(store.db);

    const startCursor = readClock(store.db).cursorWallMs;
    const nowWallMs = startCursor + 5 * 60 * 1000; // 5 chunks of 60s each

    let chunksCommitted = 0;
    const result = await runCatchUp(
      seeded,
      createPrng(1),
      { store, reducers, traceDb: store.db },
      {
        nowWallMs,
        onChunkCommitted: () => {
          chunksCommitted += 1;
          return chunksCommitted === 2;
        },
      },
    );

    expect(result.degraded).toBeUndefined();
    expect(result.summary.appliedMs).toBe(2 * 60 * 1000);
    expect(result.summary.skippedMs).toBe(3 * 60 * 1000);

    const clock = readClock(store.db);
    expect(clock.paused).toBe(true);
    expect(clock.cursorWallMs).toBe(startCursor + 2 * 60 * 1000);
    expect(clock.tick).toBe(120);

    closeStore(store);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

test("a commit that throws partway through catch-up leaves the earlier chunks committed: a reopened store resumes there, applies the rest once, and reports the whole backlog", async () => {
  const storeDir = tempDir("panthea-sim-catchup-crash-");
  try {
    const storePath = join(storeDir, "world.sqlite");
    const seeded = loadGreekWorldState();
    const reducers = createWorldProjectionReducers(seeded);
    let store = openStore(storePath, reducers);
    ensureTraceSchema(store.db);

    const startCursor = readClock(store.db).cursorWallMs;
    const nowWallMs = startCursor + 5 * 60 * 1000; // 5 chunks of 60s each

    let chunkAttempt = 0;
    function flakyCommitTick<TProjections>(
      ...args: Parameters<typeof persistCommitTick<TProjections>>
    ): ReturnType<typeof persistCommitTick<TProjections>> {
      chunkAttempt += 1;
      if (chunkAttempt === 3) {
        throw new Error("simulated crash mid-chunk");
      }
      return persistCommitTick(...args);
    }

    const firstRun = await runCatchUp(
      seeded,
      createPrng(1),
      { store, reducers, traceDb: store.db, commitTick: flakyCommitTick },
      { nowWallMs },
    );
    expect(firstRun.degraded).toBeDefined();
    expect(firstRun.summary.appliedMs).toBe(2 * 60 * 1000);

    const clockAfterCrash = readClock(store.db);
    expect(clockAfterCrash.cursorWallMs).toBe(startCursor + 2 * 60 * 1000);
    expect(clockAfterCrash.tick).toBe(120);
    expect(clockAfterCrash.paused).toBe(false);

    closeStore(store);

    // Restart: a freshly constructed composition root, reopened from the
    // same path, holding no reference to the crashed run's in-memory
    // state or PRNG -- the same shape as world-store.test.ts's restart
    // scenarios.
    const freshReducers = createWorldProjectionReducers(loadGreekWorldState());
    store = openStore(storePath, freshReducers);
    const restoredClock = readClock(store.db);
    const restoredState = restoreWorldTime(
      readLiveProjections(store, freshReducers),
      restoredClock,
    );
    expect(restoredState.tick).toBe(120);
    const restoredPrng =
      deserializePrngState(readPrngState(store.db)) ?? createPrng(1);

    const secondRun = await runCatchUp(
      restoredState,
      restoredPrng,
      { store, reducers: freshReducers, traceDb: store.db },
      { nowWallMs },
    );
    expect(secondRun.degraded).toBeUndefined();
    // The summary covers the whole backlog, including the chunks the first
    // run committed before it failed.
    expect(secondRun.summary.appliedMs).toBe(5 * 60 * 1000);

    const finalClock = readClock(store.db);
    expect(finalClock.cursorWallMs).toBe(startCursor + 5 * 60 * 1000);
    expect(finalClock.tick).toBe(300);

    // No interval was applied twice: 5 minutes of ticks for a 5 minute gap.
    expect(finalClock.tick).toBe(300);

    closeStore(store);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

test("a gap shorter than one tick applies nothing, skips nothing, and reports no outcomes", async () => {
  const storeDir = tempDir("panthea-sim-catchup-subtick-");
  try {
    const seeded = loadGreekWorldState();
    const reducers = createWorldProjectionReducers(seeded);
    const store = openStore(join(storeDir, "world.sqlite"), reducers);
    ensureTraceSchema(store.db);
    const before = readClock(store.db);

    const result = await runCatchUp(
      seeded,
      createPrng(1),
      { store, reducers, traceDb: store.db },
      { nowWallMs: before.cursorWallMs + 5 },
    );

    expect(result.summary).toEqual({
      appliedMs: 0,
      skippedMs: 0,
      majorOutcomes: [],
    });
    expect(readClock(store.db)).toEqual(before);

    closeStore(store);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

/** A `commitTick` that throws on its `failOn`-th call: the commit fails as it would if the process died at that point, but the process itself carries on. */
function throwsAtCommit(failOn: number) {
  let attempt = 0;
  return function commitTick<TProjections>(
    ...args: Parameters<typeof persistCommitTick<TProjections>>
  ): ReturnType<typeof persistCommitTick<TProjections>> {
    attempt += 1;
    if (attempt === failOn) {
      throw new Error("simulated commit failure");
    }
    return persistCommitTick(...args);
  };
}

/**
 * A `commitTick` whose `failOn`-th call runs the real commit and then throws
 * from inside its transaction, after every callback has written: the failure a
 * full disk causes at COMMIT. Whatever the callbacks wrote must roll back.
 */
function failsInsideCommit(failOn: number) {
  let attempt = 0;
  return function commitTick<TProjections>(
    ...args: Parameters<typeof persistCommitTick<TProjections>>
  ): ReturnType<typeof persistCommitTick<TProjections>> {
    attempt += 1;
    if (attempt !== failOn) {
      return persistCommitTick(...args);
    }
    const [store, reducers, input] = args;
    return persistCommitTick(store, reducers, {
      ...input,
      onCommitted: (db) => {
        input.onCommitted?.(db);
        throw new Error("SQLITE_FULL: simulated failure at commit");
      },
    });
  };
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * The cap most of these tests run under. What they check is cap and discard
 * accounting, which does not depend on the cap's size, and a catch-up costs
 * about 0.9 ms of CPU per simulated second, so the authored hour makes each of
 * them take three seconds, and more on a busy machine. Ten minutes is ten
 * chunks and 600 ticks. One test (`missed time above the cap`) runs the
 * authored world and pins the authored hour itself.
 */
const CAP_MS = 10 * 60 * 1000;

/** The authored world, with its catch-up cap replaced when `capMs` is given: the one place a test's world is made, so the store a backlog creates and every run over it agree on the cap. */
function loadWorld(capMs?: number) {
  const authored = loadGreekWorldState();
  return capMs === undefined
    ? authored
    : { ...authored, rules: { ...authored.rules, catchUpCapMs: capMs } };
}

interface Backlog {
  readonly storePath: string;
  readonly startCursor: number;
  /** Runs catch-up on a store freshly opened from disk, as a restarted service would. */
  run(
    nowWallMs: number,
    commitTick?: TickDeps["commitTick"],
    /** Called at each between-chunk yield, where a request could arrive; returning `true` pauses catch-up there, anything else lets it go on. */
    betweenChunks?: (db: Database) => boolean | undefined,
    /** `crashBeforePublish` stops the run where the service would have died after the last commit and before publishing the summary: the summary is already persisted by then. */
    options?: { readonly crashBeforePublish?: boolean },
  ): Promise<Awaited<ReturnType<typeof runCatchUp>>>;
  /** Exports the store, as it stands on disk, to `archivePath`. */
  exportTo(archivePath: string): void;
  /** Runs `fn` against the store opened fresh from disk. */
  withDb<T>(fn: (db: Database) => T): T;
  clock(): ReturnType<typeof readClock>;
  progress(): ReturnType<typeof readCatchUpProgress>;
  /** The summary persisted in the store, read fresh from disk. */
  summary(): ReturnType<typeof readCatchUpSummary>;
  /** The summary the last run's service status would put on a frame: hydrated from the store before the run, refreshed after it. */
  published(): CatchUpSummary | undefined;
  /** Runs `count` live ticks (routines plus the journal) on a store freshly opened from disk. */
  tickLive(count: number): Promise<void>;
  dispose(): void;
}

function openBacklog(
  prefix: string,
  options: { readonly capMs?: number } = {},
): Backlog {
  const storeDir = tempDir(prefix);
  return backlogAt(
    join(storeDir, "world.sqlite"),
    () => rmSync(storeDir, { recursive: true, force: true }),
    options.capMs,
  );
}

/** A backlog over the store at `storePath` (created if new), reopened from disk for every operation. */
function backlogAt(
  storePath: string,
  dispose: () => void = () => {},
  capMs?: number,
): Backlog {
  let lastPublished: CatchUpSummary | undefined;
  const first = openStore(
    storePath,
    createWorldProjectionReducers(loadWorld(capMs)),
  );
  const startCursor = readClock(first.db).cursorWallMs;
  closeStore(first);

  async function withStore<T>(
    fn: (store: ReturnType<typeof openStore>) => Promise<T> | T,
  ) {
    const store = openStore(
      storePath,
      createWorldProjectionReducers(loadWorld(capMs)),
    );
    try {
      return await fn(store);
    } finally {
      closeStore(store);
    }
  }

  return {
    storePath,
    startCursor,
    exportTo: (archivePath) => {
      const store = openStore(
        storePath,
        createWorldProjectionReducers(loadWorld(capMs)),
      );
      try {
        exportArchive(store, archivePath);
      } finally {
        closeStore(store);
      }
    },
    run: (nowWallMs, commitTick, betweenChunks, options) =>
      withStore(async (store) => {
        const reducers = createWorldProjectionReducers(loadWorld(capMs));
        ensureTraceSchema(store.db);
        const state = restoreWorldTime(
          readLiveProjections(store, reducers),
          readClock(store.db),
        );
        // A starting service hydrates its status from the store before it
        // serves a frame.
        const statusRef = createServiceStatusRef(
          state,
          readCatchUpSummary(store.db),
        );
        const result = await runCatchUp(
          state,
          deserializePrngState(readPrngState(store.db)) ?? createPrng(1),
          {
            store,
            reducers,
            traceDb: store.db,
            ...(commitTick ? { commitTick } : {}),
          },
          {
            nowWallMs,
            ...(betweenChunks
              ? { onChunkCommitted: () => betweenChunks(store.db) === true }
              : {}),
          },
        );
        // What the service does with a result: publish what is persisted. A
        // run that "crashes" stops before that.
        if (!options?.crashBeforePublish) {
          refreshStatusAfterCatchUp(statusRef, result, store);
        }
        lastPublished = statusRef.catchUpSummary;
        return result;
      }),
    withDb: (fn) => {
      const store = openStore(
        storePath,
        createWorldProjectionReducers(loadWorld(capMs)),
      );
      try {
        return fn(store.db);
      } finally {
        closeStore(store);
      }
    },
    clock: () => {
      const store = openStore(
        storePath,
        createWorldProjectionReducers(loadWorld(capMs)),
      );
      try {
        return readClock(store.db);
      } finally {
        closeStore(store);
      }
    },
    progress: () => {
      const store = openStore(
        storePath,
        createWorldProjectionReducers(loadWorld(capMs)),
      );
      try {
        return readCatchUpProgress(store.db);
      } finally {
        closeStore(store);
      }
    },
    summary: () => {
      const store = openStore(
        storePath,
        createWorldProjectionReducers(loadWorld(capMs)),
      );
      try {
        return readCatchUpSummary(store.db);
      } finally {
        closeStore(store);
      }
    },
    published: () => lastPublished,
    tickLive: (count) =>
      withStore((store) => {
        const reducers = createWorldProjectionReducers(loadWorld(capMs));
        ensureTraceSchema(store.db);
        let state = restoreWorldTime(
          readLiveProjections(store, reducers),
          readClock(store.db),
        );
        let prng =
          deserializePrngState(readPrngState(store.db)) ?? createPrng(1);
        for (let i = 0; i < count; i += 1) {
          const step = applyLiveTick(
            buildRoutineQueue(state),
            state,
            prng,
            { store, reducers, traceDb: store.db },
            {
              cursorWallMs: readClock(store.db).cursorWallMs + 1_000,
              paused: false,
            },
          );
          if (step.kind !== "committed") {
            throw new Error(`live tick failed: ${step.message}`);
          }
          state = step.state;
          prng = step.prng;
        }
      }),
    dispose,
  };
}

test("a 5 hour gap with a commit that throws after two chunks, then a reopen: the backlog applies exactly the cap in total, skips exactly the excess, and applies nothing twice", async () => {
  const backlog = openBacklog("panthea-sim-catchup-cap-throw-", {
    capMs: CAP_MS,
  });
  try {
    const gapMs = 5 * CAP_MS;
    const nowWallMs = backlog.startCursor + gapMs;

    // Commit 1 discards the excess; commits 2 and 3 are chunks; commit 4 throws.
    const firstRun = await backlog.run(nowWallMs, throwsAtCommit(4));
    expect(firstRun.degraded).toBeDefined();
    expect(firstRun.summary).toEqual({
      appliedMs: 2 * 60 * 1000,
      skippedMs: gapMs - CAP_MS,
      majorOutcomes: [],
    });
    expect(backlog.clock().tick).toBe(120);

    const secondRun = await backlog.run(nowWallMs);
    expect(secondRun.degraded).toBeUndefined();
    expect(secondRun.summary.appliedMs).toBe(CAP_MS);
    expect(secondRun.summary.skippedMs).toBe(gapMs - CAP_MS);
    expect(backlog.clock().tick).toBe(CAP_MS / 1000);
    expect(backlog.clock().cursorWallMs).toBe(nowWallMs);
    expect(backlog.progress()).toBeUndefined();
  } finally {
    backlog.dispose();
  }
});

test("the excess over the cap is discarded in its own commit before any chunk: a commit that throws on the first chunk still leaves a gap no larger than the cap, and the progress records the discard", async () => {
  const backlog = openBacklog("panthea-sim-catchup-cap-discard-");
  try {
    const nowWallMs = backlog.startCursor + 5 * HOUR_MS;
    const result = await backlog.run(nowWallMs, throwsAtCommit(2));

    expect(result.degraded).toBeDefined();
    expect(backlog.clock().tick).toBe(0);
    expect(nowWallMs - backlog.clock().cursorWallMs).toBe(HOUR_MS);
    expect(result.summary).toEqual({
      appliedMs: 0,
      skippedMs: 4 * HOUR_MS,
      majorOutcomes: [],
    });
    // The degraded run persisted its partial summary and bound the still-open
    // backlog to it.
    expect(backlog.progress()).toEqual({
      appliedMs: 0,
      discardedMs: 4 * HOUR_MS,
      startSequence: 0,
      summaryId: backlog.summary()?.id,
    });
  } finally {
    backlog.dispose();
  }
});

test("a commit that throws after the discard and before the first chunk, then a reopen: the restart still reports the discarded excess as skipped", async () => {
  const backlog = openBacklog("panthea-sim-catchup-cap-restart-", {
    capMs: CAP_MS,
  });
  try {
    const gapMs = 5 * CAP_MS;
    const nowWallMs = backlog.startCursor + gapMs;
    await backlog.run(nowWallMs, throwsAtCommit(2));

    const restarted = await backlog.run(nowWallMs);

    expect(restarted.degraded).toBeUndefined();
    expect(restarted.summary.appliedMs).toBe(CAP_MS);
    expect(restarted.summary.skippedMs).toBe(gapMs - CAP_MS);
    expect(backlog.progress()).toBeUndefined();
  } finally {
    backlog.dispose();
  }
});

test("the cap bounds the remaining backlog: a discard, an immediate failure, and 30 s of downtime apply the cap in total and report the extra 30 s as skipped", async () => {
  const backlog = openBacklog("panthea-sim-catchup-cap-downtime-", {
    capMs: CAP_MS,
  });
  try {
    const firstNow = backlog.startCursor + 5 * CAP_MS;
    const downtimeMs = 30_000;
    await backlog.run(firstNow, throwsAtCommit(2));

    const restarted = await backlog.run(firstNow + downtimeMs);

    expect(restarted.summary.appliedMs).toBe(CAP_MS);
    expect(restarted.summary.skippedMs).toBe(4 * CAP_MS + downtimeMs);
    expect(backlog.clock().tick).toBe(CAP_MS / 1000);
  } finally {
    backlog.dispose();
  }
});

test("the cap bounds the remaining backlog, not the total: after a chunks were applied, a restart d later applies C - a + d", async () => {
  const backlog = openBacklog("panthea-sim-catchup-cap-remaining-", {
    capMs: CAP_MS,
  });
  try {
    const firstNow = backlog.startCursor + 5 * CAP_MS;
    const downtimeMs = 30_000;
    const applied = 60 * 1000;
    const first = await backlog.run(firstNow, throwsAtCommit(3));
    expect(first.summary.appliedMs).toBe(applied);

    const restarted = await backlog.run(firstNow + downtimeMs);

    // This run applied C - a + d; the summary counts the backlog's total.
    expect(backlog.clock().tick - applied / 1000).toBe(
      (CAP_MS - applied + downtimeMs) / 1000,
    );
    expect(restarted.summary.appliedMs).toBe(CAP_MS + downtimeMs);
    expect(restarted.summary.skippedMs).toBe(4 * CAP_MS);
  } finally {
    backlog.dispose();
  }
});

test("a backlog that fully applied before the completing commit failed is finished by the next start: the summary is persisted then, and the progress cleared with it", async () => {
  const backlog = openBacklog("panthea-sim-catchup-final-commit-");
  try {
    const nowWallMs = backlog.startCursor + 2 * 60 * 1000;
    // Commits 1 and 2 are the chunks; commit 3, the completing commit, throws.
    const failed = await backlog.run(nowWallMs, throwsAtCommit(3));
    expect(failed.degraded).toBeDefined();
    expect(backlog.progress()).toEqual({
      appliedMs: 120_000,
      discardedMs: 0,
      startSequence: 0,
    });
    expect(backlog.summary()).toBeUndefined();

    const restarted = await backlog.run(nowWallMs);

    expect(restarted.degraded).toBeUndefined();
    expect(restarted.summary).toEqual({
      appliedMs: 120_000,
      skippedMs: 0,
      majorOutcomes: [],
    });
    expect(backlog.progress()).toBeUndefined();
    expect(backlog.summary()).toMatchObject({ appliedMs: 120_000 });
  } finally {
    backlog.dispose();
  }
});

test("once a backlog completes, the next catch-up starts a new one: its summary counts only its own time", async () => {
  const backlog = openBacklog("panthea-sim-catchup-new-backlog-");
  try {
    const firstNow = backlog.startCursor + 2 * 60 * 1000;
    await backlog.run(firstNow);
    expect(backlog.progress()).toBeUndefined();

    const second = await backlog.run(firstNow + 60 * 1000);
    expect(second.summary.appliedMs).toBe(60 * 1000);
  } finally {
    backlog.dispose();
  }
});

/** A journal entry for a strike by zeus, which has no routine of its own. */
function strikeEntry(id: string) {
  return {
    proposalId: `proposal-catchup-${id}`,
    proposal: {
      schemaVersion: 1,
      kind: "strike",
      actor: "zeus",
      target: "the-tavern",
      power: 3,
      targets: [],
      expectedRevisions: [],
      source: "fixture",
      observationId: `obs-catchup-${id}`,
    },
    observation: {
      schemaVersion: 1,
      id: `obs-catchup-${id}`,
      observer: "zeus",
      stateRevision: 0,
      factsRead: [],
      source: "fixture",
    },
  };
}

test("a pending external proposal runs in the first tick of the next catch-up chunk, marked approximate, and is consumed there", async () => {
  const backlog = openBacklog("panthea-sim-catchup-journal-first-");
  try {
    backlog.withDb((db) => insertExternalProposal(db, strikeEntry("a")));

    await backlog.run(backlog.startCursor + 3 * 60 * 1000);

    backlog.withDb((db) => {
      expect(getExternalProposal(db, "proposal-catchup-a")).toMatchObject({
        targetTick: 1,
        consumedTick: 1,
      });
      const caused = listEvents(db).filter(
        (event) => String(event.correlationId) === "obs-catchup-a",
      );
      expect(caused.map((event) => event.kind)).toEqual([
        "resource-consumed",
        "building-ignited",
      ]);
      expect(caused.every((event) => event.approximate)).toBe(true);
    });
  } finally {
    backlog.dispose();
  }
});

test("a proposal accepted while catch-up yields between chunks targets the next committed tick and runs in the next chunk", async () => {
  const backlog = openBacklog("panthea-sim-catchup-journal-between-");
  try {
    let accepted = false;
    await backlog.run(backlog.startCursor + 3 * 60 * 1000, undefined, (db) => {
      if (!accepted) {
        accepted = true;
        insertExternalProposal(db, strikeEntry("b"));
      }
      return undefined;
    });

    backlog.withDb((db) => {
      expect(getExternalProposal(db, "proposal-catchup-b")).toMatchObject({
        targetTick: 61,
        consumedTick: 61,
      });
    });
  } finally {
    backlog.dispose();
  }
});

test("the cap discard neither consumes nor reschedules a pending proposal: it stays targeted at its tick and runs when ticking resumes", async () => {
  const backlog = openBacklog("panthea-sim-catchup-journal-discard-", {
    capMs: CAP_MS,
  });
  try {
    const nowWallMs = backlog.startCursor + 5 * CAP_MS;
    backlog.withDb((db) => insertExternalProposal(db, strikeEntry("c")));

    // The discard commits; the first chunk fails.
    await backlog.run(nowWallMs, throwsAtCommit(2));
    backlog.withDb((db) => {
      expect(getExternalProposal(db, "proposal-catchup-c")).toMatchObject({
        targetTick: 1,
        consumedTick: undefined,
      });
    });

    await backlog.run(nowWallMs);
    backlog.withDb((db) => {
      expect(getExternalProposal(db, "proposal-catchup-c")?.consumedTick).toBe(
        1,
      );
    });
  } finally {
    backlog.dispose();
  }
});

test("a chunk that fails to commit leaves the pending proposal pending, with no outcome and no effects, and the retry runs it once", async () => {
  const backlog = openBacklog("panthea-sim-catchup-journal-fail-");
  try {
    const nowWallMs = backlog.startCursor + 3 * 60 * 1000;
    backlog.withDb((db) => insertExternalProposal(db, strikeEntry("d")));

    const failed = await backlog.run(nowWallMs, throwsAtCommit(1));
    expect(failed.degraded).toBeDefined();
    backlog.withDb((db) => {
      expect(
        getExternalProposal(db, "proposal-catchup-d")?.consumedTick,
      ).toBeUndefined();
      expect(listEvents(db)).toEqual([]);
    });

    await backlog.run(nowWallMs);
    backlog.withDb((db) => {
      expect(getExternalProposal(db, "proposal-catchup-d")?.consumedTick).toBe(
        1,
      );
      expect(
        listEvents(db).filter(
          (event) => String(event.correlationId) === "obs-catchup-d",
        ),
      ).toHaveLength(2);
    });
  } finally {
    backlog.dispose();
  }
});

// --- A backlog's summary across restarts, crashes, pauses, and restores ---------

const THREE_MINUTES_MS = 3 * 60 * 1000;

/** A backlog holding the strike entry, so its first chunk ignites the tavern. */
function backlogWithStrike(prefix: string, id: string): Backlog {
  const backlog = openBacklog(prefix);
  backlog.withDb((db) => insertExternalProposal(db, strikeEntry(id)));
  return backlog;
}

/** What one uninterrupted run over the strike backlog reports: the yardstick every interrupted variant must equal. */
async function uninterruptedSummary() {
  const backlog = backlogWithStrike("panthea-sim-catchup-yardstick-", "y");
  try {
    const result = await backlog.run(backlog.startCursor + THREE_MINUTES_MS);
    expect(result.degraded).toBeUndefined();
    return result.summary;
  } finally {
    backlog.dispose();
  }
}

test("the yardstick: an uninterrupted run over the strike backlog reports the ignition and its consequences among its outcomes", async () => {
  const summary = await uninterruptedSummary();

  expect(summary.appliedMs).toBe(THREE_MINUTES_MS);
  expect(summary.majorOutcomes).toContain("building-ignited:the-tavern");
  expect(summary.majorOutcomes).toContain("building-destroyed:the-tavern");
});

test("a backlog interrupted after a chunk that found outcomes reports them after the restart, and its whole summary equals an uninterrupted run's", async () => {
  const yardstick = await uninterruptedSummary();
  const backlog = backlogWithStrike("panthea-sim-catchup-outcomes-", "o");
  try {
    const nowWallMs = backlog.startCursor + THREE_MINUTES_MS;

    // Two chunks commit, the third fails.
    const interrupted = await backlog.run(nowWallMs, throwsAtCommit(3));
    expect(interrupted.degraded).toBeDefined();
    expect(interrupted.summary.majorOutcomes).toContain(
      "building-ignited:the-tavern",
    );

    const resumed = await backlog.run(nowWallMs);

    expect(resumed.degraded).toBeUndefined();
    expect(resumed.summary).toEqual(yardstick);
  } finally {
    backlog.dispose();
  }
}, 30_000);

test("the process dying after the last commit and before the summary is published loses nothing: the summary is already persisted, a restart hydrates the same one, and a second catch-up leaves it alone", async () => {
  const backlog = backlogWithStrike("panthea-sim-catchup-crash-window-", "w");
  try {
    const nowWallMs = backlog.startCursor + THREE_MINUTES_MS;

    const finished = await backlog.run(nowWallMs, undefined, undefined, {
      crashBeforePublish: true,
    });
    const persisted = backlog.summary();
    expect(persisted).toMatchObject({
      appliedMs: THREE_MINUTES_MS,
      majorOutcomes: finished.summary.majorOutcomes,
    });
    expect(backlog.progress()).toBeUndefined();
    expect(backlog.published()).toBeUndefined();

    // A restart: nothing new to apply, and the frame carries the same summary.
    const restarted = await backlog.run(nowWallMs);

    expect(restarted.summary).toEqual({
      appliedMs: 0,
      skippedMs: 0,
      majorOutcomes: [],
    });
    expect(backlog.summary()).toEqual(persisted);
    expect(backlog.published()).toEqual(persisted);
  } finally {
    backlog.dispose();
  }
}, 30_000);

test("a backlog ended by a mid-catch-up pause is persisted in the pause's own commit: a restart while paused shows the same summary, id included", async () => {
  const backlog = backlogWithStrike("panthea-sim-catchup-pause-", "p");
  try {
    const nowWallMs = backlog.startCursor + THREE_MINUTES_MS;

    const paused = await backlog.run(nowWallMs, undefined, () => true, {
      crashBeforePublish: true,
    });
    expect(backlog.clock().paused).toBe(true);
    expect(paused.summary.appliedMs).toBe(60_000);
    expect(paused.summary.skippedMs).toBe(2 * 60_000);
    expect(paused.summary.majorOutcomes).toContain(
      "building-ignited:the-tavern",
    );
    const persisted = backlog.summary();
    expect(persisted).toMatchObject({
      appliedMs: 60_000,
      skippedMs: 2 * 60_000,
    });
    expect(backlog.progress()).toBeUndefined();

    await backlog.run(nowWallMs);

    expect(backlog.summary()).toEqual(persisted);
    expect(backlog.published()).toEqual(persisted);
  } finally {
    backlog.dispose();
  }
}, 30_000);

test("a closed backlog's outcomes never leak into the next one: the second summary counts only events committed after its own start", async () => {
  const backlog = backlogWithStrike("panthea-sim-catchup-two-backlogs-", "t");
  try {
    const firstNow = backlog.startCursor + THREE_MINUTES_MS;
    const first = await backlog.run(firstNow);
    expect(first.summary.majorOutcomes).toContain(
      "building-ignited:the-tavern",
    );
    const sequenceAfterFirst = backlog.withDb(
      (db) => listEvents(db).at(-1)?.sequence ?? 0,
    );

    const failed = await backlog.run(firstNow + 2 * 60_000, throwsAtCommit(2));
    expect(failed.degraded).toBeDefined();
    expect(backlog.progress()?.startSequence).toBe(sequenceAfterFirst);

    const second = await backlog.run(firstNow + 2 * 60_000);

    expect(second.summary.majorOutcomes).not.toContain(
      "building-ignited:the-tavern",
    );
    const expected = backlog.withDb((db) =>
      listEvents(db, { fromSequence: sequenceAfterFirst })
        .filter((event) =>
          [
            "building-ignited",
            "building-destroyed",
            "building-repaired",
            "legend-recorded",
          ].includes(event.kind),
        )
        .map((event) => `${event.kind}:${String(event.entityId)}`),
    );
    expect(second.summary.majorOutcomes).toEqual(expected);
  } finally {
    backlog.dispose();
  }
}, 30_000);

test("a backlog's progress records the event sequence it started after", async () => {
  const backlog = backlogWithStrike("panthea-sim-catchup-start-sequence-", "s");
  try {
    await backlog.run(
      backlog.startCursor + THREE_MINUTES_MS,
      throwsAtCommit(2),
    );

    expect(backlog.progress()?.startSequence).toBe(0);
  } finally {
    backlog.dispose();
  }
});

test("an archive exported mid-backlog, imported, and resumed reports the same summary as an uninterrupted run: applied, skipped, and outcomes", async () => {
  const yardstick = await uninterruptedSummary();
  const backlog = backlogWithStrike("panthea-sim-catchup-archive-", "a");
  const slotsDir = tempDir("panthea-sim-catchup-archive-slots-");
  try {
    const nowWallMs = backlog.startCursor + THREE_MINUTES_MS;
    const interrupted = await backlog.run(nowWallMs, throwsAtCommit(3));
    expect(interrupted.degraded).toBeDefined();
    const archivePath = join(slotsDir, "mid-backlog.sqlite");
    backlog.exportTo(archivePath);

    const slot = importWorldArchive(
      archivePath,
      join(slotsDir, "slots"),
      worldImportReducers,
    );
    const restored = backlogAt(join(slot.slotPath, "world.sqlite"));
    const resumed = await restored.run(nowWallMs);

    expect(resumed.degraded).toBeUndefined();
    expect(resumed.summary).toEqual(yardstick);
  } finally {
    backlog.dispose();
    rmSync(slotsDir, { recursive: true, force: true });
  }
}, 30_000);

test("a journaled proposal whose observation id is bound to different content is refused in its catch-up chunk with an explicit outcome: the chunk commits, and the entry is consumed as rejected", async () => {
  const backlog = openBacklog("panthea-sim-catchup-observation-conflict-");
  try {
    const entry = strikeEntry("oc");
    backlog.withDb((db) => {
      // The trace already binds this observation id to other content, as a
      // recorded observation from before would.
      ensureTraceSchema(db);
      recordObservation(db, {
        ...entry.observation,
        factsRead: ["what the earlier proposal saw"],
      } as never);
      insertExternalProposal(db, entry);
    });

    const result = await backlog.run(backlog.startCursor + 60_000);

    expect(result.degraded).toBeUndefined();
    expect(backlog.clock().tick).toBe(60);
    backlog.withDb((db) => {
      expect(getExternalProposal(db, entry.proposalId)).toMatchObject({
        consumedTick: 1,
        outcome: { status: "rejected", reason: "observation-conflict" },
      });
      expect(
        listEvents(db).some(
          (event) => String(event.correlationId) === entry.observation.id,
        ),
      ).toBe(false);
    });
  } finally {
    backlog.dispose();
  }
});

// --- The summary is persisted before it is exposed ------------------------------

/** A legend proposal from zeus with no link: a notable event (`legend-recorded`) that needs no world setup. */
function legendEntry(id: string) {
  return {
    proposalId: `proposal-legend-${id}`,
    proposal: {
      schemaVersion: 1,
      kind: "legend",
      actor: "zeus",
      assertion: `A tale told after the catch-up, ${id}.`,
      targets: [],
      expectedRevisions: [],
      source: "fixture",
      observationId: `obs-legend-${id}`,
    },
    observation: {
      schemaVersion: 1,
      id: `obs-legend-${id}`,
      observer: "zeus",
      stateRevision: 0,
      factsRead: [],
      source: "fixture",
    },
  };
}

test("completion persists the summary and clears the progress: the row a frame shows is the row on disk", async () => {
  const backlog = backlogWithStrike("panthea-sim-summary-complete-", "c");
  try {
    const result = await backlog.run(backlog.startCursor + THREE_MINUTES_MS);

    const persisted = backlog.summary();
    expect(persisted).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      atSequence: backlog.withDb((db) => listEvents(db).at(-1)?.sequence ?? 0),
      appliedMs: THREE_MINUTES_MS,
      skippedMs: 0,
      majorOutcomes: result.summary.majorOutcomes,
    });
    expect(persisted?.majorOutcomes).toContain("building-ignited:the-tavern");
    expect(backlog.progress()).toBeUndefined();
    expect(backlog.published()).toEqual(persisted);
  } finally {
    backlog.dispose();
  }
}, 30_000);

test("atomic rollback: a failed completion leaves the backlog open, no summary, and nothing published; a reopen reconstructs it and completes", async () => {
  const backlog = backlogWithStrike("panthea-sim-summary-rollback-", "r");
  try {
    // Three chunks, then the completing commit is the fourth.
    const nowWallMs = backlog.startCursor + THREE_MINUTES_MS + 500;

    const failed = await backlog.run(nowWallMs, throwsAtCommit(4));

    expect(failed.degraded).toBeDefined();
    expect(backlog.summary()).toBeUndefined();
    expect(backlog.published()).toBeUndefined();
    expect(backlog.progress()).toMatchObject({
      appliedMs: THREE_MINUTES_MS,
      discardedMs: 0,
    });
    // The cursor jump rides in the completing commit, so it rolled back too.
    expect(backlog.clock().cursorWallMs).toBe(
      backlog.startCursor + THREE_MINUTES_MS,
    );

    const reopened = await backlog.run(nowWallMs);

    expect(reopened.degraded).toBeUndefined();
    expect(backlog.progress()).toBeUndefined();
    const persisted = backlog.summary();
    expect(persisted).toMatchObject({ appliedMs: THREE_MINUTES_MS });
    expect(persisted?.majorOutcomes).toContain("building-ignited:the-tavern");
    expect(backlog.published()).toEqual(persisted);
  } finally {
    backlog.dispose();
  }
}, 30_000);

test("outcomes stay fixed while live ticks continue: a later notable event never joins a summary already persisted", async () => {
  const backlog = backlogWithStrike("panthea-sim-summary-frozen-", "f");
  try {
    await backlog.run(backlog.startCursor + THREE_MINUTES_MS);
    const frozen = backlog.summary();
    if (!frozen) throw new Error("expected a persisted summary");

    // Live ticks go on: a legend is told after the catch-up ended.
    backlog.withDb((db) => insertExternalProposal(db, legendEntry("after")));
    await backlog.tickLive(3);

    const afterLegend = backlog.withDb((db) =>
      listEvents(db, { fromSequence: frozen.atSequence }).some(
        (event) => event.kind === "legend-recorded",
      ),
    );
    expect(afterLegend).toBe(true);
    expect(backlog.summary()).toEqual(frozen);
    // A later, empty catch-up does not re-derive it either.
    await backlog.run(backlog.clock().cursorWallMs + 500);
    expect(backlog.summary()).toEqual(frozen);
    expect(backlog.published()).toEqual(frozen);
  } finally {
    backlog.dispose();
  }
}, 30_000);

test("an empty catch-up keeps the old summary, id included", async () => {
  const backlog = openBacklog("panthea-sim-summary-empty-");
  try {
    await backlog.run(backlog.startCursor + THREE_MINUTES_MS);
    const kept = backlog.summary();

    // Nothing missed at all, then less than one tick missed.
    await backlog.run(backlog.clock().cursorWallMs);
    await backlog.run(backlog.clock().cursorWallMs + 999);

    expect(backlog.summary()).toEqual(kept);
    expect(backlog.published()).toEqual(kept);
  } finally {
    backlog.dispose();
  }
}, 30_000);

test("a non-empty catch-up replaces the summary with a new id", async () => {
  const backlog = openBacklog("panthea-sim-summary-replace-");
  try {
    await backlog.run(backlog.startCursor + THREE_MINUTES_MS);
    const first = backlog.summary();

    await backlog.run(backlog.clock().cursorWallMs + 2 * 60 * 1000);

    const second = backlog.summary();
    expect(second?.appliedMs).toBe(2 * 60 * 1000);
    expect(second?.id).not.toBe(first?.id);
    expect(backlog.published()).toEqual(second);
  } finally {
    backlog.dispose();
  }
}, 30_000);

test("an eventless replacement at the same sequence still gets a new id: a discard that no chunk followed", async () => {
  const backlog = openBacklog("panthea-sim-summary-eventless-");
  try {
    await backlog.run(backlog.startCursor + 2 * 60 * 1000);
    const first = backlog.summary();
    const cursor = backlog.clock().cursorWallMs;

    // Five hours away: the excess is discarded (no world event), and the
    // first chunk's commit fails.
    const degraded = await backlog.run(cursor + 5 * HOUR_MS, throwsAtCommit(2));

    expect(degraded.degraded).toBeDefined();
    const replaced = backlog.summary();
    expect(replaced?.atSequence).toBe(first?.atSequence);
    expect(replaced).toMatchObject({ appliedMs: 0, skippedMs: 4 * HOUR_MS });
    expect(replaced?.id).not.toBe(first?.id);
    expect(backlog.published()).toEqual(replaced);
  } finally {
    backlog.dispose();
  }
}, 30_000);

test("a degraded partial catch-up persists its summary and keeps its backlog: a retry with no new committed progress reuses the id, and one that changes the summary mints a new one", async () => {
  const backlog = openBacklog("panthea-sim-summary-partial-");
  try {
    const nowWallMs = backlog.startCursor + 4 * 60 * 1000; // four chunks

    // Chunks 1 and 2 commit; chunk 3 fails.
    const first = await backlog.run(nowWallMs, throwsAtCommit(3));
    expect(first.degraded).toBeDefined();
    const partial = backlog.summary();
    expect(partial).toMatchObject({ appliedMs: 120_000 });
    expect(backlog.progress()).toMatchObject({ appliedMs: 120_000 });
    expect(backlog.published()).toEqual(partial);

    // Chunk 3 fails again: nothing new committed.
    const same = await backlog.run(nowWallMs, throwsAtCommit(1));
    expect(same.degraded).toBeDefined();
    expect(backlog.summary()?.id).toBe(partial?.id);

    // Chunk 3 commits, chunk 4 fails: the summary changed.
    const changed = await backlog.run(nowWallMs, throwsAtCommit(2));
    expect(changed.degraded).toBeDefined();
    const advanced = backlog.summary();
    expect(advanced).toMatchObject({ appliedMs: 180_000 });
    expect(advanced?.id).not.toBe(partial?.id);
    expect(backlog.progress()).toMatchObject({ appliedMs: 180_000 });

    // The retry finishes it: the whole backlog, a new id, the backlog closed.
    const done = await backlog.run(nowWallMs);
    expect(done.degraded).toBeUndefined();
    const final = backlog.summary();
    expect(final).toMatchObject({ appliedMs: 240_000 });
    expect(final?.id).not.toBe(advanced?.id);
    expect(backlog.progress()).toBeUndefined();
    expect(backlog.published()).toEqual(final);
  } finally {
    backlog.dispose();
  }
}, 30_000);

test("a summary that could not be persisted is never published: a degraded run whose partial write fails shows the previous summary, not a new one", async () => {
  const backlog = openBacklog("panthea-sim-summary-unwritable-");
  try {
    await backlog.run(backlog.startCursor + 2 * 60 * 1000);
    const previous = backlog.summary();
    // The store refuses summary writes from here on.
    backlog.withDb((db) => {
      db.exec(
        "CREATE TRIGGER refuse_summary BEFORE UPDATE ON catch_up_summary BEGIN SELECT RAISE(ABORT, 'SQLITE_FULL: simulated'); END",
      );
    });

    const degraded = await backlog.run(
      backlog.clock().cursorWallMs + 4 * 60 * 1000,
      throwsAtCommit(3),
    );

    expect(degraded.degraded).toBeDefined();
    expect(backlog.summary()).toEqual(previous);
    expect(backlog.published()).toEqual(previous);
    expect(backlog.progress()).toMatchObject({ appliedMs: 120_000 });
  } finally {
    backlog.dispose();
  }
}, 30_000);

test("an archive exported after a completed catch-up, imported, and reopened carries the same summary, id included", async () => {
  const backlog = backlogWithStrike("panthea-sim-summary-archive-", "z");
  const slotsDir = tempDir("panthea-sim-summary-archive-slots-");
  try {
    await backlog.run(backlog.startCursor + THREE_MINUTES_MS);
    const persisted = backlog.summary();
    const archivePath = join(slotsDir, "after.sqlite");
    backlog.exportTo(archivePath);

    const slot = importWorldArchive(
      archivePath,
      join(slotsDir, "slots"),
      worldImportReducers,
    );
    const restored = backlogAt(join(slot.slotPath, "world.sqlite"));

    expect(restored.summary()).toEqual(persisted);
    // A restored service hydrates it before its first frame.
    await restored.run(restored.clock().cursorWallMs);
    expect(restored.published()).toEqual(persisted);
  } finally {
    backlog.dispose();
    rmSync(slotsDir, { recursive: true, force: true });
  }
}, 30_000);

test("atomic rollback inside the transaction: a completion that fails after it wrote the summary and cleared the progress rolls both back with the cursor jump", async () => {
  const backlog = backlogWithStrike("panthea-sim-summary-in-txn-", "i");
  try {
    const nowWallMs = backlog.startCursor + THREE_MINUTES_MS + 500;

    // Three chunks, then the completing commit fails after its callback ran.
    const failed = await backlog.run(nowWallMs, failsInsideCommit(4));

    expect(failed.degraded).toBeDefined();
    expect(backlog.summary()).toBeUndefined();
    expect(backlog.published()).toBeUndefined();
    expect(backlog.progress()).toMatchObject({ appliedMs: THREE_MINUTES_MS });
    expect(backlog.clock().cursorWallMs).toBe(
      backlog.startCursor + THREE_MINUTES_MS,
    );

    await backlog.run(nowWallMs);

    expect(backlog.summary()).toMatchObject({ appliedMs: THREE_MINUTES_MS });
    expect(backlog.progress()).toBeUndefined();
  } finally {
    backlog.dispose();
  }
}, 30_000);

test("a restart's closing commit is atomic too: if it fails inside the transaction, the backlog stays open and no summary appears", async () => {
  const backlog = openBacklog("panthea-sim-summary-restart-close-");
  try {
    const nowWallMs = backlog.startCursor + 2 * 60 * 1000;
    // Two chunks commit; the completing commit (3rd) throws before it runs.
    await backlog.run(nowWallMs, throwsAtCommit(3));
    expect(backlog.progress()).toBeDefined();

    // The restart has nothing to apply; its only commit is the closing one.
    const failed = await backlog.run(nowWallMs, failsInsideCommit(1));

    expect(failed.degraded).toBeDefined();
    expect(backlog.summary()).toBeUndefined();
    expect(backlog.progress()).toMatchObject({ appliedMs: 120_000 });

    await backlog.run(nowWallMs);
    expect(backlog.summary()).toMatchObject({ appliedMs: 120_000 });
    expect(backlog.progress()).toBeUndefined();
  } finally {
    backlog.dispose();
  }
}, 30_000);

test("a pause that fails to commit leaves the world unpaused and its backlog open, with the chunks it did commit persisted as a partial summary", async () => {
  const backlog = backlogWithStrike("panthea-sim-summary-pause-fails-", "q");
  try {
    const nowWallMs = backlog.startCursor + THREE_MINUTES_MS;

    // Chunk one commits; the pause commit (the 2nd) fails inside its transaction.
    const failed = await backlog.run(
      nowWallMs,
      failsInsideCommit(2),
      () => true,
    );

    expect(failed.degraded).toBeDefined();
    expect(backlog.clock().paused).toBe(false);
    expect(backlog.progress()).toMatchObject({ appliedMs: 60_000 });
    expect(backlog.summary()).toMatchObject({ appliedMs: 60_000 });
    expect(backlog.published()).toEqual(backlog.summary());
  } finally {
    backlog.dispose();
  }
}, 30_000);

test("the summary write and the progress clear are one step: if clearing the progress fails, no summary is left behind and nothing is published", async () => {
  const backlog = backlogWithStrike("panthea-sim-summary-one-step-", "o1");
  try {
    const nowWallMs = backlog.startCursor + THREE_MINUTES_MS;
    backlog.withDb((db) => {
      db.exec(
        "CREATE TRIGGER refuse_clear BEFORE DELETE ON catch_up_progress BEGIN SELECT RAISE(ABORT, 'SQLITE_FULL: simulated'); END",
      );
    });

    const failed = await backlog.run(nowWallMs);

    expect(failed.degraded).toBeDefined();
    expect(backlog.summary()).toBeUndefined();
    expect(backlog.published()).toBeUndefined();
    expect(backlog.progress()).toMatchObject({ appliedMs: THREE_MINUTES_MS });

    backlog.withDb((db) => db.exec("DROP TRIGGER refuse_clear"));
    await backlog.run(nowWallMs);
    expect(backlog.summary()).toMatchObject({ appliedMs: THREE_MINUTES_MS });
    expect(backlog.progress()).toBeUndefined();
  } finally {
    backlog.dispose();
  }
}, 30_000);

test("a restart that closes a backlog after a failed ending commit also moves the cursor to now: the sub-tick remainder is not left behind to add up to an extra tick later", async () => {
  const backlog = openBacklog("panthea-sim-summary-remainder-");
  try {
    // Two whole chunks and half a tick over.
    const nowWallMs = backlog.startCursor + 2 * 60 * 1000 + 500;

    // The ending commit (the third) fails before it runs, so the cursor stays
    // where the last chunk left it, half a tick behind now.
    const failed = await backlog.run(nowWallMs, throwsAtCommit(3));
    expect(failed.degraded).toBeDefined();
    expect(backlog.clock().cursorWallMs).toBe(
      backlog.startCursor + 2 * 60 * 1000,
    );

    // The restart has less than a tick to apply, so its only commit is the
    // closing one. It ends the backlog exactly as the normal ending does,
    // cursor included.
    const closed = await backlog.run(nowWallMs);
    expect(closed.degraded).toBeUndefined();
    expect(backlog.progress()).toBeUndefined();
    const summary = backlog.summary();
    expect(summary).toMatchObject({ appliedMs: 120_000 });
    expect(backlog.clock().cursorWallMs).toBe(nowWallMs);

    // Less than a full tick later: nothing to apply. With the remainder left
    // behind, the two halves would add up to a whole tick here.
    const tickBefore = backlog.clock().tick;
    const next = await backlog.run(nowWallMs + 999);

    expect(next.summary).toEqual({
      appliedMs: 0,
      skippedMs: 0,
      majorOutcomes: [],
    });
    expect(backlog.clock().tick).toBe(tickBefore);
    expect(backlog.summary()).toEqual(summary);
  } finally {
    backlog.dispose();
  }
}, 30_000);

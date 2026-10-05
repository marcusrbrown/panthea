// The service runs in this process on a fast tick timer (`test-service.ts`)
// wherever the process boundary is not the subject. What is about the process
// itself is spawned: the stdin protocol, a refused second launch, and a real
// SIGKILL. A spawned test passes the same fast timer in its environment and
// runs the TypeScript entry directly via `bun run` -- never the compiled
// binary -- matching tools/probes/backend-lifecycle/src/sidecar.test.ts's
// established pattern. Compiled-binary behavior (offline bun:sqlite, no
// build-host leakage) is covered by scripts/scan-binary.sh.

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSyncFrame } from "@panthea/contracts";
import {
  closeStore,
  type ExternalProposalEntry,
  listEvents,
  listExternalProposals,
  openStore,
  commitTick as persistCommitTick,
  readCatchUpProgress,
  readCatchUpSummary,
  readClock,
  writeCatchUpProgress,
  writeCatchUpSummary,
} from "@panthea/persistence";
import {
  createProposalId,
  ensureTraceSchema,
  getModelRequestByProposalId,
  type ModelRouteResult,
  recordModelRequest,
} from "@panthea/telemetry";
import { createPrng } from "@panthea/world";
import { runCatchUp } from "./catchup";
import {
  createHydratedStatusRef,
  refreshStatusAfterCatchUp,
  resolveAppDataDir,
  TICK_TIMER_ENV,
} from "./index";
import { parseLaunchConfig } from "./launch-config";
import { createServiceStatusRef } from "./server";
import {
  FAST_TICK_MS,
  startTestService,
  stopAllTestServices,
  type TestService,
} from "./test-service";
import type { TickDeps } from "./tick";
import {
  createWorldProjectionReducers,
  loadGreekWorldState,
  worldProjectionCodec,
} from "./world-store";

const INDEX_ENTRY = join(import.meta.dir, "index.ts");
const STARTUP_TIMEOUT_MS = 10_000;

describe("resolveAppDataDir", () => {
  test("PANTHEA_APP_DATA_DIR overrides every platform", () => {
    const env = { PANTHEA_APP_DATA_DIR: "/tmp/override" } as NodeJS.ProcessEnv;
    expect(resolveAppDataDir(env, "darwin")).toBe("/tmp/override");
    expect(resolveAppDataDir(env, "win32")).toBe("/tmp/override");
    expect(resolveAppDataDir(env, "linux")).toBe("/tmp/override");
  });

  test("each platform resolves to a distinct, non-empty path without an override", () => {
    const env = {} as NodeJS.ProcessEnv;
    const darwin = resolveAppDataDir(env, "darwin");
    const linux = resolveAppDataDir(env, "linux");
    expect(darwin.length).toBeGreaterThan(0);
    expect(linux.length).toBeGreaterThan(0);
    expect(darwin).not.toBe(linux);
    expect(darwin).toContain("ai.panthe.desktop");
  });
});

describe("refreshStatusAfterCatchUp", () => {
  test("a degraded catch-up result still refreshes the status ref's sequence and state from the chunks that did commit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "panthea-sim-index-status-"));
    try {
      const storePath = join(dir, "world.sqlite");
      const seeded = loadGreekWorldState();
      const reducers = createWorldProjectionReducers(seeded);
      const store = openStore(storePath, reducers);
      ensureTraceSchema(store.db);

      const statusRef = createServiceStatusRef(seeded);
      expect(statusRef.sequence).toBe(0);

      const startCursor = readClock(store.db).cursorWallMs;
      const nowWallMs = startCursor + 5 * 60 * 1000; // several chunks worth

      let chunkAttempt = 0;
      const flakyCommitTick: TickDeps["commitTick"] = (
        storeArg,
        reducersArg,
        input,
      ) => {
        chunkAttempt += 1;
        if (chunkAttempt === 2) {
          throw new Error("simulated store write failure");
        }
        return persistCommitTick(storeArg, reducersArg, input);
      };

      const result = await runCatchUp(
        seeded,
        createPrng(1),
        { store, reducers, traceDb: store.db, commitTick: flakyCommitTick },
        { nowWallMs },
      );
      expect(result.degraded).toBeDefined();
      expect(result.state.lastSequence).toBeGreaterThan(0);

      refreshStatusAfterCatchUp(statusRef, result, store);

      expect(statusRef.status).toBe("degraded");
      expect(statusRef.degradedReason).toBe(result.degraded?.reason);
      // The bug: these must reflect the chunks that DID commit, not the
      // pre-catch-up seed state -- a stale /frame would still show
      // sequence 0 here.
      expect(statusRef.sequence).toBe(result.state.lastSequence);
      expect(statusRef.encodedState).toEqual(
        worldProjectionCodec.encode(result.state),
      );

      closeStore(store);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a degraded catch-up result publishes the partial summary the run persisted, discard included", () => {
    const dir = mkdtempSync(
      join(tmpdir(), "panthea-sim-index-degraded-summary-"),
    );
    try {
      const seeded = loadGreekWorldState();
      const reducers = createWorldProjectionReducers(seeded);
      const store = openStore(join(dir, "world.sqlite"), reducers);
      const statusRef = createServiceStatusRef(seeded);
      // What `runCatchUp` persists for a degraded partial run.
      const partial = {
        id: "partial-1",
        atSequence: 0,
        appliedMs: 120_000,
        skippedMs: 4 * 60 * 60 * 1000,
        majorOutcomes: [],
      };
      writeCatchUpSummary(store.db, partial);

      refreshStatusAfterCatchUp(
        statusRef,
        {
          summary: {
            appliedMs: 120_000,
            skippedMs: 4 * 60 * 60 * 1000,
            majorOutcomes: [],
          },
          state: seeded,
          prng: createPrng(1),
          degraded: { reason: "store-error", message: "disk hiccup" },
        },
        store,
      );

      expect(statusRef.status).toBe("degraded");
      expect(statusRef.catchUpSummary).toEqual(partial);
      closeStore(store);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a summary the result carries but the store does not hold is never published", () => {
    const dir = mkdtempSync(join(tmpdir(), "panthea-sim-index-unpersisted-"));
    try {
      const seeded = loadGreekWorldState();
      const reducers = createWorldProjectionReducers(seeded);
      const store = openStore(join(dir, "world.sqlite"), reducers);
      const statusRef = createServiceStatusRef(seeded);

      refreshStatusAfterCatchUp(
        statusRef,
        {
          summary: {
            appliedMs: 3_600_000,
            skippedMs: 60_000,
            majorOutcomes: ["building-ignited:the-tavern"],
          },
          state: seeded,
          prng: createPrng(1),
          degraded: { reason: "disk-full", message: "no space left" },
        },
        store,
      );

      expect(statusRef.status).toBe("degraded");
      expect(statusRef.catchUpSummary).toBeUndefined();
      closeStore(store);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a degraded catch-up result that committed nothing publishes no summary", () => {
    const dir = mkdtempSync(
      join(tmpdir(), "panthea-sim-index-degraded-empty-"),
    );
    try {
      const seeded = loadGreekWorldState();
      const reducers = createWorldProjectionReducers(seeded);
      const store = openStore(join(dir, "world.sqlite"), reducers);
      const statusRef = createServiceStatusRef(seeded);

      refreshStatusAfterCatchUp(
        statusRef,
        {
          summary: { appliedMs: 0, skippedMs: 0, majorOutcomes: [] },
          state: seeded,
          prng: createPrng(1),
          degraded: { reason: "store-error", message: "disk hiccup" },
        },
        store,
      );

      expect(statusRef.status).toBe("degraded");
      expect(statusRef.catchUpSummary).toBeUndefined();
      closeStore(store);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a catch-up that applied and skipped nothing leaves the earlier summary in place, id included", async () => {
    const dir = mkdtempSync(join(tmpdir(), "panthea-sim-index-empty-summary-"));
    try {
      const seeded = loadGreekWorldState();
      const reducers = createWorldProjectionReducers(seeded);
      const store = openStore(join(dir, "world.sqlite"), reducers);
      const earlier = {
        id: "earlier",
        atSequence: 0,
        appliedMs: 3_600_000,
        skippedMs: 60_000,
        majorOutcomes: ["tavern fire spread"],
      };
      writeCatchUpSummary(store.db, earlier);
      const statusRef = createServiceStatusRef(seeded, earlier);

      refreshStatusAfterCatchUp(
        statusRef,
        {
          summary: { appliedMs: 0, skippedMs: 0, majorOutcomes: [] },
          state: seeded,
          prng: createPrng(1),
        },
        store,
      );

      expect(statusRef.catchUpSummary).toEqual(earlier);
      closeStore(store);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a catch-up that applied or skipped time replaces the earlier summary with the one it persisted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "panthea-sim-index-new-summary-"));
    try {
      const seeded = loadGreekWorldState();
      const reducers = createWorldProjectionReducers(seeded);
      const store = openStore(join(dir, "world.sqlite"), reducers);
      const earlier = {
        id: "earlier",
        atSequence: 0,
        appliedMs: 1000,
        skippedMs: 0,
        majorOutcomes: [],
      };
      const statusRef = createServiceStatusRef(seeded, earlier);
      // What `runCatchUp` persisted when it ended its backlog.
      const replacement = {
        id: "replacement",
        atSequence: 0,
        appliedMs: 0,
        skippedMs: 90_000,
        majorOutcomes: [],
      };
      writeCatchUpSummary(store.db, replacement);

      refreshStatusAfterCatchUp(
        statusRef,
        {
          summary: { appliedMs: 0, skippedMs: 90_000, majorOutcomes: [] },
          state: seeded,
          prng: createPrng(1),
        },
        store,
      );

      expect(statusRef.catchUpSummary).toEqual(replacement);
      closeStore(store);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

let appDataDir: string;

beforeEach(() => {
  appDataDir = mkdtempSync(join(tmpdir(), "panthea-sim-index-test-"));
});

afterEach(() => {
  stopAllTestServices();
  rmSync(appDataDir, { recursive: true, force: true });
});

interface SpawnedService {
  readonly proc: ReturnType<typeof Bun.spawn>;
  readonly port: number;
  /** Everything the service has written to stdout so far, the port line included. */
  output(): string;
}

/** Spawns the service, writes `token` to stdin, and resolves once the port line is seen. */
/** The launch config line the shell sends when no settings were saved. */
const NO_SETTINGS_LINE = '{"models":null,"offline":false,"keys":{}}';

async function spawnService(
  token: string,
  extraEnv: Record<string, string> = {},
): Promise<SpawnedService> {
  const proc = Bun.spawn(["bun", "run", INDEX_ENTRY], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      PANTHEA_APP_DATA_DIR: appDataDir,
      [TICK_TIMER_ENV]: String(FAST_TICK_MS),
      ...extraEnv,
    },
  });

  const writer = proc.stdin;
  if (typeof writer === "number" || !writer) {
    throw new Error("expected a FileSink stdin (spawned with stdin: 'pipe')");
  }
  writer.write(`${token}\n${NO_SETTINGS_LINE}\n`);
  await writer.flush();

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const port = await Promise.race([
    (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          throw new Error("service exited before printing PANTHEA_PORT");
        }
        buffer += decoder.decode(value, { stream: true });
        const match = /PANTHEA_PORT=(\d+)/.exec(buffer);
        if (match?.[1]) {
          return Number.parseInt(match[1], 10);
        }
      }
    })(),
    new Promise<number>((_, reject) =>
      setTimeout(
        () => reject(new Error("timed out waiting for PANTHEA_PORT")),
        STARTUP_TIMEOUT_MS,
      ),
    ),
  ]);
  // Keep draining: a test waits on lines the service prints after its port
  // (a line that arrived in the same chunk as the port line is already in
  // `buffer`), and an undrained pipe would eventually block the service.
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
      }
    } catch {
      // The process was killed; there is nothing more to read.
    }
  })();

  return { proc, port, output: () => buffer };
}

/** Runs `fn` against the active store's file: read-only while a service holds it, read-write once none does (a cleanly stopped WAL store cannot be opened read-only). */
function withActiveDb<T>(
  fn: (db: Database) => T,
  options: { readonly write?: boolean } = {},
): T {
  const path = join(appDataDir, "active", "world.sqlite");
  for (const readonly of options.write ? [false] : [true, false]) {
    const db = new Database(
      path,
      readonly ? { readonly: true } : { readwrite: true },
    );
    try {
      return fn(db);
    } catch (error) {
      if (readonly && (error as { code?: string }).code === "SQLITE_CANTOPEN") {
        continue;
      }
      throw error;
    } finally {
      db.close();
    }
  }
  throw new Error("unreachable");
}

async function waitUntil<T>(
  what: string,
  probe: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await Bun.sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function service(port: number, token: string) {
  return (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}` },
    });
}

function strikeBody(proposalId: string, observationId: string) {
  return {
    proposalId,
    observation: {
      schemaVersion: 1,
      id: observationId,
      observer: "zeus",
      stateRevision: 0,
      factsRead: [],
      source: "fixture",
    },
    proposal: {
      schemaVersion: 1,
      kind: "strike",
      actor: "zeus",
      target: "the-tavern",
      power: 3,
      targets: [],
      expectedRevisions: [],
      source: "fixture",
      observationId,
    },
  };
}

describe("service (bun run src/index.ts)", () => {
  /** The service in this process on a fast tick timer, over the test's app data directory. */
  const startInProcess = (token: string): TestService =>
    startTestService({
      appDataDir,
      token,
      launch: parseLaunchConfig(NO_SETTINGS_LINE),
    });

  /** Starts a service on a fresh store and stops it cleanly, leaving a world whose persisted cursor the harness can then set. */
  async function createStore(): Promise<void> {
    const first = startInProcess("seed-token");
    await first.waitCycles("ticked", 1);
    first.stop();
  }

  const setCursor = (cursorWallMs: number) =>
    withActiveDb(
      (db) =>
        db.run("UPDATE clock SET cursor_wall_ms = ? WHERE id = 1", [
          cursorWallMs,
        ]),
      { write: true },
    );

  async function fetchSummary(port: number, token: string) {
    const response = await service(port, token)("/frame");
    const parsed = parseSyncFrame(await response.json());
    if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.message}`);
    return parsed.value.catchUpSummary;
  }

  /**
   * Seeds three minutes of downtime, starts a service, and waits until it has
   * published the summary, without ever fetching /frame. The barrier is the
   * service's own `startup catch-up complete` line, which it prints only after
   * the catch-up ran, the status was refreshed from the store, and the frame
   * was broadcast (in that order, in `startService`). Then the persisted row is
   * read from the store. Returns the running service and the persisted summary.
   */
  async function serviceThatCaughtUp(token: string) {
    await createStore();
    setCursor(Date.now() - 3 * 60 * 1000);
    const running = startInProcess(token);
    await waitUntil("the service to have published its summary", () =>
      running.output().includes("startup catch-up complete") ? true : undefined,
    );
    const persisted = withActiveDb((db) => readCatchUpSummary(db));
    if (!persisted) {
      throw new Error("the service published but no summary is persisted");
    }
    expect(persisted.appliedMs).toBe(3 * 60 * 1000);
    // Persisted with the backlog closed, in the same commit.
    expect(withActiveDb((db) => readCatchUpProgress(db))).toBeUndefined();
    return { running, persisted };
  }

  /** Restarts with a cursor in the future, so the start applies no new catch-up (a negative gap applies zero). */
  function restartWithNoNewCatchUp(token: string) {
    setCursor(Date.now() + 10 * 60 * 1000);
    return startInProcess(token);
  }

  test("a summary the service published survives a SIGKILL, fetched or not: the restarted frame carries the identical summary, id included, and still does after the service has ticked on", async () => {
    // The one summary test with a real process: a SIGKILL leaves the store as a
    // crash does, and an in-process service cannot be killed without
    // releasing its lock.
    await createStore();
    setCursor(Date.now() - 3 * 60 * 1000);
    const running = await spawnService("summary-token-1");
    await waitUntil("the service to have published its summary", () =>
      running.output().includes("startup catch-up complete") ? true : undefined,
    );
    const persisted = withActiveDb((db) => readCatchUpSummary(db));
    if (!persisted) {
      throw new Error("the service published but no summary is persisted");
    }
    expect(persisted.appliedMs).toBe(3 * 60 * 1000);
    expect(withActiveDb((db) => readCatchUpProgress(db))).toBeUndefined();
    // A client fetched it, and then the service was killed.
    expect(await fetchSummary(running.port, "summary-token-1")).toEqual(
      persisted,
    );
    running.proc.kill("SIGKILL");
    await running.proc.exited;

    setCursor(Date.now() + 10 * 60 * 1000);
    const restarted = await spawnService("summary-token-2");
    try {
      // The very first frame the restarted service serves.
      const first = await fetchSummary(restarted.port, "summary-token-2");
      expect(first).toEqual(persisted);
      expect(first?.id).toBe(persisted.id);

      // And it is still that summary after the service has ticked on.
      const tick = () =>
        withActiveDb(
          (db) =>
            (db.query("SELECT tick FROM clock").get() as { tick: number }).tick,
        );
      const t0 = tick();
      await waitUntil("the restarted world to tick on", () =>
        tick() >= t0 + 5 ? true : undefined,
      );
      expect(await fetchSummary(restarted.port, "summary-token-2")).toEqual(
        persisted,
      );
      expect(withActiveDb((db) => readCatchUpSummary(db))).toEqual(persisted);
    } finally {
      restarted.proc.kill();
    }
  });

  test("the service's own startup line is an honest publication barrier: when it appears, the first frame already carries the summary, and it is the persisted one", async () => {
    await createStore();
    setCursor(Date.now() - 3 * 60 * 1000);
    const running = startInProcess("summary-barrier-token");
    await waitUntil("the service to have published its summary", () =>
      running.output().includes("startup catch-up complete") ? true : undefined,
    );

    const persisted = withActiveDb((db) => readCatchUpSummary(db));
    expect(persisted).toBeDefined();
    // Fetched only now, after the barrier: had the line been printed before
    // the status was refreshed and the frame broadcast, this would be empty.
    expect(await fetchSummary(running.port, "summary-barrier-token")).toEqual(
      persisted,
    );
  });

  test("a degraded partial summary meets a restart with nothing new to apply: every frame carries that same summary, id and applied time, because the closing commit reuses the id", async () => {
    // The property is about the summary, not the size of the cap: a ten minute
    // cap and a gap five times it discard four caps and apply none.
    const CAP_MS = 10 * 60 * 1000;
    const loaded = loadGreekWorldState();
    const seeded = {
      ...loaded,
      rules: { ...loaded.rules, catchUpCapMs: CAP_MS },
    };
    const reducers = createWorldProjectionReducers(seeded);
    const store = openStore(
      join(appDataDir, "active", "world.sqlite"),
      reducers,
    );
    ensureTraceSchema(store.db);
    const nowWallMs = Date.now();
    store.db.run("UPDATE clock SET cursor_wall_ms = ? WHERE id = 1", [
      nowWallMs - 5 * CAP_MS,
    ]);
    let attempt = 0;
    const interrupted = await runCatchUp(
      seeded,
      createPrng(1),
      {
        store,
        reducers,
        traceDb: store.db,
        commitTick: (storeArg, reducersArg, input) => {
          attempt += 1;
          if (attempt === 2) throw new Error("simulated commit failure");
          return persistCommitTick(storeArg, reducersArg, input);
        },
      },
      { nowWallMs },
    );
    expect(interrupted.degraded).toBeDefined();
    const partial = readCatchUpSummary(store.db);
    expect(partial).toMatchObject({ appliedMs: 0, skippedMs: 4 * CAP_MS });
    expect(readCatchUpProgress(store.db)).toBeDefined();
    closeStore(store);
    // The restart has nothing new to apply, so the summary cannot be replaced
    // by a completed backlog: it can only be kept.
    const restarted = restartWithNoNewCatchUp("summary-partial-token");
    // Whether this frame is served before or after the restart's closing
    // commit, it must be that one summary.
    expect(await fetchSummary(restarted.port, "summary-partial-token")).toEqual(
      partial,
    );

    await waitUntil("the restart to close the backlog", () =>
      restarted.output().includes("startup catch-up complete")
        ? true
        : undefined,
    );
    expect(withActiveDb((db) => readCatchUpProgress(db))).toBeUndefined();
    expect(withActiveDb((db) => readCatchUpSummary(db))).toEqual(partial);
    expect(await fetchSummary(restarted.port, "summary-partial-token")).toEqual(
      partial,
    );
  });

  test("a clean restart keeps the summary too, and a later real catch-up replaces it with a new id", async () => {
    const { running, persisted } = await serviceThatCaughtUp("summary-token-5");
    running.stop();

    const restarted = restartWithNoNewCatchUp("summary-token-6");
    expect(await fetchSummary(restarted.port, "summary-token-6")).toEqual(
      persisted,
    );
    restarted.stop();

    // Two more minutes pass while the service is down: a new catch-up.
    setCursor(Date.now() - 2 * 60 * 1000);
    const later = startInProcess("summary-token-7");
    const replaced = await waitUntil("a new summary", () => {
      const current = withActiveDb((db) => readCatchUpSummary(db));
      return current && current.id !== persisted.id ? current : undefined;
    });
    expect(replaced.appliedMs).toBeGreaterThanOrEqual(2 * 60 * 1000);
    expect(await fetchSummary(later.port, "summary-token-7")).toEqual(replaced);
  });

  test("a restart prunes model-request payload text older than seven days at startup and keeps the digests", async () => {
    await createStore();

    const day = 24 * 60 * 60 * 1000;
    const route: ModelRouteResult = {
      kind: "intent",
      step: {
        endpoint: "ollama",
        model: "m",
        attempts: 1,
        elapsedMs: 1,
        mode: "native",
      },
      failed: [],
      elapsedMs: 1,
    };
    const old = createProposalId();
    const recent = createProposalId();
    withActiveDb(
      (db) => {
        for (const [proposalId, ageDays] of [
          [old, 8],
          [recent, 1],
        ] as const) {
          recordModelRequest(
            db,
            { proposalId, role: "zeus", route, prompt: "p", output: "o" },
            Date.now() - ageDays * day,
          );
        }
      },
      { write: true },
    );

    // Pruning runs when the service starts, before it serves its first tick:
    // `startService` has returned, so it has already happened.
    startInProcess("prune-token-2");
    const prunedOld = withActiveDb((db) =>
      getModelRequestByProposalId(db, old),
    );
    const keptRecent = withActiveDb((db) =>
      getModelRequestByProposalId(db, recent),
    );
    expect(prunedOld?.promptPayload).toBeUndefined();
    expect(prunedOld?.promptDigest).toHaveLength(64);
    expect(keptRecent?.promptPayload).toBe("p");
  });

  test("proposals accepted while paused stay pending through a restart and run, in order, once the world resumes", async () => {
    const first = startInProcess("pause-token-1");
    const call1 = service(first.port, "pause-token-1");
    expect((await call1("/pause", { method: "POST" })).status).toBe(200);
    const a = strikeBody("proposal-pause-a", "obs-pause-a");
    const b = {
      ...strikeBody("proposal-pause-b", "obs-pause-b"),
      proposal: {
        ...strikeBody("x", "obs-pause-b").proposal,
        kind: "worship",
        actor: "farmer",
        deity: "zeus",
        offering: { resource: "currency", amount: 1 },
        target: undefined,
        power: undefined,
      },
    };
    for (const body of [a, b]) {
      const response = await call1("/proposals", {
        method: "POST",
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(202);
    }
    // Paused for several timer cycles, and nothing ran.
    await first.waitCycles("paused", 5);
    const pausedTick = withActiveDb(
      (db) =>
        (db.query("SELECT tick FROM clock").get() as { tick: number }).tick,
    );
    expect(
      withActiveDb((db) => listExternalProposals(db)).map(
        (e) => e.consumedTick,
      ),
    ).toEqual([undefined, undefined]);

    first.stop();

    const second = startInProcess("pause-token-2");
    const call2 = service(second.port, "pause-token-2");
    await second.waitCycles("paused", 5);
    const stillPending: readonly ExternalProposalEntry[] = withActiveDb((db) =>
      listExternalProposals(db),
    );
    expect(
      stillPending.map((e) => [e.proposalId, e.consumedTick, e.targetTick]),
    ).toEqual([
      ["proposal-pause-a", undefined, pausedTick + 1],
      ["proposal-pause-b", undefined, pausedTick + 1],
    ]);

    expect((await call2("/resume", { method: "POST" })).status).toBe(200);
    const consumed = await waitUntil("both proposals to be consumed", () => {
      const rows = withActiveDb((db) => listExternalProposals(db));
      return rows.every((row) => row.consumedTick !== undefined)
        ? rows
        : undefined;
    });
    expect(consumed.map((row) => row.consumedTick)).toEqual([
      pausedTick + 1,
      pausedTick + 1,
    ]);
    const sequenceOf = (observationId: string) =>
      withActiveDb((db) =>
        listEvents(db).find(
          (event) => String(event.correlationId) === observationId,
        ),
      )?.sequence ?? Number.NaN;
    expect(sequenceOf("obs-pause-a")).toBeLessThan(sequenceOf("obs-pause-b"));
  });

  test("error path: a request without the launch token is rejected", async () => {
    const { port } = startInProcess("test-token-1");
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(401);

    const authorized = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Authorization: "Bearer test-token-1" },
    });
    expect(authorized.status).toBe(200);
  });

  test("stdin EOF triggers a graceful exit", async () => {
    const { proc, port } = await spawnService("test-token-2");
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Authorization: "Bearer test-token-2" },
    });
    expect(response.status).toBe(200);

    const stdin = proc.stdin;
    if (typeof stdin === "number" || !stdin) {
      throw new Error("expected a FileSink stdin (spawned with stdin: 'pipe')");
    }
    stdin.end();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  test("a five hour gap whose first chunk never committed after the discard: the restarted service completes the backlog and its /frame reports all of it, discard included, under a new id", async () => {
    // The property is about the summary, not the size of the cap: a ten minute
    // cap and a gap five times it, so the backlog is ten chunks and not sixty.
    const CAP_MS = 10 * 60 * 1000;
    const loaded = loadGreekWorldState();
    const seeded = {
      ...loaded,
      rules: { ...loaded.rules, catchUpCapMs: CAP_MS },
    };
    const reducers = createWorldProjectionReducers(seeded);
    const storePath = join(appDataDir, "active", "world.sqlite");
    const store = openStore(storePath, reducers);
    ensureTraceSchema(store.db);
    const nowWallMs = Date.now();
    store.db.run("UPDATE clock SET cursor_wall_ms = ? WHERE id = 1", [
      nowWallMs - 5 * CAP_MS,
    ]);
    let attempt = 0;
    const interrupted = await runCatchUp(
      seeded,
      createPrng(1),
      {
        store,
        reducers,
        traceDb: store.db,
        commitTick: (storeArg, reducersArg, input) => {
          attempt += 1;
          if (attempt === 2) throw new Error("simulated commit failure");
          return persistCommitTick(storeArg, reducersArg, input);
        },
      },
      { nowWallMs },
    );
    expect(interrupted.degraded).toBeDefined();
    expect(readClock(store.db).tick).toBe(0);
    // The interrupted run persisted what it committed: the discard, nothing
    // applied yet. That partial summary is what a restart shows first.
    const partial = readCatchUpSummary(store.db);
    expect(partial).toMatchObject({ appliedMs: 0, skippedMs: 4 * CAP_MS });
    closeStore(store);

    const { port } = startInProcess("test-token-frame");
    const frameSummary = async () => {
      const response = await fetch(`http://127.0.0.1:${port}/frame`, {
        headers: { Authorization: "Bearer test-token-frame" },
      });
      const parsed = parseSyncFrame(await response.json());
      if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.message}`);
      return parsed.value.catchUpSummary;
    };
    const summary = await waitUntil(
      "the completed backlog's summary",
      async () => {
        const current = await frameSummary();
        return current?.appliedMs === CAP_MS ? current : undefined;
      },
    );

    // The cap is applied once; everything else in the five caps, and the
    // seconds the restart took, was discarded.
    expect(summary.appliedMs).toBe(CAP_MS);
    expect(summary.skippedMs).toBeGreaterThanOrEqual(4 * CAP_MS);
    expect(summary.skippedMs).toBeLessThan(4 * CAP_MS + 60_000);
    // The completed backlog is a different summary from the partial one.
    expect(summary.id).not.toBe(partial?.id);
  });

  test("error path: stdin EOF before any token line refuses to start (non-zero exit, never serves)", async () => {
    const proc = Bun.spawn(["bun", "run", INDEX_ENTRY], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        PANTHEA_APP_DATA_DIR: appDataDir,
        [TICK_TIMER_ENV]: String(FAST_TICK_MS),
      },
    });

    const stdin = proc.stdin;
    if (typeof stdin === "number" || !stdin) {
      throw new Error("expected a FileSink stdin (spawned with stdin: 'pipe')");
    }
    stdin.end();

    const exitCode = await proc.exited;
    expect(exitCode).not.toBe(0);
    const stdout = await new Response(proc.stdout).text();
    expect(stdout).not.toContain("PANTHEA_PORT=");
  });

  test("error path: stdin EOF after the token but before a launch config refuses to start (non-zero exit, never serves)", async () => {
    const proc = Bun.spawn(["bun", "run", INDEX_ENTRY], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        PANTHEA_APP_DATA_DIR: appDataDir,
        [TICK_TIMER_ENV]: String(FAST_TICK_MS),
      },
    });
    const stdin = proc.stdin;
    if (typeof stdin === "number" || !stdin) {
      throw new Error("expected a FileSink stdin");
    }
    stdin.write("token-without-config\n");
    await stdin.end();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(1);
    const stdout = await new Response(proc.stdout).text();
    expect(stdout).not.toContain("PANTHEA_PORT=");
    const stderr = await new Response(proc.stderr).text();
    expect(stderr).toContain("before a launch config");
  });

  test("a duplicate launch against the same app data dir is refused", async () => {
    const first = await spawnService("test-token-3");
    try {
      const second = Bun.spawn(["bun", "run", INDEX_ENTRY], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          PANTHEA_APP_DATA_DIR: appDataDir,
          [TICK_TIMER_ENV]: String(FAST_TICK_MS),
        },
      });
      const secondStdin = second.stdin;
      if (typeof secondStdin === "number" || !secondStdin) {
        throw new Error("expected a FileSink stdin");
      }
      secondStdin.write(`test-token-4\n${NO_SETTINGS_LINE}\n`);
      await secondStdin.flush();
      const exitCode = await second.exited;
      expect(exitCode).toBe(3);
    } finally {
      first.proc.kill();
    }
  });
});

describe("createHydratedStatusRef", () => {
  test("a starting service's status already carries the persisted summary, so the first frame it serves shows it even while a long catch-up is still running", async () => {
    const dir = mkdtempSync(join(tmpdir(), "panthea-sim-index-hydrate-"));
    try {
      const seeded = loadGreekWorldState();
      const reducers = createWorldProjectionReducers(seeded);
      const store = openStore(join(dir, "world.sqlite"), reducers);
      const delivered = {
        id: "delivered-before-the-restart",
        atSequence: 0,
        appliedMs: 3_600_000,
        skippedMs: 60_000,
        majorOutcomes: ["building-ignited:the-tavern"],
      };
      writeCatchUpSummary(store.db, delivered);

      const statusRef = createHydratedStatusRef(seeded, store);

      expect(statusRef.catchUpSummary).toEqual(delivered);
      closeStore(store);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("with no summary persisted, the status carries none", () => {
    const dir = mkdtempSync(join(tmpdir(), "panthea-sim-index-hydrate-none-"));
    try {
      const seeded = loadGreekWorldState();
      const store = openStore(
        join(dir, "world.sqlite"),
        createWorldProjectionReducers(seeded),
      );

      expect(
        createHydratedStatusRef(seeded, store).catchUpSummary,
      ).toBeUndefined();
      closeStore(store);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("refreshStatusAfterCatchUp: closing the backlog", () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "panthea-sim-index-close-"));
    const seeded = loadGreekWorldState();
    const reducers = createWorldProjectionReducers(seeded);
    const store = openStore(join(dir, "world.sqlite"), reducers);
    ensureTraceSchema(store.db);
    writeCatchUpProgress(store.db, {
      appliedMs: 120_000,
      discardedMs: 0,
      startSequence: 0,
    });
    return {
      seeded,
      store,
      dispose() {
        closeStore(store);
        rmSync(dir, { recursive: true, force: true });
      },
    };
  }

  const finished = (world: ReturnType<typeof setup>) => ({
    summary: { appliedMs: 120_000, skippedMs: 0, majorOutcomes: [] },
    state: world.seeded,
    prng: createPrng(1),
  });

  test("refreshing the status neither opens nor closes a backlog: ending it is the run's own commit", () => {
    const world = setup();
    try {
      const statusRef = createServiceStatusRef(world.seeded);

      refreshStatusAfterCatchUp(statusRef, finished(world), world.store);

      expect(readCatchUpProgress(world.store.db)).toEqual({
        appliedMs: 120_000,
        discardedMs: 0,
        startSequence: 0,
      });
      expect(statusRef.catchUpSummary).toBeUndefined();
    } finally {
      world.dispose();
    }
  });

  test("a degraded run leaves the backlog open, so a restart continues it", () => {
    const world = setup();
    try {
      const statusRef = createServiceStatusRef(world.seeded);

      refreshStatusAfterCatchUp(
        statusRef,
        {
          ...finished(world),
          degraded: { reason: "store-error", message: "disk hiccup" },
        },
        world.store,
      );

      expect(readCatchUpProgress(world.store.db)).toBeDefined();
    } finally {
      world.dispose();
    }
  });
});

describe("refreshStatusAfterCatchUp: nothing happened", () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "panthea-sim-index-nothing-"));
    const seeded = loadGreekWorldState();
    const reducers = createWorldProjectionReducers(seeded);
    const store = openStore(join(dir, "world.sqlite"), reducers);
    ensureTraceSchema(store.db);
    return {
      seeded,
      reducers,
      store,
      dispose() {
        closeStore(store);
        rmSync(dir, { recursive: true, force: true });
      },
    };
  }

  test("a fresh world's startup catch-up, run milliseconds after the store was created, leaves the frame with no catch-up summary", async () => {
    const world = setup();
    try {
      const statusRef = createServiceStatusRef(world.seeded);
      const result = await runCatchUp(
        world.seeded,
        createPrng(1),
        {
          store: world.store,
          reducers: world.reducers,
          traceDb: world.store.db,
        },
        { nowWallMs: readClock(world.store.db).cursorWallMs + 5 },
      );

      refreshStatusAfterCatchUp(statusRef, result, world.store);

      expect(statusRef.catchUpSummary).toBeUndefined();
    } finally {
      world.dispose();
    }
  });

  test("a catch-up that applied less than one tick and has no outcomes leaves the earlier summary in place", () => {
    const world = setup();
    try {
      const earlier = {
        id: "earlier",
        atSequence: 0,
        appliedMs: 3_600_000,
        skippedMs: 60_000,
        majorOutcomes: ["tavern fire spread"],
      };
      writeCatchUpSummary(world.store.db, earlier);
      const statusRef = createServiceStatusRef(world.seeded, earlier);

      refreshStatusAfterCatchUp(
        statusRef,
        {
          summary: { appliedMs: 400, skippedMs: 0, majorOutcomes: [] },
          state: world.seeded,
          prng: createPrng(1),
        },
        world.store,
      );

      expect(statusRef.catchUpSummary).toEqual(earlier);
    } finally {
      world.dispose();
    }
  });

  test("a catch-up that applied less than one tick but found an outcome persists and reports it", () => {
    const world = setup();
    try {
      const outcome = {
        id: "outcome-only",
        atSequence: 0,
        appliedMs: 0,
        skippedMs: 0,
        majorOutcomes: ["building-ignited:the-tavern"],
      };
      writeCatchUpSummary(world.store.db, outcome);
      const statusRef = createServiceStatusRef(world.seeded);

      refreshStatusAfterCatchUp(
        statusRef,
        {
          summary: {
            appliedMs: 0,
            skippedMs: 0,
            majorOutcomes: ["building-ignited:the-tavern"],
          },
          state: world.seeded,
          prng: createPrng(1),
        },
        world.store,
      );

      expect(statusRef.catchUpSummary).toEqual(outcome);
    } finally {
      world.dispose();
    }
  });
});

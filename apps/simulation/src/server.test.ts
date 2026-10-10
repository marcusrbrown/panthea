import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createObservationId,
  createSessionId,
  type EventId,
  parseSyncFrame,
} from "@panthea/contracts";
import {
  closeStore,
  insertExternalProposal,
  listEvents,
  listExternalProposals,
  openStore,
  readCatchUpProgress,
  readCatchUpSummary,
  readClock,
  writeCatchUpProgress,
  writeCatchUpSummary,
} from "@panthea/persistence";
import {
  createProposalId,
  ensureTraceSchema,
  getObservation,
  getProposalOutcomeByProposalId,
  listReceiptsByEvent,
} from "@panthea/telemetry";
import {
  createPrng,
  decode as decodeWorldState,
  submitProposal,
  toEntityId,
} from "@panthea/world";
import { toViewModel } from "../../client/src/store";
import { runCatchUp } from "./catchup";
import { recordPartialSummary } from "./catchup-summary";
import { refreshStatusAfterCatchUp } from "./index";
import {
  applyLiveTick,
  type CatchUpControl,
  createServiceStatusRef,
  createSimulationServer,
} from "./server";
import {
  applyOneTick,
  buildRoutineQueue,
  type QueuedProposal,
  type TickDeps,
} from "./tick";
import {
  createWorldProjectionReducers,
  loadGreekWorldState,
} from "./world-store";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

interface Harness {
  readonly baseUrl: string;
  readonly token: string;
  readonly committedEventId: EventId;
  readonly db: import("bun:sqlite").Database;
  stop(): void;
}

function startHarness(
  options: { readonly commitTick?: TickDeps["commitTick"] } = {},
): Harness {
  const storeDir = tempDir("panthea-sim-server-");
  const slotsDir = tempDir("panthea-sim-server-slots-");
  const storePath = join(storeDir, "world.sqlite");
  const seeded = loadGreekWorldState();
  const reducers = createWorldProjectionReducers(seeded);
  const store = openStore(storePath, reducers);
  ensureTraceSchema(store.db);

  // One real committed tick (through the same tick.ts path a live service
  // uses) so a trace observation/outcome exists to exercise /trace and
  // /receipts against.
  const queue = buildRoutineQueue(seeded);
  if (queue.length === 0) {
    throw new Error(
      "expected at least one routine-driven proposal to seed a committed event",
    );
  }
  const step = applyOneTick(
    seeded,
    createPrng(1),
    queue,
    { store, reducers, traceDb: store.db },
    { cursorWallMs: 1_000, paused: false },
  );
  if (step.kind !== "committed")
    throw new Error("expected a committed seed tick");
  let committedEventId: EventId | undefined;
  for (const queued of queue) {
    const outcome = getProposalOutcomeByProposalId(store.db, queued.id);
    const [firstEventId] = outcome?.eventIds ?? [];
    if (outcome?.outcome === "committed" && firstEventId) {
      committedEventId = firstEventId;
      break;
    }
  }
  if (!committedEventId)
    throw new Error("expected at least one seed proposal to commit an event");

  const token = "the-launch-token";
  const statusRef = createServiceStatusRef(step.state);

  const handle = createSimulationServer({
    token,
    store,
    reducers,
    traceDb: store.db,
    slotsDir,
    statusRef,
    port: 0,
    ...(options.commitTick ? { commitTick: options.commitTick } : {}),
  });

  return {
    baseUrl: `http://127.0.0.1:${handle.port}`,
    token,
    committedEventId,
    db: store.db,
    stop() {
      handle.stop(true);
      closeStore(store);
      rmSync(storeDir, { recursive: true, force: true });
      rmSync(slotsDir, { recursive: true, force: true });
    },
  };
}

describe("request guards", () => {
  test("a missing or wrong token gets 401, and the token never appears in server output", async () => {
    const harness = startHarness();
    const logs: string[] = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.warn = console.log;
    console.error = console.log;
    try {
      const missing = await fetch(`${harness.baseUrl}/health`);
      expect(missing.status).toBe(401);

      const wrong = await fetch(`${harness.baseUrl}/health`, {
        headers: { Authorization: "Bearer not-the-token" },
      });
      expect(wrong.status).toBe(401);

      const right = await fetch(`${harness.baseUrl}/health`, {
        headers: { Authorization: `Bearer ${harness.token}` },
      });
      expect(right.status).toBe(200);

      for (const line of logs) {
        expect(line).not.toContain(harness.token);
      }
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      harness.stop();
    }
  });

  test("a request carrying an Origin header is rejected even with a valid token", async () => {
    const harness = startHarness();
    try {
      const response = await fetch(`${harness.baseUrl}/health`, {
        headers: {
          Authorization: `Bearer ${harness.token}`,
          Origin: "http://evil.example",
        },
      });
      expect(response.status).toBe(401);
    } finally {
      harness.stop();
    }
  });

  test("a request carrying a Sec-Fetch-* header is rejected even with a valid token", async () => {
    const harness = startHarness();
    try {
      const response = await fetch(`${harness.baseUrl}/health`, {
        headers: {
          Authorization: `Bearer ${harness.token}`,
          "Sec-Fetch-Mode": "cors",
        },
      });
      expect(response.status).toBe(401);
    } finally {
      harness.stop();
    }
  });

  test("a request with a foreign Host header is rejected even with a valid token", async () => {
    const harness = startHarness();
    try {
      const response = await fetch(`${harness.baseUrl}/health`, {
        headers: {
          Authorization: `Bearer ${harness.token}`,
          Host: "evil.example:9999",
        },
      });
      expect(response.status).toBe(401);
    } finally {
      harness.stop();
    }
  });

  test("a previous session's (no-longer-valid) token is rejected the same as any wrong token", async () => {
    const harness = startHarness();
    try {
      const response = await fetch(`${harness.baseUrl}/health`, {
        headers: { Authorization: "Bearer a-token-from-an-earlier-launch" },
      });
      expect(response.status).toBe(401);
    } finally {
      harness.stop();
    }
  });
});

function authed(harness: Harness, path: string, init: RequestInit = {}) {
  return fetch(`${harness.baseUrl}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${harness.token}`,
    },
  });
}

test("GET /frame returns a running-status SyncFrame carrying the world's committed state", async () => {
  const harness = startHarness();
  try {
    const response = await authed(harness, "/frame");
    expect(response.status).toBe(200);
    const frame = (await response.json()) as {
      status: string;
      sequence: number;
    };
    expect(frame.status).toBe("running");
    expect(frame.sequence).toBeGreaterThan(0);
  } finally {
    harness.stop();
  }
});

test("a frame from the real service decodes in the client store with a sprite id on every actor", async () => {
  const harness = startHarness();
  try {
    const response = await authed(harness, "/frame");
    const parsed = parseSyncFrame(await response.json());
    if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.message}`);
    const view = toViewModel(
      parsed.value,
      decodeWorldState(parsed.value.state),
    );
    const actors = Object.values(view.realms).flatMap((realm) =>
      realm.flatMap((location) => location.actors),
    );
    expect(actors.length).toBeGreaterThan(20);
    for (const actor of actors) {
      expect({ id: actor.id, sprite: actor.sprite }).toEqual({
        id: actor.id,
        sprite: expect.stringMatching(/^[a-z0-9]+(-[a-z0-9]+)*$/),
      });
    }
    const byId = new Map(actors.map((actor) => [actor.id, actor.sprite]));
    expect(byId.get("zeus")).toBe("zeus-sprite");
    expect(byId.get("woodcutter")).toBe("placeholder-woodcutter");
  } finally {
    harness.stop();
  }
});

test("a reconnecting WebSocket subscriber gets a fresh frame immediately on open", async () => {
  const harness = startHarness();
  try {
    const wsUrl = `${harness.baseUrl.replace("http://", "ws://")}/stream`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${harness.token}` },
      } as never);
      const frame = await new Promise<{ status: string }>((resolve, reject) => {
        ws.onmessage = (event) => resolve(JSON.parse(event.data as string));
        ws.onerror = (event) => reject(event);
        setTimeout(
          () => reject(new Error("timed out waiting for a frame")),
          5_000,
        );
      });
      expect(frame.status).toBe("running");
      ws.close();
    }
  } finally {
    harness.stop();
  }
});

test("one sessionId per sidecar launch: every broadcast, /frame response, and WS connection carries the same id until restart", async () => {
  const harness = startHarness();
  try {
    const first = (await (await authed(harness, "/frame")).json()) as {
      sessionId: string;
    };
    const second = (await (await authed(harness, "/frame")).json()) as {
      sessionId: string;
    };
    expect(second.sessionId).toBe(first.sessionId);

    const wsUrl = `${harness.baseUrl.replace("http://", "ws://")}/stream`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${harness.token}` },
      } as never);
      const frame = await new Promise<{ sessionId: string }>(
        (resolve, reject) => {
          ws.onmessage = (event) => resolve(JSON.parse(event.data as string));
          ws.onerror = (event) => reject(event);
          setTimeout(
            () => reject(new Error("timed out waiting for a frame")),
            5_000,
          );
        },
      );
      expect(frame.sessionId).toBe(first.sessionId);
      ws.close();
    }
  } finally {
    harness.stop();
  }
});

test("a restarted server (a fresh createSimulationServer call) mints a new sessionId", async () => {
  const harnessA = startHarness();
  const harnessB = startHarness();
  try {
    const frameA = (await (await authed(harnessA, "/frame")).json()) as {
      sessionId: string;
    };
    const frameB = (await (await authed(harnessB, "/frame")).json()) as {
      sessionId: string;
    };
    expect(frameB.sessionId).not.toBe(frameA.sessionId);
  } finally {
    harnessA.stop();
    harnessB.stop();
  }
});

test("POST /receipts: idempotent per (event, session), duplicates are not persisted, unknown events are rejected, and a flood is capped", async () => {
  const harness = startHarness();
  try {
    const sessionId = createSessionId();

    const unknown = await authed(harness, "/receipts", {
      method: "POST",
      body: JSON.stringify({
        eventId: "evt-never-committed",
        sessionId,
      }),
    });
    expect(unknown.status).toBe(404);

    const first = await authed(harness, "/receipts", {
      method: "POST",
      body: JSON.stringify({ eventId: harness.committedEventId, sessionId }),
    });
    expect(first.status).toBe(200);

    const duplicate = await authed(harness, "/receipts", {
      method: "POST",
      body: JSON.stringify({ eventId: harness.committedEventId, sessionId }),
    });
    expect(duplicate.status).toBe(200);

    const rows = listReceiptsByEvent(harness.db, harness.committedEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sessionId).toBe(sessionId);

    let sawRateLimited = false;
    for (let i = 0; i < 60; i += 1) {
      const response = await authed(harness, "/receipts", {
        method: "POST",
        body: JSON.stringify({
          eventId: harness.committedEventId,
          sessionId: createSessionId(),
        }),
      });
      if (response.status === 429) {
        sawRateLimited = true;
        break;
      }
    }
    expect(sawRateLimited).toBe(true);
  } finally {
    harness.stop();
  }
});

test("POST /pause then POST /resume persist the clock's paused flag and record operator events, not character actions", async () => {
  const harness = startHarness();
  try {
    const pause = await authed(harness, "/pause", { method: "POST" });
    expect(pause.status).toBe(200);
    const resume = await authed(harness, "/resume", { method: "POST" });
    expect(resume.status).toBe(200);
  } finally {
    harness.stop();
  }
});

test("a store failure during POST /pause returns 500, sets degraded status with a reason, and leaves the persisted paused flag unchanged", async () => {
  const harness = startHarness({
    commitTick: () => {
      throw new Error("disk I/O error: SQLITE_FULL");
    },
  });
  try {
    const before = readClock(harness.db);
    expect(before.paused).toBe(false);

    const pause = await authed(harness, "/pause", { method: "POST" });
    expect(pause.status).toBe(500);

    expect(readClock(harness.db).paused).toBe(false);

    const frame = (await (await authed(harness, "/frame")).json()) as {
      status: string;
      degradedReason: string;
    };
    expect(frame.status).toBe("degraded");
    expect(frame.degradedReason).toBe("disk-full");
  } finally {
    harness.stop();
  }
});

test("a store failure during POST /resume returns 500, sets degraded status with a reason, and leaves the persisted paused flag unchanged", async () => {
  const harness = startHarness();
  try {
    const pause = await authed(harness, "/pause", { method: "POST" });
    expect(pause.status).toBe(200);
    expect(readClock(harness.db).paused).toBe(true);
  } finally {
    harness.stop();
  }

  const failingHarness = startHarness({
    commitTick: () => {
      throw new Error("disk I/O error: SQLITE_FULL");
    },
  });
  try {
    // Seed a paused clock directly (bypassing the failing commitTick),
    // mirroring an operator having paused before the store started
    // failing.
    failingHarness.db.run("UPDATE clock SET paused = 1 WHERE id = 1");

    const resume = await authed(failingHarness, "/resume", { method: "POST" });
    expect(resume.status).toBe(500);

    expect(readClock(failingHarness.db).paused).toBe(true);

    const frame = (await (await authed(failingHarness, "/frame")).json()) as {
      status: string;
      degradedReason: string;
    };
    expect(frame.status).toBe("degraded");
    expect(frame.degradedReason).toBe("disk-full");
  } finally {
    failingHarness.stop();
  }
});

test("a real POST /pause request during an in-progress catch-up stops it at a chunk boundary, persists paused, and reports skipped time -- without the server blocking on catch-up", async () => {
  const storeDir = tempDir("panthea-sim-server-pause-catchup-");
  const slotsDir = tempDir("panthea-sim-server-pause-catchup-slots-");
  try {
    const storePath = join(storeDir, "world.sqlite");
    const seeded = loadGreekWorldState();
    // Tiny chunks so the run spans many real chunk commits and yields --
    // enough real wall-clock time for a concurrent HTTP request to land
    // mid-run.
    const seededWithTinyChunks = {
      ...seeded,
      rules: { ...seeded.rules, catchUpChunkMs: 1_000 },
    };
    const reducers = createWorldProjectionReducers(seededWithTinyChunks);
    const store = openStore(storePath, reducers);
    ensureTraceSchema(store.db);

    const startCursor = readClock(store.db).cursorWallMs;
    const totalMs = 20 * 60 * 1000; // 20 chunks of 1 minute each
    const nowWallMs = startCursor + totalMs;

    const token = "the-launch-token";
    const statusRef = createServiceStatusRef(seededWithTinyChunks);

    let catchUpInProgress = true;
    let pauseRequestedDuringCatchUp = false;
    let chunksCommitted = 0;
    const catchUpControl: CatchUpControl = {
      isRunning: () => catchUpInProgress,
      requestPause: () => {
        pauseRequestedDuringCatchUp = true;
      },
    };

    const handle = createSimulationServer({
      token,
      store,
      reducers,
      traceDb: store.db,
      slotsDir,
      statusRef,
      catchUpControl,
      port: 0,
    });

    try {
      const catchUpPromise = runCatchUp(
        seededWithTinyChunks,
        createPrng(1),
        { store, reducers, traceDb: store.db },
        {
          nowWallMs,
          onChunkCommitted: () => {
            chunksCommitted += 1;
            return pauseRequestedDuringCatchUp;
          },
        },
      ).finally(() => {
        catchUpInProgress = false;
      });

      // Wait for a few real chunks to commit before pausing, so the
      // request genuinely lands mid-run rather than before it starts or
      // after it finishes.
      const deadline = Date.now() + 10_000;
      while (chunksCommitted < 3 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(chunksCommitted).toBeGreaterThanOrEqual(3);

      const pauseResponse = await fetch(
        `http://127.0.0.1:${handle.port}/pause`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      // 202, not 200: the request is accepted, not yet in effect -- the
      // actual pause commit still has to happen at the next chunk
      // boundary and can itself still fail.
      expect(pauseResponse.status).toBe(202);

      const result = await catchUpPromise;
      // Mirrors index.ts's runCatchUpNow: the entrypoint refreshes
      // status from the catch-up result once it resolves.
      refreshStatusAfterCatchUp(statusRef, result, store);

      expect(result.degraded).toBeUndefined();
      expect(result.summary.skippedMs).toBeGreaterThan(0);
      expect(result.summary.appliedMs).toBeLessThan(totalMs);

      const clock = readClock(store.db);
      expect(clock.paused).toBe(true);

      const operatorObservations = store.db
        .query("SELECT id FROM trace_observations WHERE observer = 'operator'")
        .all() as { id: string }[];
      expect(operatorObservations.length).toBeGreaterThan(0);

      const frameResponse = await fetch(
        `http://127.0.0.1:${handle.port}/frame`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const frame = (await frameResponse.json()) as { status: string };
      expect(frame.status).toBe("paused");
    } finally {
      handle.stop(true);
      closeStore(store);
    }
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
    rmSync(slotsDir, { recursive: true, force: true });
  }
}, 20_000);

test("a real POST /pause request whose mid-catch-up commit fails (injected trace failure) leaves status degraded, the world not paused-but-unrecorded, and reports no premature success", async () => {
  const storeDir = tempDir("panthea-sim-server-pause-catchup-fail-");
  const slotsDir = tempDir("panthea-sim-server-pause-catchup-fail-slots-");
  try {
    const storePath = join(storeDir, "world.sqlite");
    const seeded = loadGreekWorldState();
    const seededWithTinyChunks = {
      ...seeded,
      rules: { ...seeded.rules, catchUpChunkMs: 1_000 },
    };
    const reducers = createWorldProjectionReducers(seededWithTinyChunks);
    const store = openStore(storePath, reducers);
    ensureTraceSchema(store.db);

    const startCursor = readClock(store.db).cursorWallMs;
    const totalMs = 20 * 60 * 1000;
    const nowWallMs = startCursor + totalMs;

    const token = "the-launch-token";
    const statusRef = createServiceStatusRef(seededWithTinyChunks);

    let catchUpInProgress = true;
    let pauseRequestedDuringCatchUp = false;
    let chunksCommitted = 0;
    const catchUpControl: CatchUpControl = {
      isRunning: () => catchUpInProgress,
      requestPause: () => {
        pauseRequestedDuringCatchUp = true;
        // The regular chunk commits so far succeeded with a real trace
        // schema; dropping it now means the pause boundary's own
        // operator-observation write -- inside the same transaction as
        // the clock transition -- genuinely fails.
        store.db.run("DROP TABLE trace_observations");
      },
    };

    const handle = createSimulationServer({
      token,
      store,
      reducers,
      traceDb: store.db,
      slotsDir,
      statusRef,
      catchUpControl,
      port: 0,
    });

    try {
      const catchUpPromise = runCatchUp(
        seededWithTinyChunks,
        createPrng(1),
        { store, reducers, traceDb: store.db },
        {
          nowWallMs,
          onChunkCommitted: () => {
            chunksCommitted += 1;
            return pauseRequestedDuringCatchUp;
          },
        },
      ).finally(() => {
        catchUpInProgress = false;
      });

      const deadline = Date.now() + 10_000;
      while (chunksCommitted < 3 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(chunksCommitted).toBeGreaterThanOrEqual(3);

      const clockBeforePause = readClock(store.db);

      const pauseResponse = await fetch(
        `http://127.0.0.1:${handle.port}/pause`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      // The request itself is still accepted (catch-up owns the actual
      // commit); no premature 2xx claiming the pause already succeeded.
      expect(pauseResponse.status).toBe(202);

      const result = await catchUpPromise;
      refreshStatusAfterCatchUp(statusRef, result, store);
      expect(result.degraded).toBeDefined();

      // Not paused-but-unrecorded: the failed commit rolled back, so the
      // clock still shows whatever the last successfully committed chunk
      // left it at -- never `paused: true` without its operator
      // observation alongside it.
      const clockAfter = readClock(store.db);
      expect(clockAfter.paused).toBe(false);
      expect(clockAfter.cursorWallMs).toBeGreaterThanOrEqual(
        clockBeforePause.cursorWallMs,
      );

      const frameResponse = await fetch(
        `http://127.0.0.1:${handle.port}/frame`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const frame = (await frameResponse.json()) as {
        status: string;
        degradedReason?: string;
      };
      expect(frame.status).toBe("degraded");
    } finally {
      handle.stop(true);
      closeStore(store);
    }
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
    rmSync(slotsDir, { recursive: true, force: true });
  }
}, 20_000);

test("a trace failure during POST /pause rolls back the whole transition: 500, degraded status, and the persisted paused flag is unchanged", async () => {
  const storeDir = tempDir("panthea-sim-server-pause-trace-fail-");
  const slotsDir = tempDir("panthea-sim-server-pause-trace-fail-slots-");
  try {
    const storePath = join(storeDir, "world.sqlite");
    const seeded = loadGreekWorldState();
    const reducers = createWorldProjectionReducers(seeded);
    const store = openStore(storePath, reducers);
    // Deliberately not calling ensureTraceSchema: the pause transition's
    // own operator-observation trace write genuinely fails.

    const token = "the-launch-token";
    const statusRef = createServiceStatusRef(seeded);

    const handle = createSimulationServer({
      token,
      store,
      reducers,
      traceDb: store.db,
      slotsDir,
      statusRef,
      port: 0,
    });

    try {
      const before = readClock(store.db);
      expect(before.paused).toBe(false);

      const response = await fetch(`http://127.0.0.1:${handle.port}/pause`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(500);

      // The clock transition must roll back with the trace write --
      // never left half-applied.
      expect(readClock(store.db).paused).toBe(false);

      const frameResponse = await fetch(
        `http://127.0.0.1:${handle.port}/frame`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const frame = (await frameResponse.json()) as {
        status: string;
        degradedReason?: string;
      };
      expect(frame.status).toBe("degraded");
    } finally {
      handle.stop(true);
      closeStore(store);
    }
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
    rmSync(slotsDir, { recursive: true, force: true });
  }
});

test("a trace failure during POST /resume rolls back the whole transition: 500, degraded status, and the persisted paused flag is unchanged", async () => {
  const storeDir = tempDir("panthea-sim-server-resume-trace-fail-");
  const slotsDir = tempDir("panthea-sim-server-resume-trace-fail-slots-");
  try {
    const storePath = join(storeDir, "world.sqlite");
    const seeded = loadGreekWorldState();
    const reducers = createWorldProjectionReducers(seeded);
    const store = openStore(storePath, reducers);
    ensureTraceSchema(store.db);
    // Pause first (this commit and its trace write both succeed), then
    // drop the trace schema so resume's own trace write fails.
    store.db.run("UPDATE clock SET paused = 1 WHERE id = 1");
    store.db.run("DROP TABLE trace_observations");

    const token = "the-launch-token";
    const statusRef = createServiceStatusRef(seeded);

    const handle = createSimulationServer({
      token,
      store,
      reducers,
      traceDb: store.db,
      slotsDir,
      statusRef,
      port: 0,
    });

    try {
      const response = await fetch(`http://127.0.0.1:${handle.port}/resume`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(500);

      expect(readClock(store.db).paused).toBe(true);

      const frameResponse = await fetch(
        `http://127.0.0.1:${handle.port}/frame`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const frame = (await frameResponse.json()) as {
        status: string;
        degradedReason?: string;
      };
      expect(frame.status).toBe("degraded");
    } finally {
      handle.stop(true);
      closeStore(store);
    }
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
    rmSync(slotsDir, { recursive: true, force: true });
  }
});

test("POST /proposals with an unknown legend link is rejected at intake, never reaching the journal", async () => {
  const harness = startHarness();
  try {
    const observation = {
      schemaVersion: 1,
      id: createObservationId(),
      observer: "farmer",
      stateRevision: 0,
      factsRead: [],
      source: "fixture",
    };
    const response = await authed(harness, "/proposals", {
      method: "POST",
      body: JSON.stringify({
        proposalId: "proposal-unknown-legend-link",
        observation,
        proposal: {
          schemaVersion: 1,
          actor: "farmer",
          targets: [],
          expectedRevisions: [],
          source: "fixture",
          observationId: observation.id,
          kind: "legend",
          assertion: "a tale never linked to anything real",
          linkedEventId: "evt-nonexistent",
        },
      }),
    });
    expect(response.status).toBe(400);
    expect(listExternalProposals(harness.db)).toEqual([]);
  } finally {
    harness.stop();
  }
});

test("GET /trace/event follows a committed event back to its observation", async () => {
  const harness = startHarness();
  try {
    const response = await authed(
      harness,
      `/trace/event?id=${harness.committedEventId}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { found: boolean; steps: readonly { step: string }[] };
    };
    expect(body.result.found).toBe(true);
    expect(body.result.steps.map((step) => step.step)).toContain("event");
  } finally {
    harness.stop();
  }
});

test("POST /resume ends an unfinished catch-up backlog: paused wall time never becomes part of one", async () => {
  const harness = startHarness();
  try {
    writeCatchUpProgress(harness.db, {
      appliedMs: 60_000,
      discardedMs: 1_000,
      startSequence: 0,
    });
    expect((await authed(harness, "/pause", { method: "POST" })).status).toBe(
      200,
    );
    expect(readCatchUpProgress(harness.db)).toBeDefined();

    expect((await authed(harness, "/resume", { method: "POST" })).status).toBe(
      200,
    );

    expect(readCatchUpProgress(harness.db)).toBeUndefined();
  } finally {
    harness.stop();
  }
});

/** GET /frame, parsed through the contract, and its catch-up summary. */
async function frameSummary(harness: Harness) {
  const response = await authed(harness, "/frame");
  const parsed = parseSyncFrame(await response.json());
  if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.message}`);
  return parsed.value.catchUpSummary;
}

/** An open backlog as a degraded run leaves it, then the world paused: the state /resume has to close. */
async function pauseWithOpenBacklog(
  harness: Harness,
  progress: Parameters<typeof writeCatchUpProgress>[1],
) {
  writeCatchUpProgress(harness.db, progress);
  expect((await authed(harness, "/pause", { method: "POST" })).status).toBe(
    200,
  );
}

const resume = (harness: Harness) =>
  authed(harness, "/resume", { method: "POST" });

test("POST /resume ends an open backlog by the same rules as any ending: with no summary persisted yet, it persists one, clears the progress, and the frame carries it", async () => {
  const harness = startHarness();
  try {
    await pauseWithOpenBacklog(harness, {
      appliedMs: 120_000,
      discardedMs: 0,
      startSequence: 0,
    });
    expect(readCatchUpSummary(harness.db)).toBeUndefined();

    expect((await resume(harness)).status).toBe(200);

    const persisted = readCatchUpSummary(harness.db);
    expect(persisted).toMatchObject({ appliedMs: 120_000, skippedMs: 0 });
    expect(readCatchUpProgress(harness.db)).toBeUndefined();
    expect(await frameSummary(harness)).toEqual(persisted);
  } finally {
    harness.stop();
  }
});

test("POST /resume of a degraded partial backlog whose summary was already persisted keeps that summary's id: nothing about it changed, so a client that dismissed it is not shown it again", async () => {
  const harness = startHarness();
  try {
    await pauseWithOpenBacklog(harness, {
      appliedMs: 120_000,
      discardedMs: 0,
      startSequence: 0,
    });
    // What the degraded run persisted for that backlog.
    const partial = recordPartialSummary(harness.db);
    expect(partial).toBeDefined();

    expect((await resume(harness)).status).toBe(200);

    expect(readCatchUpSummary(harness.db)?.id).toBe(partial?.id);
    expect(readCatchUpProgress(harness.db)).toBeUndefined();
    expect((await frameSummary(harness))?.id).toBe(partial?.id);
  } finally {
    harness.stop();
  }
});

test("POST /resume of a backlog that moved on since its summary was persisted mints a new id", async () => {
  const harness = startHarness();
  try {
    await pauseWithOpenBacklog(harness, {
      appliedMs: 60_000,
      discardedMs: 0,
      startSequence: 0,
    });
    const partial = recordPartialSummary(harness.db);
    // Progress committed after that summary was written.
    writeCatchUpProgress(harness.db, {
      appliedMs: 180_000,
      discardedMs: 0,
      startSequence: 0,
    });

    expect((await resume(harness)).status).toBe(200);

    const persisted = readCatchUpSummary(harness.db);
    expect(persisted?.id).not.toBe(partial?.id);
    expect(persisted?.appliedMs).toBe(180_000);
    expect(await frameSummary(harness)).toEqual(persisted);
  } finally {
    harness.stop();
  }
});

test("POST /resume with no open backlog leaves the persisted summary and the frame alone", async () => {
  const harness = startHarness();
  try {
    const earlier = {
      id: "earlier",
      atSequence: 0,
      appliedMs: 60_000,
      skippedMs: 0,
      majorOutcomes: [],
    };
    writeCatchUpSummary(harness.db, earlier);
    expect((await authed(harness, "/pause", { method: "POST" })).status).toBe(
      200,
    );

    expect((await resume(harness)).status).toBe(200);

    expect(readCatchUpSummary(harness.db)).toEqual(earlier);
  } finally {
    harness.stop();
  }
});

test("POST /resume whose commit fails keeps the backlog open and persists no summary", async () => {
  const harness = startHarness();
  try {
    await pauseWithOpenBacklog(harness, {
      appliedMs: 120_000,
      discardedMs: 0,
      startSequence: 0,
    });
    // The store refuses the summary write, so the resume commit rolls back whole.
    harness.db.exec(
      "CREATE TRIGGER refuse_summary BEFORE INSERT ON catch_up_summary BEGIN SELECT RAISE(ABORT, 'SQLITE_FULL: simulated'); END",
    );

    const response = await resume(harness);

    expect(response.status).toBe(500);
    expect(readCatchUpSummary(harness.db)).toBeUndefined();
    expect(readCatchUpProgress(harness.db)).toBeDefined();
    expect(readClock(harness.db).paused).toBe(true);
  } finally {
    harness.stop();
  }
});

test("POST /import surfaces a staging failure as an error response rather than throwing, and creates no slot", async () => {
  const harness = startHarness();
  const exportDir = tempDir("panthea-sim-server-export-");
  try {
    const exportPath = join(exportDir, "archive.sqlite");
    const exportResponse = await authed(harness, "/export", {
      method: "POST",
      body: JSON.stringify({ path: exportPath }),
    });
    expect(exportResponse.status).toBe(200);

    const response = await authed(harness, "/import", {
      method: "POST",
      body: JSON.stringify({ archivePath: "/nonexistent/archive.sqlite" }),
    });
    expect(response.status).toBe(422);
  } finally {
    harness.stop();
    rmSync(exportDir, { recursive: true, force: true });
  }
});

describe("applyLiveTick: an external proposal takes its actor's slot for the tick", () => {
  function externalProposal(
    actor: string,
    raw: Record<string, unknown>,
  ): QueuedProposal {
    const observationId = createObservationId();
    const submitted = submitProposal({
      schemaVersion: 1,
      actor,
      targets: [],
      expectedRevisions: [],
      source: "fixture",
      observationId,
      ...raw,
    });
    if (!submitted.ok) throw new Error(submitted.rejection.message);
    return {
      id: createProposalId(),
      proposal: submitted.proposal,
      observation: {
        schemaVersion: 1,
        id: observationId,
        observer: toEntityId(actor),
        stateRevision: 0,
        factsRead: [],
        source: "fixture",
      },
    };
  }

  function runLiveTick(
    external: readonly QueuedProposal[],
    options: { readonly maxProposalsPerTick?: number } = {},
  ) {
    const storeDir = tempDir("panthea-sim-server-priority-");
    const authored = loadGreekWorldState();
    const seeded =
      options.maxProposalsPerTick === undefined
        ? authored
        : {
            ...authored,
            rules: {
              ...authored.rules,
              maxProposalsPerTick: options.maxProposalsPerTick,
            },
          };
    const reducers = createWorldProjectionReducers(seeded);
    const store = openStore(join(storeDir, "world.sqlite"), reducers);
    ensureTraceSchema(store.db);
    const routine = buildRoutineQueue(seeded);
    for (const queued of external) {
      insertExternalProposal(store.db, {
        proposalId: queued.id,
        proposal: queued.proposal,
        observation: queued.observation,
      });
    }
    const step = applyLiveTick(
      routine,
      seeded,
      createPrng(1),
      { store, reducers, traceDb: store.db },
      { cursorWallMs: 1_000, paused: false },
    );
    expect(step.kind).toBe("committed");
    const routineOf = (actor: string) => {
      const found = routine.find((queued) => queued.proposal.actor === actor);
      if (!found) throw new Error(`no routine proposal for ${actor}`);
      return found;
    };
    return {
      store,
      routineOf,
      dispose() {
        closeStore(store);
        rmSync(storeDir, { recursive: true, force: true });
      },
    };
  }

  const worship = () =>
    externalProposal("woodcutter", {
      kind: "worship",
      deity: "zeus",
      offering: { resource: "currency", amount: 1 },
    });

  test("under a proposal cap smaller than the routine queue, an external proposal for the later routine actor still commits, its routine yields, and nothing external is rejected over-limit", () => {
    const external = externalProposal("farmer", {
      kind: "worship",
      deity: "zeus",
      offering: { resource: "currency", amount: 1 },
    });
    const run = runLiveTick([external], { maxProposalsPerTick: 1 });
    try {
      expect(
        getProposalOutcomeByProposalId(run.store.db, external.id),
      ).toMatchObject({ outcome: "committed" });
      expect(
        getProposalOutcomeByProposalId(
          run.store.db,
          run.routineOf("farmer").id,
        ),
      ).toBeUndefined();
      // The cap left room for one proposal, so the unrelated routine is the
      // one over the limit; it is a routine, not the operator's proposal.
      expect(
        getProposalOutcomeByProposalId(
          run.store.db,
          run.routineOf("woodcutter").id,
        ),
      ).toMatchObject({ outcome: "rejected", reason: "over-limit" });
    } finally {
      run.dispose();
    }
  });

  test("under the cap, an external claim is recorded as a rejected claim, never over-limit, and costs its actor's routine nothing", () => {
    const claim = externalProposal("woodcutter", {
      kind: "claim",
      assertion: "I own the old oak",
    });
    const run = runLiveTick([claim], { maxProposalsPerTick: 1 });
    try {
      expect(
        getProposalOutcomeByProposalId(run.store.db, claim.id),
      ).toMatchObject({ outcome: "rejected", reason: "unauthorized-claim" });
      // The one slot went to the woodcutter's routine, as if no claim existed.
      expect(
        getProposalOutcomeByProposalId(
          run.store.db,
          run.routineOf("woodcutter").id,
        ),
      ).toMatchObject({ outcome: "committed" });
    } finally {
      run.dispose();
    }
  });

  test("a claim beside an external non-claim under cap 1: the non-claim commits, the claim is a rejected claim, and the claim used none of the capacity", () => {
    const worshipByFarmer = externalProposal("farmer", {
      kind: "worship",
      deity: "zeus",
      offering: { resource: "currency", amount: 1 },
    });
    const claim = externalProposal("woodcutter", {
      kind: "claim",
      assertion: "I own the old oak",
    });
    const run = runLiveTick([worshipByFarmer, claim], {
      maxProposalsPerTick: 1,
    });
    try {
      const outcomeOf = (id: QueuedProposal["id"]) =>
        getProposalOutcomeByProposalId(run.store.db, id);
      expect(outcomeOf(worshipByFarmer.id)).toMatchObject({
        outcome: "committed",
      });
      expect(outcomeOf(claim.id)).toMatchObject({
        outcome: "rejected",
        reason: "unauthorized-claim",
      });
      // The worship took the tick's one non-claim slot, so the woodcutter's
      // routine is over the limit because of the worship, not the claim.
      expect(outcomeOf(run.routineOf("woodcutter").id)).toMatchObject({
        reason: "over-limit",
      });
    } finally {
      run.dispose();
    }
  });

  test("a claim beside an external non-claim with room for both: nothing is lost", () => {
    const worshipByFarmer = externalProposal("farmer", {
      kind: "worship",
      deity: "zeus",
      offering: { resource: "currency", amount: 1 },
    });
    const claim = externalProposal("woodcutter", {
      kind: "claim",
      assertion: "I own the old oak",
    });
    const run = runLiveTick([worshipByFarmer, claim], {
      maxProposalsPerTick: 2,
    });
    try {
      const outcomeOf = (id: QueuedProposal["id"]) =>
        getProposalOutcomeByProposalId(run.store.db, id);
      expect(outcomeOf(worshipByFarmer.id)).toMatchObject({
        outcome: "committed",
      });
      expect(outcomeOf(claim.id)).toMatchObject({
        reason: "unauthorized-claim",
      });
      expect(outcomeOf(run.routineOf("woodcutter").id)).toMatchObject({
        outcome: "committed",
      });
      expect(outcomeOf(run.routineOf("farmer").id)).toBeUndefined();
    } finally {
      run.dispose();
    }
  });

  test("an external worship by an actor with a routine commits", () => {
    const external = worship();
    const run = runLiveTick([external]);
    try {
      const outcome = getProposalOutcomeByProposalId(run.store.db, external.id);
      expect(outcome?.outcome).toBe("committed");
      expect(
        listEvents(run.store.db).some(
          (event) => event.kind === "worship-performed",
        ),
      ).toBe(true);
    } finally {
      run.dispose();
    }
  });

  test("that actor's routine yields: it neither commits nor is recorded as a rejection, and its observation is never recorded", () => {
    const external = worship();
    const run = runLiveTick([external]);
    try {
      const yielded = run.routineOf("woodcutter");
      expect(
        getProposalOutcomeByProposalId(run.store.db, yielded.id),
      ).toBeUndefined();
      expect(
        getObservation(run.store.db, yielded.observation.id),
      ).toBeUndefined();
      expect(
        listEvents(run.store.db).filter(
          (event) => String(event.correlationId) === yielded.observation.id,
        ),
      ).toEqual([]);
    } finally {
      run.dispose();
    }
  });

  test("other actors' routines still run in the same tick", () => {
    const run = runLiveTick([worship()]);
    try {
      const farmer = run.routineOf("farmer");
      expect(
        getProposalOutcomeByProposalId(run.store.db, farmer.id),
      ).toBeDefined();
    } finally {
      run.dispose();
    }
  });

  test("an external proposal for an actor with no routine leaves every routine running", () => {
    const strike = externalProposal("zeus", {
      kind: "strike",
      target: "the-tavern",
      power: 3,
    });
    const run = runLiveTick([strike]);
    try {
      expect(
        getProposalOutcomeByProposalId(run.store.db, strike.id)?.outcome,
      ).toBe("committed");
      for (const actor of ["woodcutter", "farmer"]) {
        expect(
          getProposalOutcomeByProposalId(run.store.db, run.routineOf(actor).id),
        ).toBeDefined();
      }
    } finally {
      run.dispose();
    }
  });

  test("an external claim never commits, so it does not displace the actor's routine", () => {
    const claim = externalProposal("woodcutter", {
      kind: "claim",
      assertion: "I own the old oak",
    });
    const run = runLiveTick([claim]);
    try {
      expect(
        getProposalOutcomeByProposalId(run.store.db, claim.id)?.outcome,
      ).toBe("rejected");
      expect(
        getProposalOutcomeByProposalId(
          run.store.db,
          run.routineOf("woodcutter").id,
        ),
      ).toBeDefined();
    } finally {
      run.dispose();
    }
  });

  test("a rejected external proposal still takes the slot: the routine yields rather than acting behind a failed fixture", () => {
    const broke = externalProposal("woodcutter", {
      kind: "worship",
      deity: "zeus",
      offering: { resource: "currency", amount: 1_000 },
    });
    const run = runLiveTick([broke]);
    try {
      expect(
        getProposalOutcomeByProposalId(run.store.db, broke.id)?.reason,
      ).toBe("insufficient-resources");
      expect(
        getProposalOutcomeByProposalId(
          run.store.db,
          run.routineOf("woodcutter").id,
        ),
      ).toBeUndefined();
    } finally {
      run.dispose();
    }
  });
});

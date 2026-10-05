// A fast timer changes only the period: the cursor runs ahead of the wall clock,
// so it never reads as a sleep-wake gap or starts a catch-up.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeStore,
  openStore,
  readCatchUpSummary,
  readClock,
} from "@panthea/persistence";
import {
  checkTickTimerMs,
  parseTickTimerEnv,
  startService,
  TICK_TIMER_ENV,
} from "./index";
import {
  readStore,
  startTestService,
  stopAllTestServices,
  tickOf,
  until,
} from "./test-service";
import {
  createWorldProjectionReducers,
  loadGreekWorldState,
} from "./world-store";

const INDEX_ENTRY = join(import.meta.dir, "index.ts");

let appDataDir: string;
beforeEach(() => {
  appDataDir = mkdtempSync(join(tmpdir(), "panthea-sim-tick-timer-"));
});
afterEach(() => {
  stopAllTestServices();
  rmSync(appDataDir, { recursive: true, force: true });
});

describe("the timer period", () => {
  test("every whole number of milliseconds from 1 to the tick interval is a usable period; anything else is refused", () => {
    for (const ms of [1, 10, 999, 1000]) {
      expect(checkTickTimerMs(ms)).toEqual({ ok: true });
    }
    for (const ms of [0, -5, 1001, 2500, 1.5, Number.NaN]) {
      const checked = checkTickTimerMs(ms);
      expect([ms, checked.ok]).toEqual([ms, false]);
    }
  });

  test("the environment variable is read as a whole number of milliseconds: unset means the default, and a bad value is a problem that names it", () => {
    expect(parseTickTimerEnv({})).toEqual({ ok: true, ms: undefined });
    expect(parseTickTimerEnv({ [TICK_TIMER_ENV]: "" })).toEqual({
      ok: true,
      ms: undefined,
    });
    expect(parseTickTimerEnv({ [TICK_TIMER_ENV]: "10" })).toEqual({
      ok: true,
      ms: 10,
    });
    for (const raw of ["0", "5000", "1.5", "-3", "fast", "10ms"]) {
      const parsed = parseTickTimerEnv({ [TICK_TIMER_ENV]: raw });
      expect([raw, parsed.ok]).toEqual([raw, false]);
      if (!parsed.ok) expect(parsed.message).toContain(TICK_TIMER_ENV);
    }
  });

  test("a service asked for a timer slower than the tick interval refuses to start, before it takes the lock or opens a store", () => {
    expect(() =>
      startService({ token: "t", appDataDir, tickTimerMs: 1001 }),
    ).toThrow(/tick timer/);
    expect(() =>
      startService({ token: "t", appDataDir, tickTimerMs: 0 }),
    ).toThrow(/tick timer/);
    expect(() => readStore(appDataDir, () => 0)).toThrow();
  });
});

describe("a fast timer", () => {
  test("a cycle is one simulated second: the world's tick and the persisted cursor each move once per tick, and the cursor runs ahead of the wall clock", async () => {
    const service = startTestService({ appDataDir });
    await service.waitCycles("ticked", 1);
    const startCursor = readStore(
      appDataDir,
      (db) => readClock(db).cursorWallMs,
    );
    const ticksAtStart = service.cycles().ticked;
    const tickAtStart = tickOf(appDataDir);
    await service.waitCycles("ticked", 30);

    // Read in one synchronous turn, so no cycle runs between the reads.
    const ticked = service.cycles().ticked - ticksAtStart;
    const clock = readStore(appDataDir, (db) => readClock(db));
    expect(clock.tick - tickAtStart).toBe(ticked);
    expect(clock.cursorWallMs - startCursor).toBe(ticked * 1000);
    // Thirty simulated seconds passed in a fraction of one real one.
    expect(clock.cursorWallMs).toBeGreaterThan(Date.now());
  });

  test("it never reads as a sleep-wake gap: the only catch-up is the one at start, however many cycles run", async () => {
    const service = startTestService({ appDataDir });
    await service.waitCycles("ticked", 60);
    expect(service.cycles()["catch-up-started"]).toBe(0);
    expect(service.cycles()["catch-up-running"]).toBe(0);
    expect(
      service.lines().filter((line) => line.text.endsWith("catch-up started")),
    ).toHaveLength(1);
  });

  test("a restart with the cursor ahead of the wall clock applies no catch-up and keeps counting from where the world stopped", async () => {
    const first = startTestService({ appDataDir });
    await first.waitCycles("ticked", 40);
    first.stop();
    // A clean stop leaves a WAL store that only a writer can open.
    const stopped = readStore(appDataDir, (db) => readClock(db)).tick;
    expect(stopped).toBeGreaterThanOrEqual(40);

    const second = startTestService({ appDataDir });
    await until("the restart's startup catch-up", () =>
      second.output().includes("startup catch-up complete") ? true : undefined,
    );
    // The cursor was ahead: nothing applied or skipped, so no summary.
    expect(
      readStore(appDataDir, (db) => readCatchUpSummary(db)),
    ).toBeUndefined();
    await second.waitCycles("ticked", 5);
    expect(tickOf(appDataDir)).toBeGreaterThan(stopped);
  });
});

describe("the spawned service reads the environment variable", () => {
  async function spawnWith(env: Record<string, string>) {
    const proc = Bun.spawn(["bun", "run", INDEX_ENTRY], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PANTHEA_APP_DATA_DIR: appDataDir, ...env },
    });
    const stdin = proc.stdin;
    if (typeof stdin === "number" || !stdin) throw new Error("stdin");
    stdin.write('t\n{"models":null,"offline":false,"keys":{}}\n');
    await stdin.flush();
    let printed = "";
    const drain = async (stream: ReadableStream<Uint8Array>) => {
      const decoder = new TextDecoder();
      try {
        for await (const chunk of stream) {
          printed += decoder.decode(chunk, { stream: true });
        }
      } catch {
        // Killed; nothing more to read.
      }
    };
    void drain(proc.stdout as ReadableStream<Uint8Array>);
    void drain(proc.stderr as ReadableStream<Uint8Array>);
    await until("the port line", () =>
      /PANTHEA_PORT=\d+/.test(printed) ? true : undefined,
    );
    return { proc, output: () => printed };
  }

  test("PANTHEA_TICK_INTERVAL_MS=10 makes the spawned world tick tens of times a second", async () => {
    const { proc } = await spawnWith({ [TICK_TIMER_ENV]: "10" });
    try {
      // Takes 21 s at the default period.
      await until("twenty ticks", () =>
        readStore(appDataDir, (db) => readClock(db).tick) >= 20
          ? true
          : undefined,
      );
    } finally {
      proc.kill();
      await proc.exited;
    }
  });

  test("a value that is not a usable period is named on stderr and the service starts with the default period", async () => {
    const { proc, output } = await spawnWith({ [TICK_TIMER_ENV]: "5000" });
    try {
      await until("the warning on stderr", () =>
        output().includes("keeps its default") ? true : undefined,
      );
      expect(output()).toContain(`${TICK_TIMER_ENV}=5000`);
    } finally {
      proc.kill();
      await proc.exited;
    }
  });
});

describe("a service stopped while its startup catch-up runs", () => {
  test("publishes nothing afterwards: no completion line, and no frame built from the store it closed", async () => {
    // A 10-minute backlog, still running when the service stops.
    const loaded = loadGreekWorldState();
    const seeded = {
      ...loaded,
      rules: { ...loaded.rules, catchUpCapMs: 10 * 60 * 1000 },
    };
    const store = openStore(
      join(appDataDir, "active", "world.sqlite"),
      createWorldProjectionReducers(seeded),
    );
    store.db.run("UPDATE clock SET cursor_wall_ms = ? WHERE id = 1", [
      Date.now() - 10 * 60 * 1000,
    ]);
    closeStore(store);

    const service = startTestService({ appDataDir });
    await service.waitCycles("catch-up-running", 1);
    expect(service.stop()).toBe(0);
    // An error in the continuation would surface as an unhandled error.
    await Bun.sleep(300);
    expect(service.output()).not.toContain("startup catch-up complete");
  });
});

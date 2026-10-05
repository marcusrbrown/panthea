// Runs the service in the test's own process, on a fast tick timer, for tests
// whose subject is not the process boundary. A spawned service costs a second
// of real time per test (the first live tick) plus whatever a test sleeps
// through; this one ticks every few milliseconds and counts cycles instead of
// sleeping. What still needs a real process (the stdin protocol, a real
// SIGKILL, a second launch refused by the lock) stays spawned, with
// `PANTHEA_TICK_INTERVAL_MS` set to the same fast period.

import { Database } from "bun:sqlite";
import { join } from "node:path";
import { listExternalProposals, readClock } from "@panthea/persistence";
import { type ServiceHandle, startService, type TickCycle } from "./index";
import type { LaunchConfig } from "./launch-config";

/** How often a test service's timer fires. */
export const FAST_TICK_MS = 10;

/** The token a test service accepts. */
export const TEST_TOKEN = "test-service-token";

export interface TestService {
  readonly handle: ServiceHandle;
  readonly port: number;
  readonly appDataDir: string;
  /** What the service logged, one entry per line, with the wall time it was logged. */
  lines(): readonly { readonly at: number; readonly text: string }[];
  output(): string;
  /** Timer cycles by kind since the service started. */
  cycles(): Readonly<Record<TickCycle, number>>;
  /** The exit codes the service asked for, in order. */
  exits(): readonly number[];
  /** Resolves once `count` more cycles of `kind` have run. */
  waitCycles(kind: TickCycle, count: number): Promise<void>;
  /** Shuts the service down as stdin EOF would, releasing its lock and its store. */
  stop(): void;
  /** Calls the service's API with the test token. */
  call(path: string, init?: RequestInit): Promise<Response>;
}

export interface TestServiceOptions {
  readonly appDataDir: string;
  readonly launch?: LaunchConfig;
  readonly token?: string;
  readonly tickTimerMs?: number;
}

/** The launch config of a service with no settings: no routing, so no god takes a turn. */
export const NO_SETTINGS: LaunchConfig = {
  routing: undefined,
  offline: false,
  keys: new Map(),
};

const running = new Set<TestService>();

/** Starts the service in this process on `options.appDataDir`. Stops itself when the test ends if `stopAll` is called from `afterEach`. */
export function startTestService(options: TestServiceOptions): TestService {
  const lines: { at: number; text: string }[] = [];
  const exits: number[] = [];
  const counts: Record<TickCycle, number> = {
    ticked: 0,
    "catch-up-running": 0,
    halted: 0,
    paused: 0,
    "catch-up-started": 0,
  };
  const waiters: { kind: TickCycle; target: number; resolve: () => void }[] =
    [];
  const token = options.token ?? TEST_TOKEN;
  const handle = startService({
    token,
    launch: options.launch ?? NO_SETTINGS,
    appDataDir: options.appDataDir,
    port: 0,
    tickTimerMs: options.tickTimerMs ?? FAST_TICK_MS,
    handleSignals: false,
    exit: (code) => {
      exits.push(code);
    },
    onLog: (text) => {
      lines.push({ at: Date.now(), text });
    },
    onCycle: (cycle) => {
      counts[cycle] += 1;
      for (const waiter of [...waiters]) {
        if (counts[waiter.kind] >= waiter.target) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve();
        }
      }
    },
  });
  const service: TestService = {
    handle,
    port: handle.port,
    appDataDir: options.appDataDir,
    lines: () => lines,
    output: () => lines.map((line) => line.text).join("\n"),
    cycles: () => ({ ...counts }),
    exits: () => exits,
    waitCycles: (kind, count) =>
      new Promise<void>((resolve) => {
        waiters.push({ kind, target: counts[kind] + count, resolve });
      }),
    stop: () => {
      running.delete(service);
      handle.shutdown("stdin-eof");
    },
    call: (path, init = {}) =>
      fetch(`http://127.0.0.1:${handle.port}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}` },
      }),
  };
  running.add(service);
  return service;
}

/** Stops every service a test left running. Call from `afterEach`. */
export function stopAllTestServices(): void {
  for (const service of [...running]) service.stop();
}

/** Reads the store without disturbing it: read-only while a service holds it, read-write once none does (a cleanly stopped WAL store cannot be opened read-only). */
export function readStore<T>(appDataDir: string, fn: (db: Database) => T): T {
  const path = join(appDataDir, "active", "world.sqlite");
  for (const readonly of [true, false]) {
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

export const tickOf = (appDataDir: string): number =>
  readStore(appDataDir, (db) => readClock(db).tick);

export const journalOf = (appDataDir: string) =>
  readStore(appDataDir, (db) => listExternalProposals(db));

/** Polls `probe` until it returns a value. The bound only stops a hung test; nothing waits on it. */
export async function until<T>(
  what: string,
  probe: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await Bun.sleep(2);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// The simulation service entrypoint: takes the ownership lock, reads the
// launch token from stdin, opens the active world slot (creating one from
// the authored Greek pack on first run), runs catch-up, then starts the
// 1 Hz tick loop and the authenticated server. Stops cleanly on stdin EOF
// or SIGTERM/SIGINT, and self-terminates if its parent process dies.

import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRouter, initialEndpointStatus } from "@panthea/agents";
import type { GodProfile } from "@panthea/content";
import type { EntityId } from "@panthea/contracts";
import {
  closeStore,
  openStore,
  readCatchUpSummary,
  readClock,
  readLiveProjections,
  readPrngState,
  type Store,
} from "@panthea/persistence";
import { ensureTraceSchema } from "@panthea/telemetry";
import { type PrngState, toEntityId, type WorldState } from "@panthea/world";
import { createGodTurnRunner } from "./agents";
import { type CatchUpResult, runCatchUp } from "./catchup";
import {
  loadEmbeddedGreekGodProfiles,
  loadEmbeddedGreekWorldPack,
} from "./greek-world-pack";
import { type LaunchConfig, parseLaunchConfig } from "./launch-config";
import { acquireLock, openStdinSession, startParentGuard } from "./lifecycle";
import { startModelPayloadPruner } from "./prune";
import {
  applyLiveTick,
  type CatchUpControl,
  createServiceStatusRef,
  createSimulationServer,
  isHalted,
  type ServiceStatusRef,
  type SimulationServerHandle,
  updateServiceStatus,
} from "./server";
import { buildRoutineQueue, type QueuedProposal, type TickDeps } from "./tick";
import {
  createWorldProjectionReducers,
  deserializePrngState,
  loadGreekWorldState,
  restoreWorldTime,
} from "./world-store";

const APP_IDENTIFIER = "ai.panthe.desktop";
/** One world tick is one simulated second, and a live tick moves the persisted cursor forward by this much. */
const TICK_INTERVAL_MS = 1000;
const PARENT_POLL_INTERVAL_MS = 2000;
/** A wall-clock gap between ticks larger than this is treated as a sleep/wake event (catch-up), not ordinary timer jitter. */
const SLEEP_GAP_THRESHOLD_MS = 5_000;
const DEFAULT_PRNG_SEED = 1;

/** The environment variable that sets how often the tick timer fires; tests use it to run the world faster than real time. */
export const TICK_TIMER_ENV = "PANTHEA_TICK_INTERVAL_MS";

/**
 * How often the timer may fire, in milliseconds: every whole number from 1 to
 * the tick interval. A timer faster than the tick interval is safe: a tick
 * still moves the world one simulated second and the cursor one second, so the
 * cursor runs ahead of the wall clock, the gap goes negative, and neither a
 * sleep-wake catch-up nor a restart's catch-up applies anything for it. A
 * timer slower than the tick interval would let the gap grow past the
 * sleep threshold and start catch-ups of its own, so it is refused.
 */
export function checkTickTimerMs(
  ms: number,
): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  if (Number.isInteger(ms) && ms >= 1 && ms <= TICK_INTERVAL_MS) {
    return { ok: true };
  }
  return {
    ok: false,
    message: `the tick timer must fire every whole number of milliseconds from 1 to ${TICK_INTERVAL_MS}, got ${ms}`,
  };
}

/** Reads `PANTHEA_TICK_INTERVAL_MS`: `undefined` when it is unset, a problem message when it is not a usable period. */
export function parseTickTimerEnv(
  env: NodeJS.ProcessEnv = process.env,
):
  | { readonly ok: true; readonly ms: number | undefined }
  | { readonly ok: false; readonly message: string } {
  const raw = env[TICK_TIMER_ENV];
  if (raw === undefined || raw === "") return { ok: true, ms: undefined };
  const ms = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  const checked = checkTickTimerMs(ms);
  return checked.ok
    ? { ok: true, ms }
    : { ok: false, message: `${TICK_TIMER_ENV}=${raw}: ${checked.message}` };
}

/** Resolves the per-platform app data directory. `PANTHEA_APP_DATA_DIR` overrides it for tests so they never touch the real app data dir. */
export function resolveAppDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = env.PANTHEA_APP_DATA_DIR;
  if (override) {
    return override;
  }
  const home = homedir();
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", APP_IDENTIFIER);
  }
  if (platform === "win32") {
    const appData = env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(appData, APP_IDENTIFIER);
  }
  const xdgDataHome = env.XDG_DATA_HOME ?? join(home, ".local", "share");
  return join(xdgDataHome, APP_IDENTIFIER);
}

function ensureDirMode(path: string, mode: number): void {
  mkdirSync(path, { recursive: true });
  chmodSync(path, mode);
}

/**
 * Refreshes `statusRef`'s sequence and encoded state from `result.state`
 * (the last chunk that actually committed) whether or not catch-up
 * degraded partway through -- a degraded result still advanced the store
 * by however many chunks succeeded, so `/frame` must reflect that
 * progress rather than staying pinned to whatever state existed before
 * catch-up started.
 *
 * The catch-up summary a frame carries is read back from the store, never
 * taken from `result`: `runCatchUp` persists a summary in the transaction that
 * ends its backlog (or, for a degraded run, in one of its own), so what is
 * exposed here has already survived, and a summary whose write failed is
 * simply not there to expose. A catch-up that applied and skipped less than
 * one tick and found no outcomes persists nothing, so the earlier summary
 * stays.
 *
 * Status comes from the persisted clock, not an assumption: a
 * successful run can still have stopped for a mid-catch-up pause, and
 * `/frame` must show `paused`, not `running`, for that outcome.
 */
export function refreshStatusAfterCatchUp(
  statusRef: ServiceStatusRef,
  result: CatchUpResult,
  store: Pick<Store, "db">,
): void {
  const persisted = readCatchUpSummary(store.db);
  const catchUpSummary = persisted ? { catchUpSummary: persisted } : {};
  if (result.degraded) {
    updateServiceStatus(statusRef, result.state, catchUpSummary);
    statusRef.status = "degraded";
    statusRef.degradedReason = result.degraded.reason;
    return;
  }
  updateServiceStatus(statusRef, result.state, {
    ...catchUpSummary,
    paused: readClock(store.db).paused,
  });
}

/**
 * The status a starting service serves from its first frame. It already
 * carries the summary this store last delivered: that summary is persisted, so
 * a kill after it was shown, or before it was fetched, loses nothing, and a
 * catch-up still running when the first request arrives does not hide it.
 */
export function createHydratedStatusRef(
  state: WorldState,
  store: Pick<Store, "db">,
): ServiceStatusRef {
  return createServiceStatusRef(state, readCatchUpSummary(store.db));
}

/** No settings saved: no routing (so no god takes a turn), online, no keys. */
const NO_LAUNCH_CONFIG: LaunchConfig = {
  routing: undefined,
  offline: false,
  keys: new Map(),
};

export interface StartOptions {
  readonly token: string;
  /** What the shell handed over at spawn. Omitted means no settings. */
  readonly launch?: LaunchConfig;
  readonly appDataDir?: string;
  readonly parentPid?: number;
  readonly onLog?: (message: string) => void;
  /** Test-only OS-assigned port (0) instead of the real service port. */
  readonly port?: number;
  /**
   * How often the tick timer fires, in milliseconds; see `checkTickTimerMs`.
   * It changes the period only: a tick is still one simulated second. Tests
   * set it so a world ticks tens of times a second.
   */
  readonly tickTimerMs?: number;
  /** Called with the exit code where the service would end its process (a refused lock, a shutdown). Defaults to `process.exit`; a test that runs the service in its own process passes one that does not. */
  readonly exit?: (code: number) => void;
  /** Install the SIGTERM and SIGINT handlers. Defaults to true; a test that runs the service in its own process leaves them off. */
  readonly handleSignals?: boolean;
  /** Called after every timer cycle with what it did, so a test can count cycles instead of sleeping. */
  readonly onCycle?: (cycle: TickCycle) => void;
}

/** What one timer cycle did. */
export type TickCycle =
  | "ticked"
  | "catch-up-running"
  | "halted"
  | "paused"
  | "catch-up-started";

export interface ServiceHandle {
  readonly port: number;
  readonly lockPath: string;
  /** Runs the same flush-and-exit path as SIGTERM/parent-death. `reason` controls the exit code (0 for a clean shutdown, 1 otherwise). */
  shutdown(reason: string): void;
}

/** The embedded gods' profiles by actor id: the gods that can take a turn. */
function loadGodProfiles(): ReadonlyMap<EntityId, GodProfile> {
  const pack = loadEmbeddedGreekWorldPack();
  if (!pack.ok) throw new Error(`${pack.path}: ${pack.message}`);
  const gods = loadEmbeddedGreekGodProfiles(pack.value);
  if (!gods.ok) throw new Error(`${gods.path}: ${gods.message}`);
  return new Map(gods.value.map((god) => [toEntityId(god.id), god]));
}

/** Starts the service's store, catch-up, tick loop, server, and lifecycle guards. Returns a handle for tests. */
export function startService(options: StartOptions): ServiceHandle {
  const log = options.onLog ?? ((message: string) => console.log(message));
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const tickTimerMs = options.tickTimerMs ?? TICK_INTERVAL_MS;
  const timerCheck = checkTickTimerMs(tickTimerMs);
  if (!timerCheck.ok) throw new RangeError(timerCheck.message);
  const appDataDir = options.appDataDir ?? resolveAppDataDir();
  const parentPid = options.parentPid ?? process.ppid;
  const token = options.token;
  // An unusable launch config never stops startup (a hand-edited settings
  // file must not crash-loop the service): the gods stay idle and the cause is
  // logged, and the frame carries `model-degraded` once the status exists.
  const launch = options.launch ?? NO_LAUNCH_CONFIG;
  const routing = launch.routing;
  if (launch.problem !== undefined) {
    log(`panthea-simulation: ${launch.problem}; god turns are off`);
  }

  ensureDirMode(appDataDir, 0o700);
  const lockPath = join(appDataDir, "lifecycle.lock");
  const decision = acquireLock(lockPath);
  if (decision.kind === "refused") {
    log(
      "panthea-simulation: refusing to start -- the lock is held by another live process",
    );
    exit(3);
    throw new Error("the lock is held by another live process");
  }
  const lockDb = decision.db;

  const activeStorePath = join(appDataDir, "active", "world.sqlite");
  const slotsDir = join(appDataDir, "slots");
  const genesisState = loadGreekWorldState();
  const reducers = createWorldProjectionReducers(genesisState);
  const store = openStore(activeStorePath, reducers);
  ensureTraceSchema(store.db);
  // Model-request payload text is kept seven days: pruned now, then hourly.
  const payloadPruner = startModelPayloadPruner(store.db, {
    onError: (error) =>
      log(
        `panthea-simulation: model payload prune failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
  });

  const clock = readClock(store.db);
  let state: WorldState = restoreWorldTime(
    readLiveProjections(store, reducers),
    clock,
  );
  let prng: PrngState = deserializePrngState(readPrngState(store.db)) ?? {
    seed: DEFAULT_PRNG_SEED,
  };

  const tickDeps: TickDeps = { store, reducers, traceDb: store.db };
  const statusRef: ServiceStatusRef = createHydratedStatusRef(state, store);
  if (launch.problem !== undefined) {
    statusRef.modelDegraded = true;
  }
  if (routing) {
    statusRef.modelEndpoints = initialEndpointStatus(routing);
  }

  /** Set once, by `shutdown`: whatever is still running after that has no store to read or frame to publish. */
  let shuttingDown = false;

  // Set synchronously at the start of every `runCatchUpNow` call, before
  // that call's first `await` -- so by the time any other code in this
  // process runs, a catch-up run already in flight is visible. This lets
  // the live tick loop skip a cycle rather than racing catch-up's own
  // chunk commits against the same store, and lets `/pause` (via
  // `catchUpControl`) cooperate instead of committing its own pause
  // transition concurrently.
  let catchUpInProgress = false;
  let pauseRequestedDuringCatchUp = false;

  const catchUpControl: CatchUpControl = {
    isRunning: () => catchUpInProgress,
    requestPause: () => {
      pauseRequestedDuringCatchUp = true;
    },
  };

  async function runCatchUpNow(nowWallMs: number): Promise<boolean> {
    catchUpInProgress = true;
    pauseRequestedDuringCatchUp = false;
    // Bracketed in the log so an operator, and a test reading the service's
    // output, can tell exactly when a catch-up (startup or after sleep) ran.
    log("panthea-simulation: catch-up started");
    try {
      const result = await runCatchUp(state, prng, tickDeps, {
        nowWallMs,
        onChunkCommitted: () => pauseRequestedDuringCatchUp,
      });
      if (shuttingDown) {
        // Stopped while the backlog ran: the store is closed, and there is
        // nothing left to publish.
        return Boolean(result.degraded);
      }
      state = result.state;
      prng = result.prng;
      refreshStatusAfterCatchUp(statusRef, result, store);
      return Boolean(result.degraded);
    } finally {
      catchUpInProgress = false;
      log("panthea-simulation: catch-up finished");
    }
  }

  let queue: QueuedProposal[] = [];

  // The gods take turns only when the operator has configured model routing.
  // Keys (`launch.keys`) arrive with the config and live only in this
  // process's memory: the router reads one when it builds an endpoint's
  // adapter, and the runner redacts every one from the trace and the log.
  // What may start a turn is stated here, once, and read by the runner; it is
  // not inferred from where the runner is called.
  let startupCatchUpComplete = false;
  const turns = routing
    ? createGodTurnRunner({
        router: createRouter({
          config: routing,
          offline: launch.offline,
          // Read on demand, only for an endpoint offline mode kept.
          getKey: (keyRef) => launch.keys.get(keyRef),
        }),
        secrets: [...launch.keys.values()],
        profiles: loadGodProfiles(),
        store,
        getState: () => state,
        statusRef,
        lifecycle: {
          startupCatchUpComplete: () => startupCatchUpComplete,
          catchUpRunning: () => catchUpInProgress,
          paused: () => readClock(store.db).paused,
        },
        onLog: (message) => log(`panthea-simulation: ${message}`),
      })
    : undefined;

  const serverHandle: SimulationServerHandle = createSimulationServer({
    token,
    store,
    reducers,
    traceDb: store.db,
    slotsDir,
    statusRef,
    catchUpControl,
    ...(options.port !== undefined ? { port: options.port } : {}),
  });
  // Printed for the parent process (the Tauri shell, or a developer) to
  // discover the OS-assigned port; do not remove or reformat this line.
  log(`PANTHEA_PORT=${serverHandle.port}`);

  let tickTimer: ReturnType<typeof setInterval> | undefined;

  /**
   * One 1 Hz cycle: skips entirely while a catch-up run (startup or
   * sleep-wake) is already advancing the store in the background, and
   * while paused. A wall-clock gap beyond ordinary timer jitter (a
   * sleep/wake cycle) runs catch-up instead of a single tick, since
   * routines still need to act at the same one-simulated-second
   * granularity as live play; that catch-up run itself now executes in
   * the background (chunked, yielding to the event loop) rather than
   * blocking this cycle. Otherwise runs one ordinary tick over the routine
   * proposals decided from the last committed state plus the pending entries
   * of the durable proposal journal, which the tick consumes itself.
   */
  function runOneLiveTick(): TickCycle {
    if (catchUpInProgress) {
      return "catch-up-running";
    }
    if (isHalted(statusRef)) {
      return "halted";
    }
    const currentClock = readClock(store.db);
    if (currentClock.paused) {
      statusRef.status = "paused";
      return "paused";
    }
    const now = Date.now();
    const gap = now - currentClock.cursorWallMs;
    if (gap > SLEEP_GAP_THRESHOLD_MS) {
      void runCatchUpNow(now).then((degraded) => {
        if (shuttingDown) {
          return;
        }
        queue = [...buildRoutineQueue(state)];
        if (degraded && tickTimer) {
          clearInterval(tickTimer);
        }
        serverHandle.broadcastFrame();
      });
      return "catch-up-started";
    }

    const step = applyLiveTick(queue, state, prng, tickDeps, {
      cursorWallMs: currentClock.cursorWallMs + TICK_INTERVAL_MS,
      paused: false,
    });
    if (step.kind === "store-error") {
      statusRef.status = "degraded";
      statusRef.degradedReason = step.reason;
      if (tickTimer) {
        clearInterval(tickTimer);
      }
      serverHandle.broadcastFrame();
      return "halted";
    }
    state = step.state;
    prng = step.prng;
    queue = [...step.nextQueue];
    updateServiceStatus(statusRef, state);
    serverHandle.broadcastFrame();
    // A turn is asked for after the tick and never waited for: inference runs
    // outside the tick, and its proposal is journaled for a later one.
    turns?.dispatch();
    return "ticked";
  }

  tickTimer = setInterval(() => {
    const cycle = runOneLiveTick();
    options.onCycle?.(cycle);
  }, tickTimerMs);

  // Catch-up on start: the persisted cursor may be far behind now if the
  // process was not running (killed, machine restarted). Runs in the
  // background -- the server above is already listening and the tick
  // loop above already skips cycles while `catchUpInProgress`, so
  // `/pause` and every other request are served while this chunks
  // through the backlog.
  void runCatchUpNow(Date.now()).then(() => {
    // A service stopped while its catch-up ran has closed its store; there is
    // nothing left to publish, and a frame built now would read a closed one.
    if (shuttingDown) {
      return;
    }
    startupCatchUpComplete = true;
    queue = [...buildRoutineQueue(state)];
    serverHandle.broadcastFrame();
    // Printed last on purpose: by this line the catch-up has run, the status
    // was refreshed from the store (`runCatchUpNow`), and the frame was
    // broadcast, so a reader of this line knows the summary was published.
    log("panthea-simulation: startup catch-up complete");
  });

  function shutdown(reason: string): void {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log(`panthea-simulation: shutting down (${reason})`);
    if (tickTimer) {
      clearInterval(tickTimer);
    }
    turns?.stop();
    payloadPruner.stop();
    parentGuard.stop();
    serverHandle.stop(true);
    try {
      closeStore(store);
    } catch {
      // Best-effort; the process is exiting regardless.
    }
    try {
      lockDb.close();
    } catch {
      // Best-effort; the process is exiting regardless -- the OS releases
      // the lock either way.
    }
    const gracefulReasons = new Set(["SIGTERM", "SIGINT", "stdin-eof"]);
    exit(gracefulReasons.has(reason) ? 0 : 1);
  }

  const parentGuard = startParentGuard(
    parentPid,
    () => shutdown("parent-dead"),
    PARENT_POLL_INTERVAL_MS,
  );

  if (options.handleSignals ?? true) {
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }

  return { port: serverHandle.port, lockPath, shutdown };
}

/**
 * Reads the per-launch token and the launch config (two stdin lines), then
 * starts the service. Stdin EOF before either line refuses to start; EOF after
 * both drives a graceful shutdown. Stdin stays open after the config line: its
 * EOF is the shutdown signal and the orphan guard.
 */
function main(): void {
  const session = openStdinSession(process.stdin);
  let handle: ServiceHandle | undefined;
  let tokenReceived = false;
  let configReceived = false;

  void (async () => {
    const token = await session.token;
    if (token === undefined) {
      // No token line ever arrived; `onClose` below decides the outcome.
      return;
    }
    tokenReceived = true;
    if (!token) {
      console.error("panthea-simulation: empty token on stdin; exiting");
      process.exit(2);
    }
    const line = await session.launchConfig;
    if (line === undefined) {
      // Stdin closed before a config line; `onClose` below decides the outcome.
      return;
    }
    configReceived = true;
    const timer = parseTickTimerEnv();
    if (!timer.ok) {
      console.error(
        `panthea-simulation: ${timer.message}; the tick timer keeps its default`,
      );
    }
    handle = startService({
      token,
      launch: parseLaunchConfig(line),
      ...(timer.ok && timer.ms !== undefined ? { tickTimerMs: timer.ms } : {}),
    });
  })();

  session.onClose(() => {
    console.log("panthea-simulation: stdin closed");
    // Deferred so lines that arrived in the same chunk as EOF finish starting
    // the service before the outcome is decided.
    setTimeout(() => {
      if (handle) {
        handle.shutdown("stdin-eof");
      } else if (!tokenReceived) {
        // The real Tauri spawn path always writes a token right after
        // spawn; this only happens on a broken launch. Refuse to start
        // rather than exiting as if asked to shut down gracefully, since a
        // sidecar with no token can never have been authorized to serve.
        console.error(
          "panthea-simulation: stdin closed before a launch token was received; refusing to start",
        );
        process.exit(1);
      } else if (!configReceived) {
        console.error(
          "panthea-simulation: stdin closed before a launch config was received; refusing to start",
        );
        process.exit(1);
      }
    }, 0);
  });
}

if (import.meta.main) {
  main();
}

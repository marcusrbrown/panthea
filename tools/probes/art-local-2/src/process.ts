// Bounded subprocess lifecycle for generator servers: every phase has a
// time bound (readiness, stop grace, maximum lifetime, retained output) and
// ends in an explicit status. Cancellation is restart-based (plan Unit 1/5):
// stop the process, respawn, and time abort-to-exit and restart-to-ready.
//
// Late-output disposition: anything a child writes after `stop()` was
// requested is counted in `lateBytes` and discarded from the retained
// output, so a result that arrives after cancellation can never be mistaken
// for a completed one. "Late" is defined by when this process read the
// chunk, not when the child wrote it. Exception: output read after the request
// is kept when the exit was the child's own crash (a signal the stop did not send).

import type { CancelTiming } from "./measure";
import { type UsageReader, waitForTreeIdle } from "./rss";

export interface SpawnManagedOptions {
  readonly cmd: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Hard cap on process lifetime; SIGKILL after this. */
  readonly maxLifetimeMs: number;
  /** SIGTERM grace before escalating to SIGKILL (default 2000). */
  readonly stopGraceMs?: number;
  /** Cap on retained stdout+stderr bytes (default 64 KiB). */
  readonly maxOutputBytes?: number;
}

export interface ExitInfo {
  readonly exitCode: number | null;
  readonly signalCode: string | null;
  readonly reason: "exited" | "stopped" | "lifetime-exceeded" | "spawn-failed";
}

export type ReadyResult =
  | { readonly status: "ready"; readonly ms: number }
  | { readonly status: "timed-out"; readonly ms: number }
  | {
      readonly status: "exited";
      readonly ms: number;
      readonly exitCode: number | null;
    };

export interface StopResult {
  readonly exit: ExitInfo;
  /** Stop request to exit; 0 when the process was already gone. */
  readonly exitedAfterMs: number;
  readonly escalatedToKill: boolean;
  readonly lateOutputBytes: number;
}

export interface ManagedOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly lateBytes: number;
}

export interface ManagedProcess {
  readonly pid: number;
  state(): "running" | "stopping" | "exited";
  readonly exited: Promise<ExitInfo>;
  waitReady(
    isReady: () => boolean | Promise<boolean>,
    options: { readonly timeoutMs: number; readonly pollMs?: number },
  ): Promise<ReadyResult>;
  stop(): Promise<StopResult>;
  output(): ManagedOutput;
}

/** Max wait for pipes to drain after the process exits (grandchildren may hold them). */
const DRAIN_BOUND_MS = 500;

/** Signals this module sends to stop a child; any other fatal signal is the child's own crash. */
const STOP_SIGNALS = new Set(["SIGTERM", "SIGKILL"]);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A process that never started: already exited, with the spawn error as its output. */
function spawnFailure(error: unknown): ManagedProcess {
  const code = (error as { code?: unknown } | null)?.code;
  const detail = error instanceof Error ? error.message : String(error);
  const exit: ExitInfo = {
    exitCode: null,
    signalCode: null,
    reason: "spawn-failed",
  };
  const stopped: StopResult = {
    exit,
    exitedAfterMs: 0,
    escalatedToKill: false,
    lateOutputBytes: 0,
  };
  return {
    // No such pid: the RSS sampler finds no tree for it.
    pid: -1,
    state: () => "exited",
    exited: Promise.resolve(exit),
    waitReady: async () => ({ status: "exited", ms: 0, exitCode: null }),
    stop: async () => stopped,
    output: () => ({
      stdout: "",
      stderr: `spawn failed: ${typeof code === "string" ? `${code}: ` : ""}${detail}`,
      truncated: false,
      lateBytes: 0,
    }),
  };
}

export function spawnManaged(options: SpawnManagedOptions): ManagedProcess {
  const stopGraceMs = options.stopGraceMs ?? 2_000;
  const maxOutputBytes = options.maxOutputBytes ?? 64 * 1024;
  let child: ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>;
  try {
    child = Bun.spawn([...options.cmd], {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    return spawnFailure(error);
  }

  let phase: "running" | "stopping" | "exited" = "running";
  let stopRequested = false;
  let lifetimeHit = false;
  // Set the moment the OS reports termination, before the pipe-drain wait.
  // A stop requested after this point cannot have caused the exit.
  let terminationObserved = false;
  let exitInfo: ExitInfo | undefined;
  let stdout = "";
  let stderr = "";
  let retainedBytes = 0;
  let truncated = false;
  let lateBytes = 0;

  /** Output read after a stop request, held until the exit shows whether the stop caused it. */
  const heldLate: { readonly bytes: number; readonly keep: () => void }[] = [];
  let heldLateBytes = 0;
  /** Late bytes beyond the hold cap: not held, but truncation if the exit was a crash. */
  let overflowLateBytes = 0;
  let exitedOnItsOwn = false;

  async function consume(
    stream: ReadableStream<Uint8Array>,
    sink: (text: string) => void,
  ): Promise<void> {
    const decoder = new TextDecoder();
    const retain = (chunk: Uint8Array) => {
      const room = maxOutputBytes - retainedBytes;
      if (room <= 0) {
        truncated = true;
        return;
      }
      const kept = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
      if (kept.byteLength < chunk.byteLength) {
        truncated = true;
      }
      retainedBytes += kept.byteLength;
      sink(decoder.decode(kept, { stream: true }));
    };
    try {
      for await (const chunk of stream) {
        if (stopRequested && !exitedOnItsOwn) {
          lateBytes += chunk.byteLength;
          // Held (a prefix, up to the retention cap) in case the exit was the child's own crash.
          const held = chunk.subarray(
            0,
            Math.min(chunk.byteLength, maxOutputBytes - heldLateBytes),
          );
          overflowLateBytes += chunk.byteLength - held.byteLength;
          if (held.byteLength > 0) {
            heldLateBytes += held.byteLength;
            heldLate.push({
              bytes: held.byteLength,
              keep: () => retain(held),
            });
          }
          continue;
        }
        retain(chunk);
      }
    } catch {
      // A closed pipe is the normal end of a killed child.
    }
  }

  const drained = Promise.all([
    consume(child.stdout, (text) => {
      stdout += text;
    }),
    consume(child.stderr, (text) => {
      stderr += text;
    }),
  ]);

  const lifetimeTimer = setTimeout(() => {
    if (phase !== "exited") {
      lifetimeHit = true;
      child.kill("SIGKILL");
    }
  }, options.maxLifetimeMs);
  (lifetimeTimer as unknown as { unref?: () => void }).unref?.();

  const exited: Promise<ExitInfo> = child.exited.then(async () => {
    terminationObserved = true;
    clearTimeout(lifetimeTimer);
    await Promise.race([drained, sleep(DRAIN_BOUND_MS)]);
    const signalCode = child.signalCode ?? null;
    exitInfo = {
      exitCode: child.exitCode,
      signalCode,
      reason: lifetimeHit
        ? "lifetime-exceeded"
        : stopRequested && (signalCode === null || STOP_SIGNALS.has(signalCode))
          ? "stopped"
          : "exited",
    };
    if (exitInfo.reason === "exited") {
      // The stop did not cause this exit: held output is not late.
      exitedOnItsOwn = true;
      for (const held of heldLate.splice(0)) {
        lateBytes -= held.bytes;
        held.keep();
      }
      if (overflowLateBytes > 0) {
        lateBytes -= overflowLateBytes;
        truncated = true;
        overflowLateBytes = 0;
      }
    }
    phase = "exited";
    return exitInfo;
  });

  let stopPromise: Promise<StopResult> | undefined;

  function stop(): Promise<StopResult> {
    if (stopPromise) {
      return stopPromise;
    }
    stopPromise = (async () => {
      if (phase === "exited" && exitInfo) {
        return {
          exit: exitInfo,
          exitedAfterMs: 0,
          escalatedToKill: false,
          lateOutputBytes: lateBytes,
        };
      }
      if (terminationObserved) {
        // The process already terminated on its own and is only draining
        // pipes: a cleanup stop must not relabel that exit as requested nor
        // reclassify pre-exit output as late.
        return {
          exit: await exited,
          exitedAfterMs: 0,
          escalatedToKill: false,
          lateOutputBytes: lateBytes,
        };
      }
      const startedAt = performance.now();
      stopRequested = true;
      phase = "stopping";
      let escalated = false;
      child.kill("SIGTERM");
      const graceTimer = setTimeout(() => {
        escalated = true;
        child.kill("SIGKILL");
      }, stopGraceMs);
      const exit = await exited;
      clearTimeout(graceTimer);
      return {
        exit,
        exitedAfterMs: performance.now() - startedAt,
        escalatedToKill: escalated,
        lateOutputBytes: lateBytes,
      };
    })();
    return stopPromise;
  }

  return {
    pid: child.pid,
    state: () => phase,
    exited,
    async waitReady(isReady, readyOptions) {
      const pollMs = readyOptions.pollMs ?? 100;
      const startedAt = performance.now();
      // Termination is checked before each probe and again after a probe
      // answers: a probe that returns true for a child that already died
      // (or that something else answered) is not readiness.
      const exitedNow = () => ({
        status: "exited" as const,
        ms: performance.now() - startedAt,
        exitCode: child.exitCode,
      });
      for (;;) {
        const ms = performance.now() - startedAt;
        if (terminationObserved) {
          return exitedNow();
        }
        let ok = false;
        try {
          ok = await isReady();
        } catch {
          ok = false;
        }
        if (terminationObserved) {
          return exitedNow();
        }
        if (ok) {
          return { status: "ready", ms: performance.now() - startedAt };
        }
        if (ms >= readyOptions.timeoutMs) {
          return { status: "timed-out", ms };
        }
        await sleep(pollMs);
      }
    },
    stop,
    output: () => ({ stdout, stderr, truncated, lateBytes }),
  };
}

const NO_IDLE = {
  restartToIdleMs: null,
  idle: "not-measured",
  idleThresholdPercent: null,
  idleCpuEvidence: [],
} as const;

export interface RestartToReadyInput {
  readonly current: ManagedProcess;
  readonly respawn: () => ManagedProcess;
  readonly isReady: (next: ManagedProcess) => boolean | Promise<boolean>;
  readonly readyTimeoutMs: number;
  readonly pollMs?: number;
  /** Also measure respawn-to-idle (tree CPU below threshold) once ready. */
  readonly idle?: {
    readonly thresholdPercent?: number;
    readonly timeoutMs: number;
    readonly pollMs?: number;
    readonly read?: UsageReader;
  };
}

export interface RestartToReadyResult {
  /** The replacement; the caller owns it and must stop it. null when respawn threw. */
  readonly process: ManagedProcess | null;
  readonly cancel: CancelTiming;
  readonly respawnError: string | null;
}

/**
 * Abort a job by restarting its server: stop `current`, spawn a
 * replacement, and time each phase. Phases not reached stay null.
 */
export async function restartToReady(
  input: RestartToReadyInput,
): Promise<RestartToReadyResult> {
  const requestedAt = performance.now();
  const stopped = await input.current.stop();
  const abortToExitMs = performance.now() - requestedAt;

  let next: ManagedProcess;
  const respawnedAt = performance.now();
  try {
    next = input.respawn();
  } catch (error) {
    return {
      process: null,
      respawnError: error instanceof Error ? error.message : String(error),
      cancel: {
        abortToExitMs,
        restartToReadyMs: null,
        totalCancelToReadyMs: null,
        readiness: "not-attempted",
        escalatedToKill: stopped.escalatedToKill,
        ...NO_IDLE,
      },
    };
  }

  const ready = await next.waitReady(() => input.isReady(next), {
    timeoutMs: input.readyTimeoutMs,
    pollMs: input.pollMs,
  });
  // Taken before any idle wait, so the total is cancel request to ready.
  const readyAt = performance.now();
  const isReady = ready.status === "ready";
  let idleFields: Pick<
    CancelTiming,
    "restartToIdleMs" | "idle" | "idleThresholdPercent" | "idleCpuEvidence"
  > = NO_IDLE;
  if (isReady && input.idle) {
    const result = await waitForTreeIdle(next.pid, input.idle);
    idleFields = {
      restartToIdleMs:
        result.reason === "below-threshold"
          ? performance.now() - respawnedAt
          : null,
      idle: result.reason,
      idleThresholdPercent: input.idle.thresholdPercent ?? 5,
      idleCpuEvidence: result.evidence,
    };
  }
  return {
    process: next,
    respawnError: null,
    cancel: {
      abortToExitMs,
      restartToReadyMs: isReady ? ready.ms : null,
      totalCancelToReadyMs: isReady ? readyAt - requestedAt : null,
      readiness: ready.status,
      escalatedToKill: stopped.escalatedToKill,
      ...idleFields,
    },
  };
}

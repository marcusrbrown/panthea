// The unattended run: one world, kept, driven through a scripted provider outage, a clean stop with a ninety-minute
// gap, and a capped catch-up, on a clock that counts only the time the sidecar is up. The driver is a function of
// its dependencies (a clock, a world, a proxy, a sampler, a folder), so its phase logic runs on a virtual clock in
// the tests; `runUnattended` wires the real ones. The gate's report and thresholds are built on what this writes.
//
// Exits: 0 for a run that went through every phase and held its own integrity checks, 1 for a failure (a dead
// sidecar, a catch-up that did not behave), 2 only for Ollama's empty-200 fault, which is the infrastructure's
// and not a gate result.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  killAllSidecars,
  REPO_ROOT,
  startSidecar,
} from "../../m1-living-world/src/sidecar";
import { readFrame } from "../../m1-living-world/src/steps/api";
import { persistedClock } from "../../m1-living-world/src/steps/direct";
import {
  activeStorePath,
  backdateCursor,
} from "../../m1-living-world/src/world-db";
import type { Args } from "./args";
import {
  type BaselineRecord,
  captureBaseline,
  exportForBaseline,
} from "./baseline";
import { resolveSidecarBinary } from "./binary";
import {
  readCatchUpDiscardedMs,
  readProposals,
  readRealRequests,
  readStoredEvents,
} from "./db";
import { loadGodIdentities } from "./episodes";
import {
  createMemorySampler,
  findOllamaServePid,
  type MemorySample,
  type MemorySampler,
  summarizeMemory,
} from "./memory";
import {
  type OutageProxy,
  type ProxyRecord,
  startOutageProxy,
} from "./outage-proxy";
import {
  EMPTY_COMPLETION,
  GODS,
  type God,
  type ScriptedProvider,
  startProvider,
} from "./provider";
import {
  endpointKind,
  launchConfigFor,
  prepareOllama,
  type RealOptions,
} from "./real";
import type { RealInput } from "./real-analysis";
import { analyzeUnattended, gateOutcomeOf } from "./unattended-analysis";
import {
  captureOllamaState,
  type OllamaState,
  renderLogTail,
} from "./unattended-diagnostics";
import { renderUnattendedReport } from "./unattended-report";

// --- The plan ---------------------------------------------------------------------------------

const MINUTE = 60_000;

/** The gate's length in minutes of running time. */
export const GATE_MINUTES = 60;
/** The outage starts once this many of the gods have committed an action. */
export const OUTAGE_GODS = 5;
/** Wall time the world is behind after the stop. Not scaled: the catch-up cap is a world rule. */
export const GAP_MS = 90 * MINUTE;
/** What one catch-up applies at most; the rest of the gap is discarded. */
export const CATCH_UP_CAP_MS = 60 * MINUTE;
/** The world is polled this often. */
export const POLL_MS = 2_000;
/** Consecutive unreadable frames after which the run fails. */
export const FRAME_FAILURES_MAX = 5;
/** How long the restarted sidecar has to finish its catch-up, every pass of it. */
export const CATCH_UP_TIMEOUT_MS = 180_000;
/**
 * How long after the last catch-up pass finished the driver waits before it judges the catch-up. The live tick loop
 * starts another pass whenever the cursor trails the wall clock by more than 5 s (a catch-up that took that long leaves
 * exactly that trail), and it does so on its next one-second tick; the wait covers that tick and a poll.
 */
export const SETTLE_MS = 3_000;
/** How long the driver waits for god proposals already journaled to commit before it starts the outage. */
export const DRAIN_TIMEOUT_MS = 30_000;
/** Applied time past the cap that is still the catch-up: the passes that follow the first, and the ticks that run live while the driver waits. */
export const APPLIED_SLACK_MS = 2 * MINUTE;
/** A request this close before the finish line is the first tick after the catch-up, not part of it (S10's tolerance). */
export const LINE_TOLERANCE_MS = 25;

export interface PhasePlan {
  readonly minutes: number;
  /** Running time after which the outage starts even if fewer than five gods have acted. */
  readonly outageBoundMs: number;
  readonly outageMs: number;
  /** Running time from proxyRestoredAt to the stop. */
  readonly stopAfterRestoreMs: number;
  /** Running time at which the run ends. */
  readonly runMs: number;
  readonly gapMs: number;
  /** A gate verdict is rendered only for the full length. */
  readonly gate: boolean;
}

/** The running phases scaled to `minutes` of the gate's sixty; the gap is not. */
export function phasePlan(minutes: number): PhasePlan {
  const scale = minutes / GATE_MINUTES;
  return {
    minutes,
    outageBoundMs: 15 * MINUTE * scale,
    outageMs: 12 * MINUTE * scale,
    stopAfterRestoreMs: 10 * MINUTE * scale,
    runMs: minutes * MINUTE,
    gapMs: GAP_MS,
    gate: minutes === GATE_MINUTES,
  };
}

// --- What the driver sees ---------------------------------------------------------------------

export type PhaseName =
  | "started"
  | "outage-started"
  | "proxy-restored"
  | "stopped"
  | "restarted"
  | "catch-up-finished"
  | "ended";

export interface Boundary {
  readonly phase: PhaseName;
  readonly wallMs: number;
  readonly tick: number;
  /** Time the sidecar had been up when the boundary was crossed. */
  readonly runningMs: number;
  readonly note?: string;
}

export interface FrameReading {
  readonly tick: number;
  readonly sequence: number;
  readonly status: string;
  readonly degradedReason?: string;
  readonly catchUpSummary?: {
    readonly id: string;
    readonly appliedMs: number;
    readonly skippedMs: number;
  };
}

export interface RunningWorld {
  readonly pid: number;
  /** The sidecar's authenticated HTTP API. */
  request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<{ readonly status: number; readonly body: unknown }>;
  frame(): Promise<FrameReading>;
  /** SIGTERM, and the exit code. */
  stopClean(): Promise<number | null>;
  readonly exited: Promise<number | null>;
  lines(): readonly { readonly at: number; readonly text: string }[];
}

/** What a run records about how it was set up: no host, port, path or key. */
export interface RunSettings {
  readonly model: string;
  readonly reasoningEffort?: "none";
  readonly endpoint: "local" | "hosted";
}

export interface UnattendedDeps {
  readonly outDir: string;
  readonly plan: PhasePlan;
  settings?: RunSettings;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Starts the sidecar on the run's data directory: the first start, and the restart after the gap. */
  startWorld(): Promise<RunningWorld>;
  /** The gods with at least one committed proposal. */
  godsCommitted(): readonly string[];
  /** Moves the persisted wall cursor back by `ms`, on the stopped store. */
  backdate(ms: number): void;
  readonly proxy: Pick<OutageProxy, "fail" | "pass" | "records">;
  /** True once the proxy has seen five empty responses in a row. */
  empty200(): boolean;
  readonly sampler: MemorySampler;
  /** Ollama's state, for a run that ends on a fault or a failure. */
  diagnose(): Promise<OllamaState>;
  /** Runs at the end of a run that went through every phase, with the world still up: it pauses and exports. */
  onEnd?(world: RunningWorld): Promise<void>;
  /** Runs once the sidecar has stopped, however the run ended: it captures the baseline from what is on disk. */
  afterStop?(info: {
    readonly status: UnattendedStatus;
    /** Why there is no archive, when the export did not happen. */
    readonly archiveMissingReason: string | undefined;
  }): Promise<BaselineRecord>;
  /** Told each boundary as it is crossed. */
  log?(line: string): void;
  /** The milliseconds of wall time the journal records the world discarded as over the catch-up cap, summed. */
  discardedMs(): number;
  /** God proposals journaled and not yet consumed by the world. The outage waits for them to commit. */
  pendingProposals?(): number;
  /**
   * Renders the report from the finished run and the samples of the observation, or `undefined` to keep the driver's own
   * summary. It returns the report's text with the threshold result the report's verdict rests on, which sets the exit.
   */
  renderReport?(
    result: UnattendedResult,
    samples: readonly MemorySample[],
  ): { readonly text: string; readonly gate: GateOutcome } | undefined;
}

/** What the threshold table concluded: a gate run's verdict, and the rows that failed. */
export type GateVerdict =
  | "PASS"
  | "FAIL"
  | "INFRASTRUCTURE FAULT"
  | "not a gate run";

export interface GateOutcome {
  readonly verdict: GateVerdict;
  readonly failedRows: readonly string[];
}

export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export type UnattendedStatus = "completed" | "failed" | "fault";

export interface UnattendedResult {
  readonly status: UnattendedStatus;
  /** The threshold table's result, when a report was rendered. */
  readonly gate?: GateOutcome;
  /** Why the report could not be generated, when it could not. */
  readonly reportError?: string;
  readonly settings?: RunSettings;
  /** The end capture: sizes, the rebuild from genesis and the import proof. Absent when it could not be taken. */
  readonly baseline?: BaselineRecord;
  /** Why the run did not complete; absent when it did. */
  readonly reason?: string;
  readonly plan: PhasePlan;
  readonly startedWallMs: number;
  readonly endedWallMs: number;
  readonly elapsedWallMs: number;
  /** Time the sidecar was up, summed over both its lives. */
  readonly runningMs: number;
  readonly boundaries: readonly Boundary[];
  readonly checks: readonly Check[];
  readonly outage?: {
    readonly trigger: "gods" | "time-bound";
    readonly godsActed: number;
  };
  readonly restore?: {
    readonly runnerAtRestore: "present" | "absent" | "unsampled";
    readonly firstRequestAfterRestore:
      | {
          readonly latencyMs: number;
          readonly status: number;
          readonly empty: boolean;
          readonly afterRestoreMs: number;
        }
      | undefined;
  };
  readonly catchUp?: {
    /** The persisted summary a frame carried once the catch-up settled: the last pass's, when there was more than one. */
    readonly summaryId: string;
    readonly appliedMs: number;
    readonly skippedMs: number;
    readonly startedWallMs: number;
    readonly finishedWallMs: number;
    /** Catch-up passes the sidecar logged. */
    readonly passes: number;
    /** What the journal and the tick hold, which later passes do not overwrite. */
    readonly journal: {
      /** Ticks from the stop to the settled tick, as milliseconds. */
      readonly appliedMs: number;
      readonly discardedMs: number;
    };
  };
}

/**
 * 2 for the infrastructure fault and only that; 1 for a failed run, a report that could not be generated, and a
 * full-length run whose threshold table failed a row or has no result; 0 otherwise. A development run is not a gate
 * run: its failed rows are shown and do not change its exit.
 */
export function exitCodeOf(
  result: Pick<UnattendedResult, "status" | "plan" | "gate" | "reportError">,
): 0 | 1 | 2 {
  if (result.status === "fault") return 2;
  if (result.status === "failed") return 1;
  if (result.reportError !== undefined) return 1;
  if (
    result.plan.gate &&
    (result.gate === undefined || result.gate.verdict === "FAIL")
  ) {
    return 1;
  }
  return 0;
}

/** The line that says why a run exits non-zero; `undefined` for a run that exits 0. */
export function failureText(
  result: Pick<
    UnattendedResult,
    "status" | "plan" | "gate" | "reportError" | "reason"
  >,
): string | undefined {
  if (exitCodeOf(result) === 0) return undefined;
  if (result.status !== "completed") return result.reason;
  if (result.reportError !== undefined) return result.reportError;
  const rows = result.gate?.failedRows ?? [];
  if (result.gate === undefined) {
    return "the report returned no threshold result for a full-length run";
  }
  return `${rows.length} threshold ${rows.length === 1 ? "row" : "rows"} failed: ${rows.join("; ")}`;
}

/** The requests that arrived after `startedAt` and before the finish line, less the tolerance. */
export function requestsInside(
  records: readonly ProxyRecord[],
  startedAt: number,
  finishedAt: number,
): number {
  return records.filter(
    (record) =>
      record.at >= startedAt && record.at <= finishedAt - LINE_TOLERANCE_MS,
  ).length;
}

/** The run ends early: the phases after it do not happen. */
class RunEnd extends Error {
  constructor(
    readonly status: "failed" | "fault",
    reason: string,
  ) {
    super(reason);
  }
}

const jsonl = (value: unknown): string => `${JSON.stringify(value)}\n`;

// --- The driver -------------------------------------------------------------------------------

export async function driveUnattended(
  deps: UnattendedDeps,
): Promise<UnattendedResult> {
  const { plan, outDir } = deps;
  mkdirSync(outDir, { recursive: true });
  const file = (name: string) => join(outDir, name);
  const startedWallMs = deps.now();
  const boundaries: Boundary[] = [];
  const checks: Check[] = [];
  let outage: UnattendedResult["outage"];
  let restore: UnattendedResult["restore"];
  let catchUp: UnattendedResult["catchUp"];

  let world: RunningWorld | undefined;
  let exitSeen: { readonly code: number | null } | undefined;
  let expectedStop = false;
  let upBeforeMs = 0;
  let upSince: number | undefined;
  let lastFrame: FrameReading | undefined;
  let frameFailures = 0;
  let proxyRecordsWritten = 0;
  /** When the observation the gate judges ended: the last boundary, or the moment a run ended early. */
  let observationEndedAt: number | undefined;
  let lastSampleAt: number | undefined;

  const runningMs = (): number =>
    upBeforeMs + (upSince === undefined ? 0 : deps.now() - upSince);

  function attach(started: RunningWorld): void {
    world = started;
    exitSeen = undefined;
    expectedStop = false;
    frameFailures = 0;
    upSince = deps.now();
    void started.exited.then((code) => {
      if (world === started) exitSeen = { code };
    });
  }

  function down(): void {
    if (upSince !== undefined) upBeforeMs += deps.now() - upSince;
    upSince = undefined;
  }

  const guard = (): void => {
    if (deps.empty200()) {
      throw new RunEnd(
        "fault",
        "five empty responses in a row from the model endpoint (Ollama's empty-200 fault)",
      );
    }
    if (exitSeen !== undefined && !expectedStop) {
      throw new RunEnd(
        "failed",
        `the sidecar exited (${exitSeen.code}) before the run ended`,
      );
    }
  };

  function flush(): void {
    const records = deps.proxy.records();
    for (const record of records.slice(proxyRecordsWritten)) {
      appendFileSync(file("proxy-records.jsonl"), jsonl(record));
    }
    proxyRecordsWritten = records.length;
    const sample = deps.sampler.peek();
    if (sample !== undefined && sample.atMs !== lastSampleAt) {
      lastSampleAt = sample.atMs;
      appendFileSync(file("memory.jsonl"), jsonl(sample));
    }
  }

  async function readFrameNow(): Promise<FrameReading | undefined> {
    if (world === undefined) return undefined;
    try {
      const frame = await world.frame();
      frameFailures = 0;
      lastFrame = frame;
      appendFileSync(
        file("frames.jsonl"),
        jsonl({
          atMs: deps.now(),
          runningMs: runningMs(),
          sequence: frame.sequence,
          tick: frame.tick,
          status: frame.status,
          degradedReason: frame.degradedReason,
          summaryId: frame.catchUpSummary?.id,
        }),
      );
      return frame;
    } catch {
      frameFailures += 1;
      guard();
      if (frameFailures >= FRAME_FAILURES_MAX) {
        throw new RunEnd(
          "failed",
          `the frame could not be read ${FRAME_FAILURES_MAX} times in a row`,
        );
      }
      return undefined;
    }
  }

  async function poll(): Promise<void> {
    await deps.sleep(POLL_MS);
    guard();
    await readFrameNow();
    flush();
    guard();
  }

  async function record(phase: PhaseName, note?: string): Promise<void> {
    await readFrameNow().catch(() => undefined);
    const boundary: Boundary = {
      phase,
      wallMs: deps.now(),
      tick: lastFrame?.tick ?? -1,
      runningMs: runningMs(),
      ...(note === undefined ? {} : { note }),
    };
    boundaries.push(boundary);
    deps.log?.(
      `${new Date(boundary.wallMs).toISOString()} ${phase} at tick ${boundary.tick}, ${minutes(boundary.runningMs)} min running${note === undefined ? "" : ` (${note})`}`,
    );
  }

  function addCheck(name: string, ok: boolean, detail: string): void {
    checks.push({ name, ok, detail });
  }

  async function stopWorld(): Promise<number | null> {
    const stopping = world;
    if (stopping === undefined) return null;
    expectedStop = true;
    const code = await stopping.stopClean();
    down();
    return code;
  }

  let exportFailure: string | undefined;
  let exported = false;
  let end: RunEnd | undefined;
  try {
    deps.sampler.start();
    attach(await deps.startWorld());
    for (let tries = 0; tries < FRAME_FAILURES_MAX; tries += 1) {
      if (await readFrameNow()) break;
      await deps.sleep(POLL_MS);
    }
    if (lastFrame === undefined) {
      throw new RunEnd(
        "failed",
        "the sidecar served no frame after it started",
      );
    }
    await record("started");

    // Steady, until five gods have acted or the time bound.
    let trigger: "gods" | "time-bound";
    for (;;) {
      await poll();
      if (deps.godsCommitted().length >= OUTAGE_GODS) {
        trigger = "gods";
        break;
      }
      if (runningMs() >= plan.outageBoundMs) {
        trigger = "time-bound";
        break;
      }
    }
    // A proposal journaled before the proxy fails can commit on a later tick, inside the outage. The outage waits for
    // those to commit, so that "no god action commits during the outage" is true of the world and not of the requests.
    const drainStarted = deps.now();
    while (
      (deps.pendingProposals?.() ?? 0) > 0 &&
      deps.now() - drainStarted < DRAIN_TIMEOUT_MS
    ) {
      await poll();
    }
    const stillPending = deps.pendingProposals?.() ?? 0;
    const godsActed = deps.godsCommitted().length;
    outage = { trigger, godsActed };
    deps.proxy.fail();
    const acted =
      trigger === "gods"
        ? `${godsActed} of ${GODS.length} gods had acted`
        : `the time bound: only ${godsActed} of ${GODS.length} gods had acted`;
    await record(
      "outage-started",
      stillPending === 0
        ? acted
        : `${acted}; ${stillPending} god ${stillPending === 1 ? "proposal was" : "proposals were"} still pending after ${DRAIN_TIMEOUT_MS / 1000} s of waiting`,
    );

    const outageEndsAt = runningMs() + plan.outageMs;
    while (runningMs() < outageEndsAt) await poll();

    deps.proxy.pass();
    const restoredWallMs = deps.now();
    const runnerReading = deps.sampler.peek()?.runner.state;
    await record("proxy-restored");
    const stopAt = runningMs() + plan.stopAfterRestoreMs;
    while (runningMs() < stopAt) await poll();
    const first = deps.proxy
      .records()
      .find(
        (entry) => entry.at >= restoredWallMs && entry.kind === "completion",
      );
    restore = {
      runnerAtRestore: runnerReading ?? "unsampled",
      firstRequestAfterRestore:
        first === undefined
          ? undefined
          : {
              latencyMs: first.latencyMs,
              status: first.status,
              empty: first.empty,
              afterRestoreMs: first.at - restoredWallMs,
            },
    };

    // Stop, fall 90 minutes behind, restart.
    const code = await stopWorld();
    addCheck("the sidecar stops cleanly", code === 0, `exit code ${code}`);
    await record("stopped");
    deps.backdate(plan.gapMs);
    attach(await deps.startWorld());
    await record("restarted");

    const restartedAt = deps.now();
    const catchUpLines = (): {
      started: number | undefined;
      finished: number | undefined;
      passes: number;
      open: boolean;
    } => {
      const lines = world?.lines() ?? [];
      const starts = lines.filter((l) => l.text.endsWith("catch-up started"));
      const finishes = lines.filter((l) =>
        l.text.endsWith("catch-up finished"),
      );
      return {
        started: starts[0]?.at,
        finished: finishes.at(-1)?.at,
        passes: finishes.length,
        open: starts.length > finishes.length,
      };
    };
    const overdue = (): void => {
      if (deps.now() - restartedAt >= CATCH_UP_TIMEOUT_MS) {
        throw new RunEnd(
          "failed",
          `the catch-up did not finish within ${CATCH_UP_TIMEOUT_MS / 1000} s of the restart`,
        );
      }
    };
    while (catchUpLines().finished === undefined) {
      overdue();
      await poll();
    }
    // The catch-up is over when no pass is open and the last one ended a settle ago.
    for (;;) {
      const now = catchUpLines();
      if (
        !now.open &&
        now.finished !== undefined &&
        deps.now() - now.finished >= SETTLE_MS
      ) {
        break;
      }
      overdue();
      await poll();
    }
    const lines = catchUpLines();
    const summaryFrame = await readFrameNow();
    const summary = summaryFrame?.catchUpSummary;
    await record("catch-up-finished");
    addCheck(
      "the catch-up is bracketed by its own log lines",
      lines.started !== undefined &&
        lines.finished !== undefined &&
        lines.finished >= lines.started,
      `${lines.started === undefined ? "no start line" : new Date(lines.started).toISOString()} .. ${lines.finished === undefined ? "no finish line" : new Date(lines.finished).toISOString()}`,
    );
    // The persisted summary describes the last pass, so what the checks read is what later passes cannot overwrite: the
    // ticks the world advanced since the stop, and the discard the journal holds.
    const stoppedTick = boundaries.find((b) => b.phase === "stopped")?.tick;
    const settledTick = boundaries.at(-1)?.tick;
    const journalApplied =
      stoppedTick === undefined || settledTick === undefined
        ? 0
        : (settledTick - stoppedTick) * 1000;
    const journalDiscarded = deps.discardedMs();
    const appliedOk =
      journalApplied >= CATCH_UP_CAP_MS &&
      journalApplied <= CATCH_UP_CAP_MS + APPLIED_SLACK_MS;
    const discardedOk =
      journalDiscarded >= plan.gapMs - CATCH_UP_CAP_MS &&
      journalDiscarded <= plan.gapMs - CATCH_UP_CAP_MS + 10 * MINUTE;
    addCheck(
      "the catch-up applies the cap and discards the rest",
      appliedOk && discardedOk,
      `${lines.passes} ${lines.passes === 1 ? "pass" : "passes"}; the journal: ${(journalApplied / MINUTE).toFixed(1)} min applied by tick, ${(journalDiscarded / MINUTE).toFixed(1)} min discarded`,
    );
    const inside = requestsInside(
      deps.proxy.records(),
      lines.started ?? restartedAt,
      lines.finished ?? deps.now(),
    );
    addCheck(
      "no provider request is made during the catch-up",
      inside === 0,
      `${inside} requests inside it`,
    );
    if (summary !== undefined) {
      catchUp = {
        summaryId: summary.id,
        appliedMs: summary.appliedMs,
        skippedMs: summary.skippedMs,
        startedWallMs: lines.started ?? restartedAt,
        finishedWallMs: lines.finished ?? deps.now(),
        passes: lines.passes,
        journal: { appliedMs: journalApplied, discardedMs: journalDiscarded },
      };
    }

    while (runningMs() < plan.runMs) await poll();
    const finalFrame = (await readFrameNow()) ?? lastFrame;
    await record("ended");
    // The observation ends here. What follows (the export, the stop, the rebuild) is not part of what the gate measures.
    observationEndedAt = deps.now();
    addCheck(
      "the catch-up summary is still the summary at the end",
      summary !== undefined && finalFrame?.catchUpSummary?.id === summary.id,
      `${summary?.id} .. ${finalFrame?.catchUpSummary?.id}`,
    );
    if (world !== undefined) {
      try {
        await deps.onEnd?.(world);
        exported = true;
      } catch (error) {
        exportFailure = error instanceof Error ? error.message : String(error);
        throw new RunEnd("failed", `the end capture failed: ${exportFailure}`);
      }
    }
    await stopWorld();
  } catch (error) {
    end =
      error instanceof RunEnd
        ? error
        : new RunEnd(
            "failed",
            `unexpected error: ${error instanceof Error ? error.message : String(error)}`,
          );
  }

  if (end !== undefined) {
    observationEndedAt ??= deps.now();
    // A run that ends early still stops what it started and keeps what it has.
    if (world !== undefined && exitSeen === undefined) {
      try {
        await stopWorld();
      } catch {
        // Best effort.
      }
    }
    down();
  }
  const statusAfterStop: UnattendedStatus =
    end !== undefined
      ? end.status
      : checks.some((entry) => !entry.ok)
        ? "failed"
        : "completed";
  let baseline: BaselineRecord | undefined;
  let baselineFailure: string | undefined;
  if (deps.afterStop !== undefined) {
    try {
      baseline = await deps.afterStop({
        status: statusAfterStop,
        archiveMissingReason: exported
          ? undefined
          : exportFailure === undefined
            ? "the run ended before the export"
            : `the export failed: ${exportFailure}`,
      });
    } catch (error) {
      baselineFailure = error instanceof Error ? error.message : String(error);
    }
  }
  const everySample = deps.sampler.stop();
  flush();
  // The gate's samples stop where the observation does. Later ones (the sidecar is stopped while the archive is
  // exported and rebuilt) stay in memory.jsonl, marked as post-run, and are in no trend.
  const samples =
    observationEndedAt === undefined
      ? everySample
      : everySample.filter((sample) => sample.atMs <= observationEndedAt);
  const postRun = everySample.slice(samples.length);
  writeFileSync(
    file("memory.jsonl"),
    [
      ...samples.map((sample) => jsonl({ ...sample, phase: "observation" })),
      ...postRun.map((sample) => jsonl({ ...sample, phase: "post-run" })),
    ].join(""),
  );
  const summary = summarizeMemory(samples);

  const failedChecks = checks.filter((entry) => !entry.ok);
  const status: UnattendedStatus =
    end !== undefined
      ? end.status
      : failedChecks.length > 0
        ? "failed"
        : "completed";
  const reason =
    end !== undefined
      ? end.message
      : failedChecks.length > 0
        ? `checks failed: ${failedChecks.map((entry) => entry.name).join("; ")}`
        : undefined;

  if (status !== "completed") {
    const state = await deps.diagnose();
    const dir = join(outDir, "diagnostics");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "ollama-ps.json"),
      `${JSON.stringify(state.ps, null, 2)}\n`,
    );
    writeFileSync(
      join(dir, "ollama-log-tail.txt"),
      renderLogTail(state.logTail),
    );
    writeFileSync(
      join(dir, "memory.json"),
      `${JSON.stringify({ last: samples.at(-1), summary, postRunSamples: postRun.length }, null, 2)}\n`,
    );
  }

  const endedWallMs = deps.now();
  const finished: UnattendedResult = {
    status,
    ...(deps.settings === undefined ? {} : { settings: deps.settings }),
    ...(baseline === undefined ? {} : { baseline }),
    ...(reason === undefined ? {} : { reason }),
    plan,
    startedWallMs,
    endedWallMs,
    elapsedWallMs: endedWallMs - startedWallMs,
    runningMs: runningMs(),
    boundaries,
    checks,
    ...(outage === undefined ? {} : { outage }),
    ...(restore === undefined ? {} : { restore }),
    ...(catchUp === undefined ? {} : { catchUp }),
  };
  // The report is rendered before the run is written, so the threshold result it reaches is part of the record and of
  // the exit. A report that cannot be generated fails the run.
  let rendered: ReturnType<NonNullable<UnattendedDeps["renderReport"]>>;
  let reportError: string | undefined;
  try {
    rendered = deps.renderReport?.(finished, samples);
  } catch (error) {
    reportError = `the report could not be rendered: ${error instanceof Error ? error.message : String(error)}`;
  }
  const result: UnattendedResult = {
    ...finished,
    ...(rendered === undefined ? {} : { gate: rendered.gate }),
    ...(reportError === undefined ? {} : { reportError }),
  };
  writeFileSync(
    file("run.json"),
    `${JSON.stringify({ ...result, memory: summary }, null, 2)}\n`,
  );
  writeFileSync(
    file("report.md"),
    rendered?.text ?? renderRunSummary(result, baselineFailure),
  );
  return result;
}

// --- The summary ------------------------------------------------------------------------------

const minutes = (ms: number): string => (ms / MINUTE).toFixed(1);

/** The plain account of the run that Unit 5's report builds on: its status, its phase boundaries and its checks. */
export function renderRunSummary(
  result: UnattendedResult,
  baselineFailure?: string,
): string {
  const heading =
    result.status === "fault"
      ? "INFRASTRUCTURE FAULT (exit 2)"
      : result.status === "failed" || result.reportError !== undefined
        ? result.status === "completed"
          ? "COMPLETED, REPORT FAILED (exit 1)"
          : "FAILED (exit 1)"
        : "COMPLETED";
  const lines = [
    `# Unattended run: ${heading}`,
    "",
    result.reason === undefined ? "" : `Reason: ${result.reason}`,
    "",
    result.reportError === undefined
      ? ""
      : `Report: ${result.reportError}. This summary stands in for it, and the command fails.`,
    "",
    result.plan.gate
      ? "A full-length run: the gate verdict is the threshold table's, not this summary's."
      : `A ${result.plan.minutes}-minute run is not a gate run: it has no gate verdict.`,
    "",
    `Running time ${minutes(result.runningMs)} min of ${result.plan.minutes}; elapsed wall time ${minutes(result.elapsedWallMs)} min.`,
    "",
    result.settings === undefined
      ? ""
      : `The model ran at ${result.settings.endpoint === "local" ? "a local" : "a hosted"} OpenAI-compatible endpoint (${result.settings.model}${result.settings.reasoningEffort === undefined ? "" : `, reasoning ${result.settings.reasoningEffort}`}).`,
    "",
    "| Phase | Wall time | Tick | Running (min) | Note |",
    "| --- | --- | --- | --- | --- |",
    ...result.boundaries.map(
      (b) =>
        `| ${b.phase} | ${new Date(b.wallMs).toISOString()} | ${b.tick} | ${minutes(b.runningMs)} | ${b.note ?? ""} |`,
    ),
    "",
  ];
  if (result.outage !== undefined) {
    lines.push(
      result.outage.trigger === "gods"
        ? `The outage started when ${result.outage.godsActed} of ${GODS.length} gods had acted.`
        : `The outage started at the time bound: ${result.outage.godsActed} of ${GODS.length} gods had acted.`,
      "",
    );
  }
  if (result.catchUp !== undefined && result.catchUp.passes > 1) {
    lines.push(
      `The sidecar ran ${result.catchUp.passes} catch-up passes. The persisted summary was replaced by the last pass (${(result.catchUp.appliedMs / 1000).toFixed(0)} s applied, ${(result.catchUp.skippedMs / MINUTE).toFixed(1)} min discarded); the journal holds ${(result.catchUp.journal.appliedMs / MINUTE).toFixed(1)} min applied and ${(result.catchUp.journal.discardedMs / MINUTE).toFixed(1)} min discarded.`,
      "",
    );
  }
  if (result.restore !== undefined) {
    const first = result.restore.firstRequestAfterRestore;
    lines.push(
      `At proxyRestoredAt the Ollama runner was ${result.restore.runnerAtRestore}; ${
        first === undefined
          ? "no model request followed before the stop."
          : `the first request after it arrived ${(first.afterRestoreMs / 1000).toFixed(1)} s later and took ${(first.latencyMs / 1000).toFixed(1)} s (status ${first.status}${first.empty ? ", empty shape" : ""}).`
      }`,
      "",
    );
  }
  if (result.baseline !== undefined) {
    lines.push(...renderBaseline(result.baseline), "");
  } else if (baselineFailure !== undefined) {
    lines.push(`The baseline could not be captured: ${baselineFailure}`, "");
  }
  lines.push(
    "| Check | Result | Detail |",
    "| --- | --- | --- |",
    ...result.checks.map(
      (c) => `| ${c.name} | ${c.ok ? "pass" : "FAIL"} | ${c.detail} |`,
    ),
    "",
  );
  return lines
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");
}

const KIB = 1024;
const bytesText = (bytes: number): string =>
  bytes >= KIB * KIB
    ? `${(bytes / KIB / KIB).toFixed(1)} MiB`
    : `${(bytes / KIB).toFixed(1)} KiB`;

/** The baseline's lines in plain words: sizes, the rebuild and the import, each part captured or missing. */
function renderBaseline(baseline: BaselineRecord): string[] {
  const { store, archive, rebuild, importProof } = baseline;
  const lines = ["Workload baseline:"];
  lines.push(
    store.state === "captured"
      ? `- Store ${bytesText(store.bytes)}, WAL ${bytesText(store.walBytes)}.`
      : `- Store: missing (${store.reason}).`,
  );
  lines.push(
    archive.state === "captured"
      ? `- Archive ${bytesText(archive.bytes)}, ${archive.eventSequence} events.`
      : `- Archive: missing (${archive.reason}).`,
  );
  lines.push(
    rebuild.state === "captured"
      ? `- Rebuild from genesis and ${rebuild.events} events: ${rebuild.ms.toFixed(1)} ms in a separate process; the rebuilt projection ${rebuild.equal ? "equals the live projection" : `DIFFERS from the live projection (first at ${rebuild.firstDifference})`} (${rebuild.projectionBytes} bytes, digest ${rebuild.rebuiltDigest.slice(0, 12)}); integrity ${rebuild.integrity}.`
      : `- Rebuild from genesis: missing (${rebuild.reason}).`,
  );
  lines.push(
    importProof.state === "captured"
      ? importProof.ok
        ? `- Import of the archive into a scratch slot: accepted (${importProof.events} events).`
        : `- Import of the archive into a scratch slot: REFUSED (${importProof.refusal?.kind}: ${importProof.refusal?.reason}).`
      : `- Import of the archive: missing (${importProof.reason}).`,
  );
  return lines;
}

// --- The real wiring --------------------------------------------------------------------------

/** `tools/scenarios/m2-greek-cast/unattended/<timestamp>/`, the timestamp safe as a file name. */
export function defaultUnattendedDir(now: Date = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d+Z$/, "")
    .replaceAll(":", "-");
  return join(REPO_ROOT, "tools/scenarios/m2-greek-cast/unattended", stamp);
}

const OLLAMA = "http://127.0.0.1:11434";

/** Every god answers each turn with a legend of its own, so the run has gods acting without a model. */
function scriptedAnswers(provider: ScriptedProvider): void {
  let n = 0;
  for (const god of GODS) {
    provider.policy(god as God, () => {
      n += 1;
      return JSON.stringify({
        action: "legend",
        assertion: `A tale told by ${god}, number ${n}.`,
      });
    });
  }
}

/** The options of an unattended run: the local Ollama, reached through the outage proxy at `proxyUrl`. */
function unattendedOptions(
  args: Args,
  binary: string,
  proxyUrl?: string,
): RealOptions {
  return {
    binary,
    durationMs: args.unattendedMinutes * MINUTE,
    ollama: OLLAMA,
    model: args.model,
    ...(args.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: args.reasoningEffort }),
    ...(proxyUrl === undefined
      ? {}
      : { baseUrl: `${proxyUrl}/v1`, upstreamIsLocal: true as const }),
  };
}

/** The launch line the sidecar is started with: the routing config pointing at the proxy, online, with no keys. */
export function unattendedLaunchConfig(
  args: Args,
  binary: string,
  proxyUrl: string,
) {
  return launchConfigFor(unattendedOptions(args, binary, proxyUrl));
}

/** What the run records about its settings: the model, and that the endpoint was local, never a host or port. */
export function unattendedSettings(
  args: Args,
  binary: string,
  proxyUrl: string,
): RunSettings {
  const options = unattendedOptions(args, binary, proxyUrl);
  const endpoint = endpointKind(options);
  // The scripted provider answers whatever model name it is sent: the record says what answered.
  if (args.scripted !== undefined) {
    return { model: "scripted", endpoint: endpoint ?? "local" };
  }
  return {
    model: options.model,
    ...(options.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: options.reasoningEffort }),
    endpoint: endpoint ?? "local",
  };
}

/**
 * One unattended run against the compiled sidecar. The model endpoint is local Ollama behind the outage proxy, or,
 * with `--scripted`, the scripted provider behind it. Returns the result; the caller exits with its code.
 */
export async function runUnattended(
  args: Args,
  onEnd?: UnattendedDeps["onEnd"],
): Promise<UnattendedResult> {
  const outDir = args.out ?? defaultUnattendedDir();
  mkdirSync(outDir, { recursive: true });
  const dataDir = join(outDir, "app-data");
  const archivePath = join(outDir, "archive.sqlite");
  const binary = resolveSidecarBinary(args.skipBuild);
  const options = unattendedOptions(args, binary);

  let provider: ScriptedProvider | undefined;
  let upstream = OLLAMA;
  if (args.scripted === undefined) {
    await prepareOllama(options);
  } else {
    provider = startProvider();
    if (args.scripted === "answer") scriptedAnswers(provider);
    else {
      for (const god of GODS)
        provider.policy(god as God, () => EMPTY_COMPLETION);
    }
    upstream = new URL(provider.baseUrl).origin;
  }

  let faulted = false;
  const proxy = startOutageProxy({
    upstream,
    onEmptyRun: () => {
      faulted = true;
    },
  });
  const launchConfig = unattendedLaunchConfig(args, binary, proxy.url);

  let current: { readonly pid: number } | undefined;
  const sampler = createMemorySampler({
    ollamaPid: () => findOllamaServePid(),
    sidecarPid: () => current?.pid,
  });

  const gods = new Set<string>(GODS);
  const startedAt = Date.now();
  const deps: UnattendedDeps = {
    outDir,
    plan: phasePlan(args.unattendedMinutes),
    settings: unattendedSettings(args, binary, proxy.url),
    now: Date.now,
    sleep: (ms) => Bun.sleep(ms),
    async startWorld() {
      const sidecar = await startSidecar(binary, dataDir, { launchConfig });
      current = sidecar;
      return {
        pid: sidecar.pid,
        request: (method, path, body) => sidecar.request(method, path, body),
        async frame() {
          const { frame, state } = await readFrame(sidecar);
          return {
            tick: state.tick,
            sequence: frame.sequence,
            status: frame.status,
            ...(frame.degradedReason === undefined
              ? {}
              : { degradedReason: frame.degradedReason }),
            ...(frame.catchUpSummary === undefined
              ? {}
              : {
                  catchUpSummary: {
                    id: frame.catchUpSummary.id,
                    appliedMs: frame.catchUpSummary.appliedMs,
                    skippedMs: frame.catchUpSummary.skippedMs,
                  },
                }),
          };
        },
        async stopClean() {
          const code = await sidecar.stop("SIGTERM");
          current = undefined;
          return code;
        },
        exited: sidecar.exited.then((code) => {
          if (current === sidecar) current = undefined;
          return code;
        }),
        lines: () => sidecar.lines(),
      };
    },
    godsCommitted() {
      try {
        const acted = new Set<string>();
        for (const entry of readProposals(activeStorePath(dataDir))) {
          if (entry.outcome === "committed" && gods.has(entry.actor)) {
            acted.add(entry.actor);
          }
        }
        return [...acted];
      } catch {
        return [];
      }
    },
    discardedMs: () => readCatchUpDiscardedMs(activeStorePath(dataDir)),
    backdate(ms) {
      const path = activeStorePath(dataDir);
      backdateCursor(path, persistedClock({ dataDir }).cursorWallMs - ms);
    },
    proxy,
    empty200: () => faulted,
    sampler,
    diagnose: () =>
      captureOllamaState({
        ollama: OLLAMA,
        home: homedir(),
        since: startedAt,
      }),
    log: (line) => console.log(line),
    renderReport: (finished, samples) => {
      const path = activeStorePath(dataDir);
      const proposals = readProposals(path)
        .filter((entry) => entry.source === "model")
        .map((entry) => ({
          proposalId: entry.proposalId,
          actor: entry.actor,
          kind: entry.kind,
          observationId: String(entry.proposal.observationId),
          proposal: entry.proposal,
          outcome: entry.outcome as "committed" | "rejected" | undefined,
          ...(entry.reason === undefined ? {} : { reason: entry.reason }),
          ...(entry.consumedTick === undefined
            ? {}
            : { consumedTick: entry.consumedTick }),
        }));
      const last = finished.boundaries.at(-1);
      const input: RealInput = {
        requests: readRealRequests(path),
        proposals,
        events: readStoredEvents(path),
        polls: { total: 0, degraded: 0 },
        timing: {
          gods: [...GODS],
          endedAtMs: finished.endedWallMs,
          endTick: last?.tick ?? 0,
        },
      };
      const data = {
        result: finished,
        input,
        proxy: proxy.records(),
        memory: samples,
        identities: loadGodIdentities(join(REPO_ROOT, "content/greek/gods"), [
          ...GODS,
        ]),
        gods: [...GODS],
      };
      const analysis = analyzeUnattended(data);
      return {
        text: renderUnattendedReport(data, analysis),
        gate: gateOutcomeOf(analysis),
      };
    },
    pendingProposals: () => {
      try {
        return readProposals(activeStorePath(dataDir)).filter(
          (entry) =>
            entry.source === "model" &&
            entry.outcome === undefined &&
            gods.has(entry.actor),
        ).length;
      } catch {
        return 0;
      }
    },
    onEnd: async (world) => {
      await exportForBaseline(world, archivePath);
      await onEnd?.(world);
    },
    afterStop: ({ archiveMissingReason }) =>
      captureBaseline({
        runDir: outDir,
        dataDir,
        archivePath,
        ...(archiveMissingReason === undefined ? {} : { archiveMissingReason }),
      }),
  };

  try {
    return await driveUnattended(deps);
  } finally {
    killAllSidecars();
    proxy.stop();
    provider?.stop();
  }
}

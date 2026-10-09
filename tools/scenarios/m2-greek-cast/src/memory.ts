// Memory sampling for the unattended run: every 10 s, the Ollama runner's and the sidecar's RSS and physical footprint
// and swap use, recorded as pids and numbers only (never a command line), and a summary of start, peak and end for each
// series plus whether the sidecar's memory is still growing once it has settled.
//
// The verdict is read on the footprint, not on RSS. RSS counts pages the allocator has freed and the
// kernel has not yet taken back, which grow under allocation churn while the memory the process holds stays flat; the
// footprint (`footprint -p <pid>`, the figure Activity Monitor shows as Memory) leaves them out. RSS is still recorded
// and its trend reported, for context. `footprint` took about 90 ms on a process holding 1 GB, `top -l 1` about 325 ms
// and `vmmap -summary` about 740 ms, and all three agree on the figure.
//
// The runner is the child `ollama serve` spawns for the loaded model; the supervisor's own RSS says nothing
// about the weights, and the child's pid changes on every reload, so it is resolved again on every sample
// (docs/solutions/performance-issues/ollama-runner-pid-rss-sampling-2026-09-27.md). The process-table helpers are
// the coexistence probe's, which take the command runner as a parameter; every read here goes through that
// parameter so a test can answer from a fake process table.

import {
  findOllamaRunnerPids,
  parseSwapUsage,
  type RunCommand,
  readRssKb,
} from "../../../probes/coexistence/src/sample";

export type { RunCommand };

/** The sampling interval of the unattended run. */
export const SAMPLE_INTERVAL_MS = 10_000;
/** The window of the slope kept as context: the last 20 minutes. It no longer decides the memory row. */
export const TREND_WINDOW_MS = 20 * 60_000;
/** A slope over the context window is under this many percent of its mean per 10 minutes when it is flat enough to read as levelling off. Context only. */
export const LEVELLING_OFF_PERCENT_PER_10_MIN = 1;

// The memory row compares two halves of the settled span. A window slope could not tell a drift of a few MiB in a
// footprint that swings by ±10 MiB from real growth: over the same hour-long run the last-20-minute slope read
// anywhere from -1.65% to +4.34% per 10 minutes depending on where the window sat.
/** The length of the gate run, in minutes. The settle drop and the floor below are for a run of this length and scale with it. */
export const FULL_RUN_MINUTES = 60;
/** The time after the catch-up finishes that is left out of the settled span: the heap is still settling from the catch-up's burst. At the full run length. */
export const SETTLE_AFTER_CATCH_UP_MS = 15 * 60_000;
/** The settled span must be at least this long to be judged. At the full run length. */
export const SETTLED_FLOOR_MS = 20 * 60_000;
/** The row fails when the footprint's mean over the second half of the settled span is more than this many percent above the first half's. */
export const MAX_SETTLED_GROWTH_PERCENT = 10;

const BYTES_PER_KIB = 1024;
const TEN_MINUTES_MS = 10 * 60_000;

/** Runs a command and returns its standard output; `undefined` when it fails, prints nothing or cannot start. */
export function runCommandSync(command: readonly string[]): string | undefined {
  try {
    const result = Bun.spawnSync([...command]);
    if (result.exitCode !== 0) return undefined;
    const output = result.stdout.toString();
    return output.length > 0 ? output : undefined;
  } catch {
    return undefined;
  }
}

/** A process's pid, resolved on each sample: the sidecar's changes when it is restarted, and it has none while stopped. */
export type PidSource = () => number | undefined;

export type RunnerReading =
  | {
      readonly state: "present";
      /** The runner child pid(s) found this sample, and their summed RSS. */
      readonly pids: readonly number[];
      readonly rssBytes: number;
      /** Their summed physical footprint; absent when it could not be read for every one of them. */
      readonly footprintBytes?: number | undefined;
    }
  /** No runner child, or none whose RSS could be read: the model is unloaded, or Ollama is down. */
  | { readonly state: "absent" };

export type SidecarReading =
  | {
      readonly state: "present";
      readonly pid: number;
      readonly rssBytes: number;
      /** Its physical footprint; absent when `footprint` could not read it. */
      readonly footprintBytes?: number | undefined;
    }
  /** The sidecar has no pid (stopped between runs), or its pid is gone. */
  | { readonly state: "absent" };

export interface MemorySample {
  /** Wall-clock time of the sample, in epoch milliseconds. */
  readonly atMs: number;
  readonly runner: RunnerReading;
  readonly sidecar: SidecarReading;
  /** From `sysctl vm.swapusage`; absent when that read failed. */
  readonly swap:
    | { readonly usedMiB: number; readonly totalMiB: number }
    | undefined;
}

export interface SampleSources {
  /** The pid of `ollama serve`, whose runner children are sampled. */
  readonly ollamaPid: PidSource;
  readonly sidecarPid: PidSource;
  readonly runCommand?: RunCommand;
  readonly now?: () => number;
}

/** The pid of `ollama serve`: the lowest pid whose command is the `ollama` binary run with `serve`. */
export function findOllamaServePid(
  runCommand: RunCommand = runCommandSync,
): number | undefined {
  const output = runCommand(["pgrep", "-f", "(^|/)ollama serve( |$)"]);
  if (output === undefined) return undefined;
  const pids = output
    .trim()
    .split("\n")
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0);
  return pids.length > 0 ? Math.min(...pids) : undefined;
}

/** One process's physical footprint in bytes (`footprint -p`, its `phys_footprint` line); `undefined` when it cannot be read. */
export function readFootprintBytes(
  pid: number,
  runCommand: RunCommand = runCommandSync,
): number | undefined {
  const output = runCommand([
    "footprint",
    "-p",
    String(pid),
    "-f",
    "bytes",
    "--noCategories",
  ]);
  const found =
    output === undefined ? null : /phys_footprint:\s+(\d+) B/.exec(output);
  const bytes = found?.[1] === undefined ? Number.NaN : Number(found[1]);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : undefined;
}

function readRunner(
  supervisor: number | undefined,
  runCommand: RunCommand,
): RunnerReading {
  if (supervisor === undefined) return { state: "absent" };
  // Only the runner children count: with none, the runner is absent, and the supervisor's RSS is never a stand-in.
  const readable = findOllamaRunnerPids(supervisor, runCommand).flatMap(
    (pid) => {
      const kb = readRssKb(pid, runCommand);
      return kb === undefined
        ? []
        : [{ pid, kb, footprint: readFootprintBytes(pid, runCommand) }];
    },
  );
  if (readable.length === 0) return { state: "absent" };
  const footprints = readable.map(({ footprint }) => footprint);
  return {
    state: "present",
    pids: readable.map(({ pid }) => pid),
    rssBytes: readable.reduce((sum, { kb }) => sum + kb, 0) * BYTES_PER_KIB,
    footprintBytes: footprints.every((value) => value !== undefined)
      ? footprints.reduce((sum: number, value) => sum + (value ?? 0), 0)
      : undefined,
  };
}

function readSidecar(
  pid: number | undefined,
  runCommand: RunCommand,
): SidecarReading {
  if (pid === undefined) return { state: "absent" };
  const kb = readRssKb(pid, runCommand);
  return kb === undefined
    ? { state: "absent" }
    : {
        state: "present",
        pid,
        rssBytes: kb * BYTES_PER_KIB,
        footprintBytes: readFootprintBytes(pid, runCommand),
      };
}

/** One sample now. */
export function takeMemorySample(sources: SampleSources): MemorySample {
  const runCommand = sources.runCommand ?? runCommandSync;
  const swapText = runCommand(["sysctl", "vm.swapusage"]);
  const swap = swapText === undefined ? undefined : parseSwapUsage(swapText);
  return {
    atMs: (sources.now ?? Date.now)(),
    runner: readRunner(sources.ollamaPid(), runCommand),
    sidecar: readSidecar(sources.sidecarPid(), runCommand),
    swap:
      swap === undefined
        ? undefined
        : { usedMiB: swap.usedMiB, totalMiB: swap.totalMiB },
  };
}

export interface MemorySampler {
  /** Takes the first sample at once, then one every interval. */
  start(): void;
  /** Stops sampling and returns every sample taken. */
  stop(): readonly MemorySample[];
  /** The newest sample, or `undefined` before the first. */
  peek(): MemorySample | undefined;
}

export function createMemorySampler(
  options: SampleSources & { readonly intervalMs?: number },
): MemorySampler {
  const samples: MemorySample[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  const record = () => {
    samples.push(takeMemorySample(options));
  };
  return {
    start() {
      if (timer !== undefined) return;
      record();
      timer = setInterval(record, options.intervalMs ?? SAMPLE_INTERVAL_MS);
    },
    stop() {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      return samples;
    },
    peek() {
      return samples[samples.length - 1];
    },
  };
}

export interface SeriesSummary {
  /** The first, largest and last value read; `undefined` when the series was never present. */
  readonly start: number | undefined;
  readonly peak: number | undefined;
  readonly end: number | undefined;
  /** Samples that read a value, and samples where the series was absent (not counted as 0). */
  readonly present: number;
  readonly absent: number;
}

export type SidecarTrend =
  | {
      readonly judgeable: true;
      /** Least-squares slope over the window, as a percentage of the window's mean per 10 minutes. Negative when falling. */
      readonly percentPer10Min: number;
      /** True when the slope is under {@link LEVELLING_OFF_PERCENT_PER_10_MIN}; a falling series is levelling off. */
      readonly levellingOff: boolean;
      readonly windowSamples: number;
    }
  | { readonly judgeable: false; readonly reason: string };

export type SettledGrowth =
  | {
      readonly judgeable: true;
      /** The second half's mean footprint over the first half's, in percent. Negative when falling. */
      readonly growthPercent: number;
      /** True when {@link growthPercent} is not above {@link MAX_SETTLED_GROWTH_PERCENT}. */
      readonly withinLimit: boolean;
      readonly firstHalfMeanBytes: number;
      readonly secondHalfMeanBytes: number;
      /** Where the settled span starts (epoch ms), its length, and the samples in each half. */
      readonly settledFromMs: number;
      readonly settledMs: number;
      readonly firstHalfSamples: number;
      readonly secondHalfSamples: number;
    }
  | { readonly judgeable: false; readonly reason: string };

/** What the settled span depends on besides the samples: when the last catch-up finished, and how long the run was meant to be. */
export interface SettleOptions {
  /** Wall-clock time (epoch ms) the last catch-up finished; `undefined` when the run recorded none. */
  readonly catchUpFinishedMs: number | undefined;
  /** The run's length in minutes: the settle drop and the floor scale by this over {@link FULL_RUN_MINUTES}. */
  readonly runMinutes: number;
}

export interface MemorySummary {
  readonly samples: number;
  readonly spanMs: number;
  /** Runner and sidecar RSS in bytes; swap used in MiB. */
  readonly runner: SeriesSummary;
  readonly sidecar: SeriesSummary;
  readonly swapUsedMiB: SeriesSummary;
  /** The sidecar's and the runner's physical footprint in bytes. */
  readonly sidecarFootprint: SeriesSummary;
  readonly runnerFootprint: SeriesSummary;
  /** The sidecar's RSS trend over the last 20 minutes, for context. */
  readonly sidecarTrend: SidecarTrend;
  /** The sidecar's footprint trend over the last 20 minutes, for context. */
  readonly footprintTrend: SidecarTrend;
  /** The growth of the sidecar's footprint across the settled span: what the memory row is read on. */
  readonly settledGrowth: SettledGrowth;
}

function summarizeSeries(
  values: readonly (number | undefined)[],
): SeriesSummary {
  const present = values.filter(
    (value): value is number => value !== undefined,
  );
  return {
    start: present[0],
    peak: present.length > 0 ? Math.max(...present) : undefined,
    end: present[present.length - 1],
    present: present.length,
    absent: values.length - present.length,
  };
}

function sidecarTrend(
  samples: readonly MemorySample[],
  measure: "rss" | "footprint",
): SidecarTrend {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first === undefined || last === undefined) {
    return { judgeable: false, reason: "no samples" };
  }
  const windowMinutes = TREND_WINDOW_MS / 60_000;
  const windowStart = last.atMs - TREND_WINDOW_MS;
  if (first.atMs > windowStart) {
    const minutes = Math.floor((last.atMs - first.atMs) / 60_000);
    return {
      judgeable: false,
      reason: `the series covers ${minutes} minutes, shorter than the ${windowMinutes}-minute window`,
    };
  }
  const inWindow = samples.filter((taken) => taken.atMs >= windowStart);
  const points: { x: number; y: number; pid: number }[] = [];
  let unread = 0;
  for (const taken of inWindow) {
    if (taken.sidecar.state === "absent") {
      return {
        judgeable: false,
        reason: `the sidecar was absent in the last ${windowMinutes} minutes`,
      };
    }
    const y =
      measure === "rss" ? taken.sidecar.rssBytes : taken.sidecar.footprintBytes;
    if (y === undefined) {
      unread += 1;
      continue;
    }
    points.push({ x: taken.atMs - windowStart, y, pid: taken.sidecar.pid });
  }
  if (unread > 0) {
    return {
      judgeable: false,
      reason: `the sidecar's footprint was not read for ${unread} of ${inWindow.length} samples in the last ${windowMinutes} minutes`,
    };
  }
  if (new Set(points.map(({ pid }) => pid)).size > 1) {
    return {
      judgeable: false,
      reason: `the sidecar restarted inside the last ${windowMinutes} minutes, so one slope would span two processes`,
    };
  }
  const count = points.length;
  const meanX = points.reduce((sum, { x }) => sum + x, 0) / count;
  const meanY = points.reduce((sum, { y }) => sum + y, 0) / count;
  let covariance = 0;
  let variance = 0;
  for (const { x, y } of points) {
    covariance += (x - meanX) * (y - meanY);
    variance += (x - meanX) ** 2;
  }
  const bytesPerMs = variance === 0 ? 0 : covariance / variance;
  const percentPer10Min = ((bytesPerMs * TEN_MINUTES_MS) / meanY) * 100;
  return {
    judgeable: true,
    percentPer10Min,
    levellingOff: percentPer10Min < LEVELLING_OFF_PERCENT_PER_10_MIN,
    windowSamples: count,
  };
}

/**
 * The footprint's growth across the settled span: the span starts `SETTLE_AFTER_CATCH_UP_MS` (scaled to the run's
 * length) after the last catch-up finished and ends with the last sample, and is split at its middle in time; the
 * result is the second half's mean over the first's. A span under `SETTLED_FLOOR_MS` (scaled), a footprint unread in
 * it, the sidecar absent from it, or a restart inside it make the series not judgeable, never a pass.
 */
function settledGrowth(
  samples: readonly MemorySample[],
  settle: SettleOptions | undefined,
): SettledGrowth {
  const last = samples[samples.length - 1];
  if (last === undefined) return { judgeable: false, reason: "no samples" };
  if (settle === undefined || settle.catchUpFinishedMs === undefined) {
    return {
      judgeable: false,
      reason:
        "the run recorded no catch-up finish, so there is no settled span to judge",
    };
  }
  const dropMs =
    (SETTLE_AFTER_CATCH_UP_MS * settle.runMinutes) / FULL_RUN_MINUTES;
  const floorMs = (SETTLED_FLOOR_MS * settle.runMinutes) / FULL_RUN_MINUTES;
  const settledFromMs = settle.catchUpFinishedMs + dropMs;
  const settledMs = last.atMs - settledFromMs;
  if (settledMs < floorMs) {
    const minutes = (ms: number): string =>
      String(Number((ms / 60_000).toFixed(1)));
    return {
      judgeable: false,
      reason: `the settled span is ${minutes(Math.max(0, settledMs))} minutes (the ${minutes(dropMs)} minutes after the catch-up finished are left out), under the ${minutes(floorMs)}-minute floor`,
    };
  }
  const inSpan = samples.filter((taken) => taken.atMs >= settledFromMs);
  const points: { atMs: number; bytes: number; pid: number }[] = [];
  let unread = 0;
  for (const taken of inSpan) {
    if (taken.sidecar.state === "absent") {
      return {
        judgeable: false,
        reason: "the sidecar was absent in the settled span",
      };
    }
    if (taken.sidecar.footprintBytes === undefined) {
      unread += 1;
      continue;
    }
    points.push({
      atMs: taken.atMs,
      bytes: taken.sidecar.footprintBytes,
      pid: taken.sidecar.pid,
    });
  }
  if (unread > 0) {
    return {
      judgeable: false,
      reason: `the sidecar's footprint was not read for ${unread} of ${inSpan.length} samples in the settled span`,
    };
  }
  if (new Set(points.map(({ pid }) => pid)).size > 1) {
    return {
      judgeable: false,
      reason:
        "the sidecar restarted inside the settled span, so its halves would span two processes",
    };
  }
  const middle = settledFromMs + settledMs / 2;
  const first = points.filter(({ atMs }) => atMs < middle);
  const second = points.filter(({ atMs }) => atMs >= middle);
  const mean = (list: typeof points): number =>
    list.reduce((sum, { bytes }) => sum + bytes, 0) / list.length;
  if (first.length === 0 || second.length === 0) {
    return {
      judgeable: false,
      reason: "the settled span has no samples in one of its halves",
    };
  }
  const firstHalfMeanBytes = mean(first);
  const secondHalfMeanBytes = mean(second);
  const growthPercent = (secondHalfMeanBytes / firstHalfMeanBytes - 1) * 100;
  return {
    judgeable: true,
    growthPercent,
    withinLimit: growthPercent <= MAX_SETTLED_GROWTH_PERCENT,
    firstHalfMeanBytes,
    secondHalfMeanBytes,
    settledFromMs,
    settledMs,
    firstHalfSamples: first.length,
    secondHalfSamples: second.length,
  };
}

export function summarizeMemory(
  samples: readonly MemorySample[],
  settle?: SettleOptions,
): MemorySummary {
  const first = samples[0];
  const last = samples[samples.length - 1];
  return {
    samples: samples.length,
    spanMs:
      first === undefined || last === undefined ? 0 : last.atMs - first.atMs,
    runner: summarizeSeries(
      samples.map((taken) =>
        taken.runner.state === "present" ? taken.runner.rssBytes : undefined,
      ),
    ),
    sidecar: summarizeSeries(
      samples.map((taken) =>
        taken.sidecar.state === "present" ? taken.sidecar.rssBytes : undefined,
      ),
    ),
    swapUsedMiB: summarizeSeries(samples.map((taken) => taken.swap?.usedMiB)),
    sidecarFootprint: summarizeSeries(
      samples.map((taken) =>
        taken.sidecar.state === "present"
          ? taken.sidecar.footprintBytes
          : undefined,
      ),
    ),
    runnerFootprint: summarizeSeries(
      samples.map((taken) =>
        taken.runner.state === "present"
          ? taken.runner.footprintBytes
          : undefined,
      ),
    ),
    sidecarTrend: sidecarTrend(samples, "rss"),
    footprintTrend: sidecarTrend(samples, "footprint"),
    settledGrowth: settledGrowth(samples, settle),
  };
}

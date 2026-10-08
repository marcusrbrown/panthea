// Memory sampling for the unattended run: every 10 s, the Ollama runner's RSS, the sidecar's RSS and swap
// use, recorded as pids and numbers only (never a command line), and a summary of start, peak and end for each
// series plus whether the sidecar's RSS is still rising over the last 20 minutes.
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
/** The window the sidecar's RSS trend is judged over: the last 20 minutes. */
export const TREND_WINDOW_MS = 20 * 60_000;
/** The sidecar's RSS is levelling off when its slope over the window is under this many percent of its mean per 10 minutes. */
export const LEVELLING_OFF_PERCENT_PER_10_MIN = 1;

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
    }
  /** No runner child, or none whose RSS could be read: the model is unloaded, or Ollama is down. */
  | { readonly state: "absent" };

export type SidecarReading =
  | {
      readonly state: "present";
      readonly pid: number;
      readonly rssBytes: number;
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

function readRunner(
  supervisor: number | undefined,
  runCommand: RunCommand,
): RunnerReading {
  if (supervisor === undefined) return { state: "absent" };
  // Only the runner children count: with none, the runner is absent, and the supervisor's RSS is never a stand-in.
  const readable = findOllamaRunnerPids(supervisor, runCommand).flatMap(
    (pid) => {
      const kb = readRssKb(pid, runCommand);
      return kb === undefined ? [] : [{ pid, kb }];
    },
  );
  if (readable.length === 0) return { state: "absent" };
  return {
    state: "present",
    pids: readable.map(({ pid }) => pid),
    rssBytes: readable.reduce((sum, { kb }) => sum + kb, 0) * BYTES_PER_KIB,
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
    : { state: "present", pid, rssBytes: kb * BYTES_PER_KIB };
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
      /** Least-squares slope over the window, as a percentage of the window's mean RSS per 10 minutes. Negative when falling. */
      readonly percentPer10Min: number;
      /** True when the slope is under {@link LEVELLING_OFF_PERCENT_PER_10_MIN}; a falling series is levelling off. */
      readonly levellingOff: boolean;
      readonly windowSamples: number;
    }
  | { readonly judgeable: false; readonly reason: string };

export interface MemorySummary {
  readonly samples: number;
  readonly spanMs: number;
  /** Runner and sidecar RSS in bytes; swap used in MiB. */
  readonly runner: SeriesSummary;
  readonly sidecar: SeriesSummary;
  readonly swapUsedMiB: SeriesSummary;
  readonly sidecarTrend: SidecarTrend;
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

function sidecarTrend(samples: readonly MemorySample[]): SidecarTrend {
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
  for (const taken of inWindow) {
    if (taken.sidecar.state === "absent") {
      return {
        judgeable: false,
        reason: `the sidecar was absent in the last ${windowMinutes} minutes`,
      };
    }
    points.push({
      x: taken.atMs - windowStart,
      y: taken.sidecar.rssBytes,
      pid: taken.sidecar.pid,
    });
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

export function summarizeMemory(
  samples: readonly MemorySample[],
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
    sidecarTrend: sidecarTrend(samples),
  };
}

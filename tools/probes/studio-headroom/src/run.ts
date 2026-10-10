// Studio headroom sampler (parent plan Unit 7, U6): while one real image job
// runs beside the packaged studio, sample the worker's RSS, the studio app's
// and its sidecar's RSS, memory pressure, swap, free disk and a command round
// trip, every tick, into a time series and a summary.
//
// Process ids are never remembered between ticks. The worker is a different
// process after every abort and restart, so each tick reads the process table
// again, finds the processes by executable name, and labels every RSS with the
// pid it was read from. A pid that has gone by the RSS read is left out; a
// missing worker is a missing entry, never a zero.
//
// Reuses the coexistence probe's parsers and RSS reader; nothing here starts,
// stops or signals a studio process. The round-trip probe talks to a second,
// read-only session of the studio sidecar (see `createRoundTripProbe`).
//
//   bun tools/probes/studio-headroom/src/run.ts --out <dir> \
//     [--interval-ms 2000] [--duration-s N] [--disk-path <path>] \
//     [--roundtrip-sidecar <sidecar binary> --roundtrip-config <studio config>]

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  pagesToMiB,
  parseSwapUsage,
  parseVmStat,
  type RunCommand,
  readRssKb,
} from "../../coexistence/src/sample";

export type Role = "worker" | "app" | "sidecar";
export type Pressure = "normal" | "warn" | "critical";

export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
}

export interface LabelledProcess {
  readonly role: Role;
  /** The pid this RSS was read from on this tick. */
  readonly pid: number;
  readonly rssMiB: number;
  /**
   * Physical footprint from `footprint -p <pid>` (what Activity Monitor shows
   * as Memory); absent when it could not be read. RSS leaves out memory the
   * kernel holds for a process in other ways, so the worker's RSS can read far
   * below what it holds while a model is loaded; the footprint is the figure to
   * judge headroom by.
   */
  readonly footprintMiB?: number | undefined;
}

export interface HeadroomSample {
  readonly atMs: number;
  readonly processes: readonly LabelledProcess[];
  readonly pressure?: Pressure | undefined;
  readonly pressureLevel?: number | undefined;
  readonly swapUsedMiB?: number | undefined;
  readonly swapTotalMiB?: number | undefined;
  readonly vmFreeMiB?: number | undefined;
  readonly vmInactiveMiB?: number | undefined;
  readonly diskFreeMiB?: number | undefined;
  /** Milliseconds for one command round trip; `null` when it failed; absent when none was attempted. */
  readonly roundTripMs?: number | null | undefined;
}

const ROLE_ORDER: readonly Role[] = ["worker", "app", "sidecar"];

/** Parses `ps -axo pid=,ppid=,command=`. Lines that are not `<pid> <ppid> <command>` are skipped. */
export function parseProcessTable(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S.*)$/.exec(line);
    if (match === null) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      command: (match[3] as string).trim(),
    });
  }
  return rows;
}

/** The role of a process, by the executable's own name (never a substring of its arguments). */
export function classifyProcess(row: ProcessRow): Role | undefined {
  const executable = row.command.split(/\s+/, 1)[0] ?? "";
  switch (basename(executable)) {
    case "sd-server":
      return "worker";
    case "panthea-studio":
      return "app";
    case "panthea-studio-sidecar":
      return "sidecar";
    default:
      return undefined;
  }
}

export function parsePressureLevel(
  text: string,
): { level: number; name: Pressure } | undefined {
  const level = Number(text.trim());
  if (level === 1) return { level, name: "normal" };
  if (level === 2) return { level, name: "warn" };
  if (level === 4) return { level, name: "critical" };
  return undefined;
}

/** `footprint -p` prints `<name> [<pid>]: 64-bit    Footprint: 80 MB (…)`; the figure in MiB. */
export function parseFootprintMiB(text: string): number | undefined {
  const match = /Footprint:\s+([\d.]+)\s*(B|KB|MB|GB)\b/.exec(text);
  if (match === null) return undefined;
  const value = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(value)) return undefined;
  if (unit === "B") return value / (1024 * 1024);
  if (unit === "KB") return value / 1024;
  if (unit === "GB") return value * 1024;
  return value;
}

/** The Available column of the last `df -k` line. */
export function parseDiskFreeKb(text: string): number | undefined {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return undefined;
  const columns = (lines[lines.length - 1] as string).split(/\s+/);
  const available = Number(columns[3]);
  return Number.isFinite(available) ? available : undefined;
}

export function sampleHeadroom(
  run: RunCommand,
  options: { readonly diskPath: string; readonly atMs: number },
): HeadroomSample {
  const table = run(["ps", "-axo", "pid=,ppid=,command="]);
  const rows = (table === undefined ? [] : parseProcessTable(table)).flatMap(
    (row) => {
      const role = classifyProcess(row);
      return role === undefined ? [] : [{ role, pid: row.pid, ppid: row.ppid }];
    },
  );
  // A sidecar counts only when the studio app is its parent: the round-trip
  // probe starts a second, read-only session of the same binary, which is not
  // the app's own sidecar.
  const appPids = new Set(
    rows.filter((row) => row.role === "app").map((row) => row.pid),
  );
  const found = rows
    .filter((row) => row.role !== "sidecar" || appPids.has(row.ppid))
    .sort(
      (a, b) =>
        ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
        a.pid - b.pid,
    );
  const processes: LabelledProcess[] = [];
  for (const { role, pid } of found) {
    const kb = readRssKb(pid, run);
    if (kb === undefined) continue;
    const footprintText = run(["footprint", "-p", String(pid)]);
    const footprintMiB =
      footprintText === undefined
        ? undefined
        : parseFootprintMiB(footprintText);
    processes.push({
      role,
      pid,
      rssMiB: kb / 1024,
      ...(footprintMiB === undefined ? {} : { footprintMiB }),
    });
  }

  const vmText = run(["vm_stat"]);
  const vm = vmText === undefined ? undefined : parseVmStat(vmText);
  const swapText = run(["sysctl", "vm.swapusage"]);
  const swap = swapText === undefined ? undefined : parseSwapUsage(swapText);
  const pressureText = run([
    "sysctl",
    "-n",
    "kern.memorystatus_vm_pressure_level",
  ]);
  const pressure =
    pressureText === undefined ? undefined : parsePressureLevel(pressureText);
  const diskText = run(["df", "-k", options.diskPath]);
  const diskKb = diskText === undefined ? undefined : parseDiskFreeKb(diskText);

  return {
    atMs: options.atMs,
    processes,
    pressure: pressure?.name,
    pressureLevel: pressure?.level,
    swapUsedMiB: swap?.usedMiB,
    swapTotalMiB: swap?.totalMiB,
    vmFreeMiB:
      vm === undefined ? undefined : pagesToMiB(vm.freePages, vm.pageSizeBytes),
    vmInactiveMiB:
      vm === undefined
        ? undefined
        : pagesToMiB(vm.inactivePages, vm.pageSizeBytes),
    diskFreeMiB: diskKb === undefined ? undefined : diskKb / 1024,
  };
}

export interface RoleSummary {
  readonly peakRssMiB: number;
  readonly peakPid: number;
  /** The highest physical footprint read, with the pid it was read from; absent when it was never readable. */
  readonly peakFootprintMiB?: number;
  readonly peakFootprintPid?: number;
  readonly firstRssMiB: number;
  readonly lastRssMiB: number;
  /** Every pid this role was sampled as, in order of first appearance. */
  readonly pids: readonly { readonly pid: number; readonly samples: number }[];
}

export interface HeadroomSummary {
  readonly samples: number;
  readonly roles: Partial<Record<Role, RoleSummary>>;
  readonly worstPressure?: Pressure;
  readonly pressureCounts?: Partial<Record<Pressure, number>>;
  readonly maxSwapUsedMiB?: number;
  readonly minDiskFreeMiB?: number;
  readonly minVmFreeMiB?: number;
  readonly roundTrip?: {
    readonly measured: number;
    readonly failed: number;
    readonly medianMs: number;
    readonly p95Ms: number;
    readonly maxMs: number;
  };
}

const PRESSURE_RANK: Record<Pressure, number> = {
  normal: 0,
  warn: 1,
  critical: 2,
};

function percentile(sorted: readonly number[], fraction: number): number {
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1] as number;
}

export function summarize(samples: readonly HeadroomSample[]): HeadroomSummary {
  const roles: Partial<Record<Role, RoleSummary>> = {};
  for (const role of ROLE_ORDER) {
    const reads = samples.flatMap((sample) =>
      sample.processes.filter((p) => p.role === role),
    );
    const first = reads[0];
    const last = reads[reads.length - 1];
    if (first === undefined || last === undefined) continue;
    const peak = reads.reduce((best, read) =>
      read.rssMiB > best.rssMiB ? read : best,
    );
    const pids: { pid: number; samples: number }[] = [];
    for (const read of reads) {
      const seen = pids.find((p) => p.pid === read.pid);
      if (seen === undefined) pids.push({ pid: read.pid, samples: 1 });
      else seen.samples += 1;
    }
    const footprints = reads.filter((read) => read.footprintMiB !== undefined);
    const peakFootprint =
      footprints.length === 0
        ? undefined
        : footprints.reduce((best, read) =>
            (read.footprintMiB as number) > (best.footprintMiB as number)
              ? read
              : best,
          );
    roles[role] = {
      peakRssMiB: peak.rssMiB,
      peakPid: peak.pid,
      ...(peakFootprint === undefined
        ? {}
        : {
            peakFootprintMiB: peakFootprint.footprintMiB as number,
            peakFootprintPid: peakFootprint.pid,
          }),
      firstRssMiB: first.rssMiB,
      lastRssMiB: last.rssMiB,
      pids,
    };
  }

  const pressureCounts: Partial<Record<Pressure, number>> = {};
  let worst: Pressure | undefined;
  for (const sample of samples) {
    if (sample.pressure === undefined) continue;
    pressureCounts[sample.pressure] =
      (pressureCounts[sample.pressure] ?? 0) + 1;
    if (
      worst === undefined ||
      PRESSURE_RANK[sample.pressure] > PRESSURE_RANK[worst]
    )
      worst = sample.pressure;
  }
  const numbers = (pick: (s: HeadroomSample) => number | undefined) =>
    samples.flatMap((s) => {
      const value = pick(s);
      return value === undefined ? [] : [value];
    });
  const swaps = numbers((s) => s.swapUsedMiB);
  const disks = numbers((s) => s.diskFreeMiB);
  const frees = numbers((s) => s.vmFreeMiB);

  const attempts = samples.filter((s) => s.roundTripMs !== undefined);
  const times = attempts
    .flatMap((s) => (typeof s.roundTripMs === "number" ? [s.roundTripMs] : []))
    .sort((a, b) => a - b);
  const middle = Math.floor(times.length / 2);

  return {
    samples: samples.length,
    roles,
    ...(worst === undefined ? {} : { worstPressure: worst, pressureCounts }),
    ...(swaps.length === 0 ? {} : { maxSwapUsedMiB: Math.max(...swaps) }),
    ...(disks.length === 0 ? {} : { minDiskFreeMiB: Math.min(...disks) }),
    ...(frees.length === 0 ? {} : { minVmFreeMiB: Math.min(...frees) }),
    ...(attempts.length === 0
      ? {}
      : {
          roundTrip: {
            measured: times.length,
            failed: attempts.length - times.length,
            medianMs:
              times.length === 0
                ? 0
                : times.length % 2 === 1
                  ? (times[middle] as number)
                  : ((times[middle - 1] as number) +
                      (times[middle] as number)) /
                    2,
            p95Ms: times.length === 0 ? 0 : percentile(times, 0.95),
            maxMs: times.length === 0 ? 0 : (times[times.length - 1] as number),
          },
        }),
  };
}

/** Time, injected so the probe and the loop run under a test clock. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Calls `fn` after `ms`; the returned function cancels it. */
  after(ms: number, fn: () => void): () => void;
}

export const systemClock: Clock = {
  now: () => performance.now(),
  sleep: (ms) => Bun.sleep(ms),
  after: (ms, fn) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
};

/** One line-oriented conversation with a child (or a fake of one). */
export interface RoundTripLink {
  /** Sends one line (no trailing newline); throws if the child is gone. */
  send(line: string): void;
  onLine(handler: (line: string) => void): void;
  onExit(handler: () => void): void;
  close(): void;
}

export interface RoundTripProbe {
  /** Milliseconds from the request line to the reply with the same id; `undefined` when the child is gone or no reply comes in time. */
  measure(): Promise<number | undefined>;
  close(): void;
}

/**
 * A command round trip through a child that speaks newline-JSON
 * (`{id, op, args}` in, `{id, ok, ...}` out). Replies with another id are
 * ignored, so a late answer to an earlier request is never taken for this one.
 */
export function createRoundTripProbe(options: {
  readonly link: RoundTripLink;
  readonly op: string;
  readonly timeoutMs?: number;
  readonly clock?: Clock;
}): RoundTripProbe {
  const { link } = options;
  const clock = options.clock ?? systemClock;
  const timeoutMs = options.timeoutMs ?? 5000;
  const waiting = new Map<string, (replied: boolean) => void>();
  let exited = false;
  let counter = 0;

  link.onExit(() => {
    exited = true;
    for (const resolve of waiting.values()) resolve(false);
    waiting.clear();
  });
  link.onLine((line) => {
    try {
      const id = (JSON.parse(line) as { id?: unknown }).id;
      if (typeof id === "string") waiting.get(id)?.(true);
    } catch {
      // Not a reply line.
    }
  });

  return {
    async measure() {
      if (exited) return undefined;
      counter += 1;
      const id = `headroom-${counter}`;
      let cancel = () => {};
      const reply = new Promise<boolean>((resolve) => {
        waiting.set(id, resolve);
        cancel = clock.after(timeoutMs, () => resolve(false));
      });
      const started = clock.now();
      try {
        link.send(JSON.stringify({ id, op: options.op, args: {} }));
      } catch {
        cancel();
        waiting.delete(id);
        return undefined;
      }
      const replied = await reply;
      cancel();
      waiting.delete(id);
      return replied ? clock.now() - started : undefined;
    },
    close: () => link.close(),
  };
}

/** A real child process as a link: lines out to its stdin, lines in from its stdout. */
export function spawnLink(command: readonly string[]): RoundTripLink {
  const child = Bun.spawn([...command], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  return {
    send(line) {
      child.stdin.write(`${line}\n`);
      void child.stdin.flush();
    },
    onLine(handler) {
      void (async () => {
        const decoder = new TextDecoder();
        let buffered = "";
        for await (const chunk of child.stdout) {
          buffered += decoder.decode(chunk, { stream: true });
          for (
            let end = buffered.indexOf("\n");
            end !== -1;
            end = buffered.indexOf("\n")
          ) {
            handler(buffered.slice(0, end));
            buffered = buffered.slice(end + 1);
          }
        }
      })();
    },
    onExit(handler) {
      void child.exited.then(handler);
    },
    close() {
      try {
        child.stdin.end();
      } catch {
        // Already closed.
      }
      child.kill();
    },
  };
}

/**
 * Samples every `intervalMs` until `stopped()` or `durationMs` (0 for no limit)
 * has passed, calling `onSample` with each. Every tick reads the process table
 * again through `run`, so a worker that was restarted is sampled as its new pid
 * and labelled with it. Chained waits, not an interval: a slow tick never
 * queues the next one behind it.
 */
export async function sampleLoop(options: {
  readonly run: RunCommand;
  readonly diskPath: string;
  readonly intervalMs: number;
  readonly durationMs: number;
  readonly clock: Clock;
  readonly stopped: () => boolean;
  readonly probe?: RoundTripProbe | undefined;
  readonly onSample: (sample: HeadroomSample) => void;
}): Promise<HeadroomSample[]> {
  const { clock } = options;
  const samples: HeadroomSample[] = [];
  const started = clock.now();
  while (
    !options.stopped() &&
    (options.durationMs === 0 || clock.now() - started < options.durationMs)
  ) {
    const tickStart = clock.now();
    const base = sampleHeadroom(options.run, {
      diskPath: options.diskPath,
      atMs: tickStart - started,
    });
    const sample: HeadroomSample =
      options.probe === undefined
        ? base
        : { ...base, roundTripMs: (await options.probe.measure()) ?? null };
    samples.push(sample);
    options.onSample(sample);
    const wait = options.intervalMs - (clock.now() - tickStart);
    if (wait > 0) await clock.sleep(wait);
  }
  return samples;
}

function runCommandSync(command: readonly string[]): string | undefined {
  try {
    const result = Bun.spawnSync([...command]);
    if (result.exitCode !== 0) return undefined;
    const output = result.stdout.toString();
    return output.length > 0 ? output : undefined;
  } catch {
    return undefined;
  }
}

function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

/** Samples until `--duration-s` or a signal, then writes `summary.json` and returns it. */
export async function main(argv: readonly string[]): Promise<HeadroomSummary> {
  const out = flag(argv, "--out");
  if (out === undefined) throw new Error("--out <dir> is required");
  const intervalMs = Number(flag(argv, "--interval-ms") ?? 2000);
  const durationMs = Number(flag(argv, "--duration-s") ?? 0) * 1000;
  const diskPath = flag(argv, "--disk-path") ?? process.cwd();
  const sidecar = flag(argv, "--roundtrip-sidecar");
  const config = flag(argv, "--roundtrip-config");
  mkdirSync(out, { recursive: true });
  const seriesPath = join(out, "samples.jsonl");
  writeFileSync(seriesPath, "");

  const probe =
    sidecar !== undefined && config !== undefined
      ? createRoundTripProbe({
          link: spawnLink([sidecar, "session", "--config", config]),
          op: "status",
        })
      : undefined;
  let stop = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      stop = true;
    });

  const samples = await sampleLoop({
    run: runCommandSync,
    diskPath,
    intervalMs,
    durationMs,
    clock: systemClock,
    stopped: () => stop,
    probe,
    onSample: (sample) =>
      appendFileSync(seriesPath, `${JSON.stringify(sample)}\n`),
  });
  probe?.close();
  const summary = summarize(samples);
  writeFileSync(
    join(out, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  return summary;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (summary) => {
      console.log(JSON.stringify(summary, null, 2));
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}

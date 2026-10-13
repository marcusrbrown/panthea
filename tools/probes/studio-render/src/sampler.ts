// Memory sampler for the studio-render probe. Everything time-dependent comes
// in as a parameter: the clock (`Clock`) and the command runner (`RunCommand`),
// so a test drives it with a fake clock and canned command output, and the
// probe never asserts on wall-clock time. Each tick reads, per tracked process,
// phys_footprint (`footprint -p`) and RSS (`ps`), plus the kernel's memory
// pressure level, swap and free pages.
//
// A tick-sampled peak can miss a spike between ticks. `lifetimeMaxFootprintMiB`
// reads the kernel's own lifetime peak (proc_pid_rusage, flavor 4) for a live
// pid, which does not depend on the tick.

import {
  pagesToMiB,
  parseSwapUsage,
  parseVmStat,
  type RunCommand,
  readRssKb,
} from "../../coexistence/src/sample";
import {
  type Clock,
  type Pressure,
  parseFootprintMiB,
  parsePressureLevel,
} from "../../studio-headroom/src/run";

export interface Target {
  readonly label: string;
  readonly pid: number;
}

export interface ProcReading {
  readonly label: string;
  readonly pid: number;
  readonly footprintMiB?: number;
  readonly rssMiB?: number;
}

export interface Tick {
  readonly atMs: number;
  readonly processes: readonly ProcReading[];
  /** Sum of the phys_footprint of every tracked process that could be read this tick. */
  readonly sumFootprintMiB: number;
  readonly pressure?: Pressure;
  readonly pressureLevel?: number;
  readonly swapUsedMiB?: number;
  readonly swapFreeMiB?: number;
  readonly vmFreeMiB?: number;
}

export function takeTick(
  run: RunCommand,
  targets: readonly Target[],
  atMs: number,
): Tick {
  const processes: ProcReading[] = [];
  for (const target of targets) {
    const rssKb = readRssKb(target.pid, run);
    const text = run(["footprint", "-p", String(target.pid)]);
    const footprintMiB =
      text === undefined ? undefined : parseFootprintMiB(text);
    if (rssKb === undefined && footprintMiB === undefined) continue;
    processes.push({
      label: target.label,
      pid: target.pid,
      ...(footprintMiB === undefined ? {} : { footprintMiB }),
      ...(rssKb === undefined ? {} : { rssMiB: rssKb / 1024 }),
    });
  }
  const pressureText = run([
    "sysctl",
    "-n",
    "kern.memorystatus_vm_pressure_level",
  ]);
  const pressure =
    pressureText === undefined ? undefined : parsePressureLevel(pressureText);
  const swapText = run(["sysctl", "vm.swapusage"]);
  const swap = swapText === undefined ? undefined : parseSwapUsage(swapText);
  const vmText = run(["vm_stat"]);
  const vm = vmText === undefined ? undefined : parseVmStat(vmText);
  return {
    atMs,
    processes,
    sumFootprintMiB: processes.reduce((s, p) => s + (p.footprintMiB ?? 0), 0),
    ...(pressure === undefined
      ? {}
      : { pressure: pressure.name, pressureLevel: pressure.level }),
    ...(swap === undefined
      ? {}
      : { swapUsedMiB: swap.usedMiB, swapFreeMiB: swap.freeMiB }),
    ...(vm === undefined
      ? {}
      : { vmFreeMiB: pagesToMiB(vm.freePages, vm.pageSizeBytes) }),
  };
}

/**
 * Ticks every `intervalMs` until `stop()` is true. `targets` is read again
 * every tick (a restarted process has a new pid). `onTick` sees each tick as it
 * is taken, so a caller can react to a critical reading at once. Chained waits,
 * so a slow `footprint` never queues the next tick behind it, and a wait of
 * zero when sampling has fallen behind (the loop always yields); the achieved
 * spacing is in the ticks' `atMs`.
 */
export async function sampleLoop(options: {
  readonly run: RunCommand;
  readonly clock: Clock;
  readonly intervalMs: number;
  readonly targets: () => readonly Target[];
  readonly stop: () => boolean;
  readonly onTick?: (tick: Tick) => void;
}): Promise<Tick[]> {
  const { clock } = options;
  const ticks: Tick[] = [];
  const started = clock.now();
  while (!options.stop()) {
    const tickStart = clock.now();
    const tick = takeTick(options.run, options.targets(), tickStart - started);
    ticks.push(tick);
    options.onTick?.(tick);
    // Always yield, even when this tick already overran the interval: a loop that
    // never awaits starves the event loop, and a child's `close` event is never handled.
    await clock.sleep(
      Math.max(0, options.intervalMs - (clock.now() - tickStart)),
    );
  }
  return ticks;
}

export interface PhaseSummary {
  readonly ticks: number;
  readonly medianSpacingMs: number | undefined;
  readonly peakSumFootprintMiB: number;
  readonly peakFootprintMiBByLabel: Readonly<Record<string, number>>;
  readonly peakRssMiBByLabel: Readonly<Record<string, number>>;
  readonly maxPressureLevel: number | undefined;
  readonly sawCritical: boolean;
  readonly sawWarn: boolean;
  readonly swapUsedMinMiB: number | undefined;
  readonly swapUsedMaxMiB: number | undefined;
  readonly vmFreeMinMiB: number | undefined;
}

const maxOf = (values: readonly number[]): number | undefined =>
  values.length === 0 ? undefined : Math.max(...values);
const minOf = (values: readonly number[]): number | undefined =>
  values.length === 0 ? undefined : Math.min(...values);

export function summarise(ticks: readonly Tick[]): PhaseSummary {
  const peakFootprint: Record<string, number> = {};
  const peakRss: Record<string, number> = {};
  for (const tick of ticks) {
    for (const p of tick.processes) {
      if (p.footprintMiB !== undefined)
        peakFootprint[p.label] = Math.max(
          peakFootprint[p.label] ?? 0,
          p.footprintMiB,
        );
      if (p.rssMiB !== undefined)
        peakRss[p.label] = Math.max(peakRss[p.label] ?? 0, p.rssMiB);
    }
  }
  const levels = ticks.flatMap((t) =>
    t.pressureLevel === undefined ? [] : [t.pressureLevel],
  );
  const swap = ticks.flatMap((t) =>
    t.swapUsedMiB === undefined ? [] : [t.swapUsedMiB],
  );
  const free = ticks.flatMap((t) =>
    t.vmFreeMiB === undefined ? [] : [t.vmFreeMiB],
  );
  const gaps = ticks
    .slice(1)
    .map((t, i) => t.atMs - (ticks[i] as Tick).atMs)
    .sort((a, b) => a - b);
  return {
    ticks: ticks.length,
    medianSpacingMs:
      gaps.length === 0 ? undefined : gaps[Math.floor(gaps.length / 2)],
    peakSumFootprintMiB: Math.max(0, ...ticks.map((t) => t.sumFootprintMiB)),
    peakFootprintMiBByLabel: peakFootprint,
    peakRssMiBByLabel: peakRss,
    maxPressureLevel: maxOf(levels),
    sawCritical: levels.some((level) => level >= 4),
    sawWarn: levels.some((level) => level >= 2),
    swapUsedMinMiB: minOf(swap),
    swapUsedMaxMiB: maxOf(swap),
    vmFreeMinMiB: minOf(free),
  };
}

/**
 * The kernel's lifetime peak phys_footprint for a live pid, in MiB, and its
 * current phys_footprint, through proc_pid_rusage flavor RUSAGE_INFO_V4
 * (`ri_phys_footprint`, `ri_lifetime_max_phys_footprint`). Undefined when the
 * pid is gone or the call is unavailable.
 */
export async function lifetimeFootprintMiB(
  pid: number,
): Promise<
  { readonly currentMiB: number; readonly lifetimeMaxMiB: number } | undefined
> {
  try {
    const { dlopen, FFIType, ptr } = await import("bun:ffi");
    const lib = dlopen("/usr/lib/libSystem.B.dylib", {
      proc_pid_rusage: {
        args: [FFIType.i32, FFIType.i32, FFIType.ptr],
        returns: FFIType.i32,
      },
    });
    const buffer = new BigUint64Array(64);
    const status = lib.symbols.proc_pid_rusage(pid, 4, ptr(buffer));
    lib.close();
    if (status !== 0) return undefined;
    const MiB = 1024 * 1024;
    // rusage_info_v4 as u64 words: words 0-1 are the uuid; ri_phys_footprint is word 9 and ri_lifetime_max_phys_footprint word 30.
    return {
      currentMiB: Number(buffer[9] as bigint) / MiB,
      lifetimeMaxMiB: Number(buffer[30] as bigint) / MiB,
    };
  } catch {
    return undefined;
  }
}

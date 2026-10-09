import { expect, test } from "bun:test";
import {
  createMemorySampler,
  FULL_RUN_MINUTES,
  findOllamaServePid,
  LEVELLING_OFF_PERCENT_PER_10_MIN,
  MAX_SETTLED_GROWTH_PERCENT,
  type MemorySample,
  SETTLE_AFTER_CATCH_UP_MS,
  SETTLED_FLOOR_MS,
  type SettleOptions,
  summarizeMemory,
  TREND_WINDOW_MS,
  takeMemorySample,
} from "./memory";

const MIB = 1024 * 1024;
const SUPERVISOR = 100;
const SIDECAR = 200;

interface FakeProcess {
  readonly parent: number;
  readonly command: string;
  readonly rssKb: number;
  /** What `footprint` reports for it, in bytes; absent when the tool cannot read the process. */
  readonly footprintBytes?: number;
}

/** A process table and swap line the sampler reads through `runCommand`, as `ps`, `pgrep` and `sysctl` would answer. */
function fakeMachine(
  processes: Map<number, FakeProcess>,
  swap:
    | string
    | null = "vm.swapusage: total = 14336.00M  used = 13913.69M  free = 422.31M  (encrypted)",
) {
  const commands: string[][] = [];
  const runCommand = (command: readonly string[]): string | undefined => {
    commands.push([...command]);
    const [executable, ...args] = command;
    if (executable === "sysctl") return swap ?? undefined;
    if (executable === "pgrep" && args[0] === "-P") {
      const children = [...processes]
        .filter(([, process]) => process.parent === Number(args[1]))
        .map(([pid]) => pid);
      return children.length > 0 ? `${children.join("\n")}\n` : undefined;
    }
    if (executable === "pgrep" && args[0] === "-f") {
      const serving = [...processes]
        .filter(([, process]) =>
          new RegExp(args[1] ?? "").test(process.command),
        )
        .map(([pid]) => pid);
      return serving.length > 0 ? `${serving.join("\n")}\n` : undefined;
    }
    if (executable === "footprint") {
      const process = processes.get(Number(args[args.indexOf("-p") + 1]));
      if (process?.footprintBytes === undefined) return undefined;
      return [
        "======================================================================",
        `${process.command.split(" ")[0]} [${args[args.indexOf("-p") + 1]}]: 64-bit    Footprint: ${process.footprintBytes} B (16384 bytes per page)`,
        "======================================================================",
        "",
        "Auxiliary data:",
        `    phys_footprint: ${process.footprintBytes + 16384} B`,
        "    phys_footprint_peak: 999999999999 B",
        "",
      ].join("\n");
    }
    if (executable === "ps") {
      const process = processes.get(Number(args[args.length - 1]));
      if (process === undefined) return undefined;
      return args.includes("rss=")
        ? ` ${process.rssKb}\n`
        : `${process.command}\n`;
    }
    return undefined;
  };
  return { runCommand, commands };
}

const supervisor = (): FakeProcess => ({
  parent: 1,
  command: "/opt/homebrew/bin/ollama serve",
  rssKb: 80 * 1024,
});
const runner = (rssMiB: number): FakeProcess => ({
  parent: SUPERVISOR,
  command:
    "/opt/homebrew/bin/ollama runner --model /Users/someone/.ollama/models/blobs/sha256-abc --port 5555",
  rssKb: rssMiB * 1024,
});
const sidecar = (rssMiB: number): FakeProcess => ({
  parent: 1,
  command: "/tmp/run/panthea-sidecar --data-dir /tmp/run/data",
  rssKb: rssMiB * 1024,
});

function sample(
  runnerMiB: number | undefined,
  sidecarMiB: number | undefined,
  atMs: number,
  options: {
    sidecarPid?: number;
    swapUsedMiB?: number;
    /** The sidecar's physical footprint in MiB; unread when omitted. */
    footprintMiB?: number;
    runnerFootprintMiB?: number;
  } = {},
): MemorySample {
  return {
    atMs,
    runner:
      runnerMiB === undefined
        ? { state: "absent" }
        : {
            state: "present",
            pids: [300],
            rssBytes: runnerMiB * MIB,
            footprintBytes:
              options.runnerFootprintMiB === undefined
                ? undefined
                : options.runnerFootprintMiB * MIB,
          },
    sidecar:
      sidecarMiB === undefined
        ? { state: "absent" }
        : {
            state: "present",
            pid: options.sidecarPid ?? SIDECAR,
            rssBytes: sidecarMiB * MIB,
            footprintBytes:
              options.footprintMiB === undefined
                ? undefined
                : options.footprintMiB * MIB,
          },
    swap:
      options.swapUsedMiB === undefined
        ? undefined
        : { usedMiB: options.swapUsedMiB, totalMiB: 14336 },
  };
}

/** One sample every 10 s for `minutes`, the sidecar's RSS given by `rssAt(minute)`. */
function sidecarSeries(
  minutes: number,
  rssAt: (minute: number) => number,
  options: {
    sidecarPid?: number;
    footprintAt?: (minute: number) => number | undefined;
  } = {},
): MemorySample[] {
  const samples: MemorySample[] = [];
  for (let at = 0; at <= minutes * 60_000; at += 10_000) {
    const footprintMiB = options.footprintAt?.(at / 60_000);
    samples.push(
      sample(5000, rssAt(at / 60_000), at, {
        ...(options.sidecarPid === undefined
          ? {}
          : { sidecarPid: options.sidecarPid }),
        ...(footprintMiB === undefined ? {} : { footprintMiB }),
      }),
    );
  }
  return samples;
}

test("a runner child spawned by a reload is picked up on the next sample, with its own pid and RSS", () => {
  const processes = new Map<number, FakeProcess>([
    [SUPERVISOR, supervisor()],
    [300, runner(5400)],
    [SIDECAR, sidecar(300)],
  ]);
  const { runCommand } = fakeMachine(processes);
  const read = () =>
    takeMemorySample({
      ollamaPid: () => SUPERVISOR,
      sidecarPid: () => SIDECAR,
      runCommand,
      now: () => 1_000,
    });

  expect(read().runner).toEqual({
    state: "present",
    pids: [300],
    rssBytes: 5400 * MIB,
  });

  // Ollama unloads the model and loads it again: a new runner pid, a different size.
  processes.delete(300);
  processes.set(301, runner(5600));
  expect(read().runner).toEqual({
    state: "present",
    pids: [301],
    rssBytes: 5600 * MIB,
  });
});

test("with no runner present during an unload, the runner is absent: not 0 and not the supervisor's RSS", () => {
  const { runCommand } = fakeMachine(
    new Map([
      [SUPERVISOR, supervisor()],
      [SIDECAR, sidecar(300)],
    ]),
  );
  const taken = takeMemorySample({
    ollamaPid: () => SUPERVISOR,
    sidecarPid: () => SIDECAR,
    runCommand,
    now: () => 1_000,
  });
  expect(taken.runner).toEqual({ state: "absent" });
  expect(JSON.stringify(taken)).not.toContain(String(80 * 1024 * 1024));
});

test("several runner children are summed, each pid recorded", () => {
  const { runCommand } = fakeMachine(
    new Map([
      [SUPERVISOR, supervisor()],
      [300, runner(1000)],
      [301, runner(500)],
    ]),
  );
  const taken = takeMemorySample({
    ollamaPid: () => SUPERVISOR,
    sidecarPid: () => undefined,
    runCommand,
    now: () => 1_000,
  });
  expect(taken.runner).toEqual({
    state: "present",
    pids: [300, 301],
    rssBytes: 1500 * MIB,
  });
});

test("the sidecar's RSS is read by its pid; with no pid, or a pid that is gone, it is absent", () => {
  const { runCommand } = fakeMachine(
    new Map([
      [SUPERVISOR, supervisor()],
      [SIDECAR, sidecar(412)],
    ]),
  );
  const take = (pid: number | undefined) =>
    takeMemorySample({
      ollamaPid: () => SUPERVISOR,
      sidecarPid: () => pid,
      runCommand,
      now: () => 1_000,
    }).sidecar;
  expect(take(SIDECAR)).toEqual({
    state: "present",
    pid: SIDECAR,
    rssBytes: 412 * MIB,
  });
  expect(take(undefined)).toEqual({ state: "absent" });
  expect(take(999)).toEqual({ state: "absent" });
});

test("swap used and total come from sysctl vm.swapusage, and a failed read leaves them out", () => {
  const processes = new Map<number, FakeProcess>([[SUPERVISOR, supervisor()]]);
  const take = (swap: string | null) =>
    takeMemorySample({
      ollamaPid: () => SUPERVISOR,
      sidecarPid: () => undefined,
      runCommand: fakeMachine(processes, swap).runCommand,
      now: () => 1_000,
    });
  expect(take(null).swap).toBeUndefined();
  expect(take("vm.swapusage: unavailable").swap).toBeUndefined();
  expect(take(null).atMs).toBe(1_000);
  expect(
    take("vm.swapusage: total = 8192.00M  used = 7070.50M  free = 1121.50M")
      .swap,
  ).toEqual({ usedMiB: 7070.5, totalMiB: 8192 });
});

test("a sample holds pids and numbers only: no command line, path or flag the process table held reaches it", () => {
  const processes = new Map<number, FakeProcess>([
    [SUPERVISOR, supervisor()],
    [300, runner(5400)],
    [SIDECAR, sidecar(300)],
  ]);
  const taken = takeMemorySample({
    ollamaPid: () => SUPERVISOR,
    sidecarPid: () => SIDECAR,
    runCommand: fakeMachine(processes).runCommand,
    now: () => 1_000,
  });
  const text = JSON.stringify(taken);
  for (const process of processes.values()) {
    // The paths, flags and port the command lines carried.
    for (const word of process.command.split(" ")) {
      if (/^(\/|--|\d)/.test(word)) expect(text).not.toContain(word);
    }
  }
  expect(text).not.toContain("sha256");
  expect(text).not.toContain("--");
});

test("the supervisor is found by its command, not by a bare name match on a program that merely mentions it", () => {
  const processes = new Map<number, FakeProcess>([
    [SUPERVISOR, supervisor()],
    [777, { parent: 1, command: "/usr/bin/vim ollama serve notes", rssKb: 1 }],
  ]);
  expect(findOllamaServePid(fakeMachine(processes).runCommand)).toBe(
    SUPERVISOR,
  );
  expect(findOllamaServePid(fakeMachine(new Map()).runCommand)).toBeUndefined();
});

test("a flat sidecar series is levelling off, and a steadily rising one is not", () => {
  const flat = summarizeMemory(sidecarSeries(40, () => 800));
  expect(flat.sidecarTrend).toMatchObject({
    judgeable: true,
    levellingOff: true,
  });
  if (!flat.sidecarTrend.judgeable) throw new Error("expected a judgement");
  expect(Math.abs(flat.sidecarTrend.percentPer10Min)).toBeLessThan(
    LEVELLING_OFF_PERCENT_PER_10_MIN,
  );

  // 2 MiB a minute on about 800 MiB: 20 MiB per 10 minutes, about 2.5% of the mean.
  const rising = summarizeMemory(
    sidecarSeries(40, (minute) => 800 + 2 * minute),
  );
  expect(rising.sidecarTrend).toMatchObject({
    judgeable: true,
    levellingOff: false,
  });
  if (!rising.sidecarTrend.judgeable) throw new Error("expected a judgement");
  expect(rising.sidecarTrend.percentPer10Min).toBeGreaterThan(
    LEVELLING_OFF_PERCENT_PER_10_MIN,
  );
});

test("only the last 20 minutes decide: an early climb that has levelled off passes, a late climb fails", () => {
  const climbedThenFlat = summarizeMemory(
    sidecarSeries(60, (minute) => (minute < 30 ? 400 + 20 * minute : 1000)),
  );
  expect(climbedThenFlat.sidecarTrend).toMatchObject({
    judgeable: true,
    levellingOff: true,
  });
  const flatThenClimbing = summarizeMemory(
    sidecarSeries(60, (minute) =>
      minute < 40 ? 800 : 800 + 10 * (minute - 40),
    ),
  );
  expect(flatThenClimbing.sidecarTrend).toMatchObject({
    judgeable: true,
    levellingOff: false,
  });
});

test("a falling series is not rising, so it is levelling off", () => {
  const falling = summarizeMemory(
    sidecarSeries(40, (minute) => 900 - 3 * minute),
  );
  expect(falling.sidecarTrend).toMatchObject({
    judgeable: true,
    levellingOff: true,
  });
  if (!falling.sidecarTrend.judgeable) throw new Error("expected a judgement");
  expect(falling.sidecarTrend.percentPer10Min).toBeLessThan(0);
});

test("a series shorter than the 20-minute window is reported as not judgeable, not as a pass", () => {
  const short = summarizeMemory(sidecarSeries(19, () => 800));
  expect(short.sidecarTrend.judgeable).toBe(false);
  if (short.sidecarTrend.judgeable) throw new Error("expected not judgeable");
  expect(short.sidecarTrend.reason).toContain("20");
  expect(summarizeMemory([]).sidecarTrend.judgeable).toBe(false);
  // Exactly the window is enough.
  expect(
    summarizeMemory(sidecarSeries(TREND_WINDOW_MS / 60_000, () => 800))
      .sidecarTrend.judgeable,
  ).toBe(true);
});

test("a sidecar that restarted inside the window is not judged on a slope across two processes", () => {
  const samples = [...sidecarSeries(25, () => 900, { sidecarPid: 200 })];
  const afterRestart = sidecarSeries(10, () => 300, { sidecarPid: 201 }).map(
    (taken) => ({ ...taken, atMs: taken.atMs + 25 * 60_000 + 10_000 }),
  );
  const summary = summarizeMemory([...samples, ...afterRestart]);
  expect(summary.sidecarTrend.judgeable).toBe(false);
  if (summary.sidecarTrend.judgeable) throw new Error("expected not judgeable");
  expect(summary.sidecarTrend.reason).toContain("restart");
});

test("start, peak and end are summarised for each series, and absent samples are counted rather than read as 0", () => {
  const summary = summarizeMemory([
    sample(undefined, 300, 0, { swapUsedMiB: 7000 }),
    sample(5400, 350, 10_000, { swapUsedMiB: 9000 }),
    sample(5600, 420, 20_000, { swapUsedMiB: 10_500 }),
    sample(undefined, 410, 30_000, { swapUsedMiB: 10_300 }),
  ]);
  expect(summary.runner).toEqual({
    start: 5400 * MIB,
    peak: 5600 * MIB,
    end: 5600 * MIB,
    present: 2,
    absent: 2,
  });
  expect(summary.sidecar).toEqual({
    start: 300 * MIB,
    peak: 420 * MIB,
    end: 410 * MIB,
    present: 4,
    absent: 0,
  });
  expect(summary.swapUsedMiB).toEqual({
    start: 7000,
    peak: 10_500,
    end: 10_300,
    present: 4,
    absent: 0,
  });
  expect(summary.samples).toBe(4);
  expect(summary.spanMs).toBe(30_000);
});

test("a series that was never present has no start, peak or end, and the summary of nothing is empty", () => {
  const summary = summarizeMemory([sample(undefined, undefined, 0)]);
  expect(summary.runner).toEqual({
    start: undefined,
    peak: undefined,
    end: undefined,
    present: 0,
    absent: 1,
  });
  expect(summarizeMemory([]).samples).toBe(0);
  expect(summarizeMemory([]).runner.present).toBe(0);
});

test("the sampler takes one sample as it starts, then one each interval, re-resolving the runner every time", async () => {
  const processes = new Map<number, FakeProcess>([
    [SUPERVISOR, supervisor()],
    [300, runner(5400)],
  ]);
  const { runCommand, commands } = fakeMachine(processes);
  const sampler = createMemorySampler({
    intervalMs: 5,
    ollamaPid: () => SUPERVISOR,
    sidecarPid: () => undefined,
    runCommand,
  });
  sampler.start();
  expect(sampler.peek()?.runner).toMatchObject({ state: "present" });
  processes.delete(300);
  processes.set(301, runner(5600));
  await Bun.sleep(40);
  const samples = sampler.stop();
  expect(samples.length).toBeGreaterThan(2);
  expect(samples[0]?.runner).toMatchObject({ pids: [300] });
  expect(samples[samples.length - 1]?.runner).toMatchObject({ pids: [301] });
  // Each sample listed the supervisor's children afresh.
  expect(
    commands.filter((command) => command[0] === "pgrep" && command[1] === "-P")
      .length,
  ).toBe(samples.length);
  // Stopping stops it.
  const count = samples.length;
  await Bun.sleep(20);
  expect(sampler.stop().length).toBe(count);
});

// --- Physical footprint ---------------------------------------------------------------------------
//
// RSS counts pages the allocator has freed but the kernel has not taken back, so it climbs under allocation churn while
// the memory the process really holds stays flat. The footprint (`footprint -p`, the figure Activity Monitor shows) does
// not count them, so the levelling-off verdict is read on it, with RSS kept beside it.

test("a sample records the sidecar's and the runner's physical footprint by pid, read as phys_footprint through footprint -p", () => {
  const processes = new Map<number, FakeProcess>([
    [SUPERVISOR, supervisor()],
    [300, { ...runner(5400), footprintBytes: 4_900 * MIB }],
    [SIDECAR, { ...sidecar(412), footprintBytes: 78 * MIB }],
  ]);
  const { runCommand, commands } = fakeMachine(processes);
  const taken = takeMemorySample({
    ollamaPid: () => SUPERVISOR,
    sidecarPid: () => SIDECAR,
    runCommand,
    now: () => 1_000,
  });
  // The fake adds 16,384 bytes to phys_footprint, so reading another line of the output would be caught.
  expect(taken.sidecar).toMatchObject({
    state: "present",
    rssBytes: 412 * MIB,
    footprintBytes: 78 * MIB + 16_384,
  });
  expect(taken.runner).toMatchObject({
    state: "present",
    rssBytes: 5400 * MIB,
    footprintBytes: 4_900 * MIB + 16_384,
  });
  expect(commands).toContainEqual([
    "footprint",
    "-p",
    String(SIDECAR),
    "-f",
    "bytes",
    "--noCategories",
  ]);
});

test("a footprint the tool cannot read is unread, not 0: the process is still present with its RSS", () => {
  const { runCommand } = fakeMachine(
    new Map([
      [SUPERVISOR, supervisor()],
      [300, runner(5400)],
      [SIDECAR, sidecar(412)],
    ]),
  );
  const taken = takeMemorySample({
    ollamaPid: () => SUPERVISOR,
    sidecarPid: () => SIDECAR,
    runCommand,
    now: () => 1_000,
  });
  expect(taken.sidecar).toMatchObject({
    state: "present",
    rssBytes: 412 * MIB,
  });
  expect(
    (taken.sidecar as { footprintBytes?: number }).footprintBytes,
  ).toBeUndefined();
  expect(
    (taken.runner as { footprintBytes?: number }).footprintBytes,
  ).toBeUndefined();
});

test("a runner with several children has a footprint only when every child's could be read", () => {
  const { runCommand } = fakeMachine(
    new Map([
      [SUPERVISOR, supervisor()],
      [300, { ...runner(1000), footprintBytes: 900 * MIB }],
      [301, runner(500)],
    ]),
  );
  const taken = takeMemorySample({
    ollamaPid: () => SUPERVISOR,
    sidecarPid: () => undefined,
    runCommand,
    now: () => 1_000,
  });
  expect(taken.runner).toMatchObject({
    state: "present",
    rssBytes: 1500 * MIB,
  });
  expect(
    (taken.runner as { footprintBytes?: number }).footprintBytes,
  ).toBeUndefined();
});

test("a flat footprint with a rising RSS is levelling off, and the RSS trend is still reported beside it", () => {
  const summary = summarizeMemory(
    sidecarSeries(40, (minute) => 100 + 4 * minute, {
      footprintAt: () => 78,
    }),
  );
  expect(summary.footprintTrend).toMatchObject({
    judgeable: true,
    levellingOff: true,
  });
  if (!summary.footprintTrend.judgeable)
    throw new Error("expected a judgement");
  expect(Math.abs(summary.footprintTrend.percentPer10Min)).toBeLessThan(
    LEVELLING_OFF_PERCENT_PER_10_MIN,
  );
  // RSS rises 4 MiB a minute on about 160 MiB: 40 MiB per 10 minutes, a quarter of the mean.
  expect(summary.sidecarTrend).toMatchObject({
    judgeable: true,
    levellingOff: false,
  });
});

test("a steadily rising footprint is not levelling off, whatever RSS does", () => {
  const summary = summarizeMemory(
    sidecarSeries(40, () => 400, {
      footprintAt: (minute) => 80 + 1.5 * minute,
    }),
  );
  expect(summary.footprintTrend).toMatchObject({
    judgeable: true,
    levellingOff: false,
  });
  expect(summary.sidecarTrend).toMatchObject({ levellingOff: true });
});

test("a footprint missing inside the 20-minute window is not judgeable, and so is a series with none at all", () => {
  const gap = summarizeMemory(
    sidecarSeries(40, () => 400, {
      footprintAt: (minute) => (minute > 30 && minute < 31 ? undefined : 80),
    }),
  );
  expect(gap.footprintTrend.judgeable).toBe(false);
  if (gap.footprintTrend.judgeable) throw new Error("expected not judgeable");
  expect(gap.footprintTrend.reason).toContain("footprint");
  expect(gap.footprintTrend.reason).toContain("not read");

  // Samples taken before footprints were recorded, or on a machine without the tool.
  const none = summarizeMemory(sidecarSeries(40, () => 400));
  expect(none.footprintTrend.judgeable).toBe(false);
  // A gap before the window does not matter.
  const early = summarizeMemory(
    sidecarSeries(40, () => 400, {
      footprintAt: (minute) => (minute < 5 ? undefined : 80),
    }),
  );
  expect(early.footprintTrend.judgeable).toBe(true);
});

test("a footprint series too short for the window is not judgeable, and one across a sidecar restart is not either", () => {
  expect(
    summarizeMemory(sidecarSeries(19, () => 400, { footprintAt: () => 80 }))
      .footprintTrend.judgeable,
  ).toBe(false);
  const before = sidecarSeries(25, () => 400, {
    sidecarPid: 200,
    footprintAt: () => 80,
  });
  const after = sidecarSeries(10, () => 400, {
    sidecarPid: 201,
    footprintAt: () => 80,
  }).map((taken) => ({ ...taken, atMs: taken.atMs + 25 * 60_000 + 10_000 }));
  const restarted = summarizeMemory([...before, ...after]).footprintTrend;
  expect(restarted.judgeable).toBe(false);
  if (restarted.judgeable) throw new Error("expected not judgeable");
  expect(restarted.reason).toContain("restart");
});

test("the summary gives start, peak and end for the sidecar's and the runner's footprint, and counts the samples where it was unread", () => {
  const summary = summarizeMemory([
    sample(5000, 300, 0, { footprintMiB: 70, runnerFootprintMiB: 4800 }),
    sample(5000, 350, 10_000, { footprintMiB: 90, runnerFootprintMiB: 4900 }),
    sample(5000, 400, 20_000),
    sample(5000, 380, 30_000, { footprintMiB: 80, runnerFootprintMiB: 4850 }),
  ]);
  expect(summary.sidecarFootprint).toEqual({
    start: 70 * MIB,
    peak: 90 * MIB,
    end: 80 * MIB,
    present: 3,
    absent: 1,
  });
  expect(summary.runnerFootprint).toMatchObject({
    start: 4800 * MIB,
    peak: 4900 * MIB,
    end: 4850 * MIB,
    present: 3,
    absent: 1,
  });
});

// --- Growth across the settled span ------------------------------------------------------------------
//
// The memory row compares the mean footprint of the second half of the settled span with the first half's. The settled
// span starts 15 minutes after the last catch-up finishes and ends with the last sample; a window slope read
// -1.65% to +4.34% per 10 minutes over one real hour depending on where the window sat, which is noise in a footprint
// that swings by ±10 MiB.

const MINUTE_MS = 60_000;
const settleAt = (catchUpMinute: number, runMinutes = 60): SettleOptions => ({
  catchUpFinishedMs: catchUpMinute * MINUTE_MS,
  runMinutes,
});
/** A series of `minutes` whose sidecar footprint, in MiB, is `footprintAt(minute)`. */
const footprints = (
  minutes: number,
  footprintAt: (minute: number) => number | undefined,
  options: { sidecarPid?: number } = {},
) => sidecarSeries(minutes, () => 400, { ...options, footprintAt });

function judged(samples: MemorySample[], settle: SettleOptions | undefined) {
  const { settledGrowth } = summarizeMemory(samples, settle);
  if (!settledGrowth.judgeable) {
    throw new Error(`expected a judgement: ${settledGrowth.reason}`);
  }
  return settledGrowth;
}
function unjudged(samples: MemorySample[], settle: SettleOptions | undefined) {
  const { settledGrowth } = summarizeMemory(samples, settle);
  if (settledGrowth.judgeable) throw new Error("expected not judgeable");
  return settledGrowth.reason;
}

test("the constants: a fifteen-minute settle, a twenty-minute floor, ten percent, for a run of sixty minutes", () => {
  expect(SETTLE_AFTER_CATCH_UP_MS).toBe(15 * MINUTE_MS);
  expect(SETTLED_FLOOR_MS).toBe(20 * MINUTE_MS);
  expect(MAX_SETTLED_GROWTH_PERCENT).toBe(10);
  expect(FULL_RUN_MINUTES).toBe(60);
});

test("drift with flat halves passes: a footprint ramping 4 MiB per 10 minutes through the last 20 fails the slope but grows under 10% across the halves", () => {
  // Catch-up done at minute 23; the settled span is minutes 38 to 60. The footprint is flat to minute 40, then
  // ramps 118 to 126 MiB, which is 3.3% of the mean per 10 minutes.
  const samples = footprints(60, (minute) =>
    minute < 40 ? 118 : 118 + 0.4 * (minute - 40),
  );
  const summary = summarizeMemory(samples, settleAt(23));
  // The old test: the last 20 minutes' slope is over the 1% limit, so it would have failed the run.
  expect(summary.footprintTrend).toMatchObject({
    judgeable: true,
    levellingOff: false,
  });
  if (!summary.footprintTrend.judgeable) throw new Error("expected a slope");
  expect(summary.footprintTrend.percentPer10Min).toBeGreaterThan(
    LEVELLING_OFF_PERCENT_PER_10_MIN,
  );
  // The new one: the halves' means differ by under 10%.
  const growth = judged(samples, settleAt(23));
  expect(growth.growthPercent).toBeGreaterThan(0);
  expect(growth.growthPercent).toBeLessThan(MAX_SETTLED_GROWTH_PERCENT);
  expect(growth.withinLimit).toBe(true);
});

test("real growth fails: a second half more than 10% over the first, and the figure is the means' ratio", () => {
  const samples = footprints(60, (minute) => (minute < 49 ? 100 : 125));
  const growth = judged(samples, settleAt(23));
  // The settled span is minutes 38 to 60, split at 49: 100 MiB over 11 minutes, then 125 MiB.
  expect(growth.firstHalfMeanBytes / MIB).toBeCloseTo(100, 6);
  expect(growth.secondHalfMeanBytes / MIB).toBeCloseTo(125, 6);
  expect(growth.growthPercent).toBeCloseTo(25, 6);
  expect(growth.withinLimit).toBe(false);
});

test("the limit is 'more than 10%': 9.9% passes, 10.5% fails, and a falling footprint passes", () => {
  const at = (second: number) =>
    judged(
      footprints(60, (minute) => (minute < 49 ? 100 : second)),
      settleAt(23),
    );
  expect(at(109.9).withinLimit).toBe(true);
  expect(at(110.5).withinLimit).toBe(false);
  const falling = at(60);
  expect(falling.growthPercent).toBeCloseTo(-40, 6);
  expect(falling.withinLimit).toBe(true);
});

test("exactly +10% passes: the limit is decided on the means, not on a percentage that float error moves to 10.000000000000009", () => {
  // Fro Bot's shape: 10-second samples, catch-up at minute 23, 100 MiB before minute 49 and 110 MiB from it.
  const samples = footprints(60, (minute) => (minute < 49 ? 100 : 110));
  const growth = judged(samples, settleAt(23));
  expect(growth.firstHalfMeanBytes).toBe(100 * MIB);
  expect(growth.secondHalfMeanBytes).toBe(110 * MIB);
  expect(growth.withinLimit).toBe(true);
  // The percentage is for display, and it is what float error moves.
  expect(growth.growthPercent).toBeCloseTo(10, 9);
  // A byte over the boundary fails.
  const over = judged(
    footprints(60, (minute) => (minute < 49 ? 100 : 110.0001)),
    settleAt(23),
  );
  expect(over.withinLimit).toBe(false);
});

test("a burst in the first fifteen minutes after the catch-up is not in the settled span", () => {
  // 300 MiB in the 15 minutes after the catch-up, 100 MiB after: judged on the 100.
  const samples = footprints(60, (minute) =>
    minute >= 23 && minute < 38 ? 300 : 100,
  );
  const growth = judged(samples, settleAt(23));
  expect(growth.firstHalfMeanBytes / MIB).toBeCloseTo(100, 6);
  expect(growth.growthPercent).toBeCloseTo(0, 6);
  expect(growth.settledFromMs).toBe((23 + 15) * MINUTE_MS);
  expect(growth.settledMs).toBe(22 * MINUTE_MS);
});

test("the settled span is the later part of the run: samples before it, even rising ones, do not count", () => {
  const samples = footprints(60, (minute) =>
    minute < 38 ? 50 + 3 * minute : 200,
  );
  const growth = judged(samples, settleAt(23));
  expect(growth.growthPercent).toBeCloseTo(0, 6);
  expect(growth.withinLimit).toBe(true);
});

test("a settled span under the floor is not judgeable, not a pass; exactly the floor is judged", () => {
  // Catch-up at minute 30: the settled span is 45 to 60, 15 minutes.
  const reason = unjudged(
    footprints(60, () => 100),
    settleAt(30),
  );
  expect(reason).toContain("15");
  expect(reason).toContain("20");
  // Catch-up at minute 25: 40 to 60 is exactly 20 minutes.
  expect(
    judged(
      footprints(60, () => 100),
      settleAt(25),
    ).settledMs,
  ).toBe(20 * MINUTE_MS);
  // Just under it.
  expect(
    summarizeMemory(
      footprints(59.5, () => 100),
      settleAt(25),
    ).settledGrowth.judgeable,
  ).toBe(false);
});

test("no catch-up time, no samples, or a catch-up after the last sample are not judgeable", () => {
  expect(
    unjudged(
      footprints(60, () => 100),
      { catchUpFinishedMs: undefined, runMinutes: 60 },
    ),
  ).toContain("catch-up");
  expect(
    unjudged(
      footprints(60, () => 100),
      undefined,
    ),
  ).toContain("catch-up");
  expect(unjudged([], settleAt(23))).toContain("no samples");
  expect(
    unjudged(
      footprints(60, () => 100),
      settleAt(70),
    ),
  ).toContain("catch-up");
});

test("a run scaled down scales both the fifteen-minute drop and the twenty-minute floor", () => {
  // A six-minute run is a tenth of the gate: drop 1.5 minutes, floor 2 minutes. Catch-up done at minute 2.3.
  const samples = footprints(6, (minute) =>
    minute >= 2.3 && minute < 3.8 ? 300 : 100,
  );
  const growth = judged(samples, settleAt(2.3, 6));
  expect(growth.settledFromMs).toBeCloseTo(3.8 * MINUTE_MS, 3);
  expect(growth.settledMs).toBeCloseTo(2.2 * MINUTE_MS, 3);
  expect(growth.firstHalfMeanBytes / MIB).toBeCloseTo(100, 6);
  expect(growth.growthPercent).toBeCloseTo(0, 6);
  // The same samples read as a full-length run have a settled span of nothing at all, which is not judgeable.
  expect(unjudged(samples, settleAt(2.3, 60))).toContain("20");
  // Under the scaled floor of two minutes the six-minute run is not judgeable either: catch-up at minute 3 leaves 1.5.
  expect(
    unjudged(
      footprints(6, () => 100),
      settleAt(3, 6),
    ),
  ).toContain("2");
  // A thirty-minute run halves both: drop 7.5 minutes, floor 10 minutes.
  const half = judged(
    footprints(30, () => 100),
    settleAt(10, 30),
  );
  expect(half.settledFromMs).toBeCloseTo(17.5 * MINUTE_MS, 3);
  expect(half.settledMs).toBeCloseTo(12.5 * MINUTE_MS, 3);
});

test("a footprint unread, or a sidecar absent, anywhere in the settled span is not judgeable; a gap before it does not matter", () => {
  const unread = unjudged(
    footprints(60, (minute) => (minute > 50 && minute < 51 ? undefined : 100)),
    settleAt(23),
  );
  expect(unread).toContain("footprint");
  expect(unread).toContain("not read");
  expect(
    judged(
      footprints(60, (minute) =>
        minute > 30 && minute < 31 ? undefined : 100,
      ),
      settleAt(23),
    ).withinLimit,
  ).toBe(true);
  // The sidecar absent inside the span.
  const gone = footprints(60, () => 100).map((taken) =>
    taken.atMs > 45 * MINUTE_MS && taken.atMs < 46 * MINUTE_MS
      ? { ...taken, sidecar: { state: "absent" as const } }
      : taken,
  );
  expect(unjudged(gone, settleAt(23))).toContain("absent");
  // Samples that never recorded a footprint.
  expect(
    unjudged(
      sidecarSeries(60, () => 400),
      settleAt(23),
    ),
  ).toContain("not read");
});

test("a sidecar that restarted inside the settled span is not judged across two processes; one restarted before it is", () => {
  const first = footprints(45, () => 100, { sidecarPid: 200 });
  const second = footprints(15, () => 100, { sidecarPid: 201 }).map(
    (taken) => ({ ...taken, atMs: taken.atMs + 45 * MINUTE_MS + 10_000 }),
  );
  expect(unjudged([...first, ...second], settleAt(23))).toContain("restart");
  // The restart is before the span: only the later process is in it.
  const early = footprints(20, () => 300, { sidecarPid: 200 });
  const late = footprints(40, () => 100, { sidecarPid: 201 }).map((taken) => ({
    ...taken,
    atMs: taken.atMs + 20 * MINUTE_MS + 10_000,
  }));
  const growth = judged([...early, ...late], settleAt(23));
  expect(growth.growthPercent).toBeCloseTo(0, 6);
});

test("RSS is not what the row reads: a rising RSS beside a flat footprint passes, and the RSS trend is still reported", () => {
  const samples = sidecarSeries(60, (minute) => 100 + 4 * minute, {
    footprintAt: () => 78,
  });
  const summary = summarizeMemory(samples, settleAt(23));
  expect(summary.sidecarTrend).toMatchObject({
    judgeable: true,
    levellingOff: false,
  });
  expect(judged(samples, settleAt(23)).withinLimit).toBe(true);
});

test("the settled growth takes its sample counts from each half", () => {
  const growth = judged(
    footprints(60, () => 100),
    settleAt(23),
  );
  // 22 minutes at 6 samples a minute, split at the middle: 11 minutes each.
  expect(growth.firstHalfSamples).toBe(66);
  expect(growth.secondHalfSamples).toBe(67);
});

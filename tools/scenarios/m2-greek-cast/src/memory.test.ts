import { expect, test } from "bun:test";
import {
  createMemorySampler,
  findOllamaServePid,
  LEVELLING_OFF_PERCENT_PER_10_MIN,
  type MemorySample,
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
  options: { sidecarPid?: number; swapUsedMiB?: number } = {},
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
          },
    sidecar:
      sidecarMiB === undefined
        ? { state: "absent" }
        : {
            state: "present",
            pid: options.sidecarPid ?? SIDECAR,
            rssBytes: sidecarMiB * MIB,
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
  options: { sidecarPid?: number } = {},
): MemorySample[] {
  const samples: MemorySample[] = [];
  for (let at = 0; at <= minutes * 60_000; at += 10_000) {
    samples.push(sample(5000, rssAt(at / 60_000), at, options));
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

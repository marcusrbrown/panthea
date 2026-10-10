import { describe, expect, test } from "bun:test";
import type { RunCommand } from "../../coexistence/src/sample";
import type { HeadroomSample } from "./run";
import {
  type Clock,
  classifyProcess,
  createRoundTripProbe,
  parseDiskFreeKb,
  parseFootprintMiB,
  parsePressureLevel,
  parseProcessTable,
  type RoundTripLink,
  sampleHeadroom,
  sampleLoop,
  summarize,
} from "./run";

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                3754.
Pages active:                            365348.
Pages inactive:                          363213.
Pages speculative:                          638.
Pages wired down:                        137829.
Pages occupied by compressor:            125495.
Swapins:                               55004486.
Swapouts:                              64301281.
`;
const SWAP =
  "vm.swapusage: total = 6144.00M  used = 4938.75M  free = 1205.25M  (encrypted)";
const DF = `Filesystem   1024-blocks      Used Available Capacity iused ifree %iused  Mounted on
/dev/disk3s5   971350180 889395772  38808572    96% 10989283 388085720    3%   /System/Volumes/Data
`;

const APP = "/Applications/panthea-studio.app/Contents/MacOS/panthea-studio";
const SIDECAR =
  "/Applications/panthea-studio.app/Contents/MacOS/panthea-studio-sidecar session --config /tmp/c.json --parent-pid 900";
const WORKER = (pid: number) =>
  `${pid} 1202 /art/bin/release/sd-server --listen-port 52581 --diffusion-model /art/models/z.gguf`;

/** A process table the test can change between ticks. */
function fakeHost() {
  const state = {
    rows: [] as string[],
    rss: new Map<number, number>(),
    pressure: "1",
    footprint: new Map<number, string>(),
  };
  const run: RunCommand = (command) => {
    const [name, ...rest] = command;
    if (name === "ps" && rest[0] === "-axo")
      return `${state.rows.join("\n")}\n`;
    if (name === "ps" && rest[0] === "-o" && rest[1] === "rss=") {
      const kb = state.rss.get(Number(rest[3]));
      return kb === undefined ? undefined : `${kb}\n`;
    }
    if (name === "footprint") return state.footprint.get(Number(rest[1]));
    if (name === "vm_stat") return VM_STAT;
    if (name === "sysctl" && rest[0] === "vm.swapusage") return SWAP;
    if (
      name === "sysctl" &&
      rest.includes("kern.memorystatus_vm_pressure_level")
    )
      return `${state.pressure}\n`;
    if (name === "df") return DF;
    return undefined;
  };
  return { state, run };
}

describe("reading the process table", () => {
  test("pid, parent pid and the whole command, one row per line", () => {
    const rows = parseProcessTable(
      `  412     1 ${APP}\n 9001   412 ${SIDECAR}\n\nnot a row\n`,
    );

    expect(rows).toEqual([
      { pid: 412, ppid: 1, command: APP },
      { pid: 9001, ppid: 412, command: SIDECAR },
    ]);
  });

  test("the worker, the app and the sidecar are told apart by executable name, not by a substring", () => {
    const classify = (command: string) =>
      classifyProcess({ pid: 1, ppid: 0, command });

    expect(classify("/art/bin/release/sd-server --listen-port 1")).toBe(
      "worker",
    );
    expect(classify(APP)).toBe("app");
    expect(classify(SIDECAR)).toBe("sidecar");
    expect(classify("/usr/bin/grep sd-server")).toBeUndefined();
    expect(classify("bun run probe --watch sd-server")).toBeUndefined();
    expect(classify("/art/bin/release/sd-cli --help")).toBeUndefined();
    expect(classify("/tmp/panthea-studio-notes/viewer")).toBeUndefined();
  });
});

describe("one sample", () => {
  test("labels each process with the pid it sampled and its RSS in MiB", () => {
    const { state, run } = fakeHost();
    state.rows = [`412 1 ${APP}`, `9001 412 ${SIDECAR}`, WORKER(4101)];
    state.rss = new Map([
      [412, 204_800],
      [9001, 102_400],
      [4101, 5_242_880],
    ]);

    const sample = sampleHeadroom(run, { diskPath: "/tmp", atMs: 1500 });

    expect(sample.atMs).toBe(1500);
    expect(sample.processes).toEqual([
      { role: "worker", pid: 4101, rssMiB: 5120 },
      { role: "app", pid: 412, rssMiB: 200 },
      { role: "sidecar", pid: 9001, rssMiB: 100 },
    ]);
    expect(sample.pressure).toBe("normal");
    expect(sample.swapUsedMiB).toBe(4938.75);
    expect(sample.diskFreeMiB).toBeCloseTo(38_808_572 / 1024, 5);
  });

  test("the worker pid is resolved again on every tick: a restart changes the pid, and the old pid is never sampled again", () => {
    const { state, run } = fakeHost();
    state.rows = [`412 1 ${APP}`, WORKER(4101)];
    state.rss = new Map([
      [412, 100_000],
      [4101, 3_000_000],
      [4177, 800_000],
    ]);

    const first = sampleHeadroom(run, { diskPath: "/tmp", atMs: 0 });
    // The abort kills the server and the runtime starts another one.
    state.rows = [`412 1 ${APP}`, WORKER(4177)];
    state.rss.delete(4101);
    const second = sampleHeadroom(run, { diskPath: "/tmp", atMs: 2000 });

    expect(first.processes.find((p) => p.role === "worker")).toEqual({
      role: "worker",
      pid: 4101,
      rssMiB: 3_000_000 / 1024,
    });
    expect(second.processes.find((p) => p.role === "worker")).toEqual({
      role: "worker",
      pid: 4177,
      rssMiB: 800_000 / 1024,
    });
    expect(second.processes.map((p) => p.pid)).not.toContain(4101);
  });

  test("a pid that is in the table but gone by the RSS read is left out, and no worker is not a worker at 0", () => {
    const { state, run } = fakeHost();
    state.rows = [`412 1 ${APP}`, WORKER(4101)];
    state.rss = new Map([[412, 100_000]]);

    const sample = sampleHeadroom(run, { diskPath: "/tmp", atMs: 0 });

    expect(sample.processes.map((p) => p.role)).toEqual(["app"]);
  });

  test("a sidecar that the app did not start (the probe's own read-only session) is not sampled", () => {
    const { state, run } = fakeHost();
    state.rows = [
      `412 1 ${APP}`,
      `9001 412 ${SIDECAR}`,
      `9555 9444 ${SIDECAR}`,
    ];
    state.rss = new Map([
      [412, 1024],
      [9001, 2048],
      [9555, 4096],
    ]);

    const sample = sampleHeadroom(run, { diskPath: "/tmp", atMs: 0 });

    expect(sample.processes).toEqual([
      { role: "app", pid: 412, rssMiB: 1 },
      { role: "sidecar", pid: 9001, rssMiB: 2 },
    ]);
  });

  test("two workers at once are both labelled, each with its own pid", () => {
    const { state, run } = fakeHost();
    state.rows = [WORKER(4101), WORKER(4102)];
    state.rss = new Map([
      [4101, 1024],
      [4102, 2048],
    ]);

    const sample = sampleHeadroom(run, { diskPath: "/tmp", atMs: 0 });

    expect(sample.processes).toEqual([
      { role: "worker", pid: 4101, rssMiB: 1 },
      { role: "worker", pid: 4102, rssMiB: 2 },
    ]);
  });

  test("a command that fails leaves its field undefined and the rest of the sample intact", () => {
    const { state, run } = fakeHost();
    state.rows = [`412 1 ${APP}`];
    state.rss = new Map([[412, 2048]]);
    const flaky: RunCommand = (command) =>
      command[0] === "sysctl" || command[0] === "df" ? undefined : run(command);

    const sample = sampleHeadroom(flaky, { diskPath: "/tmp", atMs: 0 });

    expect(sample.pressure).toBeUndefined();
    expect(sample.swapUsedMiB).toBeUndefined();
    expect(sample.diskFreeMiB).toBeUndefined();
    expect(sample.vmFreeMiB).toBeCloseTo((3754 * 16384) / (1024 * 1024), 5);
    expect(sample.processes).toEqual([{ role: "app", pid: 412, rssMiB: 2 }]);
  });
});

describe("parsers", () => {
  test("memory pressure levels 1, 2 and 4 are normal, warn and critical; anything else is unknown", () => {
    expect(parsePressureLevel("1\n")).toEqual({ level: 1, name: "normal" });
    expect(parsePressureLevel("2")).toEqual({ level: 2, name: "warn" });
    expect(parsePressureLevel("4")).toEqual({ level: 4, name: "critical" });
    expect(parsePressureLevel("3")).toBeUndefined();
    expect(parsePressureLevel("")).toBeUndefined();
    expect(parsePressureLevel("high")).toBeUndefined();
  });

  test("free disk is the Available column of the last df line, in KiB", () => {
    expect(parseDiskFreeKb(DF)).toBe(38_808_572);
    expect(parseDiskFreeKb("")).toBeUndefined();
    expect(parseDiskFreeKb("Filesystem 1024-blocks\n")).toBeUndefined();
  });
});

describe("physical footprint", () => {
  test("parses the footprint line in B, KB, MB and GB", () => {
    const line = (value: string) =>
      `=====\nsd-server [4101]: 64-bit    Footprint: ${value} (16384 bytes per page)\n=====`;

    expect(parseFootprintMiB(line("80 MB"))).toBe(80);
    expect(parseFootprintMiB(line("4.5 GB"))).toBe(4608);
    expect(parseFootprintMiB(line("2048 KB"))).toBe(2);
    expect(parseFootprintMiB(line("1048576 B"))).toBe(1);
    expect(parseFootprintMiB("nothing here")).toBeUndefined();
  });

  test("a sample carries each pid's footprint beside its RSS; one that cannot be read is left off, not zeroed", () => {
    const { state, run } = fakeHost();
    state.rows = [WORKER(4101), `412 1 ${APP}`];
    state.rss = new Map([
      [4101, 24_576],
      [412, 2048],
    ]);
    state.footprint.set(
      4101,
      "x [4101]: 64-bit    Footprint: 5.2 GB (16384 bytes per page)",
    );

    const sample = sampleHeadroom(run, { diskPath: "/tmp", atMs: 0 });

    expect(sample.processes).toEqual([
      { role: "worker", pid: 4101, rssMiB: 24, footprintMiB: 5.2 * 1024 },
      { role: "app", pid: 412, rssMiB: 2 },
    ]);
    expect(sample.processes[1]).not.toHaveProperty("footprintMiB");
  });

  test("the summary's peak footprint carries the pid it came from", () => {
    const { state, run } = fakeHost();
    state.rss = new Map([
      [4101, 1024],
      [4177, 1024],
    ]);
    const samples = [];
    for (const [pid, text] of [
      [4101, "Footprint: 3 GB"],
      [4177, "Footprint: 5 GB"],
      [4177, "Footprint: 4 GB"],
    ] as const) {
      state.rows = [WORKER(pid)];
      state.footprint = new Map([[pid, text]]);
      samples.push(sampleHeadroom(run, { diskPath: "/tmp", atMs: 0 }));
    }

    expect(summarize(samples).roles.worker).toMatchObject({
      peakFootprintMiB: 5 * 1024,
      peakFootprintPid: 4177,
    });
  });
});

describe("the summary", () => {
  test("peak RSS per role carries the pid it came from, and every worker pid is listed with its sample count", () => {
    const { state, run } = fakeHost();
    state.rss = new Map([
      [412, 102_400],
      [4101, 2_048_000],
      [4177, 5_120_000],
    ]);
    const samples = [];
    for (const [at, worker] of [
      [0, 4101],
      [2000, 4101],
      [4000, 4177],
      [6000, 4177],
      [8000, 4177],
    ] as const) {
      state.rows = [`412 1 ${APP}`, WORKER(worker)];
      samples.push(sampleHeadroom(run, { diskPath: "/tmp", atMs: at }));
    }

    const summary = summarize(samples);

    expect(summary.samples).toBe(5);
    expect(summary.roles.worker).toMatchObject({
      peakPid: 4177,
      peakRssMiB: 5000,
      pids: [
        { pid: 4101, samples: 2 },
        { pid: 4177, samples: 3 },
      ],
    });
    expect(summary.roles.app).toMatchObject({
      peakPid: 412,
      peakRssMiB: 100,
      pids: [{ pid: 412, samples: 5 }],
    });
    expect(summary.roles.sidecar).toBeUndefined();
  });

  test("the worst pressure, the most swap used and the least free disk over the run", () => {
    const { state, run } = fakeHost();
    const samples = [];
    for (const level of ["1", "2", "4", "2"]) {
      state.pressure = level;
      samples.push(sampleHeadroom(run, { diskPath: "/tmp", atMs: 0 }));
    }

    const summary = summarize(samples);

    expect(summary.worstPressure).toBe("critical");
    expect(summary.pressureCounts).toEqual({ normal: 1, warn: 2, critical: 1 });
    expect(summary.maxSwapUsedMiB).toBe(4938.75);
    expect(summary.minDiskFreeMiB).toBeCloseTo(38_808_572 / 1024, 5);
  });

  test("round-trip times: count, failures, median, 95th percentile and maximum", () => {
    const samples = [10, 20, 30, 40, undefined, 50, 1000].map((ms, at) => ({
      atMs: at * 1000,
      processes: [],
      roundTripMs: ms === undefined ? null : ms,
    }));

    const summary = summarize(samples);

    expect(summary.roundTrip).toEqual({
      measured: 6,
      failed: 1,
      medianMs: 35,
      p95Ms: 1000,
      maxMs: 1000,
    });
  });

  test("samples with no round-trip field are not counted as failures, and an empty run summarizes to zero samples", () => {
    expect(summarize([{ atMs: 0, processes: [] }]).roundTrip).toBeUndefined();
    expect(summarize([])).toEqual({ samples: 0, roles: {} });
  });
});

/** A clock the test moves by hand: sleeping advances it, timers fire when it passes them. */
function fakeClock() {
  let at = 0;
  const timers: { due: number; fn: () => void; live: boolean }[] = [];
  const clock: Clock = {
    now: () => at,
    sleep: async (ms) => {
      advance(ms);
    },
    after: (ms, fn) => {
      const timer = { due: at + ms, fn, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
  };
  function advance(ms: number) {
    at += ms;
    for (const timer of timers)
      if (timer.live && timer.due <= at) {
        timer.live = false;
        timer.fn();
      }
  }
  return { clock, advance, timers };
}

/** A link whose replies the test sends, standing in for the sidecar. */
function fakeLink() {
  const sent: string[] = [];
  let lineHandler: (line: string) => void = () => {};
  let exitHandler: () => void = () => {};
  let gone = false;
  const link: RoundTripLink = {
    send: (line) => {
      if (gone) throw new Error("the child is gone");
      sent.push(line);
    },
    onLine: (handler) => {
      lineHandler = handler;
    },
    onExit: (handler) => {
      exitHandler = handler;
    },
    close: () => {},
  };
  return {
    link,
    sent,
    reply: (id: string) => lineHandler(JSON.stringify({ id, ok: true })),
    line: (text: string) => lineHandler(text),
    exit: () => {
      gone = true;
      exitHandler();
    },
  };
}

describe("the round-trip probe", () => {
  test("times the request line to the reply with the same id, on the injected clock", async () => {
    const fake = fakeLink();
    const time = fakeClock();
    const probe = createRoundTripProbe({
      link: fake.link,
      op: "status",
      clock: time.clock,
    });

    const first = probe.measure();
    time.advance(60);
    fake.reply("headroom-1");
    expect(await first).toBe(60);
    const second = probe.measure();
    time.advance(35);
    fake.reply("headroom-2");
    expect(await second).toBe(35);
    expect(fake.sent.map((line) => JSON.parse(line))).toEqual([
      { id: "headroom-1", op: "status", args: {} },
      { id: "headroom-2", op: "status", args: {} },
    ]);
  });

  test("a reply for another id, or a line that is not JSON, is not taken for this request's answer", async () => {
    const fake = fakeLink();
    const time = fakeClock();
    const probe = createRoundTripProbe({
      link: fake.link,
      op: "status",
      clock: time.clock,
    });

    const measured = probe.measure();
    fake.reply("headroom-0");
    fake.line("not json");
    fake.line(JSON.stringify({ ok: true }));
    time.advance(90);
    fake.reply("headroom-1");

    expect(await measured).toBe(90);
  });

  test("no reply within the bound answers undefined, and its timer is not left running after an answer", async () => {
    const fake = fakeLink();
    const time = fakeClock();
    const probe = createRoundTripProbe({
      link: fake.link,
      op: "status",
      timeoutMs: 120,
      clock: time.clock,
    });

    const silent = probe.measure();
    time.advance(120);
    expect(await silent).toBeUndefined();

    const answered = probe.measure();
    fake.reply("headroom-2");
    await answered;
    expect(time.timers.filter((timer) => timer.live)).toEqual([]);
  });

  test("a child that is gone answers undefined: one already gone, one that exits while waiting, one that cannot be written to", async () => {
    const time = fakeClock();
    const gone = fakeLink();
    const probe = createRoundTripProbe({
      link: gone.link,
      op: "status",
      clock: time.clock,
    });
    const waiting = probe.measure();
    gone.exit();
    expect(await waiting).toBeUndefined();
    expect(await probe.measure()).toBeUndefined();

    const broken = fakeLink();
    const unwritable = createRoundTripProbe({
      link: {
        ...broken.link,
        send: () => {
          throw new Error("EPIPE");
        },
      },
      op: "status",
      clock: time.clock,
    });
    expect(await unwritable.measure()).toBeUndefined();
  });
});

describe("the sampling loop", () => {
  /** A process table that answers the next worker pid on each read of it. */
  function tableOf(workers: number[]) {
    let reads = 0;
    const rss = new Map<number, number>();
    for (const pid of workers) rss.set(pid, 1024 * pid);
    const run: RunCommand = (command) => {
      if (command[0] === "ps" && command[1] === "-axo") {
        const pid = workers[Math.min(reads, workers.length - 1)];
        reads += 1;
        return `${pid} 1 /art/bin/release/sd-server --listen-port 52581\n`;
      }
      if (command[0] === "ps" && command[1] === "-o")
        return `${rss.get(Number(command[4]))}\n`;
      if (command[0] === "vm_stat") return VM_STAT;
      return undefined;
    };
    return { run, reads: () => reads };
  }

  test("re-reads the process table every tick: the worker is sampled and labelled as the pid it has on that tick, and a pid that has gone is not sampled again", async () => {
    const time = fakeClock();
    const table = tableOf([4101, 4101, 4177, 4177]);
    const seen: HeadroomSample[] = [];

    const samples = await sampleLoop({
      run: table.run,
      diskPath: "/tmp",
      intervalMs: 1000,
      durationMs: 4000,
      clock: time.clock,
      stopped: () => false,
      onSample: (sample) => seen.push(sample),
    });

    expect(table.reads()).toBe(4);
    expect(samples).toEqual(seen);
    expect(samples.map((sample) => sample.atMs)).toEqual([0, 1000, 2000, 3000]);
    expect(
      samples.map((sample) =>
        sample.processes.map((p) => [p.role, p.pid, p.rssMiB]),
      ),
    ).toEqual([
      [["worker", 4101, 4101]],
      [["worker", 4101, 4101]],
      [["worker", 4177, 4177]],
      [["worker", 4177, 4177]],
    ]);
    expect(summarize(samples).roles.worker?.pids).toEqual([
      { pid: 4101, samples: 2 },
      { pid: 4177, samples: 2 },
    ]);
  });

  test("a slow tick shortens the wait instead of delaying the next one, and a stop request ends the loop after the tick in progress", async () => {
    const time = fakeClock();
    const table = tableOf([1]);
    let ticks = 0;
    const slow: RunCommand = (command) => {
      if (command[0] === "vm_stat") time.advance(400);
      return table.run(command);
    };

    const samples = await sampleLoop({
      run: slow,
      diskPath: "/tmp",
      intervalMs: 1000,
      durationMs: 0,
      clock: time.clock,
      stopped: () => ticks++ >= 3,
      onSample: () => {},
    });

    expect(samples.map((sample) => sample.atMs)).toEqual([0, 1000, 2000]);
  });

  test("a round trip that fails is recorded as null, one that is measured as its time", async () => {
    const time = fakeClock();
    const answers = [42, undefined];
    const probe = {
      measure: async () => answers.shift(),
      close: () => {},
    };

    const samples = await sampleLoop({
      run: tableOf([1]).run,
      diskPath: "/tmp",
      intervalMs: 1000,
      durationMs: 2000,
      clock: time.clock,
      stopped: () => false,
      probe,
      onSample: () => {},
    });

    expect(samples.map((sample) => sample.roundTripMs)).toEqual([42, null]);
  });
});

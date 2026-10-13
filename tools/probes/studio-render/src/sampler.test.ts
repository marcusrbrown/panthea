import { describe, expect, test } from "bun:test";
import type { RunCommand } from "../../coexistence/src/sample";
import type { Clock } from "../../studio-headroom/src/run";
import { parseProcessTable } from "./proc";
import { sampleLoop, summarise, takeTick } from "./sampler";

/** A clock that only moves when the loop sleeps. */
function fakeClock(): Clock & { time: number } {
  const clock = {
    time: 0,
    now: () => clock.time,
    sleep: async (ms: number) => {
      clock.time += ms;
    },
    after: () => () => {},
  };
  return clock;
}

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

/** Canned command output; footprints and the pressure level come from the callbacks, read once per command. */
function runner(
  footprintMb: (pid: number) => number | undefined,
  level: () => number,
): RunCommand {
  return (command) => {
    const [tool, ...rest] = command;
    if (tool === "footprint") {
      const mb = footprintMb(Number(rest[1]));
      return mb === undefined
        ? undefined
        : `${"=".repeat(20)}\nproc [${rest[1]}]: 64-bit    Footprint: ${mb} MB (16384 bytes per page)\n`;
    }
    if (tool === "ps") {
      const mb = footprintMb(Number(rest[3]));
      return mb === undefined ? undefined : `${mb * 1024}\n`;
    }
    if (tool === "sysctl" && rest[0] === "-n") return `${level()}\n`;
    if (tool === "sysctl") return SWAP;
    if (tool === "vm_stat") return VM_STAT;
    return undefined;
  };
}

describe("takeTick", () => {
  test("sums phys_footprint over the tracked pids and reads pressure, swap and free pages", () => {
    const tick = takeTick(
      runner(
        (pid) => (pid === 10 ? 1500 : 2500),
        () => 1,
      ),
      [
        { label: "blender", pid: 10 },
        { label: "sd-server", pid: 11 },
      ],
      0,
    );
    expect(tick.sumFootprintMiB).toBe(4000);
    expect(tick.pressure).toBe("normal");
    expect(tick.swapUsedMiB).toBe(4938.75);
    expect(tick.vmFreeMiB).toBeCloseTo((3754 * 16384) / 1048576);
  });

  test("a pid that is gone is left out, never counted as zero", () => {
    const tick = takeTick(
      runner(
        (pid) => (pid === 10 ? 900 : undefined),
        () => 1,
      ),
      [
        { label: "blender", pid: 10 },
        { label: "gone", pid: 99 },
      ],
      0,
    );
    expect(tick.processes.map((p) => p.label)).toEqual(["blender"]);
  });
});

describe("sampleLoop", () => {
  test("records a peak that lies between synthetic readings, on the injected clock only", async () => {
    const clock = fakeClock();
    // Footprint follows the fake clock: it climbs to 3000 MB at t=500 and falls back.
    const footprint = () =>
      clock.time === 500 ? 3000 : clock.time < 500 ? 1000 : 1200;
    const ticks = await sampleLoop({
      run: runner(footprint, () => 1),
      clock,
      intervalMs: 250,
      targets: () => [{ label: "blender", pid: 10 }],
      stop: () => clock.time >= 1000,
    });
    expect(ticks.map((t) => t.atMs)).toEqual([0, 250, 500, 750]);
    const summary = summarise(ticks);
    expect(summary.peakSumFootprintMiB).toBe(3000);
    expect(summary.peakFootprintMiBByLabel.blender).toBe(3000);
    expect(summary.medianSpacingMs).toBe(250);
    expect(summary.sawCritical).toBe(false);
  });

  test("flags a level-4 reading as critical and lets the caller react on the tick", async () => {
    const clock = fakeClock();
    let level = 1;
    const seen: number[] = [];
    let stop = false;
    const ticks = await sampleLoop({
      run: runner(
        () => 500,
        () => level,
      ),
      clock,
      intervalMs: 100,
      targets: () => [{ label: "blender", pid: 10 }],
      stop: () => stop,
      onTick: (tick) => {
        seen.push(tick.pressureLevel ?? 0);
        if (tick.atMs === 200) level = 4;
        if ((tick.pressureLevel ?? 0) >= 4) stop = true;
      },
    });
    expect(seen).toEqual([1, 1, 1, 4]);
    const summary = summarise(ticks);
    expect(summary.sawCritical).toBe(true);
    expect(summary.sawWarn).toBe(true);
    expect(summary.maxPressureLevel).toBe(4);
  });
});

describe("sampleLoop when sampling falls behind", () => {
  test("still yields between ticks when every tick takes longer than the interval, and stops when told", async () => {
    const clock = fakeClock();
    let sleeps = 0;
    const sleep = clock.sleep;
    clock.sleep = async (ms: number) => {
      sleeps += 1;
      await sleep(ms);
    };
    // Each command read costs 300 ms on the fake clock, so one tick (four reads) overruns the 250 ms interval many times over.
    const slow: RunCommand = (command) => {
      clock.time += 300;
      return runner(
        () => 500,
        () => 1,
      )(command);
    };
    let stopAfter = 3;
    const ticks = await sampleLoop({
      run: slow,
      clock,
      intervalMs: 250,
      targets: () => [{ label: "blender", pid: 10 }],
      stop: () => stopAfter-- <= 0,
    });
    expect(ticks).toHaveLength(3);
    expect(sleeps).toBeGreaterThan(0);
    expect(sleeps).toBe(3);
  });
});

describe("parseProcessTable", () => {
  test("reads pid, ppid and pgid and skips malformed lines", () => {
    expect(
      parseProcessTable("  1     0     1\n 200   1 200\nnot a row\n  7 x 9\n"),
    ).toEqual([
      { pid: 1, ppid: 0, pgid: 1 },
      { pid: 200, ppid: 1, pgid: 200 },
    ]);
  });
});

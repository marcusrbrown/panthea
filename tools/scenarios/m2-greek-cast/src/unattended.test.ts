// The unattended driver, run on a virtual clock against a fake world: `sleep` advances time and nothing waits on the
// wall. The real sidecar, the real proxy and the real sampler are exercised by the development run, not here.

import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "./args";
import type { MemorySample } from "./memory";
import type { ProxyRecord } from "./outage-proxy";
import {
  CATCH_UP_CAP_MS,
  CATCH_UP_TIMEOUT_MS,
  driveUnattended,
  exitCodeOf,
  FRAME_FAILURES_MAX,
  GAP_MS,
  OUTAGE_GODS,
  type PhaseName,
  POLL_MS,
  phasePlan,
  type RunningWorld,
  requestsInside,
  type UnattendedDeps,
  type UnattendedResult,
  unattendedLaunchConfig,
  unattendedSettings,
} from "./unattended";
import type { OllamaState } from "./unattended-diagnostics";

const MINUTE = 60_000;
const GODS = [
  "athena",
  "hades",
  "hephaestus",
  "hera",
  "hermes",
  "poseidon",
  "zeus",
];
const T0 = 1_800_000_000_000;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

// --- The plan ---------------------------------------------------------------------------------

test("the full plan is the owner's: an outage by five gods or fifteen minutes, twelve minutes long, a stop ten minutes after the proxy is back, sixty minutes of running, a ninety-minute gap", () => {
  const plan = phasePlan(60);
  expect(plan).toMatchObject({
    minutes: 60,
    outageBoundMs: 15 * MINUTE,
    outageMs: 12 * MINUTE,
    stopAfterRestoreMs: 10 * MINUTE,
    runMs: 60 * MINUTE,
    gapMs: 90 * MINUTE,
    gate: true,
  });
  expect(OUTAGE_GODS).toBe(5);
  expect(GAP_MS).toBe(90 * MINUTE);
  expect(CATCH_UP_CAP_MS).toBe(60 * MINUTE);
});

test("a shorter run scales the running phases in proportion and leaves the gap alone; only sixty minutes is a gate run", () => {
  const six = phasePlan(6);
  expect(six).toMatchObject({
    minutes: 6,
    outageBoundMs: 1.5 * MINUTE,
    outageMs: 1.2 * MINUTE,
    stopAfterRestoreMs: 1 * MINUTE,
    runMs: 6 * MINUTE,
    gapMs: 90 * MINUTE,
    gate: false,
  });
  for (const minutes of [1, 2, 6, 30, 59, 61, 120]) {
    const plan = phasePlan(minutes);
    expect(plan.gapMs).toBe(90 * MINUTE);
    expect(plan.gate).toBe(false);
    // The bound, the outage and the wait always fit before the run's end, so a stop is never skipped.
    expect(
      plan.outageBoundMs + plan.outageMs + plan.stopAfterRestoreMs,
    ).toBeLessThan(plan.runMs);
  }
});

// --- A fake world -----------------------------------------------------------------------------

interface Script {
  /** Running ms (from the first start) at which each god's first action commits. */
  readonly godAt?: Readonly<Record<string, number>>;
  /** Running ms at which the proxy has seen five empty responses in a row. */
  readonly emptyAt?: number;
  /** Running ms at which the sidecar dies on its own, with this exit code. */
  readonly dieAt?: { readonly ms: number; readonly code: number };
  /** The exit code of the clean stop. */
  readonly stopCode?: number;
  /** How long the stop and restart take on the wall clock, which running time does not count. */
  readonly stopWallMs?: number;
  readonly catchUp?: { readonly appliedMs: number; readonly skippedMs: number };
  /** How long the catch-up runs, on the virtual clock; `undefined` never finishes. */
  readonly catchUpMs?: number | null;
  /** Provider requests the proxy saw, as wall offsets from the restart. */
  readonly requestsAtRestart?: readonly number[];
  readonly frameFailures?: { readonly from: number; readonly count: number };
  readonly runner?: "present" | "absent";
  /** The summary id the final frames carry; a different one means the summary did not survive. */
  readonly finalSummaryId?: string;
  readonly proxyRecordsAfterRestore?: readonly Omit<ProxyRecord, "at">[];
}

const ALL_GODS_BY = Object.fromEntries(
  GODS.map((god, i) => [god, 20_000 + i * 1_000]),
);

interface Harness {
  readonly deps: UnattendedDeps;
  readonly outDir: string;
  readonly calls: string[];
  readonly backdated: number[];
  readonly diagnoses: { count: number };
  readonly stops: string[];
  readonly clock: () => number;
  readonly endHook: { world: RunningWorld | undefined };
}

function harness(plan = phasePlan(6), script: Script = {}): Harness {
  const outDir = mkdtempSync(join(tmpdir(), "panthea-unattended-test-"));
  dirs.push(outDir);
  const dataDir = join(outDir, "app-data");
  let clock = T0;
  let t0: number | undefined;
  const calls: string[] = [];
  const backdated: number[] = [];
  const diagnoses = { count: 0 };
  const stops: string[] = [];
  const endHook: { world: RunningWorld | undefined } = { world: undefined };
  let starts = 0;
  let live: ReturnType<typeof makeWorld> | undefined;
  const records: ProxyRecord[] = [];
  let restoredAt: number | undefined;
  let proxyMode: "pass" | "fail" = "pass";

  const running = () => (t0 === undefined ? 0 : clock - t0);

  function makeWorld(index: number) {
    const startedAt = clock;
    const lines: { at: number; text: string }[] = [];
    let exitCode: number | null | undefined;
    let resolveExit: (code: number | null) => void = () => {};
    const exited = new Promise<number | null>((resolve) => {
      resolveExit = resolve;
    });
    const baseTick = index === 0 ? 0 : 7_000;
    if (index > 0)
      lines.push({ at: clock, text: "panthea-simulation: catch-up started" });
    const catchUpMs = script.catchUpMs === undefined ? 4_000 : script.catchUpMs;
    let frames = 0;
    const world = {
      pid: 4000 + index,
      get dead() {
        return exitCode !== undefined;
      },
      die(code: number | null) {
        if (exitCode !== undefined) return;
        exitCode = code;
        resolveExit(code);
      },
      finished: () =>
        index > 0 && catchUpMs !== null && clock >= startedAt + catchUpMs,
      exited,
      lines: () => {
        if (
          index > 0 &&
          world.finished() &&
          !lines.some((l) => l.text.endsWith("catch-up finished"))
        ) {
          lines.push({
            at: startedAt + (catchUpMs ?? 0),
            text: "panthea-simulation: catch-up finished",
          });
        }
        return lines;
      },
      async frame() {
        if (world.dead) throw new Error("connection refused");
        frames += 1;
        const failing = script.frameFailures;
        if (
          failing &&
          frames > failing.from &&
          frames <= failing.from + failing.count
        ) {
          throw new Error("frame unreadable");
        }
        const applied = script.catchUp?.appliedMs ?? CATCH_UP_CAP_MS;
        const skipped =
          script.catchUp?.skippedMs ?? GAP_MS - CATCH_UP_CAP_MS + 4_000;
        const afterRestart = index > 0 && world.finished();
        return {
          tick:
            baseTick +
            Math.floor((clock - startedAt) / 1000) +
            (afterRestart ? 3_600 : 0),
          sequence: frames,
          status: "ok",
          catchUpSummary: afterRestart
            ? {
                id:
                  script.finalSummaryId && running() >= plan.runMs - 5 * POLL_MS
                    ? script.finalSummaryId
                    : "summary-1",
                appliedMs: applied,
                skippedMs: skipped,
              }
            : undefined,
        };
      },
      async stopClean() {
        stops.push(`stop-${index}`);
        world.die(script.stopCode ?? 0);
        return exitCode ?? null;
      },
    };
    return world;
  }

  const deps: UnattendedDeps = {
    outDir,
    plan,
    now: () => clock,
    async sleep(ms) {
      clock += ms;
      if (
        script.dieAt &&
        t0 !== undefined &&
        running() >= script.dieAt.ms &&
        live &&
        !live.dead
      ) {
        live.die(script.dieAt.code);
      }
      await Promise.resolve();
      await Promise.resolve();
    },
    async startWorld() {
      mkdirSync(join(dataDir, "active"), { recursive: true });
      // The wall time between the stop and the restart is spent with no sidecar up.
      if (starts > 0) clock += script.stopWallMs ?? 0;
      if (t0 === undefined) t0 = clock;
      live = makeWorld(starts);
      starts += 1;
      if (starts === 2) {
        for (const offset of script.requestsAtRestart ?? []) {
          records.push({
            at: clock + offset,
            status: 200,
            latencyMs: 10,
            outcome: "forwarded",
            kind: "completion",
            empty: false,
          });
        }
      }
      const world = live;
      return {
        pid: world.pid,
        frame: () => world.frame(),
        stopClean: async () => world.stopClean(),
        exited: world.exited,
        lines: () => world.lines(),
      };
    },
    godsCommitted: () => {
      const godAt = script.godAt ?? ALL_GODS_BY;
      return Object.entries(godAt)
        .filter(([, ms]) => t0 !== undefined && clock - t0 >= ms)
        .map(([god]) => god);
    },
    backdate(ms) {
      backdated.push(ms);
    },
    proxy: {
      fail() {
        calls.push("fail");
        proxyMode = "fail";
      },
      pass() {
        calls.push("pass");
        proxyMode = "pass";
        restoredAt = clock;
        for (const record of script.proxyRecordsAfterRestore ?? []) {
          records.push({ ...record, at: restoredAt + 3_000 });
        }
      },
      records: () => records,
    },
    empty200: () =>
      script.emptyAt !== undefined &&
      t0 !== undefined &&
      running() >= script.emptyAt,
    sampler: {
      start() {},
      stop: () => [] as readonly MemorySample[],
      peek: () => ({
        atMs: clock,
        runner:
          script.runner === "absent"
            ? { state: "absent" }
            : { state: "present", pids: [9], rssBytes: 1000 },
        sidecar: { state: "present", pid: 4000, rssBytes: 500 },
        swap: undefined,
      }),
    },
    async diagnose(): Promise<OllamaState> {
      diagnoses.count += 1;
      return {
        ps: { ok: true, body: { models: [] } },
        logTail: { ok: true, lines: ["a", "b"] },
      };
    },
    onEnd: async (world) => {
      endHook.world = world;
    },
  };
  void proxyMode;
  return {
    deps,
    outDir,
    calls,
    backdated,
    diagnoses,
    stops,
    clock: () => clock,
    endHook,
  };
}

const names = (result: UnattendedResult): PhaseName[] =>
  result.boundaries.map((b) => b.phase);
const read = (outDir: string, file: string) =>
  readFileSync(join(outDir, file), "utf8");

const FULL: PhaseName[] = [
  "started",
  "outage-started",
  "proxy-restored",
  "stopped",
  "restarted",
  "catch-up-finished",
  "ended",
];

// --- The run ----------------------------------------------------------------------------------

test("a run goes through every phase in order, each boundary recorded with its wall time, tick and running time, and ends completed with exit 0", async () => {
  const h = harness();
  const result = await driveUnattended(h.deps);

  expect(result.status).toBe("completed");
  expect(exitCodeOf(result)).toBe(0);
  expect(names(result)).toEqual(FULL);
  for (const boundary of result.boundaries) {
    expect(boundary.wallMs).toBeGreaterThanOrEqual(T0);
    expect(Number.isInteger(boundary.tick)).toBe(true);
    expect(boundary.runningMs).toBeGreaterThanOrEqual(0);
  }
  const times = result.boundaries.map((b) => b.wallMs);
  expect([...times].sort((a, b) => a - b)).toEqual(times);
  const ticks = result.boundaries.map((b) => b.tick);
  expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);

  // The proxy was cut once and restored once, in that order, and the gap was backdated once, in full.
  expect(h.calls).toEqual(["fail", "pass"]);
  expect(h.backdated).toEqual([90 * MINUTE]);
  expect(h.stops).toEqual(["stop-0", "stop-1"]);
});

test("the outage starts as soon as five gods have committed, lasts its length on the running clock, ends at proxyRestoredAt, and the stop follows ten scaled minutes after", async () => {
  const plan = phasePlan(6);
  const h = harness(plan);
  const result = await driveUnattended(h.deps);
  const at = (phase: PhaseName) =>
    result.boundaries.find((b) => b.phase === phase);

  const outage = at("outage-started");
  const restored = at("proxy-restored");
  const stopped = at("stopped");
  expect(result.outage).toMatchObject({ trigger: "gods", godsActed: 5 });
  // Five gods had acted by 24 s: the outage did not wait for the time bound (90 s).
  expect(outage?.runningMs).toBeLessThan(plan.outageBoundMs);
  expect(outage?.runningMs).toBeGreaterThanOrEqual(24_000);
  expect(
    (restored?.runningMs ?? 0) - (outage?.runningMs ?? 0),
  ).toBeGreaterThanOrEqual(plan.outageMs);
  expect((restored?.runningMs ?? 0) - (outage?.runningMs ?? 0)).toBeLessThan(
    plan.outageMs + 2 * POLL_MS,
  );
  expect(
    (stopped?.runningMs ?? 0) - (restored?.runningMs ?? 0),
  ).toBeGreaterThanOrEqual(plan.stopAfterRestoreMs);
  expect((stopped?.runningMs ?? 0) - (restored?.runningMs ?? 0)).toBeLessThan(
    plan.stopAfterRestoreMs + 2 * POLL_MS,
  );
});

test("running time counts the sidecar being up and not the stopped gap: a restart that takes five wall minutes adds five minutes to elapsed time and none to running time", async () => {
  const plan = phasePlan(6);
  const h = harness(plan, { stopWallMs: 5 * MINUTE });
  const result = await driveUnattended(h.deps);

  expect(result.runningMs).toBeGreaterThanOrEqual(plan.runMs);
  expect(result.runningMs).toBeLessThan(plan.runMs + 2 * POLL_MS);
  expect(result.elapsedWallMs - result.runningMs).toBeGreaterThanOrEqual(
    5 * MINUTE,
  );
  expect(result.elapsedWallMs - result.runningMs).toBeLessThan(
    5 * MINUTE + 4 * POLL_MS,
  );
  // The ending is judged on running time: the boundary says 6 minutes, not 11.
  expect(result.boundaries.at(-1)?.runningMs).toBeLessThan(
    plan.runMs + 2 * POLL_MS,
  );
});

test("fewer than five gods acting leaves the outage to start at the time bound, and the boundary and the run record say so", async () => {
  const plan = phasePlan(6);
  const h = harness(plan, {
    godAt: { zeus: 10_000, hera: 20_000, athena: 30_000 },
  });
  const result = await driveUnattended(h.deps);
  const outage = result.boundaries.find((b) => b.phase === "outage-started");

  expect(result.status).toBe("completed");
  expect(result.outage).toMatchObject({ trigger: "time-bound", godsActed: 3 });
  expect(outage?.runningMs).toBeGreaterThanOrEqual(plan.outageBoundMs);
  expect(outage?.runningMs).toBeLessThan(plan.outageBoundMs + 2 * POLL_MS);
  expect(outage?.note).toContain("time bound");
  expect(outage?.note).toContain("3 of 7");
  expect(read(h.outDir, "report.md")).toContain("3 of 7 gods had acted");
});

test("exactly four gods is not enough and five is: the boundary of the trigger", async () => {
  const four = await driveUnattended(
    harness(phasePlan(6), {
      godAt: { zeus: 1_000, hera: 1_000, athena: 1_000, hermes: 1_000 },
    }).deps,
  );
  expect(four.outage?.trigger).toBe("time-bound");
  const five = await driveUnattended(
    harness(phasePlan(6), {
      godAt: {
        zeus: 1_000,
        hera: 1_000,
        athena: 1_000,
        hermes: 1_000,
        hades: 1_000,
      },
    }).deps,
  );
  expect(five.outage?.trigger).toBe("gods");
});

// --- The catch-up -----------------------------------------------------------------------------

test("the catch-up summary is read from the frame after the restart: sixty minutes applied, the rest discarded, and it is still the summary at the end", async () => {
  const h = harness();
  const result = await driveUnattended(h.deps);

  expect(result.catchUp).toMatchObject({
    appliedMs: 60 * MINUTE,
    summaryId: "summary-1",
  });
  expect(result.catchUp?.skippedMs).toBeGreaterThanOrEqual(30 * MINUTE);
  expect(result.catchUp?.skippedMs).toBeLessThan(40 * MINUTE);
  expect(result.checks.map((c) => [c.name, c.ok])).toEqual([
    ["the sidecar stops cleanly", true],
    ["the catch-up is bracketed by its own log lines", true],
    ["the catch-up applies the cap and discards the rest", true],
    ["no provider request is made during the catch-up", true],
    ["the catch-up summary is still the summary at the end", true],
  ]);
});

test("a provider request inside the catch-up fails the run, and the same request just outside it does not", async () => {
  const inside = await driveUnattended(
    harness(phasePlan(6), { requestsAtRestart: [1_000] }).deps,
  );
  expect(inside.status).toBe("failed");
  expect(exitCodeOf(inside)).toBe(1);
  expect(
    inside.checks.find(
      (c) => c.name === "no provider request is made during the catch-up",
    ),
  ).toMatchObject({
    ok: false,
  });
  expect(inside.reason).toContain(
    "no provider request is made during the catch-up",
  );

  // Control: the catch-up here ends at +4 s; a request at +5 s is the first tick after it.
  const outside = await driveUnattended(
    harness(phasePlan(6), { requestsAtRestart: [5_000] }).deps,
  );
  expect(outside.status).toBe("completed");
});

test("requestsInside counts the requests that arrived between the two log lines, with the same tolerance at the end as S10", () => {
  const at = (n: number): ProxyRecord => ({
    at: n,
    status: 200,
    latencyMs: 1,
    outcome: "forwarded",
    kind: "completion",
    empty: false,
  });
  const records = [at(99), at(100), at(150), at(174), at(175), at(200)];
  // Up to 25 ms before the finish line counts as inside: 100, 150, 174 and 175.
  expect(requestsInside(records, 100, 200)).toBe(4);
  expect(requestsInside(records, 100, 199)).toBe(3);
  expect(requestsInside([], 100, 200)).toBe(0);
  expect(requestsInside(records, 300, 200)).toBe(0);
});

test("a summary that applied less than the cap, or discarded nothing, fails the run", async () => {
  const short = await driveUnattended(
    harness(phasePlan(6), {
      catchUp: { appliedMs: 30 * MINUTE, skippedMs: 60 * MINUTE },
    }).deps,
  );
  expect(short.status).toBe("failed");
  expect(short.reason).toContain(
    "the catch-up applies the cap and discards the rest",
  );

  const kept = await driveUnattended(
    harness(phasePlan(6), { catchUp: { appliedMs: 60 * MINUTE, skippedMs: 0 } })
      .deps,
  );
  expect(kept.status).toBe("failed");
});

test("a catch-up summary that changed by the end of the run did not survive, and fails the run", async () => {
  const result = await driveUnattended(
    harness(phasePlan(6), { finalSummaryId: "summary-2" }).deps,
  );
  expect(result.status).toBe("failed");
  expect(result.reason).toContain(
    "the catch-up summary is still the summary at the end",
  );
});

test("a catch-up that never finishes ends the run as failed after its timeout, with the store kept", async () => {
  const h = harness(phasePlan(6), { catchUpMs: null });
  const result = await driveUnattended(h.deps);

  expect(result.status).toBe("failed");
  expect(result.reason).toContain("catch-up");
  expect(names(result)).toContain("restarted");
  expect(names(result)).not.toContain("catch-up-finished");
  const lastRestart = result.boundaries.find((b) => b.phase === "restarted");
  expect(h.clock() - (lastRestart?.wallMs ?? 0)).toBeGreaterThanOrEqual(
    CATCH_UP_TIMEOUT_MS,
  );
  expect(existsSync(join(h.outDir, "app-data"))).toBe(true);
});

test("a stop that does not exit cleanly fails the run, and the run still goes on to gather the rest", async () => {
  const result = await driveUnattended(
    harness(phasePlan(6), { stopCode: 137 }).deps,
  );
  expect(result.status).toBe("failed");
  expect(
    result.checks.find((c) => c.name === "the sidecar stops cleanly"),
  ).toMatchObject({ ok: false });
  expect(names(result)).toEqual(FULL);
});

// --- The faults -------------------------------------------------------------------------------

test("five empty responses in a row end the run as an infrastructure fault, exit 2, with Ollama's state captured and no later phase run, in every phase", async () => {
  const plan = phasePlan(6);
  const phases: [string, number, PhaseName[]][] = [
    ["steady, before the outage", 10_000, ["started"]],
    ["during the outage", 40_000, ["started", "outage-started"]],
    ["in recovery", 100_000, ["started", "outage-started", "proxy-restored"]],
    [
      "after the restart",
      300_000,
      [
        "started",
        "outage-started",
        "proxy-restored",
        "stopped",
        "restarted",
        "catch-up-finished",
      ],
    ],
  ];
  for (const [label, emptyAt, expected] of phases) {
    const h = harness(plan, { emptyAt });
    const result = await driveUnattended(h.deps);
    expect([label, result.status]).toEqual([label, "fault"]);
    expect(exitCodeOf(result)).toBe(2);
    expect(names(result)).toEqual(expected);
    expect(h.diagnoses.count).toBe(1);
    expect(existsSync(join(h.outDir, "diagnostics", "ollama-ps.json"))).toBe(
      true,
    );
    expect(
      existsSync(join(h.outDir, "diagnostics", "ollama-log-tail.txt")),
    ).toBe(true);
    expect(existsSync(join(h.outDir, "diagnostics", "memory.json"))).toBe(true);
    expect(read(h.outDir, "report.md")).toContain("INFRASTRUCTURE FAULT");
    expect(read(h.outDir, "report.md")).toContain("exit 2");
    // The sidecar was stopped, and the store was kept.
    expect(h.stops.length).toBeGreaterThan(0);
    expect(existsSync(join(h.outDir, "app-data"))).toBe(true);
  }
});

test("the fault capture holds the state it was given and nothing else", async () => {
  const h = harness(phasePlan(6), { emptyAt: 40_000 });
  await driveUnattended(h.deps);
  expect(JSON.parse(read(h.outDir, "diagnostics/ollama-ps.json"))).toEqual({
    ok: true,
    body: { models: [] },
  });
  expect(read(h.outDir, "diagnostics/ollama-log-tail.txt")).toBe("a\nb\n");
  expect(JSON.parse(read(h.outDir, "diagnostics/memory.json"))).toHaveProperty(
    "summary",
  );
});

test("a sidecar that dies on its own ends the run failed, exit 1, with what can be captured and the store kept; a fault is not a failure", async () => {
  const h = harness(phasePlan(6), { dieAt: { ms: 50_000, code: 137 } });
  const result = await driveUnattended(h.deps);

  expect(result.status).toBe("failed");
  expect(exitCodeOf(result)).toBe(1);
  expect(result.reason).toContain("137");
  expect(names(result)).toEqual(["started", "outage-started"]);
  expect(h.diagnoses.count).toBe(1);
  expect(existsSync(join(h.outDir, "app-data"))).toBe(true);
  expect(read(h.outDir, "report.md")).toContain("FAILED");
  expect(read(h.outDir, "report.md")).not.toContain("INFRASTRUCTURE FAULT");
});

test("a sidecar that dies after the restart is a failure too, and the stop the driver asked for is not mistaken for a death", async () => {
  const h = harness(phasePlan(6), { dieAt: { ms: 250_000, code: 1 } });
  const result = await driveUnattended(h.deps);
  expect(result.status).toBe("failed");
  expect(names(result)).toContain("stopped");
  expect(names(result)).toContain("restarted");
  expect(result.reason).toContain("exited");
});

test("a frame that cannot be read is tolerated a few times in a row and then fails the run", async () => {
  expect(FRAME_FAILURES_MAX).toBe(5);
  const tolerated = await driveUnattended(
    harness(phasePlan(6), {
      frameFailures: { from: 10, count: FRAME_FAILURES_MAX - 1 },
    }).deps,
  );
  expect(tolerated.status).toBe("completed");

  const h = harness(phasePlan(6), {
    frameFailures: { from: 10, count: FRAME_FAILURES_MAX },
  });
  const failed = await driveUnattended(h.deps);
  expect(failed.status).toBe("failed");
  expect(failed.reason).toContain("frame");
  expect(h.diagnoses.count).toBe(1);
});

// --- What the recovery shows ------------------------------------------------------------------

test("at proxyRestoredAt the run records whether the runner was loaded, and how the first request after it went", async () => {
  const withRunner = await driveUnattended(
    harness(phasePlan(6), {
      runner: "present",
      proxyRecordsAfterRestore: [
        {
          status: 200,
          latencyMs: 4_321,
          outcome: "forwarded",
          kind: "completion",
          empty: false,
          promptTokens: 2_000,
        },
        {
          status: 200,
          latencyMs: 100,
          outcome: "forwarded",
          kind: "completion",
          empty: false,
        },
      ],
    }).deps,
  );
  expect(withRunner.restore).toEqual({
    runnerAtRestore: "present",
    firstRequestAfterRestore: {
      latencyMs: 4_321,
      status: 200,
      empty: false,
      afterRestoreMs: 3_000,
    },
  });

  const cold = await driveUnattended(
    harness(phasePlan(6), { runner: "absent" }).deps,
  );
  expect(cold.restore).toEqual({
    runnerAtRestore: "absent",
    firstRequestAfterRestore: undefined,
  });
});

// --- The evidence -----------------------------------------------------------------------------

test("every artifact is written under the run folder and nothing is deleted: the run record, the report, the frames, the proxy records and the memory samples", async () => {
  const h = harness(phasePlan(6), {
    proxyRecordsAfterRestore: [
      {
        status: 200,
        latencyMs: 50,
        outcome: "forwarded",
        kind: "completion",
        empty: false,
      },
    ],
  });
  await driveUnattended(h.deps);

  for (const file of [
    "run.json",
    "report.md",
    "frames.jsonl",
    "proxy-records.jsonl",
    "memory.jsonl",
  ]) {
    expect([file, existsSync(join(h.outDir, file))]).toEqual([file, true]);
  }
  expect(existsSync(join(h.outDir, "app-data"))).toBe(true);
  const run = JSON.parse(read(h.outDir, "run.json")) as UnattendedResult;
  expect(run.status).toBe("completed");
  expect(run.boundaries.map((b) => b.phase)).toEqual(FULL);
  expect(run.plan.minutes).toBe(6);

  const frames = read(h.outDir, "frames.jsonl").trim().split("\n");
  expect(frames.length).toBeGreaterThan(50);
  const keysOf = (line: string | undefined) =>
    Object.keys(JSON.parse(line as string) as Record<string, unknown>).sort();
  expect(keysOf(frames[0])).toEqual([
    "atMs",
    "runningMs",
    "sequence",
    "status",
    "tick",
  ]);
  // After the catch-up the frames carry the summary's id, and no frame carries anything else.
  expect(keysOf(frames.at(-1))).toEqual([
    "atMs",
    "runningMs",
    "sequence",
    "status",
    "summaryId",
    "tick",
  ]);
  expect(read(h.outDir, "proxy-records.jsonl").trim().split("\n")).toHaveLength(
    1,
  );
  expect(read(h.outDir, "report.md")).toContain("COMPLETED");
});

test("a run shorter than sixty minutes says in its report that it is not a gate run", async () => {
  const h = harness(phasePlan(6));
  await driveUnattended(h.deps);
  expect(read(h.outDir, "report.md")).toContain("not a gate run");
});

test("the end hook sees the live world before the run stops it, and a failure in it fails the run", async () => {
  const h = harness();
  const result = await driveUnattended(h.deps);
  expect(result.status).toBe("completed");
  expect(h.endHook.world).toBeDefined();
  // It ran before the last stop was asked for: the last stop is the one after it.
  expect(h.stops.at(-1)).toBe("stop-1");

  const broken = harness();
  broken.deps.onEnd = async () => {
    throw new Error("export failed");
  };
  const failed = await driveUnattended(broken.deps);
  expect(failed.status).toBe("failed");
  expect(failed.reason).toContain("export failed");
});

test("exit codes: completed is 0, a failure is 1, and only an infrastructure fault is 2", () => {
  const base = { boundaries: [], checks: [] } as unknown as UnattendedResult;
  expect(exitCodeOf({ ...base, status: "completed" })).toBe(0);
  expect(exitCodeOf({ ...base, status: "failed" })).toBe(1);
  expect(exitCodeOf({ ...base, status: "fault" })).toBe(2);
});

// --- What the run says about its endpoint -----------------------------------------------------

test("the unattended run's routing names the local Ollama as the endpoint, through the proxy, and its recorded settings say local with no host, port, path or key", () => {
  const args = parseArgs([
    "--unattended",
    "--model=granite3.3-8b-4k",
    "--reasoning-effort=none",
  ]);
  const config = unattendedLaunchConfig(
    args,
    "/bin/sidecar",
    "http://127.0.0.1:53211",
  ) as {
    models: { endpoints: Record<string, unknown>[]; fallback: string[] };
    offline: boolean;
    keys: Record<string, string>;
  };
  expect(config.models.endpoints).toEqual([
    {
      id: "ollama",
      baseUrl: "http://127.0.0.1:53211/v1",
      model: "granite3.3-8b-4k",
      reasoningEffort: "none",
    },
  ]);
  expect(config.models.fallback).toEqual(["ollama"]);
  expect(config.offline).toBe(false);
  expect(config.keys).toEqual({});
  expect(JSON.stringify(config)).not.toContain("hosted");

  const settings = unattendedSettings(
    args,
    "/bin/sidecar",
    "http://127.0.0.1:53211",
  );
  expect(settings).toEqual({
    model: "granite3.3-8b-4k",
    reasoningEffort: "none",
    endpoint: "local",
  });
  const text = JSON.stringify(settings);
  for (const private_ of ["127.0.0.1", "53211", "/v1", "keyRef"]) {
    expect(text).not.toContain(private_);
  }
});

test("a run's settings are written into run.json beside the result", async () => {
  const h = harness();
  h.deps.settings = { model: "m", endpoint: "local" };
  await driveUnattended(h.deps);
  const run = JSON.parse(read(h.outDir, "run.json")) as { settings?: unknown };
  expect(run.settings).toEqual({ model: "m", endpoint: "local" });
  expect(read(h.outDir, "report.md")).toContain(
    "a local OpenAI-compatible endpoint",
  );
});

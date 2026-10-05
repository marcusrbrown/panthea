// Runs a curated subset of the QuickJS fixture matrix through the real
// subprocess host (not mocked) — the whole point of this probe is
// measuring subprocess-isolated termination behavior, so these tests
// exercise the actual boundary rather than an in-process stand-in.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type FixtureCategory, getFixture } from "./fixtures/manifest";
import { runFixtureInSubprocess } from "./host";

const RUN_FILE_PATH = join(import.meta.dir, "run.ts");

// Short engine deadline; the supervisor's 1.2 s kill stays the backstop.
const RUNAWAY_DEADLINE_MS = 50;

function run(
  fixtureId: string,
  category: FixtureCategory,
  engineDeadlineMs?: number,
) {
  return runFixtureInSubprocess({
    engineDeadlineMs,
    runFilePath: RUN_FILE_PATH,
    runtime: "quickjs",
    fixtureId,
    category,
    expect: getFixture(fixtureId).expect,
  });
}

describe("quickjs sandbox", () => {
  test("happy path lands both calls", async () => {
    const record = await run("happy-path", "happy-path");
    expect(record.outcome).toBe("completed");
    expect(record.childOutput?.ok).toBe(true);
    expect(record.childOutput?.apiLog.calls.length).toBe(2);
    expect(record.childOutput?.apiLog.status).toBe("committed");
  }, 10_000);

  test("every external-capability fixture is blocked, never escaped, with no committed call", async () => {
    const ids = [
      "external-require",
      "external-process",
      "external-fetch",
      "external-bun-global",
      "external-globalthis-leak",
      "external-function-eval-ctor",
      "external-symbol-for",
      "external-webassembly",
      "external-atomics-wait",
      "external-timers",
    ];
    for (const id of ids) {
      const record = await run(id, "external-capability");
      expect(record.outcome).not.toBe("escaped");
      expect(record.childOutput?.apiLog.calls.length ?? 0).toBe(0);
    }
  }, 30_000);

  test("infinite loop is terminated by the engine's interrupt deadline, not the supervisor's kill", async () => {
    const record = await run(
      "loop-infinite",
      "loop-recursion",
      RUNAWAY_DEADLINE_MS,
    );
    expect(record.outcome).toBe("terminated");
    expect(record.supervisorKilled).toBe(false);
    expect(record.childOutput?.interruptFired).toBe(true);
  }, 5_000);

  test("deep recursion hits the stack limit", async () => {
    const record = await run("loop-deep-recursion", "loop-recursion");
    expect(record.outcome).toBe("terminated");
  }, 5_000);

  test("allocation bomb terminates, with isolated RSS recorded honestly", async () => {
    const record = await run(
      "allocation-array-growth",
      "allocation",
      RUNAWAY_DEADLINE_MS,
    );
    expect(record.outcome).toBe("terminated");
    expect(record.peakRssBytes).toBeGreaterThan(0);
  }, 5_000);

  test("malformed API input is blocked with no committed effect", async () => {
    const record = await run("malformed-wrong-types", "malformed-input");
    expect(record.outcome).toBe("blocked");
    expect(record.childOutput?.apiLog.calls.length ?? 0).toBe(0);
  }, 5_000);

  test("over-budget calls stop exactly at the invocation budget", async () => {
    const record = await run("malformed-over-budget", "malformed-input");
    expect(record.childOutput?.apiLog.calls.length).toBe(50);
    expect(record.childOutput?.apiLog.status).toBe("rolled-back");
  }, 5_000);

  test("after a terminated fixture, the next valid behavior runs in a fresh runtime", async () => {
    const terminated = await run(
      "loop-infinite",
      "loop-recursion",
      RUNAWAY_DEADLINE_MS,
    );
    expect(terminated.outcome).toBe("terminated");
    const followUp = await run("happy-path", "happy-path");
    expect(followUp.outcome).toBe("completed");
  }, 10_000);

  test("partial-failure leaves exactly the staged calls and a rolled-back marker", async () => {
    const record = await run("partial-failure", "partial-failure");
    expect(record.childOutput?.apiLog.calls.length).toBe(2);
    expect(record.childOutput?.apiLog.status).toBe("rolled-back");
  }, 5_000);

  test("malformed-proxy-args: the parity-flip Proxy never gets its poisoned value committed", async () => {
    const record = await run("malformed-proxy-args", "malformed-input");
    expect(record.outcome).toBe("completed");
    expect(record.childOutput?.apiLog.calls).toEqual([
      { index: 1, call: "move", args: { x: 1, y: 1 } },
    ]);
    expect(record.childOutput?.apiLog.status).toBe("committed");
  }, 5_000);

  test("guest overwriting the global Object.getOwnPropertyDescriptor has zero effect: the true values still commit", async () => {
    const record = await run(
      "malformed-overwrite-descriptor-fn",
      "malformed-input",
    );
    expect(record.outcome).toBe("completed");
    expect(record.childOutput?.apiLog.calls).toEqual([
      { index: 1, call: "move", args: { x: 1, y: 1 } },
    ]);
  }, 5_000);

  test("a Proxy's own getOwnPropertyDescriptor trap can only lie about the value it returns, exactly and no more", async () => {
    const record = await run(
      "malformed-proxy-descriptor-trap",
      "malformed-input",
    );
    // The trap fabricates x; the committed value must equal exactly what
    // the trap presented (x: 999999) — never something else, never a
    // value that should have failed schema validation, and y (untouched
    // by the trap) must be the real target value.
    expect(record.childOutput?.apiLog.calls).toEqual([
      { index: 1, call: "move", args: { x: 999999, y: 1 } },
    ]);
    expect(record.outcome).toBe("completed");
  }, 5_000);

  test("an infinitely self-requeuing microtask chain is drained under the deadline and terminated, not silently ignored", async () => {
    const record = await run(
      "async-microtask-recursion",
      "async-hang",
      RUNAWAY_DEADLINE_MS,
    );
    expect(record.outcome).toBe("terminated");
    expect(record.childOutput?.jobsExecuted).toBeGreaterThan(0);
  }, 5_000);

  test("allocation-string-doubling is terminated (by the engine's max-string-length invariant), not completed", async () => {
    const record = await run("allocation-string-doubling", "allocation");
    expect(record.outcome).toBe("terminated");
    expect(record.childOutput?.ok).toBe(false);
  }, 5_000);
});

// Supervises exactly one fixture execution in a `Bun.spawn` subprocess. A
// Worker is in-process and shares the heap, so it cannot give a separate RSS
// boundary or survive a memory bomb — the measured RSS and termination here
// belong to the isolated child, never to this supervising process.
//
// Two independent bounds protect the supervisor itself: a wall-clock
// deadline (kill -9 on expiry) and a peak-RSS ceiling sampled at short
// intervals (kill -9 if the child's own resident set outgrows a sane bound,
// in case a memory bomb outgrows the runtime's own soft memory limit before
// the deadline). Both are the *control path*, not the boundary under test —
// the primary mechanism being measured is the runtime's own interrupt
// handler / memory limit / stack limit, recorded via the child's JSON
// output (`interruptFired` / `timedOut` / `limitKind`).

import type {
  ExpectedCall,
  FixtureCategory,
  FixtureExpectation,
  FixtureOutcome,
  Runtime,
} from "./fixtures/manifest";

export interface ChildRunOutput {
  readonly ok: boolean;
  readonly returnValue?: string;
  readonly errorName?: string;
  readonly errorMessage?: string;
  readonly interruptFired?: boolean;
  readonly limitKind?: string;
  readonly timedOut?: boolean;
  readonly jobsExecuted?: number;
  readonly durationMs: number;
  readonly apiLog: {
    readonly calls: readonly unknown[];
    readonly status: string;
  };
}

export interface FixtureRunRecord {
  readonly fixtureId: string;
  readonly runtime: Runtime;
  readonly category: FixtureCategory;
  readonly outcome: FixtureOutcome;
  readonly timeToTerminationMs: number;
  readonly peakRssBytes: number | undefined;
  readonly exitCode: number | null;
  readonly exitSignal: string | null;
  readonly supervisorKilled: boolean;
  readonly childOutput: ChildRunOutput | undefined;
  readonly stderrTail: string | undefined;
}

/** Per-category outer wall-clock deadlines. Adversarial loop/allocation/
 * async-hang fixtures get a tight bound since their whole point is running
 * away; everything else gets a generous bound since it should finish almost
 * instantly. */
const DEFAULT_DEADLINE_MS: Record<FixtureCategory, number> = {
  "happy-path": 2000,
  "external-capability": 2000,
  "loop-recursion": 1200,
  allocation: 1200,
  "async-hang": 1200,
  "malformed-input": 2000,
  "partial-failure": 2000,
};

const DEFAULT_RSS_LIMIT_BYTES = 512 * 1024 * 1024;
const RSS_SAMPLE_INTERVAL_MS = 40;

function sampleRssBytes(pid: number): number | undefined {
  try {
    const result = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(pid)]);
    if (result.exitCode !== 0) {
      return undefined;
    }
    const text = result.stdout.toString().trim();
    if (text.length === 0) {
      return undefined;
    }
    const kb = Number(text);
    return Number.isFinite(kb) ? kb * 1024 : undefined;
  } catch {
    return undefined;
  }
}

function classifyOutcome(
  category: FixtureCategory,
  supervisorKilled: boolean,
  childOutput: ChildRunOutput | undefined,
): FixtureOutcome {
  if (supervisorKilled) {
    return "terminated";
  }
  if (!childOutput) {
    return "terminated";
  }

  const limitFired = Boolean(
    childOutput.interruptFired || childOutput.timedOut || childOutput.limitKind,
  );

  switch (category) {
    case "loop-recursion":
    case "allocation":
      // Any abnormal ending counts as "terminated" here, not just a
      // recognized limitKind: a category whose entire point is adversarial
      // resource pressure must never silently report "completed" just
      // because the specific error message didn't match a known pattern
      // (e.g. `allocation-string-doubling` hitting the engine's own
      // max-string-length invariant, `errorMessage: "string too long"`,
      // was previously mis-reported as `completed` before `limitKind`
      // learned to recognize it — this fallback is the backstop for the
      // NEXT unrecognized message too).
      return limitFired || !childOutput.ok ? "terminated" : "completed";
    case "async-hang":
      if (limitFired) {
        return "terminated";
      }
      return childOutput.ok ? "completed" : "blocked";
    case "external-capability":
    case "malformed-input":
      if (limitFired) {
        return "terminated";
      }
      if (!childOutput.ok) {
        return "blocked";
      }
      if (typeof childOutput.returnValue === "string") {
        if (childOutput.returnValue.startsWith("REACHED")) {
          return "escaped";
        }
        if (childOutput.returnValue.startsWith("BLOCKED")) {
          return "blocked";
        }
      }
      return "completed";
    case "partial-failure":
      return "completed";
    case "happy-path":
      return childOutput.ok ? "completed" : "terminated";
    default:
      return "completed";
  }
}

/** True only if `actualCalls` has exactly the same `call`/`args` sequence
 * as `expectedCalls` (each `args` compared by JSON deep-equality; `index`
 * is never compared). */
function callsMatchExpectation(
  actualCalls: readonly unknown[],
  expectedCalls: readonly ExpectedCall[],
): boolean {
  if (actualCalls.length !== expectedCalls.length) {
    return false;
  }
  return actualCalls.every((rawCall, index) => {
    const actual = rawCall as { call?: unknown; args?: unknown };
    const expected = expectedCalls[index];
    return (
      actual.call === expected.call &&
      JSON.stringify(actual.args) === JSON.stringify(expected.args)
    );
  });
}

/**
 * A category-level outcome (`completed`, `blocked`, ...) only tells you the
 * fixture *looked* fine — it says nothing about whether the values it
 * actually committed were the right ones. `expect.committed`/`expect.status`
 * assert that directly: a `completed`/`blocked` verdict whose committed
 * calls or final status disagree with the manifest's declared expectation
 * is downgraded to `escaped`, regardless of how clean the guest's own
 * self-report (`returnValue`) looked. This is what makes a value-integrity
 * bypass (not just a capability reach) impossible to silently pass as
 * fixed — exactly the gap a `CALLED:no-throw` self-report can't see.
 */
function applyExpectationOverride(
  outcome: FixtureOutcome,
  childOutput: ChildRunOutput | undefined,
  expect: FixtureExpectation | undefined,
): FixtureOutcome {
  // Deliberately does NOT bypass this check for a "terminated" outcome: a
  // supervisor-killed or interrupted run can still have committed calls
  // (e.g. a partial commit right before an unrelated resource kill), and an
  // integrity check that only ever runs on a clean-looking result can't
  // catch a bad value that happened to coincide with an abnormal ending.
  // The check runs whenever there is a `childOutput` and an `expect` to
  // check it against, full stop.
  if (!expect || !childOutput) {
    return outcome;
  }
  if (
    expect.committed &&
    !callsMatchExpectation(childOutput.apiLog.calls, expect.committed)
  ) {
    return "escaped";
  }
  if (expect.status && childOutput.apiLog.status !== expect.status) {
    return "escaped";
  }
  return outcome;
}

export interface RunFixtureInSubprocessOptions {
  readonly runFilePath: string;
  readonly runtime: Runtime;
  readonly fixtureId: string;
  readonly category: FixtureCategory;
  /** The supervisor's outer wall-clock kill (the backstop, not the boundary under test). */
  readonly deadlineMs?: number;
  /**
   * The engine's own deadline inside the child (the interrupt handler or the
   * Lua count hook), which is the mechanism this probe measures. Omit for the
   * engine default (250 ms); tests shorten it so a runaway fixture ends fast.
   */
  readonly engineDeadlineMs?: number;
  readonly rssLimitBytes?: number;
  readonly expect?: FixtureExpectation;
}

export async function runFixtureInSubprocess(
  options: RunFixtureInSubprocessOptions,
): Promise<FixtureRunRecord> {
  const deadlineMs =
    options.deadlineMs ?? DEFAULT_DEADLINE_MS[options.category];
  const rssLimitBytes = options.rssLimitBytes ?? DEFAULT_RSS_LIMIT_BYTES;

  const proc = Bun.spawn(
    [
      "bun",
      options.runFilePath,
      "--runtime",
      options.runtime,
      "--fixture",
      options.fixtureId,
      ...(options.engineDeadlineMs === undefined
        ? []
        : ["--deadline-ms", String(options.engineDeadlineMs)]),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  let peakRssBytes: number | undefined;
  let supervisorKilled = false;
  const startedAt = performance.now();

  const sampleRss = () => {
    const rss = sampleRssBytes(proc.pid);
    if (rss !== undefined) {
      peakRssBytes =
        peakRssBytes === undefined ? rss : Math.max(peakRssBytes, rss);
      if (rss > rssLimitBytes && !supervisorKilled) {
        supervisorKilled = true;
        proc.kill("SIGKILL");
      }
    }
  };
  // One sample at once, so a child that ends before the first interval tick
  // (a short engine deadline) still has a recorded RSS.
  sampleRss();
  const sampleTimer = setInterval(sampleRss, RSS_SAMPLE_INTERVAL_MS);

  const killTimer = setTimeout(() => {
    if (!supervisorKilled) {
      supervisorKilled = true;
    }
    proc.kill("SIGKILL");
  }, deadlineMs);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  clearInterval(sampleTimer);
  clearTimeout(killTimer);
  const timeToTerminationMs = performance.now() - startedAt;

  let childOutput: ChildRunOutput | undefined;
  try {
    const lastLine = stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .at(-1);
    childOutput = lastLine
      ? (JSON.parse(lastLine) as ChildRunOutput)
      : undefined;
  } catch {
    childOutput = undefined;
  }

  const exitCode = proc.exitCode;
  const exitSignal = proc.signalCode ?? null;
  const outcome = applyExpectationOverride(
    classifyOutcome(options.category, supervisorKilled, childOutput),
    childOutput,
    options.expect,
  );

  return {
    fixtureId: options.fixtureId,
    runtime: options.runtime,
    category: options.category,
    outcome,
    timeToTerminationMs,
    peakRssBytes,
    exitCode,
    exitSignal,
    supervisorKilled,
    childOutput,
    stderrTail: stderr.length > 0 ? stderr.slice(-2000) : undefined,
  };
}

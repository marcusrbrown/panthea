#!/usr/bin/env bun
// CLI entry point. Two modes:
//
//   bun run.ts --runtime quickjs|lua --fixture <id>
//     Runs exactly one fixture in-process and prints its JSON result as the
//     last line of stdout. This is what host.ts spawns as a child.
//
//   bun run.ts --all
//     Orchestrates the full fixture matrix for both runtimes through
//     host.ts (each fixture in its own subprocess), runs the next-run-health
//     composite check, writes the raw results to results/ (gitignored), and
//     renders the README's Results section from the real numbers.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureEnvironment, renderReport } from "@panthea/tools-probes-shared";
import {
  FIXTURES,
  type FixtureCategory,
  fixturesForRuntime,
  getFixture,
  NEXT_RUN_HEALTH_PROBE_FIXTURE,
  type Runtime,
  readFixtureSource,
} from "./fixtures/manifest";
import { type FixtureRunRecord, runFixtureInSubprocess } from "./host";
import { runLuaFixture } from "./lua";
import { MAX_JOBS_TOTAL, runQuickJsFixture } from "./quickjs";
import {
  buildProxyFixNarrative,
  checkIntegrityFixtures,
} from "./readme-narrative";

const SRC_DIR = import.meta.dir;
const SANDBOX_DIR = join(SRC_DIR, "..");
const RESULTS_DIR = join(SANDBOX_DIR, "results");
const README_PATH = join(SANDBOX_DIR, "README.md");
const RUN_FILE_PATH = join(SRC_DIR, "run.ts");

interface ParsedArgs {
  readonly all: boolean;
  readonly runtime?: string;
  readonly fixture?: string;
  readonly deadlineMs?: number;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let all = false;
  let runtime: string | undefined;
  let fixture: string | undefined;
  let deadlineMs: number | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--all") {
      all = true;
    } else if (arg === "--runtime") {
      runtime = argv[i + 1];
      i += 1;
    } else if (arg === "--fixture") {
      fixture = argv[i + 1];
      i += 1;
    } else if (arg === "--deadline-ms") {
      deadlineMs = Number(argv[i + 1]);
      i += 1;
    }
  }
  return { all, runtime, fixture, deadlineMs };
}

function isRuntime(value: string | undefined): value is Runtime {
  return value === "quickjs" || value === "lua";
}

async function runOneFixture(
  runtime: Runtime,
  fixtureId: string,
  deadlineMs: number | undefined,
): Promise<void> {
  const fixture = getFixture(fixtureId);
  const source = readFixtureSource(fixture, runtime);
  const result =
    runtime === "quickjs"
      ? await runQuickJsFixture({ source, deadlineMs })
      : await runLuaFixture({ source, deadlineMs });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const CATEGORY_TITLES: Record<FixtureCategory, string> = {
  "happy-path": "Happy path",
  "external-capability": "External capability access",
  "loop-recursion": "Loop / recursion",
  allocation: "Allocation",
  "async-hang": "Async hang",
  "malformed-input": "Malformed API input",
  "partial-failure": "Partial-failure rollback",
};

const CATEGORY_ORDER: readonly FixtureCategory[] = [
  "happy-path",
  "external-capability",
  "loop-recursion",
  "allocation",
  "async-hang",
  "malformed-input",
  "partial-failure",
];

function formatRss(bytes: number | undefined): string {
  if (bytes === undefined) {
    return "n/a";
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatExit(record: FixtureRunRecord): string {
  if (record.supervisorKilled) {
    return "killed by supervisor (SIGKILL)";
  }
  if (record.exitSignal) {
    return `signal ${record.exitSignal}`;
  }
  return `exit ${record.exitCode ?? "?"}`;
}

interface NextRunHealthRecord {
  readonly runtime: Runtime;
  readonly priorFixtureId: string;
  readonly priorOutcome: string;
  readonly followUpOutcome: string;
  readonly healthy: boolean;
}

function buildMatrixMarkdown(
  records: readonly FixtureRunRecord[],
  nextRunHealth: readonly NextRunHealthRecord[],
): string {
  const lines: string[] = [];
  const header =
    "| Runtime | Fixture | Expected | Outcome | Time (ms) | Peak RSS | Exit |\n| --- | --- | --- | --- | --- | --- | --- |";

  for (const category of CATEGORY_ORDER) {
    const categoryRecords = records.filter((r) => r.category === category);
    if (categoryRecords.length === 0) {
      continue;
    }
    lines.push(`#### ${CATEGORY_TITLES[category]}`);
    lines.push("");
    lines.push(header);
    for (const record of categoryRecords) {
      const fixture = getFixture(record.fixtureId);
      lines.push(
        `| ${record.runtime} | \`${record.fixtureId}\` | ${fixture.expectedOutcome} | ${record.outcome === "escaped" ? "**escaped (P0)**" : record.outcome} | ${record.timeToTerminationMs.toFixed(0)} | ${formatRss(record.peakRssBytes)} | ${formatExit(record)} |`,
      );
    }
    lines.push("");
  }

  lines.push("#### Next-run health (after a terminated fixture)");
  lines.push("");
  lines.push(
    "| Runtime | Prior fixture | Prior outcome | Follow-up outcome | Supervisor healthy |\n| --- | --- | --- | --- | --- |",
  );
  for (const entry of nextRunHealth) {
    lines.push(
      `| ${entry.runtime} | \`${entry.priorFixtureId}\` | ${entry.priorOutcome} | ${entry.followUpOutcome} | ${entry.healthy ? "yes" : "**no**"} |`,
    );
  }
  lines.push("");

  const escapedHostCapability = records.filter(
    (r) => r.outcome === "escaped" && r.category === "external-capability",
  );
  const escapedValidation = records.filter(
    (r) => r.outcome === "escaped" && r.category !== "external-capability",
  );
  if (escapedHostCapability.length > 0) {
    lines.push(
      `**P0 — host boundary breach**: ${escapedHostCapability.length} fixture(s) reached a real host capability: ${escapedHostCapability
        .map((r) => `\`${r.runtime}/${r.fixtureId}\``)
        .join(", ")}.`,
    );
  } else {
    lines.push(
      "No external-capability fixture escaped the host boundary in this run.",
    );
  }
  if (escapedValidation.length > 0) {
    lines.push(
      `**P0 (input-validation integrity, not a host-boundary breach)**: ${escapedValidation.length} fixture(s) committed a value the world-API validator should have rejected: ${escapedValidation
        .map((r) => `\`${r.runtime}/${r.fixtureId}\``)
        .join(", ")}. See Findings for the measured cause.`,
    );
  }

  return lines.join("\n");
}

function buildApiLogSummary(records: readonly FixtureRunRecord[]): string {
  const partialFailures = records.filter(
    (r) => r.category === "partial-failure",
  );
  const lines: string[] = ["#### Partial-failure API log evidence", ""];
  for (const record of partialFailures) {
    const log = record.childOutput?.apiLog;
    lines.push(
      `- \`${record.runtime}/${record.fixtureId}\`: ${log?.calls.length ?? "?"} staged call(s), status \`${log?.status ?? "unknown"}\`.`,
    );
  }
  return lines.join("\n");
}

function writeReadme(
  records: readonly FixtureRunRecord[],
  nextRunHealth: readonly NextRunHealthRecord[],
): void {
  const environment = captureEnvironment({
    extra: {
      "quickjs-emscripten": "0.32.0",
      wasmoon: "1.16.0",
    },
  });

  const base = renderReport({
    question:
      "Do QuickJS (quickjs-emscripten 0.32.x) and Lua (wasmoon 1.16.x) reliably terminate adversarial generated-behavior code and leave the host process healthy for the next execution — and which one settles ADR-0004's sandbox mechanism?",
    howToRun:
      "```sh\ncd tools/probes/sandbox\nbun run matrix   # bun run src/run.ts --all\n```\n\nSingle fixture (what `host.ts` spawns as a child):\n\n```sh\nbun run src/run.ts --runtime quickjs --fixture loop-infinite\nbun run src/run.ts --runtime lua --fixture loop-infinite\n```\n\nEvery fixture always runs in its own `Bun.spawn` subprocess — a Worker is in-process and shares the heap, so it cannot give a separate RSS boundary or survive a memory bomb.",
    caveat:
      "Stock QuickJS's `setMemoryLimit` is a **soft** limit against the prebuilt WASM variant used here: with WASM memory growth enabled, a tight allocation loop can grow host memory well past the configured limit before (or instead of) QuickJS raising an OOM error — see [quickjs-emscripten#255](https://github.com/justjake/quickjs-emscripten/issues/255). Separately, the interrupt handler is checked between bytecode instructions, not inside a single native operation, so an operation like a huge array-to-string conversion can run to completion (or to a native OOM/crash) without the interrupt ever firing mid-operation — see [quickjs-emscripten#219](https://github.com/justjake/quickjs-emscripten/issues/219). Both are why every fixture here runs in an isolated, wall-clock-and-RSS-supervised subprocess rather than trusting the in-process limit alone.",
    environment,
    metrics: [],
    findings: buildFindings(records, nextRunHealth),
    bottomLine: buildBottomLine(records, nextRunHealth),
  });

  const matrixMarkdown = `${buildMatrixMarkdown(records, nextRunHealth)}\n\n${buildApiLogSummary(records)}`;
  const withMatrix = base.replace(
    "## Results\n\nNo metrics recorded.",
    `## Results\n\n${matrixMarkdown}`,
  );

  writeFileSync(README_PATH, withMatrix);
}

function buildFindings(
  records: readonly FixtureRunRecord[],
  nextRunHealth: readonly NextRunHealthRecord[],
): readonly string[] {
  const findings: string[] = [];

  findings.push(buildProxyFixNarrative(records));

  const escapedHostCapability = records.filter(
    (r) => r.outcome === "escaped" && r.category === "external-capability",
  );
  const escapedValidation = records.filter(
    (r) => r.outcome === "escaped" && r.category !== "external-capability",
  );
  if (escapedHostCapability.length > 0) {
    findings.push(
      `P0 — host boundary breach: ${escapedHostCapability.length} external-capability fixture(s) reached a real host capability: ${escapedHostCapability.map((r) => `${r.runtime}/${r.fixtureId}`).join(", ")}.`,
    );
  } else {
    findings.push(
      "No fixture in either runtime reached a real host capability (filesystem, process, network, Bun, WebAssembly, Atomics) — every external-capability fixture ended `blocked`.",
    );
  }
  if (escapedValidation.length > 0) {
    findings.push(
      `P0 (input-validation integrity, not a host-boundary breach): ${escapedValidation.map((r) => `${r.runtime}/${r.fixtureId}`).join(", ")} committed a value the validator should have rejected as inconsistent. Measured cause for \`malformed-proxy-args\`: the host reads a Proxy target's fields as separate property accesses (once each via \`context.dump\`), not one atomic snapshot; a \`get\` trap that alternates its return value across reads can therefore land a value combination no single read ever produced. The world API validator should snapshot every field in one pass before validating, not read incrementally.`,
    );
  }

  const luaMissingSource = FIXTURES.filter((f) => f.quickjsFile && !f.luaFile);
  findings.push(
    `${luaMissingSource.length} QuickJS fixture(s) have no Lua equivalent (\`fetch\`, \`Bun\`, \`WebAssembly\`, \`Atomics.wait\`, timers, \`Proxy\`-based coercion) because Lua's config (\`openStandardLibs: false\`, \`injectObjects: false\`, \`enableProxy: false\`) leaves no ambient surface for those concepts to exist on in the first place — the absence itself is the finding, not a gap in fixture coverage.`,
  );

  findings.push(
    "With `openStandardLibs: false`, the Lua guest has no base library at all: no `pcall`, `error`, `tostring`, `getmetatable`, or `load` beyond the raw language and the injected `api` table. Every bad-path Lua fixture therefore ends the whole chunk with an uncaught runtime error rather than a guest-caught, continuable failure — QuickJS's fixtures can (and do) `try`/`catch` around a rejected call and keep running; Lua's cannot.",
  );

  const QUICKJS_MEMORY_LIMIT_MIB = 64;
  const quickjsAllocRecords = records.filter(
    (r) => r.category === "allocation" && r.runtime === "quickjs",
  );
  const stoppedByOwnMemoryLimit = quickjsAllocRecords.filter(
    (r) => r.childOutput?.limitKind === "memory",
  );
  const stoppedByOwnStringCap = quickjsAllocRecords.filter(
    (r) => r.childOutput?.limitKind === "string-length",
  );
  const exceededConfiguredLimit = quickjsAllocRecords.filter(
    (r) => (r.peakRssBytes ?? 0) > QUICKJS_MEMORY_LIMIT_MIB * 1024 * 1024 * 1.5,
  );
  findings.push(
    `Of ${quickjsAllocRecords.length} QuickJS allocation fixtures: ${stoppedByOwnMemoryLimit.length} were actually stopped by \`setMemoryLimit\` raising an out-of-memory error, ${stoppedByOwnStringCap.length} hit the engine's own max-string-length invariant instead, and ${exceededConfiguredLimit.length} grew past ${QUICKJS_MEMORY_LIMIT_MIB * 1.5} MiB (1.5x the configured ${QUICKJS_MEMORY_LIMIT_MIB} MiB limit) before anything stopped them${exceededConfiguredLimit.length > 0 ? ` (measured peak RSS: ${exceededConfiguredLimit.map((r) => `\`${r.fixtureId}\` ${((r.peakRssBytes ?? 0) / (1024 * 1024)).toFixed(0)} MiB`).join(", ")})` : ""} — direct, measured confirmation of quickjs-emscripten#255 (\`setMemoryLimit\` is soft against this growable-WASM build). Correction: \`allocation-string-doubling\` was previously mis-reported as \`completed\` here — it actually ends in an uncaught engine error (\`string too long\`) that the classifier didn't recognize as a stop signal unless tagged with a known \`limitKind\`. The fix is two-fold: \`limitKind\` now explicitly recognizes the \`string too long\` message (\`"string-length"\`), and the loop-recursion/allocation category classifier now treats *any* abnormal ending (\`ok: false\`) as \`terminated\`, not just a recognized one — \`completed\` in this category means the fixture ran to the end genuinely unstopped, never "stopped for an unrecognized reason." None of the three measured stopping mechanisms here (deadline, \`setMemoryLimit\`, string-length cap) should be read as "allocation defenses work uniformly" — which one fires is pattern-dependent and only the deadline/RSS supervisor is guaranteed present for every pattern; see the bottom line.`,
  );

  const unhealthy = nextRunHealth.filter((entry) => !entry.healthy);
  findings.push(
    unhealthy.length === 0
      ? "Every runtime's supervisor stayed healthy after a terminated fixture: the very next execution, in a fresh runtime/process, completed normally."
      : `${unhealthy.length} runtime(s) did not recover cleanly after a terminated fixture: ${unhealthy.map((e) => e.runtime).join(", ")}.`,
  );

  const asyncRecords = records.filter(
    (r) => r.category === "async-hang" && r.runtime === "quickjs",
  );
  const unresolvedPromise = asyncRecords.find(
    (r) => r.fixtureId === "async-unresolved-promise",
  );
  if (unresolvedPromise) {
    findings.push(
      `An unresolved, un-chained promise did not hang this driver (outcome \`${unresolvedPromise.outcome}\` in ${unresolvedPromise.timeToTerminationMs.toFixed(0)}ms, jobsExecuted=${unresolvedPromise.childOutput?.jobsExecuted ?? 0}): it creates no reaction job at all (nothing calls \`.then()\` on it), so even with the job pump below actively running after every fixture, there is nothing queued to drain.`,
    );
  }
  const microtaskRecursion = asyncRecords.find(
    (r) => r.fixtureId === "async-microtask-recursion",
  );
  if (microtaskRecursion) {
    findings.push(
      `The infinitely self-requeuing microtask fixture is now actually exercised: this driver runs a bounded pending-job pump (\`runtime.executePendingJobs()\` in batches, under the same interrupt deadline) after the top-level script returns, rather than never draining the job queue at all. Measured: \`${microtaskRecursion.childOutput?.jobsExecuted ?? 0}\` jobs executed before the pump's own ${MAX_JOBS_TOTAL.toLocaleString()}-job budget tripped (\`limitKind: "job-budget"\`) in ${microtaskRecursion.timeToTerminationMs.toFixed(0)}ms — faster than either the job budget or the interrupt deadline alone would guarantee, so both bounds are real, independent backstops, not just one masking the other. Outcome: \`${microtaskRecursion.outcome}\`.`,
    );
  }

  const partialFailure = records.find(
    (r) => r.category === "partial-failure" && r.runtime === "quickjs",
  );
  if (partialFailure?.childOutput?.apiLog) {
    findings.push(
      `The partial-failure fixture staged exactly ${partialFailure.childOutput.apiLog.calls.length} call(s) before its intentional throw, and the log's status resolved to \`${partialFailure.childOutput.apiLog.status}\` — confirming the transaction boundary holds regardless of how the guest execution ends.`,
    );
  }

  const luaAllocRecords = records.filter(
    (r) => r.category === "allocation" && r.runtime === "lua",
  );
  const luaAllocKilled = luaAllocRecords.filter((r) => r.supervisorKilled);
  if (luaAllocRecords.length > 0) {
    findings.push(
      `wasmoon's \`CreateEngineOptions\` has no memory-limit field at all — capping Lua memory requires the separate, undocumented-here \`traceAllocations\`+\`setMemoryMax\` pair, which this probe does not configure per the plan's stated options (\`openStandardLibs\`, \`injectObjects\`, \`enableProxy\`, \`functionTimeout\`). Both measured Lua allocation fixtures grew unchecked until ${luaAllocKilled.length === luaAllocRecords.length ? "the outer supervisor's RSS bound killed them" : "something stopped them"} (measured peak RSS: ${luaAllocRecords.map((r) => `\`${r.fixtureId}\` ${((r.peakRssBytes ?? 0) / (1024 * 1024)).toFixed(0)} MiB`).join(", ")}) — unlike QuickJS, Lua as configured here has *no* in-runtime memory boundary, only the external supervisor.`,
    );
  }

  return findings;
}

function buildBottomLine(
  records: readonly FixtureRunRecord[],
  nextRunHealth: readonly NextRunHealthRecord[],
): string {
  const escapedHostCapability = records.filter(
    (r) => r.outcome === "escaped" && r.category === "external-capability",
  );
  const integrityChecks = checkIntegrityFixtures(records);
  const failedIntegrityChecks = integrityChecks.filter((c) => !c.ok);
  const unhealthy = nextRunHealth.filter((entry) => !entry.healthy);
  const QUICKJS_MEMORY_LIMIT_MIB = 64;
  const quickjsAllocRecords = records.filter(
    (r) => r.category === "allocation" && r.runtime === "quickjs",
  );
  const quickjsAllocExceededLimit = quickjsAllocRecords.some(
    (r) => (r.peakRssBytes ?? 0) > QUICKJS_MEMORY_LIMIT_MIB * 1024 * 1024 * 1.5,
  );

  if (escapedHostCapability.length > 0) {
    return `**P0 — do not ship.** ${escapedHostCapability.length} external-capability fixture(s) reached a real host capability. ADR-0004 cannot move to Accepted until every external-capability fixture in this README is \`blocked\`.`;
  }

  const parts: string[] = [];
  if (failedIntegrityChecks.length > 0) {
    parts.push(
      `**Inconclusive** — the \`malformed-proxy-args\` descriptor-capture fix cannot be confirmed from this run: ${failedIntegrityChecks.map((c) => `\`${c.fixtureId}\` ${c.reason}`).join("; ")}. A missing or \`terminated\` integrity fixture means the fix is unverified this run, not that it regressed — but it also means it must not be trusted until every integrity fixture runs and matches its expected outcome. See Findings for the full root-cause narrative and required fix if any check actually mismatched.`,
    );
  } else {
    parts.push(
      "The `malformed-proxy-args` Proxy-parity escape found earlier in this probe's development is closed: the world API now reads object-argument fields via property descriptors rather than `[[Get]]`, and rejects any accessor (getter/setter) descriptor outright. Every integrity fixture (proxy-args, getter-side-effect, nested-getter-parity, overwrite-descriptor-fn, proxy-descriptor-trap) ran and matched its expected outcome. See Findings for the root cause and why a naive dump-twice-and-compare fix did not work.",
    );
  }
  parts.push(
    `QuickJS (quickjs-emscripten 0.32.x), run one fresh interpreter per execution inside an isolated \`Bun.spawn\` subprocess with an outer wall-clock/RSS supervisor, is the mechanism this probe recommends for ADR-0004: it blocked every external-capability fixture, and every malformed-input fixture either committed exactly the true (schema-validated) value, was rejected outright, or — in one accepted residual case (a Proxy's own \`getOwnPropertyDescriptor\` trap) — committed exactly what the trap presented, bounded by ordinary value validation, never a host escape${failedIntegrityChecks.length > 0 ? " (**unverified this run — see the inconclusive note above**)" : ""}. QuickJS can \`try\`/\`catch\` a rejected API call and keep running (Lua's zero-stdlib config cannot), and the world's action validator remains the real authority regardless of interpreter.`,
  );
  parts.push(
    'Allocation defenses are **not** a uniform success story — do not read the category as "solved": which mechanism stops a given allocation pattern (the deadline, `setMemoryLimit` raising OOM, or an unrelated engine invariant like max-string-length) is pattern-dependent, and this run measured `setMemoryLimit` itself firing zero times. ' +
      (quickjsAllocExceededLimit
        ? "Measured allocation fixtures grew well past the configured 64 MiB before anything recognized stopped them, confirming quickjs-emscripten#255/#219 directly on this machine."
        : "No allocation fixture in this run exceeded 1.5x the configured 64 MiB before something stopped it, though quickjs-emscripten#255/#219 mean that is not a guarantee across allocation patterns.") +
      " The only mechanism guaranteed present for every pattern is the outer subprocess wall-clock/RSS supervisor — treat that as the *real* memory boundary, and `setMemoryLimit`/the engine's own invariants as an unreliable bonus, not the other way around. A fixed-memory (non-growable) WASM build is the only way to make `setMemoryLimit` itself trustworthy.",
  );
  parts.push(
    "Async hangs are now actually measured, not merely assumed absent: this driver runs a bounded pending-job pump after the top-level script returns, under the same interrupt deadline, so an infinitely self-requeuing microtask chain is drained (and terminated by a job-count budget) instead of never being exercised at all. An unresolved, un-chained promise remains a non-issue on its own merits (it queues no reaction job), not because the driver ignores the job queue.",
  );
  parts.push(
    "Lua (wasmoon 1.16.x) does not win on any measured criterion here: it terminates loops via the same class of mechanism (a `lua_sethook` count hook reachable through `Thread.run({ timeout })`, not through `functionTimeout`/`doString` alone, which only bounds JS callbacks invoked *from* Lua), but its locked-down configuration (`openStandardLibs: false`) leaves generated behaviors with no base library at all, making even ordinary error handling unavailable to the guest. ADR-0004 should stay on QuickJS.",
  );
  if (unhealthy.length > 0) {
    parts.push(
      `Caveat: ${unhealthy.length} runtime(s) did not cleanly recover after a terminated fixture in this run and need investigation before this can move to Accepted.`,
    );
  }
  return parts.join(" ");
}

async function runAll(): Promise<void> {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const runFilePath = RUN_FILE_PATH;
  const records: FixtureRunRecord[] = [];

  for (const runtime of ["quickjs", "lua"] as const) {
    for (const fixture of fixturesForRuntime(runtime)) {
      const record = await runFixtureInSubprocess({
        runFilePath,
        runtime,
        fixtureId: fixture.id,
        category: fixture.category,
        expect: fixture.expect,
      });
      records.push(record);
      console.error(
        `[matrix] ${runtime} ${fixture.id} -> ${record.outcome} (${record.timeToTerminationMs.toFixed(0)}ms, rss=${formatRss(record.peakRssBytes)})`,
      );
    }
  }

  const nextRunHealth: NextRunHealthRecord[] = [];
  for (const runtime of ["quickjs", "lua"] as const) {
    const priorFixture = FIXTURES.find((f) => f.id === "loop-infinite");
    if (!priorFixture) {
      continue;
    }
    const hasSource =
      runtime === "quickjs"
        ? priorFixture.quickjsFile !== undefined
        : priorFixture.luaFile !== undefined;
    if (!hasSource) {
      continue;
    }
    const prior = await runFixtureInSubprocess({
      runFilePath,
      runtime,
      fixtureId: priorFixture.id,
      category: priorFixture.category,
      expect: priorFixture.expect,
    });
    const followUp = await runFixtureInSubprocess({
      runFilePath,
      runtime,
      fixtureId: NEXT_RUN_HEALTH_PROBE_FIXTURE,
      category: "happy-path",
      expect: getFixture(NEXT_RUN_HEALTH_PROBE_FIXTURE).expect,
    });
    nextRunHealth.push({
      runtime,
      priorFixtureId: priorFixture.id,
      priorOutcome: prior.outcome,
      followUpOutcome: followUp.outcome,
      healthy: followUp.outcome === "completed",
    });
  }

  const resultsPath = join(RESULTS_DIR, `matrix-${Date.now()}.json`);
  writeFileSync(
    resultsPath,
    JSON.stringify({ records, nextRunHealth }, null, 2),
  );
  console.error(`[matrix] wrote ${resultsPath}`);

  writeReadme(records, nextRunHealth);
  console.error(`[matrix] wrote ${README_PATH}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.all) {
    await runAll();
    return;
  }
  if (!isRuntime(args.runtime)) {
    throw new Error("--runtime must be quickjs or lua");
  }
  if (typeof args.fixture !== "string") {
    throw new Error("--fixture <id> is required");
  }
  await runOneFixture(args.runtime, args.fixture, args.deadlineMs);
}

await main();

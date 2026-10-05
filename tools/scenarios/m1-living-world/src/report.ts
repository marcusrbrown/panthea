// Turns the recorded steps and positive-control runs into the shared
// report harness's input, so every number in the README comes from the run.

import type {
  EnvironmentInfo,
  ReportInput,
} from "@panthea/tools-probes-shared";
import type { StepResult } from "./helpers";

export interface ControlResult {
  readonly name: string;
  /** What the control breaks on purpose, in one sentence. */
  readonly sabotage: string;
  readonly exitCode: number;
  /** The `FAIL` line the control run printed. */
  readonly failure: string;
}

export interface RunSummary {
  readonly steps: readonly StepResult[];
  readonly controls: readonly ControlResult[];
  readonly environment: EnvironmentInfo;
  readonly totalMs: number;
  readonly binaryBytes: number;
}

const HOW_TO_RUN = `\`\`\`sh
bun run --cwd tools/scenarios scenario:m1                                  # build the sidecar, run the story
bun run --cwd tools/scenarios scenario:m1 --skip-build                     # reuse the built sidecar
bun run --cwd tools/scenarios scenario:m1 --positive-control=archive       # must exit non-zero
bun run --cwd tools/scenarios scenario:m1 --positive-control=catch-up      # must exit non-zero
bun run --cwd tools/scenarios scenario:m1 --positive-control=journal       # must exit non-zero
bun run --cwd tools/scenarios scenario:m1 --positive-control=bad-proposals # must exit non-zero
bun run --cwd tools/scenarios scenario:m1 --positive-control=claim-owner   # must exit non-zero
bun run --cwd tools/scenarios scenario:m1 --positive-control=pause         # must exit non-zero
bun run --cwd tools/scenarios scenario:m1 --positive-control=underworld    # must exit non-zero
bun run --cwd tools/scenarios scenario:m1 --write-readme [--jobs=4]        # story, then every control four at a time (--jobs=N), rewrites this file
\`\`\`

The scenario builds the sidecar with \`apps/simulation/scripts/build-sidecar.sh\`
and runs the compiled binary directly, with no Tauri. Each run uses a fresh
temporary app-data directory (\`PANTHEA_APP_DATA_DIR\`), so the authored Greek
world is the seed. The harness writes a launch token to the binary's stdin,
keeps stdin open, reads \`PANTHEA_PORT\` from stdout, and calls the sidecar
over authenticated loopback HTTP. Every \`POST /proposals\` carries a
producer-generated \`proposalId\`; outcomes are read through
\`/trace/proposal?id=\` and \`/trace/event?id=\`. The run stops at the first
violated invariant, exits 1, kills every child, and removes its temporary
directory. It is not part of \`bun run check\`; only the pure helpers in
\`src/helpers.test.ts\` and \`src/report.test.ts\` are.

Assertions are about committed world state. Whatever the sidecar serves is
read through its API: the decoded frame (tick, sequence, status, state), the
trace queries (proposal outcomes, event chains, presentation receipts), and a
proposal retry's status. Only facts no endpoint exposes are read from the
store, read-only: event payloads and correlation ids, the wall cursor and paused
flag, observation counts, the proposal journal, catch-up progress, the set of
stored receipts, integrity checks, slot contents, and any state inspected while
the sidecar is stopped or killed. Waits are bounded polls that name the
invariant they wait for, never fixed sleeps that decide a result. The harness
does manipulate wall time and processes; that is the fault injection, described
per step below.

Fault injections, one per negative claim:

- **Machine slept for three hours:** with the sidecar stopped, the harness
  moves the persisted wall cursor back by 10,800,000 ms. The next start sees a
  gap of three times the one-hour cap and runs startup catch-up.
- **Killed during catch-up:** \`SIGKILL\` once catch-up has committed at least
  two 60-second chunks of the capped backlog.
- **Killed with a proposal accepted and no tick run:** \`SIGKILL\` right after a
  \`202\`, then the cursor is moved back two minutes so the restart's catch-up
  is what runs the proposal.
- **Corrupted archive:** one byte inside stored event data is changed in a
  copy of an export.
- **Paused world:** an operator \`/pause\` holds the world still while a fixture
  repair is chosen and accepted.
- **Malformed, false, and stale proposals:** posted from JSON files in
  \`src/fixtures/\`.`;

const NOT_COVERED = `- **The packaged desktop app and the view.** No Tauri, no rendering. The client
  modules run headlessly against a polling transport. The packaged app is
  covered by [m1-packaged-shell](../m1-packaged-shell/README.md) and the Unit 8
  view gate.
- **The shell's exact forwarding.** The harness polls \`GET /frame\` every 250 ms
  and forwards a frame when its sequence, status, or session id changes. The
  shell polls once a second.
- **Real OS sleep and wake, and clock jumps.** Both sleeps are a rewritten
  cursor in a stopped store, not a slept machine. Backward clock jumps are not
  driven.
- **Power loss.** \`SIGKILL\` stops the process; it does not drop unsynced pages.
- **Disk-full and store errors.** No degraded status is provoked.
- **Import staging crashes.** Only a corrupted archive is injected, not a crash
  during import.
- **Trace records in archives.** Archives carry world state and the proposal
  journal with each entry's outcome, but not trace records. The run compares
  journals and event histories across export, import, and restore; it does not
  (and cannot) compare causal trace, so a restored branch has none for history
  before the restore.
- **A kill after the catch-up summary was published.** The service persists
  the summary in the commit that ends the backlog and serves it from the first
  frame after a restart, so the old window is closed. That is covered by the
  subprocess tests in \`apps/simulation/src/index.test.ts\`, not by this run: S13
  kills mid catch-up, not after the backlog ended. No export is taken while a
  backlog is open, so archives carrying an open backlog's progress are not
  driven here either.
- **Time between a kill and its restart.** The cap bounds the remaining
  backlog, so seconds that pass while the service is down are new gap, applied
  once on top of the capped total. S13 measures that extra (0 s in the recorded
  run) and bounds it by the measured downtime; it does not assert an exact total
  of one cap.
- **M2 and later.** No model proposals, memory, or generated behaviors; the
  causal chain is the M1 part of O04 only.
- **Balance.** Fire spread, economy, and repair numbers are observed, not
  tuned or asserted beyond the rules in the content files.`;

function kib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MiB`;
}

export function buildReportInput(summary: RunSummary): ReportInput {
  const metrics = summary.steps.flatMap((step) =>
    step.measurements.map((measurement) => ({
      name: `${step.id} ${measurement.name}`,
      unit: measurement.unit,
      samples: [measurement.value],
    })),
  );

  const stepFindings = summary.steps.map(
    (step) =>
      `**${step.id} ${step.title}** (${(step.elapsedMs / 1000).toFixed(1)} s). Asserts: ${step.invariant} Measured: ${step.result}.`,
  );
  const noteFindings = summary.steps.flatMap((step) =>
    step.notes.map((note) => `**${step.id} note.** ${note}`),
  );
  const controlFindings = summary.controls.map(
    (control) =>
      `**Positive control \`${control.name}\`.** ${control.sabotage} The run exited ${control.exitCode} with: ${control.failure}`,
  );

  const allNonZero = summary.controls.every(
    (control) => control.exitCode !== 0,
  );
  const bottomLine = `All ${summary.steps.length} steps held on the tree this README was committed with. The story ran in ${(summary.steps.reduce((sum, step) => sum + step.elapsedMs, 0) / 1000).toFixed(0)} s; the whole evidence run, with every control, took ${(summary.totalMs / 1000).toFixed(0)} s. ${
    allNonZero && summary.controls.length > 0
      ? `All ${summary.controls.length} positive controls exited non-zero, so the assertions they target are live. `
      : ""
  }The compiled sidecar binary was ${kib(summary.binaryBytes)}.`;

  return {
    question:
      "Does the compiled sidecar keep a persistent living world causally honest end to end: routines act unattended, a strike becomes fire, lost service, and repair, worship grants a favor that expires, legends stay attributed records, bad proposals are rejected without effect, pause and a kill mid catch-up past the cap never applies time twice, an accepted proposal survives a kill, archives survive corruption and restore into a branch, and the strike's ignition traces from its observation through the headless client's presentation receipt?",
    howToRun: HOW_TO_RUN,
    caveat: `Not covered:\n\n${NOT_COVERED}`,
    environment: summary.environment,
    metrics,
    findings: [...stepFindings, ...noteFindings, ...controlFindings],
    bottomLine,
  };
}

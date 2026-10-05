// Turns the recorded steps, positive-control runs, and the real-inference
// record into the shared report harness's input, so every number in the README
// comes from a run.

import type {
  EnvironmentInfo,
  ReportInput,
} from "@panthea/tools-probes-shared";
import type { StepResult } from "../../m1-living-world/src/helpers";
import type { RealRecord } from "./real";

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
  readonly real: RealRecord | undefined;
}

const HOW_TO_RUN = `\`\`\`sh
bun run --cwd tools/scenarios scenario:m2                                    # build the sidecar, run the scripted story
bun run --cwd tools/scenarios scenario:m2 --skip-build                       # reuse the built sidecar
bun run --cwd tools/scenarios scenario:m2 --positive-control=<name>          # must exit non-zero; names below
bun run --cwd tools/scenarios scenario:m2 --real [--seconds=180]             # both gods through local Ollama; asserts properties, writes real-run.json
bun run --cwd tools/scenarios scenario:m2 --episodes=3 --reasoning-effort=none   # the experience gate on the local baseline, qwen3-8b-4k (set up once: ollama create qwen3-8b-4k -f tools/probes/inference-baseline/Modelfile.qwen3-8b-4k)
bun run --cwd tools/scenarios scenario:m2 --episodes=3 --model=<model> --base-url=https://<host>/v1 [--key-ref=<keyRef>]   # the gate against a hosted endpoint; the key is read once from the Keychain
bun run --cwd tools/scenarios scenario:m2 --write-readme [--jobs=4]          # story, then every control four at a time (--jobs=N), rewrites this file from a fresh run and real-run.json
\`\`\`

Controls: \`kill-journal\`, \`kill-inference\`, \`chain\`, \`isolation\`, \`trace\`,
\`stale\`, \`catch-up-inference\`, \`restore-memory\`, \`petition-privacy\`, and, for the
practice steps and the practice properties of the real run, \`thread-reopened\`,
\`no-progress-advances\`, \`thread-no-ending\`, \`obligated-turn-unrecorded\`,
\`ending-no-consequence\`, \`practices-missing\`, \`consequence-no-effect\`,
\`contest-no-standing\`.

Practice steps (settlement and supplication, scripted gods, the world's real
rules; each reply is a function of the prompt its god was shown, so it names
only what that god could name):

- **S13** A refused demand closes its thread; both remember who refused; the
  repeated demand is rejected no-progress, the world records the refusal, and
  Hera's next prompt says why.
- **S14** A newer account opens a linked successor; Zeus's report naming the
  thread's subject makes no progress while one naming another agent is told;
  he accepts, performs, and the world sees it (standing won, Hera warms).
- **S15** A sworn term is broken and costs the oath penalty; counteroffers run
  out, and a counter restating an earlier offer makes no progress; Hera's
  refusal is remembered.
- **S16** Supplication: terms kept are fulfilled; terms broken cost the wolf
  stake, and the mortal keeps its memory, feelings, and identity.
- **S17** A contest for favour: Poseidon tells a legend before the fishers at
  the ferry dock; Athena, standing there, is offered a contest over it as a
  choice (a copyable object the world's validator already took) and opens it.
  She tells two legends to the dock's people and he tells none, so at the window's
  end the world decides for her: her standing at the dock rises and his falls,
  each recorded as a motif citing the closing, and Poseidon is offered no new
  contest over what Athena did before the close. The step runs a 25-tick window
  (\`PANTHEA_PRACTICE_BALANCE\`) in place of the authored five minutes.
- **S18** The real run's practice properties (\`src/practice-analysis.ts\`) hold
  over the whole scripted run. A practice control breaks the data first and the
  property it targets must fail; \`src/practice-analysis.test.ts\` holds the same
  controls as unit tests.

The transcript (\`src/transcript.ts\`) shows each thread's cause, participants,
moves, ending, and recorded changes, the threads open at the end with their age
and what each waits on, every move judged no progress, and a classification of
each turn an obligated god takes while its obligation is open (R12; an
acceptance binds, so there is no renegotiation class, and bargaining is for a
thread still open): the action the term calls for, committed, is *performed*; a
turn that did something else is *waited for a named event* when its prompt names
what stops it (the digest's UNPERFORMABLE obstacle, or no mortal at the place a
legend is to be told); every other turn, an attempt to bargain over the accepted
thread included, is *knowingly risked breach*, since the obligation led the
prompt.

The scenario builds the sidecar with \`apps/simulation/scripts/build-sidecar.sh\`
and runs the compiled binary directly, with no Tauri, extending the
[M1 harness](../m1-living-world/README.md): the same sidecar driver, store
reads, bounded waits, and positive-control pattern. Each run uses a fresh
temporary app-data directory. The only scripted piece is the model provider: a
loopback OpenAI-compatible endpoint the sidecar reaches through its production
routing path, selected by the launch config line the harness sends. It answers each god from a
queue the harness fills, or from a policy that is a pure function of the prompt
the god was shown (Hera's), and it records every request with when it arrived.
Stage-setting that is not a god's choice (moving the farmer to the tavern,
moving Hera while a turn is in flight) is posted as fixture proposals over
\`/proposals\`. Everything the sidecar serves is read through its API; facts no
endpoint exposes (the proposal journal, event payloads, the trace's requests,
a restored slot's state) are read from the store, read-only.

Fault injections, one per negative claim:

- **SIGKILL after a turn journaled:** the provider holds Zeus's reply, the
  world is paused, the reply is released so the turn journals, and the
  sidecar is killed with the proposal pending.
- **SIGKILL during inference:** the provider holds Hera's reply and the
  sidecar is killed while the request is in flight.
- **Half-hour gap:** with the sidecar stopped, the harness moves the persisted
  wall cursor back 1,800,000 ms; the restart's catch-up applies it.
- **Stale proposal:** Hera's turn is held while a fixture moves her.
- **Hostile archive:** the projection row of an export has Hera's memory and
  feeling dropped and its content hash recomputed.`;

const NOT_COVERED = `- **Reasoning quality.** The scripted run proves the causal plumbing; it says
  nothing about whether a model chooses well. The real run asserts properties
  a valid run must have, not that the episodes are good: that is the owner's
  experience gate.
- **Causation in the real run.** "A changed next action" compares a god's
  action before and after its first belief or feeling. A model that varies
  its choices anyway satisfies it; it shows the chain is wired through to a
  real model's context, not that the belief caused the change. The scripted
  run shows causation with a policy that depends on the prompt.
- **The pending-proposal gate at process level.** The service dispatches a turn
  only after a live tick, and a tick consumes every pending proposal, so a
  pending proposal and a new turn for its god cannot coexist except across a
  pause. S2 asserts what is observable there (no request while paused, one
  commit after); the gate itself is unit-tested in
  \`apps/simulation/src/agents.test.ts\`.
- **The catch-up window's edge.** The harness reads the sidecar's
  catch-up-started and catch-up-finished lines through a pipe; a request within
  25 ms before the finish line is not judged. A live tick after a catch-up cannot
  land that close in practice, and the \`catch-up-inference\` control shows a
  request inside the window is caught.
- **Power loss.** \`SIGKILL\` stops the process; it does not drop unsynced pages.
- **One turn at a time, two gods.** Scheduling, fairness, and cooldowns are
  Unit 10, not measured here.
- **Model routing settings and credentials.** The routing config is a file the
  operator names; the settings view and credential storage are Unit 3.
- **The packaged desktop app and the view.** No Tauri, no rendering.`;

function kib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MiB`;
}

function realFindings(real: RealRecord | undefined): string[] {
  if (real === undefined) {
    return [
      "**Real inference.** No real-inference run is recorded yet: run `scenario:m2 --real`.",
    ];
  }
  const a = real.analysis;
  const properties = a.properties.map(
    (property) =>
      `${property.ok ? "held" : "FAILED"}: ${property.name} (${property.detail})`,
  );
  const exhaustion =
    a.exhaustion.length === 0
      ? "no request was exhausted"
      : a.exhaustion
          .map((e) => `${e.count} x ${e.reason}: ${e.detail}`)
          .join("; ");
  return [
    `**Real inference (${real.model}${real.reasoningEffort === "none" ? ", reasoning off" : ""} on ${real.hardware}, ${real.durationMs / 1000} s, ${real.ticks} ticks, ${real.ranAt}).** ${a.requests.total} requests: ${a.requests.intent} answered (${a.requests.native} native, ${a.requests.repaired} repaired), ${a.requests.exhausted} exhausted. Latency p50 ${a.latencyMs.p50} ms, p95 ${a.latencyMs.p95} ms. Prompt p50 ${a.promptChars.p50} characters, max ${a.promptChars.max}. Proposals ${JSON.stringify(a.proposals)}; outcomes ${JSON.stringify(a.outcomes)}. Frames showed model-degraded in ${(a.degradedShare * 100).toFixed(0)}% of polls.`,
    `**Real inference, exhaustion.** ${exhaustion}.`,
    `**Real inference, properties.** ${properties.join("; ")}.`,
    "**Real inference, limits.** One short run of a 3B model on one machine, unscripted and therefore different every time; the numbers are a record of this run, not a benchmark. It does not show that a belief caused a changed action, that the episodes are good, or how a longer run behaves.",
  ];
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
  const bottomLine = `All ${summary.steps.length} scripted steps held on the tree this README was committed with. The story ran in ${(summary.steps.reduce((sum, step) => sum + step.elapsedMs, 0) / 1000).toFixed(0)} s; the whole evidence run, with every control, took ${(summary.totalMs / 1000).toFixed(0)} s. ${
    allNonZero && summary.controls.length > 0
      ? `All ${summary.controls.length} positive controls exited non-zero, so the assertions they target are live. `
      : ""
  }The compiled sidecar binary was ${kib(summary.binaryBytes)}.`;

  return {
    question:
      "Does the compiled sidecar carry the M2 causal story end to end with the gods taking turns through the production routing path: Zeus strikes and the witnesses remember, an uninformed god's context has no trace of it, Zeus tells Hera an exaggerated account with a claim, her belief changes how she feels about him with the belief as cause, her next proposal shows it, the destruction traces to the strike, a stale god proposal is rejected, no model is asked during catch-up or replay, memory and relationships survive a restart and a restore, and a SIGKILL after a turn journaled or during inference costs no more than one turn?",
    howToRun: HOW_TO_RUN,
    caveat: `Not covered:\n\n${NOT_COVERED}`,
    environment: summary.environment,
    metrics,
    findings: [
      ...stepFindings,
      ...noteFindings,
      ...controlFindings,
      ...realFindings(summary.real),
    ],
    bottomLine,
  };
}

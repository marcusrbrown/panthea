// Turns the recorded steps, positive-control runs, and the real-inference
// record into the shared report harness's input, so every number in the README
// comes from a run.

import type {
  EnvironmentInfo,
  ReportInput,
} from "@panthea/tools-probes-shared";
import type { StepResult } from "../../m1-living-world/src/helpers";
import type { RealRecord } from "./real";

/**
 * One positive control and how it was proved. A process control reran the story
 * in a child process and must have exited non-zero; an in-process control broke
 * a copy of the story's own collected data and must have failed its property.
 */
export type ControlResult = {
  readonly name: string;
  /** What the control breaks on purpose, in one sentence. */
  readonly sabotage: string;
  /** The `FAIL` line the control produced. */
  readonly failure: string;
} & (
  | {
      readonly via: "process";
      readonly exitCode: number;
      /** What the child ran: the story up to the step the control breaks, or only that step in a world of its own. */
      readonly scope: string;
      /** How long the child ran, in seconds. */
      readonly seconds: number;
    }
  | { readonly via: "in-process" }
);

export type ProcessControlResult = Extract<ControlResult, { via: "process" }>;

const tripped = (control: ControlResult): boolean =>
  control.via === "in-process" || control.exitCode !== 0;

export interface RunSummary {
  readonly steps: readonly StepResult[];
  readonly controls: readonly ControlResult[];
  readonly environment: EnvironmentInfo;
  readonly totalMs: number;
  readonly binaryBytes: number;
  readonly real: RealRecord | undefined;
}

/** The procedure for the unattended one-hour run, written from what the code does. */
const UNATTENDED_PROCEDURE = `### Unattended one-hour run (M2 exit gate)

One world, kept, run for 60 minutes of running time against local Ollama. A loopback
proxy cuts the model off for a while and restores it; the sidecar is then stopped
cleanly, the world is put 90 minutes behind, and the restart catches up the capped 60
minutes. The run ends with an export, a rebuild from the event log in a separate
process, and a report. It is the M2 exit gate and needs a real hour on a quiet machine.

**Prepare the machine**

- Close other agent sessions and heavy apps. Rancher Desktop and Docker count. Do not
  use the machine during the hour.
- \`uptime\`: the 1-minute load average under about 2 and settled. \`sysctl vm.swapusage\`:
  swap used steady, not climbing, across two readings a minute apart.
- Ollama running, with \`granite3.3-8b-4k\` created. To create it, use the
  \`ollama create\` line in \`tools/probes/inference-baseline/README.md\`.

**The command**

\`\`\`sh
bun run --cwd tools/scenarios scenario:m2 --unattended --reasoning-effort=none
\`\`\`

It builds the sidecar first; add \`--skip-build\` to reuse a sidecar you built from this
tree. The model is \`granite3.3-8b-4k\` unless you pass \`--model=\`. The evidence goes to
\`tools/scenarios/m2-greek-cast/unattended/<UTC timestamp>/\`, or to \`--out=DIR\`. Allow
about 75 minutes: the 60 running minutes, plus the model's warm-up, the sidecar build
(unless skipped), the catch-up (seconds), and the end capture (export and rebuild).

**What the run keeps**

All of it lands in the run folder:

- \`report.md\`: the report. Start here.
- \`run.json\`: the structured result: phase boundaries, checks, the threshold result,
  the baseline, the memory summary.
- \`baseline.json\`: store, WAL and archive sizes, the rebuild time, the event count,
  whether the rebuild equals the live world, and the import proof.
- \`frames.jsonl\`, \`proxy-records.jsonl\`, \`memory.jsonl\`: the tick series, the model
  responses (status, latency, token count; no prompt or reply text), and the memory
  samples (marked observation or post-run).
- \`diagnostics/\`: only after a fault or a failure: Ollama's loaded-model table, the
  tail of its server log (marked stale when the log predates the run), and memory.
- \`app-data/\` (the store and its WAL) and \`archive.sqlite\`: **git-ignored**, kept
  locally. They run to hundreds of megabytes. Everything else is small and committable.

**Reading the result**

- Exit \`0\` is PASS: every phase ran and every threshold held.
- Exit \`1\` is a gate failure: a threshold row failed, the sidecar died, a catch-up
  check failed, or the report could not be built. \`report.md\` or \`run.json\` says which.
- Exit \`2\` is Ollama's empty-response fault (five empty replies in a row). It is the
  infrastructure's, not a result. The run captures \`diagnostics/\` and stops; rerun it.
- \`report.md\` has the verdict at the top, the "## Threshold table" with each row's
  measured value and limit, and the "## Rating sheet" with the episodes to score. The
  rubric is the acceptance rubric in \`docs/product/acceptance.md\`, scored 0, 1 or 2
  by the owner.
- M2 exits only on a PASS verdict and the owner's approval of the rated episodes.

**Development runs**

\`--unattended-minutes=N\` shortens the running phases in proportion (the 90-minute gap is
not scaled). \`--scripted=answer\` replaces Ollama with the scripted provider, whose gods
tell legends; \`--scripted=empty-200\` makes every reply Ollama's empty response, so the
run ends as the fault in seconds. Use them with \`--skip-build\`; for example
\`--unattended --unattended-minutes=6 --scripted=answer --skip-build\`. A run shorter
than 60 minutes is "not a gate run": its report shows the table, its failed rows do not
change its exit code, and it never gives a verdict. \`--unattended\` cannot be combined
with \`--episodes\`, \`--real\`, \`--write-readme\`, \`--positive-control\`, \`--steps\`,
\`--base-url\` or \`--key-ref\`.`;

const HOW_TO_RUN = `\`\`\`sh
bun run --cwd tools/scenarios scenario:m2                                    # build the sidecar, run the scripted story
bun run --cwd tools/scenarios scenario:m2 --skip-build                       # reuse the built sidecar
bun run --cwd tools/scenarios scenario:m2 --steps=S21,S24                    # only the staged steps S21 to S27 (each starts a world of its own); the tool for working on one
bun run --cwd tools/scenarios scenario:m2 --positive-control=<name>          # a process control; must exit non-zero; names below
bun run --cwd tools/scenarios scenario:m2 --real [--seconds=180]             # both gods through local Ollama; asserts properties, writes real-run.json
bun run --cwd tools/scenarios scenario:m2 --episodes=3 --reasoning-effort=none   # the experience gate on the local baseline, granite3.3-8b-4k (set up once: ollama create granite3.3-8b-4k -f tools/probes/inference-baseline/Modelfile.granite3.3-8b-4k)
bun run --cwd tools/scenarios scenario:m2 --episodes=3 --model=<model> --base-url=https://<host>/v1 [--key-ref=<keyRef>]   # the gate against a hosted endpoint; the key is read once from the Keychain
bun run --cwd tools/scenarios scenario:m2 --unattended --reasoning-effort=none   # the one-hour run on local Ollama, one world kept under unattended/<timestamp>/; see "Unattended one-hour run" below
bun run --cwd tools/scenarios scenario:m2 --write-readme [--jobs=4]          # story (with the practice and world controls in-process), then each process control four at a time (--jobs=N), rewrites this file from a fresh run and real-run.json
\`\`\`

Controls come in three kinds. A **process control** runs in a child process with one
thing broken mid-flight, and that run must exit non-zero. The first four rerun the story
up to the step they break: \`chain\`, \`isolation\`, \`trace\`, and \`petition-privacy\`.
The next six are **staged-world controls**: each runs only its own step (S21 to S27
start worlds of their own) with the one thing that step stages left out, so it costs
that step and none of the story: \`strike-chain\` (S21), \`refusal-revenge\` (S22),
\`no-answerer\` (S24), \`director-off\` (S25), \`remote-bless\` (S26), and
\`remote-strike\` (S27). A **world control** is in-process like
the practice controls: \`trouble-route\` breaks the evidence S23 collected, and S23's
own check must fail on it. A **practice control**
breaks a copy of the data the one story run collected, in-process, at the end of
S20, and the practice property it targets must fail on the copy; none reruns the
story, so \`--positive-control\` does not take them and every story run applies
all of them: \`thread-reopened\`, \`no-progress-advances\`, \`thread-no-ending\`,
\`obligated-turn-unrecorded\`, \`ending-no-consequence\`, \`practices-missing\`,
\`consequence-no-effect\`, \`contest-no-standing\`, \`alliance-unsealed\`,
\`god-silent\`, and \`practice-absent\`. (2026-10-05: these eleven moved
in-process; \`alliance-unsealed\` had been a mid-story rewrite in S18 and is now the
same data mutation as the rest.)

Controls dropped on 2026-10-05, each one a whole story rerun to re-prove a property
that a test of the service already proves in-process. The story steps that inject the
same faults stay (S2, S3, S9, S10, S11); only the sabotaged reruns are gone:

- \`kill-journal\` (the pending proposal deleted from the journal after the kill) is
  covered by \`apps/simulation/src/agents.test.ts\`, "a restart > after a kill that
  followed journaling: the proposal runs once, and the god gets no second turn while
  it is pending".
- \`kill-inference\` (two legends for the re-asked turn) is covered by "a restart >
  after a kill during inference: the god reasons afresh and exactly one proposal
  commits", same file.
- \`catch-up-inference\` (a provider request inside the catch-up window) is covered by
  "the lifecycle seam > through a real catch-up run no turn starts, on every chunk it
  commits; with the gate removed the same probe sees one start", same file, which
  carries its own proof that the probe can fail.
- \`stale\` (the fixture that moves Hera skipped) is covered by "a god's turn > is
  revalidated at admission: the world moved while the model was thinking, so the
  proposal is rejected stale-target", same file.
- \`restore-memory\` (Hera's memory dropped from the archive to be restored, hash
  recomputed) is covered by \`packages/persistence/src/archive.test.ts\`,
  "importArchive: the projection must be what the event log makes > error path: a
  rehashed archive whose live projection no event produced is rejected as corrupt; no
  slot is created", with "a rehashed archive whose events were edited after export no
  longer matches its projection" beside it. S11 also still sends the hostile archive
  (Hera's memory dropped, hash recomputed) through the compiled binary and asserts the
  refusal.

Practice steps (settlement, supplication, contest, and alliance; scripted gods, the world's real
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
- **S18** A sealed alliance: Hephaestus walks to Hermes at the dock and tells him
  of a kindness; Hermes asks him for an alliance over it, and he accepts. The
  world ends the thread sealed, each of the two is allied with the other by one
  relationship-changed event citing its memory of the sealing, and no other
  relationship in the world is allied. \`alliance-unsealed\` rewrites the sealing
  as a plain performance.
- **S19** Hades takes a part in a thread: he walks to the dock and tells Hermes
  something; Hermes demands of him, and Hades refuses, is named as the refuser,
  and is remembered for it.
- **S20** The real run's practice properties (\`src/practice-analysis.ts\`) hold
  over the whole scripted run, and the full cast played: each of the seven gods
  made at least one practice move, and every practice appeared (a settlement, a
  supplication with terms, a contest, a breach with transformation, a sealed
  alliance, and travel). The result lists each god's practices and thread
  endings. Then each practice control breaks a copy of that data in-process and the
  property it targets must fail (\`god-silent\` silences the god that opened the first
  thread; \`practice-absent\` deletes the contest); \`src/practice-analysis.test.ts\`
  holds the same controls as unit tests on a fixture.

World steps (S21 to S27 start a world of their own beside the story's, created with story-only rules that make the
world's own logic produce the thing within a few ticks, so nothing waits on chance and no step depends on S1 to S20:
a greedy temperament at 1000 per mille to steal (every temperament, in S27, so an owner of a building steals too),
revenge at 1000 per mille, a trouble floor of a few ticks, a defection threshold above any feeling, and a director
interval of three ticks. The wrongs, prayers, troubles, and fires
are the world's, drawn on its persisted generator and judged by the real validator; the harness posts only moves and
prayers for mortals, as \`stageLoss\` does, and scripts what the gods answer, each reply a function of the prompt its god
was shown; nothing is injected as an event):

- **S21** A theft between mortals of different patrons becomes the victim's prayer
  to its patron, who strikes the wrongdoer (the world takes its most valuable
  carried good up to the cap, answers the prayer, and counts the strike as an act
  for contests); the wrongdoer, struck by a god, prays to its own patron naming
  that god, who demands redress of it, citing the harm. \`strike-chain\` leaves the
  victim's patron only waiting.
- **S22** A victim whose patron refuses its prayer takes exactly one revenge, and
  the wrongdoer's own refused prayer about it leads to none: revenge is damped.
  \`refusal-revenge\` has the patron answer by striking instead, so there is no revenge.
- **S23** A trouble in a god's domain is prayed about to that god, whoever the
  afflicted mortal reveres; the domain god's prompt marks it, the patron's does
  not list it. \`trouble-route\` is in-process: it reads the recorded prayer as if it
  had gone to the patron, and the step's own check fails on it.
- **S24** A mortal refused by its patron keeps it while no other god has answered
  it; when the domain god then answers its prayer, it defects to that god: a
  patron-changed event cites the answer and the unanswered prayer, exactly the god lost
  and the god gained remember it, a god told nothing is refused a contest over it, and
  the god lost opens a contest for the mortal's home. \`no-answerer\` leaves no god
  having answered it, so the mortal keeps its patron.
- **S25** The director fires three times exactly its interval apart with the world
  busy around it. \`director-off\` leaves the interval at the quiet default.
- **S26** A god answers a prayer with a blessing from where it stands. A trouble in a
  blessing god's domain takes goods from a mortal, which prays to that god; the god,
  not with the mortal, copies the bless its prompt offers and sends it as written. In
  that one turn the world accepts it, the prayer is answered, the god has not moved
  and has no journey, every mortal who stood at the blessed one's place perceives
  the blessing, and none saw the god or anything at its place. \`remote-bless\` has
  the god only wait, as one that has not walked first would, and the step fails at its wait.
- **S27** A god answers a punish prayer by striking a building it lists, from where it
  stands. A theft's victim prays to a patron that can strike, the prayer lists the
  wrongdoer's building, and the god, away from both, copies the strike on that
  building and sends it as written: the building is damaged in that one turn, the
  prayer is answered, the god has not moved, and the mortals at the building's
  place perceive it and learn nothing of where the god is. \`remote-strike\` has the
  god only wait.

The six world controls that change what happens (\`strike-chain\`, \`refusal-revenge\`,
\`no-answerer\`, \`director-off\`, \`remote-bless\`, \`remote-strike\`) run only their own step, in a world of their own, so each costs
that step and none of the story; \`--steps=S21,S24\` runs staged steps alone while working on
one, and \`--positive-control=<name>\` runs one control.

The transcript (\`src/transcript.ts\`) shows each thread's cause, participants,
moves, ending, and recorded changes, each god's distinct practices and thread
endings, the threads open at the end with their age
and what each waits on, every move judged no progress, every journey a god made
(where it set out, each hop, how it ended), and a classification of
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
A god's own journey is one scripted \`travel\` turn: the world walks it there a
step a tick, so the harness waits for the arrival and never moves the god.
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
- **Stale proposal:** Hera's strike turn is held while a fixture moves her.
- **Hostile archive:** the projection row of an export has Hera's memory and
  feeling dropped and its content hash recomputed.

${UNATTENDED_PROCEDURE}`;

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
  land that close in practice. The harness's own bracket check is no longer
  sabotaged by a control (\`catch-up-inference\` was dropped); the service's refusal
  to start a turn inside a catch-up is proved, with a probe that can fail, in
  \`apps/simulation/src/agents.test.ts\`.
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
  const controlFindings = summary.controls.map((control) =>
    control.via === "process"
      ? `**Positive control \`${control.name}\`.** ${control.sabotage} ${control.scope} The run exited ${control.exitCode} after ${control.seconds.toFixed(0)} s with: ${control.failure}`
      : `**Positive control \`${control.name}\` (in-process).** ${control.sabotage} Applied to a copy of the story's own data, the property it targets failed with: ${control.failure}`,
  );
  const allTripped = summary.controls.every(tripped);
  const inProcess = summary.controls.filter(
    (control) => control.via === "in-process",
  ).length;
  const bottomLine = `All ${summary.steps.length} scripted steps held on the tree this README was committed with. The story ran in ${(summary.steps.reduce((sum, step) => sum + step.elapsedMs, 0) / 1000).toFixed(0)} s; the whole evidence run, with every control, took ${(summary.totalMs / 1000).toFixed(0)} s. ${
    allTripped && summary.controls.length > 0
      ? `All ${summary.controls.length} positive controls tripped the assertion they target, so those assertions are live: ${summary.controls.length - inProcess} by a child process that exited non-zero (a rerun of the story to the step it breaks, or only its own staged step), ${inProcess} by breaking a copy of the evidence a step collected in-process. `
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

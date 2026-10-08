// Headless M2 scenario: the compiled sidecar with the gods taking turns
// through a scripted provider. Exits non-zero on the first violated invariant.
// Not part of `bun run check`: it spawns a binary and runs for minutes.
//
//   bun run scenario:m2                              run the scripted story
//   bun run scenario:m2 --skip-build                 reuse the existing sidecar binary
//   bun run scenario:m2 --positive-control=<name>    break one check on purpose; must fail (the process-level controls; the practice controls
//                                                    always run in-process, at the end of every story run)
//   bun run scenario:m2 --write-readme [--jobs=4]    run the story, then each process-level control four at a time, rewrite README.md (uses real-run.json)
//   bun run scenario:m2 --real [--seconds=N]         both gods through local Ollama, unscripted; asserts properties, writes real-run.json
//                                                    (rebuilds the sidecar first, unless --skip-build)
//   bun run scenario:m2 --episodes=N --model=M --base-url=https://host/v1 [--key-ref=NAME]
//                                                    the same gate against any OpenAI-compatible endpoint, local or hosted (no Ollama check or warm-up); --key-ref reads
//                                                    that key from the macOS Keychain (service ai.panthe.desktop.endpoint-keys) once and sends it
//                                                    only on the sidecar's launch line
//   bun run scenario:m2 --unattended [--unattended-minutes=60] [--out=DIR] [--scripted=answer|empty-200]
//                                                    one world on local Ollama behind an outage proxy, kept under DIR (default m2-greek-cast/unattended/<timestamp>/):
//                                                    an outage, a clean stop with a 90-minute gap, a capped catch-up; --unattended-minutes scales the running phases
//                                                    (not the gap) and below 60 is not a gate run; --scripted answers from the scripted provider instead of Ollama.
//                                                    Exit 0 completed, 1 failed, 2 only for Ollama's empty-200 fault (rebuilds the sidecar first, unless --skip-build)
//   bun run scenario:m2 --episodes=N [--episode-seconds=300] [--out=DIR]
//                                                    experience gate: N fresh worlds, Zeus and Hera on local Ollama for the same time each;
//                                                    writes episode-N.md and summary.md to DIR (default m2-greek-cast/episodes/<timestamp>/)
//                                                    (rebuilds the sidecar first, unless --skip-build)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureEnvironment, renderReport } from "@panthea/tools-probes-shared";
import { mapLimit, ScenarioFailure } from "../../m1-living-world/src/helpers";
import { killAllSidecars, REPO_ROOT } from "../../m1-living-world/src/sidecar";
import { type Args, parseArgs } from "./args";
import { resolveSidecarBinary } from "./binary";
import {
  defaultOutDir,
  gateOf,
  loadAuthoredPatrons,
  runEpisodes,
} from "./episodes";
import { SABOTAGE } from "./practice-controls";
import {
  endpointOptions,
  KeyMissing,
  OllamaUnreachable,
  type RealRecord,
  runReal,
} from "./real";
import {
  buildReportInput,
  type ControlResult,
  type ProcessControlResult,
} from "./report";
import {
  CONTROL_NAMES,
  CONTROL_STEP,
  type ControlName,
  runStory,
} from "./story";
import { exitCodeOf, failureText, runUnattended } from "./unattended";

const CONTROL_SABOTAGE: Readonly<Record<ControlName, string>> = {
  chain:
    "Zeus's report carries no claim, so Hera's belief has no consequence and her relationship toward Zeus does not change.",
  isolation:
    "The harness adds the strike's ignition to the last prompt Hera was shown before the check, as if the event had leaked into her context.",
  trace:
    "The harness follows the farmer's fixture move instead of the tavern's destruction, an event no strike caused, so the chain has no model request.",
  "petition-privacy":
    "The harness injects a petition addressed to Hera into the last prompt Zeus was shown, as if the divine sense leaked to the other god.",
  "strike-chain":
    "The victim's patron only waits when its prayer asks it to punish the wrongdoer, so the wrongdoer is never struck and no harm reaches its own patron.",
  "refusal-revenge":
    "The victim's patron answers the prayer by striking the wrongdoer instead of refusing it, so the victim has no unanswered prayer and takes no revenge.",
  "no-answerer":
    "The god of the trouble's domain never answers the mortal's prayer, so no god but its patron has answered it, and the mortal keeps its patron however many prayers are refused.",
  "director-off":
    "The staged world is made with the director's interval left at the quiet default, so it never fires.",
  "remote-bless":
    "The god of the mortal's trouble only waits instead of sending the bless its prompt offers, as one that has not walked to the mortal first would, so the blessing never comes.",
  "remote-strike":
    "The wronged mortal's patron only waits instead of sending the strike on the wrongdoer's listed building its prompt offers, as one that has not walked to the building first would, so the building is never struck.",
};

/** Runs a control in a child process: the story up to the step it breaks, or only its own staged step. */
async function runControl(name: ControlName): Promise<ProcessControlResult> {
  const started = Date.now();
  const child = Bun.spawn(
    [
      "bun",
      "run",
      import.meta.path,
      "--skip-build",
      `--positive-control=${name}`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const failure =
    `${out}\n${err}`.split("\n").find((line) => line.startsWith("FAIL")) ??
    "(no FAIL line)";
  return {
    via: "process",
    name,
    sabotage: CONTROL_SABOTAGE[name],
    exitCode,
    failure,
    seconds: (Date.now() - started) / 1000,
    scope:
      CONTROL_STEP[name] === undefined
        ? "It reruns the story in a child process, which stops at the step the control breaks."
        : `It runs only ${CONTROL_STEP[name]}, which starts a world of its own, so it costs that step and none of the story before it.`,
  };
}

async function runRealRun(args: Args): Promise<void> {
  const record = await runReal({
    binary: resolveSidecarBinary(args.skipBuild),
    durationMs: args.seconds * 1000,
    ollama: "http://127.0.0.1:11434",
    model: args.model,
    ...(args.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: args.reasoningEffort }),
    ...(await endpointOptions(args)),
  });
  writeFileSync(
    join(import.meta.dir, "..", "real-run.json"),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  console.log(JSON.stringify(record.analysis, null, 2));
  for (const property of record.analysis.properties) {
    console.log(
      `${property.ok ? "PASS" : "FAIL"} ${property.name}: ${property.detail}`,
    );
  }
  if (record.analysis.properties.some((property) => !property.ok)) {
    console.error(
      "\nFAIL invariant violated: a real-run property did not hold (see above)",
    );
    process.exit(1);
  }
}

async function runEpisodeGate(args: Args): Promise<void> {
  const outDir = args.out ?? defaultOutDir();
  const records = await runEpisodes({
    binary: resolveSidecarBinary(args.skipBuild),
    durationMs: args.episodeSeconds * 1000,
    ollama: "http://127.0.0.1:11434",
    model: args.model,
    ...(args.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: args.reasoningEffort }),
    ...(await endpointOptions(args)),
    episodes: args.episodes,
    outDir,
  });
  console.log(
    `wrote ${records.length} transcripts and summary.md to ${outDir}`,
  );
  let failed = 0;
  for (const record of records) {
    for (const god of record.episode.gods) {
      for (const check of god.checks) {
        if (!check.ok) failed += 1;
        console.log(
          `${check.ok ? "PASS" : "FAIL"} episode ${record.index} ${god.god} ${check.name}: ${check.detail}`,
        );
      }
    }
    for (const check of record.episode.world) {
      if (!check.ok) failed += 1;
      console.log(
        `${check.ok ? "PASS" : "FAIL"} episode ${record.index} ${check.name}: ${check.detail}`,
      );
    }
    for (const property of record.analysis.properties) {
      if (!property.ok) failed += 1;
      console.log(
        `${property.ok ? "PASS" : "FAIL"} episode ${record.index} ${property.name}: ${property.detail}`,
      );
    }
  }
  // The checks that span the gate's episodes: each god's initiative counts across them, not in each.
  const patrons = loadAuthoredPatrons(join(REPO_ROOT, "content/greek/world"));
  for (const check of gateOf(records, patrons)) {
    if (!check.ok) failed += 1;
    console.log(
      `${check.ok ? "PASS" : "FAIL"} gate ${check.name}: ${check.detail}`,
    );
  }
  if (failed > 0) {
    // The transcripts are kept: an unsuccessful episode is tuning evidence.
    console.error(
      `\nFAIL invariant violated: ${failed} automated checks did not hold (transcripts kept in ${outDir})`,
    );
    process.exit(1);
  }
}

async function runUnattendedMode(args: Args): Promise<void> {
  const result = await runUnattended(args);
  console.log(
    `\nunattended run ${result.status}: ${(result.runningMs / 60_000).toFixed(1)} min running, ${(result.elapsedWallMs / 60_000).toFixed(1)} min elapsed`,
  );
  for (const check of result.checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }
  if (result.gate !== undefined) {
    console.log(
      `threshold table: ${result.gate.verdict}${result.gate.failedRows.length === 0 ? "" : ` (${result.gate.failedRows.length} rows failed: ${result.gate.failedRows.join("; ")})`}`,
    );
  }
  const code = exitCodeOf(result);
  if (code === 2) {
    // Not a FAIL line: an infrastructure fault is no gate result, and the run is rerun.
    console.error(`\nINFRASTRUCTURE FAULT ${failureText(result)}`);
  } else if (code === 1) {
    console.error(`\nFAIL ${failureText(result)}`);
  }
  if (code !== 0) process.exit(code);
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  const startedAt = Date.now();
  process.on("SIGINT", () => {
    killAllSidecars();
    process.exit(130);
  });
  try {
    if (args.unattended) {
      await runUnattendedMode(args);
      return;
    }
    if (args.episodes > 0) {
      await runEpisodeGate(args);
      return;
    }
    if (args.real) {
      await runRealRun(args);
      return;
    }
    const { steps, binaryBytes, practiceControls, worldControls } =
      await runStory(args, (step) => {
        console.log(
          `PASS ${step.id} ${step.title} (${(step.elapsedMs / 1000).toFixed(1)} s): ${step.result}`,
        );
      });
    for (const { control, failure } of [
      ...practiceControls,
      ...worldControls,
    ]) {
      console.log(`control ${control} (in-process): ${failure}`);
    }
    console.log(
      `\nOK ${steps.length} steps in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`,
    );
    if (args.control) {
      console.error(
        `\nFAIL positive control ${args.control} did not trip any invariant`,
      );
      process.exit(1);
    }
    if (args.writeReadme) {
      // Each process-level control is a whole story with its own temporary root,
      // app-data directory, lifecycle lock, sidecar, and loopback ports, so they
      // share nothing but the read-only binary. `mapLimit` returns them in
      // CONTROL_NAMES order, which is the README's order. The practice controls
      // already ran in-process at the end of the story above and follow them.
      const processControls = await mapLimit(
        CONTROL_NAMES,
        args.jobs,
        async (name): Promise<ProcessControlResult> => {
          console.log(`running positive control ${name}`);
          const result = await runControl(name);
          console.log(`  ${name} exit ${result.exitCode}: ${result.failure}`);
          if (
            result.exitCode === 0 ||
            !result.failure.startsWith("FAIL invariant violated")
          ) {
            throw new Error(
              `positive control ${name} did not fail on an invariant (exit ${result.exitCode}: ${result.failure})`,
            );
          }
          return result;
        },
      );
      const controls: ControlResult[] = [
        ...processControls,
        ...practiceControls.map(
          ({ control, failure }): ControlResult => ({
            via: "in-process",
            name: control,
            sabotage: SABOTAGE[control],
            failure,
          }),
        ),
        ...worldControls.map(
          ({ control, sabotage, failure }): ControlResult => ({
            via: "in-process",
            name: control,
            sabotage,
            failure,
          }),
        ),
      ];
      const realPath = join(import.meta.dir, "..", "real-run.json");
      const real = existsSync(realPath)
        ? (JSON.parse(readFileSync(realPath, "utf8")) as RealRecord)
        : undefined;
      const report = renderReport(
        buildReportInput({
          steps,
          controls,
          environment: captureEnvironment(),
          totalMs: Date.now() - startedAt,
          binaryBytes,
          real,
        }),
      );
      writeFileSync(
        join(import.meta.dir, "..", "README.md"),
        `# m2-greek-cast: the M2 causal story against the compiled sidecar\n\n${report}\n`,
      );
      console.log("\nwrote tools/scenarios/m2-greek-cast/README.md");
    }
  } catch (error) {
    killAllSidecars();
    if (error instanceof ScenarioFailure) {
      console.error(`\nFAIL ${error.message}`);
    } else if (
      error instanceof OllamaUnreachable ||
      error instanceof KeyMissing
    ) {
      console.error(`\nFAIL ${error.message}`);
    } else {
      console.error("\nFAIL unexpected error:", error);
    }
    process.exit(1);
  }
}

await main();

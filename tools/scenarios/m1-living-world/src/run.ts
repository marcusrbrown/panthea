// Headless M1 causal scenario. Drives the compiled sidecar (no Tauri)
// through the persistent living-world story and exits non-zero on the
// first violated invariant. Not part of `bun run check`: it builds and
// spawns a binary and runs for minutes.
//
//   bun run scenario:m1                              run the story
//   bun run scenario:m1 --skip-build                 reuse the existing sidecar binary
//   bun run scenario:m1 --positive-control=<name>    break one check on purpose; must fail
//   bun run scenario:m1 --write-readme [--jobs=4]    run the story, then every control four at a time, rewrite README.md

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureEnvironment, renderReport } from "@panthea/tools-probes-shared";
import { mapLimit, ScenarioFailure } from "./helpers";
import { buildReportInput, type ControlResult } from "./report";
import { killAllSidecars } from "./sidecar";
import {
  CONTROL_NAMES,
  type ControlName,
  runStory,
  type StoryOptions,
} from "./story";

/** Positive controls `--write-readme` runs at once: each is a whole story with its own sidecar, so the cost is cores, not ports or files. */
const DEFAULT_JOBS = 4;

interface Args extends StoryOptions {
  readonly writeReadme: boolean;
  readonly jobs: number;
}

function parseArgs(argv: readonly string[]): Args {
  let control: ControlName | undefined;
  let writeReadme = false;
  let skipBuild = false;
  let jobs: number | undefined;
  for (const arg of argv) {
    if (arg === "--write-readme") writeReadme = true;
    else if (arg.startsWith("--jobs=")) {
      jobs = Number(arg.slice(7));
      if (!Number.isInteger(jobs) || jobs < 1) {
        throw new Error(
          `--jobs must be a positive whole number, got ${arg.slice(7)}`,
        );
      }
    } else if (arg === "--skip-build") skipBuild = true;
    else if (arg === "--positive-control") control = "archive";
    else if (arg.startsWith("--positive-control=")) {
      const name = arg.slice("--positive-control=".length);
      if (!(CONTROL_NAMES as readonly string[]).includes(name)) {
        throw new Error(
          `unknown positive control: ${name} (expected ${CONTROL_NAMES.join(", ")})`,
        );
      }
      control = name as ControlName;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (jobs !== undefined && !writeReadme) {
    throw new Error("--jobs applies only with --write-readme");
  }
  return {
    ...(control ? { control } : {}),
    writeReadme,
    skipBuild,
    jobs: jobs ?? DEFAULT_JOBS,
  };
}

const CONTROL_SABOTAGE: Readonly<Record<ControlName, string>> = {
  archive:
    'The harness skips the byte change, so the "corrupted" copy is a clean export and importing it must be refused.',
  "catch-up":
    "After the kill, the harness rewinds the persisted cursor to where the chunks began, so the restart replays time the committed chunks already applied.",
  journal:
    "After the kill, the harness deletes the accepted proposal from the journal, as if the service had kept it only in memory, so nothing consumes it after the restart.",
  "bad-proposals":
    "The harness adds the tree strike's observation, which did cause events, to the list of bad proposals' observations, so the check that they caused no event sees a change.",
  "claim-owner":
    "The harness checks the tavern, which has an owner, instead of the old oak for the false claim's effect, so the check that the claim granted no owner sees one.",
  pause:
    "The harness resumes the world just before stopping it, so it is running when it stops and cannot come back paused.",
  underworld:
    "The second client follows the farmer in the mortal realm instead of the underworld, so it sees and receipts mortal events.",
};

/** Runs the story again in a child process with a control enabled, and reports how it ended. */
async function runControl(name: ControlName): Promise<ControlResult> {
  const child = Bun.spawn(
    [
      "bun",
      "run",
      import.meta.path,
      "--skip-build",
      `--positive-control=${name}`,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [out, err, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const failure =
    `${out}\n${err}`.split("\n").find((line) => line.startsWith("FAIL")) ??
    "(no FAIL line)";
  return { name, sabotage: CONTROL_SABOTAGE[name], exitCode, failure };
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  const startedAt = Date.now();
  process.on("SIGINT", () => {
    killAllSidecars();
    process.exit(130);
  });
  try {
    const { steps, binaryBytes } = await runStory(args, (step) => {
      console.log(
        `PASS ${step.id} ${step.title} (${(step.elapsedMs / 1000).toFixed(1)} s): ${step.result}`,
      );
    });
    const totalMs = Date.now() - startedAt;
    console.log(
      `\nOK ${steps.length} steps in ${(totalMs / 1000).toFixed(1)} s`,
    );
    if (args.control) {
      // A control that gets here broke nothing: the assertions it targets are not live.
      console.error(
        `\nFAIL positive control ${args.control} did not trip any invariant`,
      );
      process.exit(1);
    }
    if (args.writeReadme) {
      // Each control is a whole story with its own temporary root, app-data
      // directory, lifecycle lock, and sidecar, so they share nothing but the
      // read-only binary. The results come back in CONTROL_NAMES order.
      const controls = await mapLimit(
        CONTROL_NAMES,
        args.jobs,
        async (name): Promise<ControlResult> => {
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
      const report = renderReport(
        buildReportInput({
          steps,
          controls,
          environment: captureEnvironment(),
          totalMs: Date.now() - startedAt,
          binaryBytes,
        }),
      );
      writeFileSync(
        join(import.meta.dir, "..", "README.md"),
        `# m1-living-world: headless causal scenario\n\n${report}\n`,
      );
      console.log("\nwrote tools/scenarios/m1-living-world/README.md");
    }
  } catch (error) {
    killAllSidecars();
    if (error instanceof ScenarioFailure) {
      console.error(`\nFAIL ${error.message}`);
    } else {
      console.error("\nFAIL unexpected error:", error);
    }
    process.exit(1);
  }
}

await main();

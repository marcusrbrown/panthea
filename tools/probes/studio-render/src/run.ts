// Driver for the studio-render probe (U1). One subcommand per measurement; each
// writes its result as JSON under scratch/results/. Run a long one detached and
// poll the file, for example:
//
//   bun tools/probes/studio-render/src/run.ts render rep-a > scratch/logs/rep-a.log 2>&1 &
//
// Subcommands: stage, env, render <name> [--unstaged] [--depth16] [--clip c]
// [--facing f] [--extra-clip spec], terminal-control, compare <a> <b> <result>,
// controls <run>, formats <run>, heights <run>..., clips, pin, gpu, cancel,
// memory-control, memory, observe [staged|sanity|planted-texture|planted-buffer|unstaged|all]

import { cancelStep } from "./cmd-cancel";
import { memoryControl, memoryLoadedStep, memoryStep } from "./cmd-memory";
import { clipsStep, gpuStep, pinStep, terminalControl } from "./cmd-misc";
import { observeStep } from "./cmd-observe";
import {
  compareControls,
  compareRuns,
  envStep,
  formats,
  heights,
  pngControl,
  renderSlot,
  STAGING,
  stage,
  writeResult,
} from "./cmd-render";

function flag(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

async function main(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case "stage": {
      const staged = stage(STAGING);
      writeResult("stage", staged);
      console.log(JSON.stringify(staged, null, 2));
      return;
    }
    case "env":
      await envStep();
      return;
    case "render": {
      const name = rest[0];
      if (!name) throw new Error("render needs a run name");
      const result = await renderSlot({
        name,
        unstaged: rest.includes("--unstaged"),
        depth16: rest.includes("--depth16"),
        clip: flag(rest, "--clip") ?? "walk16",
        facing: flag(rest, "--facing") ?? "south",
        extraClip: flag(rest, "--extra-clip") ?? "",
      });
      writeResult(`render-${name}`, result);
      console.log(
        JSON.stringify({
          name,
          ok: result.ok,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        }),
      );
      return;
    }
    case "terminal-control":
      await terminalControl();
      return;
    case "compare": {
      const [a, b, name] = rest;
      if (!a || !b || !name)
        throw new Error("compare <runA> <runB> <resultName>");
      const report = compareRuns(a, b);
      writeResult(name, report);
      console.log(JSON.stringify(report.perRole, null, 2));
      return;
    }
    case "controls": {
      const run = rest[0];
      if (!run) throw new Error("controls <run>");
      writeResult(`compare-controls-${run}`, compareControls(run));
      return;
    }
    case "formats": {
      const run = rest[0];
      if (!run) throw new Error("formats <run>");
      writeResult(`formats-${run}`, formats(run));
      return;
    }
    case "heights": {
      const out: Record<string, unknown> = {};
      for (const run of rest) out[run] = heights(run);
      writeResult("heights", out);
      console.log(JSON.stringify(out, null, 2));
      return;
    }
    case "png-control":
      writeResult("png-control", pngControl());
      return;
    case "clips":
      await clipsStep();
      return;
    case "pin":
      await pinStep();
      return;
    case "gpu":
      await gpuStep();
      return;
    case "cancel":
      await cancelStep();
      return;
    case "memory-control":
      await memoryControl();
      return;
    case "memory":
      await memoryStep();
      return;
    case "memory-loaded":
      await memoryLoadedStep();
      return;
    case "observe":
      await observeStep(rest[0] ?? "all");
      return;
    default:
      throw new Error(`unknown subcommand ${String(command)}`);
  }
}

main(process.argv.slice(2)).then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    process.exit(1);
  },
);

// The M2 causal story, one module per step under `steps/`. Each step asserts
// its invariant through `check`/`waitFor`, which throw a `ScenarioFailure`
// naming it; the first one stops the run. Facts a step hands on are its return
// value, passed explicitly below.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createStepRecorder,
  type StepResult,
} from "../../m1-living-world/src/helpers";
import {
  killAllSidecars,
  startSidecar,
} from "../../m1-living-world/src/sidecar";
import { resolveSidecarBinary } from "./binary";
import { startProvider } from "./provider";
import {
  heraPolicy,
  stepHera,
  stepIsolation,
  stepReport,
  stepStrike,
  stepTrace,
} from "./steps/chain";
import type { Story, StoryOptions } from "./steps/context";
import { stepIdle } from "./steps/s01-idle";
import { stepKillJournal } from "./steps/s02-kill-journal";
import { stepKillInference } from "./steps/s03-kill-inference";
import { stepStale } from "./steps/s09-stale";
import { stepCatchUp } from "./steps/s10-catch-up";
import { stepRestore } from "./steps/s11-restore";
import { stepPetitionPrivacy } from "./steps/s12-petition-privacy";
import { stepOath, stepRefusal, stepSuccessor } from "./steps/s13-settlement";
import { stepSupplication } from "./steps/s14-supplication";
import { stepPracticeProperties } from "./steps/s15-practice-properties";
import { CONTEST_WINDOW_TICKS, stepContest } from "./steps/s16-contest";
import { stepAlliance, stepHades } from "./steps/s17-cast";

export {
  CONTROL_NAMES,
  type ControlName,
  type StoryOptions,
} from "./steps/context";

export interface StoryResult {
  readonly steps: readonly StepResult[];
  readonly binaryBytes: number;
}

export async function runStory(
  options: StoryOptions,
  onStep: (step: StepResult) => void,
): Promise<StoryResult> {
  const recorder = createStepRecorder(onStep);
  const binary = resolveSidecarBinary(options.skipBuild);
  const binaryBytes = Bun.file(binary).size;
  const root = mkdtempSync(join(tmpdir(), "panthea-m2-"));
  const dataDir = join(root, "app-data");
  const provider = startProvider();
  provider.policy("hera", heraPolicy());
  const launchConfig = {
    models: {
      endpoints: [
        { id: "scripted", baseUrl: provider.baseUrl, model: "scripted" },
      ],
      // Every god in the pack needs a route of its own. The provider answers a god
      // from the replies the steps queue for it, and with a wait when there are none.
      roles: Object.fromEntries(
        [
          "athena",
          "hades",
          "hephaestus",
          "hera",
          "hermes",
          "poseidon",
          "zeus",
        ].map((god) => [god, { endpoint: "scripted" }]),
      ),
    },
    offline: false,
    keys: {},
  };
  // The scripted story is a causal chain the harness stages, so the quiet-world
  // director is off for it (a quiet window longer than any run); the real gate
  // keeps it on. Everything else is the authored pack.
  const env = {
    PANTHEA_PETITION_BALANCE: JSON.stringify({
      directorQuietTicks: 10_000_000,
    }),
    // The authored contest window is five minutes; the story's contest runs a short one.
    PANTHEA_PRACTICE_BALANCE: JSON.stringify({
      contestWindowTicks: CONTEST_WINDOW_TICKS,
    }),
  };
  let story: Story | undefined;
  try {
    const first = await startSidecar(binary, dataDir, { env, launchConfig });
    const running: Story = {
      options,
      binary,
      root,
      dataDir,
      provider,
      sidecar: first,
      async restart() {
        const next = await startSidecar(binary, dataDir, { env, launchConfig });
        running.sidecar = next;
        return next;
      },
    };
    story = running;

    await stepIdle(recorder, running);
    await stepKillJournal(recorder, running);
    await stepKillInference(recorder, running);
    const strike = await stepStrike(recorder, running);
    const { destroyedId } = await stepIsolation(recorder, running, strike);
    const report = await stepReport(recorder, running, strike);
    await stepHera(recorder, running, report);
    await stepTrace(recorder, running, strike, destroyedId);
    await stepPetitionPrivacy(recorder, running);
    await stepStale(recorder, running);
    await stepCatchUp(recorder, running);
    await stepRestore(recorder, running, report);
    const refusal = await stepRefusal(recorder, running);
    await stepSuccessor(recorder, running, refusal);
    await stepOath(recorder, running);
    await stepSupplication(recorder, running);
    await stepContest(recorder, running);
    await stepAlliance(recorder, running);
    await stepHades(recorder, running);
    await stepPracticeProperties(recorder, running);
    return { steps: recorder.results, binaryBytes };
  } finally {
    await story?.sidecar.stop("SIGTERM").catch(() => undefined);
    killAllSidecars();
    provider.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

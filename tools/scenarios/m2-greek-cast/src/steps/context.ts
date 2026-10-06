// What every step shares: the run's options and the running story (the current
// sidecar, the scripted provider, the data directory). Facts one step hands to a
// later one are its return value, passed on explicitly by `runStory`.

import type { StepRecorder } from "../../../m1-living-world/src/helpers";
import type { Sidecar } from "../../../m1-living-world/src/sidecar";
import type { ScriptedProvider } from "../provider";

/**
 * The controls that rerun the story in a child process with one thing broken mid-flight. The first four break a
 * check partway through the story (S5 to S12) and fail there, so they run the story up to it. The next four are
 * staged-world controls: each runs only its own step (S21 to S25 start worlds of their own and depend on nothing
 * before them) with the one thing its step stages left out. The practice controls and the world controls break the
 * data one run collected, in-process, and are not among these (see `practice-controls.ts` and `s23-world.ts`).
 */
export type ControlName =
  | "chain"
  | "isolation"
  | "trace"
  | "petition-privacy"
  | "strike-chain"
  | "refusal-revenge"
  | "no-answerer"
  | "director-off";

export const CONTROL_NAMES: readonly ControlName[] = [
  "chain",
  "isolation",
  "trace",
  "petition-privacy",
  "strike-chain",
  "refusal-revenge",
  "no-answerer",
  "director-off",
];

/** The steps that start a world of their own and so may run alone. */
export const STAGED_STEPS = ["S21", "S22", "S23", "S24", "S25"] as const;
export type StagedStep = (typeof STAGED_STEPS)[number];

/** The one step a staged-world control runs; the other controls run the story. */
export const CONTROL_STEP: Readonly<Partial<Record<ControlName, StagedStep>>> =
  {
    "strike-chain": "S21",
    "refusal-revenge": "S22",
    "no-answerer": "S24",
    "director-off": "S25",
  };

/** What the in-process world controls are: each breaks the evidence its step collected, and the step's own check must fail on it. */
export const WORLD_CONTROLS = ["trouble-route"] as const;

export interface StoryOptions {
  readonly control?: ControlName;
  readonly skipBuild: boolean;
  /** Run only these staged steps (a focused run while working on one), instead of the story. */
  readonly steps?: readonly StagedStep[];
}

export interface Story {
  readonly options: StoryOptions;
  readonly binary: string;
  readonly root: string;
  readonly dataDir: string;
  readonly provider: ScriptedProvider;
  sidecar: Sidecar;
  /** Starts a new sidecar on the same data directory, with the same model config. */
  restart(): Promise<Sidecar>;
}

export type Recorder = StepRecorder;

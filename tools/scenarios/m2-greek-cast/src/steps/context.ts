// What every step shares: the run's options and the running story (the current
// sidecar, the scripted provider, the data directory). Facts one step hands to a
// later one are its return value, passed on explicitly by `runStory`.

import type { StepRecorder } from "../../../m1-living-world/src/helpers";
import type { Sidecar } from "../../../m1-living-world/src/sidecar";
import type { ScriptedProvider } from "../provider";

/**
 * The controls that rerun the whole story in a child process with one thing
 * broken mid-flight. The practice controls are not among them: they break the
 * data one story run collected, in-process (see `practice-controls.ts`).
 */
export type ControlName = "chain" | "isolation" | "trace" | "petition-privacy";

export const CONTROL_NAMES: readonly ControlName[] = [
  "chain",
  "isolation",
  "trace",
  "petition-privacy",
];

export interface StoryOptions {
  readonly control?: ControlName;
  readonly skipBuild: boolean;
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

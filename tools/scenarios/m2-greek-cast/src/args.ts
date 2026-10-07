// Command-line flags of the M2 scenario runner.

import { isLocalUrl, parseRoutingConfig } from "@panthea/agents/config";
import {
  CONTROL_NAMES,
  type ControlName,
  STAGED_STEPS,
  type StagedStep,
  type StoryOptions,
} from "./story";

/**
 * The model the real run and the experience gate use unless told otherwise:
 * granite3.3 8B at a 4K context, the M2 local baseline (owner, 2026-10-07; qwen3
 * 8B at 4K was the baseline from 2026-10-02). Create it with
 * `tools/probes/inference-baseline/Modelfile.granite3.3-8b-4k`; it is meant to be
 * run with `--reasoning-effort=none`.
 */
export const DEFAULT_MODEL = "granite3.3-8b-4k";

/** Positive controls `--write-readme` runs at once: each is a whole story with its own sidecar, so the cost is cores, not ports or files. */
export const DEFAULT_JOBS = 4;

export interface Args extends StoryOptions {
  readonly real: boolean;
  readonly seconds: number;
  readonly writeReadme: boolean;
  /** How many positive controls `--write-readme` runs at once. */
  readonly jobs: number;
  /** Experience-gate episodes to run; 0 when not asked for. */
  readonly episodes: number;
  readonly episodeSeconds: number;
  readonly out: string | undefined;
  /** The Ollama model for the real run and the episodes. */
  readonly model: string;
  /** Set to "none" to ask the model not to reason before answering. */
  readonly reasoningEffort: "none" | undefined;
  /** The endpoint's OpenAI-compatible base URL; local Ollama's when unset. */
  readonly baseUrl: string | undefined;
  /** The Keychain entry (account) holding the endpoint's key; none when unset. */
  readonly keyRef: string | undefined;
}

function positiveInt(flag: string, text: string): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${flag} must be a positive whole number, got ${text}`);
  }
  return value;
}

export function parseArgs(argv: readonly string[]): Args {
  let control: ControlName | undefined;
  let steps: StagedStep[] | undefined;
  let skipBuild = false;
  let real = false;
  let writeReadme = false;
  let jobs = DEFAULT_JOBS;
  let jobsGiven = false;
  let seconds = 180;
  let episodes = 0;
  let episodeSeconds = 300;
  let out: string | undefined;
  let model = DEFAULT_MODEL;
  let reasoningEffort: "none" | undefined;
  let baseUrl: string | undefined;
  let keyRef: string | undefined;
  for (const arg of argv) {
    if (arg === "--skip-build") skipBuild = true;
    else if (arg === "--real") real = true;
    else if (arg === "--write-readme") writeReadme = true;
    else if (arg.startsWith("--jobs=")) {
      jobs = positiveInt("--jobs", arg.slice(7));
      jobsGiven = true;
    } else if (arg.startsWith("--seconds=")) seconds = Number(arg.slice(10));
    else if (arg.startsWith("--episodes=")) {
      episodes = positiveInt("--episodes", arg.slice(11));
    } else if (arg.startsWith("--episode-seconds=")) {
      episodeSeconds = positiveInt("--episode-seconds", arg.slice(18));
    } else if (arg.startsWith("--out=")) out = arg.slice(6);
    else if (arg.startsWith("--model=")) {
      model = arg.slice(8);
      if (model === "") throw new Error("--model needs a model name");
    } else if (arg.startsWith("--reasoning-effort=")) {
      if (arg.slice(19) !== "none") {
        throw new Error('--reasoning-effort accepts only "none"');
      }
      reasoningEffort = "none";
    } else if (arg.startsWith("--base-url=")) {
      baseUrl = arg.slice(11);
      // The routing config's own parser decides what a usable base URL is,
      // credentials in it included.
      const parsed = parseRoutingConfig({
        endpoints: [{ id: "hosted", baseUrl, model: "m" }],
        roles: {},
      });
      if (!parsed.ok) throw new Error(`--base-url ${parsed.message}`);
    } else if (arg.startsWith("--key-ref=")) {
      keyRef = arg.slice(10);
      if (keyRef === "") throw new Error("--key-ref needs a key reference");
    } else if (arg.startsWith("--steps=")) {
      steps = arg
        .slice(8)
        .split(",")
        .map((id) => {
          if (!(STAGED_STEPS as readonly string[]).includes(id)) {
            throw new Error(
              `--steps names only staged steps that start a world of their own (${STAGED_STEPS.join(", ")}), got ${id}`,
            );
          }
          return id as StagedStep;
        });
    } else if (arg.startsWith("--positive-control=")) {
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
  if (jobsGiven && !writeReadme) {
    throw new Error("--jobs applies only with --write-readme");
  }
  // Which endpoint flags may be combined, decided here so nothing downstream
  // (the Keychain read, the launch line) can run on a bad combination. Messages
  // name flags only, never a key.
  if (keyRef !== undefined) {
    if (baseUrl === undefined) {
      throw new Error(
        "--key-ref needs --base-url: a key is never sent to the default local Ollama endpoint",
      );
    }
    if (new URL(baseUrl).protocol !== "https:" || isLocalUrl(baseUrl)) {
      throw new Error(
        "--key-ref is sent only to a non-local https:// --base-url: a local or plain-http endpoint would receive the key unprotected",
      );
    }
  }
  if (
    (baseUrl !== undefined || keyRef !== undefined) &&
    !real &&
    episodes === 0
  ) {
    const flag = keyRef !== undefined ? "--key-ref" : "--base-url";
    throw new Error(`${flag} applies only with --real or --episodes`);
  }
  return {
    ...(control ? { control } : {}),
    ...(steps ? { steps } : {}),
    skipBuild,
    real,
    seconds,
    writeReadme,
    jobs,
    episodes,
    episodeSeconds,
    out,
    model,
    reasoningEffort,
    baseUrl,
    keyRef,
  };
}

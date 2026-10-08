// The cap on a god's whole prompt: how many characters a token is for the
// models on a role's route, and whether a built request fits `PROMPT_TOKEN_CAP`
// counted with the least favourable of them. Counting is by characters, because
// the prompt is built before any model runs; the ratios are measured on local
// Ollama (`prompt_eval_count` against request characters).

import type { RoutePlan } from "./config";
import { PROMPT_TOKEN_CAP } from "./practices";
import { MAX_FEEDBACK_CHARS, type RouteContext, requestChars } from "./router";

/** Characters a token takes, by the router's model id. Measured on local Ollama, 2026-10-08. */
export const MODEL_RATIOS: Readonly<Record<string, number>> = {
  "granite3.3-8b-4k": 2.85,
  "qwen3-8b-4k": 3.34,
};

/** The ratio of a model not in the table: below every measured one, so an unmeasured model is counted dense. */
export const DEFAULT_RATIO = 2.8;

/** The smallest ratio over every step of `plan`, and `DEFAULT_RATIO` for an empty one. */
export function routeRatio(plan: RoutePlan): number {
  const ratios = plan.steps.map(
    (step) => MODEL_RATIOS[step.model] ?? DEFAULT_RATIO,
  );
  return ratios.length === 0 ? DEFAULT_RATIO : Math.min(...ratios);
}

/**
 * Tokens `context` is counted as at `ratio`: its request plus the most a retry's
 * feedback can add. The epsilon keeps a request exactly at the cap from rounding up
 * over it.
 */
export function estimateTokens(context: RouteContext, ratio: number): number {
  return Math.ceil((requestChars(context) + MAX_FEEDBACK_CHARS) / ratio - 1e-9);
}

export function fitsCap(context: RouteContext, ratio: number): boolean {
  return estimateTokens(context, ratio) <= PROMPT_TOKEN_CAP;
}

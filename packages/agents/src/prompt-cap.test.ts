// The runtime cap on a god's whole prompt: which characters-per-token ratio
// the cap counts with, and how a built request is estimated against it.

import { describe, expect, test } from "bun:test";
import { parseRoutingConfig, planRoute, type RoutePlan } from "./config";
import { PROMPT_TOKEN_CAP } from "./practices";
import {
  DEFAULT_RATIO,
  estimateTokens,
  fitsCap,
  MODEL_RATIOS,
  routeRatio,
} from "./prompt-cap";
import { createRouter, MAX_FEEDBACK_CHARS, requestChars } from "./router";

const LOCAL = "http://127.0.0.1:11434/v1";
const HOSTED = "https://api.example.com/v1";

function planFor(
  endpoints: readonly { id: string; baseUrl: string; model: string }[],
  extra: Record<string, unknown>,
  offline = false,
): RoutePlan {
  const parsed = parseRoutingConfig({ endpoints, ...extra });
  if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.message}`);
  return planRoute(parsed.value, "zeus", { offline });
}

describe("the table", () => {
  test("pins the measured ratios, the default and the cap", () => {
    expect(MODEL_RATIOS["granite3.3-8b-4k"]).toBe(2.85);
    expect(MODEL_RATIOS["qwen3-8b-4k"]).toBe(3.34);
    expect(DEFAULT_RATIO).toBe(2.8);
    expect(PROMPT_TOKEN_CAP).toBe(3000);
  });
});

describe("routeRatio: the most conservative step of the planned route", () => {
  test("a role on granite3.3 alone gives 2.85", () => {
    const plan = planFor(
      [{ id: "local", baseUrl: LOCAL, model: "granite3.3-8b-4k" }],
      { roles: { zeus: { endpoint: "local" } } },
    );
    expect(routeRatio(plan)).toBe(2.85);
  });

  test("a qwen3 primary with a granite3.3 fallback gives 2.85", () => {
    const plan = planFor(
      [
        { id: "a", baseUrl: LOCAL, model: "qwen3-8b-4k" },
        { id: "b", baseUrl: LOCAL, model: "granite3.3-8b-4k" },
      ],
      { roles: { zeus: { endpoint: "a" } }, fallback: ["b"] },
    );
    expect(routeRatio(plan)).toBe(2.85);
  });

  test("a role's model override is what is looked up, not the endpoint's default", () => {
    const plan = planFor([{ id: "a", baseUrl: LOCAL, model: "qwen3-8b-4k" }], {
      roles: { zeus: { endpoint: "a", model: "granite3.3-8b-4k" } },
    });
    expect(routeRatio(plan)).toBe(2.85);
  });

  test("an unknown model gives the default, and so does an empty plan", () => {
    const unknown = planFor(
      [{ id: "a", baseUrl: LOCAL, model: "mystery-70b" }],
      { roles: { zeus: { endpoint: "a" } } },
    );
    expect(routeRatio(unknown)).toBe(2.8);
    expect(routeRatio({ steps: [], offlineSkipped: [] })).toBe(2.8);
  });

  test("an unknown model on the route pulls the ratio down to the default", () => {
    const plan = planFor(
      [
        { id: "a", baseUrl: LOCAL, model: "qwen3-8b-4k" },
        { id: "b", baseUrl: LOCAL, model: "mystery-70b" },
      ],
      { roles: { zeus: { endpoint: "a" } }, fallback: ["b"] },
    );
    expect(routeRatio(plan)).toBe(2.8);
  });

  test("offline drops a hosted fallback with a lower ratio, so the local ratio applies; online, the lower ratio applies", () => {
    const endpoints = [
      { id: "local", baseUrl: LOCAL, model: "qwen3-8b-4k" },
      { id: "hosted", baseUrl: HOSTED, model: "granite3.3-8b-4k" },
    ];
    const extra = {
      roles: { zeus: { endpoint: "local" } },
      fallback: ["hosted"],
    };
    expect(routeRatio(planFor(endpoints, extra, false))).toBe(2.85);
    expect(routeRatio(planFor(endpoints, extra, true))).toBe(3.34);
  });
});

describe("Router.plan", () => {
  test("returns the steps route would try, online and offline", () => {
    const parsed = parseRoutingConfig({
      endpoints: [
        { id: "local", baseUrl: LOCAL, model: "qwen3-8b-4k" },
        { id: "hosted", baseUrl: HOSTED, model: "granite3.3-8b-4k" },
      ],
      roles: { zeus: { endpoint: "local" } },
      fallback: ["hosted"],
    });
    if (!parsed.ok) throw new Error(parsed.message);
    for (const offline of [false, true]) {
      const router = createRouter({ config: parsed.value, offline });
      expect(router.plan("zeus")).toEqual(
        planRoute(parsed.value, "zeus", { offline }),
      );
    }
    const online = createRouter({ config: parsed.value, offline: false });
    expect(online.plan("zeus").steps.map((step) => step.endpoint.id)).toEqual([
      "local",
      "hosted",
    ]);
    const offline = createRouter({ config: parsed.value, offline: true });
    expect(offline.plan("zeus").steps.map((step) => step.endpoint.id)).toEqual([
      "local",
    ]);
    expect(offline.plan("zeus").offlineSkipped).toEqual(["hosted"]);
  });
});

describe("the estimate", () => {
  const RATIO = 2.85;
  const LIMIT = Math.round(PROMPT_TOKEN_CAP * RATIO);

  /** A context whose request, as the turn joins it, is `chars` long. */
  const sized = (chars: number) => ({
    instructions: "i".repeat(10),
    prompt: "p".repeat(chars - 10 - 2),
  });

  test("a request is counted as the turn joins it: instructions, a blank line, the prompt", () => {
    expect(requestChars(sized(100))).toBe(100);
    expect(requestChars({ prompt: "abc" })).toBe(3);
  });

  test("the retry's feedback is reserved in the estimate", () => {
    const base = sized(1000);
    const withFeedback = estimateTokens(base, RATIO);
    expect(withFeedback).toBe(Math.ceil((1000 + MAX_FEEDBACK_CHARS) / RATIO));
    expect(withFeedback).toBeGreaterThan(Math.ceil(1000 / RATIO));
  });

  test("lands exactly at the cap fits, and one character over does not", () => {
    const atCap = sized(LIMIT - MAX_FEEDBACK_CHARS);
    expect(estimateTokens(atCap, RATIO)).toBe(PROMPT_TOKEN_CAP);
    expect(fitsCap(atCap, RATIO)).toBe(true);
    const over = sized(LIMIT - MAX_FEEDBACK_CHARS + 1);
    expect(estimateTokens(over, RATIO)).toBe(PROMPT_TOKEN_CAP + 1);
    expect(fitsCap(over, RATIO)).toBe(false);
  });

  test("a request that fits only without the feedback counts as over", () => {
    const tight = sized(LIMIT - MAX_FEEDBACK_CHARS + 1);
    expect(requestChars(tight)).toBeLessThanOrEqual(LIMIT);
    expect(fitsCap(tight, RATIO)).toBe(false);
  });
});

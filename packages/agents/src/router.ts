// The production router: turns a context into a typed intent through the
// endpoints configured for a role. It tries the role's endpoint, then the
// operator's fallback list, over one adapter shape and one repair pass; no
// endpoint is favored and none is skipped except by offline mode.
//
// Inference never runs inside a world transaction, and this module knows
// nothing about the world: callers hand it a prompt and a schema and get back
// an intent or an account of why no endpoint could give one.

import {
  APICallError,
  generateText,
  jsonSchema,
  type LanguageModel,
  NoObjectGeneratedError,
  Output,
} from "ai";
import {
  type ParseResult,
  planRoute,
  type RouteStep,
  type RoutingConfig,
} from "./config";
import {
  CLIENT_HEADERS,
  createEndpointModel,
  RedirectRefusedError,
} from "./providers";
import { repairIntent } from "./repair";

/** What the model is asked to produce: the JSON Schema it is steered to, and the parser that decides whether its answer is an intent. The parser is the source of truth; the schema is guidance. */
export interface IntentSchema<T> {
  readonly jsonSchema: Parameters<typeof jsonSchema>[0];
  parse(candidate: unknown): ParseResult<T>;
}

export interface RouteContext {
  /** The character's standing instructions (a system message). */
  readonly instructions?: string;
  readonly prompt: string;
}

export interface RouteLimits {
  /** One attempt at one endpoint, from request to reply. */
  readonly attemptTimeoutMs: number;
  /** The whole chain across every endpoint and retry. */
  readonly totalTimeoutMs: number;
  /** Attempts per endpoint, the first included. */
  readonly maxAttempts: number;
  /** The delay before the second attempt; each later delay doubles. */
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
}

/**
 * The attempt limit is measured, not guessed (tools/probes/god-latency): on a
 * local qwen3 8B at a 4K context, one god request takes 3-16 s at the median
 * when the server can reuse the start of the last one (up to 20 s at the p95),
 * 14-23 s with nothing cached (p95 about 30 s on a machine under other load,
 * worst 32 s), and 23-28 s for the first request after the model loads. 15 s cut off most of them with the answer a
 * few seconds away, and a timed-out request wastes all of its time; 45 s is the
 * cold p95 with half again on top. The chain limit leaves room for one such
 * attempt and a retry's backoff. A request that fails fast is still retried.
 */
export const DEFAULT_ROUTE_LIMITS: RouteLimits = {
  attemptTimeoutMs: 45_000,
  totalTimeoutMs: 60_000,
  maxAttempts: 2,
  backoffBaseMs: 250,
  backoffMaxMs: 2_000,
};

export interface RouterOptions {
  readonly config: RoutingConfig;
  /** Offline mode: non-local endpoints are removed before any adapter is built. */
  readonly offline: boolean;
  /**
   * Returns the key for a `keyRef`, from platform credential storage. Called
   * only when an endpoint that has a `keyRef` is about to be built, so an
   * endpoint offline mode removed never has its key touched. The router never
   * reads a key from anywhere else and never logs one.
   */
  readonly getKey?: (keyRef: string) => string | undefined;
  readonly limits?: Partial<RouteLimits>;
  /** Replaces the adapter factory; tests use it to observe construction. */
  readonly buildModel?: typeof createEndpointModel;
  /** Waits between retries; resolves early when the signal aborts. Tests replace it to see the requested delays without real time. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export type FailureReason =
  /** One attempt ran past its own timeout. */
  | "timeout"
  /** The whole chain ran out of time. */
  | "chain-timeout"
  /** The caller aborted. */
  | "aborted"
  | "rate-limit"
  | "http-4xx"
  | "http-5xx"
  /** The endpoint could not be reached. */
  | "network"
  /** The endpoint answered with a redirect, which is refused. */
  | "redirect"
  /** The model answered, but nothing in the reply parsed as an intent. */
  | "invalid-output"
  /** The endpoint needs a key and none is set: nothing was sent. */
  | "key-missing"
  | "unknown";

export interface StepMetadata {
  readonly endpoint: string;
  readonly model: string;
  readonly attempts: number;
  /** `native` when the reply parsed as structured output; `repaired` when the repair pass had to extract it. */
  readonly mode: "native" | "repaired";
  readonly elapsedMs: number;
}

export interface StepFailure {
  readonly endpoint: string;
  readonly model: string;
  readonly reason: FailureReason;
  /** A short account, with any key value redacted. */
  readonly detail: string;
  readonly attempts: number;
  readonly elapsedMs: number;
  /** For an invalid reply: the last reply the model gave, redacted and bounded, so a refusal can be read for what it was. */
  readonly output?: string;
  /** For an invalid reply: the intent schema this request was made with, redacted and bounded (the world moves on; the schema it was asked under does not). */
  readonly schema?: string;
}

export type RouteResult<T> =
  | {
      readonly kind: "intent";
      readonly intent: T;
      readonly step: StepMetadata;
      /** Steps tried and failed before this one answered, in order. */
      readonly failed: readonly StepFailure[];
      readonly elapsedMs: number;
    }
  | {
      readonly kind: "exhausted";
      /** Every step tried, in order, with why it failed. */
      readonly steps: readonly StepFailure[];
      /** Endpoint ids offline mode removed, so "nothing local is configured" reads differently from an outage. */
      readonly offlineSkipped: readonly string[];
      readonly elapsedMs: number;
    };

export interface Router {
  route<T>(
    role: string,
    context: RouteContext,
    schema: IntentSchema<T>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<RouteResult<T>>;
}

type Attempt<T> =
  | {
      readonly ok: true;
      readonly intent: T;
      readonly mode: "native" | "repaired";
    }
  | {
      readonly ok: false;
      readonly reason: FailureReason;
      readonly detail: string;
      /** The reply refused, for `invalid-output`. */
      readonly output?: string;
    };

const RETRYABLE: ReadonlySet<FailureReason> = new Set([
  "rate-limit",
  "http-5xx",
  "network",
  "invalid-output",
]);

const DETAIL_LIMIT = 300;
/** How much of a refused reply, and of the schema it was asked under, a failure keeps. */
const OUTPUT_LIMIT = 1_000;
const SCHEMA_LIMIT = 8_000;
/** How much of a refusal's reason a retry is told. */
const FEEDBACK_LIMIT = 400;

/** What a retry after an invalid reply adds to the prompt: why it was refused, and what to do about it. */
function feedbackFor(detail: string): string {
  return `Your last reply was refused: ${detail.slice(0, FEEDBACK_LIMIT)}. Reply with one corrected JSON object.`;
}

/** An endpoint with a `keyRef` has no key to send. Names the `keyRef`, never a key. */
class KeyMissingError extends Error {
  constructor(keyRef: string) {
    super(`key not set (${keyRef})`);
    this.name = "KeyMissingError";
  }
}

function describe(error: unknown): string {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode === undefined ? "" : `${error.statusCode} `;
    // Whole: the caller redacts a key from the full text, then truncates.
    const body = error.responseBody ?? "";
    return `${status}${error.message}${body === "" ? "" : `: ${body}`}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}

function schemaInstruction<T>(schema: IntentSchema<T>): string {
  return `Respond with a single JSON object only, no prose, that matches this JSON Schema:\n${JSON.stringify(schema.jsonSchema)}`;
}

export function createRouter(options: RouterOptions): Router {
  const limits: RouteLimits = { ...DEFAULT_ROUTE_LIMITS, ...options.limits };
  const build = options.buildModel ?? createEndpointModel;
  const wait = options.sleep ?? sleep;
  const built = new Map<string, { model: LanguageModel; apiKey?: string }>();

  /** Builds an endpoint's adapter on first use, reading its key only then. */
  function adapterFor(step: RouteStep): {
    model: LanguageModel;
    apiKey?: string;
  } {
    const cacheKey = `${step.endpoint.id}\n${step.model}`;
    const cached = built.get(cacheKey);
    if (cached) {
      return cached;
    }
    const keyRef = step.endpoint.keyRef;
    const apiKey = keyRef === undefined ? undefined : options.getKey?.(keyRef);
    // Nothing is sent to a keyed endpoint without its key: an upstream 401
    // would only hide that the operator has not set one.
    if (keyRef !== undefined && (apiKey === undefined || apiKey === "")) {
      throw new KeyMissingError(keyRef);
    }
    const adapter = {
      model: build({
        endpoint: step.endpoint,
        model: step.model,
        ...(apiKey === undefined ? {} : { apiKey }),
      }),
      ...(apiKey === undefined ? {} : { apiKey }),
    };
    built.set(cacheKey, adapter);
    return adapter;
  }

  function classify(
    error: unknown,
    chain: AbortSignal,
    caller: AbortSignal | undefined,
  ): { reason: FailureReason; detail: string } {
    const detail = describe(error);
    if (caller?.aborted) {
      return { reason: "aborted", detail: "aborted by the caller" };
    }
    if (chain.aborted) {
      return {
        reason: "chain-timeout",
        detail: `the ${limits.totalTimeoutMs} ms chain timeout ran out`,
      };
    }
    if (error instanceof RedirectRefusedError) {
      return { reason: "redirect", detail };
    }
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      return {
        reason: "timeout",
        detail: `no reply within ${limits.attemptTimeoutMs} ms`,
      };
    }
    if (APICallError.isInstance(error)) {
      const status = error.statusCode;
      if (status === undefined) return { reason: "network", detail };
      if (status === 429) return { reason: "rate-limit", detail };
      if (status >= 500) return { reason: "http-5xx", detail };
      if (status >= 400) return { reason: "http-4xx", detail };
    }
    return { reason: "unknown", detail };
  }

  /** One attempt: a structured-output request; on malformed JSON the repair pass; on an endpoint that rejects the schema request (400/422) one plain-text request and the repair pass. */
  async function attempt<T>(
    model: LanguageModel,
    context: RouteContext,
    schema: IntentSchema<T>,
    chain: AbortSignal,
    caller: AbortSignal | undefined,
    reasoningEffort: "none" | undefined,
    feedback?: string,
  ): Promise<Attempt<T>> {
    const startedAt = performance.now();
    const request = (timeoutMs: number) => ({
      model,
      // The key the adapter reads for `reasoning_effort`
      // (@ai-sdk/openai-compatible, chat model options). Set on both the
      // structured request and the plain-text fallback, or neither.
      ...(reasoningEffort === undefined
        ? {}
        : { providerOptions: { openaiCompatible: { reasoningEffort } } }),
      ...(context.instructions === undefined
        ? {}
        : { instructions: context.instructions }),
      headers: CLIENT_HEADERS,
      abortSignal: chain,
      timeout: timeoutMs,
      maxRetries: 0,
    });
    const invalid = (message: string, output?: string): Attempt<T> => ({
      ok: false,
      reason: "invalid-output",
      detail: message,
      ...(output === undefined ? {} : { output }),
    });
    const asked =
      feedback === undefined
        ? context.prompt
        : `${context.prompt}\n\n${feedback}`;

    let text: string | undefined;
    try {
      const result = await generateText({
        ...request(limits.attemptTimeoutMs),
        prompt: asked,
        output: Output.object({ schema: jsonSchema(schema.jsonSchema) }),
      });
      const parsed = schema.parse(result.output);
      return parsed.ok
        ? { ok: true, intent: parsed.value, mode: "native" }
        : invalid(
            `${parsed.path === "" ? "" : `${parsed.path}: `}${parsed.message}`,
            JSON.stringify(result.output),
          );
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        text = error.text ?? "";
      } else if (
        APICallError.isInstance(error) &&
        (error.statusCode === 400 || error.statusCode === 422)
      ) {
        text = undefined;
      } else {
        return { ok: false, ...classify(error, chain, caller) };
      }
    }

    if (text === undefined) {
      try {
        const remaining = Math.max(
          1,
          limits.attemptTimeoutMs - (performance.now() - startedAt),
        );
        const result = await generateText({
          ...request(remaining),
          prompt: `${asked}\n\n${schemaInstruction(schema)}`,
        });
        text = result.text;
      } catch (error) {
        return { ok: false, ...classify(error, chain, caller) };
      }
    }

    const repaired = repairIntent(text, schema.parse);
    return repaired.ok
      ? { ok: true, intent: repaired.value, mode: "repaired" }
      : invalid(repaired.message, text);
  }

  async function tryStep<T>(
    step: RouteStep,
    context: RouteContext,
    schema: IntentSchema<T>,
    chain: AbortSignal,
    chainDeadline: number,
    caller: AbortSignal | undefined,
  ): Promise<
    | { readonly ok: true; readonly intent: T; readonly step: StepMetadata }
    | {
        readonly ok: false;
        readonly failure: StepFailure;
        readonly halt: boolean;
      }
  > {
    const startedAt = performance.now();
    const endpoint = step.endpoint.id;
    const redact = (
      text: string,
      apiKey: string | undefined,
      limit = DETAIL_LIMIT,
    ): string => {
      let clean = text;
      if (apiKey !== undefined && apiKey !== "") {
        // The key as sent, and as JSON writes it inside a string: an error
        // body that is JSON echoes a key holding a quote or backslash escaped.
        const escaped = JSON.stringify(apiKey).slice(1, -1);
        for (const form of escaped === apiKey ? [apiKey] : [escaped, apiKey]) {
          clean = clean.split(form).join("[redacted]");
        }
      }
      return clean.slice(0, limit);
    };

    let adapter: { model: LanguageModel; apiKey?: string };
    try {
      adapter = adapterFor(step);
    } catch (error) {
      if (error instanceof KeyMissingError) {
        return {
          ok: false,
          halt: false,
          failure: {
            endpoint,
            model: step.model,
            reason: "key-missing",
            detail: error.message,
            attempts: 0,
            elapsedMs: performance.now() - startedAt,
          },
        };
      }
      return {
        ok: false,
        halt: false,
        failure: {
          endpoint,
          model: step.model,
          reason: "unknown",
          detail: redact(
            `could not build the adapter: ${describe(error)}`,
            undefined,
          ),
          attempts: 0,
          elapsedMs: performance.now() - startedAt,
        },
      };
    }

    let attempts = 0;
    let last: Extract<Attempt<T>, { ok: false }>;
    // What the last attempt was refused for, told to the next one: only an invalid reply earns it, since a transport failure has nothing to correct.
    let feedback: string | undefined;
    for (;;) {
      attempts += 1;
      const outcome = await attempt(
        adapter.model,
        context,
        schema,
        chain,
        caller,
        step.endpoint.reasoningEffort,
        feedback,
      );
      if (outcome.ok) {
        return {
          ok: true,
          intent: outcome.intent,
          step: {
            endpoint,
            model: step.model,
            attempts,
            mode: outcome.mode,
            elapsedMs: performance.now() - startedAt,
          },
        };
      }
      last = outcome;
      // Redacted before it is built, so a key a parser's reason echoes (raw or as JSON writes it) never reaches the retried prompt.
      feedback =
        outcome.reason === "invalid-output"
          ? feedbackFor(redact(outcome.detail, adapter.apiKey, FEEDBACK_LIMIT))
          : undefined;
      if (!RETRYABLE.has(outcome.reason) || attempts >= limits.maxAttempts) {
        break;
      }
      const delay = Math.min(
        limits.backoffBaseMs * 2 ** (attempts - 1),
        limits.backoffMaxMs,
      );
      // A retry that could not finish inside the chain is not started.
      if (performance.now() + delay >= chainDeadline) {
        break;
      }
      await wait(delay, chain);
      if (chain.aborted) {
        last = { ok: false, ...classify(new Error("aborted"), chain, caller) };
        break;
      }
    }

    return {
      ok: false,
      halt: last.reason === "chain-timeout" || last.reason === "aborted",
      failure: {
        endpoint,
        model: step.model,
        reason: last.reason,
        detail: redact(last.detail, adapter.apiKey),
        attempts,
        elapsedMs: performance.now() - startedAt,
        ...(last.reason === "invalid-output"
          ? {
              ...(last.output === undefined
                ? {}
                : {
                    output: redact(last.output, adapter.apiKey, OUTPUT_LIMIT),
                  }),
              schema: redact(
                JSON.stringify(schema.jsonSchema),
                adapter.apiKey,
                SCHEMA_LIMIT,
              ),
            }
          : {}),
      },
    };
  }

  return {
    async route(role, context, schema, routeOptions) {
      const startedAt = performance.now();
      const plan = planRoute(options.config, role, {
        offline: options.offline,
      });
      const caller = routeOptions?.signal;
      const timeout = AbortSignal.timeout(limits.totalTimeoutMs);
      const chain = caller ? AbortSignal.any([timeout, caller]) : timeout;
      const chainDeadline = startedAt + limits.totalTimeoutMs;

      const failed: StepFailure[] = [];
      for (const step of plan.steps) {
        if (chain.aborted) {
          break;
        }
        const outcome = await tryStep(
          step,
          context,
          schema,
          chain,
          chainDeadline,
          caller,
        );
        if (outcome.ok) {
          return {
            kind: "intent",
            intent: outcome.intent,
            step: outcome.step,
            failed,
            elapsedMs: performance.now() - startedAt,
          };
        }
        failed.push(outcome.failure);
        if (outcome.halt) {
          break;
        }
      }
      return {
        kind: "exhausted",
        steps: failed,
        offlineSkipped: plan.offlineSkipped,
        elapsedMs: performance.now() - startedAt,
      };
    },
  };
}

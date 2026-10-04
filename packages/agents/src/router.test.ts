import { afterEach, describe, expect, test } from "bun:test";
import {
  type ParseResult,
  parseRoutingConfig,
  type RoutingConfig,
} from "./config";
import { createEndpointModel } from "./providers";
import {
  createRouter,
  DEFAULT_ROUTE_LIMITS,
  type IntentSchema,
  type RouteLimits,
  type RouterOptions,
} from "./router";

// --- A scripted OpenAI-compatible endpoint on loopback -----------------------

type Reply =
  | { readonly content: string; readonly delayMs?: number }
  | {
      readonly status: number;
      readonly body?: string;
      readonly delayMs?: number;
    }
  | { readonly redirectTo: string };

interface Seen {
  readonly body: Record<string, unknown>;
  readonly headers: Headers;
  readonly at: number;
}

interface Stub {
  readonly baseUrl: string;
  readonly seen: Seen[];
  stop(): void;
}

const stubs: Stub[] = [];

afterEach(() => {
  for (const stub of stubs.splice(0)) stub.stop();
});

function completion(content: string): Response {
  return Response.json({
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 1,
    model: "scripted",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

async function respond(reply: Reply): Promise<Response> {
  if ("redirectTo" in reply) {
    return new Response(null, {
      status: 302,
      headers: { location: reply.redirectTo },
    });
  }
  if (reply.delayMs) await Bun.sleep(reply.delayMs);
  if ("status" in reply) {
    return new Response(reply.body ?? "scripted failure", {
      status: reply.status,
    });
  }
  return completion(reply.content);
}

/** Serves `script(n)` for the nth request (0-based) at `/v1/chat/completions`. */
function startStub(script: (n: number) => Reply): Stub {
  const seen: Seen[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") {
        return new Response("not found", { status: 404 });
      }
      const n = seen.length;
      seen.push({
        body: (await request.json()) as Record<string, unknown>,
        headers: request.headers,
        at: performance.now(),
      });
      return respond(script(n));
    },
  });
  const stub: Stub = {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    seen,
    stop: () => server.stop(true),
  };
  stubs.push(stub);
  return stub;
}

const always = (reply: Reply) => () => reply;
const sequence =
  (...replies: Reply[]) =>
  (n: number) =>
    replies[Math.min(n, replies.length - 1)] as Reply;

// --- An intent schema and a config ----------------------------------------------

interface Say {
  readonly kind: "say";
  readonly text: string;
}

const sayIntent: IntentSchema<Say> = {
  jsonSchema: {
    type: "object",
    properties: { kind: { const: "say" }, text: { type: "string" } },
    required: ["kind", "text"],
    additionalProperties: false,
  },
  parse(candidate: unknown): ParseResult<Say> {
    const value = candidate as { kind?: unknown; text?: unknown } | null;
    return value?.kind === "say" && typeof value.text === "string"
      ? { ok: true, value: { kind: "say", text: value.text } }
      : { ok: false, path: "", message: "not a say intent" };
  },
};

const SAY = '{"kind":"say","text":"hail"}';
const HAIL: Say = { kind: "say", text: "hail" };

function configFor(
  endpoints: readonly {
    id: string;
    baseUrl: string;
    keyRef?: string;
    reasoningEffort?: string;
  }[],
  extra: Record<string, unknown> = {},
): RoutingConfig {
  const result = parseRoutingConfig({
    endpoints: endpoints.map((endpoint) => ({
      model: "scripted",
      ...endpoint,
    })),
    ...extra,
  });
  if (!result.ok) throw new Error(`${result.path}: ${result.message}`);
  return result.value;
}

const FAST: RouteLimits = {
  attemptTimeoutMs: 2_000,
  totalTimeoutMs: 10_000,
  maxAttempts: 2,
  backoffBaseMs: 1,
  backoffMaxMs: 4,
};

function routerFor(
  config: RoutingConfig,
  options: Partial<Omit<RouterOptions, "config" | "limits">> & {
    limits?: Partial<RouteLimits>;
  } = {},
) {
  const { limits, ...rest } = options;
  return createRouter({
    config,
    offline: false,
    ...rest,
    limits: { ...FAST, ...limits },
  });
}

const context = { instructions: "You are Zeus.", prompt: "What do you do?" };

// --- Tests -------------------------------------------------------------------------

describe("route: a scripted local endpoint", () => {
  test("valid JSON becomes a typed intent with step metadata", async () => {
    const stub = startStub(always({ content: SAY }));
    const router = routerFor(
      configFor([{ id: "ollama", baseUrl: stub.baseUrl }], {
        roles: { zeus: { endpoint: "ollama" } },
      }),
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(result.kind).toBe("intent");
    if (result.kind === "intent") {
      expect(result.intent).toEqual(HAIL);
      expect(result.step).toMatchObject({
        endpoint: "ollama",
        model: "scripted",
        attempts: 1,
        mode: "native",
      });
      expect(result.step.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(result.step.elapsedMs);
      expect(result.failed).toEqual([]);
    }
  });

  test("the request carries the model, the instructions, the prompt, the schema, and no Authorization when the endpoint has no key", async () => {
    const stub = startStub(always({ content: SAY }));
    const router = routerFor(
      configFor([{ id: "ollama", baseUrl: stub.baseUrl }], {
        roles: { zeus: { endpoint: "ollama" } },
      }),
    );

    await router.route("zeus", context, sayIntent);

    const [request] = stub.seen;
    expect(request?.body.model).toBe("scripted");
    expect(JSON.stringify(request?.body.messages)).toContain("You are Zeus.");
    expect(JSON.stringify(request?.body.messages)).toContain("What do you do?");
    expect(JSON.stringify(request?.body.response_format)).toContain('"kind"');
    expect(request?.headers.get("authorization")).toBeNull();
  });

  test("identifies the client with a User-Agent and one stable session id across requests", async () => {
    const stub = startStub(always({ content: SAY }));
    const router = routerFor(
      configFor([{ id: "ollama", baseUrl: stub.baseUrl }], {
        roles: { zeus: { endpoint: "ollama" } },
      }),
    );

    await router.route("zeus", context, sayIntent);
    await router.route("zeus", context, sayIntent);

    const sessions = stub.seen.map((seen) =>
      seen.headers.get("x-opencode-session"),
    );
    expect(sessions[0]).toBeTruthy();
    expect(sessions[1]).toBe(sessions[0]);
    expect(stub.seen[0]?.headers.get("user-agent")).toContain("panthea");
  });

  test("a role's model override reaches the request, and an unassigned role uses the global fallback list", async () => {
    const stub = startStub(always({ content: SAY }));
    const config = configFor([{ id: "ollama", baseUrl: stub.baseUrl }], {
      roles: { zeus: { endpoint: "ollama", model: "zeus-model" } },
      fallback: ["ollama"],
    });
    const router = routerFor(config);

    await router.route("zeus", context, sayIntent);
    await router.route("hermes", context, sayIntent);

    expect(stub.seen.map((seen) => seen.body.model)).toEqual([
      "zeus-model",
      "scripted",
    ]);
  });
});

describe("route: repair", () => {
  test("a fenced reply is repaired into the intent", async () => {
    const stub = startStub(always({ content: `\`\`\`json\n${SAY}\n\`\`\`` }));
    const router = routerFor(
      configFor([{ id: "ollama", baseUrl: stub.baseUrl }], {
        roles: { zeus: { endpoint: "ollama" } },
      }),
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(result.kind).toBe("intent");
    if (result.kind === "intent") {
      expect(result.intent).toEqual(HAIL);
      expect(result.step.mode).toBe("repaired");
      expect(result.step.attempts).toBe(1);
    }
    expect(stub.seen).toHaveLength(1);
  });

  test("an endpoint set to reasoning effort none sends reasoning_effort on the structured request and on the plain-text fallback", async () => {
    const stub = startStub(
      sequence(
        { status: 400, body: "response_format is not supported" },
        { content: `Sure! ${SAY}` },
      ),
    );
    const router = routerFor(
      configFor(
        [{ id: "ollama", baseUrl: stub.baseUrl, reasoningEffort: "none" }],
        { roles: { zeus: { endpoint: "ollama" } } },
      ),
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(result.kind).toBe("intent");
    // The structured request, then the fallback: both ask for no reasoning.
    expect(stub.seen).toHaveLength(2);
    expect(stub.seen[0]?.body.reasoning_effort).toBe("none");
    expect(stub.seen[1]?.body.reasoning_effort).toBe("none");
  });

  test("an endpoint with no reasoning effort set sends none: its requests are unchanged", async () => {
    const stub = startStub(
      sequence(
        { status: 400, body: "response_format is not supported" },
        { content: `Sure! ${SAY}` },
      ),
    );
    const router = routerFor(
      configFor([{ id: "ollama", baseUrl: stub.baseUrl }], {
        roles: { zeus: { endpoint: "ollama" } },
      }),
    );

    await router.route("zeus", context, sayIntent);

    expect(stub.seen).toHaveLength(2);
    for (const request of stub.seen) {
      expect(request.body).not.toHaveProperty("reasoning_effort");
    }
  });

  test("the setting belongs to its endpoint: a fallback endpoint without it sends none", async () => {
    const primary = startStub(always({ status: 500 }));
    const fallback = startStub(always({ content: SAY }));
    const router = routerFor(
      configFor(
        [
          { id: "primary", baseUrl: primary.baseUrl, reasoningEffort: "none" },
          { id: "fallback", baseUrl: fallback.baseUrl },
        ],
        {
          roles: { zeus: { endpoint: "primary" } },
          fallback: ["fallback"],
        },
      ),
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(result.kind).toBe("intent");
    expect(primary.seen[0]?.body.reasoning_effort).toBe("none");
    expect(fallback.seen).toHaveLength(1);
    expect(fallback.seen[0]?.body).not.toHaveProperty("reasoning_effort");
  });

  test.each([[400], [422]])(
    "an endpoint that rejects the schema request with %d gets one plain-text request that states the schema, and its reply is repaired",
    async (status) => {
      const stub = startStub(
        sequence(
          { status, body: "response_format is not supported" },
          { content: `Sure! ${SAY}` },
        ),
      );
      const router = routerFor(
        configFor([{ id: "ollama", baseUrl: stub.baseUrl }], {
          roles: { zeus: { endpoint: "ollama" } },
        }),
      );

      const result = await router.route("zeus", context, sayIntent);

      expect(result.kind).toBe("intent");
      if (result.kind === "intent") {
        expect(result.step).toMatchObject({ mode: "repaired", attempts: 1 });
      }
      expect(stub.seen).toHaveLength(2);
      expect(stub.seen[1]?.body.response_format).toBeUndefined();
      const messages = stub.seen[1]?.body.messages as { content: string }[];
      expect(messages.map((message) => message.content).join("\n")).toContain(
        '"required":["kind","text"]',
      );
    },
  );

  test("garbage on the first attempt and a valid reply on the retry is one step with two attempts, native", async () => {
    const stub = startStub(
      sequence({ content: "I cannot help with that" }, { content: SAY }),
    );
    const router = routerFor(
      configFor([{ id: "ollama", baseUrl: stub.baseUrl }], {
        roles: { zeus: { endpoint: "ollama" } },
      }),
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(result.kind).toBe("intent");
    if (result.kind === "intent") {
      expect(result.step).toMatchObject({ attempts: 2, mode: "native" });
    }
  });

  test("valid JSON the schema rejects is invalid output, not an intent", async () => {
    const stub = startStub(always({ content: '{"kind":"fly"}' }));
    const router = routerFor(
      configFor([{ id: "ollama", baseUrl: stub.baseUrl }], {
        roles: { zeus: { endpoint: "ollama" } },
      }),
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(result.kind).toBe("exhausted");
    if (result.kind === "exhausted") {
      expect(result.steps[0]).toMatchObject({
        endpoint: "ollama",
        reason: "invalid-output",
      });
      expect(result.steps[0]?.detail).toContain("not a say intent");
    }
  });

  test("the retry after an invalid reply tells the model why it was refused; the first request does not, and nothing else is added", async () => {
    const stub = startStub(
      sequence({ content: '{"kind":"fly"}' }, { content: SAY }),
    );
    const router = routerFor(
      configFor([{ id: "ollama", baseUrl: stub.baseUrl }], {
        roles: { zeus: { endpoint: "ollama" } },
      }),
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(result.kind).toBe("intent");
    if (result.kind === "intent") {
      expect(result.step).toMatchObject({ attempts: 2, mode: "native" });
    }
    const text = (n: number) => JSON.stringify(stub.seen[n]?.body.messages);
    expect(text(0)).not.toContain("not a say intent");
    expect(text(1)).toContain("not a say intent");
    expect(text(1)).toContain("What do you do?");
    // The instructions and the schema request are unchanged.
    expect(text(1)).toContain("You are Zeus.");
    expect(JSON.stringify(stub.seen[1]?.body.response_format)).toContain(
      '"kind"',
    );
  });

  test("a retry for any other failure repeats the same prompt: only an invalid reply earns feedback", async () => {
    const stub = startStub(sequence({ status: 500 }, { content: SAY }));
    const router = routerFor(
      configFor([{ id: "ollama", baseUrl: stub.baseUrl }], {
        roles: { zeus: { endpoint: "ollama" } },
      }),
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(result.kind).toBe("intent");
    expect(JSON.stringify(stub.seen[1]?.body.messages)).toBe(
      JSON.stringify(stub.seen[0]?.body.messages),
    );
  });

  test("the feedback is bounded: a long refusal reason is cut, and a second retry never stacks the first's", async () => {
    const long = `${"x".repeat(5_000)} tail`;
    const picky: IntentSchema<Say> = {
      ...sayIntent,
      parse: () => ({ ok: false, path: "", message: long }),
    };
    const stub = startStub(always({ content: SAY }));
    const router = routerFor(
      configFor([{ id: "ollama", baseUrl: stub.baseUrl }], {
        roles: { zeus: { endpoint: "ollama" } },
      }),
      { limits: { maxAttempts: 3 } },
    );

    await router.route("zeus", context, picky);

    expect(stub.seen).toHaveLength(3);
    const second = JSON.stringify(stub.seen[1]?.body.messages);
    const third = JSON.stringify(stub.seen[2]?.body.messages);
    expect(second.length).toBeLessThan(2_000);
    expect(third.length).toBeLessThan(2_000);
    expect(second).not.toContain("tail");
    // One refusal quoted, not two.
    expect(third.split("was refused").length).toBe(2);
  });

  test("a key echoed in a parser's reason, raw or as JSON escapes it, never reaches the retried prompt", async () => {
    // A key holding a quote and a backslash, so its JSON-escaped form differs from the raw one.
    const KEY = 'sk-"live"\\key-0123456789';
    const escaped = JSON.stringify(KEY).slice(1, -1);
    expect(escaped).not.toBe(KEY);
    const leaky: IntentSchema<Say> = {
      ...sayIntent,
      parse: () => ({
        ok: false,
        path: "text",
        message: `refused near ${KEY} and ${escaped}`,
      }),
    };
    const stub = startStub(always({ content: SAY }));
    const router = routerFor(
      configFor([{ id: "ollama", baseUrl: stub.baseUrl, keyRef: "k" }], {
        roles: { zeus: { endpoint: "ollama" } },
      }),
      { getKey: () => KEY },
    );

    const result = await router.route("zeus", context, leaky);

    expect(result.kind).toBe("exhausted");
    expect(stub.seen).toHaveLength(2);
    const retried = JSON.stringify(stub.seen[1]?.body.messages);
    expect(retried).toContain("was refused");
    expect(retried).toContain("[redacted]");
    expect(retried).not.toContain(KEY);
    expect(retried).not.toContain(escaped);
    expect(
      JSON.stringify(stub.seen[1]?.body.messages).includes("refused near"),
    ).toBe(true);
    // Control: with no key loaded, the same reason reaches the retry whole, so the redaction is what removed it.
    const open = startStub(always({ content: SAY }));
    await routerFor(
      configFor([{ id: "ollama", baseUrl: open.baseUrl }], {
        roles: { zeus: { endpoint: "ollama" } },
      }),
    ).route("zeus", context, leaky);
    expect(JSON.stringify(open.seen[1]?.body.messages)).toContain("sk-");
  });

  test("an exhausted step keeps what was refused: the last reply, redacted and bounded, the request-time schema, and the attempt count", async () => {
    const KEY = "sk-live-0123456789abcdef";
    const stub = startStub(
      always({ content: `{"kind":"fly","note":"${KEY}"}` }),
    );
    const router = routerFor(
      configFor([{ id: "ollama", baseUrl: stub.baseUrl, keyRef: "k" }], {
        roles: { zeus: { endpoint: "ollama" } },
      }),
      { getKey: () => KEY },
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(result.kind).toBe("exhausted");
    if (result.kind !== "exhausted") return;
    const [step] = result.steps;
    expect(step).toMatchObject({ reason: "invalid-output", attempts: 2 });
    expect(step?.output).toContain('"kind":"fly"');
    expect(step?.output).not.toContain(KEY);
    expect(step?.output).toContain("[redacted]");
    expect(step?.schema).toBe(JSON.stringify(sayIntent.jsonSchema));
  });

  test("an invalid reply that is not JSON is kept as the text it was, and an outage keeps no reply", async () => {
    const garbage = startStub(always({ content: "I cannot help with that" }));
    const router = routerFor(
      configFor([{ id: "ollama", baseUrl: garbage.baseUrl }], {
        roles: { zeus: { endpoint: "ollama" } },
      }),
    );
    const refused = await router.route("zeus", context, sayIntent);
    if (refused.kind !== "exhausted") throw new Error("expected exhausted");
    expect(refused.steps[0]?.output).toContain("I cannot help with that");

    const down = startStub(always({ status: 500 }));
    const outage = await routerFor(
      configFor([{ id: "ollama", baseUrl: down.baseUrl }], {
        roles: { zeus: { endpoint: "ollama" } },
      }),
    ).route("zeus", context, sayIntent);
    if (outage.kind !== "exhausted") throw new Error("expected exhausted");
    expect(outage.steps[0]?.reason).toBe("http-5xx");
    expect(outage.steps[0]?.output).toBeUndefined();
    expect(outage.steps[0]?.schema).toBeUndefined();
  });

  test("unrepairable output is retried a bounded number of times, then falls through to the next step", async () => {
    const bad = startStub(always({ content: "no json, sorry" }));
    const good = startStub(always({ content: SAY }));
    const router = routerFor(
      configFor(
        [
          { id: "first", baseUrl: bad.baseUrl },
          { id: "second", baseUrl: good.baseUrl },
        ],
        { roles: { zeus: { endpoint: "first", fallback: ["second"] } } },
      ),
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(result.kind).toBe("intent");
    if (result.kind === "intent") {
      expect(result.intent).toEqual(HAIL);
      expect(result.step.endpoint).toBe("second");
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toMatchObject({
        endpoint: "first",
        reason: "invalid-output",
        attempts: FAST.maxAttempts,
      });
    }
    expect(bad.seen).toHaveLength(FAST.maxAttempts);
    expect(good.seen).toHaveLength(1);
  });
});

describe("route: failure, timeouts, and backoff", () => {
  test("a step that times out is not retried, and the next step answers", async () => {
    const slow = startStub(always({ content: SAY, delayMs: 800 }));
    const fast = startStub(always({ content: SAY }));
    const router = routerFor(
      configFor(
        [
          { id: "slow", baseUrl: slow.baseUrl },
          { id: "fast", baseUrl: fast.baseUrl },
        ],
        { roles: { zeus: { endpoint: "slow", fallback: ["fast"] } } },
      ),
      { limits: { attemptTimeoutMs: 150 } },
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(result.kind).toBe("intent");
    if (result.kind === "intent") {
      expect(result.step.endpoint).toBe("fast");
      expect(result.failed[0]).toMatchObject({
        endpoint: "slow",
        reason: "timeout",
        attempts: 1,
      });
    }
    expect(slow.seen).toHaveLength(1);
  });

  test("when every step fails, the result is exhausted with each step's reason", async () => {
    const overloaded = startStub(always({ status: 500 }));
    const forbidden = startStub(always({ status: 401 }));
    const limited = startStub(always({ status: 429 }));
    const closed = startStub(always({ content: SAY }));
    const closedUrl = closed.baseUrl;
    closed.stop();
    const router = routerFor(
      configFor(
        [
          { id: "overloaded", baseUrl: overloaded.baseUrl },
          { id: "forbidden", baseUrl: forbidden.baseUrl },
          { id: "limited", baseUrl: limited.baseUrl },
          { id: "closed", baseUrl: closedUrl },
        ],
        {
          roles: {
            zeus: {
              endpoint: "overloaded",
              fallback: ["forbidden", "limited", "closed"],
            },
          },
        },
      ),
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(result.kind).toBe("exhausted");
    if (result.kind === "exhausted") {
      expect(
        result.steps.map((step) => [step.endpoint, step.reason, step.attempts]),
      ).toEqual([
        ["overloaded", "http-5xx", FAST.maxAttempts],
        ["forbidden", "http-4xx", 1],
        ["limited", "rate-limit", FAST.maxAttempts],
        ["closed", "network", FAST.maxAttempts],
      ]);
      expect(result.offlineSkipped).toEqual([]);
    }
    expect(overloaded.seen).toHaveLength(FAST.maxAttempts);
    expect(forbidden.seen).toHaveLength(1);
  });

  test("retry delays double from the base and are capped: 60, 100, 100 for base 60 and cap 100", async () => {
    const stub = startStub(always({ status: 503 }));
    const delays: number[] = [];
    const router = routerFor(
      configFor([{ id: "ollama", baseUrl: stub.baseUrl }], {
        roles: { zeus: { endpoint: "ollama" } },
      }),
      {
        limits: { maxAttempts: 4, backoffBaseMs: 60, backoffMaxMs: 100 },
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(delays).toEqual([60, 100, 100]);
    expect(stub.seen).toHaveLength(4);
    expect(result).toMatchObject({
      kind: "exhausted",
      steps: [{ endpoint: "ollama", reason: "http-5xx", attempts: 4 }],
    });
  });

  test("a step that is not retried never sleeps", async () => {
    const stub = startStub(always({ status: 401 }));
    const delays: number[] = [];
    const router = routerFor(
      configFor([{ id: "ollama", baseUrl: stub.baseUrl }], {
        roles: { zeus: { endpoint: "ollama" } },
      }),
      {
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    await router.route("zeus", context, sayIntent);

    expect(delays).toEqual([]);
  });

  test("the total chain timeout ends the whole route: the step in flight fails as chain-timeout and no later step is tried", async () => {
    const slow = startStub(always({ content: SAY, delayMs: 2_000 }));
    const spare = startStub(always({ content: SAY }));
    const router = routerFor(
      configFor(
        [
          { id: "slow", baseUrl: slow.baseUrl },
          { id: "spare", baseUrl: spare.baseUrl },
        ],
        { roles: { zeus: { endpoint: "slow", fallback: ["spare"] } } },
      ),
      { limits: { attemptTimeoutMs: 5_000, totalTimeoutMs: 200 } },
    );

    const started = performance.now();
    const result = await router.route("zeus", context, sayIntent);

    expect(performance.now() - started).toBeLessThan(1_500);
    expect(result.kind).toBe("exhausted");
    if (result.kind === "exhausted") {
      expect(result.steps.map((step) => [step.endpoint, step.reason])).toEqual([
        ["slow", "chain-timeout"],
      ]);
    }
    expect(spare.seen).toHaveLength(0);
  });

  test("the caller's abort signal stops the route as aborted", async () => {
    const slow = startStub(always({ content: SAY, delayMs: 2_000 }));
    const router = routerFor(
      configFor([{ id: "slow", baseUrl: slow.baseUrl }], {
        roles: { zeus: { endpoint: "slow" } },
      }),
    );
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    const result = await router.route("zeus", context, sayIntent, {
      signal: controller.signal,
    });

    expect(result.kind).toBe("exhausted");
    if (result.kind === "exhausted") {
      expect(result.steps[0]?.reason).toBe("aborted");
    }
  });

  test("a role with nothing to try is exhausted with no steps", async () => {
    const router = routerFor(
      configFor([{ id: "ollama", baseUrl: "http://127.0.0.1:1/v1" }]),
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(result).toMatchObject({
      kind: "exhausted",
      steps: [],
      offlineSkipped: [],
    });
  });
});

// --- Offline mode, keys, and redirects ------------------------------------------------

const HOSTED = "https://hosted.example.com/v1";

/** A fetch that answers `HOSTED` requests in process and sends everything else over loopback: the hosted endpoint is scripted, and nothing leaves the machine. */
function scriptedHostedFetch(
  reply: (request: Request) => Response | Promise<Response>,
) {
  const requests: Request[] = [];
  const scripted = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const request = new Request(input as string, init);
    if (request.url.startsWith("https://hosted.example.com")) {
      requests.push(request.clone() as Request);
      return reply(request as Request);
    }
    return fetch(input, init);
  };
  return { fetch: scripted as typeof fetch, requests };
}

function spies(hostedFetch: typeof fetch) {
  const built: string[] = [];
  const keysRead: string[] = [];
  return {
    built,
    keysRead,
    options: {
      buildModel: ((args: Parameters<typeof createEndpointModel>[0]) => {
        built.push(args.endpoint.id);
        return createEndpointModel({ ...args, fetch: hostedFetch });
      }) as typeof createEndpointModel,
      getKey: (keyRef: string) => {
        keysRead.push(keyRef);
        return "sk-hosted-secret";
      },
    },
  };
}

describe("offline mode", () => {
  function fallbackConfig(localUrl: string) {
    return configFor(
      [
        { id: "ollama", baseUrl: localUrl },
        { id: "go", baseUrl: HOSTED, keyRef: "opencode-go" },
      ],
      { roles: { zeus: { endpoint: "ollama", fallback: ["go"] } } },
    );
  }

  test("a fallback list holding a non-local endpoint never constructs its adapter and never touches its key", async () => {
    const broken = startStub(always({ status: 500 }));
    const hosted = scriptedHostedFetch(() => completion(SAY));
    const seen = spies(hosted.fetch);
    const router = routerFor(fallbackConfig(broken.baseUrl), {
      offline: true,
      ...seen.options,
    });

    const result = await router.route("zeus", context, sayIntent);

    expect(result.kind).toBe("exhausted");
    if (result.kind === "exhausted") {
      expect(result.steps.map((step) => step.endpoint)).toEqual(["ollama"]);
      expect(result.offlineSkipped).toEqual(["go"]);
    }
    expect(seen.built).toEqual(["ollama"]);
    expect(seen.keysRead).toEqual([]);
    expect(hosted.requests).toHaveLength(0);
  });

  test("positive control: the same list online constructs the non-local adapter once, reads its key once, and reaches it with the key", async () => {
    const broken = startStub(always({ status: 500 }));
    const hosted = scriptedHostedFetch(() => completion(SAY));
    const seen = spies(hosted.fetch);
    const router = routerFor(fallbackConfig(broken.baseUrl), {
      offline: false,
      ...seen.options,
    });

    const result = await router.route("zeus", context, sayIntent);

    expect(result.kind).toBe("intent");
    if (result.kind === "intent") {
      expect(result.step.endpoint).toBe("go");
    }
    expect(seen.built).toEqual(["ollama", "go"]);
    expect(seen.keysRead).toEqual(["opencode-go"]);
    expect(hosted.requests).toHaveLength(1);
    expect(hosted.requests[0]?.headers.get("authorization")).toBe(
      "Bearer sk-hosted-secret",
    );
  });

  test("an adapter is built once per endpoint and reused across routes", async () => {
    const good = startStub(always({ content: SAY }));
    const seen = spies(fetch);
    const router = routerFor(
      configFor([{ id: "ollama", baseUrl: good.baseUrl }], {
        roles: { zeus: { endpoint: "ollama" } },
      }),
      seen.options,
    );

    await router.route("zeus", context, sayIntent);
    await router.route("zeus", context, sayIntent);

    expect(seen.built).toEqual(["ollama"]);
  });

  test("offline with nothing local configured builds nothing and reports what it skipped", async () => {
    const hosted = scriptedHostedFetch(() => completion(SAY));
    const seen = spies(hosted.fetch);
    const router = routerFor(
      configFor([{ id: "go", baseUrl: HOSTED, keyRef: "opencode-go" }], {
        roles: { zeus: { endpoint: "go" } },
      }),
      { offline: true, ...seen.options },
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(result).toMatchObject({
      kind: "exhausted",
      steps: [],
      offlineSkipped: ["go"],
    });
    expect(seen.built).toEqual([]);
    expect(seen.keysRead).toEqual([]);
  });
});

describe("adapter construction", () => {
  test("a build that throws fails that step as unknown with no attempts, and the next endpoint still answers", async () => {
    const good = startStub(always({ content: SAY }));
    const built: string[] = [];
    const router = routerFor(
      configFor(
        [
          { id: "broken", baseUrl: "http://127.0.0.1:1/v1" },
          { id: "good", baseUrl: good.baseUrl },
        ],
        { roles: { zeus: { endpoint: "broken", fallback: ["good"] } } },
      ),
      {
        buildModel: ((args: Parameters<typeof createEndpointModel>[0]) => {
          built.push(args.endpoint.id);
          if (args.endpoint.id === "broken") {
            throw new Error("cannot construct this adapter");
          }
          return createEndpointModel(args);
        }) as typeof createEndpointModel,
      },
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(result.kind).toBe("intent");
    if (result.kind === "intent") {
      expect(result.intent).toEqual(HAIL);
      expect(result.step.endpoint).toBe("good");
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toMatchObject({
        endpoint: "broken",
        reason: "unknown",
        attempts: 0,
      });
      expect(result.failed[0]?.detail).toContain(
        "cannot construct this adapter",
      );
    }
    expect(built).toEqual(["broken", "good"]);
  });
});

describe("keys", () => {
  test("a key value that comes back in an error is redacted from the reason", async () => {
    const hosted = scriptedHostedFetch(
      () =>
        new Response("Incorrect API key provided: sk-hosted-secret", {
          status: 401,
        }),
    );
    const seen = spies(hosted.fetch);
    const router = routerFor(
      configFor([{ id: "go", baseUrl: HOSTED, keyRef: "opencode-go" }], {
        roles: { zeus: { endpoint: "go" } },
      }),
      seen.options,
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(result.kind).toBe("exhausted");
    if (result.kind === "exhausted") {
      const text = JSON.stringify(result);
      expect(text).not.toContain("sk-hosted-secret");
      expect(result.steps[0]?.detail).toContain("[redacted]");
      expect(result.steps[0]?.reason).toBe("http-4xx");
    }
  });
});

describe("a keyed endpoint whose key is not set", () => {
  const keyed = (hostedUrl: string, local: string) =>
    configFor(
      [
        { id: "go", baseUrl: hostedUrl, keyRef: "opencode-go" },
        { id: "ollama", baseUrl: local },
      ],
      { roles: { zeus: { endpoint: "go", fallback: ["ollama"] } } },
    );

  test("fails with a clear key-not-set reason before any request, instead of a confusing upstream 401, and the fallback answers", async () => {
    const local = startStub(always({ content: SAY }));
    const hosted = scriptedHostedFetch(
      () => new Response("401 from upstream", { status: 401 }),
    );
    const seen = spies(hosted.fetch);
    const router = routerFor(keyed(HOSTED, local.baseUrl), {
      buildModel: seen.options.buildModel,
      getKey: () => undefined,
    });

    const result = await router.route("zeus", context, sayIntent);

    expect(result.kind).toBe("intent");
    if (result.kind === "intent") {
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toMatchObject({
        endpoint: "go",
        reason: "key-missing",
        attempts: 0,
      });
      expect(result.failed[0]?.detail).toBe("key not set (opencode-go)");
    }
    expect(hosted.requests).toHaveLength(0);
  });

  test("a router given no way to read keys reports the same reason", async () => {
    const hosted = scriptedHostedFetch(() => completion(SAY));
    const router = routerFor(
      configFor([{ id: "go", baseUrl: HOSTED, keyRef: "opencode-go" }], {
        roles: { zeus: { endpoint: "go" } },
      }),
      { buildModel: spies(hosted.fetch).options.buildModel },
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(result).toMatchObject({
      kind: "exhausted",
      steps: [{ endpoint: "go", reason: "key-missing", attempts: 0 }],
    });
    expect(hosted.requests).toHaveLength(0);
  });

  test("an empty key is not a key", async () => {
    const hosted = scriptedHostedFetch(() => completion(SAY));
    const router = routerFor(
      configFor([{ id: "go", baseUrl: HOSTED, keyRef: "opencode-go" }], {
        roles: { zeus: { endpoint: "go" } },
      }),
      {
        buildModel: spies(hosted.fetch).options.buildModel,
        getKey: () => "",
      },
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(result).toMatchObject({
      kind: "exhausted",
      steps: [{ reason: "key-missing" }],
    });
  });

  test("positive control: the same endpoint with its key set is reached with the bearer key", async () => {
    const hosted = scriptedHostedFetch(() => completion(SAY));
    const router = routerFor(
      configFor([{ id: "go", baseUrl: HOSTED, keyRef: "opencode-go" }], {
        roles: { zeus: { endpoint: "go" } },
      }),
      {
        buildModel: spies(hosted.fetch).options.buildModel,
        getKey: () => "sk-hosted-secret",
      },
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(result.kind).toBe("intent");
    expect(hosted.requests[0]?.headers.get("authorization")).toBe(
      "Bearer sk-hosted-secret",
    );
  });
});

describe("a key JSON escapes", () => {
  // A quote and a backslash: an endpoint that answers with a JSON error body
  // echoes the key with both escaped.
  const key = 'sk-"quo\\te-0123456789';
  const escaped = JSON.stringify(key).slice(1, -1);

  test("is redacted from the failure detail whether the endpoint echoes it raw or JSON-escaped", async () => {
    for (const body of [
      `bad key ${key} rejected`,
      JSON.stringify({ error: { message: `bad key ${key} rejected` } }),
    ]) {
      const hosted = scriptedHostedFetch(
        () => new Response(body, { status: 401 }),
      );
      const router = routerFor(
        configFor([{ id: "go", baseUrl: HOSTED, keyRef: "opencode-go" }], {
          roles: { zeus: { endpoint: "go" } },
        }),
        {
          buildModel: spies(hosted.fetch).options.buildModel,
          getKey: () => key,
        },
      );

      const result = await router.route("zeus", context, sayIntent);

      expect(result.kind).toBe("exhausted");
      const text = JSON.stringify(result);
      expect(text).not.toContain(key);
      expect(text).not.toContain(escaped);
      expect(text).not.toContain(JSON.stringify(escaped).slice(1, -1));
      if (result.kind === "exhausted") {
        expect(result.steps[0]?.detail).toContain("[redacted]");
      }
    }
  });
});

describe("keys and the detail limit", () => {
  /** A hosted endpoint that answers 401 with `body`, and the router that asks it with `key`. */
  async function refusedWith(key: string, body: string) {
    const hosted = scriptedHostedFetch(
      () => new Response(body, { status: 401 }),
    );
    const router = routerFor(
      configFor([{ id: "go", baseUrl: HOSTED, keyRef: "opencode-go" }], {
        roles: { zeus: { endpoint: "go" } },
      }),
      { buildModel: spies(hosted.fetch).options.buildModel, getKey: () => key },
    );
    return JSON.stringify(await router.route("zeus", context, sayIntent));
  }

  test("a key that starts just before the detail limit and runs past it leaves no prefix of 8 or more characters", async () => {
    const key = "sk-Qz9XkLm2Pv7Rt4WnB8YcH3JdF6";
    const body = `${"x".repeat(285)}${key} and more text after it`;

    const result = await refusedWith(key, body);

    expect(result).not.toContain(key.slice(0, 8));
    // The placeholder itself may be cut by the limit; the key never survives it.
    expect(result).toContain("[redacted");
  });

  test("a key longer than the detail limit leaves no prefix of 8 or more characters", async () => {
    const key = `LONGKEY-${"Zq7".repeat(150)}`;
    const body = `Incorrect API key provided: ${key}`;

    const result = await refusedWith(key, body);

    expect(result).not.toContain(key.slice(0, 8));
    expect(result).toContain("[redacted]");
  });

  test("the detail is still bounded", async () => {
    const result = await refusedWith("sk-short", "y".repeat(5_000));

    expect(result.length).toBeLessThan(1_500);
  });
});

describe("redirects", () => {
  test("a redirect from a local endpoint is refused: the step fails, is not retried, and nothing reaches the redirect target", async () => {
    const target = startStub(always({ content: SAY }));
    const redirecting = startStub(
      always({ redirectTo: `${target.baseUrl}/chat/completions` }),
    );
    const router = routerFor(
      configFor([{ id: "ollama", baseUrl: redirecting.baseUrl }], {
        roles: { zeus: { endpoint: "ollama" } },
      }),
    );

    const result = await router.route("zeus", context, sayIntent);

    expect(result.kind).toBe("exhausted");
    if (result.kind === "exhausted") {
      expect(result.steps[0]).toMatchObject({
        endpoint: "ollama",
        reason: "redirect",
        attempts: 1,
      });
    }
    expect(redirecting.seen).toHaveLength(1);
    expect(target.seen).toHaveLength(0);
  });
});

// --- The default limits come from a measurement --------------------------------------------------

describe("default route limits", () => {
  // tools/probes/god-latency measured what one god request costs a local qwen3
  // 8B at a 4K context on Ollama: the first request after a model load took
  // 23-28 s, a request with nothing cached 14-23 s (p95 about 30 s on a loaded
  // machine, worst 32 s), and a request that reused a cached start 3-16 s. The
  // attempt limit is the cold p95 with half again on top; 15 s cut off more
  // than half of the answers the model was about to give.
  const COLD_P95_MS = 30_000;

  test("one attempt is given the measured cold p95 with a margin, not the 15 s that timed out most gods' turns", () => {
    expect(DEFAULT_ROUTE_LIMITS.attemptTimeoutMs).toBe(45_000);
    expect(DEFAULT_ROUTE_LIMITS.attemptTimeoutMs).toBeGreaterThanOrEqual(
      COLD_P95_MS * 1.5,
    );
  });

  test("the whole chain has room for a full attempt and a retry's backoff, and no other limit moved", () => {
    expect(DEFAULT_ROUTE_LIMITS.totalTimeoutMs).toBe(60_000);
    expect(DEFAULT_ROUTE_LIMITS.totalTimeoutMs).toBeGreaterThanOrEqual(
      DEFAULT_ROUTE_LIMITS.attemptTimeoutMs + DEFAULT_ROUTE_LIMITS.backoffMaxMs,
    );
    // The retry and backoff behaviour is as it was.
    expect(DEFAULT_ROUTE_LIMITS.maxAttempts).toBe(2);
    expect(DEFAULT_ROUTE_LIMITS.backoffBaseMs).toBe(250);
    expect(DEFAULT_ROUTE_LIMITS.backoffMaxMs).toBe(2_000);
  });
});

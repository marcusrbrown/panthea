import { afterEach, describe, expect, test } from "bun:test";
import {
  createRouter,
  type IntentSchema,
  type ParseResult,
  parseRoutingConfig,
} from "@panthea/agents";
import {
  EMPTY_RUN_LIMIT,
  FAIL_MODE,
  FAIL_MODE_ROUTER_CLASS,
  isEmptyShape,
  type OutageProxy,
  startOutageProxy,
} from "./outage-proxy";

// --- A fake Ollama on loopback ---------------------------------------------------

const EMPTY_BODY = {
  id: "chatcmpl-1",
  object: "chat.completion",
  created: -62135596800,
  model: "",
  system_fingerprint: "fp_ollama",
};

const completion = (content: string, promptTokens = 7) => ({
  id: "chatcmpl-2",
  object: "chat.completion",
  created: 1_791_400_000,
  model: "granite3.3-8b-4k",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: promptTokens,
    completion_tokens: 3,
    total_tokens: promptTokens + 3,
  },
});

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly body: string;
  readonly authorization: string | null;
  readonly signal: AbortSignal;
}

interface Upstream {
  readonly origin: string;
  readonly port: number;
  readonly seen: Seen[];
  /** What the next request is answered with; replaceable mid-test. */
  respond: (n: number, seen: Seen) => Response | Promise<Response>;
  stop(): void;
}

const servers: { stop(): void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});

function startUpstream(respond: Upstream["respond"]): Upstream {
  const seen: Seen[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const entry: Seen = {
        method: request.method,
        path: new URL(request.url).pathname,
        body: await request.text(),
        authorization: request.headers.get("authorization"),
        signal: request.signal,
      };
      const n = seen.length;
      seen.push(entry);
      return upstream.respond(n, entry);
    },
  });
  const upstream: Upstream = {
    origin: `http://127.0.0.1:${server.port}`,
    port: server.port ?? 0,
    seen,
    respond,
    stop: () => server.stop(true),
  };
  servers.push(upstream);
  return upstream;
}

function proxyFor(
  upstream: { origin: string },
  options: Partial<Parameters<typeof startOutageProxy>[0]> = {},
): OutageProxy {
  const proxy = startOutageProxy({ upstream: upstream.origin, ...options });
  servers.push(proxy);
  return proxy;
}

const CHAT = "/v1/chat/completions";
const post = (proxy: OutageProxy, body: unknown, path = CHAT) =>
  fetch(`${proxy.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer k" },
    body: JSON.stringify(body),
  });

// --- The router, against the proxy ---------------------------------------------------

interface Say {
  readonly kind: "say";
}
const sayIntent: IntentSchema<Say> = {
  jsonSchema: {
    type: "object",
    properties: { kind: { const: "say" } },
    required: ["kind"],
    additionalProperties: false,
  },
  parse(candidate: unknown): ParseResult<Say> {
    return (candidate as { kind?: unknown } | null)?.kind === "say"
      ? { ok: true, value: { kind: "say" } }
      : { ok: false, path: "", message: "not a say intent" };
  },
};

function routerAgainst(proxy: OutageProxy) {
  const config = parseRoutingConfig({
    endpoints: [
      { id: "ollama", baseUrl: `${proxy.url}/v1`, model: "granite3.3-8b-4k" },
    ],
    roles: { zeus: { endpoint: "ollama" } },
  });
  if (!config.ok) throw new Error(config.message);
  return createRouter({
    config: config.value,
    offline: false,
    limits: {
      attemptTimeoutMs: 5_000,
      totalTimeoutMs: 20_000,
      maxAttempts: 2,
      backoffBaseMs: 1,
      backoffMaxMs: 2,
    },
  });
}

const ASK = { instructions: "You are Zeus.", prompt: "What do you do?" };
const SAY = '{"kind":"say"}';

// --- Tests ---------------------------------------------------------------------------

describe("passing requests through", () => {
  test("a request reaches the upstream with its method, path, body and headers, and the response arrives unchanged", async () => {
    const upstream = startUpstream(() =>
      Response.json(completion("Hail, Athens.", 11)),
    );
    const proxy = proxyFor(upstream);

    const response = await post(proxy, { model: "m", messages: ["hi"] });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(completion("Hail, Athens.", 11));
    expect(upstream.seen).toHaveLength(1);
    expect(upstream.seen[0]).toMatchObject({
      method: "POST",
      path: CHAT,
      body: JSON.stringify({ model: "m", messages: ["hi"] }),
      authorization: "Bearer k",
    });
    expect(proxy.mode).toBe("pass");
  });

  test("any path is forwarded, a non-completion response is passed on and recorded as other, and a server-sent stream goes through chunk by chunk", async () => {
    const upstream = startUpstream((_n, seen) => {
      if (seen.path === "/api/ps") return Response.json({ models: [] });
      const stream = new ReadableStream({
        start(controller) {
          for (const piece of ['data: {"a":1}\n\n', "data: [DONE]\n\n"]) {
            controller.enqueue(new TextEncoder().encode(piece));
          }
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      });
    });
    const proxy = proxyFor(upstream);

    const ps = await fetch(`${proxy.url}/api/ps`);
    expect(await ps.json()).toEqual({ models: [] });
    const streamed = await post(proxy, { stream: true });
    expect(await streamed.text()).toBe('data: {"a":1}\n\ndata: [DONE]\n\n');

    const [first, second] = proxy.records();
    expect(first).toMatchObject({ kind: "other", status: 200, empty: false });
    expect(second).toMatchObject({
      kind: "completion",
      status: 200,
      empty: false,
      outcome: "forwarded",
    });
    expect(second?.promptTokens).toBeUndefined();
  });

  test("each response is recorded with its wall time, status, latency, and the prompt token count the OpenAI-compatible body carries", async () => {
    let clock = 1_000;
    const upstream = startUpstream(() => {
      clock += 250;
      return Response.json(completion("x", 1234));
    });
    const proxy = proxyFor(upstream, { now: () => clock });

    await post(proxy, {});

    expect(proxy.records()).toEqual([
      {
        at: 1_000,
        status: 200,
        latencyMs: 250,
        outcome: "forwarded",
        kind: "completion",
        empty: false,
        promptTokens: 1234,
      },
    ]);
  });

  test("a native Ollama body's prompt_eval_count is read when usage is absent, and a body with neither has no count", async () => {
    const bodies = [
      { model: "m", created: 5, prompt_eval_count: 321 },
      { model: "m", created: 5 },
      { model: "m", created: 5, usage: { prompt_tokens: "many" } },
    ];
    const upstream = startUpstream((n) => Response.json(bodies[n]));
    const proxy = proxyFor(upstream);

    for (let n = 0; n < bodies.length; n += 1) await post(proxy, {});

    expect(proxy.records().map((r) => r.promptTokens)).toEqual([
      321,
      undefined,
      undefined,
    ]);
  });

  test("a response the upstream gives with an error status is passed on with that status, and is a response, not a failure of the proxy", async () => {
    const upstream = startUpstream(
      () => new Response("model not found", { status: 404 }),
    );
    const proxy = proxyFor(upstream);

    const response = await post(proxy, {});

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("model not found");
    expect(proxy.records()[0]).toMatchObject({
      status: 404,
      outcome: "forwarded",
      empty: false,
    });
  });

  test("an upstream that cannot be reached answers 502, recorded as an upstream error", async () => {
    const upstream = startUpstream(() => Response.json(completion("x")));
    const proxy = proxyFor(upstream);
    upstream.stop();

    const response = await post(proxy, {});

    expect(response.status).toBe(502);
    expect(proxy.records()[0]).toMatchObject({
      status: 502,
      outcome: "upstream-error",
      empty: false,
    });
  });
});

describe("the outage", () => {
  test("after fail() a request is refused at once with a 503 and never reaches the upstream, and after pass() the next one succeeds", async () => {
    const upstream = startUpstream(() => Response.json(completion("back")));
    const proxy = proxyFor(upstream);

    proxy.fail();
    expect(proxy.mode).toBe("fail");
    const refused = await post(proxy, {});
    expect(refused.status).toBe(503);
    expect(upstream.seen).toHaveLength(0);

    proxy.pass();
    expect(proxy.mode).toBe("pass");
    const answered = await post(proxy, {});
    expect(answered.status).toBe(200);
    expect(upstream.seen).toHaveLength(1);

    expect(proxy.records().map((r) => [r.outcome, r.status])).toEqual([
      ["refused", 503],
      ["forwarded", 200],
    ]);
  });

  test("the fail mode is a 503, which the router classifies as http-5xx and retries: it takes both attempts, ends exhausted for that reason, and after pass() the router is answered", async () => {
    expect(FAIL_MODE).toBe("http-503");
    expect(FAIL_MODE_ROUTER_CLASS).toBe("http-5xx");
    const upstream = startUpstream(() => Response.json(completion(SAY)));
    const proxy = proxyFor(upstream);
    const router = routerAgainst(proxy);

    proxy.fail();
    const down = await router.route("zeus", ASK, sayIntent);
    expect(down.kind).toBe("exhausted");
    if (down.kind === "exhausted") {
      expect(down.steps).toHaveLength(1);
      expect(down.steps[0]).toMatchObject({
        reason: FAIL_MODE_ROUTER_CLASS,
        attempts: 2,
      });
    }
    // The retry is the proof it is retryable: the proxy saw two refused requests for the one route.
    expect(proxy.records().filter((r) => r.outcome === "refused")).toHaveLength(
      2,
    );
    expect(upstream.seen).toHaveLength(0);

    proxy.pass();
    const up = await router.route("zeus", ASK, sayIntent);
    expect(up.kind).toBe("intent");
    expect(upstream.seen).toHaveLength(1);
  });

  test("a request in flight when fail() is called is ended with a 503 and the upstream request is aborted; a request after pass() is not", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let arrived: () => void = () => {};
    const reached = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    // The upstream learns of the abort from its own socket closing, a step after the proxy has answered the caller.
    // Wait for its abort event, not for the flag to be already set when the 503 arrives.
    let abortSeen: () => void = () => {};
    const upstreamAborted = new Promise<void>((resolve) => {
      abortSeen = resolve;
    });
    const upstream = startUpstream(async (n, seen) => {
      if (n === 0) {
        seen.signal.addEventListener("abort", () => abortSeen(), {
          once: true,
        });
        arrived();
        await held;
      }
      return Response.json(completion("late"));
    });
    const proxy = proxyFor(upstream);

    const inFlight = post(proxy, {});
    await reached;
    proxy.fail();
    const ended = await inFlight;

    expect(ended.status).toBe(503);
    await upstreamAborted;
    expect(upstream.seen[0]?.signal.aborted).toBe(true);
    expect(proxy.records()[0]).toMatchObject({
      outcome: "aborted",
      status: 503,
    });

    proxy.pass();
    release();
    const later = await post(proxy, {});
    expect(later.status).toBe(200);
    expect(upstream.seen[1]?.signal.aborted).toBe(false);
    expect(proxy.records()[1]).toMatchObject({
      outcome: "forwarded",
      status: 200,
    });
  });

  test("fail() and pass() are idempotent, and a stopped proxy serves nothing", async () => {
    const upstream = startUpstream(() => Response.json(completion("x")));
    const proxy = proxyFor(upstream);

    proxy.fail();
    proxy.fail();
    expect((await post(proxy, {})).status).toBe(503);
    proxy.pass();
    proxy.pass();
    expect((await post(proxy, {})).status).toBe(200);

    proxy.stop();
    await expect(post(proxy, {})).rejects.toBeDefined();
  });
});

describe("the empty response", () => {
  test("the empty shape is a 200 chat completion with model empty and the zero created date, and nothing looser", () => {
    expect(isEmptyShape(200, EMPTY_BODY)).toBe(true);
    expect(isEmptyShape(200, completion("x"))).toBe(false);
    // Only both fields together are the fault.
    expect(isEmptyShape(200, { ...EMPTY_BODY, created: 1 })).toBe(false);
    expect(isEmptyShape(200, { ...EMPTY_BODY, model: "granite" })).toBe(false);
    expect(isEmptyShape(500, EMPTY_BODY)).toBe(false);
    expect(isEmptyShape(200, null)).toBe(false);
    expect(isEmptyShape(200, "text")).toBe(false);
    expect(isEmptyShape(200, [EMPTY_BODY])).toBe(false);
  });

  test("a 200 with the empty shape is recorded as empty and passed on unchanged; a normal completion and a non-JSON body are not", async () => {
    const replies: (() => Response)[] = [
      () => Response.json(EMPTY_BODY),
      () => Response.json(completion("fine")),
      () =>
        new Response("{not json", {
          headers: { "content-type": "application/json" },
        }),
    ];
    const upstream = startUpstream((n) => (replies[n] as () => Response)());
    const proxy = proxyFor(upstream);

    const first = await post(proxy, {});
    expect(await first.json()).toEqual(EMPTY_BODY);
    await post(proxy, {});
    const third = await post(proxy, {});
    expect(await third.text()).toBe("{not json");

    expect(proxy.records().map((r) => r.empty)).toEqual([true, false, false]);
  });

  test("four empty responses and a normal one reset the run; five in a row fire the callback once, at five, and again only after a reset and another five", async () => {
    const script: ("empty" | "ok")[] = [
      "empty",
      "empty",
      "empty",
      "empty",
      "ok",
      "empty",
      "empty",
      "empty",
      "empty",
      "empty",
      "empty",
      "empty",
      "ok",
      "empty",
      "empty",
      "empty",
      "empty",
      "empty",
    ];
    const upstream = startUpstream((n) =>
      Response.json(script[n] === "empty" ? EMPTY_BODY : completion("ok")),
    );
    const calls: number[] = [];
    const proxy = proxyFor(upstream, {
      onEmptyRun: (count) => calls.push(count),
    });
    expect(EMPTY_RUN_LIMIT).toBe(5);

    const runAfter: number[] = [];
    for (let n = 0; n < script.length; n += 1) {
      await post(proxy, {});
      runAfter.push(proxy.emptyRun);
      // Four empties then a normal one: no call yet, and the run is back to zero.
      if (n === 4) expect(calls).toEqual([]);
      if (n === 4) expect(proxy.emptyRun).toBe(0);
    }

    expect(runAfter).toEqual([
      1, 2, 3, 4, 0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5,
    ]);
    // Fired at the fifth of the second run (not again at the sixth and seventh), then at the fifth of the third.
    expect(calls).toEqual([EMPTY_RUN_LIMIT, EMPTY_RUN_LIMIT]);
    expect(proxy.emptyTotal).toBe(4 + 7 + 5);
  });

  test("a request the proxy refused or could not forward is no response: it neither adds to the empty run nor resets it", async () => {
    const upstream = startUpstream(() => Response.json(EMPTY_BODY));
    const proxy = proxyFor(upstream);

    await post(proxy, {});
    await post(proxy, {});
    proxy.fail();
    await post(proxy, {});
    proxy.pass();
    expect(proxy.emptyRun).toBe(2);
    await post(proxy, {});
    expect(proxy.emptyRun).toBe(3);
  });

  test("an error status from the upstream is a response, so it resets the run", async () => {
    const replies = [200, 200, 500, 200];
    const upstream = startUpstream((n) =>
      replies[n] === 200
        ? Response.json(EMPTY_BODY)
        : new Response("down", { status: 500 }),
    );
    const proxy = proxyFor(upstream);

    for (const _ of replies) await post(proxy, {});

    expect(proxy.emptyRun).toBe(1);
  });
});

describe("what a record keeps", () => {
  test("a record carries only numbers, an outcome and flags: no prompt or completion text, no host, no key", async () => {
    const PROMPT = "THE-SECRET-PROMPT-ABOUT-FISHER-DION";
    const REPLY = "THE-SECRET-COMPLETION-OF-ZEUS";
    const upstream = startUpstream((n) =>
      n === 2 ? Response.json(EMPTY_BODY) : Response.json(completion(REPLY)),
    );
    const proxy = proxyFor(upstream);

    await post(proxy, { messages: [{ content: PROMPT }] });
    proxy.fail();
    await post(proxy, { messages: [{ content: PROMPT }] });
    proxy.pass();
    await post(proxy, { messages: [{ content: PROMPT }] });
    await post(proxy, { messages: [{ content: PROMPT }] });

    const records = proxy.records();
    expect(records.length).toBe(4);
    const allowed = new Set([
      "at",
      "status",
      "latencyMs",
      "outcome",
      "kind",
      "empty",
      "promptTokens",
    ]);
    for (const record of records) {
      for (const key of Object.keys(record))
        expect(allowed.has(key)).toBe(true);
      for (const value of Object.values(record)) {
        expect(["number", "string", "boolean", "undefined"]).toContain(
          typeof value,
        );
      }
    }
    const text = JSON.stringify(records);
    for (const secret of [
      PROMPT,
      REPLY,
      "127.0.0.1",
      String(upstream.port),
      "Bearer",
      proxy.url,
      CHAT,
      "granite",
    ]) {
      expect(text).not.toContain(secret);
    }
    // Nothing else on the proxy holds them either.
    const surface = JSON.stringify({
      mode: proxy.mode,
      run: proxy.emptyRun,
      total: proxy.emptyTotal,
      failMode: FAIL_MODE,
    });
    expect(surface).not.toContain(PROMPT);
  });

  test("records() is a copy: changing it changes nothing in the proxy", async () => {
    const upstream = startUpstream(() => Response.json(completion("x")));
    const proxy = proxyFor(upstream);
    await post(proxy, {});

    const copy = proxy.records() as unknown[];
    copy.length = 0;

    expect(proxy.records()).toHaveLength(1);
  });
});

// A loopback proxy in front of the model endpoint. It forwards every request and can be switched to refuse them all,
// which is how an unattended run makes a provider outage without stopping Ollama. It classifies each response for
// Ollama's empty-completion fault and keeps numbers only: no prompt or completion text, no host, no key.

export type ProxyMode = "pass" | "fail";

/** What the proxy answers while failing: a 503, which the router classifies as `http-5xx` and retries. */
export const FAIL_MODE = "http-503";
export const FAIL_MODE_ROUTER_CLASS = "http-5xx";

/** Empty-shape responses in a row that fire the callback. */
export const EMPTY_RUN_LIMIT = 5;

/** The `created` value of the empty completion: the zero time of Go's `time.Time`, in Unix seconds. */
const ZERO_CREATED = -62135596800;

export type ProxyOutcome =
  /** The upstream answered; the response was passed on. */
  | "forwarded"
  /** The proxy was failing and answered 503 without contacting the upstream. */
  | "refused"
  /** The request was in flight when failing began, or its caller went away; the upstream request was aborted. */
  | "aborted"
  /** The upstream could not be reached or broke off; the proxy answered 502. */
  | "upstream-error";

export interface ProxyRecord {
  /** Wall time the request arrived, in ms. */
  readonly at: number;
  /** The status the caller was given. */
  readonly status: number;
  readonly latencyMs: number;
  readonly outcome: ProxyOutcome;
  /** `completion` for a chat completion request, `other` for any other path. */
  readonly kind: "completion" | "other";
  /** A 200 chat completion with `"model":""` and the zero `created` date. */
  readonly empty: boolean;
  /** The prompt's token count when the body carries one: `usage.prompt_tokens`, else `prompt_eval_count`. */
  readonly promptTokens?: number;
}

export interface OutageProxyOptions {
  /** The model endpoint's origin, e.g. `http://127.0.0.1:11434`. Request paths are appended to it. */
  readonly upstream: string;
  /** Called with the run length each time empty-shape responses in a row reach `EMPTY_RUN_LIMIT`. */
  readonly onEmptyRun?: (count: number) => void;
  /** Wall clock in ms, for `at` and latency. */
  readonly now?: () => number;
}

export interface OutageProxy {
  /** The proxy's own origin, `http://127.0.0.1:<port>`. */
  readonly url: string;
  readonly mode: ProxyMode;
  /** Empty-shape responses in a row right now. */
  readonly emptyRun: number;
  /** Empty-shape responses in all. */
  readonly emptyTotal: number;
  /** Refuse every new request and end those in flight. */
  fail(): void;
  /** Forward requests again. */
  pass(): void;
  /** A copy of every record so far, oldest first. */
  records(): ProxyRecord[];
  stop(): void;
}

const COMPLETION_PATH = "/chat/completions";

/** HTTP 200 with a chat completion body whose `model` is empty and whose `created` is the zero date. */
export function isEmptyShape(status: number, body: unknown): boolean {
  if (status !== 200) return false;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return false;
  }
  const fields = body as { model?: unknown; created?: unknown };
  return fields.model === "" && fields.created === ZERO_CREATED;
}

function promptTokensOf(body: unknown): number | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const fields = body as {
    usage?: { prompt_tokens?: unknown };
    prompt_eval_count?: unknown;
  };
  const counted = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isInteger(value) && value >= 0
      ? value
      : undefined;
  return (
    counted(fields.usage?.prompt_tokens) ?? counted(fields.prompt_eval_count)
  );
}

const REQUEST_HEADERS_DROPPED = new Set([
  "host",
  "connection",
  "content-length",
]);
const RESPONSE_HEADERS_DROPPED = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "transfer-encoding",
]);

function without(headers: Headers, dropped: ReadonlySet<string>): Headers {
  const kept = new Headers();
  for (const [name, value] of headers) {
    if (!dropped.has(name.toLowerCase())) kept.set(name, value);
  }
  return kept;
}

export function startOutageProxy(options: OutageProxyOptions): OutageProxy {
  const now = options.now ?? Date.now;
  const upstream = options.upstream.replace(/\/+$/, "");
  const log: ProxyRecord[] = [];
  const inFlight = new Set<AbortController>();
  let mode: ProxyMode = "pass";
  let emptyRun = 0;
  let emptyTotal = 0;

  function record(
    entry: Omit<ProxyRecord, "promptTokens"> & { promptTokens?: number },
  ): void {
    log.push(
      entry.promptTokens === undefined
        ? {
            at: entry.at,
            status: entry.status,
            latencyMs: entry.latencyMs,
            outcome: entry.outcome,
            kind: entry.kind,
            empty: entry.empty,
          }
        : { ...entry },
    );
  }

  function noteResponse(empty: boolean): void {
    if (!empty) {
      emptyRun = 0;
      return;
    }
    emptyRun += 1;
    emptyTotal += 1;
    if (emptyRun === EMPTY_RUN_LIMIT) options.onEmptyRun?.(emptyRun);
  }

  async function handle(request: Request): Promise<Response> {
    const startedAt = now();
    const url = new URL(request.url);
    const kind: ProxyRecord["kind"] = url.pathname.endsWith(COMPLETION_PATH)
      ? "completion"
      : "other";
    const finish = (
      status: number,
      outcome: ProxyOutcome,
      extra: { empty?: boolean; promptTokens?: number } = {},
    ): void =>
      record({
        at: startedAt,
        status,
        latencyMs: now() - startedAt,
        outcome,
        kind,
        empty: extra.empty ?? false,
        ...(extra.promptTokens === undefined
          ? {}
          : { promptTokens: extra.promptTokens }),
      });

    if (mode === "fail") {
      finish(503, "refused");
      return new Response("provider unavailable", { status: 503 });
    }

    const controller = new AbortController();
    inFlight.add(controller);
    try {
      const body =
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer();
      const reply = await fetch(`${upstream}${url.pathname}${url.search}`, {
        method: request.method,
        headers: without(request.headers, REQUEST_HEADERS_DROPPED),
        ...(body === undefined ? {} : { body }),
        redirect: "manual",
        signal: AbortSignal.any([controller.signal, request.signal]),
      });
      const headers = without(reply.headers, RESPONSE_HEADERS_DROPPED);
      const streamed = (reply.headers.get("content-type") ?? "").includes(
        "text/event-stream",
      );
      if (streamed || reply.body === null) {
        finish(reply.status, "forwarded");
        if (kind === "completion") noteResponse(false);
        return new Response(reply.body, { status: reply.status, headers });
      }
      const bytes = await reply.arrayBuffer();
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        parsed = undefined;
      }
      const empty = kind === "completion" && isEmptyShape(reply.status, parsed);
      const promptTokens =
        kind === "completion" ? promptTokensOf(parsed) : undefined;
      finish(reply.status, "forwarded", {
        empty,
        ...(promptTokens === undefined ? {} : { promptTokens }),
      });
      if (kind === "completion") noteResponse(empty);
      return new Response(bytes, { status: reply.status, headers });
    } catch {
      if (controller.signal.aborted || request.signal.aborted) {
        finish(503, "aborted");
        return new Response("provider unavailable", { status: 503 });
      }
      finish(502, "upstream-error");
      return new Response("provider unreachable", { status: 502 });
    } finally {
      inFlight.delete(controller);
    }
  }

  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handle });

  return {
    url: `http://127.0.0.1:${server.port}`,
    get mode() {
      return mode;
    },
    get emptyRun() {
      return emptyRun;
    },
    get emptyTotal() {
      return emptyTotal;
    },
    fail() {
      mode = "fail";
      for (const controller of inFlight) controller.abort();
    },
    pass() {
      mode = "pass";
    },
    records: () => [...log],
    stop: () => server.stop(true),
  };
}

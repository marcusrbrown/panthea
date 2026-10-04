// The one endpoint the measurement talks to: Ollama's native chat API, which
// reports what the router's /v1 route hides, how long the server spent reading
// the prompt (`prompt_eval_duration`), writing the reply (`eval_duration`), and
// loading the model (`load_duration`), and how many prompt tokens it had to
// read after reusing its cache (`prompt_eval_count`).

export const BASE = "http://127.0.0.1:11434";

/** What one request cost, in the server's own accounting (durations in ms). */
export interface Cost {
  readonly loadMs: number;
  /** Prompt tokens the server evaluated; a cached start is not counted. */
  readonly promptTokens: number;
  readonly prefillMs: number;
  readonly replyTokens: number;
  readonly decodeMs: number;
  readonly totalMs: number;
  /** Wall time the caller waited, queueing and network included. */
  readonly wallMs: number;
  readonly reply: string;
}

interface ChatResponse {
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  total_duration?: number;
  message?: { content?: string };
  error?: string;
}

const ms = (ns: number | undefined) => (ns ?? 0) / 1e6;

export async function chat(
  model: string,
  messages: readonly { role: string; content: string }[],
  options: { format?: unknown; numPredict?: number } = {},
): Promise<Cost> {
  const started = performance.now();
  const response = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      think: false,
      ...(options.format === undefined ? {} : { format: options.format }),
      options: { num_predict: options.numPredict ?? 512 },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = (await response.json()) as ChatResponse;
  if (body.error !== undefined) throw new Error(body.error);
  return {
    loadMs: ms(body.load_duration),
    promptTokens: body.prompt_eval_count ?? 0,
    prefillMs: ms(body.prompt_eval_duration),
    replyTokens: body.eval_count ?? 0,
    decodeMs: ms(body.eval_duration),
    totalMs: ms(body.total_duration),
    wallMs: performance.now() - started,
    reply: String(body.message?.content ?? "").slice(0, 120),
  };
}

/** Unloads the model and waits until the server says nothing is resident, so the next request is the first after a load. */
export async function unload(model: string): Promise<void> {
  await fetch(`${BASE}/api/generate`, {
    method: "POST",
    body: JSON.stringify({ model, keep_alive: 0 }),
  });
  for (let i = 0; i < 100; i += 1) {
    const ps = (await (await fetch(`${BASE}/api/ps`)).json()) as {
      models?: unknown[];
    };
    if ((ps.models ?? []).length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${model} did not unload`);
}

/** A request that shares nothing with a god's, sent to leave the server's slot holding something else. */
export async function wipe(model: string): Promise<void> {
  await chat(model, [{ role: "user", content: "Say ok." }], { numPredict: 2 });
}

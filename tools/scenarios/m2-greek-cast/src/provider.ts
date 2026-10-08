// The scripted model provider: a loopback OpenAI-compatible endpoint the
// compiled sidecar reaches through its production routing path. It is the only
// scripted piece of the scenario. It answers each god from a queue the harness
// fills (a reply may be a function of the request, so it can read the prompt
// the god was shown), holds a reply until told to release it, and records every
// request with when it arrived, so the run can say what was asked and when.

/** The gods the provider can tell apart by their prompt, and so script. The story scripts Zeus and Hera; the other five wait unless a step queues a reply for one. */
export const GODS = [
  "athena",
  "hades",
  "hephaestus",
  "hera",
  "hermes",
  "poseidon",
  "zeus",
] as const;
export type God = (typeof GODS)[number];

export interface SeenRequest {
  /** Position in arrival order. */
  readonly n: number;
  readonly god: God | "unknown";
  /** Wall time the request arrived. */
  readonly at: number;
  /** Everything the model was shown: system and user text. */
  readonly prompt: string;
  /** What the provider answered; unset while a held reply is still held. */
  reply?: string;
}

/** A reply that is the HTTP response itself: its JSON body and status, with no chat completion wrapped around it. */
export interface RawReply {
  readonly raw: unknown;
  readonly status: number;
}

/** Ollama's empty-200 fault: HTTP 200 with an empty model name, the zero `created` date, and no choices. */
export const EMPTY_COMPLETION: RawReply = {
  raw: {
    id: "chatcmpl-empty",
    object: "chat.completion",
    created: -62135596800,
    model: "",
    system_fingerprint: "fp_ollama",
  },
  status: 200,
};

/** What a reply function or policy returns: reply text, which is wrapped as a completion, or a raw response. */
export type Answer = string | RawReply;

export type Reply = Answer | ((seen: SeenRequest) => Answer | Promise<Answer>);

export interface Held {
  /** Resolves with the request once it has arrived and is being held. */
  readonly arrived: Promise<SeenRequest>;
  release(): void;
}

export interface ScriptedProvider {
  readonly baseUrl: string;
  readonly requests: readonly SeenRequest[];
  /** Queues replies for `god`; each request from it takes the next, and it waits once the queue is empty. */
  enqueue(god: God, ...replies: Reply[]): void;
  /** Answers `god` from the prompt whenever its queue is empty; `undefined` removes it. A god with neither waits. */
  policy(god: God, fn: ((seen: SeenRequest) => Answer) | undefined): void;
  /** Queues a reply that is held until released. */
  hold(god: God, reply: string): Held;
  /** Replies still queued for `god`. */
  queued(god: God): number;
  clear(): void;
  stop(): void;
}

export const WAIT = '{"action":"wait"}';

function godOf(prompt: string): God | "unknown" {
  return (
    GODS.find((god) =>
      prompt.includes(`You are ${god.charAt(0).toUpperCase()}${god.slice(1)},`),
    ) ?? "unknown"
  );
}

interface ChatBody {
  readonly messages?: readonly { readonly content?: unknown }[];
}

function promptOf(body: ChatBody): string {
  return (body.messages ?? [])
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content),
    )
    .join("\n");
}

export function startProvider(): ScriptedProvider {
  const requests: SeenRequest[] = [];
  const queues = new Map<God, Reply[]>();
  const policies = new Map<God, (seen: SeenRequest) => Answer>();

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as ChatBody;
      const prompt = promptOf(body);
      const god = godOf(prompt);
      const seen: { -readonly [K in keyof SeenRequest]: SeenRequest[K] } = {
        n: requests.length,
        god,
        at: Date.now(),
        prompt,
      };
      requests.push(seen);
      const next = god === "unknown" ? undefined : queues.get(god)?.shift();
      const policy = god === "unknown" ? undefined : policies.get(god);
      const answer: Answer =
        next === undefined
          ? (policy?.(seen) ?? WAIT)
          : typeof next === "function"
            ? await next(seen)
            : next;
      if (typeof answer !== "string") {
        seen.reply = JSON.stringify(answer.raw);
        return Response.json(answer.raw, { status: answer.status });
      }
      const reply = answer;
      seen.reply = reply;
      return Response.json({
        id: "chatcmpl-scripted",
        object: "chat.completion",
        created: 1,
        model: "scripted",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: reply },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    },
  });

  const queueOf = (god: God): Reply[] => {
    const existing = queues.get(god);
    if (existing) return existing;
    const created: Reply[] = [];
    queues.set(god, created);
    return created;
  };

  return {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    requests,
    enqueue: (god, ...replies) => {
      queueOf(god).push(...replies);
    },
    policy: (god, fn) => {
      if (fn) policies.set(god, fn);
      else policies.delete(god);
    },
    hold(god, reply) {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let arrive: (seen: SeenRequest) => void = () => {};
      const arrived = new Promise<SeenRequest>((resolve) => {
        arrive = resolve;
      });
      queueOf(god).push(async (seen) => {
        arrive(seen);
        await gate;
        return reply;
      });
      return { arrived, release: () => release() };
    },
    queued: (god) => queues.get(god)?.length ?? 0,
    clear: () => {
      queues.clear();
      policies.clear();
    },
    stop: () => server.stop(true),
  };
}

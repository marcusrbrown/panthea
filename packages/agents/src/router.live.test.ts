// One call through the production path against a live local Ollama: the
// routing config parser, the router, the OpenAI-compatible adapter, and
// Ollama's /v1 endpoint, with the derived 4K model. Opt-in: runs only with
// PANTHEA_LIVE_OLLAMA=1 (`bun run test:live`); once opted in, a missing Ollama
// or model fails. Setup: tools/probes/inference-baseline/README.md.

import { expect, test } from "bun:test";
import { type ParseResult, parseRoutingConfig } from "./config";
import { createRouter, type IntentSchema } from "./router";

const OLLAMA = "http://127.0.0.1:11434";
const MODEL = "llama3.2-3b-4k";
const optedIn = process.env.PANTHEA_LIVE_OLLAMA === "1";

async function unavailableReason(): Promise<string | undefined> {
  try {
    const response = await fetch(`${OLLAMA}/api/tags`, {
      signal: AbortSignal.timeout(750),
    });
    const { models } = (await response.json()) as {
      models?: { name: string }[];
    };
    return models?.some((model) => model.name.startsWith(`${MODEL}:`))
      ? undefined
      : `Ollama is up but has no ${MODEL} model (ollama create ${MODEL} -f tools/probes/inference-baseline/Modelfile.llama3.2-3b-4k)`;
  } catch {
    return `Ollama is not reachable at ${OLLAMA}`;
  }
}

if (!optedIn) {
  console.log(
    "live Ollama test skipped: set PANTHEA_LIVE_OLLAMA=1 (bun run test:live)",
  );
}

interface Turn {
  readonly kind: "say" | "idle";
  readonly text: string;
}

const turnIntent: IntentSchema<Turn> = {
  jsonSchema: {
    type: "object",
    properties: {
      kind: { enum: ["say", "idle"] },
      text: { type: "string" },
    },
    required: ["kind", "text"],
    additionalProperties: false,
  },
  parse(candidate: unknown): ParseResult<Turn> {
    const value = candidate as { kind?: unknown; text?: unknown } | null;
    return (value?.kind === "say" || value?.kind === "idle") &&
      typeof value.text === "string" &&
      value.text.trim() !== ""
      ? { ok: true, value: { kind: value.kind, text: value.text } }
      : { ok: false, path: "", message: "not a turn" };
  },
};

test.skipIf(!optedIn)(
  "a live local Ollama answers one turn with a schema-valid intent through the production path",
  async () => {
    const unavailable = await unavailableReason();
    if (unavailable)
      throw new Error(`live Ollama test opted in but ${unavailable}`);
    const config = parseRoutingConfig({
      endpoints: [{ id: "ollama", baseUrl: `${OLLAMA}/v1`, model: MODEL }],
      roles: { zeus: { endpoint: "ollama" } },
    });
    if (!config.ok) throw new Error(`${config.path}: ${config.message}`);
    const router = createRouter({ config: config.value, offline: true });

    const result = await router.route(
      "zeus",
      {
        instructions:
          "You are Zeus, king of the Greek gods, watching a small village. Answer only with the requested JSON.",
        prompt:
          'The farmer arrives at your altar and kneels. Choose "say" to speak to him, or "idle" to ignore him, and put your words or your reason in "text".',
      },
      turnIntent,
    );

    console.log(
      `live Ollama (${MODEL}): ${result.kind}, ${Math.round(result.elapsedMs)} ms` +
        (result.kind === "intent"
          ? `, ${result.step.mode}, ${result.step.attempts} attempt(s), ${JSON.stringify(result.intent)}`
          : `, ${JSON.stringify(result.steps)}`),
    );
    expect(result.kind).toBe("intent");
    if (result.kind === "intent") {
      expect(turnIntent.parse(result.intent).ok).toBe(true);
      expect(result.step.endpoint).toBe("ollama");
      expect(result.step.model).toBe(MODEL);
    }
  },
  60_000,
);

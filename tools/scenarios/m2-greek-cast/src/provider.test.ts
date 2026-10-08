import { afterEach, expect, test } from "bun:test";
import {
  EMPTY_COMPLETION,
  type RawReply,
  type ScriptedProvider,
  startProvider,
  WAIT,
} from "./provider";

const started: ScriptedProvider[] = [];
afterEach(() => {
  for (const provider of started.splice(0)) provider.stop();
});

function ask(provider: ScriptedProvider, who: string) {
  return fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "scripted",
      messages: [
        { role: "system", content: `You are ${who}, a Greek god of x.` },
        { role: "user", content: "What do you do?" },
      ],
    }),
  }).then(async (response) => {
    const body = (await response.json()) as {
      choices: { message: { content: string } }[];
    };
    return body.choices[0]?.message.content;
  });
}

const boot = () => {
  const provider = startProvider();
  started.push(provider);
  return provider;
};

test("an unscripted god waits; each request is recorded with which god asked, its prompt, and when", async () => {
  const provider = boot();
  expect(await ask(provider, "Zeus")).toBe('{"action":"wait"}');
  expect(await ask(provider, "Hera")).toBe('{"action":"wait"}');
  expect(provider.requests.map((r) => r.god)).toEqual(["zeus", "hera"]);
  expect(provider.requests[0]?.prompt).toContain("You are Zeus");
  expect(provider.requests[0]?.at).toBeGreaterThan(0);
});

test("scripted replies go to the god they were queued for, in order, then the god waits again", async () => {
  const provider = boot();
  provider.enqueue(
    "zeus",
    '{"action":"legend","assertion":"a"}',
    () => '{"action":"legend","assertion":"b"}',
  );
  expect(await ask(provider, "Hera")).toBe('{"action":"wait"}');
  expect(await ask(provider, "Zeus")).toContain('"a"');
  expect(await ask(provider, "Zeus")).toContain('"b"');
  expect(await ask(provider, "Zeus")).toBe('{"action":"wait"}');
});

test("a held reply arrives only when released, and a reply function sees the request it answers", async () => {
  const provider = boot();
  const held = provider.hold("zeus", '{"action":"legend","assertion":"held"}');
  let answered = false;
  const pending = ask(provider, "Zeus").then((reply) => {
    answered = true;
    return reply;
  });
  const arrived = await held.arrived;
  expect(arrived.god).toBe("zeus");
  await Bun.sleep(50);
  expect(answered).toBe(false);
  held.release();
  expect(await pending).toContain("held");

  provider.enqueue("hera", (seen) =>
    JSON.stringify({ action: "legend", assertion: seen.prompt.slice(0, 12) }),
  );
  expect(await ask(provider, "Hera")).toContain("You are Hera");
});

test("a policy answers whenever the queue is empty, from the prompt alone, and each request records the reply it got", async () => {
  const provider = boot();
  provider.policy("hera", (seen) =>
    seen.prompt.includes("You are Hera")
      ? '{"action":"legend","assertion":"policy"}'
      : WAIT,
  );
  provider.enqueue("hera", '{"action":"legend","assertion":"queued"}');
  expect(await ask(provider, "Hera")).toContain("queued");
  expect(await ask(provider, "Hera")).toContain("policy");
  expect(await ask(provider, "Zeus")).toBe(WAIT);
  expect(provider.requests.map((r) => r.reply)).toEqual([
    '{"action":"legend","assertion":"queued"}',
    '{"action":"legend","assertion":"policy"}',
    WAIT,
  ]);
  provider.policy("hera", undefined);
  expect(await ask(provider, "Hera")).toBe(WAIT);
});

// --- Raw replies: the HTTP response itself -------------------------------------------------

/** The whole HTTP response to a chat request, as text and status. */
async function rawAsk(provider: ScriptedProvider, who: string) {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "scripted",
      messages: [
        { role: "system", content: `You are ${who}, a Greek god of x.` },
      ],
    }),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

test("a string reply is still wrapped as a chat completion with the scripted model and the one-second created date", async () => {
  const provider = boot();
  provider.enqueue("zeus", '{"action":"wait"}');
  const { status, body } = await rawAsk(provider, "Zeus");
  expect(status).toBe(200);
  expect(body.model).toBe("scripted");
  expect(body.created).toBe(1);
  expect(body.usage).toEqual({
    prompt_tokens: 1,
    completion_tokens: 1,
    total_tokens: 2,
  });
});

test("a raw reply is the HTTP response itself: its body and status, with no completion wrapped around it", async () => {
  const provider = boot();
  const odd: RawReply = { raw: { shape: "not a completion" }, status: 418 };
  provider.enqueue("zeus", odd);
  const { status, body } = await rawAsk(provider, "Zeus");
  expect(status).toBe(418);
  expect(body).toEqual({ shape: "not a completion" });
  expect(provider.requests[0]?.reply).toBe(
    JSON.stringify({ shape: "not a completion" }),
  );
});

test("the empty completion is a 200 with an empty model and the zero created date and no choices, and a queue, a policy and a reply function can all return it", async () => {
  const provider = boot();
  expect(EMPTY_COMPLETION.status).toBe(200);
  provider.policy("hera", () => EMPTY_COMPLETION);
  provider.enqueue("zeus", () => EMPTY_COMPLETION, EMPTY_COMPLETION);
  for (const who of ["Hera", "Zeus", "Zeus"]) {
    const { status, body } = await rawAsk(provider, who);
    expect(status).toBe(200);
    expect(body.model).toBe("");
    expect(body.created).toBe(-62135596800);
    expect(body.choices).toBeUndefined();
  }
});

test("a raw reply queued for a god is taken once, and the next request returns to its policy or to waiting", async () => {
  const provider = boot();
  provider.policy("zeus", () => '{"action":"legend","assertion":"policy"}');
  provider.enqueue("zeus", EMPTY_COMPLETION);
  expect((await rawAsk(provider, "Zeus")).body.model).toBe("");
  expect((await rawAsk(provider, "Zeus")).body.model).toBe("scripted");
  provider.policy("zeus", undefined);
  expect(await ask(provider, "Zeus")).toBe(WAIT);
});

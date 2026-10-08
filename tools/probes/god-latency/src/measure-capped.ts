// Reads the capped requests of `capture-capped.ts` to a real model and records
// what the server counted, against what the cap estimated.
//
//   bun run src/measure-capped.ts --contexts=/tmp/god-contexts-capped.json --out=results/capped.json
//
// Protocols, every request a chat call shaped like the router's (system text,
// user text, the intent schema as the output format, thinking off):
//
//   cold     the model is unloaded, then one request is sent. Nothing is cached,
//            so `prompt_eval_count` is the whole request: the number the cap
//            has to keep at or under `PROMPT_TOKEN_CAP`. Every capture once;
//            each god's busiest capture a second time, to show the count
//            repeats.
//   resend   a cold request, then the same request again with the model still
//            loaded: the second count is the few tokens the server had to
//            re-read, which shows the cold count was a full read and not a
//            cached one.
//   v1       one request through the OpenAI-compatible route the router uses,
//            to show its `usage.prompt_tokens` equals the native count.
//   rotation the seven gods in the service's order, round after round, in each
//            world, each god's request repeated unchanged: an upper bound on
//            what a cache saves.
//   live     the same rotation with the tick moved on by one every round, so
//            a god's request differs from its last the way a service's does
//            (everything before the per-tick state is shared, the rest is
//            new). Round 0 follows a wipe; later rounds are the steady state.

import { readFileSync, writeFileSync } from "node:fs";
import { GOD_ORDER } from "./capture";
import { type CappedCapture, MODEL } from "./capture-capped";
import { BASE, type Cost, chat, unload, wipe } from "./ollama";

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ??
  fallback;

const captures = JSON.parse(
  readFileSync(arg("contexts", ""), "utf8"),
) as CappedCapture[];
const rounds = Number(arg("rounds", "3"));
const out = arg("out", "");
const only = new Set(arg("only", "cold,resend,v1,rotation,live").split(","));
const CAP = 3000;

const messagesOf = (c: CappedCapture) => [
  { role: "system", content: c.instructions },
  { role: "user", content: c.prompt },
];
const ask = (c: CappedCapture) =>
  chat(MODEL, messagesOf(c), { format: c.schema });
const label = (c: CappedCapture) => `${c.world}/${c.god}`;

interface Row {
  readonly protocol: string;
  readonly world: string;
  readonly god: string;
  readonly step: number;
  readonly chars: number;
  readonly estimatedTokens: number;
  readonly cost: Cost;
}
const rows: Row[] = [];
const note = async (
  protocol: string,
  c: CappedCapture,
  step: number,
  asked: CappedCapture = c,
) => {
  const cost = await ask(asked);
  rows.push({
    protocol,
    world: c.world,
    god: c.god,
    step,
    chars: c.chars,
    estimatedTokens: c.estimatedTokens,
    cost,
  });
  console.error(
    `${protocol.padEnd(9)} ${label(c).padEnd(20)} ${String(c.chars).padStart(5)} chars  est ${c.estimatedTokens}  real ${cost.promptTokens}  prefill ${Math.round(cost.prefillMs)} ms  decode ${Math.round(cost.decodeMs)} ms  wall ${Math.round(cost.wallMs)} ms`,
  );
  return cost;
};

/** Each god's capture with the most estimated tokens. */
const busiest = GOD_ORDER.map(
  (god) =>
    captures
      .filter((c) => c.god === god)
      .sort((a, b) => b.estimatedTokens - a.estimatedTokens)[0],
).filter((c): c is CappedCapture => c !== undefined);

if (only.has("cold")) {
  for (const c of captures) {
    await unload(MODEL);
    await note("cold", c, 0);
  }
  for (const c of busiest) {
    await unload(MODEL);
    await note("cold-2", c, 1);
  }
}

if (only.has("resend")) {
  for (const c of busiest) {
    await unload(MODEL);
    await note("resend-1", c, 0);
    await note("resend-2", c, 1);
  }
}

let v1: { native: number; v1: number } | undefined;
if (only.has("v1")) {
  const c = busiest[0] as CappedCapture;
  await unload(MODEL);
  const native = await note("v1-native", c, 0);
  await unload(MODEL);
  const response = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    body: JSON.stringify({
      model: MODEL,
      messages: messagesOf(c),
      stream: false,
      max_tokens: 512,
      response_format: {
        type: "json_schema",
        json_schema: { name: "god_intent", schema: c.schema, strict: true },
      },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = (await response.json()) as {
    usage?: { prompt_tokens?: number };
  };
  v1 = { native: native.promptTokens, v1: body.usage?.prompt_tokens ?? -1 };
  console.error(
    `v1        ${label(c)}: native ${v1.native}, /v1 usage.prompt_tokens ${v1.v1}`,
  );
}

if (only.has("rotation")) {
  for (const world of ["heavy", "crowded", "aged"]) {
    await wipe(MODEL);
    let step = 0;
    for (let round = 0; round < rounds; round += 1) {
      for (const god of GOD_ORDER) {
        const c = captures.find((x) => x.world === world && x.god === god);
        if (c !== undefined) await note(`rotation-${world}`, c, step++);
      }
    }
  }
}

/** `c` with its tick line moved on by `by`, as a service's next turn would show it. */
const later = (c: CappedCapture, by: number): CappedCapture => ({
  ...c,
  prompt: c.prompt.replace(/tick (\d+)\./, (_, t) => `tick ${Number(t) + by}.`),
});

if (only.has("live")) {
  for (const world of ["heavy", "crowded", "aged"]) {
    await wipe(MODEL);
    let step = 0;
    for (let round = 0; round < rounds + 1; round += 1) {
      for (const god of GOD_ORDER) {
        const c = captures.find((x) => x.world === world && x.god === god);
        if (c !== undefined) {
          await note(
            `live-${world}-r${round === 0 ? 0 : 1}`,
            c,
            step++,
            later(c, round),
          );
        }
      }
    }
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] as number;
};
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] as number;
};
const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);

const colds = rows.filter((r) => r.protocol === "cold");
const cold2 = rows.filter((r) => r.protocol === "cold-2");
const errors = colds.map((r) => r.cost.promptTokens / r.estimatedTokens);
const lines: string[] = [];
lines.push(`# Capped god requests on ${MODEL}`, "");
if (colds.length > 0) {
  const over = colds.filter((r) => r.cost.promptTokens > CAP);
  lines.push(
    `Cold requests: ${colds.length}; at or under ${CAP} real tokens: ${colds.length - over.length}; over: ${over.length}. Real/estimated tokens: worst ${f2(Math.max(...errors))}, median ${f2(median(errors))}, best ${f2(Math.min(...errors))}.`,
    "",
    "| Request | Chars | Estimated | Real (cold) | Real / estimated | Repeat (cold) | Wall (cold) |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const r of colds) {
    const again = cold2.find((x) => x.world === r.world && x.god === r.god);
    lines.push(
      `| ${r.world}/${r.god} | ${r.chars} | ${r.estimatedTokens} | ${r.cost.promptTokens} | ${f2(r.cost.promptTokens / r.estimatedTokens)} | ${again === undefined ? "" : again.cost.promptTokens} | ${f1(r.cost.wallMs / 1000)} s |`,
    );
  }
  lines.push("");
}
const resends = rows.filter((r) => r.protocol.startsWith("resend"));
if (resends.length > 0) {
  lines.push(
    "Cache check (busiest request per god, cold then resent with the model loaded):",
    "",
    "| God | Cold count | Resent count |",
    "| --- | --- | --- |",
  );
  for (const god of GOD_ORDER) {
    const a = resends.find((r) => r.protocol === "resend-1" && r.god === god);
    const b = resends.find((r) => r.protocol === "resend-2" && r.god === god);
    if (a && b)
      lines.push(
        `| ${god} | ${a.cost.promptTokens} | ${b.cost.promptTokens} |`,
      );
  }
  lines.push("");
}
if (v1 !== undefined) {
  lines.push(
    `Native \`/api/chat\` count ${v1.native}; \`/v1/chat/completions\` \`usage.prompt_tokens\` ${v1.v1} for the same request.`,
    "",
  );
}
const live = rows.filter((r) => r.protocol.startsWith("live-"));
if (live.length > 0) {
  const stat = (name: string, rs: Row[]) => {
    const wall = rs.map((r) => r.cost.wallMs / 1000);
    const prefill = rs.map((r) => r.cost.prefillMs / 1000);
    return `| ${name} | ${rs.length} | ${f1(median(wall))} s / ${f1(pct(wall, 0.95))} s | ${f1(median(prefill))} s / ${f1(pct(prefill, 0.95))} s | ${median(rs.map((r) => r.cost.promptTokens))} | ${Math.max(...rs.map((r) => r.cost.promptTokens))} |`;
  };
  lines.push(
    "Live rotation (the tick moves on every round; sequential in the service's god order):",
    "",
    "| Requests | n | Wall p50 / p95 | Prefill p50 / p95 | Tokens p50 | Tokens max |",
    "| --- | --- | --- | --- | --- | --- |",
    stat(
      "round 0 (after a wipe)",
      live.filter((r) => r.protocol.endsWith("-r0")),
    ),
    stat(
      "steady (rounds 1 on)",
      live.filter((r) => r.protocol.endsWith("-r1")),
    ),
    stat("all", live),
    "",
  );
}
const rot = rows.filter((r) => r.protocol.startsWith("rotation"));
if (rot.length > 0) {
  const wall = rot.map((r) => r.cost.wallMs / 1000);
  const prefill = rot.map((r) => r.cost.prefillMs / 1000);
  lines.push(
    `Warm rotation (${rot.length} requests, ${rounds} rounds per world, sequential in the service's god order): wall median ${f1(median(wall))} s, p95 ${f1(pct(wall, 0.95))} s; prefill median ${f1(median(prefill))} s, p95 ${f1(pct(prefill, 0.95))} s; prompt tokens the server read median ${median(rot.map((r) => r.cost.promptTokens))}, max ${Math.max(...rot.map((r) => r.cost.promptTokens))}.`,
    "",
  );
}
const markdown = lines.join("\n");
console.log(markdown);
if (out !== "") {
  writeFileSync(out, JSON.stringify({ model: MODEL, rows, v1 }, null, 2));
  writeFileSync(out.replace(/\.json$/, ".md"), `${markdown}\n`);
}

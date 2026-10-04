// Measures what a god's request costs the model server, split the way the
// latency splits: reading the prompt (prefill) and writing the reply (decode),
// and what the server's cache saves when requests follow each other.
//
//   bun run src/measure.ts --contexts=/tmp/god-contexts-before.json --label=before --out=results/before.json
//
// Five protocols, every request a real chat call shaped like the router's
// (system text, user text, the intent schema as the output format, thinking
// off), sent one at a time:
//
//   first      unload the model; the first request after the load. Its load,
//              and a cold prompt.
//   cold       the request with a one-line salt (a fresh random token) put
//              in front of it, so it shares no start with anything the server
//              holds: the cost of reading each god's whole request with no
//              cache at all. (A tiny request sent first is not enough: the
//              server kept a god's earlier prompt through it and answered the
//              second round in 60-190 ms.)
//   resend     the same request twice: the most a cache can save.
//   rotation   the seven gods in the service's order, round after round at
//              successive ticks: what the cache saves when requests are
//              different gods'. This is the production pattern.
//   samegod    a god, then the same god at a later tick: what its own start
//              saves when only the per-tick state changed.

import { readFileSync, writeFileSync } from "node:fs";
import { type Capture, GOD_ORDER } from "./capture";
import { chat, unload, wipe } from "./ollama";
import { type Row, render } from "./report";

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ??
  fallback;

const model = arg("model", "qwen3-8b-4k");
const only = new Set(
  arg("only", "first,cold,resend,rotation,samegod").split(","),
);
const label = arg("label", "run");
const reps = Number(arg("reps", "2"));
const out = arg("out", "");
const captures = JSON.parse(
  readFileSync(arg("contexts", ""), "utf8"),
) as Capture[];

const find = (god: string, tick: number): Capture => {
  const found = captures.find((c) => c.god === god && c.tick === tick);
  if (found === undefined)
    throw new Error(`no capture for ${god} at tick ${tick}`);
  return found;
};
const messagesOf = (c: Capture) => [
  { role: "system", content: c.instructions },
  { role: "user", content: c.prompt },
];
const ask = (c: Capture, salt?: string) =>
  chat(
    model,
    salt === undefined
      ? messagesOf(c)
      : [
          { role: "system", content: `${salt}\n${c.instructions}` },
          { role: "user", content: c.prompt },
        ],
    { format: c.schema },
  );
const salted = () => `Session ${crypto.randomUUID()}.`;

const ticks = [...new Set(captures.map((c) => c.tick))].sort((a, b) => a - b);
const busy = ticks.filter((t) => t >= 300);
const rows: Row[] = [];
const note = async (
  protocol: string,
  c: Capture,
  step: number,
  salt?: string,
) => {
  const cost = await ask(c, salt);
  rows.push({ ...cost, protocol, god: c.god, tick: c.tick, step });
  console.error(
    `${protocol.padEnd(9)} ${c.god.padEnd(10)} t${String(c.tick).padEnd(4)} prefill ${Math.round(cost.prefillMs)} ms (${cost.promptTokens} tok) decode ${Math.round(cost.decodeMs)} ms (${cost.replyTokens} tok) load ${Math.round(cost.loadMs)} ms wall ${Math.round(cost.wallMs)} ms`,
  );
};

const busiest = busy.at(-1) ?? 500;

// first: the first request after a load, per rep (salted: the load empties the cache anyway).
if (only.has("first")) {
  for (let rep = 0; rep < reps; rep += 1) {
    await unload(model);
    await note(
      "first",
      find("athena", busy[1] ?? busy[0] ?? 400),
      rep,
      salted(),
    );
  }
}

// cold: no cache at all, every god, at the busiest tick.
if (only.has("cold")) {
  for (let rep = 0; rep < reps; rep += 1) {
    for (const god of GOD_ORDER) {
      await note("cold", find(god, busiest), rep, salted());
    }
  }
}

// resend: identical twice.
if (only.has("resend")) {
  for (const god of ["athena", "poseidon", "zeus"]) {
    await wipe(model);
    await note("resend-1", find(god, busiest), 0);
    await note("resend-2", find(god, busiest), 1);
  }
}

// rotation: seven gods in order, round after round at successive ticks.
let step = 0;
if (only.has("rotation")) {
  for (let rep = 0; rep < reps; rep += 1) {
    await wipe(model);
    for (const tick of busy) {
      for (const god of GOD_ORDER) {
        await note("rotation", find(god, tick), step);
        step += 1;
      }
    }
  }
}

// samegod: a god, then itself a round later.
if (only.has("samegod")) {
  for (const god of GOD_ORDER) {
    await wipe(model);
    await note("samegod-1", find(god, busy[0] ?? 300), 0);
    await note("samegod-2", find(god, busy[1] ?? 400), 1);
  }
}

const markdown = render(label, model, reps, rows, captures, busy);
console.log(markdown);
if (out !== "") {
  writeFileSync(
    out,
    JSON.stringify({ label, model, reps, ticks: busy, rows }, null, 2),
  );
  writeFileSync(out.replace(/\.json$/, ".md"), `${markdown}\n`);
}

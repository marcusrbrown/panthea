// Turns measured rows into the tables a README records.

import { type Capture, GOD_ORDER } from "./capture";
import type { Cost } from "./ollama";
import { sharedPrefixLength } from "./prefix";

export type Row = Cost & {
  protocol: string;
  god: string;
  tick: number;
  step: number;
};

const median = (xs: readonly number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const pct = (xs: readonly number[], p: number) =>
  [...xs].sort((a, b) => a - b)[
    Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))
  ] ?? 0;

export const PROTOCOLS = [
  "first",
  "cold",
  "resend-1",
  "resend-2",
  "rotation",
  "samegod-1",
  "samegod-2",
] as const;

export function table(rows: readonly Row[]): string[] {
  const group = (protocol: string) =>
    rows.filter((r) => r.protocol === protocol);
  const names = PROTOCOLS.filter((name) => group(name).length > 0);
  return [
    "| Protocol | Requests | Prompt tokens (median) | Prefill median | Prefill p95 | Decode median | Reply tokens (median) | Load (max) | Wall median | Wall p95 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...names.map((name) => {
      const g = group(name);
      return `| ${name} | ${g.length} | ${median(g.map((r) => r.promptTokens))} | ${Math.round(median(g.map((r) => r.prefillMs)))} ms | ${Math.round(
        pct(
          g.map((r) => r.prefillMs),
          95,
        ),
      )} ms | ${Math.round(median(g.map((r) => r.decodeMs)))} ms | ${median(g.map((r) => r.replyTokens))} | ${Math.round(Math.max(0, ...g.map((r) => r.loadMs)))} ms | ${Math.round(median(g.map((r) => r.wallMs)))} ms | ${Math.round(
        pct(
          g.map((r) => r.wallMs),
          95,
        ),
      )} ms |`;
    }),
  ];
}

/** What every god's request shares at its start, by tick: the system text, and the whole request. */
export function sharing(
  captures: readonly Capture[],
  ticks: readonly number[],
) {
  const at = (tick: number, god: string) => {
    const c = captures.find((x) => x.god === god && x.tick === tick);
    if (c === undefined)
      throw new Error(`no capture for ${god} at tick ${tick}`);
    return c;
  };
  return {
    system: ticks.map((tick) =>
      sharedPrefixLength(GOD_ORDER.map((god) => at(tick, god).instructions)),
    ),
    whole: ticks.map((tick) =>
      sharedPrefixLength(
        GOD_ORDER.map((god) => {
          const c = at(tick, god);
          return `${c.instructions}\n\n${c.prompt}`;
        }),
      ),
    ),
    systemChars: ticks.map((tick) => at(tick, "zeus").instructions.length),
    requestChars: ticks.map((tick) => {
      const c = at(tick, "zeus");
      return c.instructions.length + 2 + c.prompt.length;
    }),
  };
}

export function render(
  label: string,
  model: string,
  reps: number,
  rows: readonly Row[],
  captures: readonly Capture[],
  ticks: readonly number[],
): string {
  const share = sharing(captures, ticks);
  return [
    `# God request cost: ${label}`,
    "",
    `${rows.length} requests on ${model}, ${reps} repetitions, ticks ${ticks.join(", ")}.`,
    "",
    ...table(rows),
    "",
    `Characters every god's system text shares at its start, by tick (${ticks.join(", ")}): ${share.system.join(", ")}, of system texts of about ${share.systemChars.join(", ")}. Characters the whole request (system and user) shares across all seven gods: ${share.whole.join(", ")}, of requests of about ${share.requestChars.join(", ")} (Zeus's, for scale).`,
  ].join("\n");
}

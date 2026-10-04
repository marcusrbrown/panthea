// Whether two sets of captured requests show a god the same things. A change to
// the order of a prompt must not change what is in it, so for every god at every
// tick this compares the lines of the whole request (system text, then user
// text) as a multiset: the same lines, each as many times as before, in any
// order. It also reports how the system text split changed.
//
//   bun run src/compare-contexts.ts /tmp/god-contexts-before.json /tmp/god-contexts-after.json
//
// Exits 1 on any line that is in one and not the other.

import { readFileSync } from "node:fs";
import type { Capture } from "./capture";

function counts(c: Capture): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of `${c.instructions}\n${c.prompt}`.split("\n")) {
    if (line === "") continue;
    out.set(line, (out.get(line) ?? 0) + 1);
  }
  return out;
}

export function diff(
  before: Capture,
  after: Capture,
): { onlyBefore: string[]; onlyAfter: string[] } {
  const a = counts(before);
  const b = counts(after);
  const onlyBefore: string[] = [];
  const onlyAfter: string[] = [];
  for (const [line, n] of a) {
    for (let i = 0; i < n - (b.get(line) ?? 0); i += 1) onlyBefore.push(line);
  }
  for (const [line, n] of b) {
    for (let i = 0; i < n - (a.get(line) ?? 0); i += 1) onlyAfter.push(line);
  }
  return { onlyBefore, onlyAfter };
}

if (import.meta.main) {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (beforePath === undefined || afterPath === undefined) {
    throw new Error("usage: compare-contexts <before.json> <after.json>");
  }
  const before = JSON.parse(readFileSync(beforePath, "utf8")) as Capture[];
  const after = JSON.parse(readFileSync(afterPath, "utf8")) as Capture[];
  let differs = 0;
  for (const b of before) {
    const a = after.find((c) => c.god === b.god && c.tick === b.tick);
    if (a === undefined) {
      console.log(`MISSING ${b.god} t${b.tick}`);
      differs += 1;
      continue;
    }
    const { onlyBefore, onlyAfter } = diff(b, a);
    if (onlyBefore.length + onlyAfter.length > 0) {
      differs += 1;
      console.log(`DIFFERENT ${b.god} t${b.tick}`);
      for (const line of onlyBefore) console.log(`  - ${line.slice(0, 160)}`);
      for (const line of onlyAfter) console.log(`  + ${line.slice(0, 160)}`);
    }
  }
  const chars = (cs: Capture[]) =>
    cs.map((c) => c.instructions.length + 2 + c.prompt.length);
  const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
  console.log(
    `${before.length} requests compared; ${differs} differ. Mean request chars ${Math.round(mean(chars(before)))} -> ${Math.round(mean(chars(after)))}.`,
  );
  process.exit(differs === 0 ? 0 : 1);
}

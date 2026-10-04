// Re-renders a measurement's tables from its saved rows, with the captures it
// was taken on, so a table can be regenerated without asking the model again.
//
//   bun run src/render.ts results/before.json results/contexts-before.json

import { readFileSync, writeFileSync } from "node:fs";
import type { Capture } from "./capture";
import { type Row, render } from "./report";

const [resultsPath, capturesPath] = process.argv.slice(2);
if (resultsPath === undefined || capturesPath === undefined) {
  throw new Error("usage: render <results.json> <contexts.json>");
}
const saved = JSON.parse(readFileSync(resultsPath, "utf8")) as {
  label: string;
  model: string;
  reps: number;
  ticks?: number[];
  rows: Row[];
};
const captures = JSON.parse(readFileSync(capturesPath, "utf8")) as Capture[];
const ticks =
  saved.ticks ??
  [...new Set(captures.map((c) => c.tick))]
    .filter((t) => t >= 300)
    .sort((a, b) => a - b);
const markdown = render(
  saved.label,
  saved.model,
  saved.reps,
  saved.rows,
  captures,
  ticks,
);
console.log(markdown);
writeFileSync(resultsPath.replace(/\.json$/, ".md"), `${markdown}\n`);

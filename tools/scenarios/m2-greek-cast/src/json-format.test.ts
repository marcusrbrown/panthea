// The evidence JSON is committed, and CI runs biome's formatter over it. The oracle here is biome itself: whatever the
// writer emits must be a fixed point of `biome format`, for the shapes the evidence holds.

import { expect, test } from "bun:test";
import { join } from "node:path";
import { REPO_ROOT } from "../../m1-living-world/src/sidecar";
import { formatJson } from "./json-format";

const BIOME = join(REPO_ROOT, "node_modules/.bin/biome");

/** What biome's formatter makes of `text` as a .json file. */
function biomeFormat(text: string): string {
  const run = Bun.spawnSync(
    [BIOME, "format", "--stdin-file-path=evidence.json"],
    {
      stdin: new TextEncoder().encode(text),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (run.exitCode !== 0) {
    throw new Error(
      `biome format failed: ${new TextDecoder().decode(run.stderr)}`,
    );
  }
  return new TextDecoder().decode(run.stdout);
}

/** An array of strings whose one-line form puts the line at exactly `width` columns, with a key and two spaces of indent. */
const arrayOfWidth = (width: number): string[] => {
  // `  "k": ["` + body + `"]` is 2 + 5 + 1 + 1 + n + 1 + 1 = n + 11 columns for one string of n characters.
  return ["x".repeat(Math.max(1, width - 11))];
};

const SHAPES: Record<string, unknown> = {
  scalars: {
    a: null,
    b: true,
    c: false,
    d: 1.5,
    e: -3,
    f: "text",
    g: 'quote " and \\ and \n',
  },
  emptyContainers: { models: [], extra: {}, nested: { none: [] } },
  shortNumbers: { pids: [9], more: [9, 10, 11] },
  shortStrings: { failedRows: ["prompt.tokens"], lines: ["a", "b"] },
  longStrings: {
    lines: [
      "a long line of text number one that goes on for a good while",
      "a long line of text number two that goes on for a good while",
    ],
  },
  objectsInArrays: { rows: [{ x: 1 }, { y: [1, 2] }] },
  deep: { a: { b: { c: [1, 2], d: { e: [] } } } },
  memorySample: {
    last: {
      atMs: 1791455730130,
      runner: { state: "present", pids: [4321], rssBytes: 4900000000 },
      sidecar: { state: "present", pid: 4001, rssBytes: 900000000 },
    },
    summary: {
      samples: 3,
      runner: { present: 3, absent: 0 },
      swapUsedMiB: { peak: 12.5 },
    },
    postRunSamples: 0,
  },
  psTable: {
    ok: true,
    body: {
      models: [
        {
          name: "granite3.3-8b-4k",
          size: 5300000000,
          expires_at: "2026-10-08T10:00:00-07:00",
          details: { families: ["granite"], parameter_size: "8.2B" },
        },
      ],
    },
  },
  longNumbers: { n: Array.from({ length: 40 }, (_, i) => i * 1000) },
  undefinedIsDropped: { kept: 1, gone: undefined },
};

test("the writer's output is a fixed point of biome's formatter for every shape the evidence holds", () => {
  for (const [name, value] of Object.entries(SHAPES)) {
    const written = formatJson(value);
    expect([name, biomeFormat(written)]).toEqual([name, written]);
    // And it is the same data: parsing it gives back the value JSON would have kept.
    expect(JSON.parse(written)).toEqual(JSON.parse(JSON.stringify(value)));
    expect(written.endsWith("\n")).toBe(true);
    expect(written.endsWith("\n\n")).toBe(false);
  }
});

test("an array of strings goes on one line exactly when it fits in 80 columns, with the key and the comma counted", () => {
  const widths = [60, 76, 77, 78, 79, 80, 81, 82, 90];
  for (const width of widths) {
    const value = { k: arrayOfWidth(width) };
    const written = formatJson(value);
    expect([width, biomeFormat(written)]).toEqual([width, written]);
    const inline = written
      .split("\n")
      .some((line) => line.startsWith('  "k": ["'));
    expect([width, inline]).toEqual([width, width <= 80]);
  }
  // With a sibling after it the comma takes a column: a line of 80 with the comma is 81, so it breaks.
  for (const width of [77, 78, 79, 80, 81]) {
    const value = { k: arrayOfWidth(width), z: 1 };
    const written = formatJson(value);
    expect([width, biomeFormat(written)]).toEqual([width, written]);
    const inline = written
      .split("\n")
      .some((line) => line.startsWith('  "k": ["'));
    expect([width, inline]).toEqual([width, width + 1 <= 80]);
  }
  // Nested deeper, the indent counts too.
  for (const width of [72, 74, 76, 78, 80]) {
    const value = { a: { b: { k: arrayOfWidth(width - 4) } } };
    const written = formatJson(value);
    expect([width, biomeFormat(written)]).toEqual([width, written]);
  }
});

test("a path to a number array fills lines the way biome does, and short ones stay on one line", () => {
  for (const length of [1, 2, 5, 12, 13, 14, 25, 40, 100]) {
    const value = { n: Array.from({ length }, (_, i) => i * 997) };
    const written = formatJson(value);
    expect([length, biomeFormat(written)]).toEqual([length, written]);
  }
});

test("values JSON cannot hold are not invented: undefined in an array is null, a missing key stays missing, and an empty document is one line", () => {
  expect(formatJson({ a: [1, undefined, 3] })).toBe(
    '{\n  "a": [1, null, 3]\n}\n',
  );
  expect(formatJson({})).toBe("{}\n");
  expect(formatJson([])).toBe("[]\n");
  expect(formatJson("x")).toBe('"x"\n');
  expect(formatJson({ a: undefined })).toBe("{}\n");
});

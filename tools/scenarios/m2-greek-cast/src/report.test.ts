import { expect, test } from "bun:test";
import type { EnvironmentInfo } from "@panthea/tools-probes-shared";
import type { StepResult } from "../../m1-living-world/src/helpers";
import { PRACTICE_CONTROLS } from "./practice-controls";
import { buildReportInput, type RunSummary } from "./report";
import { CONTROL_NAMES } from "./steps/context";

const environment: EnvironmentInfo = {
  hardware: { brand: "test cpu", memoryBytes: "1" },
  os: { productName: "macOS", productVersion: "15", buildVersion: "x" },
  bun: { version: "1.4.2" },
  pinned: { tauri: "2", three: "0.185", threeFlatland: "0.1" },
  extra: {},
};

const step: StepResult = {
  id: "S4",
  title: "Strike",
  invariant: "The strike commits.",
  result: "ignition evt-1-1",
  measurements: [{ name: "prompts checked", unit: "prompts", value: 3 }],
  notes: ["a note"],
  elapsedMs: 1500,
};

const summary: RunSummary = {
  steps: [step],
  controls: [
    {
      via: "process",
      name: "chain",
      sabotage: "Drops the claim.",
      exitCode: 1,
      scope: "It reruns the story.",
      seconds: 12,
      failure: "FAIL invariant violated: x",
    },
    {
      via: "in-process",
      name: "god-silent",
      sabotage: "Deletes a god's moves.",
      failure: "FAIL invariant violated: every god practiced holds -- y",
    },
  ],
  environment,
  totalMs: 60_000,
  binaryBytes: 60 * 1024 * 1024,
  real: undefined,
};

test("the report carries each step, its notes, and each control's failure, with numbers from the run", () => {
  const input = buildReportInput(summary);
  expect(input.findings.join("\n")).toContain("S4 Strike");
  expect(input.findings.join("\n")).toContain("a note");
  expect(input.findings.join("\n")).toContain("Positive control `chain`");
  expect(input.metrics).toEqual([
    { name: "S4 prompts checked", unit: "prompts", samples: [3] },
  ]);
  expect(input.findings.join("\n")).toContain(
    "Positive control `god-silent` (in-process)",
  );
  expect(input.findings.join("\n")).toContain(
    "It reruns the story. The run exited 1 after 12 s with: FAIL invariant violated: x",
  );
  expect(input.bottomLine).toContain(
    "All 2 positive controls tripped the assertion they target",
  );
  expect(input.bottomLine).toContain(
    "1 by a child process that exited non-zero (a rerun of the story to the step it breaks, or only its own staged step), 1 by breaking a copy of the evidence a step collected in-process",
  );
  expect(input.caveat).toContain("Not covered");
});

test("a real run adds its numbers, its properties, and its limits; without one the report says it has none", () => {
  expect(buildReportInput(summary).findings.join("\n")).toContain(
    "No real-inference run is recorded",
  );
  const withReal = buildReportInput({
    ...summary,
    real: {
      ranAt: "2026-09-29T00:00:00.000Z",
      model: "llama3.2-3b-4k",
      durationMs: 180_000,
      ticks: 180,
      hardware: "test cpu",
      analysis: {
        requests: {
          total: 60,
          intent: 55,
          exhausted: 5,
          native: 50,
          repaired: 5,
        },
        latencyMs: { p50: 2100, p95: 4100 },
        promptChars: { p50: 3600, max: 4600 },
        proposals: { move: 10 },
        outcomes: { committed: 10 },
        exhaustion: [
          { reason: "invalid-output", detail: "content too long", count: 5 },
        ],
        refusals: [],
        degradedShare: 0.1,
        properties: [
          { name: "valid actions", ok: true, detail: "10 proposals" },
        ],
      },
    },
  });
  const text = withReal.findings.join("\n");
  expect(text).toContain("llama3.2-3b-4k");
  expect(text).toContain("p50 2100 ms");
  expect(text).toContain("content too long");
  expect(text).toContain("valid actions");
  expect(text).toContain("does not show");
});

test("a control that did not trip is not counted among those that did", () => {
  const input = buildReportInput({
    ...summary,
    controls: [
      {
        via: "process",
        name: "chain",
        sabotage: "x",
        exitCode: 0,
        scope: "It reruns the story.",
        seconds: 3,
        failure: "",
      },
    ],
  });
  expect(input.bottomLine).not.toContain("positive controls tripped");
});

test("the how-to-run text names every positive control the runner has, process and in-process, so a new control cannot be left out of the README", () => {
  const input = buildReportInput(summary);
  for (const name of [...CONTROL_NAMES, ...PRACTICE_CONTROLS]) {
    expect(input.howToRun).toContain(`\`${name}\``);
  }
});

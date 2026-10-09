import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fakeTransport } from "../host/_testkit";
import { createStudioHost } from "../host/client";
import { initialWorkflowState, workflowReducer } from "./model";
import { WorkflowView } from "./Workflow";

const host = createStudioHost(fakeTransport());

function stateFor(
  job?: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return workflowReducer(initialWorkflowState(), {
    type: "snapshot",
    snapshot: {
      host: { state: "running" },
      status: { owner: null },
      requests: [],
      jobs: (job === undefined ? [] : [job]) as never,
      candidates: [],
      edits: [],
      workingSets: [],
      assets: [],
      ...extra,
    },
  });
}

const render = (state: ReturnType<typeof stateFor>) =>
  renderToStaticMarkup(createElement(WorkflowView, { state, host }));

describe("WorkflowView controls", () => {
  test("empty queue has no job actions", () => {
    const html = render(stateFor());
    expect(html).toContain("Queue is empty");
    expect(html).not.toContain("Remove");
    expect(html).not.toContain("Abort");
    expect(html).not.toContain("Retry");
  });

  test.each([
    ["queued", "Remove", false],
    ["running", "Abort", false],
    ["aborting", "Remove", false],
    ["cancelled", "Retry", false],
    ["removed", "", true],
    ["failed", "Retry", false],
    ["completed", "", true],
    ["unavailable", "", true],
  ] as const)(
    "%s exposes only its legal job action",
    (status, allowed, forbidden) => {
      const html = render(stateFor({ id: "job-1", status }));
      expect(html).toContain(
        status === "unavailable"
          ? "Unavailable / staging"
          : status === "completed"
            ? "Completed"
            : labelFor(status),
      );
      const controls = [
        ...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g),
      ].map((match) => match[1]);
      if (allowed) expect(controls).toContain(allowed);
      else expect(controls).not.toContain("Retry");
      if (!forbidden) {
        const disallowed = ["Remove", "Abort", "Retry"].filter(
          (name) => name !== allowed,
        );
        for (const name of disallowed) expect(controls).not.toContain(name);
      } else {
        expect(controls).not.toContain("Retry");
      }
    },
  );

  test("unavailable staging names its missing artifact and is not failed", () => {
    const html = render(
      stateFor({
        id: "job-1",
        status: "unavailable",
        staging: "z-image.safetensors",
      }),
    );
    expect(html).toContain("Unavailable / staging");
    expect(html).toContain("z-image.safetensors");
    expect(html).not.toContain("Failed");
  });

  test("candidate checks and metrics render in ascending pixel-change order", () => {
    const candidateState = stateFor(undefined, {
      candidates: [
        {
          id: "candidate-more-change",
          slot: "walk/south",
          report: { status: "fail", failedChecks: ["palette-limit"] },
          metrics: { pixelsMoved: 14, detectedScale: 2, coloursMerged: 1 },
        },
        {
          id: "candidate-less-change",
          slot: "idle/south",
          report: { status: "pass", failedChecks: [] },
          metrics: { pixelsMoved: 3, detectedScale: 1, coloursMerged: 0 },
        },
      ],
    });
    const html = render(
      workflowReducer(candidateState, {
        type: "sheet",
        value: { workingSetId: "set-default" },
      }),
    );
    expect(html.indexOf("candidate-less-change")).toBeLessThan(
      html.indexOf("candidate-more-change"),
    );
    expect(html).toContain("palette-limit");
    expect(html).toContain("Pixels moved");
    expect(html).toContain("14");
  });

  test("a loaded sheet shows pixel-cell loading and a compact sheet summary", () => {
    const loaded = workflowReducer(
      stateFor(undefined, {
        requests: [{ id: "r1", subject: "zeus" }],
        workingSets: [{ id: "w1", requestId: "r1", status: "open" }],
        candidates: [
          {
            id: "c1",
            requestId: "r1",
            slot: "idle/south",
            metrics: { pixelsMoved: 1 },
          },
        ],
      }),
      {
        type: "sheet",
        value: { workingSetId: "w1", requestId: "r1", candidateCount: 1 },
      },
    );
    const html = render(loaded);
    expect(html).toContain("1 candidate");
    expect(html).toContain("Loading candidate pixels");
    expect(html).not.toContain(
      'class="sheet-summary"><h3>Sheet summary</h3><pre>',
    );
  });

  test("remove stays enabled for queued work during the host restart", () => {
    const html = render(
      stateFor(
        { id: "job-3", requestId: "r1", status: "queued" },
        {
          host: { state: "restarting", attempt: 2, maxAttempts: 3 },
        },
      ),
    );
    expect(html).toContain("Restarting 2/3");
    expect(html).toMatch(/<button type="button">Remove<\/button>/);
  });

  test("failed conformance hides plain approve and requires an exception reason", () => {
    const html = render(
      stateFor(undefined, {
        assets: [
          {
            id: "asset-1",
            assetId: "zeus-idle",
            state: "draft",
            manifestRevision: "rev-8",
            report: { status: "fail", failedChecks: ["palette-limit"] },
          },
        ],
      }),
    );
    expect(html).not.toContain(">Approve</button>");
    expect(html).toContain("palette-limit");
    expect(html).toContain("Approve with exception");
    expect(html).toMatch(
      /<button[^>]*disabled[^>]*>Approve with exception<\/button>/,
    );
  });

  test("root lock names the PID and disables every mutation", () => {
    const html = render(
      stateFor(
        { id: "job-1", status: "queued" },
        {
          host: { state: "read-only", lockHolder: 913 },
          requests: [{ id: "r1", subject: "zeus" }],
          workingSets: [{ id: "w1", requestId: "r1", status: "open" }],
        },
      ),
    );
    expect(html).toContain("Locked by another studio session (pid 913)");
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).not.toMatch(
      /<button(?![^>]*disabled)[^>]*>(?:Remove|Abort|Retry|Generate|Pick|Reject|Edit|Pack|Approve|Publish)/,
    );
  });

  test("a read-only host is shown as connected and read-only, never as unavailable or restarting", () => {
    const html = render(
      stateFor(undefined, { host: { state: "read-only", lockHolder: 913 } }),
    );
    expect(html).toContain("Read-only");
    expect(html).not.toContain("Unavailable");
    expect(html).not.toContain("Restarting");
    expect(html).toContain("pid 913");
  });

  test("root lock keeps read-only sheet viewing open for an existing set", () => {
    const html = render(
      stateFor(undefined, {
        host: { state: "read-only", lockHolder: 913 },
        requests: [{ id: "r1", subject: "zeus" }],
        workingSets: [{ id: "w1", requestId: "r1", status: "open" }],
      }),
    );
    expect(html).toMatch(/<button type="button">View sheet<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>View sheet<\/button>/);
  });

  test("retry is absent from succeeded, queued and running jobs", () => {
    for (const job of [
      { id: "j1", status: "succeeded" },
      { id: "j2", status: "queued" },
      { id: "j3", status: "running" },
    ]) {
      expect(render(stateFor(job))).not.toContain("Retry");
    }
  });
});

function labelFor(status: string) {
  return status[0]?.toUpperCase() + status.slice(1);
}

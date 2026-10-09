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

  test("candidate checks and host metrics render in ascending pixel-change order", () => {
    const candidateState = stateFor(undefined, {
      candidates: [
        {
          id: "candidate-more-change",
          status: "done",
          requestId: "r1",
          slotKey: "walk/south",
          ordinal: 0,
          input: { hash: "a".repeat(64), width: 64, height: 80 },
          imageHash: "b".repeat(64),
          proposalHash: "c".repeat(64),
          report: { status: "fail", failedChecks: ["palette-limit"] },
          scale: 2,
          coloursMerged: 1,
          pixelsChanged: 14,
        },
        {
          id: "candidate-less-change",
          status: "done",
          requestId: "r1",
          slotKey: "idle/south",
          ordinal: 0,
          input: { hash: "d".repeat(64), width: 64, height: 80 },
          imageHash: "e".repeat(64),
          proposalHash: "f".repeat(64),
          report: { status: "pass", failedChecks: [] },
          scale: 1,
          coloursMerged: 0,
          pixelsChanged: 3,
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
    expect(html).toContain("Pixels changed");
    expect(html).toContain("14");
    expect(html).toContain("Scale");
    expect(html).toContain("Colours merged");
  });

  test("needs-scale candidates show their message without a report pill", () => {
    const html = render(
      workflowReducer(
        stateFor(undefined, {
          candidates: [
            {
              id: "j-needs-scale",
              status: "needs-scale",
              requestId: "r1",
              slotKey: "idle/south",
              ordinal: 0,
              input: { hash: "a".repeat(64), width: 64, height: 80 },
              message: "Choose an integer scale.",
              report: null,
              scale: null,
              coloursMerged: null,
              pixelsChanged: null,
            },
          ],
        }),
        { type: "sheet", value: { candidateCount: 1 } },
      ),
    );
    expect(html).toContain("Choose an integer scale.");
    expect(html).not.toContain('class="state-label state-not reported"');
    expect(html).not.toContain(">not reported</span>");
  });

  test("succeeded un-conformed jobs offer Conform and the configured sets", () => {
    const html = render(
      stateFor(
        { id: "j-ready", status: "succeeded", candidate: null },
        { status: { conformSets: ["standard", "pixel-art"] } },
      ),
    );
    expect(html).toContain("Conform");
    expect(html).toContain("standard");
    expect(html).toContain("pixel-art");
  });

  test("succeeded un-conformed jobs explain when no conform set exists", () => {
    const html = render(
      stateFor({ id: "j-ready", status: "succeeded", candidate: null }),
    );
    expect(html).toContain("No conform set configured");
    expect(html).toContain("Conform");
  });

  test("read-only mode keeps Resolve and existing View sheet enabled", () => {
    const html = render(
      stateFor(undefined, {
        host: { state: "read-only", lockHolder: 913 },
        requests: [{ id: "r1", subject: "zeus" }],
        workingSets: [{ id: "w1", requestId: "r1", status: "open" }],
      }),
    );
    expect(html).toMatch(/<button type="submit">Resolve request<\/button>/);
    expect(html).toMatch(/<button type="button">View sheet<\/button>/);
  });

  test("asset rejection has a required inline reason and candidates have no Reject", () => {
    const html = render(
      stateFor(undefined, {
        assets: [
          {
            id: "asset-1",
            assetId: "zeus-idle",
            state: "draft",
            manifestRevision: "rev-8",
            report: { status: "pass", failedChecks: [] },
          },
        ],
        candidates: [
          {
            id: "c1",
            status: "done",
            requestId: "r1",
            slotKey: "idle/south",
            ordinal: 0,
            input: { hash: "a".repeat(64), width: 64, height: 80 },
            imageHash: "b".repeat(64),
            proposalHash: "c".repeat(64),
            report: { status: "pass", failedChecks: [] },
            scale: 1,
            coloursMerged: 0,
            pixelsChanged: 0,
          },
        ],
      }),
    );
    expect(html).toContain("Rejection reason");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Reject<\/button>/);
    expect(html).not.toContain("Reject candidate");
    expect(html).not.toContain("window.prompt");
  });

  test("pack starts with an empty style tag and stays disabled", () => {
    const html = render(
      stateFor(undefined, {
        workingSets: [{ id: "w1", requestId: "r1", status: "open" }],
      }),
    );
    expect(html).not.toContain("greek-master");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Pack draft<\/button>/);
  });

  test("a loaded sheet shows pixel-cell loading and a compact sheet summary", () => {
    const loaded = workflowReducer(
      stateFor(undefined, {
        requests: [{ id: "r1", subject: "zeus" }],
        workingSets: [{ id: "w1", requestId: "r1", status: "open" }],
        candidates: [
          {
            id: "c1",
            status: "done",
            requestId: "r1",
            slotKey: "idle/south",
            ordinal: 0,
            input: { hash: "a".repeat(64), width: 64, height: 80 },
            imageHash: "b".repeat(64),
            proposalHash: "c".repeat(64),
            report: { status: "pass", failedChecks: [] },
            scale: 1,
            coloursMerged: 0,
            pixelsChanged: 1,
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

  test("an unconfigured snapshot offers config setup without opening an edit", () => {
    const state = workflowReducer(initialWorkflowState(), {
      type: "snapshot",
      snapshot: {
        host: { state: "not-configured" },
        assets: [
          {
            id: "a1",
            assetId: "zeus-idle",
            state: "draft",
            workingSetId: "w1",
          },
        ],
        edits: [{ id: "e1", status: "open", workingSetId: "w1" }],
      },
    });
    const html = render(state);
    expect(html).toContain("Choose config file");
    expect(html).not.toContain("Edit draft");
    expect(html).not.toContain("Export sheets");
  });
});

function labelFor(status: string) {
  return status[0]?.toUpperCase() + status.slice(1);
}

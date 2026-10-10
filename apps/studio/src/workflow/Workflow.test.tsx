import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { fakeTransport } from "../host/_testkit";
import { createStudioHost } from "../host/client";
import { approvalArgsForAsset } from "./actions";
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

describe("the preview selection", () => {
  const draft = (id: string, state: string) => ({
    id,
    assetId: "zeus-portrait",
    state,
    manifestRevision: `rev-${id}`,
  });

  function selectionFor(
    assets: Record<string, unknown>[],
    selected: string,
  ): unknown[] {
    const seen: unknown[] = [];
    const state = workflowReducer(stateFor(undefined, { assets }), {
      type: "select-asset",
      assetId: selected,
    });
    renderToStaticMarkup(
      createElement(WorkflowView, {
        state,
        host,
        renderPreview: (selection) => {
          seen.push(selection);
          return null;
        },
      }),
    );
    return seen;
  }

  test("two drafts of one asset: the preview is asked for the selected record's id", () => {
    const assets = [draft("draft-a", "draft"), draft("draft-b", "draft")];

    expect(selectionFor(assets, "draft-b")).toEqual([
      { source: "draft", id: "draft-b" },
    ]);
    expect(selectionFor(assets, "draft-a")).toEqual([
      { source: "draft", id: "draft-a" },
    ]);
  });

  test("an approved record is asked for by its record id too", () => {
    const assets = [draft("draft-a", "draft"), draft("approved-b", "approved")];

    expect(selectionFor(assets, "approved-b")).toEqual([
      { source: "approved", id: "approved-b" },
    ]);
  });

  test("switching portrait records requests the selected draft portrait", () => {
    const assets = [
      {
        ...draft("draft-face-a", "draft"),
        assetId: "zeus-face-a",
        workingSetId: "set-face-a",
        report: { status: "pass", failedChecks: [] },
      },
      {
        ...draft("draft-face-b", "draft"),
        assetId: "zeus-face-b",
        workingSetId: "set-face-b",
        report: { status: "pass", failedChecks: [] },
      },
    ];
    const seen: unknown[] = [];
    const state = workflowReducer(
      stateFor(undefined, {
        assets,
        workingSets: [
          { id: "set-face-a", kind: "portrait" },
          { id: "set-face-b", kind: "portrait" },
        ],
      }),
      { type: "select-asset", assetId: "draft-face-b" },
    );
    renderToStaticMarkup(
      createElement(WorkflowView, {
        state,
        host,
        renderPreview: (selection) => {
          seen.push(selection);
          return null;
        },
      }),
    );
    const selected = state.assets.find((asset) => asset.id === "draft-face-b");
    if (!selected) throw new Error("selected portrait record is missing");
    const approvalTarget = approvalArgsForAsset(selected);
    if (!approvalTarget)
      throw new Error("selected portrait has no approval revision");

    expect(seen).toEqual([
      { source: "draft", id: "draft-face-b", kind: "portrait" },
    ]);
    expect((seen[0] as { id: string }).id).toBe(approvalTarget.id);
    expect(approvalTarget.confirm).toBe("rev-draft-face-b");
  });

  test("a canon record is asked for by its asset id, the id canon is listed under", () => {
    const assets = [{ ...draft("draft-canon-rec", "canon") }];

    expect(selectionFor(assets, "draft-canon-rec")).toEqual([
      { source: "canon", id: "zeus-portrait" },
    ]);
  });
});

describe("Generate", () => {
  const resolved = workflowReducer(stateFor(), {
    type: "resolution",
    value: { request: { seed: 7 }, spec: { subject: "zeus" } },
  });

  test("is not offered as a live button while the form's resolved input is missing", () => {
    // A late or cleared resolve can leave a spec on screen with no input to
    // generate from; the button would then do nothing, silently.
    const html = render(resolved);

    expect(html).toContain("Resolved spec");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Generate<\/button>/);
  });
});

describe("WorkflowView controls", () => {
  test("field-to-card gaps use the workflow row rhythm", () => {
    const css = readFileSync(
      new URL("./workflow.css", import.meta.url),
      "utf8",
    );
    expect(css).toMatch(
      /\.working-set-select\s*\{[^}]*margin-bottom:\s*10px;/s,
    );
    expect(css).toMatch(/\.pack-form\s*\{[^}]*margin-top:\s*0;/s);
    expect(css).toMatch(/\.asset-select\s*\{[^}]*margin-bottom:\s*10px;/s);
    expect(css).toMatch(/\.scale-conform-form\s*\{[^}]*row-gap:\s*10px;/s);
  });

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
    const less = html.indexOf("candidate-less-change");
    const more = html.indexOf("candidate-more-change");
    expect(less).toBeGreaterThanOrEqual(0);
    expect(more).toBeGreaterThanOrEqual(0);
    expect(less).toBeLessThan(more);
    expect(html).toContain("palette-limit");
    // Each count sits in its own labelled cell, in the order of the cards.
    const counts = [
      ...html.matchAll(/<dt>Pixels changed<\/dt><dd>(\d+)<\/dd>/g),
    ].map((match) => match[1]);
    expect(counts).toEqual(["3", "14"]);
    expect(html).toContain("<dt>Scale</dt>");
    expect(html).toContain("<dt>Colours merged</dt>");
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
      stateFor(
        { id: "j-ready", status: "succeeded", candidate: null },
        { status: { conformSets: [] } },
      ),
    );
    expect(html).toContain(
      "Conform needs either a config set or explicit parameters.",
    );
    expect(html).toContain("Inline conform parameters");
    expect(html).toMatch(
      /<button type="submit" disabled="">Conform with params<\/button>/,
    );
    expect(html).not.toMatch(/<button[^>]*>Conform<\/button>/);
    expect(html).not.toContain("No conform set configured");
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

  test("sprite packing asks for a footprint and original-work details when hand-edited", () => {
    const html = render(
      stateFor(undefined, {
        workingSets: [
          {
            id: "w-sprite",
            kind: "sprite",
            authored: { "idle/south": { editId: "e1", frames: 4 } },
          },
        ],
      }),
    );
    expect(html).toContain("Footprint width");
    expect(html).toContain("Footprint height");
    expect(html).toContain("Original-work licence");
    expect(html).toContain("Author / method description");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Pack draft<\/button>/);
  });

  test("portrait packing omits the sprite footprint and original-work fields without hand edits", () => {
    const html = render(
      stateFor(undefined, {
        workingSets: [{ id: "w-portrait", kind: "portrait", authored: {} }],
      }),
    );
    expect(html).not.toContain("Footprint width");
    expect(html).not.toContain("Footprint height");
    expect(html).not.toContain("Original-work licence");
    expect(html).not.toContain("Author / method description");
  });

  test("changing configuration remains reachable while connected or unavailable", () => {
    for (const hostState of [
      { state: "running" as const },
      { state: "unavailable" as const, attempt: 3, maxAttempts: 3 },
    ]) {
      const state = workflowReducer(initialWorkflowState(), {
        type: "snapshot",
        snapshot: { host: hostState, status: { owner: null } },
      });
      const html = renderToStaticMarkup(
        createElement(WorkflowView, {
          state,
          host,
          onConfigChoose: () => {},
        }),
      );
      expect(html).toContain("Change config");
      if (hostState.state === "unavailable")
        expect(html).toMatch(/class="primary"[^>]*>Change config/);
    }
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

  test("workflow labels and controls share the same field classes", () => {
    const html = render(
      stateFor(
        { id: "j-ready", status: "succeeded", candidate: null },
        {
          status: { conformSets: ["u5-standard"] },
          workingSets: [{ id: "w1", status: "open" }],
          assets: [{ id: "a1", assetId: "zeus", state: "draft" }],
        },
      ),
    );
    const fields = html.match(/<(?:input|select|textarea)\b[^>]*>/g) ?? [];
    const labels = html.match(/<label\b[^>]*>/g) ?? [];

    expect(html).toContain("Conform set");
    expect(html).toContain("Working set");
    expect(html).toContain("Kind");
    expect(html).toContain("Background");
    expect(html).toContain("Rejection reason");
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      if (!field.includes('type="checkbox"')) {
        expect(field).toContain('class="workflow-control"');
      }
    }
    for (const label of labels) {
      expect(label).toContain("workflow-field");
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

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { callsTo, fakeTransport, hostError } from "../../test/host-kit";
import { createStudioHost } from "../host/client";
import {
  activeDeriveChoiceKey,
  approvalArgsForAsset,
  deriveChoices,
  deriveGuarded,
  packWorkingSetGuarded,
  pickCandidateGuarded,
} from "./actions";
import {
  initialWorkflowState,
  queueRowContext,
  reuseRowContext,
  workflowReducer,
} from "./model";
import { DerivePanel, QueueItem, WorkflowView } from "./Workflow";

const host = createStudioHost(fakeTransport());

/** Handlers that never change identity, as the window gives its rows. */
const rowHandlersForTest = (() => {
  const handlers = {
    onRemove: () => undefined,
    onAbort: () => undefined,
    onRetry: () => undefined,
    onConform: () => undefined,
  };
  return () => handlers;
})();

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

describe("a notice from outside the view", () => {
  test("a refused config choice is visible in the notice area", () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowView, {
        state: stateFor(),
        host,
        notice: "the config file is not JSON",
      }),
    );

    expect(html).toMatch(
      /<p class="notice" role="status">the config file is not JSON<\/p>/,
    );
  });
});

describe("a refused first config choice", () => {
  test("is visible on the setup screen, where no other notice shows", () => {
    const state = workflowReducer(initialWorkflowState(), {
      type: "snapshot",
      snapshot: { host: { state: "not-configured" } },
    });

    const html = renderToStaticMarkup(
      createElement(WorkflowView, {
        state,
        host,
        onConfigChoose: () => {},
        notice: "the config file is not JSON",
      }),
    );

    expect(html).toContain("Choose a studio config");
    expect(html).toContain("the config file is not JSON");
  });
});

describe("WorkflowView controls", () => {
  test("the candidate sheet shows rendered job details and a frame-strip tile", () => {
    const candidate = {
      id: "zeus-retro-idle-0000",
      status: "done",
      rendered: true,
      requestId: "r1",
      slotKey: "idle/south",
      frameCount: 16,
      revisionRecipeHash: "a".repeat(64),
      slotRecipeHash: "b".repeat(64),
    };
    const state = workflowReducer(
      stateFor(undefined, {
        requests: [{ id: "r1", subject: "zeus" }],
        candidates: [candidate],
      }),
      { type: "sheet", value: { workingSetId: "set-r1", candidateCount: 1 } },
    );

    const html = render(state);

    expect(html).toContain("zeus-retro-idle-0000");
    expect(html).toContain("16 frames");
    expect(html).toContain("recipe");
    expect(html).toContain("Frame strip");
    expect(html).toContain("Pick</button>");
  });

  test("Pick sends a rendered candidate id and slot through the existing rendered pick path", async () => {
    const transport = fakeTransport({ studio_call: () => ({ ok: true }) });
    const renderedHost = createStudioHost(transport);
    const ui = {
      allowed: () => true,
      setBusy: () => undefined,
      setMessage: () => undefined,
      setRefusalDetails: () => undefined,
    };

    await pickCandidateGuarded(renderedHost, ui, "set-r1", {
      id: "zeus-retro-idle-0000",
      rendered: true,
      slotKey: "idle/south",
    });

    expect(transport.to("studio_call").map((call) => call.args)).toEqual([
      {
        op: "pick",
        args: {
          workingSetId: "set-r1",
          candidateId: "zeus-retro-idle-0000",
          slot: "idle/south",
        },
      },
    ]);
  });

  test("record options include unique record ids and put the newest draft first", () => {
    const html = render(
      stateFor(undefined, {
        assets: [
          {
            id: "record-zeus-sprite-1",
            assetId: "zeus-sprite",
            state: "draft",
          },
          { id: "zeus-sprite", assetId: "zeus-sprite", state: "canon" },
          {
            id: "record-zeus-sprite-2",
            assetId: "zeus-sprite",
            state: "draft",
          },
        ],
      }),
    );

    expect(html).toContain("zeus-sprite · draft · record-zeus-sprite-1");
    expect(html).toContain("zeus-sprite · draft · record-zeus-sprite-2");
    expect(html.indexOf("record-zeus-sprite-2")).toBeLessThan(
      html.indexOf("record-zeus-sprite-1"),
    );
    expect(html).toContain("zeus-sprite · canon · zeus-sprite");
  });

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

  test("keeps the isometric preview above selected-record details", () => {
    const html = render(
      stateFor(undefined, {
        assets: [
          {
            id: "draft-a",
            assetId: "zeus-sprite",
            state: "draft",
            manifestRevision: "rev-draft-a",
          },
        ],
      }),
    );
    const preview = html.indexOf("Isometric preview");
    const record = html.indexOf('class="asset-select workflow-field"');

    expect(preview).toBeGreaterThanOrEqual(0);
    expect(record).toBeGreaterThan(preview);
  });

  test("keeps preview controls below the full-width canvas without overlaying it", () => {
    const css = readFileSync(
      new URL("./workflow.css", import.meta.url),
      "utf8",
    );
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

    expect(css).toMatch(/\.preview-controls\s*\{[^}]*position:\s*static;/s);
    expect(css).toMatch(
      /\.preview-controls-title\s*\{[^}]*color:\s*var\(--ink-soft\);/s,
    );
    expect(css).toMatch(/\.preview-compact #preview\s*\{[^}]*order:\s*-1;/s);
    expect(css).toMatch(
      /\.preview-compact #preview\s*\{[^}]*justify-content:\s*safe center;/s,
    );
    expect(css).toMatch(
      /\.preview-compact #preview\s*\{[^}]*overflow:\s*auto;/s,
    );
    expect(css).not.toMatch(
      /\.preview-compact #preview canvas\s*\{[^}]*max-width:\s*100%/s,
    );
    expect(css).toMatch(
      /\.preview-compact #preview canvas\s*\{[^}]*flex:\s*0 0 auto;/s,
    );
    expect(css).toMatch(
      /\.workflow-grid > \.asset-column\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/s,
    );
    expect(css).toContain(".preview-compact > section:not(.preview-controls)");
    expect(app).toMatch(
      /<section\s+className="preview-controls"\s+aria-label="Preview controls">/,
    );
    expect(app).not.toContain('display: "inline-block"');
    expect(app).toContain(
      '<span className="preview-controls-title">Preview controls</span>',
    );
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

  test("the render recipe is offered only for a subject the host says has a render profile", () => {
    const offered = render(
      stateFor(undefined, { status: { renderSubjects: ["zeus"] } }),
    );
    expect(offered).toContain("Render recipe");
    // Control: the same form with no render subject, or another subject's, offers it nowhere.
    expect(
      render(stateFor(undefined, { status: { renderSubjects: [] } })),
    ).not.toContain("Render recipe");
    expect(
      render(stateFor(undefined, { status: { renderSubjects: ["hera"] } })),
    ).not.toContain("Render recipe");
    expect(
      render(stateFor(undefined, { status: { conformSets: [] } })),
    ).not.toContain("Render recipe");
    // The image request's own fields are still there until the recipe is chosen.
    expect(offered).toContain("Base seed");
    expect(offered).toContain("Batch");
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
    expect(html).toContain("Pack requires a complete working set.");
    expect(html).not.toContain(
      "Only selected frames in an open working set can be packed.",
    );
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
    expect(html).toMatch(/Footprint width \(tiles\)[\s\S]*?max="8"/);
    expect(html).toMatch(/Footprint height \(tiles\)[\s\S]*?max="8"/);
    expect(html).toContain("Original-work licence");
    expect(html).toContain("Author / method description");
    expect(html).not.toContain("Still-frame time (ms)");
    expect(html).toMatch(
      /Author \/ method description <span class="field-hint">optional<\/span>/,
    );
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

  test("a picked portrait working set exposes its still-frame time field", () => {
    const html = render(
      stateFor(undefined, {
        workingSets: [
          {
            id: "faces",
            kind: "portrait",
            required: ["neutral", "angry"],
            picks: {
              neutral: { candidateId: "neutral-candidate" },
              angry: { candidateId: "angry-candidate" },
            },
            authored: {},
          },
        ],
      }),
    );

    expect(html).toContain("Still-frame time (ms)");
    expect(html).toContain('type="number"');
    expect(html).toContain('min="1"');
  });

  test("a selected working set without a packed draft exposes Open editor", () => {
    const html = render(
      stateFor(undefined, {
        workingSets: [
          {
            id: "fresh-sprite",
            kind: "sprite",
            required: ["idle/south"],
            picks: {
              "idle/south": { candidateId: "idle-candidate" },
            },
            authored: {},
          },
        ],
        assets: [],
      }),
    );

    expect(html).toContain("Open editor");
    expect(html).toContain("fresh-sprite");
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

  describe("the writer lock", () => {
    const withLock = (
      host: Record<string, unknown>,
      status: Record<string, unknown>,
      extra: Record<string, unknown> = {},
    ) => stateFor(undefined, { host, status, ...extra });
    const RELEASE_ENABLED = /<button(?![^>]*disabled)[^>]*>Release<\/button>/;
    const RELEASE_DISABLED = /<button[^>]*disabled[^>]*>Release<\/button>/;

    test("the header says whether this app holds the lock, nobody does, or pid N does", () => {
      expect(
        render(withLock({ state: "running", lock: "held" }, { idle: true })),
      ).toContain("Held by this app");
      expect(
        render(withLock({ state: "running", lock: "free" }, { idle: true })),
      ).toContain("Free");
      const other = render(
        withLock({ state: "read-only", lockHolder: 913, lock: "other" }, {}),
      );
      expect(other).toContain("Held by pid 913");
      expect(other).toContain("Read-only");
    });

    test("the Release button is enabled when the app holds the lock and is idle", () => {
      expect(
        render(withLock({ state: "running", lock: "held" }, { idle: true })),
      ).toMatch(RELEASE_ENABLED);
    });

    test("it is disabled when the app is not idle, and says why", () => {
      const html = render(
        withLock(
          { state: "running", lock: "held" },
          { idle: false, idleReason: "a job is queued or running" },
        ),
      );

      expect(html).toMatch(RELEASE_DISABLED);
      expect(html).toContain("a job is queued or running");
    });

    test("it is disabled when there is no lock of this app's to release", () => {
      for (const host of [
        { state: "running", lock: "free" },
        { state: "read-only", lockHolder: 913, lock: "other" },
        { state: "restarting", attempt: 1, maxAttempts: 3 },
      ])
        expect(render(withLock(host, { idle: true })), host.state).toMatch(
          RELEASE_DISABLED,
        );
    });

    test("a free lock does not make the window read-only: writes stay enabled", () => {
      const html = render(
        withLock(
          { state: "running", lock: "free" },
          { idle: true },
          {
            requests: [{ id: "r1", subject: "zeus" }],
            workingSets: [{ id: "w1", requestId: "r1", status: "open" }],
          },
        ),
      );

      expect(html).not.toContain("read-only");
      expect(html).not.toContain("Locked by another studio session");
    });

    test("a write refused as root-locked keeps the resolved request on screen and offers Retry", () => {
      const resolved = workflowReducer(
        withLock({ state: "running", lock: "free" }, { idle: true }),
        { type: "resolution", value: { spec: { subject: "zeus" } } },
      );
      const refused = workflowReducer(resolved, {
        type: "write-locked",
        op: "generate",
        args: { id: "zeus-1" },
      });

      const html = render(refused);

      expect(html).toContain("Resolved spec");
      expect(html).toContain("another process holds the writer lock");
      expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Retry<\/button>/);
      expect(render(resolved)).not.toContain("another process holds");
      expect(
        render(workflowReducer(refused, { type: "write-unlocked" })),
      ).not.toContain("another process holds");
    });
  });

  describe("the request form", () => {
    test("Generate has a base seed field that says empty draws one", () => {
      const html = render(stateFor());

      expect(html).toContain("Base seed");
      expect(html).toMatch(/<input[^>]*inputMode="numeric"[^>]*>/);
      expect(html).toContain("empty draws one");
    });

    test("the slot hint shows examples, including an act with its ability", () => {
      const html = render(stateFor());

      expect(html).toContain("state/direction[/ability]");
      expect(html).toContain("act/south/thunderbolt");
      expect(html).toContain("act needs an ability");
    });
  });

  describe("the queue", () => {
    // React skips a memoized row whose props are all `Object.is`-equal. There
    // is no DOM here to count renders in, so this drives the real reducer
    // through two parent renders that change things the row does not show and
    // checks every prop a row is given is the same value both times.
    test("a row is given the same props across two parent renders that change nothing it shows", () => {
      const jobs = Array.from({ length: 72 }, (_, i) => ({
        id: `j${i}`,
        requestId: "r1",
        slotKey: `idle/${i}`,
        status: "queued",
        candidate: null,
      }));
      const snapshot = (extra: Record<string, unknown>) => ({
        host: { state: "running", lock: "held" },
        status: { idle: false },
        requests: [],
        jobs: jobs as never,
        candidates: [],
        edits: [],
        workingSets: [],
        assets: [],
        ...extra,
      });
      const first = workflowReducer(initialWorkflowState(), {
        type: "snapshot",
        snapshot: snapshot({}) as never,
      });
      // A poll brings the same jobs as new objects, and other panels' records change.
      const second = workflowReducer(first, {
        type: "snapshot",
        snapshot: snapshot({
          jobs: jobs.map((job) => ({ ...job })),
          assets: [{ id: "a1" }],
          requests: [{ id: "r1" }],
        }) as never,
      });
      const handlers = rowHandlersForTest();
      const props = (
        state: typeof first,
        job: (typeof first.jobs)[number],
      ) => ({
        job,
        ctx: reuseRowContext(rowContextRef.current, queueRowContext(state)),
        busy: false,
        ...handlers,
        conformSet: "",
        candidate: undefined,
        conformBusy: false,
      });
      const rowContextRef = { current: queueRowContext(first) };

      const before = props(first, first.jobs[5] as never);
      rowContextRef.current = before.ctx;
      const after = props(second, second.jobs[5] as never);

      for (const key of Object.keys(before) as (keyof typeof before)[])
        expect(Object.is(before[key], after[key]), key).toBe(true);
      // Every row, not just one.
      for (const [index, job] of second.jobs.entries())
        expect(job).toBe(first.jobs[index] as never);
      // And a change to the row's own job does give it new props.
      const changed = workflowReducer(second, {
        type: "snapshot",
        snapshot: snapshot({
          jobs: jobs.map((job, i) =>
            i === 5 ? { ...job, status: "running" } : { ...job },
          ),
        }) as never,
      });
      expect(changed.jobs[5]).not.toBe(second.jobs[5] as never);
      expect(changed.jobs[6]).toBe(second.jobs[6] as never);
    });

    test("a row is a memoized component", () => {
      expect((QueueItem as unknown as { $$typeof: symbol }).$$typeof).toBe(
        Symbol.for("react.memo"),
      );
    });

    test("72 jobs render as 72 rows", () => {
      const jobs = Array.from({ length: 72 }, (_, i) => ({
        id: `j${i}`,
        requestId: "r1",
        slotKey: `idle/${i}`,
        status: i % 2 === 0 ? "queued" : "succeeded",
        candidate: i % 4 === 1 ? null : { id: `c${i}` },
      }));
      const state = workflowReducer(initialWorkflowState(), {
        type: "snapshot",
        snapshot: {
          host: { state: "running", lock: "held" },
          status: { idle: false, conformSets: ["standard"] },
          requests: [],
          jobs: jobs as never,
          candidates: [{ id: "c3", status: "done" }],
          edits: [],
          workingSets: [],
          assets: [],
        },
      });

      const html = render(state);

      expect(html.match(/class="queue-row /g)).toHaveLength(72);
      expect(html).toContain("72 jobs");
    });
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

describe("a selected record that has not reached the snapshot", () => {
  const draft = (n: number) => ({
    id: `record-zeus-sprite-${n}`,
    assetId: "zeus-sprite",
    state: "draft",
    kind: "sprite",
    workingSetId: "w",
    manifestRevision: `rev-${n}`,
    report: { status: "pass", failedChecks: [] },
  });
  const LIFECYCLE = [
    "Edit draft",
    "Approve",
    "Approve with exception",
    "Reject",
    "Publish this revision",
  ];

  function view(state: ReturnType<typeof stateFor>) {
    const previews: unknown[] = [];
    const html = renderToStaticMarkup(
      createElement(WorkflowView, {
        state,
        host,
        renderPreview: (selection) => {
          previews.push(selection);
          return null;
        },
      }),
    );
    return { html, previews };
  }
  const buttonLabel = (html: string, label: string) =>
    [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].filter(
      (m) => m[2] === label,
    );

  test("the panel waits, previews nothing, and no lifecycle action is live", () => {
    const state = workflowReducer(stateFor(undefined, { assets: [draft(1)] }), {
      type: "select-asset",
      assetId: "record-zeus-sprite-2",
    });

    const { html, previews } = view(state);

    expect(html).toContain("Waiting for record-zeus-sprite-2");
    expect(previews).toEqual([]);
    expect(html).not.toContain("rev-1");
    expect(html).not.toContain("Record record-zeus-sprite-1 · revision");
    for (const label of LIFECYCLE) {
      const found = buttonLabel(html, label);
      expect(found.length).toBeGreaterThan(0);
      expect(found.every((m) => /\bdisabled\b/.test(m[1] ?? ""))).toBe(true);
    }
  });

  test("a pack that succeeds before the next poll leaves the old draft untouched, then the snapshot makes the new one live", async () => {
    let state = stateFor(undefined, { assets: [draft(1)] });
    const transport = fakeTransport({
      studio_call: () => ({ id: "record-zeus-sprite-2", state: "draft" }),
    });
    const noop = {
      allowed: () => true,
      setBusy: () => undefined,
      setMessage: () => undefined,
      setRefusalDetails: () => undefined,
    };

    await packWorkingSetGuarded(
      createStudioHost(transport),
      noop,
      {
        id: "record-zeus-sprite-2",
        workingSetId: "w",
        assetId: "zeus-sprite",
        styleTag: "t",
      },
      (recordId) => {
        state = workflowReducer(state, {
          type: "select-asset",
          assetId: recordId,
        });
      },
    );
    const before = view(state);

    expect(before.html).toContain("Waiting for record-zeus-sprite-2");
    expect(before.previews).toEqual([]);

    state = workflowReducer(state, {
      type: "snapshot",
      snapshot: {
        host: { state: "running" },
        status: { owner: null },
        requests: [],
        jobs: [],
        candidates: [],
        edits: [],
        workingSets: [],
        assets: [draft(1), draft(2)] as never,
      },
    });
    const after = view(state);

    expect(after.previews).toEqual([
      { source: "draft", id: "record-zeus-sprite-2", kind: "sprite" },
    ]);
    expect(after.html).toContain("Record record-zeus-sprite-2 · revision");
    expect(after.html).not.toContain("Waiting for");
    expect(
      buttonLabel(after.html, "Approve").every(
        (m) => !/\bdisabled\b/.test(m[1] ?? ""),
      ),
    ).toBe(true);
  });

  test("a record that was selected and then leaves the snapshot waits too, instead of showing another", () => {
    const state = workflowReducer(stateFor(undefined, { assets: [draft(2)] }), {
      type: "select-asset",
      assetId: "record-zeus-sprite-1",
    });

    const { html, previews } = view(state);

    expect(html).toContain("Waiting for record-zeus-sprite-1");
    expect(previews).toEqual([]);
  });
});

describe("deriving from a published sprite", () => {
  const published = (over: Record<string, unknown> = {}) => ({
    id: "record-zeus-sprite-1",
    assetId: "zeus-sprite",
    state: "canon",
    kind: "sprite",
    method: "generated",
    paletteFamily: "olympus",
    realms: [],
    slots: ["idle/east", "seated/east", "walk/east", "act/east/thunderbolt"],
    manifestRevision: "rev-1",
    ...over,
  });
  const asRecord = (record: Record<string, unknown>) =>
    record as unknown as Parameters<typeof deriveChoices>[0];

  test("a mirror is offered for the east slots that can be flipped and a bob only for idle, never for walk or act", () => {
    const labels = deriveChoices(asRecord(published())).map((c) => c.label);

    expect(labels).toContain("Mirror idle/east to idle/west");
    expect(labels).toContain("Mirror seated/east to seated/west");
    expect(labels.some((l) => l.startsWith("Bob idle/east"))).toBe(true);
    expect(
      labels.filter((l) => l.includes("walk") || l.includes("act")),
    ).toEqual([]);
    expect(labels.filter((l) => l.startsWith("Bob"))).toHaveLength(1);
  });

  test("a palette swap is offered to each realm family except the asset's own", () => {
    const choices = deriveChoices(asRecord(published()));
    const swaps = choices.filter((c) => c.args.op === "palette-swap");

    expect(swaps.map((c) => c.args.to)).toEqual(["town", "underworld"]);
    expect(swaps[0]?.args).toEqual({
      asset: "zeus-sprite",
      op: "palette-swap",
      from: "olympus",
      to: "town",
    });
  });

  test("a mirror is not offered where the west already exists", () => {
    const choices = deriveChoices(
      asRecord(published({ slots: ["idle/east", "idle/west"] })),
    );

    expect(choices.some((c) => c.args.op === "mirror")).toBe(false);
  });

  test("changing records resets an old derivation to a valid choice", () => {
    const hera = deriveChoices(
      asRecord(
        published({
          id: "hera-published",
          assetId: "hera-sprite",
          slots: ["idle/east"],
          paletteFamily: undefined,
        }),
      ),
    );
    const zeus = deriveChoices(
      asRecord(
        published({
          id: "zeus-published",
          assetId: "zeus-sprite",
          slots: ["idle/south"],
        }),
      ),
    );

    expect(hera.map((choice) => choice.key)).toContain("mirror:idle/east");
    expect(
      activeDeriveChoiceKey(
        zeus,
        { recordId: "hera-published", key: "mirror:idle/east" },
        "zeus-published",
      ),
    ).toBe(zeus[0]?.key);
  });

  test("nothing is offered for a draft, an approved record or a portrait", () => {
    for (const over of [
      { state: "draft" },
      { state: "approved" },
      { kind: "portrait" },
    ])
      expect(deriveChoices(asRecord(published(over)))).toEqual([]);
  });

  test("the published sprite shows a Derive panel with plain wording, and a draft does not", () => {
    const html = (state: string) =>
      renderToStaticMarkup(
        createElement(WorkflowView, {
          state: workflowReducer(
            stateFor(undefined, { assets: [published({ state })] }),
            { type: "select-asset", assetId: "record-zeus-sprite-1" },
          ),
          host,
        }),
      );

    expect(html("canon")).toContain("Derive from this revision");
    expect(html("canon")).toContain("Mirror idle/east to idle/west");
    expect(html("draft")).not.toContain("Derive from this revision");
  });

  test("shows a Derive refusal beside its control, not in the page notice strip", () => {
    const choices = deriveChoices(asRecord(published()));
    const html = renderToStaticMarkup(
      createElement(DerivePanel, {
        choices,
        selectedKey: choices[0]?.key ?? "",
        busy: false,
        result:
          'the subject declares an asymmetry ("bolt hand"), so west is drawn, not mirrored',
        resultDetails: "mirror refused",
        onChoiceChange: () => {},
        onDerive: () => {},
      }),
    );

    expect(html).toContain('class="derive-result" role="status"');
    expect(html).toContain("bolt hand");
    expect(html).toContain("mirror refused");
    expect(html).toContain("Derive</button>");
  });

  const derived = (
    over: Record<string, unknown> = {},
    provenanceSteps: readonly Record<string, unknown>[] = [],
  ) =>
    published({
      id: "record-zeus-sprite-2",
      state: "draft",
      method: "derived",
      provenanceSteps,
      ...over,
    });

  test("compares the newly mirrored slot, not a carried east/west pair", () => {
    const seen: unknown[] = [];
    const source = published({
      slots: ["idle/east", "idle/west", "seated/east"],
    });
    const draft = derived(
      {
        slots: ["idle/east", "idle/west", "seated/east", "seated/west"],
      },
      [
        {
          recipe: "mirror",
          source: {
            assetId: "zeus-sprite",
            revision: "rev-1",
            slotKey: "seated/east",
          },
          outputSlot: "seated/west",
        },
        {
          recipe: "bob",
          source: { assetId: "zeus-sprite", slotKey: "idle/south" },
          outputSlot: "idle/south",
        },
      ],
    );
    const html = renderToStaticMarkup(
      createElement(WorkflowView, {
        state: workflowReducer(
          stateFor(undefined, { assets: [source, draft] }),
          { type: "select-asset", assetId: draft.id },
        ),
        host,
        renderPreview: (selection) => {
          seen.push(selection);
          return null;
        },
      }),
    );

    expect(html).toContain("Source: published zeus-sprite");
    expect(html).toContain("Derived: this draft");
    expect(html).toContain("seated: east → west");
    expect(seen).toEqual([
      {
        source: "canon",
        id: "zeus-sprite",
        kind: "sprite",
        state: "seated",
        direction: "east",
      },
      {
        source: "draft",
        id: "record-zeus-sprite-2",
        kind: "sprite",
        state: "seated",
        direction: "west",
      },
    ]);
  });

  test("compares a bob from and to the same slot", () => {
    const seen: unknown[] = [];
    const source = published({ slots: ["idle/south"] });
    const draft = derived({ slots: ["idle/south"] }, [
      {
        recipe: "bob",
        source: { assetId: "zeus-sprite", slotKey: "idle/south" },
        outputSlot: "idle/south",
      },
    ]);
    renderToStaticMarkup(
      createElement(WorkflowView, {
        state: workflowReducer(
          stateFor(undefined, { assets: [source, draft] }),
          { type: "select-asset", assetId: draft.id },
        ),
        host,
        renderPreview: (selection) => {
          seen.push(selection);
          return null;
        },
      }),
    );

    expect(seen).toEqual([
      {
        source: "canon",
        id: "zeus-sprite",
        kind: "sprite",
        state: "idle",
        direction: "south",
      },
      {
        source: "draft",
        id: "record-zeus-sprite-2",
        kind: "sprite",
        state: "idle",
        direction: "south",
      },
    ]);
  });

  test("compares a palette swap from its source slot to its variant realm", () => {
    const seen: unknown[] = [];
    const source = published({ slots: ["idle/east"] });
    const draft = derived({ slots: ["idle/east"], realms: ["underworld"] }, [
      {
        recipe: "palette-swap",
        source: { assetId: "zeus-sprite", slotKey: "idle/east" },
        outputSlot: "idle/east",
        targetFamily: "underworld",
      },
    ]);
    const html = renderToStaticMarkup(
      createElement(WorkflowView, {
        state: workflowReducer(
          stateFor(undefined, { assets: [source, draft] }),
          { type: "select-asset", assetId: draft.id },
        ),
        host,
        renderPreview: (selection) => {
          seen.push(selection);
          return null;
        },
      }),
    );

    expect(html).toContain("idle/east → underworld");
    expect(seen).toEqual([
      {
        source: "canon",
        id: "zeus-sprite",
        kind: "sprite",
        state: "idle",
        direction: "east",
      },
      {
        source: "draft",
        id: "record-zeus-sprite-2",
        kind: "sprite",
        state: "idle",
        direction: "east",
        realm: "underworld",
      },
    ]);
  });

  test("does not show a comparison when a derived draft has no steps", () => {
    const seen: unknown[] = [];
    const source = published();
    const draft = derived();
    const html = renderToStaticMarkup(
      createElement(WorkflowView, {
        state: workflowReducer(
          stateFor(undefined, { assets: [source, draft] }),
          { type: "select-asset", assetId: draft.id },
        ),
        host,
        renderPreview: (selection) => {
          seen.push(selection);
          return null;
        },
      }),
    );

    expect(html).not.toContain("derive-compare");
    expect(seen).toEqual([
      { source: "draft", id: "record-zeus-sprite-2", kind: "sprite" },
    ]);
  });

  const noop = (messages: string[]) => ({
    allowed: () => true,
    setBusy: () => undefined,
    setMessage: (message: string) => {
      messages.push(message);
    },
    setRefusalDetails: () => undefined,
  });

  test("Derive sends the choice's arguments exactly and reports the working set it made", async () => {
    const transport = fakeTransport({
      studio_call: callsTo({
        derive: () => ({
          workingSetId: "derive-0123456789ab",
          created: true,
          slots: ["idle/west"],
        }),
      }),
    });
    const messages: string[] = [];
    const made: string[] = [];

    await deriveGuarded(
      createStudioHost(transport),
      noop(messages),
      { asset: "zeus-sprite", op: "mirror", from: "idle/east" },
      (reply) => made.push(reply.workingSetId),
    );

    expect(transport.to("studio_call").map((call) => call.args)).toEqual([
      {
        op: "derive",
        args: { asset: "zeus-sprite", op: "mirror", from: "idle/east" },
      },
    ]);
    expect(made).toEqual(["derive-0123456789ab"]);
    expect(messages.at(-1)).toContain("Derived idle/west into working set");
  });

  test("a refusal is shown by its message and selects nothing", async () => {
    const transport = fakeTransport({
      studio_call: () => {
        throw hostError(
          "asymmetric",
          'the subject declares an asymmetry ("bolt hand"), so west is drawn, not mirrored',
        );
      },
    });
    const messages: string[] = [];
    const made: string[] = [];

    await deriveGuarded(
      createStudioHost(transport),
      noop(messages),
      { asset: "zeus-sprite", op: "mirror", from: "idle/east" },
      (reply) => made.push(reply.workingSetId),
    );

    expect(made).toEqual([]);
    expect(messages.at(-1)).toContain("bolt hand");
  });

  test("deriving again says so and still points at the same working set", async () => {
    const transport = fakeTransport({
      studio_call: callsTo({
        derive: () => ({
          workingSetId: "derive-0123456789ab",
          created: false,
          slots: ["idle/west"],
        }),
      }),
    });
    const messages: string[] = [];

    await deriveGuarded(createStudioHost(transport), noop(messages), {
      asset: "zeus-sprite",
      op: "mirror",
      from: "idle/east",
    });

    expect(messages.at(-1)).toContain("already holds this derivation");
  });
});

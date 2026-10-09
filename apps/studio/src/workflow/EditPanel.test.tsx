import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fakeTransport } from "../host/_testkit";
import { createStudioHost } from "../host/client";
import type { EditReport } from "../host/types";
import { EditPanel } from "./EditPanel";

const host = createStudioHost(fakeTransport());
const report: EditReport = {
  editId: "edit-1",
  workingSetId: "set-1",
  state: "open",
  sheetHash: "a".repeat(64),
  metadataHash: "b".repeat(64),
  slots: [
    {
      slot: "idle/south",
      diffAgainst: "recorded",
      addedFrames: [],
      removedFrames: [],
      frames: [
        {
          index: 0,
          report: "fail",
          failedChecks: ["palette-limit"],
          change: "changed",
          pixelsChanged: 4,
          diff: [
            { x: 4, y: 8, before: "#ab4c1d00", after: "#bc602800" },
            { x: 5, y: 8, before: "#ab4c1d00", after: "#bc602800" },
            { x: 6, y: 8, before: "#ab4c1d00", after: "#bc602800" },
            { x: 7, y: 8, before: "#ab4c1d00", after: "#bc602800" },
          ],
        },
      ],
    },
  ],
};

describe("EditPanel", () => {
  test("shows report-only findings and the pixel diff without an apply action", () => {
    const html = renderToStaticMarkup(
      createElement(EditPanel, {
        host,
        edit: { id: "edit-1", status: "open", slots: ["idle/south"] },
        report,
        editorLaunched: true,
        canMutate: true,
      }),
    );
    expect(html).toContain("Report only");
    expect(html).toContain("palette-limit");
    expect(html).toContain("4 pixels changed");
    expect(html).toContain("recorded version");
    expect(html).toContain("x: 4, y: 8");
    expect(html).not.toContain("Apply conformance");
  });

  test("finish and discard stay disabled until pixels are explicitly confirmed", () => {
    const html = renderToStaticMarkup(
      createElement(EditPanel, {
        host,
        edit: { id: "edit-1", status: "open", slots: ["idle/south"] },
        report,
        editorLaunched: true,
        canMutate: true,
      }),
    );
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Finish and keep<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Discard edit<\/button>/);
    expect(html).toContain("I reviewed this pixel diff");
  });

  test("missing editor exposes export and import instead of an editor claim", () => {
    const html = renderToStaticMarkup(
      createElement(EditPanel, {
        host,
        edit: { id: "edit-1", status: "open", slots: ["idle/south"] },
        editorLaunched: false,
        editorReason: "editor-unavailable",
        canMutate: true,
      }),
    );
    expect(html).toContain("Editor unavailable");
    expect(html).toContain("Export sheets");
    expect(html).toContain("Import edited sheets");
    expect(html).toMatch(
      /<button type="button" disabled="">Import edited sheets<\/button>/,
    );
  });

  test("added and removed frames are named separately from pixel diffs", () => {
    const slot = report.slots[0];
    if (!slot) throw new Error("Edit report fixture needs one slot.");
    const html = renderToStaticMarkup(
      createElement(EditPanel, {
        host,
        edit: { id: "edit-1", status: "open", slots: ["idle/south"] },
        report: {
          ...report,
          slots: [
            {
              ...slot,
              addedFrames: [2],
              removedFrames: [1],
              frames: [
                {
                  index: 0,
                  report: "pass",
                  failedChecks: [],
                  change: "unavailable",
                  pixelsChanged: null,
                  diff: null,
                },
              ],
            },
          ],
        },
        editorLaunched: true,
        canMutate: true,
      }),
    );
    expect(html).toContain("Frame 3 added");
    expect(html).toContain("Frame 2 removed");
    expect(html).toContain("Pixel change: unavailable");
  });
});

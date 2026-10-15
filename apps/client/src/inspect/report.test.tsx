import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CheckReport, describeShown } from "./report";

test("the report lists every check as PASS or FAIL with its detail, and the totals", () => {
  const html = renderToStaticMarkup(
    <CheckReport
      results={[
        {
          id: "a",
          label: "atlas hash",
          ok: true,
          detail: "0fe8, expected 0fe8",
        },
        {
          id: "b",
          label: "pixels at 2x canvas",
          ok: false,
          detail: "fnv1a32:1, expected fnv1a32:2",
        },
      ]}
    />,
  );

  expect(html).toContain("PASS");
  expect(html).toContain("FAIL");
  expect(html).toContain("atlas hash");
  expect(html).toContain("fnv1a32:1, expected fnv1a32:2");
  expect(html).toContain("1 passed, 1 failed");
  expect(html).toContain('data-status="fail"');
});

test("an all-pass report says so, and an empty one is not a pass", () => {
  const pass = renderToStaticMarkup(
    <CheckReport results={[{ id: "a", label: "x", ok: true, detail: "" }]} />,
  );
  const empty = renderToStaticMarkup(<CheckReport results={[]} />);

  expect(pass).toContain('data-status="pass"');
  expect(empty).toContain('data-status="none"');
  expect(empty).not.toContain("PASS");
});

test("a placeholder selection is labelled as one, with the reason", () => {
  expect(
    describeShown({
      selection: {
        assetId: "zeus-sprite",
        kind: "sprite",
        state: "seated",
        direction: "south",
      },
      resolution: {
        source: "placeholder",
        reason: "missing-state",
        pixels: { width: 16, height: 16, rgba: new Uint8Array(1024) },
      },
      placements: [],
      page: 0,
      pages: 1,
    }),
  ).toBe(
    "PLACEHOLDER (missing-state): zeus-sprite seated/south is not published; the shared placeholder is drawn",
  );
});

test("a canon selection shows its atlas and frame count", () => {
  const text = describeShown({
    selection: {
      assetId: "zeus-sprite",
      kind: "sprite",
      state: "idle",
      direction: "south",
    },
    resolution: {
      source: "canon",
      kind: "sprite",
      assetId: "zeus-sprite" as never,
      revision: "r".repeat(64) as never,
      uri: "panthea-asset://asset/zeus-sprite",
      atlas: { blob: "b".repeat(64) as never, width: 256, height: 80 },
      cell: { w: 64, h: 80 },
      frames: [{}, {}, {}, {}] as never,
    },
    placements: [],
    page: 0,
    pages: 1,
  });

  expect(text).toBe(
    `CANON: zeus-sprite idle/south, 4 frames, atlas ${"b".repeat(64)}`,
  );
});

test("a paged canon selection says which page is on show", () => {
  const text = describeShown({
    selection: {
      assetId: "oak-tree",
      kind: "sprite",
      state: "intact",
      direction: "south",
    },
    resolution: {
      source: "canon",
      kind: "sprite",
      assetId: "oak-tree" as never,
      revision: "r".repeat(64) as never,
      uri: "panthea-asset://asset/oak-tree",
      atlas: { blob: "b".repeat(64) as never, width: 2304, height: 192 },
      cell: { w: 192, h: 192 },
      frames: Array.from({ length: 12 }, () => ({})) as never,
    },
    placements: [],
    page: 1,
    pages: 3,
  });

  expect(text).toBe(
    `CANON: oak-tree intact/south, 12 frames, page 2 of 3, atlas ${"b".repeat(64)}`,
  );
});

// The inspection fixture's effect branch: a published effect is selected by
// the name of one of its animations, drawn through the shared layer like any
// sprite, paged when its frames do not fit one draw, and checked against the
// committed reference digests.

import { afterEach, expect, test } from "bun:test";

import {
  decodeFixture,
  fakeSource,
  zeusCanonPayload,
} from "../../test/canon-fixture";
import { type SoftBackend, softBackend } from "../../test/soft-backend";
import {
  COMMITTED_CANON_ATLASES,
  committedCanonPayload,
} from "../../test/zeus-retro-fixture";
import { createCanonClient } from "../assets/canon";
import { evaluate, summarize } from "./check";
import { REFERENCE } from "./expected";
import { createInspector, INSPECT_SIZE, pageFrames } from "./inspector";
import { selectionKey } from "./reference";
import {
  defaultSelection,
  listAssets,
  optionsOf,
  type Selection,
  selectionLabel,
  selectionQuery,
} from "./selection";

const canvas = () =>
  ({ width: 0, height: 0, style: {} }) as unknown as HTMLCanvasElement;

const mounted: { dispose(): void }[] = [];
afterEach(() => {
  for (const inspector of mounted.splice(0)) inspector.dispose();
});

async function mount(payload: unknown = committedCanonPayload()) {
  const canon = createCanonClient({
    source: fakeSource(payload, COMMITTED_CANON_ATLASES),
  });
  const backend: SoftBackend = softBackend({ size: INSPECT_SIZE });
  const inspector = createInspector(canvas(), {
    canon,
    createBackend: () => backend,
    decode: decodeFixture,
    devicePixelRatio: () => 1,
    webGpuPresent: () => false,
  });
  mounted.push(inspector);
  await inspector.start(() => {});
  return { inspector, backend, canon };
}

const effect = (assetId: string, animation: string): Selection => ({
  assetId,
  kind: "effect",
  animation,
});

test("an effect is listed with the names of its animations, in the order its manifest publishes them", async () => {
  const { canon } = await mount();
  const { snapshot } = await canon.load();

  const listed = listAssets(snapshot);

  expect(
    listed
      .filter((asset) => asset.kind === "effect")
      .map((asset) => [asset.assetId, asset.animations]),
  ).toEqual([
    ["fire", ["burn"]],
    ["lightning-strike", ["full", "calm"]],
  ]);
  // Only an effect has animations to name.
  for (const asset of listed.filter((a) => a.kind !== "effect")) {
    expect(asset.animations).toEqual([]);
  }
});

test("an effect opens on its first animation, and a selection names it explicitly", async () => {
  const { canon } = await mount();
  const { snapshot, vocabulary } = await canon.load();
  const strike = listAssets(snapshot).find(
    (asset) => asset.assetId === "lightning-strike",
  );
  if (strike === undefined) throw new Error("no strike listed");

  const selection = defaultSelection(strike, vocabulary);

  expect(selection).toEqual(effect("lightning-strike", "full"));
  expect(selectionQuery(selection)).toEqual({
    spriteId: "lightning-strike",
    animation: "full",
  });
  expect(selectionLabel(selection)).toBe("lightning-strike animation:full");
  expect(selectionKey({ animation: "calm" })).toBe("animation:calm");
  // Choosing an animation needs nothing from the vocabulary.
  expect(optionsOf(undefined)).toEqual({
    states: [],
    directions: [],
    expressions: [],
  });
});

test("the fire loop draws canon through the shared layer on one page, and every check passes at every zoom", async () => {
  const { inspector, backend } = await mount();

  const measurement = await inspector.measure(effect("fire", "burn"));
  const results = evaluate(measurement, REFERENCE);

  expect(measurement.resolution.source).toBe("canon");
  if (measurement.resolution.source === "canon") {
    expect(measurement.resolution.kind).toBe("effect");
  }
  expect(measurement.placements).toHaveLength(10);
  expect(measurement.later).toEqual([]);
  expect(backend.layerStats()).toEqual({ sprites: 10, textures: 1 });
  expect(results.filter((result) => !result.ok)).toEqual([]);
  // source, atlas, frames; then per frame: the 1x target and four canvases.
  expect(results).toHaveLength(3 + 10 * 5);
});

test("both strikes draw, the full one's 8 frames and the calm one's 4, and every check passes", async () => {
  const { inspector } = await mount();

  for (const [animation, frames] of [
    ["full", 8],
    ["calm", 4],
  ] as const) {
    const measurement = await inspector.measure(
      effect("lightning-strike", animation),
    );
    const results = evaluate(measurement, REFERENCE);

    expect(measurement.resolution.source).toBe("canon");
    expect(measurement.placements).toHaveLength(frames);
    expect(results.filter((result) => !result.ok)).toEqual([]);
    expect(results).toHaveLength(3 + frames * 5);
  }
});

test("an effect's frames that do not fit one draw are paged like any selection's, with no frame dropped", () => {
  // 70 frames of the 64x128 strike cell: more than a page holds.
  const frames = Array.from({ length: 70 }, () => ({ w: 64, h: 128 }));

  const pages = pageFrames(frames);

  expect(pages.length).toBeGreaterThan(1);
  expect(pages.reduce((count, page) => count + page.length, 0)).toBe(70);
  for (const rect of pages.flat()) {
    expect(rect.x + rect.w).toBeLessThanOrEqual(INSPECT_SIZE.width);
    expect(rect.y + rect.h).toBeLessThanOrEqual(INSPECT_SIZE.height);
  }
});

test("an effect the registry does not publish, or an animation it does not have, draws the placeholder", async () => {
  const withoutEffects = await mount(zeusCanonPayload());
  const missing = await withoutEffects.inspector.measure(
    effect("fire", "burn"),
  );
  expect(missing.resolution).toMatchObject({
    source: "placeholder",
    reason: "missing-id",
  });

  const { inspector } = await mount();
  const unnamed = await inspector.measure(effect("fire", "smoulder"));
  expect(unnamed.resolution).toMatchObject({
    source: "placeholder",
    reason: "missing-state",
  });
  // A placeholder has no committed digest to match: it is checked against the shared placeholder pixels.
  expect(evaluate(unnamed, REFERENCE).filter((result) => !result.ok)).toEqual(
    [],
  );
});

test("the whole suite covers the effects: every committed animation is a selection, and all of it passes", async () => {
  const { inspector } = await mount();

  const { results } = await inspector.runAll();

  const ids = results.map((result) => result.id);
  for (const key of [
    "canon:fire:animation:burn:source",
    "canon:lightning-strike:animation:full:source",
    "canon:lightning-strike:animation:calm:source",
  ]) {
    expect(ids).toContain(key);
  }
  // The only failure is the global check the fixture's repo root cannot satisfy: the shipped game reads the bundled root.
  expect(
    results.filter((result) => !result.ok).map((result) => result.id),
  ).toEqual(["root-kind"]);
  expect(summarize(results).passed).toBeGreaterThan(0);
  // No unpublished-state control is added for an effect.
  expect(ids.some((id) => id.startsWith("placeholder:fire:"))).toBe(false);
});

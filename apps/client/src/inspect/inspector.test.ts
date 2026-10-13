import { afterEach, expect, test } from "bun:test";
import { resolveAssetPixels } from "@panthea/assets/browser";

import {
  decodeFixture,
  fakeSource,
  PORTRAIT_ATLAS_HASH,
  ZEUS_ATLAS_HASH,
  ZEUS_CANON_ATLASES,
  zeusCanonPayload,
} from "../../test/canon-fixture";
import { type SoftBackend, softBackend } from "../../test/soft-backend";
import {
  type CanonClient,
  type CanonProblem,
  createCanonClient,
} from "../assets/canon";
import { evaluate, summarize } from "./check";
import { REFERENCE } from "./expected";
import { createInspector, INSPECT_SIZE, placeFrames } from "./inspector";
import type { Reference } from "./reference";
import type { Selection } from "./selection";

function canvas() {
  return { width: 0, height: 0, style: {} } as unknown as HTMLCanvasElement;
}

// A sprite layer owns an ECS world and the world count is capped, so every
// test releases the inspector it made.
const mounted: { dispose(): void }[] = [];
afterEach(() => {
  for (const inspector of mounted.splice(0)) inspector.dispose();
});

async function mount(
  options: {
    payload?: unknown;
    atlases?: ReadonlyMap<string, Uint8Array>;
    offset?: { x: number; y: number };
    backendName?: string;
    webGpuPresent?: boolean;
    rootKind?: "repo" | "bundled";
    reference?: Reference;
  } = {},
) {
  const problems: CanonProblem[] = [];
  const source = fakeSource(
    options.payload ?? {
      ...zeusCanonPayload(),
      rootKind: options.rootKind ?? "bundled",
    },
    options.atlases ?? ZEUS_CANON_ATLASES,
  );
  const canon: CanonClient = createCanonClient({
    source,
    onProblem: (p) => problems.push(p),
  });
  const backend: SoftBackend = softBackend({
    size: INSPECT_SIZE,
    ...(options.offset === undefined ? {} : { offset: options.offset }),
    ...(options.backendName === undefined ? {} : { name: options.backendName }),
  });
  const inspector = createInspector(canvas(), {
    canon,
    createBackend: () => backend,
    decode: decodeFixture,
    devicePixelRatio: () => 1,
    webGpuPresent: () => options.webGpuPresent ?? false,
    ...(options.reference === undefined
      ? {}
      : { reference: options.reference }),
  });
  mounted.push(inspector);
  await inspector.start(() => {});
  return { inspector, backend, source, problems };
}

const idle: Selection = {
  assetId: "zeus-sprite",
  kind: "sprite",
  state: "idle",
  direction: "south",
};
const portrait = (expression: string): Selection => ({
  assetId: "zeus-portrait",
  kind: "portrait",
  expression,
});

test("Zeus idle-south draws canon through the shared layer and every check passes at every zoom", async () => {
  const { inspector, backend, source } = await mount();

  const measurement = await inspector.measure(idle);
  const results = evaluate(measurement, REFERENCE);

  expect(measurement.resolution.source).toBe("canon");
  expect(measurement.placements).toHaveLength(4);
  expect(backend.layerStats()).toEqual({ sprites: 4, textures: 1 });
  expect([...measurement.canvases.keys()]).toEqual([1, 2, 3, 4]);
  expect(results.filter((r) => !r.ok)).toEqual([]);
  // source, atlas, frames; then per frame: the 1x target and four canvases.
  expect(results).toHaveLength(3 + 4 * 5);
  expect(source.atlasCalls()).toEqual([ZEUS_ATLAS_HASH]);
});

test("all six portrait expressions are reachable, each canon from the portrait atlas, each passing", async () => {
  const { inspector, source } = await mount();

  for (const expression of [
    "neutral",
    "pleased",
    "angry",
    "grieving",
    "scheming",
    "awed",
  ]) {
    const measurement = await inspector.measure(portrait(expression));
    const results = evaluate(measurement, REFERENCE);

    expect(measurement.resolution.source).toBe("canon");
    expect(measurement.placements).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([]);
  }
  expect(source.atlasCalls()).toEqual([PORTRAIT_ATLAS_HASH]);
});

const seated: Selection = { ...idle, state: "seated" };

test("seated draws canon through the shared layer: two frames at 500 ms from the same atlas, and every check passes at every zoom", async () => {
  const { inspector, backend, source } = await mount();

  const measurement = await inspector.measure(seated);
  const results = evaluate(measurement, REFERENCE);

  expect(measurement.resolution).toMatchObject({
    source: "canon",
    assetId: "zeus-sprite",
  });
  if (measurement.resolution.source !== "canon")
    throw new Error("expected canon art");
  expect(measurement.resolution.frames.map((f) => f.durationMs)).toEqual([
    500, 500,
  ]);
  expect(measurement.resolution.frames.map((f) => f.rect.x)).toEqual([
    256, 320,
  ]);
  expect(String(measurement.resolution.atlas.blob)).toBe(ZEUS_ATLAS_HASH);
  expect(measurement.placements).toHaveLength(2);
  expect(backend.layerStats()).toEqual({ sprites: 2, textures: 1 });
  expect(results.filter((r) => !r.ok)).toEqual([]);
  // source, atlas, frames; then per frame: the 1x target and four canvases.
  expect(results).toHaveLength(3 + 2 * 5);
  expect(results.find((r) => r.id.endsWith(":source"))?.label).toContain(
    "source is canon",
  );
  expect(source.atlasCalls()).toEqual([ZEUS_ATLAS_HASH]);
});

const act: Selection = { ...idle, state: "act", ability: "thunderbolt" };

test("act with its ability draws canon through the shared layer: five frames at 83/100/83/83/100 ms from the same atlas, and every check passes at every zoom", async () => {
  const { inspector, backend, source } = await mount();

  const measurement = await inspector.measure(act);
  const results = evaluate(measurement, REFERENCE);

  expect(measurement.resolution).toMatchObject({
    source: "canon",
    assetId: "zeus-sprite",
  });
  if (measurement.resolution.source !== "canon")
    throw new Error("expected canon art");
  expect(measurement.resolution.frames.map((f) => f.durationMs)).toEqual([
    83, 100, 83, 83, 100,
  ]);
  expect(measurement.resolution.frames.map((f) => f.rect.x)).toEqual([
    384, 448, 512, 576, 640,
  ]);
  expect(String(measurement.resolution.atlas.blob)).toBe(ZEUS_ATLAS_HASH);
  expect(measurement.placements).toHaveLength(5);
  expect(backend.layerStats()).toEqual({ sprites: 5, textures: 1 });
  expect(results.filter((r) => !r.ok)).toEqual([]);
  // source, atlas, frames; then per frame: the 1x target and four canvases.
  expect(results).toHaveLength(3 + 5 * 5);
  expect(results.find((r) => r.id.endsWith(":source"))?.label).toContain(
    "source is canon",
  );
  expect(source.atlasCalls()).toEqual([ZEUS_ATLAS_HASH]);
});

test("act without an ability, and an ability nothing publishes, stay placeholders beside the canon act", async () => {
  const { inspector } = await mount();

  for (const selection of [
    { ...idle, state: "act" },
    { ...idle, state: "act", ability: "pronouncement" },
  ] satisfies Selection[]) {
    const measurement = await inspector.measure(selection);

    expect(measurement.resolution).toMatchObject({
      source: "placeholder",
      reason: "missing-state",
    });
    expect(evaluate(measurement, REFERENCE).filter((r) => !r.ok)).toEqual([]);
  }
});

test("states nothing publishes are reachable and draw the shared placeholder, labelled as placeholders", async () => {
  const { inspector } = await mount();
  const placeholder = resolveAssetPixels(
    { entries: new Map() },
    { spriteId: "x" },
  );
  if (placeholder.source !== "placeholder")
    throw new Error("expected a placeholder");

  for (const selection of [
    { ...idle, state: "act" },
    { ...idle, state: "walk" },
  ] satisfies Selection[]) {
    const measurement = await inspector.measure(selection);
    const results = evaluate(measurement, REFERENCE);

    expect(measurement.resolution).toMatchObject({
      source: "placeholder",
      reason: "missing-state",
    });
    expect(measurement.placements).toHaveLength(1);
    expect(results.find((r) => r.id.endsWith(":source"))?.label).toContain(
      "placeholder",
    );
    expect(results.filter((r) => !r.ok)).toEqual([]);
  }
});

test("a frame drawn one pixel off fails the digest check, at every zoom, while the source and atlas still pass", async () => {
  for (const offset of [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: -1 },
  ]) {
    const { inspector } = await mount({ offset });

    const results = evaluate(await inspector.measure(idle), REFERENCE);

    const pixels = results.filter((r) => r.id.includes("#"));
    expect(pixels).toHaveLength(20);
    expect(pixels.every((r) => !r.ok)).toBe(true);
    expect(results.filter((r) => !r.id.includes("#")).every((r) => r.ok)).toBe(
      true,
    );
    inspector.dispose();
  }
});

test("an off-by-one placeholder fails its pixel comparison too", async () => {
  const { inspector } = await mount({ offset: { x: 1, y: 0 } });

  const results = evaluate(
    await inspector.measure({ ...idle, state: "act" }),
    REFERENCE,
  );

  expect(results.some((r) => r.id.includes("pixels") && !r.ok)).toBe(true);
});

test("with the registry withheld every canon check fails, whatever the placeholders draw", async () => {
  const { inspector } = await mount({ payload: new Error("withheld") });

  const suite = await inspector.runAll();

  const canon = suite.results.filter((r) => r.id.startsWith("canon:"));
  expect(canon).toHaveLength(112);
  expect(canon.filter((r) => r.ok)).toEqual([]);
  expect(suite.results.find((r) => r.id === "root-kind")?.ok).toBe(false);
  expect(summarize(suite.results).ok).toBe(false);
});

test("a placeholder-only snapshot (a registry holding only unrelated ids) fails every canon check", async () => {
  const { inspector } = await mount({
    payload: {
      ...zeusCanonPayload(),
      index: JSON.stringify({ schemaVersion: 1, entries: [] }),
    },
    reference: {
      ...REFERENCE,
      assets: REFERENCE.assets.filter((a) => a.assetId === "zeus-sprite"),
    },
  });

  const suite = await inspector.runAll();

  const canon = suite.results.filter((r) => r.id.startsWith("canon:"));
  expect(canon).toHaveLength(64);
  expect(canon.filter((r) => r.ok)).toEqual([]);
});

test("a refused atlas draws the placeholder, so the canon checks fail and the problem is reported", async () => {
  const { inspector, problems } = await mount({ atlases: new Map() });

  const measurement = await inspector.measure(idle);
  const results = evaluate(measurement, REFERENCE);

  expect(measurement.resolution.source).toBe("placeholder");
  expect(results.filter((r) => r.ok)).toEqual([]);
  expect(problems.map((p) => p.scope)).toContain(`atlas:${ZEUS_ATLAS_HASH}`);
});

test("a canon frame with no reference digest fails rather than passing unchecked", async () => {
  const { inspector } = await mount();

  const results = evaluate(await inspector.measure(idle), {
    ...REFERENCE,
    assets: [],
  });

  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ ok: false });
  expect(results[0]?.detail).toContain("no reference digest");
});

test("the suite covers every committed selection and the unpublished control, and a correct draw passes it all", async () => {
  const { inspector } = await mount({ webGpuPresent: false });

  const suite = await inspector.runAll();

  expect(suite.results.filter((r) => !r.ok)).toEqual([]);
  expect(summarize(suite.results)).toMatchObject({ failed: 0, ok: true });
  const ids = new Set(suite.results.map((r) => r.id.split("#")[0]));
  expect(ids.has("canon:zeus-sprite:idle/south:source")).toBe(true);
  for (const expression of [
    "neutral",
    "pleased",
    "angry",
    "grieving",
    "scheming",
    "awed",
  ]) {
    expect(ids.has(`canon:zeus-portrait:expression:${expression}:source`)).toBe(
      true,
    );
  }
  expect(ids.has("canon:zeus-sprite:seated/south:source")).toBe(true);
  expect(ids.has("placeholder:zeus-sprite:seated/south:source")).toBe(false);
  expect(ids.has("placeholder:zeus-sprite:act/south:source")).toBe(true);
  expect(suite.results.find((r) => r.id === "root-kind")).toMatchObject({
    ok: true,
    detail: "bundled",
  });
  expect(suite.results.find((r) => r.id === "backend")).toMatchObject({
    ok: true,
  });
});

test("the listing offers the snapshot's assets, the vocabulary's options and the root kind", async () => {
  const { inspector } = await mount();

  const listing = await inspector.listing();

  expect(listing.assets.map((a) => a.assetId)).toEqual([
    "zeus-portrait",
    "zeus-sprite",
  ]);
  expect(listing.options.states.map((s) => s.id)).toContain("seated");
  expect(listing.rootKind).toBe("bundled");
});

test("a draw prepares, then renders, and measuring leaves the display zoom as it was", async () => {
  const { inspector, backend } = await mount();
  inspector.setZoom(3);

  await inspector.show(idle);
  expect(backend.log.slice(-2)).toEqual(["prepare", "render"]);
  await inspector.measure(idle);

  expect(backend.views.at(-1)?.zoom).toBe(3);
  expect(backend.views.map((v) => v.zoom)).toContain(4);
});

test("disposing releases every texture and sprite", async () => {
  const { inspector, backend } = await mount();
  await inspector.show(idle);

  inspector.dispose();

  expect(backend.layerStats()).toEqual({ sprites: 0, textures: 0 });
  expect(() => inspector.dispose()).not.toThrow();
});

test("frames sit at whole pixels in a row, wrap before the edge, and one that cannot fit is refused", () => {
  expect(
    placeFrames([
      { w: 64, h: 80 },
      { w: 64, h: 80 },
    ]),
  ).toEqual([
    { x: 16, y: 16, w: 64, h: 80 },
    { x: 88, y: 16, w: 64, h: 80 },
  ]);
  const large = placeFrames(
    Array.from({ length: 6 }, () => ({ w: 128, h: 128 })),
  );
  expect(large.map((r) => [r.x, r.y])).toEqual([
    [16, 16],
    [152, 16],
    [288, 16],
    [424, 16],
    [16, 152],
    [152, 152],
  ]);
  for (const rect of large) {
    expect(rect.x + rect.w).toBeLessThanOrEqual(INSPECT_SIZE.width);
    expect(rect.y + rect.h).toBeLessThanOrEqual(INSPECT_SIZE.height);
  }
  // 112x96 god-tall frames: four to a row, and a 16-frame clip (the retro walk, or the longest
  // idle, seated or act) takes four rows, the last ending at 16 + 4 * 96 + 3 * 8 = 424 <= 432.
  const tall = placeFrames(
    Array.from({ length: 16 }, () => ({ w: 112, h: 96 })),
  );
  expect(tall.map((r) => [r.x, r.y])).toEqual(
    [16, 120, 224, 328].flatMap((y) => [16, 136, 256, 376].map((x) => [x, y])),
  );
  for (const rect of tall) {
    expect(rect.x + rect.w).toBeLessThanOrEqual(INSPECT_SIZE.width);
    expect(rect.y + rect.h).toBeLessThanOrEqual(INSPECT_SIZE.height);
  }
  expect(INSPECT_SIZE).toEqual({ width: 576, height: 432 });
  expect(INSPECT_SIZE.height % 16).toBe(0);
  expect(() => placeFrames([{ w: 600, h: 10 }])).toThrow(/does not fit/);
  expect(() =>
    placeFrames(Array.from({ length: 13 }, () => ({ w: 128, h: 128 }))),
  ).toThrow(/does not fit/);
  expect(() =>
    placeFrames(Array.from({ length: 17 }, () => ({ w: 112, h: 96 }))),
  ).toThrow(/does not fit/);
});

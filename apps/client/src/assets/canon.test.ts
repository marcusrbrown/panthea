import { expect, test } from "bun:test";
import { resolveAssetPixels } from "@panthea/assets/browser";
import {
  fakeSource,
  indexText,
  sha256,
  VOCABULARY_TEXT,
  ZEUS_ATLAS_BYTES,
  ZEUS_ATLAS_HASH,
  ZEUS_MANIFEST_TEXT,
  ZEUS_REVISION,
  zeusPayload,
} from "./_test-canon";
import {
  type CanonProblem,
  createCanonClient,
  createTauriCanonSource,
} from "./canon";

function client(payload: unknown, atlases?: ReadonlyMap<string, Uint8Array>) {
  const source = fakeSource(payload, atlases);
  const problems: CanonProblem[] = [];
  return {
    source,
    problems,
    canon: createCanonClient({
      source,
      onProblem: (problem) => problems.push(problem),
    }),
  };
}

test("Zeus resolves to zeus-sprite idle-south: four frames at 333/167/333/167 ms", async () => {
  const { canon, problems } = client(zeusPayload());

  const { snapshot, rootKind } = await canon.load();
  const zeus = resolveAssetPixels(snapshot, {
    spriteId: "zeus-sprite",
    state: "idle",
    direction: "south",
  });

  expect(problems).toEqual([]);
  expect(rootKind).toBe("repo");
  if (zeus.source !== "canon") throw new Error("expected canon art");
  expect(String(zeus.assetId)).toBe("zeus-sprite");
  expect(String(zeus.revision)).toBe(ZEUS_REVISION);
  expect(String(zeus.atlas.blob)).toBe(ZEUS_ATLAS_HASH);
  expect(zeus.frames.map((frame) => frame.durationMs)).toEqual([
    333, 167, 333, 167,
  ]);
  expect(zeus.frames.map((frame) => frame.rect.x)).toEqual([0, 64, 128, 192]);
  expect(zeus.pivot).toEqual({ x: 32, y: 80 });
});

test("AE1: seated draws the placeholder with no error, and idle-south is still canon", async () => {
  const { canon, problems } = client(zeusPayload());
  const { snapshot } = await canon.load();

  const seated = resolveAssetPixels(snapshot, {
    spriteId: "zeus-sprite",
    state: "seated",
  });
  const idle = resolveAssetPixels(snapshot, {
    spriteId: "zeus-sprite",
    state: "idle",
    direction: "south",
  });

  expect(seated).toMatchObject({
    source: "placeholder",
    reason: "missing-state",
  });
  expect(idle.source).toBe("canon");
  expect(problems).toEqual([]);
});

test("an id that is not published resolves to the placeholder", async () => {
  const { canon } = client(zeusPayload());
  const { snapshot } = await canon.load();

  expect(
    resolveAssetPixels(snapshot, { spriteId: "placeholder-woodcutter" }),
  ).toMatchObject({ source: "placeholder", reason: "missing-id" });
});

test("the registry is fetched once, however many times it is loaded", async () => {
  const { canon, source } = client(zeusPayload());

  const [first, second] = await Promise.all([canon.load(), canon.load()]);
  const third = await canon.load();

  expect(first).toBe(second);
  expect(third).toBe(first);
  expect(source.registryCalls()).toBe(1);
});

test("an atlas is fetched once per hash and the bytes are cached", async () => {
  const { canon, source } = client(zeusPayload());
  await canon.load();

  const [first, second] = await Promise.all([
    canon.atlas(ZEUS_ATLAS_HASH),
    canon.atlas(ZEUS_ATLAS_HASH),
  ]);
  const third = await canon.atlas(ZEUS_ATLAS_HASH);

  expect(first).toEqual(ZEUS_ATLAS_BYTES);
  expect(second).toBe(first);
  expect(third).toBe(first);
  expect(source.atlasCalls()).toEqual([ZEUS_ATLAS_HASH]);
});

test("a blob that no parsed manifest names is never fetched", async () => {
  const stray = "a".repeat(64);
  const orphan = ZEUS_MANIFEST_TEXT.replace(ZEUS_ATLAS_HASH, stray);
  const payload = {
    ...zeusPayload(),
    // A manifest for a blob the registry holds, but that the index does not select
    // and that does not parse: neither makes the blob drawable.
    manifests: [
      { hash: ZEUS_REVISION, text: ZEUS_MANIFEST_TEXT },
      { hash: sha256(orphan), text: orphan },
      { hash: sha256("{ not a manifest"), text: "{ not a manifest" },
    ],
  };
  const { canon, source, problems } = client(
    payload,
    new Map([
      [ZEUS_ATLAS_HASH, ZEUS_ATLAS_BYTES],
      [stray, ZEUS_ATLAS_BYTES],
    ]),
  );
  await canon.load();

  expect(await canon.atlas(stray)).toBeUndefined();
  expect(await canon.atlas("b".repeat(64))).toBeUndefined();
  expect(await canon.atlas(ZEUS_ATLAS_HASH)).toEqual(ZEUS_ATLAS_BYTES);

  expect(source.atlasCalls()).toEqual([ZEUS_ATLAS_HASH]);
  expect(problems.filter((p) => p.scope === `atlas:${stray}`)).toHaveLength(1);
});

test("a refused atlas fetch falls back, is reported once, and is not retried", async () => {
  const { canon, source, problems } = client(zeusPayload(), new Map());
  await canon.load();

  expect(await canon.atlas(ZEUS_ATLAS_HASH)).toBeUndefined();
  expect(await canon.atlas(ZEUS_ATLAS_HASH)).toBeUndefined();

  expect(source.atlasCalls()).toEqual([ZEUS_ATLAS_HASH]);
  expect(problems).toEqual([
    {
      scope: `atlas:${ZEUS_ATLAS_HASH}`,
      message: "atlas is not in the verified canon set",
    },
  ]);
});

test("loader problems from the shell are reported once, and the rest still loads", async () => {
  const payload = {
    ...zeusPayload(),
    problems: [
      { path: "blobs/bad.png", reason: "bytes do not hash to the file name" },
    ],
  };
  const { canon, problems } = client(payload);

  const { snapshot } = await canon.load();
  await canon.load();

  expect(snapshot.entries.has("zeus-sprite")).toBe(true);
  expect(problems).toEqual([
    { scope: "blobs/bad.png", message: "bytes do not hash to the file name" },
  ]);
});

test("a registry the shell cannot produce gives an empty snapshot and one report", async () => {
  const { canon, problems } = client(new Error("canon is unavailable"));

  const { snapshot } = await canon.load();

  expect(snapshot.entries.size).toBe(0);
  expect(problems).toEqual([
    { scope: "canon_registry", message: "canon is unavailable" },
  ]);
});

test("a payload of the wrong shape gives an empty snapshot and one report", async () => {
  const { canon, problems } = client({ index: 3 });

  const { snapshot } = await canon.load();

  expect(snapshot.entries.size).toBe(0);
  expect(problems).toHaveLength(1);
  expect(problems[0]?.scope).toBe("canon_registry");
});

test("a missing vocabulary or index drops everything and says why", async () => {
  const noVocabulary = client({ ...zeusPayload(), vocabulary: null });
  const noIndex = client({ ...zeusPayload(), index: null });

  expect((await noVocabulary.canon.load()).snapshot.entries.size).toBe(0);
  expect((await noIndex.canon.load()).snapshot.entries.size).toBe(0);
  expect(noVocabulary.problems.map((p) => p.scope)).toEqual([
    "vocabulary.json",
  ]);
  expect(noIndex.problems.map((p) => p.scope)).toEqual(["index.json"]);
});

test("a manifest that fails the contract parser is dropped and reported, others stay", async () => {
  const broken = JSON.parse(ZEUS_MANIFEST_TEXT);
  broken.id = "Not A Slug";
  const brokenText = JSON.stringify(broken);
  const brokenRevision = sha256(brokenText);
  const payload = {
    ...zeusPayload(),
    index: indexText([
      { assetId: "broken", revision: brokenRevision },
      { assetId: "zeus-sprite", revision: ZEUS_REVISION },
    ]),
    manifests: [
      { hash: brokenRevision, text: brokenText },
      { hash: ZEUS_REVISION, text: ZEUS_MANIFEST_TEXT },
    ],
  };
  const { canon, problems } = client(payload);

  const { snapshot } = await canon.load();

  expect([...snapshot.entries.keys()]).toEqual(["zeus-sprite"]);
  expect(problems).toHaveLength(1);
  expect(problems[0]?.scope).toBe(`manifests/${brokenRevision}.json`);
});

test("a manifest the index does not name by its revision is dropped", async () => {
  const payload = {
    ...zeusPayload(),
    index: indexText([{ assetId: "zeus-sprite", revision: "c".repeat(64) }]),
  };
  const { canon, problems } = client(payload);

  const { snapshot } = await canon.load();

  expect(snapshot.entries.size).toBe(0);
  expect(problems.map((p) => p.scope)).toEqual(["index.json"]);
});

test("a manifest is used only when the index revision matches a hash the shell returned", async () => {
  const other = "d".repeat(64);
  const payload = {
    ...zeusPayload(),
    // The text is Zeus's, but the shell verified it under a different hash.
    manifests: [{ hash: other, text: ZEUS_MANIFEST_TEXT }],
  };
  const { canon, problems } = client(payload);

  const { snapshot } = await canon.load();

  expect(snapshot.entries.size).toBe(0);
  expect(problems.map((p) => p.scope)).toEqual(["index.json"]);
  expect(problems[0]?.message).toContain(ZEUS_REVISION);
});

test("an index revision with no verified manifest at all is dropped and reported", async () => {
  const payload = { ...zeusPayload(), manifests: [] };
  const { canon, problems } = client(payload);

  expect((await canon.load()).snapshot.entries.size).toBe(0);
  expect(problems).toEqual([
    {
      scope: "index.json",
      message: `zeus-sprite: no verified manifest has revision ${ZEUS_REVISION}`,
    },
  ]);
});

test("the old payload shape, manifests as bare text, is refused as a whole", async () => {
  const payload = { ...zeusPayload(), manifests: [ZEUS_MANIFEST_TEXT] };
  const { canon, problems } = client(payload);

  expect((await canon.load()).snapshot.entries.size).toBe(0);
  expect(problems).toEqual([
    {
      scope: "canon_registry",
      message: "manifests is not a list of hash and text",
    },
  ]);
});

test("a manifest hash that is not a sha256 is refused as a whole", async () => {
  const payload = {
    ...zeusPayload(),
    manifests: [{ hash: "not-a-hash", text: ZEUS_MANIFEST_TEXT }],
  };
  const { canon, problems } = client(payload);

  expect((await canon.load()).snapshot.entries.size).toBe(0);
  expect(problems[0]?.scope).toBe("canon_registry");
});

test("a manifest for a different asset than the index entry is dropped", async () => {
  const payload = {
    ...zeusPayload(),
    index: indexText([{ assetId: "hera-sprite", revision: ZEUS_REVISION }]),
  };
  const { canon, problems } = client(payload);

  expect((await canon.load()).snapshot.entries.size).toBe(0);
  expect(problems).toHaveLength(1);
});

test("without a source (browser dev, fixture mode) the snapshot is empty and nothing is reported", async () => {
  const problems: CanonProblem[] = [];
  const canon = createCanonClient({ onProblem: (p) => problems.push(p) });

  const { snapshot, rootKind } = await canon.load();

  expect(snapshot.entries.size).toBe(0);
  expect(rootKind).toBeUndefined();
  expect(await canon.atlas(ZEUS_ATLAS_HASH)).toBeUndefined();
  expect(problems).toEqual([]);
});

test("the vocabulary fixture is the one the parser needs", () => {
  expect(VOCABULARY_TEXT).toContain('"states"');
});

test("the Tauri source calls the two named commands and sends no path", async () => {
  const calls: { command: string; args: unknown }[] = [];
  const source = createTauriCanonSource(async (command, args) => {
    calls.push({ command, args });
    if (command === "canon_atlas") return new Uint8Array([1, 2, 3]).buffer;
    return { index: null };
  });

  expect(await source.registry()).toEqual({ index: null });
  expect(await source.atlas(ZEUS_ATLAS_HASH)).toEqual(
    new Uint8Array([1, 2, 3]),
  );
  expect(calls).toEqual([
    { command: "canon_registry", args: undefined },
    { command: "canon_atlas", args: { hash: ZEUS_ATLAS_HASH } },
  ]);
});

test("the parsed vocabulary comes with the snapshot, for pickers that offer states and expressions", async () => {
  const { canon } = client(zeusPayload());

  const { vocabulary } = await canon.load();

  expect(vocabulary?.states.map((state) => state.id)).toEqual([
    "idle",
    "seated",
    "act",
    "walk",
    "hurt",
    "down",
  ]);
  expect(vocabulary?.directions).toEqual(["south", "north", "east", "west"]);
  expect(vocabulary?.expressions).toHaveLength(6);
});

test("with no vocabulary there is none to offer", async () => {
  const { canon } = client({ ...zeusPayload(), vocabulary: null });

  expect((await canon.load()).vocabulary).toBeUndefined();
});

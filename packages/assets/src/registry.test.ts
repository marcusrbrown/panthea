// Real temp-directory registry tests: no filesystem mocks.

import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AssetId,
  type AssetManifest,
  type AssetRecord,
  type ConformanceReport,
  canonicalJson,
  canonicalManifestText,
  newCandidate,
  type Sha256,
  transitionAsset,
} from "@panthea/contracts";
import {
  committedVocabulary,
  type FixtureAsset,
  portraitFixture,
  spriteFixture,
} from "./fixtures";
import { sha256Hex } from "./hash";
import {
  loadRegistry,
  publishAsset,
  selectRevision,
  writeRevision,
} from "./registry";
import { resolveAsset } from "./resolve";

const vocabulary = committedVocabulary();
const dirs: string[] = [];
const root = () => {
  const dir = mkdtempSync(join(tmpdir(), "assets-registry-"));
  dirs.push(dir);
  return join(dir, "registry");
};
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const pass: ConformanceReport = {
  schemaVersion: 1,
  status: "pass",
  checks: [{ check: "binary-alpha", status: "pass" }],
};

function approved(asset: FixtureAsset): AssetRecord {
  let record = newCandidate(asset.manifest, pass);
  for (const action of [{ type: "pick" }, { type: "approve" }] as const) {
    const next = transitionAsset(record, action);
    if (!next.ok) throw new Error(next.message);
    record = next.value;
  }
  return record;
}

function publish(dir: string, asset: FixtureAsset) {
  const result = publishAsset(dir, approved(asset), asset.blobs, vocabulary);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

const textOf = (path: string) => readFileSync(path, "utf8");
const listing = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).sort() : [];

describe("publishing", () => {
  it("writes content-addressed blobs and manifests, then the index, and resolves canon", () => {
    const dir = root();
    const asset = spriteFixture();
    const { record, revision } = publish(dir, asset);

    const manifestText = canonicalManifestText(asset.manifest);
    expect(revision).toBe(sha256Hex(new TextEncoder().encode(manifestText)));
    expect(textOf(join(dir, "manifests", `${revision}.json`))).toBe(
      manifestText,
    );
    const blobHash = asset.manifest.atlas.blob;
    expect(sha256Hex(readFileSync(join(dir, "blobs", `${blobHash}.png`)))).toBe(
      blobHash,
    );
    expect(textOf(join(dir, "index.json"))).toBe(
      `${canonicalJson({ schemaVersion: 1, entries: [{ assetId: "placeholder-zeus", revision }] })}\n`,
    );
    expect(record.state).toBe("canon");

    const loaded = loadRegistry(dir, vocabulary);
    expect(loaded.problems).toEqual([]);
    const resolved = resolveAsset(loaded.snapshot, {
      spriteId: "placeholder-zeus",
    });
    expect(resolved).toMatchObject({ source: "canon", revision });
  });

  it("keeps a partial canon usable: unpublished states and ids fall back", () => {
    const dir = root();
    publish(dir, spriteFixture());
    const { snapshot } = loadRegistry(dir, vocabulary);
    expect(
      resolveAsset(snapshot, { spriteId: "placeholder-zeus", state: "seated" }),
    ).toMatchObject({ source: "placeholder", reason: "missing-state" });
    expect(
      resolveAsset(snapshot, {
        spriteId: "zeus-portrait",
        expression: "neutral",
      }),
    ).toMatchObject({ source: "placeholder", reason: "missing-id" });
  });

  it("publishes several assets in sorted index order", () => {
    const dir = root();
    publish(dir, spriteFixture());
    publish(dir, portraitFixture());
    const index = JSON.parse(textOf(join(dir, "index.json")));
    expect(index.entries.map((e: { assetId: string }) => e.assetId)).toEqual([
      "placeholder-zeus",
      "zeus-portrait",
    ]);
  });

  it("republishing selects the new revision and leaves the old bytes in place", () => {
    const dir = root();
    const first = publish(dir, spriteFixture("placeholder-zeus", 1));
    const second = publish(dir, spriteFixture("placeholder-zeus", 2));
    expect(second.revision).not.toBe(first.revision);

    const index = JSON.parse(textOf(join(dir, "index.json")));
    expect(index.entries).toEqual([
      { assetId: "placeholder-zeus", revision: second.revision },
    ]);
    expect(existsSync(join(dir, "manifests", `${first.revision}.json`))).toBe(
      true,
    );
    const oldBlob = spriteFixture("placeholder-zeus", 1).manifest.atlas.blob;
    expect(existsSync(join(dir, "blobs", `${oldBlob}.png`))).toBe(true);
    expect(
      loadRegistry(dir, vocabulary).snapshot.entries.get("placeholder-zeus")
        ?.revision,
    ).toBe(second.revision);

    // Selecting A again is the rollback: only the index changes.
    const back = selectRevision(
      dir,
      "placeholder-zeus" as AssetId,
      first.revision,
      vocabulary,
    );
    expect(back.ok).toBe(true);
    expect(
      loadRegistry(dir, vocabulary).snapshot.entries.get("placeholder-zeus")
        ?.revision,
    ).toBe(first.revision);
  });

  it("is idempotent for the same content", () => {
    const dir = root();
    const asset = spriteFixture();
    const first = writeRevision(dir, asset.manifest, asset.blobs, vocabulary);
    const second = writeRevision(dir, asset.manifest, asset.blobs, vocabulary);
    expect(first).toEqual(second);
    expect(listing(join(dir, "manifests"))).toHaveLength(1);
    expect(listing(join(dir, "blobs"))).toHaveLength(1);
  });

  it("publishes only approved records and leaves the registry untouched otherwise", () => {
    const asset = spriteFixture();
    const candidate = newCandidate(asset.manifest, pass);
    const draft = transitionAsset(candidate, { type: "pick" });
    const rejected = transitionAsset(candidate, {
      type: "reject",
      reason: "no",
    });
    if (!draft.ok || !rejected.ok) throw new Error("setup");
    for (const record of [candidate, draft.value, rejected.value]) {
      const dir = root();
      const result = publishAsset(dir, record, asset.blobs, vocabulary);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("not-approved");
      expect(existsSync(dir)).toBe(false);
    }
  });
});

describe("an approval covers only the manifest that was approved", () => {
  it("publishes the approved record's own manifest, never another revision of the asset", () => {
    const dir = root();
    const a = spriteFixture("placeholder-zeus", 1);
    const b = spriteFixture("placeholder-zeus", 2);
    const writtenB = writeRevision(dir, b.manifest, b.blobs, vocabulary);
    if (!writtenB.ok) throw new Error(writtenB.message);

    const published = publish(dir, a);
    expect(published.record.manifest).toEqual(a.manifest);
    expect(published.revision).not.toBe(writtenB.value.revision);
    const index = JSON.parse(textOf(join(dir, "index.json")));
    expect(index.entries).toEqual([
      { assetId: "placeholder-zeus", revision: published.revision },
    ]);
    // B's bytes stay stored but unselected.
    expect(
      existsSync(join(dir, "manifests", `${writtenB.value.revision}.json`)),
    ).toBe(true);
  });

  it("rejects the approved manifest published with another revision's blobs and leaves the index alone", () => {
    const dir = root();
    const a = spriteFixture("placeholder-zeus", 1);
    const b = spriteFixture("placeholder-zeus", 2);
    const first = publish(dir, spriteFixture("placeholder-zeus", 3));
    const before = textOf(join(dir, "index.json"));

    const missing = publishAsset(dir, approved(a), b.blobs, vocabulary);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("missing-blob");

    const [bytesB] = [...b.blobs.values()];
    const forged = new Map([[a.manifest.atlas.blob, bytesB as Uint8Array]]);
    const mismatched = publishAsset(dir, approved(a), forged, vocabulary);
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok) expect(mismatched.code).toBe("hash-mismatch");

    expect(textOf(join(dir, "index.json"))).toBe(before);
    expect(
      loadRegistry(dir, vocabulary).snapshot.entries.get("placeholder-zeus")
        ?.revision,
    ).toBe(first.revision);
  });

  it("publishes an owner-exception approval with the exception in the stored provenance", () => {
    const dir = root();
    const asset = spriteFixture();
    let record = newCandidate(asset.manifest, {
      schemaVersion: 1,
      status: "fail",
      checks: [{ check: "binary-alpha", status: "fail" }],
    });
    for (const action of [
      { type: "pick" },
      {
        type: "approve",
        exception: { reason: "owner accepted the soft edge" },
      },
    ] as const) {
      const next = transitionAsset(record, action);
      if (!next.ok) throw new Error(next.message);
      record = next.value;
    }
    const result = publishAsset(dir, record, asset.blobs, vocabulary);
    if (!result.ok) throw new Error(result.message);
    const stored = loadRegistry(dir, vocabulary).snapshot.entries.get(
      "placeholder-zeus",
    )?.manifest;
    expect(stored?.provenance.ownerException).toEqual({
      reason: "owner accepted the soft edge",
    });
  });

  it("publishes the edited manifest of an edited draft, and the old revision's bytes stay", () => {
    const dir = root();
    const asset = spriteFixture();
    const first = publish(dir, asset);
    const edited = {
      ...asset.manifest,
      provenance: {
        ...asset.manifest.provenance,
        handEdits: [
          ...asset.manifest.provenance.handEdits,
          { description: "tidied the outline" },
        ],
      },
    };
    let record = newCandidate(asset.manifest, pass);
    for (const action of [
      { type: "pick" },
      { type: "start-edit" },
      { type: "finish-edit", manifest: edited },
      { type: "approve", report: pass },
    ] as const) {
      const next = transitionAsset(record, action);
      if (!next.ok) throw new Error(next.message);
      record = next.value;
    }
    const second = publishAsset(dir, record, asset.blobs, vocabulary);
    if (!second.ok) throw new Error(second.message);
    expect(second.value.revision).not.toBe(first.revision);
    expect(existsSync(join(dir, "manifests", `${first.revision}.json`))).toBe(
      true,
    );
    expect(
      loadRegistry(dir, vocabulary).snapshot.entries.get("placeholder-zeus")
        ?.manifest.provenance.handEdits,
    ).toHaveLength(2);
  });
});

describe("write safety", () => {
  it("rejects blob bytes that do not match the declared hash before writing anything", () => {
    const dir = root();
    const asset = spriteFixture();
    const wrong = new Map<Sha256, Uint8Array>([
      [asset.manifest.atlas.blob, new Uint8Array([1, 2, 3])],
    ]);
    const result = writeRevision(dir, asset.manifest, wrong, vocabulary);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("hash-mismatch");
    expect(existsSync(dir)).toBe(false);
  });

  it("rejects a blob whose PNG size differs from the atlas", () => {
    const dir = root();
    const asset = spriteFixture();
    const other = spriteFixture("placeholder-zeus", 9);
    const [bytes] = [...other.blobs.values()];
    const mismatched = {
      ...asset.manifest,
      atlas: { ...asset.manifest.atlas, width: 128 },
    } as AssetManifest;
    const result = writeRevision(
      dir,
      mismatched,
      new Map([[asset.manifest.atlas.blob, bytes as Uint8Array]]),
      vocabulary,
    );
    expect(result.ok).toBe(false);
  });

  it("requires every referenced blob", () => {
    const dir = root();
    const asset = spriteFixture();
    const result = writeRevision(dir, asset.manifest, new Map(), vocabulary);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("missing-blob");
  });

  it("never overwrites an existing corrupt blob", () => {
    const dir = root();
    const asset = spriteFixture();
    mkdirSync(join(dir, "blobs"), { recursive: true });
    const path = join(dir, "blobs", `${asset.manifest.atlas.blob}.png`);
    writeFileSync(path, "corrupt");
    const result = writeRevision(dir, asset.manifest, asset.blobs, vocabulary);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("corrupt-blob");
    expect(textOf(path)).toBe("corrupt");
    expect(existsSync(join(dir, "manifests"))).toBe(false);
  });

  it("never overwrites an existing manifest whose bytes differ", () => {
    const dir = root();
    const asset = spriteFixture();
    const { revision } = (() => {
      const r = writeRevision(dir, asset.manifest, asset.blobs, vocabulary);
      if (!r.ok) throw new Error(r.message);
      return r.value;
    })();
    const path = join(dir, "manifests", `${revision}.json`);
    writeFileSync(path, "tampered");
    const again = writeRevision(dir, asset.manifest, asset.blobs, vocabulary);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("corrupt-manifest");
    expect(textOf(path)).toBe("tampered");
  });

  it("selecting an unwritten or mismatched revision fails and leaves the index bytes alone", () => {
    const dir = root();
    publish(dir, spriteFixture("placeholder-zeus", 1));
    const before = textOf(join(dir, "index.json"));
    const absent = selectRevision(
      dir,
      "placeholder-zeus" as AssetId,
      "f".repeat(64) as Sha256,
      vocabulary,
    );
    expect(absent.ok).toBe(false);
    const hera = spriteFixture("placeholder-hera", 3);
    const written = writeRevision(dir, hera.manifest, hera.blobs, vocabulary);
    if (!written.ok) throw new Error(written.message);
    const wrongId = selectRevision(
      dir,
      "placeholder-zeus" as AssetId,
      written.value.revision,
      vocabulary,
    );
    expect(wrongId.ok).toBe(false);
    expect(textOf(join(dir, "index.json"))).toBe(before);
  });
});

describe("interrupted publication", () => {
  it("leaves the old index usable when the process stops before the index is selected", () => {
    const dir = root();
    const first = publish(dir, spriteFixture("placeholder-zeus", 1));
    const before = textOf(join(dir, "index.json"));

    // Phase one of a republish completes; the process dies before phase two.
    const next = spriteFixture("placeholder-zeus", 2);
    const written = writeRevision(dir, next.manifest, next.blobs, vocabulary);
    expect(written.ok).toBe(true);
    // A half-written index temp file from the dead process.
    writeFileSync(join(dir, "index.json.4242.tmp"), '{"schemaVersion":1,"entr');
    writeFileSync(join(dir, "blobs", "abc.tmp"), "partial");

    expect(textOf(join(dir, "index.json"))).toBe(before);
    const loaded = loadRegistry(dir, vocabulary);
    expect(loaded.problems).toEqual([]);
    expect(loaded.snapshot.entries.get("placeholder-zeus")?.revision).toBe(
      first.revision,
    );
    const resolved = resolveAsset(loaded.snapshot, {
      spriteId: "placeholder-zeus",
    });
    expect(resolved).toMatchObject({
      source: "canon",
      revision: first.revision,
    });
  });
});

describe("loading damaged registries", () => {
  it("excludes a missing blob and keeps healthy entries", () => {
    const dir = root();
    const zeus = publish(dir, spriteFixture());
    publish(dir, portraitFixture());
    rmSync(join(dir, "blobs", `${spriteFixture().manifest.atlas.blob}.png`));
    const loaded = loadRegistry(dir, vocabulary);
    expect(loaded.snapshot.entries.has("placeholder-zeus")).toBe(false);
    expect(loaded.snapshot.entries.has("zeus-portrait")).toBe(true);
    expect(loaded.problems).toHaveLength(1);
    expect(loaded.problems[0]?.file).toBe(
      `blobs/${spriteFixture().manifest.atlas.blob}.png`,
    );
    expect(zeus.revision).toBeDefined();
    expect(
      resolveAsset(loaded.snapshot, { spriteId: "placeholder-zeus" }),
    ).toMatchObject({ source: "placeholder", reason: "missing-id" });
  });

  it("excludes a tampered manifest, a non-canonical manifest and a corrupt blob", () => {
    const dir = root();
    const zeus = publish(dir, spriteFixture());
    const portrait = portraitFixture();
    publish(dir, portrait);

    writeFileSync(join(dir, "manifests", `${zeus.revision}.json`), "{}");
    let loaded = loadRegistry(dir, vocabulary);
    expect(loaded.problems.map((p) => p.file)).toEqual([
      `manifests/${zeus.revision}.json`,
    ]);

    // Same data, not the canonical text: the revision no longer matches the bytes.
    writeFileSync(
      join(dir, "manifests", `${zeus.revision}.json`),
      JSON.stringify(spriteFixture().manifest, null, 2),
    );
    loaded = loadRegistry(dir, vocabulary);
    expect(loaded.snapshot.entries.has("placeholder-zeus")).toBe(false);
    expect(loaded.snapshot.entries.has("zeus-portrait")).toBe(true);

    writeFileSync(
      join(dir, "blobs", `${portrait.manifest.atlas.blob}.png`),
      "corrupt",
    );
    loaded = loadRegistry(dir, vocabulary);
    expect(loaded.snapshot.entries.size).toBe(0);
    expect(loaded.problems).toHaveLength(2);
  });

  it("reports a missing or corrupt index as a problem with an empty snapshot", () => {
    const dir = root();
    expect(loadRegistry(dir, vocabulary)).toMatchObject({
      snapshot: { entries: new Map() },
      problems: [{ file: "index.json" }],
    });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.json"), "not json");
    const corrupt = loadRegistry(dir, vocabulary);
    expect(corrupt.snapshot.entries.size).toBe(0);
    expect(corrupt.problems[0]?.file).toBe("index.json");
  });

  it("loads an empty committed index without problems", () => {
    const dir = root();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "index.json"),
      '{"entries":[],"schemaVersion":1}\n',
    );
    expect(loadRegistry(dir, vocabulary)).toEqual({
      snapshot: { entries: new Map() },
      problems: [],
    });
  });
});

// The validator against real files: the committed content, and temp content
// roots filled through the real registry publish path.

import { afterEach, describe, expect, it } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAsset, sha256Hex } from "@panthea/assets";
import {
  committedVocabulary,
  type FixtureAsset,
  type FixturePalette,
  paletteFixture,
  portraitFixture,
  spriteFixture,
} from "@panthea/assets/fixtures";
import { loadRegistry, publishAsset } from "@panthea/assets/registry";
import {
  type AssetId,
  type ConformanceReport,
  canonicalJson,
  canonicalManifestText,
  newCandidate,
  transitionAsset,
} from "@panthea/contracts";
import { validateAssets } from "./assets";

const COMMITTED = join(import.meta.dir, "..", "..", "..", "content", "greek");
const vocabulary = committedVocabulary();
const dirs: string[] = [];

/** A content root with the committed gods, vocabulary and subjects and an empty canon. */
function contentRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "assets-validator-"));
  dirs.push(dir);
  cpSync(join(COMMITTED, "gods"), join(dir, "gods"), { recursive: true });
  cpSync(join(COMMITTED, "assets"), join(dir, "assets"), { recursive: true });
  cpSync(join(COMMITTED, "palette"), join(dir, "palette"), { recursive: true });
  return dir;
}

/** Replaces the root's palette files with the fixture palette's. */
function writePalette(root: string, files: FixturePalette["files"]) {
  mkdirSync(join(root, "palette"), { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(root, "palette", name), text);
  }
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const registryOf = (root: string) => join(root, "assets", "registry");
const pass: ConformanceReport = {
  schemaVersion: 1,
  status: "pass",
  checks: [],
};

function publish(root: string, asset: FixtureAsset) {
  const { files, palette } = paletteFixture();
  writePalette(root, files);
  let record = newCandidate(asset.manifest, pass);
  for (const action of [{ type: "pick" }, { type: "approve" }] as const) {
    const next = transitionAsset(record, action);
    if (!next.ok) throw new Error(next.message);
    record = next.value;
  }
  const result = publishAsset(
    registryOf(root),
    record,
    asset.blobs,
    vocabulary,
    palette,
  );
  if (!result.ok) throw new Error(result.message);
  return result.value.revision;
}

function actSprite(ability: string): FixtureAsset {
  const base = spriteFixture();
  const frames = [0, 1, 2, 3].map((i) => ({
    rect: { x: i * 64, y: 0, w: 64, h: 80 },
    durationMs: 90,
  }));
  return {
    blobs: base.blobs,
    manifest: {
      ...base.manifest,
      animations: [
        ...base.manifest.animations,
        { state: "act", direction: "south", ability, frames },
      ],
    },
  };
}

const diagnosticsOf = (root: string) => validateAssets(root).diagnostics;
const files = (root: string) => diagnosticsOf(root).map((d) => d.file);

describe("committed content", () => {
  it("is valid with an empty canon", () => {
    expect(validateAssets(COMMITTED)).toEqual({ ok: true, diagnostics: [] });
  });
});

describe("valid partial canon", () => {
  it("accepts published sprites and portraits with abilities the god has", () => {
    const root = contentRoot();
    publish(root, actSprite("thunderbolt"));
    publish(root, portraitFixture("zeus-portrait", "zeus"));
    expect(validateAssets(root)).toEqual({ ok: true, diagnostics: [] });

    // The same files resolve through the pure lookup: canon where published, placeholder elsewhere.
    const { snapshot } = loadRegistry(registryOf(root), vocabulary);
    expect(
      resolveAsset(snapshot, {
        spriteId: "placeholder-zeus",
        state: "act",
        ability: "thunderbolt",
      }),
    ).toMatchObject({ source: "canon" });
    expect(
      resolveAsset(snapshot, { spriteId: "placeholder-zeus", state: "seated" }),
    ).toMatchObject({ source: "placeholder" });
    expect(
      resolveAsset(snapshot, { spriteId: "zeus-portrait", expression: "awed" }),
    ).toMatchObject({ source: "canon", kind: "portrait" });
  });

  it("accepts a god with a visual profile but no assets (missing states fall back)", () => {
    expect(validateAssets(contentRoot()).ok).toBe(true);
  });
});

describe("the master palette", () => {
  const manifestOf = (revision: string) =>
    `assets/registry/manifests/${revision}.json`;

  it("accepts a draft palette with an empty canon", () => {
    const root = contentRoot();
    writePalette(root, paletteFixture("draft").files);
    expect(validateAssets(root)).toEqual({ ok: true, diagnostics: [] });
  });

  it("reports a missing or malformed palette file", () => {
    const missing = contentRoot();
    rmSync(join(missing, "palette", "palette.json"));
    expect(diagnosticsOf(missing)).toEqual([
      { file: "palette/palette.json", message: "file is missing" },
    ]);

    const malformed = contentRoot();
    writeFileSync(join(malformed, "palette", "master.hex"), "not a colour\n");
    expect(files(malformed)).toEqual(["palette/master.hex"]);
  });

  it("blocks a canon entry when the palette is a draft", () => {
    const root = contentRoot();
    const revision = publish(root, spriteFixture());
    expect(validateAssets(root).ok).toBe(true);
    writePalette(root, paletteFixture("draft").files);
    expect(diagnosticsOf(root)).toEqual([
      {
        file: manifestOf(revision),
        message: expect.stringContaining("draft"),
      },
    ]);
  });

  it("blocks a canon entry whose manifest names another palette", () => {
    const root = contentRoot();
    const revision = publish(root, spriteFixture());
    writePalette(root, paletteFixture("approved", "other-master").files);
    expect(diagnosticsOf(root)).toEqual([
      {
        file: manifestOf(revision),
        message: expect.stringContaining("other-master"),
      },
    ]);
  });
});

describe("broken vocabulary, gods and subjects", () => {
  it("reports a missing or invalid vocabulary", () => {
    const missing = contentRoot();
    rmSync(join(missing, "assets", "vocabulary.json"));
    expect(files(missing)).toEqual(["assets/vocabulary.json"]);

    const invalid = contentRoot();
    writeFileSync(
      join(invalid, "assets", "vocabulary.json"),
      '{"schemaVersion":2}',
    );
    expect(files(invalid)).toEqual(["assets/vocabulary.json"]);
  });

  it("reports a malformed god profile and an invalid or shared sprite id", () => {
    const root = contentRoot();
    const hera = JSON.parse(
      readFileSync(join(root, "gods", "hera.json"), "utf8"),
    );
    writeFileSync(
      join(root, "gods", "hera.json"),
      JSON.stringify({ ...hera, sprite: "Placeholder Hera" }),
    );
    expect(files(root)).toContain("gods/hera.json");

    const shared = contentRoot();
    const athena = JSON.parse(
      readFileSync(join(shared, "gods", "athena.json"), "utf8"),
    );
    writeFileSync(
      join(shared, "gods", "athena.json"),
      JSON.stringify({ ...athena, sprite: "placeholder-zeus" }),
    );
    expect(files(shared)).toEqual(["gods/zeus.json"]);
  });

  it("reports a visual profile for an unknown god, a duplicate, and an unknown family", () => {
    const unknown = contentRoot();
    writeFileSync(
      join(unknown, "assets", "subjects", "apollo.json"),
      JSON.stringify({
        schemaVersion: 1,
        godId: "apollo",
        paletteFamily: "olympus",
        iconography: ["lyre"],
      }),
    );
    expect(files(unknown)).toEqual(["assets/subjects/apollo.json"]);

    const family = contentRoot();
    const zeus = JSON.parse(
      readFileSync(join(family, "assets", "subjects", "zeus.json"), "utf8"),
    );
    writeFileSync(
      join(family, "assets", "subjects", "zeus.json"),
      JSON.stringify({ ...zeus, paletteFamily: "elysium" }),
    );
    expect(files(family)).toEqual(["assets/subjects/zeus.json"]);

    const duplicate = contentRoot();
    cpSync(
      join(duplicate, "assets", "subjects", "zeus.json"),
      join(duplicate, "assets", "subjects", "zeus2.json"),
    );
    expect(files(duplicate)).toEqual(["assets/subjects/zeus2.json"]);
  });
});

describe("broken registry", () => {
  it("reports a missing index", () => {
    const root = contentRoot();
    rmSync(join(registryOf(root), "index.json"));
    expect(files(root)).toEqual(["assets/registry/index.json"]);
  });

  it("reports an unsorted index", () => {
    const root = contentRoot();
    const revision = "a".repeat(64);
    writeFileSync(
      join(registryOf(root), "index.json"),
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          { assetId: "b-two", revision },
          { assetId: "a-one", revision },
        ],
      }),
    );
    expect(files(root)).toEqual(["assets/registry/index.json"]);
  });

  it("reports a manifest whose bytes do not hash to its revision, a non-canonical manifest, and a missing or corrupt blob", () => {
    const root = contentRoot();
    const revision = publish(root, spriteFixture());
    const manifestPath = join(
      registryOf(root),
      "manifests",
      `${revision}.json`,
    );
    const original = readFileSync(manifestPath, "utf8");

    writeFileSync(manifestPath, original.replace("fixture", "tampered"));
    expect(files(root)).toEqual([`assets/registry/manifests/${revision}.json`]);

    writeFileSync(manifestPath, JSON.stringify(JSON.parse(original), null, 2));
    expect(files(root)).toEqual([`assets/registry/manifests/${revision}.json`]);

    writeFileSync(manifestPath, original);
    const blob = join(
      registryOf(root),
      "blobs",
      readdirSync(join(registryOf(root), "blobs"))[0] as string,
    );
    const bytes = readFileSync(blob);
    writeFileSync(blob, "corrupt");
    expect(files(root)).toEqual([
      `assets/registry/blobs/${blob.split("/").pop()}`,
    ]);
    rmSync(blob);
    expect(files(root)).toEqual([
      `assets/registry/blobs/${blob.split("/").pop()}`,
    ]);
    writeFileSync(blob, bytes);
    expect(validateAssets(root).ok).toBe(true);
  });

  it("reports an index revision that points at another asset's manifest", () => {
    const root = contentRoot();
    const zeus = publish(root, spriteFixture());
    publish(root, portraitFixture());
    const index = JSON.parse(
      readFileSync(join(registryOf(root), "index.json"), "utf8"),
    );
    index.entries[1].revision = zeus;
    writeFileSync(
      join(registryOf(root), "index.json"),
      `${canonicalJson(index)}\n`,
    );
    expect(diagnosticsOf(root).map((d) => d.file)).toEqual([
      `assets/registry/manifests/${zeus}.json`,
    ]);
  });
});

describe("source asset revisions", () => {
  /** An older revision of zeus, then a portrait whose provenance names it as a source, with zeus republished since. */
  function withSource() {
    const root = contentRoot();
    const older = publish(root, spriteFixture("placeholder-zeus", 1));
    publish(root, spriteFixture("placeholder-zeus", 2));
    const portrait = portraitFixture();
    const sourced = {
      blobs: portrait.blobs,
      manifest: {
        ...portrait.manifest,
        provenance: {
          ...portrait.manifest.provenance,
          sourceAssets: [
            { assetId: "placeholder-zeus" as AssetId, revision: older },
          ],
        },
      },
    } as FixtureAsset;
    const revision = publish(root, sourced);
    return { root, older, revision };
  }

  it("accepts a source revision that is older than the one the index selects, without any authoring ledger", () => {
    const { root } = withSource();

    expect(diagnosticsOf(root)).toEqual([]);
  });

  it("reports a source revision whose manifest is missing, against the manifest that names it", () => {
    const { root, older, revision } = withSource();
    rmSync(join(registryOf(root), "manifests", `${older}.json`));

    expect(files(root)).toEqual([`assets/registry/manifests/${revision}.json`]);
    expect(diagnosticsOf(root)[0]?.message).toMatch(/source revision/);
  });

  it("reports a source revision that is corrupt, and a source blob that is missing", () => {
    const { root, older, revision } = withSource();
    const manifestFile = join(registryOf(root), "manifests", `${older}.json`);
    const good = readFileSync(manifestFile);
    writeFileSync(manifestFile, "{}");
    expect(files(root)).toEqual([`assets/registry/manifests/${revision}.json`]);
    writeFileSync(manifestFile, good);
    expect(diagnosticsOf(root)).toEqual([]);

    const blob = spriteFixture("placeholder-zeus", 1).manifest.atlas.blob;
    rmSync(join(registryOf(root), "blobs", `${blob}.png`));
    expect(files(root)).toEqual([`assets/registry/manifests/${revision}.json`]);
  });

  it("reports a source revision of an asset the registry never had", () => {
    const root = contentRoot();
    const portrait = portraitFixture();
    publish(root, {
      blobs: portrait.blobs,
      manifest: {
        ...portrait.manifest,
        provenance: {
          ...portrait.manifest.provenance,
          sourceAssets: [
            {
              assetId: "never-published" as AssetId,
              revision: "b".repeat(64) as never,
            },
          ],
        },
      },
    } as FixtureAsset);

    expect(diagnosticsOf(root)).toHaveLength(1);
  });
});

describe("a blob that is only a PNG header", () => {
  it("is reported against the blob file, not accepted", () => {
    const root = contentRoot();
    const [full] = [...spriteFixture().blobs.values()];
    const bytes = (full as Uint8Array).slice(0, 29);
    const hash = sha256Hex(bytes);
    const manifest = {
      ...spriteFixture().manifest,
      atlas: { blob: hash, width: 256, height: 80 },
    };
    const text = new TextEncoder().encode(canonicalManifestText(manifest));
    const revision = sha256Hex(text);
    const registry = registryOf(root);
    mkdirSync(join(registry, "blobs"), { recursive: true });
    mkdirSync(join(registry, "manifests"), { recursive: true });
    writeFileSync(join(registry, "blobs", `${hash}.png`), bytes);
    writeFileSync(join(registry, "manifests", `${revision}.json`), text);
    writeFileSync(
      join(registry, "index.json"),
      `${canonicalJson({ schemaVersion: 1, entries: [{ assetId: "placeholder-zeus", revision }] })}\n`,
    );
    const result = validateAssets(root);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.file)).toEqual([
      `assets/registry/blobs/${hash}.png`,
    ]);
  });
});

describe("cross references", () => {
  it("reports an ability the owning god does not have", () => {
    const root = contentRoot();
    publish(root, actSprite("lightning"));
    const [diagnostic] = diagnosticsOf(root);
    expect(diagnostic?.file).toMatch(
      /^assets\/registry\/manifests\/[0-9a-f]{64}\.json$/,
    );
    expect(diagnostic?.message).toContain("lightning");
  });

  it("reports an ability on an asset no god owns", () => {
    const root = contentRoot();
    const base = actSprite("thunderbolt");
    publish(root, {
      ...base,
      manifest: { ...base.manifest, id: "stray-sprite" as AssetId },
    });
    expect(diagnosticsOf(root)).toHaveLength(1);
  });

  it("reports a god's stable sprite id published as another kind", () => {
    const root = contentRoot();
    publish(root, portraitFixture("placeholder-zeus", "zeus"));
    expect(diagnosticsOf(root)).toHaveLength(1);
  });

  it("reports a portrait for an unknown character", () => {
    const root = contentRoot();
    publish(root, portraitFixture("someone-portrait", "nobody"));
    expect(diagnosticsOf(root)).toHaveLength(1);
  });

  it("reports a mapped portrait id that resolves to the wrong kind or character", () => {
    const root = contentRoot();
    const zeus = JSON.parse(
      readFileSync(join(root, "assets", "subjects", "zeus.json"), "utf8"),
    );
    mkdirSync(join(root, "assets", "subjects"), { recursive: true });
    writeFileSync(
      join(root, "assets", "subjects", "zeus.json"),
      JSON.stringify({ ...zeus, portrait: "zeus-portrait" }),
    );
    publish(root, portraitFixture("zeus-portrait", "hera"));
    expect(diagnosticsOf(root)).toHaveLength(1);
  });
});

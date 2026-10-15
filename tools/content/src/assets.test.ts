// The validator against real files: the committed content, and temp content
// roots filled through the real registry publish path.

import { afterEach, describe, expect, it } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  encodeRgbaPng,
  paletteDigest,
  parsePalette,
  resolveAsset,
  sha256Hex,
} from "@panthea/assets";
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
  parseAssetManifest,
  type Sha256,
  transitionAsset,
} from "@panthea/contracts";
import { tileFixture } from "../../../packages/assets/test/fixtures/tile";
import { validateAssets } from "./assets";

const COMMITTED = join(import.meta.dir, "..", "..", "..", "content", "greek");
const vocabulary = committedVocabulary();
const dirs: string[] = [];

/**
 * A content root with the committed gods, vocabulary, palette and subjects, an
 * empty canon and no subject portrait mappings. The committed registry and the
 * mappings that point into it are left out, so every scenario starts from the
 * same state however much has been published to `content/greek`: a god whose
 * stable sprite id is published there gets its `placeholder-<id>` id back, and
 * a subject loses its portrait.
 */
function contentRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "assets-validator-"));
  dirs.push(dir);
  const committedRegistry = join(COMMITTED, "assets", "registry");
  cpSync(join(COMMITTED, "gods"), join(dir, "gods"), { recursive: true });
  cpSync(join(COMMITTED, "assets"), join(dir, "assets"), {
    recursive: true,
    filter: (source) => source !== committedRegistry,
  });
  cpSync(join(COMMITTED, "palette"), join(dir, "palette"), { recursive: true });
  mkdirSync(registryOf(dir), { recursive: true });
  writeFileSync(
    join(registryOf(dir), "index.json"),
    `${JSON.stringify({ schemaVersion: 1, entries: [] }, null, 2)}\n`,
  );
  const published = new Set(
    (
      JSON.parse(
        readFileSync(join(committedRegistry, "index.json"), "utf8"),
      ) as { entries: { assetId: string }[] }
    ).entries.map((entry) => entry.assetId),
  );
  for (const name of readdirSync(join(dir, "gods"))) {
    const path = join(dir, "gods", name);
    const god = JSON.parse(readFileSync(path, "utf8"));
    if (!published.has(god.sprite)) continue;
    writeFileSync(
      path,
      `${JSON.stringify({ ...god, sprite: `placeholder-${god.id}` }, null, 2)}\n`,
    );
  }
  writeInhabitants(dir, [
    { id: "woodcutter", sprite: "placeholder-woodcutter" },
    { id: "farmer", sprite: "placeholder-farmer" },
    { id: "zeus", deity: true },
  ]);
  const subjects = join(dir, "assets", "subjects");
  for (const name of readdirSync(subjects)) {
    const { portrait: _mapped, ...subject } = JSON.parse(
      readFileSync(join(subjects, name), "utf8"),
    );
    writeFileSync(
      join(subjects, name),
      `${JSON.stringify(subject, null, 2)}\n`,
    );
  }
  return dir;
}

/** Replaces the root's inhabitants file with `inhabitants`: the fields the validator reads, never the committed cast. */
function writeInhabitants(
  root: string,
  inhabitants: readonly Record<string, unknown>[],
) {
  mkdirSync(join(root, "world"), { recursive: true });
  writeFileSync(
    join(root, "world", "inhabitants.json"),
    `${JSON.stringify({ inhabitants }, null, 2)}\n`,
  );
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
  it("is valid with the published canon", () => {
    expect(validateAssets(COMMITTED)).toEqual({ ok: true, diagnostics: [] });
  });

  it("resolves each mapped subject portrait to a published portrait", () => {
    const { snapshot } = loadRegistry(
      join(COMMITTED, "assets", "registry"),
      vocabulary,
    );
    const subjects = join(COMMITTED, "assets", "subjects");
    for (const name of readdirSync(subjects)) {
      const { portrait } = JSON.parse(
        readFileSync(join(subjects, name), "utf8"),
      );
      if (portrait === undefined) continue;
      expect(
        resolveAsset(snapshot, { spriteId: portrait, expression: "neutral" }),
      ).toMatchObject({ source: "canon", kind: "portrait" });
    }
  });

  it("resolves each god's published stable sprite to a canon sprite", () => {
    const { snapshot } = loadRegistry(
      join(COMMITTED, "assets", "registry"),
      vocabulary,
    );
    const gods = join(COMMITTED, "gods");
    const resolved = readdirSync(gods).flatMap((name) => {
      const { sprite } = JSON.parse(readFileSync(join(gods, name), "utf8"));
      return snapshot.entries.has(sprite)
        ? [[sprite, resolveAsset(snapshot, { spriteId: sprite })] as const]
        : [];
    });
    expect(resolved.map(([sprite]) => sprite)).toEqual(["zeus-retro"]);
    for (const [, result] of resolved)
      expect(result).toMatchObject({ source: "canon", kind: "sprite" });
  });

  it("has an empty-canon fixture tree: no published asset and no portrait mapping", () => {
    const root = contentRoot();
    expect(
      JSON.parse(readFileSync(join(registryOf(root), "index.json"), "utf8")),
    ).toEqual({ schemaVersion: 1, entries: [] });
    expect(readdirSync(registryOf(root))).toEqual(["index.json"]);
    const zeus = JSON.parse(
      readFileSync(join(root, "assets", "subjects", "zeus.json"), "utf8"),
    );
    expect(zeus).not.toHaveProperty("portrait");
    expect(
      JSON.parse(readFileSync(join(root, "gods", "zeus.json"), "utf8")).sprite,
    ).toBe("placeholder-zeus");
    expect(zeus).toMatchObject({ godId: "zeus", paletteFamily: "olympus" });
    expect(validateAssets(root)).toEqual({ ok: true, diagnostics: [] });
  });
});

describe("subject asymmetry", () => {
  const subjectFile = (root: string) =>
    join(root, "assets", "subjects", "zeus.json");
  const declare = (root: string, asymmetry: unknown) => {
    const zeus = JSON.parse(readFileSync(subjectFile(root), "utf8"));
    writeFileSync(subjectFile(root), JSON.stringify({ ...zeus, asymmetry }));
  };
  const asymmetric = (feature: string): FixtureAsset => {
    const base = spriteFixture();
    return {
      blobs: base.blobs,
      manifest: { ...base.manifest, asymmetry: { feature } },
    };
  };

  it("is declared on the committed Zeus subject and validates", () => {
    const committed = JSON.parse(readFileSync(subjectFile(COMMITTED), "utf8"));
    expect(committed.asymmetry).toEqual({
      feature: "left-shoulder himation",
    });
    expect(validateAssets(COMMITTED)).toEqual({ ok: true, diagnostics: [] });
  });

  it("accepts a declared subject whose published sprite predates the declaration", () => {
    const root = contentRoot();
    declare(root, { feature: "bolt hand" });
    publish(root, spriteFixture());
    expect(validateAssets(root)).toEqual({ ok: true, diagnostics: [] });
  });

  it("accepts a published sprite that carries the subject's feature", () => {
    const root = contentRoot();
    declare(root, { feature: "bolt hand" });
    publish(root, asymmetric("bolt hand"));
    expect(validateAssets(root)).toEqual({ ok: true, diagnostics: [] });
  });

  it("reports a malformed declaration against the subject file", () => {
    for (const bad of [{ feature: "" }, {}, "bolt hand", { feature: 1 }]) {
      const root = contentRoot();
      declare(root, bad);
      expect(files(root)).toEqual(["assets/subjects/zeus.json"]);
    }
  });

  it("reports a published sprite whose asymmetry is not the subject's", () => {
    const root = contentRoot();
    declare(root, { feature: "bolt hand" });
    const revision = publish(root, asymmetric("left hand"));
    expect(diagnosticsOf(root)).toEqual([
      {
        file: `assets/registry/manifests/${revision}.json`,
        message: expect.stringContaining('"bolt hand"'),
      },
    ]);
    expect(diagnosticsOf(root)[0]?.message).toContain('"left hand"');
  });

  it("reports a published sprite that declares asymmetry its subject does not", () => {
    const root = contentRoot();
    declare(root, undefined);
    publish(root, asymmetric("bolt hand"));
    const found = diagnosticsOf(root);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("declares no asymmetry");
  });
});

describe("inhabitant sprite ids", () => {
  const woodcutter = (sprite: unknown) => [
    { id: "woodcutter", sprite },
    { id: "zeus", deity: true },
  ];

  it("accepts every committed inhabitant's sprite id as canon or a placeholder", () => {
    const { snapshot } = loadRegistry(
      join(COMMITTED, "assets", "registry"),
      vocabulary,
    );
    const { inhabitants } = JSON.parse(
      readFileSync(join(COMMITTED, "world", "inhabitants.json"), "utf8"),
    ) as { inhabitants: { id: string; deity?: boolean; sprite?: string }[] };
    const mortals = inhabitants.filter((inhabitant) => !inhabitant.deity);
    expect(mortals.length).toBeGreaterThan(0);
    for (const mortal of mortals) {
      expect(mortal.sprite).toBe(`placeholder-${mortal.id}`);
      expect(snapshot.entries.has(mortal.sprite ?? "")).toBe(false);
    }
  });

  it("accepts a placeholder id and ignores deity inhabitants, whose sprite is their profile's", () => {
    const root = contentRoot();
    writeInhabitants(root, woodcutter("placeholder-woodcutter"));
    expect(validateAssets(root)).toEqual({ ok: true, diagnostics: [] });
  });

  it("accepts a canon sprite id that is published in the registry", () => {
    const root = contentRoot();
    publish(root, spriteFixture("woodcutter-sprite"));
    writeInhabitants(root, woodcutter("woodcutter-sprite"));
    expect(validateAssets(root)).toEqual({ ok: true, diagnostics: [] });
  });

  it("flags an id that is neither published nor a placeholder", () => {
    const root = contentRoot();
    writeInhabitants(root, woodcutter("woodcutter-sprite"));
    expect(diagnosticsOf(root)).toEqual([
      {
        file: "world/inhabitants.json",
        message: expect.stringContaining('"woodcutter-sprite"'),
      },
    ]);
    expect(diagnosticsOf(root)[0]?.message).toContain("woodcutter");
  });

  it("flags an id that is not a valid asset id, and a missing or non-string sprite", () => {
    for (const sprite of ["Placeholder Woodcutter", "", 7, undefined]) {
      const root = contentRoot();
      writeInhabitants(root, woodcutter(sprite));
      expect(files(root)).toEqual(["world/inhabitants.json"]);
    }
  });

  it("flags a published id whose manifest is not a sprite", () => {
    const root = contentRoot();
    publish(root, portraitFixture("woodcutter-face", "zeus"));
    writeInhabitants(root, woodcutter("woodcutter-face"));
    const found = diagnosticsOf(root).filter(
      (diagnostic) => diagnostic.file === "world/inhabitants.json",
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("portrait");
  });

  it("flags a missing or malformed inhabitants file", () => {
    const missing = contentRoot();
    rmSync(join(missing, "world", "inhabitants.json"));
    expect(diagnosticsOf(missing)).toEqual([
      { file: "world/inhabitants.json", message: "file is missing" },
    ]);

    const malformed = contentRoot();
    writeFileSync(join(malformed, "world", "inhabitants.json"), '{"nope":1}');
    expect(files(malformed)).toEqual(["world/inhabitants.json"]);
  });

  it("uses the isolated fixture registry, never the committed canon", () => {
    // zeus-sprite is published in the committed canon; the fixture's registry is empty.
    const root = contentRoot();
    writeInhabitants(root, woodcutter("zeus-sprite"));
    expect(files(root)).toEqual(["world/inhabitants.json"]);
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

describe("the palette set", () => {
  const RETRO_DIR = (root: string) => join(root, "palette", "greek-retro");
  const manifestOf = (revision: string) =>
    `assets/registry/manifests/${revision}.json`;
  const retroFile = (root: string) => join(RETRO_DIR(root), "palette.json");

  /** The committed greek-retro, approved against its own current digest, on disk under `root` and as a palette. */
  function approveRetro(root: string) {
    const json = JSON.parse(readFileSync(retroFile(root), "utf8"));
    const draft = parsePalette(
      {
        json,
        gpl: readFileSync(join(RETRO_DIR(root), "master.gpl"), "utf8"),
        hex: readFileSync(join(RETRO_DIR(root), "master.hex"), "utf8"),
      },
      vocabulary.paletteFamilies,
    );
    if (!draft.ok) throw new Error(draft.message);
    const approval = { status: "approved", digest: paletteDigest(draft.value) };
    writeFileSync(retroFile(root), JSON.stringify({ ...json, approval }));
    const approved = parsePalette(
      {
        json: JSON.parse(readFileSync(retroFile(root), "utf8")),
        gpl: readFileSync(join(RETRO_DIR(root), "master.gpl"), "utf8"),
        hex: readFileSync(join(RETRO_DIR(root), "master.hex"), "utf8"),
      },
      vocabulary.paletteFamilies,
    );
    if (!approved.ok) throw new Error(approved.message);
    return approved.value;
  }

  /** A fixture sprite published under the retro palette. */
  function publishOnRetro(root: string): string {
    const palette = approveRetro(root);
    const asset = spriteFixture("zeus-retro");
    const manifest = { ...asset.manifest, paletteId: "greek-retro" };
    let record = newCandidate(manifest, pass);
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

  it("accepts the committed set: greek-master approved, greek-retro a draft that backs no canon", () => {
    expect(validateAssets(COMMITTED)).toEqual({ ok: true, diagnostics: [] });
  });

  it("checks each canon entry against the palette its manifest names: an approved greek-retro backs a retro asset", () => {
    const root = contentRoot();
    publishOnRetro(root);
    expect(validateAssets(root)).toEqual({ ok: true, diagnostics: [] });
  });

  it("blocks a retro canon entry once greek-retro is a draft again, and the same entry passes while it is approved", () => {
    const root = contentRoot();
    const revision = publishOnRetro(root);
    expect(validateAssets(root).ok).toBe(true);
    const json = JSON.parse(readFileSync(retroFile(root), "utf8"));
    writeFileSync(
      retroFile(root),
      JSON.stringify({ ...json, approval: { status: "draft" } }),
    );
    const found = diagnosticsOf(root);
    expect(found).toEqual([
      { file: manifestOf(revision), message: expect.stringContaining("draft") },
    ]);
    expect(found[0]?.message).toContain("greek-retro");
  });

  it("blocks a retro canon entry whose palette limits were edited after approval", () => {
    const root = contentRoot();
    publishOnRetro(root);
    const json = JSON.parse(readFileSync(retroFile(root), "utf8"));
    json.limits.colours.sprite = 64;
    writeFileSync(retroFile(root), JSON.stringify(json));
    expect(diagnosticsOf(root)).toEqual([
      {
        file: "palette/greek-retro/palette.json",
        message: expect.stringContaining("approval.digest"),
      },
    ]);
  });

  it("reports a manifest whose palette is among none of the palettes, naming those there are", () => {
    const root = contentRoot();
    const asset = spriteFixture("zeus-retro");
    const palette = paletteFixture("approved", "greek-ancient");
    let record = newCandidate(
      { ...asset.manifest, paletteId: "greek-ancient" },
      pass,
    );
    for (const action of [{ type: "pick" }, { type: "approve" }] as const) {
      const next = transitionAsset(record, action);
      if (!next.ok) throw new Error(next.message);
      record = next.value;
    }
    const published = publishAsset(
      registryOf(root),
      record,
      asset.blobs,
      vocabulary,
      palette.palette,
    );
    if (!published.ok) throw new Error(published.message);
    // The palettes on disk are greek-master (the root) and greek-retro; greek-ancient was only ever used to publish.
    const found = diagnosticsOf(root);
    expect(found.map((d) => d.file)).toEqual([
      manifestOf(published.value.revision),
    ]);
    expect(found[0]?.message).toContain('"greek-ancient"');
    expect(found[0]?.message).toContain("greek-retro");
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

describe("the promoted Zeus", () => {
  const { snapshot } = loadRegistry(
    join(COMMITTED, "assets", "registry"),
    vocabulary,
  );

  it("points Zeus's stable sprite at the published rendered revision, 12 slots on the god-tall cell", () => {
    const god = JSON.parse(
      readFileSync(join(COMMITTED, "gods", "zeus.json"), "utf8"),
    );
    expect(god.sprite).toBe("zeus-retro");
    const retro = snapshot.entries.get("zeus-retro");
    expect(String(retro?.revision)).toBe(
      "f254faa3c1fc6fe0ca2ac2b1f88d9556f9dfdd134b4ad9241f77a5fb37369fa6",
    );
    const manifest = retro?.manifest;
    if (manifest === undefined || manifest.kind !== "sprite")
      throw new Error("zeus-retro is not a published sprite");
    expect(String(manifest.atlas.blob)).toBe(
      "fe9fdb0846e8e25042f76ca67ba28650a0cf6141a0c6654e0946e4cb4f5c0cc4",
    );
    expect(manifest.cell).toEqual({ w: 112, h: 96 });
    expect(manifest.pivot).toEqual({ x: 56, y: 78 });
    expect(manifest.animations).toHaveLength(12);
    expect(manifest.provenance.method).toBe("rendered");
    if (manifest.provenance.method !== "rendered")
      throw new Error("not rendered");
    expect(manifest.provenance.slots).toHaveLength(12);
    expect(manifest.asymmetry).toEqual({ feature: "left-shoulder himation" });
  });

  it("keeps zeus-sprite published and resolvable, so an actor created before promotion still draws it", () => {
    const before = snapshot.entries.get("zeus-sprite");
    expect(before?.manifest.kind).toBe("sprite");
    expect(resolveAsset(snapshot, { spriteId: "zeus-sprite" })).toMatchObject({
      source: "canon",
      kind: "sprite",
    });
    expect(
      resolveAsset(snapshot, {
        spriteId: "zeus-retro",
        state: "walk",
        direction: "west",
      }),
    ).toMatchObject({ source: "canon", kind: "sprite" });
    const subject = JSON.parse(
      readFileSync(join(COMMITTED, "assets", "subjects", "zeus.json"), "utf8"),
    );
    expect(subject.legacySprites).toEqual(["zeus-sprite"]);
  });
});

describe("cross references", () => {
  it("accepts an ability on a sprite its god lists as legacy, and still refuses one that is not the god's", () => {
    const root = contentRoot();
    const subjectFile = join(root, "assets", "subjects", "zeus.json");
    const subject = JSON.parse(readFileSync(subjectFile, "utf8"));
    const legacy = (id: string) => {
      const base = actSprite("thunderbolt");
      return { ...base, manifest: { ...base.manifest, id: id as AssetId } };
    };
    // Positive control: unlisted, the ability on an ownerless sprite is refused.
    publish(root, legacy("old-zeus-sprite"));
    expect(diagnosticsOf(root)).toHaveLength(1);
    // Listed as Zeus's legacy sprite, it validates.
    writeFileSync(
      subjectFile,
      JSON.stringify({ ...subject, legacySprites: ["old-zeus-sprite"] }),
    );
    expect(diagnosticsOf(root)).toEqual([]);
    // An ability Zeus does not have is still refused on a legacy sprite.
    const other = contentRoot();
    writeFileSync(
      join(other, "assets", "subjects", "zeus.json"),
      JSON.stringify({ ...subject, legacySprites: ["old-zeus-sprite"] }),
    );
    publish(other, {
      ...legacy("old-zeus-sprite"),
      manifest: {
        ...actSprite("lightning").manifest,
        id: "old-zeus-sprite" as AssetId,
      },
    });
    expect(diagnosticsOf(other)).toHaveLength(1);
  });

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

const REPO_ROOT = join(COMMITTED, "..", "..");

/**
 * A repository root holding only tools/render with one kit (a single `.bin` that the profile
 * "fixture" references) plus the given Python files, so the render checks start from known state.
 */
function renderRepo(
  options: {
    readonly spdx?: string;
    readonly ownerAssessment?: object;
    readonly python?: Readonly<Record<string, string>>;
  } = {},
): string {
  const root = mkdtempSync(join(tmpdir(), "assets-render-"));
  dirs.push(root);
  const kitDir = join(root, "tools", "render", "kits", "pack-a");
  mkdirSync(kitDir, { recursive: true });
  const licence = new TextEncoder().encode("CC0 text");
  const body = new TextEncoder().encode("BIN!");
  writeFileSync(join(kitDir, "LICENCE.txt"), licence);
  writeFileSync(join(kitDir, "Body.bin"), body);
  writeFileSync(
    join(root, "tools", "render", "kits.json"),
    JSON.stringify({
      schemaVersion: 1,
      sizeCapBytes: 1000,
      kits: [
        {
          id: "pack-a",
          sourceUrl: "https://example.invalid/pack-a",
          licence: {
            spdx: options.spdx ?? "CC0-1.0",
            ...(options.ownerAssessment === undefined
              ? {}
              : { ownerAssessment: options.ownerAssessment }),
          },
          licenceFile: { path: "LICENCE.txt", sha256: sha256Hex(licence) },
          status: "inspected-not-used",
          textureSkip: [],
          files: [
            {
              path: "Body.bin",
              sha256: sha256Hex(body),
              size: body.length,
              referencedBy: ["fixture"],
            },
          ],
        },
      ],
    }),
  );
  mkdirSync(join(root, "tools", "render", "stamps"), { recursive: true });
  writeFileSync(
    join(root, "tools", "render", "stamps", "stamps.json"),
    JSON.stringify({ schemaVersion: 1, sets: [] }),
  );
  for (const [name, text] of Object.entries(options.python ?? {})) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}

/** A render repository holding a copy of the committed stamp set. */
function stampRepo(): string {
  const root = renderRepo();
  const stamps = join(root, "tools", "render", "stamps");
  rmSync(stamps, { recursive: true, force: true });
  cpSync(join(REPO_ROOT, "tools", "render", "stamps"), stamps, {
    recursive: true,
  });
  return root;
}

const FIXTURE_PROFILE = {
  profile: "fixture",
  files: [{ kit: "pack-a", path: "Body.bin" }],
};

describe("render kits and the licence boundary", () => {
  it("passes the committed repository", () => {
    expect(validateAssets(COMMITTED, { repoRoot: REPO_ROOT })).toEqual({
      ok: true,
      diagnostics: [],
    });
  });

  it("runs the render checks only when asked, so a content-only root is untouched", () => {
    expect(validateAssets(contentRoot()).diagnostics).toEqual([]);
  });

  it("passes a fixture profile that references an assessed kit file", () => {
    const repoRoot = renderRepo();
    expect(
      validateAssets(contentRoot(), {
        repoRoot,
        kitProfiles: [FIXTURE_PROFILE],
      }).diagnostics,
    ).toEqual([]);
  });

  it("refuses a fixture profile that references an unassessed kit file, with the same file passing once assessed", () => {
    const refused = validateAssets(contentRoot(), {
      repoRoot: renderRepo({ spdx: "CC-BY-4.0" }),
      kitProfiles: [FIXTURE_PROFILE],
    });
    expect(refused.ok).toBe(false);
    expect(refused.diagnostics).toHaveLength(1);
    expect(refused.diagnostics[0]?.file).toBe(
      "tools/render/kits/pack-a/Body.bin",
    );
    expect(refused.diagnostics[0]?.message).toContain("ownerAssessment");

    const assessed = validateAssets(contentRoot(), {
      repoRoot: renderRepo({
        spdx: "CC-BY-4.0",
        ownerAssessment: {
          by: "owner",
          date: "2026-10-12",
          summary: "Reviewed.",
        },
      }),
      kitProfiles: [FIXTURE_PROFILE],
    });
    expect(assessed.diagnostics).toEqual([]);
  });

  it("refuses a missing stamp file and a stamp whose hash differs, and passes the unbroken stamp set", () => {
    const intact = stampRepo();
    expect(
      validateAssets(contentRoot(), { repoRoot: intact, kitProfiles: [] })
        .diagnostics,
    ).toEqual([]);

    const missing = stampRepo();
    rmSync(
      join(missing, "tools", "render", "stamps", "zeus", "face-south-r.png"),
    );
    const refusedMissing = validateAssets(contentRoot(), {
      repoRoot: missing,
      kitProfiles: [],
    });
    expect(refusedMissing.ok).toBe(false);
    expect(refusedMissing.diagnostics).toEqual([
      {
        file: "tools/render/stamps/zeus/face-south-r.png",
        message: expect.stringContaining("missing"),
      },
    ]);

    // No prop stamps: a bolt stamp file left on disk is refused as unlisted.
    const stray = stampRepo();
    writeFileSync(
      join(stray, "tools", "render", "stamps", "zeus", "bolt-000.png"),
      "a prop stamp",
    );
    expect(
      validateAssets(contentRoot(), { repoRoot: stray, kitProfiles: [] })
        .diagnostics,
    ).toEqual([
      {
        file: "tools/render/stamps/zeus/bolt-000.png",
        message: expect.stringContaining("not in stamps.json"),
      },
    ]);

    const changed = stampRepo();
    writeFileSync(
      join(changed, "tools", "render", "stamps", "zeus", "face-east-near.png"),
      "not the stamp",
    );
    const refusedHash = validateAssets(contentRoot(), {
      repoRoot: changed,
      kitProfiles: [],
    });
    expect(refusedHash.ok).toBe(false);
    expect(refusedHash.diagnostics).toEqual([
      {
        file: "tools/render/stamps/zeus/face-east-near.png",
        message: expect.stringContaining("sha256"),
      },
    ]);
  });

  it("refuses a render root without stamps.json", () => {
    const repoRoot = renderRepo();
    rmSync(join(repoRoot, "tools", "render", "stamps"), { recursive: true });
    const result = validateAssets(contentRoot(), { repoRoot, kitProfiles: [] });
    expect(result.diagnostics).toEqual([
      {
        file: "tools/render/stamps/stamps.json",
        message: expect.stringContaining("missing"),
      },
    ]);
  });

  it("refuses a Python file that imports a Blender module without the GPL header", () => {
    const repoRoot = renderRepo({
      python: { "tools/x/tool.py": "import bpy_extras\n" },
    });
    const result = validateAssets(contentRoot(), {
      repoRoot,
      kitProfiles: [],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      {
        file: "tools/x/tool.py",
        message: expect.stringContaining("bpy_extras"),
      },
    ]);
  });

  it("passes the same Python file under the GPL header", () => {
    const repoRoot = renderRepo({
      python: {
        "tools/x/tool.py":
          "# SPDX-License-Identifier: GPL-3.0-or-later\nimport bpy_extras\n",
      },
    });
    expect(
      validateAssets(contentRoot(), { repoRoot, kitProfiles: [] }).diagnostics,
    ).toEqual([]);
  });
});

// biome-ignore lint/suspicious/noExplicitAny: the tests edit an untyped JSON document
type Json = any;

describe("structures", () => {
  const renderCopy = (): string => {
    const root = mkdtempSync(join(tmpdir(), "assets-structures-"));
    dirs.push(root);
    cpSync(join(REPO_ROOT, "tools", "render"), join(root, "tools", "render"), {
      recursive: true,
      filter: (source) => !source.includes(`${"/"}scratch`),
    });
    return root;
  };
  const editJson = (path: string, change: (json: Json) => void) => {
    const json = JSON.parse(readFileSync(path, "utf8"));
    change(json);
    writeFileSync(path, JSON.stringify(json));
  };
  const subjectFile = (root: string) =>
    join(root, "assets", "structures", "greek-house.json");
  const profileFile = (root: string) =>
    join(root, "tools", "render", "profiles", "greek-house.json");
  const diagnostics = (content: string, repo?: string) =>
    validateAssets(content, repo === undefined ? {} : { repoRoot: repo })
      .diagnostics;

  it("passes the committed structures with their profiles and the vocabulary", () => {
    expect(diagnostics(contentRoot(), renderCopy())).toEqual([]);
  });

  it("refuses a subject whose id is a god's, and one in an unknown palette family", () => {
    const clash = contentRoot();
    editJson(subjectFile(clash), (s) => {
      s.id = "zeus";
    });
    expect(diagnostics(clash).map((d) => d.file)).toEqual([
      "assets/structures/greek-house.json",
    ]);
    const family = contentRoot();
    editJson(subjectFile(family), (s) => {
      s.paletteFamily = "atlantis";
    });
    expect(diagnostics(family).map((d) => d.file)).toEqual([
      "assets/structures/greek-house.json",
    ]);
  });

  it("refuses a matrix the vocabulary cannot honour", () => {
    const root = contentRoot();
    editJson(subjectFile(root), (s) => {
      s.render.matrix.cellClass = "portrait";
    });
    const found = diagnostics(root);
    expect(found.map((d) => d.file)).toEqual([
      "assets/structures/greek-house.json",
    ]);
    expect(found[0]?.message).toContain("neither sprites nor tiles");
  });

  it("refuses a profile that does not exist, and a figure profile", () => {
    const missing = contentRoot();
    editJson(subjectFile(missing), (s) => {
      s.render.profile = "greek-barn";
    });
    const found = diagnostics(missing, renderCopy());
    expect(found).toHaveLength(1);
    expect(found[0]?.file).toBe("assets/structures/greek-house.json");
    expect(found[0]?.message).toContain("greek-barn");

    const figure = contentRoot();
    editJson(subjectFile(figure), (s) => {
      s.render.profile = "zeus";
    });
    const refused = diagnostics(figure, renderCopy());
    expect(refused).toHaveLength(1);
    expect(refused[0]?.message).toContain("not a structure");
  });

  it("refuses a profile whose cell is not the vocabulary's cell for the matrix's class", () => {
    const repo = renderCopy();
    editJson(profileFile(repo), (p) => {
      p.cell.width = 184;
      p.cell.pivot = [92, 136];
    });
    const found = diagnostics(contentRoot(), repo);
    expect(found).toHaveLength(1);
    expect(found[0]?.file).toBe("tools/render/profiles/greek-house.json");
    expect(found[0]?.message).toContain("cell");
    expect(found[0]?.message).toContain("192x192");
  });

  it("accepts the ground set's profile with no kit files, and holds a ground build to the tile cell", () => {
    const root = contentRoot();
    const ground = join(root, "assets", "structures", "grass-flagstone.json");
    expect(existsSync(ground)).toBe(true);
    expect(diagnostics(root, renderCopy())).toEqual([]);
    const groundProfile = JSON.parse(
      readFileSync(
        join(REPO_ROOT, "tools", "render", "profiles", "grass-flagstone.json"),
        "utf8",
      ),
    );
    expect(groundProfile.kitFiles).toEqual([]);

    const onSprites = contentRoot();
    editJson(
      join(onSprites, "assets", "structures", "grass-flagstone.json"),
      (s) => {
        s.render.matrix.cellClass = "structure";
        s.render.matrix.required = [{ state: "intact" }];
      },
    );
    const refused = diagnostics(onSprites, renderCopy());
    expect(refused).toHaveLength(1);
    expect(refused[0]?.message).toContain("ground build");

    const house = contentRoot();
    editJson(subjectFile(house), (s) => {
      s.render.matrix.cellClass = "tile";
      s.render.matrix.required = [{ state: "base" }];
    });
    const other = diagnostics(house, renderCopy());
    expect(other).toHaveLength(1);
    expect(other[0]?.message).toContain("ground build");
  });

  it("refuses a profile with no clip for a state its subject requires, or with frames the vocabulary does not allow", () => {
    const missing = renderCopy();
    editJson(profileFile(missing), (p) => {
      delete p.clips.ruin;
    });
    const gone = diagnostics(contentRoot(), missing);
    expect(gone).toHaveLength(1);
    expect(gone[0]?.message).toContain("ruin");

    const many = renderCopy();
    editJson(profileFile(many), (p) => {
      p.clips.intact.loop = true;
      p.clips.intact.frames = 17;
      p.clips.intact.frameMs = 100;
      p.wind = { amplitudeM: 0.1, lag: 1, cycles: 1, swirl: 0.4 };
    });
    const frames = diagnostics(contentRoot(), many);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.message).toContain("frames");
  });

  it("refuses a clip timing outside the vocabulary's frame rate", () => {
    const repo = renderCopy();
    editJson(profileFile(repo), (p) => {
      p.clips.intact.frameMs = 10;
    });
    const found = diagnostics(contentRoot(), repo);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("ms");
  });
});

describe("render profiles and the camera", () => {
  /** A repository root holding a copy of the committed tools/render (kits, profiles, camera, script). */
  function renderCopy(): string {
    const root = mkdtempSync(join(tmpdir(), "assets-render-copy-"));
    dirs.push(root);
    cpSync(join(REPO_ROOT, "tools", "render"), join(root, "tools", "render"), {
      recursive: true,
      filter: (source) => !source.includes(`${"/"}scratch`),
    });
    return root;
  }
  const profilePath = (root: string) =>
    join(root, "tools", "render", "profiles", "zeus.json");
  const kitsPath = (root: string) => join(root, "tools", "render", "kits.json");
  const editJson = (path: string, change: (json: Json) => void) => {
    const json = JSON.parse(readFileSync(path, "utf8"));
    change(json);
    writeFileSync(path, JSON.stringify(json));
  };
  const run = (root: string) =>
    validateAssets(contentRoot(), { repoRoot: root }).diagnostics;

  it("passes the committed profile, camera and kits together", () => {
    expect(run(renderCopy())).toEqual([]);
  });

  it("refuses a profile naming a kit file that kits.json does not list", () => {
    const root = renderCopy();
    editJson(profilePath(root), (p) => {
      p.kitFiles.push({
        kit: "universal-base-characters",
        path: "Missing.gltf",
        sha256: "0".repeat(64),
      });
    });
    const diagnostics = run(root);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("Missing.gltf"))).toBe(
      true,
    );
  });

  it("refuses a kit ref whose sha256 differs from kits.json", () => {
    const root = renderCopy();
    editJson(profilePath(root), (p) => {
      p.kitFiles[0].sha256 = "f".repeat(64);
    });
    const diagnostics = run(root);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.file).toBe("tools/render/profiles/zeus.json");
    expect(diagnostics[0]?.message).toContain("sha256");
  });

  it("refuses a referencedBy list that omits the profile, and one that lists a file it does not read", () => {
    const omitted = renderCopy();
    editJson(kitsPath(omitted), (k) => {
      k.kits[0].files.find(
        (f: { path: string }) => f.path === "Superhero_Male_FullBody.bin",
      ).referencedBy = [];
    });
    expect(run(omitted).map((d) => d.message)).toEqual([
      expect.stringContaining("referencedBy omits"),
    ]);

    const stray = renderCopy();
    editJson(kitsPath(stray), (k) => {
      // The profile builds its hair, so the kit's hair files are unread; listing them as read by it is refused.
      for (const file of k.kits[0].files) {
        if (/^Hair_Long\./.test(file.path)) file.referencedBy = ["zeus"];
      }
    });
    const messages = run(stray).map((d) => d.message);
    expect(messages).toHaveLength(2);
    expect(
      messages.every((m) => m.includes("does not reference this file")),
    ).toBe(true);
  });

  it("refuses a profile referencing an unassessed kit file, through validate:assets", () => {
    const root = renderCopy();
    editJson(kitsPath(root), (k) => {
      k.kits[0].licence = { spdx: "CC-BY-4.0" };
    });
    const diagnostics = run(root);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(
      diagnostics.every((d) => d.message.includes("ownerAssessment")),
    ).toBe(true);
  });

  it("refuses a profile that does not parse, and a camera that does not parse", () => {
    const badProfile = renderCopy();
    editJson(profilePath(badProfile), (p) => {
      p.pose.walk16 = p.pose.seated;
    });
    expect(run(badProfile)).toEqual([
      {
        file: "tools/render/profiles/zeus.json",
        message: expect.stringContaining("walk16"),
      },
    ]);

    const badCamera = renderCopy();
    editJson(join(badCamera, "tools", "render", "camera.json"), (c) => {
      c.rotationDeg = [55, 0, 45];
    });
    expect(run(badCamera)).toEqual([
      {
        file: "tools/render/camera.json",
        message: expect.stringContaining("2:1"),
      },
    ]);
  });

  it("refuses a missing camera, and a profile file whose name is not its id", () => {
    const noCamera = renderCopy();
    rmSync(join(noCamera, "tools", "render", "camera.json"));
    expect(run(noCamera)).toEqual([
      { file: "tools/render/camera.json", message: "file is missing" },
    ]);

    const misnamed = renderCopy();
    renameSync(
      profilePath(misnamed),
      join(dirname(profilePath(misnamed)), "other.json"),
    );
    expect(run(misnamed).map((d) => d.file)).toContain(
      "tools/render/profiles/other.json",
    );
  });

  it("refuses a subject whose render.profile names no profile (positive control: zeus passes)", () => {
    const root = renderCopy();
    const content = contentRoot();
    const subject = join(content, "assets", "subjects", "zeus.json");
    const json = JSON.parse(readFileSync(subject, "utf8"));
    expect(validateAssets(content, { repoRoot: root }).diagnostics).toEqual([]);
    writeFileSync(
      subject,
      JSON.stringify({ ...json, render: { ...json.render, profile: "ghost" } }),
    );
    const diagnostics = validateAssets(content, { repoRoot: root }).diagnostics;
    expect(diagnostics).toEqual([
      {
        file: "assets/subjects/zeus.json",
        message: expect.stringContaining('"ghost"'),
      },
    ]);
  });
});

describe("the retro matrix completeness rule", () => {
  const FACINGS = ["south", "north", "east", "west"] as const;
  const COUNTS = { idle: 4, walk: 16, seated: 2, act: 4 } as const;
  const MS = { idle: 167, walk: 50, seated: 200, act: 60 } as const;
  const godFile = (root: string) => join(root, "gods", "zeus.json");
  const pointGodAt = (root: string, sprite: string) => {
    const god = JSON.parse(readFileSync(godFile(root), "utf8"));
    writeFileSync(godFile(root), JSON.stringify({ ...god, sprite }));
  };

  /** Every required slot of the Zeus matrix (12: idle, walk and seated, four facings), as the slot keys a god-tall asset holds. */
  const allSlots = (): string[] =>
    FACINGS.flatMap((facing) => [
      `idle/${facing}`,
      `walk/${facing}`,
      `seated/${facing}`,
    ]);

  /** A 112x96 sprite holding exactly `slots`, built explicitly through the real manifest parser. */
  function godTallAsset(id: string, slots: readonly string[]): FixtureAsset {
    const width = 112 * 16;
    const rgba = new Uint8Array(width * 96 * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 90;
      rgba[i + 1] = 80;
      rgba[i + 2] = 160;
      rgba[i + 3] = 255;
    }
    const bytes = encodeRgbaPng(rgba, width, 96);
    const blob = sha256Hex(bytes);
    const animations = slots.map((key) => {
      const [state, direction, ability] = key.split("/") as [
        keyof typeof COUNTS,
        string,
        string | undefined,
      ];
      return {
        state,
        direction,
        ...(ability === undefined ? {} : { ability }),
        frames: Array.from({ length: COUNTS[state] }, (_, i) => ({
          rect: { x: i * 112, y: 0, w: 112, h: 96 },
          durationMs: MS[state],
        })),
      };
    });
    const parsed = parseAssetManifest(
      {
        schemaVersion: 1,
        kind: "sprite",
        id,
        cell: { w: 112, h: 96 },
        pixelScale: 1,
        paletteFamily: "olympus",
        paletteId: "fixture-master",
        styleTag: "fixture",
        atlas: { blob, width, height: 96 },
        pivot: { x: 56, y: 78 },
        footprint: { w: 1, h: 1 },
        directions: [...FACINGS],
        realmVariants: [],
        animations,
        provenance: {
          method: "hand",
          handEdits: [{ description: "drawn by hand for a test fixture" }],
          licences: [
            { subject: "test-fixture", role: "original-work", licence: "MIT" },
          ],
          relatedJobs: [],
          sourceAssets: [],
        },
      },
      vocabulary,
    );
    if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.message}`);
    return {
      manifest: parsed.value,
      blobs: new Map([[blob as Sha256, bytes]]),
    };
  }

  it("passes a god profile pointing at an asset that holds every required slot", () => {
    const root = contentRoot();
    publish(root, godTallAsset("zeus-retro", allSlots()));
    pointGodAt(root, "zeus-retro");
    expect(validateAssets(root)).toEqual({ ok: true, diagnostics: [] });
  });

  it("fails a god profile pointing at an asset missing one walk facing, naming the slot (positive control above)", () => {
    const root = contentRoot();
    publish(
      root,
      godTallAsset(
        "zeus-retro",
        allSlots().filter((key) => key !== "walk/west"),
      ),
    );
    pointGodAt(root, "zeus-retro");
    expect(diagnosticsOf(root)).toEqual([
      { file: "gods/zeus.json", message: expect.stringContaining("walk/west") },
    ]);
    expect(diagnosticsOf(root)[0]?.message).toContain("zeus-retro");
    expect(validateAssets(root).ok).toBe(false);
  });

  it("requires exactly 12 slots: idle, walk and seated by four facings (act is deferred)", () => {
    expect(allSlots()).toHaveLength(12);
    expect(allSlots().some((key) => key.startsWith("act"))).toBe(false);
    const subject = JSON.parse(
      readFileSync(
        join(contentRoot(), "assets", "subjects", "zeus.json"),
        "utf8",
      ),
    );
    expect(subject.render.matrix.deferred).toEqual([
      { state: "act", ability: "thunderbolt" },
      { state: "act", ability: "pronouncement" },
    ]);
  });

  it("fails for a missing idle and seated slot too, and lists every missing slot (positive control above: all 12 pass)", () => {
    for (const missing of ["idle/south", "seated/east"]) {
      const root = contentRoot();
      publish(
        root,
        godTallAsset(
          "zeus-retro",
          allSlots().filter((key) => key !== missing),
        ),
      );
      pointGodAt(root, "zeus-retro");
      const found = diagnosticsOf(root);
      expect(found, missing).toHaveLength(1);
      expect(found[0]?.message, missing).toContain(missing);
    }
    const root = contentRoot();
    publish(
      root,
      godTallAsset(
        "zeus-retro",
        allSlots().filter((key) => !key.startsWith("seated/")),
      ),
    );
    pointGodAt(root, "zeus-retro");
    const message = diagnosticsOf(root)[0]?.message ?? "";
    for (const facing of FACINGS) expect(message).toContain(`seated/${facing}`);
  });

  it("does not require the deferred act slots, and accepts them when present", () => {
    const root = contentRoot();
    publish(root, godTallAsset("zeus-retro", allSlots()));
    pointGodAt(root, "zeus-retro");
    expect(validateAssets(root).ok).toBe(true);
    const withAct = contentRoot();
    publish(
      withAct,
      godTallAsset("zeus-retro", [
        ...allSlots(),
        ...FACINGS.map((f) => `act/${f}/thunderbolt`),
      ]),
    );
    pointGodAt(withAct, "zeus-retro");
    expect(validateAssets(withAct).ok).toBe(true);
  });

  it("does not require the deferred pronouncement slot", () => {
    const root = contentRoot();
    publish(root, godTallAsset("zeus-retro", allSlots()));
    pointGodAt(root, "zeus-retro");
    expect(allSlots().some((key) => key.includes("pronouncement"))).toBe(false);
    expect(validateAssets(root).ok).toBe(true);
  });

  it("leaves the legacy 64x80 zeus-sprite out of the rule: a god cell is not the matrix's god-tall cell", () => {
    const root = contentRoot();
    // The Zeus subject declares the matrix; the legacy sprite holds only idle/south.
    expect(
      JSON.parse(
        readFileSync(join(root, "assets", "subjects", "zeus.json"), "utf8"),
      ).render.matrix.cellClass,
    ).toBe("god-tall");
    // Before promotion, zeus-sprite was the god's own sprite, so it is no legacy sprite of this root.
    const subjectPath = join(root, "assets", "subjects", "zeus.json");
    const { legacySprites: _legacy, ...subject } = JSON.parse(
      readFileSync(subjectPath, "utf8"),
    );
    writeFileSync(subjectPath, JSON.stringify(subject));
    publish(root, spriteFixture("zeus-sprite"));
    pointGodAt(root, "zeus-sprite");
    expect(validateAssets(root)).toEqual({ ok: true, diagnostics: [] });
  });

  it("validates the committed promoted Zeus against the committed subject: zeus-retro holds the matrix, zeus-sprite is legacy", () => {
    const god = JSON.parse(
      readFileSync(join(COMMITTED, "gods", "zeus.json"), "utf8"),
    );
    expect(god.sprite).toBe("zeus-retro");
    expect(validateAssets(COMMITTED)).toEqual({ ok: true, diagnostics: [] });
  });

  it("applies to no god whose subject declares no matrix", () => {
    const root = contentRoot();
    const subject = join(root, "assets", "subjects", "zeus.json");
    const { render: _render, ...rest } = JSON.parse(
      readFileSync(subject, "utf8"),
    );
    writeFileSync(subject, JSON.stringify(rest));
    publish(root, godTallAsset("zeus-retro", ["walk/south"]));
    pointGodAt(root, "zeus-retro");
    expect(validateAssets(root)).toEqual({ ok: true, diagnostics: [] });
  });

  describe("a matrix the vocabulary cannot honour", () => {
    const subjectFile = (root: string) =>
      join(root, "assets", "subjects", "zeus.json");
    const changeMatrix = (root: string, change: Record<string, unknown>) => {
      const subject = JSON.parse(readFileSync(subjectFile(root), "utf8"));
      subject.render.matrix = { ...subject.render.matrix, ...change };
      writeFileSync(subjectFile(root), JSON.stringify(subject));
    };

    it("accepts the committed matrix (positive control)", () => {
      expect(validateAssets(contentRoot())).toEqual({
        ok: true,
        diagnostics: [],
      });
    });

    for (const [label, change, text] of [
      ["an unknown cell class", { cellClass: "giant" }, "giant"],
      ["a portrait cell class", { cellClass: "portrait" }, "portrait"],
      [
        "a state the class has no rule for",
        { required: [{ state: "hurt" }] },
        "hurt",
      ],
      [
        "a per-ability state with no ability",
        { required: [{ state: "act" }] },
        "act",
      ],
      [
        "an ability on a state that takes none",
        { required: [{ state: "idle", ability: "thunderbolt" }] },
        "idle",
      ],
      ["an unknown direction", { directions: ["up"] }, "up"],
    ] as const) {
      it(`reports ${label} against the subject file`, () => {
        const root = contentRoot();
        changeMatrix(root, change);
        const found = diagnosticsOf(root);
        expect(found.map((d) => d.file)).toEqual(["assets/subjects/zeus.json"]);
        expect(found[0]?.message).toContain(text);
      });
    }
  });
});

describe("tile assets", () => {
  it("accepts a published tile alongside the other kinds, with no diagnostics", () => {
    const root = contentRoot();
    publish(root, tileFixture());
    expect(diagnosticsOf(root)).toEqual([]);
    const { snapshot } = loadRegistry(registryOf(root), vocabulary);
    expect(snapshot.entries.get("grass-flagstone")?.manifest.kind).toBe("tile");
  });

  it("still holds a tile to the palette it names", () => {
    const root = contentRoot();
    publish(root, tileFixture());
    writePalette(root, paletteFixture("approved", "another-master").files);
    const [diagnostic] = diagnosticsOf(root);
    expect(diagnostic?.file).toMatch(
      /^assets\/registry\/manifests\/[0-9a-f]{64}\.json$/,
    );
    expect(diagnostic?.message).toContain("fixture-master");
  });

  it("refuses an inhabitant whose sprite id is a published tile", () => {
    const root = contentRoot();
    publish(root, tileFixture("grass-flagstone"));
    writeInhabitants(root, [
      { id: "woodcutter", sprite: "grass-flagstone" },
      { id: "zeus", deity: true },
    ]);
    const [diagnostic] = diagnosticsOf(root);
    expect(diagnostic?.message).toContain("published as a tile, not a sprite");
  });
});

// The curated kit library gate. Fixtures are built explicitly in temp directories (a render
// root with kits.json and kits/<pack>/...); the committed set is checked in place.

import { afterEach, describe, expect, it } from "bun:test";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sha256Hex } from "../hash";
import {
  checkKits,
  type KitProblem,
  type ProfileKitRefs,
  parseKitManifest,
} from "./kits";

const COMMITTED_RENDER_ROOT = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "tools",
  "render",
);
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const bytes = (text: string) => new TextEncoder().encode(text);
const gltf = (json: object) => JSON.stringify(json);

interface FixtureFile {
  readonly content: string;
  readonly referencedBy?: readonly string[];
}

interface FixtureKit {
  readonly id: string;
  readonly spdx?: string;
  readonly ownerAssessment?: object;
  readonly status?: string;
  readonly textureSkip?: readonly string[];
  /** `null`: the licence file is listed but not written. */
  readonly licenceText?: string | null;
  readonly files: Readonly<Record<string, FixtureFile>>;
}

interface Fixture {
  readonly root: string;
  readonly manifest: ReturnType<typeof manifestOf>;
}

function manifestOf(kits: readonly FixtureKit[], sizeCapBytes: number) {
  return {
    schemaVersion: 1,
    sizeCapBytes,
    kits: kits.map((kit) => ({
      id: kit.id,
      title: `Fixture ${kit.id}`,
      licence: {
        spdx: kit.spdx ?? "CC0-1.0",
        ...(kit.ownerAssessment === undefined
          ? {}
          : { ownerAssessment: kit.ownerAssessment }),
      },
      sourceUrl: `https://example.invalid/${kit.id}`,
      licenceFile: {
        path: "LICENCE.txt",
        sha256: sha256Hex(bytes(kit.licenceText ?? "CC0 text")),
      },
      status: kit.status ?? "used",
      textureSkip: kit.textureSkip ?? [],
      files: Object.entries(kit.files).map(([path, file]) => ({
        path,
        sha256: sha256Hex(bytes(file.content)),
        size: bytes(file.content).length,
        referencedBy: file.referencedBy ?? [],
      })),
    })),
  };
}

function fixture(
  kits: readonly FixtureKit[],
  sizeCapBytes = 1_000_000,
): Fixture {
  const root = mkdtempSync(join(tmpdir(), "kits-"));
  dirs.push(root);
  const manifest = manifestOf(kits, sizeCapBytes);
  writeFileSync(join(root, "kits.json"), JSON.stringify(manifest, null, 2));
  for (const kit of kits) {
    const dir = join(root, "kits", kit.id);
    mkdirSync(dir, { recursive: true });
    if (kit.licenceText !== null) {
      writeFileSync(join(dir, "LICENCE.txt"), kit.licenceText ?? "CC0 text");
    }
    for (const [path, file] of Object.entries(kit.files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), file.content);
    }
  }
  return { root, manifest };
}

/** A well-formed single-kit fixture: a body glTF with one buffer and one texture on the skip list. */
function bodyKit(overrides: Partial<FixtureKit> = {}): FixtureKit {
  return {
    id: "pack-a",
    textureSkip: ["Tex.png"],
    files: {
      "Body.gltf": {
        content: gltf({
          buffers: [{ uri: "Body.bin", byteLength: 4 }],
          images: [{ uri: "Tex.png" }],
        }),
        referencedBy: ["zeus"],
      },
      "Body.bin": { content: "BIN!", referencedBy: ["zeus"] },
    },
    ...overrides,
  };
}

const ZEUS: ProfileKitRefs = {
  profile: "zeus",
  files: [
    { kit: "pack-a", path: "Body.gltf" },
    { kit: "pack-a", path: "Body.bin" },
  ],
};

function messages(problems: readonly KitProblem[]): string {
  return problems.map((p) => `${p.file}: ${p.message}`).join("\n");
}

describe("the committed kit set", () => {
  it("passes: every entry has its licence file, hashes and sizes match, and the total is under the cap", () => {
    const result = checkKits(COMMITTED_RENDER_ROOT, []);
    expect(messages(result.problems)).toBe("");
    expect(result.totalBytes).toBeGreaterThan(0);
    const manifest = parseKitManifest(
      JSON.parse(
        readFileSync(join(COMMITTED_RENDER_ROOT, "kits.json"), "utf8"),
      ),
    );
    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      expect(result.totalBytes).toBeLessThanOrEqual(
        manifest.value.sizeCapBytes,
      );
      expect(
        manifest.value.kits.every((k) => k.licence.spdx === "CC0-1.0"),
      ).toBe(true);
    }
  });
});

describe("the fixture itself", () => {
  it("passes with a matching profile (positive control for every refusal below)", () => {
    const { root } = fixture([bodyKit()]);
    expect(messages(checkKits(root, [ZEUS]).problems)).toBe("");
  });
});

describe("licence gate", () => {
  it("refuses a referenced file in a pack whose licence file is missing, naming the entry", () => {
    const { root } = fixture([bodyKit({ licenceText: null })]);
    const text = messages(checkKits(root, [ZEUS]).problems);
    expect(text).toContain("pack-a");
    expect(text).toContain("licence file");
    expect(text).toContain("missing");
  });

  it("refuses a licence file whose hash differs from the manifest", () => {
    const { root } = fixture([bodyKit()]);
    writeFileSync(
      join(root, "kits", "pack-a", "LICENCE.txt"),
      "something else",
    );
    expect(messages(checkKits(root, [ZEUS]).problems)).toContain(
      "licence file",
    );
  });

  it.each([["inspected-not-used"], ["used"]])(
    "refuses a referenced file under a non-CC0 licence with no assessment, whatever its status (%s)",
    (status) => {
      const { root } = fixture([bodyKit({ spdx: "CC-BY-4.0", status })]);
      const text = messages(checkKits(root, [ZEUS]).problems);
      expect(text).toContain("CC-BY-4.0");
      expect(text).toContain("ownerAssessment");
      expect(text).toContain("pack-a/Body.gltf");
    },
  );

  it("passes the same files once the kit carries an owner assessment (positive control)", () => {
    const { root } = fixture([
      bodyKit({
        spdx: "CC-BY-4.0",
        status: "inspected-not-used",
        ownerAssessment: {
          by: "owner",
          date: "2026-10-12",
          summary: "Attribution recorded in the repository notices.",
        },
      }),
    ]);
    expect(messages(checkKits(root, [ZEUS]).problems)).toBe("");
  });

  it("does not gate a non-CC0 kit that no profile references", () => {
    const { root } = fixture([
      bodyKit({
        spdx: "CC-BY-4.0",
        files: {
          "Body.gltf": {
            content: gltf({ buffers: [{ uri: "Body.bin" }] }),
          },
          "Body.bin": { content: "BIN!" },
        },
      }),
    ]);
    expect(messages(checkKits(root, []).problems)).toBe("");
  });

  it("refuses a fixture profile that references an unassessed kit file, and passes it once the file is in an assessed kit", () => {
    const unassessed: FixtureKit = {
      id: "pack-b",
      spdx: "LicenseRef-Unknown",
      files: { "Hat.bin": { content: "HAT", referencedBy: ["fixture"] } },
    };
    const assessed: FixtureKit = {
      id: "pack-b",
      spdx: "LicenseRef-Unknown",
      ownerAssessment: {
        by: "owner",
        date: "2026-10-12",
        summary: "Reviewed.",
      },
      files: { "Hat.bin": { content: "HAT", referencedBy: ["fixture"] } },
    };
    const profile: ProfileKitRefs = {
      profile: "fixture",
      files: [{ kit: "pack-b", path: "Hat.bin" }],
    };
    expect(
      messages(checkKits(fixture([unassessed]).root, [profile]).problems),
    ).toContain("ownerAssessment");
    expect(
      messages(checkKits(fixture([assessed]).root, [profile]).problems),
    ).toBe("");
  });

  it("refuses a profile reference to a file no kit lists, and to a kit that does not exist", () => {
    const { root } = fixture([bodyKit()]);
    const text = messages(
      checkKits(root, [
        {
          profile: "zeus",
          files: [
            ...ZEUS.files,
            { kit: "pack-a", path: "Cape.gltf" },
            { kit: "pack-z", path: "Body.gltf" },
          ],
        },
      ]).problems,
    );
    expect(text).toContain("pack-a/Cape.gltf");
    expect(text).toContain("pack-z");
  });
});

describe("referencedBy", () => {
  it("refuses a profile reference the file's referencedBy list omits", () => {
    const { root } = fixture([
      bodyKit({
        files: {
          "Body.gltf": {
            content: gltf({ buffers: [{ uri: "Body.bin" }], images: [] }),
            referencedBy: ["zeus"],
          },
          "Body.bin": { content: "BIN!", referencedBy: [] },
        },
        textureSkip: [],
      }),
    ]);
    const text = messages(checkKits(root, [ZEUS]).problems);
    expect(text).toContain("pack-a/Body.bin");
    expect(text).toContain('"zeus"');
    expect(text).toContain("referencedBy");
  });

  it("refuses a referencedBy entry the profile does not reference", () => {
    const { root } = fixture([bodyKit()]);
    const text = messages(
      checkKits(root, [
        { profile: "zeus", files: [{ kit: "pack-a", path: "Body.gltf" }] },
      ]).problems,
    );
    expect(text).toContain("pack-a/Body.bin");
    expect(text).toContain("does not reference");
  });

  it("leaves a referencedBy entry alone when no such profile was given", () => {
    const { root } = fixture([bodyKit()]);
    expect(messages(checkKits(root, []).problems)).toBe("");
  });
});

describe("files and entries match both ways", () => {
  it("refuses a committed kit file with no entry", () => {
    const { root } = fixture([bodyKit()]);
    writeFileSync(join(root, "kits", "pack-a", "Stray.bin"), "x");
    const text = messages(checkKits(root, [ZEUS]).problems);
    expect(text).toContain("pack-a/Stray.bin");
    expect(text).toContain("not in kits.json");
  });

  it("refuses a file under a directory no kit owns", () => {
    const { root } = fixture([bodyKit()]);
    mkdirSync(join(root, "kits", "pack-q"), { recursive: true });
    writeFileSync(join(root, "kits", "pack-q", "Loose.bin"), "x");
    expect(messages(checkKits(root, [ZEUS]).problems)).toContain(
      "pack-q/Loose.bin",
    );
  });

  it("refuses an entry whose file is missing", () => {
    const { root } = fixture([bodyKit()]);
    rmSync(join(root, "kits", "pack-a", "Body.bin"));
    const text = messages(checkKits(root, [ZEUS]).problems);
    expect(text).toContain("pack-a/Body.bin");
    expect(text).toContain("missing on disk");
  });
});

describe("hashes, sizes and the cap", () => {
  it("fails a changed byte", () => {
    const { root } = fixture([bodyKit()]);
    writeFileSync(join(root, "kits", "pack-a", "Body.bin"), "BIN?");
    const text = messages(checkKits(root, [ZEUS]).problems);
    expect(text).toContain("pack-a/Body.bin");
    expect(text).toContain("sha256");
  });

  it("fails a file whose size differs from its entry", () => {
    const { root } = fixture([bodyKit()]);
    appendFileSync(join(root, "kits", "pack-a", "Body.bin"), "!");
    expect(messages(checkKits(root, [ZEUS]).problems)).toContain("size");
  });

  it("passes a total exactly at the cap and fails one byte over it", () => {
    const kit = bodyKit();
    const probe = fixture([kit]);
    const total = checkKits(probe.root, [ZEUS]).totalBytes;
    expect(total).toBeGreaterThan(0);
    const atCap = fixture([kit], total);
    expect(messages(checkKits(atCap.root, [ZEUS]).problems)).toBe("");
    const over = fixture([kit], total - 1);
    expect(messages(checkKits(over.root, [ZEUS]).problems)).toContain(
      "sizeCapBytes",
    );
  });
});

describe("glTF closure", () => {
  it("fails a glTF whose buffer is not in the manifest", () => {
    const { root } = fixture([
      bodyKit({
        files: {
          "Body.gltf": {
            content: gltf({ buffers: [{ uri: "Other.bin" }] }),
            referencedBy: ["zeus"],
          },
        },
      }),
    ]);
    const text = messages(
      checkKits(root, [
        { profile: "zeus", files: [{ kit: "pack-a", path: "Body.gltf" }] },
      ]).problems,
    );
    expect(text).toContain("Other.bin");
    expect(text).toContain("buffers[0].uri");
  });

  it("fails a glTF whose image is neither in the manifest nor on the skip list", () => {
    const { root } = fixture([bodyKit({ textureSkip: [] })]);
    const text = messages(checkKits(root, [ZEUS]).problems);
    expect(text).toContain("Tex.png");
    expect(text).toContain("images[0].uri");
  });

  it("passes the same image once it is on the skip list (positive control)", () => {
    const { root } = fixture([bodyKit({ textureSkip: ["Tex.png"] })]);
    expect(messages(checkKits(root, [ZEUS]).problems)).toBe("");
  });

  it("does not let a buffer sit on the skip list", () => {
    const { root } = fixture([
      bodyKit({
        textureSkip: ["Tex.png", "Gone.bin"],
        files: {
          "Body.gltf": {
            content: gltf({
              buffers: [{ uri: "Gone.bin" }],
              images: [{ uri: "Tex.png" }],
            }),
            referencedBy: ["zeus"],
          },
        },
      }),
    ]);
    expect(
      messages(
        checkKits(root, [
          { profile: "zeus", files: [{ kit: "pack-a", path: "Body.gltf" }] },
        ]).problems,
      ),
    ).toContain("Gone.bin");
  });

  it("refuses a uri that leaves the kit directory", () => {
    const { root } = fixture([
      bodyKit({
        files: {
          "Body.gltf": {
            content: gltf({ buffers: [{ uri: "../pack-b/Body.bin" }] }),
            referencedBy: ["zeus"],
          },
        },
      }),
    ]);
    expect(
      messages(
        checkKits(root, [
          { profile: "zeus", files: [{ kit: "pack-a", path: "Body.gltf" }] },
        ]).problems,
      ),
    ).toContain("outside the kit");
  });

  describe("uris that name a file outside the kit (U08, ADR-0012 source gate)", () => {
    /** Body.bin is listed in the manifest, so only the uri shape can cause a refusal. */
    const closureMessages = (
      role: "buffers" | "images",
      uri: string,
    ): string => {
      const { root } = fixture([
        bodyKit({
          files: {
            "Body.gltf": {
              content: gltf({ [role]: [{ uri }] }),
              referencedBy: ["zeus"],
            },
            "Body.bin": { content: "BIN!", referencedBy: ["zeus"] },
          },
        }),
      ]);
      return messages(checkKits(root, [ZEUS]).problems);
    };

    /** The reason matters: a refusal for "not in kits.json" would pass by accident. */
    const PATH = "is not a kit-relative path";
    const SCHEME = "is an external uri";
    it.each([
      ["/Body.bin", PATH],
      ["%2FBody.bin", PATH],
      ["//host/Body.bin", PATH],
      ["C:\\Body.bin", PATH],
      ["%5CBody.bin", PATH],
      ["Sub%5CBody.bin", PATH],
      ["file:///Body.bin", SCHEME],
      ["file%3A%2F%2F%2FBody.bin", SCHEME],
    ])(
      "refuses the buffer uri %p although Body.bin is listed",
      (uri, reason) => {
        const text = closureMessages("buffers", uri);
        expect(text).toContain("buffers[0].uri");
        expect(text).toContain(reason);
      },
    );

    it("refuses an absolute image uri although its basename is on the skip list", () => {
      const text = closureMessages("images", "/Tex.png");
      expect(text).toContain("images[0].uri");
      expect(text).toContain(PATH);
    });

    it("passes the relative uri against the same manifest (positive control)", () => {
      expect(closureMessages("buffers", "Body.bin")).toBe("");
    });
  });

  it("accepts embedded data uris, and a .glb needs nothing", () => {
    const { root } = fixture([
      {
        id: "pack-a",
        files: {
          "Body.gltf": {
            content: gltf({
              buffers: [{ uri: "data:application/octet-stream;base64,AAAA" }],
            }),
            referencedBy: ["zeus"],
          },
          "Anim.glb": {
            content: "glTF-not-json-at-all",
            referencedBy: ["zeus"],
          },
        },
      },
    ]);
    expect(
      messages(
        checkKits(root, [
          {
            profile: "zeus",
            files: [
              { kit: "pack-a", path: "Body.gltf" },
              { kit: "pack-a", path: "Anim.glb" },
            ],
          },
        ]).problems,
      ),
    ).toBe("");
  });

  it("checks a glTF that a profile references even when its referencedBy list is empty", () => {
    const { root } = fixture([
      bodyKit({
        textureSkip: [],
        files: {
          "Body.gltf": {
            content: gltf({ images: [{ uri: "Tex.png" }] }),
            referencedBy: [],
          },
        },
      }),
    ]);
    const text = messages(
      checkKits(root, [
        { profile: "zeus", files: [{ kit: "pack-a", path: "Body.gltf" }] },
      ]).problems,
    );
    expect(text).toContain("Tex.png");
  });

  it("fails a glTF that is not valid JSON", () => {
    const { root } = fixture([
      bodyKit({
        files: {
          "Body.gltf": { content: "{not json", referencedBy: ["zeus"] },
        },
      }),
    ]);
    expect(
      messages(
        checkKits(root, [
          { profile: "zeus", files: [{ kit: "pack-a", path: "Body.gltf" }] },
        ]).problems,
      ),
    ).toContain("not valid JSON");
  });
});

describe("parseKitManifest", () => {
  type Loose = Record<string, unknown>;
  interface LooseKit extends Loose {
    files: Loose[];
  }
  interface LooseManifest extends Loose {
    kits: LooseKit[];
  }
  const valid = () =>
    structuredClone(fixture([bodyKit()]).manifest) as unknown as LooseManifest;
  /** The manifest with its first kit (and that kit's first file) handed to `patch`. */
  const patched = (patch: (kit: LooseKit, file: Loose) => void) => {
    const manifest = valid();
    const kit = manifest.kits[0] as LooseKit;
    patch(kit, kit.files[0] as Loose);
    return manifest;
  };

  it("accepts the fixture manifest", () => {
    expect(parseKitManifest(valid()).ok).toBe(true);
  });

  it("refuses a path that is absolute, climbs out, or uses backslashes", () => {
    for (const path of ["/etc/passwd", "../x.bin", "a\\b.bin", "a//b.bin"]) {
      const manifest = patched((_kit, file) => {
        file.path = path;
      });
      expect(parseKitManifest(manifest).ok).toBe(false);
    }
  });

  it("refuses a duplicate kit id, a duplicate file path and a malformed hash", () => {
    const duplicateKit = valid();
    duplicateKit.kits.push(structuredClone(duplicateKit.kits[0]) as LooseKit);
    expect(parseKitManifest(duplicateKit).ok).toBe(false);

    const duplicateFile = patched((kit, file) => {
      kit.files.push(structuredClone(file));
    });
    expect(parseKitManifest(duplicateFile).ok).toBe(false);

    const badHash = patched((_kit, file) => {
      file.sha256 = "abc";
    });
    expect(parseKitManifest(badHash).ok).toBe(false);
  });

  it("refuses a malformed ownerAssessment and a skip entry that is also a manifest file", () => {
    const assessed = patched((kit) => {
      kit.licence = { spdx: "CC-BY-4.0", ownerAssessment: { by: "" } };
    });
    expect(parseKitManifest(assessed).ok).toBe(false);

    const overlap = patched((kit) => {
      kit.textureSkip = ["Body.bin"];
    });
    expect(parseKitManifest(overlap).ok).toBe(false);
  });

  it("refuses a missing or unsupported schema version and a negative cap", () => {
    const { schemaVersion: _version, ...noVersion } = valid();
    expect(parseKitManifest(noVersion).ok).toBe(false);
    expect(parseKitManifest({ ...valid(), schemaVersion: 2 }).ok).toBe(false);
    expect(parseKitManifest({ ...valid(), sizeCapBytes: -1 }).ok).toBe(false);
  });

  it("reports an unreadable kits.json as a problem, not a throw", () => {
    const root = mkdtempSync(join(tmpdir(), "kits-"));
    dirs.push(root);
    expect(messages(checkKits(root, []).problems)).toContain("kits.json");
    writeFileSync(join(root, "kits.json"), "{nope");
    expect(messages(checkKits(root, []).problems)).toContain("not valid JSON");
  });
});

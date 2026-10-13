// The authored stamp set: parsing, the file and hash checks `validate:assets` runs, and loading.
// Fixtures are copies of the committed tools/render/stamps tree in temp directories.

import { afterEach, describe, expect, it } from "bun:test";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BOLT_ANGLES,
  checkStamps,
  loadStampSet,
  parseStampManifest,
} from "./stamps";

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

/** A render root holding a copy of the committed stamp tree. */
function renderRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "stamps-"));
  dirs.push(root);
  mkdirSync(join(root, "stamps"), { recursive: true });
  cpSync(join(COMMITTED_RENDER_ROOT, "stamps"), join(root, "stamps"), {
    recursive: true,
  });
  return root;
}

const committedManifest = (): Record<string, unknown> =>
  JSON.parse(
    readFileSync(join(COMMITTED_RENDER_ROOT, "stamps", "stamps.json"), "utf8"),
  ) as Record<string, unknown>;

type Variants = Record<string, unknown>[];
interface EditableSet {
  bolt: { variants: Variants };
  face: { variants: Variants };
}

/** The committed manifest with one edit applied to its first set. */
function withSet(edit: (set: EditableSet) => void): unknown {
  const manifest = committedManifest() as { sets: EditableSet[] };
  edit(manifest.sets[0] as EditableSet);
  return manifest;
}

const first = (variants: Variants): Record<string, unknown> =>
  variants[0] as Record<string, unknown>;

describe("the committed stamp set", () => {
  it("passes the check: every file present with its hash, nothing unlisted", () => {
    expect(checkStamps(COMMITTED_RENDER_ROOT).problems).toEqual([]);
  });

  it("parses to a Zeus set with all eight bolt orientations and the face stamps", () => {
    const parsed = parseStampManifest(committedManifest());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const zeus = parsed.value.sets.find((s) => s.id === "zeus");
    expect(zeus?.palette).toBe("greek-retro");
    expect(zeus?.bolt?.variants.map((v) => v.angle)).toEqual([...BOLT_ANGLES]);
    expect(zeus?.bolt?.outline).toEqual([0x76, 0x57, 0x2f]);
    expect(
      zeus?.face?.variants.map((v) => `${v.facing}/${v.slot}`).sort(),
    ).toEqual(["east/near", "south/l", "south/r", "west/near"]);
  });

  it("loads: the bolt splits into core and outline pixels, the face stamps place their eye at the anchor", () => {
    const loaded = loadStampSet(COMMITTED_RENDER_ROOT, "zeus");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const up = loaded.set.bolt?.get(90);
    expect(up?.anchor).toEqual([7, 15]);
    expect(up?.core.length).toBe(46);
    expect(up?.outline.length).toBe(44);
    expect([...(loaded.set.bolt?.keys() ?? [])].sort((a, b) => a - b)).toEqual([
      ...BOLT_ANGLES,
    ]);
    const south = loaded.set.face?.get("south/l");
    expect(south?.anchor).toEqual([0, 1]);
    const eye = south?.pixels.find(
      (p) => p.x === south.anchor[0] && p.y === south.anchor[1],
    );
    expect(eye?.rgb).toEqual([0x24, 0x3f, 0x63]);
    expect(south?.pixels).toHaveLength(3);
  });

  it("refuses to load a set that is not in the manifest", () => {
    const loaded = loadStampSet(COMMITTED_RENDER_ROOT, "hera");
    expect(loaded.ok).toBe(false);
  });
});

describe("the stamp check", () => {
  it("refuses a missing stamp file, naming it (the unbroken copy passes)", () => {
    const root = renderRoot();
    expect(checkStamps(root).problems).toEqual([]);
    rmSync(join(root, "stamps", "zeus", "bolt-090.png"));
    const { problems } = checkStamps(root);
    expect(problems).toEqual([
      {
        file: "stamps/zeus/bolt-090.png",
        message: expect.stringContaining("missing"),
      },
    ]);
  });

  it("refuses a stamp file whose bytes no longer match the manifest hash", () => {
    const root = renderRoot();
    appendFileSync(join(root, "stamps", "zeus", "face-south-l.png"), "x");
    const { problems } = checkStamps(root);
    expect(problems.map((p) => p.file)).toEqual([
      "stamps/zeus/face-south-l.png",
    ]);
    expect(problems[0]?.message).toContain("sha256");
  });

  it("refuses a file on disk that the manifest does not list, and a missing manifest", () => {
    const root = renderRoot();
    writeFileSync(join(root, "stamps", "zeus", "extra.png"), "x");
    expect(checkStamps(root).problems).toEqual([
      {
        file: "stamps/zeus/extra.png",
        message: expect.stringContaining("not in stamps.json"),
      },
    ]);
    rmSync(join(root, "stamps", "stamps.json"));
    expect(checkStamps(root).problems[0]).toEqual({
      file: "stamps/stamps.json",
      message: expect.stringContaining("missing"),
    });
  });

  it("refuses a stamp that is not the PNG, size or anchor the manifest declares", () => {
    const root = renderRoot();
    const manifest = withSet((s) => {
      first(s.bolt.variants).size = [16, 12];
    });
    writeFileSync(
      join(root, "stamps", "stamps.json"),
      JSON.stringify(manifest),
    );
    const { problems } = checkStamps(root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toEqual({
      file: "stamps/zeus/bolt-000.png",
      message: expect.stringContaining("17x12"),
    });
  });
});

describe("parsing", () => {
  it("accepts a manifest without sets", () => {
    expect(parseStampManifest({ schemaVersion: 1, sets: [] }).ok).toBe(true);
  });

  it("refuses a bolt set that lacks an orientation, repeats one, or names an unknown angle", () => {
    const missing = parseStampManifest(
      withSet((s) => s.bolt.variants.splice(3, 1)),
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.message).toContain("135");
    const repeated = parseStampManifest(
      withSet((s) => s.bolt.variants.push({ ...first(s.bolt.variants) })),
    );
    expect(repeated.ok).toBe(false);
    const unknown = parseStampManifest(
      withSet((s) => {
        first(s.bolt.variants).angle = 20;
      }),
    );
    expect(unknown.ok).toBe(false);
  });

  it("refuses a face set missing a facing, an anchor outside the stamp and a bad hash or path", () => {
    expect(
      parseStampManifest(withSet((s) => s.face.variants.splice(2, 1))).ok,
    ).toBe(false);
    expect(
      parseStampManifest(
        withSet((s) => {
          first(s.face.variants).anchor = [2, 0];
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseStampManifest(
        withSet((s) => {
          first(s.bolt.variants).sha256 = "abc";
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseStampManifest(
        withSet((s) => {
          first(s.bolt.variants).file = "../kits.json";
        }),
      ).ok,
    ).toBe(false);
  });

  it("refuses two sets with one id and an unsupported schema version", () => {
    const manifest = committedManifest() as { sets: unknown[] };
    expect(
      parseStampManifest({
        ...manifest,
        sets: [...manifest.sets, ...manifest.sets],
      }).ok,
    ).toBe(false);
    expect(parseStampManifest({ ...manifest, schemaVersion: 2 }).ok).toBe(
      false,
    );
  });
});

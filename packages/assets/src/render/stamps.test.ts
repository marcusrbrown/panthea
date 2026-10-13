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
import { checkStamps, loadStampSet, parseStampManifest } from "./stamps";

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

  it("parses to a Zeus set with the face stamps and no prop stamp", () => {
    const parsed = parseStampManifest(committedManifest());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const zeus = parsed.value.sets.find((s) => s.id === "zeus");
    expect(zeus?.palette).toBe("greek-retro");
    expect(Object.keys(zeus ?? {}).sort()).toEqual(["face", "id", "palette"]);
    expect(
      zeus?.face?.variants.map((v) => `${v.facing}/${v.slot}`).sort(),
    ).toEqual(["east/near", "south/l", "south/r", "west/near"]);
  });

  it("loads: the face stamps place their eye at the anchor, and there is nothing else to load", () => {
    const loaded = loadStampSet(COMMITTED_RENDER_ROOT, "zeus");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(Object.keys(loaded.set).sort()).toEqual(["face", "id"]);
    const south = loaded.set.face?.get("south/l");
    expect(south?.anchor).toEqual([0, 1]);
    const eye = south?.pixels.find(
      (p) => p.x === south.anchor[0] && p.y === south.anchor[1],
    );
    expect(eye?.rgb).toEqual([0x24, 0x3f, 0x63]);
    expect(south?.pixels).toHaveLength(3);
  });

  it("gives the side views their own brows: the ridge one pixel above the eye, running back from it, not the front stamp", () => {
    const loaded = loadStampSet(COMMITTED_RENDER_ROOT, "zeus");
    if (!loaded.ok) throw new Error("the committed set does not load");
    const face = loaded.set.face;
    const pixelsOf = (key: string) =>
      (face?.get(key)?.pixels ?? []).map((p) => `${p.x},${p.y}`).sort();
    const BROW = [0x52, 0x64, 0x71] as const;
    for (const [key, eyeX] of [
      ["east/near", 1],
      ["west/near", 0],
    ] as const) {
      const stamp = face?.get(key);
      expect(stamp?.pixels).toHaveLength(3);
      // One dark eye pixel at the anchor, two brow pixels above it with a gap row between.
      expect(stamp?.anchor).toEqual([eyeX, 2]);
      const eye = stamp?.pixels.find(
        (p) => p.x === eyeX && p.y === (stamp?.anchor[1] as number),
      );
      expect(eye?.rgb).toEqual([0x24, 0x3f, 0x63]);
      const brow = (stamp?.pixels ?? []).filter((p) => p.y === 0);
      expect(brow).toHaveLength(2);
      for (const pixel of brow) expect([...pixel.rgb]).toEqual([...BROW]);
      // Their placement is not the front stamp's.
      expect(pixelsOf(key)).not.toEqual(pixelsOf("south/l"));
      expect(pixelsOf(key)).not.toEqual(pixelsOf("south/r"));
    }
    // The front stamps stay: the eye directly under a two-pixel brow.
    for (const key of ["south/l", "south/r"]) {
      const brow = (face?.get(key)?.pixels ?? []).filter((p) => p.y === 0);
      expect(brow).toHaveLength(2);
      // The eye sits on the row right under the brow: two rows in all.
      expect(Math.max(...(face?.get(key)?.pixels ?? []).map((p) => p.y))).toBe(
        1,
      );
    }
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
    rmSync(join(root, "stamps", "zeus", "face-south-r.png"));
    const { problems } = checkStamps(root);
    expect(problems).toEqual([
      {
        file: "stamps/zeus/face-south-r.png",
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
      first(s.face.variants).size = [3, 2];
    });
    writeFileSync(
      join(root, "stamps", "stamps.json"),
      JSON.stringify(manifest),
    );
    const { problems } = checkStamps(root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toEqual({
      file: "stamps/zeus/face-south-l.png",
      message: expect.stringContaining("2x2"),
    });
  });
});

describe("parsing", () => {
  it("accepts a manifest without sets", () => {
    expect(parseStampManifest({ schemaVersion: 1, sets: [] }).ok).toBe(true);
  });

  it("refuses a stamp set that still declares a bolt (no props on characters), and any other unknown key", () => {
    const bolted = parseStampManifest(
      withSet((s) => {
        (s as unknown as Record<string, unknown>).bolt = {
          outline: "#76572f",
          variants: [],
        };
      }),
    );
    expect(bolted.ok).toBe(false);
    if (!bolted.ok) expect(bolted.path).toContain("bolt");
    expect(
      parseStampManifest(
        withSet((s) => {
          (s as unknown as Record<string, unknown>).prop = {};
        }),
      ).ok,
    ).toBe(false);
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
          first(s.face.variants).sha256 = "abc";
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseStampManifest(
        withSet((s) => {
          first(s.face.variants).file = "../kits.json";
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

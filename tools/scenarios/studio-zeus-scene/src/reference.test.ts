import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  CHECK_ZOOMS,
  DIGEST_ALGORITHM,
  digestRgba,
  fnv1a32,
  INSPECT_BACKGROUND,
} from "@panthea/client/src/inspect/digest";
import { REFERENCE } from "@panthea/client/src/inspect/expected";
import { canonicalManifestText } from "@panthea/contracts";
import {
  portraitFixture,
  spriteFixture,
} from "../../../../packages/assets/src/fixtures";
import { decodePng } from "../../../../packages/assets/src/studio/png/decode";
import {
  buildReference,
  COMMITTED_REFERENCE,
  diffReference,
  type RegistryFiles,
  readCommittedRegistry,
  renderReference,
} from "./reference";

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

// The committed registry decoded and digested once for the file (zeus-retro alone is 136 frames x 4 zooms); both
// freshness tests compare against this one result instead of each regenerating it.
let regenerated: ReturnType<typeof buildReference> | undefined;
const generatedFromCommitted = () =>
  (regenerated ??= buildReference(readCommittedRegistry()));

test("regenerating from the committed blobs gives exactly the committed digests", () => {
  const generated = generatedFromCommitted();
  const committed = readFileSync(COMMITTED_REFERENCE, "utf8");

  expect(renderReference(generated)).toBe(committed);
  expect(diffReference(generated, JSON.parse(committed))).toEqual([]);
});

test("the generator test fails when a committed digest is edited", () => {
  const generated = generatedFromCommitted();
  const edited = JSON.parse(readFileSync(COMMITTED_REFERENCE, "utf8"));
  const frame = edited.assets[0].selections[0].frames[0];
  const original: string = frame.digests["2"];
  frame.digests["2"] =
    `${original.slice(0, -1)}${original.endsWith("0") ? "1" : "0"}`;

  const differences = diffReference(generated, edited);

  expect(differences).toHaveLength(1);
  expect(differences[0]).toContain("digests.2");
  expect(renderReference(edited)).not.toBe(renderReference(generated));
});

test("the committed digests cover every published asset, state and expression", () => {
  const byId = new Map(REFERENCE.assets.map((asset) => [asset.assetId, asset]));

  expect([...byId.keys()]).toEqual([
    "greek-house",
    "oak-tree",
    "zeus-portrait",
    "zeus-retro",
    "zeus-sprite",
  ]);
  // The promoted retro Zeus: all 12 slots (walk and the four facings included), 136 frames of 112x96.
  const retro = byId.get("zeus-retro");
  expect(retro?.selections.map((s) => s.key)).toEqual(
    ["idle", "seated", "walk"].flatMap((state) =>
      ["east", "north", "south", "west"].map((d) => `${state}/${d}`),
    ),
  );
  const frameCount = (key: string) =>
    retro?.selections.find((s) => s.key === key)?.frames.length;
  for (const d of ["south", "east", "north", "west"]) {
    expect([
      frameCount(`idle/${d}`),
      frameCount(`seated/${d}`),
      frameCount(`walk/${d}`),
    ]).toEqual([10, 8, 16]);
  }
  expect(retro?.selections.reduce((sum, s) => sum + s.frames.length, 0)).toBe(
    136,
  );
  for (const frame of retro?.selections.flatMap((s) => s.frames) ?? []) {
    expect([frame.rect.w, frame.rect.h]).toEqual([112, 96]);
    expect(Object.keys(frame.digests)).toEqual(["1", "2", "3", "4"]);
  }
  expect(retro?.atlas.blob).toBe(
    "fe9fdb0846e8e25042f76ca67ba28650a0cf6141a0c6654e0946e4cb4f5c0cc4",
  );
  // The structures: south only, each state on the 192x192 structure cell. The house is three stills; the oak's
  // intact and damaged are 12-frame wind loops and its ruin a still.
  for (const [id, counts, blob] of [
    [
      "greek-house",
      { "damaged/south": 1, "intact/south": 1, "ruin/south": 1 },
      "97a8f8864d75f71ad95a38e77d15446a1b6c22ebd5945daad353439c730edbd1",
    ],
    [
      "oak-tree",
      { "damaged/south": 12, "intact/south": 12, "ruin/south": 1 },
      "db30050550da74d3fc8c19394c5d2aa889cc4686b4bb2470b18cec2e83821020",
    ],
  ] as const) {
    const structure = byId.get(id);
    expect(structure?.atlas.blob).toBe(blob);
    expect(
      Object.fromEntries(
        structure?.selections.map((s) => [s.key, s.frames.length]) ?? [],
      ),
    ).toEqual(counts);
    for (const frame of structure?.selections.flatMap((s) => s.frames) ?? []) {
      expect([frame.rect.w, frame.rect.h]).toEqual([192, 192]);
      expect(Object.keys(frame.digests)).toEqual(["1", "2", "3", "4"]);
    }
  }
  const sprite = byId.get("zeus-sprite");
  // selections sort by key, so the act (with its ability) comes first
  expect(sprite?.selections.map((s) => s.key)).toEqual([
    "act/south/thunderbolt",
    "idle/south",
    "seated/south",
  ]);
  expect(sprite?.selections[0]?.query).toEqual({
    state: "act",
    direction: "south",
    ability: "thunderbolt",
  });
  expect(sprite?.selections[0]?.frames.map((f) => f.rect.x)).toEqual([
    384, 448, 512, 576, 640,
  ]);
  expect(sprite?.selections[1]?.frames.map((f) => f.rect.x)).toEqual([
    0, 64, 128, 192,
  ]);
  expect(sprite?.selections[2]?.frames.map((f) => f.rect.x)).toEqual([
    256, 320,
  ]);
  const portrait = byId.get("zeus-portrait");
  expect(portrait?.selections.map((s) => s.key)).toEqual([
    "expression:angry",
    "expression:awed",
    "expression:grieving",
    "expression:neutral",
    "expression:pleased",
    "expression:scheming",
  ]);
  for (const asset of REFERENCE.assets) {
    for (const selection of asset.selections) {
      for (const frame of selection.frames) {
        expect(Object.keys(frame.digests)).toEqual(CHECK_ZOOMS.map(String));
      }
    }
  }
  expect(sprite?.atlas.blob).toBe(
    "9976a62d051e1f0349a1f61d5f1cf2e3e673b8b06e97760290c8b99f5c626a69",
  );
});

test("the file's constants are the client's, so both sides digest the same way", () => {
  expect(REFERENCE.algorithm).toBe(DIGEST_ALGORITHM);
  expect(REFERENCE.background).toEqual([...INSPECT_BACKGROUND]);
  expect(REFERENCE.zooms).toEqual([...CHECK_ZOOMS]);
  expect(REFERENCE.schemaVersion).toBe(1);
});

test("a frame's digest at each zoom is the digest of its decoded pixels, composited over the background and enlarged", () => {
  const sprite = REFERENCE.assets.find((a) => a.assetId === "zeus-sprite");
  const frame = sprite?.selections.find((s) => s.key === "idle/south")
    ?.frames[2];
  if (frame === undefined || sprite === undefined) throw new Error("no frame");
  const blob = readFileSync(
    new URL(
      `../../../../content/greek/assets/registry/blobs/${sprite.atlas.blob}.png`,
      import.meta.url,
    ),
  );
  const decoded = decodePng(new Uint8Array(blob));
  if (!decoded.ok) throw new Error(decoded.message);
  const { rgba, width } = decoded.image;
  const { x, y, w, h } = frame.rect;

  for (const zoom of CHECK_ZOOMS) {
    // Pixel by pixel, with no helper from the code under test.
    const bytes: number[] = [];
    for (let row = 0; row < h * zoom; row += 1) {
      for (let col = 0; col < w * zoom; col += 1) {
        const at =
          ((y + Math.floor(row / zoom)) * width + x + Math.floor(col / zoom)) *
          4;
        const solid = (rgba[at + 3] ?? 0) >= 128;
        bytes.push(
          solid ? (rgba[at] ?? 0) : INSPECT_BACKGROUND[0],
          solid ? (rgba[at + 1] ?? 0) : INSPECT_BACKGROUND[1],
          solid ? (rgba[at + 2] ?? 0) : INSPECT_BACKGROUND[2],
          255,
        );
      }
    }
    const seed = fnv1a32(
      new Uint8Array(le(h * zoom)),
      fnv1a32(new Uint8Array(le(w * zoom))),
    );
    const hash = fnv1a32(new Uint8Array(bytes), seed);
    expect(frame.digests[String(zoom)]).toBe(
      `${DIGEST_ALGORITHM}:${hash.toString(16).padStart(8, "0")}`,
    );
  }
});

function le(value: number): number[] {
  return [
    value & 255,
    (value >>> 8) & 255,
    (value >>> 16) & 255,
    (value >>> 24) & 255,
  ];
}

function isolatedRegistry(): RegistryFiles {
  const sprite = spriteFixture("fixture-sprite", 3);
  const portrait = portraitFixture("fixture-portrait", "fixture", 5);
  const manifests = new Map<string, string>();
  const blobs = new Map<string, Uint8Array>();
  const entries: { assetId: string; revision: string }[] = [];
  for (const asset of [portrait, sprite]) {
    const text = canonicalManifestText(asset.manifest);
    const revision = sha256(text);
    manifests.set(revision, text);
    entries.push({ assetId: asset.manifest.id, revision });
    for (const [hash, bytes] of asset.blobs) blobs.set(hash, bytes);
  }
  entries.sort((a, b) => (a.assetId < b.assetId ? -1 : 1));
  return {
    vocabulary: JSON.stringify(
      JSON.parse(
        readFileSync(
          new URL(
            "../../../../content/greek/assets/vocabulary.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    ),
    index: JSON.stringify({ schemaVersion: 1, entries }),
    manifests,
    blobs,
  };
}

test("an isolated registry yields a digest per frame and zoom, sorted by asset and selection", () => {
  const reference = buildReference(isolatedRegistry());

  expect(reference.assets.map((a) => a.assetId)).toEqual([
    "fixture-portrait",
    "fixture-sprite",
  ]);
  const sprite = reference.assets[1];
  expect(sprite?.selections).toHaveLength(1);
  expect(sprite?.selections[0]?.key).toBe("idle/south");
  expect(sprite?.selections[0]?.query).toEqual({
    state: "idle",
    direction: "south",
  });
  expect(sprite?.selections[0]?.frames).toHaveLength(4);
  // A uniform atlas: every frame of it digests alike, and each zoom differs.
  const digests = sprite?.selections[0]?.frames[0]?.digests ?? {};
  expect(new Set(Object.values(digests)).size).toBe(4);
  expect(
    digestRgba({ width: 1, height: 1, data: new Uint8Array(4) }),
  ).toContain(DIGEST_ALGORITHM);
});

test("a blob whose bytes do not hash to its name is refused, not digested", () => {
  const files = isolatedRegistry();
  const [hash] = [...files.blobs.keys()];
  if (hash === undefined) throw new Error("no blob");
  const tampered = new Uint8Array(files.blobs.get(hash) ?? []);
  tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
  const blobs = new Map(files.blobs).set(hash, tampered);

  expect(() => buildReference({ ...files, blobs })).toThrow(/hash/);
});

test("an index revision with no manifest, or an unreadable blob, stops the generator", () => {
  const files = isolatedRegistry();

  expect(() => buildReference({ ...files, manifests: new Map() })).toThrow(
    /manifest/,
  );
  expect(() => buildReference({ ...files, blobs: new Map() })).toThrow(/blob/);
});

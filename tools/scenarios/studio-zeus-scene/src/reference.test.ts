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

test("regenerating from the committed blobs gives exactly the committed digests", () => {
  const generated = buildReference(readCommittedRegistry());
  const committed = readFileSync(COMMITTED_REFERENCE, "utf8");

  expect(renderReference(generated)).toBe(committed);
  expect(diffReference(generated, JSON.parse(committed))).toEqual([]);
});

test("the generator test fails when a committed digest is edited", () => {
  const generated = buildReference(readCommittedRegistry());
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

  expect([...byId.keys()]).toEqual(["zeus-portrait", "zeus-sprite"]);
  const sprite = byId.get("zeus-sprite");
  expect(sprite?.selections.map((s) => s.key)).toEqual(["idle/south"]);
  expect(sprite?.selections[0]?.frames.map((f) => f.rect.x)).toEqual([
    0, 64, 128, 192,
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
    "0fe8067fda22c1704ef491513419c412ec77a1a9ffa05907b593346540ac515e",
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
  const frame = sprite?.selections[0]?.frames[2];
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

// Test support for the canon layer: an isolated copy of Zeus's committed
// sprite manifest, its atlas and the vocabulary (never the committed registry
// itself), a payload shaped like `canon_registry`'s, and a fake source that
// counts what the webview asks for. Hashes come from node:crypto so they are
// independent of the client's own sha256.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { decodePng as decodeNodePng } from "@panthea/assets/studio";
import { type DecodedImage, rgbaImage } from "@panthea/renderer";
import type { CanonSource } from "./canon";

const fixture = (name: string): Buffer =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

export const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

export const ZEUS_MANIFEST_TEXT = fixture("zeus-sprite.manifest.json").toString(
  "utf8",
);
export const ZEUS_ATLAS_BYTES = new Uint8Array(
  fixture("zeus-sprite.atlas.png"),
);
export const VOCABULARY_TEXT = fixture("vocabulary.json").toString("utf8");

/** The names the committed registry gives these files; a copy that drifted fails here. */
export const ZEUS_REVISION = sha256(ZEUS_MANIFEST_TEXT);
export const ZEUS_ATLAS_HASH = sha256(ZEUS_ATLAS_BYTES);
if (
  ZEUS_REVISION !==
    "be87747b727142391a5b48bfb4101a6618bc229797045b464780270fc93b8286" ||
  ZEUS_ATLAS_HASH !==
    "0fe8067fda22c1704ef491513419c412ec77a1a9ffa05907b593346540ac515e"
) {
  throw new Error(
    "the Zeus fixture no longer matches the committed canon copy",
  );
}

export interface RegistryPayload {
  index: string | null;
  manifests: string[];
  vocabulary: string | null;
  rootKind: "repo" | "bundled";
  problems: { path: string; reason: string }[];
}

export const indexText = (
  entries: readonly { assetId: string; revision: string }[],
): string => JSON.stringify({ schemaVersion: 1, entries });

/** A registry with only `zeus-sprite`, as `canon_registry` would return it. */
export function zeusPayload(): RegistryPayload {
  return {
    index: indexText([{ assetId: "zeus-sprite", revision: ZEUS_REVISION }]),
    manifests: [ZEUS_MANIFEST_TEXT],
    vocabulary: VOCABULARY_TEXT,
    rootKind: "repo",
    problems: [],
  };
}

export interface FakeSource extends CanonSource {
  readonly registryCalls: () => number;
  readonly atlasCalls: () => readonly string[];
}

export function fakeSource(
  payload: unknown,
  atlases: ReadonlyMap<string, Uint8Array> = new Map([
    [ZEUS_ATLAS_HASH, ZEUS_ATLAS_BYTES],
  ]),
): FakeSource {
  let registryCalls = 0;
  const atlasCalls: string[] = [];
  return {
    registry() {
      registryCalls += 1;
      return payload instanceof Error
        ? Promise.reject(payload)
        : Promise.resolve(payload);
    },
    atlas(hash) {
      atlasCalls.push(hash);
      const bytes = atlases.get(hash);
      return bytes === undefined
        ? Promise.reject(new Error(`atlas is not in the verified canon set`))
        : Promise.resolve(bytes);
    },
    registryCalls: () => registryCalls,
    atlasCalls: () => atlasCalls,
  };
}

/** A node decode of the real PNG, held as the renderer holds a decoded atlas. */
export function decodeFixture(bytes: Uint8Array): Promise<DecodedImage> {
  const decoded = decodeNodePng(bytes);
  if (!decoded.ok) return Promise.reject(new Error(decoded.message));
  const { rgba, width, height } = decoded.image;
  return Promise.resolve(rgbaImage(width, height, rgba));
}

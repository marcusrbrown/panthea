// Test support: an isolated copy of the published retro Zeus (`zeus-retro`, the 112x96 `god-tall` revision) beside
// the legacy `zeus-sprite`, never the committed registry itself. The copy is checked against the committed names, so
// one that drifted fails here. The client's own vocabulary copy predates `god-tall`, so the payload carries the
// committed vocabulary, as the live registry command does.

import { readFileSync } from "node:fs";

import {
  indexText,
  PORTRAIT_ATLAS_BYTES,
  PORTRAIT_ATLAS_HASH,
  PORTRAIT_MANIFEST_TEXT,
  PORTRAIT_REVISION,
  type RegistryPayload,
  sha256,
  ZEUS_ATLAS_BYTES,
  ZEUS_ATLAS_HASH,
  ZEUS_MANIFEST_TEXT,
  ZEUS_REVISION,
} from "./canon-fixture";
import {
  HOUSE_MANIFEST_TEXT,
  HOUSE_REVISION,
  OAK_MANIFEST_TEXT,
  OAK_REVISION,
  STRUCTURE_ATLASES,
} from "./structure-fixture";

const fixture = (name: string): Buffer =>
  readFileSync(new URL(`../src/assets/fixtures/${name}`, import.meta.url));

export const RETRO_MANIFEST_TEXT = fixture("zeus-retro.manifest.json").toString(
  "utf8",
);
export const RETRO_ATLAS_BYTES = new Uint8Array(
  fixture("zeus-retro.atlas.png"),
);
export const RETRO_REVISION = sha256(RETRO_MANIFEST_TEXT);
export const RETRO_ATLAS_HASH = sha256(RETRO_ATLAS_BYTES);
if (
  RETRO_REVISION !==
    "f254faa3c1fc6fe0ca2ac2b1f88d9556f9dfdd134b4ad9241f77a5fb37369fa6" ||
  RETRO_ATLAS_HASH !==
    "fe9fdb0846e8e25042f76ca67ba28650a0cf6141a0c6654e0946e4cb4f5c0cc4"
) {
  throw new Error(
    "the retro Zeus fixture no longer matches the committed canon copy",
  );
}

const committedVocabulary = readFileSync(
  new URL("../../../content/greek/assets/vocabulary.json", import.meta.url),
  "utf8",
);

/** The registry the game loads after promotion: `zeus-retro` published beside the legacy `zeus-sprite`. */
export function retroPayload(): RegistryPayload {
  return {
    index: indexText([
      { assetId: "zeus-retro", revision: RETRO_REVISION },
      { assetId: "zeus-sprite", revision: ZEUS_REVISION },
    ]),
    manifests: [
      { hash: RETRO_REVISION, text: RETRO_MANIFEST_TEXT },
      { hash: ZEUS_REVISION, text: ZEUS_MANIFEST_TEXT },
    ],
    vocabulary: committedVocabulary,
    rootKind: "repo",
    problems: [],
  };
}

export const RETRO_ATLASES: ReadonlyMap<string, Uint8Array> = new Map([
  [RETRO_ATLAS_HASH, RETRO_ATLAS_BYTES],
  [ZEUS_ATLAS_HASH, ZEUS_ATLAS_BYTES],
]);

/** Everything the committed canon now publishes: Zeus's portrait, the promoted retro sprite, the legacy sprite and the two structures. */
export function committedCanonPayload(): RegistryPayload {
  const retro = retroPayload();
  return {
    ...retro,
    index: indexText([
      { assetId: "greek-house", revision: HOUSE_REVISION },
      { assetId: "oak-tree", revision: OAK_REVISION },
      { assetId: "zeus-portrait", revision: PORTRAIT_REVISION },
      { assetId: "zeus-retro", revision: RETRO_REVISION },
      { assetId: "zeus-sprite", revision: ZEUS_REVISION },
    ]),
    manifests: [
      { hash: HOUSE_REVISION, text: HOUSE_MANIFEST_TEXT },
      { hash: OAK_REVISION, text: OAK_MANIFEST_TEXT },
      { hash: PORTRAIT_REVISION, text: PORTRAIT_MANIFEST_TEXT },
      ...retro.manifests,
    ],
  };
}

export const COMMITTED_CANON_ATLASES: ReadonlyMap<string, Uint8Array> = new Map(
  [
    ...RETRO_ATLASES,
    ...STRUCTURE_ATLASES,
    [PORTRAIT_ATLAS_HASH, PORTRAIT_ATLAS_BYTES],
  ],
);

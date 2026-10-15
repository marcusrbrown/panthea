// Test support for the canon layer: the grass↔flagstone tile fixture published beside Zeus, as the
// registry payload `canon_registry` would return it. Built from the contracts' own canonical manifest
// text, so the revision is the hash of the bytes the shell would have verified.

import { readFileSync } from "node:fs";
import { canonicalManifestText } from "@panthea/contracts";
import { tileFixture } from "../../../packages/assets/test/fixtures/tile";
import { indexText, type RegistryPayload, sha256 } from "./canon-fixture";

const committedVocabulary = readFileSync(
  new URL("../../../content/greek/assets/vocabulary.json", import.meta.url),
  "utf8",
);

export function tilePayload(): {
  payload: RegistryPayload;
  revision: string;
  atlases: ReadonlyMap<string, Uint8Array>;
  atlasHash: string;
} {
  const tile = tileFixture();
  const text = canonicalManifestText(tile.manifest);
  const revision = sha256(text);
  return {
    revision,
    atlasHash: String(tile.manifest.atlas.blob),
    atlases: new Map(
      [...tile.blobs].map(([hash, bytes]) => [String(hash), bytes]),
    ),
    payload: {
      index: indexText([{ assetId: "grass-flagstone", revision }]),
      manifests: [{ hash: revision, text }],
      vocabulary: committedVocabulary,
      rootKind: "repo",
      problems: [],
    },
  };
}

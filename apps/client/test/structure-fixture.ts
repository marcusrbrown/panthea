// Test support: isolated copies of the published structures (`greek-house` and `oak-tree`, 192x192 on the
// `structure` cell), never the committed registry itself. The copies are checked against the committed names, so
// one that drifted fails here.

import { readFileSync } from "node:fs";

import { sha256 } from "./canon-fixture";

const fixture = (name: string): Buffer =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

const text = (name: string): string => fixture(name).toString("utf8");
const bytes = (name: string): Uint8Array => new Uint8Array(fixture(name));

export const HOUSE_MANIFEST_TEXT = text("greek-house.manifest.json");
export const HOUSE_ATLAS_BYTES = bytes("greek-house.atlas.png");
export const HOUSE_REVISION = sha256(HOUSE_MANIFEST_TEXT);
export const HOUSE_ATLAS_HASH = sha256(HOUSE_ATLAS_BYTES);

export const OAK_MANIFEST_TEXT = text("oak-tree.manifest.json");
export const OAK_ATLAS_BYTES = bytes("oak-tree.atlas.png");
export const OAK_REVISION = sha256(OAK_MANIFEST_TEXT);
export const OAK_ATLAS_HASH = sha256(OAK_ATLAS_BYTES);

if (
  HOUSE_REVISION !==
    "ddbfc20b4b6fccac32906a706982874d6852ed6d1a35fb5153781048834a03dc" ||
  HOUSE_ATLAS_HASH !==
    "97a8f8864d75f71ad95a38e77d15446a1b6c22ebd5945daad353439c730edbd1" ||
  OAK_REVISION !==
    "8a1c461e1609d3bc972ed0d3bdbb22d10caf5f6b6277b88c7ccac38ba7338b45" ||
  OAK_ATLAS_HASH !==
    "db30050550da74d3fc8c19394c5d2aa889cc4686b4bb2470b18cec2e83821020"
) {
  throw new Error(
    "the structure fixtures no longer match the committed canon copy",
  );
}

export const STRUCTURE_ATLASES: ReadonlyMap<string, Uint8Array> = new Map([
  [HOUSE_ATLAS_HASH, HOUSE_ATLAS_BYTES],
  [OAK_ATLAS_HASH, OAK_ATLAS_BYTES],
]);

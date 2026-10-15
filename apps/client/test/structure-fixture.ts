// Test support: isolated copies of the published structures (`greek-house` and `oak-tree`, 192x192 on the
// `structure` cell) and effects (`fire`, 64x88, and `lightning-strike`, 64x128), never the committed registry
// itself. The copies are checked against the committed names, so one that drifted fails here.

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

export const FIRE_MANIFEST_TEXT = text("fire.manifest.json");
export const FIRE_ATLAS_BYTES = bytes("fire.atlas.png");
export const FIRE_REVISION = sha256(FIRE_MANIFEST_TEXT);
export const FIRE_ATLAS_HASH = sha256(FIRE_ATLAS_BYTES);

export const STRIKE_MANIFEST_TEXT = text("lightning-strike.manifest.json");
export const STRIKE_ATLAS_BYTES = bytes("lightning-strike.atlas.png");
export const STRIKE_REVISION = sha256(STRIKE_MANIFEST_TEXT);
export const STRIKE_ATLAS_HASH = sha256(STRIKE_ATLAS_BYTES);

if (
  HOUSE_REVISION !==
    "ddbfc20b4b6fccac32906a706982874d6852ed6d1a35fb5153781048834a03dc" ||
  HOUSE_ATLAS_HASH !==
    "97a8f8864d75f71ad95a38e77d15446a1b6c22ebd5945daad353439c730edbd1" ||
  OAK_REVISION !==
    "8a1c461e1609d3bc972ed0d3bdbb22d10caf5f6b6277b88c7ccac38ba7338b45" ||
  OAK_ATLAS_HASH !==
    "db30050550da74d3fc8c19394c5d2aa889cc4686b4bb2470b18cec2e83821020" ||
  FIRE_REVISION !==
    "764fe2d5dd56200ae30799c6cf6b743c8432eb785336416ca8346e4762b114e2" ||
  FIRE_ATLAS_HASH !==
    "b0ef2ec70e190b61e7454af9db0648335d37b930a1f647dc7e9c6912ee315323" ||
  STRIKE_REVISION !==
    "115e3d84526acbfe222f9b9fa6ceb179c40acaaa702939c1dfa73934024e26bd" ||
  STRIKE_ATLAS_HASH !==
    "dd8220f14a22c7f275222b0017f90fa2fd6456644db74f7f2c7e9ea1038575f6"
) {
  throw new Error(
    "the structure fixtures no longer match the committed canon copy",
  );
}

export const STRUCTURE_ATLASES: ReadonlyMap<string, Uint8Array> = new Map([
  [HOUSE_ATLAS_HASH, HOUSE_ATLAS_BYTES],
  [OAK_ATLAS_HASH, OAK_ATLAS_BYTES],
]);

export const EFFECT_ATLASES: ReadonlyMap<string, Uint8Array> = new Map([
  [FIRE_ATLAS_HASH, FIRE_ATLAS_BYTES],
  [STRIKE_ATLAS_HASH, STRIKE_ATLAS_BYTES],
]);

// The reference digests' effect branch: a published effect gets one selection
// per animation, named `animation:<name>`, with a digest per frame at each
// zoom, exactly as a sprite state does.

import { expect, test } from "bun:test";
import { CHECK_ZOOMS } from "@panthea/client/src/inspect/digest";
import { REFERENCE } from "@panthea/client/src/inspect/expected";
import {
  buildReference,
  type RegistryFiles,
  readCommittedRegistry,
} from "./reference";

const effect = (id: string) =>
  REFERENCE.assets.find((asset) => asset.assetId === id);

test("the committed digests cover the fire loop and both strikes, frame by frame, at every zoom", () => {
  const fire = effect("fire");
  const strike = effect("lightning-strike");

  expect(fire?.kind).toBe("effect");
  expect(strike?.kind).toBe("effect");
  expect(fire?.atlas.blob).toBe(
    "b0ef2ec70e190b61e7454af9db0648335d37b930a1f647dc7e9c6912ee315323",
  );
  expect(strike?.atlas.blob).toBe(
    "dd8220f14a22c7f275222b0017f90fa2fd6456644db74f7f2c7e9ea1038575f6",
  );
  expect(fire?.selections.map((s) => [s.key, s.frames.length])).toEqual([
    ["animation:burn", 10],
  ]);
  // Selections sort by key: calm before full.
  expect(strike?.selections.map((s) => [s.key, s.frames.length])).toEqual([
    ["animation:calm", 4],
    ["animation:full", 8],
  ]);
  expect(fire?.selections[0]?.query).toEqual({ animation: "burn" });
  for (const frame of fire?.selections.flatMap((s) => s.frames) ?? []) {
    expect([frame.rect.w, frame.rect.h]).toEqual([64, 88]);
    expect(Object.keys(frame.digests)).toEqual(CHECK_ZOOMS.map(String));
  }
  for (const frame of strike?.selections.flatMap((s) => s.frames) ?? []) {
    expect([frame.rect.w, frame.rect.h]).toEqual([64, 128]);
    expect(Object.keys(frame.digests)).toEqual(CHECK_ZOOMS.map(String));
  }
  // The calm animation's frames are the last four cells of the atlas, after the full animation's eight.
  expect(
    strike?.selections
      .find((s) => s.key === "animation:calm")
      ?.frames.map((f) => f.rect.x),
  ).toEqual([512, 576, 640, 704]);
});

test("every effect frame digests differently from its neighbours, so a wrong frame cannot pass for the right one", () => {
  for (const asset of REFERENCE.assets.filter((a) => a.kind === "effect")) {
    for (const selection of asset.selections) {
      const digests = selection.frames.map((frame) => frame.digests["1"]);
      expect(new Set(digests).size).toBe(digests.length);
    }
  }
});

/** The committed registry cut down to `ids`, as a registry of only those assets. */
function registryOf(ids: readonly string[]): RegistryFiles {
  const files = readCommittedRegistry();
  const index = JSON.parse(files.index) as {
    entries: { assetId: string; revision: string }[];
  };
  return {
    ...files,
    index: JSON.stringify({
      schemaVersion: 1,
      entries: index.entries.filter((entry) => ids.includes(entry.assetId)),
    }),
  };
}

test("an effect alone in a registry yields its animations as selections, sorted by key", () => {
  const reference = buildReference(registryOf(["lightning-strike"]));

  expect(reference.assets.map((a) => a.assetId)).toEqual(["lightning-strike"]);
  expect(reference.assets[0]?.selections.map((s) => s.key)).toEqual([
    "animation:calm",
    "animation:full",
  ]);
});

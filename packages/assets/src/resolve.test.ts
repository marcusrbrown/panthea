import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  type AssetId,
  type AssetManifest,
  assetUri,
  parseAssetManifest,
  parseAssetVocabulary,
  type Sha256,
} from "@panthea/contracts";
import { tileFixture } from "../test/fixtures/tile";
import { portraitFixture, spriteFixture } from "./fixtures";
import { sha256Hex } from "./hash";
import { renderPlaceholder } from "./placeholder";
import { EMPTY_SNAPSHOT, type RegistrySnapshot, resolveAsset } from "./resolve";
import type { SnapshotEntry } from "./resolve-core";

const REVISION = "r".repeat(1) as string;

function snapshot(...assets: { manifest: AssetManifest }[]): RegistrySnapshot {
  return {
    entries: new Map(
      assets.map((a) => [
        a.manifest.id,
        {
          assetId: a.manifest.id as AssetId,
          revision: sha256Hex(
            new TextEncoder().encode(REVISION + a.manifest.id),
          ) as Sha256,
          manifest: a.manifest,
        },
      ]),
    ),
  };
}

describe("resolveAsset", () => {
  const sprite = spriteFixture();
  const portrait = portraitFixture();
  const snap = snapshot(sprite, portrait);

  it("resolves canon idle-south by default", () => {
    const result = resolveAsset(snap, { spriteId: "placeholder-zeus" });
    expect(result).toMatchObject({
      source: "canon",
      kind: "sprite",
      assetId: "placeholder-zeus",
      uri: assetUri("placeholder-zeus" as AssetId),
      cell: { w: 64, h: 80 },
      pivot: { x: 32, y: 80 },
    });
    if (result.source === "canon") {
      expect(result.frames).toHaveLength(4);
      expect(result.atlas).toEqual(sprite.manifest.atlas);
    }
  });

  it("falls back to a deterministic placeholder per unresolved state", () => {
    const missingState = resolveAsset(snap, {
      spriteId: "placeholder-zeus",
      state: "seated",
    });
    expect(missingState).toMatchObject({
      source: "placeholder",
      reason: "missing-state",
    });
    const missingDirection = resolveAsset(snap, {
      spriteId: "placeholder-zeus",
      direction: "north",
    });
    expect(missingDirection).toMatchObject({
      source: "placeholder",
      reason: "missing-state",
    });
    const missingAbility = resolveAsset(snap, {
      spriteId: "placeholder-zeus",
      state: "act",
      ability: "thunderbolt",
    });
    expect(missingAbility).toMatchObject({
      source: "placeholder",
      reason: "missing-state",
    });
    const again = resolveAsset(snap, {
      spriteId: "placeholder-zeus",
      state: "seated",
    });
    expect(again).toEqual(missingState);
  });

  it("falls back for an unknown id, including against an empty snapshot", () => {
    const unknown = resolveAsset(snap, { spriteId: "placeholder-hera" });
    expect(unknown).toMatchObject({
      source: "placeholder",
      reason: "missing-id",
    });
    const empty = resolveAsset(EMPTY_SNAPSHOT, {
      spriteId: "placeholder-zeus",
    });
    expect(empty).toMatchObject({
      source: "placeholder",
      reason: "missing-id",
    });
    if (empty.source === "placeholder") {
      expect(empty.uri).toBe(renderPlaceholder({ palette: [], parts: {} }).uri);
      expect(empty.uri).toMatch(
        /^panthea-asset:\/\/placeholder\/[0-9a-f]{64}$/,
      );
    }
  });

  it("uses the supplied placeholder input for the fallback", () => {
    const input = { palette: ["#4a6fa5"], parts: { body: "tall" } };
    const result = resolveAsset(EMPTY_SNAPSHOT, { spriteId: "x-y" }, input);
    expect(result.uri).toBe(renderPlaceholder(input).uri);
  });

  it("resolves a portrait expression and refuses mismatched kinds", () => {
    const awed = resolveAsset(snap, {
      spriteId: "zeus-portrait",
      expression: "awed",
    });
    expect(awed).toMatchObject({ source: "canon", kind: "portrait" });
    if (awed.source === "canon") expect(awed.frames).toHaveLength(1);
    expect(
      resolveAsset(snap, { spriteId: "zeus-portrait", expression: "angry" }),
    ).toMatchObject({ reason: "missing-state" });
    expect(
      resolveAsset(snap, { spriteId: "placeholder-zeus", expression: "awed" }),
    ).toMatchObject({ reason: "wrong-kind" });
    expect(resolveAsset(snap, { spriteId: "zeus-portrait" })).toMatchObject({
      reason: "wrong-kind",
    });
  });
});

const REGISTRY = new URL(
  "../../../content/greek/assets/registry/",
  import.meta.url,
);

/** The committed fire and lightning manifests, parsed under the committed vocabulary, as a registry holds them. */
function committedEffects(): RegistrySnapshot {
  const vocabulary = parseAssetVocabulary(
    JSON.parse(
      readFileSync(
        new URL(
          "../../../content/greek/assets/vocabulary.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  if (!vocabulary.ok) throw new Error(vocabulary.message);
  const index = JSON.parse(
    readFileSync(new URL("index.json", REGISTRY), "utf8"),
  ) as { entries: { assetId: string; revision: string }[] };
  const entries = new Map<string, SnapshotEntry>();
  for (const id of ["fire", "lightning-strike", "greek-house"]) {
    const found = index.entries.find((entry) => entry.assetId === id);
    if (found === undefined) throw new Error(`${id} is not published`);
    const parsed = parseAssetManifest(
      JSON.parse(
        readFileSync(
          new URL(`manifests/${found.revision}.json`, REGISTRY),
          "utf8",
        ),
      ),
      vocabulary.value,
    );
    if (!parsed.ok) throw new Error(parsed.message);
    entries.set(id, {
      assetId: id as AssetId,
      revision: found.revision as Sha256,
      manifest: parsed.value,
    });
  }
  return { entries };
}

describe("resolveAsset for effects", () => {
  const snap = committedEffects();

  it("resolves a named animation of an effect, with its cell, pivot and frames", () => {
    const calm = resolveAsset(snap, {
      spriteId: "lightning-strike",
      animation: "calm",
    });
    expect(calm).toMatchObject({
      source: "canon",
      kind: "effect",
      assetId: "lightning-strike",
      cell: { w: 64, h: 128 },
      pivot: { x: 32, y: 116 },
    });
    if (calm.source === "canon") {
      expect(calm.frames.map((frame) => frame.durationMs)).toEqual([
        150, 130, 130, 130,
      ]);
      expect(calm.frames.map((frame) => frame.rect.x)).toEqual([
        512, 576, 640, 704,
      ]);
      expect(calm.loopStart).toBeUndefined();
    }
    const full = resolveAsset(snap, {
      spriteId: "lightning-strike",
      animation: "full",
    });
    if (full.source !== "canon") throw new Error("expected canon");
    expect(full.frames).toHaveLength(8);
    const burn = resolveAsset(snap, { spriteId: "fire", animation: "burn" });
    if (burn.source !== "canon") throw new Error("expected canon");
    expect(burn.frames).toHaveLength(10);
    expect(burn.pivot).toEqual({ x: 32, y: 88 });
  });

  it("refuses an animation the effect does not publish, and a mismatch of kind either way", () => {
    expect(
      resolveAsset(snap, { spriteId: "fire", animation: "smoulder" }),
    ).toMatchObject({ source: "placeholder", reason: "missing-state" });
    expect(
      resolveAsset(snap, { spriteId: "greek-house", animation: "burn" }),
    ).toMatchObject({ source: "placeholder", reason: "wrong-kind" });
    // An effect is asked for by animation name, never as a sprite state.
    expect(resolveAsset(snap, { spriteId: "fire" })).toMatchObject({
      source: "placeholder",
      reason: "wrong-kind",
    });
    expect(
      resolveAsset(snap, { spriteId: "missing", animation: "burn" }),
    ).toMatchObject({ source: "placeholder", reason: "missing-id" });
  });
});

describe("resolveAsset for tiles", () => {
  const tile = tileFixture();
  const sprite = spriteFixture();
  const snap = snapshot(tile, sprite);
  const query = (mask: number, offset: number, id = "grass-flagstone") => ({
    spriteId: id,
    tile: { mask, offset },
  });

  it("resolves a (mask, offset) to the one atlas cell: frame index offset * 16 + mask", () => {
    for (const [mask, offset] of [
      [0, 0],
      [15, 0],
      [0, 15],
      [15, 15],
      [5, 7],
    ] as const) {
      const result = resolveAsset(snap, query(mask, offset));
      expect(result, `${mask},${offset}`).toMatchObject({
        source: "canon",
        kind: "tile",
        assetId: "grass-flagstone",
        cell: { w: 64, h: 32 },
      });
      if (result.source !== "canon") return;
      const index = offset * 16 + mask;
      expect(result.frames).toHaveLength(1);
      expect(result.frames[0]?.rect).toEqual({
        x: (index % 16) * 64,
        y: Math.floor(index / 16) * 32,
        w: 64,
        h: 32,
      });
      expect(result.atlas).toEqual(tile.manifest.atlas);
      expect(result.pivot).toBeUndefined();
      expect(result.footprint).toBeUndefined();
    }
  });

  it("refuses a mask or offset outside the set as a missing state, and an id that is not there", () => {
    for (const [mask, offset] of [
      [16, 0],
      [-1, 0],
      [0, 16],
      [0, -1],
      [1.5, 0],
    ] as const)
      expect(resolveAsset(snap, query(mask, offset))).toMatchObject({
        source: "placeholder",
        reason: "missing-state",
      });
    expect(resolveAsset(snap, query(0, 0, "nowhere"))).toMatchObject({
      source: "placeholder",
      reason: "missing-id",
    });
  });

  it("keeps the kinds apart: a tile is not a sprite, a sprite or portrait is not a tile", () => {
    expect(resolveAsset(snap, { spriteId: "grass-flagstone" })).toMatchObject({
      source: "placeholder",
      reason: "wrong-kind",
    });
    expect(resolveAsset(snap, query(0, 0, "placeholder-zeus"))).toMatchObject({
      source: "placeholder",
      reason: "wrong-kind",
    });
    expect(
      resolveAsset(snap, { spriteId: "grass-flagstone", expression: "awed" }),
    ).toMatchObject({ source: "placeholder", reason: "wrong-kind" });
    expect(
      resolveAsset(snap, { spriteId: "grass-flagstone", animation: "burn" }),
    ).toMatchObject({ source: "placeholder", reason: "wrong-kind" });
  });
});

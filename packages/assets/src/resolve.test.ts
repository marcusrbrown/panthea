import { describe, expect, it } from "bun:test";
import { type AssetId, assetUri, type Sha256 } from "@panthea/contracts";
import { portraitFixture, spriteFixture } from "./fixtures";
import { sha256Hex } from "./hash";
import { renderPlaceholder } from "./placeholder";
import { EMPTY_SNAPSHOT, type RegistrySnapshot, resolveAsset } from "./resolve";

const REVISION = "r".repeat(1) as string;

function snapshot(
  ...assets: ReturnType<typeof spriteFixture | typeof portraitFixture>[]
): RegistrySnapshot {
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

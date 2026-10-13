import { describe, expect, it } from "bun:test";
import type { AssetId, Sha256 } from "@panthea/contracts";
import {
  DEFAULT_PLACEHOLDER as BROWSER_DEFAULT_PLACEHOLDER,
  EMPTY_SNAPSHOT as BROWSER_EMPTY_SNAPSHOT,
  resolveAssetPixels,
} from "./browser";
import { portraitFixture, spriteFixture } from "./fixtures";
import { sha256Hex } from "./hash";
import {
  DEFAULT_PLACEHOLDER,
  EMPTY_SNAPSHOT,
  type RegistrySnapshot,
  resolveAsset,
} from "./resolve";
import { decodePng } from "./studio/png/decode";

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
            new TextEncoder().encode(`r${a.manifest.id}`),
          ) as Sha256,
          manifest: a.manifest,
        },
      ]),
    ),
  };
}

const snap = snapshot(spriteFixture(), portraitFixture());
const CUSTOM = { palette: ["#4a6fa5", "#b23a48"], parts: { body: "tall" } };

describe("resolveAssetPixels", () => {
  it("shares the snapshot and default placeholder constants with the node path", () => {
    expect(BROWSER_EMPTY_SNAPSHOT).toBe(EMPTY_SNAPSHOT);
    expect(BROWSER_DEFAULT_PLACEHOLDER).toBe(DEFAULT_PLACEHOLDER);
  });

  it("resolves canon identically to the node resolver", () => {
    for (const query of [
      { spriteId: "placeholder-zeus" },
      { spriteId: "zeus-portrait", expression: "awed" },
    ]) {
      const node = resolveAsset(snap, query);
      expect(node.source).toBe("canon");
      expect(resolveAssetPixels(snap, query) as unknown).toEqual(node);
    }
  });

  const MISSES = [
    ["missing id", { spriteId: "placeholder-hera" }, "missing-id"],
    [
      "missing state",
      { spriteId: "placeholder-zeus", state: "seated" },
      "missing-state",
    ],
    [
      "missing direction",
      { spriteId: "placeholder-zeus", direction: "north" },
      "missing-state",
    ],
    [
      "missing expression",
      { spriteId: "zeus-portrait", expression: "angry" },
      "missing-state",
    ],
    [
      "expression on a sprite",
      { spriteId: "placeholder-zeus", expression: "awed" },
      "wrong-kind",
    ],
    ["sprite query on a portrait", { spriteId: "zeus-portrait" }, "wrong-kind"],
  ] as const;

  for (const [name, query, reason] of MISSES) {
    for (const [label, input] of [
      ["default", DEFAULT_PLACEHOLDER],
      ["custom", CUSTOM],
    ] as const) {
      it(`${name} (${label} placeholder) draws the node path's pixels`, () => {
        const node = resolveAsset(snap, query, input);
        const browser = resolveAssetPixels(snap, query, input);
        if (node.source !== "placeholder")
          throw new Error("expected node miss");
        expect(browser.source).toBe("placeholder");
        if (browser.source !== "placeholder") return;
        expect(browser.reason).toBe(reason);
        expect(browser.reason).toBe(node.reason);
        const decoded = decodePng(node.placeholder.bytes);
        if (!decoded.ok) throw new Error(decoded.message);
        expect(browser.pixels.width).toBe(decoded.image.width);
        expect(browser.pixels.height).toBe(decoded.image.height);
        expect(Array.from(browser.pixels.rgba)).toEqual(
          Array.from(decoded.image.rgba),
        );
      });
    }
  }

  it("against an empty snapshot gives the default placeholder with no uri or bytes", () => {
    const result = resolveAssetPixels(BROWSER_EMPTY_SNAPSHOT, {
      spriteId: "placeholder-zeus",
    });
    expect(result.source).toBe("placeholder");
    expect(Object.keys(result).sort()).toEqual(["pixels", "reason", "source"]);
    if (result.source === "placeholder") {
      expect(Object.keys(result.pixels).sort()).toEqual([
        "height",
        "rgba",
        "width",
      ]);
    }
  });
});

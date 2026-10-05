import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { renderPlaceholder } from "./placeholder";

describe("renderPlaceholder", () => {
  it("produces the same URI and image hash for the same inputs", () => {
    const input = {
      palette: ["#8b5e34", "#c9a35c", "#4a6fa5"],
      parts: { body: "humanoid", head: "crowned", prop: "staff" },
    } as const;

    const first = renderPlaceholder(input);
    const second = renderPlaceholder(input);

    expect(second.uri).toBe(first.uri);
    expect(first.uri).toMatch(/^panthea-asset:\/\/placeholder\/[0-9a-f]{64}$/);
    expect(Buffer.from(second.bytes).equals(Buffer.from(first.bytes))).toBe(
      true,
    );
    const hash1 = createHash("sha256").update(first.bytes).digest("hex");
    const hash2 = createHash("sha256").update(second.bytes).digest("hex");
    expect(hash2).toBe(hash1);
  });

  it("produces a different URI for different inputs", () => {
    const a = renderPlaceholder({
      palette: ["#8b5e34"],
      parts: { body: "humanoid", head: "round", prop: "staff" },
    });
    const b = renderPlaceholder({
      palette: ["#4a6fa5"],
      parts: { body: "round", head: "hooded", prop: "sword" },
    });

    expect(a.uri).not.toBe(b.uri);
  });

  it("falls back to a default silhouette for an unknown part name instead of throwing", () => {
    expect(() =>
      renderPlaceholder({
        palette: ["#8b5e34", "#c9a35c"],
        parts: {
          body: "not-a-real-shape",
          head: "also-not-real",
          prop: "definitely-not-real",
        },
      }),
    ).not.toThrow();

    const fallback = renderPlaceholder({
      palette: ["#8b5e34", "#c9a35c"],
      parts: {
        body: "not-a-real-shape",
        head: "also-not-real",
        prop: "definitely-not-real",
      },
    });
    const defaults = renderPlaceholder({
      palette: ["#8b5e34", "#c9a35c"],
      parts: {},
    });

    // An unrecognized part name resolves to the same default shape as
    // omitting the part entirely.
    expect(fallback.uri).toBe(defaults.uri);
  });

  it("produces a valid PNG signature and 16x16 dimensions", () => {
    const asset = renderPlaceholder({
      palette: ["#8b5e34", "#c9a35c"],
      parts: { body: "tall", head: "hooded", prop: "none" },
    });

    const signature = Buffer.from(asset.bytes.subarray(0, 8));
    expect(signature.toString("hex")).toBe("89504e470d0a1a0a");
    expect(asset.width).toBe(16);
    expect(asset.height).toBe(16);
  });

  it("never throws on an empty palette", () => {
    expect(() =>
      renderPlaceholder({ palette: [], parts: { body: "humanoid" } }),
    ).not.toThrow();
  });
});

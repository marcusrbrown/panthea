import { describe, expect, it } from "bun:test";
import { renderPlaceholder } from "./placeholder";
import { renderPlaceholderPixels } from "./placeholder-pixels";
import { decodePng } from "./studio/png/decode";

// The same inputs as placeholder.golden.test.ts, whose PNG bytes and sha256
// are pinned there. Decoding the golden PNG is the independent reference for
// the pixel-only path.
const INPUTS = [
  {
    palette: ["#8b5e34", "#c9a35c", "#4a6fa5"],
    parts: { body: "humanoid", head: "crowned", prop: "staff" },
  },
  {
    palette: ["#8b5e34"],
    parts: { body: "humanoid", head: "round", prop: "staff" },
  },
  {
    palette: ["#4a6fa5"],
    parts: { body: "round", head: "hooded", prop: "sword" },
  },
  {
    palette: ["#8b5e34", "#c9a35c"],
    parts: {
      body: "not-a-real-shape",
      head: "also-not-real",
      prop: "definitely-not-real",
    },
  },
  {
    palette: ["#8b5e34", "#c9a35c"],
    parts: { body: "tall", head: "hooded", prop: "none" },
  },
  { palette: [], parts: {} },
] as const;

describe("renderPlaceholderPixels", () => {
  for (const [index, input] of INPUTS.entries()) {
    it(`equals the decoded golden PNG for input ${index}`, () => {
      const decoded = decodePng(renderPlaceholder(input).bytes);
      if (!decoded.ok) throw new Error(decoded.message);
      const pixels = renderPlaceholderPixels(input);
      expect([pixels.width, pixels.height]).toEqual([
        decoded.image.width,
        decoded.image.height,
      ]);
      expect(Array.from(pixels.rgba)).toEqual(Array.from(decoded.image.rgba));
    });
  }

  it("is pure RGBA with no PNG bytes or URI", () => {
    const pixels = renderPlaceholderPixels(INPUTS[0]);
    expect(Object.keys(pixels).sort()).toEqual(["height", "rgba", "width"]);
    expect(pixels.rgba.length).toBe(pixels.width * pixels.height * 4);
  });

  it("returns a fresh buffer each call", () => {
    const a = renderPlaceholderPixels(INPUTS[0]);
    a.rgba.fill(7);
    expect(renderPlaceholderPixels(INPUTS[0]).rgba.some((v) => v === 7)).toBe(
      false,
    );
  });
});

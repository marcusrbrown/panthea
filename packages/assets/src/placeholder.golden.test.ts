// Characterization of the M0 placeholder renderer: exact PNG bytes (by sha256
// and length) for the inputs the original tests used, the empty default, and a
// fixed encoder vector. Captured from the original implementation before it
// moved to @panthea/assets; the bytes and hashes are unchanged by the move and
// only the logical URI scheme differs from the original.

import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { encodeRgbaPng, renderPlaceholder } from "./placeholder";

const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const GOLDENS = [
  {
    name: "crowned humanoid, three colours",
    input: {
      palette: ["#8b5e34", "#c9a35c", "#4a6fa5"],
      parts: { body: "humanoid", head: "crowned", prop: "staff" },
    },
    sha256: "1fef30ecba960276654466cbe700d613e4a109b262907a981897b954ac7ea622",
    length: 119,
  },
  {
    name: "warm humanoid",
    input: {
      palette: ["#8b5e34"],
      parts: { body: "humanoid", head: "round", prop: "staff" },
    },
    sha256: "af5da2089dd9fc0e19e87e80b1b833cfec12a2506aa1c017a3cd776c48da20e8",
    length: 107,
  },
  {
    name: "cool round hooded",
    input: {
      palette: ["#4a6fa5"],
      parts: { body: "round", head: "hooded", prop: "sword" },
    },
    sha256: "d0bc9d9ae936a1f9b7f2df421e207351b5c655a82f4c426459a9930eef479076",
    length: 119,
  },
  {
    name: "unknown part names fall back to the defaults",
    input: {
      palette: ["#8b5e34", "#c9a35c"],
      parts: {
        body: "not-a-real-shape",
        head: "also-not-real",
        prop: "definitely-not-real",
      },
    },
    sha256: "54422730bcd061dd29efcc77d91ab833884bc53df26058ce25b3a3560fd066da",
    length: 110,
  },
  {
    name: "tall hooded, no prop",
    input: {
      palette: ["#8b5e34", "#c9a35c"],
      parts: { body: "tall", head: "hooded", prop: "none" },
    },
    sha256: "0d0170b8a4451ef6b84bb54e96e34e52b29770f38cfbf97a5a420a8b9b584aff",
    length: 105,
  },
  {
    name: "empty default",
    input: { palette: [], parts: {} },
    sha256: "adfc3de6de8c5d607b618691ae0ebeed37e96de9cf8196d21c97118bc142d418",
    length: 117,
  },
] as const;

describe("M0 placeholder goldens", () => {
  for (const golden of GOLDENS) {
    it(`renders ${golden.name} to the M0 bytes`, () => {
      const asset = renderPlaceholder(golden.input);
      expect(sha(asset.bytes)).toBe(golden.sha256);
      expect(asset.bytes.length).toBe(golden.length);
      expect([asset.width, asset.height]).toEqual([16, 16]);
      expect(asset.uri).toBe(`panthea-asset://placeholder/${golden.sha256}`);
    });
  }

  it("encodes a fixed RGBA vector to the M0 bytes", () => {
    const rgba = Uint8Array.from([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 0,
    ]);
    const png = encodeRgbaPng(rgba, 2, 2);
    expect(sha(png)).toBe(
      "0f8fc990c56dae539eb965823c40a3ca1e7e21bd8427300a9598d653f1ccb042",
    );
    expect(png.length).toBe(76);
  });
});

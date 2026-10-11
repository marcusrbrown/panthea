import { describe, expect, it } from "bun:test";
import { spriteFixture } from "@panthea/assets/fixtures";
import { atlasFrame } from "@panthea/renderer";

describe("atlasFrame", () => {
  it("maps a real manifest frame to normalised UVs on the atlas grid", () => {
    const { manifest } = spriteFixture();
    const second = manifest.animations[0]?.frames[1];
    expect(second?.rect).toEqual({ x: 64, y: 0, w: 64, h: 80 });
    const frame = atlasFrame(
      second?.rect ?? { x: 0, y: 0, w: 0, h: 0 },
      manifest.atlas,
    );
    expect(frame).toMatchObject({
      x: 0.25,
      y: 0,
      width: 0.25,
      height: 1,
      sourceWidth: 64,
      sourceHeight: 80,
    });
  });
});

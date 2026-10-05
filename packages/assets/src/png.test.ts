import { describe, expect, it } from "bun:test";
import { sha256Hex } from "./hash";
import { encodeRgbaPng, renderPlaceholder } from "./placeholder";
import { readPngHeader } from "./png";

describe("readPngHeader", () => {
  it("reads dimensions and format from encoder output", () => {
    expect(
      readPngHeader(renderPlaceholder({ palette: [], parts: {} }).bytes),
    ).toEqual({
      width: 16,
      height: 16,
      bitDepth: 8,
      colorType: 6,
    });
    const png = encodeRgbaPng(new Uint8Array(3 * 5 * 4), 3, 5);
    expect(readPngHeader(png)).toMatchObject({ width: 3, height: 5 });
  });

  it("returns nothing for bytes that are not a PNG header", () => {
    const good = encodeRgbaPng(new Uint8Array(16), 2, 2);
    expect(readPngHeader(new Uint8Array(0))).toBeUndefined();
    expect(readPngHeader(good.subarray(0, 20))).toBeUndefined();
    const badSignature = good.slice();
    badSignature[1] = 0;
    expect(readPngHeader(badSignature)).toBeUndefined();
    const badChunk = good.slice();
    badChunk[12] = 0x58; // IHDR -> XHDR
    expect(readPngHeader(badChunk)).toBeUndefined();
    const zeroWidth = good.slice();
    zeroWidth.fill(0, 16, 20);
    expect(readPngHeader(zeroWidth)).toBeUndefined();
  });
});

describe("sha256Hex", () => {
  it("hashes bytes to lowercase hex", () => {
    expect<string>(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

import { describe, expect, it } from "bun:test";
import { sha256Hex } from "./hash";
import { encodeRgbaPng, renderPlaceholder } from "./placeholder";
import {
  crc32,
  filtersValid,
  inflatedLength,
  parsePng,
  readPngHeader,
} from "./png";

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

// --- Structure and scanline layout ------------------------------------------

function chunkOf(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  body.set(new TextEncoder().encode(type), 0);
  body.set(data, 4);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, Bun.hash.crc32(body) >>> 0);
  return out;
}

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function ihdrOf(
  width: number,
  height: number,
  bitDepth = 8,
  colorType = 6,
  interlace = 0,
  compression = 0,
  filter = 0,
): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data.set([bitDepth, colorType, compression, filter, interlace], 8);
  return chunkOf("IHDR", data);
}

const idatOf = (n = 4) => chunkOf("IDAT", new Uint8Array(n).fill(1));
const iend = () => chunkOf("IEND", new Uint8Array(0));
const plte = (entries = 2) => chunkOf("PLTE", new Uint8Array(entries * 3));
const file = (...parts: Uint8Array[]) => Buffer.concat([SIGNATURE, ...parts]);

describe("parsePng", () => {
  it("accepts the encoder's output and reports interlace, IDAT payloads and palette size", () => {
    const parsed = parsePng(encodeRgbaPng(new Uint8Array(16), 2, 2));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.png).toMatchObject({
      width: 2,
      height: 2,
      interlace: 0,
      paletteEntries: null,
    });
    expect(parsed.png.idat.length).toBeGreaterThan(0);

    const indexed = parsePng(
      file(ihdrOf(4, 4, 8, 3), plte(5), idatOf(), iend()),
    );
    expect(indexed.ok && indexed.png.paletteEntries).toBe(5);
    const adam = parsePng(file(ihdrOf(4, 4, 8, 6, 1), idatOf(), iend()));
    expect(adam.ok && adam.png.interlace).toBe(1);
  });

  it("accepts every legal depth and colour type pair and rejects the others", () => {
    const legal: [number, number[]][] = [
      [0, [1, 2, 4, 8, 16]],
      [2, [8, 16]],
      [3, [1, 2, 4, 8]],
      [4, [8, 16]],
      [6, [8, 16]],
    ];
    for (const [colorType, depths] of legal) {
      for (const depth of [1, 2, 4, 8, 16]) {
        const extra = colorType === 3 ? [plte(1)] : [];
        const parsed = parsePng(
          file(ihdrOf(2, 2, depth, colorType), ...extra, idatOf(), iend()),
        );
        expect(parsed.ok, `${colorType}:${depth}`).toBe(depths.includes(depth));
      }
    }
    expect(parsePng(file(ihdrOf(2, 2, 8, 1), idatOf(), iend())).ok).toBe(false);
  });

  const reject: [string, Uint8Array][] = [
    ["empty bytes", new Uint8Array(0)],
    [
      "a bad signature",
      Buffer.concat([
        Uint8Array.from([0, 80, 78, 71, 13, 10, 26, 10]),
        ihdrOf(2, 2),
        idatOf(),
        iend(),
      ]),
    ],
    ["a header-only file", file(ihdrOf(2, 2)).subarray(0, 29)],
    [
      "a chunk longer than the file",
      file(ihdrOf(2, 2), chunkOf("IDAT", new Uint8Array(40))).subarray(0, 60),
    ],
    ["a missing IEND", file(ihdrOf(2, 2), idatOf())],
    [
      "an IEND with data",
      file(ihdrOf(2, 2), idatOf(), chunkOf("IEND", new Uint8Array(1))),
    ],
    [
      "bytes after IEND",
      Buffer.concat([
        file(ihdrOf(2, 2), idatOf(), iend()),
        Uint8Array.from([0]),
      ]),
    ],
    [
      "a bad CRC",
      (() => {
        const bytes = file(ihdrOf(2, 2), idatOf(), iend());
        bytes[bytes.length - 20] ^= 0xff;
        return bytes;
      })(),
    ],
    [
      "a chunk cut off after its type",
      Buffer.concat([
        SIGNATURE,
        ihdrOf(2, 2),
        Uint8Array.from([0, 0, 255, 255, 73, 68, 65, 84]),
      ]),
    ],
    ["IHDR that is not first", file(idatOf(), ihdrOf(2, 2), iend())],
    ["a second IHDR", file(ihdrOf(2, 2), ihdrOf(2, 2), idatOf(), iend())],
    [
      "an IHDR of the wrong length",
      file(chunkOf("IHDR", new Uint8Array(12)), idatOf(), iend()),
    ],
    ["zero width", file(ihdrOf(0, 2), idatOf(), iend())],
    ["zero height", file(ihdrOf(2, 0), idatOf(), iend())],
    [
      "a compression method other than 0",
      file(ihdrOf(2, 2, 8, 6, 0, 1), idatOf(), iend()),
    ],
    [
      "a filter method other than 0",
      file(ihdrOf(2, 2, 8, 6, 0, 0, 1), idatOf(), iend()),
    ],
    [
      "an interlace method above 1",
      file(ihdrOf(2, 2, 8, 6, 2), idatOf(), iend()),
    ],
    [
      "an indexed image with no PLTE",
      file(ihdrOf(2, 2, 8, 3), idatOf(), iend()),
    ],
    ["a PLTE after IDAT", file(ihdrOf(2, 2, 8, 3), idatOf(), plte(), iend())],
    [
      "a PLTE whose size is not a multiple of 3",
      file(
        ihdrOf(2, 2, 8, 3),
        chunkOf("PLTE", new Uint8Array(4)),
        idatOf(),
        iend(),
      ),
    ],
    [
      "a PLTE with more entries than the depth allows",
      file(ihdrOf(2, 2, 1, 3), plte(3), idatOf(), iend()),
    ],
    [
      "a PLTE on a grayscale image",
      file(ihdrOf(2, 2, 8, 0), plte(), idatOf(), iend()),
    ],
    ["no IDAT", file(ihdrOf(2, 2), iend())],
    [
      "empty IDAT data",
      file(ihdrOf(2, 2), chunkOf("IDAT", new Uint8Array(0)), iend()),
    ],
    [
      "IDAT chunks that are not consecutive",
      file(
        ihdrOf(2, 2),
        idatOf(),
        chunkOf("tEXt", Uint8Array.from([97, 0, 98])),
        idatOf(),
        iend(),
      ),
    ],
    [
      "an unknown critical chunk",
      file(ihdrOf(2, 2), chunkOf("ABCD", new Uint8Array(1)), idatOf(), iend()),
    ],
  ];
  const reasons: Record<string, string> = {
    "empty bytes": "signature",
    "a bad signature": "signature",
    "a header-only file": "longer than the file",
    "a chunk cut off after its type": "truncated",
    "a missing IEND": "missing IEND",
    "an IEND with data": "IEND has data",
    "bytes after IEND": "after IEND",
    "a bad CRC": "CRC",
    "a chunk longer than the file": "longer than the file",
    "IHDR that is not first": "not the first",
    "a second IHDR": "second IHDR",
    "an IHDR of the wrong length": "13 bytes",
    "zero width": "dimensions",
    "zero height": "dimensions",
    "a compression method other than 0": "compression",
    "a filter method other than 0": "filter method",
    "an interlace method above 1": "interlace",
    "an indexed image with no PLTE": "without PLTE",
    "a PLTE after IDAT": "without PLTE",
    "a PLTE whose size is not a multiple of 3": "multiple of 3",
    "a PLTE with more entries than the depth allows": "more entries",
    "a PLTE on a grayscale image": "grayscale",
    "no IDAT": "no IDAT",
    "empty IDAT data": "empty image data",
    "IDAT chunks that are not consecutive": "consecutive",
    "an unknown critical chunk": "critical",
  };
  for (const [name, bytes] of reject) {
    it(`rejects ${name}`, () => {
      const parsed = parsePng(bytes);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toContain(reasons[name] as string);
    });
  }

  it("accepts ancillary chunks between IHDR and IEND and several consecutive IDATs", () => {
    const parsed = parsePng(
      file(
        ihdrOf(2, 2),
        chunkOf("tEXt", Uint8Array.from([97, 0, 98])),
        idatOf(2),
        idatOf(3),
        iend(),
      ),
    );
    expect(parsed.ok && parsed.png.idat.map((c) => c.length)).toEqual([2, 3]);
  });
});

describe("scanline layout", () => {
  const shape = (
    width: number,
    height: number,
    bitDepth: number,
    colorType: number,
    interlace = 0,
  ) => ({
    width,
    height,
    bitDepth,
    colorType,
    interlace,
    idat: [],
    paletteEntries: null,
  });

  it("sizes non-interlaced rows from the pixel format", () => {
    expect(inflatedLength(shape(256, 80, 8, 6))).toBe(80 * 1025);
    expect(inflatedLength(shape(256, 80, 8, 2))).toBe(80 * 769);
    expect(inflatedLength(shape(256, 80, 16, 0))).toBe(80 * 513);
    expect(inflatedLength(shape(10, 3, 1, 0))).toBe(3 * (1 + 2));
    expect(inflatedLength(shape(10, 3, 4, 3))).toBe(3 * (1 + 5));
    expect(inflatedLength(shape(5, 2, 8, 4))).toBe(2 * (1 + 10));
  });

  it("sizes Adam7 passes and skips the empty ones", () => {
    expect(inflatedLength(shape(256, 80, 8, 6, 1))).toBe(82070);
    expect(inflatedLength(shape(1, 1, 8, 6, 1))).toBe(5);
    expect(inflatedLength(shape(3, 3, 8, 6, 1))).toBe(42);
  });

  it("checks every row's filter byte, across Adam7 passes too", () => {
    const flat = shape(2, 3, 8, 0);
    const raw = new Uint8Array(3 * 3);
    expect(filtersValid(raw, flat)).toBe(true);
    for (let filter = 0; filter <= 4; filter += 1) {
      raw[3] = filter;
      expect(filtersValid(raw, flat)).toBe(true);
    }
    raw[3] = 5;
    expect(filtersValid(raw, flat)).toBe(false);
    expect(filtersValid(new Uint8Array(8), flat)).toBe(false);
    expect(filtersValid(new Uint8Array(10), flat)).toBe(false);

    const adam = shape(3, 3, 8, 6, 1);
    const pixels = new Uint8Array(42);
    expect(filtersValid(pixels, adam)).toBe(true);
    // The first row of the second non-empty pass starts at byte 5.
    pixels[5] = 5;
    expect(filtersValid(pixels, adam)).toBe(false);
  });
});

describe("crc32", () => {
  it("is the standard PNG CRC", () => {
    const data = new TextEncoder().encode("IEND");
    expect(crc32(data)).toBe(0xae426082);
    expect(crc32(data)).toBe(Bun.hash.crc32(data) >>> 0);
  });
});

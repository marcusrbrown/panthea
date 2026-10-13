import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { encodeRgbaPng } from "../../placeholder";
import { crc32 } from "../../png";
import { decodePng } from "./decode";

type Decoded = ReturnType<typeof decodePng>;

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array = new Uint8Array(0)) {
  const body = concat(ascii(type), data);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc32(body), false);
  return out;
}

interface Header {
  readonly width: number;
  readonly height: number;
  readonly colorType: number;
  readonly bitDepth?: number;
  readonly interlace?: number;
}

function ihdr({
  width,
  height,
  colorType,
  bitDepth = 8,
  interlace = 0,
}: Header) {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  data[8] = bitDepth;
  data[9] = colorType;
  data[12] = interlace;
  return chunk("IHDR", data);
}

interface Assembly extends Header {
  /** Inflated scanline bytes (filter bytes included). */
  readonly raw?: Uint8Array;
  /** Pre-built IDAT payloads, overriding `raw`. */
  readonly idat?: readonly Uint8Array[];
  readonly between?: readonly Uint8Array[];
  readonly after?: readonly Uint8Array[];
}

/** A PNG with valid chunk framing and CRCs around the given payloads. */
function assemble(options: Assembly): Uint8Array {
  const idat = options.idat ?? [deflateSync(options.raw ?? new Uint8Array(0))];
  return concat(
    SIGNATURE,
    ihdr(options),
    ...(options.between ?? []),
    ...idat.map((payload) => chunk("IDAT", payload)),
    ...(options.after ?? []),
    chunk("IEND"),
  );
}

// Reference pixel source, independent of the decoder: a deterministic mix of
// x, y and channel that wraps past 255 so Sub/Up/Average/Paeth deltas wrap too.
const sample = (x: number, y: number, c: number) =>
  (x * 37 + y * 91 + c * 53 + ((x * y * 11) ^ (c * 29))) & 255;

function samples(width: number, height: number, channels: number) {
  const out = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < channels; c += 1) {
        out[(y * width + x) * channels + c] = sample(x, y, c);
      }
    }
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Forward PNG filtering: one filter type per row, reconstruction-free. */
function filterRows(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number,
  filters: readonly number[],
): Uint8Array {
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const type = filters[y % filters.length] as number;
    raw[y * (stride + 1)] = type;
    for (let i = 0; i < stride; i += 1) {
      const x = pixels[y * stride + i] as number;
      const a =
        i >= channels ? (pixels[y * stride + i - channels] as number) : 0;
      const b = y > 0 ? (pixels[(y - 1) * stride + i] as number) : 0;
      const c =
        y > 0 && i >= channels
          ? (pixels[(y - 1) * stride + i - channels] as number)
          : 0;
      const prediction = [0, a, b, (a + b) >> 1, paeth(a, b, c)][
        type
      ] as number;
      raw[y * (stride + 1) + 1 + i] = (x - prediction) & 255;
    }
  }
  return raw;
}

function withOpaqueAlpha(rgb: Uint8Array): Uint8Array {
  const out = new Uint8Array((rgb.length / 3) * 4);
  for (let p = 0; p < rgb.length / 3; p += 1) {
    out.set(rgb.subarray(p * 3, p * 3 + 3), p * 4);
    out[p * 4 + 3] = 255;
  }
  return out;
}

function expectImage(
  result: Decoded,
  width: number,
  height: number,
  expected: Uint8Array,
) {
  if (!result.ok) {
    throw new Error(`expected a decode, got ${result.code}: ${result.message}`);
  }
  expect(result.image.width).toBe(width);
  expect(result.image.height).toBe(height);
  expect(hex(result.image.rgba)).toBe(hex(expected));
}

function expectRefusal(
  result: Decoded,
  code: "unsupported-png" | "corrupt-png",
  message?: RegExp,
) {
  if (result.ok) throw new Error("expected a refusal, got a decode");
  expect(result.code).toBe(code);
  expect(result.message.length).toBeGreaterThan(0);
  if (code === "unsupported-png") expect(result.message).toMatch(/re-export/i);
  if (message) expect(result.message).toMatch(message);
}

const W = 5;
const H = 6;
const FILTER_NAMES = ["None", "Sub", "Up", "Average", "Paeth"] as const;

describe("decodePng 8-bit RGB", () => {
  const rgb = samples(W, H, 3);
  const expected = withOpaqueAlpha(rgb);

  for (const [type, name] of FILTER_NAMES.entries()) {
    test(`reconstructs every row filtered with ${name}`, () => {
      const raw = filterRows(rgb, W, H, 3, [type]);
      const result = decodePng(
        assemble({ width: W, height: H, colorType: 2, raw }),
      );
      expectImage(result, W, H, expected);
    });
  }

  test("reconstructs a mix of filters across rows with alpha 255", () => {
    const raw = filterRows(rgb, W, H, 3, [4, 3, 2, 1, 0, 4]);
    const result = decodePng(
      assemble({ width: W, height: H, colorType: 2, raw }),
    );
    expectImage(result, W, H, expected);
  });
});

describe("decodePng 8-bit RGBA", () => {
  const rgba = samples(W, H, 4);

  for (const [type, name] of FILTER_NAMES.entries()) {
    test(`reconstructs every row filtered with ${name}`, () => {
      const raw = filterRows(rgba, W, H, 4, [type]);
      const result = decodePng(
        assemble({ width: W, height: H, colorType: 6, raw }),
      );
      expectImage(result, W, H, rgba);
    });
  }

  test("reconstructs a mix of filters across rows", () => {
    const raw = filterRows(rgba, W, H, 4, [0, 1, 2, 3, 4, 2]);
    const result = decodePng(
      assemble({ width: W, height: H, colorType: 6, raw }),
    );
    expectImage(result, W, H, rgba);
  });

  test("breaks Paeth ties toward a, then b, then c", () => {
    // Row 1, pixel 1: channel 0 has a=10 b=25 c=20 (pa ties pc, a wins);
    // channel 1 has a=25 b=10 c=20 (pb ties pc, b wins); channel 2 has
    // a=10 b=30 c=20 (pa ties pb, and pc is zero, so c wins).
    expect(paeth(10, 25, 20)).toBe(10);
    expect(paeth(25, 10, 20)).toBe(10);
    expect(paeth(10, 30, 20)).toBe(20);
    const pixels = Uint8Array.from([
      ...[20, 20, 20, 255, 25, 10, 30, 255, 99, 99, 7, 255],
      ...[10, 25, 10, 255, 40, 3, 7, 255, 10, 30, 20, 128],
    ]);
    const raw = filterRows(pixels, 3, 2, 4, [0, 4]);
    const result = decodePng(
      assemble({ width: 3, height: 2, colorType: 6, raw }),
    );
    expectImage(result, 3, 2, pixels);
  });

  test("applies Paeth on the first row and left edge against zero neighbours", () => {
    const pixels = samples(4, 3, 4);
    const raw = filterRows(pixels, 4, 3, 4, [4]);
    const result = decodePng(
      assemble({ width: 4, height: 3, colorType: 6, raw }),
    );
    expectImage(result, 4, 3, pixels);
  });

  test("round-trips the shared encoder, hidden RGB included", () => {
    const width = 7;
    const height = 5;
    const pixels = samples(width, height, 4);
    for (let p = 0; p < width * height; p += 3) pixels[p * 4 + 3] = 0;
    for (let p = 1; p < width * height; p += 7) pixels[p * 4 + 3] = 5;
    const result = decodePng(encodeRgbaPng(pixels, width, height));
    expectImage(result, width, height, pixels);
  });

  test("preserves RGB hidden under alpha 0 and alpha 5 exactly", () => {
    const pixels = Uint8Array.from([
      ...[12, 200, 77, 0, 255, 0, 128, 0, 250, 3, 9, 5, 1, 2, 3, 255],
      ...[0, 0, 0, 0, 9, 8, 7, 5, 255, 255, 255, 0, 64, 32, 16, 5],
    ]);
    for (const filters of [[0], [1, 4], [2, 3]]) {
      const raw = filterRows(pixels, 4, 2, 4, filters);
      const result = decodePng(
        assemble({ width: 4, height: 2, colorType: 6, raw }),
      );
      expectImage(result, 4, 2, pixels);
    }
  });

  test("joins IDAT data split across several chunks", () => {
    const pixels = samples(W, H, 4);
    const raw = filterRows(pixels, W, H, 4, [4, 1, 3, 2, 0, 4]);
    const stream = deflateSync(raw);
    const idat = [
      stream.subarray(0, 1),
      stream.subarray(1, 7),
      stream.subarray(7, 7),
      stream.subarray(7),
    ];
    const result = decodePng(
      assemble({ width: W, height: H, colorType: 6, idat }),
    );
    expectImage(result, W, H, pixels);
  });
});

describe("decodePng input handling", () => {
  const pixels = samples(4, 3, 4);
  const png = assemble({
    width: 4,
    height: 3,
    colorType: 6,
    raw: filterRows(pixels, 4, 3, 4, [4, 2, 1]),
  });

  test("never mutates the caller bytes", () => {
    const input = Uint8Array.from(png);
    const before = Uint8Array.from(input);
    expectImage(decodePng(input), 4, 3, pixels);
    expect(hex(input)).toBe(hex(before));
  });

  test("returns pixels in a buffer the caller does not share", () => {
    const input = Uint8Array.from(png);
    const result = decodePng(input);
    if (!result.ok) throw new Error(result.message);
    expect(result.image.rgba.buffer).not.toBe(input.buffer);
    (result.image.rgba as Uint8Array).fill(0);
    expect(hex(input)).toBe(hex(png));
  });

  test("reads a PNG that is a view into a larger buffer", () => {
    const padded = new Uint8Array(png.length + 10).fill(0xaa);
    padded.set(png, 4);
    const before = Uint8Array.from(padded);
    expectImage(decodePng(padded.subarray(4, 4 + png.length)), 4, 3, pixels);
    expect(hex(padded)).toBe(hex(before));
  });

  test("ignores valid ancillary chunks around the image data", () => {
    const gama = new Uint8Array(4);
    new DataView(gama.buffer).setUint32(0, 45455, false);
    const phys = new Uint8Array(9);
    new DataView(phys.buffer).setUint32(0, 2835, false);
    new DataView(phys.buffer).setUint32(4, 2835, false);
    phys[8] = 1;
    const raw = filterRows(pixels, 4, 3, 4, [1]);
    const result = decodePng(
      assemble({
        width: 4,
        height: 3,
        colorType: 6,
        raw,
        between: [
          chunk("gAMA", gama),
          chunk("pHYs", phys),
          chunk("tEXt", ascii("Comment\0kept out of the pixels")),
          chunk("prVt", Uint8Array.of(1, 2, 3)),
        ],
        after: [chunk("tIME", Uint8Array.of(7, 234, 10, 5, 12, 0, 0))],
      }),
    );
    expectImage(result, 4, 3, pixels);
  });
});

describe("decodePng unsupported floor", () => {
  const unit = (
    colorType: number,
    bytes: number,
    extra: Partial<Header> = {},
  ) => ({
    width: 1,
    height: 1,
    colorType,
    raw: new Uint8Array(1 + bytes),
    ...extra,
  });

  test("refuses grayscale with re-export guidance", () => {
    expectRefusal(
      decodePng(assemble(unit(0, 1))),
      "unsupported-png",
      /grayscale/i,
    );
    expectRefusal(
      decodePng(assemble(unit(0, 1, { bitDepth: 1 }))),
      "unsupported-png",
      /grayscale/i,
    );
    expectRefusal(
      decodePng(assemble(unit(4, 2))),
      "unsupported-png",
      /grayscale/i,
    );
  });

  test("refuses indexed colour with re-export guidance", () => {
    const plte = chunk("PLTE", Uint8Array.of(1, 2, 3, 4, 5, 6));
    const result = decodePng(assemble({ ...unit(3, 1), between: [plte] }));
    expectRefusal(result, "unsupported-png", /indexed/i);
  });

  test("refuses 16-bit RGB and RGBA with re-export guidance", () => {
    expectRefusal(
      decodePng(assemble(unit(2, 6, { bitDepth: 16 }))),
      "unsupported-png",
      /16-bit/i,
    );
    expectRefusal(
      decodePng(assemble(unit(6, 8, { bitDepth: 16 }))),
      "unsupported-png",
      /16-bit/i,
    );
  });

  test("refuses interlaced RGB and RGBA with re-export guidance", () => {
    expectRefusal(
      decodePng(assemble(unit(2, 3, { interlace: 1 }))),
      "unsupported-png",
      /interlaced/i,
    );
    expectRefusal(
      decodePng(assemble(unit(6, 4, { interlace: 1 }))),
      "unsupported-png",
      /interlaced/i,
    );
  });

  test("refuses tRNS rather than guessing key transparency", () => {
    const rgbKey = chunk("tRNS", Uint8Array.of(0, 1, 0, 2, 0, 3));
    expectRefusal(
      decodePng(assemble({ ...unit(2, 3), between: [rgbKey] })),
      "unsupported-png",
      /tRNS/i,
    );
    expectRefusal(
      decodePng(assemble({ ...unit(6, 4), between: [rgbKey] })),
      "unsupported-png",
      /tRNS/i,
    );
  });

  test("refuses unknown critical chunks but not unknown ancillary ones", () => {
    const critical = chunk("FAKE", Uint8Array.of(1));
    expectRefusal(
      decodePng(assemble({ ...unit(6, 4), between: [critical] })),
      "unsupported-png",
      /FAKE/i,
    );
  });

  test("refuses dimensions whose scanline arithmetic is unsafe", () => {
    const huge = 0x7fffffff;
    expectRefusal(
      decodePng(
        assemble({
          width: huge,
          height: huge,
          colorType: 6,
          raw: new Uint8Array(5),
        }),
      ),
      "unsupported-png",
      /too large/i,
    );
    // A single huge row may be representable; it must still be a typed refusal.
    const wide = decodePng(
      assemble({
        width: huge,
        height: 1,
        colorType: 2,
        raw: new Uint8Array(5),
      }),
    );
    expect(wide.ok).toBe(false);
  });
});

describe("decodePng corrupt input", () => {
  const pixels = samples(4, 3, 4);
  const png = assemble({
    width: 4,
    height: 3,
    colorType: 6,
    raw: filterRows(pixels, 4, 3, 4, [4, 2, 1]),
  });
  const raw = filterRows(pixels, 4, 3, 4, [0]);
  const rgba = (idat: readonly Uint8Array[]) =>
    decodePng(assemble({ width: 4, height: 3, colorType: 6, idat }));

  test("refuses empty, non-PNG and every truncation of a valid PNG", () => {
    expectRefusal(decodePng(new Uint8Array(0)), "corrupt-png");
    expectRefusal(decodePng(ascii("GIF89a not a png at all")), "corrupt-png");
    for (let length = 0; length < png.length; length += 1) {
      expectRefusal(decodePng(png.subarray(0, length)), "corrupt-png");
    }
  });

  test("refuses a chunk CRC that no longer matches", () => {
    for (let at = 0; at < png.length; at += 1) {
      const flipped = Uint8Array.from(png);
      flipped[at] = (flipped[at] as number) ^ 0xff;
      expectRefusal(decodePng(flipped), "corrupt-png");
    }
  });

  test("refuses a truncated PNG whose last chunk CRC is also wrong", () => {
    const cut = Uint8Array.from(png.subarray(0, png.length - 20));
    cut[cut.length - 1] = (cut[cut.length - 1] as number) ^ 0xff;
    expectRefusal(decodePng(cut), "corrupt-png");
  });

  test("refuses image data that is not a zlib stream", () => {
    expectRefusal(
      rgba([Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8)]),
      "corrupt-png",
      /inflate|zlib|data/i,
    );
  });

  test("refuses a zlib stream that is cut off", () => {
    const stream = deflateSync(raw);
    expectRefusal(rgba([stream.subarray(0, stream.length - 6)]), "corrupt-png");
  });

  test("refuses a zlib stream with a bad checksum", () => {
    const stream = Uint8Array.from(deflateSync(raw));
    stream[stream.length - 1] = (stream[stream.length - 1] as number) ^ 0xff;
    expectRefusal(rgba([stream]), "corrupt-png");
  });

  test("refuses image data one row short or one byte over", () => {
    expectRefusal(
      rgba([deflateSync(raw.subarray(0, raw.length - 17))]),
      "corrupt-png",
      /bytes but [0-9]+ are required/,
    );
    expectRefusal(
      rgba([deflateSync(raw.subarray(0, raw.length - 1))]),
      "corrupt-png",
      /bytes but [0-9]+ are required/,
    );
    expectRefusal(
      rgba([deflateSync(concat(raw, Uint8Array.of(0)))]),
      "corrupt-png",
    );
    expectRefusal(rgba([deflateSync(concat(raw, raw))]), "corrupt-png");
  });

  test("refuses a decompression bomb far beyond the scanline length", () => {
    const bomb = deflateSync(new Uint8Array(64 * 1024 * 1024));
    expectRefusal(
      decodePng(assemble({ width: 2, height: 2, colorType: 6, idat: [bomb] })),
      "corrupt-png",
    );
  });

  test("refuses a scanline filter type above 4", () => {
    for (const bad of [5, 255]) {
      const broken = Uint8Array.from(raw);
      broken[4 * 4 + 1] = bad; // filter byte of row 1
      expectRefusal(rgba([deflateSync(broken)]), "corrupt-png", /filter/i);
    }
  });

  test("refuses a bad filter on the first row", () => {
    const broken = Uint8Array.from(raw);
    broken[0] = 9;
    expectRefusal(rgba([deflateSync(broken)]), "corrupt-png", /filter/i);
  });
});

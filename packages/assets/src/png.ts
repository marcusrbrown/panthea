// PNG structure helpers: header, chunk framing and scanline layout. Pure
// bytes in, no platform imports. Pixels are not decoded: a PNG that passes
// has well-formed chunks and CRCs and, once its IDAT data is inflated, the
// exact scanline count and legal filter bytes. Palette indices are unchecked.

export interface PngHeader {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const IHDR = [73, 72, 68, 82];

/** The IHDR of a PNG, or undefined when the bytes do not start with a well-formed one. */
export function readPngHeader(bytes: Uint8Array): PngHeader | undefined {
  if (bytes.length < 29) return undefined;
  if (SIGNATURE.some((byte, i) => bytes[i] !== byte)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8, false) !== 13) return undefined;
  if (IHDR.some((byte, i) => bytes[12 + i] !== byte)) return undefined;
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width === 0 || height === 0) return undefined;
  return {
    width,
    height,
    bitDepth: bytes[24] as number,
    colorType: bytes[25] as number,
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface PngStructure extends PngHeader {
  readonly interlace: number;
  /** The IDAT chunk payloads in order. */
  readonly idat: readonly Uint8Array[];
  /** Entries in PLTE, or null when there is none. */
  readonly paletteEntries: number | null;
}

export type PngParse =
  | { readonly ok: true; readonly png: PngStructure }
  | { readonly ok: false; readonly reason: string };

const LEGAL_DEPTHS: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

const text = (bytes: Uint8Array) => String.fromCharCode(...bytes);
const refuse = (reason: string): PngParse => ({ ok: false, reason });

/** Walks every chunk: bounds, CRC, order, and the rules for IHDR, PLTE, IDAT and IEND. */
export function parsePng(bytes: Uint8Array): PngParse {
  if (bytes.length < 8 || SIGNATURE.some((byte, i) => bytes[i] !== byte)) {
    return refuse("bad signature");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let header: PngHeader | undefined;
  let interlace = 0;
  let paletteEntries: number | null = null;
  const idat: Uint8Array[] = [];
  let idatClosed = false;
  let ended = false;

  while (offset < bytes.length) {
    if (ended) return refuse("bytes after IEND");
    if (bytes.length - offset < 12) return refuse("truncated chunk");
    const length = view.getUint32(offset, false);
    if (length > bytes.length - offset - 12)
      return refuse("chunk longer than the file");
    const type = text(bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const stored = view.getUint32(offset + 8 + length, false);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== stored) {
      return refuse(`bad CRC in ${type}`);
    }
    offset += 12 + length;

    if (header === undefined) {
      if (type !== "IHDR") return refuse("IHDR is not the first chunk");
      if (length !== 13) return refuse("IHDR is not 13 bytes");
      const fields = new DataView(data.buffer, data.byteOffset, 13);
      const w = fields.getUint32(0, false);
      const h = fields.getUint32(4, false);
      const [bitDepth, colorType, compression, filter, interlaceMethod] =
        data.subarray(8);
      if (w === 0 || h === 0 || w > 0x7fffffff || h > 0x7fffffff)
        return refuse("bad dimensions");
      if (!LEGAL_DEPTHS[colorType as number]?.includes(bitDepth as number)) {
        return refuse(
          `illegal bit depth ${bitDepth} for colour type ${colorType}`,
        );
      }
      if (compression !== 0) return refuse("unknown compression method");
      if (filter !== 0) return refuse("unknown filter method");
      if (interlaceMethod !== 0 && interlaceMethod !== 1)
        return refuse("unknown interlace method");
      header = {
        width: w,
        height: h,
        bitDepth: bitDepth as number,
        colorType: colorType as number,
      };
      interlace = interlaceMethod;
      continue;
    }
    switch (type) {
      case "IHDR":
        return refuse("second IHDR");
      case "PLTE": {
        if (idat.length > 0 || idatClosed) return refuse("PLTE after IDAT");
        if (paletteEntries !== null) return refuse("second PLTE");
        if (header.colorType === 0 || header.colorType === 4)
          return refuse("PLTE on a grayscale image");
        if (length === 0 || length % 3 !== 0)
          return refuse("PLTE size is not a multiple of 3");
        if (length / 3 > 2 ** header.bitDepth && header.colorType === 3) {
          return refuse("PLTE has more entries than the bit depth allows");
        }
        paletteEntries = length / 3;
        break;
      }
      case "IDAT":
        if (idatClosed) return refuse("IDAT chunks are not consecutive");
        if (header.colorType === 3 && paletteEntries === null)
          return refuse("indexed image without PLTE");
        idat.push(data);
        break;
      case "IEND":
        if (length !== 0) return refuse("IEND has data");
        if (idat.length === 0) return refuse("no IDAT");
        ended = true;
        break;
      default:
        if (type.charCodeAt(0) < 97)
          return refuse(`unknown critical chunk ${type}`);
    }
    if (type !== "IDAT" && idat.length > 0) idatClosed = true;
  }
  if (!ended) return refuse("missing IEND");
  if (idat.every((chunk) => chunk.length === 0))
    return refuse("empty image data");
  return {
    ok: true,
    png: { ...(header as PngHeader), interlace, idat, paletteEntries },
  };
}

const CHANNELS: Readonly<Record<number, number>> = {
  0: 1,
  2: 3,
  3: 1,
  4: 2,
  6: 4,
};

/** Adam7 passes as [xStart, yStart, xStep, yStep]. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/** Each non-empty pass (one for a non-interlaced image) as a row count and row length including the filter byte. */
function passes(png: PngStructure): { rows: number; rowBytes: number }[] {
  const bitsPerPixel = (CHANNELS[png.colorType] as number) * png.bitDepth;
  const rowFor = (width: number) => 1 + Math.ceil((width * bitsPerPixel) / 8);
  if (png.interlace === 0)
    return [{ rows: png.height, rowBytes: rowFor(png.width) }];
  const out: { rows: number; rowBytes: number }[] = [];
  for (const [xs, ys, dx, dy] of ADAM7) {
    const width = png.width > xs ? Math.ceil((png.width - xs) / dx) : 0;
    const rows = png.height > ys ? Math.ceil((png.height - ys) / dy) : 0;
    if (width > 0 && rows > 0) out.push({ rows, rowBytes: rowFor(width) });
  }
  return out;
}

/** Total scanline bytes (filter bytes included) of the inflated image data. */
export function inflatedLength(png: PngStructure): number {
  return passes(png).reduce((sum, pass) => sum + pass.rows * pass.rowBytes, 0);
}

/** True when `raw` is exactly the expected length and every row starts with a filter byte of 0 to 4. */
export function filtersValid(raw: Uint8Array, png: PngStructure): boolean {
  if (raw.length !== inflatedLength(png)) return false;
  let offset = 0;
  for (const pass of passes(png)) {
    for (let row = 0; row < pass.rows; row += 1) {
      if ((raw[offset] as number) > 4) return false;
      offset += pass.rowBytes;
    }
  }
  return true;
}

// PNG header reader. Pure bytes in, no platform imports.

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

// Browser PNG decode for the shared core's textures.

import type { DecodedImage } from "./textures";

/** Straight alpha, no colour conversion, rows flipped so row 0 is the bottom of the image. */
export async function decodePng(bytes: Uint8Array): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(
    new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
      imageOrientation: "flipY",
    },
  );
  return { width: bitmap.width, height: bitmap.height, image: bitmap };
}

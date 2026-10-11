// Atlas decode for the client: bytes the registry client cached become the
// texture image a renderer commits. The decoder is the shared core's, behind
// a seam so tests supply a node decode; WKWebView's decode is never the
// reference for what the pixels are (that is the packaged inspection's job).

import { type DecodedImage, decodePng } from "@panthea/renderer";

export type AtlasDecoder = (bytes: Uint8Array) => Promise<DecodedImage>;

/** Decodes atlas bytes and checks them against the size the manifest declares. */
export async function decodeAtlas(
  bytes: Uint8Array,
  declared: { readonly width: number; readonly height: number },
  decode: AtlasDecoder = decodePng,
): Promise<DecodedImage> {
  const image = await decode(bytes);
  if (image.width !== declared.width || image.height !== declared.height) {
    releaseImage(image);
    throw new Error(
      `the atlas decodes to ${image.width}x${image.height}, the manifest declares ${declared.width}x${declared.height}`,
    );
  }
  return image;
}

/** Frees a decoded bitmap's memory; a raw RGBA image is left to the garbage collector. */
export function releaseImage(image: DecodedImage): void {
  const held = image.image as { close?: () => void };
  if (typeof held.close === "function") held.close();
}

// Browser-only seams for the preview: PNG decoding and canvas mounting.

import type { PreviewHost } from "./preview";
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

export function createDomHost(container: HTMLElement): PreviewHost {
  return {
    createCanvas() {
      const canvas = container.ownerDocument.createElement("canvas");
      canvas.style.imageRendering = "pixelated";
      canvas.style.display = "block";
      return canvas;
    },
    mount(next, previous) {
      if (previous?.parentElement === container) {
        container.replaceChild(next, previous);
      } else {
        container.appendChild(next);
      }
    },
    unmount(canvas) {
      if (canvas.parentElement === container) container.removeChild(canvas);
    },
  };
}

// Browser-only seam for the studio preview: canvas mounting.

import type { PreviewHost } from "./preview";

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

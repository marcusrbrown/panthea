// The pixel-exact core's view model: logical size, zoom, canvas metrics,
// camera frustum, pixel readback and the backend contract. Pure types and
// arithmetic, no GPU.

import type { Point } from "./iso";
import type { SceneLayer } from "./layer";

/** The fixed pixel size the scene is drawn at before it is scaled by an integer zoom. */
export interface LogicalSize {
  readonly width: number;
  readonly height: number;
}

export const ZOOMS = [2, 3, 4] as const;
export type Zoom = (typeof ZOOMS)[number];

export interface CanvasMetrics {
  /** Device pixels: exactly the logical size times the zoom. */
  readonly backingWidth: number;
  readonly backingHeight: number;
  /** CSS pixels: the backing size over the device pixel ratio; fractional only here. */
  readonly cssWidth: number;
  readonly cssHeight: number;
}

export function canvasMetrics(
  size: LogicalSize,
  zoom: number,
  devicePixelRatio: number,
): CanvasMetrics {
  const ratio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  const backingWidth = size.width * zoom;
  const backingHeight = size.height * zoom;
  return {
    backingWidth,
    backingHeight,
    cssWidth: backingWidth / ratio,
    cssHeight: backingHeight / ratio,
  };
}

/** Whole logical pixels, so the camera never sits between texels. */
export function roundCamera(origin: Point): Point {
  return { x: Math.round(origin.x) + 0, y: Math.round(origin.y) + 0 };
}

/** Orthographic frustum edges (y up) for a viewport whose top-left is `origin` in screen space. */
export function cameraBounds(
  size: LogicalSize,
  origin: Point,
): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  return {
    left: origin.x,
    right: origin.x + size.width,
    top: -origin.y,
    bottom: -(origin.y + size.height),
  };
}

export interface PixelBuffer {
  readonly width: number;
  readonly height: number;
  /** RGBA, top row first. */
  readonly data: Uint8Array;
}

export interface PreviewView {
  /** A whole number: the studio offers `Zoom`, the game any integer that fits (down to 1x). */
  readonly zoom: number;
  readonly camera: Point;
  readonly metrics: CanvasMetrics;
}

/** What the controller needs from a renderer; the GPU implementation is gpu.ts. */
export interface RenderBackend {
  readonly layer: SceneLayer;
  /** Which graphics API is in use, for logs and evidence. */
  readonly name?: string;
  /** Resolves when the renderer is ready; `onDeviceLost` may be called any time after. */
  start(onDeviceLost: () => void): Promise<void>;
  view(view: PreviewView): void;
  /**
   * Resolves when everything the scene now holds can be drawn in one frame
   * (new materials compiled). Called after the scene changes, not on ticks.
   */
  prepare?(): Promise<void>;
  render(): void;
  readRenderTarget(): Promise<PixelBuffer>;
  readCanvas(): Promise<PixelBuffer>;
  /** Safe to call twice. */
  dispose(): void;
}

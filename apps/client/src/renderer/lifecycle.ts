// The scene host's lifecycle decisions, kept free of React so they can be
// exercised with a fake renderer: starting a renderer on a canvas, reacting
// to its failure and device loss, and drawing a view into it. Anything a
// renderer reports after the session was disposed is ignored.

import type { Realm } from "@panthea/contracts";
import type { WorldViewModel } from "../store";
import type { RendererFactory, WorldRenderer } from "./scene";

export interface SceneLifecycleHandlers {
  onStarted(): void;
  onFailure(message: string): void;
  /** Called once per session, however many times the renderer signals device loss. */
  onDeviceLost(): void;
}

export interface SceneSession {
  /** The renderer this session started, or `undefined` when construction failed. */
  readonly renderer: WorldRenderer | undefined;
  dispose(): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Creates a renderer for `canvas` and starts it. A factory or synchronous
 * start failure and a rejected start are reported through `onFailure`; a
 * resolved start through `onStarted`. `dispose` disposes the renderer and
 * silences every later report.
 */
export function startSceneRenderer(
  canvas: HTMLCanvasElement,
  factory: RendererFactory,
  handlers: SceneLifecycleHandlers,
): SceneSession {
  let renderer: WorldRenderer | undefined;
  let active = true;
  let recovering = false;

  try {
    renderer = factory(canvas);
    void renderer
      .start(() => {
        if (!active || recovering) return;
        recovering = true;
        handlers.onDeviceLost();
      })
      .then(() => {
        if (active) handlers.onStarted();
      })
      .catch((error: unknown) => {
        if (active) handlers.onFailure(messageOf(error));
      });
  } catch (error) {
    handlers.onFailure(messageOf(error));
  }

  const started = renderer;
  return {
    renderer: started,
    dispose() {
      active = false;
      started?.dispose();
    },
  };
}

/**
 * Draws `view` into `renderer` and hands the ids of the events it drew to
 * `onDrawn`, once the frame is on screen. A draw error is reported through
 * `onFailure` and nothing is handed on. With no renderer, nothing is drawn and
 * `onDrawn` receives an empty list.
 */
export async function drawScene(
  renderer: WorldRenderer | undefined,
  view: WorldViewModel,
  realm: Realm,
  handlers: {
    onDrawn?: (eventIds: readonly string[]) => void;
    onFailure(message: string): void;
  },
): Promise<void> {
  try {
    handlers.onDrawn?.((await renderer?.draw(view, realm)) ?? []);
  } catch (error) {
    handlers.onFailure(messageOf(error));
  }
}

/** What drives the render loop: the browser's animation frames, or a test's hand. */
export interface FrameScheduler {
  request(callback: (nowMs: number) => void): number;
  cancel(handle: number): void;
}

export const animationFrames: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/**
 * Ticks `renderer` once per scheduled frame by the time since the previous
 * frame (zero on the first), so animation runs on the render loop's own
 * clock. A tick that throws is reported and the loop carries on. Returns a
 * function that stops it.
 */
export function startFrameLoop(
  renderer: WorldRenderer,
  scheduler: FrameScheduler,
  onFailure?: (message: string) => void,
): () => void {
  let handle: number | undefined;
  let previous: number | undefined;
  let running = true;

  const frame = (nowMs: number) => {
    if (!running) return;
    const deltaMs = previous === undefined ? 0 : nowMs - previous;
    previous = nowMs;
    try {
      renderer.tick(deltaMs);
    } catch (error) {
      onFailure?.(messageOf(error));
    }
    if (running) handle = scheduler.request(frame);
  };
  handle = scheduler.request(frame);

  return () => {
    running = false;
    if (handle !== undefined) scheduler.cancel(handle);
    handle = undefined;
  };
}

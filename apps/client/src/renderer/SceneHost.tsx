import type { Realm } from "@panthea/contracts";
import { useEffect, useRef, useState } from "react";

import type { WorldViewModel } from "../store";
import {
  animationFrames,
  drawScene,
  type FrameScheduler,
  startFrameLoop,
  startSceneRenderer,
} from "./lifecycle";
import type { RendererFactory, WorldRenderer } from "./scene";

export interface SceneHostProps {
  readonly view?: WorldViewModel;
  readonly realm: Realm;
  /** Must be stable: a new factory restarts the renderer. */
  readonly rendererFactory: RendererFactory;
  /** Drives animation; defaults to the browser's animation frames. */
  readonly frames?: FrameScheduler;
  readonly onDrawn?: (eventIds: readonly string[]) => void;
  readonly onDeviceLost?: () => void;
}

export function SceneHost({
  view,
  realm,
  rendererFactory,
  frames = animationFrames,
  onDrawn,
  onDeviceLost,
}: SceneHostProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [started, setStarted] = useState(false);
  const [failure, setFailure] = useState<string>();
  const rendererRef = useRef<WorldRenderer | undefined>(undefined);
  const onDrawnRef = useRef(onDrawn);
  const onDeviceLostRef = useRef(onDeviceLost);
  onDrawnRef.current = onDrawn;
  onDeviceLostRef.current = onDeviceLost;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setStarted(false);
    setFailure(undefined);
    const session = startSceneRenderer(canvas, rendererFactory, {
      onStarted: () => setStarted(true),
      onFailure: setFailure,
      onDeviceLost: () => onDeviceLostRef.current?.(),
    });
    rendererRef.current = session.renderer;

    return () => {
      if (rendererRef.current === session.renderer) {
        rendererRef.current = undefined;
      }
      session.dispose();
    };
  }, [rendererFactory]);

  useEffect(() => {
    if (!started || !view) return;
    void drawScene(rendererRef.current, view, realm, {
      onDrawn: (eventIds) => onDrawnRef.current?.(eventIds),
      onFailure: setFailure,
    });
  }, [realm, started, view]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!started || !renderer) return;
    return startFrameLoop(renderer, frames, setFailure);
  }, [frames, started]);

  return (
    <>
      <canvas ref={canvasRef} aria-label="Rendered world scene" />
      {failure && (
        <div className="scene-failure" role="status">
          Scene unavailable: {failure}
        </div>
      )}
    </>
  );
}

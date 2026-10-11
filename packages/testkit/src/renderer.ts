// Test support: a render backend with no GPU. It is the real sprite layer and
// real three objects in a real Scene, so sprites, textures and meshes are
// genuine; only the draw calls are recorded instead of issued.

import {
  createSceneLayer,
  type GpuBackend,
  type PreviewView,
} from "@panthea/renderer";
import { Group, Scene } from "three";

export interface TestBackend extends GpuBackend {
  readonly scene: Scene;
  /** "start", "prepare", "render" and "dispose", in call order. */
  readonly log: string[];
  readonly views: PreviewView[];
  triggerLost(): void;
  /** Holds `prepare` until the returned function is called. */
  holdPrepare(): () => void;
}

export function testBackend(): TestBackend {
  const scene = new Scene();
  const layer = createSceneLayer(scene);
  const decor = new Group();
  scene.add(decor);
  const log: string[] = [];
  const views: PreviewView[] = [];
  let lost: (() => void) | undefined;
  let held: Promise<void> | undefined;
  let disposed = false;
  return {
    scene,
    layer,
    decor,
    log,
    views,
    name: "test",
    start(onDeviceLost) {
      lost = onDeviceLost;
      log.push("start");
      return Promise.resolve();
    },
    view: (view) => {
      views.push(view);
    },
    async prepare() {
      log.push("prepare");
      await held;
    },
    render() {
      log.push("render");
    },
    readRenderTarget: () => Promise.reject(new Error("no GPU")),
    readCanvas: () => Promise.reject(new Error("no GPU")),
    dispose() {
      if (disposed) return;
      disposed = true;
      log.push("dispose");
      scene.remove(decor);
      layer.dispose();
    },
    triggerLost: () => lost?.(),
    holdPrepare() {
      let release: () => void = () => {};
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        held = undefined;
        release();
      };
    },
  };
}

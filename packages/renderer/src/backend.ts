// The GPU binding behind `RenderBackend`: a WebGPURenderer (WebGL2 when
// `forceWebGL`), the scene drawn at 1x into a fixed-size nearest-filtered
// render target, and an integer blit of that target to the canvas. Colour
// management is off end to end (no sRGB decode on textures, no output
// encode), so a texel's bytes reach the canvas unchanged. Needs a real GPU
// context; the controller above it is tested with fakes.

import {
  Color,
  Group,
  LinearSRGBColorSpace,
  Mesh,
  NearestFilter,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
} from "three";
import { texture, uv, vec2 } from "three/tsl";
import { MeshBasicNodeMaterial, WebGPURenderer } from "three/webgpu";
import { DEPTH_CAMERA_Z, DEPTH_FAR, DEPTH_NEAR } from "./iso";
import { createSceneLayer } from "./layer";
import {
  cameraBounds,
  type LogicalSize,
  type PixelBuffer,
  type PreviewView,
  type RenderBackend,
} from "./view";

export const DEFAULT_BACKGROUND = [38, 42, 52] as const;

/** A render backend that also holds a group of plain meshes in the same scene and pixel space as the sprite layer. */
export interface GpuBackend extends RenderBackend {
  /**
   * Meshes the sprite layer does not draw (ground, bars, rings), in the same
   * world space as the layer's sprites: x right, y up, z the depth key. The
   * owner adds and removes children and disposes their geometry and
   * materials; the backend only draws them and removes the group on dispose.
   */
  readonly decor: Group;
}

export interface GpuBackendOptions {
  /** The fixed render-target size; the scene is drawn at 1x into it. */
  readonly logicalSize: LogicalSize;
  /** Use the WebGL2 backend even where WebGPU exists. */
  readonly forceWebGL?: boolean;
  /** Clear colour as sRGB bytes, written to the target unchanged. */
  readonly background?: readonly [number, number, number];
}

function flipRows(buffer: PixelBuffer): PixelBuffer {
  const stride = buffer.width * 4;
  const data = new Uint8Array(buffer.data.length);
  for (let row = 0; row < buffer.height; row += 1) {
    data.set(
      buffer.data.subarray(row * stride, (row + 1) * stride),
      (buffer.height - 1 - row) * stride,
    );
  }
  return { width: buffer.width, height: buffer.height, data };
}

export function createGpuBackend(
  canvas: HTMLCanvasElement,
  options: GpuBackendOptions,
): GpuBackend {
  const { width: logicalWidth, height: logicalHeight } = options.logicalSize;
  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    alpha: false,
    forceWebGL: options.forceWebGL ?? false,
  });
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.setPixelRatio(1);

  const [red, green, blue] = options.background ?? DEFAULT_BACKGROUND;
  const scene = new Scene();
  scene.background = new Color().setRGB(
    red / 255,
    green / 255,
    blue / 255,
    LinearSRGBColorSpace,
  );
  const layer = createSceneLayer(scene);
  const decor = new Group();
  scene.add(decor);
  const camera = new OrthographicCamera(
    0,
    logicalWidth,
    0,
    -logicalHeight,
    DEPTH_NEAR,
    DEPTH_FAR,
  );
  camera.position.set(0, 0, DEPTH_CAMERA_Z);

  const target = new RenderTarget(logicalWidth, logicalHeight, {
    depthBuffer: true,
    magFilter: NearestFilter,
    minFilter: NearestFilter,
    generateMipmaps: false,
  });
  target.texture.colorSpace = NoColorSpace;

  const blitMaterial = new MeshBasicNodeMaterial();
  blitMaterial.colorNode = texture(
    target.texture,
    vec2(uv().x, uv().y.oneMinus()),
  );
  blitMaterial.depthTest = false;
  blitMaterial.depthWrite = false;
  blitMaterial.toneMapped = false;
  const blitGeometry = new PlaneGeometry(2, 2);
  const blitScene = new Scene();
  blitScene.add(new Mesh(blitGeometry, blitMaterial));
  const blitCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let lost: (() => void) | undefined;
  let disposed = false;
  const defaultOnDeviceLost = renderer.onDeviceLost.bind(renderer);
  renderer.onDeviceLost = (info) => {
    defaultOnDeviceLost(info);
    if (!disposed) lost?.();
  };

  const isWebGL = () =>
    (renderer as unknown as { backend?: { isWebGLBackend?: boolean } }).backend
      ?.isWebGLBackend === true;

  function draw(): void {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(blitScene, blitCamera);
  }

  return {
    layer,
    decor,
    get name() {
      return isWebGL() ? "webgl2" : "webgpu";
    },
    async start(onDeviceLost) {
      lost = onDeviceLost;
      await renderer.init();
    },
    view(view: PreviewView) {
      renderer.setSize(
        view.metrics.backingWidth,
        view.metrics.backingHeight,
        false,
      );
      const bounds = cameraBounds(options.logicalSize, view.camera);
      camera.left = bounds.left;
      camera.right = bounds.right;
      camera.top = bounds.top;
      camera.bottom = bounds.bottom;
      camera.updateProjectionMatrix();
    },
    async prepare() {
      if (disposed) return;
      scene.updateMatrixWorld(true);
      renderer.setRenderTarget(target);
      await renderer.compileAsync(scene, camera);
      renderer.setRenderTarget(null);
      await renderer.compileAsync(blitScene, blitCamera);
    },
    render() {
      if (!disposed) draw();
    },
    async readRenderTarget() {
      const data = await renderer.readRenderTargetPixelsAsync(
        target,
        0,
        0,
        logicalWidth,
        logicalHeight,
      );
      const bytes = new Uint8Array(
        data.buffer,
        data.byteOffset,
        data.byteLength,
      );
      const buffer = {
        width: logicalWidth,
        height: logicalHeight,
        data: bytes,
      };
      return isWebGL() ? flipRows(buffer) : buffer;
    },
    readCanvas() {
      draw();
      const copy = document.createElement("canvas");
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext("2d", { willReadFrequently: true });
      if (context === null) {
        return Promise.reject(new Error("a 2D context is unavailable"));
      }
      context.drawImage(canvas, 0, 0);
      const pixels = context.getImageData(0, 0, copy.width, copy.height);
      return Promise.resolve({
        width: pixels.width,
        height: pixels.height,
        data: new Uint8Array(
          pixels.data.buffer,
          pixels.data.byteOffset,
          pixels.data.byteLength,
        ),
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(decor);
      layer.dispose();
      target.dispose();
      blitMaterial.dispose();
      blitGeometry.dispose();
      renderer.dispose();
    },
  };
}

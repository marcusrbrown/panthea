// The packaged inspection fixture's controller. It draws one explicit
// selection through exactly what the live scene uses: the registry client,
// the shared atlas decode, the `packages/renderer` GPU backend, texture store
// and sprite layer. It never reads world state. Frames of the selection are
// laid out in a row (wrapping), each at whole pixels in a fixed 1x target, so
// a read-back region is known exactly and can be compared with the committed
// reference digests.

import {
  EMPTY_SNAPSHOT,
  type PixelResolution,
  resolveAssetPixels,
} from "@panthea/assets/browser";
import {
  type AtlasSpec,
  canvasMetrics,
  createGpuBackend,
  type DecodedImage,
  depthZ,
  type GpuBackend,
  type Instance,
  type InstanceArt,
  placeholderImage,
} from "@panthea/renderer";

import type { CanonClient, RootKind } from "../assets/canon";
import { type AtlasDecoder, decodeAtlas, releaseImage } from "../assets/decode";
import {
  type CheckResult,
  evaluate,
  globalChecks,
  type Measurement,
} from "./check";
import {
  CHECK_ZOOMS,
  INSPECT_BACKGROUND,
  type PixelRect,
  type Rgba,
} from "./digest";
import { REFERENCE } from "./expected";
import type { Reference } from "./reference";
import {
  type AssetListing,
  listAssets,
  optionsOf,
  type Selection,
  type SelectionOptions,
  selectionQuery,
} from "./selection";

/** The fixed 1x render target. Wide enough for a row of 96-wide portraits or four 128-wide frames. */
export const INSPECT_SIZE = { width: 576, height: 288 } as const;

const PAD = 16;
const GAP = 8;

/** Top-left rects for frames of these sizes, left to right, wrapping, at whole pixels. */
export function placeFrames(
  sizes: readonly { readonly w: number; readonly h: number }[],
): PixelRect[] {
  const placed: PixelRect[] = [];
  let x = PAD;
  let y = PAD;
  let rowHeight = 0;
  for (const size of sizes) {
    if (x > PAD && x + size.w > INSPECT_SIZE.width - PAD) {
      x = PAD;
      y += rowHeight + GAP;
      rowHeight = 0;
    }
    if (
      x + size.w > INSPECT_SIZE.width - PAD ||
      y + size.h > INSPECT_SIZE.height
    ) {
      throw new Error(
        `a ${size.w}x${size.h} frame does not fit the ${INSPECT_SIZE.width}x${INSPECT_SIZE.height} target`,
      );
    }
    placed.push({ x, y, w: size.w, h: size.h });
    x += size.w + GAP;
    rowHeight = Math.max(rowHeight, size.h);
  }
  return placed;
}

export interface Listing {
  readonly assets: readonly AssetListing[];
  readonly options: SelectionOptions;
  readonly rootKind?: RootKind;
}

export interface Shown {
  readonly selection: Selection;
  readonly resolution: PixelResolution;
  readonly placements: readonly PixelRect[];
}

export interface SuiteResult {
  readonly results: readonly CheckResult[];
}

export interface InspectorDeps {
  readonly canon: CanonClient;
  readonly createBackend?: (canvas: HTMLCanvasElement) => GpuBackend;
  readonly decode?: AtlasDecoder;
  readonly devicePixelRatio?: () => number;
  readonly webGpuPresent?: () => boolean;
  readonly reference?: Reference;
}

export interface Inspector {
  start(onDeviceLost: () => void): Promise<void>;
  listing(): Promise<Listing>;
  /** Draws the selection at the display zoom and resolves once the frame is rendered. */
  show(selection: Selection): Promise<Shown>;
  /** Shows the selection, then reads it back from the target and from the canvas at every checked zoom. */
  measure(selection: Selection): Promise<Measurement>;
  /** Measures every committed selection and the unpublished controls, and adds the global checks. */
  runAll(): Promise<SuiteResult>;
  setZoom(zoom: number): void;
  readonly backendName: string | undefined;
  dispose(): void;
}

interface Payload {
  readonly key: string;
  readonly spec: AtlasSpec;
  readonly image: DecodedImage;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function createInspector(
  canvas: HTMLCanvasElement,
  deps: InspectorDeps,
): Inspector {
  const { canon } = deps;
  const reference = deps.reference ?? REFERENCE;
  const backend = (
    deps.createBackend ??
    ((element) =>
      createGpuBackend(element, {
        logicalSize: INSPECT_SIZE,
        background: INSPECT_BACKGROUND,
      }))
  )(canvas);
  const devicePixelRatio =
    deps.devicePixelRatio ?? (() => window.devicePixelRatio || 1);
  const webGpuPresent =
    deps.webGpuPresent ??
    (() => typeof navigator !== "undefined" && "gpu" in navigator);

  const payloads = new Map<string, Payload>();
  const undecodable = new Set<string>();
  let zoom = 2;
  let disposed = false;
  let tail: Promise<unknown> = Promise.resolve();

  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  }

  function applyView(at: number): void {
    const metrics = canvasMetrics(INSPECT_SIZE, at, devicePixelRatio());
    if (
      canvas.width !== metrics.backingWidth ||
      canvas.height !== metrics.backingHeight
    ) {
      canvas.width = metrics.backingWidth;
      canvas.height = metrics.backingHeight;
    }
    canvas.style.width = `${metrics.cssWidth}px`;
    canvas.style.height = `${metrics.cssHeight}px`;
    canvas.style.imageRendering = "pixelated";
    backend.view({ zoom: at, camera: { x: 0, y: 0 }, metrics });
  }

  async function canonPayload(atlas: {
    blob: string;
    width: number;
    height: number;
  }): Promise<Payload | undefined> {
    const key = `canon:${atlas.blob}`;
    const held = payloads.get(key);
    if (held !== undefined) return held;
    if (undecodable.has(key)) return undefined;
    const bytes = await canon.atlas(atlas.blob);
    if (bytes === undefined) return undefined;
    try {
      const image = await decodeAtlas(bytes, atlas, deps.decode);
      const payload: Payload = {
        key,
        spec: {
          pixelKey: atlas.blob,
          width: atlas.width,
          height: atlas.height,
        },
        image,
      };
      payloads.set(key, payload);
      return payload;
    } catch (error) {
      undecodable.add(key);
      canon.report({ scope: `atlas:${atlas.blob}`, message: messageOf(error) });
      return undefined;
    }
  }

  function placeholderPayload(
    pixels: Extract<PixelResolution, { source: "placeholder" }>["pixels"],
  ): Payload {
    const pixelKey = `default:${pixels.width}x${pixels.height}`;
    const key = `placeholder:${pixelKey}`;
    let payload = payloads.get(key);
    if (payload === undefined) {
      payload = {
        key,
        spec: { pixelKey, width: pixels.width, height: pixels.height },
        image: placeholderImage(pixels),
      };
      payloads.set(key, payload);
    }
    return payload;
  }

  function instance(
    index: number,
    rect: PixelRect,
    art: InstanceArt,
  ): Instance {
    const z = depthZ({ depth: 0, layer: "actor", order: index });
    if (!z.ok) throw new Error(z.detail);
    return {
      id: `frame:${index}`,
      layer: "actor",
      cell: { x: 0, y: 0, z: 0 },
      footprint: { w: 1, h: 1 },
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      depth: 0,
      z: z.value,
      art,
    };
  }

  async function showNow(selection: Selection): Promise<Shown> {
    const { snapshot } = await canon.load();
    const query = selectionQuery(selection);
    let resolution = resolveAssetPixels(snapshot, query);
    let payload: Payload | undefined;
    if (resolution.source === "canon") {
      payload = await canonPayload(resolution.atlas);
      // An atlas that cannot be had draws the placeholder, which the checks
      // then fail on: nothing canon was shown.
      if (payload === undefined) {
        resolution = resolveAssetPixels(EMPTY_SNAPSHOT, query);
      }
    }
    if (disposed) throw new Error("the inspector was disposed");

    const instances: Instance[] = [];
    let placements: PixelRect[];
    if (resolution.source === "canon" && payload !== undefined) {
      const { frames } = resolution;
      placements = placeFrames(frames.map((frame) => frame.rect));
      for (const [index, frame] of frames.entries()) {
        const rect = placements[index];
        if (rect === undefined) continue;
        instances.push(
          instance(index, rect, {
            source: "canon",
            assetId: resolution.assetId,
            revision: resolution.revision,
            uri: resolution.uri,
            atlas: resolution.atlas,
            frames: [frame],
          }),
        );
      }
    } else if (resolution.source === "placeholder") {
      payload = placeholderPayload(resolution.pixels);
      placements = placeFrames([
        { w: resolution.pixels.width, h: resolution.pixels.height },
      ]);
      const rect = placements[0];
      if (rect !== undefined) {
        instances.push(
          instance(0, rect, {
            source: "placeholder",
            reason: resolution.reason,
            placeholder: {
              width: resolution.pixels.width,
              height: resolution.pixels.height,
            },
          }),
        );
      }
    } else {
      throw new Error("a canon selection has no atlas payload");
    }

    const { layer } = backend;
    if (
      payload !== undefined &&
      layer.plan(payload.key, payload.spec) !== "keep"
    ) {
      layer.commit(payload.key, payload.spec, payload.image);
    }
    const atlasKey = payload?.key ?? "";
    const applied = layer.apply(
      instances.map((one) => ({ instance: one, atlasKey })),
    );
    for (const id of applied.skipped) {
      canon.report({ scope: id, message: "its atlas could not be drawn" });
    }
    applyView(zoom);
    await backend.prepare?.();
    if (disposed) throw new Error("the inspector was disposed");
    backend.render();
    return { selection, resolution, placements };
  }

  async function measureNow(selection: Selection): Promise<Measurement> {
    const shown = await showNow(selection);
    const target = await backend.readRenderTarget();
    const canvases = new Map<number, Rgba>();
    for (const at of CHECK_ZOOMS) {
      applyView(at);
      backend.render();
      canvases.set(at, await backend.readCanvas());
    }
    applyView(zoom);
    backend.render();
    return { ...shown, target, canvases };
  }

  async function listing(): Promise<Listing> {
    const { snapshot, rootKind, vocabulary } = await canon.load();
    return {
      assets: listAssets(snapshot),
      options: optionsOf(vocabulary),
      ...(rootKind === undefined ? {} : { rootKind }),
    };
  }

  /** The committed selections, then, per sprite, the unpublished states that must draw the placeholder. */
  function suiteSelections(): Selection[] {
    const selections: Selection[] = [];
    for (const asset of reference.assets) {
      for (const selection of asset.selections) {
        selections.push(
          "expression" in selection.query
            ? {
                assetId: asset.assetId,
                kind: "portrait",
                expression: selection.query.expression,
              }
            : {
                assetId: asset.assetId,
                kind: "sprite",
                state: selection.query.state,
                direction: selection.query.direction,
                ...(selection.query.ability === undefined
                  ? {}
                  : { ability: selection.query.ability }),
              },
        );
      }
      if (asset.kind !== "sprite") continue;
      for (const state of ["seated", "act"]) {
        const published = asset.selections.some(
          (selection) =>
            !("expression" in selection.query) &&
            selection.query.state === state &&
            selection.query.direction === "south" &&
            selection.query.ability === undefined,
        );
        if (!published) {
          selections.push({
            assetId: asset.assetId,
            kind: "sprite",
            state,
            direction: "south",
          });
        }
      }
    }
    return selections;
  }

  return {
    async start(onDeviceLost) {
      await Promise.all([backend.start(onDeviceLost), canon.load()]);
      if (disposed) return;
      applyView(zoom);
    },
    listing,
    show: (selection) => serial(() => showNow(selection)),
    measure: (selection) => serial(() => measureNow(selection)),
    runAll() {
      return serial(async () => {
        const results: CheckResult[] = [];
        for (const selection of suiteSelections()) {
          results.push(...evaluate(await measureNow(selection), reference));
        }
        const { rootKind } = await canon.load();
        results.push(
          ...globalChecks({
            rootKind,
            backendName: backend.name,
            webGpuPresent: webGpuPresent(),
          }),
        );
        return { results };
      });
    },
    setZoom(next) {
      if (!Number.isInteger(next) || next < 1) {
        throw new Error(
          `zoom must be a whole number of at least 1, got ${next}`,
        );
      }
      zoom = next;
      if (!disposed) {
        applyView(zoom);
        backend.render();
      }
    },
    get backendName() {
      return backend.name;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      backend.dispose();
      for (const payload of payloads.values()) releaseImage(payload.image);
      payloads.clear();
    },
  };
}

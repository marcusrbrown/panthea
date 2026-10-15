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
  type PageRead,
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
  selectionLabel as selectionLabelOf,
  selectionQuery,
} from "./selection";

/**
 * The fixed 1x render target. Wide enough for a row of 96-wide portraits, four
 * 128-wide frames or four 112-wide god-tall frames (16 + 4 * 112 + 3 * 8 = 488
 * <= 560). Tall enough for a 16-frame god-tall clip, the longest the vocabulary
 * allows: four rows of 96 with 8 between and 16 above end at 16 + 4 * 96 +
 * 3 * 8 = 424, rounded up to the 16 px grid: 432. The canvas is 4 x that at the
 * largest checked zoom: 2304 x 1728.
 */
export const INSPECT_SIZE = { width: 576, height: 432 } as const;

const PAD = 16;
const GAP = 8;

type FrameSize = { readonly w: number; readonly h: number };

/** Top-left rects for frames of these sizes, left to right, wrapping, at whole pixels; undefined when they do not all fit. */
function tryPlace(sizes: readonly FrameSize[]): PixelRect[] | undefined {
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
      return undefined;
    }
    placed.push({ x, y, w: size.w, h: size.h });
    x += size.w + GAP;
    rowHeight = Math.max(rowHeight, size.h);
  }
  return placed;
}

const tooBig = (size: FrameSize): Error =>
  new Error(
    `a ${size.w}x${size.h} frame does not fit the ${INSPECT_SIZE.width}x${INSPECT_SIZE.height} target`,
  );

/** Top-left rects for frames of these sizes, left to right, wrapping, at whole pixels. Throws if they do not all fit. */
export function placeFrames(sizes: readonly FrameSize[]): PixelRect[] {
  const placed = tryPlace(sizes);
  if (placed !== undefined) return placed;
  // Name the first frame that overflows, as the page it would start would not hold it either.
  for (let count = 1; count <= sizes.length; count += 1) {
    if (tryPlace(sizes.slice(0, count)) === undefined) {
      throw tooBig(sizes[count - 1] as FrameSize);
    }
  }
  throw new Error("frames do not fit the target");
}

/**
 * Splits frames into pages, in order, each page filled until the next frame would not fit the target and laid
 * out with `placeFrames`. A selection that fits is one page, so it is placed exactly as `placeFrames` places it.
 * A frame that cannot fit the target even alone, being wider or taller than the whole of it, is refused.
 */
export function pageFrames(sizes: readonly FrameSize[]): PixelRect[][] {
  const pages: FrameSize[][] = [];
  let page: FrameSize[] = [];
  for (const size of sizes) {
    if (tryPlace([size]) === undefined) {
      throw new Error(
        `a ${size.w}x${size.h} frame does not fit the ${INSPECT_SIZE.width}x${INSPECT_SIZE.height} target, even alone on a page`,
      );
    }
    if (tryPlace([...page, size]) === undefined) {
      pages.push(page);
      page = [];
    }
    page.push(size);
  }
  if (page.length > 0) pages.push(page);
  return pages.map((frames) => placeFrames(frames));
}

export interface Listing {
  readonly assets: readonly AssetListing[];
  readonly options: SelectionOptions;
  readonly rootKind?: RootKind;
}

export interface Shown {
  readonly selection: Selection;
  readonly resolution: PixelResolution;
  /** Where each frame of this page sits in the target. */
  readonly placements: readonly PixelRect[];
  /** Which page is drawn, from 0, and how many pages the selection takes: frames that do not fit one draw are paged. */
  readonly page: number;
  readonly pages: number;
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
  /** Draws one page of the selection (the first by default) at the display zoom and resolves once it is rendered. */
  show(selection: Selection, page?: number): Promise<Shown>;
  /** Shows every page of the selection in turn, reading each back from the target and from the canvas at every checked zoom. */
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
  let lastPage = 0;
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

  async function showNow(selection: Selection, page = 0): Promise<Shown> {
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
    let pages = 1;
    if (resolution.source === "canon" && payload !== undefined) {
      const paged = pageFrames(resolution.frames.map((frame) => frame.rect));
      pages = Math.max(paged.length, 1);
      if (!Number.isInteger(page) || page < 0 || page >= pages) {
        throw new Error(
          `page ${page + 1} is out of range: ${selectionLabelOf(selection)} takes ${pages} page${pages === 1 ? "" : "s"}`,
        );
      }
      placements = paged[page] ?? [];
      const first = paged
        .slice(0, page)
        .reduce((count, earlier) => count + earlier.length, 0);
      const frames = resolution.frames.slice(first, first + placements.length);
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
      if (page !== 0) {
        throw new Error(
          `page ${page + 1} is out of range: ${selectionLabelOf(selection)} takes 1 page`,
        );
      }
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
    return { selection, resolution, placements, page, pages };
  }

  /** The page now drawn, read back from the render target and from the canvas at every checked zoom. */
  async function readPage(shown: Shown): Promise<PageRead> {
    const target = await backend.readRenderTarget();
    const canvases = new Map<number, Rgba>();
    for (const at of CHECK_ZOOMS) {
      applyView(at);
      backend.render();
      canvases.set(at, await backend.readCanvas());
    }
    applyView(zoom);
    backend.render();
    return { placements: shown.placements, target, canvases };
  }

  /** Every page of the selection, each read back; the last page drawn is the one that was showing before, if there is one. */
  async function measureNow(
    selection: Selection,
    restore: boolean,
  ): Promise<Measurement> {
    const shown = await showNow(selection, 0);
    const first = await readPage(shown);
    const later: PageRead[] = [];
    for (let page = 1; page < shown.pages; page += 1) {
      later.push(await readPage(await showNow(selection, page)));
    }
    if (restore && shown.pages > 1) {
      await showNow(selection, Math.min(lastPage, shown.pages - 1));
    }
    return {
      selection,
      resolution: shown.resolution,
      placements: first.placements,
      target: first.target,
      canvases: first.canvases,
      later,
    };
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
    show: (selection, page = 0) =>
      serial(async () => {
        const shown = await showNow(selection, page);
        lastPage = page;
        return shown;
      }),
    measure: (selection) => serial(() => measureNow(selection, true)),
    runAll() {
      return serial(async () => {
        const results: CheckResult[] = [];
        for (const selection of suiteSelections()) {
          results.push(
            ...evaluate(await measureNow(selection, false), reference),
          );
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

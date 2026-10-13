// The in-page check driver: renders known scenes on the live backend, reads
// the render target and the canvas back, and judges them with the pure
// comparisons in pixels.ts. Browser only; it needs a real renderer.

import { DEFAULT_BACKGROUND, type Instance } from "@panthea/renderer";
import { HARNESS_CAMERA, harnessItems } from "../harness/layout";
import {
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  type Preview,
  type PreviewItem,
  ZOOMS,
  type Zoom,
} from "../renderer/preview";
import type {
  AssetSource,
  Listing,
  ResolveRequest,
  Selection,
} from "../source/port";
import {
  compareEnlargement,
  compareFrame,
  compareOverlap,
  diffPixels,
  type Pixels,
  type Placed,
  renderExpected,
} from "./pixels";
import {
  FRAME_PORTRAIT_ID,
  FRAME_SUBJECT_ID,
  frameScene,
  occlusionCases,
} from "./scenes";

export interface CheckReport {
  readonly name: string;
  readonly pass: boolean;
  readonly checked: number;
  readonly mismatches: number;
  readonly detail: string;
}

export interface ZoomReport {
  readonly zoom: Zoom;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly checks: readonly CheckReport[];
}

export interface CheckResult {
  readonly status: "done";
  readonly ok: boolean;
  readonly backend: string;
  readonly devicePixelRatio: number;
  readonly userAgent: string;
  readonly subjectUnderTest: string;
  readonly portraitUnderTest: string;
  readonly zooms: readonly ZoomReport[];
}

export interface CheckEnv {
  readonly preview: Preview;
  readonly source: AssetSource;
  readonly listing: Listing;
  /** Set to true to stop the run at its next step. */
  readonly cancelled?: { readonly current: boolean };
}

function proceed(env: CheckEnv): void {
  if (env.cancelled?.current) throw new Error("the check run was cancelled");
}

function pick(
  listing: Listing,
  source: Selection["source"],
  kind: "sprite" | "portrait",
): Selection | undefined {
  const found = listing.entries.find(
    (entry) => entry.source === source && entry.kind === kind && entry.ok,
  );
  return found === undefined
    ? undefined
    : { source: found.source, id: found.id };
}

async function atlasPixels(
  source: AssetSource,
  request: ResolveRequest,
  cache: Map<string, Promise<Pixels>>,
): Promise<Pixels> {
  const key = JSON.stringify(request);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const loading = (async () => {
    const resolution = await source.resolve(request);
    const bytes = await source.fetchBytes(resolution.bytes);
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      { premultiplyAlpha: "none", colorSpaceConversion: "none" },
    );
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("a 2D context is unavailable");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return {
      width: pixels.width,
      height: pixels.height,
      data: new Uint8Array(
        pixels.data.buffer,
        pixels.data.byteOffset,
        pixels.data.byteLength,
      ),
    };
  })();
  cache.set(key, loading);
  return loading;
}

function requestOf(items: readonly PreviewItem[], id: string): ResolveRequest {
  const item = items.find((candidate) => candidate.id === id);
  if (item === undefined || item.kind === "diamond") {
    throw new Error(`scene has no sourced item "${id}"`);
  }
  return item.request;
}

async function placedOf(
  env: CheckEnv,
  items: readonly PreviewItem[],
  instance: Instance,
  cache: Map<string, Promise<Pixels>>,
): Promise<Placed> {
  const atlas = await atlasPixels(
    env.source,
    requestOf(items, instance.id),
    cache,
  );
  const rect =
    instance.art.source === "canon"
      ? (instance.art.frames[0]?.rect ?? { x: 0, y: 0, w: 0, h: 0 })
      : { x: 0, y: 0, w: instance.w, h: instance.h };
  return {
    atlas,
    rect,
    at: {
      x: instance.x - HARNESS_CAMERA.x,
      y: instance.y - HARNESS_CAMERA.y,
    },
  };
}

function instanceOf(preview: Preview, id: string): Instance {
  const found = preview.drawn.find((instance) => instance.id === id);
  if (found === undefined) throw new Error(`"${id}" was not drawn`);
  return found;
}

const report = (
  name: string,
  pass: boolean,
  checked: number,
  mismatches: number,
  detail: string,
): CheckReport => ({ name, pass, checked, mismatches, detail });

async function show(
  env: CheckEnv,
  items: readonly PreviewItem[],
): Promise<void> {
  proceed(env);
  await env.preview.setItems(items);
  await env.preview.idle();
  proceed(env);
}

async function composite(
  env: CheckEnv,
  items: readonly PreviewItem[],
  cache: Map<string, Promise<Pixels>>,
): Promise<Pixels> {
  const ordered = [...env.preview.drawn].sort((a, b) => a.z - b.z);
  const layers: Placed[] = [];
  for (const instance of ordered) {
    if (instance.art.source === "diamond") continue;
    layers.push(await placedOf(env, items, instance, cache));
  }
  return renderExpected(
    LOGICAL_WIDTH,
    LOGICAL_HEIGHT,
    DEFAULT_BACKGROUND,
    layers,
  );
}

async function checkEnlargement(
  env: CheckEnv,
  zoom: Zoom,
  subject: Selection | undefined,
  portrait: Selection | undefined,
): Promise<{ result: CheckReport; canvas: { width: number; height: number } }> {
  await show(
    env,
    harnessItems({
      subject,
      portrait,
      state: "idle",
      direction: "south",
      expression: "neutral",
      companion: true,
    }),
  );
  const target = await env.preview.readRenderTarget();
  const canvas = await env.preview.readCanvas();
  const comparison = compareEnlargement(target, canvas, zoom);
  const first = comparison.first;
  return {
    canvas: { width: canvas.width, height: canvas.height },
    result: report(
      "canvas equals render target under integer division",
      comparison.mismatches === 0 && comparison.checked > 0,
      comparison.checked,
      comparison.mismatches,
      comparison.note ??
        (first === undefined
          ? `${canvas.width}x${canvas.height} canvas from a ${target.width}x${target.height} target at ${zoom}x`
          : `first difference at ${first.x},${first.y}: expected ${first.expected} got ${first.actual}`),
    ),
  };
}

async function checkFrames(
  env: CheckEnv,
  sprite: Selection,
  portrait: Selection,
  cache: Map<string, Promise<Pixels>>,
): Promise<CheckReport[]> {
  const items = frameScene(sprite, portrait);
  await show(env, items);
  const target = await env.preview.readRenderTarget();
  const reports: CheckReport[] = [];
  for (const [label, id] of [
    ["portrait panel", FRAME_PORTRAIT_ID],
    ["sprite frame", FRAME_SUBJECT_ID],
  ] as const) {
    const placed = await placedOf(
      env,
      items,
      instanceOf(env.preview, id),
      cache,
    );
    const result = compareFrame(target, placed.atlas, placed.rect, placed.at);
    reports.push(
      report(
        `${label} pixels land at their projected texels`,
        result.mismatches === 0 && result.compared > 0 && result.clipped === 0,
        result.compared,
        result.mismatches,
        `${result.compared} opaque pixels compared, ${result.skippedTransparent} below the cutout skipped, ${result.partial} partial-alpha skipped, ${result.clipped} clipped${
          result.first === undefined
            ? ""
            : `; first difference at ${result.first.x},${result.first.y}: expected ${result.first.expected} got ${result.first.actual}`
        }`,
      ),
    );
  }
  const whole = diffPixels(await composite(env, items, cache), target);
  reports.push(
    report(
      "whole frame scene equals the expected composite",
      whole.mismatches === 0 && whole.checked > 0,
      whole.checked,
      whole.mismatches,
      whole.note ??
        (whole.first === undefined
          ? "every pixel of the render target matches"
          : `first difference at ${whole.first.x},${whole.first.y}: expected ${whole.first.expected} got ${whole.first.actual}`),
    ),
  );
  return reports;
}

async function checkOcclusion(
  env: CheckEnv,
  sprite: Selection,
  cache: Map<string, Promise<Pixels>>,
): Promise<CheckReport[]> {
  const reports: CheckReport[] = [];
  for (const scene of occlusionCases(sprite)) {
    await show(env, scene.items);
    const target = await env.preview.readRenderTarget();
    const front = instanceOf(env.preview, scene.front);
    const back = instanceOf(env.preview, scene.back);
    const overlap = compareOverlap(
      target,
      await placedOf(env, scene.items, front, cache),
      await placedOf(env, scene.items, back, cache),
    );
    const decided = overlap.overlapping - overlap.ambiguous;
    const whole = diffPixels(await composite(env, scene.items, cache), target);
    const keyAgrees = front.z > back.z;
    reports.push(
      report(
        `occlusion: ${scene.name}`,
        keyAgrees &&
          decided > 0 &&
          overlap.frontWins === decided &&
          overlap.backWins === 0 &&
          overlap.other === 0 &&
          whole.mismatches === 0,
        overlap.overlapping,
        overlap.backWins + overlap.other + whole.mismatches,
        `${scene.front} in front: ${overlap.frontWins} of ${overlap.overlapping} shared pixels show it, ${overlap.backWins} show ${scene.back}, ${overlap.ambiguous} ambiguous, ${overlap.other} other; depth keys ${front.z} vs ${back.z}; composite mismatches ${whole.mismatches}`,
      ),
    );
  }
  return reports;
}

export async function runChecks(env: CheckEnv): Promise<CheckResult> {
  console.info("[studio] check run started");
  const sprite =
    pick(env.listing, "draft", "sprite") ??
    pick(env.listing, "approved", "sprite") ??
    pick(env.listing, "canon", "sprite");
  const portrait =
    pick(env.listing, "canon", "portrait") ??
    pick(env.listing, "approved", "portrait") ??
    pick(env.listing, "draft", "portrait");
  const cache = new Map<string, Promise<Pixels>>();
  const zooms: ZoomReport[] = [];
  env.preview.setCamera(HARNESS_CAMERA);

  for (const zoom of ZOOMS) {
    env.preview.setZoom(zoom);
    await env.preview.idle();
    const checks: CheckReport[] = [];
    const enlargement = await checkEnlargement(env, zoom, sprite, portrait);
    checks.push(enlargement.result);
    if (sprite === undefined || portrait === undefined) {
      checks.push(
        report(
          "frame and occlusion checks need a sprite and a portrait",
          false,
          0,
          1,
          `sprite ${sprite ? `${sprite.source}/${sprite.id}` : "missing"}, portrait ${portrait ? `${portrait.source}/${portrait.id}` : "missing"}`,
        ),
      );
    } else {
      checks.push(...(await checkFrames(env, sprite, portrait, cache)));
      checks.push(...(await checkOcclusion(env, sprite, cache)));
    }
    zooms.push({ zoom, canvas: enlargement.canvas, checks });
  }

  const label = (selection: Selection | undefined) =>
    selection === undefined ? "none" : `${selection.source}/${selection.id}`;
  return {
    status: "done",
    ok: zooms.every((z) => z.checks.every((c) => c.pass)),
    backend: env.preview.backendName() ?? "unknown",
    devicePixelRatio: window.devicePixelRatio,
    userAgent: navigator.userAgent,
    subjectUnderTest: label(sprite),
    portraitUnderTest: label(portrait),
    zooms,
  };
}

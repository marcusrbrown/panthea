// The inspection fixture's checks, as pure functions over what was read back.
// A canon check is defined by the committed reference digests, not by what
// the snapshot happens to hold: a withheld registry, or one holding only
// placeholders, fails every one of them. A check passes only on equality with
// an independent expectation; a missing expectation is a failure, never a skip.

import type { PixelResolution } from "@panthea/assets/browser";

import {
  crop,
  cutoutOver,
  digestRgba,
  INSPECT_BACKGROUND,
  type PixelRect,
  type Rgba,
  upscale,
} from "./digest";
import type {
  Reference,
  ReferenceAsset,
  ReferenceSelection,
} from "./reference";
import { selectionKey } from "./reference";
import { type Selection, selectionQuery } from "./selection";

export interface CheckResult {
  readonly id: string;
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface Measurement {
  readonly selection: Selection;
  readonly resolution: PixelResolution;
  /** Where each drawn frame sits in the 1x render target. */
  readonly placements: readonly PixelRect[];
  /** The 1x render target read back. */
  readonly target: Rgba;
  /** The canvas read back at each integer zoom, keyed by the zoom. */
  readonly canvases: ReadonlyMap<number, Rgba>;
}

export function summarize(results: readonly CheckResult[]): {
  passed: number;
  failed: number;
  ok: boolean;
} {
  const passed = results.filter((result) => result.ok).length;
  const failed = results.length - passed;
  return { passed, failed, ok: results.length > 0 && failed === 0 };
}

export function globalChecks(input: {
  readonly rootKind: "repo" | "bundled" | undefined;
  readonly backendName: string | undefined;
  readonly webGpuPresent: boolean;
}): CheckResult[] {
  return [
    {
      id: "root-kind",
      label: "registry root is the bundled resource directory",
      ok: input.rootKind === "bundled",
      detail: input.rootKind ?? "none",
    },
    {
      id: "backend",
      label: "renderer backend is WebGL2",
      ok: input.backendName === "webgl2",
      detail: `${input.backendName ?? "none"}; navigator.gpu ${input.webGpuPresent ? "present" : "absent"}`,
    },
  ];
}

const sameRect = (a: PixelRect, b: PixelRect): boolean =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** The region a frame occupies in the read-back for `zoom`, or why it cannot be read. */
function regionOf(
  measurement: Measurement,
  index: number,
  size: { readonly w: number; readonly h: number },
  zoom: number | "target",
): Rgba | string {
  const placement = measurement.placements[index];
  if (placement === undefined) return "the frame was not drawn";
  const scale = zoom === "target" ? 1 : zoom;
  const image =
    zoom === "target" ? measurement.target : measurement.canvases.get(zoom);
  if (image === undefined) return `the canvas was not read back at ${zoom}x`;
  try {
    return crop(image, {
      x: placement.x * scale,
      y: placement.y * scale,
      w: size.w * scale,
      h: size.h * scale,
    });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function canonChecks(
  measurement: Measurement,
  asset: ReferenceAsset,
  expected: ReferenceSelection,
  zooms: readonly number[],
): CheckResult[] {
  const { resolution } = measurement;
  const base = `canon:${asset.assetId}:${expected.key}`;
  const name = `${asset.assetId} ${expected.key}`;
  const isCanon = resolution.source === "canon";
  const results: CheckResult[] = [
    {
      id: `${base}:source`,
      label: `${name}: source is canon`,
      ok: isCanon,
      detail: isCanon
        ? "canon"
        : `${resolution.source} (${resolution.reason}); the registry did not supply it`,
    },
    {
      id: `${base}:atlas`,
      label: `${name}: atlas hash is the expected one`,
      ok: isCanon && resolution.atlas.blob === asset.atlas.blob,
      detail: isCanon
        ? `${resolution.atlas.blob}, expected ${asset.atlas.blob}`
        : `no atlas, expected ${asset.atlas.blob}`,
    },
    {
      id: `${base}:frames`,
      label: `${name}: frame rects are the expected ones`,
      ok:
        isCanon &&
        resolution.frames.length === expected.frames.length &&
        resolution.frames.every((frame, index) => {
          const want = expected.frames[index];
          return want !== undefined && sameRect(frame.rect, want.rect);
        }),
      detail: isCanon
        ? `${resolution.frames.length} frames, expected ${expected.frames.length}`
        : `no frames, expected ${expected.frames.length}`,
    },
  ];

  for (const [index, frame] of expected.frames.entries()) {
    const reads: ("target" | number)[] = ["target", ...zooms];
    for (const zoom of reads) {
      const key = zoom === "target" ? "1" : String(zoom);
      const want = frame.digests[key];
      const label = `${name} #${index}: pixels at ${zoom === "target" ? "1x target" : `${zoom}x canvas`}`;
      const id = `${base}#${index}:${zoom === "target" ? "target" : `canvas${zoom}`}`;
      const region = regionOf(measurement, index, frame.rect, zoom);
      if (typeof region === "string") {
        results.push({ id, label, ok: false, detail: region });
        continue;
      }
      const got = digestRgba(region);
      results.push({
        id,
        label,
        ok: want !== undefined && got === want,
        detail: `${got}, expected ${want ?? "none"}`,
      });
    }
  }
  return results;
}

function placeholderChecks(
  measurement: Measurement,
  resolution: Extract<PixelResolution, { source: "placeholder" }>,
  zooms: readonly number[],
): CheckResult[] {
  const key = selectionKey(selectionKeyOf(measurement.selection));
  const base = `placeholder:${measurement.selection.assetId}:${key}`;
  const name = `${measurement.selection.assetId} ${key}`;
  const { pixels } = resolution;
  const expected = cutoutOver(
    { width: pixels.width, height: pixels.height, data: pixels.rgba },
    INSPECT_BACKGROUND,
  );
  const results: CheckResult[] = [
    {
      id: `${base}:source`,
      label: `${name}: placeholder (${resolution.reason}), nothing is published for it`,
      ok: true,
      detail: `placeholder, ${resolution.reason}`,
    },
  ];
  const reads: ("target" | number)[] = ["target", ...zooms];
  for (const zoom of reads) {
    const scale = zoom === "target" ? 1 : zoom;
    const label = `${name}: placeholder pixels at ${zoom === "target" ? "1x target" : `${zoom}x canvas`}`;
    const id = `${base}:pixels-${zoom === "target" ? "target" : `canvas${zoom}`}`;
    const region = regionOf(
      measurement,
      0,
      { w: pixels.width, h: pixels.height },
      zoom,
    );
    if (typeof region === "string") {
      results.push({ id, label, ok: false, detail: region });
      continue;
    }
    const want = scale === 1 ? expected : upscale(expected, scale);
    let different = 0;
    for (let at = 0; at < want.data.length; at += 4) {
      for (let channel = 0; channel < 4; channel += 1) {
        if (want.data[at + channel] !== region.data[at + channel]) {
          different += 1;
          break;
        }
      }
    }
    results.push({
      id,
      label,
      ok: different === 0,
      detail:
        different === 0
          ? "equal to the shared placeholder pixels"
          : `${different} pixels differ from the shared placeholder`,
    });
  }
  return results;
}

function selectionKeyOf(selection: Selection) {
  const query = selectionQuery(selection);
  return "expression" in query && query.expression !== undefined
    ? { expression: query.expression }
    : {
        state: query.state ?? "idle",
        direction: query.direction ?? "south",
        ...(query.ability === undefined ? {} : { ability: query.ability }),
      };
}

/** All the checks for one measured selection. */
export function evaluate(
  measurement: Measurement,
  reference: Reference,
): CheckResult[] {
  const key = selectionKey(selectionKeyOf(measurement.selection));
  const asset = reference.assets.find(
    (candidate) => candidate.assetId === measurement.selection.assetId,
  );
  const expected = asset?.selections.find((candidate) => candidate.key === key);
  if (asset !== undefined && expected !== undefined) {
    return canonChecks(measurement, asset, expected, reference.zooms);
  }
  const { resolution } = measurement;
  if (resolution.source === "placeholder") {
    return placeholderChecks(measurement, resolution, reference.zooms);
  }
  return [
    {
      id: `canon:${measurement.selection.assetId}:${key}:reference`,
      label: `${measurement.selection.assetId} ${key}: has a reference digest`,
      ok: false,
      detail:
        "the registry supplied canon art for this selection, but no reference digest exists for it; generate the digests",
    },
  ];
}

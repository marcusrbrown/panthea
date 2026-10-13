// The one camera (ADR-0012): tools/render/camera.json defines the 2:1 orthographic view, the
// cell math, the light and the toon bands once. Requests carry no camera id; the camera's hash
// goes into the revision recipe hash, and the render script reads the same parsed value.
//
// Pure module: no filesystem. `load.ts` reads the file.

import {
  canonicalJson,
  fail,
  isRecord,
  ok,
  type ParseResult,
  parseArray,
  parseFiniteNumber,
  parseNonNegativeInteger,
  parseSchemaVersion,
  parseString,
  type Sha256,
} from "@panthea/contracts";
import { sha256Hex } from "../hash";

const SUPPORTED_SCHEMA_VERSIONS = [1] as const;
const TOP_KEYS = [
  "schemaVersion",
  "projection",
  "rotationDeg",
  "pixelsPerUnit",
  "supersample",
  "distance",
  "clip",
  "depthRange",
  "cell",
  "light",
  "shading",
] as const;

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

export interface CameraCell {
  /** The cell class this camera renders (`god-tall`). */
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** Pixel the world origin (the sole midpoint) projects to in the 1x cell. */
  readonly pivot: Vec2;
}

export interface Camera {
  readonly schemaVersion: 1;
  readonly projection: "orthographic";
  /** Blender XYZ euler degrees: 60 down from the zenith, 45 about Z (a 2:1 ground diamond). */
  readonly rotationDeg: Vec3;
  readonly pixelsPerUnit: number;
  /** Render size is the cell times this. */
  readonly supersample: number;
  /** Camera distance from the pivot along its view axis, metres. */
  readonly distance: number;
  readonly clip: Vec2;
  /** Camera-axis distances mapped to 0..1 by the depth pass. */
  readonly depthRange: Vec2;
  readonly cell: CameraCell;
  readonly light: {
    readonly sunStrength: number;
    readonly ambientStrength: number;
    /** Key light as (right, up, toward-camera) screen weights. */
    readonly keyScreen: Vec3;
  };
  readonly shading: {
    /** Lower edge of each toon band on the diffuse value; the first is 0. */
    readonly bandStarts: readonly number[];
    /** Palette ramp shade each band draws (shade 0 is the outline's). */
    readonly bandShades: readonly number[];
  };
}

export interface CellGeometry {
  readonly cell: { readonly width: number; readonly height: number };
  readonly pivot: { readonly x: number; readonly y: number };
  readonly renderSize: { readonly width: number; readonly height: number };
  /** World units spanned by the cell height (Blender `ortho_scale`, sensor fit vertical). */
  readonly orthoScale: number;
  /** Distance the camera moves from looking straight at the pivot so it lands on the pivot pixel, in world units along the camera's right (x) and up (y) axes. */
  readonly pivotShiftUnits: { readonly x: number; readonly y: number };
}

// --- Parsing -------------------------------------------------------------------

function rejectUnknown(
  record: Record<string, unknown>,
  keys: readonly string[],
  path: string,
) {
  for (const key of Object.keys(record)) {
    if (!keys.includes(key))
      return fail(`${path}.${key}`, `unknown key "${key}"`);
  }
  return undefined;
}

function parseTuple(value: unknown, path: string, length: 2): ParseResult<Vec2>;
function parseTuple(value: unknown, path: string, length: 3): ParseResult<Vec3>;
function parseTuple(
  value: unknown,
  path: string,
  length: 2 | 3,
): ParseResult<Vec2 | Vec3> {
  const items = parseArray(value, path, parseFiniteNumber);
  if (!items.ok) return items;
  if (items.value.length !== length) {
    return fail(path, `expected ${length} numbers`);
  }
  return ok(items.value as unknown as Vec2 | Vec3);
}

export const parseVec2 = (value: unknown, path: string) =>
  parseTuple(value, path, 2);
export const parseVec3 = (value: unknown, path: string) =>
  parseTuple(value, path, 3);

function parsePositive(value: unknown, path: string): ParseResult<number> {
  const number = parseFiniteNumber(value, path);
  if (!number.ok) return number;
  if (number.value <= 0) return fail(path, "expected a positive number");
  return number;
}

function parseCell(value: unknown, path: string): ParseResult<CameraCell> {
  if (!isRecord(value)) return fail(path, "expected a cell record");
  const unknown = rejectUnknown(
    value,
    ["id", "width", "height", "pivot"],
    path,
  );
  if (unknown) return unknown;
  const id = parseString(value.id, `${path}.id`);
  if (!id.ok) return id;
  const width = parseNonNegativeInteger(value.width, `${path}.width`);
  if (!width.ok) return width;
  const height = parseNonNegativeInteger(value.height, `${path}.height`);
  if (!height.ok) return height;
  if (width.value < 1 || height.value < 1) {
    return fail(path, "expected a cell of at least 1x1");
  }
  const pivot = parseVec2(value.pivot, `${path}.pivot`);
  if (!pivot.ok) return pivot;
  const [px, py] = pivot.value;
  if (px < 0 || px >= width.value || py < 0 || py >= height.value) {
    return fail(`${path}.pivot`, "expected a pivot inside the cell");
  }
  return ok({
    id: id.value,
    width: width.value,
    height: height.value,
    pivot: pivot.value,
  });
}

function parseLight(
  value: unknown,
  path: string,
): ParseResult<Camera["light"]> {
  if (!isRecord(value)) return fail(path, "expected a light record");
  const unknown = rejectUnknown(
    value,
    ["sunStrength", "ambientStrength", "keyScreen"],
    path,
  );
  if (unknown) return unknown;
  const sun = parsePositive(value.sunStrength, `${path}.sunStrength`);
  if (!sun.ok) return sun;
  const ambient = parsePositive(
    value.ambientStrength,
    `${path}.ambientStrength`,
  );
  if (!ambient.ok) return ambient;
  const key = parseVec3(value.keyScreen, `${path}.keyScreen`);
  if (!key.ok) return key;
  return ok({
    sunStrength: sun.value,
    ambientStrength: ambient.value,
    keyScreen: key.value,
  });
}

function parseShading(
  value: unknown,
  path: string,
): ParseResult<Camera["shading"]> {
  if (!isRecord(value)) return fail(path, "expected a shading record");
  const unknown = rejectUnknown(value, ["bandStarts", "bandShades"], path);
  if (unknown) return unknown;
  const starts = parseArray(
    value.bandStarts,
    `${path}.bandStarts`,
    parseFiniteNumber,
  );
  if (!starts.ok) return starts;
  const shades = parseArray(
    value.bandShades,
    `${path}.bandShades`,
    parseNonNegativeInteger,
  );
  if (!shades.ok) return shades;
  if (starts.value.length < 2 || starts.value.length !== shades.value.length) {
    return fail(path, "expected two or more bands, one shade per start");
  }
  if (starts.value[0] !== 0) {
    return fail(`${path}.bandStarts`, "expected the first band to start at 0");
  }
  for (let i = 1; i < starts.value.length; i += 1) {
    if ((starts.value[i] as number) <= (starts.value[i - 1] as number)) {
      return fail(
        `${path}.bandStarts`,
        "expected strictly increasing band starts",
      );
    }
  }
  return ok({ bandStarts: starts.value, bandShades: shades.value });
}

export function parseCamera(
  value: unknown,
  path = "camera.json",
): ParseResult<Camera> {
  if (!isRecord(value)) return fail(path, "expected an object");
  const unknown = rejectUnknown(value, TOP_KEYS, path);
  if (unknown) return unknown;
  const version = parseSchemaVersion(
    value.schemaVersion,
    SUPPORTED_SCHEMA_VERSIONS,
    `${path}.schemaVersion`,
  );
  if (!version.ok) return version;
  if (value.projection !== "orthographic") {
    return fail(`${path}.projection`, 'expected "orthographic"');
  }
  const rotation = parseVec3(value.rotationDeg, `${path}.rotationDeg`);
  if (!rotation.ok) return rotation;
  // 2:1 isometric: a ground tile's diamond is half as tall as it is wide, so cos(tilt) = 0.5.
  if (Math.abs(Math.cos((rotation.value[0] * Math.PI) / 180) - 0.5) > 1e-9) {
    return fail(
      `${path}.rotationDeg`,
      "expected a 2:1 view: a tilt of 60 degrees from the zenith",
    );
  }
  const ppu = parsePositive(value.pixelsPerUnit, `${path}.pixelsPerUnit`);
  if (!ppu.ok) return ppu;
  const supersample = parseNonNegativeInteger(
    value.supersample,
    `${path}.supersample`,
  );
  if (!supersample.ok) return supersample;
  if (supersample.value < 1) {
    return fail(`${path}.supersample`, "expected a supersample of at least 1");
  }
  const distance = parsePositive(value.distance, `${path}.distance`);
  if (!distance.ok) return distance;
  const clip = parseVec2(value.clip, `${path}.clip`);
  if (!clip.ok) return clip;
  const depthRange = parseVec2(value.depthRange, `${path}.depthRange`);
  if (!depthRange.ok) return depthRange;
  if (depthRange.value[0] >= depthRange.value[1]) {
    return fail(`${path}.depthRange`, "expected near below far");
  }
  const cell = parseCell(value.cell, `${path}.cell`);
  if (!cell.ok) return cell;
  const light = parseLight(value.light, `${path}.light`);
  if (!light.ok) return light;
  const shading = parseShading(value.shading, `${path}.shading`);
  if (!shading.ok) return shading;
  return ok({
    schemaVersion: 1,
    projection: "orthographic",
    rotationDeg: rotation.value,
    pixelsPerUnit: ppu.value,
    supersample: supersample.value,
    distance: distance.value,
    clip: clip.value,
    depthRange: depthRange.value,
    cell: cell.value,
    light: light.value,
    shading: shading.value,
  });
}

// --- Math and hash ---------------------------------------------------------------

/** The cell math, once: render size, ortho scale and where the pivot sits. */
export function cellGeometry(camera: Camera): CellGeometry {
  const { width, height, pivot } = camera.cell;
  const ppu = camera.pixelsPerUnit;
  return {
    cell: { width, height },
    pivot: { x: pivot[0], y: pivot[1] },
    renderSize: {
      width: width * camera.supersample,
      height: height * camera.supersample,
    },
    orthoScale: height / ppu,
    pivotShiftUnits: {
      x: (pivot[0] - width / 2) / ppu,
      y: (pivot[1] - height / 2) / ppu,
    },
  };
}

/** sha256 of the canonical JSON of the parsed camera; key order and formatting do not matter. */
export function cameraHash(camera: Camera): Sha256 {
  return sha256Hex(new TextEncoder().encode(canonicalJson(camera)));
}

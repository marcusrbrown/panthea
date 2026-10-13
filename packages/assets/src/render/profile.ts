// Model profiles (ADR-0012): render inputs, not game content. tools/render/profiles/<id>.json
// holds the kit file refs (kit id, relative path, sha256), body proportions, garment, himation,
// hair, the stamp set id, a clip map from semantic state to animation clip (with the frames the
// state is rendered at and plays back with), and a pose policy keyed by semantic state, never by
// an output clip name. One pose function in the render script serves
// every clip, sample variant and control, so a walk sampled at 8 or 16 frames is the same walk.
//
// Pure module: no filesystem. `load.ts` reads the files, and the profile's kit refs go to
// `checkKits` through `profileKitRefs`.

import {
  canonicalJson,
  fail,
  isRecord,
  ok,
  type ParseResult,
  parseArray,
  parseBoolean,
  parseFiniteNumber,
  parseNonNegativeInteger,
  parseSchemaVersion,
  parseSha256,
  parseString,
  type Sha256,
} from "@panthea/contracts";
import { sha256Hex } from "../hash";
import { parseVec2, parseVec3, type Vec2, type Vec3 } from "./camera";
import type { KitManifest, ProfileKitRefs } from "./kits";

const SUPPORTED_SCHEMA_VERSIONS = [1] as const;
const PROFILE_ID = /^[a-z0-9][a-z0-9-]*$/;
const SEMANTIC_STATE = /^[a-z][a-z0-9]*$/;

/** The material role of the base body; every profile defines it. */
export const BODY_ROLE = "skin";

export const FACINGS = ["south", "east", "north", "west"] as const;
export type Facing = (typeof FACINGS)[number];

export interface KitFileRef {
  readonly kit: string;
  /** POSIX path relative to the kit directory. */
  readonly path: string;
  readonly sha256: Sha256;
}

export interface KitPath {
  readonly kit: string;
  readonly path: string;
}

export interface HairPiece {
  readonly model: KitPath;
  /** Material role (a key of `materials`). */
  readonly role: string;
  /** Part-ID name (see `PART_IDS` in the script contract). */
  readonly part: string;
  /** Drop faces in front of y and below z (a hairline), in rest space metres. */
  readonly dropFrontBelow?: Vec2;
  /** Keep only faces at |x| >= x or y >= y (side locks). */
  readonly keepSidesBack?: Vec2;
  /** Smoothing passes over the piece's geometry; also smooths its shading into one mass. */
  readonly smooth?: number;
  /** Width scale at the top and at the bottom of the piece (a tapered mass). */
  readonly taper?: Vec2;
  /** Scale about the piece's top centre, before the taper: a longer beard from the same kit mesh. */
  readonly scale?: Vec3;
  /** Rest-space metres the piece is moved by after scaling (x left, y back, z up): clear of the chest. */
  readonly offset?: Vec3;
}

export interface Legs {
  /** Length scale of thigh and shin; their children keep their own size. */
  readonly length: number;
  /** Scale across the bone (width and depth) of thigh and shin. */
  readonly thickness: number;
}

export interface Body {
  /** Width, depth and height scale of the whole armature before the uniform fit. */
  readonly scale: Vec3;
  /** Standing height the model is fitted to at the shared world scale, px without the outline. */
  readonly standingHeightPx: number;
  readonly headScale: number;
  readonly handScale: number;
  readonly footScale: number;
  readonly armLength: number;
  readonly legs: Legs;
  /** Finger curl of a soft, open hand, degrees; 0 leaves the clip's fingers alone. */
  readonly curlDeg: number;
  /** Extra head pitch about the bone's X axis, degrees. */
  readonly headPitchDeg: number;
  /** Additive local euler offsets (degrees) of the bearing, applied to every state before its own policy. */
  readonly stance: Readonly<Record<string, Vec3>>;
}

export interface GarmentRing {
  readonly z: number;
  readonly halfWidth: number;
  readonly halfDepth: number;
  readonly centreY: number;
  readonly fold: number;
  /** 0 main material, 1 trim. */
  readonly material: 0 | 1;
}

export interface Garment {
  readonly name: string;
  readonly segments: number;
  readonly folds: number;
  /** Neck to hem. */
  readonly rings: readonly GarmentRing[];
  /** Trim faces with their centre between these heights are the belt part. */
  readonly belt: Vec2;
  /** Faces below this height are the skirt part, the rest the upper part. */
  readonly skirtBelow: number;
  /**
   * How much of the skirt below the hips follows the pelvis rather than the nearest leg, at the
   * hem (0 to 1). A low share lets a seated figure's thighs carry the skirt with them.
   */
  readonly pelvisShare: number;
  /** Material role for the main and trim materials. */
  readonly roles: readonly [string, string];
}

/** One cross-section of a draped strip: an arc of an ellipse about the torso axis, at a height. */
export interface HimationRow {
  readonly z: number;
  readonly halfWidth: number;
  readonly halfDepth: number;
  readonly centreY: number;
  /** Arc start and end, degrees: 0 is the character's left (+X), -90 the front, 90 the back. */
  readonly fromDeg: number;
  readonly toDeg: number;
  /** Radial fold depth as a share of the radius. */
  readonly fold: number;
}

/** Bone weights at a height; rows between two heights take the blend of the two. */
export interface HimationWeight {
  readonly z: number;
  readonly bones: Readonly<Record<string, number>>;
}

export interface HimationStrip {
  readonly name: string;
  /** Broad folds across the arc. */
  readonly folds: number;
  /** Top to bottom. */
  readonly rows: readonly HimationRow[];
  /** Top to bottom; the strip is skinned to these bones only, never to the nearest arm. */
  readonly weights: readonly HimationWeight[];
}

/**
 * An open draped mesh over the character's left shoulder: strips of partial rings, skinned to
 * the clavicle, spine and pelvis by height. Never mirrored, so the drape is the same in every
 * facing.
 */
export interface Himation {
  /** Material role (a key of `materials`). */
  readonly role: string;
  readonly strips: readonly HimationStrip[];
}

export interface MaterialRole {
  /** Palette ramp id. */
  readonly ramp: string;
  /** Added to the diffuse value so a material keeps its relative tone on its ramp. */
  readonly bias: number;
  /**
   * One ramp shade per camera band, replacing the camera's own. Hair and beard list fewer distinct
   * shades, so a small noisy surface reads as two or three tones; large surfaces keep the camera's.
   */
  readonly bandShades?: readonly number[];
}

export interface ClipSpec {
  /** Animation-library action. */
  readonly action: string;
  readonly loop: boolean;
  /** Frames the state is rendered at; the sheet, the manifest and the preview all play this many. */
  readonly frames: number;
  /** Whole milliseconds each frame is shown, `frames` entries: the manifest timing. */
  readonly frameMs: readonly number[];
}

export interface PoseEntry {
  /** Bone name to a direction in rig space (X toward the character's left, -Y forward, Z up). */
  readonly aims?: Readonly<Record<string, Vec3>>;
  /** Bone name to additive local euler degrees, applied after the clip pose. */
  readonly rotations?: Readonly<Record<string, Vec3>>;
}

export interface ModelProfile {
  readonly schemaVersion: 1;
  readonly id: string;
  /** Every kit file the render reads, `.bin` companions included. */
  readonly kitFiles: readonly KitFileRef[];
  readonly models: {
    readonly body: KitPath;
    readonly animations: KitPath;
    /** Action of the animation library that holds the rest (T) pose the figure is calibrated in. */
    readonly restAction: string;
    readonly hair: readonly HairPiece[];
  };
  readonly body: Body;
  readonly garment: Garment;
  readonly himation?: Himation;
  readonly materials: Readonly<Record<string, MaterialRole>>;
  /** Id of the stamp set (face stamps) the post step composites. */
  readonly stampSet: string;
  /**
   * The palette ramp the contact shadow is taken from (its shade 0, the darkest). It belongs to the
   * asset's own palette family, so a god's shadow is a colour the god's report already allows.
   */
  readonly shadow: { readonly ramp: string };
  /** Semantic state to clip. */
  readonly clips: Readonly<Record<string, ClipSpec>>;
  /** Pose policy keyed `state` or `state:facing`. */
  readonly pose: Readonly<Record<string, PoseEntry>>;
}

// --- Parsing -------------------------------------------------------------------

function strict(
  value: unknown,
  path: string,
  keys: readonly string[],
): ParseResult<Record<string, unknown>> {
  if (!isRecord(value)) return fail(path, "expected an object");
  for (const key of Object.keys(value)) {
    if (!keys.includes(key))
      return fail(`${path}.${key}`, `unknown key "${key}"`);
  }
  return ok(value);
}

function parsePositive(value: unknown, path: string): ParseResult<number> {
  const number = parseFiniteNumber(value, path);
  if (!number.ok) return number;
  if (number.value <= 0) return fail(path, "expected a positive number");
  return number;
}

function parseRelativePath(value: unknown, path: string): ParseResult<string> {
  const text = parseString(value, path);
  if (!text.ok) return text;
  const segments = text.value.split("/");
  if (
    text.value.includes("\\") ||
    segments.some((s) => s === "" || s === "." || s === "..")
  ) {
    return fail(
      path,
      "expected a relative POSIX path without empty, . or .. segments",
    );
  }
  return text;
}

function parseKitPath(value: unknown, path: string): ParseResult<KitPath> {
  const record = strict(value, path, ["kit", "path"]);
  if (!record.ok) return record;
  const kit = parseString(record.value.kit, `${path}.kit`);
  if (!kit.ok) return kit;
  const file = parseRelativePath(record.value.path, `${path}.path`);
  if (!file.ok) return file;
  return ok({ kit: kit.value, path: file.value });
}

function parseKitFileRef(
  value: unknown,
  path: string,
): ParseResult<KitFileRef> {
  const record = strict(value, path, ["kit", "path", "sha256"]);
  if (!record.ok) return record;
  const where = parseKitPath(
    { kit: record.value.kit, path: record.value.path },
    path,
  );
  if (!where.ok) return where;
  const sha = parseSha256(record.value.sha256, `${path}.sha256`);
  if (!sha.ok) return sha;
  return ok({ ...where.value, sha256: sha.value });
}

function parseHairPiece(value: unknown, path: string): ParseResult<HairPiece> {
  const record = strict(value, path, [
    "model",
    "role",
    "part",
    "dropFrontBelow",
    "keepSidesBack",
    "smooth",
    "taper",
    "scale",
    "offset",
  ]);
  if (!record.ok) return record;
  const model = parseKitPath(record.value.model, `${path}.model`);
  if (!model.ok) return model;
  const role = parseString(record.value.role, `${path}.role`);
  if (!role.ok) return role;
  const part = parseString(record.value.part, `${path}.part`);
  if (!part.ok) return part;
  let dropFrontBelow: Vec2 | undefined;
  if (record.value.dropFrontBelow !== undefined) {
    const parsed = parseVec2(
      record.value.dropFrontBelow,
      `${path}.dropFrontBelow`,
    );
    if (!parsed.ok) return parsed;
    dropFrontBelow = parsed.value;
  }
  let keepSidesBack: Vec2 | undefined;
  if (record.value.keepSidesBack !== undefined) {
    const parsed = parseVec2(
      record.value.keepSidesBack,
      `${path}.keepSidesBack`,
    );
    if (!parsed.ok) return parsed;
    keepSidesBack = parsed.value;
  }
  let smooth: number | undefined;
  if (record.value.smooth !== undefined) {
    const parsed = parseNonNegativeInteger(
      record.value.smooth,
      `${path}.smooth`,
    );
    if (!parsed.ok) return parsed;
    smooth = parsed.value;
  }
  let taper: Vec2 | undefined;
  if (record.value.taper !== undefined) {
    const parsed = parseVec2(record.value.taper, `${path}.taper`);
    if (!parsed.ok) return parsed;
    if (parsed.value.some((t) => t <= 0))
      return fail(`${path}.taper`, "expected positive width scales");
    taper = parsed.value;
  }
  let scale: Vec3 | undefined;
  if (record.value.scale !== undefined) {
    const parsed = parseVec3(record.value.scale, `${path}.scale`);
    if (!parsed.ok) return parsed;
    if (parsed.value.some((t) => t <= 0))
      return fail(`${path}.scale`, "expected positive scale factors");
    scale = parsed.value;
  }
  let offset: Vec3 | undefined;
  if (record.value.offset !== undefined) {
    const parsed = parseVec3(record.value.offset, `${path}.offset`);
    if (!parsed.ok) return parsed;
    offset = parsed.value;
  }
  return ok({
    model: model.value,
    role: role.value,
    part: part.value,
    ...(dropFrontBelow === undefined ? {} : { dropFrontBelow }),
    ...(keepSidesBack === undefined ? {} : { keepSidesBack }),
    ...(smooth === undefined ? {} : { smooth }),
    ...(taper === undefined ? {} : { taper }),
    ...(scale === undefined ? {} : { scale }),
    ...(offset === undefined ? {} : { offset }),
  });
}

function parseVec3Record(
  value: unknown,
  path: string,
): ParseResult<Readonly<Record<string, Vec3>>> {
  if (!isRecord(value)) return fail(path, "expected an object of bone names");
  const out: Record<string, Vec3> = {};
  for (const [bone, vector] of Object.entries(value)) {
    if (bone === "") return fail(path, "expected non-empty bone names");
    const parsed = parseVec3(vector, `${path}.${bone}`);
    if (!parsed.ok) return parsed;
    out[bone] = parsed.value;
  }
  return ok(out);
}

function parseLegs(value: unknown, path: string): ParseResult<Legs> {
  const record = strict(value, path, ["length", "thickness"]);
  if (!record.ok) return record;
  const length = parsePositive(record.value.length, `${path}.length`);
  if (!length.ok) return length;
  const thickness = parsePositive(record.value.thickness, `${path}.thickness`);
  if (!thickness.ok) return thickness;
  return ok({ length: length.value, thickness: thickness.value });
}

function parseBody(value: unknown, path: string): ParseResult<Body> {
  const record = strict(value, path, [
    "scale",
    "standingHeightPx",
    "headScale",
    "handScale",
    "footScale",
    "armLength",
    "legs",
    "curlDeg",
    "headPitchDeg",
    "stance",
  ]);
  if (!record.ok) return record;
  const scale = parseVec3(record.value.scale, `${path}.scale`);
  if (!scale.ok) return scale;
  if (scale.value.some((s) => s <= 0)) {
    return fail(`${path}.scale`, "expected positive scale factors");
  }
  const numbers: Record<string, number> = {};
  for (const key of [
    "standingHeightPx",
    "headScale",
    "handScale",
    "footScale",
    "armLength",
  ] as const) {
    const parsed = parsePositive(record.value[key], `${path}.${key}`);
    if (!parsed.ok) return parsed;
    numbers[key] = parsed.value;
  }
  const legs = parseLegs(record.value.legs, `${path}.legs`);
  if (!legs.ok) return legs;
  const curl = parseFiniteNumber(record.value.curlDeg, `${path}.curlDeg`);
  if (!curl.ok) return curl;
  if (curl.value < 0 || curl.value > 90) {
    return fail(`${path}.curlDeg`, "expected a curl between 0 and 90 degrees");
  }
  const pitch = parseFiniteNumber(
    record.value.headPitchDeg,
    `${path}.headPitchDeg`,
  );
  if (!pitch.ok) return pitch;
  const stance = parseVec3Record(record.value.stance, `${path}.stance`);
  if (!stance.ok) return stance;
  return ok({
    scale: scale.value,
    standingHeightPx: numbers.standingHeightPx as number,
    headScale: numbers.headScale as number,
    handScale: numbers.handScale as number,
    footScale: numbers.footScale as number,
    armLength: numbers.armLength as number,
    legs: legs.value,
    curlDeg: curl.value,
    headPitchDeg: pitch.value,
    stance: stance.value,
  });
}

function parseRing(value: unknown, path: string): ParseResult<GarmentRing> {
  const record = strict(value, path, [
    "z",
    "halfWidth",
    "halfDepth",
    "centreY",
    "fold",
    "material",
  ]);
  if (!record.ok) return record;
  const z = parseFiniteNumber(record.value.z, `${path}.z`);
  if (!z.ok) return z;
  const halfWidth = parsePositive(record.value.halfWidth, `${path}.halfWidth`);
  if (!halfWidth.ok) return halfWidth;
  const halfDepth = parsePositive(record.value.halfDepth, `${path}.halfDepth`);
  if (!halfDepth.ok) return halfDepth;
  const centreY = parseFiniteNumber(record.value.centreY, `${path}.centreY`);
  if (!centreY.ok) return centreY;
  const fold = parseFiniteNumber(record.value.fold, `${path}.fold`);
  if (!fold.ok) return fold;
  if (record.value.material !== 0 && record.value.material !== 1) {
    return fail(`${path}.material`, "expected 0 (main) or 1 (trim)");
  }
  return ok({
    z: z.value,
    halfWidth: halfWidth.value,
    halfDepth: halfDepth.value,
    centreY: centreY.value,
    fold: fold.value,
    material: record.value.material,
  });
}

function parseGarment(value: unknown, path: string): ParseResult<Garment> {
  const record = strict(value, path, [
    "name",
    "segments",
    "folds",
    "rings",
    "belt",
    "skirtBelow",
    "pelvisShare",
    "roles",
  ]);
  if (!record.ok) return record;
  const name = parseString(record.value.name, `${path}.name`);
  if (!name.ok) return name;
  const segments = parseNonNegativeInteger(
    record.value.segments,
    `${path}.segments`,
  );
  if (!segments.ok) return segments;
  if (segments.value < 3)
    return fail(`${path}.segments`, "expected at least 3 segments");
  const folds = parseNonNegativeInteger(record.value.folds, `${path}.folds`);
  if (!folds.ok) return folds;
  const rings = parseArray(record.value.rings, `${path}.rings`, parseRing);
  if (!rings.ok) return rings;
  if (rings.value.length < 2)
    return fail(`${path}.rings`, "expected at least two rings");
  for (let i = 1; i < rings.value.length; i += 1) {
    if (
      (rings.value[i] as GarmentRing).z >= (rings.value[i - 1] as GarmentRing).z
    ) {
      return fail(`${path}.rings`, "expected rings listed top to bottom");
    }
  }
  const belt = parseVec2(record.value.belt, `${path}.belt`);
  if (!belt.ok) return belt;
  const skirtBelow = parseFiniteNumber(
    record.value.skirtBelow,
    `${path}.skirtBelow`,
  );
  if (!skirtBelow.ok) return skirtBelow;
  const pelvisShare = parseFiniteNumber(
    record.value.pelvisShare,
    `${path}.pelvisShare`,
  );
  if (!pelvisShare.ok) return pelvisShare;
  if (pelvisShare.value < 0 || pelvisShare.value > 1)
    return fail(`${path}.pelvisShare`, "expected a share between 0 and 1");
  const roles = parseArray(record.value.roles, `${path}.roles`, parseString);
  if (!roles.ok) return roles;
  if (roles.value.length !== 2)
    return fail(`${path}.roles`, "expected a main and a trim role");
  return ok({
    name: name.value,
    segments: segments.value,
    folds: folds.value,
    rings: rings.value,
    belt: belt.value,
    skirtBelow: skirtBelow.value,
    pelvisShare: pelvisShare.value,
    roles: [roles.value[0] as string, roles.value[1] as string],
  });
}

function parseHimationRow(
  value: unknown,
  path: string,
): ParseResult<HimationRow> {
  const record = strict(value, path, [
    "z",
    "halfWidth",
    "halfDepth",
    "centreY",
    "fromDeg",
    "toDeg",
    "fold",
  ]);
  if (!record.ok) return record;
  const z = parseFiniteNumber(record.value.z, `${path}.z`);
  if (!z.ok) return z;
  const halfWidth = parsePositive(record.value.halfWidth, `${path}.halfWidth`);
  if (!halfWidth.ok) return halfWidth;
  const halfDepth = parsePositive(record.value.halfDepth, `${path}.halfDepth`);
  if (!halfDepth.ok) return halfDepth;
  const centreY = parseFiniteNumber(record.value.centreY, `${path}.centreY`);
  if (!centreY.ok) return centreY;
  const fromDeg = parseFiniteNumber(record.value.fromDeg, `${path}.fromDeg`);
  if (!fromDeg.ok) return fromDeg;
  const toDeg = parseFiniteNumber(record.value.toDeg, `${path}.toDeg`);
  if (!toDeg.ok) return toDeg;
  if (toDeg.value <= fromDeg.value || toDeg.value - fromDeg.value > 360) {
    return fail(
      `${path}.toDeg`,
      "expected an arc of more than 0 and at most 360 degrees",
    );
  }
  const fold = parseFiniteNumber(record.value.fold, `${path}.fold`);
  if (!fold.ok) return fold;
  return ok({
    z: z.value,
    halfWidth: halfWidth.value,
    halfDepth: halfDepth.value,
    centreY: centreY.value,
    fromDeg: fromDeg.value,
    toDeg: toDeg.value,
    fold: fold.value,
  });
}

function parseHimationWeight(
  value: unknown,
  path: string,
): ParseResult<HimationWeight> {
  const record = strict(value, path, ["z", "bones"]);
  if (!record.ok) return record;
  const z = parseFiniteNumber(record.value.z, `${path}.z`);
  if (!z.ok) return z;
  if (
    !isRecord(record.value.bones) ||
    Object.keys(record.value.bones).length === 0
  ) {
    return fail(`${path}.bones`, "expected an object of bone weights");
  }
  const bones: Record<string, number> = {};
  for (const [bone, weight] of Object.entries(record.value.bones)) {
    const parsed = parsePositive(weight, `${path}.bones.${bone}`);
    if (!parsed.ok) return parsed;
    bones[bone] = parsed.value;
  }
  return ok({ z: z.value, bones });
}

const descending = (values: readonly number[]): boolean =>
  values.every((v, i) => i === 0 || v < (values[i - 1] as number));

function parseHimationStrip(
  value: unknown,
  path: string,
): ParseResult<HimationStrip> {
  const record = strict(value, path, ["name", "folds", "rows", "weights"]);
  if (!record.ok) return record;
  const name = parseString(record.value.name, `${path}.name`);
  if (!name.ok) return name;
  const folds = parseNonNegativeInteger(record.value.folds, `${path}.folds`);
  if (!folds.ok) return folds;
  const rows = parseArray(record.value.rows, `${path}.rows`, parseHimationRow);
  if (!rows.ok) return rows;
  if (rows.value.length < 2)
    return fail(`${path}.rows`, "expected at least two rows");
  if (!descending(rows.value.map((r) => r.z)))
    return fail(`${path}.rows`, "expected rows listed top to bottom");
  const weights = parseArray(
    record.value.weights,
    `${path}.weights`,
    parseHimationWeight,
  );
  if (!weights.ok) return weights;
  if (weights.value.length < 1)
    return fail(`${path}.weights`, "expected at least one weight entry");
  if (!descending(weights.value.map((w) => w.z)))
    return fail(`${path}.weights`, "expected weights listed top to bottom");
  return ok({
    name: name.value,
    folds: folds.value,
    rows: rows.value,
    weights: weights.value,
  });
}

function parseHimation(value: unknown, path: string): ParseResult<Himation> {
  const record = strict(value, path, ["role", "strips"]);
  if (!record.ok) return record;
  const role = parseString(record.value.role, `${path}.role`);
  if (!role.ok) return role;
  const strips = parseArray(
    record.value.strips,
    `${path}.strips`,
    parseHimationStrip,
  );
  if (!strips.ok) return strips;
  if (strips.value.length < 1)
    return fail(`${path}.strips`, "expected at least one strip");
  const names = strips.value.map((strip) => strip.name);
  if (new Set(names).size !== names.length)
    return fail(`${path}.strips`, "expected unique strip names");
  return ok({ role: role.value, strips: strips.value });
}

function parseMaterials(
  value: unknown,
  path: string,
): ParseResult<Readonly<Record<string, MaterialRole>>> {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    return fail(path, "expected an object of material roles");
  }
  const out: Record<string, MaterialRole> = {};
  for (const [role, entry] of Object.entries(value)) {
    const record = strict(entry, `${path}.${role}`, [
      "ramp",
      "bias",
      "bandShades",
    ]);
    if (!record.ok) return record;
    const ramp = parseString(record.value.ramp, `${path}.${role}.ramp`);
    if (!ramp.ok) return ramp;
    const bias = parseFiniteNumber(record.value.bias, `${path}.${role}.bias`);
    if (!bias.ok) return bias;
    let bandShades: readonly number[] | undefined;
    if (record.value.bandShades !== undefined) {
      const parsed = parseArray(
        record.value.bandShades,
        `${path}.${role}.bandShades`,
        parseNonNegativeInteger,
      );
      if (!parsed.ok) return parsed;
      if (parsed.value.length === 0)
        return fail(
          `${path}.${role}.bandShades`,
          "expected one shade per band",
        );
      bandShades = parsed.value;
    }
    out[role] = {
      ramp: ramp.value,
      bias: bias.value,
      ...(bandShades === undefined ? {} : { bandShades }),
    };
  }
  return ok(out);
}

/** `frameMs` is one whole number of ms for every frame, or one per frame; stored as one per frame. */
function parseFrameMs(
  value: unknown,
  frames: number,
  path: string,
): ParseResult<readonly number[]> {
  const whole = (item: unknown, itemPath: string): ParseResult<number> => {
    const parsed = parseNonNegativeInteger(item, itemPath);
    if (!parsed.ok) return parsed;
    if (parsed.value < 1) return fail(itemPath, "expected at least 1 ms");
    return parsed;
  };
  if (Array.isArray(value)) {
    const list = parseArray(value, path, whole);
    if (!list.ok) return list;
    if (list.value.length !== frames) {
      return fail(
        path,
        `lists ${list.value.length} durations for ${frames} frames`,
      );
    }
    return list;
  }
  const one = whole(value, path);
  if (!one.ok) return one;
  return ok(Array.from({ length: frames }, () => one.value));
}

function parseClips(
  value: unknown,
  path: string,
): ParseResult<Readonly<Record<string, ClipSpec>>> {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    return fail(path, "expected a clip map from semantic state to clip");
  }
  const out: Record<string, ClipSpec> = {};
  for (const [state, entry] of Object.entries(value)) {
    if (!SEMANTIC_STATE.test(state)) {
      return fail(`${path}.${state}`, "expected a semantic state name");
    }
    const record = strict(entry, `${path}.${state}`, [
      "action",
      "loop",
      "frames",
      "frameMs",
    ]);
    if (!record.ok) return record;
    const action = parseString(record.value.action, `${path}.${state}.action`);
    if (!action.ok) return action;
    const loop = parseBoolean(record.value.loop, `${path}.${state}.loop`);
    if (!loop.ok) return loop;
    const frames = parseNonNegativeInteger(
      record.value.frames,
      `${path}.${state}.frames`,
    );
    if (!frames.ok) return frames;
    if (frames.value < 1) {
      return fail(`${path}.${state}.frames`, "expected at least one frame");
    }
    const frameMs = parseFrameMs(
      record.value.frameMs,
      frames.value,
      `${path}.${state}.frameMs`,
    );
    if (!frameMs.ok) return frameMs;
    out[state] = {
      action: action.value,
      loop: loop.value,
      frames: frames.value,
      frameMs: frameMs.value,
    };
  }
  return ok(out);
}

function parsePoseEntry(value: unknown, path: string): ParseResult<PoseEntry> {
  const record = strict(value, path, ["aims", "rotations"]);
  if (!record.ok) return record;
  let aims: PoseEntry["aims"];
  if (record.value.aims !== undefined) {
    const parsed = parseVec3Record(record.value.aims, `${path}.aims`);
    if (!parsed.ok) return parsed;
    for (const [bone, vector] of Object.entries(parsed.value)) {
      if (vector.every((c) => c === 0)) {
        return fail(`${path}.aims.${bone}`, "expected a non-zero direction");
      }
    }
    aims = parsed.value;
  }
  let rotations: PoseEntry["rotations"];
  if (record.value.rotations !== undefined) {
    const parsed = parseVec3Record(record.value.rotations, `${path}.rotations`);
    if (!parsed.ok) return parsed;
    rotations = parsed.value;
  }
  return ok({
    ...(aims === undefined ? {} : { aims }),
    ...(rotations === undefined ? {} : { rotations }),
  });
}

/** A pose key is `state` or `state:facing`, over a state the clip map has. */
function parsePose(
  value: unknown,
  path: string,
  states: ReadonlySet<string>,
): ParseResult<Readonly<Record<string, PoseEntry>>> {
  if (!isRecord(value)) return fail(path, "expected a pose policy object");
  const out: Record<string, PoseEntry> = {};
  for (const [key, entry] of Object.entries(value)) {
    const [state, facing, ...rest] = key.split(":");
    if (state === undefined || !states.has(state)) {
      return fail(
        `${path}.${key}`,
        `expected a pose keyed by a semantic state of the clip map (${[...states].join(", ")}), never by an output clip name`,
      );
    }
    if (
      facing !== undefined &&
      !(FACINGS as readonly string[]).includes(facing)
    ) {
      return fail(`${path}.${key}`, `unknown facing "${facing}"`);
    }
    if (rest.length > 0) {
      return fail(`${path}.${key}`, "expected state or state:facing");
    }
    const parsed = parsePoseEntry(entry, `${path}.${key}`);
    if (!parsed.ok) return parsed;
    out[key] = parsed.value;
  }
  return ok(out);
}

export function parseProfile(
  value: unknown,
  path = "profile",
): ParseResult<ModelProfile> {
  const record = strict(value, path, [
    "schemaVersion",
    "id",
    "kitFiles",
    "models",
    "body",
    "garment",
    "himation",
    "materials",
    "stampSet",
    "shadow",
    "clips",
    "pose",
  ]);
  if (!record.ok) return record;
  const version = parseSchemaVersion(
    record.value.schemaVersion,
    SUPPORTED_SCHEMA_VERSIONS,
    `${path}.schemaVersion`,
  );
  if (!version.ok) return version;
  const id = parseString(record.value.id, `${path}.id`);
  if (!id.ok) return id;
  if (!PROFILE_ID.test(id.value)) {
    return fail(`${path}.id`, "expected a lowercase, hyphenated profile id");
  }
  const kitFiles = parseArray(
    record.value.kitFiles,
    `${path}.kitFiles`,
    parseKitFileRef,
  );
  if (!kitFiles.ok) return kitFiles;
  const listed = new Set<string>();
  for (const [index, ref] of kitFiles.value.entries()) {
    const name = `${ref.kit}/${ref.path}`;
    if (listed.has(name))
      return fail(`${path}.kitFiles[${index}]`, `duplicate kit file "${name}"`);
    listed.add(name);
  }
  if (kitFiles.value.length === 0)
    return fail(`${path}.kitFiles`, "expected at least one kit file");

  const models = strict(record.value.models, `${path}.models`, [
    "body",
    "animations",
    "restAction",
    "hair",
  ]);
  if (!models.ok) return models;
  const body = parseKitPath(models.value.body, `${path}.models.body`);
  if (!body.ok) return body;
  const animations = parseKitPath(
    models.value.animations,
    `${path}.models.animations`,
  );
  if (!animations.ok) return animations;
  const restAction = parseString(
    models.value.restAction,
    `${path}.models.restAction`,
  );
  if (!restAction.ok) return restAction;
  const hair = parseArray(
    models.value.hair,
    `${path}.models.hair`,
    parseHairPiece,
  );
  if (!hair.ok) return hair;
  const used: [string, KitPath][] = [
    [`${path}.models.body`, body.value],
    [`${path}.models.animations`, animations.value],
    ...hair.value.map((h, i): [string, KitPath] => [
      `${path}.models.hair[${i}].model`,
      h.model,
    ]),
  ];
  for (const [where, model] of used) {
    if (!listed.has(`${model.kit}/${model.path}`)) {
      return fail(where, `"${model.kit}/${model.path}" is not among kitFiles`);
    }
  }

  const bodyShape = parseBody(record.value.body, `${path}.body`);
  if (!bodyShape.ok) return bodyShape;
  const garment = parseGarment(record.value.garment, `${path}.garment`);
  if (!garment.ok) return garment;
  let himation: Himation | undefined;
  if (record.value.himation !== undefined) {
    const parsed = parseHimation(record.value.himation, `${path}.himation`);
    if (!parsed.ok) return parsed;
    himation = parsed.value;
  }
  const materials = parseMaterials(record.value.materials, `${path}.materials`);
  if (!materials.ok) return materials;
  const roleNames = [
    BODY_ROLE,
    ...garment.value.roles,
    ...hair.value.map((h) => h.role),
    ...(himation === undefined ? [] : [himation.role]),
  ];
  for (const role of roleNames) {
    if (materials.value[role] === undefined) {
      return fail(
        `${path}.materials`,
        `role "${role}" is used but has no material`,
      );
    }
  }
  const stampSet = parseString(record.value.stampSet, `${path}.stampSet`);
  if (!stampSet.ok) return stampSet;
  const shadowRecord = strict(record.value.shadow, `${path}.shadow`, ["ramp"]);
  if (!shadowRecord.ok) return shadowRecord;
  const shadowRamp = parseString(
    shadowRecord.value.ramp,
    `${path}.shadow.ramp`,
  );
  if (!shadowRamp.ok) return shadowRamp;
  if (shadowRamp.value === "")
    return fail(`${path}.shadow.ramp`, "expected a palette ramp id");
  const clips = parseClips(record.value.clips, `${path}.clips`);
  if (!clips.ok) return clips;
  const pose = parsePose(
    record.value.pose,
    `${path}.pose`,
    new Set(Object.keys(clips.value)),
  );
  if (!pose.ok) return pose;

  return ok({
    schemaVersion: 1,
    id: id.value,
    kitFiles: kitFiles.value,
    models: {
      body: body.value,
      animations: animations.value,
      restAction: restAction.value,
      hair: hair.value,
    },
    body: bodyShape.value,
    garment: garment.value,
    ...(himation === undefined ? {} : { himation }),
    materials: materials.value,
    stampSet: stampSet.value,
    shadow: { ramp: shadowRamp.value },
    clips: clips.value,
    pose: pose.value,
  });
}

// --- Kit refs, hash, pose policy, sample times ---------------------------------------

/** The files a profile references, in the shape the kit gate (`checkKits`) takes. */
export function profileKitRefs(profile: ModelProfile): ProfileKitRefs {
  return {
    profile: profile.id,
    files: profile.kitFiles.map(({ kit, path }) => ({ kit, path })),
  };
}

/** Each kit ref resolves to an entry of kits.json with the same sha256. Never throws. */
export function profileKitProblems(
  profile: ModelProfile,
  manifest: KitManifest,
): string[] {
  const problems: string[] = [];
  const kits = new Map(manifest.kits.map((k) => [k.id, k]));
  for (const ref of profile.kitFiles) {
    const name = `${ref.kit}/${ref.path}`;
    const kit = kits.get(ref.kit);
    if (kit === undefined) {
      problems.push(
        `profile "${profile.id}" references ${name}, but kit "${ref.kit}" is not in kits.json`,
      );
      continue;
    }
    const entry = kit.files.find((f) => f.path === ref.path);
    if (entry === undefined) {
      problems.push(
        `profile "${profile.id}" references ${name}, which kits.json does not list`,
      );
    } else if (entry.sha256 !== ref.sha256) {
      problems.push(
        `profile "${profile.id}" pins ${name} at sha256 ${ref.sha256}, but kits.json has ${entry.sha256}`,
      );
    }
  }
  return problems;
}

/** sha256 of the canonical JSON of the parsed profile: part of the revision recipe hash. */
export function profileHash(profile: ModelProfile): Sha256 {
  return sha256Hex(new TextEncoder().encode(canonicalJson(profile)));
}

export interface PoseRequest {
  /** A semantic state of the profile's clip map. An output clip name is refused. */
  readonly state: string;
  readonly facing: Facing;
  /** Frames the clip is sampled at. Accepted so a variant can be passed whole; never read. */
  readonly frames?: number;
}

/**
 * The pose policy for a state and facing: the state's entry, refined by its facing entry. Bones
 * merge one by one, later entries replacing earlier ones.
 * `frames` never takes part, so a walk at 8 frames and at 16 frames poses identically.
 */
export function posePolicy(
  profile: ModelProfile,
  request: PoseRequest,
): PoseEntry {
  if (profile.clips[request.state] === undefined) {
    throw new Error(
      `"${request.state}" is not a semantic state of profile "${profile.id}" (${Object.keys(profile.clips).join(", ")}); pose policy is keyed by state, not by output clip name`,
    );
  }
  const keys = [request.state, `${request.state}:${request.facing}`];
  let aims: Record<string, Vec3> | undefined;
  let rotations: Record<string, Vec3> | undefined;
  for (const key of keys) {
    const entry = profile.pose[key];
    if (entry === undefined) continue;
    if (entry.aims !== undefined) aims = { ...aims, ...entry.aims };
    if (entry.rotations !== undefined)
      rotations = { ...rotations, ...entry.rotations };
  }
  return {
    ...(aims === undefined ? {} : { aims }),
    ...(rotations === undefined ? {} : { rotations }),
  };
}

/**
 * Source frames to render from an action spanning [start, end]. A loop excludes the duplicate
 * endpoint; a one-shot includes both ends. The same arithmetic as `sample_frames` in render.py,
 * so the 8-frame walk's times are exactly every second time of the 16-frame walk.
 */
export function sourceFrameTimes(
  start: number,
  end: number,
  count: number,
  loop: boolean,
): number[] {
  if (!Number.isInteger(count) || count < 1)
    throw new Error("count must be a positive integer");
  if (end < start) throw new Error("end before start");
  if (count === 1) return [start];
  const span = end - start;
  const divisor = loop ? count : count - 1;
  return Array.from({ length: count }, (_, i) => start + (span * i) / divisor);
}

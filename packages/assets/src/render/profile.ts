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
  parsePositiveInteger,
  parseSchemaVersion,
  parseSha256,
  parseString,
  type Sha256,
} from "@panthea/contracts";
import { sha256Hex } from "../hash";
import {
  type CameraCell,
  parseCell,
  parseVec2,
  parseVec3,
  type Vec2,
  type Vec3,
} from "./camera";
import { groundCrop } from "./ground";
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
  /** A garment of its own for the seated state: the standing garment's torso, then a lap and shin drapes. */
  readonly seated?: SeatedGarment;
}

/**
 * One cross-section of a seated leg drape, mirrored for the other leg: an ellipse about the leg's
 * own axis in rest space, skinned to the thigh and shin bones (`thigh`, `calf`, `pelvis`; a side
 * suffix is added for the leg's side).
 */
export interface SeatedLegRow {
  readonly z: number;
  readonly halfWidth: number;
  readonly halfDepth: number;
  /** Offset of the leg's axis from the centre line (the left leg's; the right leg mirrors it). */
  readonly centreX: number;
  readonly centreY: number;
  readonly fold: number;
  /** 0 main material, 1 trim. */
  readonly material: 0 | 1;
  readonly weights: Readonly<Record<string, number>>;
}

export interface SeatedGarment {
  /** How many of the standing garment's rings, from the neck, the seated garment keeps as its torso. */
  readonly keepRings: number;
  /** Top to bottom: a lap panel over the thigh, a knee transition, a shin drape and the hem. */
  readonly legs: readonly SeatedLegRow[];
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

/** A broad crease across a strip: a groove along the strip's height, kept as a crisp facet. */
export interface HimationCrease {
  /** Where across the arc, 0 to 1. */
  readonly at: number;
  /** Share of the arc the groove covers, 0 to 1. */
  readonly width: number;
  /** Depth of the groove in rest space metres. */
  readonly depth: number;
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
  /** Broad creases kept as crisp facets; the rest of the strip shades smooth. */
  readonly creases?: readonly HimationCrease[];
  /** Points across the arc, replacing the mesh's default: a few make broad wedges, many make a smooth surface. */
  readonly columns?: number;
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
  /** How the mantle drapes when the figure sits: a second mesh from the same strips (the himation only). */
  readonly seated?: SeatedMantle;
}

/**
 * The seated variant of a mantle: its rows end at `hemZ` in a flared lip where the cloth meets the
 * seat, and the rows below the hips narrow, so the chiton shows at the sides.
 */
export interface SeatedMantle {
  /** Height the mantle's rows end at, rest space metres. */
  readonly hemZ: number;
  /** Width and depth scale of the lip below the hem (more than 1). */
  readonly flare: number;
  /** Width and depth scale reached at the hem by the rows below z 1.0 (at most 1). */
  readonly narrow: number;
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
  /**
   * Bone name to a factor between 0 and 1: the bone's rotation is scaled about its mean pose over
   * the clip (a tempered gait), after the clip pose.
   */
  readonly damp?: Readonly<Record<string, number>>;
  /** Bone name to a factor between 0 and 1: the bone's location is scaled about its mean over the clip. */
  readonly dampLocation?: Readonly<Record<string, number>>;
  /**
   * Each frame, move the figure vertically so its lowest sole stands on the ground plane: a tempered
   * gait keeps one foot planted, whatever the clip's own pelvis height does.
   */
  readonly groundFeet?: boolean;
  /**
   * Bone name to the peak additive local location (metres, in the bone's own frame: Y runs along
   * the bone) of a breath: applied through the loop with weight (1 - cos 2 pi t) / 2 on the clip's
   * own phase, so the loop's seam is clean. A lift of the upper spine raises the chest, the arms
   * and the head together while the pelvis and the legs stay where they are.
   */
  readonly breath?: Readonly<Record<string, Vec3>>;
}

/** A rigged character. An absent `kind` is a figure, so a figure's JSON and its hash stay as they were. */
export interface FigureProfile {
  readonly schemaVersion: 1;
  readonly kind?: undefined;
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
  /** A beard built for the purpose, skinned to the head: strips of arcs about the face. */
  readonly beard?: Himation;
  /** Hair built for the purpose, skinned to the head: a crown ring with volume, and the long hair below it. */
  readonly hair?: Himation;
  /** A thin band across the crown, skinned to the head. */
  readonly fillet?: Himation;
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

/** What a mark on a house is: where it sits and which material draws it. */
export interface StructureDecal {
  /** The surface it is laid on: the wall facing the viewer, the wall facing right, or the front roof slope. */
  readonly wall: "front" | "side" | "roof";
  /**
   * Centre of the mark, metres. On a wall: along it from its left edge (the front's left, the side's
   * nearest the viewer), and up from the ground. On the roof: along the ridge from the roof's left
   * end, and up the slope from the eave.
   */
  readonly at: Vec2;
  /** Width and height of the mark, metres. */
  readonly size: Vec2;
  /** A key of the profile's `materials`. */
  readonly material: string;
  /** Degrees the mark is turned in its own plane; absent is square to the surface's axes. */
  readonly angle?: number;
}

/** One state of a structure: how many frames, and what it looks like. */
export interface StructureClip {
  /** A looping state sways in the wind; a still one is rendered once at rest. */
  readonly loop: boolean;
  readonly frames: number;
  /** Whole milliseconds each frame is shown, `frames` entries: the manifest timing. */
  readonly frameMs: readonly number[];
  /** The model's material role to the profile material this state draws it in. A role left out keeps its own. */
  readonly materials: Readonly<Record<string, string>>;
  /** Marks laid on a house's walls; they leave its silhouette alone. */
  readonly decals: readonly StructureDecal[];
  /** The model with its walls and roof broken (a house) or burnt down to a stump (a tree). */
  readonly ruin: boolean;
  /** The fraction of a tree's leaf clusters this state keeps, 0 to 1. */
  readonly leaves?: number;
}

export interface Wind {
  /** Peak sway of the crown, metres. */
  readonly amplitudeM: number;
  /** Phase lag up the height, radians per unit of relative height: the crown trails the trunk. */
  readonly lag: number;
  /** Whole sways per loop, so the last frame flows into the first. */
  readonly cycles: number;
  /** Quadrature share on the second axis: the crown traces a small ellipse rather than a line. */
  readonly swirl: number;
}

/** How a ground set is laid out. Lengths are metres or fractions of a tile side, as each key says. */
export interface GroundBuild {
  readonly kind: "ground";
  /** N: the field repeats every N lattice steps along each axis. */
  readonly period: number;
  /** Flagstone slabs: four to a lattice cell, split at jittered lines and inset by the gap. */
  readonly slab: {
    /** Relief of the slabs above the mortar plane; 0 lays none, which leaves the terrain a flat colour. */
    readonly heightM: number;
    /** Fraction of a tile side left bare between neighbouring slabs. */
    readonly gap: number;
    /** Fraction of a tile side a split line may move off the middle. */
    readonly jitter: number;
  };
  /** Grass tufts: low pyramids at hashed positions in each lattice cell. */
  readonly tuft: {
    readonly perTile: number;
    readonly heightM: number;
    readonly radiusM: number;
  };
  /** What the stamper (not the render) reads to cut the masks from the patches. */
  readonly stamp: {
    readonly noiseSeed: number;
    /** Wavelength of the blend-field noise, in tiles. */
    readonly wavelengthTiles: number;
    /** Peak of the noise added to the 0..1 blend field. */
    readonly amplitude: number;
    /** Width, in pixels, of the darkest-shade band on the flagstone side of a boundary. */
    readonly edgeBandPx: number;
    /** Grass overhangs placed on the boundary of a period. */
    readonly overhangs: number;
  };
}

export type StructureBuild =
  /**
   * A Greek town house built from script geometry, with kit models for the parts it names
   * (a role such as `column` or `rubble` to the model that draws it).
   */
  | {
      readonly kind: "house";
      readonly parts?: Readonly<Record<string, KitPath>>;
    }
  /** A kit model, scaled to a height. */
  | {
      readonly kind: "tree";
      readonly model: KitPath;
      readonly heightM: number;
    }
  /** One terrain of a dual-grid set, script-built and periodic. */
  | GroundBuild;

/**
 * A tree or a building. It owns its frame (the cell class it is drawn on and where the world
 * origin lands in it), so a structure need not share the one camera's cell with the figures.
 */
export interface StructureProfile {
  readonly schemaVersion: 1;
  readonly kind: "structure";
  readonly id: string;
  /** Every kit file the render reads; none for a house. */
  readonly kitFiles: readonly KitFileRef[];
  readonly build: StructureBuild;
  /** The frame: the cell class, its size, and the pixel the world origin projects to. */
  readonly cell: CameraCell;
  readonly materials: Readonly<Record<string, MaterialRole>>;
  readonly clips: Readonly<Record<string, StructureClip>>;
  readonly wind?: Wind;
  /** `false`: the post step draws no outline. Present, and only, on a ground profile. */
  readonly outline?: false;
}

export type ModelProfile = FigureProfile | StructureProfile;

export const isStructureProfile = (
  profile: ModelProfile,
): profile is StructureProfile => profile.kind === "structure";

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

const descending = (values: readonly number[]): boolean =>
  values.every((v, i) => i === 0 || v < (values[i - 1] as number));

/** Bones a seated leg row is skinned to: `thigh` and `calf` take the leg's side suffix. */
const SEATED_BONES: readonly string[] = ["thigh", "calf", "pelvis"];

function parseSeatedLegRow(
  value: unknown,
  path: string,
): ParseResult<SeatedLegRow> {
  const record = strict(value, path, [
    "z",
    "halfWidth",
    "halfDepth",
    "centreX",
    "centreY",
    "fold",
    "material",
    "weights",
  ]);
  if (!record.ok) return record;
  const z = parseFiniteNumber(record.value.z, `${path}.z`);
  if (!z.ok) return z;
  const halfWidth = parsePositive(record.value.halfWidth, `${path}.halfWidth`);
  if (!halfWidth.ok) return halfWidth;
  const halfDepth = parsePositive(record.value.halfDepth, `${path}.halfDepth`);
  if (!halfDepth.ok) return halfDepth;
  const centreX = parseFiniteNumber(record.value.centreX, `${path}.centreX`);
  if (!centreX.ok) return centreX;
  const centreY = parseFiniteNumber(record.value.centreY, `${path}.centreY`);
  if (!centreY.ok) return centreY;
  const fold = parseFiniteNumber(record.value.fold, `${path}.fold`);
  if (!fold.ok) return fold;
  if (record.value.material !== 0 && record.value.material !== 1) {
    return fail(`${path}.material`, "expected 0 (main) or 1 (trim)");
  }
  if (
    !isRecord(record.value.weights) ||
    Object.keys(record.value.weights).length === 0
  ) {
    return fail(`${path}.weights`, "expected an object of bone weights");
  }
  const weights: Record<string, number> = {};
  for (const [bone, weight] of Object.entries(record.value.weights)) {
    if (!SEATED_BONES.includes(bone)) {
      return fail(
        `${path}.weights.${bone}`,
        `expected one of ${SEATED_BONES.join(", ")}`,
      );
    }
    const parsed = parsePositive(weight, `${path}.weights.${bone}`);
    if (!parsed.ok) return parsed;
    weights[bone] = parsed.value;
  }
  return ok({
    z: z.value,
    halfWidth: halfWidth.value,
    halfDepth: halfDepth.value,
    centreX: centreX.value,
    centreY: centreY.value,
    fold: fold.value,
    material: record.value.material,
    weights,
  });
}

function parseSeatedGarment(
  value: unknown,
  path: string,
  ringCount: number,
): ParseResult<SeatedGarment> {
  const record = strict(value, path, ["keepRings", "legs"]);
  if (!record.ok) return record;
  const keepRings = parseNonNegativeInteger(
    record.value.keepRings,
    `${path}.keepRings`,
  );
  if (!keepRings.ok) return keepRings;
  if (keepRings.value < 2 || keepRings.value > ringCount) {
    return fail(
      `${path}.keepRings`,
      `expected between 2 and the standing garment's ${ringCount} rings`,
    );
  }
  const legs = parseArray(record.value.legs, `${path}.legs`, parseSeatedLegRow);
  if (!legs.ok) return legs;
  if (legs.value.length < 2)
    return fail(`${path}.legs`, "expected at least two rows");
  if (!descending(legs.value.map((r) => r.z)))
    return fail(`${path}.legs`, "expected rows listed top to bottom");
  return ok({ keepRings: keepRings.value, legs: legs.value });
}

function parseGarment(value: unknown, path: string): ParseResult<Garment> {
  const record = strict(value, path, [
    "seated",
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
  let seated: SeatedGarment | undefined;
  if (record.value.seated !== undefined) {
    const parsed = parseSeatedGarment(
      record.value.seated,
      `${path}.seated`,
      rings.value.length,
    );
    if (!parsed.ok) return parsed;
    seated = parsed.value;
  }
  return ok({
    name: name.value,
    segments: segments.value,
    folds: folds.value,
    rings: rings.value,
    belt: belt.value,
    skirtBelow: skirtBelow.value,
    pelvisShare: pelvisShare.value,
    roles: [roles.value[0] as string, roles.value[1] as string],
    ...(seated === undefined ? {} : { seated }),
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

function parseCrease(
  value: unknown,
  path: string,
): ParseResult<HimationCrease> {
  const record = strict(value, path, ["at", "width", "depth"]);
  if (!record.ok) return record;
  const at = parseFiniteNumber(record.value.at, `${path}.at`);
  if (!at.ok) return at;
  if (at.value <= 0 || at.value >= 1)
    return fail(`${path}.at`, "expected a position between 0 and 1");
  const width = parsePositive(record.value.width, `${path}.width`);
  if (!width.ok) return width;
  if (width.value > 1)
    return fail(`${path}.width`, "expected a share of the arc up to 1");
  const depth = parseFiniteNumber(record.value.depth, `${path}.depth`);
  if (!depth.ok) return depth;
  if (depth.value < 0)
    return fail(`${path}.depth`, "expected a depth of at least 0");
  return ok({ at: at.value, width: width.value, depth: depth.value });
}

function parseHimationStrip(
  value: unknown,
  path: string,
): ParseResult<HimationStrip> {
  const record = strict(value, path, [
    "name",
    "folds",
    "rows",
    "weights",
    "creases",
    "columns",
  ]);
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
  let creases: readonly HimationCrease[] | undefined;
  if (record.value.creases !== undefined) {
    const parsed = parseArray(
      record.value.creases,
      `${path}.creases`,
      parseCrease,
    );
    if (!parsed.ok) return parsed;
    creases = parsed.value;
  }
  let columns: number | undefined;
  if (record.value.columns !== undefined) {
    const parsed = parseNonNegativeInteger(
      record.value.columns,
      `${path}.columns`,
    );
    if (!parsed.ok) return parsed;
    if (parsed.value < 3 || parsed.value > 64)
      return fail(`${path}.columns`, "expected between 3 and 64 columns");
    columns = parsed.value;
  }
  return ok({
    name: name.value,
    folds: folds.value,
    rows: rows.value,
    weights: weights.value,
    ...(creases === undefined ? {} : { creases }),
    ...(columns === undefined ? {} : { columns }),
  });
}

function parseSeatedMantle(
  value: unknown,
  path: string,
): ParseResult<SeatedMantle> {
  const record = strict(value, path, ["hemZ", "flare", "narrow"]);
  if (!record.ok) return record;
  const hemZ = parseFiniteNumber(record.value.hemZ, `${path}.hemZ`);
  if (!hemZ.ok) return hemZ;
  const flare = parseFiniteNumber(record.value.flare, `${path}.flare`);
  if (!flare.ok) return flare;
  if (flare.value < 1)
    return fail(`${path}.flare`, "expected a flare of at least 1");
  const narrow = parseFiniteNumber(record.value.narrow, `${path}.narrow`);
  if (!narrow.ok) return narrow;
  if (narrow.value <= 0 || narrow.value > 1)
    return fail(`${path}.narrow`, "expected a scale above 0 and at most 1");
  return ok({ hemZ: hemZ.value, flare: flare.value, narrow: narrow.value });
}

function parseHimation(
  value: unknown,
  path: string,
  allowSeated = false,
): ParseResult<Himation> {
  const record = strict(
    value,
    path,
    allowSeated ? ["role", "strips", "seated"] : ["role", "strips"],
  );
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
  let seated: SeatedMantle | undefined;
  if (record.value.seated !== undefined) {
    const parsed = parseSeatedMantle(record.value.seated, `${path}.seated`);
    if (!parsed.ok) return parsed;
    seated = parsed.value;
  }
  return ok({
    role: role.value,
    strips: strips.value,
    ...(seated === undefined ? {} : { seated }),
  });
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
  const record = strict(value, path, [
    "aims",
    "rotations",
    "damp",
    "dampLocation",
    "groundFeet",
    "breath",
  ]);
  if (!record.ok) return record;
  let breath: PoseEntry["breath"];
  if (record.value.breath !== undefined) {
    const parsed = parseVec3Record(record.value.breath, `${path}.breath`);
    if (!parsed.ok) return parsed;
    if (Object.keys(parsed.value).length === 0)
      return fail(`${path}.breath`, "expected at least one bone");
    breath = parsed.value;
  }
  let groundFeet: boolean | undefined;
  if (record.value.groundFeet !== undefined) {
    const parsed = parseBoolean(record.value.groundFeet, `${path}.groundFeet`);
    if (!parsed.ok) return parsed;
    groundFeet = parsed.value;
  }
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
  const factors = (
    field: "damp" | "dampLocation",
  ): ParseResult<Readonly<Record<string, number>> | undefined> => {
    const raw = record.value[field];
    if (raw === undefined) return ok(undefined);
    if (!isRecord(raw) || Object.keys(raw).length === 0) {
      return fail(`${path}.${field}`, "expected an object of bone factors");
    }
    const out: Record<string, number> = {};
    for (const [bone, factor] of Object.entries(raw)) {
      const parsed = parseFiniteNumber(factor, `${path}.${field}.${bone}`);
      if (!parsed.ok) return parsed;
      if (parsed.value < 0 || parsed.value > 1) {
        return fail(
          `${path}.${field}.${bone}`,
          "expected a factor between 0 and 1",
        );
      }
      out[bone] = parsed.value;
    }
    return ok(out);
  };
  const damp = factors("damp");
  if (!damp.ok) return damp;
  const dampLocation = factors("dampLocation");
  if (!dampLocation.ok) return dampLocation;
  return ok({
    ...(aims === undefined ? {} : { aims }),
    ...(rotations === undefined ? {} : { rotations }),
    ...(damp.value === undefined ? {} : { damp: damp.value }),
    ...(dampLocation.value === undefined
      ? {}
      : { dampLocation: dampLocation.value }),
    ...(groundFeet === undefined ? {} : { groundFeet }),
    ...(breath === undefined ? {} : { breath }),
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

function parseFigureProfile(
  value: unknown,
  path: string,
): ParseResult<FigureProfile> {
  const record = strict(value, path, [
    "schemaVersion",
    "id",
    "kitFiles",
    "models",
    "body",
    "garment",
    "himation",
    "beard",
    "hair",
    "fillet",
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
    const parsed = parseHimation(
      record.value.himation,
      `${path}.himation`,
      true,
    );
    if (!parsed.ok) return parsed;
    himation = parsed.value;
  }
  let beard: Himation | undefined;
  if (record.value.beard !== undefined) {
    const parsed = parseHimation(record.value.beard, `${path}.beard`);
    if (!parsed.ok) return parsed;
    beard = parsed.value;
  }
  let hairMesh: Himation | undefined;
  if (record.value.hair !== undefined) {
    const parsed = parseHimation(record.value.hair, `${path}.hair`);
    if (!parsed.ok) return parsed;
    hairMesh = parsed.value;
  }
  let fillet: Himation | undefined;
  if (record.value.fillet !== undefined) {
    const parsed = parseHimation(record.value.fillet, `${path}.fillet`);
    if (!parsed.ok) return parsed;
    fillet = parsed.value;
  }
  const materials = parseMaterials(record.value.materials, `${path}.materials`);
  if (!materials.ok) return materials;
  const roleNames = [
    BODY_ROLE,
    ...garment.value.roles,
    ...hair.value.map((h) => h.role),
    ...(himation === undefined ? [] : [himation.role]),
    ...(beard === undefined ? [] : [beard.role]),
    ...(hairMesh === undefined ? [] : [hairMesh.role]),
    ...(fillet === undefined ? [] : [fillet.role]),
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
    ...(beard === undefined ? {} : { beard }),
    ...(hairMesh === undefined ? {} : { hair: hairMesh }),
    ...(fillet === undefined ? {} : { fillet }),
    materials: materials.value,
    stampSet: stampSet.value,
    shadow: { ramp: shadowRamp.value },
    clips: clips.value,
    pose: pose.value,
  });
}

// --- Structures ------------------------------------------------------------------------

function parseUnitFraction(value: unknown, path: string): ParseResult<number> {
  const number = parseFiniteNumber(value, path);
  if (!number.ok) return number;
  if (number.value < 0 || number.value > 1)
    return fail(path, "expected a number from 0 to 1");
  return number;
}

function parseDecal(
  value: unknown,
  path: string,
  materialKeys: ReadonlySet<string>,
): ParseResult<StructureDecal> {
  const record = strict(value, path, [
    "wall",
    "at",
    "size",
    "material",
    "angle",
  ]);
  if (!record.ok) return record;
  const wall = record.value.wall;
  if (wall !== "front" && wall !== "side" && wall !== "roof")
    return fail(`${path}.wall`, 'expected "front", "side" or "roof"');
  const at = parseVec2(record.value.at, `${path}.at`);
  if (!at.ok) return at;
  const size = parseVec2(record.value.size, `${path}.size`);
  if (!size.ok) return size;
  if (size.value[0] <= 0 || size.value[1] <= 0)
    return fail(`${path}.size`, "expected a positive width and height");
  const material = parseString(record.value.material, `${path}.material`);
  if (!material.ok) return material;
  if (!materialKeys.has(material.value))
    return fail(
      `${path}.material`,
      `"${material.value}" is not among the profile's materials`,
    );
  let angle: number | undefined;
  if (record.value.angle !== undefined) {
    const parsed = parseFiniteNumber(record.value.angle, `${path}.angle`);
    if (!parsed.ok) return parsed;
    angle = parsed.value;
  }
  return ok({
    wall,
    at: at.value,
    size: size.value,
    material: material.value,
    ...(angle === undefined ? {} : { angle }),
  });
}

function parseWind(value: unknown, path: string): ParseResult<Wind> {
  const record = strict(value, path, ["amplitudeM", "lag", "cycles", "swirl"]);
  if (!record.ok) return record;
  const amplitudeM = parsePositive(
    record.value.amplitudeM,
    `${path}.amplitudeM`,
  );
  if (!amplitudeM.ok) return amplitudeM;
  const lag = parseFiniteNumber(record.value.lag, `${path}.lag`);
  if (!lag.ok) return lag;
  const cycles = parseNonNegativeInteger(record.value.cycles, `${path}.cycles`);
  if (!cycles.ok) return cycles;
  if (cycles.value < 1)
    return fail(`${path}.cycles`, "expected at least one whole sway per loop");
  const swirl = parseFiniteNumber(record.value.swirl, `${path}.swirl`);
  if (!swirl.ok) return swirl;
  return ok({
    amplitudeM: amplitudeM.value,
    lag: lag.value,
    cycles: cycles.value,
    swirl: swirl.value,
  });
}

function parseFraction(
  value: unknown,
  path: string,
  below: number,
): ParseResult<number> {
  const number = parseFiniteNumber(value, path);
  if (!number.ok) return number;
  if (number.value < 0 || number.value >= below)
    return fail(path, `expected a number from 0 up to ${below}`);
  return number;
}

function parseGroundBuild(
  value: Record<string, unknown>,
  path: string,
): ParseResult<GroundBuild> {
  const record = strict(value, path, [
    "kind",
    "period",
    "slab",
    "tuft",
    "stamp",
  ]);
  if (!record.ok) return record;
  const period = parsePositiveInteger(record.value.period, `${path}.period`);
  if (!period.ok) return period;
  const slabRecord = strict(record.value.slab, `${path}.slab`, [
    "heightM",
    "gap",
    "jitter",
  ]);
  if (!slabRecord.ok) return slabRecord;
  const slabHeight = parseFiniteNumber(
    slabRecord.value.heightM,
    `${path}.slab.heightM`,
  );
  if (!slabHeight.ok) return slabHeight;
  if (slabHeight.value < 0)
    return fail(`${path}.slab.heightM`, "expected a number from 0 up");
  const gap = parseFraction(slabRecord.value.gap, `${path}.slab.gap`, 0.5);
  if (!gap.ok) return gap;
  const jitter = parseFraction(
    slabRecord.value.jitter,
    `${path}.slab.jitter`,
    0.5,
  );
  if (!jitter.ok) return jitter;
  const tuftRecord = strict(record.value.tuft, `${path}.tuft`, [
    "perTile",
    "heightM",
    "radiusM",
  ]);
  if (!tuftRecord.ok) return tuftRecord;
  const perTile = parseNonNegativeInteger(
    tuftRecord.value.perTile,
    `${path}.tuft.perTile`,
  );
  if (!perTile.ok) return perTile;
  const tuftHeight = parsePositive(
    tuftRecord.value.heightM,
    `${path}.tuft.heightM`,
  );
  if (!tuftHeight.ok) return tuftHeight;
  const radius = parsePositive(
    tuftRecord.value.radiusM,
    `${path}.tuft.radiusM`,
  );
  if (!radius.ok) return radius;
  const stampRecord = strict(record.value.stamp, `${path}.stamp`, [
    "noiseSeed",
    "wavelengthTiles",
    "amplitude",
    "edgeBandPx",
    "overhangs",
  ]);
  if (!stampRecord.ok) return stampRecord;
  const noiseSeed = parseNonNegativeInteger(
    stampRecord.value.noiseSeed,
    `${path}.stamp.noiseSeed`,
  );
  if (!noiseSeed.ok) return noiseSeed;
  const wavelength = parsePositive(
    stampRecord.value.wavelengthTiles,
    `${path}.stamp.wavelengthTiles`,
  );
  if (!wavelength.ok) return wavelength;
  const amplitude = parseFraction(
    stampRecord.value.amplitude,
    `${path}.stamp.amplitude`,
    0.5,
  );
  if (!amplitude.ok) return amplitude;
  const edgeBand = parseNonNegativeInteger(
    stampRecord.value.edgeBandPx,
    `${path}.stamp.edgeBandPx`,
  );
  if (!edgeBand.ok) return edgeBand;
  const overhangs = parseNonNegativeInteger(
    stampRecord.value.overhangs,
    `${path}.stamp.overhangs`,
  );
  if (!overhangs.ok) return overhangs;
  return ok({
    kind: "ground",
    period: period.value,
    slab: { heightM: slabHeight.value, gap: gap.value, jitter: jitter.value },
    tuft: {
      perTile: perTile.value,
      heightM: tuftHeight.value,
      radiusM: radius.value,
    },
    stamp: {
      noiseSeed: noiseSeed.value,
      wavelengthTiles: wavelength.value,
      amplitude: amplitude.value,
      edgeBandPx: edgeBand.value,
      overhangs: overhangs.value,
    },
  });
}

function parseStructureBuild(
  value: unknown,
  path: string,
  listed: ReadonlySet<string>,
): ParseResult<StructureBuild> {
  if (!isRecord(value)) return fail(path, "expected an object");
  if (value.kind === "ground") return parseGroundBuild(value, path);
  if (value.kind === "house") {
    const record = strict(value, path, ["kind", "parts"]);
    if (!record.ok) return record;
    if (record.value.parts === undefined) return ok({ kind: "house" });
    if (!isRecord(record.value.parts))
      return fail(`${path}.parts`, "expected an object of role to kit model");
    const parts: Record<string, KitPath> = {};
    for (const [role, entry] of Object.entries(record.value.parts)) {
      const model = parseKitPath(entry, `${path}.parts.${role}`);
      if (!model.ok) return model;
      if (!listed.has(`${model.value.kit}/${model.value.path}`))
        return fail(
          `${path}.parts.${role}`,
          `"${model.value.kit}/${model.value.path}" is not among kitFiles`,
        );
      parts[role] = model.value;
    }
    return ok({ kind: "house", parts });
  }
  if (value.kind !== "tree")
    return fail(`${path}.kind`, 'expected "house", "tree" or "ground"');
  const record = strict(value, path, ["kind", "model", "heightM"]);
  if (!record.ok) return record;
  const model = parseKitPath(record.value.model, `${path}.model`);
  if (!model.ok) return model;
  if (!listed.has(`${model.value.kit}/${model.value.path}`))
    return fail(
      `${path}.model`,
      `"${model.value.kit}/${model.value.path}" is not among kitFiles`,
    );
  const heightM = parsePositive(record.value.heightM, `${path}.heightM`);
  if (!heightM.ok) return heightM;
  return ok({ kind: "tree", model: model.value, heightM: heightM.value });
}

function parseStructureClips(
  value: unknown,
  path: string,
  build: StructureBuild,
  materialKeys: ReadonlySet<string>,
  hasWind: boolean,
): ParseResult<Readonly<Record<string, StructureClip>>> {
  if (!isRecord(value) || Object.keys(value).length === 0)
    return fail(path, "expected a clip map from semantic state to clip");
  const out: Record<string, StructureClip> = {};
  for (const [state, entry] of Object.entries(value)) {
    const at = `${path}.${state}`;
    if (!SEMANTIC_STATE.test(state))
      return fail(at, "expected a semantic state name");
    const record = strict(entry, at, [
      "loop",
      "frames",
      "frameMs",
      "materials",
      "decals",
      "ruin",
      "leaves",
    ]);
    if (!record.ok) return record;
    const loop = parseBoolean(record.value.loop, `${at}.loop`);
    if (!loop.ok) return loop;
    const frames = parseNonNegativeInteger(record.value.frames, `${at}.frames`);
    if (!frames.ok) return frames;
    if (frames.value < 1)
      return fail(`${at}.frames`, "expected at least one frame");
    if (!loop.value && frames.value !== 1)
      return fail(`${at}.frames`, "a still state is rendered once");
    if (loop.value && !hasWind)
      return fail(`${at}.loop`, "a looping state needs the profile's wind");
    const frameMs = parseFrameMs(
      record.value.frameMs,
      frames.value,
      `${at}.frameMs`,
    );
    if (!frameMs.ok) return frameMs;

    const materials: Record<string, string> = {};
    if (record.value.materials !== undefined) {
      if (!isRecord(record.value.materials))
        return fail(`${at}.materials`, "expected an object of material roles");
      for (const [role, target] of Object.entries(record.value.materials)) {
        const key = parseString(target, `${at}.materials.${role}`);
        if (!key.ok) return key;
        if (!materialKeys.has(key.value))
          return fail(
            `${at}.materials.${role}`,
            `"${key.value}" is not among the profile's materials`,
          );
        materials[role] = key.value;
      }
    }
    let decals: readonly StructureDecal[] = [];
    if (record.value.decals !== undefined) {
      const parsed = parseArray(
        record.value.decals,
        `${at}.decals`,
        (item, itemPath) => parseDecal(item, itemPath, materialKeys),
      );
      if (!parsed.ok) return parsed;
      // A parsed tree lists no decals, and the recipe parses its profile a second time.
      if (build.kind !== "house" && parsed.value.length > 0)
        return fail(`${at}.decals`, "only a house takes decals");
      decals = parsed.value;
    }
    let ruin = false;
    if (record.value.ruin !== undefined) {
      const parsed = parseBoolean(record.value.ruin, `${at}.ruin`);
      if (!parsed.ok) return parsed;
      ruin = parsed.value;
    }
    let leaves: number | undefined;
    if (record.value.leaves !== undefined) {
      if (build.kind !== "tree")
        return fail(`${at}.leaves`, "only a tree has leaves");
      const parsed = parseUnitFraction(record.value.leaves, `${at}.leaves`);
      if (!parsed.ok) return parsed;
      leaves = parsed.value;
    }
    out[state] = {
      loop: loop.value,
      frames: frames.value,
      frameMs: frameMs.value,
      materials,
      decals,
      ruin,
      ...(leaves === undefined ? {} : { leaves }),
    };
  }
  return ok(out);
}

function parseStructureProfile(
  value: unknown,
  path: string,
): ParseResult<StructureProfile> {
  const record = strict(value, path, [
    "schemaVersion",
    "kind",
    "id",
    "kitFiles",
    "build",
    "cell",
    "materials",
    "clips",
    "wind",
    "outline",
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
  if (!PROFILE_ID.test(id.value))
    return fail(`${path}.id`, "expected a lowercase, hyphenated profile id");
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
  const build = parseStructureBuild(
    record.value.build,
    `${path}.build`,
    listed,
  );
  if (!build.ok) return build;
  const cell = parseCell(record.value.cell, `${path}.cell`);
  if (!cell.ok) return cell;
  // Outline false belongs to ground, which takes none; no other build may carry the key.
  if (build.value.kind === "ground") {
    if (record.value.outline !== false)
      return fail(`${path}.outline`, "a ground profile sets outline to false");
    const crop = groundCrop(build.value.period, cell.value.pivot);
    if (
      crop.x < 0 ||
      crop.y < 0 ||
      crop.x + crop.w > cell.value.width ||
      crop.y + crop.h > cell.value.height
    )
      return fail(
        `${path}.cell`,
        `the ${crop.w}x${crop.h} patch at (${crop.x},${crop.y}) is not inside the ${cell.value.width}x${cell.value.height} cell`,
      );
  } else if (record.value.outline !== undefined)
    return fail(`${path}.outline`, "only a ground profile takes outline");
  const materials = parseMaterials(record.value.materials, `${path}.materials`);
  if (!materials.ok) return materials;
  let wind: Wind | undefined;
  if (record.value.wind !== undefined) {
    const parsed = parseWind(record.value.wind, `${path}.wind`);
    if (!parsed.ok) return parsed;
    wind = parsed.value;
  }
  const clips = parseStructureClips(
    record.value.clips,
    `${path}.clips`,
    build.value,
    new Set(Object.keys(materials.value)),
    wind !== undefined,
  );
  if (!clips.ok) return clips;
  return ok({
    schemaVersion: 1,
    kind: "structure",
    id: id.value,
    kitFiles: kitFiles.value,
    build: build.value,
    cell: cell.value,
    materials: materials.value,
    clips: clips.value,
    ...(wind === undefined ? {} : { wind }),
    ...(build.value.kind === "ground" ? { outline: false as const } : {}),
  });
}

/**
 * Parses a model profile. A profile with no `kind` is a figure and parses as it always did;
 * `kind: "structure"` is a tree or a building.
 */
export function parseProfile(
  value: unknown,
  path = "profile",
): ParseResult<ModelProfile> {
  if (isRecord(value) && value.kind !== undefined) {
    if (value.kind !== "structure")
      return fail(
        `${path}.kind`,
        'expected "structure", or no kind for a figure',
      );
    return parseStructureProfile(value, path);
  }
  return parseFigureProfile(value, path);
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
  profile: FigureProfile,
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
  let damp: Record<string, number> | undefined;
  let dampLocation: Record<string, number> | undefined;
  let groundFeet: boolean | undefined;
  let breath: Record<string, Vec3> | undefined;
  for (const key of keys) {
    const entry = profile.pose[key];
    if (entry === undefined) continue;
    if (entry.aims !== undefined) aims = { ...aims, ...entry.aims };
    if (entry.rotations !== undefined)
      rotations = { ...rotations, ...entry.rotations };
    if (entry.damp !== undefined) damp = { ...damp, ...entry.damp };
    if (entry.dampLocation !== undefined)
      dampLocation = { ...dampLocation, ...entry.dampLocation };
    if (entry.groundFeet !== undefined) groundFeet = entry.groundFeet;
    if (entry.breath !== undefined) breath = { ...breath, ...entry.breath };
  }
  return {
    ...(aims === undefined ? {} : { aims }),
    ...(rotations === undefined ? {} : { rotations }),
    ...(damp === undefined ? {} : { damp }),
    ...(dampLocation === undefined ? {} : { dampLocation }),
    ...(groundFeet === undefined ? {} : { groundFeet }),
    ...(breath === undefined ? {} : { breath }),
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

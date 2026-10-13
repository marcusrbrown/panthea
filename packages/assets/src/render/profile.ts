// Model profiles (ADR-0012): render inputs, not game content. tools/render/profiles/<id>.json
// holds the kit file refs (kit id, relative path, sha256), body proportions, garment, hair, the
// stamp set id, a clip map from semantic state to animation clip, and a pose policy keyed by
// semantic state, never by an output clip name. One pose function in the render script serves
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
  /** Finger curl of a simple fist, degrees; 0 leaves the clip's fingers alone. */
  readonly fistDeg: number;
  /** Extra head pitch about the bone's X axis, degrees. */
  readonly headPitchDeg: number;
  /** Additive local euler offsets (degrees) applied to every state before its own policy. */
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
  /** Material role for the main and trim materials. */
  readonly roles: readonly [string, string];
}

export interface MaterialRole {
  /** Palette ramp id. */
  readonly ramp: string;
  /** Added to the diffuse value so a material keeps its relative tone on its ramp. */
  readonly bias: number;
}

export interface ClipSpec {
  /** Animation-library action. */
  readonly action: string;
  readonly loop: boolean;
  /** One-shots: waypoints `[fromKey, toKey, t]` blended per frame, resampled over the frame count. */
  readonly schedule?: readonly (readonly [number, number, number])[];
}

export interface PoseEntry {
  /** Bone name to a direction in rig space (X toward the character's left, -Y forward, Z up). */
  readonly aims?: Readonly<Record<string, Vec3>>;
  /** Bone name to additive local euler degrees, applied after the clip pose. */
  readonly rotations?: Readonly<Record<string, Vec3>>;
  /** Flip the clip left for right before the aims (the act clip uses the left hand). */
  readonly mirror?: boolean;
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
  readonly materials: Readonly<Record<string, MaterialRole>>;
  /** Id of the stamp set (face and bolt stamps) the post step composites. */
  readonly stampSet: string;
  /**
   * The palette ramp the contact shadow is taken from (its shade 0, the darkest). It belongs to the
   * asset's own palette family, so a god's shadow is a colour the god's report already allows.
   */
  readonly shadow: { readonly ramp: string };
  /** Semantic state to clip. */
  readonly clips: Readonly<Record<string, ClipSpec>>;
  /** Pose policy keyed `state`, `state:facing` or `state:facing:key`. */
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
  return ok({
    model: model.value,
    role: role.value,
    part: part.value,
    ...(dropFrontBelow === undefined ? {} : { dropFrontBelow }),
    ...(keepSidesBack === undefined ? {} : { keepSidesBack }),
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
    "fistDeg",
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
  const fist = parseFiniteNumber(record.value.fistDeg, `${path}.fistDeg`);
  if (!fist.ok) return fist;
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
    fistDeg: fist.value,
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
    roles: [roles.value[0] as string, roles.value[1] as string],
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
    const record = strict(entry, `${path}.${role}`, ["ramp", "bias"]);
    if (!record.ok) return record;
    const ramp = parseString(record.value.ramp, `${path}.${role}.ramp`);
    if (!ramp.ok) return ramp;
    const bias = parseFiniteNumber(record.value.bias, `${path}.${role}.bias`);
    if (!bias.ok) return bias;
    out[role] = { ramp: ramp.value, bias: bias.value };
  }
  return ok(out);
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
      "schedule",
    ]);
    if (!record.ok) return record;
    const action = parseString(record.value.action, `${path}.${state}.action`);
    if (!action.ok) return action;
    const loop = parseBoolean(record.value.loop, `${path}.${state}.loop`);
    if (!loop.ok) return loop;
    let schedule: ClipSpec["schedule"];
    if (record.value.schedule !== undefined) {
      const parsed = parseArray(
        record.value.schedule,
        `${path}.${state}.schedule`,
        (item, itemPath) => {
          const triple = parseVec3(item, itemPath);
          if (!triple.ok) return triple;
          const [from, to, t] = triple.value;
          if (
            !Number.isInteger(from) ||
            !Number.isInteger(to) ||
            from < 0 ||
            to < 0
          ) {
            return fail(
              itemPath,
              "expected key pose indices as the first two numbers",
            );
          }
          if (t < 0 || t > 1)
            return fail(itemPath, "expected a blend between 0 and 1");
          return ok(triple.value);
        },
      );
      if (!parsed.ok) return parsed;
      if (parsed.value.length === 0) {
        return fail(
          `${path}.${state}.schedule`,
          "expected at least one waypoint",
        );
      }
      schedule = parsed.value;
    }
    out[state] = {
      action: action.value,
      loop: loop.value,
      ...(schedule === undefined ? {} : { schedule }),
    };
  }
  return ok(out);
}

function parsePoseEntry(value: unknown, path: string): ParseResult<PoseEntry> {
  const record = strict(value, path, ["aims", "rotations", "mirror"]);
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
  let mirror: boolean | undefined;
  if (record.value.mirror !== undefined) {
    const parsed = parseBoolean(record.value.mirror, `${path}.mirror`);
    if (!parsed.ok) return parsed;
    mirror = parsed.value;
  }
  return ok({
    ...(aims === undefined ? {} : { aims }),
    ...(rotations === undefined ? {} : { rotations }),
    ...(mirror === undefined ? {} : { mirror }),
  });
}

/** A pose key is `state`, `state:facing` or `state:facing:key`, over a state the clip map has. */
function parsePose(
  value: unknown,
  path: string,
  states: ReadonlySet<string>,
): ParseResult<Readonly<Record<string, PoseEntry>>> {
  if (!isRecord(value)) return fail(path, "expected a pose policy object");
  const out: Record<string, PoseEntry> = {};
  for (const [key, entry] of Object.entries(value)) {
    const [state, facing, index, ...rest] = key.split(":");
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
    if (rest.length > 0 || (index !== undefined && !/^\d+$/.test(index))) {
      return fail(
        `${path}.${key}`,
        "expected state, state:facing or state:facing:key",
      );
    }
    if (index !== undefined && facing === undefined) {
      return fail(`${path}.${key}`, "a key pose needs a facing");
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
  const materials = parseMaterials(record.value.materials, `${path}.materials`);
  if (!materials.ok) return materials;
  const roleNames = [
    BODY_ROLE,
    ...garment.value.roles,
    ...hair.value.map((h) => h.role),
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
  /** Key pose of a scheduled one-shot (act). */
  readonly key?: number;
  /** Frames the clip is sampled at. Accepted so a variant can be passed whole; never read. */
  readonly frames?: number;
}

/**
 * The pose policy for a state and facing: the state's entry, refined by its facing entry and, for
 * a key pose, by that key's entry. Bones merge one by one, later entries replacing earlier ones.
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
  if (request.key !== undefined)
    keys.push(`${request.state}:${request.facing}:${request.key}`);
  let aims: Record<string, Vec3> | undefined;
  let rotations: Record<string, Vec3> | undefined;
  let mirror: boolean | undefined;
  for (const key of keys) {
    const entry = profile.pose[key];
    if (entry === undefined) continue;
    if (entry.aims !== undefined) aims = { ...aims, ...entry.aims };
    if (entry.rotations !== undefined)
      rotations = { ...rotations, ...entry.rotations };
    if (entry.mirror !== undefined) mirror = entry.mirror;
  }
  return {
    ...(aims === undefined ? {} : { aims }),
    ...(rotations === undefined ? {} : { rotations }),
    ...(mirror === undefined ? {} : { mirror }),
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

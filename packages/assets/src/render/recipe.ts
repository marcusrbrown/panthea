// The render recipe's identity and the hand-offs between the script and the post step. Pure
// module: no filesystem, no process.
//
//   - `stampLocatorsFrom` maps the `locators` of a slot's `done.json` to the post step's
//     `StampLocators`;
//   - `revisionRecipe` hashes what every slot of a request shares (profile, camera, palette id
//     and digest, pivot, script, post-step version and settings, Blender pin, kit and stamp
//     hashes), once per request;
//   - `slotRecipeHash` adds one slot's state, clip, facing and seed to the revision hash.
//
// A hash covers decoded inputs, never raw-frame bytes: Blender writes a date and the render time
// into every PNG, so frame identity is decoded pixels (U1).

import {
  canonicalJson,
  type RenderedRevisionRecipe,
  type Sha256,
} from "@panthea/contracts";
import { sha256Hex } from "../hash";
import type { PostStepSettings, StampLocators } from "./post";
import type { KitFileRef } from "./profile";
import type { FrameLocators } from "./script-contract";
import type { StampSet } from "./stamps";

/** Bit depth of the depth pass: 8-bit RGBA, the format `decodePng` reads (U1). */
export const DEPTH_BITS = 8;

/**
 * The post step's fixed parameters, measured with the probe and pinned with `POST_STEP_VERSION`:
 * change one and the golden cells change, so the version is bumped. The cell, origin, pivot and
 * depth range come from the camera and the request; these do not vary by asset.
 */
export const POST_SETTINGS = {
  overlapThresholdM: 0.05,
  /** Shade 0 is the ramp's darkest. The ramp is the profile's (`postSettingsFor`). */
  shadow: { rx: 10, ry: 5, shade: 0 },
} as const;

export type PostFixedSettings = {
  readonly overlapThresholdM: number;
  readonly shadow: {
    readonly rx: number;
    readonly ry: number;
    readonly ramp: string;
    readonly shade: number;
  } | null;
};

/**
 * The fixed settings with the profile's shadow ramp resolved: the shadow is shade 0 of that ramp in
 * the asset's palette, so it is a colour of the asset's own family. This is what the revision
 * recipe records and the post step runs.
 */
export function postSettingsFor(shadowRamp: string): PostFixedSettings {
  return {
    overlapThresholdM: POST_SETTINGS.overlapThresholdM,
    shadow: { ...POST_SETTINGS.shadow, ramp: shadowRamp },
  };
}

/**
 * The post step's settings for a camera and a declared pivot. The world origin projects to the
 * camera's cell pivot; the declared pivot is the request's.
 */
export function postStepSettings(
  camera: {
    readonly cell: {
      readonly width: number;
      readonly height: number;
      readonly pivot: readonly [number, number];
    };
    readonly depthRange: readonly [number, number];
  },
  pivot: { readonly x: number; readonly y: number },
  fixed: PostFixedSettings,
): PostStepSettings {
  return {
    cell: { w: camera.cell.width, h: camera.cell.height },
    originPx: [camera.cell.pivot[0], camera.cell.pivot[1]],
    pivotPx: [pivot.x, pivot.y],
    depthRange: [camera.depthRange[0], camera.depthRange[1]],
    overlapThresholdM: fixed.overlapThresholdM,
    shadow: fixed.shadow,
  };
}

// --- locators ------------------------------------------------------------------------------

/**
 * Maps a frame's `done.json` locators to the post step's. The eyes are among `points` keyed
 * `<mesh>_<side>` (`eyes_l`, `eyes_r`, and `eyebrows_l`, `eyebrows_r`, which the face stamp's own
 * brow pixels make unnecessary). A frame with no eye point gets no eyes; the post step then skips
 * the face stamp, as it does on the north facing.
 */
export function stampLocatorsFrom(frame: FrameLocators): StampLocators {
  const eyeLeft = frame.points.eyes_l;
  const eyeRight = frame.points.eyes_r;
  return eyeLeft === undefined && eyeRight === undefined
    ? {}
    : {
        eyes: {
          ...(eyeLeft === undefined
            ? {}
            : {
                l: {
                  px: [eyeLeft.px[0], eyeLeft.px[1]],
                  depth: eyeLeft.depth,
                },
              }),
          ...(eyeRight === undefined
            ? {}
            : {
                r: {
                  px: [eyeRight.px[0], eyeRight.px[1]],
                  depth: eyeRight.depth,
                },
              }),
        },
      };
}

// --- hashes ------------------------------------------------------------------------------------

const text = (value: unknown): Uint8Array =>
  new TextEncoder().encode(canonicalJson(value));

export interface BlenderBinaryPin {
  readonly version: string;
  readonly buildHash: string;
  /** sha256 of the executable the pin was taken on. */
  readonly binarySha256: Sha256;
}

export interface RevisionInputs {
  readonly profile: Sha256;
  readonly camera: Sha256;
  readonly palette: { readonly id: string; readonly digest: Sha256 };
  readonly pivot: { readonly x: number; readonly y: number };
  /** sha256 of the script text the runtime writes to scratch. */
  readonly script: Sha256;
  readonly postStep: {
    readonly version: number;
    readonly settings: PostFixedSettings;
  };
  readonly blender: BlenderBinaryPin;
  readonly kit: Sha256;
  readonly stamps: Sha256;
}

export interface RevisionFields extends Omit<RevisionInputs, "postStep"> {
  readonly postStep: RevisionInputs["postStep"] & {
    readonly depthBits: typeof DEPTH_BITS;
  };
}

export interface RevisionRecipe {
  readonly hash: Sha256;
  /** What the hash covers, kept in the manifest so a later audit can compare field by field. */
  readonly fields: RevisionFields;
}

/** The revision recipe hash: the fields every slot of a request shares. */
export function revisionRecipe(inputs: RevisionInputs): RevisionRecipe {
  const fields: RevisionFields = {
    ...inputs,
    postStep: { ...inputs.postStep, depthBits: DEPTH_BITS },
  };
  return { hash: sha256Hex(text(fields)), fields };
}

export interface SlotIdentity {
  readonly state: string;
  /** The clip rendered: the state at its frame count, e.g. `walk16`. */
  readonly clip: string;
  readonly facing: string;
  readonly seed: number;
}

/** The slot recipe hash: the revision hash plus the slot's state, clip, facing and seed. */
export function slotRecipeHash(revision: Sha256, slot: SlotIdentity): Sha256 {
  return sha256Hex(
    text({
      revision,
      state: slot.state,
      clip: slot.clip,
      facing: slot.facing,
      seed: slot.seed,
    }),
  );
}

/** Hash of the kit files a profile reads: kit, path and sha256 of each, in a fixed order. */
export function kitHash(files: readonly KitFileRef[]): Sha256 {
  return sha256Hex(
    text(
      [...files]
        .map(({ kit, path, sha256 }) => ({ kit, path, sha256 }))
        .sort((a, b) =>
          `${a.kit}/${a.path}`.localeCompare(`${b.kit}/${b.path}`),
        ),
    ),
  );
}

/** Hash of a stamp set: its manifest entry, which lists every variant file with its sha256 and anchor. */
export function stampSetHash(set: StampSet): Sha256 {
  return sha256Hex(text(set));
}

/** The revision recipe hash of a recorded field set, as `revisionRecipe` computes it. */
export function revisionHashOf(fields: RevisionFields): Sha256 {
  return sha256Hex(text(fields));
}

/** The contract's recorded revision recipe, from a revision's fields and its profile id. */
export function renderedRevisionOf(
  fields: RevisionFields,
  profileId: string,
): RenderedRevisionRecipe {
  return {
    hash: revisionHashOf(fields),
    profile: { id: profileId, hash: fields.profile },
    camera: fields.camera,
    palette: { id: fields.palette.id, digest: fields.palette.digest },
    pivot: { x: fields.pivot.x, y: fields.pivot.y },
    script: fields.script,
    postStep: fields.postStep.version,
    blender: {
      version: fields.blender.version,
      build: fields.blender.buildHash,
      sha256: fields.blender.binarySha256,
    },
    kit: fields.kit,
    stamps: fields.stamps,
  };
}

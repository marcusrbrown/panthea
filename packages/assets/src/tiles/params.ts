// The stamper's parameters for a ground profile: its `build.stamp` and period, and the colour of the
// edge band, which is the darkest shade of the ramp the over terrain's material draws in.

import type { Rgb } from "../conformance";
import type { PostPalette } from "../render/post-palette";
import type { GroundBuild, ModelProfile } from "../render/profile";
import type { StampParams } from "./stamp";

export type ParamsResult =
  | {
      readonly ok: true;
      readonly params: StampParams;
      readonly build: GroundBuild;
    }
  | { readonly ok: false; readonly message: string };

export function stampParamsOf(
  profile: ModelProfile,
  palette: PostPalette,
): ParamsResult {
  if (profile.kind !== "structure" || profile.build.kind !== "ground")
    return {
      ok: false,
      message: `profile ${profile.id} is not a ground profile`,
    };
  const { build } = profile;
  const material = profile.materials[build.terrain.over];
  if (material === undefined)
    return {
      ok: false,
      message: `profile ${profile.id} has no material for the over terrain "${build.terrain.over}"`,
    };
  const darkest = palette.darkest.get(material.ramp) as Rgb | undefined;
  if (darkest === undefined)
    return {
      ok: false,
      message: `palette ${palette.id} has no ramp "${material.ramp}", the over terrain's`,
    };
  return {
    ok: true,
    build,
    params: {
      period: build.period,
      noiseSeed: build.stamp.noiseSeed,
      wavelengthTiles: build.stamp.wavelengthTiles,
      amplitude: build.stamp.amplitude,
      edgeBandPx: build.stamp.edgeBandPx,
      overhangs: build.stamp.overhangs,
      bandColour: darkest,
    },
  };
}

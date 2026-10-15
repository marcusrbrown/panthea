// Ground patches for the stamper's tests: the generated periodic mosaic (ground-mosaic.ts) through the
// real post step and the profile's crop, in the committed palette. Test support only.

import { join } from "node:path";
import type { RgbaImage } from "../../src/conformance";
import { loadRenderInputs } from "../../src/render/load";
import { postProcessSlot } from "../../src/render/post";
import {
  type PostPalette,
  postPaletteFrom,
} from "../../src/render/post-palette";
import type { GroundBuild, StructureProfile } from "../../src/render/profile";
import {
  effectiveCamera,
  groundPostOf,
  postSettingsFor,
  postStepSettings,
} from "../../src/render/recipe";
import { loadContent } from "../studio/fixtures";
import { groundMosaic } from "./ground-mosaic";

export const RENDER_ROOT = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "tools",
  "render",
);

export function groundProfile(): StructureProfile & { build: GroundBuild } {
  const found = loadRenderInputs(RENDER_ROOT).profiles.find(
    (p) => p.id === "grass-flagstone",
  );
  if (found?.kind !== "structure" || found.build.kind !== "ground")
    throw new Error("no grass-flagstone ground profile");
  return found as StructureProfile & { build: GroundBuild };
}

export function retroPalette(): PostPalette {
  const palette = postPaletteFrom(loadContent().palettes, "greek-retro");
  if (!palette.ok) throw new Error(palette.message);
  return palette.value;
}

/** The two cropped patches a render of the profile would post, from the periodic mosaic. */
export function syntheticPatches(
  profile = groundProfile(),
  palette = retroPalette(),
  period = profile.build.period,
): { base: RgbaImage; over: RgbaImage } {
  const inputs = loadRenderInputs(RENDER_ROOT);
  if (inputs.camera === undefined) throw new Error("no camera");
  const camera = effectiveCamera(profile, inputs.camera);
  const settings = postStepSettings(
    camera,
    { x: 32, y: 16 },
    postSettingsFor(undefined, groundPostOf(profile)),
  );
  const patch = (role: "base" | "over") => {
    const mosaic = groundMosaic({
      role,
      period,
      width: camera.cell.width * 4,
      height: camera.cell.height * 4,
      origin: [camera.cell.pivot[0] * 4, camera.cell.pivot[1] * 4],
      depthRange: camera.depthRange,
      olive: palette.ramps.get("olive") as never,
      stone: palette.ramps.get("stone-sky") as never,
    });
    const result = postProcessSlot({
      slot: role,
      settings,
      palette,
      frames: [{ name: role, facing: "south", ...mosaic }],
    });
    if (!result.ok) throw new Error(result.message);
    return (result.cells[0] as NonNullable<(typeof result.cells)[number]>)
      .image;
  };
  return { base: patch("base"), over: patch("over") };
}

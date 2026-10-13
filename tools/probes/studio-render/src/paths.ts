import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const PROBE_DIR = resolve(import.meta.dir, "..");
export const REPO = resolve(PROBE_DIR, "../../..");
export const SCRATCH = join(PROBE_DIR, "scratch");
export const RESULTS = join(SCRATCH, "results");
export const RUNS = join(SCRATCH, "runs");
export const BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender";
export const BLENDER_BUNDLE = "/Applications/Blender.app";
export const BLENDER_SCRIPT = join(PROBE_DIR, "blender/probe_render.py");
export const PIN = {
  versionPrefix: "5.2.2",
  buildHash: "d13f752e3b9c",
} as const;

/** The main checkout (it holds the kits and the inference binaries, and is never copied into git). */
export function mainCheckout(): string {
  const override = process.env.PANTHEA_MAIN_CHECKOUT;
  if (override) return override;
  const result = spawnSync(
    "git",
    ["-C", REPO, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error("cannot find the main checkout");
  return dirname(result.stdout.trim());
}

/** Kit files the Zeus recipe imports, relative to `<main-checkout>/tools/probes` (the layout retro_assets.py expects). */
export const KIT_FILES: readonly string[] = (() => {
  const ubc =
    "retro-render/models/Universal Base Characters[Standard]/Universal Base Characters[Standard]";
  const hair = `${ubc}/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)`;
  return [
    `${ubc}/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf`,
    `${ubc}/Base Characters/Godot - UE/Superhero_Male_FullBody.bin`,
    ...["Hair_Beard", "Hair_SimpleParted", "Hair_Long"].flatMap((name) => [
      `${hair}/${name}.gltf`,
      `${hair}/${name}.bin`,
    ]),
    "blender-sprite/models/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb",
  ];
})();

export const ensureDir = (path: string): string => {
  mkdirSync(path, { recursive: true });
  return path;
};

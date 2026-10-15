// Reads the render inputs under tools/render from disk: the one camera and the model profiles.
// Node/Bun module. `validate:assets` calls it; the parsing itself lives in camera.ts and
// profile.ts. A bad file is a problem, never a throw.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Camera, parseCamera } from "./camera";
import { parseKitManifest } from "./kits";
import { type ModelProfile, parseProfile, profileKitProblems } from "./profile";
import { frameOf } from "./recipe";

export interface RenderInputProblem {
  /** Path relative to the render root, e.g. `camera.json` or `profiles/zeus.json`. */
  readonly file: string;
  readonly message: string;
}

export interface RenderInputs {
  /** Undefined when camera.json is missing or does not parse. */
  readonly camera: Camera | undefined;
  /** Only the profiles that parsed. */
  readonly profiles: readonly ModelProfile[];
  /** The id of every profile file present (its file name), parsed or not, so one bad file reports once. */
  readonly profileIds: readonly string[];
  readonly problems: readonly RenderInputProblem[];
}

function readJson(
  path: string,
): { ok: true; value: unknown } | { ok: false; message: string } {
  if (!existsSync(path)) return { ok: false, message: "file is missing" };
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { ok: false, message: "not valid JSON" };
  }
}

/**
 * Loads `camera.json` and `profiles/*.json` under `renderRoot`. Each profile must be named for
 * its id, and each kit ref must resolve to a `kits.json` entry with the same sha256 (the
 * licence, referencedBy and on-disk checks are `checkKits`', which takes the profiles' refs).
 */
export function loadRenderInputs(renderRoot: string): RenderInputs {
  const problems: RenderInputProblem[] = [];
  const report = (file: string, message: string) =>
    problems.push({ file, message });

  let camera: Camera | undefined;
  const cameraJson = readJson(join(renderRoot, "camera.json"));
  if (!cameraJson.ok) {
    report("camera.json", cameraJson.message);
  } else {
    const parsed = parseCamera(cameraJson.value);
    if (parsed.ok) camera = parsed.value;
    else report("camera.json", `${parsed.path}: ${parsed.message}`);
  }

  const manifestJson = readJson(join(renderRoot, "kits.json"));
  const manifest = manifestJson.ok
    ? parseKitManifest(manifestJson.value)
    : undefined;

  const profiles: ModelProfile[] = [];
  const dir = join(renderRoot, "profiles");
  const names = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .sort()
    : [];
  for (const name of names) {
    const file = `profiles/${name}`;
    const json = readJson(join(dir, name));
    if (!json.ok) {
      report(file, json.message);
      continue;
    }
    const parsed = parseProfile(json.value);
    if (!parsed.ok) {
      report(file, `${parsed.path}: ${parsed.message}`);
      continue;
    }
    if (name !== `${parsed.value.id}.json`) {
      report(
        file,
        `profile id "${parsed.value.id}" does not match the file name; expected ${parsed.value.id}.json`,
      );
      continue;
    }
    profiles.push(parsed.value);
    if (manifest?.ok === true) {
      for (const message of profileKitProblems(parsed.value, manifest.value)) {
        report(file, message);
      }
    }
  }
  return {
    camera,
    profiles,
    profileIds: names.map((name) => name.slice(0, -".json".length)),
    problems,
  };
}

/**
 * The cell sizes the committed profiles draw on, each once: a figure on the camera's cell, a
 * structure on its own. None when the camera is unusable.
 */
export function renderCellsOf(
  inputs: RenderInputs,
): { readonly w: number; readonly h: number }[] {
  const { camera } = inputs;
  if (camera === undefined) return [];
  const cells: { w: number; h: number }[] = [];
  for (const profile of inputs.profiles) {
    const { width: w, height: h } = frameOf(profile, camera);
    if (!cells.some((cell) => cell.w === w && cell.h === h))
      cells.push({ w, h });
  }
  return cells;
}

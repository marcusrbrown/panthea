import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { profile } from "./cmd-observe";
import { BLENDER_BUNDLE, REPO } from "./paths";

const STAGING = "/scratch/staging-for-test";
const OUT = "/scratch/out-for-test";

/** What the sandbox would allow, read back from the profile text (subpath and literal entries only). */
function allowed(text: string): (path: string) => boolean {
  const subpaths = [...text.matchAll(/\(subpath "([^"]+)"\)/g)].map(
    (m) => m[1] as string,
  );
  const literals = [...text.matchAll(/\(literal "([^"]+)"\)/g)].map(
    (m) => m[1] as string,
  );
  expect(text).not.toContain("(regex");
  return (path) =>
    literals.includes(path) ||
    subpaths.some((p) => path === p || path.startsWith(`${p}/`));
}

describe("the staging sandbox profile", () => {
  const text = profile(STAGING, OUT);
  const isAllowed = allowed(text);

  test("names no models path at all", () => {
    expect(text).not.toMatch(/models/);
  });

  test("never allows a read under either kit pack directory of a normal checkout", () => {
    // In a normal checkout the main checkout is this repo, so these are the kit paths an unstaged run would read.
    for (const kit of [
      "tools/probes/retro-render/models/Universal Base Characters[Standard]/x.gltf",
      "tools/probes/blender-sprite/models/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb",
      "tools/probes/retro-render/models/anything.bin",
    ])
      expect(isAllowed(join(REPO, kit))).toBe(false);
  });

  test("does not allow whole script directories, only the script files and data the render reads", () => {
    expect(
      isAllowed(join(REPO, "tools/probes/retro-render/unlisted-file.json")),
    ).toBe(false);
    expect(
      isAllowed(join(REPO, "tools/probes/blender-sprite/unlisted-file.json")),
    ).toBe(false);
  });

  test("positive controls: staging, the output directory, the Blender bundle and the scripts it imports are allowed", () => {
    expect(isAllowed(join(STAGING, "retro-render/models/x.gltf"))).toBe(true);
    expect(isAllowed(join(OUT, "render/zeus-tall/meta.json"))).toBe(true);
    expect(isAllowed(join(BLENDER_BUNDLE, "Contents/MacOS/Blender"))).toBe(
      true,
    );
    expect(
      isAllowed(join(REPO, "tools/probes/retro-render/render_retro.py")),
    ).toBe(true);
    expect(
      isAllowed(join(REPO, "tools/probes/blender-sprite/zeus_proxy.py")),
    ).toBe(true);
    expect(
      isAllowed(
        join(REPO, "tools/probes/studio-render/blender/probe_render.py"),
      ),
    ).toBe(true);
  });
});

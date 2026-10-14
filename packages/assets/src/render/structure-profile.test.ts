// Structure profiles: a tree or a building with its own frame, parsed beside the figure profile by
// the `kind` field. The Zeus profile and the hashes that cover it stay exactly as they were.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCamera } from "./camera";
import {
  isStructureProfile,
  type ModelProfile,
  parseProfile,
  profileHash,
  type StructureProfile,
} from "./profile";
import { effectiveCamera, frameOf, NO_STAMPS_HASH } from "./recipe";

const RENDER_ROOT = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "tools",
  "render",
);
// biome-ignore lint/suspicious/noExplicitAny: the tests edit an untyped JSON document
type Json = any;

const readJson = (file: string): Json =>
  JSON.parse(readFileSync(join(RENDER_ROOT, file), "utf8"));

const camera = (() => {
  const parsed = parseCamera(readJson("camera.json"));
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
})();

const KIT_FILE = {
  kit: "kenney-nature-kit",
  path: "tree_oak.glb",
  sha256: "a".repeat(64),
};

/** A small house: three states, no kit files, no wind. */
function houseJson(): Json {
  return {
    schemaVersion: 1,
    kind: "structure",
    id: "test-house",
    kitFiles: [],
    build: { kind: "house" },
    cell: { id: "structure", width: 160, height: 160, pivot: [80, 128] },
    materials: {
      wall: { ramp: "marble", bias: 0 },
      roof: { ramp: "terracotta", bias: 0 },
      scorch: { ramp: "soil", bias: -0.2 },
    },
    clips: {
      intact: { loop: false, frames: 1, frameMs: 1000 },
      damaged: {
        loop: false,
        frames: 1,
        frameMs: 1000,
        materials: { wall: "scorch" },
        decals: [
          { wall: "front", at: [1, 1], size: [0.5, 0.5], material: "scorch" },
        ],
      },
      ruin: { loop: false, frames: 1, frameMs: 1000, ruin: true },
    },
  };
}

/** A tree: one kit model, a wind loop and a still ruin. */
function treeJson(): Json {
  return {
    schemaVersion: 1,
    kind: "structure",
    id: "test-tree",
    kitFiles: [KIT_FILE],
    build: {
      kind: "tree",
      model: { kit: KIT_FILE.kit, path: KIT_FILE.path },
      heightM: 4,
    },
    cell: { id: "structure", width: 160, height: 160, pivot: [80, 128] },
    materials: {
      trunk: { ramp: "soil", bias: 0 },
      leaf: { ramp: "olive", bias: 0 },
    },
    wind: { amplitudeM: 0.14, lag: 1.2, cycles: 1, swirl: 0.45 },
    clips: {
      intact: { loop: true, frames: 12, frameMs: 166, leaves: 1 },
      ruin: { loop: false, frames: 1, frameMs: 1000, ruin: true },
    },
  };
}

function structure(value: unknown): StructureProfile {
  const result = parseProfile(value);
  if (!result.ok) throw new Error(`${result.path}: ${result.message}`);
  if (!isStructureProfile(result.value)) throw new Error("not a structure");
  return result.value;
}

const failure = (value: unknown) => {
  const result = parseProfile(value);
  if (result.ok) throw new Error("expected the profile to be refused");
  return result;
};

const edited = (base: Json, change: (json: Json) => void): Json => {
  const copy = structuredClone(base);
  change(copy);
  return copy;
};

describe("parseProfile dispatches on kind", () => {
  it("parses a profile with no kind as a figure, exactly as before", () => {
    const zeus = parseProfile(readJson("profiles/zeus.json"));
    expect(zeus.ok).toBe(true);
    if (!zeus.ok) return;
    expect("kind" in zeus.value).toBe(false);
    expect(isStructureProfile(zeus.value)).toBe(false);
  });

  it("pins the Zeus profile hash, so a figure's revision recipe does not move", () => {
    const zeus = parseProfile(readJson("profiles/zeus.json"));
    if (!zeus.ok) throw new Error(zeus.message);
    expect(String(profileHash(zeus.value))).toBe(
      "bd157caf8e723ccc246d81a40e1459c8fd1bbe62f07d93db779900c3ccb00715",
    );
  });

  it("parses kind structure with its own parser", () => {
    const house = structure(houseJson());
    expect(house.kind).toBe("structure");
    expect(house.cell).toEqual({
      id: "structure",
      width: 160,
      height: 160,
      pivot: [80, 128],
    });
    expect(house.clips.intact?.materials).toEqual({});
    expect(house.clips.damaged?.materials).toEqual({ wall: "scorch" });
    expect(house.clips.ruin?.ruin).toBe(true);
    expect(structure(treeJson()).clips.intact?.frameMs).toHaveLength(12);
  });

  it("refuses a kind that is not structure, naming the field", () => {
    for (const kind of ["figure", "tree", 4, null]) {
      const refused = failure({ ...houseJson(), kind });
      expect(refused.path).toBe("profile.kind");
    }
  });

  it("keeps figure keys out of a structure and structure keys out of a figure", () => {
    expect(
      failure(edited(houseJson(), (j) => (j.stampSet = "zeus"))).path,
    ).toBe("profile.stampSet");
    expect(
      failure(edited(readJson("profiles/zeus.json"), (j) => (j.build = {})))
        .path,
    ).toBe("profile.build");
  });
});

describe("a structure profile", () => {
  it("hashes its whole content: a state, a decal, the wind and the cell all move the hash", () => {
    const base = profileHash(structure(houseJson()));
    const moved = (change: (json: Json) => void) =>
      profileHash(structure(edited(houseJson(), change)));
    expect(moved(() => undefined)).toBe(base);
    expect(moved((j) => (j.clips.damaged.decals[0].at = [2, 1]))).not.toBe(
      base,
    );
    expect(moved((j) => (j.clips.ruin.ruin = false))).not.toBe(base);
    expect(moved((j) => (j.cell.width = 164))).not.toBe(base);
    const tree = profileHash(structure(treeJson()));
    expect(
      profileHash(
        structure(edited(treeJson(), (j) => (j.wind.amplitudeM = 0.2))),
      ),
    ).not.toBe(tree);
  });

  it("parses what it has parsed to the same profile: the recipe hands the script a parsed profile, which is parsed again", () => {
    for (const json of [houseJson(), treeJson()]) {
      const once = structure(json);
      expect(structure(once)).toEqual(once);
    }
  });

  it("refuses a tree whose model is not among its kit files", () => {
    const refused = failure(
      edited(treeJson(), (j) => (j.build.model.path = "tree_other.glb")),
    );
    expect(refused.path).toBe("profile.build.model");
  });

  it("refuses a looping state without wind and a still state with several frames", () => {
    expect(failure(edited(treeJson(), (j) => delete j.wind)).path).toBe(
      "profile.clips.intact.loop",
    );
    expect(
      failure(
        edited(houseJson(), (j) => {
          j.clips.intact.frames = 2;
          j.clips.intact.frameMs = [100, 100];
        }),
      ).path,
    ).toBe("profile.clips.intact.frames");
  });

  it("refuses a material the profile does not define, in a state or a decal", () => {
    expect(
      failure(
        edited(houseJson(), (j) => (j.clips.damaged.materials.wall = "lava")),
      ).path,
    ).toBe("profile.clips.damaged.materials.wall");
    expect(
      failure(
        edited(
          houseJson(),
          (j) => (j.clips.damaged.decals[0].material = "lava"),
        ),
      ).path,
    ).toBe("profile.clips.damaged.decals[0].material");
  });

  it("allows decals on a house only and leaves on a tree only", () => {
    const decal = {
      wall: "front",
      at: [1, 1],
      size: [1, 1],
      material: "trunk",
    };
    expect(
      failure(edited(treeJson(), (j) => (j.clips.ruin.decals = [decal]))).path,
    ).toBe("profile.clips.ruin.decals");
    expect(
      failure(edited(houseJson(), (j) => (j.clips.intact.leaves = 1))).path,
    ).toBe("profile.clips.intact.leaves");
    expect(
      failure(edited(treeJson(), (j) => (j.clips.intact.leaves = 1.5))).path,
    ).toBe("profile.clips.intact.leaves");
  });

  it("refuses a pivot outside the cell and an unknown key", () => {
    expect(
      failure(edited(houseJson(), (j) => (j.cell.pivot = [80, 160]))).path,
    ).toBe("profile.cell.pivot");
    expect(failure(edited(houseJson(), (j) => (j.pose = {}))).path).toBe(
      "profile.pose",
    );
  });

  it("refuses wind that cannot loop", () => {
    expect(failure(edited(treeJson(), (j) => (j.wind.cycles = 0))).path).toBe(
      "profile.wind.cycles",
    );
    expect(failure(edited(treeJson(), (j) => (j.wind.cycles = 1.5))).path).toBe(
      "profile.wind.cycles",
    );
  });
});

describe("frameOf", () => {
  const figure = (): ModelProfile => {
    const parsed = parseProfile(readJson("profiles/zeus.json"));
    if (!parsed.ok) throw new Error(parsed.message);
    return parsed.value;
  };

  it("is the camera's cell for a figure, and the very same camera", () => {
    expect(frameOf(figure(), camera)).toBe(camera.cell);
    expect(effectiveCamera(figure(), camera)).toBe(camera);
  });

  it("is the profile's cell for a structure, in an otherwise unchanged camera", () => {
    const house = structure(houseJson());
    expect(frameOf(house, camera)).toBe(house.cell);
    const effective = effectiveCamera(house, camera);
    expect(effective.cell).toEqual(house.cell);
    expect(effective).toEqual({ ...camera, cell: house.cell });
  });
});

describe("the no-stamps hash", () => {
  it("is a constant 64-character digest", () => {
    expect(NO_STAMPS_HASH).toMatch(/^[0-9a-f]{64}$/);
  });
});

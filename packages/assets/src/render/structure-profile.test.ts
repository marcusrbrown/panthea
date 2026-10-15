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
import {
  effectiveCamera,
  frameOf,
  NO_STAMPS_HASH,
  postSettingsFor,
  revisionRecipe,
  shadowRampOf,
} from "./recipe";

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

  it("pins the greek-house and oak-tree profile hashes, so a structure's revision recipe does not move", () => {
    for (const [id, hash] of [
      [
        "greek-house",
        "595a45bb05c3f2702d994329c238c2f6a22f1a3716a0fb02a891744e3cde3ee0",
      ],
      [
        "oak-tree",
        "2449de195bb58d8d138844082a7a9794283df43d9aeb467451180778b6eba6cd",
      ],
    ] as const) {
      const parsed = parseProfile(readJson(`profiles/${id}.json`));
      if (!parsed.ok) throw new Error(parsed.message);
      expect(String(profileHash(parsed.value)), id).toBe(hash);
    }
  });

  it("pins published canon revision recipe hashes: the recipe recomputed from the manifest's recorded inputs is the recorded hash", () => {
    // zeus-retro (a figure), greek-house and oak-tree (structures), as published. The post settings
    // are the part this code builds; every other input is the manifest's own record.
    for (const [id, revision, hash] of [
      [
        "zeus",
        "f254faa3c1fc6fe0ca2ac2b1f88d9556f9dfdd134b4ad9241f77a5fb37369fa6",
        "284c046bb69bd055450e64292a518460f67eb9c17a8ee4fb25232bd65cb67057",
      ],
      [
        "greek-house",
        "ddbfc20b4b6fccac32906a706982874d6852ed6d1a35fb5153781048834a03dc",
        "b658992ea6084ae88925e4cda268a4135cc37bb48e7632d1bca4461afefb301f",
      ],
      [
        "oak-tree",
        "8a1c461e1609d3bc972ed0d3bdbb22d10caf5f6b6277b88c7ccac38ba7338b45",
        "3688cf67dc1556d107fe3568c9fdc83d2d8164f2f5c2c23664788eb27f09022f",
      ],
    ] as const) {
      const manifest = JSON.parse(
        readFileSync(
          join(
            RENDER_ROOT,
            "..",
            "..",
            "content",
            "greek",
            "assets",
            "registry",
            "manifests",
            `${revision}.json`,
          ),
          "utf8",
        ),
      );
      const recorded = manifest.provenance.revisionRecipe;
      expect(recorded.hash, id).toBe(hash);
      const parsed = parseProfile(readJson(`profiles/${id}.json`));
      if (!parsed.ok) throw new Error(parsed.message);
      const recomputed = revisionRecipe({
        profile: profileHash(parsed.value),
        camera: recorded.camera,
        palette: recorded.palette,
        pivot: recorded.pivot,
        script: recorded.script,
        postStep: {
          version: recorded.postStep,
          settings: postSettingsFor(shadowRampOf(parsed.value)),
        },
        blender: {
          version: recorded.blender.version,
          buildHash: recorded.blender.build,
          binarySha256: recorded.blender.sha256,
        },
        kit: recorded.kit,
        stamps: recorded.stamps,
      });
      expect(String(recomputed.hash), id).toBe(hash);
    }
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

  it("lays a decal on the roof, turned by an angle", () => {
    const house = structure(
      edited(houseJson(), (j) => {
        j.clips.damaged.decals.push({
          wall: "roof",
          at: [1, 1],
          size: [0.4, 0.4],
          material: "scorch",
          angle: 20,
        });
      }),
    );
    expect(house.clips.damaged?.decals[1]).toMatchObject({
      wall: "roof",
      angle: 20,
    });
    expect(house.clips.damaged?.decals[0]?.angle).toBeUndefined();
    // The angle is part of what the hash covers.
    expect(profileHash(house)).not.toBe(profileHash(structure(houseJson())));
  });

  it("refuses a decal angle that is not a number and a surface that is not a wall or the roof", () => {
    expect(
      failure(
        edited(houseJson(), (j) => (j.clips.damaged.decals[0].angle = "tilt")),
      ).path,
    ).toBe("profile.clips.damaged.decals[0].angle");
    expect(
      failure(
        edited(houseJson(), (j) => (j.clips.damaged.decals[0].wall = "floor")),
      ).path,
    ).toBe("profile.clips.damaged.decals[0].wall");
  });

  it("names the kit models a house is built with, each among its kit files", () => {
    const withParts = (parts: unknown) =>
      edited(houseJson(), (j) => {
        j.kitFiles = [KIT_FILE];
        j.build = { kind: "house", parts };
      });
    const house = structure(
      withParts({
        column: { kit: KIT_FILE.kit, path: KIT_FILE.path },
      }),
    );
    expect(house.build).toEqual({
      kind: "house",
      parts: { column: { kit: KIT_FILE.kit, path: KIT_FILE.path } },
    });
    expect(structure(houseJson()).build).toEqual({ kind: "house" });
    expect(
      failure(withParts({ column: { kit: KIT_FILE.kit, path: "other.glb" } }))
        .path,
    ).toBe("profile.build.parts.column");
    expect(failure(withParts([])).path).toBe("profile.build.parts");
    // The parts are part of what the hash covers.
    expect(profileHash(house)).not.toBe(profileHash(structure(houseJson())));
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

describe("a ground profile", () => {
  const ground = (): Json => readJson("profiles/grass-flagstone.json");
  const refusal = (value: Json) => {
    const parsed = parseProfile(value);
    if (parsed.ok) throw new Error("expected a refusal");
    return `${parsed.path} ${parsed.message}`;
  };

  it("parses the committed set: N=4, outline off, the 544x256 frame, no kit files", () => {
    const parsed = parseProfile(ground());
    if (!parsed.ok) throw new Error(parsed.message);
    const profile = parsed.value as StructureProfile;
    expect(profile.build.kind).toBe("ground");
    if (profile.build.kind === "ground") expect(profile.build.period).toBe(4);
    expect(profile.outline).toBe(false);
    expect(profile.kitFiles).toEqual([]);
    expect(Object.keys(profile.clips).sort()).toEqual(["base", "over"]);
    expect(profile.cell).toMatchObject({ width: 544, height: 256 });
  });

  it("round-trips: the recipe parses the profile it parsed", () => {
    const once = parseProfile(ground());
    if (!once.ok) throw new Error(once.message);
    const twice = parseProfile(JSON.parse(JSON.stringify(once.value)));
    expect(twice).toEqual(once);
  });

  it("hashes the period, the layout and the stamp parameters", () => {
    const hash = (edit: (v: Json) => void) => {
      const value = ground();
      edit(value);
      const parsed = parseProfile(value);
      if (!parsed.ok) throw new Error(parsed.message);
      return String(profileHash(parsed.value));
    };
    const base = hash(() => undefined);
    for (const edit of [
      (v: Json) => {
        v.build.period = 3;
      },
      (v: Json) => {
        v.build.slab.gap = 0.1;
      },
      (v: Json) => {
        v.build.tuft.perTile = 4;
      },
      (v: Json) => {
        v.build.stamp.noiseSeed = 12;
      },
    ])
      expect(hash(edit)).not.toBe(base);
  });

  it("allows outline false on a ground profile only, and requires it there", () => {
    const house = houseJson();
    house.outline = false;
    expect(refusal(house)).toMatch(/outline/);
    const noOutline = ground();
    delete noOutline.outline;
    expect(refusal(noOutline)).toMatch(/outline/);
    const on = ground();
    on.outline = true;
    expect(refusal(on)).toMatch(/outline/);
  });

  it("takes a period that is a positive integer, and a frame that holds the patch", () => {
    for (const period of [0, 1.5, -1, "4"]) {
      const value = ground();
      value.build.period = period;
      expect(refusal(value), String(period)).toMatch(/build\.period/);
    }
    const small = ground();
    small.cell.width = 300;
    small.cell.pivot = [150, 64];
    expect(refusal(small)).toMatch(/cell/);
    const high = ground();
    high.cell.pivot = [272, 20];
    expect(refusal(high)).toMatch(/cell/);
  });

  it("refuses parameters out of range and keys it does not know", () => {
    const gap = ground();
    gap.build.slab.gap = 0.5;
    expect(refusal(gap)).toMatch(/slab\.gap/);
    const unknown = ground();
    unknown.build.tuft.blades = 3;
    expect(refusal(unknown)).toMatch(/blades/);
    const seed = ground();
    seed.build.stamp.noiseSeed = 1.5;
    expect(refusal(seed)).toMatch(/noiseSeed/);
  });
});

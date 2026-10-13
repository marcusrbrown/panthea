// Model profiles are render inputs (ADR-0012): kit file refs, proportions, garment, hair, the
// stamp set, a clip map and a pose policy keyed by semantic state. The committed Zeus profile is
// checked against the committed kit library; fixtures are derived from it explicitly.

import { afterEach, describe, expect, it } from "bun:test";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../hash";
import { checkKits, type KitManifest, parseKitManifest } from "./kits";
import {
  type ModelProfile,
  parseProfile,
  posePolicy,
  profileHash,
  profileKitProblems,
  profileKitRefs,
  sourceFrameTimes,
} from "./profile";

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
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function committedJson(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(RENDER_ROOT, "profiles", "zeus.json"), "utf8"),
  );
}

function parsed(value: unknown = committedJson()): ModelProfile {
  const result = parseProfile(value);
  if (!result.ok) throw new Error(`${result.path}: ${result.message}`);
  return result.value;
}

function manifest(): KitManifest {
  const result = parseKitManifest(
    JSON.parse(readFileSync(join(RENDER_ROOT, "kits.json"), "utf8")),
  );
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

function edited(change: (profile: Json) => void): Record<string, unknown> {
  const copy = structuredClone(committedJson()) as Json;
  change(copy);
  return copy;
}

describe("the Zeus profile", () => {
  it("parses, and names its subject, stamp set and the semantic states it poses", () => {
    const profile = parsed();
    expect(profile.id).toBe("zeus");
    expect(profile.stampSet).toBe("zeus");
    expect(Object.keys(profile.clips).sort()).toEqual([
      "act",
      "idle",
      "seated",
      "walk",
    ]);
    expect(profile.clips.walk).toEqual({ action: "Walk_Loop", loop: true });
    expect(profile.clips.seated).toEqual({
      action: "Sitting_Idle_Loop",
      loop: true,
    });
    expect(profile.clips.act.loop).toBe(false);
  });

  it("declares the palette ramp its contact shadow is taken from, an olympus ramp", () => {
    expect(parsed().shadow).toEqual({ ramp: "lapis" });
    expect(parseProfile(edited((p) => delete p.shadow)).ok).toBe(false);
    expect(parseProfile(edited((p) => (p.shadow = { ramp: "" }))).ok).toBe(
      false,
    );
    expect(
      parseProfile(edited((p) => (p.shadow = { ramp: "lapis", shade: 1 }))).ok,
    ).toBe(false);
    expect(
      parseProfile(edited((p) => (p.shadow = { ramp: "marble" }))).ok,
    ).toBe(true);
  });

  it("resolves every kit ref in kits.json with a matching hash", () => {
    const profile = parsed();
    expect(profileKitProblems(profile, manifest())).toEqual([]);
    const byPath = new Map(
      manifest().kits.flatMap((kit) =>
        kit.files.map((f) => [`${kit.id}/${f.path}`, f] as const),
      ),
    );
    for (const ref of profile.kitFiles) {
      expect(byPath.get(`${ref.kit}/${ref.path}`)?.sha256).toBe(ref.sha256);
    }
  });

  it("is held by a fresh clone: every kit file it needs is present, hashed and licensed", () => {
    const profile = parsed();
    expect(checkKits(RENDER_ROOT, [profileKitRefs(profile)]).problems).toEqual(
      [],
    );
    for (const ref of profile.kitFiles) {
      const bytes = readFileSync(join(RENDER_ROOT, "kits", ref.kit, ref.path));
      expect(sha256Hex(bytes)).toBe(ref.sha256);
    }
  });

  it("agrees with the kits.json referencedBy lists both ways", () => {
    const profile = parsed();
    const listed = manifest().kits.flatMap((kit) =>
      kit.files
        .filter((f) => f.referencedBy.includes("zeus"))
        .map((f) => `${kit.id}/${f.path}`),
    );
    expect(profile.kitFiles.map((r) => `${r.kit}/${r.path}`).sort()).toEqual(
      listed.sort(),
    );
  });

  it("reads its models only from files it lists", () => {
    const profile = parsed();
    const listed = new Set(profile.kitFiles.map((r) => `${r.kit}/${r.path}`));
    const used = [
      profile.models.body,
      profile.models.animations,
      ...profile.models.hair.map((h) => h.model),
    ];
    for (const model of used)
      expect(listed.has(`${model.kit}/${model.path}`)).toBe(true);
  });

  it("hashes stably and changes with any parameter", () => {
    const base = profileHash(parsed());
    expect(profileHash(parsed())).toBe(base);
    expect(
      profileHash(
        parsed(
          edited((p) => {
            p.body.scale[2] = 0.91;
          }),
        ),
      ),
    ).not.toBe(base);
    expect(
      profileHash(
        parsed(
          edited((p) => {
            p.pose.walk.aims.hand_r[0] = -0.5;
          }),
        ),
      ),
    ).not.toBe(base);
  });
});

describe("kit refs", () => {
  it("refuses a profile naming a kit file that kits.json does not list", () => {
    const profile = parsed(
      edited((p) => {
        p.kitFiles.push({
          kit: "universal-base-characters",
          path: "Missing.gltf",
          sha256: "0".repeat(64),
        });
      }),
    );
    const problems = profileKitProblems(profile, manifest());
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("Missing.gltf");
    // The same file through the gate that also reads kits.json from disk:
    expect(
      checkKits(RENDER_ROOT, [profileKitRefs(profile)]).problems.some((p) =>
        p.file.endsWith("Missing.gltf"),
      ),
    ).toBe(true);
  });

  it("refuses a profile naming a kit that kits.json does not have", () => {
    const profile = parsed(
      edited((p) => {
        p.kitFiles[0].kit = "no-such-kit";
        for (const model of [
          p.models.body,
          p.models.animations,
          ...p.models.hair.map((h: Json) => h.model),
        ]) {
          if (model.path === p.kitFiles[0].path) model.kit = "no-such-kit";
        }
      }),
    );
    expect(profileKitProblems(profile, manifest())[0]).toContain("no-such-kit");
  });

  it("refuses a hash that differs from kits.json (positive control: the committed hash passes)", () => {
    const profile = parsed(
      edited((p) => {
        p.kitFiles[0].sha256 = "f".repeat(64);
      }),
    );
    const problems = profileKitProblems(profile, manifest());
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("sha256");
    expect(profileKitProblems(parsed(), manifest())).toEqual([]);
  });

  it("refuses a referencedBy list that omits the profile, and one that lists a file the profile does not read", () => {
    const root = mkdtempSync(join(tmpdir(), "profile-kits-"));
    dirs.push(root);
    cpSync(RENDER_ROOT, root, {
      recursive: true,
      filter: (s) => !s.includes("scratch"),
    });
    const raw = JSON.parse(readFileSync(join(root, "kits.json"), "utf8"));

    const omitted = structuredClone(raw);
    omitted.kits[0].files[0].referencedBy = [];
    writeFileSync(join(root, "kits.json"), JSON.stringify(omitted));
    const omittedProblems = checkKits(root, [
      profileKitRefs(parsed()),
    ]).problems;
    expect(omittedProblems).toHaveLength(1);
    expect(omittedProblems[0]?.message).toContain("referencedBy omits");

    writeFileSync(join(root, "kits.json"), JSON.stringify(raw));
    expect(checkKits(root, [profileKitRefs(parsed())]).problems).toEqual([]);

    const dropped = profileKitRefs(parsed());
    const stray = checkKits(root, [
      { ...dropped, files: dropped.files.slice(1) },
    ]).problems;
    expect(stray).toHaveLength(1);
    expect(stray[0]?.message).toContain("does not reference this file");
  });
});

describe("parsing", () => {
  it("refuses a model that is not among the kit files", () => {
    expect(
      parseProfile(
        edited((p) => {
          p.models.body.path = "Elsewhere.gltf";
        }),
      ).ok,
    ).toBe(false);
  });

  it("refuses unknown keys, a bad hash and duplicate kit refs", () => {
    expect(
      parseProfile(
        edited((p) => {
          p.cameraId = "other";
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseProfile(
        edited((p) => {
          p.kitFiles[0].sha256 = "xyz";
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseProfile(
        edited((p) => {
          p.kitFiles.push(p.kitFiles[0]);
        }),
      ).ok,
    ).toBe(false);
  });

  it("refuses a pose keyed by an output clip name instead of a semantic state", () => {
    const result = parseProfile(
      edited((p) => {
        p.pose.walk16 = p.pose.walk;
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toContain("walk16");
  });

  it("refuses a pose key naming a facing it does not know, and a clip map missing a state's action", () => {
    expect(
      parseProfile(
        edited((p) => {
          p.pose["walk:up"] = p.pose.walk;
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseProfile(
        edited((p) => {
          delete p.clips.act.action;
        }),
      ).ok,
    ).toBe(false);
  });

  it("refuses a material role that points at no palette ramp id shape, and an empty ring list", () => {
    expect(
      parseProfile(
        edited((p) => {
          p.materials.skin.ramp = "";
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseProfile(
        edited((p) => {
          p.garment.rings = [];
        }),
      ).ok,
    ).toBe(false);
  });
});

describe("the pose policy", () => {
  const profile = parsed();

  it("is keyed by semantic state and facing, the facing refining the state", () => {
    const south = posePolicy(profile, { state: "walk", facing: "south" });
    const west = posePolicy(profile, { state: "walk", facing: "west" });
    expect(south.aims?.hand_r).toBeDefined();
    expect(west.aims?.upperarm_r).not.toEqual(south.aims?.upperarm_r);
  });

  it("is the same for a variant clip as for its semantic state (16 against 8 frames)", () => {
    for (const facing of ["south", "east", "north", "west"] as const) {
      const fine = { state: "walk", facing, frames: 16 } as const;
      const coarse = { state: "walk", facing, frames: 8 } as const;
      expect(posePolicy(profile, coarse)).toEqual(posePolicy(profile, fine));
    }
  });

  it("refuses an output clip name where a semantic state is expected (positive control: the state passes)", () => {
    expect(() =>
      posePolicy(profile, { state: "walk16", facing: "south" }),
    ).toThrow("walk16");
    expect(() =>
      posePolicy(profile, { state: "walk", facing: "south" }),
    ).not.toThrow();
  });

  it("refines an act pose by key pose", () => {
    const carry = posePolicy(profile, { state: "act", facing: "east", key: 0 });
    const release = posePolicy(profile, {
      state: "act",
      facing: "east",
      key: 2,
    });
    expect(carry.aims?.upperarm_r).not.toEqual(release.aims?.upperarm_r);
    expect(carry.mirror).toBe(true);
  });

  it("answers a facing with no entry of its own by the state's policy", () => {
    expect(posePolicy(profile, { state: "idle", facing: "south" })).toEqual(
      profile.pose.idle as never,
    );
    expect(
      posePolicy(profile, { state: "idle", facing: "south" }).mirror,
    ).toBeUndefined();
  });
});

describe("source frame times", () => {
  it("excludes the duplicate endpoint of a loop and includes both ends of a one-shot", () => {
    expect(sourceFrameTimes(0, 8, 4, true)).toEqual([0, 2, 4, 6]);
    expect(sourceFrameTimes(0, 8, 5, false)).toEqual([0, 2, 4, 6, 8]);
    expect(sourceFrameTimes(3, 9, 1, true)).toEqual([3]);
  });

  it("refuses a count below one and a reversed range", () => {
    expect(() => sourceFrameTimes(0, 8, 0, true)).toThrow();
    expect(() => sourceFrameTimes(8, 0, 4, true)).toThrow();
  });

  it("puts every time of the 8-frame walk among the times of the 16-frame walk (ADR-0012 equality)", () => {
    // The pure logic of the probe's check_resample.py: walk[i] is walk16[2i] at the same time.
    for (const [start, end] of [
      [0, 30],
      [1, 36.4],
      [0, 29.33],
      [4.25, 52.75],
    ] as const) {
      const fine = sourceFrameTimes(start, end, 16, true);
      const coarse = sourceFrameTimes(start, end, 8, true);
      const fineSet = new Set(fine);
      expect(coarse.every((t) => fineSet.has(t))).toBe(true);
      for (const [i, t] of coarse.entries()) expect(fine[2 * i]).toBe(t);
    }
  });

  it("has a positive control: a 6-frame walk is not a subset of the 16-frame walk", () => {
    const fineSet = new Set(sourceFrameTimes(0, 30, 16, true));
    expect(sourceFrameTimes(0, 30, 6, true).every((t) => fineSet.has(t))).toBe(
      false,
    );
  });
});

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
      "idle",
      "seated",
      "walk",
    ]);
    expect(profile.clips.walk).toEqual({
      action: "Walk_Loop",
      loop: true,
      frames: 16,
      frameMs: Array.from({ length: 16 }, () => 50),
    });
    expect(profile.clips.seated).toMatchObject({
      action: "Sitting_Idle_Loop",
      loop: true,
    });
    expect(profile.clips.idle).toMatchObject({
      action: "Idle_Loop",
      loop: true,
    });
  });

  it("declares per-state frames and timing: idle 10 x 250 ms, seated 8 frames of 208-209 ms, walk 16 x 50 ms, all looping", () => {
    const { idle, seated, walk } = parsed().clips;
    expect(idle?.frames).toBe(10);
    expect(idle?.frameMs).toEqual(Array.from({ length: 10 }, () => 250));
    expect(seated?.frames).toBe(8);
    expect(seated?.frameMs).toEqual([209, 208, 208, 209, 208, 208, 209, 208]);
    expect(seated?.frameMs.reduce((a, b) => a + b, 0)).toBe(1667);
    expect(walk?.frames).toBe(16);
    expect(walk?.frameMs.every((ms) => ms === 50)).toBe(true);
    for (const clip of [idle, seated, walk]) {
      expect(clip?.loop).toBe(true);
      expect(clip?.frameMs).toHaveLength(clip?.frames as number);
    }
  });

  it("carries no bolt, no carry-arm aims, no act pose and no global adduction: the idle policy plants the legs, the seated corrections stay", () => {
    const profile = parsed();
    expect(JSON.stringify(profile)).not.toMatch(/bolt|schedule|mirror|fist/i);
    expect(Object.keys(profile.pose).sort()).toEqual([
      "idle",
      "seated",
      "walk",
    ]);
    // r7: the torso stays upright over the lap, so the seated forward curl is small.
    expect(profile.pose.seated?.rotations).toEqual({
      spine_02: [4, 0, 0],
      spine_03: [4, 0, 0],
      neck_01: [-4, 0, 0],
    });
    // The hands rest on the lap: each forearm points forward and down toward the thigh, mirrored left to right.
    const arms = profile.pose.seated?.aims;
    for (const side of ["l", "r"] as const) {
      const forearm = arms?.[`lowerarm_${side}`] ?? [0, 0, 0];
      expect(forearm[1]).toBeLessThan(-0.5);
      expect(forearm[2]).toBeLessThan(0);
      expect(arms?.[`upperarm_${side}`]?.[2]).toBeLessThan(-0.5);
    }
    expect(arms?.upperarm_l?.[0]).toBe(-(arms?.upperarm_r?.[0] ?? 0));
    expect(profile.pose.seated?.groundFeet).toBe(true);
    // Arms are aimed in the seated state only (the hands rest on the lap); standing and walking arms hang from the clip.
    for (const [key, entry] of Object.entries(profile.pose))
      for (const bone of Object.keys(entry.aims ?? {}))
        expect(bone).toMatch(
          key === "seated"
            ? /^(upperarm|lowerarm|hand)_[lr]$/
            : /^(thigh|calf|foot|ball)_[lr]$/,
        );
    // The stance is the bearing only: a total spine extension of 4 to 8 degrees, no thigh adduction.
    const stance = profile.body.stance;
    expect(Object.keys(stance).every((bone) => bone.startsWith("spine_"))).toBe(
      true,
    );
    const extension = Object.values(stance).reduce(
      (sum, [x]) => sum + Math.abs(x),
      0,
    );
    expect(extension).toBeGreaterThanOrEqual(4);
    expect(extension).toBeLessThanOrEqual(8);
  });

  it("plants both feet in idle: the right leg comes forward and the feet are separated sideways", () => {
    const aims = parsed().pose.idle?.aims;
    expect(aims?.thigh_l?.[0]).toBeGreaterThan(0);
    expect(aims?.thigh_r?.[0]).toBeLessThan(0);
    // Both soles are aimed alike (toes forward, flat), so neither foot is left behind or tipped.
    expect(aims?.foot_l?.[1]).toBe(aims?.foot_r?.[1]);
    expect(aims?.foot_l?.[2]).toBe(aims?.foot_r?.[2]);
  });

  it("drapes a himation over the character's left shoulder, skinned to the clavicle, spine and pelvis, never to an arm", () => {
    const profile = parsed();
    expect(profile.himation?.role).toBe("himation");
    expect(profile.materials.himation?.ramp).toBe("lapis");
    const bones = new Set(
      (profile.himation?.strips ?? []).flatMap((strip) =>
        strip.weights.flatMap((w) => Object.keys(w.bones)),
      ),
    );
    for (const bone of bones)
      expect(bone).toMatch(/^(clavicle_l|spine_0[123]|pelvis|thigh_[lr])$/);
    expect(bones.has("clavicle_l")).toBe(true);
    expect(bones.has("pelvis")).toBe(true);
    // A strip is an open arc, never a closed ring.
    for (const row of (profile.himation?.strips ?? []).flatMap((s) => s.rows))
      expect(row.toDeg - row.fromDeg).toBeLessThan(360);
  });

  it("keeps hair and beard to 2 or 3 tones and the large surfaces to the camera's 5 bands", () => {
    const { materials } = parsed();
    expect(new Set(materials.beard?.bandShades).size).toBeLessThanOrEqual(3);
    expect(new Set(materials.hair?.bandShades).size).toBeLessThanOrEqual(3);
    expect(new Set(materials.beard?.bandShades).size).toBeGreaterThanOrEqual(2);
    expect(materials.robe?.bandShades).toBeDefined();
    expect(materials.trim?.bandShades).toBeUndefined();
  });

  it("uses olympus ramps only, and the planted-stance proportions of the makeover", () => {
    const profile = parsed();
    expect(
      new Set(Object.values(profile.materials).map((m) => m.ramp)),
    ).toEqual(new Set(["pale-gold", "cloud", "marble", "lapis"]));
    expect(profile.body.scale).toEqual([1.16, 1.08, 1.0]);
    expect(profile.body.footScale).toBe(1);
    expect(profile.body.legs.length).toBeGreaterThanOrEqual(1.0);
    expect(profile.body.legs.length).toBeLessThanOrEqual(1.05);
    expect(profile.body.legs.thickness).toBeGreaterThanOrEqual(1.05);
    expect(profile.body.legs.thickness).toBeLessThanOrEqual(1.1);
    expect(profile.body.curlDeg).toBeGreaterThanOrEqual(30);
    expect(profile.body.curlDeg).toBeLessThanOrEqual(45);
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

  it("no longer reads the kit beard, which stays vendored for the probes with no reference from the profile", () => {
    const kits = manifest().kits.find(
      (k) => k.id === "universal-base-characters",
    );
    for (const file of ["Hair_Beard.bin", "Hair_Beard.gltf"]) {
      expect(kits?.files.find((f) => f.path === file)?.referencedBy).toEqual(
        [],
      );
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
            p.body.legs.thickness = 1.09;
          }),
        ),
      ),
    ).not.toBe(base);
  });
});

describe("the r7 construction of Zeus", () => {
  it("builds the beard for the purpose: a head-weighted mesh, no kit beard, no forward offset", () => {
    const profile = parsed();
    expect(profile.beard?.role).toBe("beard");
    expect(profile.materials.beard?.ramp).toBe("marble");
    // Every hair piece is a kit hair piece: none is the kit beard, and none is pushed forward.
    for (const piece of profile.models.hair) {
      expect(piece.model.path).not.toMatch(/Beard/);
      expect(piece.offset).toBeUndefined();
    }
    expect(profile.kitFiles.some((f) => /Beard/.test(f.path))).toBe(false);
    const strips = profile.beard?.strips ?? [];
    expect(strips.length).toBeGreaterThanOrEqual(2);
    // Skinned to the head only (the beard follows the head's scale and pitch).
    for (const strip of strips)
      for (const weight of strip.weights)
        expect(Object.keys(weight.bones)).toEqual(["Head"]);
    // Cheek roots, a chin mass and a rounded bottom: the strips span the jaw from the cheek to below the chin.
    const rows = strips.flatMap((s) => s.rows);
    expect(Math.max(...rows.map((r) => r.z))).toBeGreaterThan(1.64);
    expect(Math.min(...rows.map((r) => r.z))).toBeLessThan(1.5);
    // Open arcs about the face, never a closed ring around the neck.
    for (const row of rows) expect(row.toDeg - row.fromDeg).toBeLessThan(200);
    // It tapers to a rounded bottom: the last row of the chin mass is narrower than half the first.
    const chin = strips.find((s) => s.name === "chin");
    expect(chin).toBeDefined();
    const chinRows = chin?.rows ?? [];
    expect(
      (chinRows.at(-1)?.halfWidth ?? 1) < (chinRows[0]?.halfWidth ?? 0) / 2,
    ).toBe(true);
  });

  it("shortens the hair curtain at the nape and keeps the parted crown", () => {
    const hair = parsed().models.hair;
    const curtain = hair.find((h) => h.model.path === "Hair_Long.gltf");
    // The kit curtain reaches z 1.50; cutting it at 1.63 (the cheek, above the mouth) ends the side locks at the ear and
    // the back hair at the nape, about 7 projected px shorter, so the hair is no longer one hood around the beard.
    expect(curtain?.cutBelow).toBeGreaterThanOrEqual(1.58);
    expect(curtain?.cutBelow).toBeLessThanOrEqual(1.66);
    expect(hair.some((h) => h.model.path === "Hair_SimpleParted.gltf")).toBe(
      true,
    );
  });

  it("separates hair, cloth and cloak by value: the shade tables of the r7 brief", () => {
    const { materials } = parsed();
    expect(materials.hair).toEqual({
      ramp: "marble",
      bias: 0,
      bandShades: [2, 3, 3, 4, 4],
    });
    expect(materials.beard).toEqual({
      ramp: "marble",
      bias: 0,
      bandShades: [2, 3, 3, 4, 4],
    });
    expect(materials.robe).toEqual({
      ramp: "cloud",
      bias: 0.1,
      bandShades: [2, 3, 4, 5, 5],
    });
    expect(materials.himation).toEqual({
      ramp: "lapis",
      bias: 0,
      bandShades: [1, 1, 2, 2, 3],
    });
    // The cloak tops out at lapis 3; the chiton is the lightest large mass.
    expect(Math.max(...(materials.himation?.bandShades ?? []))).toBe(3);
    expect(Math.max(...(materials.robe?.bandShades ?? []))).toBeGreaterThan(
      Math.max(...(materials.himation?.bandShades ?? [])),
    );
  });

  it("gives the face deliberate planes: a calmer skin table and a smaller head pitch", () => {
    const profile = parsed();
    expect(profile.materials.skin).toEqual({
      ramp: "pale-gold",
      bias: 0,
      bandShades: [2, 3, 3, 4, 4],
    });
    expect(profile.body.headPitchDeg).toBe(-12);
    expect(profile.body.headScale).toBe(1.75);
  });

  it("seats the figure in a garment of its own: a lap panel over the thighs, knee transitions and shin drapes", () => {
    const seated = parsed().garment.seated;
    expect(seated).toBeDefined();
    if (seated === undefined) return;
    // The torso is the standing garment's own upper rings, so it is one chiton.
    expect(seated.keepRings).toBeGreaterThanOrEqual(5);
    expect(seated.keepRings).toBeLessThanOrEqual(7);
    const rows = seated.legs;
    const thigh = rows.filter((r) => (r.weights.thigh ?? 0) >= 1);
    const shin = rows.filter((r) => (r.weights.calf ?? 0) >= 1);
    const knee = rows.filter(
      (r) => (r.weights.thigh ?? 0) > 0 && (r.weights.calf ?? 0) > 0,
    );
    expect(thigh.length).toBeGreaterThanOrEqual(2);
    expect(shin.length).toBeGreaterThanOrEqual(2);
    expect(knee.length).toBeGreaterThanOrEqual(1);
    // Rows run top to bottom and the hem stays above the foot: toes show.
    for (let i = 1; i < rows.length; i += 1)
      expect((rows[i]?.z ?? 0) < (rows[i - 1]?.z ?? 0)).toBe(true);
    expect(rows.at(-1)?.z).toBeGreaterThanOrEqual(0.15);
    // The shin drapes stand apart: a shadow cleft of at least 0.04 between them in front view.
    const hem = rows.at(-1);
    expect((hem?.centreX ?? 0) - (hem?.halfWidth ?? 0)).toBeGreaterThanOrEqual(
      0.02,
    );
    // The lap panel is broad: the thigh rows reach the centre line.
    const top = rows[0];
    expect((top?.centreX ?? 1) - (top?.halfWidth ?? 0)).toBeLessThanOrEqual(0);
  });

  it("gives the mantle two readable creases and a lower panel that follows the pelvis, not the thighs", () => {
    const mantle = parsed().himation?.strips.find((s) => s.name === "mantle");
    expect(mantle?.creases).toHaveLength(2);
    for (const crease of mantle?.creases ?? []) {
      expect(crease.depth).toBeGreaterThanOrEqual(0.03);
      expect(crease.depth).toBeLessThanOrEqual(0.05);
      expect(crease.at).toBeGreaterThan(0);
      expect(crease.at).toBeLessThan(1);
    }
    const at = (z: number) => mantle?.weights.find((w) => w.z === z)?.bones;
    expect(at(0.95)).toEqual({ spine_01: 0.3, pelvis: 0.7 });
    expect(at(0.55)).toEqual({ pelvis: 1 });
    // The exposed right shoulder and the cloak's width are kept.
    const widest = Math.max(...(mantle?.rows ?? []).map((r) => r.halfWidth));
    expect(widest).toBeGreaterThanOrEqual(0.33);
  });

  it("tempers the walk around its neutral pose: legs 75%, arm swing 60%, root bob 50%", () => {
    const walk = parsed().pose.walk;
    expect(walk?.damp?.thigh_l).toBe(0.75);
    expect(walk?.damp?.thigh_r).toBe(0.75);
    expect(walk?.damp?.calf_l).toBe(0.75);
    expect(walk?.damp?.calf_r).toBe(0.75);
    for (const bone of ["upperarm_l", "upperarm_r"])
      expect(walk?.damp?.[bone]).toBe(0.6);
    expect(walk?.dampLocation?.pelvis).toBe(0.5);
    // Walk keeps the clip's feet: it is tempered, not re-aimed, and each frame's lowest sole is set on the ground.
    expect(walk?.aims).toBeUndefined();
    expect(walk?.groundFeet).toBe(true);
    expect(parsed().pose.idle?.groundFeet).toBeUndefined();
    expect(
      posePolicy(parsed(), { state: "walk", facing: "east" }).groundFeet,
    ).toBe(true);
  });

  it("refuses a malformed crease, damp factor, curtain cut or seated garment", () => {
    const bad = (change: (p: Json) => void) => parseProfile(edited(change)).ok;
    expect(bad(() => {})).toBe(true);
    expect(bad((p) => (p.himation.strips[0].creases[0].depth = -0.01))).toBe(
      false,
    );
    expect(bad((p) => (p.himation.strips[0].creases[0].at = 1.5))).toBe(false);
    expect(bad((p) => (p.himation.strips[0].creases[0].width = 0))).toBe(false);
    expect(bad((p) => (p.himation.strips[0].creases[0].extra = 1))).toBe(false);
    expect(bad((p) => (p.pose.walk.damp.thigh_l = 1.5))).toBe(false);
    expect(bad((p) => (p.pose.walk.damp.thigh_l = -0.1))).toBe(false);
    expect(bad((p) => (p.pose.walk.dampLocation.pelvis = 2))).toBe(false);
    expect(bad((p) => (p.pose.walk.groundFeet = "yes"))).toBe(false);
    expect(bad((p) => (p.models.hair[1].cutBelow = "low"))).toBe(false);
    expect(bad((p) => (p.garment.seated.keepRings = 1))).toBe(false);
    expect(bad((p) => (p.garment.seated.keepRings = 99))).toBe(false);
    expect(bad((p) => (p.garment.seated.legs = []))).toBe(false);
    expect(bad((p) => delete p.garment.seated.legs[0].weights)).toBe(false);
    expect(bad((p) => (p.garment.seated.legs[0].material = 2))).toBe(false);
    expect(
      bad((p) => {
        const legs = p.garment.seated.legs;
        [legs[0], legs[1]] = [legs[1], legs[0]];
      }),
    ).toBe(false);
    expect(bad((p) => (p.beard.role = "no-such-role"))).toBe(false);
    expect(bad((p) => delete p.beard)).toBe(true);
  });

  it("hashes the new fields: a beard row, a crease and the seated garment each change the profile", () => {
    const base = profileHash(parsed());
    const changed = (change: (p: Json) => void) =>
      profileHash(parsed(edited(change)));
    expect(
      changed((p) => (p.beard.strips[0].rows[0].halfWidth += 0.01)),
    ).not.toBe(base);
    expect(
      changed((p) => (p.himation.strips[0].creases[0].depth = 0.031)),
    ).not.toBe(base);
    expect(
      changed((p) => (p.garment.seated.legs[0].halfWidth += 0.01)),
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
    const long = omitted.kits[0].files.find(
      (f: Json) => f.path === "Hair_Long.bin",
    );
    long.referencedBy = [];
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
        p.pose.walk16 = p.pose.seated;
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toContain("walk16");
  });

  it("refuses a pose key naming a facing it does not know, and a clip map missing a state's action", () => {
    expect(
      parseProfile(
        edited((p) => {
          p.pose["walk:up"] = p.pose.seated;
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseProfile(
        edited((p) => {
          delete p.clips.seated.action;
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

  it("is keyed by semantic state and facing, the facing entry refining the state's", () => {
    const refined = parsed(
      edited((p) => {
        p.pose["idle:west"] = { aims: { thigh_l: [0.2, 0, -1] } };
      }),
    );
    const south = posePolicy(refined, { state: "idle", facing: "south" });
    const west = posePolicy(refined, { state: "idle", facing: "west" });
    expect(south.aims?.thigh_l).toEqual([0.07, 0, -1]);
    expect(west.aims?.thigh_l).toEqual([0.2, 0, -1]);
    // The facing entry replaces one bone and leaves the state's others.
    expect(west.aims?.thigh_r).toEqual(south.aims?.thigh_r);
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

  it("has no act state to pose (deferred), and no key-pose or mirror field", () => {
    expect(() => posePolicy(profile, { state: "act", facing: "east" })).toThrow(
      "act",
    );
    expect(
      parseProfile(
        edited((p) => {
          p.pose["idle:south:1"] = { aims: { thigh_l: [0, 0, -1] } };
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseProfile(
        edited((p) => {
          p.pose.idle.mirror = true;
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseProfile(
        edited((p) => {
          p.clips.idle.schedule = [[0, 1, 0.5]];
        }),
      ).ok,
    ).toBe(false);
  });

  it("answers a facing with no entry of its own by the state's policy", () => {
    expect(posePolicy(profile, { state: "idle", facing: "south" })).toEqual(
      profile.pose.idle as never,
    );
  });
});

describe("frames and timing in the profile", () => {
  it("parses one duration for every frame, or one per frame, and refuses a mismatch, a zero and a missing count (positive control: the committed profile parses)", () => {
    expect(parseProfile(committedJson()).ok).toBe(true);
    const clip = (change: (clip: Json) => void) =>
      parseProfile(edited((p) => change(p.clips.idle)));
    const single = clip((c) => {
      c.frames = 6;
      c.frameMs = 300;
    });
    expect(single.ok && single.value.clips.idle?.frameMs).toEqual([
      300, 300, 300, 300, 300, 300,
    ]);
    expect(
      clip((c) => {
        c.frames = 3;
        c.frameMs = [100, 200, 300];
      }).ok,
    ).toBe(true);
    expect(
      clip((c) => {
        c.frameMs = [100, 200];
      }).ok,
    ).toBe(false);
    expect(
      clip((c) => {
        c.frameMs = 0;
      }).ok,
    ).toBe(false);
    expect(
      clip((c) => {
        c.frames = 0;
      }).ok,
    ).toBe(false);
    expect(
      clip((c) => {
        delete c.frames;
      }).ok,
    ).toBe(false);
    expect(
      clip((c) => {
        delete c.frameMs;
      }).ok,
    ).toBe(false);
  });

  it("hashes the timing: a changed duration is a changed profile", () => {
    const base = profileHash(parsed());
    expect(
      profileHash(
        parsed(
          edited((p) => {
            p.clips.walk.frameMs = 60;
          }),
        ),
      ),
    ).not.toBe(base);
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

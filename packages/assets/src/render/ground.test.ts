// A ground set's patch: the geometry it is drawn on, the periodic mosaic through the post step, the
// palette it uses, and the render engine's handling of a tile request against the scripted fake
// Blender. The same patch gate on the real Blender is in structure-live.test.ts (opt-in).

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  groundMosaic,
  patchGate,
  RAW_STEP,
  rhombusPixels,
} from "../../test/render/ground-mosaic";
import {
  closeRigs,
  content,
  drain,
  jobsById,
  openRig,
  RENDER_ROOT,
  submitTile,
} from "../../test/render/rig";
import { tileDiamondRow } from "../conformance";
import { decodePng } from "../studio/png/decode";
import { cameraHash, parseCamera } from "./camera";
import { GROUND_HALO, groundCrop, periodBox, tileSideM } from "./ground";
import { checkKits } from "./kits";
import { loadRenderInputs } from "./load";
import { cellPixelHash, postProcessSlot } from "./post";
import { postPaletteFrom } from "./post-palette";
import { profileKitRefs } from "./profile";
import {
  effectiveCamera,
  groundPostOf,
  postSettingsFor,
  postStepSettings,
} from "./recipe";

afterEach(closeRigs);

const inputs = loadRenderInputs(RENDER_ROOT);
const camera = (() => {
  const parsed = parseCamera(
    JSON.parse(readFileSync(join(RENDER_ROOT, "camera.json"), "utf8")),
  );
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
})();
const profile = (() => {
  const found = inputs.profiles.find((p) => p.id === "grass-flagstone");
  if (found?.kind !== "structure" || found.build.kind !== "ground")
    throw new Error("no grass-flagstone ground profile");
  return found;
})();
const build = profile.build as Extract<
  typeof profile.build,
  { kind: "ground" }
>;
const N = build.period;
const pivot = profile.cell.pivot;

const postPalette = (() => {
  const palette = postPaletteFrom(content.palettes, "greek-retro");
  if (!palette.ok) throw new Error(palette.message);
  return palette.value;
})();

/** The ground basis and the camera axes, as render.py computes them. */
function projectLatticeStep(axis: "i" | "j", steps: number): [number, number] {
  const [ax, ay, az] = camera.rotationDeg.map((d) => (d * Math.PI) / 180) as [
    number,
    number,
    number,
  ];
  const [cx, sx, cy, sy, cz, sz] = [
    Math.cos(ax),
    Math.sin(ax),
    Math.cos(ay),
    Math.sin(ay),
    Math.cos(az),
    Math.sin(az),
  ] as const;
  const m = [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ] as const;
  const right = [m[0][0], m[1][0], m[2][0]] as const;
  const up = [m[0][1], m[1][1], m[2][1]] as const;
  // Solve [right.xy; up.xy] * e = target for the ground direction that draws as a 2:1 diamond edge.
  const target = axis === "i" ? [1, -0.5] : [-1, -0.5];
  const det = right[0] * up[1] - right[1] * up[0];
  const ex = (target[0] as number) * up[1] - right[1] * (target[1] as number);
  const ey = right[0] * (target[1] as number) - up[0] * (target[0] as number);
  const norm = Math.hypot(ex / det, ey / det);
  const e = [ex / det / norm, ey / det / norm, 0] as const;
  const dot = (a: readonly number[], b: readonly number[]) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const length = tileSideM(camera.pixelsPerUnit) * steps;
  const scale = camera.pixelsPerUnit * camera.supersample * length;
  return [scale * dot(e, right), -scale * dot(e, up)];
}

describe("the lattice is pixel-aligned", () => {
  test("one lattice step projects to exactly 128x64 raw pixels along each axis, and one period to 512x256", () => {
    expect(camera.supersample).toBe(4);
    const [ix, iy] = projectLatticeStep("i", 1);
    expect(ix).toBeCloseTo(128, 9);
    expect(iy).toBeCloseTo(64, 9);
    const [jx, jy] = projectLatticeStep("j", 1);
    expect(jx).toBeCloseTo(-128, 9);
    expect(jy).toBeCloseTo(64, 9);
    const [px, py] = projectLatticeStep("i", N);
    expect(px).toBeCloseTo(512, 8);
    expect(py).toBeCloseTo(256, 8);
    expect([RAW_STEP.x, RAW_STEP.y]).toEqual([128, 64]);
  });

  test("the tile side is derived from the pixels per unit, and the script computes it the same way", () => {
    expect(tileSideM(camera.pixelsPerUnit)).toBeCloseTo(
      (32 * Math.SQRT2) / camera.pixelsPerUnit,
      12,
    );
    expect(tileSideM(10)).toBeCloseTo(tileSideM(20) * 2, 12);
    const script = readFileSync(
      join(RENDER_ROOT, "blender", "render.py"),
      "utf8",
    );
    expect(script).toContain("32.0 * math.sqrt(2.0) / ppu");
  });

  test("the patch is the period's box and a 32 px halo, and sits inside the frame with the shifted periods", () => {
    expect(GROUND_HALO).toBe(32);
    expect(periodBox(N, pivot)).toEqual({ x: 144, y: 48, w: 256, h: 128 });
    const crop = groundCrop(N, pivot);
    expect(crop).toEqual({ x: 112, y: 16, w: 320, h: 192 });
    expect(crop.x + crop.w).toBeLessThanOrEqual(profile.cell.width);
    expect(crop.y + crop.h).toBeLessThanOrEqual(profile.cell.height);
    // Every rhombus pixel and its copy a period along either lattice axis lies in the frame.
    for (const [x, y] of rhombusPixels(N, pivot)) {
      for (const [dx, dy] of [
        [32 * N, 16 * N],
        [-32 * N, 16 * N],
      ] as const) {
        expect(x + dx).toBeGreaterThanOrEqual(0);
        expect(x + dx).toBeLessThan(profile.cell.width);
        expect(y + dy).toBeLessThan(profile.cell.height);
      }
    }
  });

  test("the rhombus is N squared diamonds that tile it exactly", () => {
    const pixels = rhombusPixels(N, pivot);
    expect(new Set(pixels.map(([x, y]) => `${x},${y}`)).size).toBe(
      pixels.length,
    );
    let diamond = 0;
    for (let row = 0; row < 31; row += 1) {
      const span = tileDiamondRow(row);
      if (span !== null) diamond += span.x1 - span.x0;
    }
    expect(pixels.length).toBe(N * N * diamond);
  });
});

describe("the post step on a ground profile", () => {
  const ground = groundPostOf(profile);

  test("takes no outline and the patch crop from the profile, and records both in the revision settings", () => {
    expect(ground).toEqual({ outline: false, crop: groundCrop(N, pivot) });
    expect(postSettingsFor(undefined, ground)).toEqual({
      overlapThresholdM: 0.05,
      shadow: null,
      outline: false,
      crop: { x: 112, y: 16, w: 320, h: 192 },
    });
    // Every other profile's settings carry neither key.
    expect(postSettingsFor(undefined)).toEqual({
      overlapThresholdM: 0.05,
      shadow: null,
    });
    expect("outline" in postSettingsFor("lapis")).toBe(false);
    for (const other of inputs.profiles.filter((p) => p.id !== profile.id))
      expect(groundPostOf(other)).toBeUndefined();
  });

  test("passes the camera's frame through as the cell, with the origin at the pivot", () => {
    const effective = effectiveCamera(profile, camera);
    const settings = postStepSettings(
      effective,
      { x: 32, y: 16 },
      postSettingsFor(undefined, ground),
    );
    expect(settings.cell).toEqual({ w: 544, h: 256 });
    expect(settings.originPx).toEqual([272, 64]);
    expect(settings.outline).toBe(false);
    expect(settings.crop).toEqual(groundCrop(N, pivot));
    expect(cameraHash(effective)).not.toBe(cameraHash(camera));
  });
});

describe("the patch gate over a generated periodic mosaic", () => {
  const rampOf = (id: string) =>
    postPalette.ramps.get(id) as readonly (readonly [number, number, number])[];
  const frame = effectiveCamera(profile, camera).cell;
  const rawOrigin = [pivot[0] * 4, pivot[1] * 4] as const;

  function post(role: "base" | "over", period = N, crop = false) {
    const mosaic = groundMosaic({
      role,
      period,
      width: frame.width * 4,
      height: frame.height * 4,
      origin: rawOrigin,
      depthRange: camera.depthRange,
      olive: rampOf("olive"),
      stone: rampOf("stone-sky"),
    });
    const settings = postStepSettings(
      effectiveCamera(profile, camera),
      { x: 32, y: 16 },
      postSettingsFor(undefined, crop ? groundPostOf(profile) : undefined),
    );
    const result = postProcessSlot({
      slot: role,
      settings: { ...settings, outline: false },
      palette: postPalette,
      frames: [
        {
          name: role,
          facing: "south",
          colour: mosaic.colour,
          id: mosaic.id,
          depth: mosaic.depth,
        },
      ],
    });
    if (!result.ok) throw new Error(result.message);
    return result.cells[0]?.image as NonNullable<
      (typeof result.cells)[number]
    >["image"];
  }

  for (const role of ["base", "over"] as const) {
    test(`${role}: the centre period equals itself one period along each lattice axis, byte for byte`, () => {
      const gate = patchGate(post(role), N, pivot);
      expect(gate.compared).toBeGreaterThan(0);
      expect(gate).toMatchObject({
        alongI: 0,
        alongJ: 0,
        transparent: 0,
        outside: 0,
      });
    });
  }

  test("the gate sees a mosaic that is not periodic in N (control)", () => {
    const gate = patchGate(post("over", N - 1), N, pivot);
    expect(gate.alongI + gate.alongJ).toBeGreaterThan(0);
  });

  test("the cropped patch is the uncropped cell's patch, and a different period moves it", () => {
    const whole = post("base");
    const cropped = post("base", N, true);
    const crop = groundCrop(N, pivot);
    expect([cropped.width, cropped.height]).toEqual([crop.w, crop.h]);
    for (let y = 0; y < crop.h; y += 1)
      for (let x = 0; x < crop.w; x += 1) {
        const from = ((crop.y + y) * whole.width + crop.x + x) * 4;
        const to = (y * crop.w + x) * 4;
        if (
          whole.rgba[from] !== cropped.rgba[to] ||
          whole.rgba[from + 3] !== cropped.rgba[to + 3]
        )
          throw new Error(`the patch differs at (${x},${y})`);
      }
    expect(cellPixelHash(post("base", N, true))).not.toBe(
      cellPixelHash(post("over", N, true)),
    );
  });
});

describe("the colours of the ground profile", () => {
  test("every shade a ground material can draw snaps to itself in the palette", () => {
    const used = new Set<string>();
    for (const [name, role] of Object.entries(profile.materials)) {
      const shades = postPalette.ramps.get(role.ramp);
      if (shades === undefined)
        throw new Error(`${name}: no ramp ${role.ramp}`);
      const bands = role.bandShades ?? camera.shading.bandShades;
      for (const shade of bands) {
        const colour = shades[shade];
        if (colour === undefined) throw new Error(`${name}: no shade ${shade}`);
        expect([...postPalette.snap(colour)]).toEqual([...colour]);
        used.add(colour.join(","));
      }
    }
    expect(used.size).toBeGreaterThan(4);
  });

  test("the ground materials use the olive and stone-sky ramps of the town family only", () => {
    expect(
      [...new Set(Object.values(profile.materials).map((m) => m.ramp))].sort(),
    ).toEqual(["olive", "stone-sky"]);
  });
});

describe("kits", () => {
  test("a ground profile lists no kit files and passes the kit gate", () => {
    expect(profile.kitFiles).toEqual([]);
    expect(checkKits(RENDER_ROOT, [profileKitRefs(profile)]).problems).toEqual(
      [],
    );
  });
});

describe("a tile render job through the engine", () => {
  const T = 90_000;

  test(
    "renders base and over to the patch crop, under one revision that records no outline and the crop",
    async () => {
      const rig = await openRig({ launches: [{}] });
      const ids = submitTile(rig, "grass-flagstone-set");
      const result = await drain(rig);
      expect(result.results.map((r) => r.outcome)).toEqual([
        "rendered",
        "rendered",
      ]);
      const crop = groundCrop(N, pivot);
      const manifests: {
        slot: { state: string; clip: string; facing: string; frames: number };
        revisionRecipeHash: string;
        revision: {
          pivot: { x: number; y: number };
          postStep: { settings: Record<string, unknown> };
        };
        frames: { cell: string; raw: Record<string, string> }[];
      }[] = [];
      for (const id of ids) {
        const record = jobsById(rig)[id];
        if (record?.job.status !== "succeeded")
          throw new Error(`${id} did not succeed: ${record?.job.status}`);
        expect(record.job.outputs).toHaveLength(1);
        const bytes = rig.session.store.readBlob(
          record.engine?.settings.manifest as never,
        );
        manifests.push(JSON.parse(new TextDecoder().decode(bytes)));
        const first = manifests.at(-1)?.frames[0];
        const cell = decodePng(
          rig.session.store.readBlob(first?.cell as never) as Uint8Array,
        );
        if (!cell.ok) throw new Error("cell does not decode");
        expect([cell.image.width, cell.image.height]).toEqual([crop.w, crop.h]);
      }
      expect(manifests.map((m) => m.slot.state)).toEqual(["base", "over"]);
      expect(manifests.map((m) => m.slot.facing)).toEqual(["south", "south"]);
      expect(manifests.map((m) => m.slot.frames)).toEqual([1, 1]);
      expect(manifests[0]?.revisionRecipeHash).toBe(
        manifests[1]?.revisionRecipeHash as string,
      );
      expect(manifests[0]?.revision.pivot).toEqual({ x: 32, y: 16 });
      expect(manifests[0]?.revision.postStep.settings).toMatchObject({
        outline: false,
        crop,
      });
    },
    T,
  );

  test(
    "the stored raw frames post to a patch whose centre period repeats along both lattice axes",
    async () => {
      const rig = await openRig({ launches: [{}] });
      const ids = submitTile(rig, "grass-flagstone-gate");
      await drain(rig);
      for (const id of ids) {
        const record = jobsById(rig)[id];
        const manifest = JSON.parse(
          new TextDecoder().decode(
            rig.session.store.readBlob(
              record?.engine?.settings.manifest as never,
            ),
          ),
        ) as { frames: { raw: Record<"colour" | "id" | "depth", string> }[] };
        const raw = manifest.frames[0]?.raw as Record<
          "colour" | "id" | "depth",
          string
        >;
        const pass = (name: "colour" | "id" | "depth") => {
          const decoded = decodePng(
            rig.session.store.readBlob(raw[name] as never) as Uint8Array,
          );
          if (!decoded.ok) throw new Error(`${name} does not decode`);
          return decoded.image;
        };
        const settings = postStepSettings(
          effectiveCamera(profile, camera),
          { x: 32, y: 16 },
          postSettingsFor(undefined, {
            outline: false,
            crop: groundCrop(N, pivot),
          }),
        );
        const posted = postProcessSlot({
          slot: id,
          settings: {
            cell: settings.cell,
            originPx: settings.originPx,
            pivotPx: settings.pivotPx,
            depthRange: settings.depthRange,
            overlapThresholdM: settings.overlapThresholdM,
            shadow: null,
            outline: false,
          },
          palette: postPalette,
          frames: [
            {
              name: id,
              facing: "south",
              colour: pass("colour"),
              id: pass("id"),
              depth: pass("depth"),
            },
          ],
        });
        if (!posted.ok) throw new Error(posted.message);
        expect(
          patchGate(posted.cells[0]?.image as never, N, pivot),
        ).toMatchObject({
          alongI: 0,
          alongJ: 0,
          transparent: 0,
          outside: 0,
        });
      }
    },
    T,
  );
});

// Structures rendered by the real, pinned, headless Blender. Opt in with PANTHEA_LIVE_BLENDER=1
// (`PANTHEA_LIVE_BLENDER=1 bun test packages/assets/src/render/structure-live.test.ts`); the executable is read
// from PANTHEA_BLENDER or the macOS bundle path.
// The default run uses the fake Blender and does not cover what only the real script can show:
// the silhouette of a damaged house, and the seam of the tree's wind loop.

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  approvedPalettes,
  closeRigs,
  content,
  drain,
  jobsById,
  openRig,
  pickAll,
  RENDER_ROOT,
  type Rig,
  registryOf,
  renderTile,
  submitRender,
  submitTile,
  TILE_PACK_INPUT,
} from "../../test/render/rig";
import type { RgbaImage } from "../conformance";
import { decodePng } from "../studio/png/decode";
import { auditRendered } from "./audit";
import { BLENDER_PIN } from "./engine";
import { groundCrop, patchGate } from "./ground";
import { loadRenderInputs } from "./load";
import { postProcessSlot } from "./post";
import { postPaletteFrom } from "./post-palette";
import {
  effectiveCamera,
  groundPostOf,
  postSettingsFor,
  postStepSettings,
} from "./recipe";

afterEach(closeRigs);

const optedIn = process.env.PANTHEA_LIVE_BLENDER === "1";
const BLENDER =
  process.env.PANTHEA_BLENDER ??
  "/Applications/Blender.app/Contents/MacOS/Blender";
const live = optedIn && existsSync(BLENDER) ? test : test.skip;
const T = 280_000;

/**
 * Renders `slots` of a structure with the real Blender: the cells of each slot in frame order, and the raw colour pass
 * (the supersampled render before the post step) of each frame.
 */
async function render(
  subject: string,
  pivot: { x: number; y: number },
  slots: readonly string[],
): Promise<{
  rig: Rig;
  cells: Record<string, RgbaImage[]>;
  raw: Record<string, RgbaImage[]>;
}> {
  const rig = await openRig({
    executable: BLENDER,
    pin: BLENDER_PIN,
    watchdogMs: 120_000,
  });
  const ids = submitRender(
    rig,
    `${subject}-live`,
    slots.map((state) => ({ state, direction: "south" })),
    { subject, pivot },
  );
  const result = await drain(rig);
  for (const entry of result.results)
    if (entry.outcome !== "rendered")
      throw new Error(`${entry.jobId}: ${entry.outcome}`);
  const cells: Record<string, RgbaImage[]> = {};
  const raw: Record<string, RgbaImage[]> = {};
  for (const [index, id] of ids.entries()) {
    const record = jobsById(rig)[id];
    if (record?.job.status !== "succeeded") throw new Error(`${id} failed`);
    const manifest = JSON.parse(
      new TextDecoder().decode(
        rig.session.store.readBlob(record.engine?.settings.manifest as never),
      ),
    ) as { frames: { raw: { colour: string } }[] };
    raw[slots[index] as string] = manifest.frames.map((frame) => {
      const decoded = decodePng(
        rig.session.store.readBlob(frame.raw.colour as never) as Uint8Array,
      );
      if (!decoded.ok) throw new Error("raw frame does not decode");
      return decoded.image;
    });
    cells[slots[index] as string] = record.job.outputs.map((output) => {
      const decoded = decodePng(
        rig.session.store.readBlob(output.hash) as Uint8Array,
      );
      if (!decoded.ok) throw new Error("cell does not decode");
      return decoded.image;
    });
  }
  return { rig, cells, raw };
}

/** Opaque pixels of `a` where `b` is transparent. */
const outside = (a: RgbaImage, b: RgbaImage): number => {
  let count = 0;
  for (let i = 0; i < a.width * a.height; i += 1)
    if (a.rgba[i * 4 + 3] !== 0 && b.rgba[i * 4 + 3] === 0) count += 1;
  return count;
};

/** Opaque pixels of `a` that lie outside `b`'s silhouette: the transparent pixels of `b` reachable from its border. */
const outsideFilled = (a: RgbaImage, b: RgbaImage): number => {
  const { width, height } = b;
  const reached = new Uint8Array(width * height);
  const stack: number[] = [];
  const visit = (x: number, y: number) => {
    const at = y * width + x;
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    if (reached[at] === 1 || b.rgba[at * 4 + 3] !== 0) return;
    reached[at] = 1;
    stack.push(at);
  };
  for (let x = 0; x < width; x += 1) {
    visit(x, 0);
    visit(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    visit(0, y);
    visit(width - 1, y);
  }
  while (stack.length > 0) {
    const at = stack.pop() as number;
    const x = at % width;
    const y = Math.floor(at / width);
    visit(x + 1, y);
    visit(x - 1, y);
    visit(x, y + 1);
    visit(x, y - 1);
  }
  let count = 0;
  for (let i = 0; i < width * height; i += 1)
    if (a.rgba[i * 4 + 3] !== 0 && reached[i] === 1) count += 1;
  return count;
};

const alpha = (image: RgbaImage): number[] =>
  Array.from({ length: image.width * image.height }, (_, i) =>
    image.rgba[i * 4 + 3] === 0 ? 0 : 1,
  );

describe("a house rendered by the real Blender", () => {
  live(
    "damaged keeps intact's alpha silhouette, and ruin does not",
    async () => {
      const { cells } = await render("greek-house", { x: 96, y: 136 }, [
        "intact",
        "damaged",
        "ruin",
      ]);
      const [intact] = cells.intact as [RgbaImage];
      const [damaged] = cells.damaged as [RgbaImage];
      const [ruin] = cells.ruin as [RgbaImage];
      expect(alpha(damaged)).toEqual(alpha(intact));
      // The colours did change: the same shape is not the same picture.
      expect(Buffer.from(damaged.rgba).equals(Buffer.from(intact.rgba))).toBe(
        false,
      );
      expect(alpha(ruin)).not.toEqual(alpha(intact));
    },
    T,
  );
});

/** Pixels that differ between two cells. */
const differing = (a: RgbaImage, b: RgbaImage): number => {
  let count = 0;
  for (let at = 0; at < a.rgba.length; at += 4)
    for (let k = 0; k < 4; k += 1)
      if (a.rgba[at + k] !== b.rgba[at + k]) {
        count += 1;
        break;
      }
  return count;
};

describe("a tree rendered by the real Blender", () => {
  live(
    "its wind loop is seamless: the step from the last frame back to the first is no bigger than the steps between the others",
    async () => {
      const { cells } = await render("oak-tree", { x: 96, y: 164 }, ["intact"]);
      const frames = cells.intact as RgbaImage[];
      expect(frames).toHaveLength(12);
      const steps = frames.map((frame, i) =>
        differing(frame, frames[(i + 1) % frames.length] as RgbaImage),
      );
      const wrap = steps[frames.length - 1] as number;
      const inner = steps.slice(0, -1);
      // The tree moves, and the wrap-around is one more of those steps.
      expect(Math.min(...inner)).toBeGreaterThan(0);
      expect(wrap).toBeGreaterThan(0);
      expect(wrap).toBeLessThanOrEqual(Math.max(...inner) * 1.25);
    },
    T,
  );

  live(
    "damaged keeps the trunk and drops the crown's leaves, and the ruin is a still stump",
    async () => {
      const { cells } = await render("oak-tree", { x: 96, y: 164 }, [
        "intact",
        "damaged",
        "ruin",
      ]);
      expect(cells.damaged).toHaveLength(12);
      expect(cells.ruin).toHaveLength(1);
      const [intact] = cells.intact as RgbaImage[];
      const [ruin] = cells.ruin as RgbaImage[];
      const count = (image: RgbaImage) =>
        alpha(image).reduce((n, v) => n + v, 0);
      expect(count(ruin as RgbaImage)).toBeLessThan(
        count(intact as RgbaImage) / 5,
      );
    },
    T,
  );

  live(
    "damaged has no limb or twig the intact tree does not have: its alpha is a subset of intact's in every frame of the loop",
    async () => {
      const { cells, raw } = await render("oak-tree", { x: 96, y: 164 }, [
        "intact",
        "damaged",
      ]);
      const intact = cells.intact as RgbaImage[];
      const damaged = cells.damaged as RgbaImage[];
      expect(damaged).toHaveLength(intact.length);
      // The geometry itself, in the supersampled render: exact. Both states sway by the same function of the
      // same frame number, and the burnt tree is the intact skeleton with fewer parts, so no tolerance is needed.
      for (const [i, frame] of (raw.damaged as RgbaImage[]).entries())
        expect(
          outside(frame, (raw.intact as RgbaImage[])[i] as RgbaImage),
        ).toBe(0);
      // The cells: the post step draws a 1 px outline round the silhouette's outside, and a pocket that is
      // enclosed in intact (so unoutlined) is open in damaged when its leaves are gone. So the cell check is
      // that damaged stays inside intact's silhouette with its enclosed pockets filled, again with no tolerance.
      for (const [i, frame] of damaged.entries())
        expect(outsideFilled(frame, intact[i] as RgbaImage)).toBe(0);
    },
    T,
  );
});

describe("a ground set rendered by the real Blender", () => {
  const inputs = loadRenderInputs(RENDER_ROOT);
  const profile = (() => {
    const found = inputs.profiles.find((p) => p.id === "grass-flagstone");
    if (found?.kind !== "structure" || found.build.kind !== "ground")
      throw new Error("no ground profile");
    return found;
  })();
  const period = (profile.build as { period: number }).period;
  const camera = (() => {
    if (inputs.camera === undefined) throw new Error("no camera");
    return inputs.camera;
  })();

  /** The set's two patches from the real Blender; `flat` turns off tufts and slabs in a copy of the profile. */
  async function renderPatches(flat: boolean, layoutPeriod = period) {
    const rig = await openRig({
      executable: BLENDER,
      pin: BLENDER_PIN,
      watchdogMs: 120_000,
      ...(flat || layoutPeriod !== period
        ? {
            mutateRenderRoot: (root: string) => {
              const file = join(root, "profiles", "grass-flagstone.json");
              const json = JSON.parse(readFileSync(file, "utf8"));
              if (flat) {
                json.build.tuft.perTile = 0;
                json.build.slab.heightM = 0;
              }
              json.build.period = layoutPeriod;
              json.build.stamp.wavelengthTiles = 1;
              writeFileSync(file, JSON.stringify(json));
            },
          }
        : {}),
    });
    const started = performance.now();
    const ids = submitTile(
      rig,
      `grass-flagstone-live-${flat ? "flat" : "full"}-${layoutPeriod}`,
    );
    const result = await drain(rig);
    const wallMs = performance.now() - started;
    for (const entry of result.results)
      if (entry.outcome !== "rendered")
        throw new Error(`${entry.jobId}: ${entry.outcome}`);
    const palette = postPaletteFrom(
      (await import("../../test/render/rig")).content.palettes,
      "greek-retro",
    );
    if (!palette.ok) throw new Error(palette.message);
    const patches: Record<string, { full: RgbaImage; cropped: RgbaImage }> = {};
    for (const [index, id] of ids.entries()) {
      const record = jobsById(rig)[id];
      if (record?.job.status !== "succeeded") throw new Error(`${id} failed`);
      const manifest = JSON.parse(
        new TextDecoder().decode(
          rig.session.store.readBlob(record.engine?.settings.manifest as never),
        ),
      ) as { frames: { raw: Record<"colour" | "id" | "depth", string> }[] };
      const raw = manifest.frames[0]?.raw as Record<
        "colour" | "id" | "depth",
        string
      >;
      const pass = (name: "colour" | "id" | "depth"): RgbaImage => {
        const decoded = decodePng(
          rig.session.store.readBlob(raw[name] as never) as Uint8Array,
        );
        if (!decoded.ok) throw new Error(`${name} does not decode`);
        return decoded.image;
      };
      const effective = effectiveCamera(profile, camera);
      const settings = postStepSettings(
        effective,
        { x: 32, y: 16 },
        postSettingsFor(undefined, groundPostOf(profile)),
      );
      const full = postProcessSlot({
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
        palette: palette.value,
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
      if (!full.ok) throw new Error(full.message);
      const cropped = decodePng(
        rig.session.store.readBlob(
          record.job.outputs[0]?.hash as never,
        ) as Uint8Array,
      );
      if (!cropped.ok) throw new Error("cell does not decode");
      patches[index === 0 ? "base" : "over"] = {
        full: full.cells[0]?.image as RgbaImage,
        cropped: cropped.image,
      };
    }
    return { patches, wallMs };
  }

  const distinctColours = (image: RgbaImage) => {
    const set = new Set<number>();
    for (let at = 0; at < image.rgba.length; at += 4)
      set.add(
        (image.rgba[at] as number) * 65536 +
          (image.rgba[at + 1] as number) * 256 +
          (image.rgba[at + 2] as number),
      );
    return set.size;
  };

  live(
    "pins ambient occlusion, horizon scan, screen-space reflections and shadows off, with one filterless sample",
    () => {
      const script = join(RENDER_ROOT, "blender", "render.py");
      const run = spawnSync(
        BLENDER,
        [
          "--background",
          "--factory-startup",
          "--python-expr",
          `import json,runpy\nns=runpy.run_path(${JSON.stringify(script)}, run_name="render")\ncamera=json.load(open(${JSON.stringify(join(RENDER_ROOT, "camera.json"))}))\nscene,_=ns["fresh_scene"](camera)\nev=scene.eevee\nprint("EEVEE "+json.dumps({"use_raytracing":ev.use_raytracing,"use_fast_gi (horizon scan, AO)":ev.use_fast_gi,"fast_gi_method":ev.fast_gi_method,"use_shadows":ev.use_shadows,"taa_render_samples":ev.taa_render_samples,"taa_samples":ev.taa_samples,"filter_size":scene.render.filter_size}))`,
        ],
        { encoding: "utf8", timeout: 120_000 },
      );
      const line = run.stdout.split("\n").find((l) => l.startsWith("EEVEE "));
      if (line === undefined)
        throw new Error(`no EEVEE line: ${run.stdout}\n${run.stderr}`);
      const settings = JSON.parse(line.slice(6));
      console.log(`EEVEE settings in use: ${JSON.stringify(settings)}`);
      expect(settings).toMatchObject({
        use_raytracing: false,
        "use_fast_gi (horizon scan, AO)": false,
        use_shadows: false,
        taa_render_samples: 1,
        taa_samples: 1,
        filter_size: 0,
      });
    },
    T,
  );

  live(
    "flat colour: both terrains' centre periods repeat along both lattice axes, byte for byte",
    async () => {
      const { patches, wallMs } = await renderPatches(true);
      console.log(`flat ground render (both slots): ${Math.round(wallMs)} ms`);
      for (const role of ["base", "over"] as const) {
        const gate = patchGate(
          (patches[role] as { full: RgbaImage }).full,
          period,
          profile.cell.pivot,
        );
        console.log(
          `flat ${role}: ${JSON.stringify(gate)}, ${distinctColours((patches[role] as { full: RgbaImage }).full)} colours`,
        );
        expect(gate, role).toMatchObject({
          alongI: 0,
          alongJ: 0,
          transparent: 0,
          outside: 0,
        });
      }
    },
    T,
  );

  live(
    "full geometry (slabs, tufts, toon bands): both terrains' centre periods repeat along both lattice axes, byte for byte",
    async () => {
      const { patches, wallMs } = await renderPatches(false);
      console.log(`full ground render (both slots): ${Math.round(wallMs)} ms`);
      const crop = groundCrop(period, profile.cell.pivot);
      for (const role of ["base", "over"] as const) {
        const { full, cropped } = patches[role] as {
          full: RgbaImage;
          cropped: RgbaImage;
        };
        const gate = patchGate(full, period, profile.cell.pivot);
        console.log(
          `full ${role}: ${JSON.stringify(gate)}, ${distinctColours(full)} colours`,
        );
        expect(gate, role).toMatchObject({
          alongI: 0,
          alongJ: 0,
          transparent: 0,
          outside: 0,
        });
        expect([cropped.width, cropped.height]).toEqual([crop.w, crop.h]);
        expect(distinctColours(full)).toBeGreaterThan(1);
      }
    },
    T,
  );

  live(
    "control: a layout that repeats every 3 lattice steps, not 4, fails the gate",
    async () => {
      const { patches } = await renderPatches(false, period - 1);
      const gate = patchGate(
        (patches.over as { full: RgbaImage }).full,
        period,
        profile.cell.pivot,
      );
      console.log(
        `control over (layout N=${period - 1}, gate N=${period}): ${JSON.stringify(gate)}`,
      );
      expect(gate.alongI + gate.alongJ).toBeGreaterThan(0);
    },
    T,
  );

  live(
    "a real set packs with every atlas cell conforming, and the audit stamps it again from the stored raw frames",
    async () => {
      const rig = await openRig({
        executable: BLENDER,
        pin: BLENDER_PIN,
        watchdogMs: 120_000,
      });
      const ids = await renderTile(rig, "grass-flagstone-live", "tile-set");
      pickAll(rig, "tile-set", ids);
      const palettes = approvedPalettes();
      const packed = rig.session.pack(
        { ...TILE_PACK_INPUT, workingSetId: "tile-set" },
        content,
        palettes,
        registryOf(rig),
        { renderRoot: RENDER_ROOT },
      );
      if (!packed.ok) throw new Error(packed.message);
      const approved = rig.session.approveAsset(
        TILE_PACK_INPUT.id,
        {},
        content,
        palettes,
      );
      if (!approved.ok) throw new Error(approved.message);
      const { manifest } = approved.asset.record;
      const atlas = rig.session.store.readBlob(manifest.atlas.blob);
      if (atlas === undefined) throw new Error("no atlas");
      const drafted = packed.asset.record;
      const report = "report" in drafted ? drafted.report : undefined;
      expect(report?.status).toBe("pass");
      expect(report?.checks.length).toBe(256 * 7);
      expect(report?.checks.filter((c) => c.status === "fail")).toEqual([]);
      expect(
        auditRendered({
          manifest,
          atlas,
          palettes,
          renderRoot: RENDER_ROOT,
          readBlob: (hash) => rig.session.store.readBlob(hash),
          jobs: rig.session.store.status().jobs,
          handEdited: new Set(),
        }),
      ).toBeUndefined();
    },
    T,
  );
});

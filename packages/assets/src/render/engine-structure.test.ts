// A structure through the render engine, against the scripted fake Blender: the frame is the
// profile's own cell, no stamps and no shadow are involved, and the revision recipe is the same
// shape as a figure's.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readLog as readBlenderLog } from "../../test/render/fake-blender";
import {
  closeRigs,
  drain,
  jobsById,
  openRig,
  RENDER_ROOT,
  submitRender,
} from "../../test/render/rig";
import { decodePng } from "../studio/png/decode";
import { cameraHash } from "./camera";
import { loadRenderInputs } from "./load";
import { cellPixelHash } from "./post";
import { effectiveCamera, NO_STAMPS_HASH } from "./recipe";

afterEach(closeRigs);

const T = 90_000;
const south = (state: string) => ({ state, direction: "south" });
const HOUSE_PIVOT = { x: 96, y: 136 };

const inputs = loadRenderInputs(RENDER_ROOT);
const house = (() => {
  const profile = inputs.profiles.find((p) => p.id === "greek-house");
  if (profile?.kind !== "structure") throw new Error("no greek-house profile");
  return profile;
})();

describe("a structure render job", () => {
  test(
    "draws on the profile's own cell, with no stamps and no shadow, under one revision",
    async () => {
      const rig = await openRig({ launches: [{}] });
      const ids = submitRender(
        rig,
        "house-states",
        [south("intact"), south("damaged"), south("ruin")],
        { subject: "greek-house", pivot: HOUSE_PIVOT },
      );
      const result = await drain(rig);
      expect(result.results.map((r) => r.outcome)).toEqual([
        "rendered",
        "rendered",
        "rendered",
      ]);

      const manifests: Record<string, unknown>[] = [];
      for (const id of ids) {
        const record = jobsById(rig)[id];
        if (record?.job.status !== "succeeded")
          throw new Error(`${id} did not succeed`);
        expect(record.job.outputs).toHaveLength(1);
        const bytes = rig.session.store.readBlob(
          record.engine?.settings.manifest as never,
        );
        if (bytes === undefined) throw new Error("manifest blob missing");
        const manifest = JSON.parse(new TextDecoder().decode(bytes)) as Record<
          string,
          unknown
        >;
        manifests.push(manifest);
        const frames = manifest.frames as {
          cell: string;
          cellPixels: string;
          locators: unknown;
        }[];
        const cell = decodePng(
          rig.session.store.readBlob(frames[0]?.cell as never) as Uint8Array,
        );
        if (!cell.ok) throw new Error("cell does not decode");
        expect([cell.image.width, cell.image.height]).toEqual([
          house.cell.width,
          house.cell.height,
        ]);
        expect(cellPixelHash(cell.image)).toBe(frames[0]?.cellPixels as never);
        expect(frames[0]?.locators).toEqual({});
        expect((manifest.slot as { loop: boolean }).loop).toBe(false);
      }

      const revision = manifests[0]?.revision as {
        camera: string;
        stamps: string;
        kit: string;
        postStep: { settings: { shadow: unknown } };
      };
      expect(manifests.map((m) => m.revisionRecipeHash)).toEqual([
        manifests[0]?.revisionRecipeHash,
        manifests[0]?.revisionRecipeHash,
        manifests[0]?.revisionRecipeHash,
      ]);
      expect(revision.stamps).toBe(NO_STAMPS_HASH);
      expect(revision.postStep.settings.shadow).toBeNull();
      if (inputs.camera === undefined) throw new Error("no camera");
      expect(revision.camera).toBe(
        cameraHash(effectiveCamera(house, inputs.camera)),
      );
      expect(revision.camera).not.toBe(cameraHash(inputs.camera));
    },
    T,
  );

  test(
    "stages the kit files a house is built with, and records their licence as its input",
    async () => {
      const rig = await openRig({ launches: [{}] });
      const [id] = submitRender(rig, "house-staging", [south("intact")], {
        subject: "greek-house",
        pivot: HOUSE_PIVOT,
      });
      const result = await drain(rig);
      expect(result.results.map((r) => r.outcome)).toEqual(["rendered"]);
      const record = jobsById(rig)[id as string];
      expect(record?.job.status).toBe("succeeded");
      const staged = readBlenderLog(rig.fakeDir).find(
        (e) => e.event === "staging",
      );
      const named = house.kitFiles.map((f) => `${f.kit}/${f.path}`).sort();
      expect(named.length).toBeGreaterThan(0);
      expect(staged?.files).toEqual(named);
      expect(record?.engine?.licences).toEqual([
        {
          subject: "kenney-building-kit",
          role: "input",
          licence: "CC0-1.0",
        },
        {
          subject: "quaternius-modular-ruins",
          role: "input",
          licence: "CC0-1.0",
        },
      ]);
    },
    T,
  );

  test(
    "a house built from script geometry alone stages nothing but still gets a staging directory, and records no input licence",
    async () => {
      const rig = await openRig({
        launches: [{}],
        mutateRenderRoot: (root) => {
          const path = join(root, "profiles", "greek-house.json");
          const profile = JSON.parse(readFileSync(path, "utf8"));
          profile.kitFiles = [];
          profile.build = { kind: "house" };
          writeFileSync(path, JSON.stringify(profile));
        },
      });
      const [id] = submitRender(rig, "house-bare", [south("intact")], {
        subject: "greek-house",
        pivot: HOUSE_PIVOT,
      });
      await drain(rig);
      expect(jobsById(rig)[id as string]?.job.status).toBe("succeeded");
      const staged = readBlenderLog(rig.fakeDir).find(
        (e) => e.event === "staging",
      );
      expect(staged?.files).toEqual([]);
      expect(jobsById(rig)[id as string]?.engine?.licences).toEqual([]);
    },
    T,
  );
});

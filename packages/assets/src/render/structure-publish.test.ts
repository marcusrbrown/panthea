// A structure through pack, approve, publish and the render audit, rendered by the fake engine:
// the cells are the profile's own size, and the audit recomputes the revision from the profile's
// own frame, not the camera's.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AssetManifest,
  RenderedProvenance,
  Sha256,
} from "@panthea/contracts";
import {
  approvedPalettes,
  closeRigs,
  content,
  copyRenderRoot,
  openRig,
  packSet,
  pickAll,
  RENDER_ROOT,
  type Rig,
  registryOf,
  renderCandidates,
} from "../../test/render/rig";
import { auditRendered } from "./audit";
import { NO_STAMPS_HASH } from "./recipe";

afterEach(closeRigs);

const T = 120_000;
const HOUSE_PIVOT = { x: 96, y: 136 };
const STATES = ["intact", "damaged", "ruin"] as const;

/** The three states rendered, picked and packed as `greek-house`, then approved. */
async function approvedHouse() {
  const rig = await openRig({ launches: [{}] });
  const ids = await renderCandidates(
    rig,
    "house",
    STATES.map((state) => ({ state, direction: "south" })),
    "house-set",
    { subject: "greek-house", pivot: HOUSE_PIVOT },
  );
  pickAll(rig, "house-set", ids);
  const packed = packSet(rig, "house-set", approvedPalettes(), {
    id: "house-pack",
    assetId: "greek-house",
    footprint: { w: 4, h: 3 },
  });
  if (!packed.ok) throw new Error(packed.message);
  const approved = rig.session.approveAsset(
    "house-pack",
    {},
    content,
    approvedPalettes(),
  );
  if (!approved.ok) throw new Error(approved.message);
  const manifest = approved.asset.record.manifest;
  const atlas = rig.session.store.readBlob(manifest.atlas.blob) as Uint8Array;
  return { rig, manifest, atlas };
}

const auditOf = (
  rig: Rig,
  manifest: AssetManifest,
  atlas: Uint8Array,
  renderRoot = RENDER_ROOT,
) =>
  auditRendered({
    manifest,
    atlas,
    palettes: approvedPalettes(),
    renderRoot,
    current: { blender: rig.blender.pin as never },
    readBlob: (hash: Sha256) => rig.session.store.readBlob(hash),
    jobs: rig.session.store.status().jobs,
    handEdited: new Set(),
  });

describe("a house through pack, approve, publish and the render audit", () => {
  test(
    "a house with no kit input needs the owner's licence for it, and says so when it is missing",
    async () => {
      const rig = await openRig({ launches: [{}] });
      const ids = await renderCandidates(
        rig,
        "house",
        [{ state: "intact", direction: "south" }],
        "house-set",
        { subject: "greek-house", pivot: HOUSE_PIVOT },
      );
      pickAll(rig, "house-set", ids);
      const refused = rig.session.pack(
        {
          id: "house-pack",
          workingSetId: "house-set",
          assetId: "greek-house",
          styleTag: "retro",
          footprint: { w: 4, h: 3 },
        },
        content,
        approvedPalettes(),
        registryOf(rig),
      );
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.message).toContain("owner's licence");
    },
    T,
  );

  test(
    "the three states pack at the profile's cell, south only, with no stamps",
    async () => {
      const { manifest } = await approvedHouse();
      if (manifest.kind !== "sprite") throw new Error("not a sprite");
      expect(manifest.cell).toEqual({ w: 192, h: 192 });
      expect(manifest.pivot).toEqual(HOUSE_PIVOT);
      expect(
        manifest.animations.map((a) => `${a.state}/${a.direction}`),
      ).toEqual(["intact/south", "damaged/south", "ruin/south"]);
      expect(manifest.animations.every((a) => a.frames.length === 1)).toBe(
        true,
      );
      const provenance = manifest.provenance as RenderedProvenance;
      expect(provenance.method).toBe("rendered");
      expect(provenance.revisionRecipe.stamps).toBe(NO_STAMPS_HASH);
      expect(provenance.revisionRecipe.profile.id).toBe("greek-house");
      // No kit is read, so the one record is the owner's licence for the house itself.
      expect(provenance.licences).toEqual([
        {
          subject: "greek-house",
          role: "original-work",
          licence: "MIT",
          attribution: "the owner",
        },
      ]);
    },
    T,
  );

  test(
    "publishes, and a profile whose cell differs from camera.json passes its audit",
    async () => {
      const { rig, manifest, atlas } = await approvedHouse();
      expect(auditOf(rig, manifest, atlas)).toBeUndefined();
      const published = rig.session.publishAsset(
        "house-pack",
        content,
        approvedPalettes(),
        registryOf(rig),
        {
          renderRoot: RENDER_ROOT,
          current: { blender: rig.blender.pin as never },
        },
      );
      if (!published.ok) throw new Error(published.message);
      expect(published.asset.record.state).toBe("canon");
    },
    T,
  );

  test(
    "changing only the profile's cell fails the revision check, naming the profile",
    async () => {
      const { rig, manifest, atlas } = await approvedHouse();
      const root = copyRenderRoot(rig.base);
      const path = join(root, "profiles", "greek-house.json");
      const profile = JSON.parse(readFileSync(path, "utf8"));
      profile.cell.pivot = [profile.cell.pivot[0], profile.cell.pivot[1] - 1];
      writeFileSync(path, JSON.stringify(profile));
      const refusal = auditOf(rig, manifest, atlas, root);
      expect(refusal).toContain("profile hash differs");
    },
    T,
  );
});

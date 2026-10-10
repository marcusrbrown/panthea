import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PackInput } from "@panthea/assets/studio";

import {
  type AssetRig,
  assetRig,
  finishSheet,
  paintFigure,
  removeTempRoots,
  runSlots,
  spriteSet,
} from "../../../../packages/assets/src/studio/_test-fixtures";
import * as workflowActions from "./actions";

const buildPackArgs = (
  workflowActions as unknown as {
    buildPackArgs?: (input: {
      readonly selectedSet: Record<string, unknown>;
      readonly assets: readonly { readonly id: string }[];
      readonly assetId: string;
      readonly styleTag: string;
      readonly footprintWidth: string;
      readonly footprintHeight: string;
      readonly originalWorkLicence: string;
      readonly originalWorkAttribution: string;
    }) => PackInput | undefined;
  }
).buildPackArgs;

const rigs: AssetRig[] = [];
const registryCopies: string[] = [];
const repositoryRegistry = join(
  import.meta.dir,
  "../../../../content/greek/assets/registry",
);

afterEach(() => {
  for (const rig of rigs.splice(0)) rig.session.close();
  removeTempRoots();
  for (const directory of registryCopies.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function newRig() {
  const tempRoot = mkdtempSync(join(tmpdir(), "studio-pack-registry-"));
  const registryRoot = join(tempRoot, "registry");
  cpSync(repositoryRegistry, registryRoot, { recursive: true });
  registryCopies.push(tempRoot);
  const rig = assetRig({ registryRoot });
  rigs.push(rig);
  return rig;
}

function setSummary(rig: AssetRig, id: string) {
  const result = rig.session.store.readWorkingSet(id);
  if (result.kind !== "found") throw new Error(`working set ${id} is missing`);
  return {
    id,
    kind: result.value.kind,
    authored: Object.fromEntries(
      Object.entries(result.value.frames).map(([slot, frames]) => [
        slot,
        { editId: frames.editId, frames: frames.frames.length },
      ]),
    ),
  };
}

function packThroughSession(
  rig: AssetRig,
  workingSetId: string,
  values: {
    readonly assetId: string;
    readonly styleTag: string;
    readonly footprintWidth?: string;
    readonly footprintHeight?: string;
  },
) {
  expect(buildPackArgs).toBeFunction();
  if (!buildPackArgs) throw new Error("buildPackArgs is not implemented");
  const set = setSummary(rig, workingSetId);
  const input = buildPackArgs({
    selectedSet: set,
    assets: rig.session.store
      .status()
      .assets.map((asset) => ({ id: asset.id })),
    assetId: values.assetId,
    styleTag: values.styleTag,
    footprintWidth: values.footprintWidth ?? "1",
    footprintHeight: values.footprintHeight ?? "1",
    originalWorkLicence: "MIT",
    originalWorkAttribution: "Marcus R. Brown, hand-edited in Aseprite",
  });
  if (!input) throw new Error("The valid pack form did not produce arguments");
  const result = rig.session.pack(
    input,
    rig.content,
    rig.palette,
    rig.registryRoot,
  );
  if (!result.ok) throw new Error(`The SDK refused pack: ${result.message}`);
  return { input, asset: result.asset };
}

describe("pack form arguments against an in-process StudioSession", () => {
  test("packs a complete four-frame sprite with its hand-work details", () => {
    const rig = newRig();
    spriteSet(rig);

    const { input, asset } = packThroughSession(rig, "w", {
      assetId: "placeholder-zeus",
      styleTag: "u5-test",
      footprintWidth: "1",
      footprintHeight: "2",
    });

    expect(input.footprint).toEqual({ w: 1, h: 2 });
    expect(input.originalWork).toEqual({
      licence: "MIT",
      attribution: "Marcus R. Brown, hand-edited in Aseprite",
    });
    expect(asset.record.manifest.kind).toBe("sprite");
    if (asset.record.manifest.kind !== "sprite")
      throw new Error("expected a sprite manifest");
    expect(asset.record.manifest.animations[0]?.frames).toHaveLength(4);
  });

  test("packs a hand-edited portrait without a sprite footprint", () => {
    const rig = newRig();
    const expressions = [...rig.content.vocabulary.expressions];
    const jobs = runSlots(
      rig,
      "zeus-faces",
      "portrait",
      expressions.map((expression) => ({ expression })),
    );
    if (!rig.session.openWorkingSet("wp", "zeus-faces", rig.content).ok)
      throw new Error("working set could not be opened");
    for (const id of jobs)
      if (!rig.session.pick("wp", id).ok)
        throw new Error(`could not pick ${id}`);
    const cell = { w: 96, h: 96 };
    finishSheet(
      rig,
      "portrait-edit",
      "wp",
      cell,
      expressions.map((expression, index) => ({
        slot: expression,
        frames: [paintFigure(rig.content, cell, index)],
      })),
    );

    const { input, asset } = packThroughSession(rig, "wp", {
      assetId: "zeus-portrait",
      styleTag: "u5-test",
    });

    expect(input.footprint).toBeUndefined();
    expect(input.originalWork?.licence).toBe("MIT");
    expect(asset.record.manifest.kind).toBe("portrait");
  });

  test("packs a second revision of the same asset with a fresh record id", () => {
    const rig = newRig();
    spriteSet(rig);

    const first = packThroughSession(rig, "w", {
      assetId: "placeholder-zeus",
      styleTag: "u5-test",
    });
    const second = packThroughSession(rig, "w", {
      assetId: "placeholder-zeus",
      styleTag: "u5-test",
    });

    expect(first.input.id).toBe("record-placeholder-zeus-1");
    expect(second.input.id).toBe("record-placeholder-zeus-2");
    expect(second.asset.assetId).toBe(first.asset.assetId);
  });
});

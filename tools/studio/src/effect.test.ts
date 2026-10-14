import { afterEach, describe, expect, test } from "bun:test";
import { readStudioStatus } from "@panthea/assets/studio";
import { loadContent } from "../../../packages/assets/test/studio/fixtures";
import { assetRig, removeTempRoots, run } from "../test/kit";
import type { StudioConfig } from "./config";
import type { Outcome } from "./format";

afterEach(removeTempRoots);

function setup() {
  const rig = assetRig();
  rig.session.close();
  const content = loadContent();
  const config: StudioConfig = {
    studioRoot: rig.root,
    contentRoot: "/content",
    registryRoot: rig.registryRoot,
  };
  const over = {
    loadContent: () => ({ ok: true as const, content }),
    loadPalettes: () => ({ ok: true as const, palettes: content.palettes }),
  };
  return {
    rig,
    cli: (op: string, args: unknown) =>
      run(config, op, args, over).then((r) => r.outcome),
  };
}

const EFFECT = {
  id: "bolt",
  assetId: "lightning-strike",
  effect: "lightning",
  seed: 7,
  palette: "greek-retro",
  styleTag: "retro",
};

const code = (outcome: Outcome) => (outcome.ok ? "ok" : outcome.error.code);

describe("the effect op", () => {
  test("drafts an effect, then approves and publishes it into the scratch registry", async () => {
    const { rig, cli } = setup();

    const drafted = await cli("effect", EFFECT);
    expect(drafted).toMatchObject({
      ok: true,
      result: {
        id: "bolt",
        state: "draft",
        assetId: "lightning-strike",
        report: { status: "pass", failedChecks: [] },
        published: null,
      },
    });
    const revision = (drafted.ok ? drafted.result : {}) as {
      manifestRevision: string;
    };
    const approved = await cli("approve", {
      id: "bolt",
      confirm: revision.manifestRevision,
    });
    expect(approved).toMatchObject({
      ok: true,
      result: { state: "approved", basis: "report-pass" },
    });
    const published = await cli("publish", {
      id: "bolt",
      confirm: revision.manifestRevision,
    });
    expect(published).toMatchObject({
      ok: true,
      result: { state: "canon", revision: revision.manifestRevision },
    });
    expect(
      readStudioStatus(rig.root).commands.map((c) => `${c.type}:${c.jobId}`),
    ).toEqual(["effect:bolt", "approve:bolt", "publish:bolt"]);
  });

  test("takes parameter overrides", async () => {
    const { rig, cli } = setup();
    const drafted = await cli("effect", { ...EFFECT, params: { depth: 4 } });
    expect(drafted.ok).toBe(true);
    const manifest = readStudioStatus(rig.root).assets[0]?.record.manifest;
    expect(
      manifest?.provenance.method === "procedural" &&
        manifest.provenance.params.depth,
    ).toBe(4);
  });

  test("fire is one burning loop", async () => {
    const { rig, cli } = setup();
    expect(
      (
        await cli("effect", {
          ...EFFECT,
          id: "flames",
          assetId: "fire-loop",
          effect: "fire",
        })
      ).ok,
    ).toBe(true);
    const manifest = readStudioStatus(rig.root).assets[0]?.record.manifest;
    expect(manifest?.kind === "effect" && manifest.animations.length).toBe(1);
  });

  test("a missing, mistyped or unknown argument is a usage error and writes nothing", async () => {
    const { rig, cli } = setup();
    const { palette: _palette, ...noPalette } = EFFECT;
    const results = [
      await cli("effect", noPalette),
      await cli("effect", { ...EFFECT, seed: "7" }),
      await cli("effect", { ...EFFECT, params: [1] }),
      await cli("effect", { ...EFFECT, workingSetId: "w" }),
    ];
    expect(results.map(code)).toEqual([
      "invalid-arguments",
      "invalid-arguments",
      "invalid-arguments",
      "invalid-arguments",
    ]);
    expect(readStudioStatus(rig.root).assets).toEqual([]);
  });

  test("a bad effect, parameter or palette is refused by the session", async () => {
    const { cli } = setup();
    const results = [
      await cli("effect", { ...EFFECT, effect: "smoke" }),
      await cli("effect", { ...EFFECT, params: { depth: 99 } }),
      await cli("effect", { ...EFFECT, palette: "nope" }),
    ];
    expect(results.map(code)).toEqual([
      "invalid-params",
      "invalid-params",
      "not-found",
    ]);
  });
});

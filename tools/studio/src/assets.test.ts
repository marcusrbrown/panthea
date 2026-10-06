import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  openStudioSession,
  readStudioStatus,
  type StudioAssetRecord,
} from "@panthea/assets/studio";
import {
  type AssetRig,
  finishSheet,
  paintFigure,
  runSlots,
  spriteSet,
} from "../../../packages/assets/src/studio/_test-fixtures";
import { assetRig, removeTempRoots, run } from "./_testkit";
import type { StudioConfig } from "./config";
import { exitOf, type Outcome } from "./format";

afterEach(removeTempRoots);

const PACK = {
  id: "p1",
  workingSetId: "w",
  assetId: "placeholder-zeus",
  styleTag: "draft",
  footprint: { w: 1, h: 1 },
  originalWork: { licence: "MIT" },
};

function setup(rig: AssetRig) {
  rig.session.close();
  const config: StudioConfig = {
    studioRoot: rig.root,
    contentRoot: "/content",
    registryRoot: rig.registryRoot,
  };
  const over = {
    loadContent: () => ({ ok: true as const, content: rig.content }),
  };
  return {
    config,
    cli: (op: string, args: unknown) =>
      run(config, op, args, over).then((r) => r.outcome),
  };
}

const asset = (rig: AssetRig, id = "p1"): StudioAssetRecord => {
  const found = readStudioStatus(rig.root).assets.find((a) => a.id === id);
  if (found === undefined) throw new Error(`no asset ${id}`);
  return found;
};

/** The owner's assessment of every licence record the studio cannot decide on its own. */
const assess = (rig: AssetRig, id = "p1") => {
  const seen = new Set<string>();
  return asset(rig, id).record.manifest.provenance.licences.flatMap(
    (record) => {
      const key = JSON.stringify(record);
      if (
        seen.has(key) ||
        ["MIT", "Apache-2.0", "CC0-1.0"].includes(record.licence)
      )
        return [];
      seen.add(key);
      return [
        {
          record,
          disposition: "mit-compatible",
          reason: "the owner read these terms",
        },
      ];
    },
  );
};

const code = (outcome: Outcome) => (outcome.ok ? "ok" : outcome.error.code);
const ledger = (rig: AssetRig) =>
  readStudioStatus(rig.root).commands.map((c) => `${c.type}:${c.jobId}`);

describe("packing", () => {
  test("a complete set packs into a draft summary with its review metadata", async () => {
    const rig = assetRig();
    spriteSet(rig);
    const { cli } = setup(rig);

    const packed = await cli("pack", PACK);

    expect(packed).toMatchObject({
      ok: true,
      result: {
        id: "p1",
        state: "draft",
        assetId: "placeholder-zeus",
        report: { status: "pass", failedChecks: [] },
        published: null,
      },
    });
    expect(
      packed.ok &&
        (packed.result as { manifestRevision: string }).manifestRevision,
    ).toBe(asset(rig).manifestRevision);
    expect(ledger(rig).filter((l) => l.startsWith("pack:"))).toEqual([
      "pack:p1",
    ]);
  });

  test("a sprite needs its footprint and a bad footprint, carried params or original work are usage errors", async () => {
    const rig = assetRig();
    spriteSet(rig);
    const { cli } = setup(rig);

    const { footprint: _omitted, ...withoutFootprint } = PACK;
    const noFootprint = await cli("pack", withoutFootprint);
    const badFootprint = await cli("pack", {
      ...PACK,
      footprint: { w: 0, h: 1 },
    });
    const extraKey = await cli("pack", {
      ...PACK,
      footprint: { w: 1, h: 1, d: 2 },
    });
    const scaled = await cli("pack", {
      ...PACK,
      carriedParams: {
        background: { type: "alpha" },
        alphaCutoff: 128,
        grid: { edgeTolerance: 8, minConfidence: 0.6, minEdges: 20 },
        scale: 2,
      },
    });
    const work = await cli("pack", { ...PACK, originalWork: { licence: "" } });

    expect(code(noFootprint)).toBe("wrong-state");
    expect([badFootprint, extraKey, scaled, work].map(code)).toEqual([
      "invalid-arguments",
      "invalid-arguments",
      "invalid-arguments",
      "invalid-arguments",
    ]);
    expect(readStudioStatus(rig.root).assets).toEqual([]);
  });

  test("a first publication from a partial portrait set is refused and writes no record, blob or ledger entry", async () => {
    const rig = assetRig();
    const [job] = runSlots(
      rig,
      "zeus-one",
      "portrait",
      [{ expression: "awed" }],
      7,
    );
    rig.session.openWorkingSet("wp", "zeus-one", rig.content);
    rig.session.pick("wp", job as string);
    const before = readStudioStatus(rig.root);
    const { cli } = setup(rig);

    const packed = await cli("pack", {
      id: "face",
      workingSetId: "wp",
      assetId: "zeus-portrait",
      styleTag: "d",
      stillFrameMs: 1000,
    });

    expect(packed).toMatchObject({ ok: false, error: { code: "wrong-state" } });
    expect(exitOf(packed)).toBe(1);
    const after = readStudioStatus(rig.root);
    expect(after.assets).toEqual([]);
    expect(after.commands.length).toBeGreaterThanOrEqual(
      before.commands.length,
    );
    expect(ledger(rig).some((l) => l.startsWith("pack:"))).toBe(false);
  });
});

describe("approval needs the literal confirmation of the reviewed revision", () => {
  test("without --confirm nothing changes, no lock is taken, and the review metadata comes back", async () => {
    const rig = assetRig();
    spriteSet(rig);
    const { cli } = setup(rig);
    await cli("pack", PACK);
    const before = ledger(rig);

    const outcome = await cli("approve", {
      id: "p1",
      assessments: assess(rig),
    });

    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: "confirmation_required",
        review: {
          id: "p1",
          state: "draft",
          manifestRevision: asset(rig).manifestRevision,
          report: { status: "pass" },
        },
      },
    });
    expect(exitOf(outcome)).toBe(1);
    expect(ledger(rig)).toEqual(before);
    expect(asset(rig).record.state).toBe("draft");
    const reopened = openStudioSession(rig.root);
    expect(reopened.kind).toBe("opened");
    if (reopened.kind === "opened") reopened.session.close();
  });

  test("a confirmation of any other revision is refused as a mismatch and changes nothing", async () => {
    const rig = assetRig();
    spriteSet(rig);
    const { cli } = setup(rig);
    await cli("pack", PACK);
    const before = ledger(rig);

    const outcome = await cli("approve", {
      id: "p1",
      confirm: "0".repeat(64),
      assessments: assess(rig),
    });

    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: "revision-mismatch",
        expected: asset(rig).manifestRevision,
      },
    });
    expect(exitOf(outcome)).toBe(1);
    expect(ledger(rig)).toEqual(before);
  });

  test("the confirmed revision approves the draft and returns the final approved revision", async () => {
    const rig = assetRig();
    spriteSet(rig);
    const { cli } = setup(rig);
    await cli("pack", PACK);
    const draft = asset(rig).manifestRevision;

    const outcome = await cli("approve", {
      id: "p1",
      confirm: draft,
      assessments: assess(rig),
    });

    expect(outcome).toMatchObject({
      ok: true,
      result: {
        id: "p1",
        state: "approved",
        basis: "report-pass",
        manifestRevision: draft,
      },
    });
    expect(asset(rig).record.state).toBe("approved");
    expect(ledger(rig).filter((l) => l.startsWith("approve:"))).toEqual([
      "approve:p1",
    ]);
  });

  test("unknown licence terms are not cleared by confirming, by an exception or by an assessment of other terms", async () => {
    const rig = assetRig();
    spriteSet(rig);
    const { cli } = setup(rig);
    await cli("pack", PACK);
    const draft = asset(rig).manifestRevision;

    const plain = await cli("approve", { id: "p1", confirm: draft });
    const withException = await cli("approve-with-exception", {
      id: "p1",
      confirm: draft,
      exception: { reason: "the owner accepts it" },
    });
    const wrongRecord = await cli("approve", {
      id: "p1",
      confirm: draft,
      assessments: [
        {
          record: { subject: "x", role: "input", licence: "Custom" },
          disposition: "mit-compatible",
          reason: "r",
        },
      ],
    });

    expect(plain).toMatchObject({ ok: false, error: { code: "wrong-state" } });
    expect(JSON.stringify(plain)).toContain("unclear");
    expect(withException).toMatchObject({
      ok: false,
      error: { code: "wrong-state" },
    });
    expect(code(wrongRecord)).toBe("invalid-params");
    expect(asset(rig).record.state).toBe("draft");
  });

  test("assessments are strict: unknown keys, a bad disposition and a missing reason are usage errors", async () => {
    const rig = assetRig();
    spriteSet(rig);
    const { cli } = setup(rig);
    await cli("pack", PACK);
    const record = { subject: "s", role: "input", licence: "L" };
    const bad = [
      [{ record, disposition: "mit-compatible", reason: "r", extra: 1 }],
      [{ record, disposition: "fine", reason: "r" }],
      [{ record, disposition: "incompatible" }],
      [
        {
          record: { ...record, path: "/x" },
          disposition: "incompatible",
          reason: "r",
        },
      ],
      "not-an-array",
    ];

    for (const assessments of bad)
      expect(
        code(await cli("approve", { id: "p1", confirm: "x", assessments })),
        JSON.stringify(assessments),
      ).toBe("invalid-arguments");
  });
});

describe("an owner exception is not a licence assessment", () => {
  async function failing() {
    const rig = assetRig();
    const [id] = runSlots(rig, "zeus-idle", "sprite", [
      { state: "idle", direction: "south" },
    ]);
    rig.session.openWorkingSet("w", "zeus-idle", rig.content);
    rig.session.pick("w", id as string);
    const frames = [0, 1, 2, 3].map((i) =>
      paintFigure(rig.content, { w: 64, h: 80 }, i),
    );
    frames[1]?.rgba.set([255, 0, 255, 255], (20 * 64 + 20) * 4);
    finishSheet(rig, "e1", "w", { w: 64, h: 80 }, [
      { slot: "idle/south", frames },
    ]);
    const { cli } = setup(rig);
    await cli("pack", PACK);
    return { rig, cli };
  }

  test("a failing report is not approved by a plain approval, and an exception needs a reason", async () => {
    const { rig, cli } = await failing();
    const draft = asset(rig).manifestRevision;

    const plain = await cli("approve", {
      id: "p1",
      confirm: draft,
      assessments: assess(rig),
    });
    const empty = await cli("approve-with-exception", {
      id: "p1",
      confirm: draft,
      exception: { reason: "  " },
      assessments: assess(rig),
    });
    const extra = await cli("approve-with-exception", {
      id: "p1",
      confirm: draft,
      exception: { reason: "r", by: "x" },
      assessments: assess(rig),
    });
    const missing = await cli("approve-with-exception", {
      id: "p1",
      confirm: draft,
    });

    expect(plain.ok).toBe(false);
    expect(code(empty)).toBe("invalid-arguments");
    expect(code(extra)).toBe("invalid-arguments");
    expect(code(missing)).toBe("invalid-arguments");
    expect(asset(rig).record.state).toBe("draft");
  });

  test("with an exception and the terms assessed separately, approval returns the final revision and publication confirms that one", async () => {
    const { rig, cli } = await failing();
    const draft = asset(rig).manifestRevision;

    const approved = await cli("approve-with-exception", {
      id: "p1",
      confirm: draft,
      exception: { reason: "the magenta pixel is intended" },
      assessments: assess(rig),
    });

    expect(approved).toMatchObject({
      ok: true,
      result: { state: "approved", basis: "owner-exception" },
    });
    const final = approved.ok
      ? (approved.result as { manifestRevision: string }).manifestRevision
      : "";
    expect(final).not.toBe(draft);
    expect(final).toBe(asset(rig).manifestRevision);

    const noConfirm = await cli("publish", { id: "p1" });
    const stale = await cli("publish", { id: "p1", confirm: draft });
    expect(noConfirm).toMatchObject({
      ok: false,
      error: {
        code: "confirmation_required",
        review: { manifestRevision: final },
      },
    });
    expect(stale).toMatchObject({
      ok: false,
      error: { code: "revision-mismatch", expected: final },
    });
    expect(existsSync(join(rig.registryRoot, "index.json"))).toBe(false);

    const published = await cli("publish", { id: "p1", confirm: final });

    expect(published).toMatchObject({
      ok: true,
      result: { id: "p1", state: "canon", revision: final },
    });
    const index = JSON.parse(
      readFileSync(join(rig.registryRoot, "index.json"), "utf8"),
    );
    expect(index.entries).toEqual([
      { assetId: "placeholder-zeus", revision: final },
    ]);
  });
});

describe("publication", () => {
  test("a draft or an unknown asset is not published and the registry is not created", async () => {
    const rig = assetRig();
    spriteSet(rig);
    const { cli } = setup(rig);
    await cli("pack", PACK);

    const draft = await cli("publish", {
      id: "p1",
      confirm: asset(rig).manifestRevision,
    });
    const unknown = await cli("publish", { id: "nobody", confirm: "x" });

    expect(draft).toMatchObject({ ok: false, error: { code: "wrong-state" } });
    expect(code(unknown)).toBe("not-found");
    expect(exitOf(unknown)).toBe(1);
    expect(existsSync(rig.registryRoot)).toBe(false);
  });

  test("a published asset cannot be published again and a rejected draft cannot be confirmed", async () => {
    const rig = assetRig();
    spriteSet(rig);
    const { cli } = setup(rig);
    await cli("pack", PACK);
    const draft = asset(rig).manifestRevision;
    await cli("approve", {
      id: "p1",
      confirm: draft,
      assessments: assess(rig),
    });
    const first = await cli("publish", { id: "p1", confirm: draft });
    const again = await cli("publish", { id: "p1", confirm: draft });

    expect(first.ok).toBe(true);
    expect(code(again)).toBe("wrong-state");
  });
});

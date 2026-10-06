import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import {
  type AssetManifest,
  canonicalManifestText,
  type LicenceRecord,
  newCandidate,
  parseAssetManifest,
  transitionAsset,
} from "@panthea/contracts";
import { paletteFixture, portraitFixture } from "../fixtures";
import { sha256Hex } from "../hash";
import { paletteDigest } from "../palette";
import { encodeRgbaPng } from "../placeholder";
import { loadRegistry, publishAsset as publishToRegistry } from "../registry";
import {
  type AssetRig,
  assetRig,
  finishSheet,
  PROVISIONAL_TEST_PARAMS,
  paintFigure,
  pngOf,
  removeTempRoots,
  runSlots,
  selectedProfileFacts,
  sheetOf as sheetOfFrames,
  spriteSet,
} from "./_test-fixtures";
import type { PackInput } from "./packing";
import { decodePng } from "./png/decode";
import { SELECTED_PROFILE } from "./provider";
import { type ApproveOptions, carriedCellsMismatch } from "./publish";
import { openStudioSession } from "./session";
import { readStudioStatus } from "./store";
import type { LicenceAssessment } from "./workspace";

afterEach(removeTempRoots);

const cell = { w: 64, h: 80 };
const packInput = (over: Partial<PackInput> = {}): PackInput => ({
  id: "zeus-pack",
  workingSetId: "w",
  assetId: "placeholder-zeus",
  styleTag: "draft",
  footprint: { w: 1, h: 1 },
  originalWork: { licence: "MIT", attribution: "the owner" },
  ...over,
});
const params = {
  background: PROVISIONAL_TEST_PARAMS.background,
  alphaCutoff: PROVISIONAL_TEST_PARAMS.alphaCutoff,
  grid: PROVISIONAL_TEST_PARAMS.grid,
};

const doPack = (rig: AssetRig, over: Partial<PackInput> = {}) =>
  rig.session.pack(packInput(over), rig.content, rig.palette, rig.registryRoot);

function packOk(rig: AssetRig, over: Partial<PackInput> = {}) {
  const result = doPack(rig, over);
  if (!result.ok) throw new Error(result.message);
  return result.asset;
}

/** The owner's assessment of every licence record the studio cannot decide. */
function assessments(licences: readonly LicenceRecord[]): LicenceAssessment[] {
  const seen = new Set<string>();
  return licences.flatMap((record) => {
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
        disposition: "mit-compatible" as const,
        reason: "the owner read these terms",
      },
    ];
  });
}

const manifestOf = (rig: AssetRig, id = "zeus-pack") => {
  const found = rig.session.store.readAsset(id);
  if (found.kind !== "found") throw new Error(`no asset ${id}`);
  return found.value.record.manifest as AssetManifest;
};

function approve(
  rig: AssetRig,
  id = "zeus-pack",
  extra: Partial<ApproveOptions> = {},
) {
  const licences = manifestOf(rig, id).provenance.licences;
  return rig.session.approveAsset(
    id,
    { assessments: assessments(licences), ...extra },
    rig.content,
    rig.palette,
  );
}

function ready(rig: AssetRig, id = "zeus-pack") {
  const result = approve(rig, id);
  if (!result.ok) throw new Error(result.message);
  return result.asset;
}

const publish = (rig: AssetRig, id = "zeus-pack") =>
  rig.session.publishAsset(id, rig.content, rig.palette, rig.registryRoot);

function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (!name.startsWith("session.lock"))
        out[relative(root, path)] = Buffer.from(readFileSync(path)).toString(
          "base64",
        );
    }
  };
  walk(root);
  return out;
}

const ledgerOf = (rig: AssetRig) =>
  readStudioStatus(rig.root).commands.map((c) => `${c.type}:${c.jobId}`);

describe("packing through the session", () => {
  test("a packed set is a draft record with its atlas stored, its report attached, its basis recorded and one ledger entry", () => {
    const rig = assetRig();
    spriteSet(rig);

    const result = doPack(rig);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const asset = result.asset;
    expect(asset.id).toBe("zeus-pack");
    expect(asset.workingSetId).toBe("w");
    expect<string>(asset.assetId).toBe("placeholder-zeus");
    expect(asset.prior).toBeNull();
    expect(asset.published).toBeNull();
    expect(asset.record.state).toBe("draft");
    expect(asset.record.state === "draft" && asset.record.edit).toBe("idle");
    expect(asset.record.state === "draft" && asset.record.report?.status).toBe(
      "pass",
    );
    const manifest = asset.record.manifest;
    expect(asset.manifestRevision).toBe(
      sha256Hex(new TextEncoder().encode(canonicalManifestText(manifest))),
    );
    expect(asset.reportBasis).toEqual({
      atlasHash: manifest.atlas.blob,
      paletteDigest: paletteDigest(rig.palette),
    });
    expect(rig.session.store.readBlob(manifest.atlas.blob)).toBeDefined();
    expect(ledgerOf(rig).filter((l) => l.startsWith("pack:"))).toEqual([
      "pack:zeus-pack",
    ]);
    expect(readStudioStatus(rig.root).assets).toEqual([asset]);
    expect(asset.licenceReview.manifestRevision).toBe(asset.manifestRevision);
    expect(asset.licenceReview.entries.length).toBe(
      manifest.provenance.licences.length,
    );
    expect(asset.licenceAssessments).toEqual([]);
  });

  test("packing never approves, and a failing report is attached to the draft rather than refused", () => {
    const rig = assetRig();
    const [id] = runSlots(rig, "zeus-idle", "sprite", [
      { state: "idle", direction: "south" },
    ]);
    rig.session.openWorkingSet("w", "zeus-idle", rig.content);
    rig.session.pick("w", id as string);
    const frames = [0, 1, 2, 3].map((i) => paintFigure(rig.content, cell, i));
    frames[2]?.rgba.set([255, 0, 255, 255], (30 * 64 + 30) * 4);
    finishSheet(rig, "e1", "w", cell, [{ slot: "idle/south", frames }]);

    const asset = packOk(rig);

    expect(asset.record.state).toBe("draft");
    expect(asset.record.state === "draft" && asset.record.report?.status).toBe(
      "fail",
    );
    expect(ledgerOf(rig).some((l) => l.startsWith("approve:"))).toBe(false);
  });

  test("a duplicate id, a bad id, a bad asset id and an unknown working set are refused with nothing written", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    const before = tree(rig.root);

    expect(doPack(rig)).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(doPack(rig, { id: "Zeus Pack" })).toMatchObject({
      ok: false,
      reason: "invalid-params",
    });
    expect(doPack(rig, { id: "other", assetId: "Not An Id" })).toMatchObject({
      ok: false,
      reason: "invalid-params",
    });
    expect(doPack(rig, { id: "other", workingSetId: "nope" })).toMatchObject({
      ok: false,
      reason: "not-found",
    });
    expect(doPack(rig, { id: "other", footprint: undefined })).toMatchObject({
      ok: false,
    });

    expect(tree(rig.root)).toEqual(before);
  });

  test("a pack whose ledger or record cannot be written is not acknowledged and leaves no asset", () => {
    const rig = assetRig();
    spriteSet(rig);
    const next = readStudioStatus(rig.root).commands.length + 1;
    mkdirSync(
      join(rig.root, "commands", `${String(next).padStart(8, "0")}.json`),
    );

    const result = doPack(rig);

    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    expect(existsSync(join(rig.root, "assets", "zeus-pack.json"))).toBe(false);
    expect(readStudioStatus(rig.root).assets).toEqual([]);
  });

  test("a closed session refuses every asset operation and a new owner's store is untouched", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    const stale = rig.session;
    stale.close();
    const opened = openStudioSession(rig.root);
    if (opened.kind === "busy") throw new Error("busy");
    const before = tree(rig.root);

    expect(
      stale.pack(
        packInput({ id: "late" }),
        rig.content,
        rig.palette,
        rig.registryRoot,
      ),
    ).toMatchObject({ ok: false, reason: "closed" });
    expect(
      stale.approveAsset("zeus-pack", {}, rig.content, rig.palette),
    ).toMatchObject({ ok: false, reason: "closed" });
    expect(
      stale.publishAsset(
        "zeus-pack",
        rig.content,
        rig.palette,
        rig.registryRoot,
      ),
    ).toMatchObject({ ok: false, reason: "closed" });

    expect(tree(rig.root)).toEqual(before);
    opened.session.close();
  });
});

describe("approving a packed asset", () => {
  test("an explicit approval of a passing draft approves exactly that manifest and atlas and records the licence review", () => {
    const rig = assetRig();
    spriteSet(rig);
    const drafted = packOk(rig);

    const result = approve(rig);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const asset = result.asset;
    expect(asset.record).toMatchObject({
      state: "approved",
      basis: { type: "report-pass" },
    });
    expect(asset.manifestRevision).toBe(drafted.manifestRevision);
    expect(canonicalManifestText(asset.record.manifest)).toBe(
      canonicalManifestText(drafted.record.manifest),
    );
    expect(asset.licenceReview.manifestRevision).toBe(asset.manifestRevision);
    expect(
      asset.licenceReview.entries.every((e) => e.status === "compatible"),
    ).toBe(true);
    expect(asset.licenceAssessments.length).toBeGreaterThan(0);
    expect(ledgerOf(rig).filter((l) => l.startsWith("approve:"))).toEqual([
      "approve:zeus-pack",
    ]);
    expect(rig.session.store.readAsset("zeus-pack")).toEqual({
      kind: "found",
      value: asset,
    });
  });

  test("unknown terms with no assessment stop approval before any write", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    const before = tree(rig.root);

    const result = rig.session.approveAsset(
      "zeus-pack",
      {},
      rig.content,
      rig.palette,
    );

    expect(result).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(!result.ok && result.message).toMatch(/unclear/);
    expect(tree(rig.root)).toEqual(before);
  });

  test("an assessment of a record the manifest lacks, twice over, or of terms the studio decides is refused", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    const licences = manifestOf(rig).provenance.licences;
    const good = assessments(licences);
    const before = tree(rig.root);
    const attempt = (list: LicenceAssessment[]) =>
      rig.session.approveAsset(
        "zeus-pack",
        { assessments: list },
        rig.content,
        rig.palette,
      );

    expect(
      attempt([
        ...good,
        {
          record: { subject: "x", role: "input", licence: "Custom" },
          disposition: "mit-compatible",
          reason: "r",
        },
      ]),
    ).toMatchObject({ ok: false, reason: "invalid-params" });
    expect(attempt([...good, ...good])).toMatchObject({
      ok: false,
      reason: "invalid-params",
    });
    const mit = licences.find((l) => l.licence === "MIT");
    if (mit !== undefined)
      expect(
        attempt([
          ...good,
          { record: mit, disposition: "mit-compatible", reason: "r" },
        ]),
      ).toMatchObject({ ok: false, reason: "invalid-params" });

    expect(tree(rig.root)).toEqual(before);
  });

  test("an incompatible assessment blocks approval as incompatible", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    const list = assessments(manifestOf(rig).provenance.licences);
    list[0] = {
      ...(list[0] as LicenceAssessment),
      disposition: "incompatible",
      reason: "no redistribution",
    };

    const result = rig.session.approveAsset(
      "zeus-pack",
      { assessments: list },
      rig.content,
      rig.palette,
    );

    expect(!result.ok && result.message).toMatch(
      /incompatible.*no redistribution/s,
    );
  });

  test("a known non-commercial original-work licence blocks approval, with or without an exception or an assessment", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig, { originalWork: { licence: "CC-BY-NC-4.0" } });
    const licences = manifestOf(rig).provenance.licences;
    const before = tree(rig.root);

    const plain = approve(rig);
    const withException = approve(rig, "zeus-pack", {
      exception: { reason: "owner accepts it" },
    });
    const nc = licences.find(
      (l) => l.licence === "CC-BY-NC-4.0",
    ) as LicenceRecord;
    const assessed = rig.session.approveAsset(
      "zeus-pack",
      {
        assessments: [
          ...assessments(licences),
          { record: nc, disposition: "mit-compatible", reason: "it is fine" },
        ],
      },
      rig.content,
      rig.palette,
    );

    expect(plain.ok).toBe(false);
    expect(!plain.ok && plain.message).toMatch(/CC-BY-NC-4\.0|incompatible/);
    expect(withException.ok).toBe(false);
    expect(assessed).toMatchObject({ ok: false, reason: "invalid-params" });
    expect(tree(rig.root)).toEqual(before);
  });

  test("a recorded 'never canon, never publication' term blocks approval whatever the subject", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig, {
      originalWork: {
        licence: "Benchmark only. Never canon, never publication.",
      },
    });

    expect(approve(rig)).toMatchObject({ ok: false });
    expect(
      approve(rig, "zeus-pack", { exception: { reason: "owner says so" } }),
    ).toMatchObject({ ok: false });
  });

  test("CC0 original work is accepted without any assessment", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig, { originalWork: { licence: "CC0-1.0" } });
    const licences = manifestOf(rig).provenance.licences;
    const list = assessments(licences);

    expect(list.some((a) => a.record.licence === "CC0-1.0")).toBe(false);
    expect(approve(rig).ok).toBe(true);
  });

  function failingRig() {
    const rig = assetRig();
    const [id] = runSlots(rig, "zeus-idle", "sprite", [
      { state: "idle", direction: "south" },
    ]);
    rig.session.openWorkingSet("w", "zeus-idle", rig.content);
    rig.session.pick("w", id as string);
    const frames = [0, 1, 2, 3].map((i) => paintFigure(rig.content, cell, i));
    frames[1]?.rgba.set([255, 0, 255, 255], (20 * 64 + 20) * 4);
    finishSheet(rig, "e1", "w", cell, [{ slot: "idle/south", frames }]);
    return { rig, drafted: packOk(rig) };
  }

  test("a failing report needs an owner exception with a reason, and none is ever applied automatically", () => {
    const { rig } = failingRig();
    const before = tree(rig.root);

    for (const exception of [undefined, { reason: "" }, { reason: "   " }]) {
      const result = approve(
        rig,
        "zeus-pack",
        exception === undefined ? {} : { exception },
      );
      expect(result).toMatchObject({ ok: false });
    }

    expect(tree(rig.root)).toEqual(before);
  });

  test("an owner exception approves the failing draft, rebinds the licence review to the final manifest hash and leaves the pixels alone", () => {
    const { rig, drafted } = failingRig();

    const result = approve(rig, "zeus-pack", {
      exception: { reason: "the magenta pixel is intended" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const asset = result.asset;
    expect(asset.record).toMatchObject({
      state: "approved",
      basis: {
        type: "owner-exception",
        reason: "the magenta pixel is intended",
      },
    });
    expect(asset.record.manifest.provenance.ownerException).toEqual({
      reason: "the magenta pixel is intended",
    });
    const finalRevision = sha256Hex(
      new TextEncoder().encode(canonicalManifestText(asset.record.manifest)),
    );
    expect(asset.manifestRevision).toBe(finalRevision);
    expect(asset.manifestRevision).not.toBe(drafted.manifestRevision);
    expect(asset.licenceReview.manifestRevision).toBe(finalRevision);
    expect(asset.reportBasis).toEqual(drafted.reportBasis);
    expect(asset.record.manifest.atlas).toEqual(drafted.record.manifest.atlas);
    const atlas = rig.session.store.readBlob(
      asset.record.manifest.atlas.blob,
    ) as Uint8Array;
    expect(sha256Hex(atlas)).toBe(asset.record.manifest.atlas.blob);
  });

  test("an exception never clears licence terms", () => {
    const { rig } = failingRig();
    const result = rig.session.approveAsset(
      "zeus-pack",
      { exception: { reason: "owner accepts it" } },
      rig.content,
      rig.palette,
    );

    expect(!result.ok && result.message).toMatch(/unclear/);
  });

  test("a stale atlas, a changed palette, a draft palette and a palette under another id are refused", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    const atlasHash = manifestOf(rig).atlas.blob;
    const before = tree(rig.root);
    const attempt = (palette = rig.palette) =>
      rig.session.approveAsset(
        "zeus-pack",
        { assessments: assessments(manifestOf(rig).provenance.licences) },
        rig.content,
        palette,
      );
    const changed = paletteFixture().palette;
    const altered = {
      ...changed,
      families: changed.families.map((f, i) =>
        i === 1 ? { ...f, ramps: [...f.ramps].reverse() } : f,
      ),
    };

    const reapproved = {
      ...altered,
      approval: { status: "approved" as const, digest: paletteDigest(altered) },
    };
    expect(attempt(altered)).toMatchObject({ ok: false });
    const rebuilt = attempt(reapproved as typeof rig.palette);
    expect(rebuilt).toMatchObject({ ok: false });
    expect(!rebuilt.ok && rebuilt.message).toMatch(/palette changed/);
    expect(attempt(paletteFixture("draft").palette)).toMatchObject({
      ok: false,
    });
    expect(
      attempt(paletteFixture("approved", "another-master").palette),
    ).toMatchObject({ ok: false });
    writeFileSync(
      join(rig.root, "blobs", `${atlasHash}.png`),
      "not the atlas any more",
    );
    const stale = attempt();
    expect(stale).toMatchObject({ ok: false });
    expect(
      Object.keys(tree(rig.root)).filter((k) => k.startsWith("assets/")),
    ).toEqual(Object.keys(before).filter((k) => k.startsWith("assets/")));
  });

  test("a record whose atlas basis or manifest revision no longer matches is refused", () => {
    const rig = assetRig();
    spriteSet(rig);
    const asset = packOk(rig);
    const mutate = (change: (r: Record<string, unknown>) => void) => {
      const record = JSON.parse(
        readFileSync(join(rig.root, "assets", "zeus-pack.json"), "utf8"),
      );
      change(record);
      writeFileSync(
        join(rig.root, "assets", "zeus-pack.json"),
        JSON.stringify(record),
      );
    };
    const run = () =>
      rig.session.approveAsset(
        "zeus-pack",
        { assessments: assessments(asset.record.manifest.provenance.licences) },
        rig.content,
        rig.palette,
      );

    mutate((r) => {
      (r.reportBasis as Record<string, string>).atlasHash = sha256Hex(
        new Uint8Array([4]),
      );
    });
    expect(run()).toMatchObject({ ok: false });
    mutate((r) => {
      (r.reportBasis as Record<string, string>).atlasHash =
        asset.reportBasis.atlasHash;
      r.manifestRevision = sha256Hex(new Uint8Array([4]));
    });
    expect(run()).toMatchObject({ ok: false });
  });

  test("the persisted job ledger is audited: changed outputs, a failed source job and a different request are refused", () => {
    const rig = assetRig();
    const { jobId } = spriteSet(rig);
    packOk(rig);
    const record = readStudioStatus(rig.root).jobs.find(
      (j) => j.job.id === jobId,
    );
    if (record?.job.status !== "succeeded") throw new Error("no job");
    const attempt = () =>
      rig.session.approveAsset(
        "zeus-pack",
        { assessments: assessments(manifestOf(rig).provenance.licences) },
        rig.content,
        rig.palette,
      );
    const original = readFileSync(
      join(rig.root, "jobs", `${jobId}.json`),
      "utf8",
    );

    rig.session.store.putJob({
      ...record,
      job: {
        ...record.job,
        outputs: [
          {
            medium: "image",
            hash: sha256Hex(new Uint8Array([8])),
            width: 512,
            height: 640,
          },
        ],
      },
    });
    expect(attempt()).toMatchObject({ ok: false });
    writeFileSync(join(rig.root, "jobs", `${jobId}.json`), original);
    rig.session.store.putJob({
      schemaVersion: 1,
      source: record.source,
      job: { ...record.job, status: "failed", error: "x" } as never,
    });
    expect(attempt()).toMatchObject({ ok: false });
    writeFileSync(join(rig.root, "jobs", `${jobId}.json`), original);
    rig.session.store.putJob({
      ...record,
      job: { ...record.job, request: { ...record.job.request, seed: 9999 } },
    });
    expect(attempt()).toMatchObject({ ok: false });
    writeFileSync(join(rig.root, "jobs", `${jobId}.json`), original);
    expect(attempt().ok).toBe(true);
  });

  test("an approval that cannot be written is not acknowledged and leaves the draft", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    const next = readStudioStatus(rig.root).commands.length + 1;
    mkdirSync(
      join(rig.root, "commands", `${String(next).padStart(8, "0")}.json`),
    );

    const result = approve(rig);

    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    expect(readStudioStatus(rig.root).assets[0]?.record.state).toBe("draft");
  });

  test("an approved or unknown asset cannot be approved again", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    ready(rig);
    const before = tree(rig.root);

    expect(approve(rig)).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(
      rig.session.approveAsset("nobody", {}, rig.content, rig.palette),
    ).toMatchObject({ ok: false, reason: "not-found" });

    expect(tree(rig.root)).toEqual(before);
  });
});

describe("publishing an approved asset", () => {
  test("publishes the approved record unchanged, selects its revision, then records canon once", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    const approved = ready(rig);

    const result = publish(rig);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const asset = result.asset;
    expect(asset.record.state).toBe("canon");
    expect(asset.published).toEqual({ revision: approved.manifestRevision });
    const index = JSON.parse(
      readFileSync(join(rig.registryRoot, "index.json"), "utf8"),
    );
    expect(index.entries).toEqual([
      { assetId: "placeholder-zeus", revision: approved.manifestRevision },
    ]);
    expect(
      readFileSync(
        join(
          rig.registryRoot,
          "manifests",
          `${approved.manifestRevision}.json`,
        ),
        "utf8",
      ),
    ).toBe(canonicalManifestText(approved.record.manifest));
    const atlasHash = approved.record.manifest.atlas.blob;
    expect(
      Array.from(
        readFileSync(join(rig.registryRoot, "blobs", `${atlasHash}.png`)),
      ),
    ).toEqual(Array.from(rig.session.store.readBlob(atlasHash) as Uint8Array));
    expect(ledgerOf(rig).filter((l) => l.startsWith("publish:"))).toEqual([
      "publish:zeus-pack",
    ]);
    expect(
      loadRegistry(
        rig.registryRoot,
        rig.content.vocabulary,
      ).snapshot.entries.has("placeholder-zeus"),
    ).toBe(true);
    expect(rig.session.store.readAsset("zeus-pack")).toEqual({
      kind: "found",
      value: asset,
    });
  });

  test("a draft, a published asset and an unknown asset are not published", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);

    expect(publish(rig)).toMatchObject({ ok: false, reason: "wrong-state" });
    ready(rig);
    expect(publish(rig).ok).toBe(true);
    expect(publish(rig)).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(publish(rig, "nobody")).toMatchObject({
      ok: false,
      reason: "not-found",
    });
    expect(existsSync(rig.registryRoot)).toBe(true);
  });

  test("a failed gate leaves the registry byte-identical: job ledger, licence review, palette and atlas are rechecked", () => {
    const rig = assetRig();
    const { jobId } = spriteSet(rig);
    packOk(rig);
    const approved = ready(rig);
    const first = rig.registryRoot;
    mkdirSync(first, { recursive: true });
    const before = tree(rig.registryRoot);
    const job = readStudioStatus(rig.root).jobs.find((j) => j.job.id === jobId);
    if (job?.job.status !== "succeeded") throw new Error("no job");
    const jobFile = join(rig.root, "jobs", `${jobId}.json`);
    const jobBytes = readFileSync(jobFile, "utf8");
    const assetFile = join(rig.root, "assets", "zeus-pack.json");
    const assetBytes = readFileSync(assetFile, "utf8");

    rig.session.store.putJob({
      ...job,
      job: {
        ...job.job,
        outputs: [
          {
            medium: "image",
            hash: sha256Hex(new Uint8Array([8])),
            width: 512,
            height: 640,
          },
        ],
      },
    });
    expect(publish(rig)).toMatchObject({ ok: false });
    writeFileSync(jobFile, jobBytes);

    const record = JSON.parse(assetBytes);
    record.licenceReview.entries[0].status = "incompatible";
    writeFileSync(assetFile, JSON.stringify(record));
    expect(publish(rig)).toMatchObject({ ok: false });
    const reviewed = JSON.parse(assetBytes);
    reviewed.licenceReview.entries = [];
    writeFileSync(assetFile, JSON.stringify(reviewed));
    expect(publish(rig)).toMatchObject({ ok: false });
    const licensed = JSON.parse(assetBytes);
    licensed.record.manifest.provenance.licences[0].licence = "CC-BY-NC-4.0";
    writeFileSync(assetFile, JSON.stringify(licensed));
    expect(publish(rig)).toMatchObject({ ok: false });
    writeFileSync(assetFile, assetBytes);

    const palette = paletteFixture().palette;
    expect(
      rig.session.publishAsset(
        "zeus-pack",
        rig.content,
        { ...palette, families: palette.families.slice(0, 2) },
        rig.registryRoot,
      ),
    ).toMatchObject({ ok: false });
    expect(
      rig.session.publishAsset(
        "zeus-pack",
        rig.content,
        paletteFixture("draft").palette,
        rig.registryRoot,
      ),
    ).toMatchObject({ ok: false });

    const atlasFile = join(
      rig.root,
      "blobs",
      `${approved.record.manifest.atlas.blob}.png`,
    );
    const atlasBytes = readFileSync(atlasFile);
    writeFileSync(atlasFile, "corrupt");
    expect(publish(rig)).toMatchObject({ ok: false });
    writeFileSync(atlasFile, atlasBytes);

    expect(tree(rig.registryRoot)).toEqual(before);
    expect(ledgerOf(rig).some((l) => l.startsWith("publish:"))).toBe(false);
    expect(publish(rig).ok).toBe(true);
  });

  test("a registry whose current revision is neither the packed prior nor this one is refused", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    ready(rig);
    mkdirSync(rig.registryRoot, { recursive: true });
    writeFileSync(
      join(rig.registryRoot, "index.json"),
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            assetId: "placeholder-zeus",
            revision: sha256Hex(new Uint8Array([7])),
          },
        ],
      }),
    );
    const before = tree(rig.registryRoot);

    const result = publish(rig);

    expect(!result.ok && result.message).toMatch(/registry changed/);
    expect(tree(rig.registryRoot)).toEqual(before);
  });

  test("a registry that cannot be written to is refused and nothing is recorded as published", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    ready(rig);
    writeFileSync(rig.registryRoot, "not a directory");

    const result = publish(rig);

    expect(result.ok).toBe(false);
    expect(ledgerOf(rig).some((l) => l.startsWith("publish:"))).toBe(false);
    expect(readStudioStatus(rig.root).assets[0]?.record.state).toBe("approved");
  });

  test("a local write that fails after canon is written is reported as a failure, and the retry finishes it with one ledger entry and the same index", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    const approved = ready(rig);
    const next = readStudioStatus(rig.root).commands.length + 1;
    const blocker = join(
      rig.root,
      "commands",
      `${String(next).padStart(8, "0")}.json`,
    );
    mkdirSync(blocker);

    const failed = publish(rig);

    expect(failed).toMatchObject({ ok: false, reason: "write-failed" });
    const indexBytes = readFileSync(
      join(rig.registryRoot, "index.json"),
      "utf8",
    );
    expect(JSON.parse(indexBytes).entries[0].revision).toBe(
      approved.manifestRevision,
    );
    expect(readStudioStatus(rig.root).assets[0]?.record.state).toBe("approved");
    expect(readStudioStatus(rig.root).assets[0]?.published).toBeNull();
    rmSyncDir(blocker);

    const retried = publish(rig);

    expect(retried.ok).toBe(true);
    expect(readFileSync(join(rig.registryRoot, "index.json"), "utf8")).toBe(
      indexBytes,
    );
    expect(ledgerOf(rig).filter((l) => l.startsWith("publish:"))).toEqual([
      "publish:zeus-pack",
    ]);
    expect(readStudioStatus(rig.root).assets[0]).toMatchObject({
      record: { state: "canon" },
      published: { revision: approved.manifestRevision },
    });
  });
});

import { rmSync } from "node:fs";

const rmSyncDir = (path: string) =>
  rmSync(path, { recursive: true, force: true });

describe("a publish whose record write fails after the ledger entry", () => {
  test("the retry finishes the record without a second ledger entry", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    const approved = ready(rig);
    chmodSync(join(rig.root, "assets"), 0o500);
    let failed: ReturnType<typeof publish>;
    try {
      failed = publish(rig);
    } finally {
      chmodSync(join(rig.root, "assets"), 0o700);
    }

    expect(failed).toMatchObject({ ok: false, reason: "write-failed" });
    expect(ledgerOf(rig).filter((l) => l.startsWith("publish:"))).toEqual([
      "publish:zeus-pack",
    ]);
    expect(readStudioStatus(rig.root).assets[0]?.record.state).toBe("approved");

    expect(publish(rig).ok).toBe(true);

    expect(ledgerOf(rig).filter((l) => l.startsWith("publish:"))).toEqual([
      "publish:zeus-pack",
    ]);
    expect(readStudioStatus(rig.root).assets[0]).toMatchObject({
      record: { state: "canon" },
      published: { revision: approved.manifestRevision },
    });
  });
});

describe("carrying published cells through to canon", () => {
  /** Publishes the south idle state as canon and packs the north one beside it. */
  function published() {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    ready(rig);
    expect(publish(rig).ok).toBe(true);
    const [id] = runSlots(
      rig,
      "zeus-north",
      "sprite",
      [{ state: "idle", direction: "north" }],
      500,
    );
    rig.session.openWorkingSet("w2", "zeus-north", rig.content);
    rig.session.pick("w2", id as string);
    finishSheet(rig, "e9", "w2", cell, [
      {
        slot: "idle/north",
        frames: [0, 1, 2, 3].map((i) => paintFigure(rig.content, cell, i + 3)),
      },
    ]);
    return rig;
  }
  const packSecond = (rig: AssetRig, over: Partial<PackInput> = {}) =>
    doPack(rig, {
      id: "zeus-pack-2",
      workingSetId: "w2",
      carriedParams: params,
      ...over,
    });

  test("a new state packs beside the published one, names the real prior revision, and publishes without any old job ledger", () => {
    const rig = published();
    const first = rig.session.store.readAsset("zeus-pack");
    if (first.kind !== "found") throw new Error("no first");
    const result = packSecond(rig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.asset.prior).toBe(first.value.manifestRevision);
    expect<unknown>(
      result.asset.record.manifest.provenance.sourceAssets,
    ).toEqual([
      { assetId: "placeholder-zeus", revision: first.value.manifestRevision },
    ]);
    const second = approve(rig, "zeus-pack-2");
    expect(second.ok).toBe(true);

    expect(publish(rig, "zeus-pack-2").ok).toBe(true);

    const index = JSON.parse(
      readFileSync(join(rig.registryRoot, "index.json"), "utf8"),
    );
    expect(index.entries[0].revision).toBe(result.asset.manifestRevision);
    expect(
      existsSync(
        join(
          rig.registryRoot,
          "manifests",
          `${first.value.manifestRevision}.json`,
        ),
      ),
    ).toBe(true);
  });

  test("a source revision that is missing or corrupt blocks publishing and leaves the registry as it was", () => {
    const rig = published();
    const first = rig.session.store.readAsset("zeus-pack");
    if (first.kind !== "found") throw new Error("no first");
    expect(packSecond(rig).ok).toBe(true);
    expect(approve(rig, "zeus-pack-2").ok).toBe(true);
    const manifestFile = join(
      rig.registryRoot,
      "manifests",
      `${first.value.manifestRevision}.json`,
    );
    const good = readFileSync(manifestFile);
    const before = tree(rig.registryRoot);

    writeFileSync(manifestFile, "{}");
    const corrupt = publish(rig, "zeus-pack-2");
    rmSyncDir(manifestFile);
    const missing = publish(rig, "zeus-pack-2");

    expect(corrupt).toMatchObject({ ok: false });
    expect(missing).toMatchObject({ ok: false });
    writeFileSync(manifestFile, good);
    expect(tree(rig.registryRoot)).toEqual(before);
    expect(publish(rig, "zeus-pack-2").ok).toBe(true);
  });

  test("a carried cell whose pixels differ from the source revision blocks publishing even when the record is self-consistent", () => {
    const rig = published();
    expect(packSecond(rig).ok).toBe(true);
    expect(approve(rig, "zeus-pack-2").ok).toBe(true);
    const file = join(rig.root, "assets", "zeus-pack-2.json");
    const record = JSON.parse(readFileSync(file, "utf8"));
    const manifest = record.record.manifest;
    const atlas = decodePng(
      rig.session.store.readBlob(manifest.atlas.blob) as Uint8Array,
    );
    if (!atlas.ok) throw new Error("no atlas");
    const rgba = Uint8Array.from(atlas.image.rgba);
    rgba[(40 * atlas.image.width + 30) * 4] =
      (rgba[(40 * atlas.image.width + 30) * 4] as number) ^ 1;
    const changed = rig.session.store.putBlob(
      encodeRgbaPng(rgba, atlas.image.width, atlas.image.height),
    );
    manifest.atlas.blob = changed;
    const revision = sha256Hex(
      new TextEncoder().encode(canonicalManifestText(manifest)),
    );
    record.manifestRevision = revision;
    record.reportBasis.atlasHash = changed;
    record.licenceReview.manifestRevision = revision;
    writeFileSync(file, JSON.stringify(record));
    const before = tree(rig.registryRoot);

    const result = publish(rig, "zeus-pack-2");

    expect(!result.ok && result.message).toMatch(
      /idle\/south frame \d differs from the source revision's pixels/,
    );
    expect(tree(rig.registryRoot)).toEqual(before);
  });

  test("packing is refused when the published revision it would carry from cannot be read", () => {
    const rig = published();
    const first = rig.session.store.readAsset("zeus-pack");
    if (first.kind !== "found") throw new Error("no first");
    writeFileSync(
      join(
        rig.registryRoot,
        "manifests",
        `${first.value.manifestRevision}.json`,
      ),
      "{}",
    );

    expect(packSecond(rig)).toMatchObject({ ok: false });
  });

  test("a canon revision published after this one was packed makes the publish a registry-changed refusal", () => {
    const rig = published();
    expect(packSecond(rig).ok).toBe(true);
    expect(approve(rig, "zeus-pack-2").ok).toBe(true);
    const [other] = runSlots(
      rig,
      "zeus-other",
      "sprite",
      [{ state: "idle", direction: "east" }],
      900,
    );
    rig.session.openWorkingSet("w3", "zeus-other", rig.content);
    rig.session.pick("w3", other as string);
    finishSheet(rig, "e10", "w3", cell, [
      {
        slot: "idle/east",
        frames: [0, 1, 2, 3].map((i) => paintFigure(rig.content, cell, i + 5)),
      },
    ]);
    expect(
      doPack(rig, {
        id: "zeus-pack-3",
        workingSetId: "w3",
        carriedParams: params,
      }).ok,
    ).toBe(true);
    expect(approve(rig, "zeus-pack-3").ok).toBe(true);
    expect(publish(rig, "zeus-pack-3").ok).toBe(true);
    const before = tree(rig.registryRoot);

    const result = publish(rig, "zeus-pack-2");

    expect(!result.ok && result.message).toMatch(/registry changed/);
    expect(tree(rig.registryRoot)).toEqual(before);
  });
});

void pngOf;

describe("checking carried cells against their source", () => {
  const prior = () => {
    const rig = assetRig();
    spriteSet(rig);
    const asset = packOk(rig);
    const atlas = rig.session.store.readBlob(
      asset.record.manifest.atlas.blob,
    ) as Uint8Array;
    return { manifest: asset.record.manifest, atlas };
  };

  test("identical cells, durations and frame counts match", () => {
    const source = prior();

    expect(
      carriedCellsMismatch({
        manifest: source.manifest,
        atlas: source.atlas,
        replaced: [],
        sources: [source],
      }),
    ).toBeUndefined();
  });

  test("a cell that differs by one channel, a different duration, a different frame count or no source is a mismatch", () => {
    const source = prior();
    const decoded = decodePng(source.atlas);
    if (!decoded.ok) throw new Error("no atlas");
    const rgba = Uint8Array.from(decoded.image.rgba);
    rgba[(40 * 256 + 100) * 4 + 1] =
      (rgba[(40 * 256 + 100) * 4 + 1] as number) ^ 1;
    const changed = encodeRgbaPng(
      rgba,
      decoded.image.width,
      decoded.image.height,
    );
    const check = (over: Partial<Parameters<typeof carriedCellsMismatch>[0]>) =>
      carriedCellsMismatch({
        manifest: source.manifest,
        atlas: source.atlas,
        replaced: [],
        sources: [source],
        ...over,
      });
    const timed = JSON.parse(JSON.stringify(source.manifest));
    timed.animations[0].frames[1].durationMs = 166;
    const shorter = JSON.parse(JSON.stringify(source.manifest));
    shorter.animations[0].frames.pop();

    expect(check({ atlas: changed })).toMatch(/pixels/);
    expect(check({ manifest: timed })).toMatch(/duration/);
    expect(check({ manifest: shorter })).toMatch(/not the cell/);
    expect(check({ sources: [] })).toMatch(/no source revision/);
  });

  test("a cell this working set replaced is not compared", () => {
    const source = prior();
    const decoded = decodePng(source.atlas);
    if (!decoded.ok) throw new Error("no atlas");
    const rgba = Uint8Array.from(decoded.image.rgba);
    rgba[10] = (rgba[10] as number) ^ 1;
    const changed = encodeRgbaPng(
      rgba,
      decoded.image.width,
      decoded.image.height,
    );

    expect(
      carriedCellsMismatch({
        manifest: source.manifest,
        atlas: changed,
        replaced: ["idle/south"],
        sources: [],
      }),
    ).toBeUndefined();
  });
});

describe("the selected production profile's terms", () => {
  test("its runtime and components, declared as the profile pins them, need no assessment from pack through publish", () => {
    const facts = selectedProfileFacts();
    const rig = assetRig({ engine: facts });
    spriteSet(rig);

    const drafted = packOk(rig);

    const licences = drafted.record.manifest.provenance.licences;
    expect(licences.map((l) => [l.subject, l.role, l.licence])).toEqual([
      [SELECTED_PROFILE.runtime.id, "runtime", "MIT"],
      ["z_image_turbo-Q3_K", "model", "Apache-2.0"],
      ["Qwen3-4B-Instruct-2507-Q4_K_M", "encoder", "Apache-2.0"],
      ["z-image-ae", "vae", "Apache-2.0"],
      ["placeholder-zeus", "original-work", "MIT"],
    ]);
    const provenance = drafted.record.manifest.provenance;
    if (provenance.method !== "generated")
      throw new Error("expected generated");
    const generation = provenance.generations[0];
    expect(generation?.runtime).toEqual({
      name: SELECTED_PROFILE.runtime.id,
      version: SELECTED_PROFILE.runtime.commit,
    });
    for (const [ref, role] of [
      [generation?.model, "diffusion-model"],
      [generation?.encoder, "text-encoder"],
      [generation?.vae, "vae"],
    ] as const) {
      const pin = SELECTED_PROFILE.components.find((c) => c.role === role);
      expect<unknown>(ref).toEqual({ id: pin?.id, sha256: pin?.sha256 });
    }
    expect(generation?.loras).toEqual([]);
    expect(
      drafted.licenceReview.entries.map((e) => [e.source, e.status]),
    ).toEqual(licences.map(() => ["pinned-terms", "compatible"]));

    const approved = rig.session.approveAsset(
      "zeus-pack",
      {},
      rig.content,
      rig.palette,
    );

    expect(approved.ok).toBe(true);
    expect(approved.ok && approved.asset.licenceAssessments).toEqual([]);
    expect(publish(rig).ok).toBe(true);
  });

  test("the benchmark-only LoRA terms as recorded in the component pins block canon whatever the LoRA's id", () => {
    const lora = {
      id: "any-id-at-all",
      sha256: sha256Hex(new Uint8Array([6])),
    };
    const terms =
      "Civitai custom terms; owner approved benchmark ONLY (model 1770073 / version 2454660 / file 2344890). Never canon, never publication.";
    const facts = selectedProfileFacts();
    const rig = assetRig({
      engine: {
        ...facts,
        loras: [lora],
        licences: [
          ...facts.licences,
          { subject: lora.id, role: "lora", licence: terms },
        ],
      },
    });
    spriteSet(rig);
    packOk(rig);

    const attempt = rig.session.approveAsset(
      "zeus-pack",
      { exception: { reason: "the owner wants it" } },
      rig.content,
      rig.palette,
    );

    expect(!attempt.ok && attempt.message).toMatch(
      /lora "any-id-at-all" is incompatible/,
    );
  });
});

describe("a portrait through to canon", () => {
  const face = { w: 96, h: 96 };

  function portraitSet(rig: AssetRig, setId = "wp", requestId = "zeus-faces") {
    const expressions = [...rig.content.vocabulary.expressions];
    const jobs = runSlots(
      rig,
      requestId,
      "portrait",
      expressions.map((expression) => ({ expression })),
    );
    rig.session.openWorkingSet(setId, requestId, rig.content);
    for (const id of jobs) rig.session.pick(setId, id);
    return { expressions, jobs };
  }
  const portraitPack = (rig: AssetRig, over: Partial<PackInput> = {}) =>
    rig.session.pack(
      {
        id: "face-pack",
        workingSetId: "wp",
        assetId: "zeus-portrait",
        styleTag: "draft",
        stillFrameMs: 1000,
        originalWork: { licence: "MIT" },
        ...over,
      },
      rig.content,
      rig.palette,
      rig.registryRoot,
    );
  const cellAt = (atlas: Uint8Array, index: number) => {
    const image = decodePng(atlas);
    if (!image.ok) throw new Error("no atlas");
    const out = new Uint8Array(face.w * face.h * 4);
    for (let row = 0; row < face.h; row += 1)
      out.set(
        image.image.rgba.subarray(
          (row * image.image.width + index * face.w) * 4,
          (row * image.image.width + (index + 1) * face.w) * 4,
        ),
        row * face.w * 4,
      );
    return Array.from(out);
  };
  const bytesIn = (root: string, dir: string) =>
    Object.fromEntries(
      readdirSync(join(root, dir)).map((name) => [
        name,
        readFileSync(join(root, dir, name), "base64"),
      ]),
    );

  test("six expressions, picks with one shared hand sheet, pack in vocabulary order, approve and publish into a temp canon", () => {
    const rig = assetRig();
    const { expressions } = portraitSet(rig);
    const edited = [expressions[1] as string, expressions[4] as string];
    const handFrames = edited.map((_, i) =>
      paintFigure(rig.content, face, i + 30),
    );
    finishSheet(
      rig,
      "e1",
      "wp",
      face,
      edited.map((slot, i) => ({
        slot,
        frames: [handFrames[i] as never],
        durations: [750],
      })),
    );
    const before = {
      jobs: bytesIn(rig.root, "jobs"),
      candidates: bytesIn(rig.root, "candidates"),
      blobs: Object.fromEntries(Object.entries(bytesIn(rig.root, "blobs"))),
    };

    const drafted = portraitPack(rig);
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    const approved = rig.session.approveAsset(
      "face-pack",
      {
        assessments: assessments(
          drafted.asset.record.manifest.provenance.licences,
        ),
      },
      rig.content,
      rig.palette,
    );
    expect(approved.ok).toBe(true);
    const published = rig.session.publishAsset(
      "face-pack",
      rig.content,
      rig.palette,
      rig.registryRoot,
    );

    expect(published.ok).toBe(true);
    if (!published.ok || !approved.ok) return;
    const manifest = approved.asset.record.manifest;
    if (manifest.kind !== "portrait") throw new Error("expected a portrait");
    expect(manifest.expressions.map((e) => e.expression)).toEqual(expressions);
    expect(manifest.expressions.map((e) => e.frame.durationMs)).toEqual(
      expressions.map((e) => (edited.includes(e) ? 750 : 1000)),
    );
    expect(manifest.provenance.handEdits.map((h) => h.description)).toEqual([
      "hand edit e1",
    ]);
    const revision = sha256Hex(
      new TextEncoder().encode(canonicalManifestText(manifest)),
    );
    const index = JSON.parse(
      readFileSync(join(rig.registryRoot, "index.json"), "utf8"),
    );
    expect(index.entries).toEqual([{ assetId: "zeus-portrait", revision }]);
    const registryAtlas = new Uint8Array(
      readFileSync(
        join(rig.registryRoot, "blobs", `${manifest.atlas.blob}.png`),
      ),
    );
    expect(sha256Hex(registryAtlas)).toBe(manifest.atlas.blob);
    const status = readStudioStatus(rig.root);
    const set = status.workingSets.find((s) => s.id === "wp");
    for (const [index, expression] of expressions.entries()) {
      const authored = set?.frames[expression];
      const hash =
        authored?.frames[0]?.hash ?? set?.picks[expression]?.imageHash;
      const stored = decodePng(
        rig.session.store.readBlob(hash as never) as Uint8Array,
      );
      if (!stored.ok) throw new Error("no cell");
      expect(cellAt(registryAtlas, index)).toEqual(
        Array.from(stored.image.rgba),
      );
    }
    expect(cellAt(registryAtlas, 1)).toEqual(
      Array.from((handFrames[0] as { rgba: Uint8Array }).rgba),
    );
    expect({
      jobs: bytesIn(rig.root, "jobs"),
      candidates: bytesIn(rig.root, "candidates"),
      blobs: Object.fromEntries(
        Object.entries(bytesIn(rig.root, "blobs")).filter(
          ([name]) => name in before.blobs,
        ),
      ),
    }).toEqual(before);
    expect(published.asset.record.state).toBe("canon");
  });

  test("a one-expression portrait set carries the other five from the published revision, with real older sources and no authoring ledger of the earlier work", () => {
    const first = assetRig();
    portraitSet(first);
    const drafted = portraitPack(first);
    if (!drafted.ok) throw new Error(drafted.message);
    const oldApproved = first.session.approveAsset(
      "face-pack",
      {
        assessments: assessments(
          drafted.asset.record.manifest.provenance.licences,
        ),
      },
      first.content,
      first.palette,
    );
    if (!oldApproved.ok) throw new Error(oldApproved.message);
    expect(
      first.session.publishAsset(
        "face-pack",
        first.content,
        first.palette,
        first.registryRoot,
      ).ok,
    ).toBe(true);
    const older = oldApproved.asset.manifestRevision;
    const oldManifest = oldApproved.asset.record.manifest;
    if (oldManifest.kind !== "portrait") throw new Error("expected a portrait");
    const oldAtlas = first.session.store.readBlob(
      oldManifest.atlas.blob,
    ) as Uint8Array;
    first.session.close();

    // A new authoring root that has never seen the earlier work, over the same canon.
    const rig = assetRig({ registryRoot: first.registryRoot });
    const [job] = runSlots(
      rig,
      "zeus-awed",
      "portrait",
      [{ expression: "awed" }],
      700,
    );
    expect(rig.session.openWorkingSet("wp", "zeus-awed", rig.content)).toEqual({
      ok: true,
    });
    expect(rig.session.store.readWorkingSet("wp")).toMatchObject({
      value: { required: ["awed"], status: "open" },
    });
    expect(rig.session.pick("wp", job as string)).toEqual({ ok: true });
    expect(rig.session.store.readWorkingSet("wp")).toMatchObject({
      value: { status: "complete" },
    });
    expect(readStudioStatus(rig.root).jobs.map((j) => j.job.id)).toEqual([
      job as string,
    ]);

    const result = portraitPack(rig, {
      id: "face-pack-2",
      carriedParams: params,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const manifest = result.asset.record.manifest;
    if (manifest.kind !== "portrait") throw new Error("expected a portrait");
    expect(result.asset.prior).toBe(older);
    expect<unknown>(manifest.provenance.sourceAssets).toEqual([
      { assetId: "zeus-portrait", revision: older },
    ]);
    expect(manifest.expressions.map((e) => e.expression)).toEqual(
      oldManifest.expressions.map((e) => e.expression),
    );
    const atlas = rig.session.store.readBlob(manifest.atlas.blob) as Uint8Array;
    const awedAt = oldManifest.expressions.findIndex(
      (e) => e.expression === "awed",
    );
    for (const [index, expression] of oldManifest.expressions.entries()) {
      if (index === awedAt) {
        expect(cellAt(atlas, index)).not.toEqual(cellAt(oldAtlas, index));
        continue;
      }
      expect(cellAt(atlas, index), expression.expression).toEqual(
        cellAt(oldAtlas, index),
      );
      expect(manifest.expressions[index]?.frame.durationMs).toBe(
        expression.frame.durationMs,
      );
    }
    const provenance = manifest.provenance;
    if (provenance.method !== "generated")
      throw new Error("expected generated");
    expect(provenance.generations.map((g) => g.jobId)).toEqual([job as string]);
    expect(provenance.relatedJobs.map((j) => j.jobId)).toEqual([job as string]);

    const approved = rig.session.approveAsset(
      "face-pack-2",
      { assessments: assessments(provenance.licences) },
      rig.content,
      rig.palette,
    );
    expect(approved.ok).toBe(true);
    const published = rig.session.publishAsset(
      "face-pack-2",
      rig.content,
      rig.palette,
      rig.registryRoot,
    );

    expect(published.ok).toBe(true);
    const index = JSON.parse(
      readFileSync(join(rig.registryRoot, "index.json"), "utf8"),
    );
    expect(index.entries[0].revision).toBe(
      approved.ok ? approved.asset.manifestRevision : undefined,
    );
    expect(
      existsSync(join(rig.registryRoot, "manifests", `${older}.json`)),
    ).toBe(true);
    const kept = loadRegistry(rig.registryRoot, rig.content.vocabulary);
    expect(kept.problems).toEqual([]);
    expect(kept.snapshot.entries.get("zeus-portrait")?.revision).toBe(
      index.entries[0].revision,
    );
  });
});

describe("a partial portrait set needs verified canon for the rest", () => {
  const face = { w: 96, h: 96 };
  const partialPack = (rig: AssetRig, over: Partial<PackInput> = {}) =>
    rig.session.pack(
      {
        id: "face-pack",
        workingSetId: "wp",
        assetId: "zeus-portrait",
        styleTag: "draft",
        stillFrameMs: 1000,
        carriedParams: params,
        originalWork: { licence: "MIT" },
        ...over,
      },
      rig.content,
      rig.palette,
      rig.registryRoot,
    );
  function oneExpression(rig: AssetRig, expression: string) {
    const [job] = runSlots(rig, "zeus-one", "portrait", [{ expression }], 700);
    expect(rig.session.openWorkingSet("wp", "zeus-one", rig.content)).toEqual({
      ok: true,
    });
    expect(rig.session.pick("wp", job as string)).toEqual({ ok: true });
    return job as string;
  }

  test("a first publication from a one-expression set is refused before any record, blob or ledger write, and the registry is untouched", () => {
    const rig = assetRig();
    oneExpression(rig, "awed");
    const studio = tree(rig.root);
    const registry = tree(rig.registryRoot);

    const result = partialPack(rig);

    expect(result).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(!result.ok && result.message).toMatch(
      /every expression|all six|missing/,
    );
    expect(tree(rig.root)).toEqual(studio);
    expect(tree(rig.registryRoot)).toEqual(registry);
    expect(existsSync(join(rig.root, "assets"))).toBe(false);
  });

  test("a published revision that lacks expressions cannot fill them in, and neither can an unreadable one", () => {
    const rig = assetRig();
    const sparse = portraitFixture("zeus-portrait", "zeus");
    const record = transitionAsset(
      newCandidate(sparse.manifest, {
        schemaVersion: 1,
        status: "pass",
        checks: [],
      }),
      { type: "pick" },
    );
    if (!record.ok) throw new Error(record.message);
    const approvedRecord = transitionAsset(record.value, { type: "approve" });
    if (!approvedRecord.ok) throw new Error(approvedRecord.message);
    const priorPalette = paletteFixture().palette;
    const published = publishToRegistry(
      rig.registryRoot,
      approvedRecord.value,
      sparse.blobs,
      rig.content.vocabulary,
      priorPalette,
    );
    if (!published.ok) throw new Error(published.message);
    oneExpression(rig, "grieving");
    const studio = tree(rig.root);
    const registry = tree(rig.registryRoot);

    const result = partialPack(rig);

    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.message).toMatch(/missing/);
    writeFileSync(
      join(rig.registryRoot, "manifests", `${published.value.revision}.json`),
      "{}",
    );
    expect(partialPack(rig)).toMatchObject({ ok: false });
    expect(tree(rig.root)).toEqual(studio);
    expect(tree(rig.registryRoot)).not.toEqual(registry);
  });

  test("an edit over the selected expressions of a partial set is a real edit, and its sheet carries only those slots", () => {
    const first = assetRig();
    const names = [...first.content.vocabulary.expressions];
    const jobs = runSlots(
      first,
      "zeus-faces",
      "portrait",
      names.map((expression) => ({ expression })),
    );
    first.session.openWorkingSet("wp", "zeus-faces", first.content);
    for (const id of jobs) first.session.pick("wp", id);
    const drafted = partialPack(first, { carriedParams: undefined });
    if (!drafted.ok) throw new Error(drafted.message);
    const old = first.session.approveAsset(
      "face-pack",
      {
        assessments: assessments(
          drafted.asset.record.manifest.provenance.licences,
        ),
      },
      first.content,
      first.palette,
    );
    if (!old.ok) throw new Error(old.message);
    expect(
      first.session.publishAsset(
        "face-pack",
        first.content,
        first.palette,
        first.registryRoot,
      ).ok,
    ).toBe(true);
    first.session.close();

    const rig = assetRig({ registryRoot: first.registryRoot });
    const chosen = [names[1] as string, names[3] as string];
    const picked = runSlots(
      rig,
      "zeus-two",
      "portrait",
      chosen.map((expression) => ({ expression })),
      800,
    );
    expect(rig.session.openWorkingSet("wp", "zeus-two", rig.content)).toEqual({
      ok: true,
    });
    for (const id of picked) rig.session.pick("wp", id);
    const opened = rig.session.openEdit(
      "e1",
      "wp",
      [chosen[0] as string],
      rig.content,
    );
    expect(opened).toEqual({ ok: true });
    const sheet = JSON.parse(
      new TextDecoder().decode(
        rig.session.store.readEditFile("e1", "sheet.json"),
      ),
    );
    expect(sheet.meta.frameTags.map((t: { name: string }) => t.name)).toEqual([
      chosen[0],
    ]);
    expect(sheet.frames).toHaveLength(1);
    const hand = paintFigure(rig.content, face, 41);
    const done = rig.session.finishEdit(
      "e1",
      ...(() => {
        const s = sheetOfFrames(face, [
          { slot: chosen[0] as string, frames: [hand] },
        ]);
        return [s.png, s.json, rig.content] as const;
      })(),
    );
    expect(done).toEqual({ ok: true, changed: true });

    const result = partialPack(rig, { id: "face-pack-2" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const manifest = result.asset.record.manifest;
    if (manifest.kind !== "portrait") throw new Error("expected a portrait");
    expect(manifest.expressions.map((e) => e.expression)).toEqual(names);
    expect(manifest.provenance.handEdits.map((h) => h.description)).toEqual([
      "hand edit e1",
    ]);
    const stored = rig.session.store.readBlob(
      manifest.atlas.blob,
    ) as Uint8Array;
    const image = decodePng(stored);
    if (!image.ok) throw new Error("no atlas");
    const at = names.indexOf(chosen[0] as string);
    const cell = Array.from(image.image.rgba).filter((_, i) => {
      const px = Math.floor(i / 4);
      const x = px % image.image.width;
      return x >= at * 96 && x < (at + 1) * 96;
    });
    const expected: number[] = [];
    for (let row = 0; row < 96; row += 1)
      expected.push(
        ...Array.from(hand.rgba.subarray(row * 96 * 4, (row + 1) * 96 * 4)),
      );
    expect(cell).toEqual(expected);
    expect(manifest.provenance.sourceAssets).toHaveLength(1);
  });
});

describe("carrying cells from a published atlas laid out in two rows", () => {
  const W = 64;
  const H = 80;
  const rects = [0, 1, 2, 3].map((i) => ({
    x: (i % 2) * W,
    y: Math.floor(i / 2) * H,
  }));

  /** A valid 128x160 atlas whose four idle/south cells are distinct, hidden RGB included. */
  function priorAtlas() {
    const rgba = new Uint8Array(128 * 160 * 4);
    for (const [i, rect] of rects.entries())
      for (let y = 0; y < H; y += 1)
        for (let x = 0; x < W; x += 1) {
          const visible = x >= 8 && x < 56 && y >= 8 && y < 72;
          rgba.set(
            visible
              ? [40 + i * 50, 60 + i * 10 + (x % 3), 90 + y, 255]
              : [i * 11 + 1, i * 7 + 2 + (x % 5), i * 3 + 3, 0],
            ((rect.y + y) * 128 + rect.x + x) * 4,
          );
        }
    return encodeRgbaPng(rgba, 128, 160);
  }

  function publishPrior(rig: AssetRig) {
    const atlas = priorAtlas();
    const hash = sha256Hex(atlas);
    const parsed = parseAssetManifest(
      {
        schemaVersion: 1,
        kind: "sprite",
        id: "placeholder-zeus",
        cell: { w: W, h: H },
        pixelScale: 1,
        paletteFamily: "olympus",
        paletteId: rig.palette.id,
        styleTag: "fixture",
        atlas: { blob: hash, width: 128, height: 160 },
        pivot: { x: 32, y: 80 },
        footprint: { w: 1, h: 1 },
        directions: ["south"],
        realmVariants: [],
        animations: [
          {
            state: "idle",
            direction: "south",
            frames: rects.map((r) => ({
              rect: { x: r.x, y: r.y, w: W, h: H },
              durationMs: 167,
            })),
          },
        ],
        provenance: {
          method: "hand",
          handEdits: [{ description: "drawn by hand for a test fixture" }],
          licences: [
            { subject: "test-fixture", role: "original-work", licence: "MIT" },
          ],
          relatedJobs: [],
          sourceAssets: [],
        },
      },
      rig.content.vocabulary,
    );
    if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.message}`);
    const picked = transitionAsset(
      newCandidate(parsed.value, {
        schemaVersion: 1,
        status: "pass",
        checks: [],
      }),
      { type: "pick" },
    );
    if (!picked.ok) throw new Error(picked.message);
    const approvedRecord = transitionAsset(picked.value, { type: "approve" });
    if (!approvedRecord.ok) throw new Error(approvedRecord.message);
    const published = publishToRegistry(
      rig.registryRoot,
      approvedRecord.value,
      new Map([[hash, atlas]]),
      rig.content.vocabulary,
      rig.palette,
    );
    if (!published.ok) throw new Error(published.message);
    return {
      atlas,
      manifest: parsed.value,
      revision: published.value.revision,
    };
  }

  const cellAt = (atlas: Uint8Array, x: number, y: number) => {
    const image = decodePng(atlas);
    if (!image.ok) throw new Error("no atlas");
    const out: number[] = [];
    for (let row = 0; row < H; row += 1)
      out.push(
        ...image.image.rgba.subarray(
          ((y + row) * image.image.width + x) * 4,
          ((y + row) * image.image.width + x + W) * 4,
        ),
      );
    return out;
  };

  function northOnTop(rig: AssetRig) {
    const prior = publishPrior(rig);
    const [id] = runSlots(
      rig,
      "zeus-north",
      "sprite",
      [{ state: "idle", direction: "north" }],
      500,
    );
    rig.session.openWorkingSet("w2", "zeus-north", rig.content);
    rig.session.pick("w2", id as string);
    finishSheet(rig, "e9", "w2", cell, [
      {
        slot: "idle/north",
        frames: [0, 1, 2, 3].map((i) => paintFigure(rig.content, cell, i + 3)),
      },
    ]);
    const packed = rig.session.pack(
      packInput({
        id: "zeus-pack-2",
        workingSetId: "w2",
        carriedParams: params,
      }),
      rig.content,
      rig.palette,
      rig.registryRoot,
    );
    return { prior, packed };
  }

  const approveWithException = (rig: AssetRig, id: string) =>
    rig.session.approveAsset(
      id,
      {
        exception: { reason: "carried cells are the owner's published pixels" },
        assessments: assessments(manifestOf(rig, id).provenance.licences),
      },
      rig.content,
      rig.palette,
    );

  test("all four carried cells are the prior atlas's own pixels at their rects, not copies of its top row", () => {
    const rig = assetRig();
    const { prior, packed } = northOnTop(rig);

    expect(packed.ok).toBe(true);
    if (!packed.ok) return;
    const atlas = rig.session.store.readBlob(
      packed.asset.record.manifest.atlas.blob,
    ) as Uint8Array;
    expect(cellAt(prior.atlas, 0, H)).not.toEqual(cellAt(prior.atlas, 0, 0));
    expect(cellAt(prior.atlas, W, H)).not.toEqual(cellAt(prior.atlas, W, 0));
    for (const [i, rect] of rects.entries())
      expect(cellAt(atlas, i * W, 0), `idle/south frame ${i}`).toEqual(
        cellAt(prior.atlas, rect.x, rect.y),
      );
    const manifest = packed.asset.record.manifest;
    if (manifest.kind !== "sprite") throw new Error("expected a sprite");
    expect(manifest.atlas).toMatchObject({ width: 512, height: 80 });
    expect(manifest.animations[0]?.frames.map((f) => f.rect.y)).toEqual([
      0, 0, 0, 0,
    ]);
    expect<unknown>(
      packed.asset.record.manifest.provenance.sourceAssets,
    ).toEqual([{ assetId: "placeholder-zeus", revision: prior.revision }]);
  });

  test("approval and publication accept the correctly carried cells and canon keeps their exact pixels", () => {
    const rig = assetRig();
    const { prior, packed } = northOnTop(rig);
    expect(packed.ok).toBe(true);

    const approved = approveWithException(rig, "zeus-pack-2");
    expect(approved.ok).toBe(true);
    const published = rig.session.publishAsset(
      "zeus-pack-2",
      rig.content,
      rig.palette,
      rig.registryRoot,
    );

    expect(published.ok).toBe(true);
    if (!approved.ok) return;
    const blob = approved.asset.record.manifest.atlas.blob;
    const canon = new Uint8Array(
      readFileSync(join(rig.registryRoot, "blobs", `${blob}.png`)),
    );
    for (const [i, rect] of rects.entries())
      expect(cellAt(canon, i * W, 0)).toEqual(
        cellAt(prior.atlas, rect.x, rect.y),
      );
  });

  test("a carried bottom cell replaced by the top cell of the same column is refused by the comparison alone and leaves canon as it was", () => {
    const rig = assetRig();
    const { prior, packed } = northOnTop(rig);
    expect(packed.ok).toBe(true);
    expect(approveWithException(rig, "zeus-pack-2").ok).toBe(true);
    const file = join(rig.root, "assets", "zeus-pack-2.json");
    const record = JSON.parse(readFileSync(file, "utf8"));
    const manifest = record.record.manifest;
    const atlas = decodePng(
      rig.session.store.readBlob(manifest.atlas.blob) as Uint8Array,
    );
    if (!atlas.ok) throw new Error("no atlas");
    const rgba = Uint8Array.from(atlas.image.rgba);
    const top = cellAt(prior.atlas, 0, 0);
    for (let row = 0; row < H; row += 1)
      rgba.set(
        top.slice(row * W * 4, (row + 1) * W * 4),
        (row * atlas.image.width + 2 * W) * 4,
      );
    const changed = rig.session.store.putBlob(
      encodeRgbaPng(rgba, atlas.image.width, atlas.image.height),
    );
    manifest.atlas.blob = changed;
    const revision = sha256Hex(
      new TextEncoder().encode(canonicalManifestText(manifest)),
    );
    record.manifestRevision = revision;
    record.reportBasis.atlasHash = changed;
    record.licenceReview.manifestRevision = revision;
    writeFileSync(file, JSON.stringify(record));
    const before = tree(rig.registryRoot);

    const result = publish(rig, "zeus-pack-2");

    expect(!result.ok && result.message).toMatch(
      /idle\/south frame 2 differs from the source revision's pixels/,
    );
    expect(tree(rig.registryRoot)).toEqual(before);
  });

  test("a manifest laid out in two rows is compared with its source at the rows it declares", () => {
    const rig = assetRig();
    const prior = publishPrior(rig);
    const same = carriedCellsMismatch({
      manifest: prior.manifest,
      atlas: prior.atlas,
      replaced: [],
      sources: [{ manifest: prior.manifest, atlas: prior.atlas }],
    });
    const decoded = decodePng(prior.atlas);
    if (!decoded.ok) throw new Error("no atlas");
    const rgba = Uint8Array.from(decoded.image.rgba);
    for (let row = 0; row < H; row += 1)
      rgba.set(
        rgba.slice(row * 128 * 4, (row * 128 + W) * 4),
        ((H + row) * 128 + W) * 4,
      );
    const swapped = carriedCellsMismatch({
      manifest: prior.manifest,
      atlas: encodeRgbaPng(rgba, 128, 160),
      replaced: [],
      sources: [{ manifest: prior.manifest, atlas: prior.atlas }],
    });

    expect(same).toBeUndefined();
    expect(swapped).toMatch(/idle\/south frame 3 differs/);
  });

  test("the comparison reads both atlases at their own rows", () => {
    const rig = assetRig();
    const { prior, packed } = northOnTop(rig);
    if (!packed.ok) throw new Error(packed.message);
    const manifest = packed.asset.record.manifest;
    const mine = rig.session.store.readBlob(manifest.atlas.blob) as Uint8Array;
    const source = { manifest: prior.manifest, atlas: prior.atlas };
    const check = (sources: (typeof source)[]) =>
      carriedCellsMismatch({
        manifest,
        atlas: mine,
        replaced: ["idle/north"],
        sources,
      });

    expect(check([source])).toBeUndefined();

    const decoded = decodePng(prior.atlas);
    if (!decoded.ok) throw new Error("no atlas");
    const rgba = Uint8Array.from(decoded.image.rgba);
    rgba[((H + 40) * 128 + 30) * 4] =
      (rgba[((H + 40) * 128 + 30) * 4] as number) ^ 1;
    const nudged = encodeRgbaPng(rgba, 128, 160);
    expect(check([{ manifest: prior.manifest, atlas: nudged }])).toMatch(
      /idle\/south frame 2 differs/,
    );
  });
});

describe("rejecting a packed draft", () => {
  const rejectOf = (rig: AssetRig, id = "zeus-pack", reason?: string) =>
    rig.session.rejectAsset(id, reason);
  const rejectLedger = (rig: AssetRig) =>
    ledgerOf(rig).filter((l) => l.startsWith("reject:"));

  test("an idle draft becomes a rejected record that keeps its exact manifest and revision, with one ledger entry", () => {
    const rig = assetRig();
    spriteSet(rig);
    const drafted = packOk(rig);

    const result = rejectOf(rig, "zeus-pack", "the idle loop is wrong");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const asset = result.asset;
    expect(asset.record).toEqual({
      state: "rejected",
      manifest: drafted.record.manifest,
      rejectedFrom: "draft",
      reason: "the idle loop is wrong",
    });
    expect(asset.manifestRevision).toBe(drafted.manifestRevision);
    expect(asset.reportBasis).toEqual(drafted.reportBasis);
    expect(asset.published).toBeNull();
    expect(rejectLedger(rig)).toEqual(["reject:zeus-pack"]);
    expect(rig.session.store.readAsset("zeus-pack")).toEqual({
      kind: "found",
      value: asset,
    });
    expect(readStudioStatus(rig.root).invalid).toEqual([]);
  });

  test("the reason is optional and absent from the record when not given", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);

    const result = rejectOf(rig);

    expect(result.ok).toBe(true);
    expect(result.ok && result.asset.record).not.toHaveProperty("reason");
    expect(result.ok && result.asset.record).toMatchObject({
      state: "rejected",
      rejectedFrom: "draft",
    });
  });

  test("a rejected asset cannot be approved, published or rejected again, and canon is untouched", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    expect(rejectOf(rig).ok).toBe(true);
    const before = tree(rig.root);

    expect(approve(rig)).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(publish(rig)).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(rejectOf(rig)).toMatchObject({ ok: false, reason: "wrong-state" });

    expect(tree(rig.root)).toEqual(before);
    expect(existsSync(join(rig.registryRoot, "index.json"))).toBe(false);
  });

  test("an approved or published asset cannot be rejected", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    ready(rig);
    const approvedBytes = tree(rig.root);

    expect(rejectOf(rig)).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(tree(rig.root)).toEqual(approvedBytes);

    expect(publish(rig).ok).toBe(true);
    const index = readFileSync(join(rig.registryRoot, "index.json"), "utf8");
    const published = tree(rig.root);

    expect(rejectOf(rig)).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(tree(rig.root)).toEqual(published);
    expect(readFileSync(join(rig.registryRoot, "index.json"), "utf8")).toBe(
      index,
    );
  });

  test("an unknown or malformed id is not found, an invalid record is wrong-state, and nothing is written", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    writeFileSync(join(rig.root, "assets", "broken.json"), "{");
    const before = tree(rig.root);

    expect(rejectOf(rig, "nobody")).toMatchObject({
      ok: false,
      reason: "not-found",
    });
    expect(rejectOf(rig, "Not A Slug")).toMatchObject({
      ok: false,
      reason: "not-found",
    });
    expect(rejectOf(rig, "broken")).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });

    expect(tree(rig.root)).toEqual(before);
  });

  test("a reject that cannot be written is not acknowledged and leaves the draft", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    const next = readStudioStatus(rig.root).commands.length + 1;
    mkdirSync(
      join(rig.root, "commands", `${String(next).padStart(8, "0")}.json`),
    );

    const result = rejectOf(rig);

    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    expect(readStudioStatus(rig.root).assets[0]?.record.state).toBe("draft");
    expect(rejectLedger(rig)).toEqual([]);
  });

  test("a record write that fails after the ledger entry is not acknowledged and leaves the draft", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    chmodSync(join(rig.root, "assets"), 0o500);
    let result: ReturnType<typeof rejectOf>;
    try {
      result = rejectOf(rig);
    } finally {
      chmodSync(join(rig.root, "assets"), 0o700);
    }

    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    expect(readStudioStatus(rig.root).assets[0]?.record.state).toBe("draft");
  });

  test("a closed session refuses before reading and a new owner's store is untouched", () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    const stale = rig.session;
    stale.close();
    const opened = openStudioSession(rig.root);
    if (opened.kind === "busy") throw new Error("busy");
    const before = tree(rig.root);

    expect(stale.rejectAsset("zeus-pack", "late")).toMatchObject({
      ok: false,
      reason: "closed",
    });
    expect(stale.rejectAsset("nobody")).toMatchObject({
      ok: false,
      reason: "closed",
    });

    expect(tree(rig.root)).toEqual(before);
    opened.session.close();
  });

  test("a stored candidate record is not a draft and is not rejected", () => {
    const rig = assetRig();
    spriteSet(rig);
    const drafted = packOk(rig);
    const file = join(rig.root, "assets", "zeus-pack.json");
    const record = JSON.parse(readFileSync(file, "utf8"));
    record.record = {
      state: "candidate",
      manifest: drafted.record.manifest,
      report: { schemaVersion: 1, status: "pass", checks: [] },
    };
    writeFileSync(file, JSON.stringify(record));
    const before = tree(rig.root);

    expect(rejectOf(rig)).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(tree(rig.root)).toEqual(before);
  });

  test("a draft that is being edited externally, or is still a candidate, is not an idle draft", () => {
    const rig = assetRig();
    spriteSet(rig);
    const drafted = packOk(rig);
    const file = join(rig.root, "assets", "zeus-pack.json");
    const record = JSON.parse(readFileSync(file, "utf8"));
    record.record.edit = "editing-externally";
    writeFileSync(file, JSON.stringify(record));
    const before = tree(rig.root);

    expect(rejectOf(rig)).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(tree(rig.root)).toEqual(before);
    void drafted;
  });
});

// biome-ignore lint/suspicious/noExplicitAny: the tests edit parsed JSON in place
type Json = Record<string, any>;

describe("a rejected record is strict", () => {
  const put = (root: string, record: unknown) => {
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "assets", "bad.json"), JSON.stringify(record));
  };
  const base = () => {
    const rig = assetRig();
    spriteSet(rig);
    packOk(rig);
    expect(rig.session.rejectAsset("zeus-pack", "no").ok).toBe(true);
    return {
      rig,
      record: JSON.parse(
        readFileSync(join(rig.root, "assets", "zeus-pack.json"), "utf8"),
      ),
    };
  };
  const bad: [string, (r: Json) => void][] = [
    [
      "an unknown key",
      (r) => {
        r.record.extra = 1;
      },
    ],
    [
      "no rejectedFrom",
      (r) => {
        delete r.record.rejectedFrom;
      },
    ],
    [
      "a rejectedFrom that is not candidate or draft",
      (r) => {
        r.record.rejectedFrom = "approved";
      },
    ],
    [
      "a reason that is not a string",
      (r) => {
        r.record.reason = 3;
      },
    ],
    [
      "a basis on a rejected record",
      (r) => {
        r.record.basis = { type: "report-pass" };
      },
    ],
    [
      "a report on a rejected record",
      (r) => {
        r.record.report = { schemaVersion: 1, status: "pass", checks: [] };
      },
    ],
    [
      "the manifest of another asset",
      (r) => {
        r.record.manifest.id = "someone-else";
      },
    ],
  ];
  for (const [name, change] of bad)
    test(`a rejected record with ${name} is reported invalid`, () => {
      const { rig, record } = base();
      change(record);
      put(rig.root, record);

      const status = readStudioStatus(rig.root);

      expect(status.invalid.map((p) => p.file)).toEqual(["assets/bad.json"]);
      expect(status.assets.map((a) => a.id)).toEqual(["zeus-pack"]);
    });

  test("a rejected record from a candidate reads back as written", () => {
    const { rig, record } = base();
    record.id = "from-candidate";
    record.record.rejectedFrom = "candidate";
    delete record.record.reason;
    put(rig.root, record);

    const status = readStudioStatus(rig.root);

    expect(status.invalid).toEqual([]);
    expect(status.assets.map((a) => a.id)).toEqual([
      "from-candidate",
      "zeus-pack",
    ]);
  });
});

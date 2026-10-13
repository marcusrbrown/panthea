// Palette versions through pack, approve and publish: the palette an asset names is
// looked up by id in the palettes on disk, its declared limits govern the pack's
// report, a draft palette packs but never approves or publishes, and a legacy asset
// still verifies against the committed greek-master.
//
// The fixture palettes are built here, explicitly: the fixture palette's own files
// with limits written in, and the committed greek-master and greek-retro read as
// files. Packing a render job's output is the rendered pipeline's, not this file's.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AssetManifest,
  type LicenceRecord,
  newCandidate,
  transitionAsset,
} from "@panthea/contracts";
import { paletteFixture, spriteFixture } from "../fixtures";
import {
  MASTER_PALETTE_ID,
  type Palette,
  type PaletteSet,
  paletteDigest,
  parsePalette,
} from "../palette";
import { publishAsset as publishToRegistry } from "../registry";
import {
  type AssetRig,
  assetRig,
  loadContent,
  masterOf,
  paletteSetOf,
  removeTempRoots,
  spriteSet,
} from "./_test-fixtures";
import type { PackInput } from "./packing";
import type { ApproveOptions } from "./publish";
import { slotConformance } from "./reports";

afterEach(removeTempRoots);

const REAL_PALETTES = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "content",
  "greek",
  "palette",
);
const FAMILIES = ["town", "olympus", "underworld"];
const RETRO_LIMITS = { shades: { min: 4, max: 6 }, colours: { sprite: 48 } };

// biome-ignore lint/suspicious/noExplicitAny: the tests edit parsed palette JSON by path
type Json = Record<string, any>;

/**
 * The fixture palette's files under `id`, with `limits` written into its JSON. The
 * result is a draft, or approved against its own current digest.
 */
function limitedPalette(
  limits: unknown,
  status: "draft" | "approved",
  id = MASTER_PALETTE_ID,
): Palette {
  const files = paletteFixture("draft", id).files;
  const json = JSON.parse(files["palette.json"]) as Json;
  if (limits !== undefined) json.limits = limits;
  const source = (approval: unknown) => ({
    json: { ...json, approval },
    gpl: files["master.gpl"],
    hex: files["master.hex"],
  });
  const draft = parsePalette(source({ status: "draft" }), FAMILIES);
  if (!draft.ok) throw new Error(`${draft.path}: ${draft.message}`);
  if (status === "draft") return draft.value;
  const approved = parsePalette(
    source({ status: "approved", digest: paletteDigest(draft.value) }),
    FAMILIES,
  );
  if (!approved.ok) throw new Error(`${approved.path}: ${approved.message}`);
  return approved.value;
}

/** A rig whose content and on-disk palettes are the given palette standing in for greek-master. */
function rigWith(palette: Palette): AssetRig {
  const rig = assetRig();
  const palettes = paletteSetOf(palette);
  return {
    ...rig,
    content: { ...rig.content, palettes },
    palette,
    palettes,
  };
}

const packInput = (over: Partial<PackInput> = {}): PackInput => ({
  id: "zeus-pack",
  workingSetId: "w",
  assetId: "placeholder-zeus",
  styleTag: "draft",
  footprint: { w: 1, h: 1 },
  originalWork: { licence: "MIT", attribution: "the owner" },
  ...over,
});

const pack = (
  rig: AssetRig,
  palettes: PaletteSet = rig.palettes,
  over: Partial<PackInput> = {},
) => rig.session.pack(packInput(over), rig.content, palettes, rig.registryRoot);

function packed(rig: AssetRig, over: Partial<PackInput> = {}) {
  const result = pack(rig, rig.palettes, over);
  if (!result.ok) throw new Error(result.message);
  return result.asset;
}

const licencesOf = (rig: AssetRig, id = "zeus-pack") => {
  const found = rig.session.store.readAsset(id);
  if (found.kind !== "found") throw new Error(`no asset ${id}`);
  return found.value.record.manifest.provenance.licences;
};

/** The owner's reading of every licence the studio cannot decide, once each. */
function assessments(licences: readonly LicenceRecord[]) {
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

const approve = (
  rig: AssetRig,
  palettes: PaletteSet = rig.palettes,
  extra: Partial<ApproveOptions> = {},
) =>
  rig.session.approveAsset(
    "zeus-pack",
    { assessments: assessments(licencesOf(rig)), ...extra },
    rig.content,
    palettes,
  );

const publish = (rig: AssetRig, palettes: PaletteSet = rig.palettes) =>
  rig.session.publishAsset(
    "zeus-pack",
    rig.content,
    palettes,
    rig.registryRoot,
  );

const reportOf = (rig: AssetRig, id = "zeus-pack") => {
  const found = rig.session.store.readAsset(id);
  if (found.kind !== "found" || found.value.record.state !== "draft")
    throw new Error(`no draft ${id}`);
  const report = found.value.record.report;
  if (report === undefined) throw new Error("no report");
  return report;
};

describe("a palette's declared limits reach the pack report", () => {
  test("a palette that declares a sprite limit of 3 fails the 4-colour figure, and with no declared limit the same figure passes", () => {
    const limited = rigWith(
      limitedPalette(
        { shades: { min: 4, max: 6 }, colours: { sprite: 3 } },
        "approved",
      ),
    );
    spriteSet(limited);
    packed(limited);
    const counts = reportOf(limited).checks.filter((c) =>
      c.check.endsWith(":colour-count"),
    );
    expect(counts.length).toBeGreaterThan(0);
    for (const count of counts) {
      expect(count.status).toBe("fail");
      expect(count.message).toContain("limit 3");
    }
    expect(reportOf(limited).status).toBe("fail");

    // Positive control: the legacy rule, 16 colours, passes the same figure.
    const legacy = rigWith(limitedPalette(undefined, "approved"));
    spriteSet(legacy);
    packed(legacy);
    const legacyCounts = reportOf(legacy).checks.filter((c) =>
      c.check.endsWith(":colour-count"),
    );
    expect(legacyCounts.length).toBeGreaterThan(0);
    for (const count of legacyCounts) {
      expect(count.status).toBe("pass");
      expect(count.message).toContain("limit 16");
    }
    expect(reportOf(legacy).status).toBe("pass");
  });

  test("a palette declaring the retro limits gives the pack a 48-colour budget", () => {
    const retroLike = rigWith(limitedPalette(RETRO_LIMITS, "approved"));
    spriteSet(retroLike);
    packed(retroLike);
    const counts = reportOf(retroLike).checks.filter((c) =>
      c.check.endsWith(":colour-count"),
    );
    expect(counts.every((c) => c.message?.includes("limit 48"))).toBe(true);
  });
});

describe("the other reports read the palette's limit too", () => {
  const LIMIT_3 = { shades: { min: 4, max: 6 }, colours: { sprite: 3 } };

  test("a candidate's conformance report holds the colour limit of the palette its request names", () => {
    const limited = rigWith(limitedPalette(LIMIT_3, "approved"));
    spriteSet(limited);
    const message = (rig: AssetRig) =>
      rig.session.store
        .status()
        .candidates.flatMap((c) =>
          c.result.status === "done"
            ? c.result.report.checks.filter((k) => k.check === "colour-count")
            : [],
        )
        .map((k) => k.message);
    expect(message(limited).length).toBeGreaterThan(0);
    for (const text of message(limited)) expect(text).toContain("limit 3");

    // Positive control: the legacy palette's candidates are held to 16.
    const legacy = rigWith(limitedPalette(undefined, "approved"));
    spriteSet(legacy);
    for (const text of message(legacy)) expect(text).toContain("limit 16");
  });

  test("a stored slot is reported fresh against the limit of the palette now: 4 colours fail 3 and pass the legacy 16", () => {
    const limited = rigWith(limitedPalette(LIMIT_3, "approved"));
    spriteSet(limited);
    const against = (rig: AssetRig) => {
      const result = slotConformance(rig.root, "w", "idle/south", rig.content);
      if (!result.ok) throw new Error(result.message);
      return result.frames.map((f) =>
        f.report.checks.find((c) => c.check === "colour-count"),
      );
    };
    for (const check of against(limited)) {
      expect(check).toMatchObject({ status: "fail" });
      expect(check?.message).toContain("limit 3");
    }
    // The same stored frames, judged under a palette with no declared limit.
    const swapped: AssetRig = {
      ...limited,
      content: {
        ...limited.content,
        palettes: paletteSetOf(limitedPalette(undefined, "approved")),
      },
    };
    for (const check of against(swapped))
      expect(check).toMatchObject({ status: "pass" });
  });
});

describe("a draft palette", () => {
  test("packs, and the report flags the draft palette, which an approved palette's report does not", () => {
    const draft = rigWith(limitedPalette(RETRO_LIMITS, "draft"));
    spriteSet(draft);
    const asset = packed(draft);
    expect(asset.record.state).toBe("draft");
    const flag = reportOf(draft).checks.find(
      (c) => c.check === "palette-approval",
    );
    expect(flag).toMatchObject({ status: "fail" });
    expect(flag?.message).toContain(MASTER_PALETTE_ID);
    expect(flag?.message).toContain("draft");
    expect(reportOf(draft).status).toBe("fail");

    const approved = rigWith(limitedPalette(RETRO_LIMITS, "approved"));
    spriteSet(approved);
    packed(approved);
    expect(
      reportOf(approved).checks.some((c) => c.check === "palette-approval"),
    ).toBe(false);
    expect(reportOf(approved).status).toBe("pass");
  });

  test("is refused at approve, and the same asset approves once the palette is approved (positive control)", () => {
    const rig = rigWith(limitedPalette(RETRO_LIMITS, "draft"));
    spriteSet(rig);
    packed(rig);
    const refused = approve(rig);
    expect(refused).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(!refused.ok && refused.message).toMatch(/draft/);

    // The palette is approved on disk later. The draft's report flagged it, so the
    // record needs a fresh pack against the approved palette, not an exception.
    const onDisk = paletteSetOf(limitedPalette(RETRO_LIMITS, "approved"));
    const stale = approve(rig, onDisk);
    expect(stale).toMatchObject({ ok: false });
    expect(!stale.ok && stale.message).toMatch(/conformance failed/);

    const fresh = rigWith(limitedPalette(RETRO_LIMITS, "approved"));
    spriteSet(fresh);
    packed(fresh);
    expect(approve(fresh).ok).toBe(true);
  });

  test("is refused at publish when the palette lost its approval after the asset was approved, and publishes while it holds", () => {
    const rig = rigWith(limitedPalette(RETRO_LIMITS, "approved"));
    spriteSet(rig);
    packed(rig);
    expect(approve(rig).ok).toBe(true);

    const draftAgain = paletteSetOf(limitedPalette(RETRO_LIMITS, "draft"));
    const refused = publish(rig, draftAgain);
    expect(refused).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(!refused.ok && refused.message).toMatch(/draft/);
    expect(publish(rig).ok).toBe(true);
  });
});

describe("a limit edited after approval", () => {
  test("changes the digest, so publish refuses the asset approved under the old limits", () => {
    const original = limitedPalette(RETRO_LIMITS, "approved");
    const rig = rigWith(original);
    spriteSet(rig);
    packed(rig);
    expect(approve(rig).ok).toBe(true);

    const edited: Palette = {
      ...original,
      limits: { ...RETRO_LIMITS, colours: { sprite: 64 } },
    };
    expect(paletteDigest(edited)).not.toBe(paletteDigest(original));
    const refused = publish(rig, paletteSetOf(edited));
    expect(refused).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(!refused.ok && refused.message).toMatch(/palette changed/);

    // Re-approving the edited palette does not rescue it either: the report was measured under the old digest.
    const reapproved: Palette = {
      ...edited,
      approval: { status: "approved", digest: paletteDigest(edited) },
    };
    expect(publish(rig, paletteSetOf(reapproved))).toMatchObject({ ok: false });
    expect(publish(rig).ok).toBe(true);
  });

  test("an approved palette whose limits were edited without a new digest is refused by the palette check", () => {
    const original = limitedPalette(RETRO_LIMITS, "approved");
    const rig = rigWith(original);
    spriteSet(rig);
    // Packed under the edited limits and the stale approval: the digest check is the palette's own.
    const stale: Palette = {
      ...original,
      limits: { ...RETRO_LIMITS, colours: { sprite: 40 } },
    };
    const set = paletteSetOf(stale);
    const result = pack(rig, set);
    expect(result.ok).toBe(true);
    const refused = approve(rig, set);
    expect(refused).toMatchObject({ ok: false });
    expect(!refused.ok && refused.message).toMatch(
      /changed after its approval/,
    );
  });
});

describe("the palette an asset names", () => {
  test("is looked up by id: a set without it refuses approve and publish, and unrelated palettes in the set are ignored", () => {
    const rig = rigWith(limitedPalette(RETRO_LIMITS, "approved"));
    spriteSet(rig);
    packed(rig);
    const elsewhere = paletteSetOf(
      limitedPalette(RETRO_LIMITS, "approved", "greek-elsewhere"),
    );
    const missing = approve(rig, elsewhere);
    expect(missing).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(!missing.ok && missing.message).toMatch(/not among the palettes/);

    // Positive control: the same set plus the asset's palette approves; the other palette is no business of the asset's.
    const both: PaletteSet = new Map([...elsewhere, ...rig.palettes]);
    expect(approve(rig, both).ok).toBe(true);
    expect(publish(rig, elsewhere)).toMatchObject({ ok: false });
    expect(publish(rig, both).ok).toBe(true);
  });

  test("is the palette pack reads from the palettes it is given, not the content as loaded", () => {
    const rig = rigWith(limitedPalette(RETRO_LIMITS, "approved"));
    spriteSet(rig);
    // The content as loaded holds the approved palette; on disk it is a draft now.
    const result = pack(
      rig,
      paletteSetOf(limitedPalette(RETRO_LIMITS, "draft")),
    );
    expect(result.ok).toBe(true);
    expect(
      reportOf(rig).checks.some((c) => c.check === "palette-approval"),
    ).toBe(true);
  });
});

describe("a pack across revisions", () => {
  /** Publishes a prior revision of `placeholder-zeus` under `palette` straight into the registry. */
  function publishPrior(rig: AssetRig, palette: Palette) {
    const fixture = spriteFixture("placeholder-zeus");
    const manifest: AssetManifest = {
      ...fixture.manifest,
      paletteId: palette.id,
    };
    const record = transitionAsset(
      newCandidate(manifest, { schemaVersion: 1, status: "pass", checks: [] }),
      { type: "pick" },
    );
    if (!record.ok) throw new Error(record.message);
    const approved = transitionAsset(record.value, { type: "approve" });
    if (!approved.ok) throw new Error(approved.message);
    const published = publishToRegistry(
      rig.registryRoot,
      approved.value,
      fixture.blobs,
      rig.content.vocabulary,
      palette,
    );
    if (!published.ok) throw new Error(published.message);
  }

  test("is refused when the prior revision is in another palette, and packs when it is in the same one", () => {
    const rig = rigWith(limitedPalette(RETRO_LIMITS, "approved"));
    spriteSet(rig);
    publishPrior(rig, limitedPalette(RETRO_LIMITS, "approved", "greek-retro"));
    const refused = pack(rig);
    expect(refused).toMatchObject({ ok: false, reason: "wrong-state" });
    expect(!refused.ok && refused.message).toMatch(
      /palette "greek-retro", not "greek-master"/,
    );

    // Positive control: a prior revision in the packing palette is no obstacle on this check.
    const same = rigWith(limitedPalette(RETRO_LIMITS, "approved"));
    spriteSet(same);
    publishPrior(same, same.palette);
    const result = pack(same);
    if (!result.ok) expect(result.message).not.toMatch(/palette "/);
  });
});

describe("a legacy asset", () => {
  /** The real committed content and palettes, with the spriteSet path running against greek-master itself. */
  function realRig(): AssetRig {
    const rig = assetRig();
    const content = loadContent();
    return {
      ...rig,
      content,
      palette: masterOf(content),
      palettes: content.palettes,
    };
  }

  test("still verifies against the committed greek-master: its digest, its approval and the manifest's palette id", () => {
    const rig = realRig();
    const master = masterOf(rig.content);
    const committed = JSON.parse(
      readFileSync(join(REAL_PALETTES, "palette.json"), "utf8"),
    ) as Json;
    expect(master.id).toBe("greek-master");
    expect(master.limits).toBeUndefined();
    expect(String(paletteDigest(master))).toBe(
      "faa637b2ce7bd3493f20a7a1b191554640b9a801a6e8fc42f8a985bb07073209",
    );
    expect(committed.approval.digest).toBe(String(paletteDigest(master)));

    spriteSet(rig);
    const asset = packed(rig);
    // The report is the legacy one: no palette-approval check, the 16-colour limit.
    expect(
      reportOf(rig).checks.some((c) => c.check === "palette-approval"),
    ).toBe(false);
    expect(reportOf(rig).status).toBe("pass");
    expect(
      reportOf(rig).checks.find((c) => c.check.endsWith(":colour-count"))
        ?.message,
    ).toContain("limit 16");
    expect(String(asset.reportBasis.paletteDigest)).toBe(
      "faa637b2ce7bd3493f20a7a1b191554640b9a801a6e8fc42f8a985bb07073209",
    );
    expect(asset.record.manifest.paletteId).toBe("greek-master");

    expect(approve(rig).ok).toBe(true);
    const published = publish(rig);
    expect(published.ok).toBe(true);
    // greek-retro rides along in the set and plays no part in a greek-master asset.
    expect([...rig.palettes.keys()]).toEqual(["greek-master", "greek-retro"]);
  });

  test("is refused against a greek-master whose colours changed, the committed digest no longer matching", () => {
    const rig = realRig();
    spriteSet(rig);
    packed(rig);
    expect(approve(rig).ok).toBe(true);
    const master = masterOf(rig.content);
    const tampered: Palette = {
      ...master,
      colours: master.colours.slice(1),
    };
    const refused = publish(
      rig,
      new Map([...rig.palettes, [MASTER_PALETTE_ID, tampered]]),
    );
    expect(refused).toMatchObject({ ok: false });
  });
});

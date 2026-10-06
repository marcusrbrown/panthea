// Pack, approve and publish as session operations. Packing makes a draft;
// approval is a separate, explicit act bound to the exact manifest and atlas;
// publishing runs every gate again before it touches canon, and canon is only
// ever written through the registry's own publishAsset with the approved
// record unchanged. Nothing here authenticates who calls it: an SDK call is an
// operator action, not an identity.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AssetManifest,
  type AssetRecord,
  type AssetVocabulary,
  canonicalJson,
  canonicalManifestText,
  checkProvenanceAgainstJobs,
  newCandidate,
  parseAssetId,
  parseAssetManifest,
  parseRegistryIndex,
  parseSlug,
  type Sha256,
  transitionAsset,
} from "@panthea/contracts";
import { sha256Hex } from "../hash";
import { type Palette, paletteDigest } from "../palette";
import {
  paletteRefusal,
  publishAsset as publishToRegistry,
  readRevision,
} from "../registry";
import { checkAssessments, licenceBlock, reviewLicences } from "./approval";
import type { EditFailure, EditHost } from "./edit-session";
import {
  logicalCells,
  type PackInput,
  type PriorRevision,
  packAsset,
} from "./packing";
import { decodePng } from "./png/decode";
import type { StudioContent } from "./request";
import type { LicenceAssessment, StudioAssetRecord } from "./workspace";

export type AssetFailure = EditFailure;

export type AssetOpResult =
  | { readonly ok: true; readonly asset: StudioAssetRecord }
  | {
      readonly ok: false;
      readonly reason: AssetFailure;
      readonly message: string;
    };

export interface ApproveOptions {
  /** Owner approval of a failing report; never clears licence terms. */
  readonly exception?: { readonly reason: string };
  readonly assessments?: readonly LicenceAssessment[];
}

export interface AssetOps {
  pack(
    input: PackInput,
    content: StudioContent,
    palette: Palette,
    registryRoot: string,
  ): AssetOpResult;
  approveAsset(
    id: string,
    options: ApproveOptions,
    content: StudioContent,
    palette: Palette,
  ): AssetOpResult;
  publishAsset(
    id: string,
    content: StudioContent,
    palette: Palette,
    registryRoot: string,
  ): AssetOpResult;
}

const refused = (reason: AssetFailure, message: string) =>
  ({ ok: false, reason, message }) as const;
const CLOSED = "the session is closed; open a new one";

const revisionOf = (manifest: AssetManifest): Sha256 =>
  sha256Hex(new TextEncoder().encode(canonicalManifestText(manifest)));

type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

/** The revision the registry's index selects for an asset, or null when it selects none. */
export function currentRevision(
  root: string,
  assetId: string,
): Result<Sha256 | null> {
  const file = join(root, "index.json");
  if (!existsSync(file)) return { ok: true, value: null };
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { ok: false, message: "the registry index is not valid JSON" };
  }
  const parsed = parseRegistryIndex(json);
  if (!parsed.ok)
    return {
      ok: false,
      message: `the registry index is invalid: ${parsed.message}`,
    };
  return {
    ok: true,
    value:
      parsed.value.entries.find((e) => e.assetId === assetId)?.revision ?? null,
  };
}

/** The cells a manifest carries over from its source revisions must be the very pixels and timings published there. */
export function carriedCellsMismatch(args: {
  readonly manifest: AssetManifest;
  readonly atlas: Uint8Array;
  readonly replaced: readonly string[];
  readonly sources: readonly { manifest: AssetManifest; atlas: Uint8Array }[];
}): string | undefined {
  const { manifest, atlas, replaced, sources } = args;
  const mine = decodePng(atlas);
  if (!mine.ok) return "the atlas cannot be decoded";
  const carried = logicalCells(manifest).filter(
    (c) => !replaced.includes(c.key),
  );
  if (carried.length === 0) return undefined;
  const source = sources.find((s) => s.manifest.id === manifest.id);
  if (source === undefined)
    return `${carried[0]?.key} is not in this working set and no source revision of ${manifest.id} is named`;
  const theirs = decodePng(source.atlas);
  if (!theirs.ok) return "the source atlas cannot be decoded";
  const { w, h } = manifest.cell;
  const cellBytes = (
    image: { rgba: Uint8Array; width: number },
    x: number,
    y: number,
  ) => {
    const out = new Uint8Array(w * h * 4);
    for (let row = 0; row < h; row += 1)
      out.set(
        image.rgba.subarray(
          ((y + row) * image.width + x) * 4,
          ((y + row) * image.width + x + w) * 4,
        ),
        row * w * 4,
      );
    return out;
  };
  const was = logicalCells(source.manifest);
  for (const cell of carried) {
    const before = was.find((c) => c.key === cell.key);
    if (before === undefined || before.frames.length !== cell.frames.length)
      return `${cell.key} is not the cell the source revision published`;
    for (const [index, frame] of cell.frames.entries()) {
      const old = before.frames[index];
      if (old === undefined || old.durationMs !== frame.durationMs)
        return `${cell.key} frame ${index} has a different duration than the source revision`;
      const a = cellBytes(mine.image, frame.rect.x, frame.rect.y);
      const b = cellBytes(theirs.image, old.rect.x, old.rect.y);
      if (a.length !== b.length || a.some((v, i) => v !== b[i]))
        return `${cell.key} frame ${index} differs from the source revision's pixels`;
    }
  }
  return undefined;
}

export function createAssetOps(host: EditHost): AssetOps {
  const { store } = host;

  const load = (id: string) => {
    if (!parseSlug(id, "id").ok)
      return refused("not-found", `no asset record ${id}`);
    const found = store.readAsset(id);
    if (found.kind === "missing")
      return refused("not-found", `no asset record ${id}`);
    if (found.kind === "invalid")
      return refused(
        "wrong-state",
        `asset record ${id} is invalid: ${found.message}`,
      );
    return found.value;
  };

  /** What approval and publication both stand on: the manifest as parsed, its atlas, the palette basis and the job ledger. */
  function revalidate(
    asset: StudioAssetRecord,
    content: StudioContent,
    palette: Palette,
  ): Result<{ manifest: AssetManifest; atlas: Uint8Array }> {
    const parsed = parseAssetManifest(
      asset.record.manifest,
      content.vocabulary,
    );
    if (!parsed.ok)
      return {
        ok: false,
        message: `the manifest is not valid: ${parsed.path}: ${parsed.message}`,
      };
    const manifest = parsed.value;
    if (revisionOf(manifest) !== asset.manifestRevision)
      return {
        ok: false,
        message: "the record's manifest revision does not match its manifest",
      };
    if (asset.reportBasis.atlasHash !== manifest.atlas.blob)
      return {
        ok: false,
        message:
          "the report was measured against another atlas than the manifest's",
      };
    const atlas = store.readBlob(manifest.atlas.blob);
    if (atlas === undefined || sha256Hex(atlas) !== manifest.atlas.blob)
      return {
        ok: false,
        message: "the studio's atlas is missing or does not match its hash",
      };
    if (paletteDigest(palette) !== asset.reportBasis.paletteDigest)
      return {
        ok: false,
        message: "the palette changed since the report was measured",
      };
    const refusal = paletteRefusal(manifest, palette);
    if (refusal !== undefined) return { ok: false, message: refusal };
    const audit = checkProvenanceAgainstJobs(
      manifest.provenance,
      store.status().jobs.map((record) => record.job),
    );
    if (!audit.ok)
      return {
        ok: false,
        message: `the job ledger disagrees with the provenance: ${audit.message}`,
      };
    return { ok: true, value: { manifest, atlas } };
  }

  function pack(
    input: PackInput,
    content: StudioContent,
    palette: Palette,
    registryRoot: string,
  ): AssetOpResult {
    if (host.isClosed()) return refused("closed", CLOSED);
    if (!parseSlug(input.id, "id").ok)
      return refused(
        "invalid-params",
        "a packed record id is a lowercase hyphenated name",
      );
    const assetId = parseAssetId(input.assetId, "assetId");
    if (!assetId.ok)
      return refused("invalid-params", `${assetId.path}: ${assetId.message}`);
    if (store.readAsset(input.id).kind !== "missing")
      return refused("wrong-state", `asset record ${input.id} already exists`);
    const set = store.readWorkingSet(input.workingSetId);
    if (set.kind === "missing")
      return refused("not-found", `no working set ${input.workingSetId}`);
    if (set.kind === "invalid")
      return refused(
        "wrong-state",
        `working set ${input.workingSetId} is invalid: ${set.message}`,
      );

    const current = currentRevision(registryRoot, input.assetId);
    if (!current.ok) return refused("wrong-state", current.message);
    let prior: PriorRevision | undefined;
    if (current.value !== null) {
      const read = readRevision(
        registryRoot,
        assetId.value,
        current.value,
        content.vocabulary,
      );
      if (!read.ok)
        return refused(
          "wrong-state",
          `the published revision cannot be read: ${read.message}`,
        );
      prior = {
        revision: current.value,
        manifest: read.value.manifest,
        atlas: read.value.atlas,
      };
    }

    const status = store.status();
    const packed = packAsset(input, {
      set: set.value,
      edits: new Map(status.edits.map((e) => [e.id, e])),
      jobs: new Map(status.jobs.map((j) => [j.job.id, j])),
      requests: new Map(status.requests.map((r) => [r.id, r])),
      commands: status.commands,
      readBlob: (hash) => store.readBlob(hash),
      content,
      palette,
      ...(prior === undefined ? {} : { prior }),
    });
    if (!packed.ok) return refused("wrong-state", packed.message);
    const { manifest, atlas, report } = packed.value;
    const picked = transitionAsset(newCandidate(manifest, report), {
      type: "pick",
    });
    if (!picked.ok) return refused("wrong-state", picked.message);
    const revision = revisionOf(manifest);
    const asset: StudioAssetRecord = {
      schemaVersion: 1,
      id: input.id,
      workingSetId: input.workingSetId,
      assetId: assetId.value,
      prior: prior?.revision ?? null,
      record: picked.value,
      manifestRevision: revision,
      reportBasis: {
        atlasHash: manifest.atlas.blob,
        paletteDigest: paletteDigest(palette),
      },
      licenceReview: reviewLicences(manifest.provenance.licences, [], revision),
      licenceAssessments: [],
      published: null,
    };
    const stored = host.write(() => {
      store.putBlob(atlas);
    });
    if (!stored.ok) return stored;
    const written = host.ledgered("pack", input.id, () =>
      store.putAsset(asset),
    );
    return written.ok ? { ok: true, asset } : written;
  }

  function approveAsset(
    id: string,
    options: ApproveOptions,
    content: StudioContent,
    palette: Palette,
  ): AssetOpResult {
    if (host.isClosed()) return refused("closed", CLOSED);
    const asset = load(id);
    if ("ok" in asset) return asset;
    if (asset.record.state !== "draft" || asset.record.edit !== "idle")
      return refused(
        "wrong-state",
        `asset ${id} is ${asset.record.state}, not a draft`,
      );
    const checked = revalidate(asset, content, palette);
    if (!checked.ok) return refused("wrong-state", checked.message);
    const { manifest } = checked.value;
    const assessments = options.assessments ?? [];
    const valid = checkAssessments(manifest.provenance.licences, assessments);
    if (!valid.ok) return refused("invalid-params", valid.message);
    const block = licenceBlock(
      reviewLicences(
        manifest.provenance.licences,
        assessments,
        asset.manifestRevision,
      ).entries,
    );
    if (block !== undefined)
      return refused(
        "wrong-state",
        `the licence terms block approval: ${block}`,
      );

    const moved = transitionAsset(
      { ...asset.record, manifest },
      {
        type: "approve",
        ...(options.exception === undefined
          ? {}
          : { exception: { reason: options.exception.reason } }),
      },
    );
    if (!moved.ok) return refused("wrong-state", moved.message);
    const revision = revisionOf(moved.value.manifest);
    const approved: StudioAssetRecord = {
      ...asset,
      record: moved.value,
      manifestRevision: revision,
      licenceReview: reviewLicences(
        moved.value.manifest.provenance.licences,
        assessments,
        revision,
      ),
      licenceAssessments: [...assessments],
    };
    const written = host.ledgered("approve", id, () =>
      store.putAsset(approved),
    );
    return written.ok ? { ok: true, asset: approved } : written;
  }

  function publishAsset(
    id: string,
    content: StudioContent,
    palette: Palette,
    registryRoot: string,
  ): AssetOpResult {
    if (host.isClosed()) return refused("closed", CLOSED);
    const asset = load(id);
    if ("ok" in asset) return asset;
    if (asset.record.state !== "approved")
      return refused(
        "wrong-state",
        `asset ${id} is ${asset.record.state}; only an approved asset publishes`,
      );
    const checked = revalidate(asset, content, palette);
    if (!checked.ok) return refused("wrong-state", checked.message);
    const { manifest, atlas } = checked.value;

    const valid = checkAssessments(
      manifest.provenance.licences,
      asset.licenceAssessments,
    );
    if (!valid.ok) return refused("wrong-state", valid.message);
    const review = reviewLicences(
      manifest.provenance.licences,
      asset.licenceAssessments,
      asset.manifestRevision,
    );
    if (canonicalJson(review) !== canonicalJson(asset.licenceReview))
      return refused(
        "wrong-state",
        "the recorded licence review is not the review of this manifest",
      );
    const block = licenceBlock(review.entries);
    if (block !== undefined)
      return refused(
        "wrong-state",
        `the licence terms block publication: ${block}`,
      );

    const sources: { manifest: AssetManifest; atlas: Uint8Array }[] = [];
    for (const ref of manifest.provenance.sourceAssets) {
      const read = readRevision(
        registryRoot,
        ref.assetId,
        ref.revision,
        content.vocabulary as AssetVocabulary,
      );
      if (!read.ok)
        return refused(
          "wrong-state",
          `source revision ${ref.assetId} ${ref.revision} cannot be read: ${read.message}`,
        );
      sources.push(read.value);
    }
    const set = store.readWorkingSet(asset.workingSetId);
    if (set.kind !== "found")
      return refused(
        "wrong-state",
        `working set ${asset.workingSetId} is not readable`,
      );
    const mismatch = carriedCellsMismatch({
      manifest,
      atlas,
      replaced: set.value.required,
      sources,
    });
    if (mismatch !== undefined) return refused("wrong-state", mismatch);

    const current = currentRevision(registryRoot, asset.assetId);
    if (!current.ok) return refused("wrong-state", current.message);
    if (
      current.value !== asset.prior &&
      current.value !== asset.manifestRevision
    )
      return refused(
        "wrong-state",
        "the registry changed since this asset was packed; pack it again against the current revision",
      );

    let canon: AssetRecord;
    if (current.value === asset.manifestRevision) {
      const present = readRevision(
        registryRoot,
        asset.assetId,
        asset.manifestRevision,
        content.vocabulary,
      );
      if (!present.ok)
        return refused(
          "wrong-state",
          `the published revision cannot be read: ${present.message}`,
        );
      const made = transitionAsset(asset.record, { type: "canonize" });
      if (!made.ok) return refused("wrong-state", made.message);
      canon = made.value;
    } else {
      let published: ReturnType<typeof publishToRegistry>;
      try {
        published = publishToRegistry(
          registryRoot,
          asset.record,
          new Map([[manifest.atlas.blob, atlas]]),
          content.vocabulary,
          palette,
        );
      } catch (error) {
        return refused("write-failed", (error as Error).message);
      }
      if (!published.ok) return refused("wrong-state", published.message);
      if (published.value.revision !== asset.manifestRevision)
        return refused(
          "wrong-state",
          "the registry stored a different revision than the approved manifest's",
        );
      canon = published.value.record;
    }
    const done: StudioAssetRecord = {
      ...asset,
      record: canon,
      published: { revision: asset.manifestRevision },
    };
    const effect = () => store.putAsset(done);
    const written = host.hasLedgered("publish", id)
      ? host.write(effect)
      : host.ledgered("publish", id, effect);
    return written.ok ? { ok: true, asset: done } : written;
  }

  return { pack, approveAsset, publishAsset };
}

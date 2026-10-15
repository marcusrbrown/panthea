// Packs a complete tile working set: the two rendered patches (`base`, `over`) are read back from
// the studio's store, stamped to the 16-column atlas, and every atlas cell is measured against tile
// conformance. Nothing is drawn by hand and no cell is carried: a tile set is the stamp of its two
// renders under the profile's parameters, and the publish-time audit stamps it again.

import {
  type AssetManifest,
  type ConformanceReport,
  type JobRef,
  type LicenceRecord,
  parseAssetManifest,
  type RenderedSlot,
  type Sha256,
  TILE_CELL,
  TILE_ROLES,
  type TileRole,
} from "@panthea/contracts";
import type { RgbaImage } from "../conformance";
import { sha256Hex } from "../hash";
import { encodeRgbaPng } from "../placeholder";
import { patchSize } from "../render/ground";
import {
  parseRenderJobManifest,
  type RenderJobManifest,
} from "../render/job-manifest";
import { loadRenderInputs } from "../render/load";
import { postPaletteFrom } from "../render/post-palette";
import { profileHash } from "../render/profile";
import { renderedRevisionOf, revisionHashOf } from "../render/recipe";
import { stampTileSet, tileCellChecks } from "../tiles/build";
import { paletteColours } from "./candidates";
import { DEFAULT_CONFORM } from "./derivation";
import type { PackInput, Packing, PackSources } from "./packing";
import { decodePng } from "./png/decode";
import type { GenerationSpec } from "./request";
import type { JobRecord, RequestRecord } from "./store";

/** The licence of work made in this repository, as its LICENSE states it. */
const REPOSITORY_WORK_LICENCE = {
  licence: "MIT",
  attribution: "Marcus R. Brown",
} as const;

const refuse = (message: string): Packing => ({ ok: false, message });

export function packTile(
  input: PackInput,
  sources: PackSources,
  spec: GenerationSpec,
  request: RequestRecord,
): Packing {
  const { set, content } = sources;
  const palette = content.palettes.get(spec.palette.id);
  if (palette === undefined)
    return refuse(`the palette ${spec.palette.id} is not loaded`);
  if (sources.renderRoot === undefined)
    return refuse(
      "a tile set is stamped from the committed ground profile: the render root must be given",
    );
  if (sources.prior !== undefined && sources.prior.manifest.kind !== "tile")
    return refuse(
      `the published ${input.assetId} is a ${sources.prior.manifest.kind}, not a tile`,
    );
  const stray = Object.keys({
    ...set.picks,
    ...set.frames,
    ...set.derived,
    ...set.variants,
  });
  if (stray.length > 0)
    return refuse(
      `a tile set is two rendered patches: ${stray.join(", ")} cannot be part of it`,
    );
  const missing = TILE_ROLES.filter(
    (role) => set.rendered?.[role] === undefined,
  );
  if (missing.length > 0)
    return refuse(
      `the tile set has no rendered patch for ${missing.join(", ")}`,
    );

  // --- the committed profile the stamp reads ---
  const inputs = loadRenderInputs(sources.renderRoot);
  const profileId = request.request.recipe?.profile ?? "";
  const profile = inputs.profiles.find((p) => p.id === profileId);
  if (profile === undefined)
    return refuse(
      `the render profile "${profileId}" is not among the committed profiles`,
    );
  const postPalette = postPaletteFrom(content.palettes, palette.id);
  if (!postPalette.ok) return refuse(postPalette.message);

  // --- the lineage of each patch: a succeeded render job under one revision recipe ---
  const lineage = {} as Record<
    TileRole,
    { record: JobRecord; manifest: RenderJobManifest }
  >;
  const patches = {} as Record<TileRole, RgbaImage>;
  for (const role of TILE_ROLES) {
    const entry = set.rendered?.[role];
    if (entry === undefined) continue;
    const record = sources.jobs.get(entry.jobId);
    if (
      record === undefined ||
      record.job.status !== "succeeded" ||
      record.engine === undefined ||
      record.engine.model !== null
    )
      return refuse(
        `slot ${role}: its render job ${entry.jobId} is not a recorded succeeded render job`,
      );
    if (record.source.slotKey !== role)
      return refuse(
        `slot ${role}: its render job ${entry.jobId} rendered ${record.source.slotKey}`,
      );
    const bytes = sources.readBlob(entry.manifest);
    if (bytes === undefined || sha256Hex(bytes) !== entry.manifest)
      return refuse(
        `slot ${role}: the role manifest ${entry.manifest} of job ${entry.jobId} is missing or altered`,
      );
    if (record.engine.settings.manifest !== entry.manifest)
      return refuse(
        `slot ${role}: the role manifest of job ${entry.jobId} is not the one the slot records`,
      );
    const manifest = readManifest(bytes);
    if (typeof manifest === "string")
      return refuse(
        `slot ${role}: the role manifest of job ${entry.jobId}: ${manifest}`,
      );
    if (revisionHashOf(manifest.revision) !== manifest.revisionRecipeHash)
      return refuse(
        `slot ${role}: the revision recipe hash of job ${entry.jobId} is not the hash of the fields its manifest records`,
      );
    if (
      entry.revisionRecipeHash !== manifest.revisionRecipeHash ||
      entry.slotRecipeHash !== manifest.slotRecipeHash ||
      entry.frames.length !== 1 ||
      entry.frames[0]?.hash !== manifest.frames[0]?.cell
    )
      return refuse(
        `slot ${role}: its cell and recipe hashes are not job ${entry.jobId}'s role manifest`,
      );
    const cellBytes = sources.readBlob(entry.frames[0].hash);
    if (
      cellBytes === undefined ||
      sha256Hex(cellBytes) !== entry.frames[0].hash
    )
      return refuse(
        `slot ${role}: the stored patch ${entry.frames[0].hash} is missing or altered`,
      );
    const decoded = decodePng(cellBytes);
    if (!decoded.ok)
      return refuse(
        `slot ${role}: the stored patch cannot be decoded (${decoded.code})`,
      );
    lineage[role] = { record, manifest };
    patches[role] = decoded.image;
  }
  const revisions = new Set(
    TILE_ROLES.map((role) => lineage[role].manifest.revisionRecipeHash),
  );
  if (revisions.size > 1)
    return refuse(
      `the two patches were rendered under ${revisions.size} different revision recipe hashes: render both under one recipe`,
    );
  const revision = lineage.base.manifest.revision;
  if (
    revision.palette.id !== palette.id ||
    revision.pivot.x !== TILE_CELL.w / 2 ||
    revision.pivot.y !== TILE_CELL.h / 2
  )
    return refuse(
      `the render's recipe names palette ${revision.palette.id} and pivot (${revision.pivot.x},${revision.pivot.y}), the request's is ${palette.id} and (${TILE_CELL.w / 2},${TILE_CELL.h / 2})`,
    );
  if (revision.profile !== profileHash(profile))
    return refuse(
      `the committed profile ${profile.id} is not the one the patches were rendered with: render them again`,
    );

  // --- the stamp, and the conformance of every atlas cell ---
  const stamped = stampTileSet(profile, postPalette.value, patches);
  if (!stamped.ok)
    return refuse(`the tile set cannot be stamped: ${stamped.message}`);
  if (patches.base.width !== patchSize(stamped.period).w)
    return refuse(
      "the stored patches are not the size of a period-sized patch",
    );
  const checked = tileCellChecks(
    stamped.atlas,
    stamped.period,
    paletteColours(spec),
    DEFAULT_CONFORM,
  );
  if (!checked.ok) return refuse(checked.message);
  const checks: ConformanceReport["checks"][number][] = [...checked.checks];
  if (palette.approval.status !== "approved")
    checks.push({
      check: "palette-approval",
      status: "fail",
      message: `palette "${palette.id}" is a draft: this packs, but only an approved palette's assets approve and publish`,
    });
  const report: ConformanceReport = {
    schemaVersion: 1,
    status: checks.some((c) => c.status === "fail") ? "fail" : "pass",
    checks,
  };

  const atlas = encodeRgbaPng(
    stamped.atlas.rgba,
    stamped.atlas.width,
    stamped.atlas.height,
  );

  // --- provenance ---
  const licences: LicenceRecord[] = [];
  for (const role of TILE_ROLES)
    for (const licence of lineage[role].record.engine?.licences ?? [])
      if (!licences.some((l) => JSON.stringify(l) === JSON.stringify(licence)))
        licences.push(licence);
  if (licences.length === 0)
    licences.push({
      subject: input.assetId,
      role: "original-work",
      ...REPOSITORY_WORK_LICENCE,
    });
  const requestIds = new Set(
    TILE_ROLES.map((role) => lineage[role].record.source.requestId),
  );
  const relatedJobs: JobRef[] = [...sources.jobs.values()]
    .filter((record) => requestIds.has(record.source.requestId))
    .filter((record) =>
      ["succeeded", "failed", "unavailable", "cancelled"].includes(
        record.job.status,
      ),
    )
    .sort(
      (a, b) =>
        a.source.requestId.localeCompare(b.source.requestId) ||
        a.source.ordinal - b.source.ordinal,
    )
    .map((record) =>
      record.job.status === "succeeded"
        ? {
            jobId: record.job.id,
            status: "succeeded" as const,
            outputs: record.job.outputs.map((output) => output.hash),
          }
        : {
            jobId: record.job.id,
            status: record.job.status as "failed" | "unavailable" | "cancelled",
          },
    );
  const slots: RenderedSlot[] = TILE_ROLES.map((role) => {
    const { manifest } = lineage[role];
    return {
      slotKey: role,
      recipeHash: manifest.slotRecipeHash,
      revisionRecipeHash: manifest.revisionRecipeHash,
      role,
      seed: 0,
      frameCount: 1,
      raw: {
        colour: manifest.frames.map((f) => f.raw.colour),
        id: manifest.frames.map((f) => f.raw.id),
        depth: manifest.frames.map((f) => f.raw.depth),
      },
    };
  });
  const built = parseAssetManifest(
    {
      schemaVersion: 1,
      kind: "tile",
      id: input.assetId,
      cell: { w: TILE_CELL.w, h: TILE_CELL.h },
      pixelScale: 1,
      paletteFamily: spec.palette.family,
      paletteId: palette.id,
      styleTag: input.styleTag,
      atlas: {
        blob: sha256Hex(atlas),
        width: stamped.atlas.width,
        height: stamped.atlas.height,
      },
      terrain: stamped.terrain,
      period: stamped.period,
      provenance: {
        method: "rendered",
        revisionRecipe: renderedRevisionOf(revision, profile.id),
        slots,
        licences,
        relatedJobs,
        handEdits: [],
        sourceAssets:
          sources.prior === undefined
            ? []
            : [{ assetId: input.assetId, revision: sources.prior.revision }],
      },
    },
    content.vocabulary,
  );
  if (!built.ok)
    return refuse(
      `the packed manifest is not valid: ${built.path}: ${built.message}`,
    );
  return {
    ok: true,
    value: {
      manifest: built.value as AssetManifest,
      atlas,
      variantAtlases: new Map<Sha256, Uint8Array>(),
      report,
      carried: [],
    },
  };
}

function readManifest(bytes: Uint8Array) {
  const parsed = parseRenderJobManifest(bytes);
  return parsed.ok ? parsed.value : `${parsed.path}: ${parsed.message}`;
}

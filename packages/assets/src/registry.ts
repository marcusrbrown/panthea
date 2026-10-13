// The filesystem registry: immutable content-addressed blobs and manifests,
// and one index that is replaced atomically. Single writer; no locks.
//
//   <root>/blobs/<sha256>.png
//   <root>/manifests/<revision>.json   canonical manifest text; revision = sha256 of these exact bytes
//   <root>/index.json                  { schemaVersion, entries: [{ assetId, revision }] } sorted by id
//
// Uses node:fs, so import it from the "@panthea/assets/registry" subpath; the
// package root stays free of the filesystem.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { inflateSync } from "node:zlib";
import {
  type AssetErrorCode,
  type AssetId,
  type AssetManifest,
  type AssetRecord,
  type AssetResult,
  type AssetVocabulary,
  type Atlas,
  assetFail,
  assetOk,
  canonicalJson,
  canonicalManifestText,
  parseAssetManifest,
  parseRegistryIndex,
  type RegistryIndex,
  type Sha256,
  transitionAsset,
} from "@panthea/contracts";
import { sha256Hex } from "./hash";
import { type Palette, paletteDigest } from "./palette";
import { filtersValid, inflatedLength, parsePng } from "./png";
import type { RegistrySnapshot, SnapshotEntry } from "./resolve";

export { parseAssetManifest };

export interface RegistryProblem {
  /** Path relative to the registry root. */
  readonly file: string;
  readonly message: string;
}

export interface RegistryLoad {
  readonly snapshot: RegistrySnapshot;
  readonly problems: readonly RegistryProblem[];
}

const INDEX_FILE = "index.json";
const blobFile = (hash: string) => `blobs/${hash}.png`;
const manifestFile = (revision: string) => `manifests/${revision}.json`;

interface Located {
  readonly code: AssetErrorCode;
  readonly file: string;
  readonly message: string;
}

type Checked<T> =
  | { readonly ok: true; readonly value: T }
  | ({ readonly ok: false } & Located);

const bad = (
  code: AssetErrorCode,
  file: string,
  message: string,
): Checked<never> => ({
  ok: false,
  code,
  file,
  message,
});

function readIfPresent(path: string): Uint8Array | undefined {
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
}

/** Writes through a sibling temp file and renames it into place. */
function writeAtomic(path: string, bytes: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    writeFileSync(temp, bytes);
    renameSync(temp, path);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}

/**
 * Checks a blob against its declared hash and atlas size: well-formed PNG
 * chunks, and image data that inflates to exactly the scanlines the header
 * implies with legal filter bytes. Pixels and palette indices are not decoded.
 */
export function checkBlob(
  bytes: Uint8Array,
  hash: Sha256,
  atlas: { readonly width: number; readonly height: number },
  file: string,
): Checked<true> {
  if (sha256Hex(bytes) !== hash)
    return bad("corrupt-blob", file, `bytes do not hash to ${hash}`);
  const parsed = parsePng(bytes);
  if (!parsed.ok)
    return bad("corrupt-blob", file, `not a valid PNG: ${parsed.reason}`);
  const { png } = parsed;
  if (png.width !== atlas.width || png.height !== atlas.height) {
    return bad(
      "corrupt-blob",
      file,
      `PNG is ${png.width}x${png.height}, the atlas declares ${atlas.width}x${atlas.height}`,
    );
  }
  const expected = inflatedLength(png);
  if (!Number.isSafeInteger(expected)) {
    return bad("corrupt-blob", file, "image data size is not representable");
  }
  let raw: Uint8Array;
  try {
    raw = inflateSync(Buffer.concat(png.idat), { maxOutputLength: expected });
  } catch {
    return bad(
      "corrupt-blob",
      file,
      "image data does not inflate to the scanline size",
    );
  }
  if (!filtersValid(raw, png)) {
    return bad(
      "corrupt-blob",
      file,
      "image data is not the expected scanlines",
    );
  }
  return { ok: true, value: true };
}

/** Every atlas a manifest names, once each: its own, then each realm variant's. */
function atlasesOf(manifest: AssetManifest): readonly Atlas[] {
  const atlases: Atlas[] = [manifest.atlas];
  if (manifest.kind === "sprite")
    for (const variant of manifest.realmVariants)
      if (!atlases.some((a) => a.blob === variant.atlas.blob))
        atlases.push(variant.atlas);
  return atlases;
}

/** Reads and verifies one revision: manifest bytes, canonical form, schema, and its blobs. */
function verifyRevision(
  root: string,
  assetId: AssetId,
  revision: Sha256,
  vocabulary: AssetVocabulary,
): Checked<{
  manifest: AssetManifest;
  atlas: Uint8Array;
  variantAtlases: ReadonlyMap<Sha256, Uint8Array>;
}> {
  const file = manifestFile(revision);
  const bytes = readIfPresent(join(root, file));
  if (bytes === undefined)
    return bad("corrupt-manifest", file, "manifest file is missing");
  if (sha256Hex(bytes) !== revision)
    return bad("corrupt-manifest", file, "bytes do not hash to the revision");
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return bad("corrupt-manifest", file, "not JSON");
  }
  const parsed = parseAssetManifest(json, vocabulary);
  if (!parsed.ok)
    return bad("invalid-manifest", file, `${parsed.path}: ${parsed.message}`);
  if (new TextDecoder().decode(bytes) !== canonicalManifestText(parsed.value)) {
    return bad(
      "corrupt-manifest",
      file,
      "not stored as canonical manifest text",
    );
  }
  if (parsed.value.id !== assetId) {
    return bad(
      "invalid-manifest",
      file,
      `manifest is for "${parsed.value.id}", not "${assetId}"`,
    );
  }
  const found = new Map<Sha256, Uint8Array>();
  for (const [index, atlas] of atlasesOf(parsed.value).entries()) {
    const blob = blobFile(atlas.blob);
    const blobBytes = readIfPresent(join(root, blob));
    if (blobBytes === undefined)
      return bad(
        "missing-blob",
        blob,
        index === 0
          ? "atlas blob is missing"
          : "realm variant atlas blob is missing",
      );
    const checked = checkBlob(blobBytes, atlas.blob, atlas, blob);
    if (!checked.ok) return checked;
    found.set(atlas.blob, blobBytes);
  }
  const atlas = found.get(parsed.value.atlas.blob) as Uint8Array;
  const variantAtlases = new Map(
    [...found].filter(([hash]) => hash !== parsed.value.atlas.blob),
  );
  return {
    ok: true,
    value: { manifest: parsed.value, atlas, variantAtlases },
  };
}

const toFailure = (located: Located) =>
  assetFail(located.code, `${located.file}: ${located.message}`);

/**
 * One verified published revision, current or older: its manifest, the exact
 * atlas PNG bytes it names, and the bytes of each realm variant's atlas by hash.
 */
export function readRevision(
  root: string,
  assetId: AssetId,
  revision: Sha256,
  vocabulary: AssetVocabulary,
): AssetResult<{
  readonly manifest: AssetManifest;
  readonly atlas: Uint8Array;
  readonly variantAtlases: ReadonlyMap<Sha256, Uint8Array>;
}> {
  const verified = verifyRevision(root, assetId, revision, vocabulary);
  return verified.ok ? assetOk(verified.value) : toFailure(verified);
}

/**
 * Phase one of publishing: validates the manifest and its blobs, then writes
 * the blob and the manifest. Nothing already stored is overwritten; a stored
 * file with different bytes is a corruption error. The index is not touched.
 */
export function writeRevision(
  root: string,
  manifest: AssetManifest,
  blobs: ReadonlyMap<Sha256, Uint8Array>,
  vocabulary: AssetVocabulary,
): AssetResult<{ readonly revision: Sha256 }> {
  const parsed = parseAssetManifest(
    JSON.parse(JSON.stringify(manifest)),
    vocabulary,
  );
  if (!parsed.ok)
    return assetFail("invalid-manifest", `${parsed.path}: ${parsed.message}`);

  // Every atlas the manifest names is checked before anything is written.
  const toWrite: { path: string; bytes: Uint8Array }[] = [];
  for (const atlas of atlasesOf(parsed.value)) {
    const hash = atlas.blob;
    const blobPath = join(root, blobFile(hash));
    const provided = blobs.get(hash);
    const stored = readIfPresent(blobPath);
    if (provided !== undefined) {
      if (sha256Hex(provided) !== hash) {
        return assetFail(
          "hash-mismatch",
          `${blobFile(hash)}: provided bytes do not hash to ${hash}`,
        );
      }
      const checked = checkBlob(provided, hash, atlas, blobFile(hash));
      if (!checked.ok) return toFailure(checked);
    }
    if (stored !== undefined) {
      const checked = checkBlob(stored, hash, atlas, blobFile(hash));
      if (!checked.ok) return toFailure(checked);
    } else if (provided === undefined) {
      return assetFail(
        "missing-blob",
        `${blobFile(hash)}: no bytes provided and none stored`,
      );
    } else {
      toWrite.push({ path: blobPath, bytes: provided });
    }
  }

  const text = new TextEncoder().encode(canonicalManifestText(parsed.value));
  const revision = sha256Hex(text);
  const manifestPath = join(root, manifestFile(revision));
  const storedManifest = readIfPresent(manifestPath);
  if (storedManifest !== undefined && sha256Hex(storedManifest) !== revision) {
    return assetFail(
      "corrupt-manifest",
      `${manifestFile(revision)}: stored bytes differ from the revision`,
    );
  }

  for (const { path, bytes } of toWrite) writeAtomic(path, bytes);
  if (storedManifest === undefined) writeAtomic(manifestPath, text);
  return assetOk({ revision });
}

function readIndex(root: string): AssetResult<RegistryIndex> {
  const bytes = readIfPresent(join(root, INDEX_FILE));
  if (bytes === undefined) return assetOk({ schemaVersion: 1, entries: [] });
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return assetFail("corrupt-index", `${INDEX_FILE}: not JSON`);
  }
  const parsed = parseRegistryIndex(json);
  return parsed.ok
    ? assetOk(parsed.value)
    : assetFail(
        "corrupt-index",
        `${INDEX_FILE}: ${parsed.path}: ${parsed.message}`,
      );
}

/**
 * Phase two of publishing: verifies the revision is stored and valid, then
 * replaces the single index file atomically. Readers see the old index or the
 * new one, never a partial one.
 */
export function selectRevision(
  root: string,
  assetId: AssetId,
  revision: Sha256,
  vocabulary: AssetVocabulary,
): AssetResult<RegistryIndex> {
  const verified = verifyRevision(root, assetId, revision, vocabulary);
  if (!verified.ok) return toFailure(verified);
  const current = readIndex(root);
  if (!current.ok) return current;
  const entries = [
    ...current.value.entries.filter((entry) => entry.assetId !== assetId),
    { assetId, revision },
  ].sort((a, b) => (a.assetId < b.assetId ? -1 : 1));
  const next: RegistryIndex = { schemaVersion: 1, entries };
  writeAtomic(join(root, INDEX_FILE), `${canonicalJson(next)}\n`);
  return assetOk(next);
}

/** Why `palette` cannot back `manifest` in canon, if it cannot: metadata only, no pixel is checked. */
export function paletteRefusal(
  manifest: AssetManifest,
  palette: Palette,
): string | undefined {
  if (palette.approval.status !== "approved") {
    return `palette "${palette.id}" is a draft; only an approved palette publishes`;
  }
  if (palette.approval.digest !== paletteDigest(palette)) {
    return `palette "${palette.id}" changed after its approval; the recorded digest does not match`;
  }
  if (manifest.paletteId !== palette.id) {
    return `the manifest names palette "${manifest.paletteId}", not the approved "${palette.id}"`;
  }
  if (manifest.kind === "sprite") {
    for (const variant of manifest.realmVariants) {
      if (variant.paletteId !== palette.id) {
        return `the ${variant.paletteFamily} realm variant names palette "${variant.paletteId}", not the approved "${palette.id}"`;
      }
    }
  }
  return undefined;
}

/**
 * Approved to canon: publishes exactly the manifest the approved record
 * owns, under the approved palette its manifest and realm variants name.
 * Writes the revision, selects it, and only then returns the canon record.
 * Anything that is not an approved record, or has no matching approved
 * palette, is refused before the registry is touched.
 */
export function publishAsset(
  root: string,
  record: AssetRecord,
  blobs: ReadonlyMap<Sha256, Uint8Array>,
  vocabulary: AssetVocabulary,
  palette: Palette,
): AssetResult<{ readonly record: AssetRecord; readonly revision: Sha256 }> {
  if (record.state !== "approved") {
    return assetFail(
      "not-approved",
      `only approved assets publish; this one is ${record.state}`,
    );
  }
  const refusal = paletteRefusal(record.manifest, palette);
  if (refusal !== undefined) return assetFail("not-approved", refusal);
  const written = writeRevision(root, record.manifest, blobs, vocabulary);
  if (!written.ok) return written;
  const selected = selectRevision(
    root,
    record.manifest.id,
    written.value.revision,
    vocabulary,
  );
  if (!selected.ok) return selected;
  const canon = transitionAsset(record, { type: "canonize" });
  if (!canon.ok) return canon;
  return assetOk({ record: canon.value, revision: written.value.revision });
}

/**
 * Reads the registry into a snapshot. An entry that fails any check is left
 * out and reported, so lookups for it fall back to the placeholder. Files the
 * index does not name (older revisions, interrupted temp files) are ignored.
 */
export function loadRegistry(
  root: string,
  vocabulary: AssetVocabulary,
): RegistryLoad {
  const empty: RegistrySnapshot = { entries: new Map() };
  const bytes = readIfPresent(join(root, INDEX_FILE));
  if (bytes === undefined) {
    return {
      snapshot: empty,
      problems: [{ file: INDEX_FILE, message: "index is missing" }],
    };
  }
  const index = readIndex(root);
  if (!index.ok) {
    return {
      snapshot: empty,
      problems: [{ file: INDEX_FILE, message: index.message }],
    };
  }
  const entries = new Map<string, SnapshotEntry>();
  const problems: RegistryProblem[] = [];
  for (const entry of index.value.entries) {
    const verified = verifyRevision(
      root,
      entry.assetId,
      entry.revision,
      vocabulary,
    );
    if (verified.ok) {
      entries.set(entry.assetId, {
        assetId: entry.assetId,
        revision: entry.revision,
        manifest: verified.value.manifest,
      });
    } else {
      problems.push({ file: verified.file, message: verified.message });
    }
  }
  return { snapshot: { entries }, problems };
}

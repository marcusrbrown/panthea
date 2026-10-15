// The curated kit library (R4, R6): third-party model files that render recipes read,
// committed under tools/render/kits/<kit id>/ and described by tools/render/kits.json.
//
// Everything here fails closed. The licence gate keys on what profiles reference, never on
// the informational `status` field: any file a profile references must belong to a kit whose
// licence text is present with a matching hash and whose licence is `CC0-1.0` or carries an
// owner assessment. Files on disk and manifest entries must match both ways, every hash and
// size must match, the total must stay under the cap, and every glTF a profile (or the
// manifest) points at must be closed: each `buffers[].uri` is a manifest file and each
// `images[].uri` is a manifest file or on the kit's declared texture skip list.
//
// Node/Bun module: it reads the kit files from disk.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import {
  fail,
  isRecord,
  ok,
  type ParseResult,
  parseArray,
  parseEnum,
  parseNonNegativeInteger,
  parseSchemaVersion,
  parseSha256,
  parseString,
  type Sha256,
} from "@panthea/contracts";
import { sha256Hex } from "../hash";

const SUPPORTED_SCHEMA_VERSIONS = [1] as const;
const KIT_STATUSES = ["used", "inspected-not-used"] as const;
const KIT_ID = /^[a-z0-9][a-z0-9-]*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const CC0_SPDX_ID = "CC0-1.0";

/** The owner's written assessment of a licence that is not `CC0-1.0`. */
export interface OwnerAssessment {
  readonly by: string;
  /** ISO date, YYYY-MM-DD. */
  readonly date: string;
  readonly summary: string;
}

export interface KitFile {
  /** POSIX path relative to the kit directory. */
  readonly path: string;
  readonly sha256: Sha256;
  readonly size: number;
  /** Ids of the profiles that reference this file. */
  readonly referencedBy: readonly string[];
}

export interface Kit {
  readonly id: string;
  readonly title?: string;
  /** How the files here differ from the pack as shipped, e.g. a format conversion. */
  readonly notes?: string;
  readonly sourceUrl: string;
  readonly licence: {
    /** SPDX id; free text is not accepted. */
    readonly spdx: string;
    readonly ownerAssessment?: OwnerAssessment;
  };
  /** The pack's licence text, relative to the kit directory. */
  readonly licenceFile: { readonly path: string; readonly sha256: Sha256 };
  /** Informational only: nothing is gated on it. */
  readonly status: (typeof KIT_STATUSES)[number];
  /** Texture uris (relative to the kit directory) skipped at import; images only. */
  readonly textureSkip: readonly string[];
  readonly files: readonly KitFile[];
}

export interface KitManifest {
  readonly schemaVersion: 1;
  readonly sizeCapBytes: number;
  readonly kits: readonly Kit[];
}

/** The kit files one render profile references. U6's profile parser supplies the real ones. */
export interface ProfileKitRefs {
  readonly profile: string;
  readonly files: readonly { readonly kit: string; readonly path: string }[];
}

export interface KitProblem {
  /** `kits.json`, or a path under the render root (`kits/<kit>/<path>`). */
  readonly file: string;
  readonly message: string;
}

export interface KitCheck {
  readonly problems: readonly KitProblem[];
  /** Bytes of the kit files and licence texts on disk. */
  readonly totalBytes: number;
}

// --- Parsing -------------------------------------------------------------------

function parseRelativePath(value: unknown, path: string): ParseResult<string> {
  const text = parseString(value, path);
  if (!text.ok) return text;
  const segments = text.value.split("/");
  if (
    text.value.includes("\\") ||
    segments.some((s) => s === "" || s === "." || s === "..")
  ) {
    return fail(
      path,
      "expected a relative POSIX path without empty, . or .. segments",
    );
  }
  return text;
}

function parseOwnerAssessment(
  value: unknown,
  path: string,
): ParseResult<OwnerAssessment> {
  if (!isRecord(value))
    return fail(path, "expected an owner assessment record");
  const by = parseString(value.by, `${path}.by`);
  if (!by.ok) return by;
  const summary = parseString(value.summary, `${path}.summary`);
  if (!summary.ok) return summary;
  if (typeof value.date !== "string" || !ISO_DATE.test(value.date)) {
    return fail(`${path}.date`, "expected an ISO date (YYYY-MM-DD)");
  }
  return ok({ by: by.value, date: value.date, summary: summary.value });
}

function parseKitFile(value: unknown, path: string): ParseResult<KitFile> {
  if (!isRecord(value)) return fail(path, "expected a file entry");
  const filePath = parseRelativePath(value.path, `${path}.path`);
  if (!filePath.ok) return filePath;
  const sha256 = parseSha256(value.sha256, `${path}.sha256`);
  if (!sha256.ok) return sha256;
  const size = parseNonNegativeInteger(value.size, `${path}.size`);
  if (!size.ok) return size;
  const referencedBy = parseArray(
    value.referencedBy,
    `${path}.referencedBy`,
    parseString,
  );
  if (!referencedBy.ok) return referencedBy;
  if (new Set(referencedBy.value).size !== referencedBy.value.length) {
    return fail(`${path}.referencedBy`, "expected unique profile ids");
  }
  return ok({
    path: filePath.value,
    sha256: sha256.value,
    size: size.value,
    referencedBy: referencedBy.value,
  });
}

function parseKit(value: unknown, path: string): ParseResult<Kit> {
  if (!isRecord(value)) return fail(path, "expected a kit");
  const id = parseString(value.id, `${path}.id`);
  if (!id.ok) return id;
  if (!KIT_ID.test(id.value)) {
    return fail(`${path}.id`, "expected a lowercase, hyphenated kit id");
  }
  const sourceUrl = parseString(value.sourceUrl, `${path}.sourceUrl`);
  if (!sourceUrl.ok) return sourceUrl;
  if (!isRecord(value.licence)) {
    return fail(`${path}.licence`, "expected a licence record");
  }
  const spdx = parseString(value.licence.spdx, `${path}.licence.spdx`);
  if (!spdx.ok) return spdx;
  let ownerAssessment: OwnerAssessment | undefined;
  if (value.licence.ownerAssessment !== undefined) {
    const assessment = parseOwnerAssessment(
      value.licence.ownerAssessment,
      `${path}.licence.ownerAssessment`,
    );
    if (!assessment.ok) return assessment;
    ownerAssessment = assessment.value;
  }
  if (!isRecord(value.licenceFile)) {
    return fail(`${path}.licenceFile`, "expected a licence file record");
  }
  const licencePath = parseRelativePath(
    value.licenceFile.path,
    `${path}.licenceFile.path`,
  );
  if (!licencePath.ok) return licencePath;
  const licenceHash = parseSha256(
    value.licenceFile.sha256,
    `${path}.licenceFile.sha256`,
  );
  if (!licenceHash.ok) return licenceHash;
  const status = parseEnum(value.status, `${path}.status`, KIT_STATUSES);
  if (!status.ok) return status;
  const textureSkip = parseArray(
    value.textureSkip,
    `${path}.textureSkip`,
    parseRelativePath,
  );
  if (!textureSkip.ok) return textureSkip;
  const files = parseArray(value.files, `${path}.files`, parseKitFile);
  if (!files.ok) return files;

  const paths = files.value.map((f) => f.path);
  if (new Set(paths).size !== paths.length) {
    return fail(`${path}.files`, "expected unique file paths");
  }
  if (paths.includes(licencePath.value)) {
    return fail(
      `${path}.licenceFile.path`,
      "the licence file is not a kit file entry",
    );
  }
  for (const skipped of textureSkip.value) {
    if (paths.includes(skipped)) {
      return fail(
        `${path}.textureSkip`,
        `"${skipped}" is a kit file, so it cannot also be skipped`,
      );
    }
  }
  const title =
    typeof value.title === "string" && value.title !== ""
      ? { title: value.title }
      : {};
  if (value.notes !== undefined) {
    const parsed = parseString(value.notes, `${path}.notes`);
    if (!parsed.ok) return parsed;
  }
  const notes = typeof value.notes === "string" ? { notes: value.notes } : {};
  return ok({
    id: id.value,
    ...title,
    ...notes,
    sourceUrl: sourceUrl.value,
    licence: {
      spdx: spdx.value,
      ...(ownerAssessment === undefined ? {} : { ownerAssessment }),
    },
    licenceFile: { path: licencePath.value, sha256: licenceHash.value },
    status: status.value,
    textureSkip: textureSkip.value,
    files: files.value,
  });
}

export function parseKitManifest(value: unknown): ParseResult<KitManifest> {
  if (!isRecord(value)) return fail("kits.json", "expected an object");
  const version = parseSchemaVersion(
    value.schemaVersion,
    SUPPORTED_SCHEMA_VERSIONS,
    "kits.json.schemaVersion",
  );
  if (!version.ok) return version;
  const cap = parseNonNegativeInteger(
    value.sizeCapBytes,
    "kits.json.sizeCapBytes",
  );
  if (!cap.ok) return cap;
  const kits = parseArray(value.kits, "kits.json.kits", parseKit);
  if (!kits.ok) return kits;
  const ids = kits.value.map((k) => k.id);
  if (new Set(ids).size !== ids.length) {
    return fail("kits.json.kits", "expected unique kit ids");
  }
  return ok({ schemaVersion: 1, sizeCapBytes: cap.value, kits: kits.value });
}

// --- Checks --------------------------------------------------------------------

/** Every file under `dir`, as POSIX paths relative to it. Symlinks are not followed. */
function filesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(dir, relative), {
      withFileTypes: true,
    })) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else found.push(path);
    }
  };
  if (existsSync(dir)) walk("");
  return found.sort();
}

type GltfUriRole = "buffers" | "images";

/** A uri scheme of two or more characters; a single letter is a drive letter, handled apart. */
const SCHEME_URI = /^[a-z][a-z0-9+.-]+:/i;

function* gltfUris(
  gltf: Record<string, unknown>,
): Generator<{ role: GltfUriRole; where: string; uri: string }> {
  for (const role of ["buffers", "images"] as const) {
    const list = gltf[role];
    if (!Array.isArray(list)) continue;
    for (const [index, item] of list.entries()) {
      if (isRecord(item) && typeof item.uri === "string") {
        yield { role, where: `${role}[${index}].uri`, uri: item.uri };
      }
    }
  }
}

/**
 * Closure of one glTF: every `buffers[].uri` is a kit file and every `images[].uri` is a kit
 * file or on the kit's skip list. Embedded `data:` uris need nothing. Returns the problems.
 */
export function gltfClosureProblems(
  kit: Kit,
  gltfPath: string,
  text: string,
): KitProblem[] {
  const file = `kits/${kit.id}/${gltfPath}`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [{ file, message: "glTF is not valid JSON" }];
  }
  if (!isRecord(parsed)) return [{ file, message: "glTF is not an object" }];
  const listed = new Set(kit.files.map((f) => f.path));
  const skipped = new Set(kit.textureSkip);
  const problems: KitProblem[] = [];
  for (const { role, where, uri } of gltfUris(parsed)) {
    if (uri.startsWith("data:")) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(uri);
    } catch {
      problems.push({ file, message: `${where} "${uri}" is not a valid uri` });
      continue;
    }
    // Judged on the decoded form, before any join: posix.join/normalize would otherwise strip a
    // leading slash and an absolute path would read as kit-relative.
    if (decoded.includes("\\") || /^[a-z]:/i.test(decoded)) {
      problems.push({
        file,
        message: `${where} "${uri}" is not a kit-relative path (backslash or drive letter); only kit files and embedded data are read`,
      });
      continue;
    }
    if (SCHEME_URI.test(uri) || SCHEME_URI.test(decoded)) {
      problems.push({
        file,
        message: `${where} "${uri}" is an external uri; only kit files and embedded data are read`,
      });
      continue;
    }
    if (decoded.startsWith("/")) {
      problems.push({
        file,
        message: `${where} "${uri}" is not a kit-relative path (absolute); only kit files and embedded data are read`,
      });
      continue;
    }
    const resolved = posix.normalize(
      posix.join(posix.dirname(gltfPath), decoded),
    );
    if (
      resolved.startsWith("../") ||
      resolved === ".." ||
      posix.isAbsolute(resolved)
    ) {
      problems.push({
        file,
        message: `${where} "${uri}" resolves outside the kit directory`,
      });
    } else if (listed.has(resolved)) {
      // closed
    } else if (role === "images" && skipped.has(resolved)) {
      // a declared texture skip
    } else {
      problems.push({
        file,
        message: `${where} "${uri}" is not in kits.json${role === "images" ? " or the kit's textureSkip list" : ""}`,
      });
    }
  }
  return problems;
}

function readJsonFile(path: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Checks the kit library under `renderRoot` (the `tools/render` directory) against the files
 * `profiles` reference. Never throws on bad data; every failure is a problem.
 */
export function checkKits(
  renderRoot: string,
  profiles: readonly ProfileKitRefs[],
): KitCheck {
  const manifestPath = join(renderRoot, "kits.json");
  if (!existsSync(manifestPath)) {
    return {
      problems: [{ file: "kits.json", message: "kits.json is missing" }],
      totalBytes: 0,
    };
  }
  const raw = readJsonFile(manifestPath);
  if (raw === undefined) {
    return {
      problems: [{ file: "kits.json", message: "kits.json is not valid JSON" }],
      totalBytes: 0,
    };
  }
  const parsed = parseKitManifest(raw);
  if (!parsed.ok) {
    return {
      problems: [
        { file: "kits.json", message: `${parsed.path}: ${parsed.message}` },
      ],
      totalBytes: 0,
    };
  }
  const manifest = parsed.value;
  const kitsRoot = join(renderRoot, "kits");
  const problems: KitProblem[] = [];
  const problem = (file: string, message: string) =>
    problems.push({ file, message });

  let totalBytes = 0;
  const present = new Set<string>(); // `kit/path` of entries found on disk
  const licenceOk = new Map<string, boolean>();
  const expectedOnDisk = new Set<string>();

  for (const kit of manifest.kits) {
    const licenceName = `kits/${kit.id}/${kit.licenceFile.path}`;
    expectedOnDisk.add(`${kit.id}/${kit.licenceFile.path}`);
    const licencePath = join(kitsRoot, kit.id, kit.licenceFile.path);
    if (!existsSync(licencePath)) {
      problem(
        licenceName,
        `licence file of kit "${kit.id}" is missing on disk`,
      );
      licenceOk.set(kit.id, false);
    } else {
      const bytes = readFileSync(licencePath);
      totalBytes += bytes.length;
      const matches = sha256Hex(bytes) === kit.licenceFile.sha256;
      if (!matches) {
        problem(
          licenceName,
          `licence file of kit "${kit.id}" does not match its manifest sha256`,
        );
      }
      licenceOk.set(kit.id, matches);
    }
    for (const entry of kit.files) {
      const name = `kits/${kit.id}/${entry.path}`;
      expectedOnDisk.add(`${kit.id}/${entry.path}`);
      const path = join(kitsRoot, kit.id, entry.path);
      if (!existsSync(path) || !statSync(path).isFile()) {
        problem(name, "is listed in kits.json but missing on disk");
        continue;
      }
      present.add(`${kit.id}/${entry.path}`);
      const bytes = readFileSync(path);
      totalBytes += bytes.length;
      if (bytes.length !== entry.size) {
        problem(
          name,
          `size ${bytes.length} differs from the manifest size ${entry.size}`,
        );
      }
      if (sha256Hex(bytes) !== entry.sha256) {
        problem(name, "sha256 differs from the manifest");
      }
    }
  }

  for (const onDisk of filesUnder(kitsRoot)) {
    if (!expectedOnDisk.has(onDisk)) {
      problem(`kits/${onDisk}`, "is on disk but not in kits.json");
    }
  }

  if (totalBytes > manifest.sizeCapBytes) {
    problem(
      "kits.json",
      `kit files total ${totalBytes} bytes, over sizeCapBytes ${manifest.sizeCapBytes}`,
    );
  }

  // Profile references: licence gate, then referencedBy both ways.
  const kitById = new Map(manifest.kits.map((k) => [k.id, k]));
  const referencedByAny = new Set<string>(); // `kit/path`
  for (const profile of profiles) {
    const referenced = new Set<string>();
    for (const ref of profile.files) {
      const name = `${ref.kit}/${ref.path}`;
      referenced.add(name);
      referencedByAny.add(name);
      const kit = kitById.get(ref.kit);
      if (kit === undefined) {
        problem(
          `kits/${name}`,
          `profile "${profile.profile}" references kit "${ref.kit}", which is not in kits.json`,
        );
        continue;
      }
      if (!kit.files.some((f) => f.path === ref.path)) {
        problem(
          `kits/${name}`,
          `profile "${profile.profile}" references a file that kit "${kit.id}" does not list`,
        );
        continue;
      }
      if (licenceOk.get(kit.id) !== true) {
        problem(
          `kits/${name}`,
          `referenced by profile "${profile.profile}", but the licence file of kit "${kit.id}" is missing or does not match its sha256`,
        );
      }
      if (
        kit.licence.spdx !== CC0_SPDX_ID &&
        kit.licence.ownerAssessment === undefined
      ) {
        problem(
          `kits/${name}`,
          `referenced by profile "${profile.profile}", but kit "${kit.id}" is licensed ${kit.licence.spdx}, not ${CC0_SPDX_ID}, and has no ownerAssessment record`,
        );
      }
    }
    for (const kit of manifest.kits) {
      for (const entry of kit.files) {
        const name = `${kit.id}/${entry.path}`;
        const listed = entry.referencedBy.includes(profile.profile);
        if (referenced.has(name) && !listed) {
          problem(
            `kits/${name}`,
            `profile "${profile.profile}" references this file, but referencedBy omits "${profile.profile}"`,
          );
        } else if (!referenced.has(name) && listed) {
          problem(
            `kits/${name}`,
            `referencedBy lists "${profile.profile}", but that profile does not reference this file`,
          );
        }
      }
    }
  }

  // glTF closure: every glTF a profile references, and every one the manifest says is referenced.
  for (const kit of manifest.kits) {
    for (const entry of kit.files) {
      if (!entry.path.endsWith(".gltf")) continue;
      const name = `${kit.id}/${entry.path}`;
      if (!present.has(name)) continue;
      if (entry.referencedBy.length === 0 && !referencedByAny.has(name))
        continue;
      problems.push(
        ...gltfClosureProblems(
          kit,
          entry.path,
          readFileSync(join(kitsRoot, kit.id, entry.path), "utf8"),
        ),
      );
    }
  }

  return { problems, totalBytes };
}

// Staging: download pinned components, then verify the downloaded bytes
// against the manifest sha256 (and size when known) before publishing the
// file under its final name. A mismatch never leaves a published or partial
// file, and an authorization refusal is reported as unavailable, never
// bypassed. CLI: `bun run src/stage.ts <arm|runtime|all> [--root <dir>]`.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { hashFile } from "./measure";

export interface StageEntry {
  readonly role: string;
  readonly id: string;
  readonly url: string;
  /** Destination relative to the probe root. */
  readonly file: string;
  readonly sizeBytes: number | null;
  readonly sha256: string;
  readonly license: string;
  readonly source: string;
  readonly benchmarkOnly?: boolean;
}

export interface Manifest {
  readonly schemaVersion: 1;
  readonly runtime: StageEntry & { readonly commit: string };
  readonly arms: Readonly<
    Record<string, { readonly components: readonly StageEntry[] }>
  >;
}

export interface StageResult {
  readonly id: string;
  readonly status:
    | "verified"
    | "downloaded"
    | "extracted"
    | "failed"
    | "unavailable";
  readonly reason?: string;
  readonly sizeBytes?: number;
  readonly sha256?: string;
}

export function loadManifest(path: string): Manifest {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Manifest;
  if (raw.schemaVersion !== 1) {
    throw new Error(`unsupported manifest schemaVersion ${raw.schemaVersion}`);
  }
  return raw;
}

async function check(entry: StageEntry, path: string): Promise<string | null> {
  const size = statSync(path).size;
  if (entry.sizeBytes !== null && size !== entry.sizeBytes) {
    return `size ${size} != expected ${entry.sizeBytes}`;
  }
  const actual = await hashFile(path);
  return actual === entry.sha256.toLowerCase()
    ? null
    : `sha256 ${actual} != expected ${entry.sha256}`;
}

/**
 * Overall wall-clock bound for one download. Generous enough for the
 * multi-GB weights on a slow link; a stalled or dead transfer still ends here.
 */
const DOWNLOAD_DEADLINE_MS = 4 * 60 * 60 * 1000;

async function download(
  url: string,
  part: string,
  deadlineMs: number,
): Promise<{ code: number; stderr: string; timedOut: boolean }> {
  const proc = Bun.spawn(
    [
      "curl",
      "-L",
      "-sS",
      "--retry",
      "3",
      "-C",
      "-",
      "-o",
      part,
      "-w",
      "%{http_code}",
      url,
    ],
    { stdout: "pipe", stderr: "pipe", env: process.env, timeout: deadlineMs },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exit = await proc.exited;
  // The deadline kill ends curl by signal; a normal curl exit never does.
  const timedOut = proc.signalCode !== null;
  // file:// transfers report 000; a clean curl exit with no HTTP code is fine.
  const code = Number.parseInt(stdout.trim(), 10);
  return {
    code:
      exit === 0 && Number.isNaN(code) ? 200 : Number.isNaN(code) ? 0 : code,
    stderr: exit === 0 ? "" : stderr.trim().slice(0, 300),
    timedOut,
  };
}

export async function stageEntry(
  entry: StageEntry,
  options: { readonly root: string; readonly downloadDeadlineMs?: number },
): Promise<StageResult> {
  const target = resolve(options.root, entry.file);
  const part = `${target}.part`;
  if (existsSync(target) && (await check(entry, target)) === null) {
    return {
      id: entry.id,
      status: "verified",
      sizeBytes: statSync(target).size,
      sha256: entry.sha256,
    };
  }
  mkdirSync(dirname(target), { recursive: true });
  const deadlineMs = options.downloadDeadlineMs ?? DOWNLOAD_DEADLINE_MS;
  const { code, stderr, timedOut } = await download(
    entry.url,
    part,
    deadlineMs,
  );
  if (timedOut) {
    // The partial bytes stay so a re-run can resume.
    return {
      id: entry.id,
      status: "failed",
      reason: `download exceeded the ${deadlineMs} ms deadline`,
    };
  }
  if (code === 401 || code === 403) {
    rmSync(part, { force: true });
    return {
      id: entry.id,
      status: "unavailable",
      reason: `HTTP ${code}: authorization required; no credential was acquired or bypass attempted`,
    };
  }
  if (code >= 400 || code === 0 || !existsSync(part)) {
    // A transport failure keeps the partial bytes so a re-run can resume;
    // an HTTP error body is never a resumable payload.
    if (code >= 400) rmSync(part, { force: true });
    return {
      id: entry.id,
      status: "failed",
      reason: `HTTP ${code}${stderr ? `: ${stderr}` : ""}`,
    };
  }
  const problem = await check(entry, part);
  if (problem !== null) {
    rmSync(part, { force: true });
    return { id: entry.id, status: "failed", reason: problem };
  }
  renameSync(part, target);
  return {
    id: entry.id,
    status: "downloaded",
    sizeBytes: statSync(target).size,
    sha256: entry.sha256,
  };
}

/** The server binary every arm config runs; `stage.ts runtime` must publish exactly this. */
export interface RuntimeBinary {
  readonly id: string;
  /** Relative to the probe root; its directory receives the whole archive. */
  readonly path: string;
  readonly sha256: string;
}

export const RUNTIME_BINARY: RuntimeBinary = {
  id: "sd-server-master-929-3f8527a",
  path: "bin/release/sd-server",
  sha256: "37fa5c1dfa673262abdf8ba0b9294144c7d666dbec40e688a1596d975fe57cae",
};

async function extractBinary(
  archive: StageEntry,
  binary: RuntimeBinary,
  root: string,
): Promise<StageResult> {
  const target = resolve(root, binary.path);
  const pin = { sizeBytes: null, sha256: binary.sha256 } as StageEntry;
  if (existsSync(target) && (await check(pin, target)) === null) {
    return {
      id: binary.id,
      status: "verified",
      sizeBytes: statSync(target).size,
      sha256: binary.sha256,
    };
  }
  const dir = dirname(target);
  const staging = `${dir}.part`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const fail = (reason: string): StageResult => {
    rmSync(staging, { recursive: true, force: true });
    return { id: binary.id, status: "failed", reason };
  };
  let exit: number;
  let stderr: string;
  try {
    const proc = Bun.spawn(
      ["unzip", "-o", "-q", resolve(root, archive.file), "-d", staging],
      { stdout: "ignore", stderr: "pipe" },
    );
    stderr = await new Response(proc.stderr).text();
    exit = await proc.exited;
  } catch (error) {
    return fail(
      `unzip could not run: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (exit !== 0) {
    return fail(`unzip exit ${exit}: ${stderr.trim().slice(0, 300)}`);
  }
  const extracted = join(staging, basename(target));
  if (!existsSync(extracted)) {
    return fail(`${basename(target)} is not in the archive`);
  }
  const problem = await check(pin, extracted);
  if (problem !== null) {
    return fail(problem);
  }
  rmSync(dir, { recursive: true, force: true });
  renameSync(staging, dir);
  return {
    id: binary.id,
    status: "extracted",
    sizeBytes: statSync(target).size,
    sha256: binary.sha256,
  };
}

/** Stages the release archive, then publishes and verifies the server binary from it. */
export async function stageRuntime(
  archive: StageEntry,
  binary: RuntimeBinary,
  options: { readonly root: string; readonly downloadDeadlineMs?: number },
): Promise<StageResult[]> {
  const staged = await stageEntry(archive, options);
  if (staged.status !== "verified" && staged.status !== "downloaded") {
    return [staged];
  }
  return [staged, await extractBinary(archive, binary, options.root)];
}

export async function main(argv: readonly string[]): Promise<number> {
  const [which, ...rest] = argv;
  const manifest = loadManifest(join(import.meta.dir, "..", "components.json"));
  const names = Object.keys(manifest.arms);
  const rootValue = rest[1];
  const rootGiven =
    rest.length === 2 &&
    rest[0] === "--root" &&
    rootValue !== undefined &&
    rootValue !== "" &&
    !rootValue.startsWith("--");
  if (
    !which ||
    (which !== "runtime" && !names.includes(which)) ||
    (rest.length > 0 && !rootGiven)
  ) {
    console.error(
      `usage: stage.ts <${["runtime", ...names].join("|")}> [--root <dir>]`,
    );
    return 64;
  }
  const root = resolve(
    rootGiven ? (rootValue as string) : join(import.meta.dir, ".."),
  );
  let bad = false;
  const report = (result: StageResult) => {
    console.log(JSON.stringify(result));
    if (result.status === "failed") bad = true;
  };
  if (which === "runtime") {
    for (const result of await stageRuntime(manifest.runtime, RUNTIME_BINARY, {
      root,
    })) {
      report(result);
    }
    return bad ? 1 : 0;
  }
  // Serial on purpose: one multi-GB transfer at a time.
  for (const entry of manifest.arms[which]?.components ?? []) {
    report(await stageEntry(entry, { root }));
  }
  return bad ? 1 : 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}

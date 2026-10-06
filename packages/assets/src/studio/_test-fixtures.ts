import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGodProfile, parseGodVisualProfiles } from "@panthea/content";
import {
  type GenerationJob,
  type GenerationRequest,
  type ParseResult,
  parseAssetVocabulary,
} from "@panthea/contracts";
import { sha256Hex } from "../hash";
import { parsePalette } from "../palette";
import type { StudioContent } from "./request";

export const HOLDER = join(import.meta.dir, "_test-holder.ts");

export const request: GenerationRequest = {
  schemaVersion: 1,
  subject: "zeus",
  kind: "sprite",
  slots: [{ state: "idle", direction: "south" }],
  batch: 1,
  seed: 7,
};

const provider = {
  id: "fake-local",
  medium: "image",
  hosting: "local",
} as const;

export function jobSource(requestId = "r1", ordinal = 0) {
  return { requestId, slotKey: "idle/south", ordinal };
}

export function queuedJob(id: string) {
  return {
    schemaVersion: 1,
    id,
    request,
    provider,
    status: "queued",
  } as const satisfies GenerationJob;
}

export function runningJob(id: string) {
  return { ...queuedJob(id), status: "running" } as const;
}

export function succeededJob(id: string): GenerationJob {
  return {
    ...queuedJob(id),
    status: "succeeded",
    outputs: [
      {
        medium: "image",
        hash: sha256Hex(new Uint8Array([1])),
        width: 8,
        height: 8,
      },
    ],
  };
}

const roots: string[] = [];

export function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "studio-"));
  roots.push(dir);
  return join(dir, "authoring");
}

export function removeTempRoots(): void {
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

const children: ReturnType<typeof Bun.spawn>[] = [];

/** Spawns a real process that opens a session on `root` and records a running job. */
export async function spawnHolder(root: string, jobId: string) {
  const child = Bun.spawn(["bun", "run", HOLDER, root, jobId], {
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(child);
  const decoder = new TextDecoder();
  let seen = "";
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  const deadline = Date.now() + 20_000;
  while (!/READY|BUSY/.test(seen)) {
    if (Date.now() > deadline) throw new Error(`holder timed out: ${seen}`);
    const chunk = await reader.read();
    if (chunk.done) break;
    seen += decoder.decode(chunk.value);
  }
  reader.releaseLock();
  return { child, seen };
}

export async function reapChildren(): Promise<void> {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited;
  }
}

const contentRoot = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "content",
  "greek",
);
const readText = (...parts: string[]) =>
  readFileSync(join(contentRoot, ...parts), "utf8");
const readJson = (...parts: string[]): unknown =>
  JSON.parse(readText(...parts));

function unwrap<T>(result: ParseResult<T>): T {
  if (!result.ok) throw new Error(`${result.path}: ${result.message}`);
  return result.value;
}

/** The authored Greek content, parsed through the production parsers. */
export function loadContent(): StudioContent {
  const vocabulary = unwrap(
    parseAssetVocabulary(readJson("assets", "vocabulary.json")),
  );
  const gods = readdirSync(join(contentRoot, "gods"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => unwrap(parseGodProfile(readJson("gods", f), f)));
  const visuals = unwrap(
    parseGodVisualProfiles(
      readdirSync(join(contentRoot, "assets", "subjects"))
        .sort()
        .map((f) => ({ label: f, value: readJson("assets", "subjects", f) })),
      gods,
      vocabulary.paletteFamilies,
    ),
  );
  const palette = unwrap(
    parsePalette(
      {
        json: readJson("palette", "palette.json"),
        gpl: readText("palette", "master.gpl"),
        hex: readText("palette", "master.hex"),
      },
      vocabulary.paletteFamilies,
    ),
  );
  return { vocabulary, gods, visuals, palette };
}

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GenerationJob, GenerationRequest } from "@panthea/contracts";
import { sha256Hex } from "../hash";

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

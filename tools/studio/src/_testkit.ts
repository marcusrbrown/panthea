// Test support: a Studio over real SDK sessions, a staged fake sd-server for
// the real runtime, and capture of what the CLI prints. The fixtures come from
// the assets package's own test support, which is test-only.

import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import {
  loadStudioContent,
  readStudioStatus,
  type SelectedProfile,
  type StudioStatus,
} from "@panthea/assets/studio";
import {
  type AssetRig,
  assetRig,
  removeTempRoots,
  tempRoot,
} from "../../../packages/assets/src/studio/_test-fixtures";
import {
  type Behavior,
  stageFixtureRuntime,
} from "../../../packages/assets/src/studio/_test-runtime";
import { execute } from "./commands";
import type { StudioConfig } from "./config";
import type { Outcome } from "./format";
import { type Deps, defaultDeps, Studio } from "./host";

export type { AssetRig };
export { assetRig, removeTempRoots, tempRoot };

export const REAL_CONTENT = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "content",
  "greek",
);

export const freePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
};

export const DEADLINES = {
  httpMs: 2000,
  startupMs: 5000,
  generationMs: 5000,
  termGraceMs: 400,
  killMs: 3000,
};

export interface Capture {
  readonly out: string[];
  readonly err: string[];
}

export const capture = (): Capture => ({ out: [], err: [] });

export function depsFor(cap: Capture, over: Partial<Deps> = {}): Deps {
  return {
    ...defaultDeps((line) => cap.err.push(line)),
    sleep: () => new Promise((resolve) => setTimeout(resolve, 5)),
    ...over,
  };
}

/** One command through the same dispatcher the CLI uses, on its own Studio. */
export async function run(
  config: StudioConfig,
  op: string,
  args: unknown,
  over: Partial<Deps> = {},
  mode: "oneshot" | "session" = "oneshot",
): Promise<{ outcome: Outcome; cap: Capture }> {
  const cap = capture();
  const studio = new Studio(config, depsFor(cap, over), mode);
  try {
    return { outcome: await execute(studio, op, args), cap };
  } finally {
    await studio.teardown();
  }
}

export interface RuntimeRig {
  readonly dir: string;
  readonly root: string;
  readonly config: StudioConfig;
  readonly profile: SelectedProfile;
  readonly deps: Partial<Deps>;
}

/** A studio root plus a staged fake runtime, configured as a CLI user would configure the real one. */
export async function runtimeRig(behavior: Behavior = {}): Promise<RuntimeRig> {
  const base = dirname(tempRoot());
  const dir = join(base, "artifacts");
  mkdirSync(dir, { recursive: true });
  const profile = stageFixtureRuntime(dir, behavior);
  const root = join(base, "studio");
  const config: StudioConfig = {
    studioRoot: root,
    contentRoot: REAL_CONTENT,
    registryRoot: join(base, "registry"),
    artifactRoot: dir,
    runtime: { port: await freePort(), pollMs: 15, deadlines: DEADLINES },
  };
  return { dir, root, config, profile, deps: { profile } };
}

export const realContent = () => {
  const loaded = loadStudioContent(REAL_CONTENT);
  if (!loaded.ok) throw new Error("the committed content does not load");
  return loaded.content;
};

export const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(
  condition: () => boolean,
  ms = 8000,
): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (condition()) return;
    await sleep(15);
  }
  throw new Error("timed out waiting for a condition");
}

/** An stdin the test feeds line by line, so a session can be answered while earlier commands are still running. */
export function pipe() {
  const queue: string[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  const iterable: AsyncIterable<string> = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const next = queue.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
  return {
    iterable,
    send(line: string) {
      queue.push(`${line}\n`);
      wake?.();
    },
    end() {
      closed = true;
      wake?.();
    },
  };
}

export const parsed = (lines: readonly string[]) =>
  lines.map((l) => JSON.parse(l) as Record<string, unknown>);

/** A copy of the committed Greek content whose palette files are the given ones, as a content root the loader reads. */
export function contentRootWithPalette(files: Record<string, string>): string {
  const root = join(dirname(tempRoot()), "content");
  for (const part of ["gods", "assets/subjects"])
    cpSync(join(REAL_CONTENT, part), join(root, part), { recursive: true });
  cpSync(
    join(REAL_CONTENT, "assets", "vocabulary.json"),
    join(root, "assets", "vocabulary.json"),
  );
  mkdirSync(join(root, "palette"), { recursive: true });
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(root, "palette", name), text);
  return root;
}

/** A session record for another process, as the lock holder left it. */
const holderRecord = (pid: number, ended = false) => ({
  schemaVersion: 1 as const,
  id: "other-session",
  pid,
  startedAt: "2026-10-09T00:00:00.000Z",
  ...(ended ? { endedAt: "2026-10-09T01:00:00.000Z" } : {}),
});

/** Deps for a root another process holds: the lock is busy, and the records name `pid` as the open holder. */
export function heldBy(
  pid: number | undefined,
  over: Partial<Deps> = {},
): Partial<Deps> & { alive: Set<number>; probes: () => number } {
  const alive = new Set<number>(pid === undefined ? [] : [pid]);
  let probes = 0;
  return {
    alive,
    probes: () => probes,
    openSession: () => {
      probes += 1;
      return { kind: "busy" as const };
    },
    readStatus: (root: string): StudioStatus => {
      const real = readStudioStatus(root);
      return pid === undefined
        ? { ...real, session: undefined }
        : { ...real, session: holderRecord(pid) };
    },
    isAlive: (p: number) => alive.has(p),
    ...over,
  };
}

// A runtime rig for the render engine's tests: a studio session on a temp root, the committed
// content, a staged fake Blender, an optional staged fake sd-server, a manual clock and a pressure
// reader the test sets. Test support only; it lives outside src/.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../../src/hash";
import { type PaletteSet, paletteDigest } from "../../src/palette";
import { type Clock, RENDER_ENGINE } from "../../src/render/engine";
import {
  type Behavior as SdBehavior,
  stageFixtureRuntime,
} from "../../src/studio/_test-runtime";
import { loadStudioContent } from "../../src/studio/content";
import type { SelectedProfile } from "../../src/studio/provider";
import { newRequestRecord } from "../../src/studio/request";
import {
  openRuntime,
  type RuntimeDeadlines,
  type StudioRuntime,
} from "../../src/studio/runtime";
import {
  openStudioSession,
  type StudioSession,
} from "../../src/studio/session";
import { readStudioStatus } from "../../src/studio/store";
import {
  type LaunchBehavior,
  type StagedBlender,
  stageFakeBlender,
} from "./fake-blender";

export const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
export const RENDER_ROOT = join(REPO_ROOT, "tools", "render");
const CONTENT_ROOT = join(REPO_ROOT, "content", "greek");

const loaded = loadStudioContent(CONTENT_ROOT);
if (!loaded.ok)
  throw new Error(
    loaded.diagnostics.map((d) => `${d.file}: ${d.message}`).join("; "),
  );
export const content = loaded.content;

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A clock the test advances; nothing in a test waits on the wall clock for engine logic. */
export class ManualClock implements Clock {
  private time = 0;
  private timers: { at: number; resolve: () => void }[] = [];

  now(): number {
    return this.time;
  }

  /** Timers armed and not yet fired: the engine's loop is waiting on the clock. */
  get pending(): number {
    return this.timers.length;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = { at: this.time + ms, resolve };
      this.timers.push(timer);
      signal?.addEventListener(
        "abort",
        () => {
          this.timers = this.timers.filter((t) => t !== timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  /** Moves time forward in timer-sized steps, letting the engine's loop run between them. */
  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (next === undefined || next.at > end) break;
      this.time = Math.max(this.time, next.at);
      this.timers.shift();
      next.resolve();
      for (let i = 0; i < 5; i += 1) await settle();
    }
    this.time = end;
    for (let i = 0; i < 5; i += 1) await settle();
  }
}

export const DEADLINES: RuntimeDeadlines = {
  httpMs: 2000,
  startupMs: 1000,
  generationMs: 5000,
  termGraceMs: 300,
  killMs: 3000,
};
export const WATCHDOG_MS = 2000;

export async function eventually(
  condition: () => boolean,
  ms = 15_000,
): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for a condition");
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

export interface RigOptions {
  launches?: LaunchBehavior[];
  /** Replaces the staged Blender: a path that need not exist. */
  executable?: string;
  /** Padding appended to the staged executable so hashing it takes a while. */
  padBytes?: number;
  /** Runs the render engine on a copy of tools/render that this function may change. */
  mutateRenderRoot?: (renderRoot: string) => void;
  /** The no-new-frame watchdog; defaults to WATCHDOG_MS. */
  watchdogMs?: number;
  /** Leave the render engine unconfigured. */
  withoutRender?: boolean;
  /** Stage a fake sd-server too. */
  sd?: SdBehavior;
  pin?: Partial<StagedBlender["pin"]>;
}

export interface Rig {
  readonly base: string;
  readonly root: string;
  readonly tempParent: string;
  readonly fakeDir: string;
  readonly sdDir: string;
  readonly session: StudioSession;
  readonly runtime: StudioRuntime;
  readonly clock: ManualClock;
  readonly blender: StagedBlender;
  readonly sdProfile: SelectedProfile | undefined;
  /** The memory pressure level the reader reports. */
  pressure: { level: number | undefined };
}

const rigs: Rig[] = [];

export async function openRig(options: RigOptions = {}): Promise<Rig> {
  const base = mkdtempSync(join(tmpdir(), "render-rig-"));
  const fakeDir = join(base, "blender");
  const sdDir = join(base, "artifacts");
  const tempParent = join(base, "scratch");
  mkdirSync(sdDir, { recursive: true });
  const staged = stageFakeBlender(fakeDir, options.launches ?? [{}]);
  if (options.padBytes !== undefined) {
    // Padding after the script's `exec` is never read by the shell, but it is hashed.
    writeFileSync(
      staged.executable,
      Buffer.concat([
        readFileSync(staged.executable),
        Buffer.from("#"),
        Buffer.alloc(options.padBytes, 0x20),
        Buffer.from("\n"),
      ]),
    );
    (staged.pin as { binarySha256: string }).binarySha256 = sha256Hex(
      new Uint8Array(readFileSync(staged.executable)),
    );
  }
  const sdProfile =
    options.sd === undefined
      ? undefined
      : stageFixtureRuntime(sdDir, options.sd);
  const opened = openStudioSession(join(base, "studio"));
  if (opened.kind === "busy") throw new Error("busy");
  const clock = new ManualClock();
  let renderRoot = RENDER_ROOT;
  if (options.mutateRenderRoot !== undefined) {
    renderRoot = copyRenderRoot(base);
    options.mutateRenderRoot(renderRoot);
  }
  const pressure: Rig["pressure"] = { level: 1 };
  const pin = { ...staged.pin, ...options.pin } as StagedBlender["pin"];
  const runtime = openRuntime(opened.session, {
    artifactRoot: sdDir,
    port: await freePort(),
    content,
    deadlines: DEADLINES,
    pollMs: 15,
    ...(sdProfile === undefined ? {} : { profile: sdProfile }),
    pressure: () => pressure.level,
    ...(options.withoutRender
      ? {}
      : {
          render: {
            executable: options.executable ?? staged.executable,
            pin: pin as never,
            renderRoot,
            tempParent,
            watchdogMs: options.watchdogMs ?? WATCHDOG_MS,
            clock,
          },
        }),
  });
  const rig: Rig = {
    base,
    root: join(base, "studio"),
    tempParent,
    fakeDir,
    sdDir,
    session: opened.session,
    runtime,
    clock,
    blender: { ...staged, pin },
    sdProfile,
    pressure,
  };
  rigs.push(rig);
  return rig;
}

/** Shuts every rig's runtime down (killing any child) and removes the temp directories. */
export async function closeRigs(): Promise<void> {
  for (const rig of rigs.splice(0)) {
    await rig.runtime.shutdown();
    rmSync(rig.base, { recursive: true, force: true });
  }
}

const refuseDraw = () => {
  throw new Error("the seed supplier must not be called");
};

export interface SlotInput {
  state: string;
  direction: string;
  ability?: string;
}

/** Submits a recipe request; returns the ids of its jobs, one per slot. */
export function submitRender(
  rig: Rig,
  id: string,
  slots: readonly SlotInput[] = [{ state: "idle", direction: "west" }],
  options: { pivot?: { x: number; y: number } } = {},
): string[] {
  const built = newRequestRecord(
    content,
    {
      id,
      subject: "zeus",
      kind: "sprite",
      slots,
      render: {
        palette: "greek-retro",
        pivot: options.pivot ?? { x: 56, y: 78 },
      },
    },
    refuseDraw,
    RENDER_ENGINE,
  );
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  const result = rig.session.submitRequest(built.value.record);
  if (!result.ok) throw new Error(result.message);
  return [...result.jobIds];
}

/** Submits an image request for the sd engine. */
export function submitSd(rig: Rig, id: string): string[] {
  const built = newRequestRecord(
    content,
    {
      id,
      subject: "zeus",
      kind: "sprite",
      slots: [{ state: "idle", direction: "south" }],
      batch: 1,
      seed: 100,
    },
    refuseDraw,
  );
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  const result = rig.session.submitRequest(built.value.record);
  if (!result.ok) throw new Error(result.message);
  return [...result.jobIds];
}

export const jobsById = (rig: Rig) =>
  Object.fromEntries(
    readStudioStatus(rig.root).jobs.map((record) => [record.job.id, record]),
  );
export const statusOf = (rig: Rig, id: string) => jobsById(rig)[id]?.job.status;
export const blobCount = (rig: Rig) =>
  existsSync(join(rig.root, "blobs"))
    ? readdirSync(join(rig.root, "blobs")).length
    : 0;
export const scratchLeft = (rig: Rig) =>
  existsSync(rig.tempParent) ? readdirSync(rig.tempParent) : [];

export const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export async function drain(rig: Rig) {
  const result = await rig.runtime.drain();
  if (!result.ok) throw new Error(`${result.reason}: ${result.message}`);
  return result;
}

/** A copy of tools/render the test may change: kits, profiles, stamps, camera and the manifest. */
export function copyRenderRoot(base: string): string {
  const copy = join(base, "render-root");
  cpSync(RENDER_ROOT, copy, {
    recursive: true,
    filter: (source) =>
      !source.includes(`${join("tools", "render", "blender")}`),
  });
  return copy;
}

/**
 * Plants an unlisted buffer in a referenced glTF of a render-root copy, then re-pins the changed
 * file in kits.json and the profile, so the closure check is the only thing that can refuse it.
 */
export function plantUnlistedBuffer(renderRoot: string): string {
  const kit = "universal-base-characters";
  const file = "Superhero_Male_FullBody.gltf";
  const path = join(renderRoot, "kits", kit, file);
  const gltf = JSON.parse(readFileSync(path, "utf8")) as {
    buffers: { uri?: string; byteLength: number }[];
  };
  gltf.buffers.push({ uri: "Planted_Unlisted.bin", byteLength: 4 });
  const bytes = Buffer.from(JSON.stringify(gltf));
  writeFileSync(path, bytes);
  repin(renderRoot, kit, file, bytes);
  return `${kit}/${file}`;
}

/**
 * Points a referenced glTF at a buffer whose uri is not valid percent-encoding (`bad%ZZ.bin`), then
 * re-pins the changed file, so the uri is the only thing wrong with the render root.
 */
export function plantMalformedBufferUri(renderRoot: string): string {
  const kit = "universal-base-characters";
  const file = "Superhero_Male_FullBody.gltf";
  const path = join(renderRoot, "kits", kit, file);
  const gltf = JSON.parse(readFileSync(path, "utf8")) as {
    buffers: { uri?: string; byteLength: number }[];
  };
  gltf.buffers.push({ uri: "bad%ZZ.bin", byteLength: 4 });
  const bytes = Buffer.from(JSON.stringify(gltf));
  writeFileSync(path, bytes);
  repin(renderRoot, kit, file, bytes);
  return `${kit}/${file}`;
}

/** Changes a non-glTF kit file's bytes without re-pinning it: the closure check cannot see it. */
export function corruptKitFile(renderRoot: string): string {
  const kit = "universal-base-characters";
  const file = "Superhero_Male_FullBody.bin";
  const path = join(renderRoot, "kits", kit, file);
  const bytes = Buffer.from(readFileSync(path));
  bytes[0] = (bytes[0] as number) ^ 0xff;
  writeFileSync(path, bytes);
  return `${kit}/${file}`;
}

function repin(
  renderRoot: string,
  kit: string,
  file: string,
  bytes: Buffer,
): void {
  const sha = sha256Hex(new Uint8Array(bytes));
  const manifestPath = join(renderRoot, "kits.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    kits: {
      id: string;
      files: { path: string; sha256: string; size: number }[];
    }[];
  };
  const entry = manifest.kits
    .find((k) => k.id === kit)
    ?.files.find((f) => f.path === file);
  if (entry === undefined) throw new Error("no such kit file");
  entry.sha256 = sha;
  entry.size = bytes.length;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  for (const name of readdirSync(join(renderRoot, "profiles"))) {
    const profilePath = join(renderRoot, "profiles", name);
    const profile = JSON.parse(readFileSync(profilePath, "utf8")) as {
      kitFiles: { kit: string; path: string; sha256: string }[];
    };
    for (const ref of profile.kitFiles)
      if (ref.kit === kit && ref.path === file) ref.sha256 = sha;
    writeFileSync(profilePath, JSON.stringify(profile, null, 2));
  }
}

// --- Rendered assets through pack, approve and publish -------------------------------------------------

/** Every palette of the content with `greek-retro` approved against its own digest: what a fixture needs to approve and publish. */
export function approvedPalettes(): PaletteSet {
  const retro = content.palettes.get("greek-retro");
  if (retro === undefined)
    throw new Error("no greek-retro palette in the content");
  return new Map([
    ...content.palettes,
    [
      "greek-retro",
      {
        ...retro,
        approval: { status: "approved", digest: paletteDigest(retro) },
      },
    ],
  ]);
}

/**
 * Every palette of the content with `greek-retro` an explicit draft, whatever the committed
 * file's status: what a fixture needs to prove that approve and publish refuse a draft palette.
 */
export function draftPalettes(): PaletteSet {
  const retro = content.palettes.get("greek-retro");
  if (retro === undefined)
    throw new Error("no greek-retro palette in the content");
  return new Map([
    ...content.palettes,
    ["greek-retro", { ...retro, approval: { status: "draft" } }],
  ]);
}

export const registryOf = (rig: Rig): string => {
  const root = join(rig.base, "registry");
  mkdirSync(root, { recursive: true });
  return root;
};

/** Renders a request through the runtime, reads each job back as a rendered candidate and opens a working set on it. Returns the job ids. */
export async function renderCandidates(
  rig: Rig,
  requestId: string,
  slots: readonly SlotInput[],
  setId?: string,
  options: { pivot?: { x: number; y: number } } = {},
): Promise<string[]> {
  const ids = submitRender(rig, requestId, slots, options);
  const result = await drain(rig);
  for (const entry of result.results)
    if (entry.outcome !== "rendered")
      throw new Error(`${entry.jobId}: ${entry.outcome}`);
  for (const id of ids) {
    const conformed = rig.session.conformRendered(id, content);
    if (!conformed.ok) throw new Error(`conform ${id}: ${conformed.message}`);
  }
  if (setId !== undefined) {
    const opened = rig.session.openWorkingSet(setId, requestId, content);
    if (!opened.ok) throw new Error(`open set: ${opened.message}`);
  }
  return ids;
}

export function pickAll(rig: Rig, setId: string, ids: readonly string[]): void {
  for (const id of ids) {
    const picked = rig.session.pick(setId, id);
    if (!picked.ok) throw new Error(`pick ${id}: ${picked.message}`);
  }
}

export const PACK_INPUT = {
  id: "zeus-retro-pack",
  assetId: "zeus-retro",
  styleTag: "retro",
  footprint: { w: 1, h: 1 },
  originalWork: { licence: "MIT", attribution: "the owner" },
} as const;

export function packSet(
  rig: Rig,
  setId: string,
  palettes: PaletteSet = approvedPalettes(),
  over: Partial<typeof PACK_INPUT> = {},
) {
  return rig.session.pack(
    { ...PACK_INPUT, ...over, workingSetId: setId },
    content,
    palettes,
    registryOf(rig),
  );
}

// The render engine: pinned Blender, run by the studio runtime beside sd-server.
//
// One Blender process renders a consecutive run of queued render jobs of one request (one job
// is one slot). The runner
//   - verifies the executable (owner config, outside the artifact root) against the pinned
//     sha256, cached by size and mtime;
//   - builds the recipe, runs the static kit-closure check on every glTF it references, and
//     stages only the manifest kit files into a scratch directory the script is pointed at;
//   - spawns argv-only with an allow-listed env in its own process group, and reads stdout for
//     the script's first line (a death before it is `unavailable`, never `failed`);
//   - ingests a slot only when its `done.json` matches (slot, frame count, per-file sha256) and
//     the expected files are all there; the exit code is never trusted;
//   - stores raw frames as blobs, runs the TypeScript post step, stores the cells and a role
//     manifest blob, and settles the job.
//
// Time is injected: the per-slot deadline, the no-new-frame watchdog and the start-up deadline
// read `RenderEngineConfig.clock`, so tests drive them without wall-clock waits.
//
// Stop is SIGTERM, a bounded wait, then SIGKILL, never SIGINT (Blender swallows it).

/// <reference path="../studio/py-module.d.ts" />

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import {
  canonicalJson,
  durationBounds,
  type ImageOutput,
  type LicenceRecord,
  type Sha256,
  stateRuleFor,
} from "@panthea/contracts";
import RENDER_SCRIPT from "../../../../tools/render/blender/render.py" with {
  type: "text",
};
import { sha256Hex } from "../hash";
import { paletteDigest } from "../palette";
import { encodeRgbaPng } from "../placeholder";
import {
  type Attempt,
  type Engine,
  type Ready,
  type Running,
  unsettled,
} from "../studio/engine";
import { matchesPin } from "../studio/hash-file";
import { decodePng } from "../studio/png/decode";
import {
  launch,
  type OwnedChild,
  stopGroup,
  type TeardownResult,
  tailOf,
} from "../studio/process";
import { RENDER_PROVIDER } from "../studio/provider";
import type { EngineCells } from "../studio/request";
import { buildSpec } from "../studio/request";
import type { RuntimeConfig } from "../studio/runtime";
import type { StudioSession } from "../studio/session";
import type { JobRecord } from "../studio/store";
import { parseEngineFacts } from "../studio/workspace";
import { cameraHash } from "./camera";
import { gltfClosureProblems, type Kit, parseKitManifest } from "./kits";
import { listFiles } from "./list-files";
import { loadRenderInputs } from "./load";
import {
  cellPixelHash,
  POST_STEP_VERSION,
  postProcessSlot,
  type RawFrame,
} from "./post";
import { postPaletteFrom } from "./post-palette";
import { type ModelProfile, profileHash } from "./profile";
import {
  type BlenderBinaryPin,
  kitHash,
  postSettingsFor,
  postStepSettings,
  type RevisionRecipe,
  revisionRecipe,
  slotRecipeHash,
  stampLocatorsFrom,
  stampSetHash,
} from "./recipe";
import {
  classifyExit,
  classifyTermination,
  FIRST_LINE_MARKER,
  parseDoneSentinel,
  parseRenderRecipe,
  RENDER_ROLES,
  type RenderRecipe,
  type RenderRole,
  renderRecipeJson,
  SENTINEL_NAME,
} from "./script-contract";
import {
  type LoadedStampSet,
  loadStampSet,
  parseStampManifest,
} from "./stamps";

/** The render engine's declared cells, for the request builder's size gate. */
export const RENDER_ENGINE: EngineCells = {
  provider: RENDER_PROVIDER,
  measuredCells: [{ w: 112, h: 96 }],
  generationScale: 1,
};

/** Blender 5.2.2 LTS, build `d13f752e3b9c`, the arm64 macOS executable the probes measured (U1). */
export const BLENDER_PIN: BlenderBinaryPin = {
  version: "5.2.2",
  buildHash: "d13f752e3b9c",
  binarySha256:
    "f5c1f2a0c0bca3389ec772d355242b700975ea84e66cbb3f5257a7bce8e5adeb" as Sha256,
};

/** The script text the sidecar carries; its hash is the script hash in the recipe. */
export const RENDER_SCRIPT_TEXT: string = RENDER_SCRIPT;
export const RENDER_SCRIPT_SHA256: Sha256 = sha256Hex(
  new TextEncoder().encode(RENDER_SCRIPT_TEXT),
);

export interface Clock {
  now(): number;
  /** Resolves after `ms`, or at once when the signal aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    }),
};

export interface RenderEngineConfig {
  /** Blender, from owner config. Outside `artifactRoot`; never from the webview. */
  readonly executable: string;
  readonly pin: BlenderBinaryPin;
  /** `tools/render`: kits, kits.json, profiles, camera and stamps. */
  readonly renderRoot: string;
  /** Where scratch directories are made; the system temp directory when absent. */
  readonly tempParent?: string;
  /** No new frame and no output for this long means a stall. */
  readonly watchdogMs: number;
  readonly clock?: Clock;
  /** The child's whole environment; defaults to a minimal one pointing HOME and TMPDIR at scratch. */
  readonly env?: Readonly<Record<string, string>>;
}

const BLENDER_GUIDANCE = (config: RenderEngineConfig) =>
  `Install Blender ${config.pin.version} (build ${config.pin.buildHash}) and set render.executable in the studio config to its executable, outside the artifact root. The executable's sha256 must be ${config.pin.binarySha256}. Nothing is downloaded automatically and no other renderer is tried.`;

const inside = (parent: string, path: string) => {
  const rel = posix.relative(parent, path);
  return rel === "" || (!rel.startsWith("..") && !posix.isAbsolute(rel));
};

const hex = (rgb: readonly number[]) =>
  `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

// --- Preparation ------------------------------------------------------------------------------------------

interface PreparedSlot {
  readonly record: JobRecord;
  readonly recipe: RenderRecipe["slots"][number];
  readonly clip: string;
  readonly seed: number;
  /** Whole milliseconds each frame is shown: the profile's timing for the state. */
  readonly frameMs: readonly number[];
}

interface Prepared {
  readonly workDir: string;
  readonly scriptPath: string;
  readonly recipePath: string;
  readonly recipe: RenderRecipe;
  readonly revision: RevisionRecipe;
  readonly slots: readonly PreparedSlot[];
  readonly settings: ReturnType<typeof postStepSettings>;
  readonly palette: NonNullable<ReturnType<typeof okPalette>>;
  readonly stamps: LoadedStampSet;
  readonly licences: readonly LicenceRecord[];
  readonly paletteId: string;
  readonly paletteDigest: Sha256;
}

const okPalette = (value: ReturnType<typeof postPaletteFrom>) =>
  value.ok ? value.value : undefined;

/** Buffers a staged glTF reads that the profile does not list: they would be missing at import. */
function unstagedBufferProblems(
  profile: ModelProfile,
  kit: string,
  gltfPath: string,
  text: string,
): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const buffers = (parsed as { buffers?: { uri?: unknown }[] }).buffers;
  if (!Array.isArray(buffers)) return [];
  const listed = new Set(
    profile.kitFiles.filter((f) => f.kit === kit).map((f) => f.path),
  );
  const problems: string[] = [];
  for (const buffer of buffers) {
    if (typeof buffer?.uri !== "string" || buffer.uri.startsWith("data:"))
      continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(buffer.uri);
    } catch {
      problems.push(
        `${kit}/${gltfPath} names a buffer "${buffer.uri}" which is not a valid uri`,
      );
      continue;
    }
    const resolved = posix.normalize(
      posix.join(posix.dirname(gltfPath), decoded),
    );
    if (!listed.has(resolved))
      problems.push(
        `${kit}/${gltfPath} reads buffer ${resolved}, which the profile does not list, so it would not be staged`,
      );
  }
  return problems;
}

type PrepareResult =
  | { readonly ok: true; readonly prepared: Prepared }
  | { readonly ok: false; readonly error: string };

function prepare(
  session: StudioSession,
  config: RuntimeConfig,
  render: RenderEngineConfig,
  batch: readonly JobRecord[],
  revisions: Map<string, RevisionRecipe>,
): PrepareResult {
  const problem = (error: string): PrepareResult => ({ ok: false, error });
  const first = batch[0] as JobRecord;
  const stored = session.store.readRequest(first.source.requestId);
  if (stored.kind !== "found")
    return problem(
      `request record ${first.source.requestId} is missing or invalid`,
    );
  const request = stored.value.request;
  const recipeRequest = request.recipe;
  if (recipeRequest === undefined)
    return problem("the job's request is not a recipe request");
  const spec = buildSpec(config.content, request);
  if (!spec.ok)
    return problem(
      `cannot rebuild the generation spec: ${JSON.stringify(spec.error)}`,
    );

  const inputs = loadRenderInputs(render.renderRoot);
  if (inputs.camera === undefined)
    return problem(
      `camera.json is unusable: ${inputs.problems.find((p) => p.file === "camera.json")?.message ?? "unknown"}`,
    );
  const profile = inputs.profiles.find((p) => p.id === recipeRequest.profile);
  if (profile === undefined)
    return problem(
      `no render profile "${recipeRequest.profile}" under ${render.renderRoot}/profiles (${inputs.problems.map((p) => `${p.file}: ${p.message}`).join("; ") || "none unparsed"})`,
    );
  const profileProblems = inputs.problems.filter(
    (p) => p.file === `profiles/${profile.id}.json`,
  );
  if (profileProblems.length > 0)
    return problem(
      `profile ${profile.id}: ${profileProblems.map((p) => p.message).join("; ")}`,
    );
  const camera = inputs.camera;

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(
      readFileSync(join(render.renderRoot, "kits.json"), "utf8"),
    );
  } catch (error) {
    return problem(`kits.json cannot be read: ${(error as Error).message}`);
  }
  const manifest = parseKitManifest(manifestJson);
  if (!manifest.ok)
    return problem(`kits.json: ${manifest.path}: ${manifest.message}`);
  const kitById = new Map<string, Kit>(
    manifest.value.kits.map((k) => [k.id, k]),
  );

  // The static closure check: every glTF the profile reads names only manifest files (or declared
  // texture skips), and every buffer it names is one the profile stages.
  const violations: string[] = [];
  for (const ref of profile.kitFiles) {
    if (!ref.path.endsWith(".gltf")) continue;
    const kit = kitById.get(ref.kit);
    if (kit === undefined) {
      violations.push(`kit ${ref.kit} is not in kits.json`);
      continue;
    }
    let text: string;
    try {
      text = readFileSync(
        join(render.renderRoot, "kits", ref.kit, ref.path),
        "utf8",
      );
    } catch {
      violations.push(`${ref.kit}/${ref.path} cannot be read`);
      continue;
    }
    for (const found of gltfClosureProblems(kit, ref.path, text))
      violations.push(found.message);
    violations.push(
      ...unstagedBufferProblems(profile, ref.kit, ref.path, text),
    );
  }
  if (violations.length > 0)
    return problem(`kit closure violation: ${violations.join("; ")}`);

  const palette = config.content.palettes.get(recipeRequest.palette);
  if (palette === undefined)
    return problem(`no palette "${recipeRequest.palette}" in the content`);
  const postPalette = okPalette(
    postPaletteFrom(config.content.palettes, recipeRequest.palette),
  );
  if (postPalette === undefined)
    return problem(
      `palette "${recipeRequest.palette}" cannot drive the post step`,
    );

  // The contact shadow is shade 0 of the profile's ramp: refuse before a render if the palette has none.
  if (postPalette.ramps.get(profile.shadow.ramp)?.[0] === undefined)
    return problem(
      `the profile's shadow ramp "${profile.shadow.ramp}" is not in palette "${palette.id}"`,
    );

  let stampsJson: unknown;
  try {
    stampsJson = JSON.parse(
      readFileSync(join(render.renderRoot, "stamps", "stamps.json"), "utf8"),
    );
  } catch (error) {
    return problem(`stamps.json cannot be read: ${(error as Error).message}`);
  }
  const stampManifest = parseStampManifest(stampsJson);
  if (!stampManifest.ok)
    return problem(
      `stamps.json: ${stampManifest.path}: ${stampManifest.message}`,
    );
  const stampSet = stampManifest.value.sets.find(
    (s) => s.id === profile.stampSet,
  );
  if (stampSet === undefined)
    return problem(`no stamp set "${profile.stampSet}" in stamps.json`);
  const stamps = loadStampSet(render.renderRoot, profile.stampSet);
  if (!stamps.ok)
    return problem(
      `stamps: ${stamps.problems.map((p) => `${p.file}: ${p.message}`).join("; ")}`,
    );

  // Slots: one per job, in order, with the profile's frame count and timing for the state, held
  // to the vocabulary's rule for the state on this cell class.
  const slots: PreparedSlot[] = [];
  for (const record of batch) {
    const slot = record.job.request.slots[0];
    if (
      slot === undefined ||
      slot.state === undefined ||
      slot.direction === undefined
    )
      return problem(`job ${record.job.id} has no sprite slot`);
    const rule = stateRuleFor(
      config.content.vocabulary,
      slot.state,
      spec.value.cell.id,
    );
    if (rule === undefined)
      return problem(
        `${slot.state} is not drawn on the ${spec.value.cell.id} cell`,
      );
    const facing = slot.direction;
    if (
      facing !== "south" &&
      facing !== "east" &&
      facing !== "north" &&
      facing !== "west"
    )
      return problem(
        `direction ${facing} is not a facing the render script knows`,
      );
    const clipSpec = profile.clips[slot.state];
    if (clipSpec === undefined)
      return problem(
        `profile ${profile.id} has no clip for ${slot.state} (it poses ${Object.keys(profile.clips).join(", ")})`,
      );
    const frames = clipSpec.frames;
    if (frames < rule.frames.min || frames > rule.frames.max)
      return problem(
        `profile ${profile.id} renders ${slot.state} at ${frames} frames; the ${spec.value.cell.id} rule allows ${rule.frames.min === rule.frames.max ? rule.frames.max : `${rule.frames.min} to ${rule.frames.max}`}`,
      );
    if (rule.fps !== undefined) {
      const bounds = durationBounds(rule.fps);
      const bad = clipSpec.frameMs.find(
        (ms) => ms < bounds.min || ms > bounds.max,
      );
      if (bad !== undefined)
        return problem(
          `profile ${profile.id} shows a ${slot.state} frame for ${bad} ms; the ${spec.value.cell.id} rule allows ${bounds.min} to ${bounds.max} ms (${rule.fps.min} to ${rule.fps.max} fps)`,
        );
    }
    slots.push({
      record,
      recipe: {
        id: record.job.id,
        state: slot.state,
        facing,
        frames,
        outDir: "",
      },
      clip: `${slot.state}${frames}`,
      seed: record.job.request.seed ?? 0,
      frameMs: clipSpec.frameMs,
    });
  }

  // One request is one revision: the recipe is computed from the inputs as they are now, and a
  // later slot (a restarted batch after an abort) must still match the first slot's. If it does
  // not, the job is refused before any render, so no slot is recorded under a recipe hash that is
  // not the hash of the inputs it was rendered from.
  const revisionKey = first.source.requestId;
  const revision = revisionRecipe({
    profile: profileHash(profile),
    camera: cameraHash(camera),
    palette: { id: palette.id, digest: paletteDigest(palette) },
    pivot: recipeRequest.pivot,
    script: RENDER_SCRIPT_SHA256,
    postStep: {
      version: POST_STEP_VERSION,
      settings: postSettingsFor(profile.shadow.ramp),
    },
    blender: render.pin,
    kit: kitHash(profile.kitFiles),
    stamps: stampSetHash(stampSet),
  });
  const earlier = revisions.get(revisionKey);
  if (earlier !== undefined && earlier.hash !== revision.hash)
    return problem(
      `inputs changed since this request's first slot: the revision recipe was ${earlier.hash} and is now ${revision.hash} (a profile, camera, palette, kit, stamp set or script differs); render the request again`,
    );
  revisions.set(revisionKey, earlier ?? revision);

  const parent = render.tempParent ?? tmpdir();
  mkdirSync(parent, { recursive: true });
  const workDir = mkdtempSync(join(parent, "panthea-render-"));
  const cleanup = () => rmSync(workDir, { recursive: true, force: true });

  // Staging: only the profile's kit files, each hashed against the profile's pin as it is read.
  const stagingRoot = join(workDir, "staging");
  const expected: string[] = [];
  try {
    for (const ref of profile.kitFiles) {
      const bytes = new Uint8Array(
        readFileSync(join(render.renderRoot, "kits", ref.kit, ref.path)),
      );
      const actual = sha256Hex(bytes);
      if (actual !== ref.sha256) {
        cleanup();
        return problem(
          `staging violation: ${ref.kit}/${ref.path} has sha256 ${actual}, the profile pins ${ref.sha256}`,
        );
      }
      const target = join(stagingRoot, ref.kit, ref.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
      expected.push(`${ref.kit}/${ref.path}`);
    }
  } catch (error) {
    cleanup();
    return problem(`staging violation: ${(error as Error).message}`);
  }
  const staged = listFiles(stagingRoot);
  if (JSON.stringify(staged) !== JSON.stringify([...expected].sort())) {
    cleanup();
    return problem(
      `staging violation: the staging directory holds ${staged.length} files, the profile lists ${expected.length}`,
    );
  }

  const slotsRoot = join(workDir, "slots");
  mkdirSync(slotsRoot, { recursive: true });
  const placed = slots.map((s) => ({
    ...s,
    recipe: { ...s.recipe, outDir: join(slotsRoot, s.recipe.id) },
  }));
  const recipe = parseRenderRecipe({
    schemaVersion: 1,
    blender: { version: render.pin.version, buildHash: render.pin.buildHash },
    stagingRoot,
    camera,
    profile,
    palette: {
      id: palette.id,
      digest: paletteDigest(palette),
      ramps: palette.families.flatMap((f) =>
        f.ramps.map((r) => ({ id: r.id, shades: r.shades.map(hex) })),
      ),
    },
    slots: placed.map((s) => s.recipe),
  });
  if (!recipe.ok) {
    cleanup();
    return problem(`the recipe is invalid: ${recipe.path}: ${recipe.message}`);
  }
  const scriptPath = join(workDir, "render.py");
  const recipePath = join(workDir, "recipe.json");
  writeFileSync(scriptPath, RENDER_SCRIPT_TEXT, { mode: 0o600 });
  writeFileSync(recipePath, renderRecipeJson(recipe.value), { mode: 0o600 });

  const usedKits = [...new Set(profile.kitFiles.map((f) => f.kit))].sort();
  return {
    ok: true,
    prepared: {
      workDir,
      scriptPath,
      recipePath,
      recipe: recipe.value,
      revision,
      slots: placed,
      settings: postStepSettings(
        camera,
        recipeRequest.pivot,
        postSettingsFor(profile.shadow.ramp),
      ),
      palette: postPalette,
      stamps: stamps.set,
      paletteId: palette.id,
      paletteDigest: paletteDigest(palette),
      licences: usedKits.map((id) => ({
        subject: id,
        role: "input" as const,
        licence: kitById.get(id)?.licence.spdx ?? "unknown",
      })),
    },
  };
}

// --- Engine ----------------------------------------------------------------------------------------------------

export function createRenderEngine(
  session: StudioSession,
  config: RuntimeConfig,
  render: RenderEngineConfig,
): Engine {
  const clock = render.clock ?? realClock;
  const revisions = new Map<string, RevisionRecipe>();
  let child: OwnedChild | undefined;
  let stopPending: Promise<TeardownResult> | undefined;

  const stop = (): Promise<TeardownResult> => {
    if (stopPending) return stopPending;
    const owned = child;
    if (!owned) return Promise.resolve({ ok: true });
    stopPending = stopGroup(owned, config.deadlines).then((result) => {
      stopPending = undefined;
      if (result.ok && child === owned) child = undefined;
      return result;
    });
    return stopPending;
  };

  async function ready(running: Running): Promise<Ready> {
    if (process.platform === "win32")
      return {
        ok: false,
        kind: "unavailable",
        reason:
          "process-group teardown is only implemented for POSIX platforms",
      };
    if (inside(config.artifactRoot, render.executable))
      return {
        ok: false,
        kind: "unavailable",
        reason: `the Blender executable ${render.executable} is inside the artifact root; it must live outside it`,
      };
    if (render.executable === "")
      return {
        ok: false,
        kind: "unavailable",
        reason:
          "the studio config's render section names no Blender executable",
      };
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(render.executable);
    } catch {
      return {
        ok: false,
        kind: "unavailable",
        reason: `Blender is missing at ${render.executable}`,
      };
    }
    if (!stat.isFile())
      return {
        ok: false,
        kind: "unavailable",
        reason: `${render.executable} is not a regular file`,
      };
    const pin = await matchesPin(
      render.executable,
      render.pin.binarySha256,
      running.controller.signal,
    );
    if (pin.kind === "aborted") return { ok: false, kind: "aborted" };
    if (pin.kind === "mismatch")
      return {
        ok: false,
        kind: "unavailable",
        reason: `Blender at ${render.executable} has sha256 ${pin.actual}, not the pinned ${render.pin.binarySha256} (Blender ${render.pin.version}, build ${render.pin.buildHash})`,
      };
    return { ok: true };
  }

  async function run(
    batch: readonly JobRecord[],
    running: Running,
    track: (jobId: string) => Running,
  ): Promise<readonly Attempt[]> {
    const attempts: Attempt[] = [];
    const failBatch = (error: string): readonly Attempt[] => {
      // The first job is running; the rest of the batch shares the inputs and the failure.
      for (const [index, record] of batch.entries()) {
        const started =
          index === 0 ? { ok: true as const } : session.start(record.job.id);
        const recorded = started.ok
          ? session.fail(record.job.id, error)
          : started;
        if (!recorded.ok) {
          attempts.push(unsettled(recorded));
          continue;
        }
        attempts.push({
          kind: "result",
          result: { jobId: record.job.id, outcome: "failed", error },
        });
      }
      return attempts;
    };

    const made = prepare(session, config, render, batch, revisions);
    if (!made.ok) return failBatch(made.error);
    const prepared = made.prepared;
    const slots = prepared.slots;
    const startupMs = config.deadlines.startupMs;
    const slotMs = config.deadlines.generationMs;
    const pollMs = config.pollMs;

    let cur = running;
    let index = 0;
    let sawFirstLine = false;
    let lastLine = "";
    let progressAt = clock.now();
    let slotStartedAt = progressAt;
    let wake: (() => void) | undefined;
    const poke = () => {
      const waiting = wake;
      wake = undefined;
      waiting?.();
    };
    let carry = "";
    const onStdout = (text: string) => {
      carry += text;
      const lines = carry.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim() === "") continue;
        lastLine = line.trim();
        if (line.startsWith(FIRST_LINE_MARKER)) sawFirstLine = true;
      }
      progressAt = clock.now();
      poke();
    };

    const sleeper = new AbortController();
    try {
      const args = [
        "--background",
        "--factory-startup",
        "--python-exit-code",
        "1",
        "--python",
        prepared.scriptPath,
        "--",
        "--recipe",
        prepared.recipePath,
      ];
      const env = render.env ?? {
        PATH: "/usr/bin:/bin",
        HOME: prepared.workDir,
        TMPDIR: prepared.workDir,
      };
      const launched = await launch(render.executable, args, env, {
        onStdout,
        label: "Blender",
        cwd: prepared.workDir,
      });
      if (!launched.ok) {
        if (launched.kind === "unavailable")
          return [
            { kind: "unavailable", reason: launched.message, jobId: cur.id },
          ];
        return failBatch(launched.message);
      }
      child = launched.child;
      const proc = launched.child;
      proc.proc.on("close", poke);
      const watchAbort = (r: Running) =>
        r.controller.signal.addEventListener("abort", poke, { once: true });
      watchAbort(cur);
      const launchedAt = clock.now();
      progressAt = launchedAt;
      slotStartedAt = launchedAt;

      const slotDirs = (slot: PreparedSlot) => [
        `${slot.recipe.outDir}.partial`,
        slot.recipe.outDir,
      ];
      const filesNow = () => {
        const slot = slots[index];
        if (slot === undefined) return 0;
        return slotDirs(slot).reduce((n, dir) => n + listFiles(dir).length, 0);
      };
      let lastFiles = 0;
      const discard = (slot: PreparedSlot) => {
        for (const dir of slotDirs(slot))
          rmSync(dir, { recursive: true, force: true });
      };
      const failCurrent = (error: string): void => {
        const recorded = session.fail(cur.id, error);
        attempts.push(
          recorded.ok
            ? {
                kind: "result",
                result: { jobId: cur.id, outcome: "failed", error },
              }
            : unsettled(recorded),
        );
      };
      const stopNow = async () => {
        const stopped = await stop();
        if (!stopped.ok)
          attempts.push({ kind: "refused", message: stopped.message });
      };

      for (;;) {
        // 1. Ingest every slot whose sentinel has landed, in order.
        while (index < slots.length) {
          const slot = slots[index] as PreparedSlot;
          if (!existsSync(join(slot.recipe.outDir, SENTINEL_NAME))) break;
          const outcome = ingest(session, render, prepared, slot);
          if (outcome.kind === "failed") {
            failCurrent(outcome.error);
            discard(slot);
            await stopNow();
            return attempts;
          }
          attempts.push(outcome.attempt);
          if (outcome.attempt.kind !== "result") {
            await stopNow();
            return attempts;
          }
          index += 1;
          progressAt = clock.now();
          slotStartedAt = progressAt;
          lastFiles = 0;
          const next = slots[index];
          if (next !== undefined) {
            const started = session.start(next.record.job.id);
            if (!started.ok) {
              attempts.push(unsettled(started));
              await stopNow();
              return attempts;
            }
            cur = track(next.record.job.id);
            watchAbort(cur);
          }
        }
        const all = index >= slots.length;

        // 2. An abort or quit: the in-flight slot is discarded and nothing it wrote is stored.
        if (cur.aborted || cur.controller.signal.aborted) {
          await stopNow();
          const slot = slots[index];
          if (slot !== undefined) discard(slot);
          if (!all)
            attempts.push({
              kind: "result",
              result: { jobId: cur.id, outcome: "aborted" },
            });
          return attempts;
        }

        // 3. The process ended.
        if (proc.closed) {
          if (all) return attempts;
          const slot = slots[index] as PreparedSlot;
          const tail =
            lastLine === "" ? tailOf(proc) : ` Last output: ${lastLine}.`;
          const landedWithoutSentinel = existsSync(slot.recipe.outDir);
          if (proc.signal !== undefined) {
            const status = classifyTermination({
              signal: proc.signal,
              sawFirstLine,
              aborted: false,
            });
            if (status === "unavailable") {
              attempts.push({
                kind: "unavailable",
                reason: `Blender died by ${proc.signal} before the render script's first line; the GPU or the executable is unusable.${tailOf(proc)}`,
                jobId: cur.id,
              });
              return attempts;
            }
            failCurrent(
              `Blender died by ${proc.signal} while rendering slot ${slot.recipe.id}.${tail}`,
            );
            discard(slot);
            return attempts;
          }
          const code = proc.code ?? -1;
          const status = classifyExit(code);
          if (status.ok && status.value === "unavailable") {
            attempts.push({
              kind: "unavailable",
              reason: `Blender exited with code ${code}: ${lastLine || "no output"}`,
              jobId: cur.id,
            });
            return attempts;
          }
          if (status.ok && status.value === "ok") {
            failCurrent(
              landedWithoutSentinel
                ? `Blender exited 0, but slot ${slot.recipe.id} has frames and no ${SENTINEL_NAME}: a torn slot is not ingested.${tail}`
                : `Blender exited 0 without rendering slot ${slot.recipe.id}: no ${SENTINEL_NAME}.${tail}`,
            );
          } else {
            failCurrent(
              `Blender exited with code ${code}${status.ok ? "" : " (not in the exit-code table)"} on slot ${slot.recipe.id}.${tail}`,
            );
          }
          discard(slot);
          return attempts;
        }

        // 4. Deadlines, on the injected clock.
        const now = clock.now();
        if (!sawFirstLine && now - launchedAt > startupMs) {
          await stopNow();
          attempts.push({
            kind: "unavailable",
            reason: `Blender printed no first line within ${startupMs} ms; the script did not start`,
            jobId: cur.id,
          });
          return attempts;
        }
        if (sawFirstLine && !all) {
          const slot = slots[index] as PreparedSlot;
          const files = filesNow();
          if (files !== lastFiles) {
            lastFiles = files;
            progressAt = now;
          }
          if (now - slotStartedAt > slotMs) {
            await stopNow();
            failCurrent(
              `slot ${slot.recipe.id} did not finish within ${slotMs} ms`,
            );
            discard(slot);
            return attempts;
          }
          if (now - progressAt > render.watchdogMs) {
            await stopNow();
            failCurrent(
              `slot ${slot.recipe.id} stalled: no new frame or output for ${render.watchdogMs} ms (${files} files written)`,
            );
            discard(slot);
            return attempts;
          }
        } else if (all && now - progressAt > render.watchdogMs) {
          await stopNow();
          return attempts;
        }

        // 5. Wait for output, an exit, an abort or the next tick.
        const tick = new AbortController();
        await Promise.race([
          new Promise<void>((resolve) => {
            wake = resolve;
          }),
          clock.sleep(pollMs, tick.signal),
        ]);
        tick.abort();
        wake = undefined;
      }
    } finally {
      sleeper.abort();
      await stop();
      rmSync(prepared.workDir, { recursive: true, force: true });
    }
  }

  return {
    provider: RENDER_PROVIDER.id,
    guidance: BLENDER_GUIDANCE(render),
    batchOf(queue) {
      const head = queue[0] as JobRecord;
      const batch: JobRecord[] = [];
      for (const record of queue) {
        if (
          record.job.provider.id !== head.job.provider.id ||
          record.source.requestId !== head.source.requestId
        )
          break;
        batch.push(record);
      }
      return batch;
    },
    ready,
    run,
    live: () => child !== undefined && !child.exited,
    stop,
  };
}

// --- Ingest ----------------------------------------------------------------------------------------------------

type Ingested =
  | { readonly kind: "failed"; readonly error: string }
  | { readonly kind: "done"; readonly attempt: Attempt };

/**
 * Ingests one landed slot, or says why not. The sentinel must parse and match the slot and frame
 * count, the directory must hold exactly the files it lists, and every file must hash to its entry
 * (transport integrity only: frame identity is the decoded pixels).
 */
function ingest(
  session: StudioSession,
  render: RenderEngineConfig,
  prepared: Prepared,
  slot: PreparedSlot,
): Ingested {
  const failed = (error: string): Ingested => ({
    kind: "failed",
    error: `slot ${slot.recipe.id}: ${error}`,
  });
  const dir = slot.recipe.outDir;
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(join(dir, SENTINEL_NAME), "utf8"));
  } catch {
    return failed(`${SENTINEL_NAME} is not valid JSON`);
  }
  const sentinel = parseDoneSentinel(json, {
    slot: slot.recipe.id,
    frames: slot.recipe.frames,
  });
  if (!sentinel.ok)
    return failed(
      `the sentinel does not match the slot: ${sentinel.path}: ${sentinel.message}`,
    );
  const done = sentinel.value;
  if (
    done.blender.version !== render.pin.version ||
    done.blender.buildHash !== render.pin.buildHash
  )
    return failed(
      `the sentinel is from Blender ${done.blender.version} (${done.blender.buildHash}), not the pinned ${render.pin.version} (${render.pin.buildHash})`,
    );

  const expectedNames = RENDER_ROLES.flatMap((role) =>
    done.files[role].map((f) => f.name),
  );
  const found = listFiles(dir).filter((name) => name !== SENTINEL_NAME);
  if (
    found.length !== expectedNames.length ||
    JSON.stringify(found) !== JSON.stringify([...expectedNames].sort())
  )
    return failed(
      `expected ${expectedNames.length} frame files (${slot.recipe.frames} frames x ${RENDER_ROLES.length} passes), found ${found.length}`,
    );

  const bytes = {} as Record<RenderRole, Uint8Array[]>;
  for (const role of RENDER_ROLES) {
    bytes[role] = [];
    for (const file of done.files[role]) {
      const data = new Uint8Array(readFileSync(join(dir, file.name)));
      if (sha256Hex(data) !== file.sha256)
        return failed(
          `${file.name} does not match the sentinel's sha256: a torn frame`,
        );
      bytes[role].push(data);
    }
  }
  const decoded = {} as Record<
    RenderRole,
    import("../conformance").RgbaImage[]
  >;
  for (const role of RENDER_ROLES) {
    decoded[role] = [];
    for (const [i, data] of bytes[role].entries()) {
      const image = decodePng(data);
      if (!image.ok)
        return failed(
          `${done.files[role][i]?.name} does not decode: ${image.code}: ${image.message}`,
        );
      decoded[role].push(image.image);
    }
  }

  const frames: RawFrame[] = Array.from({ length: done.frames }, (_, i) => ({
    name: `${slot.recipe.id}_${String(i).padStart(2, "0")}`,
    facing: slot.recipe.facing,
    colour: decoded.colour[i],
    id: decoded.id[i],
    depth: decoded.depth[i],
    locators: stampLocatorsFrom(done.locators[i] as never),
  }));
  const post = postProcessSlot({
    slot: slot.recipe.id,
    settings: prepared.settings,
    palette: prepared.palette,
    stamps: prepared.stamps,
    frames,
  });
  if (!post.ok)
    return failed(`the post step refused the frames: ${post.message}`);

  let manifestHash: Sha256;
  const outputs: ImageOutput[] = [];
  const rawHashes = {} as Record<RenderRole, Sha256[]>;
  const cellFrames: unknown[] = [];
  try {
    for (const role of RENDER_ROLES)
      rawHashes[role] = bytes[role].map((data) => session.store.putBlob(data));
    for (const [i, cell] of post.cells.entries()) {
      const png = encodeRgbaPng(
        cell.image.rgba,
        cell.image.width,
        cell.image.height,
      );
      const hash = session.store.putBlob(png);
      outputs.push({
        medium: "image",
        hash,
        width: cell.image.width,
        height: cell.image.height,
      });
      cellFrames.push({
        frame: i,
        sourceFrame: done.sourceFrames[i],
        raw: {
          colour: rawHashes.colour[i],
          id: rawHashes.id[i],
          depth: rawHashes.depth[i],
        },
        cell: hash,
        cellPixels: cellPixelHash(cell.image),
        extentPx: done.extentPx[i],
        locators: frames[i]?.locators ?? {},
      });
    }
    const slotHash = slotRecipeHash(prepared.revision.hash, {
      state: slot.recipe.state,
      clip: slot.clip,
      facing: slot.recipe.facing,
      seed: slot.seed,
    });
    manifestHash = session.store.putBlob(
      new TextEncoder().encode(
        canonicalJson({
          schemaVersion: 1,
          jobId: slot.recipe.id,
          slotKey: slot.record.source.slotKey,
          slot: {
            state: slot.recipe.state,
            clip: slot.clip,
            facing: slot.recipe.facing,
            frames: slot.recipe.frames,
            frameMs: slot.frameMs,
            seed: slot.seed,
            loop:
              prepared.recipe.profile.clips[slot.recipe.state]?.loop ?? false,
          },
          revisionRecipeHash: prepared.revision.hash,
          revision: prepared.revision.fields,
          slotRecipeHash: slotHash,
          postStepVersion: post.version,
          frames: cellFrames,
        }),
      ),
    );
    const engine = parseEngineFacts(
      {
        runtime: {
          name: "blender",
          version: `${render.pin.version}+${render.pin.buildHash}`,
        },
        runtimeBinarySha256: render.pin.binarySha256,
        model: null,
        loras: [],
        encoder: null,
        vae: null,
        licences: prepared.licences,
        settings: {
          revisionRecipeHash: prepared.revision.hash,
          slotRecipeHash: slotHash,
          manifest: manifestHash,
          state: slot.recipe.state,
          clip: slot.clip,
          facing: slot.recipe.facing,
          frames: slot.recipe.frames,
          postStepVersion: post.version,
          palette: prepared.paletteId,
          paletteDigest: prepared.paletteDigest,
        },
      },
      "engine",
    );
    if (!engine.ok)
      return failed(`the engine facts cannot be recorded: ${engine.message}`);
    const settled = session.succeed(slot.record.job.id, outputs, engine.value);
    if (!settled.ok) return { kind: "done", attempt: unsettled(settled) };
  } catch (error) {
    return failed(`could not store the frames: ${(error as Error).message}`);
  }
  return {
    kind: "done",
    attempt: {
      kind: "result",
      result: {
        jobId: slot.recipe.id,
        outcome: "rendered",
        outputs,
        manifest: manifestHash,
      },
    },
  };
}

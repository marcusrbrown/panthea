// The render engine through the real runtime, against a scripted fake Blender that obeys the shared
// script contract (test/render/fake-blender.ts). Time is a manual clock and memory pressure a
// reader the test sets; the only waits are for real child processes to reach a state.

import { afterEach, describe, expect, test } from "bun:test";
import {
  type LaunchBehavior,
  readLog as readBlenderLog,
} from "../../test/render/fake-blender";
import {
  alive,
  blobCount,
  closeRigs,
  corruptKitFile,
  DEADLINES,
  drain,
  eventually,
  jobsById,
  openRig,
  plantUnlistedBuffer,
  RENDER_ROOT,
  type Rig,
  scratchLeft,
  statusOf,
  submitRender,
  submitSd,
  WATCHDOG_MS,
} from "../../test/render/rig";
import { readLog as readSdLog } from "../studio/_test-runtime";
import { decodePng } from "../studio/png/decode";
import { RENDER_SCRIPT_SHA256 } from "./engine";
import { loadRenderInputs } from "./load";
import { cellPixelHash, POST_STEP_VERSION } from "./post";
import { slotRecipeHash } from "./recipe";

afterEach(closeRigs);

const T = 90_000;
const events = (rig: Rig, name: string) =>
  readBlenderLog(rig.fakeDir).filter((e) => e.event === name);
const startPids = (rig: Rig) => events(rig, "start").map((e) => e.pid);
const west = (state: string) => ({ state, direction: "west" });
const outcomes = (results: readonly { jobId: string; outcome: string }[]) =>
  results.map((r) => `${r.jobId}:${r.outcome}`);

describe("a render job through the runtime", () => {
  test(
    "stores raw frames, cells, a role manifest and the recipe hashes; one process serves the request's jobs",
    async () => {
      const rig = await openRig({ launches: [{}] });
      const ids = submitRender(rig, "zeus-retro", [west("idle"), west("walk")]);
      const result = await drain(rig);

      expect(result.stopped).toBe("empty");
      expect(outcomes(result.results)).toEqual(
        ids.map((id) => `${id}:rendered`),
      );
      expect(startPids(rig)).toHaveLength(1);
      expect(scratchLeft(rig)).toEqual([]);

      const jobs = jobsById(rig);
      const manifests: Record<string, unknown>[] = [];
      for (const id of ids) {
        const record = jobs[id];
        if (record?.job.status !== "succeeded")
          throw new Error(`${id} did not succeed`);
        expect(record.job.outputs).toHaveLength(16);
        expect(record.engine?.model).toBeNull();
        expect(record.engine?.runtime).toEqual({
          name: "blender",
          version: "5.2.2+d13f752e3b9c",
        });
        const hash = record.engine?.settings.manifest as string;
        const bytes = rig.session.store.readBlob(hash as never);
        if (bytes === undefined) throw new Error("manifest blob missing");
        const manifest = JSON.parse(new TextDecoder().decode(bytes)) as Record<
          string,
          unknown
        >;
        manifests.push(manifest);
        const frames = manifest.frames as {
          raw: Record<string, string>;
          cell: string;
          cellPixels: string;
        }[];
        expect(frames).toHaveLength(16);
        for (const [index, frame] of frames.entries()) {
          for (const role of ["colour", "id", "depth"]) {
            const raw = rig.session.store.readBlob(frame.raw[role] as never);
            expect(raw).toBeDefined();
            expect(decodePng(raw as Uint8Array).ok).toBe(true);
          }
          const cell = decodePng(
            rig.session.store.readBlob(frame.cell as never) as Uint8Array,
          );
          if (!cell.ok) throw new Error("cell does not decode");
          expect([cell.image.width, cell.image.height]).toEqual([112, 96]);
          expect(cellPixelHash(cell.image)).toBe(frame.cellPixels as never);
          expect(record.job.outputs[index]?.hash).toBe(frame.cell as never);
        }
        const settings = record.engine?.settings;
        expect(manifest.revisionRecipeHash).toBe(
          settings?.revisionRecipeHash as never,
        );
        expect(manifest.slotRecipeHash).toBe(settings?.slotRecipeHash as never);
      }

      // One revision recipe hash per request, a slot recipe hash per slot.
      const [idle, walk] = manifests as [
        Record<string, unknown>,
        Record<string, unknown>,
      ];
      expect(idle.revisionRecipeHash).toBe(walk.revisionRecipeHash as never);
      expect(idle.slotRecipeHash).not.toBe(walk.slotRecipeHash as never);
      expect(idle.slotRecipeHash).toBe(
        slotRecipeHash(idle.revisionRecipeHash as never, {
          state: "idle",
          clip: "idle16",
          facing: "west",
          seed: 0,
        }),
      );
      const fields = idle.revision as {
        script: string;
        postStep: { version: number; depthBits: number };
        blender: { version: string; buildHash: string };
        palette: { id: string };
        pivot: { x: number; y: number };
      };
      expect(fields.script).toBe(RENDER_SCRIPT_SHA256);
      expect(fields.postStep).toMatchObject({
        version: POST_STEP_VERSION,
        depthBits: 8,
      });
      expect(fields.blender).toMatchObject({
        version: "5.2.2",
        buildHash: "d13f752e3b9c",
      });
      expect(fields.palette.id).toBe("greek-retro");
      expect(fields.pivot).toEqual({ x: 56, y: 78 });
    },
    T,
  );

  test(
    "spawns argv-only with an allow-listed env, stages only the profile's kit files, and writes the embedded script to scratch",
    async () => {
      const rig = await openRig({ launches: [{}] });
      submitRender(rig, "zeus-retro");
      await drain(rig);

      const start = events(rig, "start")[0];
      // The shell wrapper adds PWD and SHLVL itself; nothing of the parent's env gets through.
      const given = ((start?.envKeys ?? []) as string[]).filter(
        (k) => !["PWD", "SHLVL", "_", "OLDPWD"].includes(k),
      );
      expect(given).toEqual(["HOME", "PATH", "TMPDIR"]);
      const check = events(rig, "argv-check")[0];
      expect(check).toMatchObject({
        scriptReadable: true,
        background: true,
        factoryStartup: true,
        pythonExitCode: "1",
      });
      expect(((check?.afterDashes ?? []) as string[])[0]).toBe("--recipe");

      const inputs = loadRenderInputs(RENDER_ROOT);
      const profile = inputs.profiles.find((p) => p.id === "zeus");
      const staged = events(rig, "staging")[0]?.files as string[];
      expect(staged).toEqual(
        (profile?.kitFiles ?? []).map((f) => `${f.kit}/${f.path}`).sort(),
      );
    },
    T,
  );
});

describe("one engine at a time", () => {
  test(
    "a queue of sd, render, sd runs in order, with sd-server stopped before Blender and restarted after",
    async () => {
      const rig = await openRig({ launches: [{}], sd: {} });
      const [sdA] = submitSd(rig, "sd-a");
      const [render] = submitRender(rig, "zeus-retro");
      const [sdB] = submitSd(rig, "sd-b");
      const result = await drain(rig);

      expect(outcomes(result.results)).toEqual([
        `${sdA}:succeeded`,
        `${render}:rendered`,
        `${sdB}:succeeded`,
      ]);
      const sdStarts = readSdLog(rig.sdDir).filter((e) => e.event === "start");
      expect(sdStarts).toHaveLength(2);
      const sdTerm = readSdLog(rig.sdDir).find((e) => e.event === "term");
      const blenderStart = events(rig, "start")[0];
      const lastBlender = readBlenderLog(rig.fakeDir).at(-1);
      expect(sdTerm).toBeDefined();
      expect(sdTerm?.pid).toBe(sdStarts[0]?.pid as number);
      expect(sdTerm?.at as number).toBeLessThanOrEqual(
        blenderStart?.at as number,
      );
      expect(lastBlender?.at as number).toBeLessThanOrEqual(
        sdStarts[1]?.at as number,
      );
    },
    T,
  );
});

describe("an unavailable Blender marks only render jobs", () => {
  async function renderThenSd(rig: Rig): Promise<{
    render: string;
    sd: string;
    result: Awaited<ReturnType<typeof drain>>;
  }> {
    const [render] = submitRender(rig, "zeus-retro");
    const [sd] = submitSd(rig, "sd-a");
    const result = await drain(rig);
    return { render: render as string, sd: sd as string, result };
  }

  const cases: [
    string,
    LaunchBehavior[],
    Partial<Parameters<typeof openRig>[0]>,
    RegExp,
  ][] = [
    [
      "a missing executable",
      [{}],
      { executable: "/nonexistent/Blender" },
      /missing/,
    ],
    [
      "a wrong version",
      [{ installed: { version: "5.2.1", buildHash: "000000000000" } }],
      {},
      /exited with code 11/,
    ],
    [
      "a sha256 mismatch",
      [{}],
      { pin: { binarySha256: "0".repeat(64) } },
      /sha256/,
    ],
    ["no GPU context", [{ noGpu: true }], {}, /exited with code 10/],
    [
      "death by signal before the first line",
      [{ dieBeforeFirstLine: "SIGSEGV" }],
      {},
      /died by SIGSEGV before/,
    ],
  ];
  for (const [name, launches, options, reason] of cases) {
    test(
      `${name}: render jobs are unavailable with guidance, sd jobs still run`,
      async () => {
        const rig = await openRig({ launches, sd: {}, ...options });
        const { render, sd, result } = await renderThenSd(rig);

        expect(statusOf(rig, render)).toBe("unavailable");
        const record = jobsById(rig)[render]?.job;
        if (record?.status !== "unavailable")
          throw new Error("not unavailable");
        expect(record.reason).toMatch(reason);
        expect(record.staging).toMatch(/Blender 5\.2\.2/);
        expect(statusOf(rig, sd)).toBe("succeeded");
        expect(result.stopped).toBe("unavailable");
        expect(scratchLeft(rig)).toEqual([]);
      },
      T,
    );
  }

  test(
    "with no render engine configured, render jobs are unavailable with guidance and sd jobs still run",
    async () => {
      const rig = await openRig({ sd: {}, withoutRender: true });
      const { render, sd, result } = await renderThenSd(rig);
      const record = jobsById(rig)[render]?.job;
      if (record?.status !== "unavailable") throw new Error("not unavailable");
      expect(record.reason).toMatch(
        /no engine is configured for provider blender-eevee/,
      );
      expect(record.staging).toMatch(/render section/);
      expect(statusOf(rig, sd)).toBe("succeeded");
      expect(result.stopped).toBe("unavailable");
    },
    T,
  );

  test(
    "a Blender that prints nothing within the start-up deadline is unavailable, on the injected clock",
    async () => {
      const rig = await openRig({
        launches: [{ holdBeforeFirstLine: true }],
        sd: {},
      });
      const [render] = submitRender(rig, "zeus-retro");
      const [sd] = submitSd(rig, "sd-a");
      const drained = rig.runtime.drain();
      await eventually(
        () => events(rig, "holding-before-first-line").length === 1,
      );
      await eventually(() => rig.clock.pending > 0);
      await rig.clock.advance(DEADLINES.startupMs + 100);
      const result = await drained;
      if (!result.ok) throw new Error(result.message);
      expect(statusOf(rig, render as string)).toBe("unavailable");
      expect(statusOf(rig, sd as string)).toBe("succeeded");
      expect(alive(startPids(rig)[0] as number)).toBe(false);
    },
    T,
  );
});

describe("failures are failed, never unavailable", () => {
  async function failedWith(
    launch: LaunchBehavior,
    pattern: RegExp,
    options: Parameters<typeof openRig>[0] = {},
  ) {
    const rig = await openRig({ launches: [launch], ...options });
    const [id] = submitRender(rig, "zeus-retro");
    const result = await drain(rig);
    const job = jobsById(rig)[id as string]?.job;
    if (job?.status !== "failed")
      throw new Error(`expected failed, got ${job?.status}`);
    expect(job.error).toMatch(pattern);
    expect(result.results.map((r) => r.outcome)).toEqual(["failed"]);
    expect(scratchLeft(rig)).toEqual([]);
    return rig;
  }

  test(
    "exit 0 with a short frame set",
    async () => {
      const rig = await failedWith(
        { defaultMode: "short" },
        /expects?|expected 16 frames|frames/i,
      );
      expect(blobCount(rig)).toBe(0);
    },
    T,
  );

  test(
    "exit 0 with a file the sentinel lists missing",
    async () => {
      const rig = await failedWith(
        { defaultMode: "missing-file" },
        /expected 48 frame files/,
      );
      expect(blobCount(rig)).toBe(0);
    },
    T,
  );

  test(
    "the input-error exit code",
    async () => {
      await failedWith({ inputError: true }, /exited with code 12/);
    },
    T,
  );

  test(
    "a script error exit code",
    async () => {
      await failedWith({ scriptError: true }, /exited with code 1\b/);
    },
    T,
  );

  test(
    "an exit code outside the table",
    async () => {
      await failedWith({ defaultMode: "torn", oddExit: 99 }, /code 99|torn/);
    },
    T,
  );

  test(
    "death by signal after the first line",
    async () => {
      await failedWith(
        { defaultMode: "crash" },
        /died by SIGSEGV while rendering/,
      );
    },
    T,
  );

  test(
    "a stall past the watchdog stops the group and fails the job",
    async () => {
      const rig = await openRig({ launches: [{ defaultMode: "stall" }] });
      const [id] = submitRender(rig, "zeus-retro");
      const drained = rig.runtime.drain();
      await eventually(() => events(rig, "stalled").length === 1);
      await eventually(() => rig.clock.pending > 0);
      await rig.clock.advance(WATCHDOG_MS + 100);
      const result = await drained;
      if (!result.ok) throw new Error(result.message);
      const job = jobsById(rig)[id as string]?.job;
      if (job?.status !== "failed")
        throw new Error(`expected failed, got ${job?.status}`);
      expect(job.error).toMatch(/stalled/);
      expect(alive(startPids(rig)[0] as number)).toBe(false);
      expect(blobCount(rig)).toBe(0);
      expect(scratchLeft(rig)).toEqual([]);
    },
    T,
  );

  test(
    "a slot past its deadline fails even while the watchdog is quiet",
    async () => {
      const rig = await openRig({
        launches: [{ defaultMode: "stall" }],
        watchdogMs: DEADLINES.generationMs * 10,
      });
      const [id] = submitRender(rig, "zeus-retro");
      const drained = rig.runtime.drain();
      await eventually(() => events(rig, "stalled").length === 1);
      await eventually(() => rig.clock.pending > 0);
      await rig.clock.advance(DEADLINES.generationMs + 100);
      const result = await drained;
      if (!result.ok) throw new Error(result.message);
      const job = jobsById(rig)[id as string]?.job;
      if (job?.status !== "failed")
        throw new Error(`expected failed, got ${job?.status}`);
      expect(job.error).toMatch(/did not finish within 5000 ms/);
      expect(alive(startPids(rig)[0] as number)).toBe(false);
      expect(scratchLeft(rig)).toEqual([]);
    },
    T,
  );

  test(
    "a planted unlisted buffer fails the job before launch; the same recipe without it runs",
    async () => {
      // Positive control: the same copy of the render root, nothing planted.
      const control = await openRig({
        launches: [{}],
        mutateRenderRoot: () => {},
      });
      const [controlId] = submitRender(control, "zeus-retro");
      const ran = await drain(control);
      expect(outcomes(ran.results)).toEqual([`${controlId}:rendered`]);

      let planted = "";
      const rig = await openRig({
        launches: [{}],
        mutateRenderRoot: (root) => {
          planted = plantUnlistedBuffer(root);
        },
      });
      const [id] = submitRender(rig, "zeus-retro");
      const result = await drain(rig);
      const job = jobsById(rig)[id as string]?.job;
      if (job?.status !== "failed")
        throw new Error(`expected failed, got ${job?.status}`);
      expect(job.error).toMatch(/kit closure violation/);
      expect(job.error).toContain("Planted_Unlisted.bin");
      expect(planted).toContain("Hair_Beard.gltf");
      expect(result.results.map((r) => r.outcome)).toEqual(["failed"]);
      expect(events(rig, "start")).toHaveLength(0);
      expect(scratchLeft(rig)).toEqual([]);
    },
    T,
  );

  test(
    "a kit file whose bytes changed after it was pinned is a staging violation",
    async () => {
      const rig = await openRig({
        launches: [{}],
        mutateRenderRoot: corruptKitFile,
      });
      const [id] = submitRender(rig, "zeus-retro");
      await drain(rig);
      const job = jobsById(rig)[id as string]?.job;
      if (job?.status !== "failed")
        throw new Error(`expected failed, got ${job?.status}`);
      expect(job.error).toMatch(/staging violation: .*Hair_Beard\.bin/);
      expect(events(rig, "start")).toHaveLength(0);
      expect(scratchLeft(rig)).toEqual([]);
    },
    T,
  );
});

describe("a torn frame is never ingested", () => {
  test(
    "frames in place and no sentinel",
    async () => {
      const rig = await openRig({ launches: [{ defaultMode: "torn" }] });
      const [id] = submitRender(rig, "zeus-retro");
      const result = await drain(rig);
      const job = jobsById(rig)[id as string]?.job;
      if (job?.status !== "failed")
        throw new Error(`expected failed, got ${job?.status}`);
      expect(job.error).toMatch(/no done\.json|torn/);
      expect(result.results.map((r) => r.outcome)).toEqual(["failed"]);
      expect(blobCount(rig)).toBe(0);
    },
    T,
  );

  test(
    "a frame whose bytes do not match the sentinel's sha256",
    async () => {
      const rig = await openRig({ launches: [{ defaultMode: "bad-sha" }] });
      const [id] = submitRender(rig, "zeus-retro");
      await drain(rig);
      const job = jobsById(rig)[id as string]?.job;
      if (job?.status !== "failed")
        throw new Error(`expected failed, got ${job?.status}`);
      expect(job.error).toMatch(/sha256|torn frame/);
      expect(blobCount(rig)).toBe(0);
    },
    T,
  );
});

describe("abort and quit", () => {
  test(
    "abort mid-batch discards the in-flight slot, keeps finished slots succeeded, and the drain continues once the engine restarts",
    async () => {
      const rig = await openRig({ launches: [{ holdAfterSlots: 1 }, {}] });
      const [first, second, third] = submitRender(rig, "zeus-retro", [
        west("idle"),
        west("walk"),
        west("seated"),
      ]) as [string, string, string];
      const drained = rig.runtime.drain();
      await eventually(
        () =>
          statusOf(rig, first) === "succeeded" &&
          statusOf(rig, second) === "running",
      );
      const aborted = await rig.runtime.abort(second);
      expect(aborted.ok).toBe(true);
      const result = await drained;
      if (!result.ok) throw new Error(result.message);

      expect(outcomes(result.results)).toEqual([
        `${first}:rendered`,
        `${second}:aborted`,
        `${third}:rendered`,
      ]);
      expect(statusOf(rig, first)).toBe("succeeded");
      expect(statusOf(rig, second)).toBe("cancelled");
      expect(statusOf(rig, third)).toBe("succeeded");
      expect(startPids(rig)).toHaveLength(2);
      expect(alive(startPids(rig)[0] as number)).toBe(false);
      expect(scratchLeft(rig)).toEqual([]);
    },
    T,
  );

  test(
    "abort during Blender's start-up stops it cleanly and the next job runs on a fresh process",
    async () => {
      const rig = await openRig({
        launches: [{ holdBeforeFirstLine: true }, {}],
      });
      const [first, second] = submitRender(rig, "zeus-retro", [
        west("idle"),
        west("walk"),
      ]) as [string, string];
      const drained = rig.runtime.drain();
      await eventually(
        () => events(rig, "holding-before-first-line").length === 1,
      );
      expect((await rig.runtime.abort(first)).ok).toBe(true);
      const result = await drained;
      if (!result.ok) throw new Error(result.message);
      expect(outcomes(result.results)).toEqual([
        `${first}:aborted`,
        `${second}:rendered`,
      ]);
      expect(statusOf(rig, first)).toBe("cancelled");
      expect(startPids(rig)).toHaveLength(2);
      expect(alive(startPids(rig)[0] as number)).toBe(false);
    },
    T,
  );

  test(
    "abort during hashing stops before any process starts and the next job runs",
    async () => {
      const rig = await openRig({
        launches: [{}],
        padBytes: 256 * 1024 * 1024,
      });
      const [first, second] = submitRender(rig, "zeus-retro", [
        west("idle"),
        west("walk"),
      ]) as [string, string];
      const drained = rig.runtime.drain();
      await eventually(() => statusOf(rig, first) === "running");
      expect((await rig.runtime.abort(first)).ok).toBe(true);
      const result = await drained;
      if (!result.ok) throw new Error(result.message);
      expect(outcomes(result.results)).toEqual([
        `${first}:aborted`,
        `${second}:rendered`,
      ]);
      expect(startPids(rig)).toHaveLength(1);
    },
    T,
  );

  test(
    "quit during hashing leaves no process and ends inside the stop bound",
    async () => {
      const rig = await openRig({
        launches: [{}],
        padBytes: 256 * 1024 * 1024,
      });
      const [first] = submitRender(rig, "zeus-retro") as [string];
      const drained = rig.runtime.drain();
      await eventually(() => statusOf(rig, first) === "running");
      const began = Date.now();
      const closed = await rig.runtime.shutdown();
      expect(closed.ok).toBe(true);
      expect(Date.now() - began).toBeLessThan(
        DEADLINES.termGraceMs + DEADLINES.killMs,
      );
      await drained;
      expect(events(rig, "start")).toHaveLength(0);
      expect(statusOf(rig, first)).toBe("cancelled");
    },
    T,
  );

  test(
    "quit during Blender's start-up leaves no surviving process group inside the bound",
    async () => {
      const rig = await openRig({ launches: [{ holdBeforeFirstLine: true }] });
      const [first] = submitRender(rig, "zeus-retro") as [string];
      const drained = rig.runtime.drain();
      await eventually(
        () => events(rig, "holding-before-first-line").length === 1,
      );
      const pid = startPids(rig)[0] as number;
      const began = Date.now();
      const closed = await rig.runtime.shutdown();
      expect(closed.ok).toBe(true);
      expect(Date.now() - began).toBeLessThan(
        DEADLINES.termGraceMs + DEADLINES.killMs,
      );
      await drained;
      expect(alive(pid)).toBe(false);
      expect(statusOf(rig, first)).toBe("cancelled");
    },
    T,
  );

  test(
    "quit during a render stops the process group before the drain is awaited",
    async () => {
      const rig = await openRig({ launches: [{ holdAfterSlots: 0 }] });
      const [first] = submitRender(rig, "zeus-retro") as [string];
      const drained = rig.runtime.drain();
      await eventually(() => events(rig, "holding-after-slots").length === 1);
      const pid = startPids(rig)[0] as number;
      const closed = await rig.runtime.shutdown();
      expect(closed.ok).toBe(true);
      await drained;
      expect(alive(pid)).toBe(false);
      expect(statusOf(rig, first)).toBe("cancelled");
      expect(scratchLeft(rig)).toEqual([]);
    },
    T,
  );

  test(
    "stop sends SIGTERM, then SIGKILL after the grace, and never SIGINT",
    async () => {
      const rig = await openRig({
        launches: [{ holdBeforeFirstLine: true, ignoreTerm: true }],
      });
      const [first] = submitRender(rig, "zeus-retro") as [string];
      const drained = rig.runtime.drain();
      await eventually(
        () => events(rig, "holding-before-first-line").length === 1,
      );
      const pid = startPids(rig)[0] as number;
      const began = Date.now();
      expect((await rig.runtime.abort(first)).ok).toBe(true);
      await drained;

      expect(events(rig, "term").length).toBeGreaterThanOrEqual(1);
      expect(events(rig, "int")).toHaveLength(0);
      // The process ignored TERM, so only KILL after the grace could end it.
      expect(alive(pid)).toBe(false);
      expect(Date.now() - began).toBeGreaterThanOrEqual(
        DEADLINES.termGraceMs - 50,
      );
    },
    T,
  );
});

describe("memory pressure", () => {
  test(
    "critical pressure launches nothing and leaves the job queued with guidance; the drain proceeds once it drops",
    async () => {
      const rig = await openRig({ launches: [{}] });
      const [id] = submitRender(rig, "zeus-retro") as [string];
      rig.pressure.level = 4;
      const deferred = await drain(rig);

      expect(deferred.stopped).toBe("deferred");
      expect(deferred.guidance).toMatch(/memory pressure is critical/i);
      expect(deferred.results).toEqual([]);
      expect(statusOf(rig, id)).toBe("queued");
      expect(events(rig, "start")).toHaveLength(0);

      rig.pressure.level = 2;
      const resumed = await drain(rig);
      expect(outcomes(resumed.results)).toEqual([`${id}:rendered`]);
      expect(events(rig, "start")).toHaveLength(1);
    },
    T,
  );

  test(
    "critical pressure also keeps sd-server from launching",
    async () => {
      const rig = await openRig({ launches: [{}], sd: {} });
      const [id] = submitSd(rig, "sd-a") as [string];
      rig.pressure.level = 4;
      const deferred = await drain(rig);
      expect(deferred.stopped).toBe("deferred");
      expect(statusOf(rig, id)).toBe("queued");
      expect(
        readSdLog(rig.sdDir).filter((e) => e.event === "start"),
      ).toHaveLength(0);
      rig.pressure.level = 1;
      expect(outcomes((await drain(rig)).results)).toEqual([`${id}:succeeded`]);
    },
    T,
  );
});

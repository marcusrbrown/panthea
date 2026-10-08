import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { sha256Hex } from "../hash";
import {
  loadContent,
  nativeFigure,
  noiseImage,
  PROVISIONAL_TEST_PARAMS,
  pngOf,
  removeTempRoots,
  succeedWithImage,
  tempRoot,
  upscale,
  withHiddenRgb,
} from "./_test-fixtures";
import {
  grayscalePng,
  readLog,
  stageFixtureRuntime,
  withTransparencyChunk,
} from "./_test-runtime";
import type { ConformParams } from "./candidates";
import { decodePng } from "./png/decode";
import { newRequestRecord } from "./request";
import { openRuntime } from "./runtime";
import { openStudioSession, type StudioSession } from "./session";
import { readStudioStatus } from "./store";

const artifactDirs: string[] = [];
afterEach(() => {
  for (const dir of artifactDirs.splice(0))
    for (const event of readLog(dir))
      if (event.event === "start" || event.event === "grand")
        try {
          process.kill(event.pid, 0);
          process.kill(event.pid, "SIGKILL");
          throw new Error(`fixture process ${event.pid} outlived its test`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
  removeTempRoots();
});

const content = loadContent();
const figure = nativeFigure(content);
const big = upscale(figure, 8);
const refuseDraw = () => {
  throw new Error("the seed supplier must not be called");
};

function open(root: string): StudioSession {
  const opened = openStudioSession(root);
  if (opened.kind === "busy") throw new Error("busy");
  return opened.session;
}

/** Queues one sprite job for `id` and returns its job id. */
function queue(session: StudioSession, id: string, slots = 1): string[] {
  const built = newRequestRecord(
    content,
    {
      id,
      subject: "zeus",
      kind: "sprite",
      slots: [
        { state: "idle", direction: "south" },
        { state: "idle", direction: "north" },
      ].slice(0, slots),
      batch: 1,
      seed: 1,
    },
    refuseDraw,
  );
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  const result = session.submitRequest(built.value.record);
  if (!result.ok) throw new Error(result.message);
  return [...result.jobIds];
}

function succeeded(
  root: string,
  id: string,
  png: Uint8Array,
  size?: { w: number; h: number },
) {
  const session = open(root);
  const [jobId] = queue(session, id);
  const hash = succeedWithImage(session, jobId as string, png, size);
  return { session, jobId: jobId as string, hash };
}

const blobNames = (root: string) =>
  existsSync(join(root, "blobs"))
    ? readdirSync(join(root, "blobs")).sort()
    : [];
const candidateFiles = (root: string) =>
  existsSync(join(root, "candidates"))
    ? readdirSync(join(root, "candidates"))
    : [];

function done(result: ReturnType<StudioSession["conform"]>) {
  if (!result.ok) throw new Error(`${result.reason}: ${result.message}`);
  if (result.candidate.result.status !== "done") throw new Error("not done");
  return { candidate: result.candidate, result: result.candidate.result };
}

describe("original bytes are never rewritten", () => {
  const rawA = pngOf(withHiddenRgb(big, 0));
  const rawB = pngOf(withHiddenRgb(big, 7));

  test("hidden RGB under alpha 0 changes the raw hash and the decoded hash but nothing conformed", () => {
    expect(sha256Hex(rawA)).not.toBe(sha256Hex(rawB));
    const root = tempRoot();
    const a = succeeded(root, "fig-a", rawA);
    a.session.close();
    const b = succeeded(root, "fig-b", rawB);

    const first = done(
      b.session.conform("fig-a-0000", content, PROVISIONAL_TEST_PARAMS),
    );
    const second = done(
      b.session.conform("fig-b-0000", content, PROVISIONAL_TEST_PARAMS),
    );

    expect(first.candidate.input.hash).toBe(sha256Hex(rawA));
    expect(second.candidate.input.hash).toBe(sha256Hex(rawB));
    expect(first.candidate.input.decodedSha256).not.toBe(
      second.candidate.input.decodedSha256,
    );
    expect(first.result.imageHash).toBe(second.result.imageHash);
    expect(first.result.proposalHash).toBe(second.result.proposalHash);
    expect(first.result.report).toEqual(second.result.report);
    expect(first.result.metrics).toEqual(second.result.metrics);
    expect(first.result.metrics.grid).toEqual(second.result.metrics.grid);
    expect(first.result.diff).toEqual(second.result.diff);
    b.session.close();
  });

  test("the original blob is immutable and its decoded hash is exact", () => {
    const root = tempRoot();
    const { session, jobId, hash } = succeeded(root, "fig-a", rawA);
    const before = readFileSync(join(root, "blobs", `${hash}.png`));

    const { candidate } = done(
      session.conform(jobId, content, PROVISIONAL_TEST_PARAMS),
    );

    expect(
      Buffer.compare(readFileSync(join(root, "blobs", `${hash}.png`)), before),
    ).toBe(0);
    expect(sha256Hex(new Uint8Array(before))).toBe(hash);
    const decoded = decodePng(rawA);
    if (!decoded.ok) throw new Error("fixture does not decode");
    expect(candidate.input).toEqual({
      hash,
      width: 512,
      height: 640,
      decodedSha256: sha256Hex(decoded.image.rgba),
    });
    session.close();
  });
});

describe("the conformed candidate", () => {
  test("is native 64x80, uses the explicit options and the palette family, and records its source", () => {
    const root = tempRoot();
    const { session, jobId } = succeeded(
      root,
      "fig-a",
      pngOf(withHiddenRgb(big, 3)),
    );

    const { candidate, result } = done(
      session.conform(jobId, content, PROVISIONAL_TEST_PARAMS),
    );

    expect(candidate).toMatchObject({
      schemaVersion: 1,
      id: jobId,
      source: { requestId: "fig-a", slotKey: "idle/south", ordinal: 0 },
      subject: "zeus",
      kind: "sprite",
      params: { ...PROVISIONAL_TEST_PARAMS, scale: null },
      target: { cell: { id: "god", w: 64, h: 80 }, pivot: { x: 32, y: 80 } },
    });
    const family = content.palette.families.find((f) => f.id === "olympus");
    const hexes = [
      ...new Set(
        (family?.ramps ?? []).flatMap((r) =>
          r.shades.map(
            (c) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`,
          ),
        ),
      ),
    ];
    expect(candidate.target.palette).toEqual({
      id: "greek-master",
      family: "olympus",
      digest:
        content.palette.approval.status === "approved"
          ? content.palette.approval.digest
          : null,
      colours: hexes,
    });
    expect(result.metrics.resize).toEqual({
      from: { w: 512, h: 640 },
      to: { w: 64, h: 80 },
      factor: 8,
      detected: true,
      supplied: false,
    });
    expect(result.report.status).toBe("pass");

    const image = decodePng(
      session.store.readBlob(result.imageHash) ?? new Uint8Array(),
    );
    if (!image.ok) throw new Error("image blob does not decode");
    expect([image.image.width, image.image.height]).toEqual([64, 80]);
    for (let at = 0; at < figure.rgba.length; at += 4) {
      expect(image.image.rgba[at + 3]).toBe(figure.rgba[at + 3] as number);
      if (figure.rgba[at + 3] === 255)
        expect(Array.from(image.image.rgba.slice(at, at + 3))).toEqual(
          Array.from(figure.rgba.slice(at, at + 3)),
        );
    }
    const proposal = decodePng(
      session.store.readBlob(result.proposalHash) ?? new Uint8Array(),
    );
    expect(
      proposal.ok && [proposal.image.width, proposal.image.height],
    ).toEqual([64, 80]);
    session.close();
  });

  test("equivalent inputs in two roots give byte-identical records and blobs", () => {
    const png = pngOf(withHiddenRgb(big, 1));
    const run = () => {
      const root = tempRoot();
      const { session, jobId } = succeeded(root, "fig-a", png);
      done(session.conform(jobId, content, PROVISIONAL_TEST_PARAMS));
      session.close();
      return root;
    };
    const one = run();
    const two = run();

    expect(
      readFileSync(join(one, "candidates", "fig-a-0000.json"), "utf8"),
    ).toBe(readFileSync(join(two, "candidates", "fig-a-0000.json"), "utf8"));
    expect(blobNames(one)).toEqual(blobNames(two));
    expect(blobNames(one)).toHaveLength(2);
    for (const name of blobNames(one))
      expect(
        Buffer.compare(
          readFileSync(join(one, "blobs", name)),
          readFileSync(join(two, "blobs", name)),
        ),
      ).toBe(0);
  });

  test("a re-conform replaces the candidate and leaves a pick's snapshot as it was", () => {
    const root = tempRoot();
    const { session, jobId } = succeeded(root, "fig-a", pngOf(big));
    session.openWorkingSet("zeus-idle", "fig-a", content);
    done(session.conform(jobId, content, PROVISIONAL_TEST_PARAMS));
    expect(session.pick("zeus-idle", jobId)).toEqual({ ok: true });
    const picked = readFileSync(
      join(root, "working-sets", "zeus-idle.json"),
      "utf8",
    );

    const again = done(
      session.conform(jobId, content, {
        ...PROVISIONAL_TEST_PARAMS,
        alphaCutoff: 100,
      }),
    );

    expect(again.candidate.params.alphaCutoff).toBe(100);
    expect(readStudioStatus(root).candidates).toHaveLength(1);
    expect(readStudioStatus(root).candidates[0]?.params.alphaCutoff).toBe(100);
    expect(
      readFileSync(join(root, "working-sets", "zeus-idle.json"), "utf8"),
    ).toBe(picked);
    expect(
      readStudioStatus(root).workingSets[0]?.picks["idle/south"]?.params
        .alphaCutoff,
    ).toBe(128);
    session.close();
  });
});

describe("an ambiguous grid", () => {
  test("stores a needs-scale candidate with no image blobs, cannot be picked, and conforms once a scale is supplied", () => {
    const root = tempRoot();
    const { session, jobId } = succeeded(
      root,
      "noise-a",
      pngOf(noiseImage(512, 640)),
    );
    session.openWorkingSet("zeus-idle", "noise-a", content);

    const first = session.conform(jobId, content, PROVISIONAL_TEST_PARAMS);

    expect(first.ok && first.candidate.result.status).toBe("needs-scale");
    expect(
      first.ok &&
        first.candidate.result.status === "needs-scale" &&
        first.candidate.result.grid.scale,
    ).toBeGreaterThanOrEqual(1);
    expect(blobNames(root)).toHaveLength(1);
    expect(session.pick("zeus-idle", jobId)).toMatchObject({
      ok: false,
      reason: "wrong-state",
    });

    const explicit = done(
      session.conform(jobId, content, { ...PROVISIONAL_TEST_PARAMS, scale: 8 }),
    );

    expect(explicit.candidate.params.scale).toBe(8);
    expect(explicit.result.metrics.grid.source).toBe("supplied");
    expect(blobNames(root).length).toBeGreaterThanOrEqual(2);
    session.close();
  });
});

describe("refusals create nothing", () => {
  const corruptCrc = (png: Uint8Array) => {
    const out = Uint8Array.from(png);
    const idat = Buffer.from(out).indexOf("IDAT");
    out[idat + 6] = (out[idat + 6] as number) ^ 0xff;
    return out;
  };
  const refusals: [
    string,
    Uint8Array,
    { w: number; h: number } | undefined,
    string,
  ][] = [
    ["a grayscale PNG", grayscalePng(512, 640), undefined, "unsupported-png"],
    [
      "a PNG with a tRNS chunk",
      withTransparencyChunk(pngOf(big)),
      undefined,
      "unsupported-png",
    ],
    ["a truncated PNG", pngOf(big).slice(0, 1000), undefined, "corrupt-png"],
    ["a PNG with a bad CRC", corruptCrc(pngOf(big)), undefined, "corrupt-png"],
    [
      "bytes that are not a PNG",
      new TextEncoder().encode("not a png"),
      undefined,
      "corrupt-png",
    ],
    [
      "a PNG whose size differs from the job output",
      pngOf(big),
      { w: 513, h: 640 },
      "corrupt-png",
    ],
    [
      "a PNG that is not the spec's generated size",
      pngOf(figure),
      { w: 64, h: 80 },
      "corrupt-png",
    ],
  ];

  for (const [name, png, size, reason] of refusals) {
    test(`${name} is refused as ${reason}`, () => {
      const root = tempRoot();
      const { session, jobId } = succeeded(root, "fig-a", png, size);
      const blobs = blobNames(root);

      const result = session.conform(jobId, content, PROVISIONAL_TEST_PARAMS);

      expect(result).toMatchObject({ ok: false, reason });
      expect(candidateFiles(root)).toEqual([]);
      expect(blobNames(root)).toEqual(blobs);
      session.close();
    });
  }

  test("a missing or altered original blob is corrupt, not conformed", () => {
    const root = tempRoot();
    const { session, jobId, hash } = succeeded(root, "fig-a", pngOf(big));
    const file = join(root, "blobs", `${hash}.png`);
    writeFileSync(file, pngOf(withHiddenRgb(big, 9)));

    expect(
      session.conform(jobId, content, PROVISIONAL_TEST_PARAMS),
    ).toMatchObject({ ok: false, reason: "corrupt-png" });

    rmSync(file);
    expect(
      session.conform(jobId, content, PROVISIONAL_TEST_PARAMS),
    ).toMatchObject({ ok: false, reason: "corrupt-png" });
    expect(candidateFiles(root)).toEqual([]);
    session.close();
  });

  const bad: [string, ConformParams][] = [
    ["a zero alpha cutoff", { ...PROVISIONAL_TEST_PARAMS, alphaCutoff: 0 }],
    [
      "a confidence of zero",
      {
        ...PROVISIONAL_TEST_PARAMS,
        grid: { ...PROVISIONAL_TEST_PARAMS.grid, minConfidence: 0 },
      },
    ],
    [
      "a key colour out of range",
      {
        ...PROVISIONAL_TEST_PARAMS,
        background: { type: "key", rgb: [0, 0, 300], tolerance: 1 },
      },
    ],
    ["a zero scale", { ...PROVISIONAL_TEST_PARAMS, scale: 0 }],
  ];
  for (const [name, params] of bad) {
    test(`${name} is invalid-params and writes nothing`, () => {
      const root = tempRoot();
      const { session, jobId } = succeeded(root, "fig-a", pngOf(big));
      const blobs = blobNames(root);

      expect(session.conform(jobId, content, params)).toMatchObject({
        ok: false,
        reason: "invalid-params",
      });

      expect(candidateFiles(root)).toEqual([]);
      expect(blobNames(root)).toEqual(blobs);
      session.close();
    });
  }

  test("an unknown job, a bad id and a job that did not succeed are refused", () => {
    const root = tempRoot();
    const session = open(root);
    const [queued, running, failed, removed] = queue(
      session,
      "fig-a",
      2,
    ).concat(queue(session, "fig-b", 2)) as [string, string, string, string];
    session.start(running);
    session.start(failed);
    session.fail(failed, "boom");
    session.remove(removed);

    expect(
      session.conform("ghost", content, PROVISIONAL_TEST_PARAMS),
    ).toMatchObject({ ok: false, reason: "not-found" });
    expect(
      session.conform("../escape", content, PROVISIONAL_TEST_PARAMS),
    ).toMatchObject({ ok: false, reason: "not-found" });
    for (const id of [queued, running, failed, removed])
      expect(
        session.conform(id, content, PROVISIONAL_TEST_PARAMS),
      ).toMatchObject({ ok: false, reason: "wrong-state" });

    expect(candidateFiles(root)).toEqual([]);
    session.close();
  });

  test("a candidate that cannot be written is refused as write-failed", () => {
    const root = tempRoot();
    const { session, jobId } = succeeded(root, "fig-a", pngOf(big));
    mkdirSync(join(root, "candidates"));
    chmodSync(join(root, "candidates"), 0o500);
    try {
      expect(
        session.conform(jobId, content, PROVISIONAL_TEST_PARAMS),
      ).toMatchObject({ ok: false, reason: "write-failed" });
    } finally {
      chmodSync(join(root, "candidates"), 0o700);
    }
    expect(candidateFiles(root)).toEqual([]);
    session.close();
  });
});

describe("a runtime-drained image", () => {
  test("the stored fixture PNG conforms and traces back to its job output hash", async () => {
    const png = pngOf(withHiddenRgb(big, 4));
    const base = dirname(tempRoot());
    const dir = join(base, "artifacts");
    mkdirSync(dir, { recursive: true });
    artifactDirs.push(dir);
    writeFileSync(join(dir, "figure.png"), png);
    const profile = stageFixtureRuntime(dir, {
      image: join(dir, "figure.png"),
    });
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as { port: number };
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const session = open(join(base, "studio"));
    const runtime = openRuntime(session, {
      artifactRoot: dir,
      port,
      content,
      pollMs: 15,
      profile,
      deadlines: {
        httpMs: 2000,
        startupMs: 5000,
        generationMs: 5000,
        termGraceMs: 400,
        killMs: 3000,
      },
    });
    try {
      const [jobId] = queue(session, "fig-a");
      const drained = await runtime.drain();
      expect(drained.ok && drained.results.map((r) => r.outcome)).toEqual([
        "succeeded",
      ]);
      const first = drained.ok ? drained.results[0] : undefined;
      if (first?.outcome !== "succeeded") throw new Error("not succeeded");
      expect(first.output.hash).toBe(sha256Hex(png));

      const { candidate } = done(
        session.conform(jobId as string, content, PROVISIONAL_TEST_PARAMS),
      );

      expect(candidate.input.hash).toBe(first.output.hash);
      expect(candidate.input.decodedSha256).toBe(sha256Hex(first.image.rgba));
      expect(
        Buffer.compare(
          readFileSync(
            join(base, "studio", "blobs", `${first.output.hash}.png`),
          ),
          png,
        ),
      ).toBe(0);
    } finally {
      await runtime.shutdown();
    }
  });
});

describe("extra keys on the caller's options", () => {
  const withExtras = (background: unknown): ConformParams =>
    ({
      background,
      alphaCutoff: 128,
      grid: {
        edgeTolerance: 8,
        minConfidence: 0.6,
        minEdges: 20,
        comment: "grid note",
      },
      scale: 8,
      note: "top-level note",
    }) as unknown as ConformParams;

  const cases: [string, unknown, ConformParams["background"]][] = [
    ["an alpha background", { type: "alpha", note: "x" }, { type: "alpha" }],
    [
      "a key background",
      { type: "key", rgb: [0, 0, 0], tolerance: 2, note: "x" },
      { type: "key", rgb: [0, 0, 0], tolerance: 2 },
    ],
  ];

  for (const [name, background, effective] of cases) {
    test(`${name} with extra keys is recorded as only its effective fields and stays readable`, () => {
      const root = tempRoot();
      const { session, jobId } = succeeded(root, "fig-a", pngOf(big));
      session.openWorkingSet("zeus-idle", "fig-a", content);
      const params = withExtras(background);
      const callerCopy = structuredClone(params);

      const result = session.conform(jobId, content, params);

      expect(result.ok).toBe(true);
      expect(params).toEqual(callerCopy);
      if (!result.ok) return;
      expect(result.candidate.params).toEqual({
        background: effective,
        alphaCutoff: 128,
        grid: { edgeTolerance: 8, minConfidence: 0.6, minEdges: 20 },
        scale: 8,
      });
      expect(Object.keys(result.candidate.params).sort()).toEqual([
        "alphaCutoff",
        "background",
        "grid",
        "scale",
      ]);
      expect(Object.keys(result.candidate.params.grid).sort()).toEqual([
        "edgeTolerance",
        "minConfidence",
        "minEdges",
      ]);
      const text = readFileSync(
        join(root, "candidates", `${jobId}.json`),
        "utf8",
      );
      expect(text).not.toContain("note");
      expect(text).not.toContain("comment");

      const status = readStudioStatus(root);
      expect(status.invalid).toEqual([]);
      expect(status.candidates.map((c) => c.id)).toEqual([jobId]);
      expect(status.candidates[0]).toEqual(result.candidate);
      expect(session.pick("zeus-idle", jobId)).toEqual({ ok: true });
      session.close();
    });
  }

  test("a key colour is copied, not aliased, so the caller's later edits cannot change the record", () => {
    const root = tempRoot();
    const { session, jobId } = succeeded(root, "fig-a", pngOf(big));
    const rgb: [number, number, number] = [0, 0, 0];
    const params: ConformParams = {
      ...PROVISIONAL_TEST_PARAMS,
      background: { type: "key", rgb, tolerance: 2 },
    };

    const result = session.conform(jobId, content, params);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    rgb[0] = 255;

    expect(result.candidate.params.background).toEqual({
      type: "key",
      rgb: [0, 0, 0],
      tolerance: 2,
    });
    session.close();
  });

  test("invalid options with extra keys are still refused, not recorded", () => {
    const root = tempRoot();
    const { session, jobId } = succeeded(root, "fig-a", pngOf(big));
    const blobs = blobNames(root);
    const bad = [
      withExtras({ type: "key", rgb: [0, 0, 0, 9], tolerance: 2, note: "x" }),
      withExtras({ type: "plaid", note: "x" }),
      {
        ...withExtras({ type: "alpha" }),
        grid: "not an object",
      } as unknown as ConformParams,
      {
        ...withExtras({ type: "alpha" }),
        background: undefined,
      } as unknown as ConformParams,
    ];

    for (const params of bad)
      expect(session.conform(jobId, content, params)).toMatchObject({
        ok: false,
        reason: "invalid-params",
      });

    expect(candidateFiles(root)).toEqual([]);
    expect(blobNames(root)).toEqual(blobs);
    session.close();
  });
});

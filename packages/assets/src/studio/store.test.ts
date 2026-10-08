import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "../hash";
import {
  authoredFrames,
  doneCandidate,
  engineFacts,
  jobSource,
  keyframe,
  needsScaleCandidate,
  PROVISIONAL_TEST_PARAMS,
  queuedJob,
  removeTempRoots,
  request,
  runningJob,
  studioAsset,
  succeededJob,
  TEST_PALETTE,
  tempRoot,
  workingSet,
} from "./_test-fixtures";
import type { EditRecord } from "./export-import";
import { readStudioBlob, readStudioStatus } from "./index";
import { openStore } from "./store";

afterEach(removeTempRoots);

const repoRoot = join(import.meta.dir, "..", "..", "..", "..");

describe("authoring root", () => {
  test(".studio is gitignored", () => {
    const result = Bun.spawnSync(
      ["git", "check-ignore", "-q", ".studio/jobs/a.json"],
      { cwd: repoRoot },
    );
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("status of a root that does not exist is empty and creates nothing", () => {
    const root = tempRoot();
    expect(readStudioStatus(root)).toEqual({
      session: undefined,
      requests: [],
      jobs: [],
      candidates: [],
      workingSets: [],
      edits: [],
      assets: [],
      commands: [],
      invalid: [],
    });
    expect(existsSync(root)).toBe(false);
  });
});

describe("blob reads without the writer", () => {
  test("readStudioBlob returns stored bytes by hash and nothing for a hash that is not stored", () => {
    const root = tempRoot();
    const bytes = new Uint8Array([7, 8, 9]);
    const hash = openStore(root).putBlob(bytes);
    expect(readStudioBlob(root, hash)).toEqual(bytes);
    expect(
      readStudioBlob(root, sha256Hex(new Uint8Array([1]))),
    ).toBeUndefined();
    expect(readStudioBlob(tempRoot(), hash)).toBeUndefined();
  });
});

describe("records", () => {
  test("every record kind reads back as written", () => {
    const store = openStore(tempRoot());
    const session = {
      schemaVersion: 1,
      id: "s-1",
      pid: 42,
      startedAt: "2026-10-05T00:00:00.000Z",
    } as const;
    const requestRecord = {
      schemaVersion: 1,
      id: "r1",
      request,
      nextOrdinal: 3,
    } as const;
    const jobRecord = {
      schemaVersion: 1,
      source: jobSource("r1", 2),
      job: succeededJob("job-a"),
      engine: engineFacts(),
    } as const;
    const candidate = doneCandidate("job-a", { ordinal: 2 });
    const stuck = needsScaleCandidate("job-b", { ordinal: 3 });
    const set = workingSet("w1", {
      picks: { "idle/south": keyframe(candidate) },
    });
    const command = {
      schemaVersion: 1,
      seq: 1,
      type: "enqueue",
      jobId: "job-a",
      at: "2026-10-05T00:00:00.000Z",
    } as const;

    store.putSession(session);
    store.putRequest(requestRecord);
    store.putJob(jobRecord);
    store.putCandidate(candidate);
    store.putCandidate(stuck);
    store.putWorkingSet(set);
    store.putCommand(command);

    expect(store.status()).toEqual({
      session,
      requests: [requestRecord],
      jobs: [jobRecord],
      candidates: [candidate, stuck],
      workingSets: [set],
      edits: [],
      assets: [],
      commands: [command],
      invalid: [],
    });
  });

  test("a malformed record of each kind is reported by file; valid neighbours still read", () => {
    const root = tempRoot();
    const store = openStore(root);
    store.putRequest({ schemaVersion: 1, id: "good", request, nextOrdinal: 0 });
    store.putJob({
      schemaVersion: 1,
      source: jobSource("good"),
      job: queuedJob("job-a"),
    });
    store.putCandidate(doneCandidate("job-a", { requestId: "good" }));
    store.putWorkingSet(workingSet("good", { sheetRequestId: "good" }));
    store.putCommand({
      schemaVersion: 1,
      seq: 1,
      type: "enqueue",
      jobId: "job-a",
      at: "t",
    });
    writeFileSync(
      join(root, "requests", "bad.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "bad",
        request: { subject: "zeus" },
      }),
    );
    writeFileSync(join(root, "jobs", "bad.json"), "{");
    writeFileSync(
      join(root, "jobs", "no-source.json"),
      JSON.stringify({ schemaVersion: 1, job: queuedJob("no-source") }),
    );
    writeFileSync(
      join(root, "jobs", "bad-ordinal.json"),
      JSON.stringify({
        schemaVersion: 1,
        source: { ...jobSource("good"), ordinal: -1 },
        job: queuedJob("bad-ordinal"),
      }),
    );
    writeFileSync(
      join(root, "requests", "bad-ordinal.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "bad-ordinal",
        request,
        nextOrdinal: -1,
      }),
    );
    writeFileSync(
      join(root, "candidates", "bad.json"),
      JSON.stringify({ schemaVersion: 1, id: "bad" }),
    );
    writeFileSync(
      join(root, "working-sets", "bad.json"),
      JSON.stringify({ ...workingSet("bad"), status: "weird" }),
    );
    writeFileSync(
      join(root, "commands", "00000002.json"),
      JSON.stringify({
        schemaVersion: 1,
        seq: 2,
        type: "explode",
        jobId: "job-a",
        at: "t",
      }),
    );
    writeFileSync(join(root, "session.json"), "garbage");

    const status = store.status();

    expect(status.invalid.map((p) => p.file).sort()).toEqual(
      [
        "commands/00000002.json",
        "jobs/bad-ordinal.json",
        "jobs/bad.json",
        "jobs/no-source.json",
        "requests/bad-ordinal.json",
        "requests/bad.json",
        "session.json",
      ]
        .concat(["candidates/bad.json", "working-sets/bad.json"])
        .sort(),
    );
    expect(status.invalid.every((p) => p.message.length > 0)).toBe(true);
    expect(status.session).toBeUndefined();
    expect(status.requests.map((r) => r.id)).toEqual(["good"]);
    expect(status.jobs.map((r) => r.job.id)).toEqual(["job-a"]);
    expect(status.candidates.map((r) => r.id)).toEqual(["job-a"]);
    expect(status.workingSets.map((r) => r.id)).toEqual(["good"]);
    expect(status.commands.map((r) => r.seq)).toEqual([1]);
    expect(readFileSync(join(root, "jobs", "bad.json"), "utf8")).toBe("{");
  });

  test("temp files from an interrupted write are neither listed nor reported", () => {
    const root = tempRoot();
    const store = openStore(root);
    store.putJob({
      schemaVersion: 1,
      source: jobSource("r1"),
      job: queuedJob("job-a"),
    });
    writeFileSync(join(root, "jobs", "job-b.json.123.abc.tmp"), '{"half":');

    const status = store.status();

    expect(status.jobs.map((r) => r.job.id)).toEqual(["job-a"]);
    expect(status.invalid).toEqual([]);
  });

  test("a failed write leaves no temp file behind", () => {
    const root = tempRoot();
    const store = openStore(root);
    mkdirSync(join(root, "jobs", "job-a.json"), { recursive: true });

    expect(() =>
      store.putJob({
        schemaVersion: 1,
        source: jobSource("r1"),
        job: queuedJob("job-a"),
      }),
    ).toThrow();

    expect(readdirSync(join(root, "jobs"))).toEqual(["job-a.json"]);
  });

  test("a rewrite replaces the whole record", () => {
    const root = tempRoot();
    const store = openStore(root);
    store.putJob({
      schemaVersion: 1,
      source: jobSource("r1"),
      job: queuedJob("job-a"),
    });
    store.putJob({
      schemaVersion: 1,
      source: jobSource("r1"),
      job: succeededJob("job-a"),
      engine: engineFacts(),
    });

    expect(store.status().jobs.map((r) => r.job.status)).toEqual(["succeeded"]);
    expect(readdirSync(join(root, "jobs"))).toEqual(["job-a.json"]);
  });
});

describe("blobs", () => {
  test("bytes are stored once under their SHA-256 and read back unchanged", () => {
    const root = tempRoot();
    const store = openStore(root);
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

    const hash = store.putBlob(bytes);
    expect(hash).toBe(sha256Hex(bytes));
    expect(store.putBlob(bytes.slice())).toBe(hash);

    expect(readdirSync(join(root, "blobs"))).toEqual([`${hash}.png`]);
    expect(store.readBlob(hash)).toEqual(bytes);
    expect(store.putBlob(new Uint8Array([9]))).not.toBe(hash);
    expect(store.readBlob("0".repeat(64) as typeof hash)).toBeUndefined();
  });
});

// biome-ignore lint/suspicious/noExplicitAny: the tests edit parsed JSON in place
type Json = Record<string, any>;
const clone = <T>(value: T): Json => JSON.parse(JSON.stringify(value));

describe("candidate and working-set records are strict", () => {
  const candidateMutations: [string, (c: Json) => void][] = [
    [
      "an unknown key",
      (c) => {
        c.extra = 1;
      },
    ],
    [
      "schema version 2",
      (c) => {
        c.schemaVersion = 2;
      },
    ],
    [
      "a kind that is not sprite or portrait",
      (c) => {
        c.kind = "tile";
      },
    ],
    [
      "a non-hex input hash",
      (c) => {
        c.input.hash = "xyz";
      },
    ],
    [
      "a non-hex decoded hash",
      (c) => {
        c.input.decodedSha256 = "xyz";
      },
    ],
    [
      "a zero input width",
      (c) => {
        c.input.width = 0;
      },
    ],
    [
      "an empty slot key",
      (c) => {
        c.source.slotKey = "";
      },
    ],
    [
      "a negative ordinal",
      (c) => {
        c.source.ordinal = -1;
      },
    ],
    [
      "an unknown params key",
      (c) => {
        c.params.extra = 1;
      },
    ],
    [
      "a zero alpha cutoff",
      (c) => {
        c.params.alphaCutoff = 0;
      },
    ],
    [
      "a missing scale",
      (c) => {
        delete c.params.scale;
      },
    ],
    [
      "a zero scale",
      (c) => {
        c.params.scale = 0;
      },
    ],
    [
      "a key background with a bad colour",
      (c) => {
        c.params.background = { type: "key", rgb: [0, 0, 256], tolerance: 1 };
      },
    ],
    [
      "a grid confidence above 1",
      (c) => {
        c.params.grid.minConfidence = 2;
      },
    ],
    [
      "a palette colour that is not #rrggbb",
      (c) => {
        c.target.palette.colours[0] = "#12345";
      },
    ],
    [
      "an uppercase palette colour",
      (c) => {
        c.target.palette.colours[0] = "#ABCDEF";
      },
    ],
    [
      "a bad palette digest",
      (c) => {
        c.target.palette.digest = "nope";
      },
    ],
    [
      "a missing pivot",
      (c) => {
        delete c.target.pivot;
      },
    ],
    [
      "a done result without a proposal hash",
      (c) => {
        delete c.result.proposalHash;
      },
    ],
    [
      "a done result with a grid",
      (c) => {
        c.result.grid = {};
      },
    ],
    [
      "a report whose status disagrees with its checks",
      (c) => {
        c.result.report.status = "pass";
        c.result.report.checks[0].status = "fail";
      },
    ],
    [
      "a negative pixel count",
      (c) => {
        c.result.metrics.pixelsChanged = -1;
      },
    ],
    [
      "an unknown metrics key",
      (c) => {
        c.result.metrics.extra = 1;
      },
    ],
    [
      "a fractional blended count",
      (c) => {
        c.result.metrics.blendedBlocks = 0.5;
      },
    ],
    [
      "a grid source that is unknown",
      (c) => {
        c.result.metrics.grid.source = "guessed";
      },
    ],
    [
      "a colour map entry with a bad hex",
      (c) => {
        c.result.metrics.colourMap[0].from = "#xyz";
      },
    ],
    [
      "a diff pixel with a bad rgba",
      (c) => {
        c.result.diff[0].after = "#526471";
      },
    ],
    [
      "a diff pixel at a negative position",
      (c) => {
        c.result.diff[0].x = -1;
      },
    ],
  ];

  test("every malformed candidate is reported by file and the valid one still reads", () => {
    const root = tempRoot();
    const store = openStore(root);
    store.putCandidate(doneCandidate("good"));
    candidateMutations.forEach(([, mutate], index) => {
      const bad = clone(doneCandidate(`bad-${index}`));
      mutate(bad);
      mkdirSync(join(root, "candidates"), { recursive: true });
      writeFileSync(
        join(root, "candidates", `bad-${index}.json`),
        JSON.stringify(bad),
      );
    });
    const stuck = clone(needsScaleCandidate("stuck"));
    stuck.result.imageHash = sha256Hex(new Uint8Array([1]));
    writeFileSync(
      join(root, "candidates", "stuck.json"),
      JSON.stringify(stuck),
    );

    const status = store.status();

    expect(status.candidates.map((c) => c.id)).toEqual(["good"]);
    expect(status.invalid.map((p) => p.file).sort()).toEqual(
      [
        ...candidateMutations.map((_, i) => `candidates/bad-${i}.json`),
        "candidates/stuck.json",
      ].sort(),
    );
  });

  const candidate = doneCandidate("job-a");
  const frame = keyframe(candidate);
  const portrait = (picked: string[]) => {
    const required = ["neutral", "pleased", "angry"];
    const picks = Object.fromEntries(picked.map((k) => [k, frame]));
    return workingSet("w", {
      kind: "portrait",
      required,
      picks,
      status: picked.length === required.length ? "complete" : "open",
    });
  };
  const setMutations: [string, (w: Json) => void][] = [
    [
      "an unknown key",
      (w) => {
        w.extra = 1;
      },
    ],
    [
      "a kind that is not sprite or portrait",
      (w) => {
        w.kind = "tile";
      },
    ],
    [
      "a non-slug id",
      (w) => {
        w.id = "Not A Slug";
      },
    ],
    [
      "no required slots",
      (w) => {
        w.required = [];
      },
    ],
    [
      "a duplicate required slot",
      (w) => {
        w.required = ["idle/south", "idle/south"];
      },
    ],
    [
      "a status that is not open or complete",
      (w) => {
        w.status = "weird";
      },
    ],
    [
      "a sprite marked complete",
      (w) => {
        w.picks = { "idle/south": frame, "idle/north": frame };
        w.status = "complete";
      },
    ],
    [
      "a pick for a slot that is not required",
      (w) => {
        w.picks = { "idle/west": frame };
      },
    ],
    [
      "an unknown keyframe key",
      (w) => {
        w.picks = { "idle/south": { ...frame, extra: 1 } };
      },
    ],
    [
      "a keyframe with a bad hash",
      (w) => {
        w.picks = { "idle/south": { ...frame, imageHash: "x" } };
      },
    ],
    [
      "a keyframe with a malformed report",
      (w) => {
        w.picks = { "idle/south": { ...frame, report: { status: "pass" } } };
      },
    ],
  ];

  test("every malformed working set is reported, including a status that disagrees with its picks", () => {
    const root = tempRoot();
    const store = openStore(root);
    store.putWorkingSet(workingSet("good"));
    store.putWorkingSet(portrait(["neutral", "pleased", "angry"]));
    mkdirSync(join(root, "working-sets"), { recursive: true });
    setMutations.forEach(([, mutate], index) => {
      const bad = clone(workingSet("x"));
      mutate(bad);
      writeFileSync(
        join(root, "working-sets", `bad-${index}.json`),
        JSON.stringify(bad),
      );
    });
    const stale = clone(portrait(["neutral"]));
    stale.status = "complete";
    writeFileSync(
      join(root, "working-sets", "stale-complete.json"),
      JSON.stringify(stale),
    );
    const early = clone(portrait(["neutral", "pleased", "angry"]));
    early.status = "open";
    writeFileSync(
      join(root, "working-sets", "stale-open.json"),
      JSON.stringify(early),
    );

    const status = store.status();

    expect(status.workingSets.map((w) => w.id).sort()).toEqual(["good", "w"]);
    expect(status.invalid.map((p) => p.file).sort()).toEqual(
      [
        ...setMutations.map((_, i) => `working-sets/bad-${i}.json`),
        "working-sets/stale-complete.json",
        "working-sets/stale-open.json",
      ].sort(),
    );
  });
});

describe("working sets with authored frames", () => {
  const slots = ["idle/south", "idle/north"];
  const complete = () =>
    workingSet("w", {
      frames: {
        "idle/south": authoredFrames("e1", 4),
        "idle/north": authoredFrames("e1", 4),
      },
      status: "complete",
    });
  const faces = (extra: Record<string, unknown> = {}) =>
    ({
      ...workingSet("p", {
        kind: "portrait",
        required: ["neutral", "pleased"],
      }),
      ...extra,
    }) as Json;

  test("limits, authored frames, their basis and hand edits read back as written", () => {
    const root = tempRoot();
    const store = openStore(root);
    const set = workingSet("w", {
      picks: { "idle/south": keyframe(doneCandidate("job-a")) },
      frames: {
        "idle/south": authoredFrames("e1", 4, {
          pivot: { x: 32, y: 80 },
          basis: {
            kind: "frames",
            editId: "e0",
            sheetHash: sha256Hex(new Uint8Array([7])),
          },
        }),
      },
    });
    store.putWorkingSet(set);
    store.putWorkingSet(complete());

    const status = store.status();

    expect(status.invalid).toEqual([]);
    expect(status.workingSets.find((w) => w.id === "w")?.status).toBe(
      "complete",
    );
    expect(store.readWorkingSet("w")).toEqual({
      kind: "found",
      value: complete(),
    });
  });

  const mutations: [string, (w: Json) => void, string?][] = [
    [
      "a missing limits record",
      (w) => {
        delete w.limits;
      },
    ],
    [
      "limits for a slot that is not required",
      (w) => {
        w.limits["idle/west"] = { min: 1, max: 1 };
      },
    ],
    [
      "a required slot without limits",
      (w) => {
        delete w.limits["idle/north"];
      },
    ],
    [
      "a limit whose minimum is above its maximum",
      (w) => {
        w.limits["idle/south"] = { min: 5, max: 4 };
      },
    ],
    [
      "a limit with a zero minimum",
      (w) => {
        w.limits["idle/south"] = { min: 0, max: 4 };
      },
    ],
    [
      "a limit with an unknown key",
      (w) => {
        w.limits["idle/south"].extra = 1;
      },
    ],
    [
      "authored frames for a slot that is not required",
      (w) => {
        w.frames["idle/west"] = authoredFrames("e1", 4);
      },
    ],
    [
      "fewer authored frames than the minimum",
      (w) => {
        w.frames["idle/south"] = authoredFrames("e1", 3);
      },
    ],
    [
      "more authored frames than the maximum",
      (w) => {
        w.frames["idle/south"] = authoredFrames("e1", 5);
      },
    ],
    [
      "a frame hash that is not a sha256",
      (w) => {
        w.frames["idle/south"] = {
          ...authoredFrames("e1", 4),
          frames: [
            { hash: "x", durationMs: 100 },
            ...authoredFrames("e1", 3).frames,
          ],
        };
      },
    ],
    [
      "a zero duration",
      (w) => {
        w.frames["idle/south"] = { ...authoredFrames("e1", 4) };
        w.frames["idle/south"].frames[0].durationMs = 0;
      },
    ],
    [
      "a fractional duration",
      (w) => {
        w.frames["idle/south"] = { ...authoredFrames("e1", 4) };
        w.frames["idle/south"].frames[0].durationMs = 100.5;
      },
    ],
    [
      "a pivot below zero",
      (w) => {
        w.frames["idle/south"] = {
          ...authoredFrames("e1", 4),
          pivot: { x: -1, y: 0 },
        };
      },
    ],
    [
      "an unknown authored-frames key",
      (w) => {
        w.frames["idle/south"] = { ...authoredFrames("e1", 4), extra: 1 };
      },
    ],
    [
      "a basis of an unknown kind",
      (w) => {
        w.frames["idle/south"] = {
          ...authoredFrames("e1", 4),
          basis: { kind: "magic" },
        };
      },
    ],
    [
      "a keyframe basis with a bad hash",
      (w) => {
        w.frames["idle/south"] = {
          ...authoredFrames("e1", 4),
          basis: { kind: "keyframe", candidateId: "job-a", imageHash: "x" },
        };
      },
    ],
    [
      "a frames basis with an unknown key",
      (w) => {
        w.frames["idle/south"] = {
          ...authoredFrames("e1", 4),
          basis: {
            kind: "frames",
            editId: "e0",
            sheetHash: sha256Hex(new Uint8Array([1])),
            extra: 1,
          },
        };
      },
    ],
    [
      "hand edits that are not an array",
      (w) => {
        w.frames["idle/south"] = { ...authoredFrames("e1", 4), handEdits: "x" };
      },
    ],
    [
      "a hand edit with an unknown key",
      (w) => {
        w.frames["idle/south"] = {
          ...authoredFrames("e1", 4),
          handEdits: [{ description: "d", extra: 1 }],
        };
      },
    ],
    [
      "a status of open when every slot has its frames",
      (w) => {
        w.frames = {
          "idle/south": authoredFrames("e1", 4),
          "idle/north": authoredFrames("e1", 4),
        };
        w.status = "open";
      },
    ],
    [
      "a status of complete with one slot short of frames",
      (w) => {
        w.frames = { "idle/south": authoredFrames("e1", 4) };
        w.status = "complete";
      },
    ],
    [
      "a sprite completed by picks alone",
      (w) => {
        w.picks = {
          "idle/south": keyframe(doneCandidate("a")),
          "idle/north": keyframe(doneCandidate("b")),
        };
        w.status = "complete";
      },
    ],
  ];

  test("every malformed sprite working set is reported and the valid one still reads", () => {
    const root = tempRoot();
    const store = openStore(root);
    store.putWorkingSet(workingSet("good"));
    mkdirSync(join(root, "working-sets"), { recursive: true });
    mutations.forEach(([, mutate], index) => {
      const bad = clone(workingSet("x"));
      mutate(bad);
      writeFileSync(
        join(root, "working-sets", `bad-${index}.json`),
        JSON.stringify(bad),
      );
    });

    const status = store.status();

    expect(status.workingSets.map((w) => w.id)).toEqual(["good"]);
    expect(status.invalid.map((p) => p.file).sort()).toEqual(
      mutations.map((_, i) => `working-sets/bad-${i}.json`).sort(),
    );
    void slots;
  });

  test("a portrait is complete when every expression has a pick or one authored frame, and not otherwise", () => {
    const root = tempRoot();
    const store = openStore(root);
    const frame = authoredFrames("e1", 1);
    const pick = keyframe(
      doneCandidate("job-a", { kind: "portrait", slotKey: "neutral" }),
    );
    const mixed = {
      ...faces(),
      picks: { neutral: pick },
      frames: { pleased: frame },
      status: "complete",
    };
    mkdirSync(join(root, "working-sets"), { recursive: true });
    const write = (name: string, value: unknown) =>
      writeFileSync(
        join(root, "working-sets", `${name}.json`),
        JSON.stringify({ ...(value as Json), id: name }),
      );
    write("mixed", mixed);
    write("one-short", {
      ...faces(),
      picks: { neutral: pick },
      status: "open",
    });
    write("short-but-complete", {
      ...faces(),
      picks: { neutral: pick },
      status: "complete",
    });
    write("two-frames", {
      ...faces(),
      picks: { neutral: pick },
      frames: { pleased: authoredFrames("e1", 2) },
      status: "complete",
    });
    write("authored-wins", {
      ...faces(),
      frames: { neutral: frame, pleased: frame },
      status: "complete",
    });

    const status = store.status();

    expect(status.workingSets.map((w) => w.id).sort()).toEqual([
      "authored-wins",
      "mixed",
      "one-short",
    ]);
    expect(status.invalid.map((p) => p.file).sort()).toEqual([
      "working-sets/short-but-complete.json",
      "working-sets/two-frames.json",
    ]);
  });
});

describe("edit records and files", () => {
  const h = (n: number) => sha256Hex(new Uint8Array([n]));
  const edit = (id: string): EditRecord => ({
    schemaVersion: 1,
    id,
    workingSetId: "w",
    slots: ["idle/south"],
    cell: { w: 64, h: 80 },
    base: {
      "idle/south": { kind: "keyframe", candidateId: "job-a", imageHash: h(1) },
    },
    evidence: {
      "idle/south": {
        params: { ...PROVISIONAL_TEST_PARAMS, scale: null },
        palette: { ...TEST_PALETTE, colours: [...TEST_PALETTE.colours] },
      },
    },
    baseSheet: { sheetHash: h(2), metadataHash: h(3) },
    baseSignature: {
      "idle/south": { frames: [{ hash: h(4), durationMs: 167 }], pivot: null },
    },
    status: "open",
    preview: null,
  });

  test("a record reads back as written, is listed by status and a malformed one is reported", () => {
    const root = tempRoot();
    const store = openStore(root);
    store.putEdit(edit("e1"));
    store.putEdit({ ...edit("e2"), status: "finished" });
    writeFileSync(
      join(root, "edits", "bad.json"),
      JSON.stringify({ ...edit("bad"), status: "weird" }),
    );

    expect(store.readEdit("e1")).toEqual({ kind: "found", value: edit("e1") });
    expect(store.readEdit("nope")).toEqual({ kind: "missing" });
    expect(store.readEdit("bad").kind).toBe("invalid");
    const status = store.status();
    expect(status.edits.map((e) => [e.id, e.status])).toEqual([
      ["e1", "open"],
      ["e2", "finished"],
    ]);
    expect(status.invalid.map((p) => p.file)).toEqual(["edits/bad.json"]);
  });

  test("only the three workspace files can be written, under a valid edit id, and read back exactly", () => {
    const root = tempRoot();
    const store = openStore(root);
    const bytes = new Uint8Array([1, 2, 3, 0, 255]);

    store.putEditFile("e1", "sheet.png", bytes);
    store.putEditFile("e1", "sheet.json", new TextEncoder().encode("{}"));
    store.putEditFile("e1", "workspace.aseprite", bytes);

    expect(store.readEditFile("e1", "sheet.png")).toEqual(bytes);
    expect(store.readEditFile("e1", "workspace.aseprite")).toEqual(bytes);
    expect(store.readEditFile("e1", "sheet.json")).toEqual(
      new TextEncoder().encode("{}"),
    );
    expect(store.readEditFile("e2", "sheet.png")).toBeUndefined();
    expect(readdirSync(join(root, "edits", "e1")).sort()).toEqual([
      "sheet.json",
      "sheet.png",
      "workspace.aseprite",
    ]);
    for (const name of [
      "../escape.png",
      "other.png",
      "sheet.png.tmp",
      "",
      "e1/sheet.png",
    ])
      expect(
        () => store.putEditFile("e1", name as never, bytes),
        name,
      ).toThrow();
    for (const id of ["../x", "a/b", "", "Not Valid", "."])
      expect(() => store.putEditFile(id, "sheet.png", bytes), id).toThrow();
    expect(store.readEditFile("../x", "sheet.png")).toBeUndefined();
    expect(readdirSync(root).sort()).toEqual(["edits"]);
  });

  test("a failed edit-file write leaves no temp file behind", () => {
    const root = tempRoot();
    const store = openStore(root);
    mkdirSync(join(root, "edits", "e1", "sheet.png"), { recursive: true });

    expect(() =>
      store.putEditFile("e1", "sheet.png", new Uint8Array([1])),
    ).toThrow();

    expect(readdirSync(join(root, "edits", "e1"))).toEqual(["sheet.png"]);
  });
});

describe("engine facts on job records", () => {
  const readOne = (root: string) => openStore(root).status();
  const put = (root: string, record: unknown, id = "job-a") => {
    mkdirSync(join(root, "jobs"), { recursive: true });
    writeFileSync(join(root, "jobs", `${id}.json`), JSON.stringify(record));
  };
  const succeededRecord = (extra: object = {}) => ({
    schemaVersion: 1,
    source: jobSource("r1"),
    job: succeededJob("job-a"),
    engine: engineFacts(),
    ...extra,
  });

  test("a succeeded job carries its engine facts and reads back unchanged", () => {
    const root = tempRoot();
    const store = openStore(root);
    const record = {
      schemaVersion: 1 as const,
      source: jobSource("r1"),
      job: succeededJob("job-a"),
      engine: engineFacts({
        loras: [{ id: "pixel-lora", sha256: sha256Hex(new Uint8Array([7])) }],
      }),
    };

    store.putJob(record);

    expect(readOne(root).jobs).toEqual([record]);
    expect(readOne(root).invalid).toEqual([]);
  });

  test("a succeeded job without engine facts is invalid", () => {
    const root = tempRoot();
    put(root, {
      schemaVersion: 1,
      source: jobSource("r1"),
      job: succeededJob("job-a"),
    });

    const status = readOne(root);

    expect(status.jobs).toEqual([]);
    expect(status.invalid.map((p) => [p.file, p.message])).toEqual([
      ["jobs/job-a.json", expect.stringMatching(/engine/)],
    ]);
  });

  for (const [name, job] of [
    ["queued", queuedJob("job-a")],
    ["running", runningJob("job-a")],
    ["failed", { ...queuedJob("job-a"), status: "failed", error: "x" }],
    [
      "unavailable",
      {
        ...queuedJob("job-a"),
        status: "unavailable",
        reason: "r",
        staging: "s",
      },
    ],
    [
      "cancelled",
      { ...queuedJob("job-a"), status: "cancelled", cancelledBy: "aborted" },
    ],
  ] as const)
    test(`a ${name} job with engine facts is invalid`, () => {
      const root = tempRoot();
      put(root, {
        schemaVersion: 1,
        source: jobSource("r1"),
        job,
        engine: engineFacts(),
      });

      expect(readOne(root).invalid.map((p) => p.file)).toEqual([
        "jobs/job-a.json",
      ]);
      expect(readOne(root).jobs).toEqual([]);
    });

  const bad: [string, (e: Json) => void][] = [
    [
      "an unknown key",
      (e) => {
        e.endpoint = "http://127.0.0.1:1";
      },
    ],
    [
      "a file path key",
      (e) => {
        e.path = "/models/x.gguf";
      },
    ],
    [
      "a missing runtime",
      (e) => {
        delete e.runtime;
      },
    ],
    [
      "a runtime with an extra key",
      (e) => {
        e.runtime.commit = "x";
      },
    ],
    [
      "a non-hex binary hash",
      (e) => {
        e.runtimeBinarySha256 = "xyz";
      },
    ],
    [
      "a missing binary hash",
      (e) => {
        delete e.runtimeBinarySha256;
      },
    ],
    [
      "a model with a short hash",
      (e) => {
        e.model.sha256 = "ab";
      },
    ],
    [
      "a model without an id",
      (e) => {
        delete e.model.id;
      },
    ],
    [
      "loras that are not an array",
      (e) => {
        e.loras = {};
      },
    ],
    [
      "an encoder that is undefined instead of null",
      (e) => {
        delete e.encoder;
      },
    ],
    [
      "a vae that is a string",
      (e) => {
        e.vae = "z-image-ae";
      },
    ],
    [
      "licences with an unknown role",
      (e) => {
        e.licences[0].role = "owner";
      },
    ],
    [
      "licences that are not an array",
      (e) => {
        e.licences = "MIT";
      },
    ],
    [
      "a credential-looking setting key",
      (e) => {
        e.settings.apiKey = "x";
      },
    ],
    [
      "an endpoint in a setting value",
      (e) => {
        e.settings.server = "http://127.0.0.1:8080";
      },
    ],
    [
      "a nested setting",
      (e) => {
        e.settings.sample_params = { a: 1 };
      },
    ],
    [
      "a missing settings object",
      (e) => {
        delete e.settings;
      },
    ],
  ];
  for (const [name, change] of bad)
    test(`engine facts with ${name} are invalid`, () => {
      const root = tempRoot();
      const record = JSON.parse(JSON.stringify(succeededRecord()));
      change(record.engine);
      put(root, record);

      expect(readOne(root).invalid.map((p) => p.file)).toEqual([
        "jobs/job-a.json",
      ]);
    });

  test("an unknown key on the job record is still invalid", () => {
    const root = tempRoot();
    put(root, succeededRecord({ extra: 1 }));

    expect(readOne(root).invalid).toHaveLength(1);
  });
});

describe("studio asset records", () => {
  const put = (root: string, record: unknown, id = "asset-a") => {
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "assets", `${id}.json`), JSON.stringify(record));
  };

  test("a packed asset reads back as written and is listed by status", () => {
    const root = tempRoot();
    const store = openStore(root);
    const draft = studioAsset("asset-a");
    const published = studioAsset("asset-b", {
      published: { revision: sha256Hex(new Uint8Array([9])) },
      licenceAssessments: [
        {
          record: { subject: "x", role: "input", licence: "Custom" },
          disposition: "mit-compatible",
          reason: "owner read the terms",
        },
      ],
    });

    store.putAsset(draft);
    store.putAsset(published);

    expect(store.readAsset("asset-a")).toEqual({ kind: "found", value: draft });
    expect(store.status().assets).toEqual([draft, published]);
    expect(store.status().invalid).toEqual([]);
  });

  const bad: [string, (r: Json) => void][] = [
    [
      "an unknown key",
      (r) => {
        r.extra = 1;
      },
    ],
    [
      "schema version 2",
      (r) => {
        r.schemaVersion = 2;
      },
    ],
    [
      "a non-slug local id",
      (r) => {
        r.id = "Not A Slug";
      },
    ],
    [
      "a non-slug asset id",
      (r) => {
        r.assetId = "Zeus";
      },
    ],
    [
      "a prior that is not a hash",
      (r) => {
        r.prior = "x";
      },
    ],
    [
      "a missing prior",
      (r) => {
        delete r.prior;
      },
    ],
    [
      "an unknown record state",
      (r) => {
        r.record.state = "weird";
      },
    ],
    [
      "a record without a manifest",
      (r) => {
        delete r.record.manifest;
      },
    ],
    [
      "a draft without its edit state",
      (r) => {
        delete r.record.edit;
      },
    ],
    [
      "a candidate record carrying a basis",
      (r) => {
        r.record = {
          state: "candidate",
          manifest: r.record.manifest,
          report: { schemaVersion: 1, status: "pass", checks: [] },
          basis: { type: "report-pass" },
        };
      },
    ],
    [
      "an approved record without a basis",
      (r) => {
        r.record = { state: "approved", manifest: r.record.manifest };
      },
    ],
    [
      "a report whose status disagrees with its checks",
      (r) => {
        r.record.report.status = "fail";
      },
    ],
    [
      "a manifest revision that is not a hash",
      (r) => {
        r.manifestRevision = "x";
      },
    ],
    [
      "a report basis without a palette digest",
      (r) => {
        delete r.reportBasis.paletteDigest;
      },
    ],
    [
      "a licence review entry with an unknown status",
      (r) => {
        r.licenceReview.entries[0].status = "fine";
      },
    ],
    [
      "a licence review entry with an unknown source",
      (r) => {
        r.licenceReview.entries[0].source = "guess";
      },
    ],
    [
      "a licence review without its revision",
      (r) => {
        delete r.licenceReview.manifestRevision;
      },
    ],
    [
      "an assessment with an unknown disposition",
      (r) => {
        r.licenceAssessments = [
          {
            record: { subject: "x", role: "input", licence: "L" },
            disposition: "legal",
            reason: "r",
          },
        ];
      },
    ],
    [
      "an assessment without a reason",
      (r) => {
        r.licenceAssessments = [
          {
            record: { subject: "x", role: "input", licence: "L" },
            disposition: "incompatible",
            reason: "",
          },
        ];
      },
    ],
    [
      "a published marker that is not a revision",
      (r) => {
        r.published = { revision: "x" };
      },
    ],
    [
      "a missing published marker",
      (r) => {
        delete r.published;
      },
    ],
  ];
  for (const [name, change] of bad)
    test(`a record with ${name} is reported invalid and its neighbours still read`, () => {
      const root = tempRoot();
      const store = openStore(root);
      store.putAsset(studioAsset("asset-b"));
      const record = clone(studioAsset("asset-a"));
      change(record);
      put(root, record);

      const status = store.status();

      expect(status.assets.map((a) => a.id)).toEqual(["asset-b"]);
      expect(status.invalid.map((p) => p.file)).toEqual([
        "assets/asset-a.json",
      ]);
    });
});

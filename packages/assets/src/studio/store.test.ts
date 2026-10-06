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
  doneCandidate,
  jobSource,
  keyframe,
  needsScaleCandidate,
  queuedJob,
  removeTempRoots,
  request,
  succeededJob,
  tempRoot,
  workingSet,
} from "./_test-fixtures";
import { readStudioStatus } from "./index";
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
      commands: [],
      invalid: [],
    });
    expect(existsSync(root)).toBe(false);
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

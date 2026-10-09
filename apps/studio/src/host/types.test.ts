import { describe, expect, test } from "bun:test";
import {
  type EditReport,
  parseCandidateFrames,
  parseCommandError,
  parseConfigChoice,
  parseConfigStatus,
  parseEditExport,
  parseEditOpened,
  parseEditReport,
  parseHostStatus,
  parseSnapshot,
} from "./types";

const KEY = "a".repeat(64);

const full = () => ({
  host: { state: "running" },
  status: { counts: { jobs: 1 } },
  requests: [{ id: "zeus-idle" }],
  jobs: [{ id: "zeus-idle-0000", status: "queued" }],
  candidates: [],
  edits: [],
  workingSets: [],
  assets: [],
  keys: {
    listing: "l1",
    selections: [{ source: "draft", id: "zeus-take", key: KEY }],
  },
  errors: {},
});

describe("the host status", () => {
  test.each([
    "not-configured",
    "starting",
    "running",
    "unavailable-without-attempt-is-wrong",
  ])("%s", (state) => {
    const parsed = parseHostStatus({ state });
    expect(parsed.ok).toBe(
      ["not-configured", "starting", "running"].includes(state),
    );
  });

  test("a restart carries its attempt out of the maximum", () => {
    expect(
      parseHostStatus({ state: "restarting", attempt: 2, maxAttempts: 3 }),
    ).toEqual({
      ok: true,
      value: { state: "restarting", attempt: 2, maxAttempts: 3 },
    });
    expect(
      parseHostStatus({ state: "unavailable", attempt: 3, maxAttempts: 3 }),
    ).toMatchObject({ ok: true, value: { state: "unavailable", attempt: 3 } });
  });

  test("stopped is a state", () => {
    expect(parseHostStatus({ state: "stopped" })).toEqual({
      ok: true,
      value: { state: "stopped" },
    });
  });

  test.each([
    ["no state", {}],
    ["an unknown state", { state: "sleeping" }],
    ["a state that is not text", { state: 3 }],
    ["restarting without an attempt", { state: "restarting" }],
    [
      "restarting with attempt zero",
      { state: "restarting", attempt: 0, maxAttempts: 3 },
    ],
    [
      "an attempt past the maximum",
      { state: "restarting", attempt: 4, maxAttempts: 3 },
    ],
    [
      "a fractional attempt",
      { state: "restarting", attempt: 1.5, maxAttempts: 3 },
    ],
    ["a text attempt", { state: "restarting", attempt: "1", maxAttempts: 3 }],
    [
      "an attempt on a running host",
      { state: "running", attempt: 1, maxAttempts: 3 },
    ],
    ["a missing maximum", { state: "restarting", attempt: 1 }],
    ["read-only without a holder", { state: "read-only" }],
    ["read-only with holder zero", { state: "read-only", lockHolder: 0 }],
    [
      "read-only with a fractional holder",
      { state: "read-only", lockHolder: 1.5 },
    ],
    [
      "read-only with a text holder",
      { state: "read-only", lockHolder: "4242" },
    ],
    [
      "read-only with an attempt",
      { state: "read-only", lockHolder: 4242, attempt: 1, maxAttempts: 3 },
    ],
    ["a holder on a running host", { state: "running", lockHolder: 4242 }],
    [
      "a holder on a restarting host",
      { state: "restarting", attempt: 1, maxAttempts: 3, lockHolder: 4242 },
    ],
    ["null", null],
    ["a string", "running"],
    ["an array", []],
  ])("refuses %s", (_name, value) => {
    expect(parseHostStatus(value).ok).toBe(false);
  });
});

describe("the snapshot", () => {
  test("a host-only snapshot is valid: there is no store data to show yet", () => {
    expect(parseSnapshot({ host: { state: "not-configured" } })).toEqual({
      ok: true,
      value: { host: { state: "not-configured" } },
    });
  });

  test("a full snapshot parses every section with its host state", () => {
    const parsed = parseSnapshot(full());
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.value.host.state).toBe("running");
    expect(parsed.value.jobs).toEqual([
      { id: "zeus-idle-0000", status: "queued" },
    ]);
    expect(parsed.value.keys).toEqual({
      listing: "l1",
      selections: [{ source: "draft", id: "zeus-take", key: KEY }],
    });
    expect(parsed.value.status).toEqual({ counts: { jobs: 1 } });
  });

  test("a section the session refused is null and named in errors", () => {
    const parsed = parseSnapshot({
      ...full(),
      assets: null,
      keys: null,
      errors: {
        assets: { code: "internal", message: "boom" },
        keys: { code: "missing-config" },
      },
    });
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.value.assets).toBeNull();
    expect(parsed.value.keys).toBeNull();
    expect(parsed.value.errors).toEqual({
      assets: { code: "internal", message: "boom" },
      keys: { code: "missing-config" },
    });
  });

  test("a restarting host with data cleared is a host-only snapshot with an attempt", () => {
    expect(
      parseSnapshot({
        host: { state: "restarting", attempt: 1, maxAttempts: 3 },
      }),
    ).toMatchObject({
      ok: true,
      value: { host: { state: "restarting", attempt: 1 } },
    });
  });

  test("a read-only host names the process that holds the root", () => {
    expect(
      parseSnapshot({ host: { state: "read-only", lockHolder: 6304 } }),
    ).toEqual({
      ok: true,
      value: { host: { state: "read-only", lockHolder: 6304 } },
    });
    expect(parseHostStatus({ state: "read-only", lockHolder: 1 }).ok).toBe(
      true,
    );
  });

  test("a snapshot no longer carries the sidecar pid: it is not a field", () => {
    expect(
      parseSnapshot({ host: { state: "running" }, sidecarPid: 6304 }),
    ).toEqual({ ok: true, value: { host: { state: "running" } } });
  });

  test.each([
    ["not an object", 7],
    ["null", null],
    ["an array", []],
    ["no host", { jobs: [] }],
    ["a forged host", { host: "running" }],
    ["a bad host", { host: { state: "sleeping" } }],
    ["a section that is not a list", { host: { state: "running" }, jobs: {} }],
    [
      "a record with no id",
      { host: { state: "running" }, jobs: [{ status: "queued" }] },
    ],
    [
      "a record that is not an object",
      { host: { state: "running" }, jobs: ["x"] },
    ],
    [
      "an id that is not text",
      { host: { state: "running" }, edits: [{ id: 1 }] },
    ],
    ["keys that are not an object", { host: { state: "running" }, keys: [] }],
    [
      "a listing key that is not text",
      { host: { state: "running" }, keys: { listing: 1, selections: [] } },
    ],
    [
      "selections that are not a list",
      { host: { state: "running" }, keys: { listing: "l", selections: {} } },
    ],
    [
      "a selection with a path-like id",
      {
        host: { state: "running" },
        keys: {
          listing: "l",
          selections: [{ source: "draft", id: "../x", key: KEY }],
        },
      },
    ],
    [
      "a selection with an unknown source",
      {
        host: { state: "running" },
        keys: {
          listing: "l",
          selections: [{ source: "registry", id: "a", key: KEY }],
        },
      },
    ],
    [
      "a selection key that is not text",
      {
        host: { state: "running" },
        keys: {
          listing: "l",
          selections: [{ source: "draft", id: "a", key: 3 }],
        },
      },
    ],
    [
      "errors that are not an object",
      { host: { state: "running" }, errors: [] },
    ],
    [
      "an error with no code",
      { host: { state: "running" }, errors: { keys: { message: "x" } } },
    ],
  ])("refuses %s", (_name, value) => {
    const parsed = parseSnapshot(value);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message.length).toBeGreaterThan(0);
  });

  test("the refusal names where it failed but never echoes the payload's values", () => {
    const parsed = parseSnapshot({
      host: { state: "running" },
      keys: {
        listing: "l",
        selections: [{ source: "draft", id: "/Users/secret/x", key: KEY }],
      },
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.message).toContain("keys");
      expect(parsed.message).not.toContain("secret");
    }
  });

  test("a section can be absent, and unknown extra sections are dropped rather than passed on", () => {
    const parsed = parseSnapshot({
      host: { state: "running" },
      surprise: { a: 1 },
    });
    expect(parsed).toEqual({ ok: true, value: { host: { state: "running" } } });
  });
});

describe("command errors", () => {
  test("a host error object keeps its code, message and retryable flag", () => {
    expect(
      parseCommandError({
        code: "stale-version",
        message: "resolve it again",
        retryable: false,
      }),
    ).toEqual({
      code: "stale-version",
      message: "resolve it again",
      retryable: false,
    });
  });

  test("details survive and nothing else is trusted", () => {
    expect(
      parseCommandError({
        code: "invalid-request",
        message: "bad",
        retryable: false,
        detail: { error: { kind: "unknown-subject", valid: ["zeus"] } },
      }),
    ).toEqual({
      code: "invalid-request",
      message: "bad",
      retryable: false,
      detail: { error: { kind: "unknown-subject", valid: ["zeus"] } },
    });
  });

  test.each([
    ["a string", "the host crashed"],
    ["null", null],
    ["an object with no code", { message: "x" }],
    ["an Error", new Error("nope")],
  ])("%s becomes a non-retryable unknown error with text", (_name, value) => {
    const error = parseCommandError(value);
    expect(error.code).toBe("unknown");
    expect(error.retryable).toBe(false);
    expect(typeof error.message).toBe("string");
  });
});

describe("config and edit replies", () => {
  test("the config status is whether a config is chosen and what the host is doing, with no path", () => {
    expect(parseConfigStatus({ configured: true, state: "running" })).toEqual({
      ok: true,
      value: { configured: true, state: "running" },
    });
    expect(parseConfigStatus({ configured: "yes", state: "running" }).ok).toBe(
      false,
    );
    expect(parseConfigStatus({ configured: true, state: "asleep" }).ok).toBe(
      false,
    );
  });

  test("choosing a config is cancelled or a new status", () => {
    expect(parseConfigChoice({ cancelled: true })).toEqual({
      ok: true,
      value: { cancelled: true },
    });
    expect(parseConfigChoice({ configured: true, state: "starting" })).toEqual({
      ok: true,
      value: { cancelled: false, configured: true, state: "starting" },
    });
    expect(parseConfigChoice({}).ok).toBe(false);
  });

  test("an opened edit reports its workspace metadata and whether the editor launched", () => {
    const reply = {
      editId: "e1",
      slots: ["idle/south"],
      workspace: {
        size: { w: 64, h: 80 },
        durationsMs: [167],
        tags: [{ name: "idle/south", from: 0, to: 0 }],
      },
      editor: { launched: false, reason: "editor-unavailable" },
    };
    expect(parseEditOpened(reply)).toEqual({ ok: true, value: reply });
    expect(
      parseEditOpened({ ...reply, editor: { launched: true } }),
    ).toMatchObject({ ok: true, value: { editor: { launched: true } } });
    expect(parseEditOpened({ ...reply, editor: { launched: "no" } }).ok).toBe(
      false,
    );
    expect(parseEditOpened({ ...reply, slots: [1] }).ok).toBe(false);
    expect(parseEditOpened({ editId: 3 }).ok).toBe(false);
  });

  test("an export is cancelled or the names of the files written", () => {
    expect(parseEditExport({ cancelled: true })).toEqual({
      ok: true,
      value: { cancelled: true },
    });
    expect(
      parseEditExport({ editId: "e1", files: ["sheet.png", "sheet.json"] }),
    ).toEqual({
      ok: true,
      value: {
        cancelled: false,
        editId: "e1",
        files: ["sheet.png", "sheet.json"],
      },
    });
    expect(parseEditExport({ editId: "e1", files: [1] }).ok).toBe(false);
  });
});

describe("the edit report", () => {
  const H = "a".repeat(64);
  const px = { x: 4, y: 4, before: "#546471ff", after: "#596471ff" };
  const frame = (over: Record<string, unknown> = {}) => ({
    index: 0,
    report: "pass",
    failedChecks: [],
    change: "unchanged",
    pixelsChanged: 0,
    diff: [],
    ...over,
  });
  const slot = (over: Record<string, unknown> = {}) => ({
    slot: "idle/south",
    diffAgainst: "recorded",
    frames: [
      frame(),
      frame({ index: 1, change: "changed", pixelsChanged: 1, diff: [px] }),
      frame({
        index: 2,
        report: "fail",
        failedChecks: ["grid", "palette"],
        change: "added",
        pixelsChanged: null,
        diff: null,
      }),
    ],
    addedFrames: [2],
    removedFrames: [3, 4],
    ...over,
  });
  const report = (over: Record<string, unknown> = {}) => ({
    editId: "e1",
    workingSetId: "zeus-set",
    state: "open",
    sheetHash: H,
    metadataHash: "b".repeat(64),
    slots: [slot()],
    ...over,
  });

  test("a report with changed, unchanged and added frames, failed checks and removed frames parses as it is", () => {
    expect(parseEditReport(report())).toEqual({
      ok: true,
      value: report() as unknown as EditReport,
    });
    expect(parseEditReport(report({ state: "finished" })).ok).toBe(true);
  });

  test("a save with no recorded base says unavailable for every frame and nothing is added or removed", () => {
    const unavailable = slot({
      diffAgainst: "unavailable",
      frames: [
        frame({ change: "unavailable", pixelsChanged: null, diff: null }),
      ],
      addedFrames: [],
      removedFrames: [],
    });
    expect(parseEditReport(report({ slots: [unavailable] })).ok).toBe(true);
  });

  const bad: [string, (r: ReturnType<typeof report>) => unknown][] = [
    ["not an object", () => 7],
    ["null", () => null],
    ["an unknown state", (r) => ({ ...r, state: "discarded" })],
    ["a bad edit id", (r) => ({ ...r, editId: "../x" })],
    ["a bad working set id", (r) => ({ ...r, workingSetId: "" })],
    ["a bad sheet hash", (r) => ({ ...r, sheetHash: "x" })],
    ["a bad metadata hash", (r) => ({ ...r, metadataHash: H.toUpperCase() })],
    ["slots that are not a list", (r) => ({ ...r, slots: {} })],
    ["a slot with no name", (r) => ({ ...r, slots: [slot({ slot: "" })] })],
    [
      "an unknown diffAgainst",
      (r) => ({ ...r, slots: [slot({ diffAgainst: "base" })] }),
    ],
    [
      "frames out of order",
      (r) => ({
        ...r,
        slots: [slot({ frames: [frame({ index: 1 }), frame({ index: 0 })] })],
      }),
    ],
    [
      "an unknown report status",
      (r) => ({
        ...r,
        slots: [
          slot({
            frames: [frame({ report: "maybe" })],
            addedFrames: [],
            removedFrames: [],
          }),
        ],
      }),
    ],
    [
      "a passing frame with failed checks",
      (r) => ({
        ...r,
        slots: [
          slot({
            frames: [frame({ failedChecks: ["grid"] })],
            addedFrames: [],
            removedFrames: [],
          }),
        ],
      }),
    ],
    [
      "failed checks that are not text",
      (r) => ({
        ...r,
        slots: [
          slot({
            frames: [frame({ report: "fail", failedChecks: [1] })],
            addedFrames: [],
            removedFrames: [],
          }),
        ],
      }),
    ],
    [
      "an unchanged frame that counts changed pixels",
      (r) => ({
        ...r,
        slots: [
          slot({
            frames: [frame({ pixelsChanged: 1, diff: [px] })],
            addedFrames: [],
            removedFrames: [],
          }),
        ],
      }),
    ],
    [
      "a changed frame whose count is not its diff",
      (r) => ({
        ...r,
        slots: [
          slot({
            frames: [
              frame({ change: "changed", pixelsChanged: 2, diff: [px] }),
            ],
            addedFrames: [],
            removedFrames: [],
          }),
        ],
      }),
    ],
    [
      "a changed frame with no changed pixels",
      (r) => ({
        ...r,
        slots: [
          slot({
            frames: [frame({ change: "changed", pixelsChanged: 0, diff: [] })],
            addedFrames: [],
            removedFrames: [],
          }),
        ],
      }),
    ],
    [
      "an added frame that carries a diff",
      (r) => ({
        ...r,
        slots: [
          slot({
            frames: [frame({ change: "added", pixelsChanged: 0, diff: [] })],
            addedFrames: [0],
            removedFrames: [],
          }),
        ],
      }),
    ],
    [
      "a pixel with a malformed colour",
      (r) => ({
        ...r,
        slots: [
          slot({
            frames: [
              frame({
                change: "changed",
                pixelsChanged: 1,
                diff: [{ ...px, after: "red" }],
              }),
            ],
            addedFrames: [],
            removedFrames: [],
          }),
        ],
      }),
    ],
    [
      "a pixel at a negative position",
      (r) => ({
        ...r,
        slots: [
          slot({
            frames: [
              frame({
                change: "changed",
                pixelsChanged: 1,
                diff: [{ ...px, x: -1 }],
              }),
            ],
            addedFrames: [],
            removedFrames: [],
          }),
        ],
      }),
    ],
    [
      "added frames that are not the added frames",
      (r) => ({ ...r, slots: [slot({ addedFrames: [0] })] }),
    ],
    [
      "removed frames inside the current frames",
      (r) => ({ ...r, slots: [slot({ removedFrames: [1] })] }),
    ],
    [
      "removed frames out of order",
      (r) => ({ ...r, slots: [slot({ removedFrames: [4, 3] })] }),
    ],
    [
      "an unavailable slot that has a recorded frame",
      (r) => ({ ...r, slots: [slot({ diffAgainst: "unavailable" })] }),
    ],
    [
      "a recorded slot with an unavailable frame",
      (r) => ({
        ...r,
        slots: [
          slot({
            frames: [
              frame({ change: "unavailable", pixelsChanged: null, diff: null }),
            ],
            addedFrames: [],
            removedFrames: [],
          }),
        ],
      }),
    ],
  ];
  for (const [name, make] of bad)
    test(`a report with ${name} is refused`, () => {
      const parsed = parseEditReport(make(report()));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.message.length).toBeGreaterThan(0);
    });

  test("a refusal names where it failed and never echoes a value", () => {
    const parsed = parseEditReport(
      report({ slots: [slot({ slot: "" }), { secret: "/Users/x/secret" }] }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).not.toContain("secret");
  });
});

describe("a candidate's frames", () => {
  const H = "c".repeat(64);
  const reply = (over: Record<string, unknown> = {}) => ({
    candidateId: "zeus-idle-0000",
    width: 64,
    height: 80,
    frames: [{ index: 0, durationMs: null, imageHash: H }],
    ...over,
  });

  test("one still frame with no timing parses as it is", () => {
    expect(parseCandidateFrames(reply())).toEqual({ ok: true, value: reply() });
  });

  test("several frames keep their order and their timing", () => {
    const frames = [
      { index: 0, durationMs: 100, imageHash: H },
      { index: 1, durationMs: 167, imageHash: "d".repeat(64) },
      { index: 2, durationMs: null, imageHash: "e".repeat(64) },
    ];
    expect(parseCandidateFrames(reply({ frames }))).toEqual({
      ok: true,
      value: reply({ frames }),
    });
  });

  test("pixels never come through: a base64 field on a frame is dropped, not passed on", () => {
    const parsed = parseCandidateFrames(
      reply({
        frames: [{ index: 0, durationMs: null, imageHash: H, base64: "AAAA" }],
      }),
    );
    expect(parsed).toEqual({ ok: true, value: reply() });
  });

  const bad: [string, unknown][] = [
    ["not an object", 7],
    ["null", null],
    ["a bad candidate id", reply({ candidateId: "../x" })],
    ["a zero width", reply({ width: 0 })],
    ["a fractional height", reply({ height: 1.5 })],
    ["no frames", reply({ frames: [] })],
    ["frames that are not a list", reply({ frames: {} })],
    ["a frame that is not an object", reply({ frames: [1] })],
    [
      "frames out of order",
      reply({
        frames: [
          { index: 1, durationMs: null, imageHash: H },
          { index: 0, durationMs: null, imageHash: H },
        ],
      }),
    ],
    [
      "a duration of zero",
      reply({ frames: [{ index: 0, durationMs: 0, imageHash: H }] }),
    ],
    [
      "a duration that is text",
      reply({ frames: [{ index: 0, durationMs: "100", imageHash: H }] }),
    ],
    [
      "a duration that is missing",
      reply({ frames: [{ index: 0, imageHash: H }] }),
    ],
    [
      "a bad image hash",
      reply({ frames: [{ index: 0, durationMs: null, imageHash: "x" }] }),
    ],
  ];
  for (const [name, value] of bad)
    test(`a reply with ${name} is refused`, () => {
      const parsed = parseCandidateFrames(value);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.message.length).toBeGreaterThan(0);
    });
});

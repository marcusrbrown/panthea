import { describe, expect, test } from "bun:test";
import {
  parseCommandError,
  parseConfigChoice,
  parseConfigStatus,
  parseEditExport,
  parseEditOpened,
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

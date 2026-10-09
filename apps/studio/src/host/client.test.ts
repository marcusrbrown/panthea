import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { callsTo, fakeTransport, hostError } from "./_testkit";
import {
  createStudioHost,
  HostError,
  type HostProblem,
  STUDIO_OPS,
} from "./client";
import type { EditReport, StudioSnapshot } from "./types";

const running: StudioSnapshot = { host: { state: "running" } };

describe("calls", () => {
  test("studio_call carries the op and its arguments exactly and returns the reply", async () => {
    const transport = fakeTransport({
      studio_call: callsTo({ list: (args) => [{ id: "j", args }] }),
    });
    const host = createStudioHost(transport);

    const reply = await host.call("list", { kind: "jobs" });

    expect(reply).toEqual([{ id: "j", args: { kind: "jobs" } }]);
    expect(transport.to("studio_call")).toEqual([
      { command: "studio_call", args: { op: "list", args: { kind: "jobs" } } },
    ]);
  });

  test("an op with no arguments sends an empty object", async () => {
    const transport = fakeTransport({ studio_call: () => ({ counts: {} }) });
    await createStudioHost(transport).call("status");
    expect(transport.calls[0]?.args).toEqual({ op: "status", args: {} });
  });

  test("a refusal rejects with a HostError that keeps the code, retry flag and details", async () => {
    const transport = fakeTransport({
      studio_call: () => {
        throw hostError("invalid-request", "bad", false, {
          error: { kind: "unknown-subject", valid: ["zeus"] },
        });
      },
    });

    const error = await createStudioHost(transport)
      .call("resolve", {
        id: "a",
        subject: "nobody",
        kind: "sprite",
        slots: [],
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HostError);
    expect(error).toMatchObject({
      code: "invalid-request",
      message: "bad",
      retryable: false,
      detail: { error: { kind: "unknown-subject", valid: ["zeus"] } },
    });
  });

  test("a retryable host error says so", async () => {
    const transport = fakeTransport({
      studio_call: () => {
        throw hostError("sidecar-unavailable", "not running", true);
      },
    });
    const error = await createStudioHost(transport)
      .call("status")
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "sidecar-unavailable",
      retryable: true,
    });
  });

  test("a rejection that is not the host's shape still becomes a HostError", async () => {
    const transport = fakeTransport({
      studio_call: () => {
        throw "the ipc bridge fell over";
      },
    });
    const error = await createStudioHost(transport)
      .call("status")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HostError);
    expect(error).toMatchObject({ code: "unknown", retryable: false });
  });

  test("the working-set ops carry their ids exactly and nothing else", async () => {
    const transport = fakeTransport({
      studio_call: callsTo({
        "set-create": (args) => ({ id: args.id, state: "open" }),
        "set-replace-sheet": (args) => ({
          workingSetId: args.workingSetId,
          sheetRequestId: args.requestId,
        }),
      }),
    });
    const host = createStudioHost(transport);

    await host.call("set-create", { id: "zeus-set", requestId: "zeus-idle" });
    await host.call("set-replace-sheet", {
      workingSetId: "zeus-set",
      requestId: "zeus-idle-2",
    });

    expect(transport.to("studio_call").map((call) => call.args)).toEqual([
      { op: "set-create", args: { id: "zeus-set", requestId: "zeus-idle" } },
      {
        op: "set-replace-sheet",
        args: { workingSetId: "zeus-set", requestId: "zeus-idle-2" },
      },
    ]);
  });

  test("the typed op list is the Rust schema table, in the same order", async () => {
    const text = await Bun.file(
      join(import.meta.dir, "..", "..", "src-tauri", "src", "schema.rs"),
    ).text();
    const rust = [...text.matchAll(/^\s+spec\(\s*"([a-z-]+)"/gm)].map(
      (m) => m[1],
    );
    expect(rust.length).toBeGreaterThan(10);
    expect([...STUDIO_OPS] as string[]).toEqual(rust as string[]);
  });
});

describe("preview bytes", () => {
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

  test("an atlas is fetched by selection and version, and an ArrayBuffer comes back as bytes", async () => {
    const transport = fakeTransport({
      preview_bytes: () => png.buffer.slice(0),
    });

    const bytes = await createStudioHost(transport).previewBytes(
      { source: "draft", id: "zeus-take" },
      "k1",
    );

    expect([...bytes]).toEqual([...png]);
    expect(transport.calls[0]).toEqual({
      command: "preview_bytes",
      args: { selection: { source: "draft", id: "zeus-take" }, v: "k1" },
    });
  });

  test("the placeholder is fetched by its hash with no version", async () => {
    const transport = fakeTransport({
      preview_bytes: () => png.buffer.slice(0),
    });
    const hash = "0".repeat(64);

    await createStudioHost(transport).previewBytes({ placeholder: hash });

    expect(transport.calls[0]?.args).toEqual({
      selection: { placeholder: hash },
    });
  });

  test("a Uint8Array reply is accepted too", async () => {
    const transport = fakeTransport({ preview_bytes: () => png });
    const bytes = await createStudioHost(transport).previewBytes(
      { source: "canon", id: "zeus-sprite" },
      "k",
    );
    expect([...bytes]).toEqual([...png]);
  });

  test.each([
    ["text", "not bytes"],
    ["null", null],
    ["an object", { base64: "AAAA" }],
    ["a number array", [1, 2, 3]],
  ])("a reply that is %s is refused as malformed", async (_name, reply) => {
    const transport = fakeTransport({ preview_bytes: () => reply });
    const error = await createStudioHost(transport)
      .previewBytes({ source: "draft", id: "a" }, "k")
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "malformed-reply" });
  });

  test("a stale version rejects with the typed code", async () => {
    const transport = fakeTransport({
      preview_bytes: () => {
        throw hostError("stale-version", "resolve it again");
      },
    });
    const error = await createStudioHost(transport)
      .previewBytes({ source: "draft", id: "a" }, "old")
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "stale-version", retryable: false });
  });
});

describe("edit and config commands", () => {
  test("edit_open names the edit, working set and slots, and parses the reply", async () => {
    const reply = {
      editId: "e1",
      slots: ["idle/south"],
      workspace: { size: { w: 64, h: 80 }, durationsMs: [167], tags: [] },
      editor: { launched: true },
    };
    const transport = fakeTransport({ edit_open: () => reply });

    const opened = await createStudioHost(transport).editOpen("e1", "w", [
      "idle/south",
    ]);

    expect(opened).toEqual(reply);
    expect(transport.calls[0]?.args).toEqual({
      editId: "e1",
      workingSetId: "w",
      slots: ["idle/south"],
    });
  });

  test("a reply the parser refuses rejects as malformed, never as a value", async () => {
    const transport = fakeTransport({ edit_open: () => ({ editId: 5 }) });
    const error = await createStudioHost(transport)
      .editOpen("e1", "w", [])
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "malformed-reply" });
  });

  test("export and import resolve cancelled or their result, and carry no path from the webview", async () => {
    const transport = fakeTransport({
      edit_export: () => ({ cancelled: true }),
      edit_import: (args) =>
        args?.finish === true
          ? { editId: "e1", state: "finished", changed: true }
          : { editId: "e1", state: "imported", changed: false },
    });
    const host = createStudioHost(transport);

    expect(await host.editExport("e1")).toEqual({ cancelled: true });
    expect(await host.editImport("e1")).toMatchObject({ state: "imported" });
    expect(await host.editImport("e1", true)).toMatchObject({
      state: "finished",
    });

    expect(transport.to("edit_export")[0]?.args).toEqual({ editId: "e1" });
    expect(transport.to("edit_import").map((c) => c.args)).toEqual([
      { editId: "e1", finish: false },
      { editId: "e1", finish: true },
    ]);
  });

  test("editReport asks edit-report for the id alone and parses the reply", async () => {
    const reply = {
      editId: "e1",
      workingSetId: "w",
      state: "open",
      sheetHash: "a".repeat(64),
      metadataHash: "b".repeat(64),
      slots: [
        {
          slot: "idle/south",
          diffAgainst: "recorded",
          frames: [
            {
              index: 0,
              report: "pass",
              failedChecks: [],
              change: "unchanged",
              pixelsChanged: 0,
              diff: [],
            },
          ],
          addedFrames: [],
          removedFrames: [],
        },
      ],
    };
    const transport = fakeTransport({
      studio_call: callsTo({ "edit-report": () => reply }),
    });
    const host = createStudioHost(transport);

    expect(await host.editReport("e1")).toEqual(reply as unknown as EditReport);
    expect(transport.calls[0]?.args).toEqual({
      op: "edit-report",
      args: { id: "e1" },
    });

    transport.answer(
      "studio_call",
      callsTo({ "edit-report": () => ({ editId: 5 }) }),
    );
    await expect(host.editReport("e1")).rejects.toMatchObject({
      code: "malformed-reply",
    });
  });

  test("an edit-report refusal keeps its code", async () => {
    for (const code of ["not-found", "wrong-state", "corrupt-blob"]) {
      const transport = fakeTransport({
        studio_call: () => {
          throw hostError(code, "no");
        },
      });
      await expect(
        createStudioHost(transport).editReport("e1"),
      ).rejects.toMatchObject({ code, retryable: false });
    }
  });

  test("config_status and config_choose parse their replies", async () => {
    const transport = fakeTransport({
      config_status: () => ({ configured: false, state: "not-configured" }),
      config_choose: () => ({ cancelled: true }),
    });
    const host = createStudioHost(transport);

    expect(await host.configStatus()).toEqual({
      configured: false,
      state: "not-configured",
    });
    expect(await host.configChoose()).toEqual({ cancelled: true });
    expect(transport.to("config_choose")[0]?.args).toBeUndefined();

    transport.answer("config_status", () => ({ configured: "maybe" }));
    await expect(host.configStatus()).rejects.toMatchObject({
      code: "malformed-reply",
    });
  });
});

describe("the snapshot subscription", () => {
  const collect = () => {
    const seen: StudioSnapshot[] = [];
    const problems: HostProblem[] = [];
    return {
      seen,
      problems,
      listener: {
        onSnapshot: (snapshot: StudioSnapshot) => seen.push(snapshot),
        onProblem: (problem: HostProblem) => problems.push(problem),
      },
    };
  };

  test("every listener shares the one subscribe_studio call and the one channel", async () => {
    const transport = fakeTransport({ subscribe_studio: () => undefined });
    const host = createStudioHost(transport);
    const a = collect();
    const b = collect();

    host.snapshots.subscribe(a.listener);
    host.snapshots.subscribe(b.listener);
    await Promise.resolve();

    expect(transport.to("subscribe_studio")).toHaveLength(1);
    expect(transport.channels).toHaveLength(1);
    expect(transport.to("subscribe_studio")[0]?.args).toEqual({
      channel: transport.channels[0]?.handle,
    });

    transport.channels[0]?.emit(running);
    expect(a.seen).toEqual([running]);
    expect(b.seen).toEqual([running]);
  });

  test("a late listener is given the latest snapshot at once without another subscribe", async () => {
    const transport = fakeTransport({ subscribe_studio: () => undefined });
    const host = createStudioHost(transport);
    host.snapshots.subscribe(collect().listener);
    transport.channels[0]?.emit({ host: { state: "starting" } });
    transport.channels[0]?.emit(running);

    const late = collect();
    host.snapshots.subscribe(late.listener);

    expect(late.seen).toEqual([running]);
    expect(transport.to("subscribe_studio")).toHaveLength(1);
  });

  test("an invalid payload is reported to every listener and dropped, and the next valid one still arrives", () => {
    const transport = fakeTransport({ subscribe_studio: () => undefined });
    const host = createStudioHost(transport);
    const a = collect();
    const b = collect();
    host.snapshots.subscribe(a.listener);
    host.snapshots.subscribe(b.listener);

    for (const bad of [
      null,
      "x",
      [],
      { jobs: [] },
      { host: { state: "asleep" } },
    ])
      transport.channels[0]?.emit(bad);
    transport.channels[0]?.emit(running);

    expect(a.seen).toEqual([running]);
    expect(a.problems).toHaveLength(5);
    expect(a.problems[0]).toMatchObject({ kind: "invalid-snapshot" });
    expect(b.problems).toHaveLength(5);
  });

  test("a listener that throws is reported to itself and does not stop the others or the channel", () => {
    const transport = fakeTransport({ subscribe_studio: () => undefined });
    const host = createStudioHost(transport);
    const problems: HostProblem[] = [];
    host.snapshots.subscribe({
      onSnapshot: () => {
        throw new Error("render exploded");
      },
      onProblem: (problem) => problems.push(problem),
    });
    const other = collect();
    host.snapshots.subscribe(other.listener);

    expect(() => transport.channels[0]?.emit(running)).not.toThrow();

    expect(other.seen).toEqual([running]);
    expect(problems).toEqual([
      { kind: "listener-failed", message: "render exploded" },
    ]);
  });

  test("a listener whose own problem handler throws is swallowed", () => {
    const transport = fakeTransport({ subscribe_studio: () => undefined });
    const host = createStudioHost(transport);
    host.snapshots.subscribe({
      onSnapshot: () => {
        throw new Error("a");
      },
      onProblem: () => {
        throw new Error("b");
      },
    });
    expect(() => transport.channels[0]?.emit(running)).not.toThrow();
  });

  test("unsubscribe stops delivery to that listener only", () => {
    const transport = fakeTransport({ subscribe_studio: () => undefined });
    const host = createStudioHost(transport);
    const a = collect();
    const b = collect();
    const stopA = host.snapshots.subscribe(a.listener);
    host.snapshots.subscribe(b.listener);

    stopA();
    stopA();
    transport.channels[0]?.emit(running);

    expect(a.seen).toEqual([]);
    expect(b.seen).toEqual([running]);
  });

  test("a failed subscribe is reported, and the next subscribe tries again", async () => {
    let attempts = 0;
    const transport = fakeTransport({
      subscribe_studio: () => {
        attempts += 1;
        if (attempts === 1) throw hostError("sidecar-unavailable", "no", true);
        return undefined;
      },
    });
    const host = createStudioHost(transport);
    const first = collect();
    host.snapshots.subscribe(first.listener);
    await Promise.resolve();
    await Promise.resolve();

    expect(first.problems).toEqual([
      { kind: "subscribe-failed", message: "no" },
    ]);

    host.snapshots.subscribe(collect().listener);
    await Promise.resolve();
    expect(transport.to("subscribe_studio")).toHaveLength(2);
    expect(transport.channels).toHaveLength(2);
  });

  test("snapshots from a channel that was replaced by a retry are ignored", async () => {
    let attempts = 0;
    const transport = fakeTransport({
      subscribe_studio: () => {
        attempts += 1;
        if (attempts === 1) throw hostError("x", "no");
        return undefined;
      },
    });
    const host = createStudioHost(transport);
    const a = collect();
    host.snapshots.subscribe(a.listener);
    await Promise.resolve();
    await Promise.resolve();
    host.snapshots.subscribe(collect().listener);
    await Promise.resolve();

    transport.channels[0]?.emit(running);

    expect(a.seen).toEqual([]);
  });
});

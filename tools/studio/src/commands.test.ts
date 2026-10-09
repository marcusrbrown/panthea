import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  newRequestRecord,
  openStudioSession,
  readStudioStatus,
} from "@panthea/assets/studio";
import { paletteFixture } from "../../../packages/assets/src/fixtures";
import {
  type AssetRig,
  doneCandidate,
  finishSheet,
  keyframe,
  loadContent,
  needsScaleCandidate,
  olympusMovedPaletteFiles,
  PROVISIONAL_TEST_PARAMS,
  paintFigure,
  pngOf,
  queuedJob,
  runSlots,
  sheetOf,
  spriteSet,
  succeedWithImage,
  upscale,
  workingSet,
} from "../../../packages/assets/src/studio/_test-fixtures";
import { readLog } from "../../../packages/assets/src/studio/_test-runtime";
import {
  alive,
  assetRig,
  capture,
  contentRootWithPalette,
  depsFor,
  removeTempRoots,
  run,
  runtimeRig,
  tempRoot,
  waitFor,
} from "./_testkit";
import { execute, opNames, opSpec, READ_ONLY, readArgs } from "./commands";
import type { StudioConfig } from "./config";
import { exitOf } from "./format";
import { Studio } from "./host";

afterEach(removeTempRoots);

const codeOf = (outcome: Awaited<ReturnType<typeof run>>["outcome"]) =>
  outcome.ok ? "ok" : outcome.error.code;

describe("argument checking", () => {
  test("an unknown argument, a wrong type and a missing required argument are refused as usage errors", async () => {
    const config: StudioConfig = { studioRoot: tempRoot() };
    const cases: [string, unknown][] = [
      ["remove", {}],
      ["remove", { jobId: "j", extra: 1 }],
      ["remove", { jobId: 3 }],
      ["remove", { jobId: "" }],
      ["remove", []],
      ["remove", null],
      ["reroll", { requestId: "r", perSlot: "4" }],
      ["reroll", { requestId: "r", perSlot: 1.5 }],
      ["reroll", { requestId: "r", perSlot: -1 }],
      ["reroll", { requestId: "r", perSlot: 1, slotKey: "" }],
      ["reroll", { requestId: "r", perSlot: 1, slotKey: 3 }],
      ["generate", { id: "r", subject: "zeus", kind: "sprite" }],
      ["pick", { workingSetId: "w" }],
    ];
    for (const [op, args] of cases) {
      const { outcome } = await run(config, op, args);
      expect(codeOf(outcome), `${op} ${JSON.stringify(args)}`).toBe(
        "invalid-arguments",
      );
      expect(exitOf(outcome)).toBe(64);
    }
  });

  test("an unknown command is a usage error that names the known ones", async () => {
    const { outcome } = await run({ studioRoot: tempRoot() }, "levitate", {});

    expect(codeOf(outcome)).toBe("unknown-op");
    expect(!outcome.ok && Array.isArray(outcome.error.known)).toBe(true);
    expect(exitOf(outcome)).toBe(64);
  });

  test("a name an object inherits is not a command: toString, constructor, __proto__ and hasOwnProperty are unknown ops", async () => {
    for (const op of [
      "toString",
      "constructor",
      "__proto__",
      "hasOwnProperty",
      "valueOf",
    ]) {
      const { outcome } = await run({ studioRoot: tempRoot() }, op, {});

      expect(codeOf(outcome), op).toBe("unknown-op");
      expect(!outcome.ok && Array.isArray(outcome.error.known), op).toBe(true);
      expect(exitOf(outcome), op).toBe(64);
    }
  });

  test("an inherited name is not an argument either, and a throw while reading arguments is an internal error, not a crash", async () => {
    const spec = { a: { t: "string" as const } };
    for (const key of ["toString", "constructor", "hasOwnProperty"])
      expect(readArgs({ [key]: 1 }, spec), key).toMatchObject({
        ok: false,
        error: { code: "invalid-arguments" },
      });
    expect(
      readArgs(JSON.parse('{"__proto__":1}'), spec),
      "__proto__ as an own key",
    ).toMatchObject({ ok: false, error: { code: "invalid-arguments" } });

    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("boom");
        },
      },
    );
    const { outcome } = await run(
      { studioRoot: tempRoot() },
      "status",
      hostile,
    );
    expect(codeOf(outcome)).toBe("internal");
  });

  test("every op the app added is found by own-property lookup only, and refuses an inherited name as an argument", async () => {
    for (const op of [
      "resolve",
      "source-list",
      "source-resolve",
      "source-bytes",
      "source-keys",
      "edit-report",
      "candidate-frames",
      "candidate-bytes",
      "edit-workspace",
    ]) {
      expect(opSpec(op), op).toBeDefined();
      expect(opNames(), op).toContain(op);
      for (const key of ["toString", "constructor", "hasOwnProperty"]) {
        const { outcome } = await run({ studioRoot: tempRoot() }, op, {
          [key]: 1,
        });
        expect(codeOf(outcome), `${op} ${key}`).toBe("invalid-arguments");
      }
      const proto = await run(
        { studioRoot: tempRoot() },
        op,
        JSON.parse('{"__proto__":1}'),
      );
      expect(codeOf(proto.outcome), `${op} __proto__`).toBe(
        "invalid-arguments",
      );
    }
    for (const inherited of ["toString", "constructor", "__proto__"])
      expect(opSpec(inherited), inherited).toBeUndefined();
  });

  test("readArgs accepts exactly what a spec names", () => {
    expect(readArgs({ a: "x" }, { a: { t: "string", req: true } })).toEqual({
      a: "x",
    });
    expect(
      "ok" in (readArgs({ a: "x", b: 1 }, { a: { t: "string" } }) as object),
    ).toBe(true);
  });

  test("a command that needs a config group the user did not set says which, with exit 64 and no side effects", async () => {
    const root = tempRoot();
    for (const [op, args, field] of [
      [
        "generate",
        {
          id: "r",
          subject: "zeus",
          kind: "sprite",
          slots: [{ state: "idle", direction: "south" }],
        },
        "contentRoot",
      ],
      ["set-create", { id: "w", requestId: "r" }, "contentRoot"],
      [
        "pack",
        { id: "p", workingSetId: "w", assetId: "a", styleTag: "t" },
        "contentRoot",
      ],
    ] as const) {
      const { outcome } = await run({ studioRoot: root }, op, args);
      expect(codeOf(outcome), op).toBe("missing-config");
      expect(!outcome.ok && outcome.error.field).toBe(field);
      expect(exitOf(outcome)).toBe(64);
    }
    expect(readStudioStatus(root).requests).toEqual([]);
    const none = await run({}, "status", {});
    expect(none.outcome).toMatchObject({
      ok: false,
      error: { code: "missing-config", field: "studioRoot" },
    });
  });

  test("content that does not load is a config error with its diagnostics and no session opened", async () => {
    const root = tempRoot();
    const { outcome } = await run(
      { studioRoot: root, contentRoot: join(root, "no-content") },
      "set-create",
      { id: "w", requestId: "r" },
    );

    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "invalid-content" },
    });
    expect(!outcome.ok && Array.isArray(outcome.error.diagnostics)).toBe(true);
    expect(exitOf(outcome)).toBe(64);
  });
});

describe("reading without the writer lock", () => {
  test("status, list, sheet and report read a root another session owns, and leave that session open", async () => {
    const rig = assetRig();
    spriteSet(rig);
    const config: StudioConfig = { studioRoot: rig.root };
    const before = readFileSync(
      join(rig.root, "working-sets", "w.json"),
      "utf8",
    );

    const status = await run(config, "status", {});
    const jobs = await run(config, "list", { kind: "jobs" });
    const sets = await run(config, "list", { kind: "working-sets" });
    const view = await run(config, "sheet", { workingSetId: "w" });

    expect(status.outcome).toMatchObject({
      ok: true,
      result: { owner: { open: true }, counts: { jobs: 1, edits: 1 } },
    });
    expect(jobs.outcome).toMatchObject({
      ok: true,
      result: [{ id: "zeus-idle-0000", status: "succeeded" }],
    });
    expect(sets.outcome).toMatchObject({
      ok: true,
      result: [{ id: "w", authored: { "idle/south": { frames: 4 } } }],
    });
    expect(view.outcome.ok).toBe(true);
    expect(openStudioSession(rig.root).kind).toBe("busy");
    expect(readFileSync(join(rig.root, "working-sets", "w.json"), "utf8")).toBe(
      before,
    );
    rig.session.close();
  });

  test("list refuses an unknown kind", async () => {
    const { outcome } = await run({ studioRoot: tempRoot() }, "list", {
      kind: "secrets",
    });

    expect(codeOf(outcome)).toBe("invalid-arguments");
  });

  test("derive is explicitly unsupported and writes nothing", async () => {
    const root = tempRoot();
    const { outcome } = await run({ studioRoot: root }, "derive", {});

    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "unsupported", verb: "derive" },
    });
    expect(exitOf(outcome)).toBe(1);
    expect(readStudioStatus(root).requests).toEqual([]);
    expect(openStudioSession(root).kind).toBe("opened");
  });

  test("a mutating command against a root another process owns is refused as busy, while reads still work", async () => {
    const rig = assetRig();
    spriteSet(rig);
    const config: StudioConfig = { studioRoot: rig.root };

    for (const [op, args] of [
      ["remove", { jobId: "zeus-idle-0000" }],
      ["abort", { jobId: "zeus-idle-0000" }],
      ["pick", { workingSetId: "w", candidateId: "zeus-idle-0000" }],
      ["discard", { id: "e1" }],
      ["reject", { id: "none" }],
    ] as const) {
      const { outcome } = await run(config, op, args);
      expect(codeOf(outcome), op).toBe("busy");
      expect(exitOf(outcome)).toBe(1);
    }
    expect((await run(config, "status", {})).outcome.ok).toBe(true);
    rig.session.close();
  });
});

describe("hand edits are reported, never replaced", () => {
  function offPaletteSet() {
    const rig = assetRig();
    const [id] = runSlots(rig, "zeus-idle", "sprite", [
      { state: "idle", direction: "south" },
    ]);
    rig.session.openWorkingSet("w", "zeus-idle", rig.content);
    rig.session.pick("w", id as string);
    const frames = [0, 1, 2, 3].map((i) =>
      paintFigure(rig.content, { w: 64, h: 80 }, i),
    );
    frames[1]?.rgba.set([255, 0, 255, 255], (20 * 64 + 20) * 4);
    finishSheet(rig, "e1", "w", { w: 64, h: 80 }, [
      { slot: "idle/south", frames },
    ]);
    return rig;
  }

  test("a hand-finished slot whose conform would change pixels exits 1 with the exact diff and leaves every stored byte alone", async () => {
    const rig = offPaletteSet();
    rig.session.close();
    const bytes = (path: string) => readFileSync(path);
    const set = readStudioStatus(rig.root).workingSets[0];
    const hashes = set?.frames["idle/south"]?.frames.map((f) => f.hash) ?? [];
    const before = hashes.map((h) =>
      bytes(join(rig.root, "blobs", `${h}.png`)),
    );
    const setBytes = readFileSync(
      join(rig.root, "working-sets", "w.json"),
      "utf8",
    );
    const edit = readStudioStatus(rig.root).edits[0];
    const expectedDiff =
      edit?.preview?.slots["idle/south"]?.reports[1]?.diff ?? [];
    expect(expectedDiff.length).toBeGreaterThan(0);

    const { outcome } = await run(
      { studioRoot: rig.root, contentRoot: "/content" },
      "report",
      { workingSetId: "w", slot: "idle/south" },
      { loadContent: () => ({ ok: true as const, content: rig.content }) },
    );

    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "proposal-would-replace", source: "hand" },
    });
    expect(exitOf(outcome)).toBe(1);
    const frames = (!outcome.ok ? outcome.error.frames : []) as unknown as {
      index: number;
      pixelsChanged: number;
      diff: unknown[];
    }[];
    expect(frames).toHaveLength(4);
    expect(frames[1]?.pixelsChanged).toBe(expectedDiff.length);
    expect(frames[1]?.diff).toEqual(JSON.parse(JSON.stringify(expectedDiff)));
    expect(frames[0]?.pixelsChanged).toBe(0);
    expect(
      hashes.map((h) => bytes(join(rig.root, "blobs", `${h}.png`))),
    ).toEqual(before);
    expect(readFileSync(join(rig.root, "working-sets", "w.json"), "utf8")).toBe(
      setBytes,
    );
    expect(readStudioStatus(rig.root).assets).toEqual([]);
  });

  test("a clean hand slot passes, an unknown slot or set is not found, and no content root is a config error", async () => {
    const rig = assetRig();
    spriteSet(rig);
    rig.session.close();
    const config: StudioConfig = {
      studioRoot: rig.root,
      contentRoot: "/content",
    };
    const over = {
      loadContent: () => ({ ok: true as const, content: rig.content }),
    };

    const clean = await run(
      config,
      "report",
      { workingSetId: "w", slot: "idle/south" },
      over,
    );
    const unknown = await run(
      config,
      "report",
      { workingSetId: "w", slot: "idle/west" },
      over,
    );
    const noSet = await run(
      config,
      "report",
      { workingSetId: "nope", slot: "idle/south" },
      over,
    );
    const noContent = await run(
      { studioRoot: rig.root },
      "report",
      { workingSetId: "w", slot: "idle/south" },
      over,
    );

    expect(clean.outcome).toMatchObject({
      ok: true,
      result: { source: "hand" },
    });
    expect(codeOf(unknown.outcome)).toBe("not-found");
    expect(codeOf(noSet.outcome)).toBe("not-found");
    expect(noContent.outcome).toMatchObject({
      ok: false,
      error: { code: "missing-config", field: "contentRoot" },
    });
  });

  const rootBytes = (root: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (!name.startsWith("session.lock"))
          out[relative(root, path)] = readFileSync(path).toString("base64");
      }
    };
    walk(root);
    return out;
  };

  test("a palette change under a new content root is reported fresh with the replacing diff, exits 1, and every stored byte stays identical", async () => {
    const rig = assetRig();
    spriteSet(rig);
    rig.session.close();
    const same = contentRootWithPalette(paletteFixture().files);
    const moved = contentRootWithPalette(olympusMovedPaletteFiles());
    const before = rootBytes(rig.root);

    const clean = await run(
      { studioRoot: rig.root, contentRoot: same },
      "report",
      { workingSetId: "w", slot: "idle/south" },
    );
    const changed = await run(
      { studioRoot: rig.root, contentRoot: moved },
      "report",
      { workingSetId: "w", slot: "idle/south" },
    );

    expect(clean.outcome).toMatchObject({
      ok: true,
      result: { source: "hand" },
    });
    expect(exitOf(clean.outcome)).toBe(0);
    expect(changed.outcome).toMatchObject({
      ok: false,
      error: { code: "proposal-would-replace", source: "hand" },
    });
    expect(exitOf(changed.outcome)).toBe(1);
    const frames = (!changed.outcome.ok
      ? changed.outcome.error.frames
      : []) as unknown as {
      index: number;
      report: string;
      pixelsChanged: number;
      diff: unknown[];
    }[];
    expect(frames).toHaveLength(4);
    expect(
      frames.every((f) => f.report === "fail" && f.pixelsChanged > 0),
    ).toBe(true);
    expect(frames.every((f) => f.diff.length === f.pixelsChanged)).toBe(true);
    expect(rootBytes(rig.root)).toEqual(before);
    expect(readStudioStatus(rig.root).assets).toEqual([]);
    expect(readStudioStatus(rig.root).session?.endedAt).toBeString();
  });

  test("a picked-only slot is reported fresh against a changed palette too", async () => {
    const rig = assetRig();
    const [id] = runSlots(rig, "zeus-idle", "sprite", [
      { state: "idle", direction: "south" },
    ]);
    rig.session.openWorkingSet("w", "zeus-idle", rig.content);
    rig.session.pick("w", id as string);
    rig.session.close();
    const moved = contentRootWithPalette(olympusMovedPaletteFiles());

    const clean = await run(
      {
        studioRoot: rig.root,
        contentRoot: contentRootWithPalette(paletteFixture().files),
      },
      "report",
      { workingSetId: "w", slot: "idle/south" },
    );
    const changed = await run(
      { studioRoot: rig.root, contentRoot: moved },
      "report",
      { workingSetId: "w", slot: "idle/south" },
    );

    expect(clean.outcome).toMatchObject({
      ok: true,
      result: { source: "pick" },
    });
    expect(changed.outcome).toMatchObject({
      ok: false,
      error: { code: "proposal-would-replace", source: "pick" },
    });
  });

  test("the report reads a root another process owns and takes no writer lock", async () => {
    const rig = assetRig();
    spriteSet(rig);
    const moved = contentRootWithPalette(olympusMovedPaletteFiles());

    const { outcome } = await run(
      { studioRoot: rig.root, contentRoot: moved },
      "report",
      { workingSetId: "w", slot: "idle/south" },
    );

    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "proposal-would-replace" },
    });
    expect(openStudioSession(rig.root).kind).toBe("busy");
    rig.session.close();
  });

  test("a stored frame that is gone or altered is a typed refusal that prints no pixels", async () => {
    const rig = assetRig();
    spriteSet(rig);
    rig.session.close();
    const hash = readStudioStatus(rig.root).workingSets[0]?.frames["idle/south"]
      ?.frames[1]?.hash as string;
    writeFileSync(join(rig.root, "blobs", `${hash}.png`), "SECRET-PIXELS");

    const { outcome } = await run(
      { studioRoot: rig.root, contentRoot: "/content" },
      "report",
      { workingSetId: "w", slot: "idle/south" },
      { loadContent: () => ({ ok: true as const, content: rig.content }) },
    );

    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "corrupt-blob" },
    });
    expect(exitOf(outcome)).toBe(1);
    expect(JSON.stringify(outcome)).not.toContain("SECRET-PIXELS");
  });
});

describe("conform, sets, picks and rejection through the session", () => {
  test("conform a generated job with a named config set, then open a set and pick its candidate", async () => {
    const rig = assetRig();
    const [jobId] = runSlots(rig, "zeus-idle", "sprite", [
      { state: "idle", direction: "south" },
    ]);
    rig.session.close();
    const config: StudioConfig = {
      studioRoot: rig.root,
      contentRoot: "/content",
      conform: { standard: PROVISIONAL_TEST_PARAMS },
    };
    const over = {
      loadContent: () => ({ ok: true as const, content: rig.content }),
    };

    const conformed = await run(
      config,
      "conform",
      { jobId, set: "standard" },
      over,
    );
    const opened = await run(
      config,
      "set-create",
      { id: "w", requestId: "zeus-idle" },
      over,
    );
    const picked = await run(
      config,
      "pick",
      { workingSetId: "w", candidateId: jobId },
      over,
    );

    expect(conformed.outcome).toMatchObject({
      ok: true,
      result: {
        id: jobId,
        status: "done",
        report: { status: "pass", failedChecks: [] },
        scale: expect.any(Number),
        coloursMerged: expect.any(Number),
        pixelsChanged: expect.any(Number),
      },
    });
    expect(opened.outcome.ok && picked.outcome.ok).toBe(true);
    expect(
      readStudioStatus(rig.root).workingSets[0]?.picks["idle/south"]
        ?.candidateId,
    ).toBe(jobId);
  });

  test("conform needs exactly one of a named set and inline params, and every numeric threshold explicit", async () => {
    const root = tempRoot();
    const config: StudioConfig = {
      studioRoot: root,
      contentRoot: "/content",
      conform: { standard: PROVISIONAL_TEST_PARAMS },
    };

    const both = await run(config, "conform", {
      jobId: "j",
      set: "standard",
      params: PROVISIONAL_TEST_PARAMS,
    });
    const neither = await run(config, "conform", { jobId: "j" });
    const unnamed = await run(config, "conform", { jobId: "j", set: "other" });
    const incomplete = await run(config, "conform", {
      jobId: "j",
      params: { background: { type: "alpha" }, alphaCutoff: 128 },
    });

    expect(codeOf(both.outcome)).toBe("invalid-arguments");
    expect(codeOf(neither.outcome)).toBe("invalid-arguments");
    expect(codeOf(unnamed.outcome)).toBe("invalid-config");
    expect(codeOf(incomplete.outcome)).toBe("invalid-arguments");
    expect(
      [both, neither, unnamed, incomplete].every(
        (r) => exitOf(r.outcome) === 64,
      ),
    ).toBe(true);
  });

  test("a sheet is replaced by a later request and the picks stay", async () => {
    const rig = assetRig();
    const [first] = runSlots(rig, "zeus-idle", "sprite", [
      { state: "idle", direction: "south" },
    ]);
    rig.session.openWorkingSet("w", "zeus-idle", rig.content);
    rig.session.pick("w", first as string);
    runSlots(
      rig,
      "zeus-again",
      "sprite",
      [{ state: "idle", direction: "south" }],
      300,
    );
    rig.session.close();
    const config: StudioConfig = {
      studioRoot: rig.root,
      contentRoot: "/content",
    };

    const replaced = await run(config, "set-replace-sheet", {
      workingSetId: "w",
      requestId: "zeus-again",
    });

    expect(replaced.outcome).toMatchObject({
      ok: true,
      result: { workingSetId: "w", sheetRequestId: "zeus-again" },
    });
    const set = readStudioStatus(rig.root).workingSets[0];
    expect(set?.sheetRequestId).toBe("zeus-again");
    expect(set?.picks["idle/south"]?.candidateId).toBe(first);
  });

  test("pick --slot puts one neutral candidate into every portrait slot and keeps its lineage; a sprite refuses another slot", async () => {
    const rig = assetRig();
    const expressions = [...rig.content.vocabulary.expressions];
    runSlots(
      rig,
      "zeus-faces",
      "portrait",
      expressions.map((expression) => ({ expression })),
    );
    const [neutral] = runSlots(
      rig,
      "zeus-neutral",
      "portrait",
      [{ expression: "neutral" }],
      300,
    ) as [string];
    const [south] = runSlots(rig, "zeus-idle", "sprite", [
      { state: "idle", direction: "south" },
      { state: "idle", direction: "north" },
    ]) as [string];
    rig.session.close();
    const config: StudioConfig = {
      studioRoot: rig.root,
      contentRoot: "/content",
    };
    const over = {
      loadContent: () => ({ ok: true as const, content: rig.content }),
    };

    const created = await run(
      config,
      "set-create",
      { id: "faces", requestId: "zeus-faces" },
      over,
    );
    const switched = await run(config, "set-replace-sheet", {
      workingSetId: "faces",
      requestId: "zeus-neutral",
    });
    const results = [];
    for (const slot of expressions)
      results.push(
        await run(config, "pick", {
          workingSetId: "faces",
          candidateId: neutral,
          slot,
        }),
      );
    const sprite = await run(
      config,
      "set-create",
      { id: "walk", requestId: "zeus-idle" },
      over,
    );
    const refused = await run(config, "pick", {
      workingSetId: "walk",
      candidateId: south,
      slot: "idle/north",
    });
    const own = await run(config, "pick", {
      workingSetId: "walk",
      candidateId: south,
    });

    expect(created.outcome.ok && switched.outcome.ok && sprite.outcome.ok).toBe(
      true,
    );
    expect(results.every((r) => r.outcome.ok)).toBe(true);
    expect(results[1]?.outcome).toMatchObject({
      ok: true,
      result: { workingSetId: "faces", candidateId: neutral, slot: "pleased" },
    });
    const status = readStudioStatus(rig.root);
    const faces = status.workingSets.find((w) => w.id === "faces");
    expect(faces?.status).toBe("complete");
    for (const expression of expressions)
      expect(faces?.picks[expression]).toMatchObject({
        candidateId: neutral,
        source: { slotKey: "neutral" },
      });
    expect(codeOf(refused.outcome)).toBe("wrong-state");
    expect(own.outcome).toMatchObject({
      ok: true,
      result: { workingSetId: "walk", candidateId: south },
    });
    expect(
      status.workingSets.find((w) => w.id === "walk")?.picks,
    ).toHaveProperty("idle/south");
  });

  test("a packed draft is rejected once, with the reason, and then cannot be approved", async () => {
    const rig = assetRig();
    spriteSet(rig);
    rig.session.pack(
      {
        id: "p1",
        workingSetId: "w",
        assetId: "placeholder-zeus",
        styleTag: "d",
        footprint: { w: 1, h: 1 },
        originalWork: { licence: "MIT" },
      },
      rig.content,
      rig.palette,
      rig.registryRoot,
    );
    rig.session.close();
    const config: StudioConfig = {
      studioRoot: rig.root,
      contentRoot: "/content",
      registryRoot: rig.registryRoot,
    };
    const over = {
      loadContent: () => ({ ok: true as const, content: rig.content }),
    };

    const rejected = await run(
      config,
      "reject",
      { id: "p1", reason: "wrong loop" },
      over,
    );
    const again = await run(config, "reject", { id: "p1" }, over);
    const approve = await run(config, "approve", { id: "p1" }, over);

    expect(rejected.outcome).toMatchObject({
      ok: true,
      result: { id: "p1", state: "rejected" },
    });
    expect(codeOf(again.outcome)).toBe("wrong-state");
    expect(codeOf(approve.outcome)).toBe("wrong-state");
  });

  test("a stored session cannot be removed or aborted from outside: queued jobs left behind are failed on reopen, so remove is wrong-state and abort is not-running", async () => {
    const rig = assetRig();
    rig.session.enqueue(
      { requestId: "r", slotKey: "idle/south", ordinal: 0 },
      queuedJob("left-behind"),
    );
    rig.session.close();
    const config: StudioConfig = { studioRoot: rig.root };

    const removed = await run(config, "remove", { jobId: "left-behind" });
    const aborted = await run(config, "abort", { jobId: "left-behind" });

    expect(codeOf(removed.outcome)).toBe("wrong-state");
    expect(codeOf(aborted.outcome)).toBe("not-running");
    expect(exitOf(aborted.outcome)).toBe(1);
  });
});

void doneCandidate;
void keyframe;
void loadContent;
void workingSet;
void readLog;
void alive;
void capture;
void depsFor;
void execute;
void runtimeRig;
void waitFor;
void writeFileSync;
void Studio;

describe("edit-report", () => {
  const cell = { w: 64, h: 80 };
  const treeOf = (root: string) => {
    const out: Record<string, string> = {};
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (!name.startsWith("session.lock"))
          out[relative(root, path)] = readFileSync(path).toString("base64");
      }
    };
    walk(root);
    return out;
  };

  /** A finished edit e1 and an open edit e2 on the same slot, both owned by a session in this process. */
  function twoEdits() {
    const rig = assetRig();
    const { frames } = spriteSet(rig);
    rig.session.openEdit("e2", "w", ["idle/south"], rig.content);
    return { rig, frames };
  }

  test("a finished edit answers while another session holds the lock, and reads without writing", async () => {
    const { rig } = twoEdits();
    const before = treeOf(rig.root);

    const { outcome } = await run({ studioRoot: rig.root }, "edit-report", {
      id: "e1",
    });

    expect(outcome).toMatchObject({
      ok: true,
      result: {
        editId: "e1",
        workingSetId: "w",
        state: "finished",
        slots: [
          {
            slot: "idle/south",
            diffAgainst: "recorded",
            addedFrames: [1, 2, 3],
            removedFrames: [],
          },
        ],
      },
    });
    expect(openStudioSession(rig.root).kind).toBe("busy");
    expect(treeOf(rig.root)).toEqual(before);
    rig.session.close();
  });

  test("a second save of a re-edit shows the pixels that changed since the edit it started from, and nothing for the frames it left alone", async () => {
    const { rig, frames } = twoEdits();
    const edited = [
      frames[0],
      frames[1],
      paintFigure(rig.content, cell, 7),
      frames[3],
    ] as NonNullable<(typeof frames)[number]>[];
    const sheet = sheetOf(cell, [{ slot: "idle/south", frames: edited }]);
    expect(
      rig.session.importEdit("e2", sheet.png, sheet.json, rig.content),
    ).toEqual({ ok: true, changed: true });

    const { outcome } = await run({ studioRoot: rig.root }, "edit-report", {
      id: "e2",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const slot = (
      outcome.result as {
        state: string;
        slots: {
          frames: {
            index: number;
            change: string;
            pixelsChanged: number;
            diff: unknown[];
          }[];
          removedFrames: number[];
        }[];
      }
    ).slots[0];
    expect((outcome.result as { state: string }).state).toBe("open");
    expect(slot?.frames.map((f) => f.change)).toEqual([
      "unchanged",
      "unchanged",
      "changed",
      "unchanged",
    ]);
    expect(slot?.frames[2]?.pixelsChanged).toBeGreaterThan(0);
    expect(slot?.frames[2]?.diff).toHaveLength(
      slot?.frames[2]?.pixelsChanged as number,
    );
    expect(slot?.frames[0]?.pixelsChanged).toBe(0);
    expect(slot?.removedFrames).toEqual([]);
    rig.session.close();
  });

  test("an unknown edit, an edit with no save, a discarded edit and a bad id are refused, each without a write", async () => {
    const { rig } = twoEdits();
    const config: StudioConfig = { studioRoot: rig.root };
    const unsaved = (await run(config, "edit-report", { id: "e2" })).outcome;
    rig.session.discardEdit("e2");
    rig.session.openEdit("e3", "w", ["idle/south"], rig.content);
    const sheet = sheetOf(cell, [
      { slot: "idle/south", frames: [paintFigure(rig.content, cell, 9)] },
    ]);
    rig.session.importEdit("e3", sheet.png, sheet.json, rig.content);
    rig.session.discardEdit("e3");
    const before = treeOf(rig.root);

    const results = {
      unknown: (await run(config, "edit-report", { id: "nope" })).outcome,
      unsaved,
      discarded: (await run(config, "edit-report", { id: "e3" })).outcome,
      path: (await run(config, "edit-report", { id: "../../etc" })).outcome,
    };

    expect(codeOf(results.unknown)).toBe("not-found");
    expect(codeOf(results.unsaved)).toBe("wrong-state");
    expect(codeOf(results.discarded)).toBe("wrong-state");
    expect(codeOf(results.path)).toBe("not-found");
    for (const outcome of Object.values(results))
      expect(exitOf(outcome)).toBe(1);
    expect(treeOf(rig.root)).toEqual(before);
    rig.session.close();
  });

  test("it takes an id and nothing else, and needs a configured root", async () => {
    const config: StudioConfig = { studioRoot: tempRoot() };
    for (const args of [
      {},
      { id: "" },
      { id: 3 },
      { id: "e1", extra: 1 },
      { id: "e1", path: "/tmp/x" },
      [],
      null,
    ]) {
      const { outcome } = await run(config, "edit-report", args);
      expect(codeOf(outcome), JSON.stringify(args)).toBe("invalid-arguments");
    }
    const none = await run({}, "edit-report", { id: "e1" });
    expect(none.outcome).toMatchObject({
      ok: false,
      error: { code: "missing-config", field: "studioRoot" },
    });
    expect(exitOf(none.outcome)).toBe(64);
  });

  test("it is a lock-free read: listed read-only, and still answered while the session is shutting down", async () => {
    expect(READ_ONLY.has("edit-report")).toBe(true);
    const { rig } = twoEdits();
    const studio = new Studio(
      { studioRoot: rig.root },
      depsFor(capture()),
      "session",
    );
    await studio.teardown();
    expect(studio.stopping).toBe(true);

    const read = await execute(studio, "edit-report", { id: "e1" });
    const write = await execute(studio, "remove", { jobId: "zeus-idle-0000" });

    expect(read.ok).toBe(true);
    expect(write).toMatchObject({
      ok: false,
      error: { code: "shutting-down" },
    });
    rig.session.close();
  });

  test("a stored frame that is gone is a typed refusal that prints no pixels", async () => {
    const { rig } = twoEdits();
    rig.session.close();
    const hash = readStudioStatus(rig.root).edits.find((e) => e.id === "e1")
      ?.preview?.slots["idle/south"]?.frames[0]?.hash as string;
    writeFileSync(join(rig.root, "blobs", `${hash}.png`), "SECRET-PIXELS");

    const { outcome } = await run({ studioRoot: rig.root }, "edit-report", {
      id: "e1",
    });

    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "corrupt-blob" },
    });
    expect(JSON.stringify(outcome)).not.toContain("SECRET-PIXELS");
  });
});

describe("candidate-frames and candidate-bytes", () => {
  const sha = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");

  function withCandidate() {
    const rig = assetRig();
    spriteSet(rig);
    const candidate = readStudioStatus(rig.root).candidates.find(
      (c) => c.id === "zeus-idle-0000",
    );
    if (candidate?.result.status !== "done") throw new Error("not conformed");
    return { rig, imageHash: candidate.result.imageHash as string };
  }

  test("candidate-frames lists the frame's metadata with no pixels, while another session holds the lock", async () => {
    const { rig, imageHash } = withCandidate();

    const { outcome } = await run(
      { studioRoot: rig.root },
      "candidate-frames",
      {
        candidateId: "zeus-idle-0000",
      },
    );

    expect(outcome).toMatchObject({
      ok: true,
      result: {
        candidateId: "zeus-idle-0000",
        width: 64,
        height: 80,
        frames: [{ index: 0, durationMs: null, imageHash }],
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("base64");
    expect(openStudioSession(rig.root).kind).toBe("busy");
    rig.session.close();
  });

  test("candidate-bytes returns each frame's PNG as base64 that matches its hash", async () => {
    const { rig, imageHash } = withCandidate();

    const { outcome } = await run({ studioRoot: rig.root }, "candidate-bytes", {
      candidateId: "zeus-idle-0000",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const reply = outcome.result as {
      candidateId: string;
      width: number;
      height: number;
      frames: {
        index: number;
        durationMs: number | null;
        imageHash: string;
        base64: string;
      }[];
    };
    expect(reply).toMatchObject({
      candidateId: "zeus-idle-0000",
      width: 64,
      height: 80,
    });
    expect(reply.frames).toHaveLength(1);
    expect(reply.frames[0]).toMatchObject({
      index: 0,
      durationMs: null,
      imageHash,
    });
    const bytes = Buffer.from(reply.frames[0]?.base64 as string, "base64");
    expect(sha(bytes)).toBe(imageHash);
    expect([...bytes.subarray(0, 4)]).toEqual([137, 80, 78, 71]);
    expect(Object.keys(reply.frames[0] as object).sort()).toEqual([
      "base64",
      "durationMs",
      "imageHash",
      "index",
    ]);
    rig.session.close();
  });

  test("both refuse an unknown candidate and a needs-scale one, each without a write", async () => {
    const { rig } = withCandidate();
    rig.session.store.putCandidate(needsScaleCandidate("stuck"));
    const config: StudioConfig = { studioRoot: rig.root };

    for (const op of ["candidate-frames", "candidate-bytes"]) {
      const unknown = await run(config, op, { candidateId: "nope" });
      const bad = await run(config, op, { candidateId: "../../etc" });
      const stuck = await run(config, op, { candidateId: "stuck" });
      expect(codeOf(unknown.outcome), op).toBe("not-found");
      expect(codeOf(bad.outcome), op).toBe("not-found");
      expect(codeOf(stuck.outcome), op).toBe("wrong-state");
      expect(exitOf(unknown.outcome)).toBe(1);
    }
    rig.session.close();
  });

  test("a tampered or missing blob is corrupt-blob for both, and the refusal prints no pixels", async () => {
    const { rig, imageHash } = withCandidate();
    rig.session.close();
    writeFileSync(join(rig.root, "blobs", `${imageHash}.png`), "SECRET-PIXELS");

    for (const op of ["candidate-frames", "candidate-bytes"]) {
      const { outcome } = await run({ studioRoot: rig.root }, op, {
        candidateId: "zeus-idle-0000",
      });
      expect(outcome, op).toMatchObject({
        ok: false,
        error: { code: "corrupt-blob" },
      });
      expect(JSON.stringify(outcome)).not.toContain("SECRET-PIXELS");
    }
  });

  test("each takes a candidate id and nothing else, and needs a configured root", async () => {
    const config: StudioConfig = { studioRoot: tempRoot() };
    for (const op of ["candidate-frames", "candidate-bytes"]) {
      for (const args of [
        {},
        { candidateId: "" },
        { candidateId: 3 },
        { candidateId: "a", extra: 1 },
        { candidateId: "a", path: "/tmp/x" },
        { candidateId: "a", frame: 0 },
        { id: "a" },
        [],
      ]) {
        const { outcome } = await run(config, op, args);
        expect(codeOf(outcome), `${op} ${JSON.stringify(args)}`).toBe(
          "invalid-arguments",
        );
      }
      const none = await run({}, op, { candidateId: "a" });
      expect(none.outcome).toMatchObject({
        ok: false,
        error: { code: "missing-config", field: "studioRoot" },
      });
    }
  });

  test("both are lock-free reads, still answered while the session is shutting down", async () => {
    expect(READ_ONLY.has("candidate-frames")).toBe(true);
    expect(READ_ONLY.has("candidate-bytes")).toBe(true);
    const { rig } = withCandidate();
    const studio = new Studio(
      { studioRoot: rig.root },
      depsFor(capture()),
      "session",
    );
    await studio.teardown();

    const frames = await execute(studio, "candidate-frames", {
      candidateId: "zeus-idle-0000",
    });
    const bytes = await execute(studio, "candidate-bytes", {
      candidateId: "zeus-idle-0000",
    });

    expect(frames.ok && bytes.ok).toBe(true);
    rig.session.close();
  });
});

describe("what the app needs to conform a job", () => {
  const over = (rig: AssetRig) => ({
    loadContent: () => ({ ok: true as const, content: rig.content }),
  });

  test("status lists the names of the configured conform sets and nothing of their settings", async () => {
    const rig = assetRig();
    rig.session.close();
    const config: StudioConfig = {
      studioRoot: rig.root,
      conform: {
        standard: PROVISIONAL_TEST_PARAMS,
        "scale-4": PROVISIONAL_TEST_PARAMS,
      },
    };

    const { outcome } = await run(config, "status", {});

    expect(outcome).toMatchObject({
      ok: true,
      result: { conformSets: ["scale-4", "standard"] },
    });
    expect(JSON.stringify(outcome)).not.toContain("alphaCutoff");
    const none = await run({ studioRoot: rig.root }, "status", {});
    expect(none.outcome).toMatchObject({
      ok: true,
      result: { conformSets: [] },
    });
  });

  test("list jobs says which succeeded jobs have a candidate, and list candidates carries the real summary", async () => {
    const rig = assetRig();
    const ids = runSlots(rig, "zeus-idle", "sprite", [
      { state: "idle", direction: "south" },
      { state: "idle", direction: "north" },
    ]);
    // A third job that succeeded but was never conformed.
    const second = runSlots(rig, "zeus-walk", "sprite", [
      { state: "idle", direction: "south" },
    ]);
    rig.session.store.putCandidate(needsScaleCandidate(second[0] as string));
    rig.session.close();
    const config: StudioConfig = { studioRoot: rig.root };

    const jobs = await run(config, "list", { kind: "jobs" });
    const candidates = await run(config, "list", { kind: "candidates" });

    expect(jobs.outcome.ok && jobs.outcome.result).toEqual(
      expect.arrayContaining(
        ids.map((id) => expect.objectContaining({ id, candidate: "done" })),
      ),
    );
    expect(jobs.outcome.ok && jobs.outcome.result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: second[0], candidate: "needs-scale" }),
      ]),
    );
    expect(candidates.outcome.ok && candidates.outcome.result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: ids[0],
          report: { status: "pass", failedChecks: [] },
          scale: 8,
        }),
      ]),
    );
  });

  test("a succeeded job that was never conformed reads candidate null, and conforming it with a named set makes it done", async () => {
    const rig = assetRig();
    const built = newRequestRecord(
      rig.content,
      {
        id: "zeus-idle",
        subject: "zeus",
        kind: "sprite",
        slots: [{ state: "idle", direction: "south" }],
        batch: 1,
        seed: 100,
      },
      () => 0,
    );
    if (!built.ok) throw new Error("request");
    const submitted = rig.session.submitRequest(built.value.record);
    if (!submitted.ok) throw new Error("submit");
    const [jobId] = submitted.jobIds;
    succeedWithImage(
      rig.session,
      jobId as string,
      pngOf(upscale(paintFigure(rig.content, { w: 64, h: 80 }, 0), 8)),
      { w: 512, h: 640 },
      rig.engine,
    );
    rig.session.close();
    const config: StudioConfig = {
      studioRoot: rig.root,
      contentRoot: "/content",
      conform: { standard: PROVISIONAL_TEST_PARAMS },
    };

    const before = await run(config, "list", { kind: "jobs" });
    const conformed = await run(
      config,
      "conform",
      { jobId, set: "standard" },
      over(rig),
    );
    const after = await run(config, "list", { kind: "jobs" });

    expect(before.outcome.ok && before.outcome.result).toEqual([
      expect.objectContaining({
        id: jobId,
        status: "succeeded",
        candidate: null,
      }),
    ]);
    expect(conformed.outcome.ok).toBe(true);
    expect(after.outcome.ok && after.outcome.result).toEqual([
      expect.objectContaining({ id: jobId, candidate: "done" }),
    ]);
  });

  test("conform takes a set name or inline params and nothing that names a file", async () => {
    const config: StudioConfig = { studioRoot: tempRoot() };
    for (const args of [
      { jobId: "j", set: "s", path: "/tmp/x.json" },
      { jobId: "j", file: "/tmp/x.json" },
      { jobId: "j", set: "s", params: {} },
      { jobId: "j" },
      { set: "s" },
    ]) {
      const { outcome } = await run(config, "conform", args);
      expect(codeOf(outcome), JSON.stringify(args)).toBe("invalid-arguments");
    }
    expect(
      (await run(config, "conform", { jobId: "j", set: "missing" })).outcome,
    ).toMatchObject({ ok: false, error: { code: "invalid-config" } });
  });
});

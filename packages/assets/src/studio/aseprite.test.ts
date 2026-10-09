import { afterEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { Sha256 } from "@panthea/contracts";
import type { RgbaImage } from "../conformance";
import { sha256Hex } from "../hash";
import { encodeRgbaPng } from "../placeholder";
import {
  doneCandidate,
  keyframe,
  loadContent,
  removeTempRoots,
  tempRoot,
  toneFrame,
  workingSet,
} from "./_test-fixtures";
import {
  createEditorAdapter,
  type EditorAdapter,
  resolveAseprite,
} from "./aseprite";
import { sheetJson } from "./export-import";
import { decodePng } from "./png/decode";
import { openStudioSession, type StudioSession } from "./session";
import { readStudioStatus } from "./store";

const content = loadContent();
const cell = { w: 64, h: 80 };
const scratch: string[] = [];
const pids = new Set<number>();
const adapters: EditorAdapter[] = [];

afterEach(async () => {
  for (const adapter of adapters.splice(0)) await adapter.close();
  for (const pid of pids) {
    try {
      process.kill(pid, 0);
      process.kill(pid, "SIGKILL");
      throw new Error(`fake editor ${pid} outlived its test`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  pids.clear();
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
  removeTempRoots();
});

const scratchDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-ase-test-"));
  scratch.push(dir);
  return dir;
};

const FAKE = `
const fs = require("node:fs");
const path = require("node:path");
const dir = __dirname;
const behavior = JSON.parse(fs.readFileSync(path.join(dir, "behavior.json"), "utf8"));
const args = process.argv.slice(2);
if (args[0] === "--warm") process.exit(behavior.warmExit || 0);
fs.appendFileSync(path.join(dir, "calls.jsonl"), JSON.stringify({ pid: process.pid, argv: args, envKeys: Object.keys(process.env) }) + "\\n");
if (behavior.exit) { console.error("the fake editor failed on purpose"); process.exit(behavior.exit); }
if (behavior.hang) setInterval(() => {}, 1000);
else setTimeout(() => {
  const flag = (name) => args[args.indexOf(name) + 1];
  const params = {};
  args.forEach((a, i) => { if (a === "--script-param") { const [k, ...v] = args[i + 1].split("="); params[k] = v.join("="); } });
  if (args.includes("--script")) {
    fs.writeFileSync(params.out, "FAKE-ASEPRITE-WORKSPACE");
    console.log(behavior.readback || "");
    process.exit(0);
  }
  if (args.includes("--sheet") && !behavior.skipOutputs) {
    fs.writeFileSync(flag("--sheet"), Buffer.from(behavior.sheetBase64, "base64"));
    const json = behavior.json;
    fs.writeFileSync(flag("--data"), behavior.partialJson ? json.slice(0, 60) : json);
  }
  process.exit(0);
}, behavior.delayMs || 0);
`;

interface Fake {
  readonly dir: string;
  readonly executable: string;
  set(behavior: Record<string, unknown>): void;
  current(): Record<string, unknown>;
  reset(): void;
  calls(): { pid: number; argv: string[]; envKeys: string[] }[];
}

function fakeEditor(
  parent = scratchDir(),
  name = "aseprite",
  warmExit = 0,
): Fake {
  mkdirSync(parent, { recursive: true });
  writeFileSync(join(parent, "fake.js"), FAKE);
  const executable = join(parent, name);
  writeFileSync(
    executable,
    `#!/bin/sh\nexec '${process.execPath}' '${join(parent, "fake.js")}' "$@"\n`,
  );
  chmodSync(executable, 0o755);
  writeFileSync(join(parent, "behavior.json"), JSON.stringify({ warmExit }));
  // The first exec of a freshly written wrapper can take hundreds of
  // milliseconds on the host; take that cost here, not inside a timeout the
  // fake's first real call is measured against.
  const warmed = spawnSync(executable, ["--warm"], {
    env: {},
    timeout: 30_000,
    killSignal: "SIGKILL",
    encoding: "utf8",
  });
  if (warmed.status !== 0)
    throw new Error(
      `fake editor warm-up failed: ${warmed.error?.message ?? `exit ${warmed.status}, signal ${warmed.signal}`}`,
    );
  const fake: Fake = {
    dir: parent,
    executable,
    set: (behavior) =>
      writeFileSync(join(parent, "behavior.json"), JSON.stringify(behavior)),
    current: () =>
      JSON.parse(readFileSync(join(parent, "behavior.json"), "utf8")),
    reset: () => {
      fake.calls();
      rmSync(join(parent, "calls.jsonl"), { force: true });
    },
    calls: () => {
      const log = join(parent, "calls.jsonl");
      const entries = existsSync(log)
        ? readFileSync(log, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l))
        : [];
      for (const entry of entries) pids.add(entry.pid);
      return entries;
    },
  };
  fake.set({});
  return fake;
}

const pngOf = (image: RgbaImage) =>
  encodeRgbaPng(image.rgba, image.width, image.height);
const strip = (images: RgbaImage[]): RgbaImage => {
  const width = cell.w;
  const rgba = new Uint8Array(width * images.length * cell.h * 4);
  images.forEach((image, index) => {
    for (let y = 0; y < cell.h; y += 1)
      rgba.set(
        image.rgba.subarray(y * width * 4, (y + 1) * width * 4),
        (y * width * images.length + index * width) * 4,
      );
  });
  return { rgba, width: width * images.length, height: cell.h };
};
const frames = (count: number, tone: number, hidden = 0) =>
  Array.from({ length: count }, (_, i) =>
    toneFrame(cell, tone + i, hidden + i),
  );

function openSession(root: string): StudioSession {
  const opened = openStudioSession(root);
  if (opened.kind === "busy") throw new Error("busy");
  return opened.session;
}

/** A session with one idle/south pick and an open edit on it. */
function rig() {
  const root = tempRoot();
  const session = openSession(root);
  const pick = {
    ...keyframe(doneCandidate("pick-0", { slotKey: "idle/south" })),
    imageHash: session.store.putBlob(pngOf(toneFrame(cell, 0, 9))),
  };
  session.store.putWorkingSet(
    workingSet("w", {
      required: ["idle/south"],
      picks: { "idle/south": pick },
    }),
  );
  session.openEdit("e1", "w", ["idle/south"], content);
  return { root, session };
}

const fourFrames = () => ({
  png: pngOf(strip(frames(4, 0, 20))),
  json: sheetJson(
    [
      {
        slot: "idle/south",
        durations: [123, 167, 250, 333],
        pivot: { x: 32, y: 80 },
      },
    ],
    cell,
  ),
});

function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (!name.startsWith("session.lock"))
        out[relative(root, path)] = Buffer.from(readFileSync(path)).toString(
          "base64",
        );
    }
  };
  walk(root);
  return out;
}

const adapterFor = (session: StudioSession, fake: Fake, timeoutMs = 5000) => {
  const adapter = createEditorAdapter(session, {
    executable: fake.executable,
    timeoutMs,
    tempParent: scratchDir(),
  });
  adapters.push(adapter);
  return adapter;
};

/** An adapter whose edit already has its workspace, so an export has something to read. */
const readyAdapter = async (
  session: StudioSession,
  fake: Fake,
  timeoutMs = 5000,
) => {
  const adapter = adapterFor(session, fake, timeoutMs);
  const behavior = fake.current();
  fake.set({ readback: "rgb=true" });
  expect((await adapter.openWorkspace("e1")).ok).toBe(true);
  fake.reset();
  fake.set(behavior);
  return adapter;
};

describe("the fake editor's warm-up", () => {
  const dead = (pid: number | undefined) => {
    try {
      process.kill(pid ?? 0, 0);
      return false;
    } catch {
      return true;
    }
  };

  test("--warm exits 0 at once, records no call and leaves nothing running", () => {
    const fake = fakeEditor();
    fake.reset();

    const result = spawnSync(fake.executable, ["--warm"], {
      env: {},
      timeout: 5000,
      killSignal: "SIGKILL",
      encoding: "utf8",
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    expect(fake.calls()).toEqual([]);
    expect(dead(result.pid)).toBe(true);
  });

  test("staging runs the warm-up and does not ignore its failure", () => {
    expect(() => fakeEditor(scratchDir(), "aseprite", 5)).toThrow(/warm-up/);
  });

  test("a staged fake has no calls until its first real one, which is then the only recorded call", () => {
    const fake = fakeEditor();
    expect(fake.calls()).toEqual([]);

    const result = spawnSync(fake.executable, ["--version"], {
      env: {},
      timeout: 5000,
      killSignal: "SIGKILL",
    });

    expect(result.status).toBe(0);
    expect(fake.calls().map((c) => c.argv)).toEqual([["--version"]]);
  });
});

describe("finding the editor", () => {
  const timeoutMs = 1000;

  test("a configured executable wins over PATH and the bundle", () => {
    const configured = fakeEditor();
    const onPath = fakeEditor();
    const bundle = fakeEditor();

    const found = resolveAseprite({
      executable: configured.executable,
      path: onPath.dir,
      platform: "darwin",
      bundleExecutable: bundle.executable,
      timeoutMs,
    });

    expect(found).toEqual({
      ok: true,
      path: configured.executable,
      source: "configured",
    });
  });

  test("PATH is searched next, in order, then the macOS bundle", () => {
    const first = fakeEditor();
    const second = fakeEditor();
    const bundle = fakeEditor();

    expect(
      resolveAseprite({
        path: `${first.dir}:${second.dir}`,
        platform: "linux",
        timeoutMs,
      }),
    ).toEqual({ ok: true, path: first.executable, source: "path" });
    expect(
      resolveAseprite({
        path: scratchDir(),
        platform: "darwin",
        bundleExecutable: bundle.executable,
        timeoutMs,
      }),
    ).toEqual({ ok: true, path: bundle.executable, source: "bundle" });
  });

  test("the bundle is only tried on macOS, and a file that is not executable is skipped", () => {
    const bundle = fakeEditor();
    const plain = fakeEditor();
    chmodSync(plain.executable, 0o644);

    const linux = resolveAseprite({
      path: scratchDir(),
      platform: "linux",
      bundleExecutable: bundle.executable,
      timeoutMs,
    });
    const skipped = resolveAseprite({
      executable: plain.executable,
      path: plain.dir,
      platform: "linux",
      timeoutMs,
    });

    expect(linux.ok).toBe(false);
    expect(skipped.ok).toBe(false);
  });

  test("a missing editor says what to do instead: export and import the sheet and metadata by hand", () => {
    const found = resolveAseprite({
      path: scratchDir(),
      platform: "linux",
      timeoutMs,
    });

    expect(found.ok).toBe(false);
    if (found.ok) return;
    expect(found.message).toMatch(/Aseprite/);
    expect(found.message).toMatch(/sheet\.png/);
    expect(found.message).toMatch(/sheet\.json/);
  });
});

describe("running the editor", () => {
  test("building a workspace runs a batch script with RGB parameters and a minimal environment", async () => {
    process.env.PANTHEA_TEST_SECRET = "do-not-leak";
    try {
      const { root, session } = rig();
      const fake = fakeEditor();
      fake.set({ readback: "rgb=true" });

      const result = await adapterFor(session, fake).openWorkspace("e1");

      expect(result.ok).toBe(true);
      const [call] = fake.calls();
      expect(call?.argv[0]).toBe("--batch");
      expect(call?.argv).toContain("--script");
      expect(call?.argv.at(-1)).toMatch(/scripts[\\/]export\.lua$/);
      const params = Object.fromEntries(
        (call?.argv ?? []).flatMap((a, i) =>
          a === "--script-param"
            ? [
                [
                  (call?.argv[i + 1] ?? "").split("=")[0],
                  (call?.argv[i + 1] ?? "").split("=").slice(1).join("="),
                ],
              ]
            : [],
        ),
      );
      expect(params).toMatchObject({
        cellw: "64",
        cellh: "80",
        durations: "334",
        tags: "idle/south:1:1",
        pivots: "",
      });
      expect(Object.keys(params).sort()).toEqual([
        "cellh",
        "cellw",
        "durations",
        "gpl",
        "out",
        "pivots",
        "sheet",
        "tags",
      ]);
      expect(call?.argv.join(" ")).not.toMatch(
        /--trim|--crop|--border-padding|--shape-padding|--inner-padding|--sheet-pack|--merge-duplicates/,
      );
      expect(call?.envKeys).not.toContain("PANTHEA_TEST_SECRET");
      expect(
        (call?.envKeys ?? []).filter(
          (k) => !["HOME", "PWD", "OLDPWD", "_", "SHLVL"].includes(k),
        ),
      ).toEqual([]);
      expect(params.out?.startsWith(root)).toBe(false);
      expect(params.sheet?.startsWith(root)).toBe(false);
      session.close();
    } finally {
      delete process.env.PANTHEA_TEST_SECRET;
    }
  });

  test("a good run stores the workspace in the edit and the readback comes from the script's output", async () => {
    const { session } = rig();
    const fake = fakeEditor();
    fake.set({
      readback: [
        "rgb=true",
        "size=64x80",
        "frames=1",
        "duration.1=167",
        "tag.idle/south=1-1 repeats=0",
        "slice.pivot:idle/south=nil",
        "palette.count=2",
        "palette.0=#526471",
        "palette.1=#8fa6ad",
      ].join("\n"),
    });

    const result = await adapterFor(session, fake).openWorkspace("e1");

    expect(result).toEqual({
      ok: true,
      readback: {
        rgb: true,
        size: { w: 64, h: 80 },
        durationsMs: [167],
        tags: [{ name: "idle/south", from: 1, to: 1, repeats: 0 }],
        pivots: { "idle/south": null },
        palette: ["#526471", "#8fa6ad"],
      },
    });
    expect(
      new TextDecoder().decode(
        session.store.readEditFile("e1", "workspace.aseprite"),
      ),
    ).toBe("FAKE-ASEPRITE-WORKSPACE");
    session.close();
  });

  test("an unchanged export is exported with the verified flags and imported through the one import path", async () => {
    const { root, session } = rig();
    const fake = fakeEditor();
    const edited = fourFrames();
    fake.set({
      sheetBase64: Buffer.from(edited.png).toString("base64"),
      json: edited.json,
    });

    const result = await (await readyAdapter(session, fake)).refresh(
      "e1",
      content,
      "import",
    );

    expect(result).toEqual({ ok: true, changed: true });
    const [call] = fake.calls();
    const flag = (name: string) =>
      call?.argv[(call?.argv.indexOf(name) ?? -1) + 1];
    expect(call?.argv.slice(0, 2)).toEqual(
      ["--batch", join(root, "edits", "e1", "workspace.aseprite")].map(
        (a, i) => (i === 1 ? call?.argv[1] : a),
      ),
    );
    expect(call?.argv).toEqual(
      expect.arrayContaining([
        "--sheet-type",
        "horizontal",
        "--format",
        "json-array",
        "--list-tags",
        "--list-slices",
        "--sheet",
        "--data",
      ]),
    );
    expect(flag("--sheet-type")).toBe("horizontal");
    expect(flag("--format")).toBe("json-array");
    expect(call?.argv.join(" ")).not.toMatch(
      /--trim|--crop|--border-padding|--shape-padding|--inner-padding|--sheet-pack|--merge-duplicates|--ignore-empty/,
    );
    expect(readStudioStatus(root).edits[0]?.preview?.sheetHash).toBe(
      sha256Hex(edited.png),
    );
    expect(session.store.readBlob(sha256Hex(edited.png) as Sha256)).toEqual(
      edited.png,
    );
    session.close();
  });

  test("finishing through the editor puts the frames into the working set", async () => {
    const { root, session } = rig();
    const fake = fakeEditor();
    const edited = fourFrames();
    fake.set({
      sheetBase64: Buffer.from(edited.png).toString("base64"),
      json: edited.json,
    });

    const result = await (await readyAdapter(session, fake)).refresh(
      "e1",
      content,
      "finish",
    );

    expect(result).toEqual({ ok: true, changed: true });
    const set = readStudioStatus(root).workingSets[0];
    expect(set?.status).toBe("complete");
    expect(set?.frames["idle/south"]?.frames.map((f) => f.durationMs)).toEqual([
      123, 167, 250, 333,
    ]);
    session.close();
  });

  test("a half-written export, a missing export and a failing editor are typed refusals that keep the earlier preview", async () => {
    const { root, session } = rig();
    const fake = fakeEditor();
    const edited = fourFrames();
    const adapter = await readyAdapter(session, fake);
    fake.set({
      sheetBase64: Buffer.from(edited.png).toString("base64"),
      json: edited.json,
    });
    await adapter.refresh("e1", content, "import");
    const before = snapshot(root);

    fake.set({
      sheetBase64: Buffer.from(edited.png.slice(0, 300)).toString("base64"),
      json: edited.json,
    });
    expect(await adapter.refresh("e1", content, "import")).toMatchObject({
      ok: false,
      reason: "corrupt-png",
    });
    fake.set({
      sheetBase64: Buffer.from(edited.png).toString("base64"),
      json: edited.json,
      partialJson: true,
    });
    expect(await adapter.refresh("e1", content, "import")).toMatchObject({
      ok: false,
      reason: "invalid-params",
    });
    fake.set({ skipOutputs: true });
    expect(await adapter.refresh("e1", content, "import")).toMatchObject({
      ok: false,
      reason: "export-incomplete",
    });
    fake.set({ exit: 3 });
    const failed = await adapter.refresh("e1", content, "import");
    expect(failed).toMatchObject({ ok: false, reason: "editor-failed" });
    expect(failed.ok === false && failed.message).toMatch(/exit code 3/);
    expect(failed.ok === false && failed.message).toMatch(/failed on purpose/);

    expect(snapshot(root)).toEqual(before);
    expect(readStudioStatus(root).edits[0]?.preview?.sheetHash).toBe(
      sha256Hex(edited.png),
    );
    session.close();
  });

  test("a run that outlives its timeout is killed by its own pid and awaited", async () => {
    const { root, session } = rig();
    const fake = fakeEditor();
    fake.set({ hang: true });
    const adapter = await readyAdapter(session, fake, 300);
    const before = snapshot(root);

    const started = Date.now();
    const result = await adapter.refresh("e1", content, "import");

    expect(result).toMatchObject({ ok: false, reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(4000);
    const [call] = fake.calls();
    expect(() => process.kill(call?.pid ?? 0, 0)).toThrow();
    expect(snapshot(root)).toEqual(before);
    session.close();
  });

  test("closing the adapter kills a running editor and waits for it", async () => {
    const { session } = rig();
    const fake = fakeEditor();
    fake.set({ hang: true });
    const adapter = await readyAdapter(session, fake, 20_000);

    const running = adapter.refresh("e1", content, "import");
    await new Promise((resolve) => setTimeout(resolve, 400));
    await adapter.close();

    expect(await running).toMatchObject({ ok: false, reason: "aborted" });
    const [call] = fake.calls();
    expect(() => process.kill(call?.pid ?? 0, 0)).toThrow();
    session.close();
  });

  test("a session that closes while the editor runs gets no writes and a new owner's store is untouched", async () => {
    const { root, session } = rig();
    const fake = fakeEditor();
    const edited = fourFrames();
    fake.set({
      sheetBase64: Buffer.from(edited.png).toString("base64"),
      json: edited.json,
      delayMs: 500,
    });
    const adapter = await readyAdapter(session, fake);

    const running = adapter.refresh("e1", content, "import");
    await new Promise((resolve) => setTimeout(resolve, 150));
    session.close();
    const owner = openSession(root);
    const before = snapshot(root);

    expect(await running).toMatchObject({ ok: false, reason: "closed" });

    expect(snapshot(root)).toEqual(before);
    owner.close();
  });

  test("a missing editor leaves the hand-exported sheet and metadata usable through the same import path", async () => {
    const { root, session } = rig();
    const adapter = createEditorAdapter(session, {
      path: scratchDir(),
      platform: "linux",
      timeoutMs: 1000,
      tempParent: scratchDir(),
    });
    adapters.push(adapter);
    const edited = fourFrames();

    expect(await adapter.openWorkspace("e1")).toMatchObject({
      ok: false,
      reason: "editor-unavailable",
    });
    expect(await adapter.refresh("e1", content, "import")).toMatchObject({
      ok: false,
      reason: "editor-unavailable",
    });
    expect(
      adapter.refreshFallback("e1", edited.png, edited.json, content, "import"),
    ).toEqual({ ok: true, changed: true });

    expect(readStudioStatus(root).edits[0]?.preview?.sheetHash).toBe(
      sha256Hex(edited.png),
    );
    expect(
      adapter.refreshFallback("e1", edited.png, edited.json, content, "finish"),
    ).toEqual({ ok: true, changed: true });
    expect(readStudioStatus(root).edits[0]?.status).toBe("finished");
    session.close();
  });

  test("the script uses only the documented Sprite API: RGB, milliseconds as seconds, no io, os or invented export", () => {
    const script = readFileSync(
      join(import.meta.dir, "scripts", "export.lua"),
      "utf8",
    );

    expect(script).toContain("ColorMode.RGB");
    expect(script).toContain("/ 1000");
    expect(script).toContain("tag.repeats = 0");
    expect(script).toMatch(/slice\.pivot = Point/);
    expect(script).not.toMatch(/\bio\./);
    expect(script).not.toMatch(/\bos\./);
    expect(script).not.toMatch(/exportPNG|app\.command|trim|crop/i);
  });
});

/** A trusted batch script that changes one pixel of one frame through the image API and saves the same file. */
const EDIT_PIXEL_LUA = `local p = app.params
local sprite = app.open(p.path)
app.sprite = sprite
local cel = sprite.layers[1]:cel(tonumber(p.frame))
local x = tonumber(p.x) - cel.position.x
local y = tonumber(p.y) - cel.position.y
cel.image:drawPixel(x, y, app.pixelColor.rgba(255, 0, 255, 255))
sprite:saveAs(p.path)
`;

const MAGENTA = [255, 0, 255, 255];

/** Changes one visible pixel inside the installed editor; the child is awaited and only ever signalled by its own pid. */
async function editPixel(
  executable: string,
  workspace: string,
  frame: number,
  x: number,
  y: number,
): Promise<number | null> {
  const dir = scratchDir();
  const script = join(dir, "edit.lua");
  writeFileSync(script, EDIT_PIXEL_LUA);
  const child = spawn(
    executable,
    [
      "--batch",
      "--script-param",
      `path=${workspace}`,
      "--script-param",
      `frame=${frame}`,
      "--script-param",
      `x=${x}`,
      "--script-param",
      `y=${y}`,
      "--script",
      script,
    ],
    { shell: false, stdio: "ignore", env: { HOME: dir } },
  );
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  const code = await new Promise<number | null>((resolve) =>
    child.once("close", resolve),
  );
  clearTimeout(timer);
  return code;
}

const pixelAt = (image: RgbaImage, x: number, y: number) =>
  Array.from(
    image.rgba.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4),
  );

describe("the installed editor", () => {
  const editor = resolveAseprite({ timeoutMs: 30_000 });
  const real = editor.ok ? test : test.skip;
  const executable = editor.ok ? editor.path : "";

  real(
    "builds the idle sheet, refuses an unedited export, and takes one real in-editor pixel edit through import and finish",
    async () => {
      const root = tempRoot();
      const session = openSession(root);
      const family = content.palette.families.find((f) => f.id === "olympus");
      const colours = [
        ...new Set(
          (family?.ramps ?? []).flatMap((r) =>
            r.shades.map(
              (c) =>
                `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`,
            ),
          ),
        ),
      ];
      const palette = {
        id: "greek-master",
        family: "olympus",
        digest: null,
        colours,
      };
      const pick = {
        ...keyframe(doneCandidate("pick-0", { slotKey: "idle/south" })),
        imageHash: session.store.putBlob(pngOf(toneFrame(cell, 0))),
        palette,
      };
      session.store.putWorkingSet(
        workingSet("w", {
          required: ["idle/south"],
          picks: { "idle/south": pick },
        }),
      );
      expect(session.openEdit("seed", "w", ["idle/south"], content)).toEqual({
        ok: true,
      });
      const seeded = fourFrames();
      expect(
        session.finishEdit("seed", seeded.png, seeded.json, content),
      ).toEqual({ ok: true, changed: true });
      expect(session.openEdit("e1", "w", ["idle/south"], content)).toEqual({
        ok: true,
      });
      const adapter = createEditorAdapter(session, {
        timeoutMs: 30_000,
        tempParent: scratchDir(),
      });
      adapters.push(adapter);

      const built = await adapter.openWorkspace("e1");

      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(built.readback.rgb).toBe(true);
      expect(built.readback.size).toEqual({ w: 64, h: 80 });
      expect(built.readback.durationsMs).toEqual([123, 167, 250, 333]);
      expect(built.readback.tags).toEqual([
        { name: "idle/south", from: 1, to: 4, repeats: 0 },
      ]);
      expect(built.readback.pivots).toEqual({ "idle/south": { x: 32, y: 80 } });
      expect(built.readback.palette).toEqual(colours);
      const workspace = join(root, "edits", "e1", "workspace.aseprite");
      expect(statSync(workspace).size).toBeGreaterThan(0);

      // Negative control: the editor re-encodes the same pixels; nothing was edited.
      const setBefore = readFileSync(
        join(root, "working-sets", "w.json"),
        "utf8",
      );
      const unedited = await adapter.refresh("e1", content, "import");
      expect(unedited).toEqual({ ok: true, changed: false });
      const refused = await adapter.refresh("e1", content, "finish");
      expect(refused).toMatchObject({ ok: false, reason: "wrong-state" });
      expect(
        readStudioStatus(root)
          .commands.filter((c) => c.type === "finish-edit")
          .map((c) => c.jobId),
      ).toEqual(["seed"]);
      expect(readFileSync(join(root, "working-sets", "w.json"), "utf8")).toBe(
        setBefore,
      );
      expect(
        readStudioStatus(root).edits.find((e) => e.id === "e1")?.preview,
      ).toBeNull();

      // Positive control: one pixel of frame 2 changed inside the editor.
      expect(await editPixel(executable, workspace, 2, 20, 20)).toBe(0);
      const changed = await adapter.refresh("e1", content, "import");
      expect(changed).toEqual({ ok: true, changed: true });
      const edit = readStudioStatus(root).edits.find((e) => e.id === "e1");
      const slot = edit?.preview?.slots["idle/south"];
      expect(slot?.frames.map((f) => f.durationMs)).toEqual([
        123, 167, 250, 333,
      ]);
      expect(slot?.pivot).toEqual({ x: 32, y: 80 });
      expect(slot?.reports[1]?.report.status).toBe("fail");
      const sheet = decodePng(
        session.store.readBlob(
          edit?.preview?.sheetHash as Sha256,
        ) as Uint8Array,
      );
      expect(sheet.ok && [sheet.image.width, sheet.image.height]).toEqual([
        256, 80,
      ]);
      if (!sheet.ok) return;
      const original = strip(frames(4, 0, 20));
      const differing: number[][] = [];
      for (let at = 0; at < original.rgba.length; at += 4) {
        const got = Array.from(sheet.image.rgba.slice(at, at + 4));
        const want = Array.from(original.rgba.slice(at, at + 4));
        if (want[3] === 0 && got[3] === 0) continue;
        if (got.join() !== want.join())
          differing.push([(at / 4) % 256, Math.floor(at / 4 / 256), ...got]);
      }
      expect(differing).toEqual([[64 + 20, 20, ...MAGENTA]]);

      const finished = await adapter.refresh("e1", content, "finish");
      expect(finished).toEqual({ ok: true, changed: true });
      const set = readStudioStatus(root).workingSets[0];
      expect(
        set?.frames["idle/south"]?.handEdits.map((h) => h.description),
      ).toEqual(["hand edit seed", "hand edit e1"]);
      expect(
        readStudioStatus(root)
          .commands.filter((c) => c.type === "finish-edit")
          .map((c) => c.jobId),
      ).toEqual(["seed", "e1"]);
      const handFrame = decodePng(
        session.store.readBlob(
          set?.frames["idle/south"]?.frames[1]?.hash as Sha256,
        ) as Uint8Array,
      );
      expect(handFrame.ok && pixelAt(handFrame.image, 20, 20)).toEqual(MAGENTA);
      session.close();
    },
    120_000,
  );

  real(
    "refuses an unedited six-expression portrait export and finishes one with a real in-editor pixel edit",
    async () => {
      const face = { w: 96, h: 96 };
      const root = tempRoot();
      const session = openSession(root);
      const expressions = [...content.vocabulary.expressions];
      const picks = Object.fromEntries(
        expressions.map((slot, index) => [
          slot,
          {
            ...keyframe(
              doneCandidate(`face-${index}`, {
                slotKey: slot,
                kind: "portrait",
              }),
            ),
            imageHash: session.store.putBlob(pngOf(toneFrame(face, index, 3))),
          },
        ]),
      );
      session.store.putWorkingSet(
        workingSet("w", {
          kind: "portrait",
          required: expressions,
          picks,
          status: "complete",
        }),
      );
      expect(session.openEdit("f1", "w", expressions, content)).toEqual({
        ok: true,
      });
      const adapter = createEditorAdapter(session, {
        timeoutMs: 30_000,
        tempParent: scratchDir(),
      });
      adapters.push(adapter);

      const built = await adapter.openWorkspace("f1");

      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(built.readback.size).toEqual({ w: 96, h: 96 });
      expect(built.readback.durationsMs).toEqual([
        100, 100, 100, 100, 100, 100,
      ]);
      expect(built.readback.tags.map((t) => [t.name, t.from, t.to])).toEqual(
        expressions.map((name, i) => [name, i + 1, i + 1]),
      );
      expect(Object.values(built.readback.pivots)).toEqual([]);

      // Negative control: the unmodified export is not an edit and finishes nothing.
      expect(await adapter.refresh("f1", content, "finish")).toMatchObject({
        ok: false,
        reason: "wrong-state",
      });
      expect(readStudioStatus(root).commands.map((c) => c.type)).toEqual([
        "open-edit",
      ]);
      expect(readStudioStatus(root).workingSets[0]?.frames).toEqual({});

      // Positive control: one pixel of the fourth expression changed inside the editor.
      expect(
        await editPixel(
          executable,
          join(root, "edits", "f1", "workspace.aseprite"),
          4,
          30,
          30,
        ),
      ).toBe(0);
      expect(await adapter.refresh("f1", content, "finish")).toEqual({
        ok: true,
        changed: true,
      });

      const set = readStudioStatus(root).workingSets[0];
      expect(Object.keys(set?.frames ?? {})).toEqual(expressions);
      expect(set?.status).toBe("complete");
      expect(set?.frames.neutral?.pivot).toBeNull();
      for (const expression of expressions)
        expect(
          set?.frames[expression]?.handEdits.map((h) => h.description),
        ).toEqual(["hand edit f1"]);
      const edited = decodePng(
        session.store.readBlob(
          set?.frames.grieving?.frames[0]?.hash as Sha256,
        ) as Uint8Array,
      );
      expect(edited.ok && pixelAt(edited.image, 30, 30)).toEqual(MAGENTA);
      const untouched = decodePng(
        session.store.readBlob(
          set?.frames.awed?.frames[0]?.hash as Sha256,
        ) as Uint8Array,
      );
      expect(untouched.ok && pixelAt(untouched.image, 30, 30)).not.toEqual(
        MAGENTA,
      );
      expect(
        readStudioStatus(root).commands.filter((c) => c.type === "finish-edit"),
      ).toHaveLength(1);
      session.close();
    },
    120_000,
  );
});

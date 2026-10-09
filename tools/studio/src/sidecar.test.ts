// The compiled sidecar: `apps/studio/scripts/build-sidecar.sh` builds the
// studio session into a standalone binary, and these tests drive that binary
// over stdio the way the native host will. Nothing here sleeps or polls: they
// wait on the child's own output and exit.
//
// The binary is built once for the file. Set PANTHEA_STUDIO_SIDECAR to a
// prebuilt binary to skip the build (CI builds it ahead of the Rust jobs).
// Without a way to derive a target triple (macOS, or PANTHEA_SIDECAR_TRIPLE)
// the whole file is skipped.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveAseprite } from "@panthea/assets/studio";
import { paletteFixture } from "../../../packages/assets/src/fixtures";
import { runSlots } from "../../../packages/assets/src/studio/_test-fixtures";
import { assetRig, contentRootWithPalette, removeTempRoots } from "./_testkit";

const REPO = join(import.meta.dir, "..", "..", "..");
const SCRIPT = join(REPO, "apps", "studio", "scripts", "build-sidecar.sh");

const HOST_TRIPLE: Record<string, string> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
};
const triple =
  process.env.PANTHEA_SIDECAR_TRIPLE ??
  HOST_TRIPLE[`${process.platform}-${process.arch}`];
const canBuild =
  process.env.PANTHEA_STUDIO_SIDECAR !== undefined ||
  (triple !== undefined && Bun.which("bash") !== null);
const suite = canBuild ? describe : describe.skip;

// biome-ignore lint/suspicious/noExplicitAny: replies are JSON read by shape in assertions
type Reply = Record<string, any>;

const scratch: string[] = [];
const tmp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
};

let binary = "";
let built = false;

beforeAll(async () => {
  if (!canBuild) return;
  if (process.env.PANTHEA_STUDIO_SIDECAR !== undefined) {
    binary = process.env.PANTHEA_STUDIO_SIDECAR;
    return;
  }
  const outDir = tmp("studio-sidecar-build-");
  const proc = Bun.spawn(["bash", SCRIPT], {
    cwd: REPO,
    env: { ...process.env, PANTHEA_SIDECAR_OUT_DIR: outDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0)
    throw new Error(`build-sidecar failed (${code}): ${err}${out}`);
  binary = join(outDir, `panthea-studio-sidecar-${triple}`);
  built = true;
}, 120_000);

afterAll(() => {
  removeTempRoots();
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** The sidecar as the native host runs it: argv only, a pipe each way, replies on stdout. */
function spawnSidecar(args: readonly string[]) {
  const home = tmp("studio-sidecar-home-");
  const proc = Bun.spawn([binary, ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "", HOME: home },
  });
  const lines: string[] = [];
  const waiting: (() => void)[] = [];
  let tail = "";
  const reading = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stdout) {
      tail += decoder.decode(chunk, { stream: true });
      for (let at = tail.indexOf("\n"); at >= 0; at = tail.indexOf("\n")) {
        lines.push(tail.slice(0, at));
        tail = tail.slice(at + 1);
        for (const wake of waiting.splice(0)) wake();
      }
    }
    for (const wake of waiting.splice(0)) wake();
  })();
  const stderr = new Response(proc.stderr).text();
  const parse = (line: string) => JSON.parse(line) as Reply;
  return {
    proc,
    send(request: unknown) {
      proc.stdin.write(`${JSON.stringify(request)}\n`);
      proc.stdin.flush();
    },
    /** The next reply line, waited for on the child's output, not on a clock. */
    async reply(): Promise<Reply> {
      while (lines.length === 0) {
        if (proc.exitCode !== null && tail === "")
          throw new Error("the sidecar exited without a reply");
        await new Promise<void>((wake) => waiting.push(wake));
      }
      return parse(lines.shift() as string);
    },
    async end() {
      proc.stdin.end();
      const code = await proc.exited;
      await reading;
      return { code, rest: lines.map(parse), tail, stderr: await stderr };
    },
  };
}

const quiet = () => {
  const root = join(tmp("studio-sidecar-root-"), "authoring");
  const config = join(dirname(root), "studio.json");
  writeFileSync(config, JSON.stringify({ studioRoot: root }));
  return { root, config };
};

suite("the compiled studio sidecar", () => {
  test("the build writes a triple-suffixed, executable binary", () => {
    if (!built) return;
    expect(binary.endsWith(`panthea-studio-sidecar-${triple}`)).toBe(true);
    expect(statSync(binary).isFile()).toBe(true);
    expect(statSync(binary).mode & 0o111).not.toBe(0);
  });

  test("answers status with exactly one correlated reply, keeps stdout to replies only, and exits 0 when stdin closes", async () => {
    const { config } = quiet();
    const sidecar = spawnSidecar([
      "session",
      "--config",
      config,
      "--parent-pid",
      String(process.pid),
    ]);

    sidecar.send({ id: "s1", op: "status", args: {} });
    const reply = await sidecar.reply();
    const ended = await sidecar.end();

    expect(reply).toMatchObject({
      id: "s1",
      ok: true,
      result: { counts: expect.any(Object) },
    });
    expect(ended.code).toBe(0);
    expect(ended.rest).toEqual([]);
    expect(ended.tail).toBe("");
  }, 30_000);

  test("an unknown op, and an op named like an inherited property, each get exactly one error reply with their id", async () => {
    const { config } = quiet();
    const sidecar = spawnSidecar(["session", "--config", config]);

    sidecar.send({ id: "u1", op: "levitate", args: {} });
    const unknown = await sidecar.reply();
    sidecar.send({ id: "u2", op: "toString", args: {} });
    const inherited = await sidecar.reply();
    sidecar.send({ id: "u3", op: "status" });
    const status = await sidecar.reply();
    const ended = await sidecar.end();

    expect(unknown).toMatchObject({
      id: "u1",
      ok: false,
      error: { code: "unknown-op" },
    });
    expect(inherited).toMatchObject({
      id: "u2",
      ok: false,
      error: { code: "unknown-op" },
    });
    expect(status).toMatchObject({ id: "u3", ok: true });
    expect(ended.code).toBe(0);
    expect(ended.rest).toEqual([]);
  }, 30_000);

  test("bun:sqlite works compiled: the session holds the root's lock, and a second sidecar on the same root is refused busy", async () => {
    const { root, config } = quiet();
    const first = spawnSidecar(["session", "--config", config]);
    first.send({ id: "s1", op: "status", args: {} });
    expect(await first.reply()).toMatchObject({ id: "s1", ok: true });
    expect(existsSync(root)).toBe(true);

    const second = spawnSidecar(["session", "--config", config]);
    const refused = await second.reply();
    const secondEnd = await second.end();
    const firstEnd = await first.end();

    expect(refused).toMatchObject({
      ok: false,
      error: { code: "busy" },
    });
    expect(secondEnd.code).toBe(1);
    expect(firstEnd.code).toBe(0);
  }, 30_000);

  test("a bad --parent-pid is a usage refusal on stdout and exit 64", async () => {
    const sidecar = spawnSidecar(["session", "--parent-pid", "0"]);
    const reply = await sidecar.reply();
    const ended = await sidecar.end();

    expect(reply).toMatchObject({
      ok: false,
      error: { code: "invalid-arguments" },
    });
    expect(ended.code).toBe(64);
  }, 30_000);

  const editor = resolveAseprite({ timeoutMs: 30_000 });
  const withEditor = editor.ok ? test : test.skip;

  withEditor(
    "runs one real batch export through the embedded Lua script, with no source tree to read it from",
    async () => {
      const rig = assetRig();
      const [id] = runSlots(rig, "zeus-idle", "sprite", [
        { state: "idle", direction: "south" },
      ]);
      rig.session.openWorkingSet("w", "zeus-idle", rig.content);
      rig.session.pick("w", id as string);
      rig.session.close();
      const base = tmp("studio-sidecar-edit-");
      const config = join(base, "studio.json");
      mkdirSync(base, { recursive: true });
      writeFileSync(
        config,
        JSON.stringify({
          studioRoot: rig.root,
          contentRoot: contentRootWithPalette(paletteFixture().files),
          editor: {
            executable: editor.ok ? editor.path : undefined,
            timeoutMs: 30_000,
            // Far longer than the test: the edit is never re-imported.
            editPollMs: 3_600_000,
          },
        }),
      );
      const sidecar = spawnSidecar(["session", "--config", config]);

      sidecar.send({
        id: "o1",
        op: "open",
        args: { id: "e1", workingSetId: "w", slots: ["idle/south"] },
      });
      const opened = await sidecar.reply();
      expect(opened).toMatchObject({
        id: "o1",
        ok: true,
        result: {
          editId: "e1",
          workspace: { size: { w: 64, h: 80 } },
        },
      });
      const file = opened.result.workspacePath as string;
      expect(file).toBe(join(rig.root, "edits", "e1", "workspace.aseprite"));
      expect(statSync(file).size).toBeGreaterThan(0);

      sidecar.send({ id: "d1", op: "discard", args: { id: "e1" } });
      expect(await sidecar.reply()).toMatchObject({ id: "d1", ok: true });
      const ended = await sidecar.end();
      expect(ended.code).toBe(0);
      expect(ended.stderr).not.toContain("export.lua");
    },
    120_000,
  );
});

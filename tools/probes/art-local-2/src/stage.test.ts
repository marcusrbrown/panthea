import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { createHash } from "node:crypto";
import {
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
import { join } from "node:path";
import {
  loadManifest,
  main,
  RUNTIME_BINARY,
  stageEntry,
  stageRuntime,
} from "./stage";

const sha = (bytes: string) => createHash("sha256").update(bytes).digest("hex");

describe("components manifest", () => {
  const manifest = loadManifest(join(import.meta.dir, "..", "components.json"));
  const all = Object.values(manifest.arms).flatMap((a) => a.components);

  test("every Hugging Face URL is pinned to an immutable 40-hex commit", () => {
    const hf = all.filter((c) => c.url.startsWith("https://huggingface.co/"));
    expect(hf.length).toBeGreaterThan(0);
    for (const c of hf) {
      expect(c.url).toMatch(/\/resolve\/[0-9a-f]{40}\//);
    }
  });

  test("every component declares a sha256 and a unique destination", () => {
    for (const c of all) expect(c.sha256).toMatch(/^[0-9a-f]{64}$/);
    const files = all.map((c) => c.file);
    // The Qwen3 text encoders differ per arm, so destinations never collide.
    expect(new Set(files).size).toBe(files.length);
  });

  test("the Civitai LoRA is exactly the approved file and is benchmark-only", () => {
    const civitai = all.filter((c) => c.url.includes("civitai.com"));
    expect(civitai).toHaveLength(1);
    expect(civitai[0]?.url).toBe(
      "https://civitai.com/api/download/models/2454660?fileId=2344890",
    );
    expect(civitai[0]?.benchmarkOnly).toBe(true);
    expect(all.filter((c) => c.benchmarkOnly)).toHaveLength(1);
  });

  test("the binary that runtime staging publishes is the one every arm config runs", () => {
    const armsDir = join(import.meta.dir, "..", "arms");
    const configs = readdirSync(armsDir).filter((f) => f.endsWith(".json"));
    expect(configs.length).toBeGreaterThan(0);
    for (const file of configs) {
      const config = JSON.parse(readFileSync(join(armsDir, file), "utf8"));
      expect(config.server.binary).toMatchObject({
        id: RUNTIME_BINARY.id,
        path: RUNTIME_BINARY.path,
        declared: { sha256: RUNTIME_BINARY.sha256 },
      });
    }
  });

  test("runtime pins the exact release archive", () => {
    expect(manifest.runtime.sha256).toBe(
      "1c8ee6c8e413e3335b1223bbc657ea5d86dae1819f8426a98b84c265587eb192",
    );
    expect(manifest.runtime.sizeBytes).toBe(35_049_086);
  });
});

describe("stageEntry", () => {
  let root: string;
  let server: ReturnType<typeof Bun.serve>;
  const payload = "pretend-weights";

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "stage-"));
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/ok") return new Response(payload);
        if (path === "/denied") return new Response("auth", { status: 401 });
        if (path === "/missing") return new Response("nope", { status: 404 });
        if (path === "/stall") {
          // Headers and a few bytes, then silence: the body never ends.
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("partial"));
              },
            }),
          );
        }
        return new Response("wrong bytes");
      },
    });
  });
  afterAll(() => {
    server.stop(true);
    rmSync(root, { recursive: true, force: true });
  });

  const entry = (file: string, path: string, over: object = {}) => ({
    role: "other" as const,
    id: file,
    url: `http://127.0.0.1:${server.port}${path}`,
    file: `models/${file}`,
    sizeBytes: payload.length,
    sha256: sha(payload),
    license: "test",
    source: "test",
    ...over,
  });

  test("downloads, verifies bytes, and atomically publishes the file", async () => {
    const result = await stageEntry(entry("a.bin", "/ok"), { root });
    expect(result.status).toBe("downloaded");
    expect(readFileSync(join(root, "models/a.bin"), "utf8")).toBe(payload);
    expect(existsSync(join(root, "models/a.bin.part"))).toBe(false);
  });

  test("an already-verified file is reused without any network access", async () => {
    const result = await stageEntry(
      entry("a.bin", "/ok", { url: "http://127.0.0.1:1/unreachable" }),
      { root },
    );
    expect(result.status).toBe("verified");
  });

  test("a hash mismatch is a failure and leaves no published or partial file", async () => {
    const result = await stageEntry(entry("b.bin", "/wrong"), { root });
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/sha256|size/);
    expect(existsSync(join(root, "models/b.bin"))).toBe(false);
    expect(existsSync(join(root, "models/b.bin.part"))).toBe(false);
  });

  test("an authorization refusal is unavailable, never bypassed", async () => {
    const result = await stageEntry(entry("c.bin", "/denied"), { root });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("401");
    expect(existsSync(join(root, "models/c.bin"))).toBe(false);
  });

  test("other HTTP errors are failures without a stale partial file", async () => {
    const result = await stageEntry(entry("d.bin", "/missing"), { root });
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("404");
    expect(existsSync(join(root, "models/d.bin.part"))).toBe(false);
  });

  test("a stalled download fails at the deadline and keeps the partial file for resume", async () => {
    const started = performance.now();
    const result = await stageEntry(entry("s.bin", "/stall"), {
      root,
      downloadDeadlineMs: 500,
    });
    expect(performance.now() - started).toBeLessThan(4_000);
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/deadline/);
    expect(existsSync(join(root, "models/s.bin"))).toBe(false);
    expect(existsSync(join(root, "models/s.bin.part"))).toBe(true);
  });

  test("an unknown size is allowed when the hash matches", async () => {
    const result = await stageEntry(
      entry("e.bin", "/ok", { sizeBytes: null }),
      { root },
    );
    expect(result.status).toBe("downloaded");
  });

  test("a corrupt existing file is replaced by a verified download", async () => {
    mkdirSync(join(root, "models"), { recursive: true });
    writeFileSync(join(root, "models/f.bin"), "corrupt");
    const result = await stageEntry(entry("f.bin", "/ok"), { root });
    expect(result.status).toBe("downloaded");
    expect(readFileSync(join(root, "models/f.bin"), "utf8")).toBe(payload);
  });
});

// A 240-byte stored zip holding `sd-server` ("fake-sd-server", 0755) and a
// sibling `libfake.dylib`, standing in for the release archive.
const RUNTIME_ZIP = Buffer.from(
  "UEsDBBQAAAAAAAAARF3HuWtsDgAAAA4AAAAJAAAAc2Qtc2VydmVyZmFrZS1zZC1zZXJ2ZXJQSwMEFAAAAAAAAABEXZ2jkGkIAAAACAAAAA0AAABsaWJmYWtlLmR5bGliZmFrZS1saWJQSwECFAMUAAAAAAAAAERdx7lrbA4AAAAOAAAACQAAAAAAAAAAAAAA7YEAAAAAc2Qtc2VydmVyUEsBAhQDFAAAAAAAAABEXZ2jkGkIAAAACAAAAA0AAAAAAAAAAAAAAO2BNQAAAGxpYmZha2UuZHlsaWJQSwUGAAAAAAIAAgByAAAAaAAAAAAA",
  "base64",
);

describe("stageRuntime", () => {
  let root: string;
  let server: ReturnType<typeof Bun.serve>;
  const archive = {
    role: "runtime",
    id: "fake-runtime",
    url: "",
    file: "bin/sd-release.zip",
    sizeBytes: RUNTIME_ZIP.byteLength,
    sha256: createHash("sha256").update(RUNTIME_ZIP).digest("hex"),
    license: "test",
    source: "test",
  };
  const binary = {
    id: "fake-sd-server",
    path: "bin/release/sd-server",
    sha256: sha("fake-sd-server"),
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "stage-runtime-"));
    server = Bun.serve({ port: 0, fetch: () => new Response(RUNTIME_ZIP) });
  });
  afterEach(() => {
    server.stop(true);
    rmSync(root, { recursive: true, force: true });
  });

  const entry = () => ({
    ...archive,
    url: `http://127.0.0.1:${server.port}/z`,
  });

  test("publishes the verified server binary the arm configs point at, executable", async () => {
    const results = await stageRuntime(entry(), binary, { root });
    expect(results.map((r) => r.status)).toEqual(["downloaded", "extracted"]);
    const target = join(root, binary.path);
    expect(readFileSync(target, "utf8")).toBe("fake-sd-server");
    expect(statSync(target).mode & 0o111).not.toBe(0);
    expect(existsSync(join(root, "bin/release/libfake.dylib"))).toBe(true);
    expect(existsSync(join(root, "bin/release.part"))).toBe(false);
  });

  test("extracts when the archive is already verified but the binary is missing", async () => {
    mkdirSync(join(root, "bin"), { recursive: true });
    writeFileSync(join(root, archive.file), RUNTIME_ZIP);
    const results = await stageRuntime(
      { ...archive, url: "http://127.0.0.1:1/unreachable" },
      binary,
      { root },
    );
    expect(results.map((r) => r.status)).toEqual(["verified", "extracted"]);
    expect(existsSync(join(root, binary.path))).toBe(true);
  });

  test("an already-verified binary is reused", async () => {
    await stageRuntime(entry(), binary, { root });
    const results = await stageRuntime(entry(), binary, { root });
    expect(results.map((r) => r.status)).toEqual(["verified", "verified"]);
  });

  test("a binary that fails its declared hash is a failure and is never published", async () => {
    const results = await stageRuntime(
      entry(),
      { ...binary, sha256: sha("something else") },
      { root },
    );
    expect(results[1]?.status).toBe("failed");
    expect(results[1]?.reason).toMatch(/sha256/);
    expect(existsSync(join(root, binary.path))).toBe(false);
    expect(existsSync(join(root, "bin/release.part"))).toBe(false);
  });

  test("a failed archive download stops before extraction", async () => {
    const results = await stageRuntime(
      { ...entry(), sha256: sha("wrong") },
      binary,
      { root },
    );
    expect(results.map((r) => r.status)).toEqual(["failed"]);
  });
});

describe("stage CLI arguments", () => {
  let dir: string;
  let root: string;
  let marker: string;
  const savedPath = process.env.PATH;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stage-cli-"));
    root = join(dir, "root");
    mkdirSync(root);
    marker = join(dir, "curl-calls");
    const bin = join(dir, "bin");
    mkdirSync(bin);
    // A curl that records its arguments and fails, so no test touches a network.
    writeFileSync(
      join(bin, "curl"),
      `#!/bin/sh\necho "$@" >> "${marker}"\nexit 22\n`,
      { mode: 0o755 },
    );
    process.env.PATH = `${bin}:${savedPath}`;
  });
  afterEach(() => {
    process.env.PATH = savedPath;
    rmSync(dir, { recursive: true, force: true });
  });

  const quiet = async (argv: string[]) => {
    const error = console.error;
    console.error = () => {};
    try {
      return await main(argv);
    } finally {
      console.error = error;
    }
  };

  for (const argv of [
    ["runtime", "--root"],
    ["runtime", "--root", "--other"],
    ["runtime", "extra"],
    ["runtime", "--root", "dir", "extra"],
  ]) {
    test(`rejects \`${argv.join(" ")}\` with 64 before any download or write`, async () => {
      expect(await quiet(argv)).toBe(64);
      expect(existsSync(marker)).toBe(false);
      expect(readdirSync(root)).toEqual([]);
    });
  }

  test("a given --root receives the download", async () => {
    expect(await quiet(["runtime", "--root", root])).toBe(1);
    expect(readFileSync(marker, "utf8")).toContain(
      join(root, "bin/sd-release.zip.part"),
    );
  });
});

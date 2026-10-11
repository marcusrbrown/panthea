// Studio release probe (plan U7): what a release followed by a re-acquire
// costs, so the grace period can be picked from numbers.
//
// It measures, on a COPY of a real studio store (the original is never
// opened, so a running app or CLI is not disturbed):
//   - the status scan (`readStudioStatus`) and the session acquire
//     (`openStudioSession` plus close);
//   - artifact verification: stat plus sha256 of the runtime binary and the
//     models, the same work as `verifyArtifacts` in
//     packages/assets/src/studio/runtime.ts (which is not exported);
//   - a real runtime cold start through the production path: a `Studio` in
//     session mode takes a `generate`, the drain starts the owned sd-server,
//     and the clock stops at the first successful `capabilities` answer. The
//     job is then aborted by `teardown()`, which is timed too. The server is
//     started once and stopped by the runtime's own group teardown.
//
//   bun tools/probes/studio-release/src/measure.ts \
//     --config .context/studio-pipeline/seated/config-sitting.json [--runs 3] [--skip-server]
//
// Output is one JSON object on stdout. Nothing here writes outside a temp dir.

import { createHash } from "node:crypto";
import {
  cpSync,
  createReadStream,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openStudioSession,
  readStudioStatus,
  SELECTED_PROFILE,
} from "../../../../packages/assets/src/studio";
import { execute } from "../../../studio/src/commands";
import { loadConfig } from "../../../studio/src/config";
import { defaultDeps, Studio } from "../../../studio/src/host";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
const has = (name: string) => process.argv.includes(`--${name}`);

const ms = (since: number) => Math.round(performance.now() - since);

const hashFile = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });

const portFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });

async function verification(artifactRoot: string) {
  const files = [
    SELECTED_PROFILE.runtime.binary.path,
    ...SELECTED_PROFILE.components.map((c) => c.file),
  ];
  const start = performance.now();
  const perFile: Record<string, { ms: number; bytes: number }> = {};
  for (const file of files) {
    const path = join(artifactRoot, file);
    const begun = performance.now();
    statSync(path);
    await hashFile(path);
    perFile[file] = { ms: ms(begun), bytes: statSync(path).size };
  }
  return { totalMs: ms(start), perFile };
}

const loaded = loadConfig(flag("config") ?? "");
if (!loaded.ok) throw new Error(loaded.message);
const config = loaded.value;
const source = config.studioRoot;
if (source === undefined) throw new Error("the config has no studioRoot");
const runs = Number(flag("runs") ?? "3");

const dir = mkdtempSync(join(tmpdir(), "studio-release-"));
const copy = join(dir, "studio");
const copying = performance.now();
cpSync(source, copy, { recursive: true });
const copyMs = ms(copying);
rmSync(join(copy, "session.lock"), { force: true });

const report: Record<string, unknown> = {
  host: `${process.platform} ${process.arch}`,
  bun: Bun.version,
  storeBytes: Bun.spawnSync(["du", "-sk", copy])
    .stdout.toString()
    .split("\t")[0],
  copyMs,
};

try {
  const statusMs: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const t = performance.now();
    readStudioStatus(copy);
    statusMs.push(ms(t));
  }
  report.statusScanMs = statusMs;

  const acquireMs: number[] = [];
  const closeMs: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const t = performance.now();
    const opened = openStudioSession(copy);
    acquireMs.push(ms(t));
    if (opened.kind !== "opened") throw new Error("could not open the copy");
    const c = performance.now();
    opened.session.close();
    closeMs.push(ms(c));
  }
  report.sessionAcquireMs = acquireMs;
  report.sessionCloseMs = closeMs;

  const { artifactRoot } = config;
  if (artifactRoot === undefined) throw new Error("no artifactRoot");
  const verify: number[] = [];
  let detail: Awaited<ReturnType<typeof verification>> | undefined;
  for (let i = 0; i < Math.min(runs, 2); i += 1) {
    const result = await verification(artifactRoot);
    verify.push(result.totalMs);
    detail ??= result;
  }
  report.verificationMs = verify;
  report.verificationDetail = detail;

  // What a verification costs when the process-level cache (packages/assets/src/studio/runtime.ts)
  // already holds the files: the stat of each, nothing hashed.
  const cached: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const t = performance.now();
    for (const file of [
      SELECTED_PROFILE.runtime.binary.path,
      ...SELECTED_PROFILE.components.map((c) => c.file),
    ])
      statSync(join(artifactRoot, file), { bigint: true });
    cached.push(Number((performance.now() - t).toFixed(3)));
  }
  report.verificationCachedMs = cached;

  const { runtime } = config;
  if (!has("skip-server") && runtime !== undefined) {
    if (!(await portFree(runtime.port)))
      throw new Error(`port ${runtime.port} is not free`);
    const real = globalThis.fetch;
    let ready: number | undefined;
    globalThis.fetch = (async (input: Request | string | URL, init) => {
      const response = await real(input, init);
      if (
        ready === undefined &&
        response.ok &&
        String(input instanceof Request ? input.url : input).endsWith(
          "/sdcpp/v1/capabilities",
        )
      )
        ready = performance.now();
      return response;
    }) as typeof fetch;
    const lines: string[] = [];
    const studio = new Studio(
      { ...config, studioRoot: copy },
      defaultDeps((line) => lines.push(line)),
      "session",
    );
    try {
      const t = performance.now();
      const outcome = await execute(studio, "generate", {
        id: "release-probe",
        subject: "zeus",
        kind: "sprite",
        slots: [{ state: "idle", direction: "south" }],
        batch: 1,
        seed: 1,
      });
      report.generateAckMs = ms(t);
      report.generateOutcome = outcome.ok ? "queued" : outcome.error.code;
      const end = performance.now() + 180_000;
      while (ready === undefined && performance.now() < end)
        await new Promise((r) => setTimeout(r, 25));
      report.generateToReadyMs = ready === undefined ? null : ready - t;
      const stop = performance.now();
      await studio.teardown();
      report.teardownWithServerMs = ms(stop);
    } finally {
      globalThis.fetch = real;
    }
    report.portFreeAfter = await portFree(runtime.port);
    report.log = lines;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(JSON.stringify(report, null, 2));

// Criteria a (terminal control), e (forced no-GPU context), g (binary pin) and
// the clip-loop part of i.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { systemClock } from "../../studio-headroom/src/run";
import { blenderArgv, pickEnv, runToCompletion, savedEnvKeys } from "./blender";
import { STAGING, stage, writeResult } from "./cmd-render";
import {
  BLENDER,
  BLENDER_BUNDLE,
  ensureDir,
  PIN,
  RUNS,
  SCRATCH,
} from "./paths";
import { isGone, launchOwned, until } from "./proc";

const clock = systemClock;

async function streamingSha256(
  path: string,
): Promise<{ sha256: string; ms: number }> {
  const started = performance.now();
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return {
    sha256: hash.digest("hex"),
    ms: Math.round(performance.now() - started),
  };
}

function timed(
  command: string,
  args: readonly string[],
): { status: number | null; ms: number; output: string } {
  const started = performance.now();
  const result = spawnSync(command, [...args], { encoding: "utf8" });
  return {
    status: result.status,
    ms: Math.round(performance.now() - started),
    output: `${result.stdout}${result.stderr}`.trim().slice(-600),
  };
}

/** (g) */
export async function pinStep(): Promise<void> {
  const hashes: { sha256: string; ms: number }[] = [];
  for (let i = 0; i < 3; i += 1) hashes.push(await streamingSha256(BLENDER));
  const size = statSync(BLENDER).size;

  // Positive control: one changed byte must change the hash.
  const copy = join(
    ensureDir(join(SCRATCH, "pin")),
    "Blender-one-byte-changed",
  );
  copyFileSync(BLENDER, copy);
  const bytes = readFileSync(copy);
  bytes[1024] = (bytes[1024] as number) ^ 1;
  writeFileSync(copy, bytes);
  const changed = await streamingSha256(copy);
  rmSync(copy);

  const codesign = timed("codesign", [
    "--verify",
    "--deep",
    "--strict",
    BLENDER_BUNDLE,
  ]);
  const archs = timed("lipo", ["-archs", BLENDER]);

  const env = pickEnv(savedEnvKeys());
  const version = await runToCompletion({
    name: "pin-version",
    mode: "version",
    scriptArgs: ["--out", join(RUNS, "pin-version")],
    outDir: join(RUNS, "pin-version"),
    env,
    timeoutMs: 120_000,
  });
  const wrongBuild = await runToCompletion({
    name: "pin-wrong-build",
    mode: "version",
    scriptArgs: [
      "--out",
      join(RUNS, "pin-wrong-build"),
      "--expect-build",
      "000000000000",
    ],
    outDir: join(RUNS, "pin-wrong-build"),
    env,
    timeoutMs: 120_000,
  });
  const wrongVersion = await runToCompletion({
    name: "pin-wrong-version",
    mode: "version",
    scriptArgs: [
      "--out",
      join(RUNS, "pin-wrong-version"),
      "--expect-version",
      "5.2.3",
    ],
    outDir: join(RUNS, "pin-wrong-version"),
    env,
    timeoutMs: 120_000,
  });
  const start = JSON.parse(
    readFileSync(join(RUNS, "pin-version/probe-start.json"), "utf8"),
  ) as { pin: Record<string, unknown> };
  const agree = hashes.every((h) => h.sha256 === hashes[0]?.sha256);
  writeResult("pin", {
    executable: "/Applications/Blender.app/Contents/MacOS/Blender",
    sizeBytes: size,
    sha256: hashes[0]?.sha256,
    hashRuns: hashes,
    hashesAgree: agree,
    reportedByScript: start.pin,
    versionPrefixMatches: String(start.pin.version_string).startsWith(
      PIN.versionPrefix,
    ),
    buildHashMatches: start.pin.build_hash === PIN.buildHash,
    pass:
      agree &&
      String(start.pin.version_string).startsWith(PIN.versionPrefix) &&
      start.pin.build_hash === PIN.buildHash,
    controls: {
      oneByteChangedCopy: {
        sha256: changed.sha256,
        differsFromPinned: changed.sha256 !== hashes[0]?.sha256,
      },
      wrongExpectedBuild: { exitCode: wrongBuild.exitCode },
      wrongExpectedVersion: { exitCode: wrongVersion.exitCode },
      scriptRunWithPinnedValues: { exitCode: version.exitCode },
    },
    codesignDeepStrict: codesign,
    architectures: archs,
  });
}

/** (a) positive control for the terminal check: the same facts with a pseudo-terminal attached through `script`. */
export async function terminalControl(): Promise<void> {
  const out = join(RUNS, "terminal-pty");
  rmSync(out, { recursive: true, force: true });
  ensureDir(out);
  const launched = await launchOwned(
    "/usr/bin/script",
    ["-q", "/dev/null", BLENDER, ...blenderArgv("terminal", ["--out", out])],
    pickEnv(savedEnvKeys()),
    clock,
  );
  if (!launched.ok) throw new Error(launched.reason);
  await until(() => launched.child.closed, 120_000, clock);
  await until(() => isGone(launched.child), 15_000, clock);
  const facts = existsSync(join(out, "probe-start.json"))
    ? (
        JSON.parse(readFileSync(join(out, "probe-start.json"), "utf8")) as {
          terminal: unknown;
        }
      ).terminal
    : null;
  const piped = JSON.parse(
    readFileSync(join(RUNS, "env-0/probe-start.json"), "utf8"),
  ) as { terminal: unknown };
  writeResult("terminal-control", {
    withPty: facts,
    exitCode: launched.child.exitCode,
    sidecarStyleForComparison: piped.terminal,
  });
}

/** (e) */
export async function gpuStep(): Promise<void> {
  const env = pickEnv(savedEnvKeys());
  const sandboxDir = ensureDir(join(SCRATCH, "sandbox"));
  const attempt = async (
    name: string,
    extra: {
      flags?: string[];
      profile?: string;
      args?: string[];
      mode?: string;
    },
  ) => {
    const out = join(RUNS, `gpu-${name}`);
    rmSync(out, { recursive: true, force: true });
    ensureDir(out);
    let wrapper: { binary: string; args: string[] } | undefined;
    if (extra.profile !== undefined) {
      const file = join(sandboxDir, `gpu-${name}.sb`);
      writeFileSync(file, extra.profile);
      wrapper = { binary: "/usr/bin/sandbox-exec", args: ["-f", file] };
    }
    const result = await runToCompletion({
      name,
      mode: extra.mode ?? "gpu",
      scriptArgs: ["--out", out, ...(extra.args ?? [])],
      outDir: out,
      env,
      timeoutMs: 120_000,
      ...(extra.flags ? { flags: extra.flags } : {}),
      ...(wrapper ? { wrapper } : {}),
    });
    const stdout = result.stdoutTail
      .split("\n")
      .filter((l) => l.includes("PROBE"))
      .map((l) => l.slice(0, 200));
    return {
      name,
      exitCode: result.exitCode,
      exitSignal: result.exitSignal,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      probeLines: stdout,
      stderrTail: result.stderrTail.slice(-500),
    };
  };
  const attempts = [];
  attempts.push(await attempt("control-unforced", {}));
  attempts.push(
    await attempt("input-error-control", {
      mode: "slot",
      args: ["--models", join(SCRATCH, "does-not-exist")],
    }),
  );
  attempts.push(
    await attempt("backend-vulkan", { flags: ["--gpu-backend", "vulkan"] }),
  );
  attempts.push(
    await attempt("backend-opengl", { flags: ["--gpu-backend", "opengl"] }),
  );
  attempts.push(
    await attempt("sandbox-deny-iokit-open", {
      profile: "(version 1)\n(allow default)\n(deny iokit-open)\n",
    }),
  );
  attempts.push(
    await attempt("sandbox-deny-mtl-compiler-lookup", {
      profile:
        '(version 1)\n(allow default)\n(deny mach-lookup (global-name-prefix "com.apple.MTL"))\n(deny mach-lookup (global-name-prefix "com.apple.gpu"))\n',
    }),
  );
  attempts.push(
    await attempt("sandbox-deny-agx-user-clients", {
      profile:
        '(version 1)\n(allow default)\n(deny iokit-open (iokit-user-client-class "AGXDeviceUserClient") (iokit-user-client-class "AGXSharedUserClient") (iokit-user-client-class "AGXCommandQueue") (iokit-user-client-class "AGXDevice"))\n',
    }),
  );
  attempts.push(
    await attempt("sandbox-deny-agx-accelerator-entry", {
      profile:
        '(version 1)\n(allow default)\n(deny iokit-open (iokit-registry-entry-class "AGXAcceleratorG13X"))\n',
    }),
  );
  writeResult("gpu", { attempts });
}

/** (i), clip loops */
export async function clipsStep(): Promise<void> {
  if (!existsSync(STAGING)) stage(STAGING);
  const out = join(RUNS, "clips");
  rmSync(out, { recursive: true, force: true });
  ensureDir(out);
  const result = await runToCompletion({
    name: "clips",
    mode: "clips",
    scriptArgs: ["--models", STAGING, "--out", out],
    outDir: out,
    env: pickEnv(savedEnvKeys()),
    timeoutMs: 180_000,
  });
  writeResult("clips-run", {
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stderrTail: result.stderrTail.slice(-500),
  });
}

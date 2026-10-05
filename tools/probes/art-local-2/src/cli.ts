// CLI: `bun run src/cli.ts --config <arm.json> --out <dir>`.
// Writes <out>/<arm>/results.json (private paths redacted) and
// <out>/<arm>/images/*.png. Hashes are computed from the bytes written.
// Each server's full retained output is persisted, with the same private-path
// redaction, to <out>/<arm>/logs/server-<n>.log (results.json servers[].logFile).
//
// Exit codes: 0 every cell completed; 2 arm blocked (missing/mismatching
// component, staging needed) with nothing failed; 1 any failure, timeout or
// cancelled cell; 64 usage or config error.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  type ArmConfig,
  type ArmReport,
  type CellSpec,
  type ComponentSpec,
  type ImageEvent,
  runArm,
  type ServerLogEvent,
} from "./arm";
import { hashBytes } from "./measure";
import { type PathReplacement, redactPrivatePaths } from "./redact";
import type { BodyShape } from "./sdserver";

export class ConfigError extends Error {}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function fail(path: string, expected: string): never {
  throw new ConfigError(`invalid config at ${path}: expected ${expected}`);
}

const str = (v: unknown, path: string): string =>
  typeof v === "string" && v.length > 0 ? v : fail(path, "non-empty string");
const num = (v: unknown, path: string): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fail(path, "number");
const posInt = (v: unknown, path: string, min = 1): number =>
  typeof v === "number" && Number.isInteger(v) && v >= min
    ? v
    : fail(path, `integer >= ${min}`);
const obj = (v: unknown, path: string): Obj =>
  isObj(v) ? v : fail(path, "object");
const optional = <T>(v: unknown, read: (v: unknown) => T): T | undefined =>
  v === undefined ? undefined : read(v);

function parseComponent(raw: unknown, path: string): ComponentSpec {
  const o = obj(raw, path);
  const declared =
    o.declared === undefined ? undefined : obj(o.declared, `${path}.declared`);
  return {
    role: str(o.role, `${path}.role`) as ComponentSpec["role"],
    id: str(o.id, `${path}.id`),
    path: str(o.path, `${path}.path`),
    declared: declared && {
      sha256: optional(declared.sha256, (v) =>
        str(v, `${path}.declared.sha256`),
      ),
      license: optional(declared.license, (v) =>
        str(v, `${path}.declared.license`),
      ),
      source: optional(declared.source, (v) =>
        str(v, `${path}.declared.source`),
      ),
      quantization: optional(declared.quantization, (v) =>
        str(v, `${path}.declared.quantization`),
      ),
    },
  };
}

function parseCell(raw: unknown, path: string): CellSpec {
  const o = obj(raw, path);
  return {
    id: str(o.id, `${path}.id`),
    width: posInt(o.width, `${path}.width`),
    height: posInt(o.height, `${path}.height`),
  };
}

const BODY_SHAPE_FIELDS = [
  "prompt",
  "negativePrompt",
  "width",
  "height",
  "seed",
  "sampleParams",
  "lora",
] as const;

function parseBodyShape(raw: unknown, path: string): BodyShape {
  const o = obj(raw, path);
  const fields = obj(o.fields, `${path}.fields`);
  return {
    fields: Object.fromEntries(
      BODY_SHAPE_FIELDS.map((key) => [
        key,
        str(fields[key], `${path}.fields.${key}`),
      ]),
    ) as BodyShape["fields"],
    ...(o.extra === undefined ? {} : { extra: obj(o.extra, `${path}.extra`) }),
  };
}

const DEFAULT_CELLS: readonly CellSpec[] = [
  { id: "512x640", width: 512, height: 640 },
  { id: "768x768", width: 768, height: 768 },
];

/** Parses a raw JSON value into an ArmConfig, applying plan defaults. */
export function parseArmConfig(raw: unknown): ArmConfig {
  const o = obj(raw, "$");
  const server = obj(o.server, "$.server");
  if (!Array.isArray(server.cmd) || server.cmd.length === 0) {
    fail("$.server.cmd", "non-empty string array");
  }
  const lora =
    o.lora === undefined || o.lora === null ? null : obj(o.lora, "$.lora");
  const cancelProbe =
    o.cancelProbe === undefined || o.cancelProbe === null
      ? null
      : obj(o.cancelProbe, "$.cancelProbe");
  const idle = o.idle === undefined ? undefined : obj(o.idle, "$.idle");
  return {
    arm: str(o.arm, "$.arm"),
    server: {
      cmd: server.cmd.map((c, i) => str(c, `$.server.cmd[${i}]`)),
      baseUrl: str(server.baseUrl, "$.server.baseUrl"),
      env:
        server.env === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(obj(server.env, "$.server.env")).map(([k, v]) => [
                k,
                str(v, `$.server.env.${k}`),
              ]),
            ),
      readyTimeoutMs:
        optional(server.readyTimeoutMs, (v) =>
          posInt(v, "$.server.readyTimeoutMs"),
        ) ?? 120_000,
      maxLifetimeMs:
        optional(server.maxLifetimeMs, (v) =>
          posInt(v, "$.server.maxLifetimeMs"),
        ) ?? 1_800_000,
      stopGraceMs: optional(server.stopGraceMs, (v) =>
        posInt(v, "$.server.stopGraceMs"),
      ),
      binary: optional(server.binary, (v) =>
        parseComponent(v, "$.server.binary"),
      ),
    },
    components: (Array.isArray(o.components)
      ? o.components
      : o.components === undefined
        ? []
        : fail("$.components", "array")
    ).map((c, i) => parseComponent(c, `$.components[${i}]`)),
    prompt: str(o.prompt, "$.prompt"),
    negativePrompt: optional(o.negativePrompt, (v) =>
      str(v, "$.negativePrompt"),
    ),
    seed: num(o.seed, "$.seed"),
    sampleParams:
      o.sampleParams === undefined ? {} : obj(o.sampleParams, "$.sampleParams"),
    bodyShape: optional(o.bodyShape, (v) => parseBodyShape(v, "$.bodyShape")),
    lora: lora && {
      id: str(lora.id, "$.lora.id"),
      path: str(lora.path, "$.lora.path"),
      multiplier: num(lora.multiplier, "$.lora.multiplier"),
      ...(lora.isHighNoise === undefined
        ? {}
        : { isHighNoise: lora.isHighNoise === true }),
    },
    cells:
      o.cells === undefined
        ? DEFAULT_CELLS
        : Array.isArray(o.cells)
          ? o.cells.map((c, i) => parseCell(c, `$.cells[${i}]`))
          : fail("$.cells", "array"),
    warmupCount:
      optional(o.warmupCount, (v) => posInt(v, "$.warmupCount", 0)) ?? 1,
    sampleCount:
      optional(o.sampleCount, (v) => posInt(v, "$.sampleCount")) ?? 3,
    timeoutMs:
      optional(o.timeoutMs, (v) => posInt(v, "$.timeoutMs")) ?? 120_000,
    pollMs: optional(o.pollMs, (v) => posInt(v, "$.pollMs")),
    stagingGuidance:
      optional(o.stagingGuidance, (v) => str(v, "$.stagingGuidance")) ??
      "Stage the listed components and the server binary per the probe README, then re-run.",
    cancelProbe: cancelProbe && {
      afterMs: posInt(cancelProbe.afterMs, "$.cancelProbe.afterMs"),
      cell: parseCell(cancelProbe.cell, "$.cancelProbe.cell"),
    },
    idle: idle && {
      thresholdPercent: optional(idle.thresholdPercent, (v) =>
        num(v, "$.idle.thresholdPercent"),
      ),
      timeoutMs: posInt(idle.timeoutMs, "$.idle.timeoutMs"),
    },
    rssIntervalMs: optional(o.rssIntervalMs, (v) =>
      posInt(v, "$.rssIntervalMs"),
    ),
  };
}

function parseArgs(argv: readonly string[]): { config: string; out: string } {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag !== "--config" && flag !== "--out") || value === undefined) {
      throw new ConfigError(
        `usage: cli.ts --config <arm.json> --out <dir> (bad argument ${flag ?? ""})`,
      );
    }
    values.set(flag, value);
  }
  const config = values.get("--config");
  const out = values.get("--out");
  if (!config || !out) {
    throw new ConfigError("usage: cli.ts --config <arm.json> --out <dir>");
  }
  return { config, out };
}

function redactions(
  config: ArmConfig,
  out: string,
  configDir: string,
): PathReplacement[] {
  const dirs = (paths: readonly string[], label: string) =>
    [...new Set(paths.map((p) => dirname(resolve(p))))].map((prefix) => ({
      prefix,
      label,
    }));
  return [
    { prefix: out, label: "<out>" },
    { prefix: configDir, label: "<config>" },
    ...dirs(
      [
        ...config.components.map((c) => c.path),
        ...(config.lora ? [config.lora.path] : []),
      ],
      "<models>",
    ),
    ...dirs(config.server.binary ? [config.server.binary.path] : [], "<bin>"),
    { prefix: process.cwd(), label: "<cwd>" },
  ];
}

/** Why a configured cancel probe is not evidence of a working cancellation, if it is not. */
function cancelProblem(
  report: ArmReport,
  config: ArmConfig,
): string | undefined {
  const probe = report.cancelProbe;
  if (probe === null) return "no cancel probe was recorded";
  if (probe.status !== "cancelled") {
    return `the job ${probe.status} before it could be cancelled`;
  }
  const timing = probe.cancel;
  if (timing === null) return "the cancel probe recorded no timing";
  if (timing.readiness !== "ready") {
    return `the replacement server was ${timing.readiness}, not ready`;
  }
  if (
    timing.abortToExitMs === null ||
    timing.restartToReadyMs === null ||
    timing.totalCancelToReadyMs === null
  ) {
    return "the cancel probe is missing a timing";
  }
  if (
    config.idle !== undefined &&
    (timing.idle !== "below-threshold" || timing.restartToIdleMs === null)
  ) {
    return `the replacement did not settle to idle (${timing.idle})`;
  }
  return undefined;
}

/**
 * Exit code for a finished arm: 1 any failed cell or, when a cancel probe is
 * configured and the arm ran, a probe that is not full cancellation evidence;
 * 2 blocked with nothing failed; 0 otherwise.
 */
export function exitCodeFor(report: ArmReport, config: ArmConfig): number {
  if (
    report.cells.some(
      (c) => c.status !== "completed" && c.status !== "unavailable",
    )
  ) {
    return 1;
  }
  if (report.cells.some((c) => c.status === "unavailable")) return 2;
  if (config.cancelProbe && cancelProblem(report, config) !== undefined) {
    return 1;
  }
  return 0;
}

export async function main(argv: readonly string[]): Promise<number> {
  let config: ArmConfig;
  let args: { config: string; out: string };
  try {
    args = parseArgs(argv);
    config = parseArmConfig(JSON.parse(readFileSync(args.config, "utf8")));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 64;
  }

  const armDir = join(resolve(args.out), config.arm);
  const imagesDir = join(armDir, "images");
  mkdirSync(imagesDir, { recursive: true });
  const images: {
    file: string;
    cellId: string;
    variant: string;
    kind: string;
    index: number;
    sha256: string;
    byteLength: number;
  }[] = [];
  const onImage = (event: ImageEvent) => {
    const sha256 = hashBytes(event.bytes);
    const file = `images/${event.cellId}-${event.variant}-${event.kind}${event.index}-${sha256.slice(0, 12)}.png`;
    writeFileSync(join(armDir, file), event.bytes);
    images.push({
      file,
      cellId: event.cellId,
      variant: event.variant,
      kind: event.kind,
      index: event.index,
      sha256,
      byteLength: event.bytes.byteLength,
    });
  };

  const replacements = redactions(
    config,
    resolve(args.out),
    dirname(resolve(args.config)),
  );
  const logFileFor = (serverIndex: number) =>
    `logs/server-${serverIndex + 1}.log`;
  const onServerLog = (event: ServerLogEvent) => {
    mkdirSync(join(armDir, "logs"), { recursive: true });
    writeFileSync(
      join(armDir, logFileFor(event.serverIndex)),
      redactPrivatePaths(event.text, replacements),
    );
  };

  const report = await runArm(config, { onImage, onServerLog });
  const evidence = redactPrivatePaths(
    {
      ...report,
      servers: report.servers.map((server, index) => ({
        ...server,
        logFile: logFileFor(index),
      })),
      images,
      serverCmd: config.server.cmd,
    },
    replacements,
  );
  writeFileSync(
    join(armDir, "results.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );

  for (const cell of report.cells) {
    console.error(`[art-local-2] ${report.arm} ${cell.cellId}: ${cell.status}`);
  }
  if (report.cancelProbe) {
    console.error(
      `[art-local-2] ${report.arm} cancel-probe: ${report.cancelProbe.status}`,
    );
  }
  if (config.cancelProbe && exitCodeFor(report, config) === 1) {
    const problem = cancelProblem(report, config);
    if (problem !== undefined) {
      console.error(`[art-local-2] ${report.arm} cancel-probe: ${problem}`);
    }
  }
  return exitCodeFor(report, config);
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}

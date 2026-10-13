import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { ConformParams } from "@panthea/assets/studio";

export interface RuntimeSettings {
  readonly port: number;
  readonly pollMs: number;
  readonly deadlines: {
    readonly httpMs: number;
    readonly startupMs: number;
    readonly generationMs: number;
    readonly termGraceMs: number;
    readonly killMs: number;
  };
}

export interface EditorSettings {
  readonly executable?: string;
  readonly timeoutMs: number;
  readonly tempParent?: string;
  readonly editPollMs: number;
}

export interface StudioConfig {
  readonly studioRoot?: string;
  readonly contentRoot?: string;
  readonly registryRoot?: string;
  readonly artifactRoot?: string;
  readonly runtime?: RuntimeSettings;
  readonly editor?: EditorSettings;
  readonly conform?: Readonly<Record<string, ConformParams>>;
}

export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const fail = (path: string, message: string): Parsed<never> => ({
  ok: false,
  message: `${path}: ${message}`,
});
const good = <T>(value: T): Parsed<T> => ({ ok: true, value });

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** An object whose keys are all among `allowed`. */
function record(
  value: unknown,
  path: string,
  allowed: readonly string[],
): Parsed<Rec> {
  if (!isRecord(value)) return fail(path, "expected an object");
  const extra = Object.keys(value).find((k) => !allowed.includes(k));
  return extra === undefined
    ? good(value)
    : fail(path, `unknown key "${extra}"`);
}

function intIn(
  value: unknown,
  path: string,
  min: number,
  max: number,
): Parsed<number> {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? good(value)
    : fail(path, `expected an integer from ${min} to ${max}`);
}

const positive = (value: unknown, path: string) =>
  intIn(value, path, 1, Number.MAX_SAFE_INTEGER);

export function parseConformParams(
  value: unknown,
  path: string,
): Parsed<ConformParams> {
  const top = record(value, path, [
    "background",
    "alphaCutoff",
    "grid",
    "scale",
  ]);
  if (!top.ok) return top;
  const background = top.value.background;
  let spec: ConformParams["background"];
  if (!isRecord(background))
    return fail(`${path}.background`, "expected an object");
  if (background.type === "alpha") {
    const only = record(background, `${path}.background`, ["type"]);
    if (!only.ok) return only;
    spec = { type: "alpha" };
  } else if (background.type === "key") {
    const key = record(background, `${path}.background`, [
      "type",
      "rgb",
      "tolerance",
    ]);
    if (!key.ok) return key;
    const rgb = key.value.rgb;
    if (!Array.isArray(rgb) || rgb.length !== 3)
      return fail(`${path}.background.rgb`, "expected three channels");
    const channels: number[] = [];
    for (const [i, c] of rgb.entries()) {
      const channel = intIn(c, `${path}.background.rgb[${i}]`, 0, 255);
      if (!channel.ok) return channel;
      channels.push(channel.value);
    }
    const tolerance = intIn(
      key.value.tolerance,
      `${path}.background.tolerance`,
      0,
      255,
    );
    if (!tolerance.ok) return tolerance;
    spec = {
      type: "key",
      rgb: [
        channels[0] as number,
        channels[1] as number,
        channels[2] as number,
      ],
      tolerance: tolerance.value,
    };
  } else return fail(`${path}.background.type`, 'expected "alpha" or "key"');

  const alphaCutoff = intIn(
    top.value.alphaCutoff,
    `${path}.alphaCutoff`,
    1,
    255,
  );
  if (!alphaCutoff.ok) return alphaCutoff;
  const grid = record(top.value.grid, `${path}.grid`, [
    "edgeTolerance",
    "minConfidence",
    "minEdges",
  ]);
  if (!grid.ok) return grid;
  const edgeTolerance = intIn(
    grid.value.edgeTolerance,
    `${path}.grid.edgeTolerance`,
    0,
    255,
  );
  if (!edgeTolerance.ok) return edgeTolerance;
  const confidence = grid.value.minConfidence;
  if (typeof confidence !== "number" || !(confidence > 0) || confidence > 1)
    return fail(
      `${path}.grid.minConfidence`,
      "expected a number above 0 and at most 1",
    );
  const minEdges = positive(grid.value.minEdges, `${path}.grid.minEdges`);
  if (!minEdges.ok) return minEdges;
  const base = {
    background: spec,
    alphaCutoff: alphaCutoff.value,
    grid: {
      edgeTolerance: edgeTolerance.value,
      minConfidence: confidence,
      minEdges: minEdges.value,
    },
  };
  if (top.value.scale === undefined) return good(base);
  const scale = positive(top.value.scale, `${path}.scale`);
  if (!scale.ok) return scale;
  return good({ ...base, scale: scale.value });
}

function pathValue(
  value: unknown,
  path: string,
  baseDir: string,
): Parsed<string> {
  if (typeof value !== "string" || value === "")
    return fail(path, "expected a non-empty path");
  return good(isAbsolute(value) ? value : resolve(baseDir, value));
}

function parseRuntime(value: unknown, path: string): Parsed<RuntimeSettings> {
  const top = record(value, path, ["port", "pollMs", "deadlines"]);
  if (!top.ok) return top;
  const port = intIn(top.value.port, `${path}.port`, 1, 65535);
  if (!port.ok) return port;
  const pollMs = positive(top.value.pollMs, `${path}.pollMs`);
  if (!pollMs.ok) return pollMs;
  const names = [
    "httpMs",
    "startupMs",
    "generationMs",
    "termGraceMs",
    "killMs",
  ] as const;
  const d = record(top.value.deadlines, `${path}.deadlines`, names);
  if (!d.ok) return d;
  const read = {} as Record<(typeof names)[number], number>;
  for (const name of names) {
    const v = positive(d.value[name], `${path}.deadlines.${name}`);
    if (!v.ok) return v;
    read[name] = v.value;
  }
  return good({ port: port.value, pollMs: pollMs.value, deadlines: read });
}

function parseEditor(
  value: unknown,
  path: string,
  baseDir: string,
): Parsed<EditorSettings> {
  const top = record(value, path, [
    "executable",
    "timeoutMs",
    "tempParent",
    "editPollMs",
  ]);
  if (!top.ok) return top;
  const timeoutMs = positive(top.value.timeoutMs, `${path}.timeoutMs`);
  if (!timeoutMs.ok) return timeoutMs;
  const editPollMs = positive(top.value.editPollMs, `${path}.editPollMs`);
  if (!editPollMs.ok) return editPollMs;
  const out: { -readonly [K in keyof EditorSettings]: EditorSettings[K] } = {
    timeoutMs: timeoutMs.value,
    editPollMs: editPollMs.value,
  };
  for (const key of ["executable", "tempParent"] as const) {
    if (top.value[key] === undefined) continue;
    const p = pathValue(top.value[key], `${path}.${key}`, baseDir);
    if (!p.ok) return p;
    out[key] = p.value;
  }
  return good(out);
}

/** Parses config text; relative paths resolve against `baseDir`, the config file's directory. */
export function parseConfig(
  text: string,
  baseDir: string,
): Parsed<StudioConfig> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail("config", "is not valid JSON");
  }
  const top = record(json, "config", [
    "studioRoot",
    "contentRoot",
    "registryRoot",
    "artifactRoot",
    "runtime",
    "editor",
    "conform",
  ]);
  if (!top.ok) return top;
  const config: { -readonly [K in keyof StudioConfig]: StudioConfig[K] } = {};
  for (const key of [
    "studioRoot",
    "contentRoot",
    "registryRoot",
    "artifactRoot",
  ] as const) {
    if (top.value[key] === undefined) continue;
    const p = pathValue(top.value[key], `config.${key}`, baseDir);
    if (!p.ok) return p;
    config[key] = p.value;
  }
  if (top.value.runtime !== undefined) {
    const runtime = parseRuntime(top.value.runtime, "config.runtime");
    if (!runtime.ok) return runtime;
    config.runtime = runtime.value;
  }
  if (top.value.editor !== undefined) {
    const editor = parseEditor(top.value.editor, "config.editor", baseDir);
    if (!editor.ok) return editor;
    config.editor = editor.value;
  }
  if (top.value.conform !== undefined) {
    if (!isRecord(top.value.conform))
      return fail("config.conform", "expected an object of named sets");
    const sets: Record<string, ConformParams> = {};
    for (const [name, value] of Object.entries(top.value.conform)) {
      if (name === "") return fail("config.conform", "a set needs a name");
      const set = parseConformParams(value, `config.conform.${name}`);
      if (!set.ok) return set;
      sets[name] = set.value;
    }
    config.conform = sets;
  }
  return good(config);
}

export function loadConfig(path: string): Parsed<StudioConfig> {
  let text: string;
  try {
    if (!statSync(path).isFile()) return fail("config", "is not a file");
    text = readFileSync(path, "utf8");
  } catch {
    return fail("config", "cannot be read");
  }
  return parseConfig(text, dirname(resolve(path)));
}

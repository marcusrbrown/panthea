// The installed-editor adapter. It builds an Aseprite workspace for an open
// edit with a trusted batch script, exports it with the verified CLI flags,
// and hands the exported sheet and metadata to the session's one import path.
// Aseprite is run with argv only (no shell), a minimal environment and a
// scratch directory outside the authoring root; a run is bounded by a timeout
// and only ever signalled by its own pid. The editor rewrites the RGB under
// fully transparent pixels to zero; a sheet imported by hand (refreshFallback)
// keeps whatever the owner exported.

/// <reference path="./lua-module.d.ts" />
import { type ChildProcess, spawn } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EditResult } from "./edit-session";
import { parseSheetJson } from "./export-import";
import type { StudioContent } from "./request";
import EMBEDDED_SCRIPT from "./scripts/export.lua" with { type: "text" };
import type { StudioSession } from "./session";
import { studioPaths } from "./workspace";

export interface AsepriteConfig {
  /** A configured executable; tried before PATH and the macOS bundle. */
  readonly executable?: string;
  /** The PATH to search; the process's own when absent. */
  readonly path?: string;
  readonly platform?: NodeJS.Platform;
  readonly bundleExecutable?: string;
  /** Longest a single batch run may take. */
  readonly timeoutMs: number;
  /** Where scratch files go; the OS temp directory when absent. */
  readonly tempParent?: string;
}

export type EditorResolution =
  | {
      readonly ok: true;
      readonly path: string;
      readonly source: "configured" | "path" | "bundle";
    }
  | { readonly ok: false; readonly message: string };

const DEFAULT_BUNDLE = "/Applications/Aseprite.app/Contents/MacOS/aseprite";
const SCRIPT_FILE = fileURLToPath(
  new URL("./scripts/export.lua", import.meta.url),
);

/**
 * The batch script's path. Run from source it is the file in the source tree.
 * A compiled binary ships no source tree, so there the embedded text is copied
 * into the run's scratch directory, which is removed with it.
 */
export function exportScriptPath(dir: string, onDisk = SCRIPT_FILE): string {
  if (existsSync(onDisk)) return onDisk;
  const copy = join(dir, "export.lua");
  writeFileSync(copy, EMBEDDED_SCRIPT, { mode: 0o600 });
  return copy;
}

const isExecutable = (path: string): boolean => {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** The configured executable, then PATH, then the macOS app bundle. */
export function resolveAseprite(config: AsepriteConfig): EditorResolution {
  if (config.executable !== undefined && isExecutable(config.executable))
    return { ok: true, path: config.executable, source: "configured" };
  const search = (config.path ?? process.env.PATH ?? "").split(delimiter);
  for (const dir of search) {
    if (dir === "") continue;
    const candidate = join(dir, "aseprite");
    if (isExecutable(candidate))
      return { ok: true, path: candidate, source: "path" };
  }
  const bundle = config.bundleExecutable ?? DEFAULT_BUNDLE;
  if (
    (config.platform ?? process.platform) === "darwin" &&
    isExecutable(bundle)
  )
    return { ok: true, path: bundle, source: "bundle" };
  return {
    ok: false,
    message:
      "Aseprite was not found (configured path, PATH, macOS bundle). The sheet and metadata still work without it: open edits/<id>/sheet.png and sheet.json in any editor, export a horizontal PNG strip and a json-array file with tags and slices, no trim or padding, and import them with the same session call.",
  };
}

export type EditorFailure = {
  readonly ok: false;
  readonly reason:
    | "editor-unavailable"
    | "editor-failed"
    | "timeout"
    | "aborted"
    | "export-incomplete"
    | "closed"
    | "not-found"
    | "wrong-state";
  readonly message: string;
};

export interface WorkspaceReadback {
  readonly rgb: boolean;
  readonly size: { readonly w: number; readonly h: number };
  readonly durationsMs: readonly number[];
  readonly tags: readonly {
    readonly name: string;
    readonly from: number;
    readonly to: number;
    readonly repeats: number;
  }[];
  readonly pivots: Readonly<
    Record<string, { readonly x: number; readonly y: number } | null>
  >;
  readonly palette: readonly string[];
}

export interface EditorAdapter {
  /** Builds workspace.aseprite for an open edit with the installed editor. */
  openWorkspace(
    editId: string,
  ): Promise<
    { readonly ok: true; readonly readback: WorkspaceReadback } | EditorFailure
  >;
  /** Exports the workspace to a sheet and metadata, then imports or finishes the edit with them. */
  refresh(
    editId: string,
    content: StudioContent,
    mode: "import" | "finish",
  ): Promise<EditResult | EditorFailure>;
  /** The same import path for a sheet and metadata the owner exported by hand. */
  refreshFallback(
    editId: string,
    png: Uint8Array,
    json: string,
    content: StudioContent,
    mode: "import" | "finish",
  ): EditResult;
  /** Kills any running editor child and waits for it to be gone. */
  close(): Promise<void>;
}

type Run =
  | {
      readonly kind: "exit";
      readonly code: number | null;
      readonly stdout: string;
      readonly stderr: string;
    }
  | { readonly kind: "timeout" }
  | { readonly kind: "aborted" }
  | { readonly kind: "spawn-error"; readonly message: string };

const fail = (
  reason: EditorFailure["reason"],
  message: string,
): EditorFailure => ({
  ok: false,
  reason,
  message,
});

const KILL_GRACE_MS = 1000;
const TAIL = 800;

export function createEditorAdapter(
  session: StudioSession,
  config: AsepriteConfig,
): EditorAdapter {
  interface Active {
    aborted: boolean;
    done: Promise<void>;
    terminate: () => void;
  }
  const running = new Set<Active>();

  /** Runs one batch invocation; the child is only ever signalled by its own pid. */
  function run(
    executable: string,
    args: readonly string[],
    home: string,
  ): Promise<Run> {
    return new Promise((resolve) => {
      const child: ChildProcess = spawn(executable, [...args], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { HOME: home },
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (data) => {
        stdout = (stdout + data).slice(-64_000);
      });
      child.stderr?.on("data", (data) => {
        stderr = (stderr + data).slice(-8_000);
      });
      let timedOut = false;
      let closed = false;
      const entry: Active = {
        aborted: false,
        done: Promise.resolve(),
        terminate: () => {
          if (closed || child.pid === undefined) return;
          child.kill("SIGTERM");
          setTimeout(() => {
            if (!closed) child.kill("SIGKILL");
          }, KILL_GRACE_MS).unref();
        },
      };
      const timer = setTimeout(() => {
        timedOut = true;
        entry.terminate();
      }, config.timeoutMs);
      entry.done = new Promise<void>((finished) => {
        const settle = (value: Run) => {
          closed = true;
          clearTimeout(timer);
          running.delete(entry);
          finished();
          resolve(value);
        };
        child.once("error", (error) =>
          settle({ kind: "spawn-error", message: error.message }),
        );
        child.once("close", (code) => {
          if (entry.aborted) settle({ kind: "aborted" });
          else if (timedOut) settle({ kind: "timeout" });
          else settle({ kind: "exit", code, stdout, stderr });
        });
      });
      running.add(entry);
    });
  }

  const failed = (result: Run): EditorFailure | undefined => {
    if (result.kind === "timeout")
      return fail(
        "timeout",
        `the editor did not finish within ${config.timeoutMs} ms and was stopped`,
      );
    if (result.kind === "aborted")
      return fail("aborted", "the editor run was stopped");
    if (result.kind === "spawn-error")
      return fail(
        "editor-failed",
        `the editor could not be started: ${result.message}`,
      );
    if (result.code !== 0)
      return fail(
        "editor-failed",
        `the editor exited with exit code ${result.code}: ${(result.stderr || result.stdout).trim().slice(-TAIL)}`,
      );
    return undefined;
  };

  const openEdit = (editId: string) => {
    const found = session.store.readEdit(editId);
    if (found.kind === "missing") return fail("not-found", `no edit ${editId}`);
    if (found.kind === "invalid")
      return fail("wrong-state", `edit ${editId} is invalid: ${found.message}`);
    if (found.value.status !== "open")
      return fail("wrong-state", `edit ${editId} is ${found.value.status}`);
    return found.value;
  };

  const scratch = () =>
    mkdtempSync(join(config.tempParent ?? tmpdir(), "studio-ase-"));

  function parseReadback(text: string): WorkspaceReadback {
    const lines = Object.fromEntries(
      text
        .split("\n")
        .filter((line) => line.includes("="))
        .map(
          (line) =>
            [
              line.slice(0, line.indexOf("=")),
              line.slice(line.indexOf("=") + 1),
            ] as const,
        ),
    );
    const [w, h] = (lines.size ?? "0x0").split("x").map(Number);
    const frames = Number(lines.frames ?? 0);
    const tags: { name: string; from: number; to: number; repeats: number }[] =
      [];
    const pivots: Record<string, { x: number; y: number } | null> = {};
    for (const [key, value] of Object.entries(lines)) {
      if (key.startsWith("tag.")) {
        const match = /^(\d+)-(\d+) repeats=(\d+)$/.exec(value);
        if (match)
          tags.push({
            name: key.slice(4),
            from: Number(match[1]),
            to: Number(match[2]),
            repeats: Number(match[3]),
          });
      } else if (key.startsWith("slice.pivot:")) {
        const [x, y] = value.split(",").map(Number);
        pivots[key.slice("slice.pivot:".length)] =
          value === "nil" ? null : { x: x as number, y: y as number };
      }
    }
    return {
      rgb: lines.rgb === "true",
      size: { w: w ?? 0, h: h ?? 0 },
      durationsMs: Array.from({ length: frames }, (_, i) =>
        Number(lines[`duration.${i + 1}`]),
      ),
      tags,
      pivots,
      palette: Array.from(
        { length: Number(lines["palette.count"] ?? 0) },
        (_, i) => lines[`palette.${i}`] ?? "",
      ),
    };
  }

  return {
    async openWorkspace(editId) {
      const editor = resolveAseprite(config);
      if (!editor.ok) return fail("editor-unavailable", editor.message);
      const edit = openEdit(editId);
      if ("ok" in edit) return edit;
      const set = session.store.readWorkingSet(edit.workingSetId);
      if (set.kind !== "found")
        return fail(
          "wrong-state",
          `working set ${edit.workingSetId} is unavailable`,
        );
      const png = session.store.readEditFile(editId, "sheet.png");
      const json = session.store.readEditFile(editId, "sheet.json");
      if (png === undefined || json === undefined)
        return fail("wrong-state", `edit ${editId} has no sheet to open`);
      const meta = parseSheetJson(new TextDecoder().decode(json), {
        slots: edit.slots,
        cell: edit.cell,
        max: Object.fromEntries(
          edit.slots.map((slot) => [slot, set.value.limits[slot]?.max ?? 0]),
        ),
      });
      if (!meta.ok)
        return fail(
          "wrong-state",
          `the sheet metadata is not valid: ${meta.message}`,
        );

      const colours = [
        ...new Set(
          edit.slots.flatMap(
            (slot) => edit.evidence[slot]?.palette.colours ?? [],
          ),
        ),
      ];
      const dir = scratch();
      try {
        writeFileSync(join(dir, "sheet.png"), png);
        writeFileSync(
          join(dir, "palette.gpl"),
          `GIMP Palette\nName: studio edit\nColumns: 4\n#\n${colours
            .map(
              (hex, i) =>
                `${Number.parseInt(hex.slice(1, 3), 16)} ${Number.parseInt(hex.slice(3, 5), 16)} ${Number.parseInt(hex.slice(5, 7), 16)} c${i}`,
            )
            .join("\n")}\n`,
        );
        const out = join(dir, "workspace.aseprite");
        const params: Record<string, string> = {
          sheet: join(dir, "sheet.png"),
          gpl: join(dir, "palette.gpl"),
          out,
          cellw: String(edit.cell.w),
          cellh: String(edit.cell.h),
          durations: meta.value.durations.join(","),
          tags: meta.value.tags
            .map((t) => `${t.name}:${t.from + 1}:${t.to + 1}`)
            .join(","),
          pivots: Object.entries(meta.value.pivots)
            .flatMap(([slot, pivot]) =>
              pivot === null ? [] : [`${slot}:${pivot.x}:${pivot.y}`],
            )
            .join(","),
        };
        const args = [
          "--batch",
          ...Object.entries(params).flatMap(([k, v]) => [
            "--script-param",
            `${k}=${v}`,
          ]),
          "--script",
          exportScriptPath(dir),
        ];
        const result = await run(editor.path, args, dir);
        const problem = failed(result);
        if (problem) return problem;
        if (result.kind !== "exit")
          return fail("editor-failed", "unexpected editor result");
        if (!existsSync(out) || statSync(out).size === 0)
          return fail(
            "export-incomplete",
            "the editor did not write the workspace",
          );
        try {
          session.store.putEditFile(
            editId,
            "workspace.aseprite",
            new Uint8Array(readFileSync(out)),
          );
        } catch (error) {
          return /closed/.test((error as Error).message)
            ? fail("closed", (error as Error).message)
            : fail("editor-failed", (error as Error).message);
        }
        return { ok: true, readback: parseReadback(result.stdout) };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },

    async refresh(editId, content, mode) {
      const editor = resolveAseprite(config);
      if (!editor.ok) return fail("editor-unavailable", editor.message);
      const edit = openEdit(editId);
      if ("ok" in edit) return edit;
      const workspace = join(
        studioPaths(session.store.root).edits,
        editId,
        "workspace.aseprite",
      );
      if (!existsSync(workspace))
        return fail(
          "wrong-state",
          `edit ${editId} has no workspace; open it in the editor first`,
        );
      const dir = scratch();
      try {
        const sheet = join(dir, "export.png");
        const data = join(dir, "export.json");
        const args = [
          "--batch",
          workspace,
          "--sheet-type",
          "horizontal",
          "--format",
          "json-array",
          "--list-tags",
          "--list-slices",
          "--sheet",
          sheet,
          "--data",
          data,
        ];
        const result = await run(editor.path, args, dir);
        const problem = failed(result);
        if (problem) return problem;
        if (
          !existsSync(sheet) ||
          !existsSync(data) ||
          statSync(sheet).size === 0 ||
          statSync(data).size === 0
        )
          return fail(
            "export-incomplete",
            "the editor exported no complete sheet and metadata",
          );
        const png = new Uint8Array(readFileSync(sheet));
        const json = readFileSync(data, "utf8");
        return mode === "import"
          ? session.importEdit(editId, png, json, content)
          : session.finishEdit(editId, png, json, content);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },

    refreshFallback: (editId, png, json, content, mode) =>
      mode === "import"
        ? session.importEdit(editId, png, json, content)
        : session.finishEdit(editId, png, json, content),

    async close() {
      const active = [...running];
      for (const entry of active) {
        entry.aborted = true;
        entry.terminate();
      }
      await Promise.all(active.map((entry) => entry.done));
    },
  };
}

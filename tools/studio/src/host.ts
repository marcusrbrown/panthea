// The owner of one studio root for the life of a process: it opens the SDK
// session on first use, lazily creates the runtime and the editor adapter,
// shares one drain between every command, watches open edits, and tears
// everything down in an order that keeps the root locked until the owned
// server is really gone.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AsepriteConfig,
  createEditorAdapter,
  type EditorAdapter,
  type LoadedContent,
  loadStudioContent,
  openRuntime,
  openStudioSession,
  type RuntimeConfig,
  readStudioStatus,
  type SelectedProfile,
  type StudioContent,
  type StudioOpen,
  type StudioRuntime,
  type StudioSession,
  type StudioStatus,
  studioPaths,
} from "@panthea/assets/studio";
import type { StudioConfig } from "./config";
import {
  type Json,
  jobSummary,
  type Outcome,
  refuse,
  safeMessage,
} from "./format";

export interface Deps {
  readonly loadContent: (root: string) => LoadedContent;
  readonly openSession: (root: string) => StudioOpen;
  readonly readStatus: (root: string) => StudioStatus;
  readonly openRuntime: (
    session: StudioSession,
    config: RuntimeConfig,
  ) => StudioRuntime;
  readonly createEditor: (
    session: StudioSession,
    config: AsepriteConfig,
  ) => EditorAdapter;
  /** A runtime profile other than the selected production one, for tests of a staged runtime. */
  readonly profile?: SelectedProfile;
  readonly drawSeed: () => number;
  /** Whether a process id names a live process; status uses it to tell an open session from a crashed one. */
  readonly isAlive: (pid: number) => boolean;
  readonly sleep: (ms: number) => Promise<void>;
  /** Progress and diagnostics: ids and statuses only, never prompts or output tails. */
  readonly log: (line: string) => void;
}

/** Signal 0 only checks that the process exists; EPERM means it exists under another user. */
export const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export const defaultDeps = (log: (line: string) => void): Deps => ({
  loadContent: loadStudioContent,
  openSession: openStudioSession,
  readStatus: readStudioStatus,
  openRuntime,
  createEditor: createEditorAdapter,
  drawSeed: () => crypto.getRandomValues(new Uint32Array(1))[0] as number,
  isAlive: processAlive,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log,
});

export const isOutcome = (value: unknown): value is Outcome =>
  typeof value === "object" && value !== null && "ok" in value;

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

interface Watch {
  readonly timer: ReturnType<typeof setInterval>;
  baseline: string;
  busy: boolean;
}

export class Studio {
  stopRequested: string | undefined;
  /** True once the edit being foreground-watched ends by finish or discard. */
  editEnded: ((editId: string) => void) | undefined;
  private session: StudioSession | undefined;
  private content: StudioContent | undefined;
  private runtime: StudioRuntime | undefined;
  private editor: EditorAdapter | undefined;
  private drain: Promise<void> | undefined;
  private refusal: string | undefined;
  private unfinished = 0;
  private tearingDown: Promise<void> | undefined;
  private readonly watches = new Map<string, Watch>();

  constructor(
    readonly config: StudioConfig,
    readonly deps: Deps,
    readonly mode: "oneshot" | "session",
  ) {}

  get stopping(): boolean {
    return this.tearingDown !== undefined;
  }

  get root(): string | undefined {
    return this.config.studioRoot;
  }

  /** The durable records, read without taking the writer lock. */
  readOnly(): StudioStatus | Outcome {
    if (this.root === undefined) return this.missing("studioRoot");
    return this.session === undefined
      ? this.deps.readStatus(this.root)
      : this.session.store.status();
  }

  missing(what: string): Outcome {
    return refuse(
      "missing-config",
      `${what} is not configured: set it in the config file${what === "studioRoot" ? " or pass --root" : ""}`,
      { field: what },
    );
  }

  owner(): StudioSession | Outcome {
    if (this.stopping)
      return refuse("shutting-down", "the session is shutting down");
    if (this.session !== undefined) return this.session;
    if (this.root === undefined) return this.missing("studioRoot");
    const opened = this.deps.openSession(this.root);
    if (opened.kind === "busy")
      return refuse("busy", "another session owns this studio root", {
        hint: "read it with status or list, or send the command to the owning session",
      });
    this.session = opened.session;
    for (const id of opened.session.recovered)
      this.deps.log(`recovered interrupted job ${id}`);
    return this.session;
  }

  loadedContent(): StudioContent | Outcome {
    if (this.content !== undefined) return this.content;
    if (this.config.contentRoot === undefined)
      return this.missing("contentRoot");
    const loaded = this.deps.loadContent(this.config.contentRoot);
    if (!loaded.ok)
      return refuse("invalid-content", "the content root does not load", {
        diagnostics: loaded.diagnostics.map((d) => ({
          file: d.file,
          message: d.message,
        })),
      });
    this.content = loaded.content;
    return this.content;
  }

  registryRoot(): string | Outcome {
    return this.config.registryRoot ?? this.missing("registryRoot");
  }

  runtimeFor(session: StudioSession): StudioRuntime | Outcome {
    if (this.runtime !== undefined) return this.runtime;
    const { artifactRoot, runtime } = this.config;
    if (artifactRoot === undefined) return this.missing("artifactRoot");
    if (runtime === undefined) return this.missing("runtime");
    const content = this.loadedContent();
    if (isOutcome(content)) return content;
    this.runtime = this.deps.openRuntime(session, {
      artifactRoot,
      port: runtime.port,
      content,
      deadlines: runtime.deadlines,
      pollMs: runtime.pollMs,
      ...(this.deps.profile === undefined
        ? {}
        : { profile: this.deps.profile }),
    });
    return this.runtime;
  }

  runtimeIfStarted(): StudioRuntime | undefined {
    return this.runtime;
  }

  editorFor(session: StudioSession): EditorAdapter | Outcome {
    if (this.editor !== undefined) return this.editor;
    const { editor } = this.config;
    if (editor === undefined) return this.missing("editor");
    this.editor = this.deps.createEditor(session, {
      ...(editor.executable === undefined
        ? {}
        : { executable: editor.executable }),
      timeoutMs: editor.timeoutMs,
      ...(editor.tempParent === undefined
        ? {}
        : { tempParent: editor.tempParent }),
    });
    return this.editor;
  }

  /** Starts draining the durable queue unless a drain is already running; one drain at a time. */
  kick(): void {
    const session = this.session;
    const runtime = this.runtime;
    if (this.drain !== undefined || this.stopping || !session || !runtime)
      return;
    const pollMs = this.config.runtime?.pollMs ?? 100;
    const seen = new Map<string, string>();
    const progress = setInterval(() => {
      for (const record of session.store.status().jobs) {
        if (seen.get(record.job.id) === record.job.status) continue;
        seen.set(record.job.id, record.job.status);
        this.deps.log(`job ${record.job.id} ${record.job.status}`);
      }
    }, pollMs);
    const queuedLeft = () => {
      const queued = session.queued();
      return queued.ok && queued.jobs.length > 0;
    };
    this.drain = (async () => {
      for (;;) {
        const result = await runtime.drain();
        if (!result.ok) {
          this.refusal = `${result.reason}: ${safeMessage(result.message)}`;
          this.deps.log(`drain stopped: ${this.refusal}`);
          return;
        }
        this.unfinished += result.results.filter(
          (r) => r.outcome === "failed" || r.outcome === "unavailable",
        ).length;
        if (result.stopped === "empty" || result.stopped === "start-failed") {
          if (!queuedLeft()) return;
          continue;
        }
        return;
      }
    })().finally(() => {
      clearInterval(progress);
      this.drain = undefined;
      if (!this.stopping && this.refusal === undefined && queuedLeft())
        this.kick();
    });
  }

  async idle(): Promise<void> {
    while (this.drain !== undefined) await this.drain;
  }

  drainRefusal(): string | undefined {
    return this.refusal;
  }

  /** Why the work this process ran did not finish: a drain that stopped, or jobs that failed or were unavailable. Operator cancellation is not a failure. */
  workflowFailure(): string | undefined {
    if (this.refusal !== undefined) return this.refusal;
    return this.unfinished > 0
      ? `${this.unfinished} job${this.unfinished === 1 ? "" : "s"} failed or were unavailable`
      : undefined;
  }

  /** Foreground-watches an edit's workspace; a changed file is imported once by content hash. */
  watchEdit(editId: string, workspaceHash: string | undefined): void {
    const session = this.session;
    const editor = this.editor;
    const content = this.content;
    const pollMs = this.config.editor?.editPollMs;
    if (!session || !editor || !content || pollMs === undefined) return;
    const file = join(
      studioPaths(session.store.root).edits,
      editId,
      "workspace.aseprite",
    );
    const watch: Watch = {
      baseline: workspaceHash ?? "",
      busy: false,
      timer: setInterval(async () => {
        if (watch.busy || !existsSync(file)) return;
        const hash = sha256(new Uint8Array(readFileSync(file)));
        if (hash === watch.baseline) return;
        watch.busy = true;
        watch.baseline = hash;
        try {
          const result = await editor.refresh(editId, content, "import");
          this.deps.log(
            result.ok
              ? `edit ${editId} ${result.changed ? "imported" : "unchanged"}`
              : `edit ${editId} not imported: ${result.reason}`,
          );
        } finally {
          watch.busy = false;
        }
      }, pollMs),
    };
    this.watches.set(editId, watch);
  }

  workspaceHash(editId: string): string | undefined {
    const session = this.session;
    if (session === undefined) return undefined;
    const file = join(
      studioPaths(session.store.root).edits,
      editId,
      "workspace.aseprite",
    );
    return existsSync(file)
      ? sha256(new Uint8Array(readFileSync(file)))
      : undefined;
  }

  unwatchEdit(editId: string): void {
    const watch = this.watches.get(editId);
    if (watch === undefined) return;
    clearInterval(watch.timer);
    this.watches.delete(editId);
    this.editEnded?.(editId);
  }

  get hasWatches(): boolean {
    return this.watches.size > 0;
  }

  /**
   * Stops watching, closes the editor and shuts the runtime down, keeping the
   * writer lock until the owned server is gone: a failed shutdown is retried
   * at the configured poll, never abandoned.
   */
  teardown(): Promise<void> {
    this.tearingDown ??= (async () => {
      for (const id of [...this.watches.keys()]) this.unwatchEdit(id);
      await this.editor?.close();
      if (this.runtime !== undefined) {
        const pollMs = this.config.runtime?.pollMs ?? 100;
        for (let attempt = 1; ; attempt += 1) {
          const result = await this.runtime.shutdown();
          if (result.ok) break;
          this.deps.log(
            `the owned runtime is still stopping; the root stays locked (attempt ${attempt})`,
          );
          await this.deps.sleep(pollMs);
        }
      } else this.session?.close();
    })();
    return this.tearingDown;
  }

  jobsOf(ids: readonly string[]): Json[] {
    const session = this.session;
    if (session === undefined) return [];
    const records = new Map(
      session.store.status().jobs.map((r) => [r.job.id, r]),
    );
    return ids.flatMap((id) => {
      const record = records.get(id);
      return record === undefined ? [] : [jobSummary(record)];
    });
  }
}

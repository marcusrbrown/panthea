// The shapes the webview receives from the native host, and the explicit checks
// that turn an untrusted payload into one of them. Everything that arrives from
// `invoke` or the studio channel is unknown until a parser here accepts it; a
// refusal names where the payload failed, never what it held, and the caller
// drops the payload. Nothing here imports Tauri, node or the assets runtime.

export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const good = <T>(value: T): Parsed<T> => ({ ok: true, value });
const bad = (path: string, why: string): Parsed<never> => ({
  ok: false,
  message: `${path}: ${why}`,
});

type Obj = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isSlug = (value: unknown): value is string =>
  isText(value) && value.length <= 128 && SLUG.test(value);

// --- Host state -------------------------------------------------------------

export const HOST_STATES = [
  "not-configured",
  "starting",
  "running",
  "read-only",
  "restarting",
  "unavailable",
  "stopped",
] as const;
export type HostState = (typeof HOST_STATES)[number];

/**
 * Where the app is. A restarting or given-up sidecar says which attempt. A
 * read-only host is a healthy sidecar beside another session that holds the
 * studio root: reads work, writes are refused, and `lockHolder` is that
 * session's process id. It is not a failure and has no attempt.
 */
export interface HostStatus {
  readonly state: HostState;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly lockHolder?: number;
}

const ATTEMPT_STATES: readonly HostState[] = ["restarting", "unavailable"];

export function parseHostStatus(value: unknown): Parsed<HostStatus> {
  if (!isObject(value)) return bad("host", "not an object");
  const { state, attempt, maxAttempts, lockHolder } = value;
  if (!HOST_STATES.includes(state as HostState))
    return bad("host.state", "not a known state");
  const known = state as HostState;
  if (known === "read-only") {
    if (attempt !== undefined || maxAttempts !== undefined)
      return bad("host", "an attempt on a state that has none");
    if (!isCount(lockHolder) || lockHolder < 1)
      return bad("host.lockHolder", "not a positive process id");
    return good({ state: known, lockHolder });
  }
  if (lockHolder !== undefined)
    return bad("host.lockHolder", "a lock holder on a state that has none");
  if (!ATTEMPT_STATES.includes(known)) {
    if (attempt !== undefined || maxAttempts !== undefined)
      return bad("host", "an attempt on a state that has none");
    return good({ state: known });
  }
  if (!isCount(attempt) || attempt < 1)
    return bad("host.attempt", "not a positive whole number");
  if (!isCount(maxAttempts) || maxAttempts < 1)
    return bad("host.maxAttempts", "not a positive whole number");
  if (attempt > maxAttempts) return bad("host.attempt", "past the maximum");
  return good({ state: known, attempt, maxAttempts });
}

// --- Snapshot ---------------------------------------------------------------

/** One record of a list section. Only `id` is checked here; the workflow narrows the rest where it uses it. */
export interface SummaryRecord {
  readonly id: string;
  readonly [field: string]: unknown;
}

export type SourceKind = "canon" | "draft" | "approved";
const SOURCE_KINDS: readonly string[] = ["canon", "draft", "approved"];

export interface KeyedSelection {
  readonly source: SourceKind;
  readonly id: string;
  /** Changes whenever the selection's resolved content does. */
  readonly key: string;
}

/** What a poller compares to see that something changed without fetching it. */
export interface SourceKeys {
  /** Changes whenever the listing or its problems do. */
  readonly listing: string;
  readonly selections: readonly KeyedSelection[];
}

export interface SnapshotError {
  readonly code: string;
  readonly message?: string;
}

export const SNAPSHOT_LISTS = [
  "requests",
  "jobs",
  "candidates",
  "edits",
  "workingSets",
  "assets",
] as const;
export type SnapshotList = (typeof SNAPSHOT_LISTS)[number];

/**
 * What the host pushes over the studio channel. `host` is always present. The
 * store sections are absent until a sidecar has answered this launch, and
 * `null` when the session refused that section (see `errors`).
 */
export interface StudioSnapshot {
  readonly host: HostStatus;
  readonly status?: Obj | null;
  readonly requests?: readonly SummaryRecord[] | null;
  readonly jobs?: readonly SummaryRecord[] | null;
  readonly candidates?: readonly SummaryRecord[] | null;
  readonly edits?: readonly SummaryRecord[] | null;
  readonly workingSets?: readonly SummaryRecord[] | null;
  readonly assets?: readonly SummaryRecord[] | null;
  readonly keys?: SourceKeys | null;
  readonly errors?: Readonly<Record<string, SnapshotError>>;
}

function parseRecords(
  value: unknown,
  path: string,
): Parsed<readonly SummaryRecord[]> {
  if (!Array.isArray(value)) return bad(path, "not a list");
  for (let i = 0; i < value.length; i += 1) {
    const item: unknown = value[i];
    if (!isObject(item)) return bad(`${path}[${i}]`, "not an object");
    if (!isText(item.id)) return bad(`${path}[${i}].id`, "not text");
  }
  return good(value as readonly SummaryRecord[]);
}

function parseKeys(value: unknown): Parsed<SourceKeys> {
  if (!isObject(value)) return bad("keys", "not an object");
  if (!isText(value.listing)) return bad("keys.listing", "not text");
  if (!Array.isArray(value.selections))
    return bad("keys.selections", "not a list");
  const selections: KeyedSelection[] = [];
  for (let i = 0; i < value.selections.length; i += 1) {
    const item: unknown = value.selections[i];
    const at = `keys.selections[${i}]`;
    if (!isObject(item)) return bad(at, "not an object");
    if (!SOURCE_KINDS.includes(item.source as string))
      return bad(`${at}.source`, "not a known source");
    if (!isSlug(item.id))
      return bad(`${at}.id`, "not a lowercase hyphenated id");
    if (!isText(item.key) || item.key === "")
      return bad(`${at}.key`, "not text");
    selections.push({
      source: item.source as SourceKind,
      id: item.id,
      key: item.key,
    });
  }
  return good({ listing: value.listing, selections });
}

function parseErrors(
  value: unknown,
): Parsed<Readonly<Record<string, SnapshotError>>> {
  if (!isObject(value)) return bad("errors", "not an object");
  const errors: Record<string, SnapshotError> = {};
  for (const [section, entry] of Object.entries(value)) {
    if (!isObject(entry) || !isText(entry.code) || entry.code === "")
      return bad(`errors.${section.slice(0, 32)}`, "not an error with a code");
    errors[section] = isText(entry.message)
      ? { code: entry.code, message: entry.message }
      : { code: entry.code };
  }
  return good(errors);
}

export function parseSnapshot(value: unknown): Parsed<StudioSnapshot> {
  if (!isObject(value)) return bad("snapshot", "not an object");
  const host = parseHostStatus(value.host);
  if (!host.ok) return host;

  const out: { -readonly [K in keyof StudioSnapshot]: StudioSnapshot[K] } = {
    host: host.value,
  };
  if (value.status !== undefined) {
    if (value.status !== null && !isObject(value.status))
      return bad("status", "not an object");
    out.status = value.status as Obj | null;
  }
  for (const section of SNAPSHOT_LISTS) {
    const raw = value[section];
    if (raw === undefined) continue;
    if (raw === null) {
      out[section] = null;
      continue;
    }
    const records = parseRecords(raw, section);
    if (!records.ok) return records;
    out[section] = records.value;
  }
  if (value.keys !== undefined) {
    if (value.keys === null) out.keys = null;
    else {
      const keys = parseKeys(value.keys);
      if (!keys.ok) return keys;
      out.keys = keys.value;
    }
  }
  if (value.errors !== undefined) {
    const errors = parseErrors(value.errors);
    if (!errors.ok) return errors;
    out.errors = errors.value;
  }
  return good(out);
}

// --- Command errors ---------------------------------------------------------

/** What every host command rejects with. */
export interface CommandError {
  readonly code: string;
  readonly message: string;
  /** True when asking again may succeed (the sidecar is starting or just went away). */
  readonly retryable: boolean;
  readonly detail?: unknown;
}

/** Reads a rejection from `invoke`. Anything that is not the host's error shape becomes a non-retryable `unknown`. */
export function parseCommandError(value: unknown): CommandError {
  if (isObject(value) && isText(value.code) && value.code !== "") {
    const error: CommandError = {
      code: value.code,
      message: isText(value.message) ? value.message : "",
      retryable: value.retryable === true,
    };
    return value.detail === undefined
      ? error
      : { ...error, detail: value.detail };
  }
  return {
    code: "unknown",
    message: value instanceof Error ? value.message : "the host call failed",
    retryable: false,
  };
}

// --- Config and edit replies ------------------------------------------------

/** Whether a config is chosen and what the host is doing. It carries no path. */
export interface ConfigStatus {
  readonly configured: boolean;
  readonly state: HostState;
}

export function parseConfigStatus(value: unknown): Parsed<ConfigStatus> {
  if (!isObject(value)) return bad("config", "not an object");
  if (typeof value.configured !== "boolean")
    return bad("config.configured", "not a boolean");
  if (!HOST_STATES.includes(value.state as HostState))
    return bad("config.state", "not a known state");
  return good({
    configured: value.configured,
    state: value.state as HostState,
  });
}

export type ConfigChoice =
  | { readonly cancelled: true }
  | ({ readonly cancelled: false } & ConfigStatus);

export function parseConfigChoice(value: unknown): Parsed<ConfigChoice> {
  if (isObject(value) && value.cancelled === true)
    return good({ cancelled: true });
  const status = parseConfigStatus(value);
  return status.ok ? good({ cancelled: false, ...status.value }) : status;
}

export interface EditOpened {
  readonly editId: string;
  readonly slots: readonly string[];
  readonly workspace: {
    readonly size: { readonly w: number; readonly h: number };
    readonly durationsMs: readonly number[];
    readonly tags: readonly {
      readonly name: string;
      readonly from: number;
      readonly to: number;
    }[];
  };
  /** Whether the host started Aseprite on the workspace. When it did not, export and import still work. */
  readonly editor: { readonly launched: boolean; readonly reason?: string };
}

const isTextList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(isText);

export function parseEditOpened(value: unknown): Parsed<EditOpened> {
  if (!isObject(value)) return bad("edit", "not an object");
  if (!isText(value.editId)) return bad("edit.editId", "not text");
  if (!isTextList(value.slots)) return bad("edit.slots", "not a list of text");
  const { workspace, editor } = value;
  if (!isObject(workspace)) return bad("edit.workspace", "not an object");
  const size = workspace.size;
  if (!isObject(size) || !isNumber(size.w) || !isNumber(size.h))
    return bad("edit.workspace.size", "not a width and height");
  if (
    !Array.isArray(workspace.durationsMs) ||
    !workspace.durationsMs.every(isNumber)
  )
    return bad("edit.workspace.durationsMs", "not a list of numbers");
  if (!Array.isArray(workspace.tags))
    return bad("edit.workspace.tags", "not a list");
  const tags: { name: string; from: number; to: number }[] = [];
  for (const tag of workspace.tags as unknown[]) {
    if (
      !isObject(tag) ||
      !isText(tag.name) ||
      !isNumber(tag.from) ||
      !isNumber(tag.to)
    )
      return bad("edit.workspace.tags", "not a list of tags");
    tags.push({ name: tag.name, from: tag.from, to: tag.to });
  }
  if (!isObject(editor) || typeof editor.launched !== "boolean")
    return bad("edit.editor", "not a launch result");
  return good({
    editId: value.editId,
    slots: value.slots,
    workspace: {
      size: { w: size.w, h: size.h },
      durationsMs: workspace.durationsMs as readonly number[],
      tags,
    },
    editor: isText(editor.reason)
      ? { launched: editor.launched, reason: editor.reason }
      : { launched: editor.launched },
  });
}

export type EditExport =
  | { readonly cancelled: true }
  | {
      readonly cancelled: false;
      readonly editId: string;
      readonly files: readonly string[];
    };

export function parseEditExport(value: unknown): Parsed<EditExport> {
  if (isObject(value) && value.cancelled === true)
    return good({ cancelled: true });
  if (!isObject(value)) return bad("export", "not an object");
  if (!isText(value.editId)) return bad("export.editId", "not text");
  if (!isTextList(value.files))
    return bad("export.files", "not a list of text");
  return good({ cancelled: false, editId: value.editId, files: value.files });
}

export type EditBrought =
  | { readonly cancelled: true }
  | {
      readonly cancelled: false;
      readonly editId: string;
      readonly state: "imported" | "finished";
      readonly changed: boolean;
    };

export function parseEditBrought(value: unknown): Parsed<EditBrought> {
  if (isObject(value) && value.cancelled === true)
    return good({ cancelled: true });
  if (!isObject(value)) return bad("import", "not an object");
  if (!isText(value.editId)) return bad("import.editId", "not text");
  if (value.state !== "imported" && value.state !== "finished")
    return bad("import.state", "not imported or finished");
  if (typeof value.changed !== "boolean")
    return bad("import.changed", "not a boolean");
  return good({
    cancelled: false,
    editId: value.editId,
    state: value.state,
    changed: value.changed,
  });
}

// --- The latest save of an edit ------------------------------------------------

export type FrameChange = "unchanged" | "changed" | "added" | "unavailable";

/** One pixel that differs, as `#rrggbbaa` (a transparent pixel is `#00000000`). */
export interface PixelChange {
  readonly x: number;
  readonly y: number;
  readonly before: string;
  readonly after: string;
}

export interface EditReportFrame {
  readonly index: number;
  /** The stored report-only verdict of the frame as drawn. */
  readonly report: "pass" | "fail";
  readonly failedChecks: readonly string[];
  readonly change: FrameChange;
  /** Null for an added frame and when no base was recorded. */
  readonly pixelsChanged: number | null;
  readonly diff: readonly PixelChange[] | null;
}

export interface EditReportSlot {
  readonly slot: string;
  readonly diffAgainst: "recorded" | "unavailable";
  readonly frames: readonly EditReportFrame[];
  /** Frames this save has beyond the version it is measured against. */
  readonly addedFrames: readonly number[];
  /** Frames that version had beyond this save. */
  readonly removedFrames: readonly number[];
}

export interface EditReport {
  readonly editId: string;
  readonly workingSetId: string;
  readonly state: "open" | "finished";
  readonly sheetHash: string;
  readonly metadataHash: string;
  readonly slots: readonly EditReportSlot[];
}

const SHA256 = /^[0-9a-f]{64}$/;
const COLOUR = /^#[0-9a-f]{8}$/;

function parsePixel(value: unknown, path: string): Parsed<PixelChange> {
  if (!isObject(value)) return bad(path, "not an object");
  if (!isCount(value.x) || !isCount(value.y))
    return bad(path, "not a position");
  if (!isText(value.before) || !COLOUR.test(value.before))
    return bad(`${path}.before`, "not a colour");
  if (!isText(value.after) || !COLOUR.test(value.after))
    return bad(`${path}.after`, "not a colour");
  return good({
    x: value.x,
    y: value.y,
    before: value.before,
    after: value.after,
  });
}

const FRAME_CHANGES: readonly FrameChange[] = [
  "unchanged",
  "changed",
  "added",
  "unavailable",
];

function parseReportFrame(
  value: unknown,
  path: string,
  index: number,
): Parsed<EditReportFrame> {
  if (!isObject(value)) return bad(path, "not an object");
  if (value.index !== index) return bad(`${path}.index`, "out of order");
  if (value.report !== "pass" && value.report !== "fail")
    return bad(`${path}.report`, "not pass or fail");
  if (!Array.isArray(value.failedChecks) || !value.failedChecks.every(isText))
    return bad(`${path}.failedChecks`, "not a list of text");
  if (value.report === "pass" && value.failedChecks.length > 0)
    return bad(`${path}.failedChecks`, "a passing frame has failed checks");
  const change = FRAME_CHANGES.find((c) => c === value.change);
  if (change === undefined) return bad(`${path}.change`, "not a known change");

  if (change === "added" || change === "unavailable") {
    if (value.pixelsChanged !== null || value.diff !== null)
      return bad(path, `a ${change} frame has no diff`);
    return good({
      index,
      report: value.report,
      failedChecks: value.failedChecks as readonly string[],
      change,
      pixelsChanged: null,
      diff: null,
    });
  }
  if (!isCount(value.pixelsChanged))
    return bad(`${path}.pixelsChanged`, "not a count");
  if (!Array.isArray(value.diff)) return bad(`${path}.diff`, "not a list");
  if (value.diff.length !== value.pixelsChanged)
    return bad(`${path}.diff`, "does not match the count");
  if ((change === "unchanged") !== (value.pixelsChanged === 0))
    return bad(`${path}.change`, "does not match the count");
  const diff: PixelChange[] = [];
  for (let i = 0; i < value.diff.length; i += 1) {
    const pixel = parsePixel(value.diff[i], `${path}.diff[${i}]`);
    if (!pixel.ok) return pixel;
    diff.push(pixel.value);
  }
  return good({
    index,
    report: value.report,
    failedChecks: value.failedChecks as readonly string[],
    change,
    pixelsChanged: value.pixelsChanged,
    diff,
  });
}

function parseReportSlot(value: unknown, path: string): Parsed<EditReportSlot> {
  if (!isObject(value)) return bad(path, "not an object");
  if (!isText(value.slot) || value.slot === "")
    return bad(`${path}.slot`, "not text");
  if (value.diffAgainst !== "recorded" && value.diffAgainst !== "unavailable")
    return bad(`${path}.diffAgainst`, "not recorded or unavailable");
  if (!Array.isArray(value.frames) || value.frames.length === 0)
    return bad(`${path}.frames`, "not a list of frames");
  const frames: EditReportFrame[] = [];
  for (let i = 0; i < value.frames.length; i += 1) {
    const frame = parseReportFrame(value.frames[i], `${path}.frames[${i}]`, i);
    if (!frame.ok) return frame;
    if (
      (frame.value.change === "unavailable") !==
      (value.diffAgainst === "unavailable")
    )
      return bad(`${path}.frames[${i}].change`, "does not match diffAgainst");
    frames.push(frame.value);
  }
  const counts = (field: unknown, at: string): Parsed<readonly number[]> => {
    if (!Array.isArray(field) || !field.every(isCount))
      return bad(at, "not a list of frame numbers");
    for (let i = 1; i < field.length; i += 1)
      if ((field[i] as number) <= (field[i - 1] as number))
        return bad(at, "not in ascending order");
    return good(field as readonly number[]);
  };
  const added = counts(value.addedFrames, `${path}.addedFrames`);
  if (!added.ok) return added;
  const removed = counts(value.removedFrames, `${path}.removedFrames`);
  if (!removed.ok) return removed;
  const addedNow = frames
    .filter((f) => f.change === "added")
    .map((f) => f.index);
  if (JSON.stringify(addedNow) !== JSON.stringify(added.value))
    return bad(`${path}.addedFrames`, "not the added frames");
  if (removed.value.some((n) => n < frames.length))
    return bad(`${path}.removedFrames`, "names a frame the save has");
  if (value.diffAgainst === "unavailable" && removed.value.length > 0)
    return bad(
      `${path}.removedFrames`,
      "nothing to remove from an unknown base",
    );
  return good({
    slot: value.slot,
    diffAgainst: value.diffAgainst,
    frames,
    addedFrames: added.value,
    removedFrames: removed.value,
  });
}

export function parseEditReport(value: unknown): Parsed<EditReport> {
  if (!isObject(value)) return bad("report", "not an object");
  if (!isSlug(value.editId)) return bad("report.editId", "not an id");
  if (!isSlug(value.workingSetId))
    return bad("report.workingSetId", "not an id");
  if (value.state !== "open" && value.state !== "finished")
    return bad("report.state", "not open or finished");
  if (!isText(value.sheetHash) || !SHA256.test(value.sheetHash))
    return bad("report.sheetHash", "not a hash");
  if (!isText(value.metadataHash) || !SHA256.test(value.metadataHash))
    return bad("report.metadataHash", "not a hash");
  if (!Array.isArray(value.slots)) return bad("report.slots", "not a list");
  const slots: EditReportSlot[] = [];
  for (let i = 0; i < value.slots.length; i += 1) {
    const slot = parseReportSlot(value.slots[i], `report.slots[${i}]`);
    if (!slot.ok) return slot;
    slots.push(slot.value);
  }
  return good({
    editId: value.editId,
    workingSetId: value.workingSetId,
    state: value.state,
    sheetHash: value.sheetHash,
    metadataHash: value.metadataHash,
    slots,
  });
}

// --- A candidate's stored frames -------------------------------------------------

export interface CandidateFrame {
  readonly index: number;
  /** A candidate is one generated still, so null; a frame with timing carries it. */
  readonly durationMs: number | null;
  readonly imageHash: string;
}

/** The metadata of a candidate's stored image. The pixels are fetched by frame number, never carried here. */
export interface CandidateFrames {
  readonly candidateId: string;
  readonly width: number;
  readonly height: number;
  readonly frames: readonly CandidateFrame[];
}

export function parseCandidateFrames(value: unknown): Parsed<CandidateFrames> {
  if (!isObject(value)) return bad("candidate", "not an object");
  if (!isSlug(value.candidateId))
    return bad("candidate.candidateId", "not an id");
  if (!isCount(value.width) || value.width < 1)
    return bad("candidate.width", "not a positive whole number");
  if (!isCount(value.height) || value.height < 1)
    return bad("candidate.height", "not a positive whole number");
  if (!Array.isArray(value.frames) || value.frames.length === 0)
    return bad("candidate.frames", "not a list of frames");
  const frames: CandidateFrame[] = [];
  for (let i = 0; i < value.frames.length; i += 1) {
    const at = `candidate.frames[${i}]`;
    const frame: unknown = value.frames[i];
    if (!isObject(frame)) return bad(at, "not an object");
    if (frame.index !== i) return bad(`${at}.index`, "out of order");
    if (
      frame.durationMs !== null &&
      (!isCount(frame.durationMs) || frame.durationMs < 1)
    )
      return bad(`${at}.durationMs`, "not null or a positive whole number");
    if (!isText(frame.imageHash) || !SHA256.test(frame.imageHash))
      return bad(`${at}.imageHash`, "not a hash");
    frames.push({
      index: i,
      durationMs: frame.durationMs as number | null,
      imageHash: frame.imageHash,
    });
  }
  return good({
    candidateId: value.candidateId,
    width: value.width,
    height: value.height,
    frames,
  });
}

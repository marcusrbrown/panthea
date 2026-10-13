// The local causal trace store: observation records, proposals (accepted
// and rejected), and presentation receipts, linked by correlation/causation
// IDs. Local causal recording and inspection are always on; external
// export is a separate, opt-in concern (docs/README.md invariants) this
// module does not implement.
//
// Deliberately decoupled from packages/persistence: this module takes a
// plain `bun:sqlite` `Database` handle (the composing service, e.g.
// apps/simulation, decides whether that is the same physical file as the
// world store or a dedicated trace file) and an injected `EventSource` for
// resolving committed events by ID, rather than depending on
// @panthea/persistence's `Store` type. `packages/telemetry`'s package.json
// only declares `@panthea/contracts` as a dependency.
//
// `packages/contracts`' Proposal shapes have no `id`/`proposalId` field, so
// a proposal can't be addressed by trace records without one. This module
// mints a local `ProposalId` brand using contracts' own generic
// `idParser`/`idFactory` helpers rather than editing packages/contracts.

import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  type Brand,
  type CausationId,
  type CorrelationId,
  canonicalJson,
  type EventId,
  idFactory,
  idParser,
  type ObservationId,
  type ObservationRecord,
  type Proposal,
  type RejectionReasonCode,
  type SessionId,
  timeOrderedIdFactory,
  type WorldEvent,
} from "@panthea/contracts";

export type ProposalId = Brand<string, "ProposalId">;
export const parseProposalId = idParser<"ProposalId">();
export const createProposalId = timeOrderedIdFactory<"ProposalId">("proposal");

export type ModelRequestId = Brand<string, "ModelRequestId">;
export const parseModelRequestId = idParser<"ModelRequestId">();
export const createModelRequestId =
  idFactory<"ModelRequestId">("model-request");

/** Resolves committed events by ID. Injected so this module never assumes a specific events table shape (packages/persistence owns that). */
export interface EventSource {
  getEvent(id: EventId): WorldEvent | undefined;
}

/** Creates the trace tables (idempotent). Safe to call on every open. */
export function ensureTraceSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trace_observations (
      id TEXT PRIMARY KEY,
      observer TEXT NOT NULL,
      state_revision INTEGER NOT NULL,
      source TEXT NOT NULL,
      recorded_at INTEGER NOT NULL,
      payload TEXT NOT NULL
    ) STRICT
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS trace_proposal_outcomes (
      proposal_id TEXT PRIMARY KEY,
      observation_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      causation_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      reason TEXT,
      recorded_at INTEGER NOT NULL,
      payload TEXT NOT NULL,
      CHECK (outcome IN ('committed', 'rejected'))
    ) STRICT
  `);
  // Every event a committed proposal produced, in commit order. An event
  // carries only its observation id, so this is what tells two proposals
  // that cite the same observation apart.
  db.exec(`
    CREATE TABLE IF NOT EXISTS trace_outcome_events (
      event_id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      position INTEGER NOT NULL
    ) STRICT
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_trace_outcome_events_proposal_id
    ON trace_outcome_events(proposal_id, position)
  `);
  // One row per model call chain (see `recordModelRequest`). `proposal_id` is
  // the proposal the request produced; it is null when the chain was
  // exhausted or the intent was refused before it became a proposal.
  // `exhausted_reason` names why a turn ended with no chain run. The cap
  // columns are what the prompt cap measured and shed for the request; null
  // for a request recorded by a caller that has no cap.
  db.exec(`
    CREATE TABLE IF NOT EXISTS trace_model_requests (
      id TEXT PRIMARY KEY,
      proposal_id TEXT,
      role TEXT NOT NULL,
      outcome TEXT NOT NULL,
      steps TEXT NOT NULL,
      elapsed_ms INTEGER NOT NULL,
      prompt_digest TEXT NOT NULL,
      output_digest TEXT,
      prompt_payload TEXT,
      output_payload TEXT,
      recorded_at INTEGER NOT NULL,
      exhausted_reason TEXT,
      estimated_tokens INTEGER,
      token_ratio REAL,
      shed_events INTEGER,
      shed_actions INTEGER,
      shed_memories INTEGER,
      shed_prayers INTEGER,
      CHECK (outcome IN ('intent', 'exhausted')),
      CHECK (outcome <> 'exhausted' OR proposal_id IS NULL),
      CHECK (outcome = 'exhausted' OR exhausted_reason IS NULL)
    ) STRICT
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_trace_model_requests_proposal_id
    ON trace_model_requests(proposal_id)
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS trace_receipts (
      event_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      presented_at_ms INTEGER NOT NULL,
      PRIMARY KEY (event_id, session_id)
    ) STRICT
  `);
}

export type RecordObservationResult =
  /** A new observation was recorded. */
  | { readonly kind: "recorded" }
  /** The id was already recorded with exactly this content; nothing changed. */
  | { readonly kind: "same" }
  /** The id was already recorded with different content; nothing changed, and `recorded` is what the trace still holds. */
  | { readonly kind: "conflict"; readonly recorded: ObservationRecord };

/**
 * Records an observation. An observation id binds to one content, forever:
 * recording the same content again is a no-op (several proposals may cite
 * one unchanged observation), and recording different content under a used
 * id changes nothing and reports a conflict. It never throws for a
 * conflict, because callers run inside a tick transaction where a throw
 * would roll the tick back to be repeated; callers screen for conflicts
 * before the tick and refuse the proposal with an explicit outcome.
 */
export function recordObservation(
  db: Database,
  record: ObservationRecord,
  now: number = Date.now(),
): RecordObservationResult {
  const existing = getObservation(db, record.id);
  if (existing) {
    return canonicalJson(existing.record) === canonicalJson(record)
      ? { kind: "same" }
      : { kind: "conflict", recorded: existing.record };
  }
  db.run(
    `INSERT INTO trace_observations
       (id, observer, state_revision, source, recorded_at, payload)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.observer,
      record.stateRevision,
      record.source,
      now,
      JSON.stringify(record),
    ],
  );
  return { kind: "recorded" };
}

export interface ObservationEntry {
  readonly record: ObservationRecord;
}

export function getObservation(
  db: Database,
  id: ObservationId,
): ObservationEntry | undefined {
  const row = db
    .query("SELECT payload FROM trace_observations WHERE id = ?")
    .get(id) as { payload: string } | null;
  if (!row) {
    return undefined;
  }
  return { record: JSON.parse(row.payload) as ObservationRecord };
}

export type ProposalOutcomeKind = "committed" | "rejected";

export interface RecordProposalOutcomeInput {
  readonly proposalId: ProposalId;
  readonly observationId: ObservationId;
  readonly correlationId: CorrelationId;
  readonly causationId: CausationId;
  readonly proposal: Proposal;
  readonly outcome: ProposalOutcomeKind;
  readonly reason?: RejectionReasonCode;
  /** Every event a committed proposal produced, in commit order. */
  readonly eventIds?: readonly EventId[];
}

export function recordProposalOutcome(
  db: Database,
  input: RecordProposalOutcomeInput,
  now: number = Date.now(),
): void {
  db.run(
    `INSERT OR IGNORE INTO trace_proposal_outcomes
       (proposal_id, observation_id, correlation_id, causation_id, outcome, reason, recorded_at, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.proposalId,
      input.observationId,
      input.correlationId,
      input.causationId,
      input.outcome,
      input.reason ?? null,
      now,
      JSON.stringify(input.proposal),
    ],
  );
  (input.eventIds ?? []).forEach((eventId, position) => {
    db.run(
      `INSERT OR IGNORE INTO trace_outcome_events (event_id, proposal_id, position)
       VALUES (?, ?, ?)`,
      [eventId, input.proposalId, position],
    );
  });
}

export interface ProposalOutcomeRow {
  readonly proposalId: ProposalId;
  readonly observationId: ObservationId;
  readonly correlationId: CorrelationId;
  readonly causationId: CausationId;
  readonly outcome: ProposalOutcomeKind;
  readonly reason: RejectionReasonCode | undefined;
  /** Every event the proposal produced, in commit order; a rejection lists only the goal events its goal change still committed. */
  readonly eventIds: readonly EventId[];
  readonly proposal: Proposal;
}

function decodeProposalOutcomeRow(
  db: Database,
  row: {
    proposal_id: string;
    observation_id: string;
    correlation_id: string;
    causation_id: string;
    outcome: string;
    reason: string | null;
    payload: string;
  },
): ProposalOutcomeRow {
  return {
    proposalId: row.proposal_id as ProposalId,
    observationId: row.observation_id as ObservationId,
    correlationId: row.correlation_id as CorrelationId,
    causationId: row.causation_id as CausationId,
    outcome: row.outcome as ProposalOutcomeKind,
    reason: (row.reason ?? undefined) as RejectionReasonCode | undefined,
    eventIds: (
      db
        .query(
          "SELECT event_id FROM trace_outcome_events WHERE proposal_id = ? ORDER BY position ASC",
        )
        .all(row.proposal_id) as { event_id: string }[]
    ).map((event) => event.event_id as EventId),
    proposal: JSON.parse(row.payload) as Proposal,
  };
}

export function getProposalOutcomeByProposalId(
  db: Database,
  proposalId: ProposalId,
): ProposalOutcomeRow | undefined {
  const row = db
    .query("SELECT * FROM trace_proposal_outcomes WHERE proposal_id = ?")
    .get(proposalId) as Parameters<typeof decodeProposalOutcomeRow>[1] | null;
  return row ? decodeProposalOutcomeRow(db, row) : undefined;
}

export function getProposalOutcomeByEventId(
  db: Database,
  eventId: EventId,
): ProposalOutcomeRow | undefined {
  const link = db
    .query("SELECT proposal_id FROM trace_outcome_events WHERE event_id = ?")
    .get(eventId) as { proposal_id: string } | null;
  return link
    ? getProposalOutcomeByProposalId(db, link.proposal_id as ProposalId)
    : undefined;
}

export interface RecordReceiptInput {
  readonly eventId: EventId;
  readonly sessionId: SessionId;
}

/** Thrown by `recordReceipt` when `eventId` does not resolve via the injected `EventSource`. */
export class UnknownEventError extends Error {
  constructor(readonly eventId: EventId) {
    super(`recordReceipt: unknown event id ${eventId}`);
    this.name = "UnknownEventError";
  }
}

/**
 * Records that `sessionId` presented `eventId`. Rejects with
 * `UnknownEventError` if `eventId` does not resolve via `eventSource` --
 * a receipt only ever names a real, committed event. Idempotent per
 * (event, session) via the table's primary key plus `INSERT OR IGNORE`.
 */
export function recordReceipt(
  db: Database,
  eventSource: EventSource,
  input: RecordReceiptInput,
  presentedAtMs: number = Date.now(),
): void {
  if (eventSource.getEvent(input.eventId) === undefined) {
    throw new UnknownEventError(input.eventId);
  }
  db.run(
    `INSERT OR IGNORE INTO trace_receipts
       (event_id, session_id, presented_at_ms)
     VALUES (?, ?, ?)`,
    [input.eventId, input.sessionId, presentedAtMs],
  );
}

export interface ReceiptRow {
  readonly eventId: EventId;
  readonly sessionId: SessionId;
  readonly presentedAtMs: number;
}

export function listReceiptsByEvent(
  db: Database,
  eventId: EventId,
): readonly ReceiptRow[] {
  const rows = db
    .query(
      "SELECT * FROM trace_receipts WHERE event_id = ? ORDER BY presented_at_ms ASC",
    )
    .all(eventId) as {
    event_id: string;
    session_id: string;
    presented_at_ms: number;
  }[];
  return rows.map((row) => ({
    eventId: row.event_id as EventId,
    sessionId: row.session_id as SessionId,
    presentedAtMs: row.presented_at_ms,
  }));
}

// --- Model requests ---------------------------------------------------------------

/** Most characters of prompt or output text kept per model request. Digests always cover the whole text. */
export const MODEL_PAYLOAD_LIMIT = 16_384;

/** How long payload text is kept; digests and metadata stay for the life of the world history. */
export const MODEL_PAYLOAD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface RouteStepLike {
  readonly endpoint: string;
  readonly model: string;
  readonly attempts: number;
  readonly elapsedMs: number;
}

interface FailedRouteStepLike extends RouteStepLike {
  readonly reason: string;
  readonly detail?: string;
  readonly output?: string;
  readonly schema?: string;
}

/**
 * The result of routing a model request, as `@panthea/agents`' router reports
 * it. Declared here structurally so telemetry does not depend on the agent
 * layer: a `RouteResult` is assignable to this.
 */
export type ModelRouteResult =
  | {
      readonly kind: "intent";
      /** The step that answered. */
      readonly step: RouteStepLike & { readonly mode: "native" | "repaired" };
      /** Steps that failed before it, in order. */
      readonly failed: readonly FailedRouteStepLike[];
      readonly elapsedMs: number;
    }
  | {
      readonly kind: "exhausted";
      readonly steps: readonly FailedRouteStepLike[];
      readonly elapsedMs: number;
    };

/** One step of the chain as stored: a failed step has a `reason`, the step that answered has a `mode`. */
export interface ModelRequestStep {
  readonly endpoint: string;
  readonly model: string;
  readonly attempts: number;
  readonly elapsedMs: number;
  readonly mode?: "native" | "repaired";
  readonly reason?: string;
  readonly detail?: string;
  /** For an invalid reply: the last reply refused, redacted and bounded. */
  readonly output?: string;
  /** For an invalid reply: the intent schema the request was made under, redacted and bounded. */
  readonly schema?: string;
}

/** What the prompt cap did to a request: the tokens it was counted as, at which characters-per-token ratio, and how many units each tier shed. */
export interface ModelRequestCap {
  readonly estimatedTokens: number;
  readonly ratio: number;
  readonly shed: {
    readonly events: number;
    readonly actions: number;
    /** Memories and feelings together. */
    readonly memories: number;
    readonly prayers: number;
  };
}

interface ModelRequestBase {
  readonly role: string;
  readonly prompt: string;
  readonly cap?: ModelRequestCap;
}

/** A chain that produced an intent. */
export interface IntentModelRequest extends ModelRequestBase {
  readonly route: Extract<ModelRouteResult, { readonly kind: "intent" }>;
  /** The proposal this request produced; absent when the intent was refused before it became one. */
  readonly proposalId?: ProposalId;
  /** What the model answered (the raw reply, or its parsed intent as JSON). */
  readonly output?: string;
  readonly exhaustedReason?: never;
}

/** A chain that produced nothing: no proposal and no output, so neither can be given. */
export interface ExhaustedModelRequest extends ModelRequestBase {
  readonly route: Extract<ModelRouteResult, { readonly kind: "exhausted" }>;
  readonly proposalId?: never;
  readonly output?: never;
  /** Why the turn ended without running the chain, when it did (`prompt-over-cap`: the prompt was over the cap and nothing was sent). */
  readonly exhaustedReason?: string;
}

/**
 * A model request to record, discriminated on `route.kind`. An exhausted chain
 * cannot claim a proposal (the table would refuse it, and inside a tick that
 * would turn an outage into a store failure), so the type refuses it first.
 */
export type ModelRequestInput = IntentModelRequest | ExhaustedModelRequest;

export interface ModelRequestRow {
  readonly id: ModelRequestId;
  readonly proposalId: ProposalId | undefined;
  readonly role: string;
  readonly outcome: "intent" | "exhausted";
  readonly exhaustedReason: string | undefined;
  readonly cap: ModelRequestCap | undefined;
  readonly steps: readonly ModelRequestStep[];
  readonly elapsedMs: number;
  readonly promptDigest: string;
  readonly outputDigest: string | undefined;
  /** Bounded prompt text; gone once pruned. */
  readonly promptPayload: string | undefined;
  readonly outputPayload: string | undefined;
  /** Wall time the row was written. Used only to decide when to prune; never a world input. */
  readonly recordedAtMs: number;
}

const digest = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

const bounded = (text: string): string => text.slice(0, MODEL_PAYLOAD_LIMIT);

/** Marker a redacted secret leaves behind. */
export const REDACTED = "[redacted]";

/** Rewrites text before it is stored. */
export type Redactor = (text: string) => string;

/**
 * A redactor that replaces every occurrence of each given secret (a loaded
 * endpoint key) with `[redacted]`, in its raw form and in the form JSON writes
 * it inside a string: the runner serializes proposals and outputs as JSON, and
 * an endpoint's JSON error body echoes a key the same way, so a key holding a
 * quote, a backslash, or a control character appears escaped there. Longer
 * forms go first, so one that holds another is replaced whole; empty strings
 * are ignored.
 */
export function createRedactor(secrets: Iterable<string>): Redactor {
  const forms = new Set<string>();
  for (const secret of secrets) {
    if (secret === "") continue;
    forms.add(secret);
    forms.add(JSON.stringify(secret).slice(1, -1));
  }
  const ordered = [...forms].sort((a, b) => b.length - a.length);
  if (ordered.length === 0) return (text) => text;
  return (text) => {
    let clean = text;
    for (const form of ordered) clean = clean.split(form).join(REDACTED);
    return clean;
  };
}

function stepsOf(
  route: ModelRouteResult,
  redact: Redactor,
): ModelRequestStep[] {
  const failed = route.kind === "intent" ? route.failed : route.steps;
  const steps: ModelRequestStep[] = failed.map((step) => ({
    endpoint: step.endpoint,
    model: step.model,
    attempts: step.attempts,
    elapsedMs: Math.round(step.elapsedMs),
    reason: step.reason,
    ...(step.detail === undefined ? {} : { detail: redact(step.detail) }),
    ...(step.output === undefined ? {} : { output: redact(step.output) }),
    ...(step.schema === undefined ? {} : { schema: redact(step.schema) }),
  }));
  if (route.kind === "intent") {
    steps.push({
      endpoint: route.step.endpoint,
      model: route.step.model,
      attempts: route.step.attempts,
      elapsedMs: Math.round(route.step.elapsedMs),
      mode: route.step.mode,
    });
  }
  return steps;
}

/**
 * Records one model call chain: its role, every step with its reason or
 * mode, timing, sha256 digests of the whole prompt and output, and the
 * prompt and output text bounded to `MODEL_PAYLOAD_LIMIT` characters.
 *
 * A request whose proposal commits is written inside that tick's
 * transaction, so a rolled-back tick leaves no row; an exhausted chain has
 * no proposal and is written on its own. A second request for one proposal
 * is ignored, never thrown, because this runs inside a tick where a throw
 * would roll the tick back to be repeated; it returns the id of the row that
 * already holds the proposal.
 *
 * `redact` is applied to every text the row stores (prompt, output, each step's
 * detail) before anything is written, and the digests cover the redacted text:
 * this is the write boundary ADR-0006 asks for before a credential-bearing
 * producer exists. Pass one built from every loaded key.
 */
export function recordModelRequest(
  db: Database,
  input: ModelRequestInput,
  now: number = Date.now(),
  redact: Redactor = (text) => text,
): ModelRequestId {
  const id = createModelRequestId();
  const prompt = redact(input.prompt);
  const output = input.output === undefined ? undefined : redact(input.output);
  const result = db.run(
    // Only a repeat of the proposal is ignored; a CHECK violation still throws.
    `INSERT INTO trace_model_requests
       (id, proposal_id, role, outcome, steps, elapsed_ms, prompt_digest, output_digest, prompt_payload, output_payload, recorded_at,
        exhausted_reason, estimated_tokens, token_ratio, shed_events, shed_actions, shed_memories, shed_prayers)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (proposal_id) DO NOTHING`,
    [
      id,
      input.proposalId ?? null,
      input.role,
      input.route.kind,
      JSON.stringify(stepsOf(input.route, redact)),
      Math.round(input.route.elapsedMs),
      digest(prompt),
      output === undefined ? null : digest(output),
      bounded(prompt),
      output === undefined ? null : bounded(output),
      now,
      input.exhaustedReason ?? null,
      input.cap?.estimatedTokens ?? null,
      input.cap?.ratio ?? null,
      input.cap?.shed.events ?? null,
      input.cap?.shed.actions ?? null,
      input.cap?.shed.memories ?? null,
      input.cap?.shed.prayers ?? null,
    ],
  );
  if (result.changes === 0 && input.proposalId !== undefined) {
    // The proposal already had its request; that row's id is the answer.
    const existing = getModelRequestByProposalId(db, input.proposalId);
    if (existing) {
      return existing.id;
    }
  }
  return id;
}

interface ModelRequestSqlRow {
  id: string;
  proposal_id: string | null;
  role: string;
  outcome: string;
  steps: string;
  elapsed_ms: number;
  prompt_digest: string;
  output_digest: string | null;
  prompt_payload: string | null;
  output_payload: string | null;
  recorded_at: number;
  exhausted_reason: string | null;
  estimated_tokens: number | null;
  token_ratio: number | null;
  shed_events: number | null;
  shed_actions: number | null;
  shed_memories: number | null;
  shed_prayers: number | null;
}

function decodeModelRequest(row: ModelRequestSqlRow): ModelRequestRow {
  return {
    id: row.id as ModelRequestId,
    proposalId: (row.proposal_id ?? undefined) as ProposalId | undefined,
    role: row.role,
    outcome: row.outcome as "intent" | "exhausted",
    exhaustedReason: row.exhausted_reason ?? undefined,
    cap:
      row.estimated_tokens === null ||
      row.token_ratio === null ||
      row.shed_events === null ||
      row.shed_actions === null ||
      row.shed_memories === null ||
      row.shed_prayers === null
        ? undefined
        : {
            estimatedTokens: row.estimated_tokens,
            ratio: row.token_ratio,
            shed: {
              events: row.shed_events,
              actions: row.shed_actions,
              memories: row.shed_memories,
              prayers: row.shed_prayers,
            },
          },
    steps: JSON.parse(row.steps) as ModelRequestStep[],
    elapsedMs: row.elapsed_ms,
    promptDigest: row.prompt_digest,
    outputDigest: row.output_digest ?? undefined,
    promptPayload: row.prompt_payload ?? undefined,
    outputPayload: row.output_payload ?? undefined,
    recordedAtMs: row.recorded_at,
  };
}

export function getModelRequest(
  db: Database,
  id: ModelRequestId,
): ModelRequestRow | undefined {
  const row = db
    .query("SELECT * FROM trace_model_requests WHERE id = ?")
    .get(id) as ModelRequestSqlRow | null;
  return row ? decodeModelRequest(row) : undefined;
}

export function getModelRequestByProposalId(
  db: Database,
  proposalId: ProposalId,
): ModelRequestRow | undefined {
  const row = db
    .query("SELECT * FROM trace_model_requests WHERE proposal_id = ?")
    .get(proposalId) as ModelRequestSqlRow | null;
  return row ? decodeModelRequest(row) : undefined;
}

/**
 * Nulls the prompt and output text of every request recorded more than
 * `olderThanMs` before `now`, keeping digests, steps, timing, and outcome.
 * Returns how many rows it changed. A row exactly at the boundary is kept.
 */
export function pruneModelPayloads(
  db: Database,
  olderThanMs: number,
  now: number = Date.now(),
): number {
  return db.run(
    `UPDATE trace_model_requests
     SET prompt_payload = NULL, output_payload = NULL
     WHERE recorded_at < ?
       AND (prompt_payload IS NOT NULL OR output_payload IS NOT NULL)`,
    [now - olderThanMs],
  ).changes;
}

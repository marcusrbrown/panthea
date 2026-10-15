// The sidecar's streaming protocol: one committed-state frame. A reconnect
// requests a fresh frame; there is no incremental delta protocol.

import { type FireCause, WORLD_EVENT_KINDS, type WorldEvent } from "./event";
import {
  type EntityId,
  type EventId,
  fail,
  isRecord,
  ok,
  type ParseResult,
  parseArray,
  parseEntityId,
  parseEnum,
  parseEventId,
  parseNonNegativeInteger,
  parseSchemaVersion,
  parseSessionId,
  parseString,
  parseWorldId,
  type SessionId,
  type WorldId,
} from "./ids";

export const SYNC_FRAME_SCHEMA_VERSIONS = [1] as const;

export const WORLD_STATUSES = ["running", "paused", "degraded"] as const;
export type WorldStatus = (typeof WORLD_STATUSES)[number];

export const DEGRADED_REASONS = [
  "store-error",
  "disk-full",
  "sidecar-unreachable",
  /** Every model endpoint failed. Unlike the others it never halts the world: routines and the director keep ticking. */
  "model-degraded",
] as const;
export type DegradedReason = (typeof DEGRADED_REASONS)[number];

export interface CatchUpSummary {
  /**
   * The summary's own identity, minted by the service when it persists the
   * summary and held until a different summary replaces it. A client
   * acknowledges a summary by this id, so it stays acknowledged across every
   * frame that repeats it and across a service restart, and a later
   * catch-up (a new id, even at the same sequence) shows again.
   */
  readonly id: string;
  readonly appliedMs: number;
  readonly skippedMs: number;
  readonly majorOutcomes: readonly string[];
  /** The committed sequence at which this catch-up finished; its outcomes are frozen at it. */
  readonly atSequence: number;
}

function parseCatchUpSummary(
  value: unknown,
  path: string,
): ParseResult<CatchUpSummary> {
  if (!isRecord(value)) {
    return fail(path, "expected a catch-up summary object");
  }
  const id = parseString(value.id, `${path}.id`);
  if (!id.ok) return id;
  if (id.value === "") {
    return fail(`${path}.id`, "expected a non-empty summary id");
  }
  const appliedMs = parseNonNegativeInteger(
    value.appliedMs,
    `${path}.appliedMs`,
  );
  if (!appliedMs.ok) return appliedMs;
  const skippedMs = parseNonNegativeInteger(
    value.skippedMs,
    `${path}.skippedMs`,
  );
  if (!skippedMs.ok) return skippedMs;
  const majorOutcomes = parseArray(
    value.majorOutcomes,
    `${path}.majorOutcomes`,
    parseString,
  );
  if (!majorOutcomes.ok) return majorOutcomes;
  const atSequence = parseNonNegativeInteger(
    value.atSequence,
    `${path}.atSequence`,
  );
  if (!atSequence.ok) return atSequence;
  return ok({
    id: id.value,
    appliedMs: appliedMs.value,
    skippedMs: skippedMs.value,
    majorOutcomes: majorOutcomes.value,
    atSequence: atSequence.value,
  });
}

/**
 * A committed event the frame's window still carries: enough for a client
 * to decide which events concern what it renders and to receipt the ones
 * it drew. `subjects` are the actor, building, location, and deity ids the
 * event touches.
 */
export interface RecentEvent {
  readonly id: EventId;
  readonly sequence: number;
  readonly tick: number;
  readonly kind: WorldEvent["kind"];
  readonly subjects: readonly EntityId[];
  /**
   * Why a building ignited, on `building-ignited` events only: a strike, the
   * quiet-world director, or a fire spreading from another building. A client
   * that shows a strike needs it, because the three look alike otherwise.
   */
  readonly cause?: FireCause["kind"];
}

export const IGNITION_CAUSES = [
  "strike",
  "director",
  "spread",
] as const satisfies readonly FireCause["kind"][];

function parseRecentEvent(
  value: unknown,
  path: string,
): ParseResult<RecentEvent> {
  if (!isRecord(value)) {
    return fail(path, "expected a recent event object");
  }
  const id = parseEventId(value.id, `${path}.id`);
  if (!id.ok) return id;
  const sequence = parseNonNegativeInteger(value.sequence, `${path}.sequence`);
  if (!sequence.ok) return sequence;
  const tick = parseNonNegativeInteger(value.tick, `${path}.tick`);
  if (!tick.ok) return tick;
  const kind = parseEnum(value.kind, `${path}.kind`, WORLD_EVENT_KINDS);
  if (!kind.ok) return kind;
  const subjects = parseArray(
    value.subjects,
    `${path}.subjects`,
    parseEntityId,
  );
  if (!subjects.ok) return subjects;
  if (value.cause === undefined) {
    return ok({
      id: id.value,
      sequence: sequence.value,
      tick: tick.value,
      kind: kind.value,
      subjects: subjects.value,
    });
  }
  const cause = parseEnum(value.cause, `${path}.cause`, IGNITION_CAUSES);
  if (!cause.ok) return cause;
  if (kind.value !== "building-ignited") {
    return fail(
      `${path}.cause`,
      "only a building-ignited event carries a cause",
    );
  }
  return ok({
    id: id.value,
    sequence: sequence.value,
    tick: tick.value,
    kind: kind.value,
    subjects: subjects.value,
    cause: cause.value,
  });
}

export const ENDPOINT_STATES = ["untried", "ok", "failed"] as const;
export type EndpointState = (typeof ENDPOINT_STATES)[number];

/**
 * How one model endpoint's last request went, as the service saw it: `failed`
 * carries the router's reason and a short account with any key redacted.
 * Present on a frame only when model routing is configured.
 */
export type ModelEndpointStatus =
  | { readonly endpoint: string; readonly state: "untried" | "ok" }
  | {
      readonly endpoint: string;
      readonly state: "failed";
      readonly reason: string;
      readonly detail: string;
    };

function parseModelEndpointStatus(
  value: unknown,
  path: string,
): ParseResult<ModelEndpointStatus> {
  if (!isRecord(value)) {
    return fail(path, "expected an endpoint status object");
  }
  const endpoint = parseString(value.endpoint, `${path}.endpoint`);
  if (!endpoint.ok) return endpoint;
  const state = parseEnum(value.state, `${path}.state`, ENDPOINT_STATES);
  if (!state.ok) return state;
  if (state.value !== "failed") {
    return ok({ endpoint: endpoint.value, state: state.value });
  }
  const reason = parseString(value.reason, `${path}.reason`);
  if (!reason.ok) return reason;
  const detail = parseString(value.detail, `${path}.detail`);
  if (!detail.ok) return detail;
  return ok({
    endpoint: endpoint.value,
    state: "failed",
    reason: reason.value,
    detail: detail.value,
  });
}

export interface SyncFrame {
  readonly schemaVersion: number;
  readonly sequence: number;
  readonly worldId: WorldId;
  readonly sessionId: SessionId;
  readonly status: WorldStatus;
  readonly degradedReason?: DegradedReason;
  readonly catchUpSummary?: CatchUpSummary;
  /** Each configured model endpoint's last outcome, in config order; absent when no models are configured. */
  readonly modelEndpoints?: readonly ModelEndpointStatus[];
  /** Committed events inside the sidecar's recent window, ascending by sequence. */
  readonly recentEvents: readonly RecentEvent[];
  /** Opaque projection payload; its shape is owned by packages/world. */
  readonly state: unknown;
}

export function parseSyncFrame(input: unknown): ParseResult<SyncFrame> {
  if (!isRecord(input)) {
    return fail("", "expected a state frame object");
  }

  const schemaVersion = parseSchemaVersion(
    input.schemaVersion,
    SYNC_FRAME_SCHEMA_VERSIONS,
  );
  if (!schemaVersion.ok) return schemaVersion;

  const sequence = parseNonNegativeInteger(input.sequence, "sequence");
  if (!sequence.ok) return sequence;

  const worldId = parseWorldId(input.worldId, "worldId");
  if (!worldId.ok) return worldId;

  const sessionId = parseSessionId(input.sessionId, "sessionId");
  if (!sessionId.ok) return sessionId;

  const status = parseEnum(input.status, "status", WORLD_STATUSES);
  if (!status.ok) return status;

  let degradedReason: DegradedReason | undefined;
  if (status.value === "degraded") {
    const reason = parseEnum(
      input.degradedReason,
      "degradedReason",
      DEGRADED_REASONS,
    );
    if (!reason.ok) return reason;
    degradedReason = reason.value;
  }

  let catchUpSummary: CatchUpSummary | undefined;
  if (input.catchUpSummary !== undefined) {
    const summary = parseCatchUpSummary(input.catchUpSummary, "catchUpSummary");
    if (!summary.ok) return summary;
    catchUpSummary = summary.value;
  }

  let modelEndpoints: readonly ModelEndpointStatus[] | undefined;
  if (input.modelEndpoints !== undefined) {
    const endpoints = parseArray(
      input.modelEndpoints,
      "modelEndpoints",
      parseModelEndpointStatus,
    );
    if (!endpoints.ok) return endpoints;
    modelEndpoints = endpoints.value;
  }

  const recentEvents = parseArray(
    input.recentEvents,
    "recentEvents",
    parseRecentEvent,
  );
  if (!recentEvents.ok) return recentEvents;

  if (input.state === undefined) {
    return fail("state", "expected a state payload");
  }

  return ok({
    schemaVersion: schemaVersion.value,
    sequence: sequence.value,
    worldId: worldId.value,
    sessionId: sessionId.value,
    status: status.value,
    ...(degradedReason === undefined ? {} : { degradedReason }),
    ...(catchUpSummary === undefined ? {} : { catchUpSummary }),
    ...(modelEndpoints === undefined ? {} : { modelEndpoints }),
    recentEvents: recentEvents.value,
    state: input.state,
  });
}

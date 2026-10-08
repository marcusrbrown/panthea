// Read-only views, and the one write the archive control needs, over a world
// slot's SQLite file, for the facts no sidecar endpoint exposes: which
// proposals the gods journaled and how each ended, the model requests in the
// trace, and the state a restored slot holds.

import { Database } from "bun:sqlite";
import { computeContentHash } from "@panthea/persistence";
import { decode, type WorldState } from "@panthea/world";
import { withWorldDb } from "../../m1-living-world/src/world-db";
import type { StoredEvent } from "./checks";
import type { RealRequest } from "./real-analysis";

export interface JournaledProposal {
  readonly inputOrder: number;
  readonly proposalId: string;
  readonly actor: string;
  readonly kind: string;
  readonly source: string;
  readonly proposal: Record<string, unknown>;
  readonly consumedTick: number | undefined;
  readonly outcome: string | undefined;
  readonly reason: string | undefined;
}

/** Every proposal the journal holds, in input order, with its actor, kind, and source: what a god's turn journaled, and what the fixture posted. */
export function readProposals(path: string): JournaledProposal[] {
  return withWorldDb(path, (db) =>
    (
      db
        .query("SELECT * FROM external_proposals ORDER BY input_order ASC")
        .all() as {
        input_order: number;
        proposal_id: string;
        proposal: string;
        consumed_tick: number | null;
        outcome: string | null;
        reason: string | null;
      }[]
    ).map((row) => {
      const proposal = JSON.parse(row.proposal) as Record<string, unknown>;
      return {
        inputOrder: row.input_order,
        proposalId: row.proposal_id,
        actor: String(proposal.actor),
        kind: String(proposal.kind),
        source: String(proposal.source),
        proposal,
        consumedTick: row.consumed_tick ?? undefined,
        outcome: row.outcome ?? undefined,
        reason: row.reason ?? undefined,
      };
    }),
  );
}

export interface ModelRequestRow {
  readonly proposalId: string | undefined;
  readonly role: string;
  readonly outcome: string;
  readonly elapsedMs: number;
  readonly promptDigest: string;
  readonly recordedAt: number;
}

/** The model requests the trace holds, oldest first. */
export function readModelRequests(path: string): ModelRequestRow[] {
  return withWorldDb(path, (db) =>
    (
      db
        .query(
          "SELECT proposal_id, role, outcome, elapsed_ms, prompt_digest, recorded_at FROM trace_model_requests ORDER BY recorded_at ASC",
        )
        .all() as {
        proposal_id: string | null;
        role: string;
        outcome: string;
        elapsed_ms: number;
        prompt_digest: string;
        recorded_at: number;
      }[]
    ).map((row) => ({
      proposalId: row.proposal_id ?? undefined,
      role: row.role,
      outcome: row.outcome,
      elapsedMs: row.elapsed_ms,
      promptDigest: row.prompt_digest,
      recordedAt: row.recorded_at,
    })),
  );
}

/** Every event's full payload, oldest first. */
export function readStoredEvents(path: string): StoredEvent[] {
  return withWorldDb(path, (db) =>
    (
      db.query("SELECT payload FROM events ORDER BY sequence ASC").all() as {
        payload: string;
      }[]
    ).map((row) => JSON.parse(row.payload) as StoredEvent),
  );
}

/** The world state a store's projection row holds, decoded through the world's own codec. */
export function readProjectedState(path: string): WorldState {
  return withWorldDb(path, (db) => {
    const row = db.query("SELECT data FROM projections WHERE id = 1").get() as {
      data: string;
    };
    return decode(JSON.parse(row.data));
  });
}

/**
 * Rewrites the projection row of a stopped archive with `edit` applied to its
 * encoded world, then recomputes the manifest's content hash so nothing but the
 * import's own rebuild can tell. Fault injection: a hostile archive.
 */
export function rewriteArchiveProjection(
  archivePath: string,
  edit: (encoded: Record<string, unknown>) => void,
): void {
  const db = new Database(archivePath);
  try {
    const row = db.query("SELECT data FROM projections WHERE id = 1").get() as {
      data: string;
    };
    const encoded = JSON.parse(row.data) as Record<string, unknown>;
    edit(encoded);
    db.run("UPDATE projections SET data = ? WHERE id = 1", [
      JSON.stringify(encoded),
    ]);
    const manifest = db.query("SELECT * FROM manifest WHERE id = 1").get() as {
      format_version: number;
      sqlite_schema_version: number;
      payload_schema_version: number;
      world_id: string;
      event_sequence: number;
    };
    db.run("UPDATE manifest SET content_hash = ?", [
      computeContentHash(db, {
        formatVersion: manifest.format_version,
        sqliteSchemaVersion: manifest.sqlite_schema_version,
        payloadSchemaVersion: manifest.payload_schema_version,
        worldId: manifest.world_id as never,
        eventSequence: manifest.event_sequence,
      }),
    ]);
  } finally {
    db.close();
  }
}

/** The model requests with their bounded prompt text and step records, for measuring a real run. */
export function readRealRequests(path: string): RealRequest[] {
  return withWorldDb(path, (db) =>
    (
      db
        .query(
          "SELECT proposal_id, role, outcome, steps, elapsed_ms, prompt_payload, recorded_at FROM trace_model_requests ORDER BY recorded_at ASC",
        )
        .all() as {
        proposal_id: string | null;
        role: string;
        outcome: "intent" | "exhausted";
        steps: string;
        elapsed_ms: number;
        prompt_payload: string | null;
        recorded_at: number;
      }[]
    ).map((row) => ({
      proposalId: row.proposal_id ?? undefined,
      role: row.role,
      outcome: row.outcome,
      elapsedMs: row.elapsed_ms,
      promptPayload: row.prompt_payload ?? undefined,
      steps: JSON.parse(row.steps) as RealRequest["steps"],
      recordedAt: row.recorded_at,
    })),
  );
}

/** A model request as the trace holds it, with the prompt and the output it recorded (already redacted by the service at the write boundary). */
export interface SampleRow {
  readonly role: string;
  readonly outcome: "intent" | "exhausted";
  readonly promptPayload: string | undefined;
  readonly outputPayload: string | undefined;
  readonly steps: readonly {
    mode?: string;
    reason?: string;
    detail?: string;
    attempts?: number;
    output?: string;
    schema?: string;
  }[];
  readonly elapsedMs: number;
}

/** Every model request the trace holds, oldest first, with its prompt and output text. */
export function readSampleRows(path: string): SampleRow[] {
  return withWorldDb(path, (db) =>
    (
      db
        .query(
          "SELECT role, outcome, steps, elapsed_ms, prompt_payload, output_payload FROM trace_model_requests ORDER BY recorded_at ASC",
        )
        .all() as {
        role: string;
        outcome: "intent" | "exhausted";
        steps: string;
        elapsed_ms: number;
        prompt_payload: string | null;
        output_payload: string | null;
      }[]
    ).map((row) => ({
      role: row.role,
      outcome: row.outcome,
      promptPayload: row.prompt_payload ?? undefined,
      outputPayload: row.output_payload ?? undefined,
      steps: JSON.parse(row.steps) as SampleRow["steps"],
      elapsedMs: row.elapsed_ms,
    })),
  );
}

/**
 * The milliseconds of wall time the world has discarded as over the catch-up cap, summed over the operator observations
 * the catch-up journals (`operator:catch-up-discard:<ms>`). The persisted catch-up summary is overwritten by a later
 * pass; these observations are not.
 */
export function readCatchUpDiscardedMs(path: string): number {
  return withWorldDb(path, (db) =>
    (
      db
        .query(
          "SELECT json_extract(payload, '$.factsRead[0]') AS fact FROM trace_observations WHERE source = 'operator'",
        )
        .all() as { fact: string | null }[]
    ).reduce((total, { fact }) => {
      const match = /^operator:catch-up-discard:(\d+)$/.exec(fact ?? "");
      return match === null ? total : total + Number(match[1]);
    }, 0),
  );
}

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createCausationId,
  createCorrelationId,
  createEntityId,
  createEventId,
  createObservationId,
  createSessionId,
  type EventId,
  type ObservationRecord,
  type Proposal,
  type WorldEvent,
} from "@panthea/contracts";
import {
  createModelRequestId,
  createProposalId,
  createRedactor,
  type EventSource,
  ensureTraceSchema,
  getModelRequest,
  getModelRequestByProposalId,
  getObservation,
  getProposalOutcomeByEventId,
  getProposalOutcomeByProposalId,
  listReceiptsByEvent,
  MODEL_PAYLOAD_LIMIT,
  MODEL_PAYLOAD_RETENTION_MS,
  type ModelRequestInput,
  type ModelRouteResult,
  parseProposalId,
  pruneModelPayloads,
  recordModelRequest,
  recordObservation,
  recordProposalOutcome,
  recordReceipt,
  UnknownEventError,
} from "./trace";

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  ensureTraceSchema(db);
});

afterEach(() => {
  db.close();
});

function makeObservation(): ObservationRecord {
  return {
    schemaVersion: 1,
    id: createObservationId(),
    observer: createEntityId(),
    stateRevision: 0,
    factsRead: ["fact-1"],
    source: "fixture",
  };
}

function makeProposal(observationId: ObservationRecord["id"]): Proposal {
  return {
    schemaVersion: 1,
    actor: createEntityId(),
    targets: [],
    expectedRevisions: [],
    source: "fixture",
    observationId,
    kind: "move",
    to: createEntityId(),
  };
}

function fakeEvent(id: EventId): WorldEvent {
  return {
    schemaVersion: 2,
    id,
    sequence: 1,
    simTime: 1,
    correlationId: createCorrelationId(),
    causationId: createCausationId(),
    tick: 1,
    approximate: false,
    kind: "entity-moved",
    entityId: createEntityId(),
    to: createEntityId(),
  };
}

describe("ProposalId", () => {
  test("created IDs round-trip through the parser", () => {
    const id = createProposalId();
    const parsed = parseProposalId(id, "proposalId");
    expect(parsed).toEqual({ ok: true, value: id });
  });
});

describe("ensureTraceSchema", () => {
  test("resolving an event to its proposal outcome searches by primary key, not a full table scan", () => {
    const plan = db
      .query(
        "EXPLAIN QUERY PLAN SELECT * FROM trace_outcome_events WHERE event_id = ?",
      )
      .all("some-event-id") as { detail: string }[];
    expect(plan.every((row) => !/^SCAN/.test(row.detail))).toBe(true);
  });

  test("only the five trace tables exist", () => {
    const tables = (
      db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    expect(tables.sort()).toEqual(
      [
        "trace_model_requests",
        "trace_observations",
        "trace_outcome_events",
        "trace_proposal_outcomes",
        "trace_receipts",
      ].sort(),
    );
  });
});

describe("recordObservation / getObservation", () => {
  test("happy path: round-trips through JSON", () => {
    const record = makeObservation();
    recordObservation(db, record);
    const fetched = getObservation(db, record.id);
    expect(fetched?.record).toEqual(record);
  });

  test("exact reuse of an observation id is allowed, whatever the key order, and reports the record as already there", () => {
    const record = makeObservation();
    expect(recordObservation(db, record)).toEqual({ kind: "recorded" });

    const reordered = {
      source: record.source,
      factsRead: [...record.factsRead],
      stateRevision: record.stateRevision,
      observer: record.observer,
      id: record.id,
      schemaVersion: record.schemaVersion,
    } as ObservationRecord;

    expect(recordObservation(db, reordered)).toEqual({ kind: "same" });
    expect(
      (
        db.query("SELECT COUNT(*) AS n FROM trace_observations").get() as {
          n: number;
        }
      ).n,
    ).toBe(1);
  });

  test("conflicting reuse of an observation id is reported, never thrown, and never overwrites the recorded evidence", () => {
    const record = makeObservation();
    recordObservation(db, record);

    const conflicting = {
      ...record,
      factsRead: ["different"],
      stateRevision: 9,
    };
    const result = recordObservation(db, conflicting);

    expect(result.kind).toBe("conflict");
    if (result.kind === "conflict") {
      expect(result.recorded).toEqual(record);
    }
    expect(getObservation(db, record.id)?.record).toEqual(record);
  });

  test("a conflicting reuse differing only in provenance is still a conflict", () => {
    const record = makeObservation();
    recordObservation(db, record);

    expect(recordObservation(db, { ...record, source: "routine" }).kind).toBe(
      "conflict",
    );
  });

  test("returns undefined for an unknown ID", () => {
    expect(getObservation(db, createObservationId())).toBeUndefined();
  });
});

describe("recordProposalOutcome", () => {
  test("happy path: a committed outcome is retrievable by proposal ID and by event ID", () => {
    const observation = makeObservation();
    recordObservation(db, observation);
    const proposal = makeProposal(observation.id);
    const proposalId = createProposalId();
    const eventId = createEventId();

    recordProposalOutcome(db, {
      proposalId,
      observationId: observation.id,
      correlationId: createCorrelationId(),
      causationId: createCausationId(),
      proposal,
      outcome: "committed",
      eventIds: [eventId],
    });

    const byProposal = getProposalOutcomeByProposalId(db, proposalId);
    const byEvent = getProposalOutcomeByEventId(db, eventId);
    expect(byProposal?.outcome).toBe("committed");
    expect(byEvent?.proposalId).toBe(proposalId);
    expect(byProposal?.proposal).toEqual(proposal);
    expect(byProposal?.eventIds).toEqual([eventId]);
  });

  test("a committed outcome is retrievable by every event it committed, in commit order", () => {
    const observation = makeObservation();
    recordObservation(db, observation);
    const proposalId = createProposalId();
    const first = createEventId();
    const second = createEventId();
    const third = createEventId();

    recordProposalOutcome(db, {
      proposalId,
      observationId: observation.id,
      correlationId: createCorrelationId(),
      causationId: createCausationId(),
      proposal: makeProposal(observation.id),
      outcome: "committed",
      eventIds: [first, second, third],
    });

    for (const eventId of [first, second, third]) {
      expect(getProposalOutcomeByEventId(db, eventId)?.proposalId).toBe(
        proposalId,
      );
    }
    expect(getProposalOutcomeByProposalId(db, proposalId)?.eventIds).toEqual([
      first,
      second,
      third,
    ]);
  });

  test("an event the outcome did not commit resolves to no outcome", () => {
    expect(getProposalOutcomeByEventId(db, createEventId())).toBeUndefined();
  });

  test("error path: a rejected proposal keeps its reason and no event IDs", () => {
    const observation = makeObservation();
    recordObservation(db, observation);
    const proposal = makeProposal(observation.id);
    const proposalId = createProposalId();

    recordProposalOutcome(db, {
      proposalId,
      observationId: observation.id,
      correlationId: createCorrelationId(),
      causationId: createCausationId(),
      proposal,
      outcome: "rejected",
      reason: "stale-target",
    });

    const outcome = getProposalOutcomeByProposalId(db, proposalId);
    expect(outcome?.outcome).toBe("rejected");
    expect(outcome?.reason).toBe("stale-target");
    expect(outcome?.eventIds).toEqual([]);
  });
});

describe("recordReceipt", () => {
  test("happy path: a receipt for a known event is recorded", () => {
    const event = fakeEvent(createEventId());
    const eventSource: EventSource = {
      getEvent: (id) => (id === event.id ? event : undefined),
    };
    const sessionId = createSessionId();

    recordReceipt(db, eventSource, { eventId: event.id, sessionId });

    const rows = listReceiptsByEvent(db, event.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ eventId: event.id, sessionId });
  });

  test("error path: a receipt referencing an unknown event is rejected and never persisted", () => {
    const eventSource: EventSource = { getEvent: () => undefined };
    const unknownEventId = createEventId();

    expect(() =>
      recordReceipt(db, eventSource, {
        eventId: unknownEventId,
        sessionId: createSessionId(),
      }),
    ).toThrow(UnknownEventError);

    expect(listReceiptsByEvent(db, unknownEventId)).toHaveLength(0);
  });

  test("idempotent per event+session: duplicate receipts are dropped, not persisted twice", () => {
    const event = fakeEvent(createEventId());
    const eventSource: EventSource = { getEvent: () => event };
    const sessionId = createSessionId();

    recordReceipt(db, eventSource, { eventId: event.id, sessionId });
    recordReceipt(db, eventSource, { eventId: event.id, sessionId });

    expect(listReceiptsByEvent(db, event.id)).toHaveLength(1);
  });
});

// --- Model requests --------------------------------------------------------------

const sha256 = (text: string): string =>
  new Bun.CryptoHasher("sha256").update(text).digest("hex");

const OLLAMA_STEP = {
  endpoint: "ollama",
  model: "llama3.2-3b-4k",
  attempts: 1,
  elapsedMs: 812.4,
};

const intentRoute = {
  kind: "intent",
  step: { ...OLLAMA_STEP, mode: "native" },
  failed: [],
  elapsedMs: 815.2,
} satisfies ModelRouteResult;

describe("recordModelRequest", () => {
  test("a request that produced a proposal is found by that proposal, with its role, steps, timing, digests, and payloads", () => {
    const proposalId = createProposalId();

    const id = recordModelRequest(
      db,
      {
        proposalId,
        role: "zeus",
        route: intentRoute,
        prompt: "What does Zeus do?",
        output: '{"kind":"strike"}',
      },
      1_000,
    );

    const row = getModelRequestByProposalId(db, proposalId);
    expect(row).toEqual({
      id,
      proposalId,
      role: "zeus",
      outcome: "intent",
      exhaustedReason: undefined,
      cap: undefined,
      steps: [{ ...OLLAMA_STEP, elapsedMs: 812, mode: "native" }],
      elapsedMs: 815,
      promptDigest: sha256("What does Zeus do?"),
      outputDigest: sha256('{"kind":"strike"}'),
      promptPayload: "What does Zeus do?",
      outputPayload: '{"kind":"strike"}',
      recordedAtMs: 1_000,
    });
  });

  test("a chain where one step failed and the next answered records both steps, in order, with the reason and the mode", () => {
    const proposalId = createProposalId();
    const route: ModelRouteResult = {
      kind: "intent",
      step: {
        endpoint: "go",
        model: "some-go-model",
        attempts: 2,
        elapsedMs: 4_100,
        mode: "repaired",
      },
      failed: [
        {
          endpoint: "ollama",
          model: "llama3.2-3b-4k",
          attempts: 1,
          elapsedMs: 15_000,
          reason: "timeout",
          detail: "no reply within 15000 ms",
        },
      ],
      elapsedMs: 19_200,
    };

    recordModelRequest(db, {
      proposalId,
      role: "hera",
      route,
      prompt: "p",
      output: "o",
    });

    const row = getModelRequestByProposalId(db, proposalId);
    expect(row?.steps).toEqual([
      {
        endpoint: "ollama",
        model: "llama3.2-3b-4k",
        attempts: 1,
        elapsedMs: 15_000,
        reason: "timeout",
        detail: "no reply within 15000 ms",
      },
      {
        endpoint: "go",
        model: "some-go-model",
        attempts: 2,
        elapsedMs: 4_100,
        mode: "repaired",
      },
    ]);
    expect(row?.outcome).toBe("intent");
  });

  test("an exhausted chain is recorded with no proposal and no output, every step with its reason", () => {
    const id = recordModelRequest(db, {
      role: "zeus",
      route: {
        kind: "exhausted",
        steps: [
          { ...OLLAMA_STEP, reason: "network", detail: "Cannot connect" },
          {
            endpoint: "go",
            model: "some-go-model",
            attempts: 1,
            elapsedMs: 90,
            reason: "http-4xx",
          },
        ],
        elapsedMs: 900,
      },
      prompt: "What does Zeus do?",
    });

    const row = getModelRequest(db, id);
    expect(row).toMatchObject({
      id,
      role: "zeus",
      outcome: "exhausted",
      elapsedMs: 900,
      promptDigest: sha256("What does Zeus do?"),
    });
    expect(row?.proposalId).toBeUndefined();
    expect(row?.outputDigest).toBeUndefined();
    expect(row?.outputPayload).toBeUndefined();
    expect(row?.steps.map((step) => [step.endpoint, step.reason])).toEqual([
      ["ollama", "network"],
      ["go", "http-4xx"],
    ]);
  });

  test("an intent the service refused before it became a proposal may be recorded with no proposal", () => {
    const id = recordModelRequest(db, {
      role: "zeus",
      route: intentRoute,
      prompt: "p",
      output: "o",
    });

    expect(getModelRequest(db, id)?.proposalId).toBeUndefined();
  });

  test("the digest covers the whole text while the stored payload is bounded", () => {
    const prompt = "p".repeat(MODEL_PAYLOAD_LIMIT + 5_000);
    const output = "o".repeat(MODEL_PAYLOAD_LIMIT * 2);

    const id = recordModelRequest(db, {
      role: "zeus",
      route: intentRoute,
      prompt,
      output,
    });

    const row = getModelRequest(db, id);
    expect(row?.promptPayload).toHaveLength(MODEL_PAYLOAD_LIMIT);
    expect(row?.outputPayload).toHaveLength(MODEL_PAYLOAD_LIMIT);
    expect(row?.promptDigest).toBe(sha256(prompt));
    expect(row?.outputDigest).toBe(sha256(output));
  });

  test("the schema still refuses an exhausted chain that claims a proposal, should the type be bypassed", () => {
    const bypassed = {
      proposalId: createProposalId(),
      role: "zeus",
      route: { kind: "exhausted", steps: [], elapsedMs: 1 },
      prompt: "p",
    } as unknown as ModelRequestInput;

    expect(() => recordModelRequest(db, bypassed)).toThrow();
  });

  test("a proposal has at most one model request: a second is ignored, never thrown, so a tick that traces twice cannot fail", () => {
    const proposalId = createProposalId();
    const first = recordModelRequest(db, {
      proposalId,
      role: "zeus",
      route: intentRoute,
      prompt: "first",
      output: "o",
    });

    recordModelRequest(db, {
      proposalId,
      role: "zeus",
      route: intentRoute,
      prompt: "second",
      output: "o",
    });

    expect(getModelRequestByProposalId(db, proposalId)?.id).toBe(first);
    expect(
      (
        db.query("SELECT COUNT(*) AS n FROM trace_model_requests").get() as {
          n: number;
        }
      ).n,
    ).toBe(1);
  });

  test("the id a repeat request returns is the id of the row that holds the proposal, never one that was not written", () => {
    const proposalId = createProposalId();
    const first = recordModelRequest(db, {
      proposalId,
      role: "zeus",
      route: intentRoute,
      prompt: "first",
      output: "o",
    });

    const second = recordModelRequest(db, {
      proposalId,
      role: "zeus",
      route: intentRoute,
      prompt: "second",
      output: "o",
    });

    expect(second).toBe(first);
    expect(getModelRequest(db, second)?.promptPayload).toBe("first");
  });

  test("an unknown id and a proposal with no request resolve to nothing", () => {
    expect(getModelRequest(db, createModelRequestId())).toBeUndefined();
    expect(getModelRequestByProposalId(db, createProposalId())).toBeUndefined();
  });
});

describe("redaction at the write boundary (ADR-0006)", () => {
  const KEY = "sk-sentinel-DO-NOT-LEAK-0123456789";

  /** Every column of every trace table as text, the way a leak would be found. */
  function everythingStored(): string {
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    return tables
      .map(({ name }) =>
        JSON.stringify(db.query(`SELECT * FROM "${name}"`).all()),
      )
      .join("\n");
  }

  const leakyRoute: ModelRouteResult = {
    kind: "exhausted",
    steps: [
      {
        endpoint: "go",
        model: "big",
        attempts: 1,
        elapsedMs: 5,
        reason: "http-4xx",
        detail: `401 bad key ${KEY} rejected`,
      },
    ],
    elapsedMs: 6,
  };

  test("positive control: without a redactor the same request stores the key, so the scan can see it", () => {
    recordModelRequest(db, {
      role: "zeus",
      route: leakyRoute,
      prompt: `prompt with ${KEY}`,
    });
    expect(everythingStored()).toContain(KEY);
  });

  test("a loaded key is replaced in the prompt, the output, and every step's detail before the row is stored", () => {
    const redact = createRedactor([KEY]);
    const proposalId = createProposalId();
    recordModelRequest(
      db,
      {
        proposalId,
        role: "zeus",
        route: {
          kind: "intent",
          step: { ...OLLAMA_STEP, elapsedMs: 5, mode: "native" },
          failed: leakyRoute.steps,
          elapsedMs: 9,
        },
        prompt: `the prompt echoes ${KEY}`,
        output: `{"text":"${KEY}"}`,
      },
      1_000,
      redact,
    );

    expect(everythingStored()).not.toContain(KEY);
    const row = getModelRequestByProposalId(db, proposalId);
    expect(row?.promptPayload).toBe("the prompt echoes [redacted]");
    expect(row?.outputPayload).toBe('{"text":"[redacted]"}');
    expect(row?.steps[0]?.detail).toBe("401 bad key [redacted] rejected");
  });

  test("an exhausted step's refused reply and request-time schema are stored with the step, redacted", () => {
    const redact = createRedactor([KEY]);
    const id = recordModelRequest(
      db,
      {
        role: "zeus",
        route: {
          kind: "exhausted",
          steps: [
            {
              endpoint: "ollama",
              model: "m",
              attempts: 2,
              elapsedMs: 9,
              reason: "invalid-output",
              detail: "move must be one of: demand",
              output: `{"action":"practice","note":"${KEY}"}`,
              schema: `{"type":"object","description":"${KEY}"}`,
            },
          ],
          elapsedMs: 10,
        },
        prompt: "p",
      },
      1_000,
      redact,
    );
    expect(everythingStored()).not.toContain(KEY);
    const [step] = getModelRequest(db, id)?.steps ?? [];
    expect(step).toMatchObject({
      attempts: 2,
      output: '{"action":"practice","note":"[redacted]"}',
      schema: '{"type":"object","description":"[redacted]"}',
    });
    // Control: with no redactor the key reaches the row, so the scan above is the redaction's doing.
    recordModelRequest(db, {
      role: "zeus",
      route: {
        kind: "exhausted",
        steps: [
          {
            endpoint: "o",
            model: "m",
            attempts: 1,
            elapsedMs: 1,
            reason: "invalid-output",
            output: KEY,
          },
        ],
        elapsedMs: 1,
      },
      prompt: "p",
    });
    expect(everythingStored()).toContain(KEY);
  });

  test("the digests cover the redacted text, so a stored digest is never a hash of text holding a key", () => {
    const redact = createRedactor([KEY]);
    const proposalId = createProposalId();
    recordModelRequest(
      db,
      {
        proposalId,
        role: "zeus",
        route: intentRoute,
        prompt: `p ${KEY}`,
        output: `o ${KEY}`,
      },
      1_000,
      redact,
    );
    const row = getModelRequestByProposalId(db, proposalId);
    expect(row?.promptDigest).toBe(sha256("p [redacted]"));
    expect(row?.outputDigest).toBe(sha256("o [redacted]"));
  });

  test("every loaded key is replaced, a longer key that holds a shorter one is replaced whole, and an empty key is ignored", () => {
    const redact = createRedactor(["abcdefgh", "abcdefghij", ""]);
    expect(redact("x abcdefghij y abcdefgh z")).toBe(
      "x [redacted] y [redacted] z",
    );
    expect(createRedactor([])("nothing to hide")).toBe("nothing to hide");
  });

  test("text with no key is stored unchanged", () => {
    const redact = createRedactor([KEY]);
    const proposalId = createProposalId();
    recordModelRequest(
      db,
      {
        proposalId,
        role: "zeus",
        route: intentRoute,
        prompt: "plain",
        output: "plain out",
      },
      1_000,
      redact,
    );
    expect(getModelRequestByProposalId(db, proposalId)?.promptPayload).toBe(
      "plain",
    );
  });

  describe("a key with characters JSON escapes", () => {
    // A quote, a backslash, and a newline: each is written differently inside
    // a JSON string, and the runner serializes proposals and outputs as JSON.
    const TRICKY = 'sk-"quo\\te\nnl-0123456789';
    const ESCAPED = JSON.stringify(TRICKY).slice(1, -1);

    test("sanity: the escaped form really differs from the raw key", () => {
      expect(ESCAPED).not.toBe(TRICKY);
    });

    test("the redactor replaces the raw key and its JSON-escaped form", () => {
      const redact = createRedactor([TRICKY]);
      expect(redact(`raw ${TRICKY} and escaped ${ESCAPED}`)).toBe(
        "raw [redacted] and escaped [redacted]",
      );
      expect(redact(JSON.stringify({ text: TRICKY }))).toBe(
        '{"text":"[redacted]"}',
      );
    });

    test("a key echoed in a JSON-serialized answer and in an error detail is redacted in the stored row", () => {
      const redact = createRedactor([TRICKY]);
      const proposalId = createProposalId();
      recordModelRequest(
        db,
        {
          proposalId,
          role: "zeus",
          route: {
            kind: "intent",
            step: { ...OLLAMA_STEP, elapsedMs: 5, mode: "native" },
            failed: [
              {
                endpoint: "go",
                model: "big",
                attempts: 1,
                elapsedMs: 5,
                reason: "http-4xx",
                detail: `{"error":"bad key ${ESCAPED}"}`,
              },
            ],
            elapsedMs: 9,
          },
          prompt: "p",
          output: JSON.stringify({ assertion: `speaks ${TRICKY}` }),
        },
        1_000,
        redact,
      );

      const stored = everythingStored();
      expect(stored).not.toContain(TRICKY);
      expect(stored).not.toContain(ESCAPED);
      expect(stored).not.toContain(JSON.stringify(ESCAPED).slice(1, -1));
      expect(getModelRequestByProposalId(db, proposalId)?.outputPayload).toBe(
        '{"assertion":"speaks [redacted]"}',
      );
    });

    test("positive control: without the escaped form the same row would still hold the key", () => {
      const rawOnly = (text: string) => text.split(TRICKY).join("[redacted]");
      recordModelRequest(
        db,
        {
          role: "zeus",
          route: {
            kind: "intent",
            step: { ...OLLAMA_STEP, elapsedMs: 5, mode: "native" },
            failed: [],
            elapsedMs: 9,
          },
          prompt: "p",
          output: JSON.stringify({ assertion: `speaks ${TRICKY}` }),
        },
        1_000,
        rawOnly,
      );
      const row = db
        .query("SELECT output_payload FROM trace_model_requests")
        .get() as { output_payload: string };
      expect(row.output_payload).toContain(ESCAPED);
    });

    test("a key with nothing to escape is replaced once, not twice", () => {
      expect(createRedactor(["plainkey123"])("a plainkey123 b")).toBe(
        "a [redacted] b",
      );
    });
  });

  test("a bypass that writes a row without the writer is caught by the scan", () => {
    const redact = createRedactor([KEY]);
    recordModelRequest(
      db,
      { role: "zeus", route: leakyRoute, prompt: "p" },
      1_000,
      redact,
    );
    expect(everythingStored()).not.toContain(KEY);
    // A producer that inserts directly, skipping the writer, leaves the key.
    db.run(
      `INSERT INTO trace_model_requests
         (id, proposal_id, role, outcome, steps, elapsed_ms, prompt_digest, output_digest, prompt_payload, output_payload, recorded_at)
       VALUES (?, NULL, 'zeus', 'exhausted', '[]', 1, 'd', NULL, ?, NULL, 1)`,
      [createModelRequestId(), `bypassed ${KEY}`],
    );
    expect(everythingStored()).toContain(KEY);
  });
});

describe("pruneModelPayloads", () => {
  const DAY = 24 * 60 * 60 * 1000;

  function recordAt(recordedAt: number, tag: string) {
    const proposalId = createProposalId();
    recordModelRequest(
      db,
      {
        proposalId,
        role: "zeus",
        route: intentRoute,
        prompt: `prompt ${tag}`,
        output: `output ${tag}`,
      },
      recordedAt,
    );
    return proposalId;
  }

  test("nulls payload text older than the retention and keeps digests and metadata; newer rows are left alone", () => {
    const now = 100 * DAY;
    const old = recordAt(now - 8 * DAY, "old");
    const recent = recordAt(now - 6 * DAY, "recent");

    const pruned = pruneModelPayloads(db, MODEL_PAYLOAD_RETENTION_MS, now);

    expect(pruned).toBe(1);
    const oldRow = getModelRequestByProposalId(db, old);
    expect(oldRow?.promptPayload).toBeUndefined();
    expect(oldRow?.outputPayload).toBeUndefined();
    expect(oldRow).toMatchObject({
      promptDigest: sha256("prompt old"),
      outputDigest: sha256("output old"),
      role: "zeus",
      outcome: "intent",
      elapsedMs: 815,
    });
    expect(oldRow?.steps).toHaveLength(1);
    const recentRow = getModelRequestByProposalId(db, recent);
    expect(recentRow?.promptPayload).toBe("prompt recent");
    expect(recentRow?.outputPayload).toBe("output recent");
  });

  test("the retention is seven days, and a second prune finds nothing more to do", () => {
    expect(MODEL_PAYLOAD_RETENTION_MS).toBe(7 * DAY);
    const now = 100 * DAY;
    recordAt(now - 8 * DAY, "old");

    expect(pruneModelPayloads(db, MODEL_PAYLOAD_RETENTION_MS, now)).toBe(1);
    expect(pruneModelPayloads(db, MODEL_PAYLOAD_RETENTION_MS, now)).toBe(0);
  });

  test("a row exactly at the boundary is kept", () => {
    const now = 100 * DAY;
    const boundary = recordAt(now - 7 * DAY, "boundary");

    expect(pruneModelPayloads(db, MODEL_PAYLOAD_RETENTION_MS, now)).toBe(0);
    expect(getModelRequestByProposalId(db, boundary)?.promptPayload).toBe(
      "prompt boundary",
    );
  });
});

describe("an exhausted chain cannot claim a proposal or an output, by type", () => {
  const exhaustedRoute = {
    kind: "exhausted",
    steps: [],
    elapsedMs: 1,
  } as const;

  test("recordModelRequest refuses the combination at compile time, and accepts an exhausted chain that claims neither", () => {
    // Never called: these lines exist to be type-checked.
    const claimsProposal = () =>
      // @ts-expect-error an exhausted route produced no proposal
      recordModelRequest(db, {
        proposalId: createProposalId(),
        role: "zeus",
        route: exhaustedRoute,
        prompt: "p",
      });
    const claimsOutput = () =>
      // @ts-expect-error an exhausted route has no output
      recordModelRequest(db, {
        role: "zeus",
        route: exhaustedRoute,
        prompt: "p",
        output: "o",
      });
    expect(typeof claimsProposal).toBe("function");
    expect(typeof claimsOutput).toBe("function");

    const id = recordModelRequest(db, {
      role: "zeus",
      route: exhaustedRoute,
      prompt: "p",
    });
    expect(getModelRequest(db, id)?.outcome).toBe("exhausted");
  });
});

test("proposal ids are time-ordered, so the trace's outcome rows and their links are appended at the end of their indexes and not scattered through them", () => {
  const ids = Array.from({ length: 500 }, () => createProposalId());
  expect([...ids].sort()).toEqual(ids);
  expect(ids[0]?.startsWith("proposal-")).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
});

describe("the cap figures on a model request", () => {
  const cap = {
    estimatedTokens: 2_874,
    ratio: 2.85,
    shed: { events: 3, actions: 1, memories: 0, prayers: 2 },
  };

  test("an answered request keeps the estimated tokens, the ratio and the shed count of each tier", () => {
    const proposalId = createProposalId();
    recordModelRequest(db, {
      proposalId,
      role: "zeus",
      route: intentRoute,
      prompt: "p",
      output: "o",
      cap,
    });

    expect(getModelRequestByProposalId(db, proposalId)?.cap).toEqual(cap);
    expect(
      db
        .query(
          "SELECT estimated_tokens, token_ratio, shed_events, shed_actions, shed_memories, shed_prayers FROM trace_model_requests",
        )
        .get(),
    ).toEqual({
      estimated_tokens: 2_874,
      token_ratio: 2.85,
      shed_events: 3,
      shed_actions: 1,
      shed_memories: 0,
      shed_prayers: 2,
    });
  });

  test("a turn that was over the cap is recorded exhausted with the reason, and sent nothing", () => {
    const id = recordModelRequest(db, {
      role: "zeus",
      route: { kind: "exhausted", steps: [], elapsedMs: 0 },
      prompt: "p",
      exhaustedReason: "prompt-over-cap",
      cap,
    });

    const row = getModelRequest(db, id);
    expect(row).toMatchObject({
      outcome: "exhausted",
      exhaustedReason: "prompt-over-cap",
      steps: [],
      cap,
    });
  });

  test("a request recorded without them reads back with none, and a chain the router exhausted has no reason", () => {
    const id = recordModelRequest(db, {
      role: "zeus",
      route: { kind: "exhausted", steps: [], elapsedMs: 1 },
      prompt: "p",
    });

    const row = getModelRequest(db, id);
    expect(row?.cap).toBeUndefined();
    expect(row?.exhaustedReason).toBeUndefined();
  });

  test("only an exhausted request can carry a reason", () => {
    expect(() =>
      db.run(
        `INSERT INTO trace_model_requests
           (id, role, outcome, steps, elapsed_ms, prompt_digest, recorded_at, exhausted_reason)
         VALUES ('r', 'zeus', 'intent', '[]', 1, 'd', 1, 'prompt-over-cap')`,
      ),
    ).toThrow();
  });
});

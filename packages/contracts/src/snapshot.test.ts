import { expect, test } from "bun:test";
import { parseSyncFrame } from "./snapshot";

function frame(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    sequence: 10,
    worldId: "world-1",
    sessionId: "session-1",
    status: "running",
    recentEvents: [],
    state: { actors: [] },
    ...overrides,
  };
}

function recentEvent(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "evt-4-11",
    sequence: 11,
    tick: 4,
    kind: "building-ignited",
    subjects: ["tavern"],
    ...overrides,
  };
}

test("a valid running frame parses", () => {
  const result = parseSyncFrame(frame());
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      schemaVersion: 1,
      sequence: 10,
      worldId: "world-1",
      sessionId: "session-1",
      status: "running",
      state: { actors: [] },
    });
    expect(result.value.degradedReason).toBeUndefined();
    expect(result.value.catchUpSummary).toBeUndefined();
    expect(result.value.recentEvents).toHaveLength(0);
  }
});

test("a frame carrying recent events parses them in order", () => {
  const result = parseSyncFrame(
    frame({
      recentEvents: [
        recentEvent(),
        recentEvent({
          id: "evt-5-12",
          sequence: 12,
          tick: 5,
          kind: "entity-moved",
          subjects: ["npc-1", "loc-2"],
        }),
      ],
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.recentEvents as readonly unknown[]).toEqual([
      {
        id: "evt-4-11",
        sequence: 11,
        tick: 4,
        kind: "building-ignited",
        subjects: ["tavern"],
      },
      {
        id: "evt-5-12",
        sequence: 12,
        tick: 5,
        kind: "entity-moved",
        subjects: ["npc-1", "loc-2"],
      },
    ]);
  }
});

test("an ignition carries why it started: a strike, the director or a spread", () => {
  for (const cause of ["strike", "director", "spread"] as const) {
    const result = parseSyncFrame(
      frame({ recentEvents: [recentEvent({ cause })] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.recentEvents[0]?.cause).toBe(cause);
  }
});

test("a recent event's cause is absent unless it was sent", () => {
  const result = parseSyncFrame(frame({ recentEvents: [recentEvent()] }));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.recentEvents[0]).not.toHaveProperty("cause");
  }
});

test("a recent event with an unknown cause, or a cause on an event that is not an ignition, is rejected", () => {
  const unknown = parseSyncFrame(
    frame({ recentEvents: [recentEvent({ cause: "lightning" })] }),
  );
  expect(unknown.ok).toBe(false);
  if (!unknown.ok) expect(unknown.path).toBe("recentEvents[0].cause");

  const misplaced = parseSyncFrame(
    frame({
      recentEvents: [recentEvent({ kind: "entity-moved", cause: "strike" })],
    }),
  );
  expect(misplaced.ok).toBe(false);
  if (!misplaced.ok) expect(misplaced.path).toBe("recentEvents[0].cause");
});

test("a frame missing recentEvents is rejected", () => {
  const payload = frame();
  delete payload.recentEvents;
  const result = parseSyncFrame(payload);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.path).toBe("recentEvents");
  }
});

test("recentEvents that is not a list is rejected", () => {
  expect(parseSyncFrame(frame({ recentEvents: {} })).ok).toBe(false);
});

test("a recent event with an unknown kind is rejected", () => {
  const result = parseSyncFrame(
    frame({ recentEvents: [recentEvent({ kind: "teleported" })] }),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.path).toBe("recentEvents[0].kind");
  }
});

test("a recent event with a non-integer sequence or tick is rejected", () => {
  expect(
    parseSyncFrame(frame({ recentEvents: [recentEvent({ sequence: 1.5 })] }))
      .ok,
  ).toBe(false);
  expect(
    parseSyncFrame(frame({ recentEvents: [recentEvent({ tick: -1 })] })).ok,
  ).toBe(false);
});

test("a recent event missing its id or with a non-string subject is rejected", () => {
  const missingId = recentEvent();
  delete missingId.id;
  expect(parseSyncFrame(frame({ recentEvents: [missingId] })).ok).toBe(false);
  expect(
    parseSyncFrame(frame({ recentEvents: [recentEvent({ subjects: [7] })] }))
      .ok,
  ).toBe(false);
  expect(
    parseSyncFrame(
      frame({ recentEvents: [recentEvent({ subjects: "tavern" })] }),
    ).ok,
  ).toBe(false);
});

test("a valid paused frame parses", () => {
  const result = parseSyncFrame(frame({ status: "paused" }));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.status).toBe("paused");
  }
});

test("a degraded frame requires and carries a reason", () => {
  const result = parseSyncFrame(
    frame({ status: "degraded", degradedReason: "disk-full" }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      status: "degraded",
      degradedReason: "disk-full",
    });
  }
});

test("a frame can report model-degraded, the outage that never halts the world", () => {
  const result = parseSyncFrame(
    frame({ status: "degraded", degradedReason: "model-degraded" }),
  );

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      status: "degraded",
      degradedReason: "model-degraded",
    });
  }
});

test("an unknown degraded reason is still rejected", () => {
  expect(
    parseSyncFrame(frame({ status: "degraded", degradedReason: "gremlins" }))
      .ok,
  ).toBe(false);
});

test("a degraded frame missing a reason is rejected", () => {
  const result = parseSyncFrame(frame({ status: "degraded" }));
  expect(result.ok).toBe(false);
});

test("a frame with a catch-up summary parses", () => {
  const result = parseSyncFrame(
    frame({
      catchUpSummary: {
        id: "summary-7f3a",
        appliedMs: 3_600_000,
        skippedMs: 120_000,
        majorOutcomes: ["tavern fire spread"],
        atSequence: 10,
      },
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.catchUpSummary).toEqual({
      id: "summary-7f3a",
      appliedMs: 3_600_000,
      skippedMs: 120_000,
      majorOutcomes: ["tavern fire spread"],
      atSequence: 10,
    });
  }
});

test("a catch-up summary without an id is rejected, naming the path", () => {
  const result = parseSyncFrame(
    frame({
      catchUpSummary: {
        appliedMs: 0,
        skippedMs: 0,
        majorOutcomes: [],
        atSequence: 10,
      },
    }),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.path).toBe("catchUpSummary.id");
  }
});

test("a catch-up summary id that is not a non-empty string is rejected", () => {
  for (const id of ["", 7, null, {}]) {
    const result = parseSyncFrame(
      frame({
        catchUpSummary: {
          id,
          appliedMs: 0,
          skippedMs: 0,
          majorOutcomes: [],
          atSequence: 10,
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.path).toBe("catchUpSummary.id");
    }
  }
});

test("the summary's schema version is still 1: a frame carrying an id parses under SyncFrame version 1", () => {
  const result = parseSyncFrame(
    frame({
      catchUpSummary: {
        id: "s",
        appliedMs: 0,
        skippedMs: 0,
        majorOutcomes: [],
        atSequence: 0,
      },
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.schemaVersion).toBe(1);
  }
});

test("a catch-up summary without atSequence is rejected", () => {
  const result = parseSyncFrame(
    frame({
      catchUpSummary: {
        id: "summary-1",
        appliedMs: 3_600_000,
        skippedMs: 120_000,
        majorOutcomes: [],
      },
    }),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.path).toBe("catchUpSummary.atSequence");
  }
});

test("a catch-up summary atSequence that is not a non-negative integer is rejected", () => {
  for (const atSequence of [-1, 1.5, "10"]) {
    const result = parseSyncFrame(
      frame({
        catchUpSummary: {
          id: "summary-1",
          appliedMs: 0,
          skippedMs: 0,
          majorOutcomes: [],
          atSequence,
        },
      }),
    );
    expect(result.ok).toBe(false);
  }
});

test("a frame missing the state payload is rejected", () => {
  const payload = frame();
  delete payload.state;
  const result = parseSyncFrame(payload);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.path).toBe("state");
  }
});

test("a sequence that is not a non-negative integer is rejected", () => {
  expect(parseSyncFrame(frame({ sequence: 1.5 })).ok).toBe(false);
  expect(parseSyncFrame(frame({ sequence: -1 })).ok).toBe(false);
});

test("an unsupported schema version is rejected", () => {
  const result = parseSyncFrame(frame({ schemaVersion: 99 }));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("unsupported-version");
  }
});

test("an unknown status is rejected", () => {
  const result = parseSyncFrame(frame({ status: "crashed" }));
  expect(result.ok).toBe(false);
});

// --- Endpoint status: how each model endpoint's last request went ----------------------

test("a frame without endpoint status still parses, and has none", () => {
  const result = parseSyncFrame(frame());
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.modelEndpoints).toBeUndefined();
});

test("a frame carries each endpoint's last outcome through the parser: ok, failed with a reason and detail, untried", () => {
  const modelEndpoints = [
    { endpoint: "ollama", state: "ok" },
    {
      endpoint: "go",
      state: "failed",
      reason: "key-missing",
      detail: "key not set (opencode-go)",
    },
    { endpoint: "spare", state: "untried" },
  ];
  const result = parseSyncFrame(frame({ modelEndpoints }));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.modelEndpoints).toEqual(
      modelEndpoints as unknown as typeof result.value.modelEndpoints,
    );
  }
});

test("an empty endpoint list parses and is kept", () => {
  const result = parseSyncFrame(frame({ modelEndpoints: [] }));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.modelEndpoints).toEqual([]);
});

test("endpoint status rides a model-degraded frame without disturbing it", () => {
  const result = parseSyncFrame(
    frame({
      status: "degraded",
      degradedReason: "model-degraded",
      modelEndpoints: [
        { endpoint: "go", state: "failed", reason: "network", detail: "down" },
      ],
    }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.degradedReason).toBe("model-degraded");
    expect(result.value.modelEndpoints?.[0]?.state).toBe("failed");
  }
});

test("malformed endpoint status is rejected, naming the path", () => {
  for (const bad of [
    "nope",
    [{ endpoint: "x", state: "gremlins" }],
    [{ state: "ok" }],
    [{ endpoint: "x", state: "failed" }],
    [{ endpoint: "x", state: "failed", reason: 3, detail: "d" }],
  ]) {
    const result = parseSyncFrame(frame({ modelEndpoints: bad }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toContain("modelEndpoints");
  }
});

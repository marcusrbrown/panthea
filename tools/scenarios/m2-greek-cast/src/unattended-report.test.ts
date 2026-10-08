import { expect, test } from "bun:test";
import { phasePlan } from "./unattended";
import { analyzeUnattended } from "./unattended-analysis";
import { CLAIMS, renderUnattendedReport } from "./unattended-report";
import {
  baseResult,
  healthyScene,
  runData,
  T0,
  TICKS,
  turn,
} from "./unattended-test-data";

const report = (over: Parameters<typeof runData>[0] = {}): string =>
  renderUnattendedReport(runData(over));

test("a healthy full-length run reads end to end: every section, a PASS verdict at the top and above the rating sheet, and a threshold row for every check", () => {
  const text = report();
  for (const heading of [
    "# Unattended run",
    "## What this run proves",
    "## Phase timeline",
    "## Gods",
    "### Idle reasons",
    "### Relationship and belief changes by phase",
    "## Queue wait and quiet stretches",
    "## Latency",
    "## Recovery",
    "## Prompt size and the empty-200 fault",
    "## Director events by kind and phase",
    "## Memory",
    "## Export and rebuild",
    "## Threshold table",
    "## Rating sheet",
  ]) {
    expect([heading, text.includes(heading)]).toEqual([heading, true]);
  }
  expect(text.match(/\*\*Verdict: PASS\*\*/g)).toHaveLength(2);
  const analysis = analyzeUnattended(runData());
  for (const row of analysis.rows) {
    expect([row.id, text.includes(row.name.replaceAll("|", "/"))]).toEqual([
      row.id,
      true,
    ]);
  }
  expect(text).not.toContain("**FAIL**");
  // Every section that has a number has one filled in.
  expect(text).not.toContain("undefined");
  expect(text).not.toContain("NaN");
});

test("a development-length run says 'not a gate run' as its verdict, in the header and above the rating sheet", () => {
  const text = report({ result: { plan: phasePlan(6) } });
  expect(text).toContain("**Verdict: not a gate run**");
  expect(text).toContain("a 6-minute development run");
  expect(text).not.toContain("**Verdict: PASS**");
  expect(text).not.toContain("**Verdict: FAIL**");
});

test("a failing row shows FAIL in the table and a FAIL verdict, and an infrastructure fault says so and is not a FAIL", () => {
  const scene = healthyScene();
  turn(scene, "zeus", 1000, { recordedAtTick: 1100 });
  const failed = report({ scene });
  expect(failed).toContain("**Verdict: FAIL**");
  expect(failed).toContain(
    "| no god action commits during the outage | **FAIL** |",
  );

  const fault = report({
    result: { status: "fault", reason: "five empty responses in a row" },
  });
  expect(fault).toContain("**Verdict: INFRASTRUCTURE FAULT**");
  expect(fault).toContain(
    "The run did not complete: five empty responses in a row.",
  );
  expect(fault).not.toContain("**Verdict: FAIL**");
});

test("the claims are exactly what the run proves: A14 is export and rebuild only, P07 a local outage only, no A15, one hour", () => {
  expect(CLAIMS).toHaveLength(3);
  const text = report();
  expect(text).toContain("It proves export and rebuild only");
  expect(text).toContain("It proves a local outage only");
  expect(text).toContain(
    "It makes no claim for A15 (the eight-hour trial) and no claim beyond one hour of running time.",
  );
  // Nothing in the report claims more.
  expect(text).not.toMatch(/A15 (is )?(met|proved|proven|passed)/);
  expect(text).not.toMatch(/eight-hour trial (passed|is met)/);
});

test("the report names no host, port, path, key reference or user: only 'a local OpenAI-compatible endpoint'", () => {
  const text = report();
  expect(text).toContain(
    "a local OpenAI-compatible endpoint (granite3.3-8b-4k",
  );
  for (const secret of [
    "127.0.0.1",
    "localhost",
    "11434",
    ":8",
    "/Users/",
    "/tmp/",
    "Bearer",
    "api_key",
    "key-ref",
    "keyRef",
    "http://",
    "https://",
  ]) {
    expect([secret, text.includes(secret)]).toEqual([secret, false]);
  }
  const hosted = renderUnattendedReport(
    runData({ result: { settings: { model: "m", endpoint: "hosted" } } }),
  );
  expect(hosted).toContain("a hosted OpenAI-compatible endpoint");
});

test("queue wait is shown in service time with the inclusive figure beside it, and says which windows were left out", () => {
  const text = report();
  expect(text).toContain("p95 queue wait, service time");
  expect(text).toContain("p95 including the windows");
  expect(text).toContain(
    `outage start to proxyRestoredAt (ticks ${TICKS.outage} to ${TICKS.restored})`,
  );
  expect(text).toContain(
    `stop to the end of the catch-up (ticks ${TICKS.stopped} to ${TICKS.catchUp})`,
  );
  expect(text).toContain("Waiting after the proxy returned counts.");
});

test("the longest quiet stretch is shown per god, and one that runs to the end of the run says so", () => {
  const scene = healthyScene();
  scene.requests = scene.requests.filter(
    (r) =>
      !(
        r.role === "zeus" &&
        Number(/tick (\d+)/.exec(r.promptPayload ?? "")?.[1]) >
          TICKS.ended - 400
      ),
  );
  const kept = new Set(scene.requests.map((r) => r.proposalId));
  scene.proposals = scene.proposals.filter((p) => kept.has(p.proposalId));
  const text = report({ scene });
  expect(text).toMatch(
    /\| zeus \| \d+ \| \d+ \| \d+ \| \d+ \| ticks \d+ to 8400 \(to the end of the run\) \|/,
  );
});

test("an idle reason that can only be inferred is labelled as inferred, and a god with no gap over 90 ticks is not blamed", () => {
  const scene = healthyScene();
  scene.requests = scene.requests.filter((r) => {
    const tick = Number(/tick (\d+)/.exec(r.promptPayload ?? "")?.[1]);
    return !(r.role === "hades" && tick > 100 && tick < 500);
  });
  const kept = new Set(scene.requests.map((r) => r.proposalId));
  scene.proposals = scene.proposals.filter((p) => kept.has(p.proposalId));
  const text = report({ scene });
  expect(text).toMatch(
    /- hades: \d+ gaps? longer than 90 service ticks between requests\. Inferred: the scheduler's skips are not journaled/,
  );
  // A god whose gaps are all within 90 service ticks is not named, whatever the others did.
  const analysis = analyzeUnattended(runData());
  const steady = analysis.gods.filter(
    (g) => g.service.longGaps === 0 && g.requests > 0,
  );
  expect(steady.length).toBeGreaterThan(0);
  const quiet = report();
  for (const g of steady) expect(quiet).not.toContain(`- ${g.god}: `);
  // With no god over the line the section says so.
  const calm = healthyScene();
  const dense: typeof calm = {
    requests: [],
    proposals: [],
    events: calm.events,
  };
  for (const god of [
    "athena",
    "hades",
    "hephaestus",
    "hera",
    "hermes",
    "poseidon",
    "zeus",
  ]) {
    for (let tick = 10; tick < TICKS.ended; tick += 40) {
      if (tick > TICKS.outage - 30 && tick < TICKS.restored + 5) continue;
      if (tick > TICKS.stopped - 30 && tick < TICKS.catchUp + 5) continue;
      turn(dense, god, tick);
    }
  }
  expect(report({ scene: dense })).toContain(
    "Every god took its turns without a gap over 90 service ticks.",
  );
});

test("latency keeps the first request after recovery apart from the steady ones, and names whether the runner was loaded", () => {
  const text = report();
  expect(text).toContain("Steady-state requests took a median of");
  expect(text).toContain(
    "The first request after the proxy returned took 9.0 s",
  );
  expect(text).toContain(
    "the Ollama runner was absent when the proxy returned",
  );
});

test("recovery states proxyRestoredAt, when reasoning resumed and when a god acted, in ticks", () => {
  const text = report();
  expect(text).toContain(`proxyRestoredAt was tick ${TICKS.restored}.`);
  expect(text).toMatch(/Reasoning resumed at tick \d+, \d+ ticks later\./);
  expect(text).toMatch(
    /The first god action committed at tick \d+ \(\w+\), \d+ ticks later\./,
  );
});

test("the export and rebuild line carries the bytes, the rebuild milliseconds, the event count and the equality", () => {
  const text = report();
  expect(text).toContain(
    "Rebuild from genesis and 9000 events took 800 ms in a separate process and equals the live projection.",
  );
  expect(text).toContain("at event 9000");
  expect(text).toContain(
    "The archive imported into a scratch slot (9000 events).",
  );
  const missing = report({ result: { baseline: undefined } });
  expect(missing).toContain("No baseline was captured.");
});

test("the memory section is present-or-absent honest: it shows the sample count, the span and the peaks", () => {
  const text = report();
  expect(text).toMatch(
    /\d+ samples over [\d.]+ min\. Ollama runner: start \d+ MiB, peak \d+ MiB/,
  );
  expect(text).toContain("Swap used: peak 1000 MiB");
});

test("the rating sheet lists director-caused and god-caused episodes under separate headings, each with the three questions, and leaves the decision blank", () => {
  const text = report();
  const sheet = text.slice(text.indexOf("## Rating sheet"));
  expect(sheet).toContain("**Episodes the director caused**");
  expect(sheet).toContain("**Episodes a god caused**");
  expect(sheet).toContain("1. **Alive.**");
  expect(sheet).toContain("2. **Consequential.**");
  expect(sheet).toContain("3. **Coherent.**");
  expect(sheet).toContain(
    "M2 exits only on a PASS verdict and your approval of these episodes. Decision: ______",
  );
  expect(sheet).toMatch(
    /- tick \d+ \([a-z ]+\): the director's stock-spoiled on farmer/,
  );
  expect(sheet).toMatch(
    /- tick \d+ \([a-z ]+\): \w+'s (legend|travel), which caused a told belief/,
  );
  // A run that found no episode of a kind says so rather than inventing one.
  const bare = report({
    scene: { requests: [], proposals: [], events: [] },
  });
  expect(bare).toContain("No episode of this kind was found in the run.");
});

test("a run that ended in a failure still renders a full report: the boundaries it reached and the rows it could not fill, as failing", () => {
  const result = baseResult();
  const early = {
    status: "failed" as const,
    reason: "the sidecar exited (137) before the run ended",
    boundaries: result.boundaries.slice(0, 2),
    checks: [],
    baseline: undefined,
    catchUp: undefined,
    restore: undefined,
  };
  const text = report({ result: early });
  expect(text).toContain("**Verdict: FAIL**");
  expect(text).toContain(
    "The run did not complete: the sidecar exited (137) before the run ended.",
  );
  expect(text).toContain("The outage did not end, so there is no recovery.");
  expect(text).not.toContain("NaN");
  expect(text).not.toContain("undefined");
  expect(T0).toBeGreaterThan(0);
});

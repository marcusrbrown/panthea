import { expect, test } from "bun:test";
import type { ProxyRecord } from "./outage-proxy";
import {
  CUT_RATIO,
  collapsedTokens,
  findCutPrompts,
  joinResponses,
  MIN_CALIBRATION,
  namesSuspected,
  type PromptSample,
} from "./prompt-cut";
import type { RealRequest } from "./real-analysis";

const T0 = 1_800_000_000_000;
const CONTEXT = 4096;
const PER_CHAR = 0.33;

/** A request that finished `finishAt` ms into the run after `elapsedMs`, shown a prompt of `chars` characters. */
function request(
  god: string,
  finishAt: number,
  chars: number,
  elapsedMs = 8000,
): RealRequest {
  return {
    proposalId: `p-${finishAt}`,
    role: god,
    outcome: "intent",
    elapsedMs,
    promptPayload: "x".repeat(chars),
    steps: [{ mode: "native" }],
    recordedAt: T0 + finishAt,
  };
}

/** The response the proxy recorded for it, 6 ms before the trace row was written. */
function response(
  finishAt: number,
  elapsedMs: number,
  promptTokens: number,
): ProxyRecord {
  return {
    at: T0 + finishAt - 6 - elapsedMs,
    status: 200,
    latencyMs: elapsedMs,
    outcome: "forwarded",
    kind: "completion",
    empty: false,
    promptTokens,
  };
}

/** `count` ordinary turns one after another, prompts of 2,000 to 10,500 characters, each at 0.33 tokens a character give or take 8%. */
function turns(count: number): {
  requests: RealRequest[];
  proxy: ProxyRecord[];
} {
  const requests: RealRequest[] = [];
  const proxy: ProxyRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const finishAt = (i + 1) * 20_000;
    const chars = 2000 + ((i * 937) % 8500);
    const wobble = 1 + (((i * 7) % 17) - 8) / 100;
    requests.push(request(i % 2 === 0 ? "athena" : "zeus", finishAt, chars));
    proxy.push(response(finishAt, 8000, Math.round(chars * PER_CHAR * wobble)));
  }
  return { requests, proxy };
}

test("the count Ollama reports for a cut prompt is half the context plus two", () => {
  expect(collapsedTokens(4096)).toBe(2050);
  expect(collapsedTokens(8192)).toBe(4098);
});

test("a response joins the request whose span its end falls in, and each of a retried request's responses is a sample of its prompt", () => {
  const { requests, proxy } = turns(3);
  // The second request made two attempts: a first response, then a repair after it.
  const second = requests[1] as RealRequest;
  const retried = { ...second, elapsedMs: 16_000 };
  const first = response(40_000 - 8000, 8000, 3000);
  const samples = joinResponses(
    [requests[0] as RealRequest, retried, requests[2] as RealRequest],
    [
      proxy[0] as ProxyRecord,
      first,
      proxy[1] as ProxyRecord,
      proxy[2] as ProxyRecord,
    ],
  );
  // Four responses: the retried request's two both belong to it, and the request after it still gets its own.
  expect(samples).toHaveLength(4);
  expect(samples[1]?.tokens).toBe(3000);
  expect(samples[2]?.tokens).toBe(
    (proxy[1] as ProxyRecord).promptTokens as number,
  );
  expect(samples[1]?.chars).toBe(samples[2]?.chars);
  expect(samples[3]?.tokens).toBe(
    (proxy[2] as ProxyRecord).promptTokens as number,
  );
});

test("a request the model never answered has no response to join, and neither does a response outside every request", () => {
  const { requests, proxy } = turns(5);
  const refused: RealRequest = {
    proposalId: undefined,
    role: "hera",
    outcome: "exhausted",
    elapsedMs: 300,
    promptPayload: "x".repeat(500),
    steps: [{ reason: "http-5xx" }],
    recordedAt: T0 + 3_000_000,
  };
  const stray = response(5_000_000, 8000, 999);
  const samples = joinResponses([...requests, refused], [...proxy, stray]);
  expect(samples).toHaveLength(5);
  expect(samples.map((s) => s.god)).not.toContain("hera");
});

test("an hour like the failed one: 9 of 214 responses report 2,050 for prompts of about 12,000 characters, the largest ordinary count is 4,094, and all 9 are found, by god", () => {
  const { requests, proxy } = turns(205);
  const samples: PromptSample[] = joinResponses(requests, proxy);
  const cuts = [...Array.from({ length: 8 }, () => "athena"), "hephaestus"].map(
    (god, i) => {
      const finishAt = 5_000_000 + i * 20_000;
      requests.push(request(god, finishAt, 12_000 + i * 40));
      proxy.push(response(finishAt, 8000, 2050));
      return god;
    },
  );
  // The largest ordinary count is one token under the context.
  const finishAt = 6_000_000;
  requests.push(request("athena", finishAt, 11_990));
  proxy.push(response(finishAt, 8000, 4094));
  expect(cuts).toHaveLength(9);
  expect(Math.max(...proxy.map((r) => r.promptTokens ?? 0))).toBe(4094);

  const found = findCutPrompts(joinResponses(requests, proxy), proxy, CONTEXT);
  expect(samples.length).toBe(205);
  expect(found.cut).toBe(9);
  expect(found.byGod).toEqual({ athena: 8, hephaestus: 1 });
  expect(found.suspected).toBe(0);
  expect(found.calibrated).toBe(true);
  expect(found.matched).toBe(215);
});

test("a run whose largest prompt is 4,094 tokens and none collapsed has no cut response", () => {
  const { requests, proxy } = turns(60);
  const finishAt = 2_000_000;
  requests.push(request("athena", finishAt, 11_990));
  proxy.push(response(finishAt, 8000, 4094));
  const found = findCutPrompts(joinResponses(requests, proxy), proxy, CONTEXT);
  expect(found.cut).toBe(0);
  expect(found.byGod).toEqual({});
  expect(found.responses).toBe(61);
});

test("the length signal finds a cut that does not land on 2,050, as a model with another context would give", () => {
  const { requests, proxy } = turns(60);
  const finishAt = 2_000_000;
  requests.push(request("poseidon", finishAt, 12_000));
  proxy.push(response(finishAt, 8000, 2400));
  const found = findCutPrompts(joinResponses(requests, proxy), proxy, CONTEXT);
  expect(found.cut).toBe(1);
  expect(found.byGod).toEqual({ poseidon: 1 });
  // 2,400 tokens for 12,000 characters is 0.2 a character against a median near 0.33: under the 0.7 line.
  expect(2400 / 12_000).toBeLessThan(CUT_RATIO * PER_CHAR);
});

test("a response at exactly 2,050 that no request can be matched to is a suspected cut, not a confirmed one: there is no prompt length to read it against", () => {
  const proxy = [
    response(100_000, 8000, 1500),
    response(200_000, 8000, 2050),
    response(300_000, 8000, 3900),
  ];
  const found = findCutPrompts([], proxy, CONTEXT);
  expect(found.calibrated).toBe(false);
  expect(found.cut).toBe(0);
  expect(found.suspected).toBe(1);
  expect(found.byGod).toEqual({});
  expect(found.suspectedByGod).toEqual({});
  expect(namesSuspected(found)).toBe("god unknown 1");
});

test("a matched ordinary prompt that is exactly 2,050 tokens is not cut: the length decides, and its ratio is the run's", () => {
  // Fro Bot's case: 6,212 characters and 2,050 tokens is 0.330 a character against a median near 0.33.
  const { requests, proxy } = turns(60);
  const finishAt = 2_000_000;
  requests.push(request("zeus", finishAt, 6212));
  proxy.push(response(finishAt, 8000, 2050));
  const samples = joinResponses(requests, proxy);
  const found = findCutPrompts(samples, proxy, CONTEXT);
  const ratio = 2050 / 6212;
  expect(ratio).toBeGreaterThan(CUT_RATIO * (found.medianTokensPerChar ?? 0));
  expect(found.cut).toBe(0);
  expect(found.byGod).toEqual({});
  expect(found.suspected).toBe(0);
  expect(found.matched).toBe(61);
});

test("a matched prompt of 12,000 characters at exactly 2,050 tokens is cut, by its length", () => {
  const { requests, proxy } = turns(60);
  const finishAt = 2_000_000;
  requests.push(request("athena", finishAt, 12_000));
  proxy.push(response(finishAt, 8000, 2050));
  const found = findCutPrompts(joinResponses(requests, proxy), proxy, CONTEXT);
  expect(found.cut).toBe(1);
  expect(found.byGod).toEqual({ athena: 1 });
  expect(found.suspected).toBe(0);
});

test("too few matched responses to calibrate leaves the length signal off: a short prompt with a low ratio is not called cut", () => {
  const few: PromptSample[] = Array.from(
    { length: MIN_CALIBRATION - 2 },
    () => ({
      god: "zeus",
      tokens: 330,
      chars: 1000,
    }),
  );
  const odd: PromptSample = { god: "zeus", tokens: 100, chars: 1000 };
  const found = findCutPrompts([...few, odd], [], CONTEXT);
  expect(found.calibrated).toBe(false);
  expect(found.cut).toBe(0);
});

test("a matched response at exactly 2,050 when too few were matched to calibrate is suspected, since its length cannot be read against a median", () => {
  const few: PromptSample[] = Array.from({ length: 5 }, () => ({
    god: "zeus",
    tokens: 330,
    chars: 1000,
  }));
  const collapsed: PromptSample = {
    god: "athena",
    tokens: 2050,
    chars: 12_000,
  };
  const found = findCutPrompts([...few, collapsed], [], CONTEXT);
  expect(found.calibrated).toBe(false);
  expect(found.cut).toBe(0);
  expect(found.suspected).toBe(1);
  expect(found.suspectedByGod).toEqual({ athena: 1 });
  expect(namesSuspected(found)).toBe("athena 1");
});

test("ordinary spread in tokens per character is not a cut: counts 10% under and over the median pass", () => {
  const samples: PromptSample[] = Array.from({ length: 40 }, (_, i) => ({
    god: "hera",
    tokens: Math.round(1000 * PER_CHAR * (i % 2 === 0 ? 0.9 : 1.1)),
    chars: 1000,
  }));
  expect(findCutPrompts(samples, [], CONTEXT).cut).toBe(0);
});

test("two cut responses to one request, a retry on the same cut prompt, are both counted, and both are the god's", () => {
  const { requests, proxy } = turns(40);
  const finishAt = 2_000_000;
  const retried = request("athena", finishAt, 12_000, 16_000);
  requests.push(retried);
  proxy.push(
    response(finishAt - 8000, 8000, 2050),
    response(finishAt, 8000, 2050),
  );
  const found = findCutPrompts(joinResponses(requests, proxy), proxy, CONTEXT);
  expect(found.cut).toBe(2);
  expect(found.byGod).toEqual({ athena: 2 });
  expect(found.suspected).toBe(0);
});

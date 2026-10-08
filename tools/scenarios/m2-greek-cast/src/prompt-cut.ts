// Whether any prompt the model was sent was cut. Ollama cuts a prompt longer than its context without an error and
// reports a prompt token count for what is left: on the 4,096-token baseline it reports exactly 2,050 (half the
// context and two) whatever the prompt was, so the largest count in a run stays under the context while the model has
// lost the start of its instructions. The count alone cannot show it, so each response is read against the prompt that
// made it:
//
// - A response matched to its request is cut when it reports far fewer tokens than its prompt's length predicts. The
//   prediction is the run's own median tokens per character, so it needs no tokenizer and survives a change of model or
//   of Ollama's cutting rule. Length decides, whatever the count: a prompt can genuinely be 2,050 tokens.
// - A response with no prompt length to read it against, because no request was matched to it or too few were matched to
//   calibrate a median, can only be suspected: if it reports exactly half the context plus two, which is what a cut
//   reports, it is a suspected cut. A suspected cut is named but not counted as a cut.
//
// Matching responses to requests is by time, from the proxy's records and the trace's rows. Nothing here reads prompt
// text beyond its length.

import type { ProxyRecord } from "./outage-proxy";
import type { RealRequest } from "./real-analysis";

/** A response whose tokens per character are under this share of the run's median is taken as cut: a cut halves them, and ordinary prompts stay within a tenth of the median. */
export const CUT_RATIO = 0.7;
/** The fewest matched responses the run's median tokens per character is taken from. */
export const MIN_CALIBRATION = 20;
/** How far a proxy record's end may fall outside its request's span, in ms. */
export const JOIN_TOLERANCE_MS = 250;

/** The token count Ollama reports for a prompt it cut, for a model run with `contextTokens` of context. */
export const collapsedTokens = (contextTokens: number): number =>
  contextTokens / 2 + 2;

export interface PromptSample {
  readonly god: string;
  readonly tokens: number;
  readonly chars: number;
}

const isCounted = (record: ProxyRecord): boolean =>
  record.kind === "completion" &&
  record.outcome === "forwarded" &&
  record.promptTokens !== undefined;

/**
 * Each response joined to the request it answered, by time: turns run one at a time, so a response whose end falls within
 * a request's span (its finish less its elapsed time, to its finish) is that request's, and so is each retry in it,
 * which is a response to the same prompt or to that prompt with a repair added. A request the model did not answer, or
 * one the trace kept no prompt for, has no sample.
 */
export function joinResponses(
  requests: readonly RealRequest[],
  proxy: readonly ProxyRecord[],
): PromptSample[] {
  const responses = proxy
    .filter(isCounted)
    .map((record) => ({ record, end: record.at + record.latencyMs }))
    .sort((a, b) => a.record.at - b.record.at);
  const used = new Set<ProxyRecord>();
  const samples: PromptSample[] = [];
  const ordered = requests
    .filter((r) => r.recordedAt !== undefined && r.promptPayload !== undefined)
    .sort((a, b) => (a.recordedAt as number) - (b.recordedAt as number));
  for (const request of ordered) {
    const finish = request.recordedAt as number;
    const within = responses.filter(
      ({ record, end }) =>
        !used.has(record) &&
        end >= finish - request.elapsedMs - JOIN_TOLERANCE_MS &&
        end <= finish + JOIN_TOLERANCE_MS,
    );
    const chars = request.promptPayload?.length ?? 0;
    for (const { record } of within) {
      used.add(record);
      if (record.promptTokens === undefined || chars === 0) continue;
      samples.push({
        god: request.role,
        tokens: record.promptTokens,
        chars,
      });
    }
  }
  return samples;
}

const median = (values: readonly number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

export interface CutPrompts {
  /** Responses that carried a prompt token count. */
  readonly responses: number;
  /** Of those, the ones joined to a request. */
  readonly matched: number;
  /** Whether enough were matched to calibrate a median tokens per character; when not, no matched response can be called cut. */
  readonly calibrated: boolean;
  readonly medianTokensPerChar: number | undefined;
  /** The count Ollama reports for a cut prompt at this context. */
  readonly collapsedAt: number;
  /** Matched responses whose tokens per character are far under the run's median: confirmed cuts. */
  readonly cut: number;
  /** Confirmed cuts by the god whose request they answered. */
  readonly byGod: Readonly<Record<string, number>>;
  /** Responses at exactly `collapsedAt` with no prompt length to read them against: possibly cut, not confirmed. */
  readonly suspected: number;
  /** Suspected responses whose request is known, by god: matched, but too few were matched to calibrate a median. */
  readonly suspectedByGod: Readonly<Record<string, number>>;
}

/** The cut responses in a run: `samples` are the joined responses, `proxy` every response the proxy recorded. */
export function findCutPrompts(
  samples: readonly PromptSample[],
  proxy: readonly ProxyRecord[],
  contextTokens: number,
): CutPrompts {
  const collapsedAt = collapsedTokens(contextTokens);
  const counted = proxy.filter(isCounted);
  // A median is read from the responses at any count but the collapsed one, which a cut could have produced.
  const ordinary = samples.filter((s) => s.tokens !== collapsedAt);
  const calibrated = ordinary.length >= MIN_CALIBRATION;
  const medianRatio = calibrated
    ? median(ordinary.map((s) => s.tokens / s.chars))
    : undefined;
  const byGod: Record<string, number> = {};
  const suspectedByGod: Record<string, number> = {};
  let cut = 0;
  let matchedCollapsed = 0;
  for (const sample of samples) {
    const collapsed = sample.tokens === collapsedAt;
    if (collapsed) matchedCollapsed += 1;
    if (medianRatio === undefined) {
      // No median to read the length against: a collapsed count can only be suspected.
      if (collapsed) {
        suspectedByGod[sample.god] = (suspectedByGod[sample.god] ?? 0) + 1;
      }
    } else if (sample.tokens / sample.chars < CUT_RATIO * medianRatio) {
      cut += 1;
      byGod[sample.god] = (byGod[sample.god] ?? 0) + 1;
    }
  }
  const collapsedRecords = counted.filter(
    (r) => r.promptTokens === collapsedAt,
  ).length;
  // Responses at the collapsed count that no request was matched to have no prompt length to read, and the god is unknown.
  const unmatched = Math.max(0, collapsedRecords - matchedCollapsed);
  const suspected =
    unmatched + Object.values(suspectedByGod).reduce((a, b) => a + b, 0);
  return {
    responses: counted.length,
    matched: samples.length,
    calibrated,
    medianTokensPerChar: medianRatio,
    collapsedAt,
    cut,
    byGod,
    suspected,
    suspectedByGod,
  };
}

/** Who the suspected cuts are, by god and then those whose god is unknown: "athena 1, god unknown 2". */
export function namesSuspected(cut: CutPrompts): string {
  const known = Object.entries(cut.suspectedByGod)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([god, n]) => `${god} ${n}`);
  const unknown =
    cut.suspected -
    Object.values(cut.suspectedByGod).reduce((a, b) => a + b, 0);
  return [...known, ...(unknown === 0 ? [] : [`god unknown ${unknown}`])].join(
    ", ",
  );
}

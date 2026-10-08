// Whether any prompt the model was sent was cut. Ollama cuts a prompt longer than its context without an error and
// reports a prompt token count for what is left: on the 4,096-token baseline it reports exactly 2,050 (half the
// context and two) whatever the prompt was, so the largest count in a run stays under the context while the model has
// lost the start of its instructions. The count alone cannot show it, so two signals read it against the prompt:
//
// - Length: a response reports far fewer tokens than its own prompt's length predicts. The prediction is the run's own
//   median tokens per character, so it needs no tokenizer and survives a change of model or of Ollama's cutting rule.
//   It needs each response joined to the request that made it, which the proxy's records and the trace's rows allow by
//   time.
// - Collapse: a response reports exactly half the context plus two. It needs no join, so it still sees a cut when the
//   run's responses cannot be matched to requests.
//
// A response either signal marks is cut. Nothing here reads prompt text beyond its length.

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
 * Each request joined to the first response the model gave it, by time: turns run one at a time, so a response whose
 * end falls within a request's span (its finish less its elapsed time, to its finish) is that request's. A request the
 * model did not answer, or one the trace kept no prompt for, has no sample.
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
    for (const { record } of within) used.add(record);
    const first = within[0]?.record;
    const chars = request.promptPayload?.length ?? 0;
    if (first?.promptTokens === undefined || chars === 0) continue;
    samples.push({ god: request.role, tokens: first.promptTokens, chars });
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
  /** Whether enough were matched to read the length signal; when not, only the collapse is read. */
  readonly calibrated: boolean;
  readonly medianTokensPerChar: number | undefined;
  /** The count Ollama reports for a cut prompt at this context. */
  readonly collapsedAt: number;
  /** Responses either signal marks as cut. */
  readonly cut: number;
  /** Cut responses by the god whose request they answered. */
  readonly byGod: Readonly<Record<string, number>>;
  /** Cut responses that no request was matched to: the collapse saw them, the god is unknown. */
  readonly unattributed: number;
}

/** The cut responses in a run: `samples` are the joined responses, `proxy` every response the proxy recorded. */
export function findCutPrompts(
  samples: readonly PromptSample[],
  proxy: readonly ProxyRecord[],
  contextTokens: number,
): CutPrompts {
  const collapsedAt = collapsedTokens(contextTokens);
  const counted = proxy.filter(isCounted);
  const ordinary = samples.filter((s) => s.tokens !== collapsedAt);
  const calibrated = ordinary.length >= MIN_CALIBRATION;
  const medianRatio = calibrated
    ? median(ordinary.map((s) => s.tokens / s.chars))
    : undefined;
  const byGod: Record<string, number> = {};
  let matchedCut = 0;
  let matchedCollapsed = 0;
  for (const sample of samples) {
    const collapsed = sample.tokens === collapsedAt;
    const short =
      medianRatio !== undefined &&
      sample.tokens / sample.chars < CUT_RATIO * medianRatio;
    if (collapsed) matchedCollapsed += 1;
    if (collapsed || short) {
      matchedCut += 1;
      byGod[sample.god] = (byGod[sample.god] ?? 0) + 1;
    }
  }
  const collapsedRecords = counted.filter(
    (r) => r.promptTokens === collapsedAt,
  ).length;
  const unattributed = Math.max(0, collapsedRecords - matchedCollapsed);
  return {
    responses: counted.length,
    matched: samples.length,
    calibrated,
    medianTokensPerChar: medianRatio,
    collapsedAt,
    cut: matchedCut + unattributed,
    byGod,
    unattributed,
  };
}

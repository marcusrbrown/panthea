// The cap on a god's whole prompt: how many characters a token is for the
// models on a role's route, and whether a built request fits `PROMPT_TOKEN_CAP`
// counted with the least favourable of them. Counting is by characters, because
// the prompt is built before any model runs; the ratios are measured on local
// Ollama (`prompt_eval_count` against request characters).

import type { GodProfile } from "@panthea/content";
import type { EntityId } from "@panthea/contracts";
import type { PerceptionSnapshot, WorldState } from "@panthea/world";
import type { RoutePlan } from "./config";
import {
  buildGodContext,
  type PetitionView,
  protectedPrayers,
  type Remembered,
} from "./context";
import {
  PROMPT_TOKEN_CAP,
  type PracticeOptions,
  practiceBy,
} from "./practices";
import { MAX_FEEDBACK_CHARS, type RouteContext, requestChars } from "./router";

/** Characters a token takes, by the router's model id. Measured on local Ollama, 2026-10-08. */
export const MODEL_RATIOS: Readonly<Record<string, number>> = {
  "granite3.3-8b-4k": 2.85,
  "qwen3-8b-4k": 3.34,
};

/** The ratio of a model not in the table: below every measured one, so an unmeasured model is counted dense. */
export const DEFAULT_RATIO = 2.8;

/** The smallest ratio over every step of `plan`, and `DEFAULT_RATIO` for an empty one. */
export function routeRatio(plan: RoutePlan): number {
  const ratios = plan.steps.map(
    (step) => MODEL_RATIOS[step.model] ?? DEFAULT_RATIO,
  );
  return ratios.length === 0 ? DEFAULT_RATIO : Math.min(...ratios);
}

/** The most characters one send may carry at `ratio`: the cap, in the characters that count it. */
export function maxCharsFor(ratio: number): number {
  return Math.floor(PROMPT_TOKEN_CAP * ratio + 1e-6);
}

/**
 * Tokens `context` is counted as at `ratio`: its request plus the most a retry's
 * feedback can add. The epsilon keeps a request exactly at the cap from rounding up
 * over it.
 */
export function estimateTokens(context: RouteContext, ratio: number): number {
  return Math.ceil((requestChars(context) + MAX_FEEDBACK_CHARS) / ratio - 1e-9);
}

export function fitsCap(context: RouteContext, ratio: number): boolean {
  return estimateTokens(context, ratio) <= PROMPT_TOKEN_CAP;
}

// --- Shedding ------------------------------------------------------------------------------------

/** How many units each tier shed. `memories` counts memories and feelings together. */
export interface ShedCounts {
  readonly events: number;
  readonly actions: number;
  readonly memories: number;
  readonly prayers: number;
}

export interface CapInput {
  readonly profile: GodProfile;
  /** The committed state `remembered` was read from: shedding re-derives the practice options from it. */
  readonly state: WorldState;
  readonly actorId: EntityId;
  readonly snapshot: PerceptionSnapshot;
  readonly remembered: Remembered;
  /** Characters per token on the role's route (`routeRatio`). */
  readonly ratio: number;
}

export interface Capped {
  /** What the prompt, the schema and the proposal builder are all made from. */
  readonly snapshot: PerceptionSnapshot;
  readonly remembered: Remembered;
  readonly context: RouteContext;
  readonly estimatedTokens: number;
  readonly ratio: number;
  readonly shed: ShedCounts;
  /** False when the protected floor alone is over the cap: nothing more may be shed, and the turn is not sent. */
  readonly fits: boolean;
}

interface Pair {
  readonly snapshot: PerceptionSnapshot;
  readonly remembered: Remembered;
}

/** `petition` with the offer and redress `options` hold for it, and none it no longer holds. */
function withOptions(
  petition: PetitionView,
  options: PracticeOptions,
): PetitionView {
  const { offer: _offer, redress: _redress, ...rest } = petition;
  const offer = options.offerTerms[petition.id];
  const redress = options.redress[petition.id];
  return {
    ...rest,
    ...(offer === undefined ? {} : { offer }),
    ...(redress === undefined ? {} : { redress }),
  };
}

/**
 * `remembered` with its practice options asked again of the memories and prayers it now holds, the way
 * `rememberedBy` re-asks for the prayers it shows: what may be offered, demanded over or named as a party
 * is what the god can still see.
 */
function rederive(input: CapInput, remembered: Remembered): Remembered {
  const { options } = practiceBy(
    input.state,
    input.actorId,
    remembered.memories,
    remembered.petitions.map((petition) => petition.petitioner),
    remembered.practiceRefusal,
    new Set(remembered.petitions.map((petition) => petition.id)),
  );
  return {
    ...remembered,
    practice: options,
    petitions: remembered.petitions.map((petition) =>
      withOptions(petition, options),
    ),
  };
}

/** Tier 1: the oldest recent event. */
function withoutEvent({ snapshot, remembered }: Pair): Pair | undefined {
  if (snapshot.events.length === 0) return undefined;
  return {
    snapshot: { ...snapshot, events: snapshot.events.slice(1) },
    remembered,
  };
}

/** Tier 2: the oldest own action, and the goal-history row that tells of it. */
function withoutAction({ snapshot, remembered }: Pair): Pair | undefined {
  const [gone, ...ownActions] = remembered.ownActions;
  if (gone === undefined) return undefined;
  return {
    snapshot,
    remembered: {
      ...remembered,
      ownActions,
      goalHistory: remembered.goalHistory.filter(
        (entry) => entry.kind !== "action" || entry.event.id !== gone.id,
      ),
    },
  };
}

/**
 * Tier 3: the least salient memory (the oldest among equals), with its goal-history row, and everything
 * derived from it; once none is left, the weakest feeling.
 */
function withoutMemory(
  { snapshot, remembered }: Pair,
  input: CapInput,
): Pair | undefined {
  const gone = [...remembered.memories].sort(
    (a, b) => a.salience - b.salience || a.recordedAt - b.recordedAt,
  )[0];
  if (gone !== undefined) {
    return {
      snapshot,
      remembered: rederive(input, {
        ...remembered,
        memories: remembered.memories.filter((memory) => memory !== gone),
        goalHistory: remembered.goalHistory.filter(
          (entry) => entry.kind !== "memory" || entry.memory.id !== gone.id,
        ),
      }),
    };
  }
  if (remembered.relationships.length === 0) return undefined;
  // Strongest first, as `rememberedBy` keeps them.
  return {
    snapshot,
    remembered: {
      ...remembered,
      relationships: remembered.relationships.slice(0, -1),
    },
  };
}

/** Tier 4: the oldest prayer no live practice names. Prayers are held protected first, then newest first. */
function withoutPrayer(
  { snapshot, remembered }: Pair,
  input: CapInput,
): Pair | undefined {
  const protectedIds = protectedPrayers(input.state, input.actorId);
  const at = remembered.petitions
    .map((petition) => protectedIds.has(petition.id))
    .lastIndexOf(false);
  if (at < 0) return undefined;
  return {
    snapshot,
    remembered: rederive(input, {
      ...remembered,
      petitions: remembered.petitions.filter((_, index) => index !== at),
      morePrayers: remembered.morePrayers + 1,
    }),
  };
}

const TIERS: readonly (readonly [
  keyof ShedCounts,
  (pair: Pair, input: CapInput) => Pair | undefined,
])[] = [
  ["events", withoutEvent],
  ["actions", withoutAction],
  ["memories", withoutMemory],
  ["prayers", withoutPrayer],
];

/**
 * Sheds units from `(snapshot, remembered)`, tier by tier, until the request built from what is left fits
 * the cap at `ratio` or nothing sheddable is left. It measures the rebuilt request after every unit, so the
 * result is the real size and a unit shed always changes what the prompt, the schema and the parser are built
 * from together. The protected floor is never touched: the instructions and persona, the goal and journey,
 * the god's own obligations and every prayer a live practice names. The loop ends after at most one rebuild
 * per unit, and asks no model.
 */
export function fitToCap(input: CapInput): Capped {
  let pair: Pair = { snapshot: input.snapshot, remembered: input.remembered };
  let context = buildGodContext(input.profile, pair.snapshot, pair.remembered);
  const shed = { events: 0, actions: 0, memories: 0, prayers: 0 };
  for (const [tier, next] of TIERS) {
    while (!fitsCap(context, input.ratio)) {
      const reduced = next(pair, input);
      if (reduced === undefined) break;
      pair = reduced;
      shed[tier] += 1;
      context = buildGodContext(input.profile, pair.snapshot, pair.remembered);
    }
  }
  return {
    ...pair,
    context,
    estimatedTokens: estimateTokens(context, input.ratio),
    ratio: input.ratio,
    shed,
    fits: fitsCap(context, input.ratio),
  };
}

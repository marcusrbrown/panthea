// The cap on a god's whole prompt: how many characters a token is for the
// models on a role's route, and whether a built request fits `PROMPT_TOKEN_CAP`
// counted with the least favourable of them. Counting is by characters, because
// the prompt is built before any model runs; the ratios are measured on local
// Ollama (`prompt_eval_count` against request characters).

import type { GodProfile } from "@panthea/content";
import type { EntityId, EventId } from "@panthea/contracts";
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
import { type RouteContext, requestChars } from "./router";

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
 * Tokens `context` is counted as at `ratio`: the bare request, instructions and prompt. No room is kept for a
 * retry's note; the router cuts the note to the room left. The epsilon keeps a request exactly at the cap from
 * rounding up over it.
 */
export function estimateTokens(context: RouteContext, ratio: number): number {
  return Math.ceil(requestChars(context) / ratio - 1e-9);
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

/** The ledger ids the cap never sheds beyond the floor, fixed once from the world as built. */
export interface CausalSet {
  /** Memory ids: the newest memory, and the evidence behind the demand opening shown first. */
  readonly memories: ReadonlySet<EventId>;
  /** Prayer ids: the one prayer the god can answer, beyond those a live practice names. */
  readonly prayers: ReadonlySet<EventId>;
}

/**
 * What a turn's cap keeps besides the floor, so that what the god just learned, the bargain it is shown first
 * and one prayer it can answer all survive:
 * - the newest memory;
 * - the memory (or the prayer, for harm a prayer told of) that the demand opening shown first rests on, only
 *   that one and not every cause available;
 * - one prayer with its choices: the prayer the first offer opening names, else the first prayer shown with an
 *   offer, else the newest prayer with any answer.
 * It is read from the unshed world once. Shedding re-derives the practice options from survivors, and what
 * that derives later is never added here.
 */
export function causalSet(input: CapInput): CausalSet {
  const { remembered, state } = input;
  const memories = new Set<EventId>();
  const prayers = new Set<EventId>();
  const shownPrayer = new Set(remembered.petitions.map((p) => p.id));

  const newest = [...remembered.memories].sort(
    (a, b) => b.recordedAt - a.recordedAt || (a.id < b.id ? -1 : 1),
  )[0];
  if (newest !== undefined) memories.add(newest.id);

  const first = remembered.practice.openings[0];
  if (first?.kind === "demand") {
    const evidence = remembered.practice.causes.find(
      (cause) => cause.id === first.intent.cause,
    )?.memoryId;
    if (evidence !== undefined) {
      if (remembered.memories.some((memory) => memory.id === evidence)) {
        memories.add(evidence);
      } else if (shownPrayer.has(evidence)) {
        prayers.add(evidence);
      }
    }
  }

  const named = remembered.practice.openings.find(
    (opening) => typeof opening.intent.prayer === "string",
  )?.intent.prayer;
  const offered = remembered.petitions.find(
    (petition) => petition.offer !== undefined,
  )?.id;
  const answerable = [...remembered.petitions]
    .filter(
      (petition) =>
        petition.bless !== undefined ||
        petition.offer !== undefined ||
        petition.redress !== undefined ||
        petition.strikeMortal !== undefined ||
        petition.strikeBuildings !== undefined ||
        petition.refuse !== undefined,
    )
    .sort(
      (a, b) =>
        (state.petitions.get(b.id)?.sequence ?? 0) -
          (state.petitions.get(a.id)?.sequence ?? 0) || (a.id < b.id ? -1 : 1),
    )[0]?.id;
  const keep = [named, offered, answerable].find(
    (id): id is EventId => id !== undefined && shownPrayer.has(id as EventId),
  );
  if (keep !== undefined) prayers.add(keep);
  return { memories, prayers };
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
 * Tier 3: the least salient memory outside the causal set (the oldest among equals), with its goal-history row,
 * and everything derived from it; once none is left, the weakest feeling.
 */
function withoutMemory(
  { snapshot, remembered }: Pair,
  input: CapInput,
  causal: CausalSet,
): Pair | undefined {
  const gone = remembered.memories
    .filter((memory) => !causal.memories.has(memory.id))
    .sort((a, b) => a.salience - b.salience || a.recordedAt - b.recordedAt)[0];
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

/** Tier 4: the oldest prayer no live practice names and the causal set does not keep. Prayers are held protected first, then newest first. */
function withoutPrayer(
  { snapshot, remembered }: Pair,
  input: CapInput,
  causal: CausalSet,
): Pair | undefined {
  const live = protectedPrayers(input.state, input.actorId);
  const at = remembered.petitions
    .map((petition) => live.has(petition.id) || causal.prayers.has(petition.id))
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
  (pair: Pair, input: CapInput, causal: CausalSet) => Pair | undefined,
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
 * the god's own obligations, every prayer a live practice names, and the causal set (`causalSet`), fixed from
 * the world as built. The loop ends after at most one rebuild per unit, and asks no model.
 */
export function shedToCap(
  input: CapInput,
  causal: CausalSet = causalSet(input),
): Capped {
  let pair: Pair = { snapshot: input.snapshot, remembered: input.remembered };
  let context = buildGodContext(input.profile, pair.snapshot, pair.remembered);
  const shed = { events: 0, actions: 0, memories: 0, prayers: 0 };
  for (const [tier, next] of TIERS) {
    while (!fitsCap(context, input.ratio)) {
      const reduced = next(pair, input, causal);
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

// --- Refilling -----------------------------------------------------------------------------------

/** A shed unit that may come back, and how to put it back into a pair. */
interface Candidate {
  readonly tier: "memories" | "actions" | "events";
  readonly add: (pair: Pair) => Pair;
}

/** `kept` of `all`, in the order of `all`. */
const inOrder = <T>(all: readonly T[], kept: ReadonlySet<T>): T[] =>
  all.filter((item) => kept.has(item));

/**
 * What a god's prompt loses to the cap and may get back, most valuable first: memories (the most salient,
 * then the newest among equals), then feelings (the strongest), then its own actions (the newest), then recent
 * events (the newest). Prayers are not among them. Each candidate adds one unit to a pair and derives everything
 * from it again, the way shedding does, so that a unit brought back is cited, offered and parsed like one never shed.
 */
function refillCandidates(
  original: Pair,
  shedPair: Pair,
  input: CapInput,
): Candidate[] {
  const was = original.remembered;
  const now = shedPair.remembered;
  const have = new Set(now.memories);
  const haveFeelings = new Set(now.relationships);
  const haveActions = new Set(now.ownActions);
  const haveEvents = new Set(shedPair.snapshot.events);
  const goalHistoryOf = (
    memories: readonly { readonly id: string }[],
    actions: readonly { readonly id: string }[],
  ) =>
    was.goalHistory.filter((entry) =>
      entry.kind === "memory"
        ? memories.some((memory) => memory.id === entry.memory.id)
        : actions.some((action) => action.id === entry.event.id),
    );

  const memories = was.memories
    .filter((memory) => !have.has(memory))
    .sort((a, b) => b.salience - a.salience || b.recordedAt - a.recordedAt)
    .map(
      (memory): Candidate => ({
        tier: "memories",
        add: ({ snapshot, remembered }) => {
          const kept = inOrder(
            was.memories,
            new Set([...remembered.memories, memory]),
          );
          return {
            snapshot,
            remembered: rederive(input, {
              ...remembered,
              memories: kept,
              goalHistory: goalHistoryOf(kept, remembered.ownActions),
            }),
          };
        },
      }),
    );
  // `rememberedBy` keeps feelings strongest first, and shedding takes them from the end.
  const feelings = was.relationships
    .filter((feeling) => !haveFeelings.has(feeling))
    .map(
      (feeling): Candidate => ({
        tier: "memories",
        add: ({ snapshot, remembered }) => ({
          snapshot,
          remembered: {
            ...remembered,
            relationships: inOrder(
              was.relationships,
              new Set([...remembered.relationships, feeling]),
            ),
          },
        }),
      }),
    );
  const actions = was.ownActions
    .filter((action) => !haveActions.has(action))
    .reverse()
    .map(
      (action): Candidate => ({
        tier: "actions",
        add: ({ snapshot, remembered }) => {
          const kept = inOrder(
            was.ownActions,
            new Set([...remembered.ownActions, action]),
          );
          return {
            snapshot,
            remembered: {
              ...remembered,
              ownActions: kept,
              goalHistory: goalHistoryOf(remembered.memories, kept),
            },
          };
        },
      }),
    );
  const events = original.snapshot.events
    .filter((event) => !haveEvents.has(event))
    .reverse()
    .map(
      (event): Candidate => ({
        tier: "events",
        add: ({ snapshot, remembered }) => ({
          snapshot: {
            ...snapshot,
            events: inOrder(
              original.snapshot.events,
              new Set([...snapshot.events, event]),
            ),
          },
          remembered,
        }),
      }),
    );
  return [...memories, ...feelings, ...actions, ...events];
}

/**
 * `shedToCap`, then a refill: the shed order says what goes first, so once the request fits, what went
 * earlier than the last resort may come back where room is left. Each shed unit is tried once, most
 * valuable first (`refillCandidates`); one is kept only if the rebuilt request still fits, and dropped again otherwise. A prayer is never brought back. The shed counts are the net:
 * what stayed out.
 */
export function fitToCap(input: CapInput): Capped {
  const shedOnly = shedToCap(input, causalSet(input));
  if (!shedOnly.fits || Object.values(shedOnly.shed).every((n) => n === 0)) {
    return shedOnly;
  }
  const original: Pair = {
    snapshot: input.snapshot,
    remembered: input.remembered,
  };
  let pair: Pair = {
    snapshot: shedOnly.snapshot,
    remembered: shedOnly.remembered,
  };
  let context = shedOnly.context;
  const shed = { ...shedOnly.shed };
  for (const candidate of refillCandidates(original, pair, input)) {
    const trial = candidate.add(pair);
    const trialContext = buildGodContext(
      input.profile,
      trial.snapshot,
      trial.remembered,
    );
    if (!fitsCap(trialContext, input.ratio)) continue;
    pair = trial;
    context = trialContext;
    shed[candidate.tier] -= 1;
  }
  return {
    ...pair,
    context,
    estimatedTokens: estimateTokens(context, input.ratio),
    ratio: input.ratio,
    shed,
    fits: true,
  };
}

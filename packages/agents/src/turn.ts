// One god's turn: snapshot what it perceives, add what it remembers, ask the
// model through the router, and let the trusted builder turn the parsed intent
// into an observation and proposal. It reads committed state and awaits the
// model; it never writes anything and never runs inside a world transaction.
// Journaling the result, and recording the request in the trace, belong to the
// caller (apps/simulation), which owns the store.

import type { GodProfile } from "@panthea/content";
import type {
  EntityId,
  GoalChangeRefusedEvent,
  JourneyEndedEvent,
  ObservationRecord,
  PracticeRefusedEvent,
  Proposal,
  WorldEvent,
} from "@panthea/contracts";
import { perceive, type WorldState } from "@panthea/world";
import {
  buildGodContext,
  godIntentSchema,
  type ParsedGodIntent,
  rememberedBy,
} from "./context";
import { buildModelProposal } from "./observation";
import type { RouteResult, Router } from "./router";

type IntentRoute = Extract<RouteResult<ParsedGodIntent>, { kind: "intent" }>;
type ExhaustedRoute = Extract<
  RouteResult<ParsedGodIntent>,
  { kind: "exhausted" }
>;

/** The model request a turn made, in the shape the causal trace records (`recordModelRequest`). */
export interface AnsweredRequest {
  readonly role: string;
  readonly route: IntentRoute;
  /** What the model was shown. */
  readonly prompt: string;
  /** The parsed intent, as JSON. */
  readonly output: string;
}

export interface ExhaustedRequest {
  readonly role: string;
  readonly route: ExhaustedRoute;
  readonly prompt: string;
}

/** How a turn ended. A `proposal` is the only outcome that changes anything. */
export type GodTurnResult =
  | {
      readonly kind: "proposal";
      readonly observation: ObservationRecord;
      readonly proposal: Proposal;
      readonly request: AnsweredRequest;
    }
  /** The god chose to do nothing. */
  | { readonly kind: "wait"; readonly request: AnsweredRequest }
  /** No endpoint gave a valid intent. */
  | { readonly kind: "exhausted"; readonly request: ExhaustedRequest };

export interface GodTurnDeps {
  readonly router: Router;
  readonly profiles: ReadonlyMap<EntityId, GodProfile>;
}

/**
 * Runs `actorId`'s turn against `state`, the last committed state, with
 * `recentEvents` as the window perception places events in. Returns
 * `undefined`, asking no model, when the actor is unknown or dead or has no
 * profile. The role the router routes is the actor's id.
 */
export async function runGodTurn(
  deps: GodTurnDeps,
  turn: {
    readonly state: WorldState;
    readonly actorId: EntityId;
    readonly recentEvents?: readonly WorldEvent[];
    /** The events this god's own actions committed, newest few: what it is shown it did. */
    readonly ownEvents?: readonly WorldEvent[];
    /** The god's latest refused goal change, if any: what it is told when it asks to change its goal too soon. */
    readonly refusal?: GoalChangeRefusedEvent;
    /** The god's latest refused practice move, if no move of its own has committed since: what its digest says about it. */
    readonly practiceRefusal?: PracticeRefusedEvent;
    /** The god's latest journey ending, if any: what its prompt says about how its last journey ended. */
    readonly journeyEnding?: JourneyEndedEvent;
    readonly signal?: AbortSignal;
  },
): Promise<GodTurnResult | undefined> {
  const profile = deps.profiles.get(turn.actorId);
  const snapshot = perceive(turn.state, turn.actorId, turn.recentEvents);
  if (!profile || !snapshot) return undefined;

  const remembered = rememberedBy(
    turn.state,
    turn.actorId,
    turn.ownEvents,
    turn.refusal,
    turn.practiceRefusal,
    turn.journeyEnding,
  );
  const context = buildGodContext(profile, snapshot, remembered);
  const prompt = `${context.instructions}\n\n${context.prompt}`;
  const role = turn.actorId as string;

  const route = await deps.router.route(
    role,
    context,
    godIntentSchema(profile, snapshot, remembered),
    turn.signal === undefined ? undefined : { signal: turn.signal },
  );
  if (route.kind === "exhausted") {
    return { kind: "exhausted", request: { role, route, prompt } };
  }

  const request: AnsweredRequest = {
    role,
    route,
    prompt,
    output: JSON.stringify(route.intent),
  };
  const built = buildModelProposal(
    turn.actorId,
    snapshot,
    route.intent,
    remembered,
  );
  // The intent was parsed against this very snapshot, so its targets are in it
  // and the builder has nothing to refuse.
  if (!built.ok) {
    throw new Error(`invariant breach: ${built.message}`);
  }
  if (built.kind === "wait") return { kind: "wait", request };
  return {
    kind: "proposal",
    observation: built.observation,
    proposal: built.proposal,
    request,
  };
}

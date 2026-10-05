// S4 to S8: the causal story. Zeus, sent by scripted travel turns, strikes the
// farmer's tavern while the farmer watches; Hera, on Olympus, never sees it
// and her prompts carry no trace of it; Zeus returns and tells her an
// exaggerated account with a claim; her belief changes how she feels about him,
// with the belief as cause; her next proposal shows it; and the tavern's
// destruction traces to the strike's observation, request, and proposal.

import type { MemoryEntry } from "@panthea/world";
import { toEntityId, type WorldState } from "@panthea/world";
import {
  traceEvent,
  waitForTicks,
} from "../../../m1-living-world/src/steps/api";
import { eventsOf } from "../../../m1-living-world/src/steps/direct";
import {
  explainChain,
  type StoredEvent,
  tracesIn,
  withoutPrayers,
} from "../checks";
import { WAIT } from "../provider";

/** Every stored event's full payload, oldest first. */
const storedEvents = (story: Story): StoredEvent[] =>
  eventsOf(story).map((event) => event.payload as StoredEvent);

import type { Recorder, Story } from "./context";
import {
  check,
  driveGod,
  lastInputOrder,
  postFixture,
  stateOf,
  waitFor,
  waitForConsumed,
  waitForModelProposal,
  walk,
} from "./support";

const id = toEntityId;

/** What the strike step hands on. */
export interface Strike {
  readonly proposalId: string;
  readonly observationId: string;
  readonly ignitionId: string;
  /** Provider request index when the strike committed: prompts after it are "after the strike". */
  readonly requestMark: number;
}

export interface Report {
  readonly proposalId: string;
  readonly observationId: string;
  readonly eventId: string;
  readonly memoryEventId: string;
  readonly changeEventId: string;
  readonly content: string;
}

const memoriesOf = (state: WorldState, actor: string): readonly MemoryEntry[] =>
  state.memories.get(id(actor)) ?? [];

const witnessed = (
  state: WorldState,
  actor: string,
  sourceEventId: string,
): MemoryEntry | undefined =>
  memoriesOf(state, actor).find(
    (memory) =>
      memory.kind === "witnessed" && memory.sourceEventId === sourceEventId,
  );

const eventOfKind = (
  events: readonly StoredEvent[],
  kind: string,
  where: (event: StoredEvent) => boolean = () => true,
): StoredEvent | undefined =>
  events.find((event) => event.kind === kind && where(event));

export async function stepStrike(
  recorder: Recorder,
  story: Story,
): Promise<Strike> {
  return recorder.run(
    "S4",
    "Zeus strikes the tavern; witnesses remember",
    "Zeus, sent by a scripted travel turn from Olympus to the tavern, strikes the farmer's tavern through a model proposal; the ignition records the strike and Zeus; exactly the two present, Zeus and the farmer, remember it, each citing the ignition event, with the harm attributed to Zeus and the farmer as its target; Hera and the woodcutter, elsewhere, do not; the farmer now holds a grudge.",
    async (step) => {
      await walk(story, "zeus", "tavern");
      // Stage the strike so the farmer is at the tavern when it lands, without
      // racing the farmer's own routine (it walks to the altar when it has
      // something to pray about). Zeus's reply is a function of what he is shown:
      // he strikes only once his prompt lists the farmer here at the tavern. The
      // farmer's fixture move displaces its routine for that tick, Zeus's next
      // turn is taken with the farmer present, and his strike is journaled and
      // runs on the following tick before any routine can move the farmer.
      let struck = false;
      const afterStrikeOrder = lastInputOrder(story);
      story.provider.policy("zeus", (seen) => {
        const here =
          seen.prompt.split("Here with you:")[1]?.split("Buildings here:")[0] ??
          "";
        if (
          struck ||
          !here.includes("- farmer") ||
          !seen.prompt.includes("The Tavern")
        ) {
          return WAIT;
        }
        struck = true;
        return JSON.stringify({
          action: "strike",
          target: "the-tavern",
          power: 3,
        });
      });
      await postFixture(
        story,
        "farmer",
        { kind: "move", to: "tavern" },
        "the farmer goes to the tavern",
      );
      const journaled = await waitForModelProposal(
        story,
        "zeus",
        "strike",
        afterStrikeOrder,
        "zeus strikes once his prompt shows the farmer at the tavern",
      );
      story.provider.policy("zeus", undefined);
      const row = await waitForConsumed(
        story,
        journaled.proposalId,
        "zeus's strike runs on a tick",
      );
      check(
        row.outcome === "committed",
        "zeus strikes the tavern: it commits",
        `${row.outcome} ${row.reason}`,
      );
      const observationId = String(row.proposal.observationId);
      const events = storedEvents(story);
      const ignition = eventOfKind(
        events,
        "building-ignited",
        (event) =>
          event.entityId === "the-tavern" &&
          (event as { correlationId?: string }).correlationId === observationId,
      );
      check(
        ignition !== undefined,
        "the strike ignited the tavern",
        events
          .map((e) => e.kind)
          .join()
          .slice(-200),
      );
      check(
        JSON.stringify(ignition.cause) ===
          JSON.stringify({ kind: "strike", actor: "zeus" }),
        "the ignition records the strike and Zeus as its cause",
        JSON.stringify(ignition.cause),
      );
      const ignitionId = ignition.id;

      const state = await waitFor(
        "Zeus and the farmer remember the ignition in the committed state",
        async () => {
          const current = await stateOf(story);
          return witnessed(current, "zeus", ignitionId) &&
            witnessed(current, "farmer", ignitionId)
            ? current
            : undefined;
        },
        { timeoutMs: 10_000, intervalMs: 100 },
      );
      for (const witness of ["zeus", "farmer"]) {
        const memory = witnessed(state, witness, ignitionId);
        check(
          memory?.kind === "witnessed" &&
            memory.eventKind === "building-ignited" &&
            JSON.stringify(memory.consequence) ===
              JSON.stringify({
                effect: "harm",
                agent: "zeus",
                target: "farmer",
              }),
          `${witness} remembers the ignition, citing it, with the harm attributed to Zeus and aimed at the farmer`,
          JSON.stringify(memory),
        );
      }
      check(
        witnessed(state, "hera", ignitionId) === undefined &&
          witnessed(state, "woodcutter", ignitionId) === undefined,
        "Hera (on Olympus) and the woodcutter (in the square) do not remember it",
        "a witness memory exists",
      );
      const memoryEvents = storedEvents(story).filter(
        (event) =>
          event.kind === "memory-recorded" &&
          event.sourceEventId === ignitionId,
      );
      check(
        memoryEvents
          .map((event) => String(event.entityId))
          .sort()
          .join() === "farmer,zeus",
        "exactly the two present formed a memory of the ignition",
        memoryEvents.map((e) => e.entityId).join(),
      );
      const farmerFeeling = state.relationships.get("farmer>zeus");
      check(
        farmerFeeling?.affinity === -2 && farmerFeeling.grudge === 1,
        "the farmer, whose tavern it was, feels wronged: affinity -2 and a grudge",
        JSON.stringify(farmerFeeling),
      );
      check(
        state.relationships.get("hera>zeus") === undefined,
        "Hera has no feeling about Zeus yet",
        JSON.stringify(state.relationships.get("hera>zeus")),
      );
      const shown = story.provider.requests.find(
        (r) => r.god === "zeus" && r.reply?.includes('"strike"'),
      );
      check(
        shown?.prompt.includes("The Tavern") === true,
        "the prompt that produced the strike showed Zeus the tavern",
        shown?.prompt.slice(0, 120) ?? "no strike request",
      );
      step.done(
        `zeus struck from the tavern (proposal ${row.proposalId}); ignition ${ignitionId} cites the strike; witnesses ${memoryEvents
          .map((e) => e.entityId)
          .sort()
          .join(
            " and ",
          )}; the farmer's feeling toward Zeus: affinity ${farmerFeeling?.affinity}, grudge ${farmerFeeling?.grudge}`,
      );
      return {
        proposalId: row.proposalId,
        observationId,
        ignitionId,
        requestMark: story.provider.requests.length,
      };
    },
  );
}

export async function stepIsolation(
  recorder: Recorder,
  story: Story,
  strike: Strike,
): Promise<{ readonly destroyedId: string }> {
  return recorder.run(
    "S5",
    "Knowledge isolation",
    "Through the strike and the tavern's destruction, none of Hera's prompts carries any trace of it outside a prayer addressed to her: not the ignition or destruction event, not the strike's observation, not the tavern; the farmer's own prayer about the burning, if it is addressed to her, is how she may hear of it (R7, W04's divine sense), and is the one place it may appear; Zeus's own prompts after it do carry the ignition.",
    async (step) => {
      const destroyed = await waitFor(
        "the tavern burns down",
        () =>
          eventOfKind(
            storedEvents(story),
            "building-destroyed",
            (event) => event.entityId === "the-tavern",
          ),
        { timeoutMs: 30_000, intervalMs: 200 },
      );
      // Let Hera take several turns after the strike, the last after the destruction.
      await waitFor(
        "Hera takes at least three turns after the strike",
        () =>
          story.provider.requests
            .slice(strike.requestMark)
            .filter((r) => r.god === "hera").length >= 3
            ? true
            : undefined,
        { timeoutMs: 30_000 },
      );
      const traces = [
        strike.ignitionId,
        destroyed.id,
        strike.observationId,
        "the-tavern",
        "building-ignited",
        "building-destroyed",
      ];
      const heraPrompts = story.provider.requests
        .slice(strike.requestMark)
        .filter((r) => r.god === "hera")
        .map((r) => withoutPrayers(r.prompt));
      check(
        heraPrompts.length >= 3,
        "Hera took several turns through the strike and its aftermath",
        `${heraPrompts.length} prompts`,
      );
      if (story.options.control === "isolation") {
        // Positive control: the strike leaks into Hera's context.
        const last = heraPrompts.length - 1;
        heraPrompts[last] =
          `${heraPrompts[last]}\n- You saw [${strike.ignitionId}] building-ignited (the-tavern)`;
      }
      const leaked = heraPrompts.flatMap((prompt) => tracesIn(prompt, traces));
      check(
        leaked.length === 0,
        "no prompt Hera was shown carries a trace of the strike outside a prayer addressed to her",
        `found ${leaked.join(", ")}`,
      );
      // Control in the run: the same check does see the ignition in a prompt Zeus was shown at the tavern.
      const zeusSaw = story.provider.requests
        .slice(strike.requestMark)
        .filter((r) => r.god === "zeus")
        .some((r) => tracesIn(r.prompt, [strike.ignitionId]).length > 0);
      check(
        zeusSaw,
        "Zeus's own prompts after the strike do carry the ignition (the check can see a trace)",
        "none did",
      );
      step.done(
        `${heraPrompts.length} of Hera's prompts through the strike and destruction (${destroyed.id}) carry none of ${traces.length} traces; Zeus's prompts after the strike carry the ignition`,
        [
          {
            name: "hera prompts checked",
            unit: "prompts",
            value: heraPrompts.length,
          },
        ],
      );
      return { destroyedId: destroyed.id };
    },
  );
}

const EXAGGERATION =
  "I burned the whole agora to ashes, and I would do it again.";

export async function stepReport(
  recorder: Recorder,
  story: Story,
  strike: Strike,
): Promise<Report> {
  return recorder.run(
    "S6",
    "Zeus tells Hera; her feeling changes, with the belief as cause",
    "Zeus travels back to Olympus and, through a model proposal citing the ignition he witnessed, tells Hera an exaggerated account with a claim; Hera's belief is attributed to Zeus, stores his words as told (they differ from what happened), and shifts her affinity toward Zeus by exactly one relationship-changed event that cites that belief; no legend is recorded.",
    async (step) => {
      await walk(story, "zeus", "great-hall");
      const legendsBefore = (await stateOf(story)).legends.size;
      const claim =
        story.options.control === "chain"
          ? undefined
          : { effect: "harm", agent: "zeus" };
      const row = await driveGod(
        story,
        "zeus",
        "report",
        () =>
          JSON.stringify({
            action: "report",
            listener: "hera",
            content: EXAGGERATION,
            ...(claim ? { claim } : {}),
            linkedEventId: strike.ignitionId,
          }),
        "zeus tells hera",
      );
      const observationId = String(row.proposal.observationId);
      const events = storedEvents(story);
      const told = events.find(
        (event) =>
          event.kind === "report-told" && event.correlationId === observationId,
      );
      check(
        told?.entityId === "zeus" &&
          told.listenerId === "hera" &&
          told.content === EXAGGERATION &&
          told.linkedEventId === strike.ignitionId,
        "the report is recorded: Zeus to Hera, his words, citing the ignition he witnessed",
        JSON.stringify(told),
      );
      const belief = events.find(
        (event) =>
          event.kind === "memory-recorded" &&
          event.entityId === "hera" &&
          event.sourceEventId === told?.id,
      );
      check(
        belief?.memoryKind === "told" &&
          belief.teller === "zeus" &&
          belief.content === EXAGGERATION &&
          belief.linkedEventId === strike.ignitionId,
        "Hera holds a belief attributed to Zeus, his words stored as told",
        JSON.stringify(belief),
      );
      const ignition = events.find((event) => event.id === strike.ignitionId);
      check(
        EXAGGERATION.includes("agora") &&
          ignition?.entityId === "the-tavern" &&
          !JSON.stringify(ignition).includes("agora"),
        "what Zeus told is not what happened: the agora, not the tavern",
        JSON.stringify(ignition),
      );
      check(
        belief.correlationId === observationId ||
          belief.sourceEventId === told.id,
        "the belief rests on the report event",
        String(belief.sourceEventId),
      );
      const change = events.find(
        (event) =>
          event.kind === "relationship-changed" &&
          event.entityId === "hera" &&
          event.memoryEventId === belief.id,
      );
      check(
        change !== undefined,
        "Hera's belief changed her relationship: a relationship-changed event cites it",
        "none found: the report carried no claim, so it taught her nothing to feel",
      );
      check(
        change.toward === "zeus" &&
          change.affinityDelta === -1 &&
          change.grudgeDelta === 0,
        "the change is Hera toward Zeus: affinity -1, no grudge",
        JSON.stringify(change),
      );
      const state = await stateOf(story);
      const feeling = state.relationships.get("hera>zeus");
      check(
        feeling?.affinity === -1 && feeling.grudge === 0,
        "the committed state holds that feeling",
        JSON.stringify(feeling),
      );
      check(
        state.legends.size === legendsBefore,
        "the belief is not a legend: no legend was recorded",
        `${legendsBefore} -> ${state.legends.size}`,
      );
      const chain = explainChain(storedEvents(story), change.id);
      check(
        chain.join() ===
          "building-ignited,report-told,memory-recorded,relationship-changed",
        "the change explains itself from the events: ignition, report, belief, change",
        chain.join(),
      );
      step.done(
        `zeus told hera "${EXAGGERATION}" citing ${strike.ignitionId}; her belief ${belief.id} is attributed to zeus; relationship-changed ${change.id} (affinity -1) cites it; chain ${chain.join(" > ")}`,
      );
      return {
        proposalId: row.proposalId,
        observationId,
        eventId: told.id,
        memoryEventId: belief.id,
        changeEventId: change.id,
        content: EXAGGERATION,
      };
    },
  );
}

/** Hera's policy: a pure function of what she is shown. Told something about Zeus and feeling worse about him, she tells him what she holds against him; otherwise she waits. */
export function heraPolicy(): (seen: { readonly prompt: string }) => string {
  let spoken = false;
  return (seen) => {
    if (spoken) return WAIT;
    const told = /- zeus told you: "[^"]*" \(claiming (\S+) harmed /.exec(
      seen.prompt,
    );
    const feels = /- zeus: affinity -\d+/.test(seen.prompt);
    if (!told || !feels) return WAIT;
    spoken = true;
    return JSON.stringify({
      action: "report",
      listener: "zeus",
      content: "You told me of your fire. I hold it against you.",
      claim: { effect: "harm", agent: told[1] },
    });
  };
}

export async function stepHera(
  recorder: Recorder,
  story: Story,
  report: Report,
): Promise<void> {
  await recorder.run(
    "S7",
    "Hera's next proposal reflects it",
    "Hera, shown her belief and her feeling toward Zeus in her prompt, answers with a proposal she did not make before: a report to Zeus whose claim names the agent her belief names; the turn before, with no belief in her prompt, she waited; the proposal commits, and its request is in the trace.",
    async (step) => {
      const row = await waitForModelProposal(
        story,
        "hera",
        "report",
        0,
        "Hera's next proposal is a report",
        30_000,
      );
      const consumed = await waitForConsumed(
        story,
        row.proposalId,
        "Hera's report runs on a tick",
      );
      check(
        consumed.outcome === "committed",
        "it commits",
        `${consumed.outcome} ${consumed.reason}`,
      );
      check(
        row.proposal.listener === "zeus" &&
          (row.proposal.claim as { agent?: string } | undefined)?.agent ===
            "zeus" &&
          !("linkedEventId" in row.proposal),
        "it names Zeus as listener and as the claim's agent, and cites nothing (she saw nothing)",
        JSON.stringify(row.proposal),
      );
      const answered = story.provider.requests.find(
        (r) => r.god === "hera" && r.reply?.includes('"report"'),
      );
      check(
        answered?.prompt.includes(`zeus told you: "${report.content}"`) ===
          true && /- zeus: affinity -1/.test(answered.prompt),
        "the prompt behind it showed her the belief, attributed to Zeus, and the feeling",
        answered?.prompt.slice(-400) ?? "no request",
      );
      const before = story.provider.requests
        .slice(0, answered?.n)
        .filter((r) => r.god === "hera")
        .at(-1);
      check(
        before?.reply === WAIT && !before.prompt.includes(report.content),
        "the turn before, with no belief about the strike in her prompt, she waited",
        `${before?.reply}`,
      );
      const zeusHeard = (await stateOf(story)).memories
        .get(toEntityId("zeus"))
        ?.find((m) => m.kind === "told" && m.teller === "hera");
      check(
        zeusHeard !== undefined,
        "Zeus, the listener, now holds a belief attributed to Hera",
        "none",
      );
      const requests = storedEvents(story).find(
        (event) => event.id === report.changeEventId,
      );
      check(requests !== undefined, "the change is still in the log", "gone");
      step.done(
        `hera waited (request ${before?.n}) without the belief and answered request ${answered?.n} with a report to zeus (claim agent zeus, no citation); zeus holds a belief attributed to hera`,
      );
    },
  );
}

export async function stepTrace(
  recorder: Recorder,
  story: Story,
  strike: Strike,
  destroyedId: string,
): Promise<void> {
  await recorder.run(
    "S8",
    "Destruction traces to the strike",
    "Following the tavern's destruction in the trace walks back through its ignition to the strike's proposal, model request, and observation; the destruction cites the ignition event.",
    async (step) => {
      const events = storedEvents(story);
      const traced =
        story.options.control === "trace"
          ? // Positive control: follow an event no strike caused (the farmer's fixture move).
            (events.find(
              (event) =>
                event.kind === "entity-moved" && event.entityId === "farmer",
            )?.id ?? destroyedId)
          : destroyedId;
      const chain = await traceEvent(story, traced);
      const steps = chain.steps.map((entry) => entry.step);
      check(
        steps[0] === "observation" &&
          steps[1] === "model-request" &&
          steps[2] === "proposal" &&
          steps[3] === "validation",
        "the trace starts with the strike's observation, model request, proposal, and validation",
        steps.join(" > "),
      );
      const observation = chain.steps[0];
      const request = chain.steps[1];
      const proposal = chain.steps[2];
      check(
        observation?.step === "observation" &&
          observation.record.observer === "zeus" &&
          observation.record.source === "model" &&
          String(observation.record.id) === strike.observationId,
        "the observation is Zeus's own, source model, the strike's",
        JSON.stringify(observation),
      );
      check(
        request?.step === "model-request" && request.request.role === "zeus",
        "the model request is Zeus's",
        JSON.stringify(request),
      );
      check(
        proposal?.step === "proposal" &&
          proposal.proposalId === strike.proposalId,
        "the proposal is the strike's",
        JSON.stringify(proposal),
      );
      const eventIds = chain.steps.flatMap((entry) =>
        entry.step === "event" ? [entry.eventId] : [],
      );
      check(
        eventIds[0] === strike.ignitionId && eventIds.at(-1) === destroyedId,
        "the events run from the ignition to the destruction",
        eventIds.join(" > "),
      );
      const destroyed = events.find((event) => event.id === destroyedId);
      check(
        destroyed?.cause === strike.ignitionId,
        "the destruction cites the ignition as its cause",
        String(destroyed?.cause),
      );
      step.done(
        `destruction ${destroyedId}: ${steps.join(" > ")}; ignition ${strike.ignitionId} is the strike ${strike.proposalId}'s event`,
      );
    },
  );
}

/** Ticks to let a step settle without deciding a result by them. */
export const settle = (story: Story, ticks: number) =>
  waitForTicks(story, ticks, "the world settles");

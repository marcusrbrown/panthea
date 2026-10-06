// S16: supplication through the compiled sidecar. Two mortals have prayed; a
// god answers each by offering terms (its boon for one offering by the mortal),
// the mortal's routine takes them by drive and means, the god gives the boon,
// and the world judges both halves. One mortal keeps its terms and the thread
// is fulfilled. The other takes the boon and does not offer: the thread is
// breached, and the stake the god chose turns it into a wolf, with its memory,
// feelings, and identity kept.
//
// The scripted part is the gods' choices; the mortals decide for themselves.

import {
  nextHop,
  type Petition,
  type PracticeThread,
  toEntityId,
} from "@panthea/world";
import type { God } from "../provider";
import type { Recorder, Story } from "./context";
import {
  eventsOfKind,
  godMoves,
  storedEvents,
  threadAfter,
  threadEnded,
  threadNow,
  threadsOf,
  walkTo,
} from "./practice";
import { check, postFixture, stateOf, waitFor } from "./support";

const id = toEntityId;

/** What S16 hands on: the two supplication threads. */
export interface Supplications {
  readonly keptId: string;
  readonly brokenId: string;
}

/** Open help petitions, newest last. */
async function openHelp(story: Story): Promise<Petition[]> {
  const state = await stateOf(story);
  return [...state.petitions.values()].filter(
    (petition) =>
      petition.status === "open" &&
      petition.request.kind === "help" &&
      state.actors.get(petition.god)?.alive === true &&
      state.actors.get(petition.petitioner)?.alive === true,
  );
}

/** The offer a god makes on a prayer: one offering by the one who prayed, to the god. */
const offerOn = (
  petition: Petition,
  amount: number,
  ticks: number,
  stake?: string,
  resource = "currency",
) =>
  JSON.stringify({
    action: "practice",
    move: "offer",
    prayer: petition.id,
    term: {
      kind: "make-offering",
      party: petition.petitioner,
      to: petition.god,
      resource,
      amount,
      deadlineTicks: ticks,
    },
    ...(stake === undefined ? {} : { stake }),
  });

/**
 * The god stands with the mortal and blesses it; returns the blessing's event id.
 * A mortal of the town is on the road to the altar and back often, and a god takes
 * a turn once in seven, so the god goes to where the mortal stands now and tries
 * again when the mortal has moved on by the god's turn.
 */
async function giveBoon(
  story: Story,
  petition: Petition,
  why: string,
): Promise<string> {
  const god = petition.god as God;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const state = await stateOf(story);
    const mortal = state.actors.get(petition.petitioner);
    check(mortal !== undefined, `${petition.petitioner} is somewhere`, "gone");
    await walkTo(story, god, mortal.locationId);
    try {
      await waitFor(
        `${petition.petitioner} is where ${god} stands`,
        async () => {
          const now = await stateOf(story);
          return now.actors.get(petition.petitioner)?.locationId ===
            now.actors.get(id(god))?.locationId
            ? true
            : undefined;
        },
        { timeoutMs: 60_000, intervalMs: 200 },
      );
      const row = await godMoves(
        story,
        god,
        JSON.stringify({ action: "bless", petition: petition.id }),
        why,
      );
      const blessing = eventsOfKind(
        story,
        "blessing-granted",
        (e) => e.correlationId === String(row.proposal.observationId),
      )[0];
      check(blessing !== undefined, `${why}: a blessing is recorded`, "none");
      return blessing.id;
    } catch (error) {
      if (attempt === 5) throw error;
    }
  }
  throw new Error(`${why}: no blessing`);
}

/** The god offers terms and the mortal's own routine takes them. */
async function offerTerms(
  story: Story,
  petition: Petition,
  amount: number,
  ticks: number,
  stake?: string,
  resource = "currency",
): Promise<PracticeThread> {
  const earlier = threadsOf(await stateOf(story)).map((t) => t.id as string);
  await godMoves(
    story,
    petition.god as God,
    offerOn(petition, amount, ticks, stake, resource),
    `${petition.god} offers ${petition.petitioner} terms`,
  );
  const thread = await threadAfter(story, earlier, "the offer opens a thread");
  check(
    thread.practice === "supplication" &&
      thread.petition === petition.id &&
      thread.demander === petition.god &&
      thread.obligated === petition.petitioner &&
      thread.status === "open" &&
      thread.counterBudgetLeft === 0 &&
      thread.term.kind === "make-offering" &&
      thread.term.party === petition.petitioner &&
      thread.term.to === petition.god,
    "the offer opens a supplication thread on the prayer: the god's boon for one offering by the one who prayed, no counteroffers",
    JSON.stringify(thread),
  );
  const accepted = await waitFor(
    `${petition.petitioner}'s routine answers the terms`,
    async () => {
      const now = await threadNow(story, thread.id);
      return now.status === "open" ? undefined : now;
    },
    { timeoutMs: 30_000, intervalMs: 200 },
  );
  check(
    accepted.status === "accepted",
    `${petition.petitioner} accepts, by its drive and its means`,
    accepted.status,
  );
  const answer = eventsOfKind(
    story,
    "practice-moved",
    (e) => e.threadId === thread.id && e.move === "accept",
  )[0];
  check(
    answer?.entityId === petition.petitioner,
    "the acceptance is the mortal's own move, from its routine",
    JSON.stringify(answer),
  );
  return accepted;
}

/**
 * Stages a prayer's cause, as S4 stages a burning tavern, instead of leaning on
 * whatever the town happens to go short of: `owner` is walked to its own
 * `building` by fixture moves, Zeus goes there and damages it (power 1, below
 * the ignition threshold, so nothing burns), and the owner notices the loss
 * standing there.
 * A mortal that has noticed a loss prays about it, to the god it weighs most.
 */
async function stageLoss(
  story: Story,
  owner: string,
  buildingId: string,
): Promise<void> {
  const building = (await stateOf(story)).buildings.get(id(buildingId));
  check(
    building !== undefined && building.owner === id(owner),
    `${owner} owns ${buildingId}`,
    String(building?.owner),
  );
  for (let hop = 0; hop < 12; hop += 1) {
    const state = await stateOf(story);
    const mortal = state.actors.get(id(owner));
    check(mortal?.alive === true, `${owner} is alive`, "gone");
    if (mortal.locationId === building.locationId) break;
    const next = nextHop(
      state,
      mortal.locationId,
      building.locationId,
      mortal.capabilities,
    );
    check(next !== undefined, `${owner} can walk to ${buildingId}`, "no route");
    await postFixture(
      story,
      owner,
      { kind: "move", to: next },
      `${owner} walks toward ${buildingId}`,
    );
  }
  // A god names only what it could see: Zeus goes to the building first.
  await walkTo(story, "zeus", building.locationId);
  await godMoves(
    story,
    "zeus",
    JSON.stringify({ action: "strike", target: buildingId, power: 1 }),
    `zeus damages ${buildingId}`,
  );
  await waitFor(
    `${owner} notices the damage to ${buildingId}`,
    () =>
      eventsOfKind(
        story,
        "loss-noticed",
        (e) => e.entityId === owner && e.building === buildingId,
      )[0],
    { timeoutMs: 20_000, intervalMs: 100 },
  );
}

export async function stepSupplication(
  recorder: Recorder,
  story: Story,
): Promise<Supplications> {
  return recorder.run(
    "S16",
    "Supplication: terms kept are fulfilled; terms broken cost the stake, and the mortal keeps its memory and identity",
    "Two mortals have prayed. A god answers one prayer by offering terms (its boon for one offering by the mortal of a unit of what it gathers, no counteroffers); the mortal's routine accepts, the god blesses it, and the mortal makes its offering: the thread is fulfilled, its ending cites the half that came last (the offering or the boon), and the blessing and the offering are each recorded as seen. A god answers the other with the same terms and a stake, the wolf; the mortal accepts and is blessed, then cannot make its offering by the deadline: the thread is breached, the stake changes the mortal's form and capabilities, citing the breach, and its memories, feelings, and identity are kept.",
    async (step) => {
      // The town is twenty mortals and seven gods, and the story scripts only Zeus and Hera, so
      // the step answers the prayers made to them. The term to be broken is a promise of nearly
      // all that its mortal could hold by the deadline of what it gathers, which no wealth in
      // the town changes; the term to be kept is one unit of what its mortal gathers.
      //
      // The town goes short rarely now, so the step makes its own causes: the woodcutter and the
      // farmer, whose patrons are Zeus and Hera, each lose a building and pray about it.
      await stageLoss(story, "woodcutter", "woodshed");
      await stageLoss(story, "farmer", "agora-shop");
      const { first, second } = await waitFor(
        "two prayers wait for an answer from two mortals who each gather something",
        async () => {
          const state = await stateOf(story);
          // Only a prayer the god's latest prompt offers terms on: one answered or lapsed since is not worth a turn.
          const offered = new Set(
            ["zeus", "hera"].flatMap((god) =>
              [
                ...(
                  story.provider.requests
                    .filter((request) => request.god === god)
                    .at(-1)?.prompt ?? ""
                ).matchAll(/"move":"offer","prayer":"(evt-[^"]+)"/g),
              ].map((match) => match[1]),
            ),
          );
          // The newest first: a prayer near the end of its window lapses before the god's turn comes.
          const prayers = (await openHelp(story))
            .filter(
              (p) =>
                (p.god === "zeus" || p.god === "hera") && offered.has(p.id),
            )
            .filter((p) => state.tick - p.tick < 150)
            .sort((a, b) => b.tick - a.tick);
          const gathers = (mortal: string) =>
            state.actors.get(id(mortal))?.gathers;
          // A food producer does nothing but gather now that it sells only to whoever asks, so a
          // promise of what it could gather in the time is one it keeps: the one who breaks is not one.
          const breaker = prayers.find((p) => {
            const resource = gathers(p.petitioner);
            return resource !== undefined && resource !== "food";
          });
          // Mortals pray to their patrons, so Zeus and Hera hear only their own few, some of them poor: the
          // keeper is asked for a unit of what it gathers, not a coin: a poor mortal spends its coins eating and
          // buying between the god's turn and its own, and a gatherer always has the unit by the deadline. It must
          // be pious enough to take the terms at all.
          const keeper = prayers.find(
            (p) =>
              p.petitioner !== breaker?.petitioner &&
              gathers(p.petitioner) !== undefined &&
              Math.round(
                (state.actors.get(p.petitioner)?.drives?.piety ?? 0) * 100,
              ) >= 10,
          );
          return breaker === undefined || keeper === undefined
            ? undefined
            : { first: keeper, second: breaker };
        },
        { timeoutMs: 240_000, intervalMs: 500 },
      );

      // Terms kept: one unit of what the mortal gathers.
      const keptGood = (await stateOf(story)).actors.get(
        id(first.petitioner),
      )?.gathers;
      check(
        keptGood !== undefined,
        `${first.petitioner} gathers something to offer`,
        String(keptGood),
      );
      const keptThread = await offerTerms(
        story,
        first,
        1,
        90,
        undefined,
        keptGood,
      );
      const keptBoon = await giveBoon(
        story,
        first,
        `${first.god} blesses ${first.petitioner}`,
      );
      const kept = await threadEnded(
        story,
        keptThread.id,
        "the thread ends",
        60_000,
      );
      const keptEnd = eventsOfKind(
        story,
        "practice-ended",
        (e) => e.threadId === keptThread.id,
      )[0];
      // A supplication is two halves, the god's boon and the mortal's offering, and the world
      // fulfils it when the second lands: the ending cites whichever came last. A mortal of the
      // town may have made its offering before the god got to it, so the ending may cite the boon.
      // The offering is the worship that carried what the term asked for: a mortal who
      // worships its god plainly, with nothing offered, has not made the offering, and a
      // check that took the first worship of the god at all would take that one.
      const offering = eventsOfKind(
        story,
        "worship-performed",
        (e) =>
          e.entityId === first.petitioner &&
          e.deity === first.god &&
          Number(e.tick) >= keptThread.openedTick &&
          (e.offering as { resource?: string } | undefined)?.resource ===
            (keptThread.term as { resource?: string }).resource,
      )[0];
      const completing = storedEvents(story).find(
        (e) => e.id === keptEnd?.performedBy,
      );
      check(
        kept.status === "fulfilled" &&
          keptEnd?.reason === "performed" &&
          offering !== undefined &&
          (keptEnd.performedBy === offering.id ||
            keptEnd.performedBy === keptBoon),
        "the thread is fulfilled: the mortal made its offering to the god, and the ending cites the half that came last, the offering or the boon",
        JSON.stringify({
          status: kept.status,
          keptEnd,
          offering: offering ?? null,
          completing: completing?.kind ?? null,
          wanted: { who: first.petitioner, god: first.god },
        }),
      );
      const steps = eventsOfKind(
        story,
        "practice-progressed",
        (e) => e.threadId === keptThread.id,
      );
      // The half that came first is a recorded step; the half that came last is the ending's citation.
      check(
        steps.some((e) => e.step === "boon" && e.by === keptBoon) ||
          kept.progress?.boon === keptBoon ||
          keptEnd?.performedBy === keptBoon,
        "the blessing was recorded as the boon seen given",
        JSON.stringify({ steps, progress: kept.progress }),
      );

      // Terms broken.
      const before = await stateOf(story);
      const mortal = second.petitioner;
      const gathered = before.actors.get(id(mortal))?.gathers;
      check(
        gathered !== undefined,
        `${mortal} gathers something to promise`,
        String(gathered),
      );
      // The most the world lets it promise is what it holds plus what it could gather in the
      // ticks it has. The step promises nearly all of that (six ticks short, in case it sells a
      // few before the offer lands): the world accepts the term, and the mortal, who spends its
      // ticks eating, selling, and walking to the altar, cannot hold that much by the deadline.
      const gatherAmount = before.rules.economyBalance.gatherAmount ?? 1;
      const promised =
        (before.actors.get(id(mortal))?.inventory.get(gathered ?? "") ?? 0) +
        gatherAmount * (30 - 6);
      const brokenThread = await offerTerms(
        story,
        second,
        promised,
        30,
        "wolf",
        gathered,
      );
      check(
        brokenThread.stake?.form === "wolf",
        "the stake the god chose is on the thread, as the world authored it",
        JSON.stringify(brokenThread.stake),
      );
      check(
        brokenThread.term.kind === "make-offering" &&
          brokenThread.term.amount === promised,
        `${mortal} promised ${promised} ${gathered}, nearly the most the world lets it promise and more than it can hold by the deadline`,
        JSON.stringify(brokenThread.term),
      );
      const memoriesBefore =
        (await stateOf(story)).memories.get(id(mortal)) ?? [];
      const feelingsBefore = [...(await stateOf(story)).relationships.entries()]
        .filter(([key]) => key.startsWith(`${mortal}>`))
        .map(([key, value]) => [key, JSON.stringify(value)]);
      await giveBoon(story, second, `${second.god} blesses ${mortal}`);
      const broken = await threadEnded(
        story,
        brokenThread.id,
        "the deadline passes",
        90_000,
      );
      const brokenEnd = eventsOfKind(
        story,
        "practice-ended",
        (e) => e.threadId === brokenThread.id,
      )[0];
      check(
        broken.status === "breached" &&
          brokenEnd?.reason === "obligation-deadline",
        "the thread is breached at its obligation deadline: the boon was had and the offering was not made",
        JSON.stringify({ status: broken.status, brokenEnd }),
      );
      const change = eventsOfKind(
        story,
        "motif-applied",
        (e) => e.threadId === brokenThread.id && e.effect === "transformation",
      )[0];
      check(
        change?.entityId === mortal &&
          change.form === "wolf" &&
          change.intent === "punishment" &&
          change.cause === brokenEnd.id,
        "the stake applies: the mortal becomes a wolf as punishment, citing the breach",
        JSON.stringify(change),
      );
      const after = await stateOf(story);
      const changed = after.actors.get(id(mortal));
      const kept_ = (after.memories.get(id(mortal)) ?? []).map((m) => m.id);
      check(
        changed?.form === "wolf" &&
          changed.alive === true &&
          changed.capabilities.includes("beast"),
        "the committed state holds the new form and capability",
        JSON.stringify({
          form: changed?.form,
          capabilities: changed?.capabilities,
        }),
      );
      // The form change forgets nothing. A mortal that already holds as many as it can (the town's wrongs fill a
      // memory) forgets its least salient as new ones form, as every full memory does, so a missing one is allowed
      // only from a full memory.
      const capacity = after.rules.memoryBalance?.capacity ?? 24;
      check(
        memoriesBefore.every((m) => kept_.includes(m.id)) ||
          kept_.length >= capacity,
        "every memory it held before is still held, unless a full memory forgot it as new ones formed",
        `${memoriesBefore.length} before, ${kept_.length} after, capacity ${capacity}`,
      );
      // The boon and the breach may move how it feels about the gods (it remembers a kindness, and a broken term); the form
      // change itself moves nothing, and every feeling it held is still held, toward everyone but the gods unchanged.
      const feelingsAfter = new Map(
        [...after.relationships.entries()]
          .filter(([key]) => key.startsWith(`${mortal}>`))
          .map(([key, value]) => [key, JSON.stringify(value)]),
      );
      // The town's own wrongs move how a mortal feels about other mortals, so what is held is that no feeling is
      // lost and that the change of form itself formed no memory, and so moved no feeling.
      const formedByChange = storedEvents(story).filter(
        (e) =>
          e.kind === "memory-recorded" &&
          e.entityId === mortal &&
          e.sourceEventId === change.id,
      );
      check(
        feelingsBefore.every(([key]) => feelingsAfter.has(key as string)) &&
          formedByChange.length === 0,
        "every feeling it held is still held, and the change of form formed no memory or feeling of its own",
        JSON.stringify({
          before: feelingsBefore,
          after: [...feelingsAfter],
          formedByChange,
        }),
      );
      step.done(
        `${first.god} offered ${first.petitioner} terms on ${first.id}: ${first.petitioner}'s routine accepted, the blessing ${keptBoon} and its offering ${offering?.id} fulfilled ${keptThread.id}; ${second.god} offered ${mortal} the same with the wolf as stake: it took the boon and had nothing to offer, ${brokenThread.id} breached (${brokenEnd?.id}) and ${change?.id} made it a wolf with its ${memoriesBefore.length} memories kept`,
      );
      return { keptId: keptThread.id, brokenId: brokenThread.id };
    },
  );
}

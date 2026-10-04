// S13 to S15: settlement between the two gods, played through the compiled
// sidecar with scripted turns. A reply is a function of the prompt its god was
// shown, so each names only what that god could name.
//
//   S13  Hera demands; Zeus refuses; her repeat makes no progress and her next
//        prompt says why; both remember how it ended.
//   S14  A newer account lets her open a linked successor; Zeus's talk around it
//        makes no progress while a report that names another agent does not;
//        he accepts, performs, and the world observes it.
//   S15  A sworn term broken costs the oath penalty; counteroffers are
//        exhausted, one reworded counter makes no progress; Hera refuses a
//        demand of her own and is remembered for it.

import type { Recorder, Story } from "./context";
import {
  answerThread,
  beAt,
  demandOver,
  eventsOfKind,
  feeling,
  godActs,
  godMoves,
  meet,
  nextPrompt,
  threadAfter,
  threadEnded,
  threadNow,
  threadsOf,
  walkTo,
} from "./practice";
import { check, stateOf } from "./support";

const NO_PROGRESS = "no-progress";
const known = async (story: Story) =>
  threadsOf(await stateOf(story)).map((thread) => thread.id as string);
const byId = (cause: string) => (causes: { id: string }[]) =>
  causes.find((c) => c.id === cause)?.id;

/** What S13 hands on: the thread it closed and the cause that thread consumed. */
export interface Refusal {
  readonly threadId: string;
  readonly cause: string;
}

export async function stepRefusal(
  recorder: Recorder,
  story: Story,
): Promise<Refusal> {
  return recorder.run(
    "S13",
    "A refused demand closes its thread; a repeat makes no progress, and Hera's next prompt says why",
    "Hera, told of Zeus's deed, demands through a model proposal that he be at the square by a deadline; the world opens a settlement thread on that cause, with the two as participants; Zeus refuses; the thread is refused and closed, both remember how it ended (the refuser named), and Hera's affinity toward him falls by exactly one relationship-changed event citing her memory of it; her identical demand is then rejected no-progress, no thread opens, the refusal is recorded for her, and her next prompt names the demand as refused and already answered while Zeus's prompt shows that he refused.",
    async (step) => {
      const before = await stateOf(story);
      const earlier = await known(story);
      const feltBefore = feeling(before, "hera", "zeus")?.affinity ?? 0;

      // The cause is the account that blames him: the one whose claim Hera's memory holds.
      const blame = before.memories
        .get("hera" as never)
        ?.find(
          (m) =>
            m.kind === "told" &&
            m.teller === "zeus" &&
            m.consequence?.agent === "zeus",
        );
      check(
        blame?.kind === "told",
        "Hera holds an account from Zeus that blames him",
        "no such memory",
      );
      const demand = await godMoves(
        story,
        "hera",
        demandOver(
          byId(blame.linkedEventId ?? blame.sourceEventId),
          beAt("zeus", "town-square", 30),
        ),
        "hera demands that zeus be at the square",
      );
      const thread = await threadAfter(
        story,
        earlier,
        "the demand opens a thread",
      );
      const cause = String(demand.proposal.cause);
      check(
        thread.practice === "settlement" &&
          thread.demander === "hera" &&
          thread.obligated === "zeus" &&
          thread.status === "open" &&
          thread.causes.join() === cause &&
          thread.term.kind === "be-at" &&
          thread.term.party === "zeus",
        "the demand opens a settlement thread: Hera and Zeus, resting on the cause she cited, one term for Zeus",
        JSON.stringify(thread),
      );
      const opening = eventsOfKind(
        story,
        "practice-opened",
        (e) => e.id === thread.id,
      )[0];
      check(
        opening?.correlationId === String(demand.proposal.observationId),
        "the opening event is the demand's own",
        JSON.stringify(opening),
      );

      const refusal = await godMoves(
        story,
        "zeus",
        answerThread("AWAITING YOUR ANSWER", "refuse"),
        "zeus refuses",
      );
      const closed = await threadEnded(
        story,
        thread.id,
        "the refusal closes the thread",
      );
      check(
        closed.status === "refused",
        "the thread is refused",
        closed.status,
      );
      const moved = eventsOfKind(
        story,
        "practice-moved",
        (e) => e.threadId === thread.id && e.move === "refuse",
      )[0];
      check(
        moved?.entityId === "zeus" &&
          moved.correlationId === String(refusal.proposal.observationId),
        "the refusal is Zeus's move, and the event is the proposal's own",
        JSON.stringify(moved),
      );
      // Both parties remember how it ended, with who refused.
      const memories = eventsOfKind(
        story,
        "memory-recorded",
        (e) => e.sourceEventId === moved?.id,
      );
      check(
        memories
          .map((m) => String(m.entityId))
          .sort()
          .join() === "hera,zeus" &&
          memories.every(
            (m) =>
              m.memoryKind === "witnessed" &&
              (m.ending as { outcome?: string; agent?: string })?.outcome ===
                "refused" &&
              (m.ending as { agent?: string }).agent === "zeus",
          ),
        "both remember the refusal, naming Zeus as the refuser",
        JSON.stringify(memories),
      );
      const herMemory = memories.find((m) => m.entityId === "hera");
      const cooled = eventsOfKind(
        story,
        "relationship-changed",
        (e) => e.memoryEventId === herMemory?.id,
      );
      check(
        cooled.length === 1 &&
          cooled[0]?.entityId === "hera" &&
          cooled[0].toward === "zeus" &&
          Number(cooled[0].affinityDelta) < 0,
        "Hera cools toward Zeus by exactly one relationship-changed event, citing her memory of the refusal",
        JSON.stringify(cooled),
      );
      const feltAfter =
        feeling(await stateOf(story), "hera", "zeus")?.affinity ?? 0;
      check(
        feltAfter < feltBefore,
        "the committed state holds the cooler feeling",
        `${feltBefore} -> ${feltAfter}`,
      );

      // Her identical demand repeats an answered move on a cause the thread consumed.
      const repeat = await godActs(
        story,
        "hera",
        demandOver(byId(cause), beAt("zeus", "town-square", 35)),
        "hera repeats the demand",
      );
      check(
        repeat.outcome === "rejected" && repeat.reason === NO_PROGRESS,
        "the repeat is rejected no-progress",
        `${repeat.outcome} ${repeat.reason}`,
      );
      check(
        (await known(story)).length === earlier.length + 1,
        "no new thread opened",
        String((await known(story)).length),
      );
      const refused = eventsOfKind(
        story,
        "practice-refused",
        (e) => e.correlationId === String(repeat.proposal.observationId),
      )[0];
      check(
        refused?.attempted === "demand" &&
          refused.reason === NO_PROGRESS &&
          refused.thread === thread.id &&
          String(refused.why).includes("already answered"),
        "the world records the refusal for Hera: a demand, no-progress, on that thread, already answered",
        JSON.stringify(refused),
      );
      const mark = story.provider.requests.length;
      const heraNext = await nextPrompt(
        story,
        "hera",
        mark,
        "hera is asked again",
      );
      const zeusNext = await nextPrompt(
        story,
        "zeus",
        mark,
        "zeus is asked again",
      );
      check(
        heraNext.prompt.includes("Your open practices:") &&
          heraNext.prompt.includes("Your last demand was refused") &&
          heraNext.prompt.includes("already answered"),
        "Hera's next prompt says her last demand was refused and why",
        heraNext.prompt.slice(0, 400),
      );
      check(
        heraNext.prompt.includes(`zeus refused your offer [${moved?.id}]`),
        "and her memory section says Zeus refused her",
        "not shown",
      );
      check(
        zeusNext.prompt.includes(`you refused hera's offer [${moved?.id}]`) &&
          !zeusNext.prompt.includes("practice-moved"),
        "Zeus's prompt shows that he refused, in words and not as an event kind",
        zeusNext.prompt.slice(-600),
      );
      step.done(
        `hera demanded over ${cause} (thread ${thread.id}); zeus refused (${moved?.id}); her affinity toward him went ${feltBefore} -> ${feltAfter} by ${cooled[0]?.id}; her repeat was rejected no-progress (${refused?.id}: "${refused?.why}") and her next prompt named it`,
      );
      return { threadId: thread.id, cause };
    },
  );
}

/** What S14 hands on: the thread Zeus performed. */
export interface Fulfilment {
  readonly threadId: string;
}

export async function stepSuccessor(
  recorder: Recorder,
  story: Story,
  refusal: Refusal,
): Promise<Fulfilment> {
  return recorder.run(
    "S14",
    "A newer account opens a linked successor; talk around it makes no progress; Zeus performs and the world sees it",
    "Zeus tells Hera something newer (a report, free now the first thread is closed); her demand over it opens a successor that links the closed thread, which learns its successor, and rests on a cause the closed one did not consume; while it is open, Zeus's report whose claim names the thread's subject is rejected no-progress, is recorded as refused, and leaves the thread's revision as it was, while a report whose claim names another agent is told; he accepts, walks to the square, and the world observes the performance: the thread is fulfilled, its ending cites the move that showed it, Zeus's standing at the square is recorded as won, and Hera's affinity toward him rises; every move he made while obligated was made with the obligation leading his prompt.",
    async (step) => {
      // Zeus away from the square, so performing the term takes him there.
      await walkTo(story, "zeus", "great-hall");
      await meet(story, "hera", "zeus");
      const earlier = await known(story);

      const told = await godMoves(
        story,
        "zeus",
        JSON.stringify({
          action: "report",
          listener: "hera",
          content: "I healed the farmer's herd with my own hand.",
          claim: { effect: "kindness", agent: "zeus" },
        }),
        "zeus tells hera something newer",
      );
      const reportId = eventsOfKind(
        story,
        "report-told",
        (e) => e.correlationId === String(told.proposal.observationId),
      )[0]?.id;
      check(reportId !== undefined, "the report is recorded", "no report-told");

      await godMoves(
        story,
        "hera",
        demandOver(byId(reportId), beAt("zeus", "town-square", 40)),
        "hera demands over the newer account",
      );
      const thread = await threadAfter(
        story,
        earlier,
        "the demand opens a successor",
      );
      const opening = eventsOfKind(
        story,
        "practice-opened",
        (e) => e.id === thread.id,
      )[0];
      const first = await threadNow(story, refusal.threadId);
      check(
        opening?.succeeds === refusal.threadId &&
          first.successor === thread.id &&
          thread.causes.join() === reportId &&
          !first.causes.some((c) => c === reportId),
        "the successor links the closed thread, which learns it, and rests on a cause the closed thread did not consume",
        JSON.stringify({
          succeeds: opening?.succeeds,
          successor: first.successor,
          causes: thread.causes,
          subject: thread.subject,
          earlierSubject: first.subject,
          earlierCauses: first.causes,
          memories: (await stateOf(story)).memories
            .get("hera" as never)
            ?.map((m) => [
              m.kind,
              m.sourceEventId,
              m.recordedAt,
              m.consequence,
            ]),
        }),
      );
      check(
        first.status === "refused",
        "the closed thread stays closed",
        first.status,
      );

      // While it is open, talk about its subject counts for nothing.
      const revision = (await threadNow(story, thread.id)).revision;
      const talk = await godActs(
        story,
        "zeus",
        JSON.stringify({
          action: "report",
          listener: "hera",
          content: "I did nothing to the farmer, truly.",
          claim: { effect: "harm", agent: "zeus" },
        }),
        "zeus talks around the thread",
      );
      check(
        talk.outcome === "rejected" && talk.reason === NO_PROGRESS,
        "his report naming the thread's subject is rejected no-progress",
        `${talk.outcome} ${talk.reason}`,
      );
      const refused = eventsOfKind(
        story,
        "practice-refused",
        (e) => e.correlationId === String(talk.proposal.observationId),
      )[0];
      check(
        refused?.attempted === "report" && refused.thread === thread.id,
        "the refusal is recorded as talk around that thread",
        JSON.stringify(refused),
      );
      check(
        eventsOfKind(
          story,
          "report-told",
          (e) => e.correlationId === String(talk.proposal.observationId),
        ).length === 0,
        "nothing was told",
        "a report-told followed",
      );
      check(
        (await threadNow(story, thread.id)).revision === revision,
        "the thread is as it was",
        "its revision moved",
      );
      // A claim that names another agent is a different matter, whatever the words.
      await godMoves(
        story,
        "zeus",
        JSON.stringify({
          action: "report",
          listener: "hera",
          content: "I did nothing to the farmer, truly; you wronged him too.",
          claim: { effect: "harm", agent: "hera" },
        }),
        "zeus reports a claim about another agent",
      );
      check(
        (await threadNow(story, thread.id)).revision === revision,
        "and it changed nothing in the thread either",
        "its revision moved",
      );

      // He accepts, then performs.
      const accepted = await godMoves(
        story,
        "zeus",
        answerThread("AWAITING YOUR ANSWER", "accept"),
        "zeus accepts",
      );
      const obligated = await threadNow(story, thread.id);
      check(
        obligated.status === "accepted" &&
          obligated.acceptance?.sworn === false,
        "the thread is accepted, not sworn",
        JSON.stringify(obligated.acceptance),
      );
      const mark = story.provider.requests.length;
      await walkTo(story, "zeus", "town-square");
      const done = await threadEnded(
        story,
        thread.id,
        "the performance is observed",
      );
      check(
        done.status === "fulfilled",
        "the thread is fulfilled",
        done.status,
      );
      const ended = eventsOfKind(
        story,
        "practice-ended",
        (e) => e.threadId === thread.id,
      )[0];
      const arrival = eventsOfKind(
        story,
        "entity-moved",
        (e) => e.id === ended?.performedBy,
      )[0];
      check(
        ended?.outcome === "fulfilled" &&
          ended.reason === "performed" &&
          arrival?.entityId === "zeus" &&
          arrival.to === "town-square",
        "the ending cites the move that showed Zeus at the square",
        JSON.stringify({ ended, arrival }),
      );
      const standing = eventsOfKind(
        story,
        "motif-applied",
        (e) => e.threadId === thread.id && e.effect === "standing",
      )[0];
      check(
        standing?.entityId === "zeus" &&
          standing.place === "town-square" &&
          Number(standing.delta) > 0,
        "Zeus's standing at the square is recorded as won",
        JSON.stringify(standing),
      );
      const warmed = eventsOfKind(
        story,
        "relationship-changed",
        (e) =>
          e.entityId === "hera" &&
          e.toward === "zeus" &&
          Number(e.affinityDelta) > 0 &&
          Number(e.sequence) > Number(ended?.sequence),
      )[0];
      check(
        warmed !== undefined,
        "Hera's affinity toward Zeus rises, from her memory of his keeping his word",
        "no relationship-changed",
      );
      // Every journey he set out on while obligated was begun with the obligation leading his prompt.
      const trips = story.provider.requests.filter(
        (r) =>
          r.god === "zeus" &&
          r.n >= mark &&
          /"action":\s*"travel"/.test(r.reply ?? ""),
      );
      check(
        trips.length > 0 &&
          trips.every((r) => r.prompt.includes(`[${thread.id}] YOU OWE hera`)),
        "every journey he set out on was begun with the obligation leading his prompt",
        `${trips.length} journeys`,
      );
      step.done(
        `zeus's newer account ${reportId} let hera open successor ${thread.id} (succeeds ${refusal.threadId}); his report naming the subject was rejected no-progress (${refused?.id}) and moved nothing, a report naming hera was told; he accepted (${accepted.proposalId}), set out ${trips.length} time(s) for the square, and ${ended?.id} cites ${arrival?.id}; standing ${standing?.id}, hera warmed by ${warmed?.id}`,
      );
      return { threadId: thread.id };
    },
  );
}

export async function stepOath(
  recorder: Recorder,
  story: Story,
): Promise<{
  readonly oathId: string;
  readonly exhaustedId: string;
  readonly refusedByHeraId: string;
}> {
  return recorder.run(
    "S15",
    "A sworn term broken costs the oath penalty; counteroffers run out; Hera is remembered for refusing",
    "Hera demands that Zeus be at the altar by a deadline and he swears it by the Styx, then does nothing: when the deadline passes the thread is breached, the world records the bounded oath penalty on Zeus (divinity lost, the divine capability withheld until a later tick) and each party remembers the sworn breach, which Zeus's next prompt shows in words; meanwhile Zeus's own demand of Hera is countered, countered again, answered by Hera with a reworded counter that restates her first offer, which is rejected no-progress and spends nothing, and then with a changed counter that spends the last counteroffer, so the thread is refused as budget exhausted; and Zeus's second demand of Hera, which Hera refuses, closes with her named as the refuser and Zeus cooling toward her.",
    async (step) => {
      await meet(story, "hera", "zeus");
      const earlier = await known(story);

      // Something new for Hera to act on: a harm Zeus admits, about a different matter.
      const admitted = await godMoves(
        story,
        "zeus",
        JSON.stringify({
          action: "report",
          listener: "hera",
          content: "I burned the farmer's tavern, and I would do it again.",
          claim: { effect: "harm", agent: "zeus", target: "farmer" },
        }),
        "zeus admits the tavern",
      );
      const admission = eventsOfKind(
        story,
        "report-told",
        (e) => e.correlationId === String(admitted.proposal.observationId),
      )[0]?.id;
      check(
        admission !== undefined,
        "the admission is recorded",
        "no report-told",
      );

      // What Hera tells him, so his own demands rest on accounts of their own: one blaming him, one in which she owns a wrong.
      const hera = async (content: string, claim: Record<string, unknown>) => {
        const row = await godMoves(
          story,
          "hera",
          JSON.stringify({
            action: "report",
            listener: "zeus",
            content,
            claim,
          }),
          "hera tells zeus something",
        );
        const told = eventsOfKind(
          story,
          "report-told",
          (e) => e.correlationId === String(row.proposal.observationId),
        )[0]?.id;
        check(told !== undefined, "her account is recorded", "no report-told");
        return told;
      };
      const blamed = await hera("You humbled me before the whole court.", {
        effect: "harm",
        agent: "zeus",
        target: "hera",
      });
      const owned = await hera("I wronged you too, and I will not undo it.", {
        effect: "harm",
        agent: "hera",
        target: "zeus",
      });

      // C: the oath.
      await godMoves(
        story,
        "hera",
        demandOver(byId(admission), beAt("zeus", "altar", 40)),
        "hera demands that zeus be at the altar",
      );
      const oath = await threadAfter(
        story,
        earlier,
        "the demand opens a thread",
      );
      const oathOpening = eventsOfKind(
        story,
        "practice-opened",
        (e) => e.id === oath.id,
      )[0];
      check(
        oathOpening?.succeeds === undefined &&
          oath.subject?.target === "farmer",
        "it is a fresh matter (Zeus and the farmer), not a successor",
        JSON.stringify({
          succeeds: oathOpening?.succeeds,
          subject: oath.subject,
        }),
      );
      const divinity =
        (await stateOf(story)).actors
          .get("zeus" as never)
          ?.inventory.get("divinity") ?? 0;
      await godMoves(
        story,
        "zeus",
        answerThread("AWAITING YOUR ANSWER", "accept", { swear: true }),
        "zeus accepts and swears",
      );
      check(
        (await threadNow(story, oath.id)).acceptance?.sworn === true,
        "he swore it",
        "acceptance not sworn",
      );

      // D: counteroffers run out, and one counter is reworded.
      const afterOath = await known(story);
      await godMoves(
        story,
        "zeus",
        demandOver(byId(blamed), beAt("hera", "great-hall", 60)),
        "zeus demands of hera over what she told him",
      );
      const bargain = await threadAfter(
        story,
        afterOath,
        "his demand opens a thread",
      );
      const counter = (move: string, term: Record<string, unknown>) =>
        answerThread("AWAITING YOUR ANSWER", move, { term });
      await godMoves(
        story,
        "hera",
        counter("counter", beAt("zeus", "altar", 70)),
        "hera counters",
      );
      await godMoves(
        story,
        "zeus",
        counter("counter", beAt("hera", "mountain-path", 80)),
        "zeus counters",
      );
      const reworded = await godActs(
        story,
        "hera",
        counter("counter", beAt("zeus", "altar", 70)),
        "hera counters with her first offer again",
      );
      check(
        reworded.outcome === "rejected" && reworded.reason === NO_PROGRESS,
        "her counter restating her first offer is rejected no-progress",
        `${reworded.outcome} ${reworded.reason}`,
      );
      const restated = eventsOfKind(
        story,
        "practice-refused",
        (e) => e.correlationId === String(reworded.proposal.observationId),
      )[0];
      check(
        restated?.attempted === "counter" &&
          restated.thread === bargain.id &&
          String(restated.why).includes("already made"),
        "and the world records it for her: a counter, on that thread, already made",
        JSON.stringify(restated),
      );
      check(
        (await threadNow(story, bargain.id)).counterBudgetLeft === 1,
        "it spent no counteroffer",
        String((await threadNow(story, bargain.id)).counterBudgetLeft),
      );
      await godMoves(
        story,
        "hera",
        counter("counter", beAt("zeus", "inn", 90)),
        "hera counters with a changed offer",
      );
      const spent = await threadEnded(
        story,
        bargain.id,
        "the last counteroffer ends it",
      );
      const exhausted = eventsOfKind(
        story,
        "practice-ended",
        (e) => e.threadId === bargain.id,
      )[0];
      check(
        spent.status === "refused" &&
          exhausted?.outcome === "refused" &&
          exhausted.reason === "budget-exhausted",
        "the thread is refused, as budget exhausted",
        JSON.stringify(exhausted),
      );

      // E: Hera refuses a demand of Zeus's, and is remembered for it.
      const beforeE = await known(story);
      const zeusFelt =
        (await stateOf(story)).relationships.get("zeus>hera" as never)
          ?.affinity ?? 0;
      await godMoves(
        story,
        "zeus",
        demandOver(byId(owned), beAt("hera", "olympus-gate", 60)),
        "zeus demands again, over the wrong she owned",
      );
      const refusedThread = await threadAfter(
        story,
        beforeE,
        "his second demand opens a thread",
      );
      await godMoves(
        story,
        "hera",
        answerThread("AWAITING YOUR ANSWER", "refuse"),
        "hera refuses",
      );
      await threadEnded(story, refusedThread.id, "her refusal closes it");
      const heraRefused = eventsOfKind(
        story,
        "practice-moved",
        (e) => e.threadId === refusedThread.id && e.move === "refuse",
      )[0];
      const hisMemory = eventsOfKind(
        story,
        "memory-recorded",
        (e) => e.sourceEventId === heraRefused?.id && e.entityId === "zeus",
      )[0];
      check(
        heraRefused?.entityId === "hera" &&
          (hisMemory?.ending as { agent?: string } | undefined)?.agent ===
            "hera",
        "Zeus remembers that Hera refused",
        JSON.stringify(hisMemory),
      );
      const zeusFeltAfter =
        (await stateOf(story)).relationships.get("zeus>hera" as never)
          ?.affinity ?? 0;
      check(
        zeusFeltAfter < zeusFelt,
        "and cools toward her",
        `${zeusFelt} -> ${zeusFeltAfter}`,
      );

      // C's deadline passes with Zeus having done nothing.
      const breached = await threadEnded(
        story,
        oath.id,
        "the sworn term's deadline passes",
        90_000,
      );
      check(
        breached.status === "breached",
        "the sworn thread is breached",
        breached.status,
      );
      const breach = eventsOfKind(
        story,
        "practice-ended",
        (e) => e.threadId === oath.id,
      )[0];
      check(
        breach?.outcome === "breached" &&
          breach.reason === "obligation-deadline",
        "it ended breached, at its obligation deadline",
        JSON.stringify(breach),
      );
      const penalty = eventsOfKind(
        story,
        "motif-applied",
        (e) => e.threadId === oath.id && e.effect === "oath-penalty",
      )[0];
      check(
        penalty?.entityId === "zeus" &&
          penalty.capability === "divine" &&
          Number(penalty.divinityLost) > 0 &&
          penalty.cause === breach.id,
        "the oath penalty falls on Zeus, citing the breach: divinity lost and the divine capability withheld",
        JSON.stringify(penalty),
      );
      const zeus = (await stateOf(story)).actors.get("zeus" as never);
      check(
        zeus !== undefined &&
          !zeus.capabilities.includes("divine") &&
          (zeus.withheld ?? []).some((w) => w.capability === "divine") &&
          (zeus.inventory.get("divinity") ?? 0) < divinity,
        "the committed state holds the penalty",
        JSON.stringify({
          capabilities: zeus?.capabilities,
          withheld: zeus?.withheld,
        }),
      );
      const mark = story.provider.requests.length;
      const zeusNext = await nextPrompt(
        story,
        "zeus",
        mark,
        "zeus is asked after the breach",
      );
      check(
        zeusNext.prompt.includes(
          `you breached the sworn term to hera [${breach.id}]`,
        ),
        "Zeus's next prompt shows that he broke the sworn term, in words",
        zeusNext.prompt.slice(-500),
      );
      step.done(
        `hera's demand ${oath.id} was sworn by zeus and breached at its deadline (${breach.id}): oath penalty ${penalty.id} cost ${penalty.divinityLost} divinity and withheld ${penalty.capability}; zeus's demand ${bargain.id} ended refused as budget exhausted after her counter restating her first offer was rejected no-progress (${restated?.id}); her refusal of ${refusedThread.id} is remembered by zeus (affinity ${zeusFelt} -> ${zeusFeltAfter})`,
      );
      return {
        oathId: oath.id,
        exhaustedId: bargain.id,
        refusedByHeraId: refusedThread.id,
      };
    },
  );
}

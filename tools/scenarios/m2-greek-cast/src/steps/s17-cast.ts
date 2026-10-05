// S18 and S19: the three gods the story had left waiting take their parts, so
// that all seven act. Hermes stands at the ferry dock the whole time.
//
//   S18  Hephaestus walks to the dock and tells Hermes of a kindness; Hermes
//        asks him for an alliance over it; he accepts and the world seals it:
//        each of the two is allied with the other, and the seal is the cause.
//   S19  Hades walks to the dock and tells Hermes something; Hermes demands
//        of him in turn, and Hades refuses: he is named as the refuser, and
//        Hermes cools toward him.
//
// A reply is a function of the prompt its god was shown, so each names only
// what that god could name.

import { toEntityId } from "@panthea/world";
import type { Recorder, Story } from "./context";
import {
  answerThread,
  beAt,
  demandOver,
  eventsOfKind,
  feeling,
  godMoves,
  meet,
  threadAfter,
  threadEnded,
  threadsOf,
} from "./practice";
import { check, stateOf } from "./support";

const id = toEntityId;
const known = async (story: Story) =>
  threadsOf(await stateOf(story)).map((thread) => thread.id as string);
const byId = (cause: string) => (causes: { id: string }[]) =>
  causes.find((c) => c.id === cause)?.id;

/** A god tells Hermes something, and the id of the report the world recorded. */
async function tellsHermes(
  story: Story,
  god: "hades" | "hephaestus",
  content: string,
): Promise<string> {
  await meet(story, god, "hermes");
  const told = await godMoves(
    story,
    god,
    JSON.stringify({
      action: "report",
      listener: "hermes",
      content,
      claim: { effect: "kindness", agent: god },
    }),
    `${god} tells hermes something`,
  );
  const report = eventsOfKind(
    story,
    "report-told",
    (e) => e.correlationId === String(told.proposal.observationId),
  )[0]?.id;
  check(report !== undefined, "the report is recorded", "no report-told");
  return report;
}

/** What S18 hands on: the thread whose acceptance was sealed. */
export interface Alliance {
  readonly threadId: string;
  readonly sealingId: string;
}

export async function stepAlliance(
  recorder: Recorder,
  story: Story,
): Promise<Alliance> {
  return recorder.run(
    "S18",
    "A sealed alliance: Hermes asks Hephaestus, he accepts, and the world allies both gods with the seal as the cause",
    "Hephaestus walks to Hermes at the ferry dock and tells him of a kindness; Hermes demands over it that Hephaestus ally with him, and the world opens a settlement with an alliance term between the two, no one allied yet; Hephaestus accepts, and on that tick the world ends the thread fulfilled with the reason sealed, citing no performance; each of the two remembers the sealing, and each is allied with the other by exactly one relationship-changed event citing that memory, which in turn rests on the sealed ending; the committed state holds both relationships as allied and no other relationship in the world is.",
    async (step) => {
      const earlier = await known(story);
      const oars = await tellsHermes(
        story,
        "hephaestus",
        "I forged the ferryman's oars with my own hands.",
      );

      const before = await stateOf(story);
      check(
        feeling(before, "hermes", "hephaestus")?.allied !== true &&
          feeling(before, "hephaestus", "hermes")?.allied !== true,
        "neither is allied with the other yet",
        "already allied",
      );
      await godMoves(
        story,
        "hermes",
        demandOver(byId(oars), {
          kind: "ally",
          party: "hephaestus",
          to: "hermes",
          deadlineTicks: 50,
        }),
        "hermes asks hephaestus for an alliance",
      );
      const thread = await threadAfter(
        story,
        earlier,
        "the demand opens a thread",
      );
      check(
        thread.practice === "settlement" &&
          thread.demander === "hermes" &&
          thread.obligated === "hephaestus" &&
          thread.status === "open" &&
          thread.causes.join() === oars &&
          thread.term.kind === "ally" &&
          thread.term.party === "hephaestus" &&
          thread.term.to === "hermes",
        "the demand opens a settlement on his report: an alliance term between Hermes and Hephaestus, Hephaestus to ally",
        JSON.stringify(thread),
      );

      const accepted = await godMoves(
        story,
        "hephaestus",
        answerThread("AWAITING YOUR ANSWER", "accept"),
        "hephaestus accepts",
      );
      const sealed = await threadEnded(
        story,
        thread.id,
        "the acceptance seals the alliance",
      );
      check(
        sealed.status === "fulfilled",
        "the thread is fulfilled",
        sealed.status,
      );
      const acceptance = eventsOfKind(
        story,
        "practice-moved",
        (e) => e.threadId === thread.id && e.move === "accept",
      )[0];
      const read = eventsOfKind(
        story,
        "practice-ended",
        (e) => e.threadId === thread.id,
      )[0];
      // The control rewrites the sealing as a plain performance before the check reads it.
      const ended =
        story.options.control === "alliance-unsealed" && read !== undefined
          ? { ...read, reason: "performed" }
          : read;
      check(
        acceptance?.entityId === "hephaestus" &&
          acceptance.correlationId ===
            String(accepted.proposal.observationId) &&
          ended?.outcome === "fulfilled" &&
          ended.reason === "sealed" &&
          ended.performedBy === undefined &&
          Number(ended.sequence) > Number(acceptance.sequence),
        "the ending is sealed, after Hephaestus's own acceptance, and cites no performance",
        JSON.stringify({ acceptance, ended }),
      );

      // Each remembers the sealing; each feeling cites its memory, which rests on the ending.
      const memories = eventsOfKind(
        story,
        "memory-recorded",
        (e) => e.sourceEventId === ended.id,
      );
      check(
        memories
          .map((m) => String(m.entityId))
          .sort()
          .join() === "hephaestus,hermes" &&
          memories.every(
            (m) =>
              m.memoryKind === "witnessed" &&
              (m.ending as { sealed?: boolean } | undefined)?.sealed === true,
          ),
        "both remember the sealing",
        JSON.stringify(memories),
      );
      const memoryIds = memories.map((m) => String(m.id));
      const allied = eventsOfKind(
        story,
        "relationship-changed",
        (e) => memoryIds.includes(String(e.memoryEventId)) && e.allied === true,
      );
      check(
        allied
          .map((e) => `${e.entityId}>${e.toward}`)
          .sort()
          .join() === "hephaestus>hermes,hermes>hephaestus" &&
          allied.every((e) => {
            const memory = memories.find((m) => m.id === e.memoryEventId);
            return (
              memory?.entityId === e.entityId &&
              String(e.causationId) === String(e.memoryEventId)
            );
          }),
        "each is allied with the other by one relationship-changed event citing its own memory of the sealing",
        JSON.stringify(allied),
      );
      const after = await stateOf(story);
      check(
        feeling(after, "hermes", "hephaestus")?.allied === true &&
          feeling(after, "hephaestus", "hermes")?.allied === true,
        "the committed state holds both relationships as allied",
        JSON.stringify([
          feeling(after, "hermes", "hephaestus"),
          feeling(after, "hephaestus", "hermes"),
        ]),
      );
      const alliances = [...after.relationships.values()].filter(
        (r) => r.allied,
      );
      check(
        alliances.length === 2,
        "no other relationship in the world is allied",
        `${alliances.length} allied`,
      );
      step.done(
        `hephaestus's report ${oars} let hermes open ${thread.id}; hephaestus accepted (${acceptance?.id}) and ${ended.id} ended it sealed: ${allied.map((e) => `${e.entityId} → ${e.toward} allied by ${e.id}`).join(", ")}`,
      );
      return { threadId: thread.id, sealingId: String(ended.id) };
    },
  );
}

/** What S19 hands on: the thread Hades refused. */
export interface Refusal {
  readonly threadId: string;
}

export async function stepHades(
  recorder: Recorder,
  story: Story,
): Promise<Refusal> {
  return recorder.run(
    "S19",
    "Hades takes a part in a thread: Hermes demands of him and he refuses, and is remembered for it",
    "Hades walks to Hermes at the ferry dock and tells him something; Hermes demands over it that Hades be at the town square, the world opens a settlement between the two on that cause, and Hades refuses: the thread is refused and closed, both remember how it ended with Hades named as the refuser, and Hermes cools toward him by exactly one relationship-changed event citing his memory of it.",
    async (step) => {
      const earlier = await known(story);
      const decree = await tellsHermes(
        story,
        "hades",
        "No shade leaves my halls unpaid for.",
      );
      const felt =
        feeling(await stateOf(story), "hermes", "hades")?.affinity ?? 0;
      await godMoves(
        story,
        "hermes",
        demandOver(byId(decree), beAt("hades", "town-square", 40)),
        "hermes demands that hades be at the square",
      );
      const thread = await threadAfter(
        story,
        earlier,
        "the demand opens a thread",
      );
      check(
        thread.practice === "settlement" &&
          thread.demander === "hermes" &&
          thread.obligated === "hades" &&
          thread.status === "open" &&
          thread.causes.join() === decree &&
          thread.term.kind === "be-at" &&
          thread.term.party === "hades",
        "the demand opens a settlement between Hermes and Hades on his report, one term for Hades",
        JSON.stringify(thread),
      );

      const refusal = await godMoves(
        story,
        "hades",
        answerThread("AWAITING YOUR ANSWER", "refuse"),
        "hades refuses",
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
        moved?.entityId === "hades" &&
          moved.correlationId === String(refusal.proposal.observationId),
        "the refusal is Hades's move, and the event is the proposal's own",
        JSON.stringify(moved),
      );
      const memories = eventsOfKind(
        story,
        "memory-recorded",
        (e) => e.sourceEventId === moved?.id,
      );
      check(
        memories
          .map((m) => String(m.entityId))
          .sort()
          .join() === "hades,hermes" &&
          memories.every(
            (m) =>
              m.memoryKind === "witnessed" &&
              (m.ending as { outcome?: string; agent?: string })?.outcome ===
                "refused" &&
              (m.ending as { agent?: string }).agent === "hades",
          ),
        "both remember the refusal, naming Hades as the refuser",
        JSON.stringify(memories),
      );
      const hers = memories.find((m) => m.entityId === "hermes");
      const cooled = eventsOfKind(
        story,
        "relationship-changed",
        (e) => e.memoryEventId === hers?.id,
      );
      check(
        cooled.length === 1 &&
          cooled[0]?.entityId === "hermes" &&
          cooled[0].toward === "hades" &&
          Number(cooled[0].affinityDelta) < 0,
        "Hermes cools toward Hades by exactly one relationship-changed event, citing his memory of the refusal",
        JSON.stringify(cooled),
      );
      const feltAfter =
        feeling(await stateOf(story), "hermes", "hades")?.affinity ?? 0;
      check(
        feltAfter < felt && (await stateOf(story)).actors.has(id("hades")),
        "the committed state holds the cooler feeling",
        `${felt} -> ${feltAfter}`,
      );
      step.done(
        `hades's report ${decree} let hermes open ${thread.id}; hades refused (${moved?.id}) and hermes's affinity toward him went ${felt} -> ${feltAfter} by ${cooled[0]?.id}`,
      );
      return { threadId: thread.id };
    },
  );
}

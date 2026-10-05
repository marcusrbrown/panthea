// S17: a contest for favour through the compiled sidecar. Poseidon, at the ferry
// dock where fishers live, tells a legend before them; Athena, who walks to the
// dock and sees it, is offered a contest over it as a choice (a copyable object the
// world's validator already took), and takes it. Over the window each god's
// services count per mortal, from what the mortals there experienced: Athena tells
// two legends to the dock's people and Poseidon none. When the window closes the
// world decides for Athena: her standing at the dock rises and his falls, each
// recorded citing the closing, and Poseidon is offered no new contest over what
// Athena did before it closed.
//
// The scripted part is the gods' choices (a reply is a function of the prompt its
// god was shown, so Athena names only the act she saw); the mortals decide for
// themselves, and the world counts, judges, and changes standing.

import { standingOf, toEntityId } from "@panthea/world";
import { WAIT } from "../provider";
import type { Recorder, Story } from "./context";
import { eventsOfKind, godMoves, nextPrompt, walkTo } from "./practice";
import { check, legend, stateOf, waitFor } from "./support";

/** The window the story runs a contest for, in ticks: `PANTHEA_PRACTICE_BALANCE` shortens the authored five minutes. */
export const CONTEST_WINDOW_TICKS = 25;

const DOCK = "ferry-dock";

/** The act id a prompt offers to contest, read from the copyable object it shows. */
const offeredAct = (prompt: string): string | undefined =>
  /"move":"contest","act":"(evt-[^"]+)"/.exec(prompt)?.[1];

/** Every act id a prompt offers to contest. */
const offeredActs = (prompt: string): string[] =>
  [...prompt.matchAll(/"move":"contest","act":"(evt-[^"]+)"/g)].flatMap(
    (match) => (match[1] === undefined ? [] : [match[1]]),
  );

export async function stepContest(
  recorder: Recorder,
  story: Story,
): Promise<void> {
  await recorder.run(
    "S17",
    "A contest for favour: decided by what the mortals experienced, standing changes for good, and the loser is offered no new contest over what it already lost",
    "Poseidon tells a legend before the mortals at the ferry dock and Athena, standing there, is offered a contest over it as a choice; she takes it, and the world records the contest with her rival and the window. Over the window she tells two legends to the dock's people and he tells none, so the mortals there favour her; at the window's end the world closes the contest decided for Athena, her standing at the dock rises and Poseidon's falls, each recorded as a motif citing the closing, and Poseidon's next prompt offers no contest over what Athena did before the close.",
    async (step) => {
      await walkTo(story, "athena", DOCK);

      // The rival act: Poseidon tells a legend, and some mortal is there to hear it.
      let act:
        | {
            id: string;
            reached: readonly string[];
            perceivedBy: readonly string[];
          }
        | undefined;
      for (let tries = 0; tries < 6 && act === undefined; tries += 1) {
        await godMoves(
          story,
          "poseidon",
          legend("The sea feeds the dock, and the sea takes what it is owed."),
          "poseidon tells a legend at the dock",
        );
        const kept = (await stateOf(story)).services.find(
          (candidate) =>
            candidate.kind === "legend" &&
            candidate.god === "poseidon" &&
            candidate.place === DOCK,
        );
        if (kept !== undefined) act = kept;
      }
      check(
        act !== undefined,
        "the world kept Poseidon's legend as an act a rival can contest: it reached mortals at the dock",
        "no mortal was at the dock to hear it",
      );
      check(
        (act?.perceivedBy ?? []).includes("athena" as never),
        "Athena, standing at the dock, perceived it",
        JSON.stringify(act),
      );

      // Athena is offered the contest as a choice and takes it.
      const before = (await stateOf(story)).contests.size;
      const opening = await godMoves(
        story,
        "athena",
        (seen) => {
          const offered = offeredAct(seen.prompt);
          // With no contest offered she only waits, and the step fails on it, naming what her prompt held.
          if (offered === undefined) return WAIT;
          return JSON.stringify({
            action: "practice",
            move: "contest",
            act: offered,
          });
        },
        "athena opens a contest over the legend she saw",
      );
      const state = await stateOf(story);
      const contest = [...state.contests.values()].at(-1);
      check(
        state.contests.size === before + 1 &&
          contest !== undefined &&
          contest.status === "open" &&
          String(contest.opener) === "athena" &&
          String(contest.rival) === "poseidon" &&
          String(contest.place) === DOCK &&
          contest.cause === act?.id,
        "the world holds an open contest between Athena and Poseidon at the dock, resting on his legend",
        JSON.stringify(contest),
      );
      if (contest === undefined) throw new Error("no contest");
      check(
        contest.closesAt - contest.openedTick === CONTEST_WINDOW_TICKS,
        `the window is the ${CONTEST_WINDOW_TICKS} ticks the story set`,
        `${contest.openedTick} to ${contest.closesAt}`,
      );
      const openedEvent = eventsOfKind(
        story,
        "contest-opened",
        (e) => e.cause === act?.id,
      )[0];
      check(
        openedEvent?.entityId === "athena" &&
          openedEvent.rival === "poseidon" &&
          openedEvent.closesAt === contest.closesAt,
        "the opening is a primary event naming the god, its rival, and the window's last tick",
        JSON.stringify(openedEvent),
      );
      check(
        opening.outcome === "committed",
        "Athena's move committed",
        `${opening.outcome} ${opening.reason}`,
      );

      // Over the window Athena serves the dock's people and Poseidon does not.
      for (const told of [
        "The olive grows where the sea cannot reach.",
        "Wisdom feeds the dock better than the sea does.",
      ]) {
        await godMoves(story, "athena", legend(told), "athena tells a legend");
      }
      const served = (await stateOf(story)).contests.get(contest.id);
      check(
        (served?.tallies ?? []).some(
          (t) => String(t.god) === "athena" && t.weight > 0,
        ) && !(served?.tallies ?? []).some((t) => String(t.god) === "poseidon"),
        "the mortals who heard Athena are counted for her, and none for Poseidon, who did nothing since the contest opened",
        JSON.stringify(served?.tallies),
      );

      // The window closes: the world decides, and standing changes for good.
      const closed = await waitFor(
        "the contest closes",
        async () => {
          const now = (await stateOf(story)).contests.get(contest.id);
          return now !== undefined && now.status !== "open" ? now : undefined;
        },
        { timeoutMs: 120_000, intervalMs: 500 },
      );
      check(
        closed.status === "decided" &&
          String(closed.winner) === "athena" &&
          closed.reason === "window" &&
          closed.closedTick === contest.closesAt,
        "the contest closed decided for Athena at the last tick of its window",
        JSON.stringify(closed),
      );
      const ending = eventsOfKind(
        story,
        "contest-closed",
        (e) => e.contestId === contest.id,
      )[0];
      const favoured = (ending?.favoured ?? []) as { god: string }[];
      check(
        ending?.result === "decided" &&
          favoured.length > 0 &&
          favoured.every((f) => f.god === "athena"),
        "the closing records the mortals' favour, all of it Athena's",
        JSON.stringify(ending),
      );
      const standing = eventsOfKind(
        story,
        "motif-applied",
        (e) => e.effect === "standing" && e.cause === ending?.id,
      );
      check(
        standing.length === 2 &&
          standing.some(
            (e) =>
              e.entityId === "athena" &&
              e.motif === "standing-won" &&
              e.place === DOCK &&
              Number(e.delta) > 0,
          ) &&
          standing.some(
            (e) =>
              e.entityId === "poseidon" &&
              e.motif === "standing-lost" &&
              e.place === DOCK &&
              Number(e.delta) < 0,
          ),
        "Athena's standing at the dock rose and Poseidon's fell, each a motif citing the closing",
        JSON.stringify(standing),
      );
      const after = await stateOf(story);
      const rise = standingOf(after, toEntityId("athena"), toEntityId(DOCK));
      const fall = standingOf(after, toEntityId("poseidon"), toEntityId(DOCK));
      check(
        rise > 0 && fall < 0,
        "the committed state holds the new standing: it outlasts the window",
        JSON.stringify({ rise, fall }),
      );

      // The loser is offered no new contest over what the closed one already settled.
      const prompt = await nextPrompt(
        story,
        "poseidon",
        story.provider.requests.length,
        "poseidon's next prompt after the close",
      );
      // Another god's act, still young enough to contest (Hera's blessing at the dock, from an earlier step), may be offered to him; what the closed contest settled may not.
      const athenas = after.services
        .filter((held) => held.god === "athena")
        .map((held) => String(held.id));
      const offered = offeredActs(prompt.prompt);
      check(
        athenas.length > 0 && offered.every((act) => !athenas.includes(act)),
        "Poseidon is offered no contest over Athena's legends: they came before the close",
        `offered ${offered.join(", ") || "none"}; Athena's acts ${athenas.join(", ")}`,
      );

      step.done(
        `poseidon's legend ${act?.id} let athena open ${contest.id} (${openedEvent?.id}); her two legends reached the dock's mortals and his none, ${ending?.id} closed it decided for athena: her standing at the dock went to ${rise}, his to ${fall}`,
      );
    },
  );
}

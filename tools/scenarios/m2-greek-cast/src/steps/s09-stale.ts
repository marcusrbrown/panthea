// S9: a god's proposal built from a snapshot the world has since moved past is
// rejected as stale-target, with no effect; the same proposal in an unchanged
// world commits. The proposal is a strike, which pins the god, its location, and
// the building: report, travel, legend, and bless pin nothing, so they are never
// stale (the validator judges their conditions at commit time instead).

import { outcomeOf } from "../../../m1-living-world/src/steps/api";
import { eventsOf } from "../../../m1-living-world/src/steps/direct";
import type { Recorder, Story } from "./context";
import { walkTo } from "./practice";
import {
  check,
  lastInputOrder,
  locationOf,
  postFixture,
  waitForConsumed,
  waitForModelProposal,
  within,
} from "./support";

/** Hera's held turn: a light strike on the old oak (no one's, so no one prays about it), which pins her, her location, and the building. */
const STRIKE = JSON.stringify({
  action: "strike",
  target: "old-oak",
  power: 1,
});

/** Holds a Hera strike turn in flight, optionally changes the world, releases it, and returns how it ended. */
async function heldTurn(story: Story, changeWorld: boolean) {
  const after = lastInputOrder(story);
  const held = story.provider.hold("hera", STRIKE);
  await within("hera's turn is in flight", held.arrived, 30_000);
  if (changeWorld) {
    // While the model thinks, Hera is moved by a fixture: her revision and her
    // location's change.
    await postFixture(
      story,
      "hera",
      { kind: "move", to: "tavern" },
      "hera is moved while her turn is in flight",
    );
    const at = await locationOf(story, "hera");
    check(at === "tavern", "hera stands at the tavern", String(at));
  }
  held.release();
  const journaled = await waitForModelProposal(
    story,
    "hera",
    "strike",
    after,
    "hera's held turn is journaled",
  );
  const consumed = await waitForConsumed(
    story,
    journaled.proposalId,
    "hera's held proposal is taken by a tick",
  );
  return { consumed, observationId: String(journaled.proposal.observationId) };
}

export async function stepStale(
  recorder: Recorder,
  story: Story,
): Promise<void> {
  await recorder.run(
    "S9",
    "Stale god proposal rejected",
    "A god's strike (which pins the god, its location, and the building), built from a snapshot the world has since moved past (the god itself was moved while the model thought), is rejected as stale-target and causes no event; the same proposal in an unchanged world commits.",
    async (step) => {
      // Hera travels to the square, where the old oak stands.
      await walkTo(story, "hera", "town-square");
      const unchanged = await heldTurn(story, false);
      check(
        unchanged.consumed.outcome === "committed",
        "in an unchanged world the held proposal commits",
        `${unchanged.consumed.outcome} ${unchanged.consumed.reason}`,
      );
      // She returns to the square for the second try.
      await walkTo(story, "hera", "town-square");

      const stale = await heldTurn(story, true);
      check(
        stale.consumed.outcome === "rejected" &&
          stale.consumed.reason === "stale-target",
        "the proposal built before the world moved is rejected as stale-target",
        `${stale.consumed.outcome} ${stale.consumed.reason}`,
      );
      const traced = await outcomeOf(
        story,
        stale.consumed.proposalId,
        "the rejection is in the trace",
      );
      check(
        traced.outcome === "rejected" && traced.reason === "stale-target",
        "the trace records the same rejection",
        `${traced.outcome} ${traced.reason}`,
      );
      check(
        eventsOf(story).every(
          (event) => event.correlationId !== stale.observationId,
        ),
        "the stale proposal caused no event",
        "an event carries its observation",
      );
      step.done(
        `held turn in an unchanged world: committed; the same strike after hera was moved: ${stale.consumed.outcome} (${stale.consumed.reason}), no event`,
      );
    },
  );
}

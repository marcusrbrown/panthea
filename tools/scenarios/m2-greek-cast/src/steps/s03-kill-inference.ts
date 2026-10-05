// S3: SIGKILL during inference. The turn dies with the process and journals
// nothing; after the restart the god reasons afresh and exactly one proposal
// commits.

import { waitForTicks } from "../../../m1-living-world/src/steps/api";
import { eventsOf } from "../../../m1-living-world/src/steps/direct";
import { activeStorePath } from "../../../m1-living-world/src/world-db";
import { readModelRequests } from "../db";
import type { Recorder, Story } from "./context";
import {
  check,
  lastInputOrder,
  legend,
  modelProposals,
  waitFor,
  waitForConsumed,
  within,
} from "./support";

export async function stepKillInference(
  recorder: Recorder,
  story: Story,
): Promise<void> {
  await recorder.run(
    "S3",
    "SIGKILL during inference",
    "A god's turn SIGKILLed while the provider holds its reply journals nothing and leaves no request with a proposal; after the restart the god reasons afresh and exactly one proposal commits.",
    async (step) => {
      const { provider } = story;
      const text = legend("Hera speaks through the kill.");
      const before = lastInputOrder(story);
      const held = provider.hold("hera", text);
      // The fresh turn after the restart answers with the same legend.
      provider.enqueue("hera", text);
      const inFlight = await within(
        "hera's turn is in flight",
        held.arrived,
        30_000,
      );
      const path = activeStorePath(story.dataDir);
      const requestsBefore = readModelRequests(path).length;

      const exitCode = await story.sidecar.stop("SIGKILL");
      const killedAt = Date.now();
      check(exitCode !== 0, "the sidecar was killed", `exit code ${exitCode}`);
      held.release();
      check(
        modelProposals(story, "hera").filter((e) => e.inputOrder > before)
          .length === 0,
        "the killed turn journaled nothing",
        "a proposal appeared",
      );
      check(
        readModelRequests(path).length === requestsBefore,
        "the killed turn left no request in the trace",
        `${requestsBefore} -> ${readModelRequests(path).length}`,
      );

      await story.restart();
      const fresh = await waitFor(
        "hera reasons afresh after the restart",
        () =>
          provider.requests.find(
            (r) => r.god === "hera" && r.n > inFlight.n && r.at > killedAt,
          ),
        { timeoutMs: 30_000 },
      );
      const first = await waitFor(
        "hera's fresh turn journals a legend",
        () =>
          modelProposals(story, "hera").find(
            (e) => e.inputOrder > before && e.kind === "legend",
          ),
        { timeoutMs: 30_000, intervalMs: 50 },
      );
      const consumed = await waitForConsumed(
        story,
        first.proposalId,
        "hera's fresh legend runs",
      );
      check(
        consumed.outcome === "committed",
        "it committed",
        `${consumed.outcome} ${consumed.reason}`,
      );
      // Time for a second proposal, were one coming: Hera's next turn comes after the six other
      // gods' (about one turn a tick each), so a few rotations of the seven.
      await waitForTicks(story, 24, "the world ticks past the fresh turn");
      const legends = modelProposals(story, "hera").filter(
        (e) => e.inputOrder > before && e.kind === "legend",
      );
      check(
        legends.length === 1,
        "exactly one proposal committed for the killed and re-asked turn",
        `${legends.length} legends`,
      );
      const recorded = eventsOf(story).filter(
        (event) => event.correlationId === String(first.proposal.observationId),
      );
      check(
        recorded.length === 1 && recorded[0]?.kind === "legend-recorded",
        "and one legend-recorded event",
        recorded.map((e) => e.kind).join(),
      );
      step.done(
        `hera's turn (request ${inFlight.n}) killed in flight: no journal row, no trace row; after the restart she was asked again (request ${fresh.n}) and exactly ${legends.length} legend committed`,
      );
    },
  );
}

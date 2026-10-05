// S2: SIGKILL after a god's turn journaled. The proposal survives, runs
// exactly once after the restart, and its trace links to its request; while it
// waits (the world is paused) no god is asked anything.

import { readFrame, waitForLog } from "../../../m1-living-world/src/steps/api";
import { eventsOf } from "../../../m1-living-world/src/steps/direct";
import { activeStorePath } from "../../../m1-living-world/src/world-db";
import { readModelRequests } from "../db";
import type { Recorder, Story } from "./context";
import {
  check,
  lastInputOrder,
  legend,
  proposalsOf,
  waitFor,
  waitForConsumed,
  waitForModelProposal,
  within,
} from "./support";

export async function stepKillJournal(
  recorder: Recorder,
  story: Story,
): Promise<void> {
  await recorder.run(
    "S2",
    "SIGKILL after a god's turn journaled",
    "A god's turn journaled and then SIGKILLed before any tick is still pending after the restart, with the trace linking it to its request; while it waits no god is asked anything; once the world runs it commits exactly once; and only then does the god take another turn.",
    async (step) => {
      const { provider } = story;
      const after = lastInputOrder(story);
      const held = provider.hold(
        "zeus",
        legend("Zeus speaks before the kill."),
      );
      await within("zeus's turn is in flight", held.arrived, 20_000);
      // Pause: a turn in flight still journals, and nothing runs it.
      const paused = await story.sidecar.request("POST", "/pause");
      check(
        paused.status === 200,
        "POST /pause answers",
        String(paused.status),
      );
      await waitFor(
        "the frame reports paused",
        async () =>
          (await readFrame(story.sidecar)).frame.status === "paused"
            ? true
            : undefined,
        { timeoutMs: 5000 },
      );
      held.release();
      const entry = await waitForModelProposal(
        story,
        "zeus",
        "legend",
        after,
        "zeus's turn journals while the world is paused",
      );
      check(
        entry.consumedTick === undefined,
        "the journaled proposal is pending: no tick ran it",
        String(entry.consumedTick),
      );
      const path = activeStorePath(story.dataDir);
      const request = readModelRequests(path).find(
        (r) => r.proposalId === entry.proposalId,
      );
      check(
        request?.role === "zeus",
        "the trace linked the request to the proposal before it was journaled",
        JSON.stringify(request),
      );

      const exitCode = await story.sidecar.stop("SIGKILL");
      check(exitCode !== 0, "the sidecar was killed", `exit code ${exitCode}`);
      const onDisk = proposalsOf(story).find(
        (e) => e.proposalId === entry.proposalId,
      );
      check(
        onDisk?.consumedTick === undefined && onDisk !== undefined,
        "the pending proposal is in the journal after the kill",
        JSON.stringify(onDisk),
      );

      const restarted = await story.restart();
      await waitForLog(
        restarted,
        "startup catch-up complete",
        "the startup catch-up after the kill finishes",
      );
      const askedBefore = provider.requests.length;
      await Bun.sleep(2500);
      check(
        provider.requests.length === askedBefore,
        "no god is asked anything while the restarted world is paused with the proposal pending",
        `${provider.requests.length - askedBefore} requests in 2.5 s`,
      );
      check(
        proposalsOf(story).find((e) => e.proposalId === entry.proposalId)
          ?.consumedTick === undefined,
        "the proposal is still pending while paused",
        "consumed",
      );

      const askedAtResume = provider.requests.length;
      const resumed = await restarted.request("POST", "/resume");
      check(
        resumed.status === 200,
        "POST /resume answers",
        String(resumed.status),
      );
      const consumed = await waitForConsumed(
        story,
        entry.proposalId,
        "the killed turn's proposal ran after the restart",
      );
      check(
        consumed.outcome === "committed",
        "it committed",
        `${consumed.outcome} ${consumed.reason}`,
      );
      const observationId = String(entry.proposal.observationId);
      const caused = eventsOf(story).filter(
        (event) => event.correlationId === observationId,
      );
      check(
        caused.length === 1 && caused[0]?.kind === "legend-recorded",
        "it ran exactly once: one legend-recorded event",
        caused.map((e) => e.kind).join(),
      );
      const again = await waitFor(
        "the god takes another turn once its proposal is consumed",
        () =>
          provider.requests.find(
            (r, index) => index >= askedAtResume && r.god === "zeus",
          ),
        { timeoutMs: 20_000 },
      );
      step.done(
        `zeus's legend journaled while paused and SIGKILLed still pending (run at tick ${consumed.consumedTick} after the restart); after the restart 0 requests in 2.5 s while paused; after resume it committed once (1 legend-recorded), then zeus was asked again (request ${again.n})`,
        [
          {
            name: "requests while paused with the proposal pending",
            unit: "requests",
            value: 0,
          },
        ],
        [
          "The service dispatches a turn only after a live tick, and a tick consumes every pending proposal first, so at process level a pending proposal and a new turn for its god cannot coexist except across a pause; the pending-proposal gate itself is unit-tested in apps/simulation/src/agents.test.ts.",
        ],
      );
    },
  );
}

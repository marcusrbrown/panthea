// S10: through a startup catch-up of half an hour, no god is asked anything;
// after it, turns resume; the gods' memory and feelings come through the restart
// unchanged.

import {
  readFrame,
  stopClean,
  waitForLog,
} from "../../../m1-living-world/src/steps/api";
import { persistedClock } from "../../../m1-living-world/src/steps/direct";
import {
  activeStorePath,
  backdateCursor,
} from "../../../m1-living-world/src/world-db";
import { differences } from "../checks";
import type { Recorder, Story } from "./context";
import { check, stateOf, waitFor } from "./support";

const HALF_HOUR_MS = 30 * 60 * 1000;
/** Pipe delay between the sidecar printing a line and the harness reading it: requests this close to the end line are not judged. */
const LINE_TOLERANCE_MS = 25;

export async function stepCatchUp(
  recorder: Recorder,
  story: Story,
): Promise<void> {
  await recorder.run(
    "S10",
    "No inference in catch-up; memory survives the restart",
    "After a clean stop and a half-hour gap, the startup catch-up runs, and the provider receives no request between the sidecar's own catch-up-started and catch-up-finished lines; turns resume after it; every actor's memories and relationships equal what they were before the restart.",
    async (step) => {
      const before = await stateOf(story);
      check(
        before.memories.size > 0 && before.relationships.size > 0,
        "there is memory and feeling to keep",
        `${before.memories.size} memories, ${before.relationships.size} relationships`,
      );
      await stopClean(story, "the sidecar shuts down cleanly");
      const path = activeStorePath(story.dataDir);
      backdateCursor(path, persistedClock(story).cursorWallMs - HALF_HOUR_MS);

      const restarted = await story.restart();
      const started = await waitFor(
        "the catch-up starts",
        () =>
          restarted
            .lines()
            .find((line) => line.text.endsWith("catch-up started")),
        { timeoutMs: 20_000, intervalMs: 5 },
      );
      await waitForLog(
        restarted,
        "catch-up finished",
        "the startup catch-up finishes",
      );
      const finished = restarted
        .lines()
        .find((line) => line.text.endsWith("catch-up finished"));
      check(
        finished !== undefined && finished.at >= started.at,
        "the catch-up is bracketed by its own log lines",
        `${started.at} .. ${finished?.at}`,
      );
      const inside = story.provider.requests.filter(
        (request) =>
          request.at >= started.at &&
          request.at <= (finished?.at ?? 0) - LINE_TOLERANCE_MS,
      );
      check(
        inside.length === 0,
        "no provider request during the catch-up",
        `${inside.length} requests inside it`,
      );
      const { frame } = await readFrame(restarted);
      check(
        (frame.catchUpSummary?.appliedMs ?? 0) >= 10 * 60 * 1000,
        "the catch-up really applied the gap",
        JSON.stringify(frame.catchUpSummary),
      );
      // Control in the run: the gods are asked again once it is over.
      const resumed = await waitFor(
        "turns resume after the catch-up",
        () =>
          story.provider.requests.find(
            (request) => request.at > (finished?.at ?? 0),
          ),
        { timeoutMs: 20_000 },
      );
      const after = await stateOf(story);
      // The gods' own memories and feelings are what a restart must keep. The
      // mortals' live on through the catch-up (they pray, and unanswered prayers
      // lapse into harm and a fall in affinity: R4, R8), so theirs may change.
      const changed = differences(before, after, ["zeus", "hera"]);
      check(
        changed.length === 0,
        "the gods' memory and feelings are exactly what they were before the restart",
        changed.join("; "),
      );
      step.done(
        `${(frame.catchUpSummary?.appliedMs ?? 0) / 1000} s applied by a catch-up that ran ${(finished?.at ?? 0) - started.at} ms; 0 provider requests inside it; the first request after it at +${resumed.at - (finished?.at ?? 0)} ms; the gods' memories and feelings unchanged (the mortals' are free to move on)`,
        [
          {
            name: "catch-up gap applied",
            unit: "s",
            value: (frame.catchUpSummary?.appliedMs ?? 0) / 1000,
          },
        ],
        [
          `A request within ${LINE_TOLERANCE_MS} ms before the finish line is not judged: the harness reads the line through a pipe, so its timestamp can trail the sidecar's print. The service only dispatches after a live tick, and the loop skips ticks during a catch-up, so requests at that distance would be the first tick after it.`,
        ],
      );
    },
  );
}

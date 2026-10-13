---
title: The studio preview must compare the recorded step and follow clip timing after a refresh
date: 2026-10-11
category: logic-errors
module: studio-preview
problem_type: logic_error
component: tooling
severity: medium
symptoms:
  - "The derive side-by-side compared a carried east/west pair instead of the slot the draft had just derived"
  - "Step, Scrub and the frame indicator kept the old frame durations after a revision changed them under the same keys"
  - "A timing refresh that resolved late undid the owner's Play or Scrub"
root_cause: logic_error
resolution_type: code_fix
tags: [studio-preview, side-by-side, derivation, playback-clock, stale-reply, approve-what-you-saw]
---

# The studio preview must compare the recorded step and follow clip timing after a refresh

## Problem

The owner approves what the preview shows, so the preview has to show what will be published. The derived-sprite work (#209, #210) had two places where it didn't.

## Symptoms

- **Wrong comparison.** The side-by-side picked the first source east slot that had a west slot anywhere in the draft. A draft's slots include carried animations, so a draft adding a mirrored `seated/west` beside a carried `idle/east`/`idle/west` compared idle, and the new seated frames were never shown. A bob draft could also be read as a mirror.
- **Stale timing.** The playback clock was configured once per selection. A new revision can change durations, frame count or `loopStart` and keep every key name. When it did, the source emitted `changed` with `listing: false`, but the clock kept the old timing. Scrubbing to frame 2 sought 250.5 ms while the renderer drew 333 ms frames.
- **Lost input.** The first fix read play state and frame before awaiting the new timing. A Play or Scrub made while the resolve was pending was overwritten when the reply arrived, and the Play/Pause label stopped matching the clock.

## What Didn't Work

- Inferring the comparison from the draft's animation list. That list mixes new and carried slots.
- Refreshing the clock with state captured before the await.

## Solution

1. **Compare the first recorded step.** `derivationComparison` (`apps/studio/src/workflow/Workflow.tsx`) reads `provenanceSteps[0]`:
   - **Mirror** compares the recorded source east with the output west.
   - **Bob** compares the same slot before and after.
   - **Palette swap** compares the source slot with its target realm.
   - **No steps** means no comparison is shown, rather than a guess.

   This relies on pack writing new slots' steps first (`packages/assets/src/studio/packing.ts`).
2. **Follow the clip and read live state on reply.** `followClipTiming` (`apps/studio/src/harness/layout.ts`):
   - re-resolves whenever the source reports a change to the followed selection;
   - drops replies older than the latest request;
   - reads the clock when the reply arrives.

   ```ts
   const wasPlaying = playback.playing();
   const heldFrame = playback.frame();
   const { durations, loopStart } = clockTiming(resolved.asset);
   playback.configure(durations, loopStart);
   if (refresh && !wasPlaying && durations.length > 0)
     playback.scrub(Math.min(heldFrame, durations.length - 1));
   onTiming(durations, playback.frame(), playback.playing());
   ```

   The reply never changes whether the clock is playing. `onTiming` reports the playing state, so the label follows the clock.

## Prevention

- Pick review views from what the record says happened, never from the full set of slots the draft carries.
- An async reply that updates interactive state reads that state when the reply arrives, and only the newest reply applies.
- A change notice without a listing change can still change timing, so subscribe by selection, not by listing.
- Tests:
  - `apps/studio/src/workflow/Workflow.test.tsx`:
    - "compares the newly mirrored slot, not a carried east/west pair";
    - "compares a palette swap from its source slot to its variant realm";
    - "does not show a comparison when a derived draft has no steps".
  - `apps/studio/src/harness/layout.test.ts`:
    - a timing-only change refreshes the clock;
    - Play pressed while the resolve is pending is not undone by the reply;
    - a Scrub made while the resolve is pending is kept by the reply, on the new timing.

## Related

- `docs/solutions/integration-issues/version-keyed-asset-bridge-live-reload-2026-10-08.md`: selection keys carry the realm.
- `docs/solutions/performance-issues/studio-edit-save-lag-and-unreviewed-finish-2026-10-09.md`: carrying the reviewed version through to the action.

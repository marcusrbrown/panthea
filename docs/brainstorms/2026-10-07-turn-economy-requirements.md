---
date: 2026-10-07
topic: turn-economy
---

# Gods Answer Prayers From Where They Stand

## Summary

A god can answer a prayer addressed to it from wherever it stands. In one turn, without walking first, it can bless the mortal who prayed, strike the wrongdoer the prayer names or a building of the wrongdoer's that it lists, offer terms on the prayer, or refuse it. Every other act keeps today's rules.

---

## Problem Frame

Two rated seven-god gates ran on 2026-10-07: `tools/scenarios/m2-greek-cast/episodes/2026-10-07T00-52-07/`, and `2026-10-07T02-58-12/` after the legend fix.

**Few turns, mostly spent walking.** One local model serves all seven gods, about 28–34 requests per 5-minute episode, which is 4–5 turns per god. In the first gate, 63 of 71 committed actions were walks to where a mortal stood. In the second, 56 of 102 were.

**Blessing costs two turns.** The world accepts a blessing only from a god standing with the mortal, and the prompt tells a god to travel before blessing or striking for a distant prayer. So an answered prayer costs two turns, and the second comes a whole turn gap later: the per-god queue wait p95 was 62–115 ticks, against a 150-tick prayer lapse.

**Prayers lapse unanswered.**
- In the first gate, 41 of 105 prayers lapsed and 2 were answered.
- In the second, 36 lapsed and 6 were answered.
- With so few answers, no mortal defected, because defection needs another god to have answered it. No god opened a demand or contest against another.

**Presence is not a requirement.**
- The world hears prayers from anywhere already. The prompt tells a god it hears prayers wherever it is, and a god learns of a mortal's wrong only through a prayer about it.
- Refusing a prayer already works from anywhere.
- No requirement or owner decision says a god must be present to act. Presence for blessing comes from the world's validator and from the god's side, which offers a blessing only for a mortal standing with it. The walk-first instruction is prompt text.

---

## Actors

- A1. Gods: the seven Olympians, driven by the model, each receiving prayers addressed to it.
- A2. Inhabitants: routine-driven mortals who pray to a god and are blessed, struck or answered.

---

## Requirements

**Answering from afar**
- R1. A god may bless the mortal whose open prayer is addressed to it, wherever the god stands. This includes a boon the god owes under accepted terms on that prayer.
- R2. A god may strike the wrongdoer an open prayer addressed to it asks it to punish, or a building of the wrongdoer's that the prayer lists, wherever the god stands. This includes a strike the god owes under accepted terms on that prayer.
- R3. A god may offer terms on an open prayer addressed to it (a supplication), wherever the god stands.
- R4. A god may refuse an open prayer addressed to it from anywhere, as today.

**Everything else unchanged**
- R5. Any act that doesn't answer an open prayer addressed to the god keeps today's rules. Blessing unprompted still needs the god present, and legends and reports are still told to those present. Demands, contests and settlements between gods keep their current checks, and no new presence check is added to them.

**World authority and perception**
- R6. The world checks every blessing or refusal made from afar: the prayer is open, it is addressed to this god, and the target is the mortal who prayed. Strikes keep today's world rules, so a god may strike anywhere. A strike answers a punish prayer only if it hits the named wrongdoer or a listed building while that prayer is still open. The god's side offers strike targets only from the prayers it was shown. The god's abilities and power rules apply unchanged.
- R7. An answer made from afar takes effect at the target's place. Those present there perceive it as they would any act at that place, and they don't learn where the god is. The answer doesn't move the god. Those standing with the god see it spend divinity, as they do today.

**Prompt**
- R8. For a distant prayer, the god's prompt offers each answer as a move the god can copy and send as written, with no travel step. Travel is no longer shown as the way to answer a prayer.

---

## Acceptance Examples

- AE1. **Covers R1, R8.** Given the farmer in the agora prays to Hera for help while Hera stands at the harbour, Hera's prompt offers a blessing she can copy and send as written, with no walk. When she sends it, the world accepts it that tick and the prayer is answered.
- AE2. **Covers R2, R7.**
  - **Given:** Doris prays to Poseidon to punish Lykos, who stole from her. Poseidon is on the mountain, and Lykos is in the market.
  - **When:** Poseidon strikes Lykos.
  - **Then:**
    - the world accepts the strike;
    - Lykos loses goods as a strike takes them;
    - mortals in the market perceive the strike;
    - nobody in the market learns where Poseidon is.
- AE3. **Covers R5.** Given Hera is far from a mortal who hasn't prayed to her, when she tries to bless that mortal, the world refuses it as it does today.
- AE4. **Covers R6.** Given a prayer addressed to Zeus, when Hera tries to bless its petitioner from afar, the world refuses it.

---

## Success Criteria

- **One turn per answer:** a god answers a distant prayer in a single turn. The scripted story proves this through the real service for a blessing and for a punishing strike, each with a positive control.
- **What this promises:** it removes the walk from a prayer answer. It doesn't promise fewer lapsed prayers or more disputes between gods. Whether a god chooses to answer before a prayer lapses is model behaviour, and changing that is separate work.
- **Measured in the next rated gate:** it reports the actions spent on prayer answers versus walks, and the prayers answered versus lapsed, against the two 2026-10-07 gates. These are measured, not targets. The owner rejected tuning to the 5-minute episode before the system is built.
- **Clean handoff:** planning can proceed without inventing which acts work from afar, what the world checks, or what the prompt shows.
- Status (2026-10-07), measured in the first rated gate after the change (`tools/scenarios/m2-greek-cast/episodes/2026-10-07T14-02-54/`, 3 × 300 s on qwen3-8b-4k, exit 1, 43 failed checks of 186): the one-turn answer is proven in the scripted story (S26, S27) and the wasted requests on answers fell (0 refused blesses, 0 exhausted requests), but walks did not fall (63, 56, 57 across the three gates), direct answers fell from 6 to 3 (all Zeus's owed boon), and 37 of 40 closed prayers lapsed. The promise was the removal of the walk, not fewer lapses or more disputes; the model walked on 46% and reported on 35% of the turns where a prayer was open, so whether a god chooses to answer is, as written, model behaviour. The owner rates.

---

## Scope Boundaries

- Scheduler priority for gods with open prayers stays deferred.
- No free travel and no "go there and act" moves.
- No change to the 150-tick prayer lapse or any other world rate.
- Acts that don't answer a prayer keep today's rules.
- How the renderer depicts an act made from afar is out of scope.
- This doesn't aim to make gods choose disputes with each other. SC4 and SC5 of `docs/plans/2026-10-05-001-feat-mortal-wrongs-plan.md` (a dispute between gods, and initiative from every god) are model behaviour and may still fail.

---

## Key Decisions

- **Remote answers only.** We chose answering prayers from afar over two alternatives:
  - letting a god act from afar on anything it perceives, which makes travel nearly meaningless;
  - making travel free with a queued act on arrival, which adds new state and edge cases and still delays the act by the journey.

  The prayer is already the god's way of perceiving the need, so answering it from afar adds no new perception path.
- **No scheduler change.** Removing the walk removes the second turn. Priority would tune for episode throughput, which the owner rejected.
- **Cheap punishment is accepted.** A god can strike any wrongdoer a worshipper names, from across the map. That likely means more strikes, prayers about harm and revenge chains: the cause for quarrels between gods that the mortal-wrongs work wanted.

---

## Dependencies / Assumptions

- **Depends on #153:** that PR adds the copyable legend and report lines. R8's answer moves sit beside them in the same instructions.
- **Strikes on buildings:** the world already accepts these without a location check (`packages/world/src/validate.ts`), but the prompt tells gods to walk first. R8 covers the prompt side only for strikes that answer a prayer.
- **Bless on the god's side:** blessing from afar also needs the god's side to change, not only the world's validator. Today that side offers and builds a blessing only for a petitioner who stands with the god.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] Find every point on the god's side that limits a blessing to a petitioner standing with the god: the action list, the parser and the proposal builder.
- [Affects R8][Technical] Re-measure the busiest prompt against the 10,500-character guard once the travel-first lines are replaced.

---

## Sources / Research

- **Rated gates:** `tools/scenarios/m2-greek-cast/episodes/2026-10-07T00-52-07/summary.md` and `2026-10-07T02-58-12/summary.md`. They give the action mix, prayers answered and lapsed, and per-god queue wait.
- **Validators:** `packages/world/src/validate.ts`. Bless requires co-location, refuse works from anywhere, and a strike on a building has no location check.
- **Punish prayers:** `packages/world/src/petitions.ts`. A prayer to punish names the offender and lists its buildings.
- **Prompt:** `packages/agents/src/context.ts`. Prayers are heard wherever the god is, and distant prayers are answered by travelling first.
- **Scheduler:** `packages/agents/src/scheduler.ts` and `apps/simulation/src/agents.ts`. A turn is one model request, and prayers give no priority.
- **Earlier deferral:** `docs/brainstorms/2026-10-05-mortal-wrongs-requirements.md` deferred scheduler priority for harm and defection.

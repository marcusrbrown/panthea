---
date: 2026-10-10
topic: m3-playable-consequences
---

# M3: Playable consequences

## Summary

M3 lets the owner live in the world as a mortal. It is built in five phases plus the exit play-through, and each one is proven by its own causal scenario:

1. **A mortal in the town.** A new mortal who works, trades, travels, prays, talks with gods and mortals, and leaves and comes back.
2. **Interruption and artifacts.**
3. **Conflict.**
4. **Death and the Underworld.**
5. **Defeated gods, realm rules and transformation.**

The exit play-through covers strike, response, loss, afterlife, return and recovery. The player's acts enter the world the same way every other actor's do, and the world judges them the same way.

---

## Problem Frame

M2 ended with seven gods and twenty mortals living unattended for an hour (roadmap, M2 outcome). The client is still a read-only observer. It renders the realms, follows actors and lists events, but it has no world controls, and nobody can take part.

The brief's central promise is "watching is entertaining, participation matters, consequences persist." The discovery interview asks for a player who can "create a mortal, travel, converse, buy, sell, and use artifacts." It ranks "death, transformation, grudges, alliances, and shortages" as the consequences that matter most.

**Status.** Requirements M01–M08 and W11 are planned, and W09 is partial (traceability). Some groundwork exists:
- Destruction and repair (W08) and the director (W10) are implemented.
- The world validates realm transitions, trade, consumption, repair, strikes, worship and petitions.
- A mortal's defection is recorded privately to the two gods involved, and the god left behind can contest it. This is M04 groundwork; M04 itself is still planned.

**What is missing.** The following were not found in the code inspected for this brainstorm. Repository-wide absence was not verified.
- A mortal entry or control path, and a proposal source for player acts.
- An event that adds an actor after genesis.
- Speech events, and memories of words.
- Artifacts.
- Mortal combat, equipment and ingestion effects, a death transition, and god banishment.

The Underworld is scaffolded (W02). Its judgment hall is gated to divine actors.

**Why it matters now.** In M2, prayers lapsed and gods rarely came to town (roadmap, M2 outcome, items 2 and 4). For an observer that is a statistic. For a player who prays, pays and waits, it is the experience.

---

## Actors

- A1. **Player:** the owner, playing one mortal through the client. Can leave to observe and come back.
- A2. **Player's mortal:** the in-world actor. A1 controls it when present, and its routine controls it when A1 is away.
- A3. **Gods:** the seven model-driven gods. They answer the player's speech in their own voice, or with an act.
- A4. **Mortals:** the authored inhabitants. They act from routine and answer speech from their own state, without a model.
- A5. **World:** the authoritative simulation. It validates and records every act, whoever proposes it.

---

## Key Flows

- F1. **Enter as a new mortal**
  - **Trigger:** A1 chooses to play.
  - **Actors:** A1, A2, A5.
  - **Steps:**
    1. A1 names a mortal and picks a look from the existing sprites.
    2. A1 picks an allowed spawn and a trade, and either a patron or none.
    3. The world accepts the mortal, or refuses it with a reason. A1's choices survive a refusal.
    4. A1 takes control.
  - **Outcome:** a new mortal exists with a livelihood, starting goods and a routine.
  - **Covered by:** R1, R2, R3.
- F2. **Speak to a god**
  - **Trigger:** A1 types to a god.
  - **Actors:** A1, A2, A3, A5.
  - **Steps:**
    1. If the god is present, the words open a request that the god owes an answer. The god answers on its next turn, in its own voice or with an act.
    2. If the god is absent, the words become a plea with a prayer's answer window, and the god may choose to come.
    3. A1 sees the request's state: waiting, answered, refused or lapsed, each with its reason.
  - **Outcome:** the god answered, refused or came, or the plea lapsed visibly.
  - **Covered by:** R8, R9, R10, R11, R13.
- F3. **Leave and come back**
  - **Trigger:** A1 leaves play or closes the window. Both count as leaving.
  - **Actors:** A1, A2, A5.
  - **Steps:**
    1. Leaving is recorded.
    2. The mortal's routine takes over with full vulnerability.
    3. The world continues, and A1 sees a visible away state.
    4. On return, A1 sees what happened to the mortal first, with applied and skipped time, and resumes the same identity.
  - **Outcome:** the same mortal, changed only by what the world did.
  - **Covered by:** R3, R16, R17.
- F4. **Die and return**
  - **Trigger:** the player's mortal dies.
  - **Actors:** A1, A2, A3, A5.
  - **Steps:**
    1. A1 is told at once, or on return if away.
    2. The mortal goes to its default afterlife, which its spawn realm sets. The influence of its patron and its killer is recorded.
    3. A1 plays in the Underworld, where the return condition is hinted.
    4. A1 meets the return condition and returns, or retires the mortal after confirming.
  - **Outcome:** a returned mortal with its history, or a retired one whose history is kept.
  - **Covered by:** R25, R26, R27, R28, R29.

---

## Requirements

**Phase 1: a mortal in the town**

*Entry and acts*
- R1. The player creates a mortal from the following choices. The mortal enters the running world as an ordinary inhabitant (M01).
  - a name;
  - a look from the existing sprites;
  - a spawn among those the content allows a mortal;
  - one of the town's existing trades;
  - a patron, or none.
- R2. The trade gives the mortal the starting goods, workplace and routine that an authored inhabitant of that trade has.
- R3. Every act by the player's mortal enters as a proposal through the same validation and journal as every other actor's. The client never decides an outcome (W05).
  - Creating a mortal, taking control and giving it up are also recorded inputs. Replays and the away summary therefore depend only on what was recorded.
- R4. The player moves, and travels between places and realms wherever the content allows a mortal (W02). The player acts in context:
  - work;
  - exchange goods;
  - pray;
  - make an offering of goods or coin to a god, which the god perceives;
  - choose a new patron.
- R5. Every act is reachable by keyboard, pointer and controller. A controller player types through an on-screen text entry with quick phrases (M02).
- R6. An act that cannot happen now is shown disabled, with its reason. An act the world refuses shows the world's reason.
- R7. Time controls stay at pause and normal speed (defaults).

*Talk*
- R8. The player can type free text to any actor present. Who is present and addressable is shown (M02).
- R9. Words to a present god open a request that the god owes an answer. The god answers on its next turn rather than in normal rotation, either in its own voice or with an act: bless, strike, refuse or offer terms.
- R10. Words to an absent god become a plea with a prayer's answer window and lapse. A god spoken to by name, or prayed to at its altar, may choose to come to the player on its turn.
- R11. The player sees each request's state, with its reason: waiting, answered, refused or lapsed. An answer that arrives while the player is away appears in the return summary.
- R12. A mortal spoken to keeps the words as a memory and answers with a short line drawn from its own state: need, grudge, temperament, trade and patron. No model is involved.
- R13. Speech is recorded in history. Only actors present perceive it, under the perception rules (W04).

*Patron and pressure*
- R14. Choosing a new patron is recorded as the mortal's defection, under the existing patron-change rules. The god left and the god joined both perceive it (M04).
- R15. The player's mortal lives under the world's existing pressures:
  - other mortals can wrong it;
  - grudges against it change what those mortals do;
  - shortages can leave it hungry or unable to buy (W06, W09).

*Absence*
- R16. Playing, observing and away are each visibly distinct. Leaving hands the mortal to its routine with full vulnerability, and the world continues (M07, A07).
- R17. On return, the player resumes the same identity. A summary shows what happened to the mortal first, with applied and skipped time (A07, A08).

*Phase gates*
- R18. Queue wait is re-measured with player speech before phase 2 starts (ADR-0005, O08). If it misses the target, R9's priority is narrowed or the target is re-argued with evidence.
- R19. The owner rates a play session on the acceptance rubric after phase 1 and again after phase 3. The next phase starts only when no dimension scores 0.

**Phase 2: interruption and artifacts**
- R20. Fire, an attack, travel or another actor's arrival interrupts or redirects a conversation, and the world does not freeze (M03, A05).
  - Pending responses revalidate before they apply.
  - An unsent draft survives the interruption.
  - A sent line dropped by revalidation is shown with its cause.
- R21. The player can buy, sell and hold artifacts. Transfers conserve goods and money (M04).
- R22. Equipping or ingesting an artifact applies a recorded effect that changes something the world judges (M04).

**Phase 3: conflict**
- R23. The player can fight, flee, persuade, or call or summon their patron. Each act has a valid resolution path (M05).
- R24. Conflict runs in asynchronous turns while world time continues (D09). Timing is a tunable rule and does not depend on frame rate.
  - Each turn has readiness, cast and recovery times, costs and cooldowns.
  - The player sees readiness and casting.
  - An idle player falls back to defending or routine after a visible timeout (defaults).

**Phase 4: death and the Underworld**
- R25. Any mortal can die from conflict, a god's strike or another world cause. This includes the player's mortal while the player is away (M06, M07). The player is told at once, or on return.
- R26. Death sends the mortal to its default afterlife, which its spawn realm sets. The world records its patron's and its killer's influence on its fate (M06).
- R27. The player can act and talk in the Underworld, with Hades included.
- R28. A mortal can reach an authored return condition. The condition is hinted in play. Meeting it returns the mortal with its identity and memory (M06).
- R29. The player can retire a mortal permanently from the Underworld or the menu, after a confirmation that it cannot be undone. The mortal's history is kept, and a new mortal can then be created (M07).
- R30. At least one transformation case is reachable in this phase, ahead of phase 5's general rule (W09).

**Phase 5: defeated gods, realm rules and transformation**
- R31. A defeated god enters its configured state, banished or recovering. It returns only through valid conditions, and its core drives stay recognizable (M08, D09).
- R32. A realm modifier changes cost or access. A test realm pack adapts a creation without hard-coded Greek assumptions (W11).
- R33. An explicit effect can change a mortal's form, perception, mind or relationships. It records its provenance. Identity and memory unrelated to the change survive. A changed form uses an existing sprite (W09).

**Phase 6: exit play-through**
- R34. One causal play-through covers the following, in order (roadmap M3 exit):
  1. a strike on the player's mortal or its livelihood;
  2. a response;
  3. a loss;
  4. the afterlife;
  5. a return;
  6. recovery.

**Across phases**
- R35. Everything in M3 works offline after first-run setup. Offline mode never falls back to a hosted provider (P01, P07).
- R36. Queue wait is measured again at M3 exit, with player speech included (ADR-0005, O08).

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given a running world, when the player creates "Kallias", a fisher who spawns in the town with Poseidon as patron, then Kallias appears with a fisher's goods and routine. The creation is a recorded input.
- AE2. **Covers R9, R11, R13.** Given Poseidon is present, when the player says "the nets come up empty", then the request shows as waiting. Poseidon answers on his next turn, in his voice or with an act. Only the actors present perceive the exchange.
- AE3. **Covers R10, R11.** Given Poseidon is absent, when the player types to him, then a plea opens with an answer window. Poseidon either comes on his turn, or the plea shows as lapsed with its reason.
- AE4. **Covers R12, R15.** Given a smith with a grudge against the player's mortal, when the player greets her, then she answers from the grudge, keeps the words as a memory, and refuses to sell.
- AE5. **Covers R16, R17.** Given the player leaves while the mortal is fishing, when a director theft takes its catch, then on return the summary leads with the theft, shows applied and skipped time, and the mortal is the same identity.
- AE6. **Covers R14.** Given the player's patron is Poseidon, when the player chooses Hermes, then a defection is recorded, and both Poseidon and Hermes perceive it.
- AE7. **Covers R20.** Given the player is bargaining with the smith, when the forge ignites, then the bargain is interrupted with its cause shown, no duplicate trade applies, the player's unsent draft remains, and the world keeps running.
- AE8. **Covers R25, R26, R28.** Given the player's mortal is killed by another mortal, then the player is told. The mortal reaches the Underworld with patron and killer influence recorded, and it can meet the hinted return condition to come back with its memory.

---

## Success Criteria

- Each phase's causal scenario runs against the compiled service and passes, with a positive control for each claim.
- The owner's play ratings after phase 1, after phase 3 and at exit have no dimension at 0.
- The exit play-through (R34) passes.
- When the owner plays, the world answers him:
  - a god he speaks to answers, refuses or comes, and he can see which;
  - mortals respond from who they are;
  - consequences persist across absence and death.
- A planner can take one phase at a time without inventing player-facing behavior.

---

## Scope Boundaries

- Mortals speak without a model.
- No new art. Looks and changed forms use the existing sprite set.
- One player. No multiplayer.
- Operator and Universe controls, schedules and generated behavior belong to M4.
- No fast-forward time control (defaults).
- Alliances stay between gods. The player meets them only through their consequences.
- The rest of the M2 tuning list stays on that list, except where M3 depends on a fix.

---

## Key Decisions

- **The player enters as a new mortal with an existing trade.** This meets M01 and gives absence (M07) a real routine to run. Taking over an authored inhabitant was rejected because it is not "create a mortal" and would hand the player someone else's history.
- **Gods speak and mortals answer from state.** The one local model is already near its queue-wait margin with seven gods: in hour 4, p95 reached 102 ticks against a 105-tick target. A model voice for mortals would push the gods over.
- **Speech is its own request.** Practice threads are god-only, and prayers need a known cause, so the player's words get their own request kind. It has an answer, a window and visible outcomes, and nothing lapses silently.
- **The player travels, and gods may come.** Talking with gods is the brief's central experience, and gods rarely come to town. So the player can go to them, and calling a god by name gives it a reason to come.
- **The player's choice of patron is a defection.** It reuses the existing patron-change rules and perception, and the patron default gets a dated note. No separate mechanism is needed.
- **Keyboard, pointer and controller ship together in phase 1.** M02 requires parity, and building all three from the start avoids retrofitting.
- **The owner rates play early.** Ratings after phases 1 and 3 catch a dull or broken loop before most of the work is done. Queue wait is gated at phase 1 for the same reason.
- **Phases go foundation first, then each new risk, then the exit run.** Death comes after conflict, so the Underworld has a mortal cause of death to test as well as a god's strike.

---

## Dependencies / Assumptions

- Player acts reach the world through the service's validated proposal intake, and the client never decides an outcome. The intake for player acts does not exist yet. ADR-0008 limits the webview to frames and receipts.
- Underworld travel is scaffolded, not built for play (W02). The judgment hall is gated to divine actors.
- Artifacts, post-genesis actor entry, and speech events and memories are new world concepts.
- The project is greenfield. If M3 changes the store version, M2 worlds are not migrated.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R3][Owner gate] Planning proposes how player acts enter the service, as an ADR-0008 superseding note covering source, relay and observation. The owner approves it before any building starts.
- [Affects R1, R2][Technical] Which spawns the content allows a new mortal. How a trade maps to an inhabitant's authored fields (gathers, starting inventory, workplace).
- [Affects R5][Technical] The control scheme, the on-screen text entry, and the quick phrases.
- [Affects R9, R10][Technical] How a speech request reaches a god's prompt within the prompt cap. The legal answer set. What makes a god choose to come.
- [Affects R12][Technical] The state-to-line rules for mortal replies, and how much variety they need to avoid repetition.
- [Affects R17][Technical] How the return summary is built from the event log, and its item cap.
- [Affects R21, R22][Technical] Whether artifacts are typed resources or item entities.
- [Affects R24][Needs research] Readiness and cooldown defaults for conflict turns.
- [Affects R27, R28][Needs research] The Underworld's places and actors, where the return condition sits given the gated judgment hall, and the condition itself, drawn from sourced myth variants (D05).
- [Affects R30, R33][Needs research] Which transformation case comes first, and which effects cause transformations.
- [Affects R31][Needs research] What defeats a god, and each god's banished and recovery states.
- [Affects R32][Technical] The test realm pack that shows W11 without Greek assumptions.

---

## Sources

- **Roadmap:** M3 row, M2 outcome and known limits in `docs/product/mvp-roadmap.md`.
- **Requirements:** M01–M08, W02, W04–W06 and W08–W11 in `docs/product/requirements.md`. Statuses are in `docs/product/traceability.md`.
- **Decisions:** D05, D07, D09, D11 and D23 in `docs/product/decisions.md`.
- **Defaults:** conversation, absence, fate, patrons, catch-up and time in `docs/product/defaults.md`.
- **Acceptance:** A05–A08 in `docs/product/acceptance.md`.
- **Proposal intake and client boundary:** `docs/decisions/0008-world-state-and-client-transport.md`.
- **Queue-wait target:** the 2026-10-10 amendment to `docs/decisions/0005-model-providers.md`.
- **Current client:** `apps/client/src/App.tsx` and `apps/client/src/ui/surface.tsx`, which are read only and have no world controls.
- **Underworld content:** `content/greek/world/` (the judgment hall requires the `divine` capability).

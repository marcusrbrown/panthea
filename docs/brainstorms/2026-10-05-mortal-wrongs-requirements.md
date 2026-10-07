---
date: 2026-10-05
topic: mortal-wrongs
---

# Mortals Who Wrong Each Other, and Gods Who Take Sides

## Summary

Inhabitants wrong each other through their temperament and their need. Each belongs to a patron god and prays to it for redress when wronged. When a patron punishes a wrongdoer who worships another god, the two gods have a cause to quarrel. Domain gods answer troubles such as storms, sickness, and broken tools. A god that neglects its prayers loses worshippers, lets feuds grow, and loses standing. Seasons and domain troubles add pressure of their own, hunger becomes occasional, and the director keeps its own clock.

---

## Problem Frame

The seven-god gate on 2026-10-05 ran three unscripted 5-minute episodes on qwen3 8B (`tools/scenarios/m2-greek-cast/episodes/2026-10-05T14-16-36/`). The owner rated it continue, not passing.

Every prayer asked for food. Each episode logged about 1,250 "cannot get food" lines: many inhabitants start without food, food costs 3, and a sale needs a stocked, willing seller in the same place.

No god set a goal. No settlement opened between gods. No god struck or told a legend. Zeus answered none of his 13 prayers, and ignoring a prayer cost him one grudge per episode.

The god-practices design (`docs/brainstorms/2026-10-02-god-practices-requirements.md`) expected causes to come from rivalries, the director, and mortals' losses (R2, R16, R20–R22). None appeared without a script:

- The director never fired. Its quiet measure resets on any bless or answered prayer, so gods answering food prayers every minute keep the world "busy" for good.
- Damage, fire, theft, spoilage, and grudges are already wired as prayer causes. The director makes theft, spoilage, and some fires; strikes make damage and can start fires; memories of signs make grudges. With the director silent and no god striking, none of them occurred.
- A contest opens only when a god perceives a rival's bless, strike, or legend at a place where there are mortals. That rarely happens.
- No god has "its people". A wrong done to one mortal is no god's concern.

M05 requires conflict with valid resolution paths. W04 requires remembered outcomes to change later behavior. The owner's discovery record names repetitive, uneventful play as a failure (`docs/discovery/interview.md`).

---

## Actors

- A1. Gods: the seven Olympians, driven by the model. Each has a patron flock and a domain.
- A2. Inhabitants: twenty mortals driven by routines, with no model. Each has a temperament, a livelihood, a patron, and memories of how each god treated it.
- A3. Director: the world's own source of trouble, independent of any provider.
- A4. Owner: watches episodes and rates the experience gate.

---

## Key Flows

- F1. A wrong becomes a quarrel between gods
  - **Trigger:** Lykos, a greedy trader under Hermes, cheats Doris, a fisher under Poseidon.
  - **Actors:** A2, A1
  - **Steps:** Doris knows of the loss and prays to her patron Poseidon for redress, naming Lykos. Poseidon may punish Lykos, compensate Doris, offer terms, refuse, or let the prayer lapse. If Poseidon strikes Lykos, Lykos prays to his own patron Hermes about the harm.
  - **Outcome:** Hermes learns that Poseidon harmed his worshipper, which is a cause to demand redress from Poseidon (god-practices F1). If Poseidon lets the prayer lapse instead, Doris's affinity for Poseidon falls and she may take revenge on Lykos.
  - **Covered by:** R1, R3–R9, R12
- F2. A neglected flock defects
  - **Trigger:** A mortal's prayers to its patron go unanswered.
  - **Actors:** A2, A1
  - **Steps:** Each unanswered prayer lowers the mortal's affinity for its patron. Another god answers a prayer the mortal made about a trouble in that god's domain. Once the affinity falls below a threshold, the mortal adopts the god that last answered it.
  - **Outcome:** The patron loses a worshipper, and the defection is a recorded event. Standing at that place shifts. The god that lost the worshipper may contest the place's people with the god that gained it.
  - **Covered by:** R9–R11
- F3. Seasons and domain troubles
  - **Trigger:** The season turns, or the director's clock fires.
  - **Actors:** A3, A2
  - **Steps:** The season changes which troubles are likely. A storm season wrecks boats, a dry season ruins crops, a winter season brings sickness and cold. Each trouble names the god of its domain, and the mortal prays to that god.
  - **Outcome:** A domain god that ignores the prayer loses the mortal's affinity (R9). When the domain god is also the mortal's patron, as with a fisher's storm and Poseidon, that loss moves the mortal toward defection.
  - **Covered by:** R2, R13–R16

---

## Requirements

**Patrons and domains**
- R1. Every inhabitant has one patron god, set by its authored devotion. Every inhabitant has an authored devotion. The patron is visible in the inhabitant's state and in the gods' prompts.
- R2. Every god has a domain: a closed list of troubles, such as storms at sea for Poseidon or broken tools for Hephaestus. A mortal prays about a trouble to the god of its domain. Domains are sourced from Greek myth and cite their sources.
- R3. A god learns of harm to its worshipper when the worshipper prays to it about the harm. When another god caused the harm, as with a strike or a curse, the harm is a cause the patron may use to open a demand against that god (god-practices R2).

**Wrongs between mortals**
- R4. Inhabitants commit wrongs against each other through their routines: theft, cheating in trade, an unpaid debt, a broken agreement, and a feud. A wrong is a recorded event with a wrongdoer, a victim, and a loss the victim knows of.
- R5. Each inhabitant has an authored temperament, such as greedy, quarrelsome, honest, or proud. The temperament sets how likely each kind of wrong is. Need, such as hunger or debt, raises those odds.
- R6. Wrongs are decided only by persisted world state and the persisted random number generator. They replay deterministically.
- R7. A victim supplicates its own patron for redress, and names the wrongdoer. The answers a god can give stay those of a supplication: punish the wrongdoer, compensate the victim, offer terms, refuse, or let the prayer lapse.
- R8. A punishment falls on the wrongdoer. A wrongdoer harmed by a punishment knows which god punished it, and prays to its own patron about the harm, naming that god (R3).

**What neglect costs**
- R9. An unanswered or refused prayer lowers the mortal's affinity for the god it was addressed to. An answered prayer raises it.
- R10. When a mortal's affinity for its patron falls below a threshold, it adopts as its patron the god, other than its patron, that most recently answered it. If no such god has answered it, it keeps its patron until one does. The defection is recorded with its cause.
- R11. A god's standing at a place reflects how many of the place's people it holds and whether its worshippers' prayers go answered. Defections and unanswered prayers lower it. A defection at a place is a cause for the god that lost the worshipper to open a contest for the place's people with the god that gained it, whether or not the two gods are rivals.
- R12. A victim whose prayer goes unanswered may take revenge on the wrongdoer, which is a new wrong. Revenge is damped: one retaliation per wrong, and no revenge for a revenge. That keeps an episode from tipping into endless feuds.

**Seasons, domain troubles, and the director**
- R13. The world has seasons that turn on world time. Each season changes the odds of the domain troubles. At least one change of season happens within the one-hour unattended run.
- R14. Each god has at least one domain trouble that the world produces without a script: a storm on boats for Poseidon, a broken tool or forge fire for Hephaestus, and so on. A domain trouble is a loss mortals pray about.
- R15. The director fires on its own clock, which answered prayers and blessings never reset. It still applies attributed events without choosing a god's response (god-practices R22).
- R16. The gods' prompts show the current season.

**Food**
- R17. Hunger is occasional. Inhabitants can feed themselves through their livelihoods most of the time, and food prayers become one kind of trouble among many.

**Evidence and the gate**
- R18. Transcripts show each wrong with its wrongdoer, victim, and the temperament and need behind it. They also show prayers routed to patrons and domain gods, patron changes with their cause, revenge, and season turns.
- R19. The gate stops requiring a goal to be set and ended. It judges each god by the threads, influence, and defections it caused. Across the gate's episodes, every god opens at least one thread of its own toward another god: a demand, a contest, or terms it offers first to another god. Answering a prayer does not count.
- R20. ADR-0005's per-god starvation target becomes a p95 queue wait of 90 s or less, amended with the measured rounds from the 2026-10-05 gate (59–75 s for seven gods on one model). The scheduler's existing limit of 7 consecutive skips stays.

---

## Acceptance Examples

- AE1. **Covers R3, R7, R8.** Given Lykos, under Hermes, cheats Doris, under Poseidon. When Doris prays to Poseidon and Poseidon strikes Lykos, Lykos prays to Hermes about the harm, and Hermes may demand redress from Poseidon. If Lykos and Doris both worship Poseidon, a punishment harms no other god's people and no quarrel between gods follows.
- AE2. **Covers R9, R10.** Given a fisher whose three prayers to Poseidon lapse, and whose prayer to Athena about a ruined olive crop she answers. When its affinity for Poseidon falls below the threshold, it becomes Athena's. The transcript records the defection, citing the lapsed prayers.
- AE3. **Covers R10.** Given a mortal whose patron ignores it and whom no other god has answered. When its affinity falls below the threshold, it keeps its patron. When Athena later answers it, it becomes Athena's.
- AE4. **Covers R11.** Given a fisher at the harbor who defects from Poseidon to Athena. Poseidon may open a contest with Athena for the harbor's people, citing the defection, though the two are not rivals.
- AE5. **Covers R12.** Given a feud where A wronged B and B's prayer lapsed. When B takes revenge on A, A may pray about it. A's own unanswered prayer does not lead A to take revenge on B.
- AE6. **Covers R15.** Given gods blessing every minute. When the director's clock comes due, it still fires.
- AE7. **Covers R13, R14, R16.** Given storm season. When the season turns, storms on boats become less likely and the next season's trouble more likely, and the gods' prompts name the new season.

---

## Success Criteria

- In the next rated seven-god gate, food prayers are fewer than half of all prayers, and an episode logs at most 250 "cannot get food" lines: an 80% cut from the 2026-10-05 baseline of about 1,250.
- Every god's domain trouble occurs at least once per episode, as a tuning target, and every god receives at least one prayer.
- At least one unscripted wrong between mortals with different patrons reaches the victim's patron and leads to a visible consequence: a punishment, revenge, a defection, a demand, a contest, or a settlement.
- At least one demand, contest, or settlement between gods opens unscripted, citing harm to a worshipper or a defection.
- Every god opens at least one thread of its own toward another god across the gate's episodes (R19).
- The tunables are set so that a mortal whose patron ignores its prayers defects within one 5-minute episode, and the transcript shows why.
- The owner rates the gate on whether the town feels alive and the gods' choices matter.
- Status (2026-10-06), from the first gate on the built system (`tools/scenarios/m2-greek-cast/episodes/2026-10-07T00-52-07/`, 3 × 300 s on qwen3-8b-4k, exit 1): the food line count is met (69, 59, 65) and the food-prayer share is not (58%, 50%, 51%); the domain troubles occur every episode and every god received a prayer in at least one episode (3 of 21 god-episodes had none, Hephaestus in two of three); an unscripted wrong with a consequence is met (5 revenges, and a director theft the farmer prayed about that Hera punished); no demand or contest between gods opened in any episode, so the harm-or-defection thread and every god's initiative are not met; no mortal defected, since only 2 of 105 prayers were answered; the owner's rating is pending.
- Status (2026-10-06), second gate after the legend fix (`tools/scenarios/m2-greek-cast/episodes/2026-10-07T02-58-12/`, exit 1): exhausted requests 12 became 2; legends 0 became 23 and blessings 1 became 6; prayers answered 2 became 6; the p95 queue wait is within 90 s for every god (13 of 21 over before); the food-prayer share passes in one episode of three (42%, 57%, 50%); no demand or contest between gods opened, no god showed initiative, and no mortal defected, so the thread, initiative and defection criteria are still not met; Hephaestus received no prayer in any episode; the owner's rating is pending.
- Planning can build this without inventing behavior. The plan's open questions are the tunables, the content (temperaments, domains, troubles, seasons), and the measured items below.

---

## Scope Boundaries

- No new practices. Supplication, demand and settlement, and contest carry all of this. A defection is a new cause for the existing contest.
- Inhabitants stay routine-driven, with no model.
- Goals stay as they are, apart from the gate check (R19).
- Patronage is authored, not emergent. It changes only by defection (R10).
- Wrongs are between mortals. A god does not wrong a mortal except through a punishment.
- The M2 exit gate (Unit 13) and its plan come after this work and its rated gate.

---

## Key Decisions

- **Wrongs between mortals are the main engine; seasons, domain troubles, and the director support them.** Harm to a worshipper and defections both set gods against each other.
- **Wrongs go to the victim's patron; troubles go to the domain god.** A wrong between two gods' people gives the victim's patron a choice. A punishment harms another god's worshipper, and the harmed wrongdoer's prayer, naming the god that punished it, is how its patron learns of the harm. No new perception rule is needed. Whether gods choose to punish is what the gate shows.
- **The god prayed to pays for neglect.** An unanswered prayer lowers affinity for the god it was addressed to, as the world does today.
- **Authored patrons, not emergent patronage.** An inhabitant's authored devotion is its patron, and every inhabitant has one, so no fallback exists. Variety within a livelihood means more wrongs between different gods' people. Defection still lets patronage shift, but only toward a god that answered.
- **Temperament and need together.** Temperament makes wrongs read as character. Need ties them to the economy without making a fed town a peaceful one.
- **Every neglect cost applies: defection, revenge, and lost standing.** Ignoring a prayer must cost more than answering it. Damping (R12) bounds the revenge.
- **A defection opens a contest.** It is a new cause for the existing practice, not a new practice, and it needs no standing rivalry: losing a worshipper is the grievance.
- **Goals leave the gate; initiative replaces them.** The gate checks that every god opens a thread of its own toward another god, so it cannot pass with gods that only answer prayers.
- **Seasons are in this round.** The owner chose to include seasons as well as domain troubles.
- **The queue target is 90 s at p95, not 30 s.** Seven gods on one local model can't meet 30 s, and the measured rounds back the amended number.

---

## Dependencies / Assumptions

- The supplication, settlement, and contest practices, and the god scheduler, are on main (god-practices Units 1–10).
- Damage, fire, theft, spoilage, and grudges are already wired as prayer causes (code scan, 2026-10-05).
- The influence count credits a bless whose answered prayer raises affinity (#138).

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2][Needs research] Each god's domain list of troubles, with sources.
- [Affects R2, R14][Needs research] Hades's domain trouble must not need mortals to die. Playable death is later scope, and the world has no deaths yet.
- [Affects R5][Technical] The temperaments, and the odds each gives per wrong, as D23 tunables.
- [Affects R10, R11][Technical] The defection threshold and the standing formula, as tunables meeting the defection success criterion.
- [Affects R13][Technical] Season length in ticks, so that a 5-minute episode can see a season and an hour sees at least one turn.
- [Affects R17][Technical] Whether the food fix is content (starting stock, prices, recipes) or routine behavior. Measure it on a scripted day.
- [Affects R19][Technical] Which requirement ID the gate's goal check traces to, before that check is removed. The goal feature stays.
- [Affects R3, R11][Needs research] Whether a cause reaches its god in time. A wrong, a prayer, an answer, the patron's prayer, and the patron's next turn may outrun a 5-minute episode, and the new state shares a 4K prompt. Measure the cause-to-action latency and decide whether a harm or defection must lead the prompt or earn a scheduler priority.
- [Affects R20][Technical] Where queue wait is measured for the 90 s target.

---

## Sources / Research

- `docs/brainstorms/2026-10-02-god-practices-requirements.md`: the practices, R2 causes, R14 supplication, R16 contest, R22 director.
- `tools/scenarios/m2-greek-cast/episodes/2026-10-05T14-16-36/`: the gate evidence this brainstorm responds to.
- `docs/decisions/` ADR-0005: the starvation target this amends.
- `content/greek/world/inhabitants.json`, `content/greek/gods/*.json`: the current livelihoods, devotions, and god profiles.

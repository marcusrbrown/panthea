# Episode 2 of 3

## Settings

- Recorded: 2026-10-07T18:58:24.249Z
- Model: granite3.3-8b-4k through local Ollama, 4K context, reasoning off (reasoning_effort none)
- Length: 300 s (300 ticks)
- World: a fresh world from the initial authored Greek state; no fixtures, no seeds
- Machine: Apple M1 Pro

## Gods

### Athena

- Domains: wisdom, counsel, war, the protection of cities, weaving
- Drives: guardianship 0.8, order 0.7, sovereignty 0.5, vengeance 0.3
- Powers: Wrath of Pallas (strike), Counsel (legend), Gift of the Olive (bless); and, for any god, travel, report, bless, refuse, practice

### Hades

- Domains: the dead, the underworld, wealth beneath the earth
- Drives: sovereignty 0.8, order 0.8, guardianship 0.5, vengeance 0.3
- Powers: Decree of the Dead (legend); and, for any god, travel, report, bless, refuse, practice

### Hephaestus

- Domains: fire, the forge, craft
- Drives: order 0.7, guardianship 0.5, vengeance 0.4, sovereignty 0.3
- Powers: Fire of the Forge (strike), Craftsman's Tale (legend), Gift of Craft (bless); and, for any god, travel, report, bless, refuse, practice

### Hera

- Domains: marriage, women, childbirth, queenship of the gods
- Drives: fidelity 0.9, vengeance 0.8, guardianship 0.6, sovereignty 0.5, order 0.4
- Powers: Wrath of Hera (strike), Tale of a Grievance (legend); and, for any god, travel, report, bless, refuse, practice

### Hermes

- Domains: messages, travel, exchange, herds, cunning, guiding souls
- Drives: guardianship 0.6, desire 0.5, order 0.5, sovereignty 0.3
- Powers: Tidings (report), Tale of the Road (legend), Windfall (bless); and, for any god, travel, report, bless, refuse, practice

### Poseidon

- Domains: the sea, earthquakes, horses
- Drives: sovereignty 0.8, vengeance 0.7, guardianship 0.5, desire 0.3
- Powers: Earthshaker (strike), Decree of the Deep (legend); and, for any god, travel, report, bless, refuse, practice

### Zeus

- Domains: sky, thunder, kingship, oaths, hospitality (xenia)
- Drives: sovereignty 0.9, order 0.7, desire 0.7, vengeance 0.4, guardianship 0.3
- Powers: Thunderbolt (strike), Pronouncement (legend); and, for any god, travel, report, bless, refuse, practice

## What happened

1. **tick 6, Athena:** report → herdsman-damon (context-backed)
   - says: "You have my blessing to gather resources safely and well."
   - caused: report-told (athena → herdsman-damon)
   - then: herdsman-damon now believes athena: "You have my blessing to gather resources safely and well."
2. **tick 9, Hades:** travel → ferry-dock (context-backed)
   - caused: journey-started (hades)
3. **tick 14, Hephaestus:** strike → the-forge (ability-backed)
   - caused: resource-consumed (hephaestus); building-damaged (the-forge)
   - then: hephaestus, provisioner-nikanor, smith-brontes, smith-delia, smith-ktesias remember building-damaged
   - then: provisioner-nikanor → hephaestus: affinity -2
   - then: smith-brontes → hephaestus: affinity -2
   - then: smith-delia → hephaestus: affinity -2
   - then: smith-ktesias → hephaestus: affinity -2, grudge +1
4. **tick 22, Hera:** bless → evt-3-60 (context-backed)
   - caused: resource-consumed (hera); blessing-granted (hera)
   - then: farmer → hera: affinity +1
5. **tick 29, Hermes:** bless → evt-7-164 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: market-trader-iris → hermes: affinity +1
6. **tick 38, Poseidon:** practice → offer evt-5-110 (context-backed)
   - caused: practice-opened (poseidon)
7. **tick 44, Zeus:** bless → evt-5-106 (context-backed)
   - caused: resource-consumed (zeus); blessing-granted (zeus)
   - then: woodcutter → zeus: affinity +1
8. **tick 52, Poseidon:** strike → fisher-dion (ability-backed)
   - caused: resource-consumed (poseidon); mortal-struck (fisher-dion)
   - then: fisher-kallias → poseidon: affinity +1
   - then: farmer, fisher-dion, fisher-eleni, fisher-kallias, fisher-melina, fisher-stavros, market-trader-iris, olive-grower-aristo, olive-grower-leon, olive-grower-phoebe, woodcutter remember mortal-struck
   - then: farmer → poseidon: affinity -2
   - then: fisher-dion → poseidon: affinity -2, grudge +1
   - then: fisher-eleni → poseidon: affinity -2
   - then: fisher-kallias → poseidon: affinity -2
   - then: fisher-melina → poseidon: affinity -2
   - then: fisher-stavros → poseidon: affinity -2
   - then: market-trader-iris → poseidon: affinity -2
   - then: olive-grower-aristo → poseidon: affinity -2
   - then: olive-grower-leon → poseidon: affinity -2
   - then: olive-grower-phoebe → poseidon: affinity -2
   - then: woodcutter → poseidon: affinity -2
9. **tick 60, Athena:** bless → evt-38-718 (ability-backed)
   - caused: resource-consumed (athena); blessing-granted (athena)
   - then: farmer → athena: affinity +1
10. **tick 66, Hades:** report → poseidon (context-backed)
   - says: "Though you took from the sea, the realm of water is less vast than mine, brother."
   - caused: report-told (hades → poseidon)
   - then: poseidon now believes hades: "Though you took from the sea, the realm of water is less vast than mine, brother."
11. **tick 74, Hephaestus:** bless → evt-41-791 (ability-backed)
   - caused: resource-consumed (hephaestus); blessing-granted (hephaestus)
   - then: smith-ktesias → hephaestus: affinity +1
12. **tick 79, Hera:** report → zeus (context-backed)
   - says: "I remind you of our oath, bound by Earth, Heaven, and the Styx; I claim you swore to honor my wishes concerning Heracles, yet his torment continues."
   - caused: report-told (hera → zeus)
   - then: zeus now believes hera: "I remind you of our oath, bound by Earth, Heaven, and the Styx; I claim you swore to honor my wishes concerning Heracles, yet his torment continues."
13. **tick 90, Hermes:** bless → evt-58-1142 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: ferryman → hermes: affinity +1
14. **tick 99, Poseidon:** bless → evt-72-1428 (context-backed)
   - caused: resource-consumed (poseidon); blessing-granted (poseidon)
   - then: fisher-kallias → poseidon: affinity +1
15. **tick 104, Zeus:** legend (ability-backed)
   - says: "I deny the charge of disregarding my oath; Heracles' torment is by Eurystheus, not me."
   - heard by: hera
   - caused: legend-recorded (zeus)
   - then: hera now believes zeus: "I deny the charge of disregarding my oath; Heracles' torment is by Eurystheus, not me."
16. **tick 110, Athena:** legend (ability-backed)
   - says: "I advise all to continue their work diligently and in peace."
   - heard by: herdsman-damon, weaver-xenia, weaver-zoe
   - caused: legend-recorded (athena)
   - then: herdsman-damon now believes athena: "I advise all to continue their work diligently and in peace."
   - then: weaver-xenia now believes athena: "I advise all to continue their work diligently and in peace."
   - then: weaver-zoe now believes athena: "I advise all to continue their work diligently and in peace."
17. **tick 115, Hades:** travel → olympus-gate (context-backed)
   - caused: journey-started (hades)
18. **tick 124, Hephaestus:** bless → evt-85-1669 (ability-backed)
   - caused: resource-consumed (hephaestus); blessing-granted (hephaestus)
   - then: market-trader-iris → hephaestus: affinity +1
19. **tick 130, Hera:** report → zeus (context-backed)
   - says: "You swore by our marriage bed and oaths grave to honor my wishes concerning Heracles, yet his torment persists."
   - caused: report-told (hera → zeus)
   - then: zeus now believes hera: "You swore by our marriage bed and oaths grave to honor my wishes concerning Heracles, yet his torment persists."
20. **tick 141, Hermes:** bless → evt-54-1070 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: fisher-dion → hermes: affinity +1
21. **tick 150, Poseidon:** report → hermes (context-backed)
   - says: "I recall when Fisher Kallias honored our pact, and Hades reminded me of the boundaries of our realms."
   - caused: report-told (poseidon → hermes)
   - then: hermes now believes poseidon: "I recall when Fisher Kallias honored our pact, and Hades reminded me of the boundaries of our realms."
22. **tick 156, Zeus:** legend (ability-backed)
   - says: "I uphold my oath, yet Heracles' suffering is not my doing, but Eurystheus'}. I demand Hera respect our marriage bond and cease her false claims [<br><br>"
   - heard by: hera
   - caused: legend-recorded (zeus)
   - then: hera now believes zeus: "I uphold my oath, yet Heracles' suffering is not my doing, but Eurystheus'}. I demand Hera respect our marriage bond and cease her false claims [<br><br>"
23. **tick 166, Athena:** bless → evt-153-2683 (ability-backed)
   - caused: resource-consumed (athena); blessing-granted (athena)
   - then: farmer → athena: affinity +1
24. **tick 178, Hephaestus:** legend (ability-backed)
   - says: "I, Hephaestus, forge master and craftsman, once taught crafts to men in caves, with Athena as my partner in skill-sharing."
   - heard by: provisioner-nikanor
   - caused: legend-recorded (hephaestus)
   - then: provisioner-nikanor now believes hephaestus: "I, Hephaestus, forge master and craftsman, once taught crafts to men in caves, with Athena as my partner in skill-sharing."
25. **tick 202, Hermes:** bless → evt-63-1244 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: market-trader-iris → hermes: affinity +1
26. **tick 214, Poseidon:** bless → evt-192-3335 (context-backed)
   - caused: resource-consumed (poseidon); blessing-granted (poseidon)
   - then: olive-grower-leon → poseidon: affinity +1
27. **tick 222, Zeus:** bless → evt-204-3521 (context-backed)
   - caused: resource-consumed (zeus); blessing-granted (zeus)
   - then: olive-grower-aristo → zeus: affinity +1
28. **tick 236, Athena:** bless → evt-180-3117 (ability-backed)
   - caused: resource-consumed (athena); blessing-granted (athena)
   - then: weaver-ismene → athena: affinity +1
29. **tick 240, Hades:** legend (ability-backed)
   - says: "I, Hades, Lord of the Underworld, decree that Persephone shall return to me for a third of the year."
   - heard by: no one
   - caused: legend-recorded (hades)
30. **tick 250, Hephaestus:** bless → evt-179-3104 (ability-backed)
   - caused: resource-consumed (hephaestus); blessing-granted (hephaestus)
   - then: smith-ktesias → hephaestus: affinity +1
31. **tick 255, Hera:** bless → evt-166-2886 (context-backed)
   - caused: resource-consumed (hera); blessing-granted (hera)
   - then: herdsman-damon → hera: affinity +1
32. **tick 268, Hermes:** bless → evt-242-4199 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: farmer → hermes: affinity +1
33. **tick 281, Poseidon:** bless → evt-241-4177 (context-backed)
   - caused: resource-consumed (poseidon); blessing-granted (poseidon)
   - then: ferryman → poseidon: affinity +1
34. **tick 288, Zeus:** practice → offer evt-222-3843 (context-backed)
   - caused: practice-opened (zeus)

## What the world did with every proposal

- dispositions: bless 18 × committed, report 5 × committed, legend 5 × committed, travel 2 × committed, strike 2 × committed, practice 2 × committed, practice 1 × insufficient-resources, bless 1 × pending

1. Athena: report → herdsman-damon — committed: report-told
2. Hades: travel → ferry-dock — committed: journey-started
3. Hephaestus: strike → the-forge — committed: resource-consumed, building-damaged
4. Hera: bless → evt-3-60 — committed: resource-consumed, blessing-granted
5. Hermes: bless → evt-7-164 — committed: resource-consumed, blessing-granted
6. Poseidon: practice → offer evt-5-110 — committed: practice-opened
7. Zeus: bless → evt-5-106 — committed: resource-consumed, blessing-granted
8. Poseidon: strike → fisher-dion — committed: resource-consumed, mortal-struck
9. Athena: bless → evt-38-718 — committed: resource-consumed, blessing-granted
10. Hades: report → poseidon — committed: report-told
11. Hephaestus: bless → evt-41-791 — committed: resource-consumed, blessing-granted
12. Hera: report → zeus — committed: report-told
13. Hermes: bless → evt-58-1142 — committed: resource-consumed, blessing-granted
14. Poseidon: bless → evt-72-1428 — committed: resource-consumed, blessing-granted
15. Zeus: legend → legend — committed: legend-recorded
16. Athena: legend → legend — committed: legend-recorded
17. Hades: travel → olympus-gate — committed: journey-started
18. Hephaestus: bless → evt-85-1669 — committed: resource-consumed, blessing-granted
19. Hera: report → zeus — committed: report-told
20. Hermes: bless → evt-54-1070 — committed: resource-consumed, blessing-granted
21. Poseidon: report → hermes — committed: report-told
22. Zeus: legend → legend — committed: legend-recorded
23. Athena: bless → evt-153-2683 — committed: resource-consumed, blessing-granted
24. Hephaestus: legend → legend — committed: legend-recorded
25. Hera: practice → offer evt-166-2886 — rejected: insufficient-resources
26. Hermes: bless → evt-63-1244 — committed: resource-consumed, blessing-granted
27. Poseidon: bless → evt-192-3335 — committed: resource-consumed, blessing-granted
28. Zeus: bless → evt-204-3521 — committed: resource-consumed, blessing-granted
29. Athena: bless → evt-180-3117 — committed: resource-consumed, blessing-granted
30. Hades: legend → legend — committed: legend-recorded
31. Hephaestus: bless → evt-179-3104 — committed: resource-consumed, blessing-granted
32. Hera: bless → evt-166-2886 — committed: resource-consumed, blessing-granted
33. Hermes: bless → evt-242-4199 — committed: resource-consumed, blessing-granted
34. Poseidon: bless → evt-241-4177 — committed: resource-consumed, blessing-granted
35. Zeus: practice → offer evt-222-3843 — committed: practice-opened
36. Athena: bless → evt-251-4407 — pending

## The episode's numbers

- Food: 79 "cannot get food" lines; 16 of 46 prayers are about food
- Troubles in a god's domain: Athena 2, Hades 2, Hephaestus 2, Hera 2, Hermes 4, Poseidon 2, Zeus 2
- Wrongs between mortals: 10; 9 between different patrons
  - [evt-1-23] fisher-dion (hermes) wronged fisher-kallias (poseidon): cheating; the victim prayed [evt-5-110]; punished
  - [evt-67-1333] weaver-xenia (hera) wronged weaver-ismene (athena): feud; the victim prayed [evt-207-3563]; no consequence yet
  - [evt-136-2391] olive-grower-aristo (athena) wronged herdsman-damon (hermes): cheating; the victim prayed [evt-141-2473]; no consequence yet
  - [evt-143-2505] market-trader-iris (hermes) wronged fisher-stavros (poseidon): theft; the victim prayed [evt-237-4086]; no consequence yet
  - [evt-171-2957] smith-brontes (hephaestus) wronged weaver-zoe (athena): feud; the victim did not pray about it; no consequence yet
  - [evt-173-3011] fisher-kallias (poseidon) wronged fisher-eleni (athena): unpaid-debt; the victim prayed [evt-275-4866]; no consequence yet
  - [evt-187-3231] fisher-dion (hermes) wronged olive-grower-leon (poseidon): cheating; the victim prayed [evt-239-4139]; no consequence yet
  - [evt-216-3740] weaver-xenia (hera) wronged woodcutter (zeus): unpaid-debt; the victim prayed [evt-222-3843]; no consequence yet
  - [evt-263-4656] olive-grower-aristo (athena) wronged fisher-melina (poseidon): unpaid-debt; the victim prayed [evt-275-4865]; no consequence yet
- Defections: 0
- From a prayer's cause to its closing: 22 closed (median 51 ticks, p95 155 ticks); by outcome answered 19, lapsed 3

## What the world did

- tick 1: fisher-dion wronged fisher-kallias: cheating of 2 currency; greedy, not in need [evt-1-23]
- tick 1: farmer cannot get planks (no-seller)
- tick 2: woodcutter cannot get food (no-seller)
- tick 2: market-trader-iris cannot get wine (no-buyer)
- tick 2: olive-grower-leon cannot get olives (no-buyer)
- tick 3: farmer prayed to hera: help with planks [evt-3-60] (routed to its patron)
- tick 3: olive-grower-aristo cannot get olives (no-buyer)
- tick 3: olive-grower-phoebe cannot get olives (no-buyer)
- tick 4: farmer cannot get planks (no-seller)
- tick 4: fisher-eleni cannot get fish (no-buyer)
- tick 4: fisher-dion cannot get fish (no-buyer)
- tick 5: woodcutter prayed to zeus: help with food [evt-5-106] (routed to its patron)
- tick 5: fisher-kallias prayed to poseidon: punish fisher-dion, who owns  [evt-5-110] (routed to its patron)
- tick 5: fisher-stavros cannot get fish (no-buyer)
- tick 6: market-trader-iris cannot get wine (no-buyer)
- tick 6: fisher-melina cannot get fish (no-buyer)
- tick 7: market-trader-iris prayed to hermes: help with wine [evt-7-164] (routed to its patron)
- tick 9: fisher-kallias cannot get fish (no-buyer)
- tick 22: hera blessed farmer: 2 planks
- tick 22: hera answered farmer's prayer [evt-3-60]
- tick 22: farmer remembers hera's answer
- tick 22: farmer → hera: affinity +1
- tick 29: hermes blessed market-trader-iris: 2 wine
- tick 29: hermes answered market-trader-iris's prayer [evt-7-164]
- tick 29: market-trader-iris remembers hermes's answer
- tick 29: market-trader-iris → hermes: affinity +1
- tick 36: a tool-flaw in athena's domain (spring, the god's floor) took 2 tools of farmer [evt-36-700]
- tick 37: woodcutter cannot get food (no-seller)
- tick 38: farmer prayed to athena: help with tools [evt-38-718] (a trouble in the god's domain: routed to the domain god)
- tick 41: smith-ktesias prayed to hephaestus: help with the-forge [evt-41-791] (routed to its patron)
- tick 44: zeus blessed woodcutter: 2 food
- tick 44: zeus answered woodcutter's prayer [evt-5-106]
- tick 44: woodcutter remembers zeus's answer
- tick 44: woodcutter → zeus: affinity +1
- tick 48: fisher-kallias cannot get food (no-funds)
- tick 48: olive-grower-aristo cannot get food (no-funds)
- tick 50: a dig-collapse in hades's domain (spring, the god's floor) took 2 ore of smith-ktesias [evt-50-960]
- tick 52: poseidon struck fisher-dion and took 2 fish [evt-52-981]
- tick 52: poseidon's boon to fisher-kallias was seen given [evt-38-716] (evt-52-981)
- tick 52: poseidon answered fisher-kallias's prayer [evt-5-110]
- tick 52: fisher-kallias remembers poseidon's answer
- tick 52: fisher-kallias → poseidon: affinity +1
- tick 53: fisher-kallias cannot get food (no-funds)
- tick 53: fisher-dion cannot get food (no-seller)
- tick 54: fisher-dion prayed to hermes: help with fish [evt-54-1070] (routed to its patron)
- tick 55: a vanished-goods in hermes's domain (spring, the god's floor) took 2 fish of ferryman [evt-55-1099]
- tick 56: fisher-dion cannot get food (no-seller)
- tick 57: fisher-dion cannot get fish (no-buyer)
- tick 58: ferryman prayed to hermes: help with fish [evt-58-1142] (a trouble in the god's domain: routed to the domain god)
- tick 60: athena blessed farmer: 2 tools
- tick 60: athena answered farmer's prayer [evt-38-718]
- tick 60: farmer remembers athena's answer
- tick 60: farmer → athena: affinity +1
- tick 61: a crossing-loss in hermes's domain (spring, the season's odds) took 2 fish of market-trader-iris [evt-61-1222]
- tick 62: fisher-dion cannot get fish (no-buyer)
- tick 63: market-trader-iris prayed to hermes: help with fish [evt-63-1244] (a trouble in the god's domain: routed to the domain god)
- tick 67: weaver-xenia wronged weaver-ismene: feud of 2 cloth; proud, not in need [evt-67-1333]
- tick 68: fisher-kallias cannot get food (no-funds)
- tick 70: fisher-kallias cannot get food (no-funds)
- tick 71: fisher-dion cannot get fish (no-buyer)
- tick 72: fisher-kallias prayed to poseidon: help with food [evt-72-1428] (routed to its patron)
- tick 74: hephaestus blessed smith-ktesias: 3 planks for the-forge
- tick 74: hephaestus answered smith-ktesias's prayer [evt-41-791]
- tick 74: smith-ktesias remembers hephaestus's answer
- tick 74: smith-ktesias → hephaestus: affinity +1
- tick 75: fisher-kallias cannot get fish (no-buyer)
- tick 82: a cracked-tools in hephaestus's domain (spring, the god's floor) took 1 tools of market-trader-iris [evt-82-1635]
- tick 85: market-trader-iris prayed to hephaestus: help with tools [evt-85-1669] (a trouble in the god's domain: routed to the domain god)
- tick 85: a roof-leak in hera's domain (spring, the god's floor) took 1 food of smith-delia [evt-85-1688]
- tick 85: fisher-melina cannot get food (no-funds)
- tick 88: fisher-kallias cannot get food (no-funds)
- tick 90: hermes blessed ferryman: 2 fish
- tick 90: hermes answered ferryman's prayer [evt-58-1142]
- tick 90: ferryman remembers hermes's answer
- tick 90: ferryman → hermes: affinity +1
- tick 99: poseidon blessed fisher-kallias: 2 food
- tick 99: poseidon answered fisher-kallias's prayer [evt-72-1428]
- tick 99: fisher-kallias remembers poseidon's answer
- tick 99: fisher-kallias → poseidon: affinity +1
- tick 113: weaver-xenia cannot get food (no-funds)
- tick 116: market-trader-iris cannot get food (no-funds)
- tick 117: a squall in zeus's domain (spring, the god's floor) damaged olive-press of olive-grower-aristo [evt-117-2111]
- tick 118: a vanished-goods in hermes's domain (spring, the season's odds) took 2 olives of weaver-zoe [evt-118-2123]
- tick 120: the director spoiled 23 cloth of weaver-xenia
- tick 121: olive-grower-aristo cannot get food (no-seller)
- tick 122: olive-grower-aristo prayed to athena: help with food [evt-122-2179] (routed to its patron)
- tick 122: weaver-zoe cannot get food (no-seller)
- tick 124: hephaestus blessed market-trader-iris: 1 tools
- tick 124: olive-grower-aristo cannot get food (no-seller)
- tick 124: hephaestus answered market-trader-iris's prayer [evt-85-1669]
- tick 124: market-trader-iris remembers hephaestus's answer
- tick 124: market-trader-iris → hephaestus: affinity +1
- tick 131: fisher-kallias cannot get food (no-funds)
- tick 132: olive-grower-aristo cannot get olives (no-buyer)
- tick 136: olive-grower-aristo wronged herdsman-damon: cheating of 2 currency; greedy, in need [evt-136-2391]
- tick 136: market-trader-iris cannot get food (no-funds)
- tick 138: a quake in poseidon's domain (spring, the god's floor) damaged woodshed of woodcutter [evt-138-2427]
- tick 141: hermes blessed fisher-dion: 2 fish
- tick 141: herdsman-damon prayed to hermes: punish olive-grower-aristo, who owns olive-press [evt-141-2473] (routed to its patron)
- tick 141: hermes answered fisher-dion's prayer [evt-54-1070]
- tick 141: fisher-dion remembers hermes's answer
- tick 141: fisher-dion → hermes: affinity +1
- tick 142: woodcutter prayed to poseidon: help with woodshed [evt-142-2482] (a trouble in the god's domain: routed to the domain god)
- tick 143: market-trader-iris wronged fisher-stavros: theft of 1 cloth; greedy, not in need [evt-143-2505]
- tick 149: olive-grower-phoebe cannot get food (no-funds)
- tick 151: a tool-flaw in athena's domain (spring, the god's floor) took 2 tools of farmer [evt-151-2654]
- tick 151: fisher-stavros cannot get food (no-seller)
- tick 152: fisher-stavros prayed to poseidon: help with food [evt-152-2664] (routed to its patron)
- tick 152: fisher-dion cannot get food (no-seller)
- tick 152: olive-grower-aristo cannot get food (no-seller)
- tick 152: olive-grower-leon cannot get food (no-seller)
- tick 152: weaver-ismene cannot get food (no-seller)
- tick 152: weaver-zoe cannot get food (no-seller)
- tick 152: weaver-xenia cannot get food (no-seller)
- tick 152: smith-ktesias cannot get food (no-seller)
- tick 152: smith-delia cannot get food (no-seller)
- tick 153: farmer prayed to athena: help with tools [evt-153-2683] (a trouble in the god's domain: routed to the domain god)
- tick 153: fisher-stavros cannot get food (no-seller)
- tick 155: olive-grower-leon cannot get olives (no-buyer)
- tick 156: olive-grower-leon prayed to poseidon: help with olives [evt-156-2740] (routed to its patron)
- tick 156: market-trader-iris cannot get food (no-funds)
- tick 156: fisher-stavros cannot get fish (no-buyer)
- tick 160: a damp in hera's domain (spring, the god's floor) took 2 cloth of herdsman-damon [evt-160-2807]
- tick 162: olive-grower-aristo cannot get food (no-funds)
- tick 165: a dig-collapse in hades's domain (spring, the god's floor) took 2 ore of smith-brontes [evt-165-2873]
- tick 166: athena blessed farmer: 2 tools
- tick 166: herdsman-damon prayed to hera: help with cloth [evt-166-2886] (a trouble in the god's domain: routed to the domain god)
- tick 166: athena answered farmer's prayer [evt-153-2683]
- tick 166: farmer remembers athena's answer
- tick 166: farmer → athena: affinity +1
- tick 168: fisher-kallias cannot get food (no-funds)
- tick 169: olive-grower-phoebe cannot get food (no-funds)
- tick 170: fisher-kallias prayed to poseidon: help with food [evt-170-2939] (routed to its patron)
- tick 171: smith-brontes wronged weaver-zoe: feud of 2 cloth; quarrelsome, not in need [evt-171-2957]
- tick 171: fisher-stavros cannot get fish (no-buyer)
- tick 173: fisher-kallias wronged fisher-eleni: unpaid-debt of 3 currency; greedy, in need; the credit [evt-73-1461] failed [evt-173-3011]
- tick 173: fisher-kallias cannot get fish (no-buyer)
- tick 176: market-trader-iris cannot get food (no-funds)
- tick 178: smith-ktesias cannot get food (no-seller)
- tick 179: smith-ktesias prayed to hephaestus: help with food [evt-179-3104] (routed to its patron)
- tick 179: weaver-ismene cannot get food (no-seller)
- tick 180: weaver-ismene prayed to athena: help with food [evt-180-3117] (routed to its patron)
- tick 180: a vanished-goods in hermes's domain (spring, the god's floor) took 2 fish of fisher-eleni [evt-180-3123]
- tick 181: fisher-eleni cannot get food (no-seller)
- tick 182: fisher-eleni prayed to athena: help with food [evt-182-3150] (routed to its patron)
- tick 182: weaver-ismene cannot get food (no-seller)
- tick 185: fisher-melina cannot get food (no-funds)
- tick 186: fisher-kallias cannot get fish (no-buyer)
- tick 186: fisher-eleni cannot get fish (no-buyer)
- tick 187: fisher-dion wronged olive-grower-leon: cheating of 2 currency; greedy, not in need [evt-187-3231]
- tick 189: weaver-ismene cannot get wool (no-buyer)
- tick 190: fisher-kallias cannot get fish (no-buyer)
- tick 190: fisher-eleni cannot get fish (no-buyer)
- tick 191: olive-grower-leon cannot get food (no-seller)
- tick 191: weaver-ismene cannot get wool (no-buyer)
- tick 192: hera's offer was refused (insufficient-resources)
- tick 192: olive-grower-leon prayed to poseidon: help with food [evt-192-3335] (routed to its patron)
- tick 193: weaver-ismene cannot get wool (no-buyer)
- tick 194: olive-grower-leon cannot get food (no-seller)
- tick 197: market-trader-iris cannot get food (no-funds)
- tick 199: market-trader-iris prayed to hermes: help with food [evt-199-3435] (routed to its patron)
- tick 200: the season turned from spring to summer
- tick 200: olive-grower-leon cannot get olives (no-buyer)
- tick 202: hermes blessed market-trader-iris: 2 fish
- tick 202: hermes answered market-trader-iris's prayer [evt-63-1244]
- tick 202: market-trader-iris remembers hermes's answer
- tick 202: market-trader-iris → hermes: affinity +1
- tick 203: olive-grower-aristo cannot get food (no-seller)
- tick 204: olive-grower-aristo prayed to zeus: help with olive-press [evt-204-3521] (a trouble in the god's domain: routed to the domain god)
- tick 205: fisher-melina cannot get food (no-funds)
- tick 206: olive-grower-aristo cannot get food (no-seller)
- tick 207: weaver-ismene prayed to athena: punish weaver-xenia, who owns  [evt-207-3563] (routed to its patron)
- tick 208: olive-grower-leon cannot get olives (no-buyer)
- tick 210: fisher-kallias cannot get food (no-funds)
- tick 210: olive-grower-aristo cannot get olives (no-buyer)
- tick 210: olive-grower-leon cannot get olives (no-buyer)
- tick 212: fisher-melina cannot get fish (no-buyer)
- tick 212: fisher-stavros cannot get fish (no-buyer)
- tick 212: fisher-eleni cannot get fish (no-buyer)
- tick 212: fisher-dion cannot get fish (no-buyer)
- tick 213: fisher-stavros cannot get food (no-seller)
- tick 213: fisher-dion cannot get food (no-seller)
- tick 214: poseidon blessed olive-grower-leon: 2 food
- tick 214: fisher-melina prayed to poseidon: help with fish [evt-214-3680] (routed to its patron)
- tick 214: fisher-stavros prayed to poseidon: help with fish [evt-214-3681] (routed to its patron)
- tick 214: fisher-eleni prayed to athena: help with fish [evt-214-3682] (routed to its patron)
- tick 214: fisher-dion prayed to hermes: help with food [evt-214-3683] (routed to its patron)
- tick 214: weaver-ismene cannot get wool (no-buyer)
- tick 214: poseidon answered olive-grower-leon's prayer [evt-192-3335]
- tick 214: olive-grower-leon remembers poseidon's answer
- tick 214: olive-grower-leon → poseidon: affinity +1
- tick 216: weaver-xenia wronged woodcutter: unpaid-debt of 3 currency; proud, not in need; the credit [evt-116-2095] failed [evt-216-3740]
- tick 216: market-trader-iris cannot get food (no-funds)
- tick 218: olive-grower-aristo cannot get olives (no-buyer)
- tick 219: fisher-melina cannot get fish (no-buyer)
- tick 222: zeus blessed olive-grower-aristo: 3 planks for olive-press
- tick 222: woodcutter prayed to zeus: punish weaver-xenia, who owns  [evt-222-3843] (routed to its patron)
- tick 222: zeus answered olive-grower-aristo's prayer [evt-204-3521]
- tick 222: olive-grower-aristo remembers zeus's answer
- tick 222: olive-grower-aristo → zeus: affinity +1
- tick 226: weaver-ismene cannot get wool (no-buyer)
- tick 227: fisher-melina cannot get fish (no-buyer)
- tick 228: fisher-kallias cannot get food (no-funds)
- tick 228: olive-grower-aristo cannot get food (no-funds)
- tick 228: weaver-ismene cannot get wool (no-buyer)
- tick 230: weaver-ismene cannot get wool (no-buyer)
- tick 231: fisher-melina cannot get fish (no-buyer)
- tick 231: fisher-stavros cannot get fish (no-buyer)
- tick 232: weaver-ismene cannot get wool (no-buyer)
- tick 234: weaver-ismene cannot get wool (no-buyer)
- tick 235: fisher-kallias cannot get fish (no-buyer)
- tick 235: fisher-eleni cannot get fish (no-buyer)
- tick 235: fisher-dion cannot get fish (no-buyer)
- tick 236: athena blessed weaver-ismene: 2 food
- tick 236: market-trader-iris cannot get food (no-funds)
- tick 236: fisher-eleni cannot get food (no-seller)
- tick 236: fisher-dion cannot get food (no-seller)
- tick 236: athena answered weaver-ismene's prayer [evt-180-3117]
- tick 236: weaver-ismene remembers athena's answer
- tick 236: weaver-ismene → athena: affinity +1
- tick 237: fisher-kallias prayed to poseidon: help with fish [evt-237-4084] (routed to its patron)
- tick 237: fisher-stavros prayed to poseidon: punish market-trader-iris, who owns  [evt-237-4086] (routed to its patron)
- tick 237: fisher-eleni prayed to hermes: help with fish [evt-237-4087] (a trouble in the god's domain: routed to the domain god)
- tick 237: fisher-dion prayed to hermes: help with fish [evt-237-4088] (routed to its patron)
- tick 237: olive-grower-aristo cannot get olives (no-buyer)
- tick 237: olive-grower-phoebe cannot get olives (no-buyer)
- tick 237: olive-grower-leon cannot get olives (no-buyer)
- tick 237: weaver-ismene cannot get wool (no-buyer)
- tick 238: a harbour-surge in poseidon's domain (summer, the god's floor) damaged fish-landing of ferryman [evt-238-4117]
- tick 238: olive-grower-aristo cannot get food (no-funds)
- tick 238: olive-grower-phoebe cannot get food (no-seller)
- tick 239: olive-grower-aristo prayed to athena: help with olives [evt-239-4137] (routed to its patron)
- tick 239: olive-grower-phoebe prayed to athena: help with food [evt-239-4138] (routed to its patron)
- tick 239: olive-grower-leon prayed to poseidon: punish fisher-dion, who owns  [evt-239-4139] (routed to its patron)
- tick 239: weaver-ismene cannot get wool (no-buyer)
- tick 240: the director made fisher-melina take 197 food from farmer
- tick 241: ferryman prayed to poseidon: help with fish-landing [evt-241-4177] (a trouble in the god's domain: routed to the domain god)
- tick 241: fisher-kallias cannot get fish (no-buyer)
- tick 241: fisher-stavros cannot get fish (no-buyer)
- tick 241: fisher-eleni cannot get food (no-seller)
- tick 241: fisher-eleni cannot get fish (no-buyer)
- tick 241: fisher-dion cannot get food (no-seller)
- tick 241: fisher-dion cannot get fish (no-buyer)
- tick 241: olive-grower-phoebe cannot get food (no-seller)
- tick 241: weaver-zoe cannot get food (no-seller)
- tick 241: weaver-xenia cannot get food (no-seller)
- tick 241: smith-ktesias cannot get food (no-seller)
- tick 241: smith-brontes cannot get food (no-seller)
- tick 241: smith-delia cannot get food (no-seller)
- tick 242: farmer prayed to hermes: help with food [evt-242-4199] (not its authored patron (a defection or a domain))
- tick 242: weaver-ismene cannot get wool (no-buyer)
- tick 244: weaver-ismene cannot get wool (no-buyer)
- tick 245: fisher-kallias cannot get fish (no-buyer)
- tick 245: fisher-melina cannot get fish (no-buyer)
- tick 245: fisher-stavros cannot get fish (no-buyer)
- tick 245: fisher-eleni cannot get fish (no-buyer)
- tick 245: fisher-dion cannot get fish (no-buyer)
- tick 246: olive-grower-aristo cannot get olives (no-buyer)
- tick 246: olive-grower-leon cannot get olives (no-buyer)
- tick 247: olive-grower-aristo cannot get food (no-seller)
- tick 247: olive-grower-phoebe cannot get food (no-seller)
- tick 247: weaver-ismene cannot get wool (no-buyer)
- tick 249: market-trader-iris cannot get wine (no-buyer)
- tick 250: hephaestus blessed smith-ktesias: 2 food
- tick 250: fisher-kallias cannot get fish (no-buyer)
- tick 250: fisher-melina cannot get fish (no-buyer)
- tick 250: fisher-stavros cannot get fish (no-buyer)
- tick 250: fisher-eleni cannot get fish (no-buyer)
- tick 250: fisher-dion cannot get fish (no-buyer)
- tick 250: weaver-zoe cannot get food (no-seller)
- tick 250: weaver-xenia cannot get food (no-seller)
- tick 250: smith-brontes cannot get food (no-seller)
- tick 250: hephaestus answered smith-ktesias's prayer [evt-179-3104]
- tick 250: smith-ktesias remembers hephaestus's answer
- tick 250: smith-ktesias → hephaestus: affinity +1
- tick 251: market-trader-iris prayed to hermes: help with wine [evt-251-4397] (routed to its patron)
- tick 251: weaver-zoe prayed to athena: help with food [evt-251-4407] (routed to its patron)
- tick 251: weaver-xenia prayed to hera: help with food [evt-251-4408] (routed to its patron)
- tick 251: smith-brontes prayed to hephaestus: help with food [evt-251-4411] (routed to its patron)
- tick 251: olive-grower-aristo cannot get olives (no-buyer)
- tick 251: olive-grower-phoebe cannot get olives (no-buyer)
- tick 251: olive-grower-leon cannot get olives (no-buyer)
- tick 252: fisher-kallias cannot get fish (no-buyer)
- tick 252: fisher-melina cannot get fish (no-buyer)
- tick 252: fisher-stavros cannot get fish (no-buyer)
- tick 252: fisher-eleni cannot get fish (no-buyer)
- tick 252: fisher-dion cannot get fish (no-buyer)
- tick 254: market-trader-iris cannot get wine (no-buyer)
- tick 255: hera blessed herdsman-damon: 2 cloth
- tick 255: hera answered herdsman-damon's prayer [evt-166-2886]
- tick 255: herdsman-damon remembers hera's answer
- tick 255: herdsman-damon → hera: affinity +1
- tick 260: a lightning-fire in zeus's domain (summer, the god's floor) took 1 food of olive-grower-aristo [evt-260-4604]
- tick 260: olive-grower-aristo cannot get food (no-funds)
- tick 263: olive-grower-aristo wronged fisher-melina: unpaid-debt of 3 currency; greedy, in need; the credit [evt-163-2849] failed [evt-263-4656]
- tick 266: olive-grower-leon cannot get food (no-funds)
- tick 268: hermes blessed farmer: 4 food
- tick 268: olive-grower-aristo cannot get food (no-funds)
- tick 268: hermes answered farmer's prayer [evt-242-4199]
- tick 268: farmer remembers hermes's answer
- tick 268: farmer → hermes: affinity +1
- tick 269: olive-grower-phoebe cannot get food (no-funds)
- tick 271: fisher-kallias cannot get fish (no-buyer)
- tick 271: fisher-stavros cannot get fish (no-buyer)
- tick 271: fisher-dion cannot get fish (no-buyer)
- tick 273: a forge-flare in hephaestus's domain (summer, the god's floor) damaged the-forge of smith-ktesias [evt-273-4835]
- tick 273: fisher-melina cannot get fish (no-buyer)
- tick 273: fisher-eleni cannot get fish (no-buyer)
- tick 273: olive-grower-aristo's prayer to athena lapsed unanswered [evt-122-2179]
- tick 273: olive-grower-aristo remembers athena's silence
- tick 273: olive-grower-aristo → athena: affinity -2, grudge +1
- tick 274: fisher-eleni cannot get food (no-seller)
- tick 275: fisher-melina prayed to poseidon: punish olive-grower-aristo, who owns olive-press [evt-275-4865] (routed to its patron)
- tick 275: fisher-eleni prayed to athena: punish fisher-kallias, who owns  [evt-275-4866] (routed to its patron)
- tick 275: fisher-kallias cannot get fish (no-buyer)
- tick 275: fisher-stavros cannot get fish (no-buyer)
- tick 275: fisher-dion cannot get fish (no-buyer)
- tick 276: fisher-stavros wronged fisher-kallias: feud of 2 cloth; quarrelsome, in need [evt-276-4892]
- tick 276: market-trader-iris cannot get food (no-funds)
- tick 281: poseidon blessed ferryman: 3 planks for fish-landing
- tick 281: poseidon answered ferryman's prayer [evt-241-4177]
- tick 281: ferryman remembers poseidon's answer
- tick 281: ferryman → poseidon: affinity +1
- tick 291: fisher-stavros cannot get fish (no-buyer)
- tick 291: fisher-dion cannot get fish (no-buyer)
- tick 292: fisher-kallias cannot get food (no-funds)
- tick 292: herdsman-damon's prayer to hermes lapsed unanswered [evt-141-2473]
- tick 292: herdsman-damon remembers hermes's silence
- tick 292: herdsman-damon → hermes: affinity -2, grudge +1
- tick 293: woodcutter's prayer to poseidon lapsed unanswered [evt-142-2482]
- tick 293: woodcutter remembers poseidon's silence
- tick 293: woodcutter → poseidon: affinity -2, grudge +1
- tick 295: fisher-kallias cannot get food (no-funds)
- tick 296: market-trader-iris cannot get food (no-funds)
- tick 297: fisher-kallias cannot get food (no-funds)

## Journeys

- journeys: 2 started: 2 arrived, 0 refused, 0 replaced, 0 still travelling

1. Hades: underworld-shore → ferry-dock, set out at tick 9, 1 hop, arrived at tick 9
   - tick 9: crossed from underworld-shore to ferry-dock
2. Hades: ferry-dock → olympus-gate, set out at tick 115, 3 hops, arrived at tick 117
   - tick 115: moved to town-square
   - tick 116: moved to mountain-path
   - tick 117: crossed from mountain-path to olympus-gate

## Practice threads

### supplication [evt-38-716]: poseidon → fisher-kallias, fulfilled

- Opened at tick 38
- Cause: wrong (fisher-dion) [evt-1-23]
- Answers the prayer [evt-5-110]
- Moves:
  1. tick 38, Poseidon: offer — fisher-kallias offers poseidon 1 currency by tick 128
  2. tick 39, fisher-kallias: accept
- Boon: seen given (evt-52-981)
- Offering: not seen
- Ending: fulfilled at tick 53, by fisher-kallias; remembered by fisher-kallias, poseidon
- Changed: poseidon → fisher-kallias: affinity +1

### supplication [evt-288-5061]: zeus → woodcutter, still open

- Opened at tick 288
- Cause: wrong (weaver-xenia) [evt-216-3740]
- Answers the prayer [evt-222-3843]
- Moves:
  1. tick 288, Zeus: offer — woodcutter offers zeus 1 currency by tick 378
  2. tick 289, woodcutter: accept
- Boon: not seen
- Offering: not seen

## What each god practiced

- athena: no practice move; thread endings: none
- hades: travel; thread endings: none
- hephaestus: no practice move; thread endings: none
- hera: no practice move; thread endings: none
- hermes: no practice move; thread endings: none
- poseidon: supplication; thread endings: fulfilled [evt-38-716] by its act
- zeus: supplication; thread endings: none

## Open threads at the end

- [evt-288-5061] supplication zeus → woodcutter, open 12 ticks (since tick 288): waits on zeus's boon on [evt-222-3843] and woodcutter's offering; ends by tick 378

## Moves judged no progress

No move was judged no progress.

## Turns while an obligation was open

A turn is performed, waited for a named event, or knowingly risked breach (R12, amended 2026-10-03: an acceptance binds).

Each turn is classified from the god's prompt and its proposal. An acceptance binds, so the god performs, waits, or risks breach, and bargaining is for a thread still open: the action the term calls for, committed, is performed; a turn that did something else is waited for a named event when its prompt shows what stops it (the digest's UNPERFORMABLE obstacle, or no mortal at the place a legend is to be told); every other turn, an attempt to bargain over the accepted thread included, is knowingly risked breach, since the obligation led the prompt.

| God | Tick | Thread | Deadline | Chose | Classified | Waiting for |
| --- | --- | --- | --- | --- | --- | --- |
| poseidon | 44 | evt-38-716 | 128 | strike | performed |  |

## Repetition

- Athena: longest run 1 of report:herdsman-damon (cap 3). Choices: report:herdsman-damon ×1, bless:evt-38-718 ×1, legend:legend ×1, bless:evt-153-2683 ×1, bless:evt-180-3117 ×1
- Hades: longest run 1 of travel:ferry-dock (cap 3). Choices: travel:ferry-dock ×1, report:poseidon ×1, travel:olympus-gate ×1, legend:legend ×1
- Hephaestus: longest run 1 of strike:the-forge (cap 3). Choices: strike:the-forge ×1, bless:evt-41-791 ×1, bless:evt-85-1669 ×1, legend:legend ×1, bless:evt-179-3104 ×1
- Hera: longest run 2 of report:zeus (cap 3). Choices: report:zeus ×2, bless:evt-3-60 ×1, bless:evt-166-2886 ×1
- Hermes: longest run 1 of bless:evt-7-164 (cap 3). Choices: bless:evt-7-164 ×1, bless:evt-58-1142 ×1, bless:evt-54-1070 ×1, bless:evt-63-1244 ×1, bless:evt-242-4199 ×1
- Poseidon: longest run 1 of practice:offer evt-5-110 (cap 3). Choices: practice:offer evt-5-110 ×1, strike:fisher-dion ×1, bless:evt-72-1428 ×1, report:hermes ×1, bless:evt-192-3335 ×1, bless:evt-241-4177 ×1
- Zeus: longest run 2 of legend:legend (cap 3). Choices: legend:legend ×2, bless:evt-5-106 ×1, bless:evt-204-3521 ×1, practice:offer evt-222-3843 ×1

## Automated checks

| God | Check | Result | Detail |
| --- | --- | --- | --- |
| Athena | profile trace | pass | 5 actions: 4 ability-backed, 1 context-backed |
| Athena | repetition | pass | longest run 1 of report:herdsman-damon (cap 3) |
| Athena | minimum activity | pass | 5 committed model actions (at least 5) |
| Athena | influence | pass | 7 caused (told belief, relationship-changed) |
| Athena | petition heard | pass | 11 petitions addressed to this god (at least 1) |
| Athena | petition answered | pass | 3 of 11 answered (at least 1) |
| Hades | profile trace | pass | 4 actions: 1 ability-backed, 3 context-backed |
| Hades | repetition | pass | longest run 1 of travel:ferry-dock (cap 3) |
| Hades | minimum activity | FAIL | 4 committed model actions (at least 5) |
| Hades | influence | pass | 1 caused (told belief) |
| Hades | petition heard | FAIL | no petition was addressed to this god (at least 1) |
| Hades | petition answered | pass | 0 heard; this god has no bless or strike to answer with, so none is required |
| Hephaestus | profile trace | pass | 5 actions: 5 ability-backed, 0 context-backed |
| Hephaestus | repetition | pass | longest run 1 of strike:the-forge (cap 3) |
| Hephaestus | minimum activity | pass | 5 committed model actions (at least 5) |
| Hephaestus | influence | pass | 4 caused (relationship-changed, told belief) |
| Hephaestus | petition heard | pass | 4 petitions addressed to this god (at least 1) |
| Hephaestus | petition answered | pass | 3 of 4 answered (at least 1) |
| Hera | profile trace | pass | 4 actions: 0 ability-backed, 4 context-backed |
| Hera | repetition | pass | longest run 2 of report:zeus (cap 3) |
| Hera | minimum activity | FAIL | 4 committed model actions (at least 5) |
| Hera | influence | pass | 4 caused (relationship-changed, told belief) |
| Hera | petition heard | pass | 3 petitions addressed to this god (at least 1) |
| Hera | petition answered | pass | 2 of 3 answered (at least 1) |
| Hermes | profile trace | pass | 5 actions: 5 ability-backed, 0 context-backed |
| Hermes | repetition | pass | longest run 1 of bless:evt-7-164 (cap 3) |
| Hermes | minimum activity | pass | 5 committed model actions (at least 5) |
| Hermes | influence | pass | 5 caused (relationship-changed) |
| Hermes | petition heard | pass | 11 petitions addressed to this god (at least 1) |
| Hermes | petition answered | pass | 5 of 11 answered (at least 1) |
| Poseidon | profile trace | pass | 6 actions: 1 ability-backed, 5 context-backed |
| Poseidon | repetition | pass | longest run 1 of practice:offer evt-5-110 (cap 3) |
| Poseidon | minimum activity | pass | 6 committed model actions (at least 5) |
| Poseidon | influence | pass | 5 caused (relationship-changed, told belief) |
| Poseidon | petition heard | pass | 14 petitions addressed to this god (at least 1) |
| Poseidon | petition answered | pass | 4 of 14 answered (at least 1) |
| Zeus | profile trace | pass | 5 actions: 2 ability-backed, 3 context-backed |
| Zeus | repetition | pass | longest run 2 of legend:legend (cap 3) |
| Zeus | minimum activity | pass | 5 committed model actions (at least 5) |
| Zeus | influence | pass | 4 caused (relationship-changed, told belief) |
| Zeus | petition heard | pass | 3 petitions addressed to this god (at least 1) |
| Zeus | petition answered | pass | 2 of 3 answered (at least 1) |

## Model run

- 37 requests: 37 answered (37 native, 0 repaired), 0 exhausted; latency p50 7251 ms, p95 13468 ms; prompt p50 7161 / max 9956 characters; frames showed model-degraded in 0% of polls
- valid actions: held (36 proposals, all god actions, none rejected as malformed)
- perception compliance: held (every id named by 36 proposals was in the prompt behind it)
- relationship change with provenance: held (119 changes, 119 explained from the log alone, e.g. wrong > memory-recorded > relationship-changed)
- changed next action: held (hera: report:zeus before its first belief, report:zeus after (same); hermes: bless:evt-54-1070 before its first belief, bless:evt-63-1244 after (changed); poseidon: strike:fisher-dion before its first belief, bless:evt-72-1428 after (changed); zeus: bless:evt-5-106 before its first belief, legend: after (changed))
- goal privacy: held (37 prompts checked against 0 goals: none carried another god's goal outside a told account or a perceived legend)
- petition privacy: held (37 prompts checked against 46 petitions: none listed a petition addressed to another god, and none carried one the god did not witness)
- god thread endings: FAILED (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: no thread ending it caused left a persistent consequence; hermes: no thread ending it caused left a persistent consequence; poseidon: 1 (fulfilled [evt-38-716]); zeus: no thread ending it caused left a persistent consequence)
- supplication and settlement: FAILED (2 supplications, 0 settlements, 0 refused or breached)
- thread endings recorded: held (2 threads: 1 ended with their parties remembering, 1 still open and inside their deadlines)
- no reopening without a new cause: held (0 settlements, 0 opened as linked successors on a newer cause, none reopened a closed matter on an old one)
- no-progress moves advance nothing: held (0 moves judged no progress, each leaving a refusal record and advancing no thread; no counter restated an earlier offer)
- consequence changes a later choice: held (poseidon: strike:fisher-dion before the consequence, bless: after (changed); the prompt behind it showed how the thread ended)
- obligated turns recorded: held (1 obligated turns, each with its recorded choice: 1 performed)
- contest endings: held (no contest was opened)
- alliances sealed by agreement: held (no alliance was formed)

Requests, in the order they ran (one at a time):

| # | God | Asked at tick | Applied at tick | Latency | Outcome | Prompt chars |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | athena | 1 | 6 | 4.9 s | answered | 5414 |
| 2 | hades | 6 | 9 | 2.4 s | answered | 3551 |
| 3 | hephaestus | 9 | 14 | 4.1 s | answered | 4839 |
| 4 | hera | 14 | 22 | 8.0 s | answered | 6740 |
| 5 | hermes | 22 | 29 | 6.9 s | answered | 6337 |
| 6 | poseidon | 29 | 38 | 8.7 s | answered | 7215 |
| 7 | zeus | 38 | 44 | 5.4 s | answered | 6925 |
| 8 | poseidon | 44 | 52 | 7.7 s | answered | 6423 |
| 9 | athena | 52 | 60 | 7.3 s | answered | 7407 |
| 10 | hades | 60 | 66 | 6.0 s | answered | 4608 |
| 11 | hephaestus | 66 | 74 | 8.0 s | answered | 7161 |
| 12 | hera | 74 | 79 | 4.6 s | answered | 4838 |
| 13 | hermes | 79 | 90 | 10.0 s | answered | 8054 |
| 14 | poseidon | 90 | 99 | 8.7 s | answered | 7519 |
| 15 | zeus | 99 | 104 | 4.5 s | answered | 5545 |
| 16 | athena | 104 | 110 | 5.1 s | answered | 5497 |
| 17 | hades | 110 | 115 | 4.3 s | answered | 4696 |
| 18 | hephaestus | 115 | 124 | 8.3 s | answered | 7321 |
| 19 | hera | 124 | 130 | 5.5 s | answered | 5513 |
| 20 | hermes | 130 | 141 | 10.5 s | answered | 7307 |
| 21 | poseidon | 141 | 150 | 8.3 s | answered | 5773 |
| 22 | zeus | 150 | 156 | 6.0 s | answered | 5870 |
| 23 | athena | 156 | 166 | 9.4 s | answered | 8194 |
| 24 | hades | 166 | — | 3.2 s | answered | 3829 |
| 25 | hephaestus | 170 | 178 | 7.1 s | answered | 5556 |
| 26 | hera | 178 | 192 | 13.5 s | answered | 7541 |
| 27 | hermes | 192 | 202 | 9.3 s | answered | 7379 |
| 28 | poseidon | 202 | 214 | 12.0 s | answered | 9733 |
| 29 | zeus | 214 | 222 | 7.2 s | answered | 7819 |
| 30 | athena | 222 | 236 | 13.5 s | answered | 9885 |
| 31 | hades | 236 | 240 | 3.5 s | answered | 3829 |
| 32 | hephaestus | 240 | 250 | 9.0 s | answered | 7410 |
| 33 | hera | 250 | 255 | 4.5 s | answered | 7601 |
| 34 | hermes | 255 | 268 | 12.1 s | answered | 8945 |
| 35 | poseidon | 268 | 281 | 12.5 s | answered | 9736 |
| 36 | zeus | 281 | 288 | 6.3 s | answered | 7879 |
| 37 | athena | 288 | — | 12.2 s | answered | 9956 |

Each god's turns (finished requests; the gap is the ticks between its request starts):

| God | Turns | Median gap (ticks) | p95 gap (ticks) | Worst gap (ticks) | Median latency |
| --- | --- | --- | --- | --- | --- |
| athena | 6 | 52 | 66 | 66 | 8.3 s |
| hades | 5 | 55 | 70 | 70 | 3.5 s |
| hephaestus | 5 | 56 | 70 | 70 | 8.0 s |
| hera | 5 | 57 | 72 | 72 | 5.5 s |
| hermes | 5 | 59.5 | 63 | 63 | 10.0 s |
| poseidon | 6 | 51 | 66 | 66 | 8.7 s |
| zeus | 5 | 62.5 | 67 | 67 | 6.0 s |

## Owner rubric

Score each 0, 1, or 2: 0 = replan pressure, 1 = needs tuning, 2 = good enough to continue. The owner scores; nothing above is a score.

| Dimension | Score (0/1/2) | Notes |
| --- | --- | --- |
| Novelty |  |  |
| Causality |  |  |
| Recognizable identity |  |  |
| Pacing |  |  |
| Inspectability |  |  |

Decision: continue / tune / replan: 

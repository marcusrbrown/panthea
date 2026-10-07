# Episode 1 of 3

## Settings

- Recorded: 2026-10-07T18:53:22.037Z
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

1. **tick 11, Athena:** legend (ability-backed)
   - says: "I advise moderation in your pursuits, for all actions require a balance."
   - heard by: herdsman-damon, weaver-ismene, weaver-xenia, weaver-zoe
   - caused: legend-recorded (athena)
   - then: herdsman-damon now believes athena: "I advise moderation in your pursuits, for all actions require a balance."
   - then: weaver-ismene now believes athena: "I advise moderation in your pursuits, for all actions require a balance."
   - then: weaver-xenia now believes athena: "I advise moderation in your pursuits, for all actions require a balance."
   - then: weaver-zoe now believes athena: "I advise moderation in your pursuits, for all actions require a balance."
2. **tick 16, Hades:** travel → ferry-dock (context-backed)
   - caused: journey-started (hades)
3. **tick 24, Hephaestus:** legend (ability-backed)
   - says: "I, Hephaestus, am known for teaching crafts to men. I share this tale with my fellow craftsmen."
   - heard by: provisioner-nikanor, smith-brontes, smith-delia, smith-ktesias
   - caused: legend-recorded (hephaestus)
   - then: provisioner-nikanor now believes hephaestus: "I, Hephaestus, am known for teaching crafts to men. I share this tale with my fellow craftsmen."
   - then: smith-brontes now believes hephaestus: "I, Hephaestus, am known for teaching crafts to men. I share this tale with my fellow craftsmen."
   - then: smith-delia now believes hephaestus: "I, Hephaestus, am known for teaching crafts to men. I share this tale with my fellow craftsmen."
   - then: smith-ktesias now believes hephaestus: "I, Hephaestus, am known for teaching crafts to men. I share this tale with my fellow craftsmen."
4. **tick 33, Hera:** bless → evt-3-60 (context-backed)
   - caused: resource-consumed (hera); blessing-granted (hera)
   - then: farmer → hera: affinity +1
5. **tick 42, Hermes:** bless → evt-7-162 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: market-trader-iris → hermes: affinity +1
6. **tick 53, Poseidon:** strike → fisher-dion (ability-backed)
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
7. **tick 64, Zeus:** practice → offer evt-5-106 (context-backed)
   - caused: practice-opened (zeus)
8. **tick 72, Athena:** bless → evt-38-767 (ability-backed)
   - caused: resource-consumed (athena); blessing-granted (athena)
   - then: farmer → athena: affinity +1
9. **tick 76, Zeus:** bless → evt-5-106 (context-backed)
   - caused: resource-consumed (zeus); blessing-granted (zeus)
   - then: woodcutter → zeus: affinity +1
10. **tick 92, Hephaestus:** report → smith-ktesias (context-backed)
   - says: "I remember well when we, with Athena, taught the arts to men in caves, aiding their climb from darkness."
   - caused: report-told (hephaestus → smith-ktesias)
   - then: smith-ktesias now believes hephaestus: "I remember well when we, with Athena, taught the arts to men in caves, aiding their climb from darkness."
11. **tick 96, Hera:** bless → evt-58-1140 (context-backed)
   - caused: resource-consumed (hera); blessing-granted (hera)
   - then: ferryman → hera: affinity +1
12. **tick 104, Hermes:** bless → evt-55-1083 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: fisher-dion → hermes: affinity +1
13. **tick 116, Poseidon:** bless → evt-84-1694 (context-backed)
   - caused: resource-consumed (poseidon); blessing-granted (poseidon)
   - then: ferryman → poseidon: affinity +1
14. **tick 121, Zeus:** report → hera (context-backed)
   - says: "You should know, I'm pleased that the woodcutter honored our agreements."
   - caused: report-told (zeus → hera)
   - then: hera now believes zeus: "You should know, I'm pleased that the woodcutter honored our agreements."
15. **tick 126, Athena:** legend (ability-backed)
   - says: "Cities must safeguard their people above all else"
   - heard by: herdsman-damon, weaver-ismene, weaver-xenia
   - caused: legend-recorded (athena)
   - then: herdsman-damon now believes athena: "Cities must safeguard their people above all else"
   - then: weaver-ismene now believes athena: "Cities must safeguard their people above all else"
   - then: weaver-xenia now believes athena: "Cities must safeguard their people above all else"
16. **tick 131, Hades:** report → hermes (context-backed)
   - says: "I saw the Fish Landing repaired completely."
   - caused: report-told (hades → hermes)
   - then: hermes now believes hades: "I saw the Fish Landing repaired completely."
17. **tick 137, Hephaestus:** strike → the-forge (ability-backed)
   - caused: resource-consumed (hephaestus); building-damaged (the-forge)
   - then: hephaestus, provisioner-nikanor, smith-brontes remember building-damaged
   - then: provisioner-nikanor → hephaestus: affinity -2
   - then: smith-brontes → hephaestus: affinity -2
18. **tick 141, Hera:** report → zeus (context-backed)
   - says: "I learned of the woodcutter's honor of our agreements. I find it... reassuring."
   - caused: report-told (hera → zeus)
   - then: zeus now believes hera: "I learned of the woodcutter's honor of our agreements. I find it... reassuring."
19. **tick 150, Hermes:** bless → evt-123-2345 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: ferryman → hermes: affinity +1
20. **tick 161, Poseidon:** bless → evt-87-1748 (context-backed)
   - caused: resource-consumed (poseidon); blessing-granted (poseidon)
   - then: fisher-melina → poseidon: affinity +1
21. **tick 168, Zeus:** bless → evt-138-2569 (context-backed)
   - caused: resource-consumed (zeus); blessing-granted (zeus)
   - then: market-trader-iris → zeus: affinity +1
22. **tick 177, Athena:** bless → evt-154-2836 (ability-backed)
   - caused: resource-consumed (athena); blessing-granted (athena)
   - then: fisher-eleni → athena: affinity +1
23. **tick 183, Hades:** report → poseidon (context-backed)
   - says: "I informed Hermes of the Fish Landing's repair."
   - caused: report-told (hades → poseidon)
   - then: poseidon now believes hades: "I informed Hermes of the Fish Landing's repair."
24. **tick 203, Hera:** bless → evt-167-3098 (context-backed)
   - caused: resource-consumed (hera); blessing-granted (hera)
   - then: herdsman-damon → hera: affinity +1
25. **tick 213, Hermes:** bless → evt-198-3652 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: fisher-dion → hermes: affinity +1
26. **tick 225, Poseidon:** bless → evt-212-3870 (context-backed)
   - caused: resource-consumed (poseidon); blessing-granted (poseidon)
   - then: farmer → poseidon: affinity +1
27. **tick 229, Zeus:** legend (ability-backed)
   - says: "Before Hera, I declared the woodcutter's honor, and she acknowledged it."
   - heard by: hera
   - caused: legend-recorded (zeus)
   - then: hera now believes zeus: "Before Hera, I declared the woodcutter's honor, and she acknowledged it."
28. **tick 241, Athena:** bless → evt-214-3920 (ability-backed)
   - caused: resource-consumed (athena); blessing-granted (athena)
   - then: olive-grower-phoebe → athena: affinity +1
29. **tick 252, Hades:** practice → offer evt-200-3693 (context-backed)
   - caused: practice-opened (hades)
30. **tick 261, Hephaestus:** bless → evt-190-3507 (ability-backed)
   - caused: resource-consumed (hephaestus); blessing-granted (hephaestus)
   - then: farmer → hephaestus: affinity +1
31. **tick 269, Hades:** bless → evt-200-3693 (context-backed)
   - caused: resource-consumed (hades); blessing-granted (hades)
   - then: herdsman-damon → hades: affinity +1
32. **tick 276, Hera:** report → zeus (context-backed)
   - says: "I recount a warning, urging caution. Io's ordeal reminds me, I speak Zeus's name, a caution: 'Your promises and our pacts, they're binding, even to gods. Let not our words today find echo in Io's past woe.'"
   - caused: report-told (hera → zeus)
   - then: zeus now believes hera: "I recount a warning, urging caution. Io's ordeal reminds me, I speak Zeus's name, a caution: 'Your promises and our pacts, they're binding, even to gods. Let not our words today find echo in Io's past woe.'"
33. **tick 289, Hermes:** report → ferryman (ability-backed)
   - says: "Your recent gathering was noted. I also witnessed the repair of the Fish Landing, as told by Hades."
   - caused: report-told (hermes → ferryman)
   - then: ferryman now believes hermes: "Your recent gathering was noted. I also witnessed the repair of the Fish Landing, as told by Hades."

## What the world did with every proposal

- dispositions: bless 17 × committed, report 7 × committed, legend 4 × committed, strike 2 × committed, practice 2 × committed, travel 1 × committed, report 1 × not-adjacent

1. Athena: legend → legend — committed: legend-recorded
2. Hades: travel → ferry-dock — committed: journey-started
3. Hephaestus: legend → legend — committed: legend-recorded
4. Hera: bless → evt-3-60 — committed: resource-consumed, blessing-granted
5. Hermes: bless → evt-7-162 — committed: resource-consumed, blessing-granted
6. Poseidon: strike → fisher-dion — committed: resource-consumed, mortal-struck
7. Zeus: practice → offer evt-5-106 — committed: practice-opened
8. Athena: bless → evt-38-767 — committed: resource-consumed, blessing-granted
9. Zeus: bless → evt-5-106 — committed: resource-consumed, blessing-granted
10. Hades: report → ferryman — rejected: not-adjacent
11. Hephaestus: report → smith-ktesias — committed: report-told
12. Hera: bless → evt-58-1140 — committed: resource-consumed, blessing-granted
13. Hermes: bless → evt-55-1083 — committed: resource-consumed, blessing-granted
14. Poseidon: bless → evt-84-1694 — committed: resource-consumed, blessing-granted
15. Zeus: report → hera — committed: report-told
16. Athena: legend → legend — committed: legend-recorded
17. Hades: report → hermes — committed: report-told
18. Hephaestus: strike → the-forge — committed: resource-consumed, building-damaged
19. Hera: report → zeus — committed: report-told
20. Hermes: bless → evt-123-2345 — committed: resource-consumed, blessing-granted
21. Poseidon: bless → evt-87-1748 — committed: resource-consumed, blessing-granted
22. Zeus: bless → evt-138-2569 — committed: resource-consumed, blessing-granted
23. Athena: bless → evt-154-2836 — committed: resource-consumed, blessing-granted
24. Hades: report → poseidon — committed: report-told
25. Hera: bless → evt-167-3098 — committed: resource-consumed, blessing-granted
26. Hermes: bless → evt-198-3652 — committed: resource-consumed, blessing-granted
27. Poseidon: bless → evt-212-3870 — committed: resource-consumed, blessing-granted
28. Zeus: legend → legend — committed: legend-recorded
29. Athena: bless → evt-214-3920 — committed: resource-consumed, blessing-granted
30. Hades: practice → offer evt-200-3693 — committed: practice-opened
31. Hephaestus: bless → evt-190-3507 — committed: resource-consumed, blessing-granted
32. Hades: bless → evt-200-3693 — committed: resource-consumed, blessing-granted
33. Hera: report → zeus — committed: report-told
34. Hermes: report → ferryman — committed: report-told

## The episode's numbers

- Food: 83 "cannot get food" lines; 18 of 40 prayers are about food
- Troubles in a god's domain: Athena 3, Hades 2, Hephaestus 2, Hera 2, Hermes 2, Poseidon 2, Zeus 2
- Wrongs between mortals: 7; 6 between different patrons
  - [evt-1-23] fisher-dion (hermes) wronged fisher-kallias (poseidon): cheating; the victim prayed [evt-5-110]; punished
  - [evt-61-1215] woodcutter (zeus) wronged fisher-stavros (poseidon): feud; the victim prayed [evt-198-3650]; no consequence yet
  - [evt-141-2633] herdsman-damon (hermes) wronged weaver-ismene (athena): theft; the victim did not pray about it; no consequence yet
  - [evt-230-4176] olive-grower-phoebe (athena) wronged market-trader-iris (hermes): unpaid-debt; the victim prayed [evt-232-4202]; no consequence yet
  - [evt-268-4911] smith-brontes (hephaestus) wronged provisioner-nikanor (hermes): feud; the victim prayed [evt-271-4994]; no consequence yet
  - [evt-295-5440] fisher-kallias (poseidon) wronged farmer (hera): unpaid-debt; the victim prayed [evt-297-5487]; no consequence yet
- Defections: 0
- From a prayer's cause to its closing: 22 closed (median 51 ticks, p95 152 ticks); by outcome answered 18, lapsed 4

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
- tick 7: market-trader-iris prayed to hermes: help with wine [evt-7-162] (routed to its patron)
- tick 9: fisher-kallias cannot get fish (no-buyer)
- tick 33: hera blessed farmer: 2 planks
- tick 33: hera answered farmer's prayer [evt-3-60]
- tick 33: farmer remembers hera's answer
- tick 33: farmer → hera: affinity +1
- tick 36: a tool-flaw in athena's domain (spring, the god's floor) took 2 planks of farmer [evt-36-745]
- tick 37: woodcutter cannot get food (no-seller)
- tick 38: farmer prayed to athena: help with planks [evt-38-767] (a trouble in the god's domain: routed to the domain god)
- tick 42: hermes blessed market-trader-iris: 2 wine
- tick 42: hermes answered market-trader-iris's prayer [evt-7-162]
- tick 42: market-trader-iris remembers hermes's answer
- tick 42: market-trader-iris → hermes: affinity +1
- tick 50: a hoard-swallowed in hades's domain (spring, the god's floor) took 2 currency of weaver-zoe [evt-50-978]
- tick 53: poseidon struck fisher-dion and took 2 fish [evt-53-1014]
- tick 53: poseidon answered fisher-kallias's prayer [evt-5-110]
- tick 53: fisher-kallias remembers poseidon's answer
- tick 53: fisher-kallias → poseidon: affinity +1
- tick 54: fisher-dion cannot get food (no-seller)
- tick 55: fisher-dion prayed to hermes: help with fish [evt-55-1083] (routed to its patron)
- tick 55: a roof-leak in hera's domain (spring, the god's floor) took 2 food of ferryman [evt-55-1097]
- tick 57: fisher-dion cannot get food (no-seller)
- tick 58: ferryman prayed to hera: help with food [evt-58-1140] (a trouble in the god's domain: routed to the domain god)
- tick 58: fisher-dion cannot get fish (no-buyer)
- tick 61: woodcutter wronged fisher-stavros: feud of 1 food; quarrelsome, not in need [evt-61-1215]
- tick 62: fisher-dion cannot get fish (no-buyer)
- tick 66: fisher-stavros cannot get food (no-seller)
- tick 67: fisher-stavros prayed to poseidon: help with food [evt-67-1338] (routed to its patron)
- tick 67: a tool-flaw in athena's domain (spring, the season's odds) took 2 tools of smith-delia [evt-67-1351]
- tick 68: fisher-kallias cannot get food (no-funds)
- tick 70: fisher-kallias prayed to poseidon: help with food [evt-70-1401] (routed to its patron)
- tick 71: fisher-stavros cannot get fish (no-buyer)
- tick 71: fisher-dion cannot get fish (no-buyer)
- tick 72: athena blessed farmer: 2 planks
- tick 72: athena answered farmer's prayer [evt-38-767]
- tick 72: farmer remembers athena's answer
- tick 72: farmer → athena: affinity +1
- tick 73: fisher-kallias cannot get fish (no-buyer)
- tick 76: zeus blessed woodcutter: 2 food
- tick 76: zeus's boon to woodcutter was seen given [evt-64-1275] (evt-76-1530)
- tick 76: zeus answered woodcutter's prayer [evt-5-106]
- tick 76: woodcutter remembers zeus's answer
- tick 76: woodcutter → zeus: affinity +1
- tick 81: a harbour-surge in poseidon's domain (spring, the god's floor) damaged fish-landing of ferryman [evt-81-1657]
- tick 84: ferryman prayed to poseidon: help with fish-landing [evt-84-1694] (a trouble in the god's domain: routed to the domain god)
- tick 85: fisher-melina cannot get food (no-funds)
- tick 87: fisher-melina prayed to poseidon: help with food [evt-87-1748] (routed to its patron)
- tick 88: fisher-kallias cannot get food (no-funds)
- tick 90: fisher-melina cannot get fish (no-buyer)
- tick 96: hera blessed ferryman: 2 food
- tick 96: hera answered ferryman's prayer [evt-58-1140]
- tick 96: ferryman remembers hera's answer
- tick 96: ferryman → hera: affinity +1
- tick 101: fisher-kallias cannot get food (no-funds)
- tick 104: hermes blessed fisher-dion: 2 fish
- tick 104: hermes answered fisher-dion's prayer [evt-55-1083]
- tick 104: fisher-dion remembers hermes's answer
- tick 104: fisher-dion → hermes: affinity +1
- tick 105: fisher-melina cannot get food (no-funds)
- tick 106: fisher-kallias cannot get food (no-funds)
- tick 110: fisher-kallias cannot get food (no-funds)
- tick 112: a lightning-fire in zeus's domain (spring, the god's floor) took 1 food of market-trader-iris [evt-112-2164]
- tick 114: market-trader-iris cannot get food (no-seller)
- tick 115: market-trader-iris prayed to hermes: help with food [evt-115-2195] (routed to its patron)
- tick 116: poseidon blessed ferryman: 3 planks for fish-landing
- tick 116: poseidon answered ferryman's prayer [evt-84-1694]
- tick 116: ferryman remembers poseidon's answer
- tick 116: ferryman → poseidon: affinity +1
- tick 119: fisher-kallias cannot get food (no-funds)
- tick 120: the director made smith-ktesias take 104 food from ferryman
- tick 123: ferryman prayed to hermes: help with food [evt-123-2345] (not its authored patron (a defection or a domain))
- tick 124: a vanished-goods in hermes's domain (spring, the god's floor) took 2 food of smith-ktesias [evt-124-2369]
- tick 128: olive-grower-aristo cannot get food (no-funds)
- tick 129: olive-grower-phoebe cannot get food (no-funds)
- tick 136: market-trader-iris cannot get food (no-funds)
- tick 137: weaver-zoe cannot get food (no-seller)
- tick 138: market-trader-iris prayed to zeus: help with food [evt-138-2569] (a trouble in the god's domain: routed to the domain god)
- tick 138: weaver-zoe prayed to athena: help with food [evt-138-2575] (routed to its patron)
- tick 139: a cracked-tools in hephaestus's domain (spring, the god's floor) took 2 tools of smith-delia [evt-139-2597]
- tick 140: weaver-zoe cannot get food (no-seller)
- tick 141: herdsman-damon wronged weaver-ismene: theft of 2 cloth; greedy, not in need [evt-141-2633]
- tick 148: fisher-kallias cannot get food (no-funds)
- tick 148: olive-grower-aristo cannot get food (no-funds)
- tick 148: olive-grower-leon cannot get food (no-funds)
- tick 150: hermes blessed ferryman: 4 food
- tick 150: hermes answered ferryman's prayer [evt-123-2345]
- tick 150: ferryman remembers hermes's answer
- tick 150: ferryman → hermes: affinity +1
- tick 152: fisher-melina cannot get fish (no-buyer)
- tick 152: fisher-stavros cannot get fish (no-buyer)
- tick 152: fisher-eleni cannot get fish (no-buyer)
- tick 152: fisher-dion cannot get fish (no-buyer)
- tick 153: fisher-melina cannot get food (no-seller)
- tick 153: fisher-stavros cannot get food (no-seller)
- tick 153: fisher-dion cannot get food (no-seller)
- tick 154: fisher-melina prayed to poseidon: help with fish [evt-154-2834] (routed to its patron)
- tick 154: fisher-stavros prayed to poseidon: help with fish [evt-154-2835] (routed to its patron)
- tick 154: fisher-eleni prayed to athena: help with fish [evt-154-2836] (routed to its patron)
- tick 154: fisher-dion prayed to hermes: help with food [evt-154-2837] (routed to its patron)
- tick 156: market-trader-iris cannot get food (no-funds)
- tick 156: fisher-melina cannot get fish (no-buyer)
- tick 156: fisher-stavros cannot get fish (no-buyer)
- tick 156: fisher-eleni cannot get fish (no-buyer)
- tick 156: fisher-dion cannot get fish (no-buyer)
- tick 159: fisher-melina cannot get fish (no-buyer)
- tick 159: fisher-stavros cannot get fish (no-buyer)
- tick 159: fisher-eleni cannot get fish (no-buyer)
- tick 159: fisher-dion cannot get fish (no-buyer)
- tick 161: poseidon blessed fisher-melina: 2 food
- tick 161: poseidon answered fisher-melina's prayer [evt-87-1748]
- tick 161: fisher-melina remembers poseidon's answer
- tick 161: fisher-melina → poseidon: affinity +1
- tick 162: a roof-leak in hera's domain (spring, the god's floor) took 2 food of herdsman-damon [evt-162-3007]
- tick 162: weaver-zoe cannot get food (no-seller)
- tick 164: weaver-xenia cannot get wool (no-buyer)
- tick 166: a lightning-fire in zeus's domain (spring, the god's floor) took 1 food of fisher-eleni [evt-166-3078]
- tick 166: olive-grower-leon cannot get olives (no-buyer)
- tick 166: weaver-xenia cannot get wool (no-buyer)
- tick 167: herdsman-damon prayed to hera: help with food [evt-167-3098] (a trouble in the god's domain: routed to the domain god)
- tick 167: a vanished-goods in hermes's domain (spring, the god's floor) took 2 olives of weaver-ismene [evt-167-3103]
- tick 168: zeus blessed market-trader-iris: 1 food
- tick 168: olive-grower-leon prayed to poseidon: help with olives [evt-168-3120] (routed to its patron)
- tick 168: fisher-melina cannot get fish (no-buyer)
- tick 168: fisher-stavros cannot get fish (no-buyer)
- tick 168: fisher-eleni cannot get fish (no-buyer)
- tick 168: fisher-dion cannot get fish (no-buyer)
- tick 168: olive-grower-aristo cannot get food (no-funds)
- tick 168: olive-grower-leon cannot get food (no-seller)
- tick 168: weaver-xenia cannot get wool (no-buyer)
- tick 168: zeus answered market-trader-iris's prayer [evt-138-2569]
- tick 168: market-trader-iris remembers zeus's answer
- tick 168: market-trader-iris → zeus: affinity +1
- tick 170: weaver-xenia cannot get wool (no-buyer)
- tick 171: fisher-melina cannot get fish (no-buyer)
- tick 171: fisher-stavros cannot get fish (no-buyer)
- tick 171: fisher-eleni cannot get fish (no-buyer)
- tick 171: fisher-dion cannot get fish (no-buyer)
- tick 172: olive-grower-phoebe cannot get olives (no-buyer)
- tick 172: olive-grower-leon cannot get food (no-seller)
- tick 174: olive-grower-phoebe prayed to athena: help with olives [evt-174-3253] (routed to its patron)
- tick 176: olive-grower-leon cannot get olives (no-buyer)
- tick 177: athena blessed fisher-eleni: 2 fish
- tick 177: athena answered fisher-eleni's prayer [evt-154-2836]
- tick 177: fisher-eleni remembers athena's answer
- tick 177: fisher-eleni → athena: affinity +1
- tick 178: olive-grower-leon cannot get olives (no-buyer)
- tick 181: weaver-xenia cannot get wool (no-buyer)
- tick 183: weaver-xenia cannot get wool (no-buyer)
- tick 185: weaver-xenia cannot get wool (no-buyer)
- tick 186: olive-grower-leon cannot get food (no-funds)
- tick 187: weaver-xenia cannot get wool (no-buyer)
- tick 188: a cracked-tools in hephaestus's domain (spring, the god's floor) took 2 tools of farmer [evt-188-3478]
- tick 189: fisher-kallias cannot get food (no-seller)
- tick 189: fisher-stavros cannot get food (no-seller)
- tick 189: fisher-eleni cannot get food (no-seller)
- tick 189: fisher-dion cannot get food (no-seller)
- tick 189: olive-grower-aristo cannot get food (no-seller)
- tick 189: olive-grower-phoebe cannot get food (no-funds)
- tick 189: weaver-ismene cannot get food (no-seller)
- tick 189: weaver-zoe cannot get food (no-seller)
- tick 189: weaver-xenia cannot get wool (no-buyer)
- tick 189: smith-delia cannot get food (no-seller)
- tick 190: farmer prayed to hephaestus: help with tools [evt-190-3507] (a trouble in the god's domain: routed to the domain god)
- tick 191: weaver-xenia cannot get wool (no-buyer)
- tick 192: olive-grower-aristo prayed to athena: help with food [evt-192-3550] (routed to its patron)
- tick 194: fisher-kallias cannot get food (no-funds)
- tick 194: olive-grower-aristo cannot get food (no-seller)
- tick 195: a quake in poseidon's domain (spring, the season's odds) damaged the-tavern of farmer [evt-195-3603]
- tick 195: a hoard-swallowed in hades's domain (spring, the god's floor) took 1 currency of herdsman-damon [evt-195-3604]
- tick 196: market-trader-iris cannot get food (no-funds)
- tick 196: fisher-stavros cannot get fish (no-buyer)
- tick 196: fisher-eleni cannot get fish (no-buyer)
- tick 196: fisher-dion cannot get fish (no-buyer)
- tick 197: fisher-stavros cannot get food (no-seller)
- tick 197: fisher-eleni cannot get food (no-seller)
- tick 197: fisher-dion cannot get food (no-seller)
- tick 197: olive-grower-aristo cannot get olives (no-buyer)
- tick 198: fisher-stavros prayed to poseidon: punish woodcutter, who owns woodshed [evt-198-3650] (routed to its patron)
- tick 198: fisher-eleni prayed to athena: help with food [evt-198-3651] (routed to its patron)
- tick 198: fisher-dion prayed to hermes: help with fish [evt-198-3652] (routed to its patron)
- tick 200: herdsman-damon prayed to hades: help with currency [evt-200-3693] (a trouble in the god's domain: routed to the domain god)
- tick 200: the season turned from spring to summer
- tick 200: weaver-xenia cannot get wool (no-buyer)
- tick 202: weaver-xenia cannot get wool (no-buyer)
- tick 203: hera blessed herdsman-damon: 2 food
- tick 203: hera answered herdsman-damon's prayer [evt-167-3098]
- tick 203: herdsman-damon remembers hera's answer
- tick 203: herdsman-damon → hera: affinity +1
- tick 204: weaver-xenia cannot get wool (no-buyer)
- tick 206: weaver-xenia cannot get wool (no-buyer)
- tick 208: weaver-xenia cannot get wool (no-buyer)
- tick 210: weaver-xenia cannot get wool (no-buyer)
- tick 211: fisher-kallias cannot get food (no-seller)
- tick 211: fisher-stavros cannot get food (no-seller)
- tick 211: fisher-eleni cannot get food (no-seller)
- tick 211: fisher-dion cannot get food (no-seller)
- tick 211: olive-grower-phoebe cannot get food (no-seller)
- tick 211: olive-grower-leon cannot get food (no-seller)
- tick 211: weaver-ismene cannot get food (no-seller)
- tick 211: weaver-zoe cannot get food (no-seller)
- tick 211: smith-delia cannot get food (no-seller)
- tick 212: farmer prayed to poseidon: help with the-tavern [evt-212-3870] (a trouble in the god's domain: routed to the domain god)
- tick 212: weaver-xenia cannot get wool (no-buyer)
- tick 213: hermes blessed fisher-dion: 2 fish
- tick 213: hermes answered fisher-dion's prayer [evt-198-3652]
- tick 213: fisher-dion remembers hermes's answer
- tick 213: fisher-dion → hermes: affinity +1
- tick 214: olive-grower-phoebe prayed to athena: help with food [evt-214-3920] (routed to its patron)
- tick 216: market-trader-iris cannot get food (no-funds)
- tick 216: olive-grower-phoebe cannot get food (no-seller)
- tick 217: weaver-xenia cannot get wool (no-buyer)
- tick 218: fisher-stavros's prayer to poseidon lapsed unanswered [evt-67-1338]
- tick 218: fisher-stavros remembers poseidon's silence
- tick 218: fisher-stavros → poseidon: affinity -2, grudge +1
- tick 220: olive-grower-phoebe cannot get olives (no-buyer)
- tick 221: weaver-xenia cannot get wool (no-buyer)
- tick 221: fisher-kallias's prayer to poseidon lapsed unanswered [evt-70-1401]
- tick 221: fisher-kallias remembers poseidon's silence
- tick 221: fisher-kallias → poseidon: affinity -2, grudge +1
- tick 223: weaver-xenia cannot get wool (no-buyer)
- tick 225: poseidon blessed farmer: 3 planks for the-tavern
- tick 225: weaver-xenia cannot get wool (no-buyer)
- tick 225: poseidon answered farmer's prayer [evt-212-3870]
- tick 225: farmer remembers poseidon's answer
- tick 225: farmer → poseidon: affinity +1
- tick 227: fisher-melina cannot get fish (no-buyer)
- tick 227: weaver-xenia cannot get wool (no-buyer)
- tick 229: olive-grower-aristo cannot get food (no-funds)
- tick 229: olive-grower-phoebe cannot get food (no-funds)
- tick 229: weaver-xenia cannot get wool (no-buyer)
- tick 230: olive-grower-phoebe wronged market-trader-iris: unpaid-debt of 3 currency; honest, in need; the credit [evt-130-2455] failed [evt-230-4176]
- tick 231: weaver-xenia cannot get wool (no-buyer)
- tick 232: market-trader-iris prayed to hermes: punish olive-grower-phoebe, who owns  [evt-232-4202] (routed to its patron)
- tick 236: market-trader-iris cannot get food (no-funds)
- tick 236: weaver-xenia cannot get wool (no-buyer)
- tick 238: weaver-xenia cannot get wool (no-buyer)
- tick 240: weaver-xenia cannot get wool (no-buyer)
- tick 240: the director made ferryman take 84 fish from market-trader-iris
- tick 241: athena blessed olive-grower-phoebe: 2 food
- tick 241: athena answered olive-grower-phoebe's prayer [evt-214-3920]
- tick 241: olive-grower-phoebe remembers athena's answer
- tick 241: olive-grower-phoebe → athena: affinity +1
- tick 242: weaver-xenia cannot get wool (no-buyer)
- tick 244: weaver-xenia cannot get wool (no-buyer)
- tick 246: weaver-xenia cannot get wool (no-buyer)
- tick 247: fisher-melina cannot get fish (no-buyer)
- tick 248: fisher-kallias cannot get food (no-funds)
- tick 248: olive-grower-aristo cannot get food (no-funds)
- tick 248: weaver-xenia cannot get wool (no-buyer)
- tick 250: weaver-xenia cannot get wool (no-buyer)
- tick 251: fisher-kallias cannot get food (no-funds)
- tick 251: olive-grower-leon cannot get food (no-funds)
- tick 252: weaver-xenia cannot get wool (no-buyer)
- tick 253: fisher-kallias prayed to poseidon: help with food [evt-253-4568] (routed to its patron)
- tick 254: fisher-stavros cannot get fish (no-buyer)
- tick 254: fisher-eleni cannot get fish (no-buyer)
- tick 254: fisher-dion cannot get fish (no-buyer)
- tick 255: market-trader-iris prayed to hermes: help with fish [evt-255-4601] (routed to its patron)
- tick 255: olive-grower-aristo wronged smith-delia: cheating of 2 currency; greedy, in need [evt-255-4618]
- tick 255: fisher-eleni cannot get food (no-seller)
- tick 255: fisher-dion cannot get food (no-seller)
- tick 256: fisher-eleni prayed to athena: help with fish [evt-256-4647] (routed to its patron)
- tick 256: fisher-dion prayed to hermes: help with fish [evt-256-4648] (routed to its patron)
- tick 256: market-trader-iris cannot get food (no-funds)
- tick 256: fisher-kallias cannot get fish (no-buyer)
- tick 257: weaver-xenia cannot get wool (no-buyer)
- tick 259: weaver-xenia cannot get wool (no-buyer)
- tick 261: hephaestus blessed farmer: 2 tools
- tick 261: weaver-xenia cannot get wool (no-buyer)
- tick 261: hephaestus answered farmer's prayer [evt-190-3507]
- tick 261: farmer remembers hephaestus's answer
- tick 261: farmer → hephaestus: affinity +1
- tick 263: weaver-xenia cannot get wool (no-buyer)
- tick 265: weaver-xenia cannot get wool (no-buyer)
- tick 266: market-trader-iris's prayer to hermes lapsed unanswered [evt-115-2195]
- tick 266: market-trader-iris remembers hermes's silence
- tick 266: market-trader-iris → hermes: affinity -2, grudge +1
- tick 267: fisher-kallias cannot get fish (no-buyer)
- tick 267: fisher-melina cannot get fish (no-buyer)
- tick 267: weaver-xenia cannot get wool (no-buyer)
- tick 268: smith-brontes wronged provisioner-nikanor: feud of 2 food; quarrelsome, not in need [evt-268-4911]
- tick 269: hades blessed herdsman-damon: 1 currency
- tick 269: fisher-kallias cannot get fish (no-buyer)
- tick 269: fisher-melina cannot get fish (no-buyer)
- tick 269: fisher-stavros cannot get food (no-funds)
- tick 269: fisher-eleni cannot get fish (no-buyer)
- tick 269: weaver-xenia cannot get wool (no-buyer)
- tick 269: smith-brontes cannot get ore (no-buyer)
- tick 269: hades's boon to herdsman-damon was seen given [evt-252-4544] (evt-269-4919)
- tick 269: hades answered herdsman-damon's prayer [evt-200-3693]
- tick 269: herdsman-damon remembers hades's answer
- tick 269: herdsman-damon → hades: affinity +1
- tick 270: a tool-flaw in athena's domain (summer, the god's floor) took 1 tools of market-trader-iris [evt-270-4962]
- tick 271: fisher-stavros prayed to poseidon: help with food [evt-271-4981] (routed to its patron)
- tick 271: provisioner-nikanor prayed to hermes: punish smith-brontes, who owns  [evt-271-4994] (routed to its patron)
- tick 271: weaver-xenia cannot get wool (no-buyer)
- tick 271: smith-brontes cannot get ore (no-buyer)
- tick 272: smith-brontes cannot get food (no-seller)
- tick 274: fisher-stavros cannot get fish (no-buyer)
- tick 275: olive-grower-phoebe cannot get olives (no-buyer)
- tick 276: market-trader-iris cannot get food (no-funds)
- tick 277: weaver-xenia cannot get wool (no-buyer)
- tick 278: market-trader-iris prayed to hermes: help with food [evt-278-5126] (routed to its patron)
- tick 279: weaver-xenia cannot get wool (no-buyer)
- tick 281: weaver-xenia cannot get wool (no-buyer)
- tick 283: weaver-xenia cannot get wool (no-buyer)
- tick 285: weaver-xenia cannot get wool (no-buyer)
- tick 287: fisher-melina cannot get fish (no-buyer)
- tick 287: fisher-stavros cannot get fish (no-buyer)
- tick 287: weaver-xenia cannot get wool (no-buyer)
- tick 288: fisher-kallias cannot get food (no-funds)
- tick 288: olive-grower-aristo cannot get food (no-funds)
- tick 289: olive-grower-phoebe cannot get food (no-funds)
- tick 289: weaver-xenia cannot get wool (no-buyer)
- tick 289: weaver-zoe's prayer to athena lapsed unanswered [evt-138-2575]
- tick 289: weaver-zoe remembers athena's silence
- tick 289: weaver-zoe → athena: affinity -2, grudge +1
- tick 291: fisher-kallias cannot get food (no-funds)
- tick 291: weaver-xenia cannot get wool (no-buyer)
- tick 294: fisher-kallias cannot get food (no-funds)
- tick 295: fisher-kallias wronged farmer: unpaid-debt of 3 currency; greedy, in need; the credit [evt-195-3602] failed [evt-295-5440]
- tick 296: market-trader-iris cannot get food (no-funds)
- tick 296: fisher-eleni cannot get food (no-seller)
- tick 296: fisher-dion cannot get food (no-seller)
- tick 296: weaver-ismene cannot get food (no-seller)
- tick 296: weaver-zoe cannot get food (no-seller)
- tick 296: weaver-xenia cannot get wool (no-buyer)
- tick 296: smith-delia cannot get food (no-seller)
- tick 297: farmer prayed to hera: punish fisher-kallias, who owns  [evt-297-5487] (routed to its patron)
- tick 297: woodcutter cannot get food (no-seller)
- tick 298: weaver-xenia cannot get wool (no-buyer)
- tick 299: woodcutter prayed to zeus: help with food [evt-299-5523] (routed to its patron)
- tick 300: market-trader-iris cannot get food (no-seller)
- tick 300: weaver-xenia cannot get wool (no-buyer)

## Journeys

- journeys: 1 started: 1 arrived, 0 refused, 0 replaced, 0 still travelling

1. Hades: underworld-shore → ferry-dock, set out at tick 16, 1 hop, arrived at tick 16
   - tick 16: crossed from underworld-shore to ferry-dock

## Practice threads

### supplication [evt-64-1275]: zeus → woodcutter, fulfilled

- Opened at tick 64
- Cause: unmet-need (woodcutter) [evt-2-56]
- Answers the prayer [evt-5-106]
- Moves:
  1. tick 64, Zeus: offer — woodcutter offers zeus 1 currency by tick 154
  2. tick 65, woodcutter: accept
- Boon: seen given (evt-76-1530)
- Offering: not seen
- Ending: fulfilled at tick 78, by woodcutter; remembered by woodcutter, zeus
- Changed: zeus → woodcutter: affinity +1

### supplication [evt-252-4544]: hades → herdsman-damon, fulfilled

- Opened at tick 252
- Cause: trouble (herdsman-damon) [evt-195-3604]
- Answers the prayer [evt-200-3693]
- Moves:
  1. tick 252, Hades: offer — herdsman-damon offers hades 1 cloth by tick 342
  2. tick 253, herdsman-damon: accept
- Boon: seen given (evt-269-4919)
- Offering: not seen
- Ending: fulfilled at tick 270, by herdsman-damon; remembered by hades, herdsman-damon
- Changed: hades → herdsman-damon: affinity +1

## What each god practiced

- athena: no practice move; thread endings: none
- hades: supplication, travel; thread endings: fulfilled [evt-252-4544] by its act
- hephaestus: no practice move; thread endings: none
- hera: no practice move; thread endings: none
- hermes: no practice move; thread endings: none
- poseidon: no practice move; thread endings: none
- zeus: supplication; thread endings: fulfilled [evt-64-1275] by its act

## Open threads at the end

No thread was open at the end.

## Moves judged no progress

No move was judged no progress.

## Turns while an obligation was open

A turn is performed, waited for a named event, or knowingly risked breach (R12, amended 2026-10-03: an acceptance binds).

Each turn is classified from the god's prompt and its proposal. An acceptance binds, so the god performs, waits, or risks breach, and bargaining is for a thread still open: the action the term calls for, committed, is performed; a turn that did something else is waited for a named event when its prompt shows what stops it (the digest's UNPERFORMABLE obstacle, or no mortal at the place a legend is to be told); every other turn, an attempt to bargain over the accepted thread included, is knowingly risked breach, since the obligation led the prompt.

| God | Tick | Thread | Deadline | Chose | Classified | Waiting for |
| --- | --- | --- | --- | --- | --- | --- |
| zeus | 72 | evt-64-1275 | 154 | bless | performed |  |
| hades | 261 | evt-252-4544 | 342 | bless | performed |  |

## Repetition

- Athena: longest run 1 of legend:legend (cap 3). Choices: legend:legend ×2, bless:evt-38-767 ×1, bless:evt-154-2836 ×1, bless:evt-214-3920 ×1
- Hades: longest run 1 of travel:ferry-dock (cap 3). Choices: travel:ferry-dock ×1, report:hermes ×1, report:poseidon ×1, practice:offer evt-200-3693 ×1, bless:evt-200-3693 ×1
- Hephaestus: longest run 1 of legend:legend (cap 3). Choices: legend:legend ×1, report:smith-ktesias ×1, strike:the-forge ×1, bless:evt-190-3507 ×1
- Hera: longest run 1 of bless:evt-3-60 (cap 3). Choices: report:zeus ×2, bless:evt-3-60 ×1, bless:evt-58-1140 ×1, bless:evt-167-3098 ×1
- Hermes: longest run 1 of bless:evt-7-162 (cap 3). Choices: bless:evt-7-162 ×1, bless:evt-55-1083 ×1, bless:evt-123-2345 ×1, bless:evt-198-3652 ×1, report:ferryman ×1
- Poseidon: longest run 1 of strike:fisher-dion (cap 3). Choices: strike:fisher-dion ×1, bless:evt-84-1694 ×1, bless:evt-87-1748 ×1, bless:evt-212-3870 ×1
- Zeus: longest run 1 of practice:offer evt-5-106 (cap 3). Choices: practice:offer evt-5-106 ×1, bless:evt-5-106 ×1, report:hera ×1, bless:evt-138-2569 ×1, legend:legend ×1

## Automated checks

| God | Check | Result | Detail |
| --- | --- | --- | --- |
| Athena | profile trace | pass | 5 actions: 5 ability-backed, 0 context-backed |
| Athena | repetition | pass | longest run 1 of legend:legend (cap 3) |
| Athena | minimum activity | pass | 5 committed model actions (at least 5) |
| Athena | influence | pass | 10 caused (told belief, relationship-changed) |
| Athena | petition heard | pass | 8 petitions addressed to this god (at least 1) |
| Athena | petition answered | pass | 3 of 8 answered (at least 1) |
| Hades | profile trace | pass | 5 actions: 0 ability-backed, 5 context-backed |
| Hades | repetition | pass | longest run 1 of travel:ferry-dock (cap 3) |
| Hades | minimum activity | pass | 5 committed model actions (at least 5) |
| Hades | influence | pass | 3 caused (told belief, relationship-changed) |
| Hades | petition heard | pass | 1 petition addressed to this god (at least 1) |
| Hades | petition answered | pass | 1 of 1 answered (at least 1) |
| Hephaestus | profile trace | pass | 4 actions: 3 ability-backed, 1 context-backed |
| Hephaestus | repetition | pass | longest run 1 of legend:legend (cap 3) |
| Hephaestus | minimum activity | FAIL | 4 committed model actions (at least 5) |
| Hephaestus | influence | pass | 6 caused (told belief, relationship-changed) |
| Hephaestus | petition heard | pass | 1 petition addressed to this god (at least 1) |
| Hephaestus | petition answered | pass | 1 of 1 answered (at least 1) |
| Hera | profile trace | pass | 5 actions: 0 ability-backed, 5 context-backed |
| Hera | repetition | pass | longest run 1 of bless:evt-3-60 (cap 3) |
| Hera | minimum activity | pass | 5 committed model actions (at least 5) |
| Hera | influence | pass | 5 caused (relationship-changed, told belief) |
| Hera | petition heard | pass | 4 petitions addressed to this god (at least 1) |
| Hera | petition answered | pass | 3 of 4 answered (at least 1) |
| Hermes | profile trace | pass | 5 actions: 5 ability-backed, 0 context-backed |
| Hermes | repetition | pass | longest run 1 of bless:evt-7-162 (cap 3) |
| Hermes | minimum activity | pass | 5 committed model actions (at least 5) |
| Hermes | influence | pass | 5 caused (relationship-changed, told belief) |
| Hermes | petition heard | pass | 11 petitions addressed to this god (at least 1) |
| Hermes | petition answered | pass | 4 of 11 answered (at least 1) |
| Poseidon | profile trace | pass | 4 actions: 1 ability-backed, 3 context-backed |
| Poseidon | repetition | pass | longest run 1 of strike:fisher-dion (cap 3) |
| Poseidon | minimum activity | FAIL | 4 committed model actions (at least 5) |
| Poseidon | influence | pass | 4 caused (relationship-changed) |
| Poseidon | petition heard | pass | 12 petitions addressed to this god (at least 1) |
| Poseidon | petition answered | pass | 4 of 12 answered (at least 1) |
| Zeus | profile trace | pass | 5 actions: 1 ability-backed, 4 context-backed |
| Zeus | repetition | pass | longest run 1 of practice:offer evt-5-106 (cap 3) |
| Zeus | minimum activity | pass | 5 committed model actions (at least 5) |
| Zeus | influence | pass | 4 caused (relationship-changed, told belief) |
| Zeus | petition heard | pass | 3 petitions addressed to this god (at least 1) |
| Zeus | petition answered | pass | 2 of 3 answered (at least 1) |

## Model run

- 35 requests: 34 answered (34 native, 0 repaired), 1 exhausted; latency p50 7704 ms, p95 12059 ms; prompt p50 6740 / max 9868 characters; frames showed model-degraded in 2% of polls
- exhaustion: 1 × term.party: party must be one of: athena, hades, hera, hermes, poseidon, zeus
- hephaestus was refused after 2 attempts (term.party: party must be one of: athena, hades, hera, hermes, poseidon, zeus); it sent {"action":"practice","cause":"evt-120-2297","term":{"kind":"make-offering","party":"hephaestus","deadlineTicks":100,"to":"zeus","amount":5}}
- valid actions: held (34 proposals, all god actions, none rejected as malformed)
- perception compliance: held (every id named by 34 proposals was in the prompt behind it)
- relationship change with provenance: held (84 changes, 84 explained from the log alone, e.g. wrong > memory-recorded > relationship-changed)
- changed next action: held (hades: report:poseidon before its first belief, practice:evt-200-3693 after (changed); hephaestus: report:smith-ktesias before its first belief, strike:the-forge after (changed); hera: bless:evt-58-1140 before its first belief, report:zeus after (changed); hermes: bless:evt-55-1083 before its first belief, bless:evt-123-2345 after (changed); poseidon: bless:evt-87-1748 before its first belief, bless:evt-212-3870 after (changed); zeus: bless:evt-5-106 before its first belief, report:hera after (changed))
- goal privacy: held (35 prompts checked against 0 goals: none carried another god's goal outside a told account or a perceived legend)
- petition privacy: held (35 prompts checked against 40 petitions: none listed a petition addressed to another god, and none carried one the god did not witness)
- god thread endings: FAILED (athena: no thread ending it caused left a persistent consequence; hades: 1 (fulfilled [evt-252-4544]); hephaestus: no thread ending it caused left a persistent consequence; hera: no thread ending it caused left a persistent consequence; hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: 1 (fulfilled [evt-64-1275]))
- supplication and settlement: FAILED (2 supplications, 0 settlements, 0 refused or breached)
- thread endings recorded: held (2 threads: 2 ended with their parties remembering, 0 still open and inside their deadlines)
- no reopening without a new cause: held (0 settlements, 0 opened as linked successors on a newer cause, none reopened a closed matter on an old one)
- no-progress moves advance nothing: held (0 moves judged no progress, each leaving a refusal record and advancing no thread; no counter restated an earlier offer)
- consequence changes a later choice: held (hades: a consequence at 4974, but no committed action on both sides of it; zeus: bless: before the consequence, report:hera after (changed); the prompt behind it showed how the thread ended)
- obligated turns recorded: held (2 obligated turns, each with its recorded choice: 2 performed)
- contest endings: held (no contest was opened)
- alliances sealed by agreement: held (no alliance was formed)

Requests, in the order they ran (one at a time):

| # | God | Asked at tick | Applied at tick | Latency | Outcome | Prompt chars |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | athena | 1 | 11 | 9.4 s | answered | 5414 |
| 2 | hades | 11 | 16 | 4.1 s | answered | 3552 |
| 3 | hephaestus | 16 | 24 | 7.5 s | answered | 4856 |
| 4 | hera | 24 | 33 | 8.9 s | answered | 6740 |
| 5 | hermes | 33 | 42 | 8.6 s | answered | 6272 |
| 6 | poseidon | 42 | 53 | 10.3 s | answered | 7215 |
| 7 | zeus | 53 | 64 | 10.5 s | answered | 6925 |
| 8 | athena | 64 | 72 | 7.4 s | answered | 7484 |
| 9 | zeus | 72 | 76 | 3.4 s | answered | 6198 |
| 10 | hades | 76 | 84 | 7.1 s | answered | 4714 |
| 11 | hephaestus | 84 | 92 | 7.8 s | answered | 5079 |
| 12 | hera | 92 | 96 | 3.8 s | answered | 6788 |
| 13 | hermes | 96 | 104 | 7.2 s | answered | 6651 |
| 14 | poseidon | 104 | 116 | 11.4 s | answered | 9868 |
| 15 | zeus | 116 | 121 | 4.5 s | answered | 5513 |
| 16 | athena | 121 | 126 | 4.6 s | answered | 5567 |
| 17 | hades | 126 | 131 | 4.9 s | answered | 5100 |
| 18 | hephaestus | 131 | 137 | 5.7 s | answered | 5758 |
| 19 | hera | 137 | 141 | 4.0 s | answered | 5308 |
| 20 | hermes | 141 | 150 | 8.3 s | answered | 7257 |
| 21 | poseidon | 150 | 161 | 10.5 s | answered | 9280 |
| 22 | zeus | 161 | 168 | 6.1 s | answered | 7477 |
| 23 | athena | 168 | 177 | 8.5 s | answered | 8236 |
| 24 | hades | 177 | 183 | 5.2 s | answered | 5185 |
| 25 | hephaestus | 183 | — | 12.5 s | exhausted (invalid-output: term.party: party must be one of: athena, hades, hera, hermes, poseidon, zeus) | 5984 |
| 26 | hera | 196 | 203 | 6.2 s | answered | 7118 |
| 27 | hermes | 203 | 213 | 9.6 s | answered | 7965 |
| 28 | poseidon | 213 | 225 | 11.4 s | answered | 9815 |
| 29 | zeus | 225 | 229 | 4.0 s | answered | 5762 |
| 30 | athena | 229 | 241 | 11.7 s | answered | 9813 |
| 31 | hades | 241 | 252 | 10.3 s | answered | 7177 |
| 32 | hephaestus | 252 | 261 | 8.3 s | answered | 7644 |
| 33 | hades | 261 | 269 | 7.7 s | answered | 6808 |
| 34 | hera | 269 | 276 | 6.5 s | answered | 5558 |
| 35 | hermes | 276 | 289 | 12.1 s | answered | 8361 |
| 36 | poseidon | ≈288 | — | — | in flight at the end (inferred) | — |

Each god's turns (finished requests; the gap is the ticks between its request starts):

| God | Turns | Median gap (ticks) | p95 gap (ticks) | Worst gap (ticks) | Median latency |
| --- | --- | --- | --- | --- | --- |
| athena | 5 | 59 | 63 | 63 | 8.5 s |
| hades | 6 | 51 | 65 | 65 | 6.2 s |
| hephaestus | 5 | 60 | 69 | 69 | 7.8 s |
| hera | 5 | 63.5 | 73 | 73 | 6.2 s |
| hermes | 5 | 62.5 | 73 | 73 | 8.6 s |
| poseidon | 4 | 62 | 63 | 63 | 10.9 s |
| zeus | 5 | 44.5 | 64 | 64 | 4.5 s |

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

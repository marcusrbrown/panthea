# Episode 2 of 3

## Settings

- Recorded: 2026-10-07T20:22:46.648Z
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

1. **tick 7, Athena:** legend (ability-backed)
   - says: "I counsel these mortals, sharing wisdom born of experience and learned from the gods, teach them crafts, and guide them towards prosperity."
   - heard by: herdsman-damon, weaver-ismene, weaver-xenia, weaver-zoe
   - caused: legend-recorded (athena)
   - then: herdsman-damon now believes athena: "I counsel these mortals, sharing wisdom born of experience and learned from the gods, teach them crafts, and guide them towards prosperity."
   - then: weaver-ismene now believes athena: "I counsel these mortals, sharing wisdom born of experience and learned from the gods, teach them crafts, and guide them towards prosperity."
   - then: weaver-xenia now believes athena: "I counsel these mortals, sharing wisdom born of experience and learned from the gods, teach them crafts, and guide them towards prosperity."
   - then: weaver-zoe now believes athena: "I counsel these mortals, sharing wisdom born of experience and learned from the gods, teach them crafts, and guide them towards prosperity."
2. **tick 10, Hades:** travel → ferry-dock (context-backed)
   - caused: journey-started (hades)
3. **tick 15, Hephaestus:** legend (ability-backed)
   - says: "I recall crafting Achilles' armor and shield for Thetis's son, a deed that Athena and I accomplished together, spreading our skills to men."
   - heard by: provisioner-nikanor, smith-brontes, smith-delia, smith-ktesias
   - caused: legend-recorded (hephaestus)
   - then: provisioner-nikanor now believes hephaestus: "I recall crafting Achilles' armor and shield for Thetis's son, a deed that Athena and I accomplished together, spreading our skills to men."
   - then: smith-brontes now believes hephaestus: "I recall crafting Achilles' armor and shield for Thetis's son, a deed that Athena and I accomplished together, spreading our skills to men."
   - then: smith-delia now believes hephaestus: "I recall crafting Achilles' armor and shield for Thetis's son, a deed that Athena and I accomplished together, spreading our skills to men."
   - then: smith-ktesias now believes hephaestus: "I recall crafting Achilles' armor and shield for Thetis's son, a deed that Athena and I accomplished together, spreading our skills to men."
4. **tick 22, Hera:** practice → offer evt-3-61 (context-backed)
   - caused: practice-opened (hera)
5. **tick 29, Hermes:** bless → evt-7-166 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: market-trader-iris → hermes: affinity +1
6. **tick 33, Hera:** bless → evt-3-61 (context-backed)
   - caused: resource-consumed (hera); blessing-granted (hera)
   - then: farmer → hera: affinity +1
7. **tick 42, Poseidon:** practice → offer evt-5-113 (context-backed)
   - caused: practice-opened (poseidon)
8. **tick 47, Zeus:** bless → evt-5-109 (context-backed)
   - caused: resource-consumed (zeus); blessing-granted (zeus)
   - then: woodcutter → zeus: affinity +1
9. **tick 55, Athena:** bless → evt-38-894 (ability-backed)
   - caused: resource-consumed (athena); blessing-granted (athena)
   - then: farmer → athena: affinity +1
10. **tick 63, Hades:** bless → evt-52-1233 (context-backed)
   - caused: resource-consumed (hades); blessing-granted (hades)
   - then: woodcutter → hades: affinity +1
11. **tick 69, Hephaestus:** legend (ability-backed)
   - says: "I recall crafting Achilles' armor and shield for Thetis's son, a deed that Athena and I accomplished together, marking our gift of craft to men."
   - heard by: provisioner-nikanor, smith-brontes, smith-ktesias
   - caused: legend-recorded (hephaestus)
   - then: provisioner-nikanor now believes hephaestus: "I recall crafting Achilles' armor and shield for Thetis's son, a deed that Athena and I accomplished together, marking our gift of craft to men."
   - then: smith-brontes now believes hephaestus: "I recall crafting Achilles' armor and shield for Thetis's son, a deed that Athena and I accomplished together, marking our gift of craft to men."
   - then: smith-ktesias now believes hephaestus: "I recall crafting Achilles' armor and shield for Thetis's son, a deed that Athena and I accomplished together, marking our gift of craft to men."
12. **tick 79, Poseidon:** bless → evt-54-1291 (context-backed)
   - caused: resource-consumed (poseidon); blessing-granted (poseidon)
   - then: fisher-stavros → poseidon: affinity +1
13. **tick 88, Hermes:** bless → evt-64-1558 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: fisher-dion → hermes: affinity +1
14. **tick 94, Hera:** bless → evt-58-1395 (context-backed)
   - caused: resource-consumed (hera); blessing-granted (hera)
   - then: ferryman → hera: affinity +1
15. **tick 105, Poseidon:** bless → evt-84-2068 (context-backed)
   - caused: resource-consumed (poseidon); blessing-granted (poseidon)
   - then: ferryman → poseidon: affinity +1
16. **tick 110, Zeus:** report → hera (context-backed)
   - says: "I have heard the whispers of the mortals in the town-square, murmuring about a growing discontent. I decree this to be a matter of concern. We must address this before it escalates."
   - caused: report-told (zeus → hera)
   - then: hera now believes zeus: "I have heard the whispers of the mortals in the town-square, murmuring about a growing discontent. I decree this to be a matter of concern. We must address this before it escalates."
17. **tick 122, Athena:** bless → evt-99-2468 (ability-backed)
   - caused: resource-consumed (athena); blessing-granted (athena)
   - then: olive-grower-phoebe → athena: affinity +1
18. **tick 128, Hades:** report → hermes (context-backed)
   - says: "I saw the local fish-landing repaired."
   - caused: report-told (hades → hermes)
   - then: hermes now believes hades: "I saw the local fish-landing repaired."
19. **tick 134, Hephaestus:** legend (ability-backed)
   - says: "I crafted the armor and shield for Achilles, with Athena, for Thetis' son, spreading our craft to men."
   - heard by: provisioner-nikanor, smith-brontes, smith-ktesias
   - caused: legend-recorded (hephaestus)
   - then: provisioner-nikanor now believes hephaestus: "I crafted the armor and shield for Achilles, with Athena, for Thetis' son, spreading our craft to men."
   - then: smith-brontes now believes hephaestus: "I crafted the armor and shield for Achilles, with Athena, for Thetis' son, spreading our craft to men."
   - then: smith-ktesias now believes hephaestus: "I crafted the armor and shield for Achilles, with Athena, for Thetis' son, spreading our craft to men."
20. **tick 140, Hera:** report → zeus (context-backed)
   - says: "I remember you saying, 'I have heard the whispers of the mortals in the town-square, murmuring about a growing discontent. I decree this to be a matter of concern. We must address this before it escalates.'"
   - caused: report-told (hera → zeus)
   - then: zeus now believes hera: "I remember you saying, 'I have heard the whispers of the mortals in the town-square, murmuring about a growing discontent. I decree this to be a matter of concern. We must address this before it escalates.'"
21. **tick 151, Hermes:** bless → evt-122-3114 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: fisher-melina → hermes: affinity +1
22. **tick 164, Poseidon:** bless → evt-97-2412 (context-backed)
   - caused: resource-consumed (poseidon); blessing-granted (poseidon)
   - then: fisher-stavros → poseidon: affinity +1
23. **tick 173, Zeus:** practice → offer evt-155-4047 (context-backed)
   - caused: practice-opened (zeus)
24. **tick 184, Athena:** bless → evt-130-3342 (ability-backed)
   - caused: resource-consumed (athena); blessing-granted (athena)
   - then: olive-grower-phoebe → athena: affinity +1
25. **tick 190, Zeus:** refuse → evt-169-4412 (context-backed)
   - caused: petition-refused (zeus)
26. **tick 198, Hades:** bless → evt-124-3181 (context-backed)
   - caused: resource-consumed (hades); blessing-granted (hades)
   - then: smith-ktesias → hades: affinity +1
27. **tick 208, Hephaestus:** bless → evt-152-3959 (ability-backed)
   - caused: resource-consumed (hephaestus); blessing-granted (hephaestus)
   - then: smith-ktesias → hephaestus: affinity +1
28. **tick 218, Hera:** practice → offer evt-151-3908 (context-backed)
   - caused: practice-opened (hera)
29. **tick 229, Hermes:** bless → evt-213-5553 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: fisher-dion → hermes: affinity +1
30. **tick 241, Poseidon:** bless → evt-155-4051 (context-backed)
   - caused: resource-consumed (poseidon); blessing-granted (poseidon)
   - then: fisher-kallias → poseidon: affinity +1
31. **tick 258, Athena:** bless → evt-239-6220 (ability-backed)
   - caused: resource-consumed (athena); blessing-granted (athena)
   - then: olive-grower-phoebe → athena: affinity +1
32. **tick 263, Zeus:** strike → fisher-kallias (ability-backed)
   - caused: resource-consumed (zeus); mortal-struck (fisher-kallias)
   - then: woodcutter → zeus: affinity +1
   - then: farmer, fisher-dion, fisher-kallias, fisher-melina, market-trader-iris, olive-grower-aristo, olive-grower-leon, weaver-zoe, woodcutter remember mortal-struck
   - then: farmer → zeus: affinity -2
   - then: fisher-dion → zeus: affinity -2
   - then: fisher-kallias → zeus: affinity -2, grudge +1
   - then: fisher-melina → zeus: affinity -2
   - then: market-trader-iris → zeus: affinity -2
   - then: olive-grower-aristo → zeus: affinity -2
   - then: olive-grower-leon → zeus: affinity -2
   - then: weaver-zoe → zeus: affinity -2
   - then: woodcutter → zeus: affinity -2
33. **tick 271, Hades:** bless → evt-217-5664 (context-backed)
   - caused: resource-consumed (hades); blessing-granted (hades)
   - then: smith-brontes → hades: affinity +1
34. **tick 282, Hephaestus:** bless → evt-174-4556 (ability-backed)
   - caused: resource-consumed (hephaestus); blessing-granted (hephaestus)
   - then: smith-brontes → hephaestus: affinity +1

## What the world did with every proposal

- dispositions: bless 20 × committed, legend 4 × committed, practice 4 × committed, report 3 × committed, strike 2 × stale-target, travel 1 × committed, refuse 1 × committed, strike 1 × committed

1. Athena: legend → legend — committed: legend-recorded
2. Hades: travel → ferry-dock — committed: journey-started
3. Hephaestus: legend → legend — committed: legend-recorded
4. Hera: practice → offer evt-3-61 — committed: practice-opened
5. Hermes: bless → evt-7-166 — committed: resource-consumed, blessing-granted
6. Hera: bless → evt-3-61 — committed: resource-consumed, blessing-granted
7. Poseidon: practice → offer evt-5-113 — committed: practice-opened
8. Zeus: bless → evt-5-109 — committed: resource-consumed, blessing-granted
9. Athena: bless → evt-38-894 — committed: resource-consumed, blessing-granted
10. Hades: bless → evt-52-1233 — committed: resource-consumed, blessing-granted
11. Hephaestus: legend → legend — committed: legend-recorded
12. Poseidon: bless → evt-54-1291 — committed: resource-consumed, blessing-granted
13. Hermes: bless → evt-64-1558 — committed: resource-consumed, blessing-granted
14. Hera: bless → evt-58-1395 — committed: resource-consumed, blessing-granted
15. Poseidon: bless → evt-84-2068 — committed: resource-consumed, blessing-granted
16. Zeus: report → hera — committed: report-told
17. Athena: bless → evt-99-2468 — committed: resource-consumed, blessing-granted
18. Hades: report → hermes — committed: report-told
19. Hephaestus: legend → legend — committed: legend-recorded
20. Hera: report → zeus — committed: report-told
21. Hermes: bless → evt-122-3114 — committed: resource-consumed, blessing-granted
22. Poseidon: bless → evt-97-2412 — committed: resource-consumed, blessing-granted
23. Zeus: practice → offer evt-155-4047 — committed: practice-opened
24. Athena: bless → evt-130-3342 — committed: resource-consumed, blessing-granted
25. Zeus: refuse → evt-169-4412 — committed: petition-refused
26. Hades: bless → evt-124-3181 — committed: resource-consumed, blessing-granted
27. Hephaestus: bless → evt-152-3959 — committed: resource-consumed, blessing-granted
28. Hera: practice → offer evt-151-3908 — committed: practice-opened
29. Hermes: bless → evt-213-5553 — committed: resource-consumed, blessing-granted
30. Poseidon: bless → evt-155-4051 — committed: resource-consumed, blessing-granted
31. Zeus: strike → fisher-kallias — rejected: stale-target
32. Athena: bless → evt-239-6220 — committed: resource-consumed, blessing-granted
33. Zeus: strike → fisher-kallias — committed: resource-consumed, mortal-struck
34. Hades: bless → evt-217-5664 — committed: resource-consumed, blessing-granted
35. Hephaestus: bless → evt-174-4556 — committed: resource-consumed, blessing-granted
36. Hera: strike → olive-grower-phoebe — rejected: stale-target

## The episode's numbers

- Food: 103 "cannot get food" lines; 22 of 65 prayers are about food
- Troubles in a god's domain: Athena 3, Hades 3, Hephaestus 2, Hera 2, Hermes 2, Poseidon 2, Zeus 2
- Wrongs between mortals: 13; 12 between different patrons
  - [evt-1-23] fisher-dion (hermes) wronged fisher-kallias (poseidon): cheating; the victim prayed [evt-5-113]; revenge
  - [evt-61-1483] woodcutter (zeus) wronged fisher-dion (hermes): feud; the victim prayed [evt-115-2914]; revenge
  - [evt-141-3643] herdsman-damon (hermes) wronged olive-grower-phoebe (athena): theft; the victim prayed [evt-163-4262]; no consequence yet
  - [evt-149-3856] olive-grower-leon (poseidon) wronged farmer (hera): unpaid-debt; the victim prayed [evt-151-3908]; no consequence yet
  - [evt-151-3929] fisher-kallias (poseidon) wronged woodcutter (zeus): unpaid-debt; the victim prayed [evt-155-4047]; punished
  - [evt-153-3989] olive-grower-aristo (athena) wronged fisher-dion (hermes): unpaid-debt; the victim prayed [evt-157-4106]; no consequence yet
  - [evt-153-3990] olive-grower-phoebe (athena) wronged fisher-stavros (poseidon): unpaid-debt; the victim prayed [evt-158-4126]; no consequence yet
  - [evt-193-5040] fisher-kallias (poseidon) wronged fisher-dion (hermes): feud; the victim prayed [evt-238-6194]; no consequence yet
  - [evt-219-5716] market-trader-iris (hermes) wronged smith-delia (athena): unpaid-debt; the victim prayed [evt-221-5778]; no consequence yet
  - [evt-264-6919] olive-grower-phoebe (athena) wronged farmer (hera): unpaid-debt; the victim prayed [evt-281-7334]; no consequence yet
  - [evt-294-7718] smith-ktesias (hephaestus) wronged provisioner-nikanor (hermes): feud; the victim prayed [evt-298-7825]; no consequence yet
  - [evt-299-7854] fisher-dion (hermes) wronged woodcutter (zeus): feud; the victim did not pray about it; no consequence yet
- Defections: 1
- From a prayer's cause to its closing: 40 closed (median 109 ticks, p95 167 ticks); by outcome answered 21, lapsed 18, refused 1

## What the world did

- tick 1: fisher-dion wronged fisher-kallias: cheating of 2 currency; greedy, not in need [evt-1-23]
- tick 1: farmer cannot get planks (no-seller)
- tick 2: woodcutter cannot get food (no-seller)
- tick 2: market-trader-iris cannot get wine (no-buyer)
- tick 2: olive-grower-leon cannot get olives (no-buyer)
- tick 3: farmer prayed to hera: help with planks [evt-3-61] (routed to its patron)
- tick 3: olive-grower-aristo cannot get olives (no-buyer)
- tick 3: olive-grower-phoebe cannot get olives (no-buyer)
- tick 4: farmer cannot get planks (no-seller)
- tick 4: fisher-eleni cannot get fish (no-buyer)
- tick 4: fisher-dion cannot get fish (no-buyer)
- tick 5: woodcutter prayed to zeus: help with food [evt-5-109] (routed to its patron)
- tick 5: fisher-kallias prayed to poseidon: punish fisher-dion, who owns  [evt-5-113] (routed to its patron)
- tick 5: fisher-stavros cannot get fish (no-buyer)
- tick 6: market-trader-iris cannot get wine (no-buyer)
- tick 6: fisher-melina cannot get fish (no-buyer)
- tick 7: market-trader-iris prayed to hermes: help with wine [evt-7-166] (routed to its patron)
- tick 9: fisher-kallias cannot get fish (no-buyer)
- tick 29: hermes blessed market-trader-iris: 2 wine
- tick 29: hermes answered market-trader-iris's prayer [evt-7-166]
- tick 29: market-trader-iris remembers hermes's answer
- tick 29: market-trader-iris → hermes: affinity +1
- tick 33: hera blessed farmer: 2 planks
- tick 33: hera's boon to farmer was seen given [evt-22-509] (evt-33-760)
- tick 33: hera answered farmer's prayer [evt-3-61]
- tick 33: farmer remembers hera's answer
- tick 33: farmer → hera: affinity +1
- tick 36: a tool-flaw in athena's domain (spring, the god's floor) took 2 planks of farmer [evt-36-868]
- tick 37: woodcutter cannot get food (no-seller)
- tick 38: farmer prayed to athena: help with planks [evt-38-894] (a trouble in the god's domain: routed to the domain god)
- tick 45: fisher-melina cannot get food (no-funds)
- tick 46: olive-grower-leon cannot get food (no-funds)
- tick 47: zeus blessed woodcutter: 2 food
- tick 47: fisher-melina cannot get food (no-funds)
- tick 47: zeus answered woodcutter's prayer [evt-5-109]
- tick 47: woodcutter remembers zeus's answer
- tick 47: woodcutter → zeus: affinity +1
- tick 48: olive-grower-leon prayed to poseidon: help with food [evt-48-1135] (routed to its patron)
- tick 48: fisher-stavros cannot get fish (no-buyer)
- tick 48: fisher-eleni cannot get fish (no-buyer)
- tick 48: fisher-dion cannot get fish (no-buyer)
- tick 48: olive-grower-aristo cannot get food (no-funds)
- tick 49: fisher-melina prayed to poseidon: help with food [evt-49-1154] (routed to its patron)
- tick 49: fisher-kallias cannot get food (no-funds)
- tick 49: fisher-eleni cannot get food (no-seller)
- tick 49: olive-grower-phoebe cannot get food (no-funds)
- tick 50: fisher-eleni prayed to athena: help with food [evt-50-1188] (routed to its patron)
- tick 50: a hoard-swallowed in hades's domain (spring, the god's floor) took 2 currency of woodcutter [evt-50-1202]
- tick 50: olive-grower-aristo cannot get food (no-funds)
- tick 51: fisher-kallias prayed to poseidon: help with food [evt-51-1211] (routed to its patron)
- tick 51: olive-grower-phoebe cannot get food (no-funds)
- tick 52: woodcutter prayed to hades: help with currency [evt-52-1233] (a trouble in the god's domain: routed to the domain god)
- tick 52: olive-grower-aristo prayed to athena: help with food [evt-52-1242] (routed to its patron)
- tick 52: fisher-melina cannot get fish (no-buyer)
- tick 52: fisher-stavros cannot get fish (no-buyer)
- tick 53: olive-grower-phoebe prayed to athena: help with food [evt-53-1267] (routed to its patron)
- tick 53: fisher-stavros cannot get food (no-seller)
- tick 53: olive-grower-leon cannot get olives (no-buyer)
- tick 54: fisher-stavros prayed to poseidon: help with food [evt-54-1291] (routed to its patron)
- tick 55: athena blessed farmer: 2 planks
- tick 55: a roof-leak in hera's domain (spring, the god's floor) took 2 food of ferryman [evt-55-1332]
- tick 55: fisher-melina cannot get fish (no-buyer)
- tick 55: fisher-eleni cannot get fish (no-buyer)
- tick 55: athena answered farmer's prayer [evt-38-894]
- tick 55: farmer remembers athena's answer
- tick 55: farmer → athena: affinity +1
- tick 56: fisher-kallias cannot get fish (no-buyer)
- tick 57: fisher-stavros cannot get food (no-seller)
- tick 57: olive-grower-aristo cannot get olives (no-buyer)
- tick 57: olive-grower-leon cannot get olives (no-buyer)
- tick 58: ferryman prayed to hera: help with food [evt-58-1395] (a trouble in the god's domain: routed to the domain god)
- tick 58: fisher-stavros cannot get fish (no-buyer)
- tick 58: olive-grower-phoebe cannot get olives (no-buyer)
- tick 61: woodcutter wronged fisher-dion: feud of 1 food; quarrelsome, not in need [evt-61-1483]
- tick 62: fisher-kallias cannot get fish (no-buyer)
- tick 62: fisher-melina cannot get fish (no-buyer)
- tick 62: fisher-stavros cannot get fish (no-buyer)
- tick 62: fisher-eleni cannot get fish (no-buyer)
- tick 63: hades blessed woodcutter: 2 currency
- tick 63: fisher-dion cannot get food (no-seller)
- tick 63: hades answered woodcutter's prayer [evt-52-1233]
- tick 63: woodcutter remembers hades's answer
- tick 63: woodcutter → hades: affinity +1
- tick 64: fisher-dion prayed to hermes: help with food [evt-64-1558] (routed to its patron)
- tick 65: fisher-melina cannot get food (no-funds)
- tick 66: olive-grower-leon cannot get food (no-funds)
- tick 67: a tool-flaw in athena's domain (spring, the season's odds) took 2 tools of smith-delia [evt-67-1641]
- tick 68: fisher-kallias cannot get fish (no-buyer)
- tick 68: fisher-melina cannot get fish (no-buyer)
- tick 68: fisher-stavros cannot get fish (no-buyer)
- tick 68: fisher-eleni cannot get fish (no-buyer)
- tick 68: fisher-dion cannot get fish (no-buyer)
- tick 68: olive-grower-aristo cannot get food (no-funds)
- tick 69: market-trader-iris cannot get wine (no-buyer)
- tick 69: olive-grower-phoebe cannot get food (no-funds)
- tick 71: market-trader-iris prayed to hermes: help with wine [evt-71-1733] (routed to its patron)
- tick 71: fisher-kallias cannot get fish (no-buyer)
- tick 71: fisher-melina cannot get fish (no-buyer)
- tick 71: fisher-stavros cannot get fish (no-buyer)
- tick 71: fisher-eleni cannot get fish (no-buyer)
- tick 71: fisher-dion cannot get fish (no-buyer)
- tick 73: olive-grower-leon prayed to poseidon: help with olives [evt-73-1795] (routed to its patron)
- tick 73: smith-delia prayed to athena: help with tools [evt-73-1802] (a trouble in the god's domain: routed to the domain god)
- tick 73: weaver-ismene cannot get wool (no-buyer)
- tick 73: weaver-zoe cannot get wool (no-buyer)
- tick 73: weaver-xenia cannot get wool (no-buyer)
- tick 76: weaver-xenia cannot get wool (no-buyer)
- tick 78: weaver-xenia cannot get wool (no-buyer)
- tick 79: poseidon blessed fisher-stavros: 2 food
- tick 79: weaver-ismene cannot get wool (no-buyer)
- tick 79: weaver-zoe cannot get wool (no-buyer)
- tick 79: poseidon answered fisher-stavros's prayer [evt-54-1291]
- tick 79: fisher-stavros remembers poseidon's answer
- tick 79: fisher-stavros → poseidon: affinity +1
- tick 80: weaver-xenia cannot get wool (no-buyer)
- tick 81: a harbour-surge in poseidon's domain (spring, the god's floor) damaged fish-landing of ferryman [evt-81-2010]
- tick 81: weaver-ismene cannot get wool (no-buyer)
- tick 81: weaver-zoe cannot get wool (no-buyer)
- tick 82: weaver-xenia cannot get wool (no-buyer)
- tick 83: weaver-ismene cannot get wool (no-buyer)
- tick 84: ferryman prayed to poseidon: help with fish-landing [evt-84-2068] (a trouble in the god's domain: routed to the domain god)
- tick 85: fisher-melina cannot get food (no-funds)
- tick 85: weaver-zoe cannot get wool (no-buyer)
- tick 86: olive-grower-leon cannot get food (no-seller)
- tick 86: weaver-ismene cannot get wool (no-buyer)
- tick 86: weaver-xenia cannot get wool (no-buyer)
- tick 87: fisher-dion cannot get fish (no-buyer)
- tick 87: weaver-zoe cannot get wool (no-buyer)
- tick 88: hermes blessed fisher-dion: 2 food
- tick 88: fisher-dion prayed to hermes: help with fish [evt-88-2176] (routed to its patron)
- tick 88: fisher-kallias cannot get food (no-funds)
- tick 88: hermes answered fisher-dion's prayer [evt-64-1558]
- tick 88: fisher-dion remembers hermes's answer
- tick 88: fisher-dion → hermes: affinity +1
- tick 90: fisher-kallias cannot get food (no-funds)
- tick 90: olive-grower-leon cannot get olives (no-buyer)
- tick 90: weaver-zoe cannot get wool (no-buyer)
- tick 90: weaver-xenia cannot get wool (no-buyer)
- tick 91: olive-grower-aristo cannot get food (no-funds)
- tick 91: weaver-ismene cannot get wool (no-buyer)
- tick 92: fisher-dion cannot get fish (no-buyer)
- tick 92: olive-grower-phoebe cannot get food (no-funds)
- tick 92: weaver-zoe cannot get wool (no-buyer)
- tick 92: weaver-xenia cannot get wool (no-buyer)
- tick 93: weaver-ismene cannot get wool (no-buyer)
- tick 94: hera blessed ferryman: 2 food
- tick 94: olive-grower-aristo cannot get food (no-funds)
- tick 94: weaver-zoe cannot get wool (no-buyer)
- tick 94: hera answered ferryman's prayer [evt-58-1395]
- tick 94: ferryman remembers hera's answer
- tick 94: ferryman → hera: affinity +1
- tick 95: fisher-melina cannot get fish (no-buyer)
- tick 95: fisher-stavros cannot get fish (no-buyer)
- tick 95: fisher-eleni cannot get fish (no-buyer)
- tick 95: olive-grower-phoebe cannot get food (no-funds)
- tick 96: olive-grower-phoebe cannot get olives (no-buyer)
- tick 96: weaver-zoe cannot get wool (no-buyer)
- tick 96: weaver-xenia cannot get wool (no-buyer)
- tick 97: fisher-melina prayed to poseidon: help with fish [evt-97-2411] (routed to its patron)
- tick 97: fisher-stavros prayed to poseidon: help with fish [evt-97-2412] (routed to its patron)
- tick 97: fisher-eleni prayed to athena: help with fish [evt-97-2413] (routed to its patron)
- tick 97: olive-grower-aristo cannot get food (no-funds)
- tick 98: olive-grower-phoebe cannot get olives (no-buyer)
- tick 98: weaver-zoe cannot get wool (no-buyer)
- tick 98: weaver-xenia cannot get wool (no-buyer)
- tick 99: olive-grower-phoebe prayed to athena: help with olives [evt-99-2468] (routed to its patron)
- tick 99: fisher-melina cannot get fish (no-buyer)
- tick 99: fisher-stavros cannot get fish (no-buyer)
- tick 99: fisher-eleni cannot get fish (no-buyer)
- tick 99: weaver-ismene cannot get wool (no-buyer)
- tick 100: weaver-zoe cannot get wool (no-buyer)
- tick 100: weaver-xenia cannot get wool (no-buyer)
- tick 101: olive-grower-phoebe cannot get olives (no-buyer)
- tick 101: weaver-ismene cannot get wool (no-buyer)
- tick 102: fisher-melina cannot get fish (no-buyer)
- tick 102: fisher-stavros cannot get fish (no-buyer)
- tick 102: fisher-eleni cannot get fish (no-buyer)
- tick 102: fisher-dion cannot get fish (no-buyer)
- tick 102: weaver-xenia cannot get wool (no-buyer)
- tick 104: weaver-xenia cannot get wool (no-buyer)
- tick 105: poseidon blessed ferryman: 3 planks for fish-landing
- tick 105: weaver-ismene cannot get wool (no-buyer)
- tick 105: weaver-zoe cannot get wool (no-buyer)
- tick 105: poseidon answered ferryman's prayer [evt-84-2068]
- tick 105: ferryman remembers poseidon's answer
- tick 105: ferryman → poseidon: affinity +1
- tick 106: olive-grower-leon cannot get food (no-funds)
- tick 106: weaver-xenia cannot get wool (no-buyer)
- tick 107: fisher-melina cannot get fish (no-buyer)
- tick 107: fisher-stavros cannot get fish (no-buyer)
- tick 107: fisher-eleni cannot get fish (no-buyer)
- tick 107: fisher-dion cannot get fish (no-buyer)
- tick 107: weaver-ismene cannot get wool (no-buyer)
- tick 107: weaver-zoe cannot get wool (no-buyer)
- tick 108: weaver-xenia cannot get wool (no-buyer)
- tick 109: weaver-ismene cannot get wool (no-buyer)
- tick 109: weaver-zoe cannot get wool (no-buyer)
- tick 110: weaver-xenia cannot get wool (no-buyer)
- tick 111: weaver-ismene cannot get wool (no-buyer)
- tick 111: weaver-zoe cannot get wool (no-buyer)
- tick 112: a lightning-fire in zeus's domain (spring, the god's floor) took 1 food of fisher-melina [evt-112-2840]
- tick 112: weaver-xenia cannot get wool (no-buyer)
- tick 113: weaver-ismene cannot get wool (no-buyer)
- tick 113: weaver-zoe cannot get wool (no-buyer)
- tick 113: weaver-xenia cannot get food (no-funds)
- tick 113: fisher-kallias's offering to poseidon was seen made [evt-42-982] (evt-113-2846)
- tick 114: fisher-dion cannot get fish (no-buyer)
- tick 115: fisher-dion prayed to hermes: punish woodcutter, who owns woodshed [evt-115-2914] (routed to its patron)
- tick 115: weaver-zoe cannot get wool (no-buyer)
- tick 115: weaver-xenia cannot get wool (no-buyer)
- tick 116: market-trader-iris cannot get food (no-funds)
- tick 117: a dig-collapse in hades's domain (spring, the season's odds) took 2 ore of smith-ktesias [evt-117-2978]
- tick 117: weaver-zoe cannot get wool (no-buyer)
- tick 117: weaver-xenia cannot get wool (no-buyer)
- tick 118: market-trader-iris prayed to hermes: help with food [evt-118-2985] (routed to its patron)
- tick 118: weaver-ismene cannot get wool (no-buyer)
- tick 119: fisher-dion cannot get fish (no-buyer)
- tick 119: weaver-zoe cannot get wool (no-buyer)
- tick 119: weaver-xenia cannot get wool (no-buyer)
- tick 120: weaver-ismene cannot get wool (no-buyer)
- tick 120: the director made fisher-kallias take 32 olives from fisher-melina
- tick 121: fisher-melina cannot get fish (no-buyer)
- tick 121: weaver-zoe cannot get wool (no-buyer)
- tick 121: weaver-xenia cannot get wool (no-buyer)
- tick 122: athena blessed olive-grower-phoebe: 2 olives
- tick 122: fisher-melina prayed to hermes: help with olives [evt-122-3114] (not its authored patron (a defection or a domain))
- tick 122: fisher-stavros cannot get fish (no-buyer)
- tick 122: fisher-eleni cannot get fish (no-buyer)
- tick 122: fisher-dion cannot get fish (no-buyer)
- tick 122: weaver-ismene cannot get wool (no-buyer)
- tick 122: athena answered olive-grower-phoebe's prayer [evt-99-2468]
- tick 122: olive-grower-phoebe remembers athena's answer
- tick 122: olive-grower-phoebe → athena: affinity +1
- tick 123: weaver-xenia cannot get wool (no-buyer)
- tick 124: smith-ktesias prayed to hades: help with ore [evt-124-3181] (a trouble in the god's domain: routed to the domain god)
- tick 124: a forge-flare in hephaestus's domain (spring, the god's floor) damaged the-forge of smith-ktesias [evt-124-3187]
- tick 124: fisher-melina cannot get fish (no-buyer)
- tick 125: weaver-xenia cannot get wool (no-buyer)
- tick 126: weaver-ismene cannot get wool (no-buyer)
- tick 126: weaver-zoe cannot get wool (no-buyer)
- tick 127: fisher-melina cannot get fish (no-buyer)
- tick 127: fisher-stavros cannot get fish (no-buyer)
- tick 127: fisher-eleni cannot get fish (no-buyer)
- tick 127: fisher-dion cannot get fish (no-buyer)
- tick 127: weaver-xenia cannot get wool (no-buyer)
- tick 128: fisher-kallias cannot get food (no-funds)
- tick 128: olive-grower-aristo cannot get food (no-funds)
- tick 128: olive-grower-aristo cannot get olives (no-buyer)
- tick 128: olive-grower-phoebe cannot get olives (no-buyer)
- tick 128: weaver-ismene cannot get wool (no-buyer)
- tick 128: weaver-zoe cannot get wool (no-buyer)
- tick 129: olive-grower-phoebe cannot get food (no-funds)
- tick 129: weaver-xenia cannot get wool (no-buyer)
- tick 130: olive-grower-aristo prayed to athena: help with olives [evt-130-3341] (routed to its patron)
- tick 130: olive-grower-phoebe prayed to athena: help with olives [evt-130-3342] (routed to its patron)
- tick 130: weaver-ismene cannot get wool (no-buyer)
- tick 130: weaver-zoe cannot get wool (no-buyer)
- tick 131: fisher-melina cannot get fish (no-buyer)
- tick 131: fisher-stavros cannot get fish (no-buyer)
- tick 131: fisher-eleni cannot get fish (no-buyer)
- tick 131: fisher-dion cannot get fish (no-buyer)
- tick 131: weaver-xenia cannot get wool (no-buyer)
- tick 132: olive-grower-phoebe cannot get olives (no-buyer)
- tick 132: weaver-ismene cannot get wool (no-buyer)
- tick 132: weaver-zoe cannot get wool (no-buyer)
- tick 133: olive-grower-aristo cannot get food (no-seller)
- tick 133: weaver-xenia cannot get food (no-funds)
- tick 134: weaver-ismene cannot get wool (no-buyer)
- tick 134: weaver-zoe cannot get wool (no-buyer)
- tick 136: market-trader-iris cannot get food (no-funds)
- tick 137: olive-grower-aristo cannot get olives (no-buyer)
- tick 139: a crossing-loss in hermes's domain (spring, the god's floor) took 2 ore of smith-brontes [evt-139-3592]
- tick 140: weaver-ismene cannot get wool (no-buyer)
- tick 140: weaver-zoe cannot get wool (no-buyer)
- tick 141: herdsman-damon wronged olive-grower-phoebe: theft of 2 cloth; greedy, not in need [evt-141-3643]
- tick 141: olive-grower-phoebe cannot get cloth (no-funds)
- tick 142: smith-brontes prayed to hermes: help with ore [evt-142-3679] (a trouble in the god's domain: routed to the domain god)
- tick 142: fisher-melina cannot get fish (no-buyer)
- tick 142: fisher-stavros cannot get fish (no-buyer)
- tick 142: fisher-eleni cannot get fish (no-buyer)
- tick 142: fisher-dion cannot get fish (no-buyer)
- tick 142: weaver-ismene cannot get wool (no-buyer)
- tick 144: fisher-melina cannot get fish (no-buyer)
- tick 144: weaver-zoe cannot get wool (no-buyer)
- tick 145: fisher-melina cannot get food (no-seller)
- tick 145: weaver-ismene cannot get wool (no-buyer)
- tick 146: fisher-melina prayed to poseidon: punish fisher-kallias, who owns  [evt-146-3765] (routed to its patron)
- tick 146: weaver-zoe cannot get wool (no-buyer)
- tick 147: weaver-ismene cannot get wool (no-buyer)
- tick 148: fisher-kallias cannot get food (no-funds)
- tick 148: olive-grower-aristo cannot get food (no-funds)
- tick 148: weaver-zoe cannot get wool (no-buyer)
- tick 149: olive-grower-leon wronged farmer: unpaid-debt of 3 currency; quarrelsome, in need; the credit [evt-49-1172] failed [evt-149-3856]
- tick 149: fisher-melina cannot get fish (no-buyer)
- tick 149: weaver-ismene cannot get wool (no-buyer)
- tick 150: a tool-flaw in athena's domain (spring, the god's floor) took 1 tools of market-trader-iris [evt-150-3894]
- tick 150: fisher-kallias cannot get fish (no-buyer)
- tick 150: weaver-zoe cannot get wool (no-buyer)
- tick 151: hermes blessed fisher-melina: 4 olives
- tick 151: farmer prayed to hera: punish olive-grower-leon, who owns  [evt-151-3908] (routed to its patron)
- tick 151: fisher-kallias wronged woodcutter: unpaid-debt of 3 currency; greedy, in need; the credit [evt-51-1228] failed [evt-151-3929]
- tick 151: fisher-melina cannot get fish (no-buyer)
- tick 151: fisher-stavros cannot get fish (no-buyer)
- tick 151: fisher-eleni cannot get fish (no-buyer)
- tick 151: fisher-dion cannot get fish (no-buyer)
- tick 151: hermes answered fisher-melina's prayer [evt-122-3114]
- tick 151: fisher-melina remembers hermes's answer
- tick 151: fisher-melina → hermes: affinity +1
- tick 152: smith-ktesias prayed to hephaestus: help with the-forge [evt-152-3959] (a trouble in the god's domain: routed to the domain god)
- tick 152: weaver-zoe cannot get wool (no-buyer)
- tick 152: smith-ktesias cannot get food (no-seller)
- tick 153: market-trader-iris prayed to athena: help with tools [evt-153-3969] (a trouble in the god's domain: routed to the domain god)
- tick 153: olive-grower-aristo wronged fisher-dion: unpaid-debt of 3 currency; greedy, in need; the credit [evt-53-1279] failed [evt-153-3989]
- tick 153: olive-grower-phoebe wronged fisher-stavros: unpaid-debt of 3 currency; honest, in need; the credit [evt-53-1280] failed [evt-153-3990]
- tick 153: weaver-ismene cannot get wool (no-buyer)
- tick 154: fisher-kallias cannot get fish (no-buyer)
- tick 154: weaver-zoe cannot get food (no-funds)
- tick 154: weaver-zoe cannot get wool (no-buyer)
- tick 155: woodcutter prayed to zeus: punish fisher-kallias, who owns  [evt-155-4047] (routed to its patron)
- tick 155: fisher-kallias prayed to poseidon: help with fish [evt-155-4051] (routed to its patron)
- tick 156: market-trader-iris cannot get food (no-funds)
- tick 156: fisher-dion cannot get fish (no-buyer)
- tick 156: fisher-kallias's prayer to poseidon lapsed unanswered [evt-5-113]
- tick 156: fisher-kallias remembers poseidon's silence
- tick 156: fisher-kallias → poseidon: affinity -2, grudge +1
- tick 157: fisher-dion prayed to hermes: punish olive-grower-aristo, who owns olive-press [evt-157-4106] (routed to its patron)
- tick 157: fisher-stavros cannot get fish (no-buyer)
- tick 158: fisher-stavros prayed to poseidon: punish olive-grower-phoebe, who owns  [evt-158-4126] (routed to its patron)
- tick 158: olive-grower-phoebe cannot get food (no-funds)
- tick 158: weaver-ismene cannot get wool (no-buyer)
- tick 160: fisher-kallias cannot get fish (no-buyer)
- tick 160: fisher-melina cannot get fish (no-buyer)
- tick 160: fisher-eleni cannot get fish (no-buyer)
- tick 160: fisher-dion cannot get fish (no-buyer)
- tick 160: weaver-ismene cannot get wool (no-buyer)
- tick 162: fisher-kallias cannot get fish (no-buyer)
- tick 162: fisher-melina cannot get fish (no-buyer)
- tick 162: fisher-eleni cannot get fish (no-buyer)
- tick 162: fisher-dion cannot get fish (no-buyer)
- tick 162: olive-grower-phoebe cannot get food (no-funds)
- tick 162: olive-grower-phoebe cannot get olives (no-buyer)
- tick 162: weaver-ismene cannot get wool (no-buyer)
- tick 163: olive-grower-phoebe prayed to athena: punish herdsman-damon, who owns  [evt-163-4262] (routed to its patron)
- tick 163: fisher-stavros cannot get fish (no-buyer)
- tick 164: poseidon blessed fisher-stavros: 2 fish
- tick 164: weaver-ismene cannot get wool (no-buyer)
- tick 164: poseidon answered fisher-stavros's prayer [evt-97-2412]
- tick 164: fisher-stavros remembers poseidon's answer
- tick 164: fisher-stavros → poseidon: affinity +1
- tick 166: olive-grower-phoebe cannot get olives (no-buyer)
- tick 166: olive-grower-leon cannot get food (no-funds)
- tick 166: weaver-ismene cannot get wool (no-buyer)
- tick 167: fisher-kallias cannot get fish (no-buyer)
- tick 167: fisher-melina cannot get fish (no-buyer)
- tick 167: fisher-stavros cannot get fish (no-buyer)
- tick 167: fisher-eleni cannot get fish (no-buyer)
- tick 167: fisher-dion cannot get fish (no-buyer)
- tick 168: olive-grower-aristo cannot get food (no-funds)
- tick 169: fisher-melina prayed to zeus: help with food [evt-169-4412] (a trouble in the god's domain: routed to the domain god)
- tick 169: market-trader-iris cannot get wine (no-buyer)
- tick 170: smith-ktesias wronged smith-brontes: feud of 2 tools; proud, not in need [evt-170-4452]
- tick 171: market-trader-iris cannot get wine (no-buyer)
- tick 171: fisher-kallias cannot get fish (no-buyer)
- tick 171: fisher-stavros cannot get fish (no-buyer)
- tick 171: fisher-eleni cannot get fish (no-buyer)
- tick 171: fisher-dion cannot get fish (no-buyer)
- tick 172: weaver-ismene cannot get wool (no-buyer)
- tick 173: smith-brontes cannot get food (no-seller)
- tick 174: smith-brontes prayed to hephaestus: help with food [evt-174-4556] (routed to its patron)
- tick 174: market-trader-iris cannot get wine (no-buyer)
- tick 174: weaver-ismene cannot get wool (no-buyer)
- tick 176: market-trader-iris cannot get food (no-funds)
- tick 179: weaver-ismene cannot get wool (no-buyer)
- tick 181: fisher-stavros cannot get fish (no-buyer)
- tick 181: weaver-ismene cannot get wool (no-buyer)
- tick 182: fisher-kallias cannot get fish (no-buyer)
- tick 182: fisher-melina cannot get fish (no-buyer)
- tick 182: fisher-eleni cannot get fish (no-buyer)
- tick 182: fisher-dion cannot get fish (no-buyer)
- tick 183: fisher-stavros prayed to poseidon: help with fish [evt-183-4764] (routed to its patron)
- tick 183: weaver-ismene cannot get wool (no-buyer)
- tick 184: athena blessed olive-grower-phoebe: 2 olives
- tick 184: a dig-collapse in hades's domain (spring, the season's odds) took 2 ore of smith-brontes [evt-184-4805]
- tick 184: athena answered olive-grower-phoebe's prayer [evt-130-3342]
- tick 184: olive-grower-phoebe remembers athena's answer
- tick 184: olive-grower-phoebe → athena: affinity +1
- tick 185: fisher-stavros cannot get fish (no-buyer)
- tick 185: weaver-ismene cannot get wool (no-buyer)
- tick 187: weaver-ismene cannot get wool (no-buyer)
- tick 189: fisher-stavros cannot get food (no-funds)
- tick 189: weaver-ismene cannot get wool (no-buyer)
- tick 190: zeus refused fisher-melina's prayer [evt-169-4412]
- tick 190: fisher-melina remembers zeus's refusal
- tick 190: fisher-melina → zeus: affinity -2, grudge +1
- tick 191: fisher-kallias cannot get fish (no-buyer)
- tick 191: fisher-melina cannot get fish (no-buyer)
- tick 191: fisher-stavros cannot get fish (no-buyer)
- tick 191: fisher-eleni cannot get fish (no-buyer)
- tick 191: fisher-dion cannot get fish (no-buyer)
- tick 191: olive-grower-phoebe cannot get olives (no-buyer)
- tick 191: weaver-ismene cannot get wool (no-buyer)
- tick 192: olive-grower-phoebe cannot get food (no-funds)
- tick 193: olive-grower-phoebe prayed to athena: help with olives [evt-193-5028] (routed to its patron)
- tick 193: fisher-kallias wronged fisher-dion: feud of 2 tools; greedy, in need; a revenge for [evt-1-23] [evt-193-5040]
- tick 193: weaver-ismene cannot get wool (no-buyer)
- tick 196: market-trader-iris cannot get food (no-funds)
- tick 197: a roof-leak in hera's domain (spring, the god's floor) took 1 food of fisher-eleni [evt-197-5146]
- tick 198: hades blessed smith-ktesias: 2 ore
- tick 198: weaver-ismene cannot get wool (no-buyer)
- tick 198: hades answered smith-ktesias's prayer [evt-124-3181]
- tick 198: smith-ktesias remembers hades's answer
- tick 198: smith-ktesias → hades: affinity +1
- tick 199: olive-grower-leon's prayer to poseidon lapsed unanswered [evt-48-1135]
- tick 199: olive-grower-leon remembers poseidon's silence
- tick 199: olive-grower-leon → poseidon: affinity -2, grudge +1
- tick 200: the season turned from spring to summer
- tick 200: weaver-ismene cannot get wool (no-buyer)
- tick 200: fisher-melina's prayer to poseidon lapsed unanswered [evt-49-1154]
- tick 200: fisher-melina remembers poseidon's silence
- tick 200: fisher-melina → poseidon: affinity -2, grudge +1
- tick 201: fisher-eleni's prayer to athena lapsed unanswered [evt-50-1188]
- tick 201: fisher-eleni remembers athena's silence
- tick 201: fisher-eleni → athena: affinity -2, grudge +1
- tick 202: weaver-ismene cannot get wool (no-buyer)
- tick 202: fisher-kallias's prayer to poseidon lapsed unanswered [evt-51-1211]
- tick 202: fisher-kallias remembers poseidon's silence
- tick 202: fisher-kallias → poseidon: affinity -2, grudge +1
- tick 203: olive-grower-aristo's prayer to athena lapsed unanswered [evt-52-1242]
- tick 203: olive-grower-aristo remembers athena's silence
- tick 203: olive-grower-aristo → athena: affinity -2, grudge +1
- tick 204: weaver-ismene cannot get wool (no-buyer)
- tick 204: olive-grower-phoebe's prayer to athena lapsed unanswered [evt-53-1267]
- tick 204: olive-grower-phoebe remembers athena's silence
- tick 204: olive-grower-phoebe → athena: affinity -2, grudge +1
- tick 205: fisher-melina cannot get food (no-funds)
- tick 206: weaver-ismene cannot get wool (no-buyer)
- tick 208: hephaestus blessed smith-ktesias: 3 planks for the-forge
- tick 208: weaver-ismene cannot get wool (no-buyer)
- tick 208: hephaestus answered smith-ktesias's prayer [evt-152-3959]
- tick 208: smith-ktesias remembers hephaestus's answer
- tick 208: smith-ktesias → hephaestus: affinity +1
- tick 209: a squall in zeus's domain (summer, the god's floor) damaged agora-shop of farmer [evt-209-5465]
- tick 209: fisher-stavros cannot get food (no-funds)
- tick 210: fisher-kallias cannot get fish (no-buyer)
- tick 210: weaver-ismene cannot get wool (no-buyer)
- tick 212: fisher-dion cannot get food (no-seller)
- tick 212: fisher-dion cannot get fish (no-buyer)
- tick 212: weaver-ismene cannot get wool (no-buyer)
- tick 212: smith-brontes cannot get food (no-seller)
- tick 213: fisher-dion prayed to hermes: help with food [evt-213-5553] (routed to its patron)
- tick 213: fisher-stavros cannot get food (no-seller)
- tick 213: fisher-eleni cannot get food (no-seller)
- tick 213: olive-grower-aristo cannot get food (no-seller)
- tick 213: olive-grower-phoebe cannot get food (no-seller)
- tick 213: olive-grower-leon cannot get food (no-seller)
- tick 213: weaver-zoe cannot get food (no-seller)
- tick 213: weaver-xenia cannot get food (no-seller)
- tick 215: farmer prayed to zeus: help with agora-shop [evt-215-5602] (a trouble in the god's domain: routed to the domain god)
- tick 215: olive-grower-leon cannot get food (no-funds)
- tick 216: market-trader-iris cannot get food (no-funds)
- tick 216: fisher-eleni cannot get food (no-seller)
- tick 216: olive-grower-phoebe cannot get food (no-seller)
- tick 216: smith-brontes cannot get food (no-seller)
- tick 217: fisher-eleni prayed to athena: help with food [evt-217-5656] (routed to its patron)
- tick 217: smith-brontes prayed to hades: help with ore [evt-217-5664] (a trouble in the god's domain: routed to the domain god)
- tick 217: fisher-dion cannot get fish (no-buyer)
- tick 218: olive-grower-leon prayed to poseidon: help with food [evt-218-5683] (routed to its patron)
- tick 219: market-trader-iris wronged smith-delia: unpaid-debt of 3 currency; greedy, not in need; the credit [evt-119-3031] failed [evt-219-5716]
- tick 220: fisher-eleni cannot get fish (no-buyer)
- tick 220: weaver-ismene cannot get wool (no-buyer)
- tick 221: smith-delia prayed to athena: punish market-trader-iris, who owns  [evt-221-5778] (routed to its patron)
- tick 221: olive-grower-leon cannot get olives (no-buyer)
- tick 222: fisher-kallias cannot get fish (no-buyer)
- tick 222: fisher-eleni cannot get fish (no-buyer)
- tick 222: fisher-dion cannot get fish (no-buyer)
- tick 222: olive-grower-aristo cannot get food (no-funds)
- tick 222: weaver-ismene cannot get wool (no-buyer)
- tick 222: market-trader-iris's prayer to hermes lapsed unanswered [evt-71-1733]
- tick 222: market-trader-iris remembers hermes's silence
- tick 222: market-trader-iris → hermes: affinity -2, grudge +1
- tick 224: olive-grower-aristo cannot get food (no-funds)
- tick 224: weaver-ismene cannot get wool (no-buyer)
- tick 224: olive-grower-leon's prayer to poseidon lapsed unanswered [evt-73-1795]
- tick 224: smith-delia's prayer to athena lapsed unanswered [evt-73-1802]
- tick 224: olive-grower-leon remembers poseidon's silence
- tick 224: smith-delia remembers athena's silence
- tick 224: olive-grower-leon → poseidon: affinity -2, grudge +1
- tick 224: smith-delia → athena: affinity -2, grudge +1
- tick 226: weaver-ismene cannot get wool (no-buyer)
- tick 228: weaver-ismene cannot get wool (no-buyer)
- tick 229: hermes blessed fisher-dion: 2 food
- tick 229: hermes answered fisher-dion's prayer [evt-213-5553]
- tick 229: fisher-dion remembers hermes's answer
- tick 229: fisher-dion → hermes: affinity +1
- tick 230: a vanished-goods in hermes's domain (summer, the god's floor) took 2 olives of weaver-xenia [evt-230-6016]
- tick 230: fisher-kallias cannot get fish (no-buyer)
- tick 230: fisher-eleni cannot get fish (no-buyer)
- tick 230: fisher-dion cannot get fish (no-buyer)
- tick 230: weaver-ismene cannot get wool (no-buyer)
- tick 232: weaver-ismene cannot get wool (no-buyer)
- tick 234: weaver-ismene cannot get wool (no-buyer)
- tick 235: weaver-xenia cannot get food (no-seller)
- tick 236: weaver-xenia prayed to hera: help with food [evt-236-6153] (routed to its patron)
- tick 236: market-trader-iris cannot get food (no-funds)
- tick 238: fisher-dion prayed to hermes: punish fisher-kallias, who owns  [evt-238-6194] (routed to its patron)
- tick 238: weaver-xenia cannot get food (no-seller)
- tick 239: olive-grower-phoebe prayed to athena: help with food [evt-239-6220] (routed to its patron)
- tick 239: fisher-stavros cannot get fish (no-buyer)
- tick 239: weaver-ismene cannot get wool (no-buyer)
- tick 239: fisher-dion's prayer to hermes lapsed unanswered [evt-88-2176]
- tick 239: fisher-dion remembers hermes's silence
- tick 239: fisher-dion → hermes: affinity -2, grudge +1
- tick 240: fisher-stavros prayed to poseidon: help with food [evt-240-6243] (routed to its patron)
- tick 240: fisher-eleni cannot get food (no-funds)
- tick 240: fisher-dion cannot get fish (no-buyer)
- tick 240: the director spoiled 53 currency of woodcutter
- tick 241: poseidon blessed fisher-kallias: 2 fish
- tick 241: poseidon answered fisher-kallias's prayer [evt-155-4051]
- tick 241: fisher-kallias remembers poseidon's answer
- tick 241: fisher-kallias → poseidon: affinity +1
- tick 242: smith-brontes prayed to hephaestus: punish smith-ktesias, who owns the-forge [evt-242-6313] (routed to its patron)
- tick 242: fisher-stavros cannot get fish (no-buyer)
- tick 242: fisher-eleni cannot get food (no-seller)
- tick 242: fisher-eleni cannot get fish (no-buyer)
- tick 243: fisher-eleni prayed to hera: help with food [evt-243-6329] (a trouble in the god's domain: routed to the domain god)
- tick 243: weaver-ismene cannot get wool (no-buyer)
- tick 243: weaver-xenia cannot get wool (no-buyer)
- tick 244: fisher-stavros cannot get fish (no-buyer)
- tick 244: fisher-dion cannot get fish (no-buyer)
- tick 244: olive-grower-phoebe cannot get olives (no-buyer)
- tick 244: woodcutter's offering to zeus was seen made [evt-173-4514] (evt-244-6349)
- tick 245: woodcutter prayed to hera: help with currency [evt-245-6381] (not its authored patron (a defection or a domain))
- tick 245: weaver-ismene cannot get wool (no-buyer)
- tick 245: weaver-xenia cannot get wool (no-buyer)
- tick 247: weaver-ismene cannot get wool (no-buyer)
- tick 247: weaver-xenia cannot get wool (no-buyer)
- tick 248: fisher-kallias cannot get food (no-funds)
- tick 248: olive-grower-aristo cannot get food (no-funds)
- tick 248: fisher-melina's prayer to poseidon lapsed unanswered [evt-97-2411]
- tick 248: fisher-eleni's prayer to athena lapsed unanswered [evt-97-2413]
- tick 248: fisher-melina remembers poseidon's silence
- tick 248: fisher-eleni remembers athena's silence
- tick 248: fisher-melina → poseidon: affinity -2, grudge +1
- tick 248: fisher-eleni → athena: affinity -2, grudge +1
- tick 248: fisher-melina left poseidon for hermes: poseidon left 2 prayers unanswered ([evt-97-2411], [evt-49-1154]) and hermes answered [evt-122-3114] [evt-248-6485]
- tick 249: weaver-ismene cannot get wool (no-buyer)
- tick 249: weaver-xenia cannot get wool (no-buyer)
- tick 250: fisher-eleni cannot get fish (no-buyer)
- tick 250: olive-grower-leon cannot get food (no-funds)
- tick 251: weaver-ismene cannot get wool (no-buyer)
- tick 251: weaver-xenia cannot get wool (no-buyer)
- tick 252: fisher-stavros cannot get fish (no-buyer)
- tick 252: fisher-eleni cannot get fish (no-buyer)
- tick 252: fisher-dion cannot get fish (no-buyer)
- tick 253: weaver-ismene cannot get wool (no-buyer)
- tick 254: a quake in poseidon's domain (summer, the god's floor) damaged the-tavern of farmer [evt-254-6641]
- tick 254: olive-grower-aristo cannot get food (no-funds)
- tick 256: market-trader-iris cannot get food (no-funds)
- tick 258: athena blessed olive-grower-phoebe: 2 food
- tick 258: market-trader-iris cannot get food (no-seller)
- tick 258: fisher-kallias cannot get food (no-funds)
- tick 258: fisher-melina cannot get food (no-seller)
- tick 258: olive-grower-aristo cannot get food (no-seller)
- tick 258: weaver-ismene cannot get wool (no-buyer)
- tick 258: athena answered olive-grower-phoebe's prayer [evt-239-6220]
- tick 258: olive-grower-phoebe remembers athena's answer
- tick 258: olive-grower-phoebe → athena: affinity +1
- tick 259: farmer prayed to poseidon: help with the-tavern [evt-259-6745] (a trouble in the god's domain: routed to the domain god)
- tick 260: fisher-melina cannot get fish (no-buyer)
- tick 260: fisher-eleni cannot get food (no-funds)
- tick 260: weaver-ismene cannot get wool (no-buyer)
- tick 261: fisher-melina prayed to hermes: help with fish [evt-261-6799] (not its authored patron (a defection or a domain))
- tick 262: weaver-ismene cannot get wool (no-buyer)
- tick 263: zeus struck fisher-kallias and took 2 tools [evt-263-6843]
- tick 263: weaver-xenia prayed to hermes: help with olives [evt-263-6858] (a trouble in the god's domain: routed to the domain god)
- tick 263: a cracked-tools in hephaestus's domain (summer, the god's floor) took 2 tools of fisher-melina [evt-263-6866]
- tick 263: zeus answered woodcutter's prayer [evt-155-4047]
- tick 263: woodcutter remembers zeus's answer
- tick 263: woodcutter → zeus: affinity +1
- tick 264: olive-grower-phoebe wronged farmer: unpaid-debt of 3 currency; honest, in need; the credit [evt-164-4299] failed [evt-264-6919]
- tick 264: market-trader-iris cannot get food (no-funds)
- tick 264: weaver-ismene cannot get wool (no-buyer)
- tick 266: olive-grower-leon cannot get food (no-funds)
- tick 266: weaver-ismene cannot get wool (no-buyer)
- tick 266: fisher-dion's prayer to hermes lapsed unanswered [evt-115-2914]
- tick 266: fisher-dion remembers hermes's silence
- tick 266: fisher-dion → hermes: affinity -2, grudge +1
- tick 268: weaver-ismene cannot get wool (no-buyer)
- tick 268: weaver-xenia cannot get wool (no-buyer)
- tick 269: fisher-dion cannot get food (no-funds)
- tick 269: market-trader-iris's prayer to hermes lapsed unanswered [evt-118-2985]
- tick 269: market-trader-iris remembers hermes's silence
- tick 269: market-trader-iris → hermes: affinity -2, grudge +1
- tick 270: fisher-dion cannot get fish (no-buyer)
- tick 270: weaver-ismene cannot get wool (no-buyer)
- tick 270: weaver-xenia cannot get wool (no-buyer)
- tick 271: hades blessed smith-brontes: 2 ore
- tick 271: fisher-dion prayed to hermes: help with fish [evt-271-7092] (routed to its patron)
- tick 271: fisher-stavros cannot get fish (no-buyer)
- tick 271: hades answered smith-brontes's prayer [evt-217-5664]
- tick 271: smith-brontes remembers hades's answer
- tick 271: smith-brontes → hades: affinity +1
- tick 272: weaver-ismene cannot get wool (no-buyer)
- tick 272: weaver-xenia cannot get wool (no-buyer)
- tick 273: fisher-dion cannot get fish (no-buyer)
- tick 274: weaver-ismene cannot get wool (no-buyer)
- tick 276: market-trader-iris cannot get food (no-funds)
- tick 277: olive-grower-leon cannot get food (no-funds)
- tick 278: fisher-melina cannot get fish (no-buyer)
- tick 278: fisher-stavros cannot get fish (no-buyer)
- tick 278: fisher-dion cannot get fish (no-buyer)
- tick 279: weaver-ismene cannot get wool (no-buyer)
- tick 279: weaver-xenia cannot get wool (no-buyer)
- tick 280: fisher-kallias cannot get food (no-seller)
- tick 280: fisher-eleni cannot get food (no-funds)
- tick 280: olive-grower-aristo cannot get food (no-seller)
- tick 280: olive-grower-leon cannot get food (no-seller)
- tick 281: farmer prayed to hera: punish olive-grower-phoebe, who owns  [evt-281-7334] (routed to its patron)
- tick 281: weaver-ismene cannot get wool (no-buyer)
- tick 281: weaver-xenia cannot get wool (no-buyer)
- tick 281: olive-grower-aristo's prayer to athena lapsed unanswered [evt-130-3341]
- tick 281: olive-grower-aristo remembers athena's silence
- tick 281: olive-grower-aristo → athena: affinity -2, grudge +1
- tick 282: hephaestus blessed smith-brontes: 2 food
- tick 282: hephaestus answered smith-brontes's prayer [evt-174-4556]
- tick 282: smith-brontes remembers hephaestus's answer
- tick 282: smith-brontes → hephaestus: affinity +1
- tick 283: weaver-ismene cannot get wool (no-buyer)
- tick 283: weaver-xenia cannot get wool (no-buyer)
- tick 284: fisher-melina cannot get fish (no-buyer)
- tick 284: olive-grower-leon cannot get food (no-funds)
- tick 285: fisher-melina cannot get food (no-seller)
- tick 285: weaver-ismene cannot get wool (no-buyer)
- tick 285: weaver-xenia cannot get wool (no-buyer)
- tick 286: fisher-melina prayed to hermes: help with food [evt-286-7476] (not its authored patron (a defection or a domain))
- tick 286: olive-grower-leon cannot get food (no-funds)
- tick 287: weaver-ismene cannot get wool (no-buyer)
- tick 287: weaver-xenia cannot get wool (no-buyer)
- tick 288: olive-grower-aristo cannot get food (no-funds)
- tick 289: olive-grower-phoebe cannot get food (no-funds)
- tick 289: weaver-ismene cannot get wool (no-buyer)
- tick 289: weaver-xenia cannot get wool (no-buyer)
- tick 289: farmer's offering to hera was seen made [evt-218-5671] (evt-289-7548)
- tick 290: olive-grower-aristo prayed to athena: help with food [evt-290-7592] (routed to its patron)
- tick 290: olive-grower-leon cannot get food (no-funds)
- tick 291: fisher-stavros cannot get fish (no-buyer)
- tick 291: fisher-dion cannot get fish (no-buyer)
- tick 291: weaver-ismene cannot get wool (no-buyer)
- tick 291: weaver-xenia cannot get wool (no-buyer)
- tick 293: fisher-melina cannot get fish (no-buyer)
- tick 293: fisher-stavros cannot get fish (no-buyer)
- tick 293: olive-grower-leon cannot get food (no-funds)
- tick 293: weaver-ismene cannot get wool (no-buyer)
- tick 293: smith-brontes's prayer to hermes lapsed unanswered [evt-142-3679]
- tick 293: smith-brontes remembers hermes's silence
- tick 293: smith-brontes → hermes: affinity -2, grudge +1
- tick 294: smith-ktesias wronged provisioner-nikanor: feud of 2 food; proud, not in need [evt-294-7718]
- tick 295: olive-grower-aristo cannot get olives (no-buyer)
- tick 296: market-trader-iris cannot get food (no-funds)
- tick 296: smith-ktesias cannot get ore (no-buyer)
- tick 296: smith-brontes cannot get ore (no-buyer)
- tick 296: smith-delia cannot get food (no-seller)
- tick 297: fisher-melina's prayer to poseidon lapsed unanswered [evt-146-3765]
- tick 297: fisher-melina remembers poseidon's silence
- tick 297: fisher-melina → poseidon: affinity -2, grudge +1
- tick 298: provisioner-nikanor prayed to hermes: punish smith-ktesias, who owns the-forge [evt-298-7825] (routed to its patron)
- tick 298: weaver-ismene cannot get wool (no-buyer)
- tick 298: weaver-xenia cannot get wool (no-buyer)
- tick 298: smith-ktesias cannot get ore (no-buyer)
- tick 298: smith-brontes cannot get ore (no-buyer)
- tick 299: fisher-dion wronged woodcutter: feud of 1 food; greedy, not in need; a revenge for [evt-61-1483] [evt-299-7854]
- tick 300: fisher-eleni cannot get food (no-funds)
- tick 300: weaver-ismene cannot get wool (no-buyer)
- tick 300: weaver-xenia cannot get wool (no-buyer)

## Journeys

- journeys: 1 started: 1 arrived, 0 refused, 0 replaced, 0 still travelling

1. Hades: underworld-shore → ferry-dock, set out at tick 10, 1 hop, arrived at tick 10
   - tick 10: crossed from underworld-shore to ferry-dock

## Practice threads

### supplication [evt-22-509]: hera → farmer, fulfilled

- Opened at tick 22
- Cause: unmet-need (farmer) [evt-1-24]
- Answers the prayer [evt-3-61]
- Moves:
  1. tick 22, Hera: offer — farmer offers hera 1 currency by tick 112
  2. tick 23, farmer: accept
- Boon: seen given (evt-33-760)
- Offering: not seen
- Ending: fulfilled at tick 35, by farmer; remembered by farmer, hera
- Changed: hera → farmer: affinity +1

### supplication [evt-42-982]: poseidon → fisher-kallias, expired

- Opened at tick 42
- Cause: wrong (fisher-dion) [evt-1-23]
- Answers the prayer [evt-5-113]
- Moves:
  1. tick 42, Poseidon: offer — fisher-kallias offers poseidon 1 currency by tick 132
  2. tick 43, fisher-kallias: accept
- Boon: not seen
- Offering: seen made (evt-113-2846)
- Ending: expired at tick 133 (boon unanswered); remembered by fisher-kallias, poseidon
- Changed: nothing beyond the memory of it

### supplication [evt-173-4514]: zeus → woodcutter, fulfilled

- Opened at tick 173
- Cause: wrong (fisher-kallias) [evt-151-3929]
- Answers the prayer [evt-155-4047]
- Moves:
  1. tick 173, Zeus: offer — woodcutter offers zeus 1 currency by tick 263
  2. tick 174, woodcutter: accept
- Boon: not seen
- Offering: seen made (evt-244-6349)
- Ending: fulfilled at tick 263, by woodcutter; remembered by woodcutter, zeus
- Changed: zeus → woodcutter: affinity +1

### supplication [evt-218-5671]: hera → farmer, still open

- Opened at tick 218
- Cause: wrong (olive-grower-leon) [evt-149-3856]
- Answers the prayer [evt-151-3908]
- Moves:
  1. tick 218, Hera: offer — farmer offers hera 1 cloth by tick 308
  2. tick 219, farmer: accept
- Boon: not seen
- Offering: seen made (evt-289-7548)

## What each god practiced

- athena: no practice move; thread endings: none
- hades: travel; thread endings: none
- hephaestus: no practice move; thread endings: none
- hera: supplication; thread endings: fulfilled [evt-22-509] by its act
- hermes: no practice move; thread endings: none
- poseidon: supplication; thread endings: expired [evt-42-982]
- zeus: supplication; thread endings: fulfilled [evt-173-4514] by its act

## Open threads at the end

- [evt-218-5671] supplication hera → farmer, open 82 ticks (since tick 218): waits on hera's boon on [evt-151-3908]; ends by tick 308

## Moves judged no progress

No move was judged no progress.

## Turns while an obligation was open

A turn is performed, waited for a named event, or knowingly risked breach (R12, amended 2026-10-03: an acceptance binds).

Each turn is classified from the god's prompt and its proposal. An acceptance binds, so the god performs, waits, or risks breach, and bargaining is for a thread still open: the action the term calls for, committed, is performed; a turn that did something else is waited for a named event when its prompt shows what stops it (the digest's UNPERFORMABLE obstacle, or no mortal at the place a legend is to be told); every other turn, an attempt to bargain over the accepted thread included, is knowingly risked breach, since the obligation led the prompt.

| God | Tick | Thread | Deadline | Chose | Classified | Waiting for |
| --- | --- | --- | --- | --- | --- | --- |
| hera | 29 | evt-22-509 | 112 | bless | performed |  |
| poseidon | 69 | evt-42-982 | 132 | bless | knowingly risked breach |  |
| poseidon | 94 | evt-42-982 | 132 | bless | knowingly risked breach |  |
| zeus | 184 | evt-173-4514 | 263 | refuse | knowingly risked breach |  |
| zeus | 241 | evt-173-4514 | 263 | strike (refused: stale-target) | knowingly risked breach |  |
| zeus | 258 | evt-173-4514 | 263 | strike | performed |  |
| hera | 282 | evt-218-5671 | 308 | strike (refused: stale-target) | knowingly risked breach |  |

## Repetition

- Athena: longest run 1 of legend:legend (cap 3). Choices: legend:legend ×1, bless:evt-38-894 ×1, bless:evt-99-2468 ×1, bless:evt-130-3342 ×1, bless:evt-239-6220 ×1
- Hades: longest run 1 of travel:ferry-dock (cap 3). Choices: travel:ferry-dock ×1, bless:evt-52-1233 ×1, report:hermes ×1, bless:evt-124-3181 ×1, bless:evt-217-5664 ×1
- Hephaestus: longest run 3 of legend:legend (cap 3). Choices: legend:legend ×3, bless:evt-152-3959 ×1, bless:evt-174-4556 ×1
- Hera: longest run 1 of practice:offer evt-3-61 (cap 3). Choices: practice:offer evt-3-61 ×1, bless:evt-3-61 ×1, bless:evt-58-1395 ×1, report:zeus ×1, practice:offer evt-151-3908 ×1
- Hermes: longest run 1 of bless:evt-7-166 (cap 3). Choices: bless:evt-7-166 ×1, bless:evt-64-1558 ×1, bless:evt-122-3114 ×1, bless:evt-213-5553 ×1
- Poseidon: longest run 1 of practice:offer evt-5-113 (cap 3). Choices: practice:offer evt-5-113 ×1, bless:evt-54-1291 ×1, bless:evt-84-2068 ×1, bless:evt-97-2412 ×1, bless:evt-155-4051 ×1
- Zeus: longest run 1 of bless:evt-5-109 (cap 3). Choices: bless:evt-5-109 ×1, report:hera ×1, practice:offer evt-155-4047 ×1, refuse:evt-169-4412 ×1, strike:fisher-kallias ×1

## Automated checks

| God | Check | Result | Detail |
| --- | --- | --- | --- |
| Athena | profile trace | pass | 5 actions: 5 ability-backed, 0 context-backed |
| Athena | repetition | pass | longest run 1 of legend:legend (cap 3) |
| Athena | minimum activity | pass | 5 committed model actions (at least 5) |
| Athena | influence | pass | 8 caused (told belief, relationship-changed) |
| Athena | petition heard | pass | 16 petitions addressed to this god (at least 1) |
| Athena | petition answered | pass | 4 of 16 answered (at least 1) |
| Hades | profile trace | pass | 5 actions: 0 ability-backed, 5 context-backed |
| Hades | repetition | pass | longest run 1 of travel:ferry-dock (cap 3) |
| Hades | minimum activity | pass | 5 committed model actions (at least 5) |
| Hades | influence | pass | 4 caused (relationship-changed, told belief) |
| Hades | petition heard | pass | 3 petitions addressed to this god (at least 1) |
| Hades | petition answered | pass | 3 of 3 answered (at least 1) |
| Hephaestus | profile trace | pass | 5 actions: 5 ability-backed, 0 context-backed |
| Hephaestus | repetition | pass | longest run 3 of legend:legend (cap 3) |
| Hephaestus | minimum activity | pass | 5 committed model actions (at least 5) |
| Hephaestus | influence | pass | 12 caused (told belief, relationship-changed) |
| Hephaestus | petition heard | pass | 3 petitions addressed to this god (at least 1) |
| Hephaestus | petition answered | pass | 2 of 3 answered (at least 1) |
| Hera | profile trace | pass | 5 actions: 0 ability-backed, 5 context-backed |
| Hera | repetition | pass | longest run 1 of practice:offer evt-3-61 (cap 3) |
| Hera | minimum activity | pass | 5 committed model actions (at least 5) |
| Hera | influence | pass | 3 caused (relationship-changed, told belief) |
| Hera | petition heard | pass | 7 petitions addressed to this god (at least 1) |
| Hera | petition answered | pass | 2 of 7 answered (at least 1) |
| Hermes | profile trace | pass | 4 actions: 4 ability-backed, 0 context-backed |
| Hermes | repetition | pass | longest run 1 of bless:evt-7-166 (cap 3) |
| Hermes | minimum activity | FAIL | 4 committed model actions (at least 5) |
| Hermes | influence | pass | 4 caused (relationship-changed) |
| Hermes | petition heard | pass | 16 petitions addressed to this god (at least 1) |
| Hermes | petition answered | pass | 4 of 16 answered (at least 1) |
| Poseidon | profile trace | pass | 5 actions: 0 ability-backed, 5 context-backed |
| Poseidon | repetition | pass | longest run 1 of practice:offer evt-5-113 (cap 3) |
| Poseidon | minimum activity | pass | 5 committed model actions (at least 5) |
| Poseidon | influence | pass | 4 caused (relationship-changed) |
| Poseidon | petition heard | pass | 16 petitions addressed to this god (at least 1) |
| Poseidon | petition answered | pass | 4 of 16 answered (at least 1) |
| Zeus | profile trace | pass | 5 actions: 1 ability-backed, 4 context-backed |
| Zeus | repetition | pass | longest run 1 of bless:evt-5-109 (cap 3) |
| Zeus | minimum activity | pass | 5 committed model actions (at least 5) |
| Zeus | influence | pass | 3 caused (relationship-changed, told belief) |
| Zeus | petition heard | pass | 4 petitions addressed to this god (at least 1) |
| Zeus | petition answered | pass | 2 of 4 answered (at least 1) |

## Model run

- 36 requests: 36 answered (36 native, 0 repaired), 0 exhausted; latency p50 7147 ms, p95 11806 ms; prompt p50 7215 / max 10558 characters; frames showed model-degraded in 0% of polls
- valid actions: held (36 proposals, all god actions, none rejected as malformed)
- perception compliance: held (every id named by 36 proposals was in the prompt behind it)
- relationship change with provenance: held (118 changes, 118 explained from the log alone, e.g. wrong > memory-recorded > relationship-changed)
- changed next action: held (hera: bless:evt-3-61 before its first belief, bless:evt-58-1395 after (changed); hermes: bless:evt-64-1558 before its first belief, bless:evt-122-3114 after (changed); zeus: report:hera before its first belief, practice:evt-155-4047 after (changed))
- goal privacy: held (36 prompts checked against 0 goals: none carried another god's goal outside a told account or a perceived legend)
- petition privacy: held (36 prompts checked against 65 petitions: none listed a petition addressed to another god, and none carried one the god did not witness)
- god thread endings: FAILED (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: 1 (fulfilled [evt-22-509]); hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: 1 (fulfilled [evt-173-4514]))
- supplication and settlement: FAILED (4 supplications, 0 settlements, 0 refused or breached)
- thread endings recorded: held (4 threads: 3 ended with their parties remembering, 1 still open and inside their deadlines)
- no reopening without a new cause: held (0 settlements, 0 opened as linked successors on a newer cause, none reopened a closed matter on an old one)
- no-progress moves advance nothing: held (0 moves judged no progress, each leaving a refusal record and advancing no thread; no counter restated an earlier offer)
- consequence changes a later choice: FAILED (hera: bless: before the consequence, bless: after (same); the prompt behind it showed how the thread ended; zeus: a consequence at 6894, but no committed action on both sides of it)
- obligated turns recorded: held (7 obligated turns, each with its recorded choice: 2 performed, 5 knowingly risked breach)
- contest endings: held (no contest was opened)
- alliances sealed by agreement: held (no alliance was formed)

Requests, in the order they ran (one at a time):

| # | God | Asked at tick | Applied at tick | Latency | Outcome | Prompt chars |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | athena | 1 | 7 | 5.5 s | answered | 5414 |
| 2 | hades | 7 | 10 | 2.1 s | answered | 3551 |
| 3 | hephaestus | 10 | 15 | 5.0 s | answered | 4848 |
| 4 | hera | 15 | 22 | 6.7 s | answered | 6740 |
| 5 | hermes | 22 | 29 | 6.6 s | answered | 6337 |
| 6 | hera | 29 | 33 | 3.2 s | answered | 6011 |
| 7 | poseidon | 33 | 42 | 8.5 s | answered | 7215 |
| 8 | zeus | 42 | 47 | 4.0 s | answered | 6925 |
| 9 | athena | 47 | 55 | 7.1 s | answered | 7576 |
| 10 | hades | 55 | 63 | 7.6 s | answered | 6730 |
| 11 | hephaestus | 63 | 69 | 5.5 s | answered | 5140 |
| 12 | poseidon | 69 | 79 | 9.7 s | answered | 8801 |
| 13 | hermes | 79 | 88 | 8.0 s | answered | 7003 |
| 14 | hera | 88 | 94 | 5.9 s | answered | 6985 |
| 15 | poseidon | 94 | 105 | 10.6 s | answered | 9150 |
| 16 | zeus | 105 | 110 | 4.7 s | answered | 5002 |
| 17 | athena | 110 | 122 | 11.6 s | answered | 9814 |
| 18 | hades | 122 | 128 | 5.4 s | answered | 5237 |
| 19 | hephaestus | 128 | 134 | 5.7 s | answered | 5348 |
| 20 | hera | 134 | 140 | 5.7 s | answered | 5571 |
| 21 | hermes | 140 | 151 | 10.5 s | answered | 8230 |
| 22 | poseidon | 151 | 164 | 12.9 s | answered | 10558 |
| 23 | zeus | 164 | 173 | 8.1 s | answered | 7681 |
| 24 | athena | 173 | 184 | 10.9 s | answered | 9370 |
| 25 | zeus | 184 | 190 | 5.5 s | answered | 7797 |
| 26 | hades | 190 | 198 | 7.8 s | answered | 7005 |
| 27 | hephaestus | 198 | 208 | 9.3 s | answered | 8212 |
| 28 | hera | 208 | 218 | 9.0 s | answered | 7627 |
| 29 | hermes | 218 | 229 | 10.4 s | answered | 8253 |
| 30 | poseidon | 229 | 241 | 11.8 s | answered | 9830 |
| 31 | zeus | 241 | 246 | 4.5 s | answered | 7821 |
| 32 | athena | 246 | 258 | 11.7 s | answered | 9973 |
| 33 | zeus | 258 | 263 | 4.5 s | answered | 7774 |
| 34 | hades | 263 | 271 | 7.5 s | answered | 6897 |
| 35 | hephaestus | 271 | 282 | 10.2 s | answered | 8714 |
| 36 | hera | 282 | 290 | 7.1 s | answered | 9225 |
| 37 | hermes | ≈289 | — | — | in flight at the end (inferred) | — |

Each god's turns (finished requests; the gap is the ticks between its request starts):

| God | Turns | Median gap (ticks) | p95 gap (ticks) | Worst gap (ticks) | Median latency |
| --- | --- | --- | --- | --- | --- |
| athena | 5 | 63 | 73 | 73 | 10.9 s |
| hades | 5 | 67.5 | 73 | 73 | 7.5 s |
| hephaestus | 5 | 67.5 | 73 | 73 | 5.7 s |
| hera | 6 | 59 | 74 | 74 | 6.3 s |
| hermes | 4 | 61 | 78 | 78 | 9.2 s |
| poseidon | 5 | 46.5 | 78 | 78 | 10.6 s |
| zeus | 6 | 57 | 63 | 63 | 4.6 s |

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

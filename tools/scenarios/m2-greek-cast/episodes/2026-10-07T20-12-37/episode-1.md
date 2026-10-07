# Episode 1 of 3

## Settings

- Recorded: 2026-10-07T20:17:44.643Z
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

1. **tick 14, Athena:** legend (ability-backed)
   - says: "To those gathered, I offer counsel. The gods have shown me favor in the successful planting of the olive tree, a symbol of wisdom and peace. Let this be a reminder to work together, as Poseidon and I did, to cultivate prosperity and harmony. Our strength lies in unity, not strife"
   - heard by: herdsman-damon, weaver-ismene, weaver-xenia, weaver-zoe
   - caused: legend-recorded (athena)
   - then: herdsman-damon now believes athena: "To those gathered, I offer counsel. The gods have shown me favor in the successful planting of the olive tree, a symbol of wisdom and peace. Let this be a reminder to work together, as Poseidon and I did, to cultivate prosperity and harmony. Our strength lies in unity, not strife"
   - then: weaver-ismene now believes athena: "To those gathered, I offer counsel. The gods have shown me favor in the successful planting of the olive tree, a symbol of wisdom and peace. Let this be a reminder to work together, as Poseidon and I did, to cultivate prosperity and harmony. Our strength lies in unity, not strife"
   - then: weaver-xenia now believes athena: "To those gathered, I offer counsel. The gods have shown me favor in the successful planting of the olive tree, a symbol of wisdom and peace. Let this be a reminder to work together, as Poseidon and I did, to cultivate prosperity and harmony. Our strength lies in unity, not strife"
   - then: weaver-zoe now believes athena: "To those gathered, I offer counsel. The gods have shown me favor in the successful planting of the olive tree, a symbol of wisdom and peace. Let this be a reminder to work together, as Poseidon and I did, to cultivate prosperity and harmony. Our strength lies in unity, not strife"
2. **tick 21, Hades:** legend (ability-backed)
   - says: "I, Hades, declare that the cycle of life and death will continue uninterrupted according to the ancient laws, and no mortal's plea will alter Persephone's portioned time in the underworld or mine own decree."
   - heard by: no one
   - caused: legend-recorded (hades)
3. **tick 30, Hephaestus:** report → provisioner-nikanor (context-backed)
   - says: "I have noticed your dedication in gathering resources. I will bestow upon you a blessing for your hard work, granting you improved resource gathering for the next harvest."
   - caused: report-told (hephaestus → provisioner-nikanor)
   - then: provisioner-nikanor now believes hephaestus: "I have noticed your dedication in gathering resources. I will bestow upon you a blessing for your hard work, granting you improved resource gathering for the next harvest."
4. **tick 41, Hera:** practice → offer evt-3-61 (context-backed)
   - caused: practice-opened (hera)
5. **tick 50, Hermes:** bless → evt-7-165 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: market-trader-iris → hermes: affinity +1
6. **tick 54, Hera:** bless → evt-3-61 (context-backed)
   - caused: resource-consumed (hera); blessing-granted (hera)
   - then: farmer → hera: affinity +1
7. **tick 66, Poseidon:** bless → evt-48-1097 (context-backed)
   - caused: resource-consumed (poseidon); blessing-granted (poseidon)
   - then: olive-grower-leon → poseidon: affinity +1
8. **tick 76, Zeus:** bless → evt-5-109 (context-backed)
   - caused: resource-consumed (zeus); blessing-granted (zeus)
   - then: woodcutter → zeus: affinity +1
9. **tick 89, Athena:** bless → evt-55-1282 (ability-backed)
   - caused: resource-consumed (athena); blessing-granted (athena)
   - then: fisher-eleni → athena: affinity +1
10. **tick 97, Hades:** bless → evt-52-1194 (context-backed)
   - caused: resource-consumed (hades); blessing-granted (hades)
   - then: woodcutter → hades: affinity +1
11. **tick 103, Hephaestus:** legend (ability-backed)
   - says: "I, Hephaestus, the lame god of fire and craft, recall teaching crafts to men emerging from cave life."
   - heard by: provisioner-nikanor, smith-brontes, smith-delia, smith-ktesias
   - caused: legend-recorded (hephaestus)
   - then: provisioner-nikanor now believes hephaestus: "I, Hephaestus, the lame god of fire and craft, recall teaching crafts to men emerging from cave life."
   - then: smith-brontes now believes hephaestus: "I, Hephaestus, the lame god of fire and craft, recall teaching crafts to men emerging from cave life."
   - then: smith-delia now believes hephaestus: "I, Hephaestus, the lame god of fire and craft, recall teaching crafts to men emerging from cave life."
   - then: smith-ktesias now believes hephaestus: "I, Hephaestus, the lame god of fire and craft, recall teaching crafts to men emerging from cave life."
12. **tick 110, Hera:** bless → evt-58-1366 (context-backed)
   - caused: resource-consumed (hera); blessing-granted (hera)
   - then: ferryman → hera: affinity +1
13. **tick 118, Hermes:** bless → evt-55-1283 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: fisher-dion → hermes: affinity +1
14. **tick 131, Poseidon:** bless → evt-101-2465 (context-backed)
   - caused: resource-consumed (poseidon); blessing-granted (poseidon)
   - then: fisher-stavros → poseidon: affinity +1
15. **tick 136, Zeus:** report → hera (context-backed)
   - says: "You know my power over guests and suppliants, and your recent trickery makes clear you seek to undermine me. I will not let this stand, for it threatens my sovereignty and role as protector."
   - caused: report-told (zeus → hera)
   - then: hera now believes zeus: "You know my power over guests and suppliants, and your recent trickery makes clear you seek to undermine me. I will not let this stand, for it threatens my sovereignty and role as protector."
16. **tick 149, Athena:** bless → evt-100-2444 (ability-backed)
   - caused: resource-consumed (athena); blessing-granted (athena)
   - then: olive-grower-aristo → athena: affinity +1
17. **tick 154, Hades:** legend (ability-backed)
   - says: "I, Hades, solemnly declare that Persephone's time shall remain unaltered, honoring the ancient pact. Any mortal plea that defies the natural order is in vain."
   - heard by: no one
   - caused: legend-recorded (hades)
18. **tick 162, Hephaestus:** bless → evt-146-3648 (ability-backed)
   - caused: resource-consumed (hephaestus); blessing-granted (hephaestus)
   - then: smith-ktesias → hephaestus: affinity +1
19. **tick 170, Hera:** practice → offer evt-151-3791 (context-backed)
   - caused: practice-opened (hera)
20. **tick 178, Hermes:** bless → evt-153-3852 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: fisher-dion → hermes: affinity +1
21. **tick 183, Hera:** strike → olive-grower-leon (ability-backed)
   - caused: resource-consumed (hera); mortal-struck (olive-grower-leon)
   - then: farmer → hera: affinity +1
   - then: athena, herdsman-damon, olive-grower-leon, olive-grower-phoebe, weaver-ismene remember mortal-struck
   - then: athena → hera: affinity -2
   - then: herdsman-damon → hera: affinity -2
   - then: olive-grower-leon → hera: affinity -2, grudge +1
   - then: olive-grower-phoebe → hera: affinity -2
   - then: weaver-ismene → hera: affinity -2
22. **tick 194, Poseidon:** bless → evt-173-4373 (context-backed)
   - caused: resource-consumed (poseidon); blessing-granted (poseidon)
   - then: fisher-stavros → poseidon: affinity +1
23. **tick 202, Zeus:** bless → evt-182-4589 (context-backed)
   - caused: resource-consumed (zeus); blessing-granted (zeus)
   - then: fisher-kallias → zeus: affinity +1
24. **tick 215, Athena:** bless → evt-178-4497 (ability-backed)
   - caused: resource-consumed (athena); blessing-granted (athena)
   - then: fisher-eleni → athena: affinity +1
25. **tick 224, Hades:** practice → offer evt-172-4360 (context-backed)
   - caused: practice-opened (hades)
26. **tick 236, Hephaestus:** bless → evt-172-4358 (ability-backed)
   - caused: resource-consumed (hephaestus); blessing-granted (hephaestus)
   - then: smith-ktesias → hephaestus: affinity +1
27. **tick 241, Hades:** bless → evt-172-4360 (context-backed)
   - caused: resource-consumed (hades); blessing-granted (hades)
   - then: smith-delia → hades: affinity +1
28. **tick 252, Hermes:** bless → evt-181-4572 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: fisher-dion → hermes: affinity +1
29. **tick 259, Hera:** bless → evt-244-6235 (context-backed)
   - caused: resource-consumed (hera); blessing-granted (hera)
   - then: smith-brontes → hera: affinity +1
30. **tick 272, Poseidon:** bless → evt-252-6418 (context-backed)
   - caused: resource-consumed (poseidon); blessing-granted (poseidon)
   - then: fisher-stavros → poseidon: affinity +1
31. **tick 281, Zeus:** bless → evt-211-5366 (context-backed)
   - caused: resource-consumed (zeus); blessing-granted (zeus)
   - then: fisher-kallias → zeus: affinity +1
32. **tick 295, Athena:** bless → evt-266-6819 (ability-backed)
   - caused: resource-consumed (athena); blessing-granted (athena)
   - then: olive-grower-phoebe → athena: affinity +1

## What the world did with every proposal

- dispositions: bless 22 × committed, legend 4 × committed, practice 3 × committed, report 2 × committed, strike 1 × committed

1. Athena: legend → legend — committed: legend-recorded
2. Hades: legend → legend — committed: legend-recorded
3. Hephaestus: report → provisioner-nikanor — committed: report-told
4. Hera: practice → offer evt-3-61 — committed: practice-opened
5. Hermes: bless → evt-7-165 — committed: resource-consumed, blessing-granted
6. Hera: bless → evt-3-61 — committed: resource-consumed, blessing-granted
7. Poseidon: bless → evt-48-1097 — committed: resource-consumed, blessing-granted
8. Zeus: bless → evt-5-109 — committed: resource-consumed, blessing-granted
9. Athena: bless → evt-55-1282 — committed: resource-consumed, blessing-granted
10. Hades: bless → evt-52-1194 — committed: resource-consumed, blessing-granted
11. Hephaestus: legend → legend — committed: legend-recorded
12. Hera: bless → evt-58-1366 — committed: resource-consumed, blessing-granted
13. Hermes: bless → evt-55-1283 — committed: resource-consumed, blessing-granted
14. Poseidon: bless → evt-101-2465 — committed: resource-consumed, blessing-granted
15. Zeus: report → hera — committed: report-told
16. Athena: bless → evt-100-2444 — committed: resource-consumed, blessing-granted
17. Hades: legend → legend — committed: legend-recorded
18. Hephaestus: bless → evt-146-3648 — committed: resource-consumed, blessing-granted
19. Hera: practice → offer evt-151-3791 — committed: practice-opened
20. Hermes: bless → evt-153-3852 — committed: resource-consumed, blessing-granted
21. Hera: strike → olive-grower-leon — committed: resource-consumed, mortal-struck
22. Poseidon: bless → evt-173-4373 — committed: resource-consumed, blessing-granted
23. Zeus: bless → evt-182-4589 — committed: resource-consumed, blessing-granted
24. Athena: bless → evt-178-4497 — committed: resource-consumed, blessing-granted
25. Hades: practice → offer evt-172-4360 — committed: practice-opened
26. Hephaestus: bless → evt-172-4358 — committed: resource-consumed, blessing-granted
27. Hades: bless → evt-172-4360 — committed: resource-consumed, blessing-granted
28. Hermes: bless → evt-181-4572 — committed: resource-consumed, blessing-granted
29. Hera: bless → evt-244-6235 — committed: resource-consumed, blessing-granted
30. Poseidon: bless → evt-252-6418 — committed: resource-consumed, blessing-granted
31. Zeus: bless → evt-211-5366 — committed: resource-consumed, blessing-granted
32. Athena: bless → evt-266-6819 — committed: resource-consumed, blessing-granted

## The episode's numbers

- Food: 86 "cannot get food" lines; 22 of 72 prayers are about food
- Troubles in a god's domain: Athena 3, Hades 3, Hephaestus 2, Hera 2, Hermes 2, Poseidon 2, Zeus 3
- Wrongs between mortals: 14; 12 between different patrons
  - [evt-1-23] fisher-dion (hermes) wronged fisher-kallias (poseidon): cheating; the victim prayed [evt-5-113]; revenge, defection
  - [evt-61-1453] woodcutter (zeus) wronged fisher-melina (poseidon): feud; the victim prayed [evt-126-3138]; no consequence yet
  - [evt-141-3527] herdsman-damon (hermes) wronged olive-grower-phoebe (athena): theft; the victim prayed [evt-163-4113]; no consequence yet
  - [evt-149-3730] olive-grower-leon (poseidon) wronged farmer (hera): unpaid-debt; the victim prayed [evt-151-3791]; punished
  - [evt-151-3809] olive-grower-aristo (athena) wronged woodcutter (zeus): unpaid-debt; the victim prayed [evt-155-3901]; no consequence yet
  - [evt-164-4148] fisher-kallias (poseidon) wronged fisher-eleni (athena): theft; the victim prayed [evt-204-5195]; no consequence yet
  - [evt-251-6404] fisher-stavros (poseidon) wronged fisher-eleni (athena): unpaid-debt; the victim prayed [evt-254-6496]; no consequence yet
  - [evt-252-6434] olive-grower-leon (poseidon) wronged olive-grower-aristo (athena): unpaid-debt; the victim prayed [evt-262-6712]; no consequence yet
  - [evt-252-6435] fisher-kallias (zeus) wronged fisher-dion (hermes): cheating; the victim did not pray about it; no consequence yet
  - [evt-257-6596] market-trader-iris (hermes) wronged farmer (hera): unpaid-debt; the victim prayed [evt-259-6632]; no consequence yet
  - [evt-272-7004] fisher-kallias (zeus) wronged fisher-dion (hermes): feud; the victim prayed [evt-278-7154]; no consequence yet
  - [evt-298-7646] provisioner-nikanor (hermes) wronged smith-brontes (hephaestus): theft; the victim did not pray about it; no consequence yet
- Defections: 2
- From a prayer's cause to its closing: 37 closed (median 72 ticks, p95 159 ticks); by outcome answered 23, lapsed 14

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
- tick 7: market-trader-iris prayed to hermes: help with wine [evt-7-165] (routed to its patron)
- tick 9: fisher-kallias cannot get fish (no-buyer)
- tick 36: a tool-flaw in athena's domain (spring, the god's floor) took 2 planks of farmer [evt-36-835]
- tick 37: woodcutter cannot get food (no-seller)
- tick 38: farmer prayed to athena: help with planks [evt-38-862] (a trouble in the god's domain: routed to the domain god)
- tick 45: fisher-melina cannot get food (no-funds)
- tick 46: olive-grower-leon cannot get food (no-funds)
- tick 48: olive-grower-leon prayed to poseidon: help with food [evt-48-1097] (routed to its patron)
- tick 48: fisher-kallias cannot get food (no-funds)
- tick 48: olive-grower-aristo cannot get food (no-funds)
- tick 49: olive-grower-phoebe cannot get food (no-funds)
- tick 50: hermes blessed market-trader-iris: 2 wine
- tick 50: a hoard-swallowed in hades's domain (spring, the god's floor) took 2 currency of woodcutter [evt-50-1160]
- tick 50: olive-grower-aristo cannot get food (no-funds)
- tick 50: hermes answered market-trader-iris's prayer [evt-7-165]
- tick 50: market-trader-iris remembers hermes's answer
- tick 50: market-trader-iris → hermes: affinity +1
- tick 51: woodcutter cannot get food (no-seller)
- tick 51: olive-grower-phoebe cannot get food (no-funds)
- tick 52: woodcutter prayed to hades: help with currency [evt-52-1194] (a trouble in the god's domain: routed to the domain god)
- tick 52: olive-grower-aristo cannot get olives (no-buyer)
- tick 53: olive-grower-aristo prayed to athena: help with olives [evt-53-1226] (routed to its patron)
- tick 53: olive-grower-phoebe prayed to athena: help with food [evt-53-1227] (routed to its patron)
- tick 53: fisher-kallias cannot get fish (no-buyer)
- tick 53: fisher-eleni cannot get fish (no-buyer)
- tick 53: fisher-dion cannot get fish (no-buyer)
- tick 53: olive-grower-leon cannot get olives (no-buyer)
- tick 54: hera blessed farmer: 2 planks
- tick 54: hera's boon to farmer was seen given [evt-41-928] (evt-54-1245)
- tick 54: hera answered farmer's prayer [evt-3-61]
- tick 54: farmer remembers hera's answer
- tick 54: farmer → hera: affinity +1
- tick 55: fisher-kallias prayed to poseidon: help with fish [evt-55-1280] (routed to its patron)
- tick 55: fisher-eleni prayed to athena: help with fish [evt-55-1282] (routed to its patron)
- tick 55: fisher-dion prayed to hermes: help with fish [evt-55-1283] (routed to its patron)
- tick 55: a roof-leak in hera's domain (spring, the god's floor) took 2 food of ferryman [evt-55-1297]
- tick 57: fisher-kallias cannot get fish (no-buyer)
- tick 57: fisher-eleni cannot get fish (no-buyer)
- tick 57: fisher-dion cannot get fish (no-buyer)
- tick 57: olive-grower-leon cannot get olives (no-buyer)
- tick 58: ferryman prayed to hera: help with food [evt-58-1366] (a trouble in the god's domain: routed to the domain god)
- tick 58: olive-grower-phoebe cannot get olives (no-buyer)
- tick 59: olive-grower-aristo cannot get olives (no-buyer)
- tick 61: woodcutter wronged fisher-melina: feud of 1 food; quarrelsome, not in need [evt-61-1453]
- tick 62: fisher-kallias cannot get fish (no-buyer)
- tick 62: fisher-melina cannot get food (no-seller)
- tick 62: fisher-melina cannot get fish (no-buyer)
- tick 62: fisher-eleni cannot get fish (no-buyer)
- tick 62: fisher-dion cannot get fish (no-buyer)
- tick 63: fisher-melina prayed to poseidon: help with food [evt-63-1498] (routed to its patron)
- tick 66: poseidon blessed olive-grower-leon: 2 food
- tick 66: poseidon answered olive-grower-leon's prayer [evt-48-1097]
- tick 66: olive-grower-leon remembers poseidon's answer
- tick 66: olive-grower-leon → poseidon: affinity +1
- tick 67: a tool-flaw in athena's domain (spring, the season's odds) took 2 tools of smith-delia [evt-67-1611]
- tick 68: fisher-kallias cannot get fish (no-buyer)
- tick 68: fisher-melina cannot get fish (no-buyer)
- tick 68: fisher-eleni cannot get fish (no-buyer)
- tick 68: fisher-dion cannot get fish (no-buyer)
- tick 68: olive-grower-aristo cannot get food (no-funds)
- tick 69: olive-grower-phoebe cannot get food (no-funds)
- tick 69: weaver-ismene cannot get wool (no-buyer)
- tick 69: weaver-zoe cannot get wool (no-buyer)
- tick 70: weaver-xenia cannot get wool (no-buyer)
- tick 71: fisher-kallias cannot get fish (no-buyer)
- tick 71: fisher-melina cannot get fish (no-buyer)
- tick 71: fisher-stavros cannot get fish (no-buyer)
- tick 71: fisher-eleni cannot get fish (no-buyer)
- tick 71: fisher-dion cannot get fish (no-buyer)
- tick 71: weaver-ismene cannot get wool (no-buyer)
- tick 71: weaver-zoe cannot get wool (no-buyer)
- tick 72: fisher-stavros cannot get food (no-seller)
- tick 72: weaver-xenia cannot get wool (no-buyer)
- tick 73: fisher-stavros prayed to poseidon: help with food [evt-73-1759] (routed to its patron)
- tick 73: olive-grower-leon cannot get olives (no-buyer)
- tick 73: weaver-ismene cannot get wool (no-buyer)
- tick 73: weaver-zoe cannot get wool (no-buyer)
- tick 75: olive-grower-leon prayed to poseidon: help with olives [evt-75-1816] (routed to its patron)
- tick 75: smith-delia prayed to athena: help with tools [evt-75-1823] (a trouble in the god's domain: routed to the domain god)
- tick 76: zeus blessed woodcutter: 2 food
- tick 76: weaver-xenia cannot get wool (no-buyer)
- tick 76: smith-delia cannot get food (no-seller)
- tick 76: zeus answered woodcutter's prayer [evt-5-109]
- tick 76: woodcutter remembers zeus's answer
- tick 76: woodcutter → zeus: affinity +1
- tick 78: olive-grower-leon cannot get olives (no-buyer)
- tick 78: weaver-xenia cannot get wool (no-buyer)
- tick 79: fisher-kallias cannot get fish (no-buyer)
- tick 79: fisher-melina cannot get fish (no-buyer)
- tick 79: fisher-stavros cannot get fish (no-buyer)
- tick 79: fisher-eleni cannot get fish (no-buyer)
- tick 79: fisher-dion cannot get fish (no-buyer)
- tick 79: weaver-ismene cannot get wool (no-buyer)
- tick 79: weaver-zoe cannot get wool (no-buyer)
- tick 80: olive-grower-aristo cannot get olives (no-buyer)
- tick 80: olive-grower-phoebe cannot get olives (no-buyer)
- tick 81: a harbour-surge in poseidon's domain (spring, the god's floor) damaged fish-landing of ferryman [evt-81-1989]
- tick 81: olive-grower-phoebe cannot get food (no-seller)
- tick 82: olive-grower-phoebe prayed to athena: help with olives [evt-82-2008] (routed to its patron)
- tick 82: fisher-kallias cannot get fish (no-buyer)
- tick 82: fisher-melina cannot get fish (no-buyer)
- tick 82: fisher-stavros cannot get fish (no-buyer)
- tick 82: fisher-eleni cannot get fish (no-buyer)
- tick 82: fisher-dion cannot get fish (no-buyer)
- tick 84: ferryman prayed to poseidon: help with fish-landing [evt-84-2051] (a trouble in the god's domain: routed to the domain god)
- tick 84: olive-grower-phoebe cannot get food (no-seller)
- tick 84: olive-grower-phoebe cannot get olives (no-buyer)
- tick 87: fisher-kallias cannot get fish (no-buyer)
- tick 87: fisher-stavros cannot get fish (no-buyer)
- tick 87: fisher-eleni cannot get fish (no-buyer)
- tick 87: fisher-dion cannot get fish (no-buyer)
- tick 89: athena blessed fisher-eleni: 2 fish
- tick 89: olive-grower-phoebe cannot get food (no-funds)
- tick 89: athena answered fisher-eleni's prayer [evt-55-1282]
- tick 89: fisher-eleni remembers athena's answer
- tick 89: fisher-eleni → athena: affinity +1
- tick 91: fisher-kallias cannot get fish (no-buyer)
- tick 91: fisher-stavros cannot get fish (no-buyer)
- tick 91: fisher-dion cannot get fish (no-buyer)
- tick 97: hades blessed woodcutter: 2 currency
- tick 97: hades answered woodcutter's prayer [evt-52-1194]
- tick 97: woodcutter remembers hades's answer
- tick 97: woodcutter → hades: affinity +1
- tick 98: olive-grower-aristo cannot get food (no-funds)
- tick 99: fisher-melina cannot get fish (no-buyer)
- tick 99: fisher-stavros cannot get fish (no-buyer)
- tick 99: fisher-eleni cannot get fish (no-buyer)
- tick 100: olive-grower-aristo prayed to athena: help with food [evt-100-2444] (routed to its patron)
- tick 100: fisher-melina cannot get food (no-seller)
- tick 101: fisher-melina prayed to poseidon: help with fish [evt-101-2464] (routed to its patron)
- tick 101: fisher-stavros prayed to poseidon: help with fish [evt-101-2465] (routed to its patron)
- tick 102: weaver-zoe cannot get food (no-funds)
- tick 103: fisher-stavros cannot get fish (no-buyer)
- tick 105: olive-grower-aristo cannot get olives (no-buyer)
- tick 106: olive-grower-leon cannot get food (no-funds)
- tick 107: fisher-kallias cannot get fish (no-buyer)
- tick 107: fisher-melina cannot get fish (no-buyer)
- tick 107: fisher-stavros cannot get fish (no-buyer)
- tick 107: fisher-dion cannot get fish (no-buyer)
- tick 107: weaver-ismene cannot get wool (no-buyer)
- tick 108: weaver-zoe cannot get wool (no-buyer)
- tick 108: weaver-xenia cannot get wool (no-buyer)
- tick 109: weaver-ismene cannot get wool (no-buyer)
- tick 110: hera blessed ferryman: 2 food
- tick 110: weaver-zoe cannot get wool (no-buyer)
- tick 110: weaver-xenia cannot get wool (no-buyer)
- tick 110: hera answered ferryman's prayer [evt-58-1366]
- tick 110: ferryman remembers hera's answer
- tick 110: ferryman → hera: affinity +1
- tick 111: fisher-kallias cannot get fish (no-buyer)
- tick 111: fisher-melina cannot get fish (no-buyer)
- tick 111: fisher-stavros cannot get fish (no-buyer)
- tick 111: fisher-dion cannot get fish (no-buyer)
- tick 111: weaver-ismene cannot get wool (no-buyer)
- tick 112: a lightning-fire in zeus's domain (spring, the god's floor) took 1 food of fisher-kallias [evt-112-2773]
- tick 112: weaver-zoe cannot get wool (no-buyer)
- tick 112: weaver-xenia cannot get wool (no-buyer)
- tick 113: weaver-ismene cannot get wool (no-buyer)
- tick 113: weaver-xenia cannot get food (no-funds)
- tick 114: weaver-zoe cannot get wool (no-buyer)
- tick 116: market-trader-iris cannot get food (no-funds)
- tick 116: weaver-zoe cannot get wool (no-buyer)
- tick 117: a dig-collapse in hades's domain (spring, the season's odds) took 2 ore of smith-ktesias [evt-117-2901]
- tick 117: weaver-ismene cannot get wool (no-buyer)
- tick 117: weaver-xenia cannot get wool (no-buyer)
- tick 118: hermes blessed fisher-dion: 2 fish
- tick 118: weaver-zoe cannot get wool (no-buyer)
- tick 118: hermes answered fisher-dion's prayer [evt-55-1283]
- tick 118: fisher-dion remembers hermes's answer
- tick 118: fisher-dion → hermes: affinity +1
- tick 119: weaver-ismene cannot get wool (no-buyer)
- tick 119: weaver-xenia cannot get wool (no-buyer)
- tick 120: weaver-zoe cannot get wool (no-buyer)
- tick 120: the director made fisher-kallias take 21 tools from smith-ktesias
- tick 121: weaver-ismene cannot get wool (no-buyer)
- tick 121: weaver-xenia cannot get wool (no-buyer)
- tick 122: weaver-zoe cannot get food (no-funds)
- tick 123: weaver-ismene cannot get wool (no-buyer)
- tick 123: weaver-xenia cannot get wool (no-buyer)
- tick 124: a forge-flare in hephaestus's domain (spring, the god's floor) damaged the-forge of smith-ktesias [evt-124-3104]
- tick 124: fisher-melina cannot get fish (no-buyer)
- tick 125: fisher-melina cannot get food (no-seller)
- tick 125: weaver-ismene cannot get wool (no-buyer)
- tick 125: weaver-xenia cannot get wool (no-buyer)
- tick 126: fisher-melina prayed to poseidon: punish woodcutter, who owns woodshed [evt-126-3138] (routed to its patron)
- tick 127: weaver-ismene cannot get wool (no-buyer)
- tick 127: weaver-xenia cannot get wool (no-buyer)
- tick 128: fisher-melina cannot get fish (no-buyer)
- tick 128: olive-grower-leon cannot get food (no-funds)
- tick 129: weaver-ismene cannot get wool (no-buyer)
- tick 129: weaver-xenia cannot get wool (no-buyer)
- tick 130: fisher-melina cannot get fish (no-buyer)
- tick 130: fisher-stavros cannot get fish (no-buyer)
- tick 131: poseidon blessed fisher-stavros: 2 fish
- tick 131: weaver-ismene cannot get wool (no-buyer)
- tick 131: weaver-xenia cannot get wool (no-buyer)
- tick 131: poseidon answered fisher-stavros's prayer [evt-101-2465]
- tick 131: fisher-stavros remembers poseidon's answer
- tick 131: fisher-stavros → poseidon: affinity +1
- tick 133: weaver-ismene cannot get wool (no-buyer)
- tick 133: weaver-xenia cannot get food (no-funds)
- tick 136: market-trader-iris cannot get food (no-funds)
- tick 138: weaver-ismene cannot get wool (no-buyer)
- tick 139: a crossing-loss in hermes's domain (spring, the god's floor) took 2 ore of smith-brontes [evt-139-3478]
- tick 140: weaver-ismene cannot get wool (no-buyer)
- tick 141: herdsman-damon wronged olive-grower-phoebe: theft of 2 cloth; greedy, not in need [evt-141-3527]
- tick 141: olive-grower-phoebe cannot get cloth (no-funds)
- tick 142: weaver-ismene cannot get wool (no-buyer)
- tick 144: weaver-ismene cannot get wool (no-buyer)
- tick 145: smith-ktesias cannot get food (no-seller)
- tick 146: smith-ktesias prayed to hephaestus: help with food [evt-146-3648] (routed to its patron)
- tick 146: olive-grower-leon cannot get food (no-funds)
- tick 146: weaver-ismene cannot get wool (no-buyer)
- tick 147: fisher-melina cannot get fish (no-buyer)
- tick 148: olive-grower-leon prayed to poseidon: help with food [evt-148-3693] (routed to its patron)
- tick 148: weaver-ismene cannot get wool (no-buyer)
- tick 149: athena blessed olive-grower-aristo: 2 food
- tick 149: olive-grower-leon wronged farmer: unpaid-debt of 3 currency; quarrelsome, in need; the credit [evt-49-1132] failed [evt-149-3730]
- tick 149: fisher-kallias cannot get food (no-seller)
- tick 149: fisher-stavros cannot get food (no-funds)
- tick 149: athena answered olive-grower-aristo's prayer [evt-100-2444]
- tick 149: olive-grower-aristo remembers athena's answer
- tick 149: olive-grower-aristo → athena: affinity +1
- tick 150: fisher-kallias prayed to poseidon: help with food [evt-150-3764] (routed to its patron)
- tick 150: a tool-flaw in athena's domain (spring, the god's floor) took 1 tools of market-trader-iris [evt-150-3781]
- tick 150: fisher-dion cannot get food (no-seller)
- tick 150: olive-grower-phoebe cannot get food (no-seller)
- tick 150: weaver-ismene cannot get wool (no-buyer)
- tick 150: weaver-zoe cannot get food (no-seller)
- tick 150: weaver-xenia cannot get food (no-seller)
- tick 151: farmer prayed to hera: punish olive-grower-leon, who owns  [evt-151-3791] (routed to its patron)
- tick 151: olive-grower-aristo wronged woodcutter: unpaid-debt of 3 currency; greedy, in need; the credit [evt-51-1190] failed [evt-151-3809]
- tick 151: fisher-kallias cannot get food (no-seller)
- tick 151: fisher-eleni cannot get food (no-seller)
- tick 152: market-trader-iris prayed to athena: help with tools [evt-152-3822] (a trouble in the god's domain: routed to the domain god)
- tick 152: fisher-dion cannot get food (no-seller)
- tick 152: olive-grower-phoebe cannot get cloth (no-funds)
- tick 153: fisher-dion prayed to hermes: help with food [evt-153-3852] (routed to its patron)
- tick 153: fisher-eleni cannot get fish (no-buyer)
- tick 153: fisher-dion cannot get fish (no-buyer)
- tick 153: olive-grower-leon cannot get olives (no-buyer)
- tick 153: smith-brontes cannot get food (no-seller)
- tick 154: fisher-eleni prayed to athena: help with fish [evt-154-3881] (routed to its patron)
- tick 154: fisher-kallias cannot get fish (no-buyer)
- tick 154: fisher-melina cannot get fish (no-buyer)
- tick 155: woodcutter prayed to zeus: punish olive-grower-aristo, who owns olive-press [evt-155-3901] (routed to its patron)
- tick 155: fisher-dion cannot get fish (no-buyer)
- tick 156: smith-brontes prayed to hephaestus: help with food [evt-156-3940] (routed to its patron)
- tick 156: market-trader-iris cannot get food (no-funds)
- tick 156: fisher-kallias's prayer to poseidon lapsed unanswered [evt-5-113]
- tick 156: fisher-kallias remembers poseidon's silence
- tick 156: fisher-kallias → poseidon: affinity -2, grudge +1
- tick 157: fisher-kallias cannot get fish (no-buyer)
- tick 157: fisher-melina cannot get fish (no-buyer)
- tick 157: fisher-dion cannot get fish (no-buyer)
- tick 158: fisher-eleni cannot get fish (no-buyer)
- tick 158: olive-grower-phoebe cannot get food (no-funds)
- tick 158: olive-grower-phoebe cannot get cloth (no-funds)
- tick 160: fisher-eleni cannot get food (no-funds)
- tick 162: hephaestus blessed smith-ktesias: 2 food
- tick 162: olive-grower-phoebe cannot get food (no-funds)
- tick 162: olive-grower-phoebe cannot get olives (no-buyer)
- tick 162: hephaestus answered smith-ktesias's prayer [evt-146-3648]
- tick 162: smith-ktesias remembers hephaestus's answer
- tick 162: smith-ktesias → hephaestus: affinity +1
- tick 163: olive-grower-phoebe prayed to athena: punish herdsman-damon, who owns  [evt-163-4113] (routed to its patron)
- tick 164: fisher-kallias wronged fisher-eleni: theft of 2 cloth; greedy, in need [evt-164-4148]
- tick 166: olive-grower-leon cannot get food (no-funds)
- tick 167: fisher-kallias cannot get fish (no-buyer)
- tick 167: fisher-melina cannot get fish (no-buyer)
- tick 167: fisher-eleni cannot get fish (no-buyer)
- tick 167: fisher-dion cannot get fish (no-buyer)
- tick 168: olive-grower-aristo cannot get food (no-funds)
- tick 168: olive-grower-phoebe cannot get olives (no-buyer)
- tick 169: a ore-seam-lost in hades's domain (spring, the god's floor) took 2 ore of smith-delia [evt-169-4280]
- tick 169: fisher-stavros cannot get food (no-funds)
- tick 169: olive-grower-phoebe cannot get food (no-seller)
- tick 171: fisher-kallias cannot get fish (no-buyer)
- tick 171: fisher-melina cannot get fish (no-buyer)
- tick 171: fisher-stavros cannot get fish (no-buyer)
- tick 171: fisher-eleni cannot get fish (no-buyer)
- tick 171: fisher-dion cannot get fish (no-buyer)
- tick 172: smith-ktesias prayed to hephaestus: help with the-forge [evt-172-4358] (a trouble in the god's domain: routed to the domain god)
- tick 172: smith-delia prayed to hades: help with ore [evt-172-4360] (a trouble in the god's domain: routed to the domain god)
- tick 172: fisher-stavros cannot get food (no-funds)
- tick 172: olive-grower-aristo cannot get olives (no-buyer)
- tick 173: fisher-stavros prayed to poseidon: help with fish [evt-173-4373] (routed to its patron)
- tick 173: olive-grower-aristo prayed to athena: help with food [evt-173-4376] (routed to its patron)
- tick 175: fisher-stavros cannot get fish (no-buyer)
- tick 176: market-trader-iris cannot get food (no-funds)
- tick 177: fisher-eleni cannot get food (no-seller)
- tick 177: fisher-eleni cannot get fish (no-buyer)
- tick 177: olive-grower-aristo cannot get food (no-funds)
- tick 178: hermes blessed fisher-dion: 2 food
- tick 178: fisher-eleni prayed to athena: help with food [evt-178-4497] (routed to its patron)
- tick 178: a cracked-tools in hephaestus's domain (spring, the god's floor) took 2 tools of fisher-dion [evt-178-4512]
- tick 178: hermes answered fisher-dion's prayer [evt-153-3852]
- tick 178: fisher-dion remembers hermes's answer
- tick 178: fisher-dion → hermes: affinity +1
- tick 180: fisher-eleni cannot get fish (no-buyer)
- tick 180: fisher-dion cannot get fish (no-buyer)
- tick 181: fisher-dion prayed to hermes: help with fish [evt-181-4572] (routed to its patron)
- tick 182: fisher-kallias prayed to zeus: help with food [evt-182-4589] (a trouble in the god's domain: routed to the domain god)
- tick 182: olive-grower-aristo cannot get food (no-funds)
- tick 182: olive-grower-aristo cannot get olives (no-buyer)
- tick 183: hera struck olive-grower-leon and took 2 cloth [evt-183-4611]
- tick 183: smith-brontes prayed to hermes: help with ore [evt-183-4629] (a trouble in the god's domain: routed to the domain god)
- tick 183: fisher-dion cannot get fish (no-buyer)
- tick 183: hera's boon to farmer was seen given [evt-170-4289] (evt-183-4611)
- tick 183: hera answered farmer's prayer [evt-151-3791]
- tick 183: farmer remembers hera's answer
- tick 183: farmer → hera: affinity +1
- tick 184: olive-grower-aristo wronged olive-grower-phoebe: theft of 2 cloth; greedy, in need [evt-184-4670]
- tick 184: olive-grower-phoebe cannot get cloth (no-funds)
- tick 185: fisher-kallias cannot get fish (no-buyer)
- tick 187: fisher-kallias cannot get fish (no-buyer)
- tick 187: fisher-melina cannot get fish (no-buyer)
- tick 187: fisher-stavros cannot get fish (no-buyer)
- tick 187: fisher-eleni cannot get fish (no-buyer)
- tick 187: fisher-dion cannot get fish (no-buyer)
- tick 187: olive-grower-leon cannot get olives (no-buyer)
- tick 188: olive-grower-leon cannot get food (no-funds)
- tick 189: olive-grower-leon prayed to poseidon: help with cloth [evt-189-4804] (routed to its patron)
- tick 189: olive-grower-phoebe cannot get food (no-funds)
- tick 189: farmer's prayer to athena lapsed unanswered [evt-38-862]
- tick 189: farmer remembers athena's silence
- tick 189: farmer → athena: affinity -2, grudge +1
- tick 190: olive-grower-phoebe prayed to athena: punish olive-grower-aristo, who owns olive-press [evt-190-4834] (routed to its patron)
- tick 190: fisher-melina cannot get fish (no-buyer)
- tick 190: fisher-stavros cannot get fish (no-buyer)
- tick 190: fisher-eleni cannot get fish (no-buyer)
- tick 190: fisher-dion cannot get fish (no-buyer)
- tick 191: fisher-kallias cannot get fish (no-buyer)
- tick 191: olive-grower-leon cannot get olives (no-buyer)
- tick 192: olive-grower-leon cannot get food (no-funds)
- tick 193: a squall in zeus's domain (spring, the god's floor) damaged olive-press of olive-grower-aristo [evt-193-4921]
- tick 194: poseidon blessed fisher-stavros: 2 fish
- tick 194: poseidon answered fisher-stavros's prayer [evt-173-4373]
- tick 194: fisher-stavros remembers poseidon's answer
- tick 194: fisher-stavros → poseidon: affinity +1
- tick 195: smith-ktesias prayed to hermes: help with tools [evt-195-4968] (not its authored patron (a defection or a domain))
- tick 195: market-trader-iris cannot get wine (no-buyer)
- tick 196: market-trader-iris cannot get food (no-funds)
- tick 197: olive-grower-aristo cannot get olives (no-buyer)
- tick 198: olive-grower-aristo prayed to zeus: help with olive-press [evt-198-5035] (a trouble in the god's domain: routed to the domain god)
- tick 198: fisher-kallias wronged fisher-melina: theft of 1 food; greedy, in need [evt-198-5048]
- tick 199: fisher-stavros cannot get fish (no-buyer)
- tick 200: the season turned from spring to summer
- tick 200: fisher-melina cannot get food (no-seller)
- tick 201: fisher-melina prayed to poseidon: punish fisher-kallias, who owns  [evt-201-5109] (routed to its patron)
- tick 201: fisher-stavros prayed to poseidon: help with fish [evt-201-5110] (routed to its patron)
- tick 202: zeus blessed fisher-kallias: 1 food
- tick 202: olive-grower-aristo cannot get food (no-funds)
- tick 202: olive-grower-aristo cannot get olives (no-buyer)
- tick 202: zeus answered fisher-kallias's prayer [evt-182-4589]
- tick 202: fisher-kallias remembers zeus's answer
- tick 202: fisher-kallias → zeus: affinity +1
- tick 203: fisher-stavros cannot get fish (no-buyer)
- tick 203: fisher-eleni cannot get food (no-seller)
- tick 203: fisher-eleni cannot get fish (no-buyer)
- tick 203: fisher-dion cannot get fish (no-buyer)
- tick 204: fisher-eleni prayed to athena: punish fisher-kallias, who owns  [evt-204-5195] (routed to its patron)
- tick 204: fisher-dion prayed to hephaestus: help with tools [evt-204-5196] (a trouble in the god's domain: routed to the domain god)
- tick 204: fisher-melina cannot get fish (no-buyer)
- tick 204: olive-grower-aristo's prayer to athena lapsed unanswered [evt-53-1226]
- tick 204: olive-grower-phoebe's prayer to athena lapsed unanswered [evt-53-1227]
- tick 204: olive-grower-aristo remembers athena's silence
- tick 204: olive-grower-phoebe remembers athena's silence
- tick 204: olive-grower-aristo → athena: affinity -2, grudge +1
- tick 204: olive-grower-phoebe → athena: affinity -2, grudge +1
- tick 206: fisher-kallias cannot get fish (no-buyer)
- tick 206: fisher-melina cannot get fish (no-buyer)
- tick 206: fisher-stavros cannot get fish (no-buyer)
- tick 206: fisher-eleni cannot get food (no-funds)
- tick 206: fisher-kallias's prayer to poseidon lapsed unanswered [evt-55-1280]
- tick 206: fisher-kallias remembers poseidon's silence
- tick 206: fisher-kallias → poseidon: affinity -2, grudge +1
- tick 206: fisher-kallias left poseidon for zeus: poseidon left 2 prayers unanswered ([evt-55-1280], [evt-5-113]) and zeus answered [evt-182-4589] [evt-206-5269]
- tick 209: fisher-kallias cannot get fish (no-buyer)
- tick 211: fisher-kallias prayed to zeus: help with fish [evt-211-5366] (not its authored patron (a defection or a domain))
- tick 214: fisher-kallias cannot get fish (no-buyer)
- tick 214: olive-grower-phoebe cannot get olives (no-buyer)
- tick 214: fisher-melina's prayer to poseidon lapsed unanswered [evt-63-1498]
- tick 214: fisher-melina remembers poseidon's silence
- tick 214: fisher-melina → poseidon: affinity -2, grudge +1
- tick 215: athena blessed fisher-eleni: 2 food
- tick 215: olive-grower-phoebe prayed to athena: help with food [evt-215-5470] (routed to its patron)
- tick 215: market-trader-iris cannot get wine (no-buyer)
- tick 215: athena answered fisher-eleni's prayer [evt-178-4497]
- tick 215: fisher-eleni remembers athena's answer
- tick 215: fisher-eleni → athena: affinity +1
- tick 216: market-trader-iris cannot get food (no-funds)
- tick 217: olive-grower-phoebe cannot get olives (no-buyer)
- tick 218: smith-ktesias prayed to hephaestus: punish fisher-kallias, who owns  [evt-218-5553] (routed to its patron)
- tick 222: olive-grower-aristo cannot get olives (no-buyer)
- tick 223: olive-grower-aristo cannot get food (no-funds)
- tick 224: olive-grower-aristo prayed to athena: help with olives [evt-224-5683] (routed to its patron)
- tick 224: fisher-stavros's prayer to poseidon lapsed unanswered [evt-73-1759]
- tick 224: fisher-stavros remembers poseidon's silence
- tick 224: fisher-stavros → poseidon: affinity -2, grudge +1
- tick 225: market-trader-iris cannot get wine (no-buyer)
- tick 226: olive-grower-leon's prayer to poseidon lapsed unanswered [evt-75-1816]
- tick 226: smith-delia's prayer to athena lapsed unanswered [evt-75-1823]
- tick 226: olive-grower-leon remembers poseidon's silence
- tick 226: smith-delia remembers athena's silence
- tick 226: olive-grower-leon → poseidon: affinity -2, grudge +1
- tick 226: smith-delia → athena: affinity -2, grudge +1
- tick 227: market-trader-iris prayed to hermes: help with wine [evt-227-5757] (routed to its patron)
- tick 227: fisher-kallias cannot get fish (no-buyer)
- tick 227: fisher-melina cannot get fish (no-buyer)
- tick 227: fisher-stavros cannot get fish (no-buyer)
- tick 227: fisher-eleni cannot get fish (no-buyer)
- tick 227: fisher-dion cannot get fish (no-buyer)
- tick 227: olive-grower-aristo cannot get olives (no-buyer)
- tick 228: olive-grower-aristo cannot get food (no-seller)
- tick 228: weaver-ismene cannot get wool (no-buyer)
- tick 230: market-trader-iris cannot get wine (no-buyer)
- tick 231: fisher-kallias cannot get fish (no-buyer)
- tick 231: fisher-melina cannot get fish (no-buyer)
- tick 231: fisher-stavros cannot get fish (no-buyer)
- tick 231: fisher-eleni cannot get fish (no-buyer)
- tick 231: fisher-dion cannot get fish (no-buyer)
- tick 231: olive-grower-leon cannot get olives (no-buyer)
- tick 232: olive-grower-leon cannot get food (no-funds)
- tick 233: olive-grower-leon prayed to poseidon: help with olives [evt-233-5924] (routed to its patron)
- tick 233: olive-grower-phoebe's prayer to athena lapsed unanswered [evt-82-2008]
- tick 233: olive-grower-phoebe remembers athena's silence
- tick 233: olive-grower-phoebe → athena: affinity -2, grudge +1
- tick 234: market-trader-iris cannot get wine (no-buyer)
- tick 234: weaver-ismene cannot get wool (no-buyer)
- tick 235: ferryman's prayer to poseidon lapsed unanswered [evt-84-2051]
- tick 235: ferryman remembers poseidon's silence
- tick 235: ferryman → poseidon: affinity -2, grudge +1
- tick 236: hephaestus blessed smith-ktesias: 3 planks for the-forge
- tick 236: market-trader-iris cannot get food (no-funds)
- tick 236: market-trader-iris cannot get wine (no-buyer)
- tick 236: hephaestus answered smith-ktesias's prayer [evt-172-4358]
- tick 236: smith-ktesias remembers hephaestus's answer
- tick 236: smith-ktesias → hephaestus: affinity +1
- tick 239: market-trader-iris cannot get wine (no-buyer)
- tick 239: olive-grower-phoebe cannot get olives (no-buyer)
- tick 240: olive-grower-phoebe prayed to athena: help with olives [evt-240-6106] (routed to its patron)
- tick 240: fisher-eleni cannot get food (no-funds)
- tick 240: the director spoiled 32 tools of smith-brontes
- tick 241: hades blessed smith-delia: 2 ore
- tick 241: market-trader-iris cannot get wine (no-buyer)
- tick 241: hades's boon to smith-delia was seen given [evt-224-5673] (evt-241-6124)
- tick 241: hades answered smith-delia's prayer [evt-172-4360]
- tick 241: smith-delia remembers hades's answer
- tick 241: smith-delia → hades: affinity +1
- tick 241: smith-delia left athena for hades: athena left 1 prayers unanswered ([evt-75-1823]) and hades answered [evt-172-4360] [evt-241-6155]
- tick 242: smith-ktesias prayed to hades: help with ore [evt-242-6174] (a trouble in the god's domain: routed to the domain god)
- tick 242: a quake in poseidon's domain (summer, the god's floor) damaged woodshed of woodcutter [evt-242-6180]
- tick 242: fisher-eleni cannot get fish (no-buyer)
- tick 242: olive-grower-phoebe cannot get olives (no-buyer)
- tick 243: market-trader-iris cannot get wine (no-buyer)
- tick 243: fisher-eleni cannot get food (no-funds)
- tick 244: woodcutter prayed to poseidon: help with woodshed [evt-244-6218] (a trouble in the god's domain: routed to the domain god)
- tick 244: smith-brontes prayed to hera: help with tools [evt-244-6235] (not its authored patron (a defection or a domain))
- tick 248: fisher-eleni cannot get fish (no-buyer)
- tick 248: olive-grower-aristo cannot get food (no-funds)
- tick 249: fisher-stavros cannot get food (no-funds)
- tick 251: fisher-stavros wronged fisher-eleni: unpaid-debt of 3 currency; quarrelsome, in need; the credit [evt-151-3808] failed [evt-251-6404]
- tick 251: fisher-kallias cannot get fish (no-buyer)
- tick 251: fisher-melina cannot get fish (no-buyer)
- tick 251: fisher-stavros cannot get fish (no-buyer)
- tick 251: fisher-dion cannot get fish (no-buyer)
- tick 252: hermes blessed fisher-dion: 2 fish
- tick 252: fisher-stavros prayed to poseidon: help with food [evt-252-6418] (routed to its patron)
- tick 252: olive-grower-leon wronged olive-grower-aristo: unpaid-debt of 3 currency; quarrelsome, in need; the credit [evt-152-3838] failed [evt-252-6434]
- tick 252: fisher-kallias wronged fisher-dion: cheating of 2 currency; greedy, in need [evt-252-6435]
- tick 252: hermes answered fisher-dion's prayer [evt-181-4572]
- tick 252: fisher-melina's prayer to poseidon lapsed unanswered [evt-101-2464]
- tick 252: fisher-dion remembers hermes's answer
- tick 252: fisher-melina remembers poseidon's silence
- tick 252: fisher-dion → hermes: affinity +1
- tick 252: fisher-melina → poseidon: affinity -2, grudge +1
- tick 253: fisher-eleni cannot get fish (no-buyer)
- tick 254: fisher-eleni prayed to athena: punish fisher-stavros, who owns  [evt-254-6496] (routed to its patron)
- tick 254: fisher-stavros cannot get fish (no-buyer)
- tick 254: fisher-dion cannot get food (no-seller)
- tick 254: fisher-dion cannot get fish (no-buyer)
- tick 255: fisher-dion prayed to hermes: help with food [evt-255-6530] (routed to its patron)
- tick 256: market-trader-iris cannot get food (no-funds)
- tick 256: fisher-eleni cannot get fish (no-buyer)
- tick 257: market-trader-iris wronged farmer: unpaid-debt of 3 currency; greedy, in need; the credit [evt-157-3974] failed [evt-257-6596]
- tick 258: market-trader-iris prayed to hermes: help with food [evt-258-6603] (routed to its patron)
- tick 258: fisher-kallias cannot get fish (no-buyer)
- tick 258: fisher-stavros cannot get fish (no-buyer)
- tick 258: fisher-eleni cannot get fish (no-buyer)
- tick 258: fisher-dion cannot get fish (no-buyer)
- tick 258: weaver-xenia cannot get food (no-seller)
- tick 259: hera blessed smith-brontes: 4 tools
- tick 259: farmer prayed to hera: punish market-trader-iris, who owns  [evt-259-6632] (routed to its patron)
- tick 259: fisher-melina cannot get fish (no-buyer)
- tick 259: hera answered smith-brontes's prayer [evt-244-6235]
- tick 259: smith-brontes remembers hera's answer
- tick 259: smith-brontes → hera: affinity +1
- tick 260: fisher-eleni cannot get food (no-funds)
- tick 261: fisher-melina prayed to poseidon: help with fish [evt-261-6684] (routed to its patron)
- tick 261: weaver-xenia prayed to hera: help with food [evt-261-6693] (routed to its patron)
- tick 261: olive-grower-aristo cannot get olives (no-buyer)
- tick 262: olive-grower-aristo prayed to athena: punish olive-grower-leon, who owns  [evt-262-6712] (routed to its patron)
- tick 262: fisher-melina cannot get fish (no-buyer)
- tick 263: a roof-leak in hera's domain (summer, the god's floor) took 1 food of fisher-stavros [evt-263-6749]
- tick 263: fisher-stavros cannot get food (no-funds)
- tick 263: olive-grower-aristo cannot get olives (no-buyer)
- tick 264: fisher-melina cannot get fish (no-buyer)
- tick 265: a lightning-fire in zeus's domain (summer, the season's odds) took 1 food of fisher-dion [evt-265-6803]
- tick 265: fisher-melina cannot get food (no-funds)
- tick 265: olive-grower-phoebe cannot get olives (no-buyer)
- tick 266: olive-grower-phoebe prayed to athena: help with cloth [evt-266-6819] (routed to its patron)
- tick 266: olive-grower-aristo cannot get olives (no-buyer)
- tick 266: olive-grower-leon cannot get food (no-funds)
- tick 266: weaver-xenia cannot get food (no-seller)
- tick 267: fisher-kallias cannot get fish (no-buyer)
- tick 267: fisher-melina cannot get fish (no-buyer)
- tick 267: fisher-stavros cannot get fish (no-buyer)
- tick 267: fisher-eleni cannot get fish (no-buyer)
- tick 267: fisher-dion cannot get fish (no-buyer)
- tick 268: olive-grower-aristo cannot get food (no-seller)
- tick 268: olive-grower-phoebe cannot get olives (no-buyer)
- tick 269: fisher-kallias cannot get fish (no-buyer)
- tick 269: fisher-melina cannot get fish (no-buyer)
- tick 269: fisher-stavros cannot get fish (no-buyer)
- tick 269: fisher-eleni cannot get fish (no-buyer)
- tick 269: fisher-dion cannot get fish (no-buyer)
- tick 269: olive-grower-phoebe cannot get food (no-funds)
- tick 270: market-trader-iris cannot get wine (no-buyer)
- tick 271: fisher-kallias cannot get fish (no-buyer)
- tick 271: fisher-melina cannot get fish (no-buyer)
- tick 271: fisher-stavros cannot get fish (no-buyer)
- tick 271: fisher-eleni cannot get fish (no-buyer)
- tick 271: fisher-dion cannot get fish (no-buyer)
- tick 272: poseidon blessed fisher-stavros: 2 food
- tick 272: fisher-kallias wronged fisher-dion: feud of 2 cloth; greedy, in need; a revenge for [evt-1-23] [evt-272-7004]
- tick 272: poseidon answered fisher-stavros's prayer [evt-252-6418]
- tick 272: fisher-stavros remembers poseidon's answer
- tick 272: fisher-stavros → poseidon: affinity +1
- tick 273: market-trader-iris cannot get wine (no-buyer)
- tick 274: fisher-stavros cannot get fish (no-buyer)
- tick 276: fisher-stavros prayed to hera: help with food [evt-276-7099] (a trouble in the god's domain: routed to the domain god)
- tick 276: market-trader-iris cannot get food (no-funds)
- tick 276: fisher-eleni cannot get fish (no-buyer)
- tick 277: fisher-eleni cannot get food (no-funds)
- tick 277: fisher-melina's prayer to poseidon lapsed unanswered [evt-126-3138]
- tick 277: fisher-melina remembers poseidon's silence
- tick 277: fisher-melina → poseidon: affinity -2, grudge +1
- tick 278: fisher-dion prayed to hermes: punish fisher-kallias, who owns  [evt-278-7154] (routed to its patron)
- tick 278: fisher-eleni cannot get fish (no-buyer)
- tick 279: fisher-eleni prayed to athena: help with food [evt-279-7176] (routed to its patron)
- tick 280: fisher-stavros cannot get fish (no-buyer)
- tick 280: fisher-dion cannot get fish (no-buyer)
- tick 281: zeus blessed fisher-kallias: 2 fish
- tick 281: zeus answered fisher-kallias's prayer [evt-211-5366]
- tick 281: fisher-kallias remembers zeus's answer
- tick 281: fisher-kallias → zeus: affinity +1
- tick 285: fisher-melina cannot get food (no-funds)
- tick 288: a vanished-goods in hermes's domain (summer, the god's floor) took 2 fish of olive-grower-phoebe [evt-288-7403]
- tick 288: olive-grower-aristo cannot get food (no-funds)
- tick 290: fisher-kallias cannot get fish (no-buyer)
- tick 290: fisher-melina cannot get fish (no-buyer)
- tick 291: fisher-stavros cannot get fish (no-buyer)
- tick 291: fisher-eleni cannot get fish (no-buyer)
- tick 291: fisher-dion cannot get fish (no-buyer)
- tick 292: fisher-kallias prayed to zeus: help with fish [evt-292-7487] (not its authored patron (a defection or a domain))
- tick 295: athena blessed olive-grower-phoebe: 2 cloth
- tick 295: athena answered olive-grower-phoebe's prayer [evt-266-6819]
- tick 295: olive-grower-phoebe remembers athena's answer
- tick 295: olive-grower-phoebe → athena: affinity +1
- tick 296: market-trader-iris cannot get food (no-funds)
- tick 298: provisioner-nikanor wronged smith-brontes: theft of 2 tools; greedy, not in need [evt-298-7646]
- tick 299: olive-grower-leon's prayer to poseidon lapsed unanswered [evt-148-3693]
- tick 299: olive-grower-leon remembers poseidon's silence
- tick 299: olive-grower-leon → poseidon: affinity -2, grudge +1
- tick 300: fisher-dion cannot get fish (no-buyer)

## Journeys

No god set out on a journey.

## Practice threads

### supplication [evt-41-928]: hera → farmer, fulfilled

- Opened at tick 41
- Cause: unmet-need (farmer) [evt-1-24]
- Answers the prayer [evt-3-61]
- Moves:
  1. tick 41, Hera: offer — farmer offers hera 1 currency by tick 131
  2. tick 42, farmer: accept
- Boon: seen given (evt-54-1245)
- Offering: not seen
- Ending: fulfilled at tick 55, by farmer; remembered by farmer, hera
- Changed: hera → farmer: affinity +1

### supplication [evt-170-4289]: hera → farmer, fulfilled

- Opened at tick 170
- Cause: wrong (olive-grower-leon) [evt-149-3730]
- Answers the prayer [evt-151-3791]
- Moves:
  1. tick 170, Hera: offer — farmer offers hera 1 cloth by tick 260
  2. tick 171, farmer: accept
- Boon: seen given (evt-183-4611)
- Offering: not seen
- Ending: fulfilled at tick 184, by farmer; remembered by farmer, hera
- Changed: hera → farmer: affinity +1

### supplication [evt-224-5673]: hades → smith-delia, fulfilled

- Opened at tick 224
- Cause: trouble (smith-delia) [evt-169-4280]
- Answers the prayer [evt-172-4360]
- Moves:
  1. tick 224, Hades: offer — smith-delia offers hades 1 currency by tick 314
  2. tick 225, smith-delia: accept
- Boon: seen given (evt-241-6124)
- Offering: not seen
- Ending: fulfilled at tick 243, by smith-delia; remembered by hades, smith-delia
- Changed: hades → smith-delia: affinity +1

## What each god practiced

- athena: no practice move; thread endings: none
- hades: supplication; thread endings: fulfilled [evt-224-5673] by its act
- hephaestus: no practice move; thread endings: none
- hera: supplication; thread endings: fulfilled [evt-41-928] by its act, fulfilled [evt-170-4289] by its act
- hermes: no practice move; thread endings: none
- poseidon: no practice move; thread endings: none
- zeus: no practice move; thread endings: none

## Open threads at the end

No thread was open at the end.

## Moves judged no progress

No move was judged no progress.

## Turns while an obligation was open

A turn is performed, waited for a named event, or knowingly risked breach (R12, amended 2026-10-03: an acceptance binds).

Each turn is classified from the god's prompt and its proposal. An acceptance binds, so the god performs, waits, or risks breach, and bargaining is for a thread still open: the action the term calls for, committed, is performed; a turn that did something else is waited for a named event when its prompt shows what stops it (the digest's UNPERFORMABLE obstacle, or no mortal at the place a legend is to be told); every other turn, an attempt to bargain over the accepted thread included, is knowingly risked breach, since the obligation led the prompt.

| God | Tick | Thread | Deadline | Chose | Classified | Waiting for |
| --- | --- | --- | --- | --- | --- | --- |
| hera | 50 | evt-41-928 | 131 | bless | performed |  |
| hera | 178 | evt-170-4289 | 260 | strike | performed |  |
| hades | 236 | evt-224-5673 | 314 | bless | performed |  |

## Repetition

- Athena: longest run 1 of legend:legend (cap 3). Choices: legend:legend ×1, bless:evt-55-1282 ×1, bless:evt-100-2444 ×1, bless:evt-178-4497 ×1, bless:evt-266-6819 ×1
- Hades: longest run 1 of legend:legend (cap 3). Choices: legend:legend ×2, bless:evt-52-1194 ×1, practice:offer evt-172-4360 ×1, bless:evt-172-4360 ×1
- Hephaestus: longest run 1 of report:provisioner-nikanor (cap 3). Choices: report:provisioner-nikanor ×1, legend:legend ×1, bless:evt-146-3648 ×1, bless:evt-172-4358 ×1
- Hera: longest run 1 of practice:offer evt-3-61 (cap 3). Choices: practice:offer evt-3-61 ×1, bless:evt-3-61 ×1, bless:evt-58-1366 ×1, practice:offer evt-151-3791 ×1, strike:olive-grower-leon ×1, bless:evt-244-6235 ×1
- Hermes: longest run 1 of bless:evt-7-165 (cap 3). Choices: bless:evt-7-165 ×1, bless:evt-55-1283 ×1, bless:evt-153-3852 ×1, bless:evt-181-4572 ×1
- Poseidon: longest run 1 of bless:evt-48-1097 (cap 3). Choices: bless:evt-48-1097 ×1, bless:evt-101-2465 ×1, bless:evt-173-4373 ×1, bless:evt-252-6418 ×1
- Zeus: longest run 1 of bless:evt-5-109 (cap 3). Choices: bless:evt-5-109 ×1, report:hera ×1, bless:evt-182-4589 ×1, bless:evt-211-5366 ×1

## Automated checks

| God | Check | Result | Detail |
| --- | --- | --- | --- |
| Athena | profile trace | pass | 5 actions: 5 ability-backed, 0 context-backed |
| Athena | repetition | pass | longest run 1 of legend:legend (cap 3) |
| Athena | minimum activity | pass | 5 committed model actions (at least 5) |
| Athena | influence | pass | 8 caused (told belief, relationship-changed) |
| Athena | petition heard | pass | 21 petitions addressed to this god (at least 1) |
| Athena | petition answered | pass | 4 of 21 answered (at least 1) |
| Hades | profile trace | pass | 5 actions: 2 ability-backed, 3 context-backed |
| Hades | repetition | pass | longest run 1 of legend:legend (cap 3) |
| Hades | minimum activity | pass | 5 committed model actions (at least 5) |
| Hades | influence | pass | 2 caused (relationship-changed) |
| Hades | petition heard | pass | 3 petitions addressed to this god (at least 1) |
| Hades | petition answered | pass | 2 of 3 answered (at least 1) |
| Hephaestus | profile trace | pass | 4 actions: 3 ability-backed, 1 context-backed |
| Hephaestus | repetition | pass | longest run 1 of report:provisioner-nikanor (cap 3) |
| Hephaestus | minimum activity | FAIL | 4 committed model actions (at least 5) |
| Hephaestus | influence | pass | 7 caused (told belief, relationship-changed) |
| Hephaestus | petition heard | pass | 5 petitions addressed to this god (at least 1) |
| Hephaestus | petition answered | pass | 2 of 5 answered (at least 1) |
| Hera | profile trace | pass | 6 actions: 1 ability-backed, 5 context-backed |
| Hera | repetition | pass | longest run 1 of practice:offer evt-3-61 (cap 3) |
| Hera | minimum activity | pass | 6 committed model actions (at least 5) |
| Hera | influence | pass | 4 caused (relationship-changed) |
| Hera | petition heard | pass | 7 petitions addressed to this god (at least 1) |
| Hera | petition answered | pass | 4 of 7 answered (at least 1) |
| Hermes | profile trace | pass | 4 actions: 4 ability-backed, 0 context-backed |
| Hermes | repetition | pass | longest run 1 of bless:evt-7-165 (cap 3) |
| Hermes | minimum activity | FAIL | 4 committed model actions (at least 5) |
| Hermes | influence | pass | 4 caused (relationship-changed) |
| Hermes | petition heard | pass | 10 petitions addressed to this god (at least 1) |
| Hermes | petition answered | pass | 4 of 10 answered (at least 1) |
| Poseidon | profile trace | pass | 4 actions: 0 ability-backed, 4 context-backed |
| Poseidon | repetition | pass | longest run 1 of bless:evt-48-1097 (cap 3) |
| Poseidon | minimum activity | FAIL | 4 committed model actions (at least 5) |
| Poseidon | influence | pass | 4 caused (relationship-changed) |
| Poseidon | petition heard | pass | 20 petitions addressed to this god (at least 1) |
| Poseidon | petition answered | pass | 4 of 20 answered (at least 1) |
| Zeus | profile trace | pass | 4 actions: 0 ability-backed, 4 context-backed |
| Zeus | repetition | pass | longest run 1 of bless:evt-5-109 (cap 3) |
| Zeus | minimum activity | FAIL | 4 committed model actions (at least 5) |
| Zeus | influence | pass | 4 caused (relationship-changed, told belief) |
| Zeus | petition heard | pass | 6 petitions addressed to this god (at least 1) |
| Zeus | petition answered | pass | 3 of 6 answered (at least 1) |

## Model run

- 32 requests: 32 answered (32 native, 0 repaired), 0 exhausted; latency p50 8090 ms, p95 12804 ms; prompt p50 6946 / max 10802 characters; frames showed model-degraded in 0% of polls
- valid actions: held (32 proposals, all god actions, none rejected as malformed)
- perception compliance: held (every id named by 32 proposals was in the prompt behind it)
- relationship change with provenance: held (102 changes, 102 explained from the log alone, e.g. wrong > memory-recorded > relationship-changed)
- changed next action: held (athena: bless:evt-100-2444 before its first belief, bless:evt-178-4497 after (changed); hera: bless:evt-3-61 before its first belief, bless:evt-58-1366 after (changed))
- goal privacy: held (32 prompts checked against 0 goals: none carried another god's goal outside a told account or a perceived legend)
- petition privacy: held (32 prompts checked against 72 petitions: none listed a petition addressed to another god, and none carried one the god did not witness)
- god thread endings: FAILED (athena: no thread ending it caused left a persistent consequence; hades: 1 (fulfilled [evt-224-5673]); hephaestus: no thread ending it caused left a persistent consequence; hera: 2 (fulfilled [evt-41-928], fulfilled [evt-170-4289]); hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: no thread ending it caused left a persistent consequence)
- supplication and settlement: FAILED (3 supplications, 0 settlements, 0 refused or breached)
- thread endings recorded: held (3 threads: 3 ended with their parties remembering, 0 still open and inside their deadlines)
- no reopening without a new cause: held (0 settlements, 0 opened as linked successors on a newer cause, none reopened a closed matter on an old one)
- no-progress moves advance nothing: held (0 moves judged no progress, each leaving a refusal record and advancing no thread; no counter restated an earlier offer)
- consequence changes a later choice: FAILED (hades: a consequence at 6217, but no committed action on both sides of it; hera: bless: before the consequence, bless: after (same); the prompt behind it showed how the thread ended)
- obligated turns recorded: held (3 obligated turns, each with its recorded choice: 3 performed)
- contest endings: held (no contest was opened)
- alliances sealed by agreement: held (no alliance was formed)

Requests, in the order they ran (one at a time):

| # | God | Asked at tick | Applied at tick | Latency | Outcome | Prompt chars |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | athena | 1 | 14 | 12.6 s | answered | 5414 |
| 2 | hades | 14 | 21 | 6.5 s | answered | 3552 |
| 3 | hephaestus | 21 | 30 | 8.5 s | answered | 4856 |
| 4 | hera | 30 | 41 | 10.5 s | answered | 6740 |
| 5 | hermes | 41 | 50 | 8.5 s | answered | 6257 |
| 6 | hera | 50 | 54 | 3.4 s | answered | 6011 |
| 7 | poseidon | 54 | 66 | 11.7 s | answered | 7901 |
| 8 | zeus | 66 | 76 | 9.1 s | answered | 6925 |
| 9 | athena | 76 | 89 | 12.5 s | answered | 10494 |
| 10 | hades | 89 | 97 | 7.7 s | answered | 5812 |
| 11 | hephaestus | 97 | 103 | 5.0 s | answered | 5101 |
| 12 | hera | 103 | 110 | 6.0 s | answered | 6989 |
| 13 | hermes | 110 | 118 | 7.6 s | answered | 6434 |
| 14 | poseidon | 118 | 131 | 12.6 s | answered | 10126 |
| 15 | zeus | 131 | 136 | 4.6 s | answered | 5002 |
| 16 | athena | 136 | 149 | 12.8 s | answered | 10665 |
| 17 | hades | 149 | 154 | 4.5 s | answered | 3833 |
| 18 | hephaestus | 154 | 162 | 7.5 s | answered | 7299 |
| 19 | hera | 162 | 170 | 7.0 s | answered | 7439 |
| 20 | hermes | 170 | 178 | 7.2 s | answered | 6444 |
| 21 | hera | 178 | 183 | 4.3 s | answered | 6946 |
| 22 | poseidon | 183 | 194 | 10.7 s | answered | 9400 |
| 23 | zeus | 194 | 202 | 7.4 s | answered | 8205 |
| 24 | athena | 202 | 215 | 12.5 s | answered | 10140 |
| 25 | hades | 215 | 224 | 8.3 s | answered | 6010 |
| 26 | hephaestus | 224 | 236 | 11.4 s | answered | 9570 |
| 27 | hades | 236 | 241 | 4.2 s | answered | 5275 |
| 28 | hermes | 241 | 252 | 10.4 s | answered | 8482 |
| 29 | hera | 252 | 259 | 6.4 s | answered | 7352 |
| 30 | poseidon | 259 | 272 | 12.4 s | answered | 10370 |
| 31 | zeus | 272 | 281 | 8.1 s | answered | 9072 |
| 32 | athena | 281 | 295 | 13.4 s | answered | 10802 |
| 33 | hades | ≈295 | — | — | in flight at the end (inferred) | — |

Each god's turns (finished requests; the gap is the ticks between its request starts):

| God | Turns | Median gap (ticks) | p95 gap (ticks) | Worst gap (ticks) | Median latency |
| --- | --- | --- | --- | --- | --- |
| athena | 5 | 70.5 | 79 | 79 | 12.6 s |
| hades | 5 | 63 | 75 | 75 | 6.5 s |
| hephaestus | 4 | 70 | 76 | 76 | 8.0 s |
| hera | 6 | 53 | 74 | 74 | 6.2 s |
| hermes | 4 | 69 | 71 | 71 | 8.1 s |
| poseidon | 4 | 65 | 76 | 76 | 12.0 s |
| zeus | 4 | 65 | 78 | 78 | 7.8 s |

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

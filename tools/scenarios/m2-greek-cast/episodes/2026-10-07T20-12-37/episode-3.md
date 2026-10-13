# Episode 3 of 3

## Settings

- Recorded: 2026-10-07T20:27:48.161Z
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

1. **tick 6, Athena:** legend (ability-backed)
   - says: "I guide with counsel, as I always strive to do, and offer wisdom to those gathered here."
   - heard by: herdsman-damon, weaver-ismene, weaver-xenia, weaver-zoe
   - caused: legend-recorded (athena)
   - then: herdsman-damon now believes athena: "I guide with counsel, as I always strive to do, and offer wisdom to those gathered here."
   - then: weaver-ismene now believes athena: "I guide with counsel, as I always strive to do, and offer wisdom to those gathered here."
   - then: weaver-xenia now believes athena: "I guide with counsel, as I always strive to do, and offer wisdom to those gathered here."
   - then: weaver-zoe now believes athena: "I guide with counsel, as I always strive to do, and offer wisdom to those gathered here."
2. **tick 9, Hades:** travel → ferry-dock (context-backed)
   - caused: journey-started (hades)
3. **tick 13, Hephaestus:** strike → the-forge (ability-backed)
   - caused: resource-consumed (hephaestus); building-damaged (the-forge)
   - then: hephaestus, provisioner-nikanor, smith-brontes, smith-delia, smith-ktesias remember building-damaged
   - then: provisioner-nikanor → hephaestus: affinity -2
   - then: smith-brontes → hephaestus: affinity -2
   - then: smith-delia → hephaestus: affinity -2
   - then: smith-ktesias → hephaestus: affinity -2, grudge +1
4. **tick 20, Hera:** practice → offer evt-3-61 (context-backed)
   - caused: practice-opened (hera)
5. **tick 28, Hermes:** bless → evt-7-170 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: market-trader-iris → hermes: affinity +1
6. **tick 32, Hera:** bless → evt-3-61 (context-backed)
   - caused: resource-consumed (hera); blessing-granted (hera)
   - then: farmer → hera: affinity +1
7. **tick 40, Poseidon:** strike → fisher-dion (ability-backed)
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
8. **tick 45, Zeus:** bless → evt-5-109 (context-backed)
   - caused: resource-consumed (zeus); blessing-granted (zeus)
   - then: woodcutter → zeus: affinity +1
9. **tick 53, Athena:** bless → evt-38-904 (ability-backed)
   - caused: resource-consumed (athena); blessing-granted (athena)
   - then: farmer → athena: affinity +1
10. **tick 73, Hephaestus:** bless → evt-19-467 (ability-backed)
   - caused: resource-consumed (hephaestus); blessing-granted (hephaestus)
   - then: smith-ktesias → hephaestus: affinity +1
11. **tick 81, Hera:** strike → woodshed (ability-backed)
   - caused: resource-consumed (hera); building-damaged (woodshed)
   - then: farmer → hera: affinity +1
   - then: farmer, fisher-eleni, olive-grower-aristo, olive-grower-phoebe, woodcutter remember building-damaged
   - then: farmer → hera: affinity -2
   - then: fisher-eleni → hera: affinity -2
   - then: olive-grower-aristo → hera: affinity -2
   - then: olive-grower-phoebe → hera: affinity -2
   - then: woodcutter → hera: affinity -2, grudge +1
12. **tick 90, Hermes:** bless → evt-72-1789 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: fisher-dion → hermes: affinity +1
13. **tick 101, Poseidon:** bless → evt-84-2121 (context-backed)
   - caused: resource-consumed (poseidon); blessing-granted (poseidon)
   - then: ferryman → poseidon: affinity +1
14. **tick 105, Zeus:** bless → evt-84-2118 (context-backed)
   - caused: resource-consumed (zeus); blessing-granted (zeus)
   - then: woodcutter → zeus: affinity +1
15. **tick 117, Athena:** bless → evt-104-2644 (ability-backed)
   - caused: resource-consumed (athena); blessing-granted (athena)
   - then: smith-delia → athena: affinity +1
16. **tick 125, Hades:** bless → evt-52-1266 (context-backed)
   - caused: resource-consumed (hades); blessing-granted (hades)
   - then: woodcutter → hades: affinity +1
17. **tick 131, Hephaestus:** report → provisioner-nikanor (context-backed)
   - says: "You gathered a resource moments ago."
   - caused: report-told (hephaestus → provisioner-nikanor)
   - then: provisioner-nikanor now believes hephaestus: "You gathered a resource moments ago."
18. **tick 136, Hera:** bless → evt-58-1427 (context-backed)
   - caused: resource-consumed (hera); blessing-granted (hera)
   - then: ferryman → hera: affinity +1
19. **tick 147, Hermes:** bless → evt-110-2801 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: fisher-dion → hermes: affinity +1
20. **tick 161, Poseidon:** bless → evt-115-2938 (context-backed)
   - caused: resource-consumed (poseidon); blessing-granted (poseidon)
   - then: fisher-melina → poseidon: affinity +1
21. **tick 168, Zeus:** strike → olive-press (ability-backed)
   - caused: resource-consumed (zeus); building-damaged (olive-press)
   - then: woodcutter → zeus: affinity +1
   - then: athena, herdsman-damon, olive-grower-aristo, olive-grower-leon, weaver-ismene, weaver-xenia, weaver-zoe remember building-damaged
   - then: athena → zeus: affinity -2
   - then: herdsman-damon → zeus: affinity -2
   - then: olive-grower-aristo → zeus: affinity -2, grudge +1
   - then: olive-grower-leon → zeus: affinity -2
   - then: weaver-ismene → zeus: affinity -2
   - then: weaver-xenia → zeus: affinity -2
   - then: weaver-zoe → zeus: affinity -2
22. **tick 181, Athena:** bless → evt-153-4013 (ability-backed)
   - caused: resource-consumed (athena); blessing-granted (athena)
   - then: market-trader-iris → athena: affinity +1
23. **tick 202, Hephaestus:** bless → evt-160-4202 (ability-backed)
   - caused: resource-consumed (hephaestus); blessing-granted (hephaestus)
   - then: smith-ktesias → hephaestus: affinity +1
24. **tick 209, Hera:** practice → offer evt-151-3952 (context-backed)
   - caused: practice-opened (hera)
25. **tick 221, Hermes:** bless → evt-190-5008 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: smith-ktesias → hermes: affinity +1
26. **tick 226, Hera:** strike → olive-grower-leon (ability-backed)
   - caused: resource-consumed (hera); mortal-struck (olive-grower-leon)
   - then: farmer → hera: affinity +1
   - then: farmer, fisher-kallias, fisher-melina, market-trader-iris, olive-grower-aristo, olive-grower-leon, smith-ktesias, woodcutter remember mortal-struck
   - then: farmer → hera: affinity -2
   - then: fisher-kallias → hera: affinity -2
   - then: fisher-melina → hera: affinity -2
   - then: market-trader-iris → hera: affinity -2
   - then: olive-grower-aristo → hera: affinity -2
   - then: olive-grower-leon → hera: affinity -2, grudge +1
   - then: smith-ktesias → hera: affinity -2
   - then: woodcutter → hera: affinity -2
27. **tick 238, Poseidon:** bless → evt-196-5142 (context-backed)
   - caused: resource-consumed (poseidon); blessing-granted (poseidon)
   - then: ferryman → poseidon: affinity +1
28. **tick 243, Zeus:** bless → evt-138-3576 (context-backed)
   - caused: resource-consumed (zeus); blessing-granted (zeus)
   - then: fisher-melina → zeus: affinity +1
29. **tick 255, Athena:** bless → evt-173-4577 (ability-backed)
   - caused: resource-consumed (athena); blessing-granted (athena)
   - then: olive-grower-aristo → athena: affinity +1
30. **tick 268, Hades:** bless → evt-255-6751 (context-backed)
   - caused: resource-consumed (hades); blessing-granted (hades)
   - then: olive-grower-phoebe → hades: affinity +1
31. **tick 277, Hephaestus:** bless → evt-132-3436 (ability-backed)
   - caused: resource-consumed (hephaestus); blessing-granted (hephaestus)
   - then: smith-ktesias → hephaestus: affinity +1
32. **tick 283, Hera:** report → zeus (context-backed)
   - says: "You remember our oath, and I recall when the farmer honored their term to me in both [evt-33-796] and [evt-227-6007]."
   - caused: report-told (hera → zeus)
   - then: zeus now believes hera: "You remember our oath, and I recall when the farmer honored their term to me in both [evt-33-796] and [evt-227-6007]."
33. **tick 294, Hermes:** bless → evt-263-6955 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: fisher-stavros → hermes: affinity +1

## What the world did with every proposal

- dispositions: bless 22 × committed, strike 5 × committed, practice 2 × committed, report 2 × committed, legend 1 × committed, travel 1 × committed, practice 1 × insufficient-resources

1. Athena: legend → legend — committed: legend-recorded
2. Hades: travel → ferry-dock — committed: journey-started
3. Hephaestus: strike → the-forge — committed: resource-consumed, building-damaged
4. Hera: practice → offer evt-3-61 — committed: practice-opened
5. Hermes: bless → evt-7-170 — committed: resource-consumed, blessing-granted
6. Hera: bless → evt-3-61 — committed: resource-consumed, blessing-granted
7. Poseidon: strike → fisher-dion — committed: resource-consumed, mortal-struck
8. Zeus: bless → evt-5-109 — committed: resource-consumed, blessing-granted
9. Athena: bless → evt-38-904 — committed: resource-consumed, blessing-granted
10. Hephaestus: bless → evt-19-467 — committed: resource-consumed, blessing-granted
11. Hera: strike → woodshed — committed: resource-consumed, building-damaged
12. Hermes: bless → evt-72-1789 — committed: resource-consumed, blessing-granted
13. Poseidon: bless → evt-84-2121 — committed: resource-consumed, blessing-granted
14. Zeus: bless → evt-84-2118 — committed: resource-consumed, blessing-granted
15. Athena: bless → evt-104-2644 — committed: resource-consumed, blessing-granted
16. Hades: bless → evt-52-1266 — committed: resource-consumed, blessing-granted
17. Hephaestus: report → provisioner-nikanor — committed: report-told
18. Hera: bless → evt-58-1427 — committed: resource-consumed, blessing-granted
19. Hermes: bless → evt-110-2801 — committed: resource-consumed, blessing-granted
20. Poseidon: bless → evt-115-2938 — committed: resource-consumed, blessing-granted
21. Zeus: strike → olive-press — committed: resource-consumed, building-damaged
22. Athena: bless → evt-153-4013 — committed: resource-consumed, blessing-granted
23. Hades: practice → offer evt-172-4545 — rejected: insufficient-resources
24. Hephaestus: bless → evt-160-4202 — committed: resource-consumed, blessing-granted
25. Hera: practice → offer evt-151-3952 — committed: practice-opened
26. Hermes: bless → evt-190-5008 — committed: resource-consumed, blessing-granted
27. Hera: strike → olive-grower-leon — committed: resource-consumed, mortal-struck
28. Poseidon: bless → evt-196-5142 — committed: resource-consumed, blessing-granted
29. Zeus: bless → evt-138-3576 — committed: resource-consumed, blessing-granted
30. Athena: bless → evt-173-4577 — committed: resource-consumed, blessing-granted
31. Hades: bless → evt-255-6751 — committed: resource-consumed, blessing-granted
32. Hephaestus: bless → evt-132-3436 — committed: resource-consumed, blessing-granted
33. Hera: report → zeus — committed: report-told
34. Hermes: bless → evt-263-6955 — committed: resource-consumed, blessing-granted

## The episode's numbers

- Food: 85 "cannot get food" lines; 21 of 60 prayers are about food
- Troubles in a god's domain: Athena 3, Hades 3, Hephaestus 2, Hera 2, Hermes 2, Poseidon 2, Zeus 2
- Wrongs between mortals: 12; 9 between different patrons
  - [evt-1-23] fisher-dion (hermes) wronged fisher-kallias (poseidon): cheating; the victim prayed [evt-5-113]; punished
  - [evt-61-1520] woodcutter (zeus) wronged farmer (hera): feud; the victim prayed [evt-63-1550]; punished
  - [evt-141-3675] herdsman-damon (hermes) wronged weaver-ismene (athena): theft; the victim prayed [evt-152-3998]; no consequence yet
  - [evt-149-3901] olive-grower-leon (poseidon) wronged farmer (hera): unpaid-debt; the victim prayed [evt-151-3952]; punished
  - [evt-151-3973] olive-grower-aristo (athena) wronged woodcutter (zeus): unpaid-debt; the victim prayed [evt-153-4011]; punished
  - [evt-169-4462] fisher-dion (hermes) wronged ferryman (hades): cheating; the victim prayed [evt-172-4545]; no consequence yet
  - [evt-250-6623] olive-grower-leon (poseidon) wronged herdsman-damon (hermes): unpaid-debt; the victim prayed [evt-255-6756]; no consequence yet
  - [evt-268-7098] woodcutter (zeus) wronged fisher-kallias (poseidon): feud; the victim did not pray about it; no consequence yet
  - [evt-300-7912] fisher-dion (hermes) wronged fisher-kallias (poseidon): theft; the victim did not pray about it; no consequence yet
- Defections: 3
- From a prayer's cause to its closing: 41 closed (median 81 ticks, p95 153 ticks); by outcome answered 26, lapsed 15

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
- tick 7: market-trader-iris prayed to hermes: help with wine [evt-7-170] (routed to its patron)
- tick 9: fisher-kallias cannot get fish (no-buyer)
- tick 19: smith-ktesias prayed to hephaestus: help with the-forge [evt-19-467] (routed to its patron)
- tick 28: hermes blessed market-trader-iris: 2 wine
- tick 28: hermes answered market-trader-iris's prayer [evt-7-170]
- tick 28: market-trader-iris remembers hermes's answer
- tick 28: market-trader-iris → hermes: affinity +1
- tick 32: hera blessed farmer: 2 planks
- tick 32: hera's boon to farmer was seen given [evt-20-473] (evt-32-746)
- tick 32: hera answered farmer's prayer [evt-3-61]
- tick 32: farmer remembers hera's answer
- tick 32: farmer → hera: affinity +1
- tick 36: a tool-flaw in athena's domain (spring, the god's floor) took 1 tools of farmer [evt-36-877]
- tick 37: woodcutter cannot get food (no-seller)
- tick 38: farmer prayed to athena: help with tools [evt-38-904] (a trouble in the god's domain: routed to the domain god)
- tick 40: poseidon struck fisher-dion and took 1 food [evt-40-949]
- tick 40: poseidon answered fisher-kallias's prayer [evt-5-113]
- tick 40: fisher-kallias remembers poseidon's answer
- tick 40: fisher-kallias → poseidon: affinity +1
- tick 41: fisher-dion cannot get food (no-seller)
- tick 41: fisher-dion cannot get fish (no-buyer)
- tick 42: fisher-dion prayed to hermes: help with food [evt-42-1030] (routed to its patron)
- tick 45: zeus blessed woodcutter: 2 food
- tick 45: fisher-melina cannot get food (no-funds)
- tick 45: zeus answered woodcutter's prayer [evt-5-109]
- tick 45: woodcutter remembers zeus's answer
- tick 45: woodcutter → zeus: affinity +1
- tick 46: olive-grower-leon cannot get food (no-funds)
- tick 48: olive-grower-leon prayed to poseidon: help with food [evt-48-1176] (routed to its patron)
- tick 48: fisher-kallias cannot get food (no-funds)
- tick 48: olive-grower-aristo cannot get food (no-funds)
- tick 49: olive-grower-phoebe cannot get food (no-funds)
- tick 50: a hoard-swallowed in hades's domain (spring, the god's floor) took 2 currency of woodcutter [evt-50-1237]
- tick 50: olive-grower-aristo cannot get food (no-funds)
- tick 51: olive-grower-phoebe cannot get food (no-funds)
- tick 52: woodcutter prayed to hades: help with currency [evt-52-1266] (a trouble in the god's domain: routed to the domain god)
- tick 52: olive-grower-aristo cannot get olives (no-buyer)
- tick 53: athena blessed farmer: 1 tools
- tick 53: olive-grower-aristo prayed to athena: help with olives [evt-53-1300] (routed to its patron)
- tick 53: olive-grower-phoebe prayed to athena: help with food [evt-53-1301] (routed to its patron)
- tick 53: fisher-dion cannot get fish (no-buyer)
- tick 53: olive-grower-leon cannot get olives (no-buyer)
- tick 53: athena answered farmer's prayer [evt-38-904]
- tick 53: farmer remembers athena's answer
- tick 53: farmer → athena: affinity +1
- tick 54: fisher-kallias cannot get fish (no-buyer)
- tick 54: fisher-melina cannot get fish (no-buyer)
- tick 54: fisher-stavros cannot get fish (no-buyer)
- tick 54: fisher-eleni cannot get fish (no-buyer)
- tick 55: a roof-leak in hera's domain (spring, the god's floor) took 2 food of ferryman [evt-55-1369]
- tick 55: fisher-eleni cannot get food (no-seller)
- tick 56: fisher-kallias prayed to poseidon: help with fish [evt-56-1378] (routed to its patron)
- tick 56: fisher-melina prayed to poseidon: help with fish [evt-56-1379] (routed to its patron)
- tick 56: fisher-stavros prayed to poseidon: help with fish [evt-56-1380] (routed to its patron)
- tick 56: fisher-eleni prayed to athena: help with food [evt-56-1381] (routed to its patron)
- tick 57: olive-grower-leon cannot get olives (no-buyer)
- tick 58: ferryman prayed to hera: help with food [evt-58-1427] (a trouble in the god's domain: routed to the domain god)
- tick 58: fisher-melina cannot get fish (no-buyer)
- tick 58: fisher-stavros cannot get fish (no-buyer)
- tick 58: fisher-eleni cannot get food (no-seller)
- tick 58: fisher-eleni cannot get fish (no-buyer)
- tick 58: olive-grower-phoebe cannot get olives (no-buyer)
- tick 60: fisher-kallias cannot get fish (no-buyer)
- tick 60: olive-grower-aristo cannot get olives (no-buyer)
- tick 61: woodcutter wronged farmer: feud of 2 food; quarrelsome, not in need [evt-61-1520]
- tick 62: market-trader-iris cannot get wine (no-buyer)
- tick 63: farmer prayed to hera: punish woodcutter, who owns woodshed [evt-63-1550] (routed to its patron)
- tick 66: olive-grower-leon cannot get food (no-funds)
- tick 67: a tool-flaw in athena's domain (spring, the season's odds) took 2 tools of smith-delia [evt-67-1665]
- tick 67: fisher-kallias cannot get fish (no-buyer)
- tick 67: fisher-melina cannot get fish (no-buyer)
- tick 67: fisher-stavros cannot get fish (no-buyer)
- tick 67: fisher-eleni cannot get fish (no-buyer)
- tick 68: olive-grower-aristo cannot get food (no-funds)
- tick 69: fisher-dion cannot get food (no-seller)
- tick 69: olive-grower-phoebe cannot get food (no-funds)
- tick 69: weaver-zoe cannot get wool (no-buyer)
- tick 69: weaver-xenia cannot get wool (no-buyer)
- tick 70: weaver-ismene cannot get wool (no-buyer)
- tick 71: fisher-kallias cannot get fish (no-buyer)
- tick 71: fisher-melina cannot get fish (no-buyer)
- tick 71: fisher-stavros cannot get fish (no-buyer)
- tick 71: fisher-eleni cannot get fish (no-buyer)
- tick 71: fisher-dion cannot get fish (no-buyer)
- tick 71: weaver-zoe cannot get wool (no-buyer)
- tick 71: weaver-xenia cannot get wool (no-buyer)
- tick 72: fisher-dion prayed to hermes: help with fish [evt-72-1789] (routed to its patron)
- tick 72: olive-grower-leon cannot get olives (no-buyer)
- tick 72: weaver-ismene cannot get wool (no-buyer)
- tick 73: hephaestus blessed smith-ktesias: 3 planks for the-forge
- tick 73: olive-grower-leon cannot get food (no-seller)
- tick 73: weaver-zoe cannot get wool (no-buyer)
- tick 73: hephaestus answered smith-ktesias's prayer [evt-19-467]
- tick 73: smith-ktesias remembers hephaestus's answer
- tick 73: smith-ktesias → hephaestus: affinity +1
- tick 75: weaver-ismene cannot get wool (no-buyer)
- tick 75: weaver-xenia cannot get wool (no-buyer)
- tick 76: weaver-zoe cannot get wool (no-buyer)
- tick 76: smith-delia cannot get food (no-seller)
- tick 78: olive-grower-leon cannot get olives (no-buyer)
- tick 78: weaver-zoe cannot get wool (no-buyer)
- tick 79: olive-grower-leon prayed to poseidon: help with olives [evt-79-1980] (routed to its patron)
- tick 79: weaver-ismene cannot get wool (no-buyer)
- tick 79: weaver-xenia cannot get wool (no-buyer)
- tick 80: fisher-dion cannot get fish (no-buyer)
- tick 80: olive-grower-leon cannot get olives (no-buyer)
- tick 80: weaver-zoe cannot get wool (no-buyer)
- tick 81: smith-delia prayed to athena: help with food [evt-81-2042] (routed to its patron)
- tick 81: a harbour-surge in poseidon's domain (spring, the god's floor) damaged fish-landing of ferryman [evt-81-2046]
- tick 81: weaver-ismene cannot get wool (no-buyer)
- tick 81: weaver-xenia cannot get wool (no-buyer)
- tick 81: hera answered farmer's prayer [evt-63-1550]
- tick 81: farmer remembers hera's answer
- tick 81: farmer → hera: affinity +1
- tick 82: market-trader-iris cannot get wine (no-buyer)
- tick 83: market-trader-iris prayed to hermes: help with wine [evt-83-2097] (routed to its patron)
- tick 84: woodcutter prayed to zeus: help with woodshed [evt-84-2118] (routed to its patron)
- tick 84: ferryman prayed to poseidon: help with fish-landing [evt-84-2121] (a trouble in the god's domain: routed to the domain god)
- tick 85: fisher-melina cannot get food (no-seller)
- tick 85: weaver-ismene cannot get wool (no-buyer)
- tick 85: weaver-zoe cannot get wool (no-buyer)
- tick 85: weaver-xenia cannot get wool (no-buyer)
- tick 87: olive-grower-leon cannot get food (no-seller)
- tick 87: weaver-ismene cannot get wool (no-buyer)
- tick 87: weaver-zoe cannot get wool (no-buyer)
- tick 87: weaver-xenia cannot get wool (no-buyer)
- tick 90: hermes blessed fisher-dion: 2 fish
- tick 90: hermes answered fisher-dion's prayer [evt-72-1789]
- tick 90: fisher-dion remembers hermes's answer
- tick 90: fisher-dion → hermes: affinity +1
- tick 91: fisher-kallias cannot get fish (no-buyer)
- tick 91: fisher-stavros cannot get fish (no-buyer)
- tick 91: fisher-dion cannot get fish (no-buyer)
- tick 91: olive-grower-leon cannot get olives (no-buyer)
- tick 93: weaver-zoe cannot get wool (no-buyer)
- tick 95: weaver-ismene cannot get wool (no-buyer)
- tick 95: weaver-xenia cannot get wool (no-buyer)
- tick 96: weaver-zoe cannot get wool (no-buyer)
- tick 98: weaver-zoe cannot get wool (no-buyer)
- tick 99: weaver-ismene cannot get wool (no-buyer)
- tick 99: weaver-xenia cannot get wool (no-buyer)
- tick 100: weaver-zoe cannot get wool (no-buyer)
- tick 101: poseidon blessed ferryman: 3 planks for fish-landing
- tick 101: weaver-ismene cannot get wool (no-buyer)
- tick 101: weaver-xenia cannot get wool (no-buyer)
- tick 101: poseidon answered ferryman's prayer [evt-84-2121]
- tick 101: ferryman remembers poseidon's answer
- tick 101: ferryman → poseidon: affinity +1
- tick 103: smith-delia cannot get food (no-seller)
- tick 104: smith-delia prayed to athena: help with tools [evt-104-2644] (a trouble in the god's domain: routed to the domain god)
- tick 105: zeus blessed woodcutter: 3 planks for woodshed
- tick 105: weaver-ismene cannot get wool (no-buyer)
- tick 105: weaver-zoe cannot get wool (no-buyer)
- tick 105: weaver-xenia cannot get wool (no-buyer)
- tick 105: zeus answered woodcutter's prayer [evt-84-2118]
- tick 105: woodcutter remembers zeus's answer
- tick 105: woodcutter → zeus: affinity +1
- tick 106: olive-grower-leon cannot get food (no-funds)
- tick 107: fisher-melina cannot get fish (no-buyer)
- tick 107: fisher-dion cannot get fish (no-buyer)
- tick 107: weaver-ismene cannot get wool (no-buyer)
- tick 107: weaver-zoe cannot get wool (no-buyer)
- tick 107: weaver-xenia cannot get wool (no-buyer)
- tick 108: olive-grower-aristo cannot get food (no-funds)
- tick 109: fisher-dion cannot get food (no-seller)
- tick 109: weaver-ismene cannot get wool (no-buyer)
- tick 109: weaver-zoe cannot get wool (no-buyer)
- tick 109: weaver-xenia cannot get wool (no-buyer)
- tick 110: fisher-dion prayed to hermes: help with food [evt-110-2801] (routed to its patron)
- tick 110: olive-grower-aristo cannot get food (no-funds)
- tick 111: fisher-kallias cannot get fish (no-buyer)
- tick 111: fisher-stavros cannot get fish (no-buyer)
- tick 111: weaver-ismene cannot get wool (no-buyer)
- tick 111: weaver-zoe cannot get wool (no-buyer)
- tick 111: weaver-xenia cannot get wool (no-buyer)
- tick 112: olive-grower-aristo prayed to athena: help with food [evt-112-2858] (routed to its patron)
- tick 112: a lightning-fire in zeus's domain (spring, the god's floor) took 1 food of fisher-melina [evt-112-2871]
- tick 112: fisher-dion cannot get fish (no-buyer)
- tick 113: weaver-ismene cannot get wool (no-buyer)
- tick 113: weaver-zoe cannot get wool (no-buyer)
- tick 114: fisher-kallias cannot get fish (no-buyer)
- tick 114: fisher-melina cannot get food (no-seller)
- tick 114: fisher-melina cannot get fish (no-buyer)
- tick 114: fisher-stavros cannot get fish (no-buyer)
- tick 114: fisher-dion cannot get fish (no-buyer)
- tick 115: fisher-melina prayed to poseidon: help with food [evt-115-2938] (routed to its patron)
- tick 115: weaver-xenia cannot get wool (no-buyer)
- tick 116: market-trader-iris cannot get food (no-funds)
- tick 116: fisher-eleni cannot get fish (no-buyer)
- tick 117: athena blessed smith-delia: 2 tools
- tick 117: a dig-collapse in hades's domain (spring, the season's odds) took 1 ore of smith-ktesias [evt-117-3005]
- tick 117: olive-grower-aristo cannot get olives (no-buyer)
- tick 117: weaver-xenia cannot get wool (no-buyer)
- tick 117: athena answered smith-delia's prayer [evt-104-2644]
- tick 117: smith-delia remembers athena's answer
- tick 117: smith-delia → athena: affinity +1
- tick 118: fisher-eleni prayed to athena: help with fish [evt-118-3022] (routed to its patron)
- tick 118: weaver-ismene cannot get wool (no-buyer)
- tick 118: weaver-zoe cannot get wool (no-buyer)
- tick 119: fisher-kallias cannot get fish (no-buyer)
- tick 119: fisher-melina cannot get fish (no-buyer)
- tick 119: fisher-stavros cannot get fish (no-buyer)
- tick 119: fisher-dion cannot get fish (no-buyer)
- tick 119: weaver-xenia cannot get wool (no-buyer)
- tick 120: weaver-ismene cannot get wool (no-buyer)
- tick 120: weaver-zoe cannot get wool (no-buyer)
- tick 120: the director made fisher-kallias take 16 tools from smith-ktesias
- tick 121: weaver-xenia cannot get wool (no-buyer)
- tick 122: weaver-ismene cannot get wool (no-buyer)
- tick 124: a forge-flare in hephaestus's domain (spring, the god's floor) damaged the-forge of smith-ktesias [evt-124-3209]
- tick 124: fisher-eleni cannot get fish (no-buyer)
- tick 124: weaver-zoe cannot get wool (no-buyer)
- tick 125: hades blessed woodcutter: 2 currency
- tick 125: weaver-ismene cannot get wool (no-buyer)
- tick 125: weaver-xenia cannot get wool (no-buyer)
- tick 125: hades answered woodcutter's prayer [evt-52-1266]
- tick 125: woodcutter remembers hades's answer
- tick 125: woodcutter → hades: affinity +1
- tick 126: weaver-zoe cannot get wool (no-buyer)
- tick 127: fisher-kallias cannot get fish (no-buyer)
- tick 127: fisher-melina cannot get fish (no-buyer)
- tick 127: fisher-stavros cannot get fish (no-buyer)
- tick 127: fisher-eleni cannot get fish (no-buyer)
- tick 127: fisher-dion cannot get fish (no-buyer)
- tick 127: weaver-ismene cannot get wool (no-buyer)
- tick 127: weaver-xenia cannot get wool (no-buyer)
- tick 128: weaver-zoe cannot get wool (no-buyer)
- tick 129: market-trader-iris cannot get wine (no-buyer)
- tick 129: olive-grower-phoebe cannot get food (no-funds)
- tick 129: weaver-ismene cannot get wool (no-buyer)
- tick 129: weaver-xenia cannot get wool (no-buyer)
- tick 130: weaver-zoe cannot get wool (no-buyer)
- tick 131: fisher-kallias cannot get fish (no-buyer)
- tick 131: fisher-melina cannot get fish (no-buyer)
- tick 131: fisher-stavros cannot get fish (no-buyer)
- tick 131: fisher-eleni cannot get fish (no-buyer)
- tick 131: fisher-dion cannot get fish (no-buyer)
- tick 131: olive-grower-phoebe cannot get food (no-funds)
- tick 131: weaver-ismene cannot get wool (no-buyer)
- tick 131: weaver-xenia cannot get wool (no-buyer)
- tick 131: smith-ktesias cannot get food (no-seller)
- tick 132: smith-ktesias prayed to hephaestus: help with food [evt-132-3436] (routed to its patron)
- tick 132: weaver-zoe cannot get wool (no-buyer)
- tick 133: weaver-ismene cannot get wool (no-buyer)
- tick 134: olive-grower-phoebe cannot get food (no-funds)
- tick 135: fisher-dion cannot get fish (no-buyer)
- tick 136: hera blessed ferryman: 2 food
- tick 136: market-trader-iris cannot get food (no-funds)
- tick 136: hera answered ferryman's prayer [evt-58-1427]
- tick 136: ferryman remembers hera's answer
- tick 136: ferryman → hera: affinity +1
- tick 137: fisher-dion prayed to hermes: help with fish [evt-137-3554] (routed to its patron)
- tick 137: fisher-melina cannot get fish (no-buyer)
- tick 138: fisher-melina prayed to zeus: help with food [evt-138-3576] (a trouble in the god's domain: routed to the domain god)
- tick 138: weaver-ismene cannot get wool (no-buyer)
- tick 138: weaver-zoe cannot get wool (no-buyer)
- tick 138: weaver-xenia cannot get wool (no-buyer)
- tick 139: a crossing-loss in hermes's domain (spring, the god's floor) took 2 fish of olive-grower-phoebe [evt-139-3619]
- tick 140: fisher-dion cannot get fish (no-buyer)
- tick 140: weaver-ismene cannot get wool (no-buyer)
- tick 140: weaver-zoe cannot get wool (no-buyer)
- tick 140: weaver-xenia cannot get wool (no-buyer)
- tick 141: herdsman-damon wronged weaver-ismene: theft of 2 cloth; greedy, not in need [evt-141-3675]
- tick 141: olive-grower-phoebe cannot get food (no-seller)
- tick 142: olive-grower-phoebe prayed to hermes: help with fish [evt-142-3705] (a trouble in the god's domain: routed to the domain god)
- tick 142: fisher-kallias cannot get fish (no-buyer)
- tick 142: fisher-stavros cannot get fish (no-buyer)
- tick 142: fisher-eleni cannot get fish (no-buyer)
- tick 142: fisher-dion cannot get fish (no-buyer)
- tick 142: weaver-xenia cannot get wool (no-buyer)
- tick 144: olive-grower-phoebe cannot get food (no-funds)
- tick 144: weaver-xenia cannot get wool (no-buyer)
- tick 145: weaver-zoe cannot get wool (no-buyer)
- tick 146: fisher-melina cannot get fish (no-buyer)
- tick 147: hermes blessed fisher-dion: 2 food
- tick 147: market-trader-iris cannot get wine (no-buyer)
- tick 147: olive-grower-phoebe cannot get olives (no-buyer)
- tick 147: hermes answered fisher-dion's prayer [evt-110-2801]
- tick 147: fisher-dion remembers hermes's answer
- tick 147: fisher-dion → hermes: affinity +1
- tick 148: fisher-kallias cannot get fish (no-buyer)
- tick 148: fisher-melina cannot get fish (no-buyer)
- tick 148: fisher-stavros cannot get fish (no-buyer)
- tick 148: fisher-eleni cannot get fish (no-buyer)
- tick 148: fisher-dion cannot get fish (no-buyer)
- tick 149: olive-grower-leon wronged farmer: unpaid-debt of 3 currency; quarrelsome, in need; the credit [evt-49-1211] failed [evt-149-3901]
- tick 150: a tool-flaw in athena's domain (spring, the god's floor) took 2 tools of market-trader-iris [evt-150-3941]
- tick 150: woodcutter cannot get wood (no-buyer)
- tick 150: fisher-kallias cannot get fish (no-buyer)
- tick 150: fisher-melina cannot get fish (no-buyer)
- tick 150: fisher-stavros cannot get fish (no-buyer)
- tick 150: fisher-eleni cannot get fish (no-buyer)
- tick 150: fisher-dion cannot get fish (no-buyer)
- tick 151: farmer prayed to hera: punish olive-grower-leon, who owns  [evt-151-3952] (routed to its patron)
- tick 151: olive-grower-aristo wronged woodcutter: unpaid-debt of 3 currency; greedy, in need; the credit [evt-51-1263] failed [evt-151-3973]
- tick 152: weaver-ismene prayed to athena: punish herdsman-damon, who owns  [evt-152-3998] (routed to its patron)
- tick 152: market-trader-iris cannot get wine (no-buyer)
- tick 153: woodcutter prayed to zeus: punish olive-grower-aristo, who owns olive-press [evt-153-4011] (routed to its patron)
- tick 153: market-trader-iris prayed to athena: help with tools [evt-153-4013] (a trouble in the god's domain: routed to the domain god)
- tick 154: olive-grower-phoebe wronged fisher-eleni: unpaid-debt of 3 currency; honest, in need; the credit [evt-54-1341] failed [evt-154-4055]
- tick 156: market-trader-iris cannot get food (no-funds)
- tick 156: fisher-eleni cannot get fish (no-buyer)
- tick 157: market-trader-iris cannot get wine (no-buyer)
- tick 158: fisher-eleni prayed to athena: punish olive-grower-phoebe, who owns  [evt-158-4147] (routed to its patron)
- tick 158: weaver-ismene cannot get food (no-seller)
- tick 160: smith-ktesias prayed to hephaestus: help with the-forge [evt-160-4202] (a trouble in the god's domain: routed to the domain god)
- tick 161: poseidon blessed fisher-melina: 2 food
- tick 161: poseidon answered fisher-melina's prayer [evt-115-2938]
- tick 161: fisher-melina remembers poseidon's answer
- tick 161: fisher-melina → poseidon: affinity +1
- tick 164: fisher-eleni cannot get fish (no-buyer)
- tick 165: weaver-ismene cannot get wool (no-buyer)
- tick 165: weaver-zoe cannot get wool (no-buyer)
- tick 165: weaver-xenia cannot get wool (no-buyer)
- tick 166: fisher-kallias cannot get fish (no-buyer)
- tick 166: fisher-melina cannot get fish (no-buyer)
- tick 166: fisher-stavros cannot get fish (no-buyer)
- tick 166: fisher-eleni cannot get fish (no-buyer)
- tick 166: fisher-dion cannot get fish (no-buyer)
- tick 166: olive-grower-leon cannot get food (no-funds)
- tick 167: market-trader-iris cannot get wine (no-buyer)
- tick 167: weaver-ismene cannot get wool (no-buyer)
- tick 167: weaver-zoe cannot get wool (no-buyer)
- tick 167: weaver-xenia cannot get wool (no-buyer)
- tick 168: olive-grower-aristo cannot get food (no-funds)
- tick 168: zeus answered woodcutter's prayer [evt-153-4011]
- tick 168: woodcutter remembers zeus's answer
- tick 168: woodcutter → zeus: affinity +1
- tick 169: fisher-dion wronged ferryman: cheating of 2 currency; greedy, in need [evt-169-4462]
- tick 169: olive-grower-phoebe cannot get food (no-funds)
- tick 169: weaver-ismene cannot get wool (no-buyer)
- tick 169: weaver-zoe cannot get wool (no-buyer)
- tick 169: weaver-xenia cannot get wool (no-buyer)
- tick 170: fisher-kallias wronged fisher-stavros: theft of 2 tools; greedy, in need [evt-170-4499]
- tick 170: fisher-stavros cannot get food (no-seller)
- tick 171: weaver-ismene cannot get wool (no-buyer)
- tick 171: weaver-zoe cannot get wool (no-buyer)
- tick 171: weaver-xenia cannot get wool (no-buyer)
- tick 172: ferryman prayed to hades: punish fisher-dion, who owns  [evt-172-4545] (routed to its patron)
- tick 172: olive-grower-aristo cannot get olives (no-buyer)
- tick 173: olive-grower-aristo prayed to athena: help with olive-press [evt-173-4577] (routed to its patron)
- tick 173: weaver-ismene cannot get wool (no-buyer)
- tick 173: weaver-zoe cannot get wool (no-buyer)
- tick 175: weaver-xenia cannot get wool (no-buyer)
- tick 176: market-trader-iris cannot get food (no-funds)
- tick 177: weaver-xenia cannot get wool (no-buyer)
- tick 178: weaver-ismene cannot get wool (no-buyer)
- tick 178: weaver-zoe cannot get wool (no-buyer)
- tick 179: weaver-xenia cannot get wool (no-buyer)
- tick 180: olive-grower-aristo cannot get food (no-seller)
- tick 180: olive-grower-aristo cannot get olives (no-buyer)
- tick 180: weaver-ismene cannot get wool (no-buyer)
- tick 180: weaver-zoe cannot get wool (no-buyer)
- tick 181: athena blessed market-trader-iris: 2 tools
- tick 181: weaver-xenia cannot get wool (no-buyer)
- tick 181: athena answered market-trader-iris's prayer [evt-153-4013]
- tick 181: market-trader-iris remembers athena's answer
- tick 181: market-trader-iris → athena: affinity +1
- tick 182: fisher-kallias cannot get fish (no-buyer)
- tick 182: fisher-melina cannot get fish (no-buyer)
- tick 182: fisher-eleni cannot get fish (no-buyer)
- tick 182: fisher-dion cannot get fish (no-buyer)
- tick 184: olive-grower-aristo cannot get olives (no-buyer)
- tick 184: olive-grower-leon cannot get olives (no-buyer)
- tick 188: olive-grower-aristo cannot get food (no-funds)
- tick 190: smith-ktesias prayed to hermes: help with tools [evt-190-5008] (not its authored patron (a defection or a domain))
- tick 191: a harbour-surge in poseidon's domain (spring, the god's floor) damaged fish-landing of ferryman [evt-191-5036]
- tick 191: fisher-kallias cannot get fish (no-buyer)
- tick 191: fisher-melina cannot get fish (no-buyer)
- tick 191: fisher-eleni cannot get fish (no-buyer)
- tick 191: fisher-dion cannot get fish (no-buyer)
- tick 191: smith-ktesias cannot get food (no-seller)
- tick 192: hades's offer was refused (insufficient-resources)
- tick 193: fisher-dion's prayer to hermes lapsed unanswered [evt-42-1030]
- tick 193: fisher-dion remembers hermes's silence
- tick 193: fisher-dion → hermes: affinity -2, grudge +1
- tick 196: ferryman prayed to poseidon: help with fish-landing [evt-196-5142] (a trouble in the god's domain: routed to the domain god)
- tick 196: market-trader-iris cannot get food (no-funds)
- tick 197: olive-grower-aristo cannot get olives (no-buyer)
- tick 197: olive-grower-leon cannot get olives (no-buyer)
- tick 198: a hoard-swallowed in hades's domain (spring, the god's floor) took 2 currency of olive-grower-phoebe [evt-198-5210]
- tick 198: a vanished-goods in hermes's domain (spring, the god's floor) took 2 fish of fisher-stavros [evt-198-5211]
- tick 199: olive-grower-leon's prayer to poseidon lapsed unanswered [evt-48-1176]
- tick 199: olive-grower-leon remembers poseidon's silence
- tick 199: olive-grower-leon → poseidon: affinity -2, grudge +1
- tick 200: the season turned from spring to summer
- tick 202: hephaestus blessed smith-ktesias: 3 planks for the-forge
- tick 202: olive-grower-phoebe cannot get olives (no-buyer)
- tick 202: hephaestus answered smith-ktesias's prayer [evt-160-4202]
- tick 202: smith-ktesias remembers hephaestus's answer
- tick 202: smith-ktesias → hephaestus: affinity +1
- tick 203: olive-grower-phoebe prayed to athena: help with olives [evt-203-5326] (routed to its patron)
- tick 204: olive-grower-aristo's prayer to athena lapsed unanswered [evt-53-1300]
- tick 204: olive-grower-phoebe's prayer to athena lapsed unanswered [evt-53-1301]
- tick 204: olive-grower-aristo remembers athena's silence
- tick 204: olive-grower-phoebe remembers athena's silence
- tick 204: olive-grower-aristo → athena: affinity -2, grudge +1
- tick 204: olive-grower-phoebe → athena: affinity -2, grudge +1
- tick 205: weaver-ismene cannot get wool (no-buyer)
- tick 205: weaver-zoe cannot get wool (no-buyer)
- tick 206: olive-grower-leon cannot get food (no-funds)
- tick 206: weaver-xenia cannot get wool (no-buyer)
- tick 207: a cracked-tools in hephaestus's domain (summer, the god's floor) took 2 tools of fisher-kallias [evt-207-5450]
- tick 207: fisher-kallias cannot get fish (no-buyer)
- tick 207: fisher-melina cannot get fish (no-buyer)
- tick 207: fisher-eleni cannot get fish (no-buyer)
- tick 207: fisher-dion cannot get fish (no-buyer)
- tick 207: weaver-ismene cannot get wool (no-buyer)
- tick 207: weaver-zoe cannot get wool (no-buyer)
- tick 207: fisher-kallias's prayer to poseidon lapsed unanswered [evt-56-1378]
- tick 207: fisher-melina's prayer to poseidon lapsed unanswered [evt-56-1379]
- tick 207: fisher-stavros's prayer to poseidon lapsed unanswered [evt-56-1380]
- tick 207: fisher-eleni's prayer to athena lapsed unanswered [evt-56-1381]
- tick 207: fisher-kallias remembers poseidon's silence
- tick 207: fisher-melina remembers poseidon's silence
- tick 207: fisher-stavros remembers poseidon's silence
- tick 207: fisher-eleni remembers athena's silence
- tick 207: fisher-kallias → poseidon: affinity -2, grudge +1
- tick 207: fisher-melina → poseidon: affinity -2, grudge +1
- tick 207: fisher-stavros → poseidon: affinity -2, grudge +1
- tick 207: fisher-eleni → athena: affinity -2, grudge +1
- tick 208: olive-grower-aristo cannot get food (no-funds)
- tick 208: olive-grower-leon cannot get food (no-funds)
- tick 208: weaver-xenia cannot get wool (no-buyer)
- tick 209: olive-grower-phoebe cannot get food (no-seller)
- tick 209: weaver-ismene cannot get wool (no-buyer)
- tick 209: weaver-zoe cannot get wool (no-buyer)
- tick 210: fisher-stavros cannot get food (no-seller)
- tick 210: fisher-stavros cannot get fish (no-buyer)
- tick 211: fisher-stavros prayed to poseidon: help with food [evt-211-5566] (routed to its patron)
- tick 211: fisher-eleni cannot get fish (no-buyer)
- tick 211: fisher-dion cannot get fish (no-buyer)
- tick 212: olive-grower-phoebe cannot get olives (no-buyer)
- tick 216: market-trader-iris cannot get food (no-funds)
- tick 216: weaver-xenia cannot get wool (no-buyer)
- tick 217: fisher-stavros cannot get fish (no-buyer)
- tick 218: weaver-xenia cannot get wool (no-buyer)
- tick 219: fisher-stavros cannot get fish (no-buyer)
- tick 219: fisher-eleni cannot get fish (no-buyer)
- tick 219: fisher-dion cannot get fish (no-buyer)
- tick 219: weaver-ismene cannot get wool (no-buyer)
- tick 219: weaver-zoe cannot get wool (no-buyer)
- tick 220: weaver-xenia cannot get wool (no-buyer)
- tick 220: smith-ktesias cannot get food (no-seller)
- tick 221: hermes blessed smith-ktesias: 4 tools
- tick 221: smith-ktesias prayed to hades: help with ore [evt-221-5822] (a trouble in the god's domain: routed to the domain god)
- tick 221: weaver-ismene cannot get wool (no-buyer)
- tick 221: weaver-zoe cannot get wool (no-buyer)
- tick 221: hermes answered smith-ktesias's prayer [evt-190-5008]
- tick 221: smith-ktesias remembers hermes's answer
- tick 221: smith-ktesias → hermes: affinity +1
- tick 222: weaver-xenia cannot get wool (no-buyer)
- tick 223: weaver-ismene cannot get wool (no-buyer)
- tick 225: weaver-zoe cannot get wool (no-buyer)
- tick 226: hera struck olive-grower-leon and took 2 cloth [evt-226-5932]
- tick 226: weaver-ismene cannot get wool (no-buyer)
- tick 226: weaver-xenia cannot get wool (no-buyer)
- tick 226: hera's boon to farmer was seen given [evt-209-5501] (evt-226-5932)
- tick 226: hera answered farmer's prayer [evt-151-3952]
- tick 226: farmer remembers hera's answer
- tick 226: farmer → hera: affinity +1
- tick 227: olive-grower-leon cannot get food (no-seller)
- tick 227: olive-grower-leon cannot get olives (no-buyer)
- tick 227: weaver-zoe cannot get wool (no-buyer)
- tick 228: olive-grower-leon prayed to poseidon: help with cloth [evt-228-6031] (routed to its patron)
- tick 228: olive-grower-phoebe cannot get olives (no-buyer)
- tick 228: weaver-ismene cannot get wool (no-buyer)
- tick 228: weaver-xenia cannot get wool (no-buyer)
- tick 229: olive-grower-phoebe cannot get food (no-seller)
- tick 229: weaver-zoe cannot get wool (no-buyer)
- tick 230: olive-grower-phoebe prayed to athena: help with food [evt-230-6084] (routed to its patron)
- tick 230: weaver-ismene cannot get wool (no-buyer)
- tick 230: weaver-xenia cannot get wool (no-buyer)
- tick 230: olive-grower-leon's prayer to poseidon lapsed unanswered [evt-79-1980]
- tick 230: olive-grower-leon remembers poseidon's silence
- tick 230: olive-grower-leon → poseidon: affinity -2, grudge +1
- tick 231: fisher-stavros cannot get fish (no-buyer)
- tick 231: fisher-eleni cannot get fish (no-buyer)
- tick 231: fisher-dion cannot get fish (no-buyer)
- tick 231: weaver-zoe cannot get wool (no-buyer)
- tick 232: olive-grower-leon cannot get food (no-seller)
- tick 232: olive-grower-leon cannot get olives (no-buyer)
- tick 232: weaver-ismene cannot get wool (no-buyer)
- tick 232: weaver-xenia cannot get wool (no-buyer)
- tick 232: smith-delia's prayer to athena lapsed unanswered [evt-81-2042]
- tick 232: smith-delia remembers athena's silence
- tick 232: smith-delia → athena: affinity -2, grudge +1
- tick 233: weaver-zoe cannot get wool (no-buyer)
- tick 234: market-trader-iris's prayer to hermes lapsed unanswered [evt-83-2097]
- tick 234: market-trader-iris remembers hermes's silence
- tick 234: market-trader-iris → hermes: affinity -2, grudge +1
- tick 236: market-trader-iris cannot get food (no-funds)
- tick 237: fisher-stavros cannot get fish (no-buyer)
- tick 237: olive-grower-phoebe cannot get food (no-funds)
- tick 238: poseidon blessed ferryman: 3 planks for fish-landing
- tick 238: fisher-stavros prayed to poseidon: help with fish [evt-238-6295] (routed to its patron)
- tick 238: poseidon answered ferryman's prayer [evt-196-5142]
- tick 238: ferryman remembers poseidon's answer
- tick 238: ferryman → poseidon: affinity +1
- tick 240: weaver-zoe cannot get wool (no-buyer)
- tick 240: weaver-xenia cannot get wool (no-buyer)
- tick 240: the director spoiled 67 fish of fisher-kallias
- tick 242: fisher-stavros cannot get fish (no-buyer)
- tick 242: fisher-eleni cannot get fish (no-buyer)
- tick 242: fisher-dion cannot get fish (no-buyer)
- tick 242: olive-grower-phoebe cannot get food (no-funds)
- tick 242: weaver-xenia cannot get wool (no-buyer)
- tick 243: zeus blessed fisher-melina: 1 food
- tick 243: zeus answered fisher-melina's prayer [evt-138-3576]
- tick 243: fisher-melina remembers zeus's answer
- tick 243: fisher-melina → zeus: affinity +1
- tick 243: fisher-melina left poseidon for zeus: poseidon left 1 prayers unanswered ([evt-56-1379]) and zeus answered [evt-138-3576] [evt-243-6455]
- tick 244: olive-grower-phoebe cannot get food (no-seller)
- tick 244: olive-grower-phoebe cannot get olives (no-buyer)
- tick 244: weaver-xenia cannot get wool (no-buyer)
- tick 245: weaver-ismene cannot get wool (no-buyer)
- tick 245: weaver-zoe cannot get wool (no-buyer)
- tick 246: olive-grower-leon cannot get food (no-funds)
- tick 249: olive-grower-phoebe cannot get food (no-funds)
- tick 250: olive-grower-leon wronged herdsman-damon: unpaid-debt of 3 currency; quarrelsome, in need; the credit [evt-150-3940] failed [evt-250-6623]
- tick 250: a roof-leak in hera's domain (summer, the god's floor) took 1 food of smith-delia [evt-250-6624]
- tick 251: fisher-stavros cannot get fish (no-buyer)
- tick 251: fisher-eleni cannot get fish (no-buyer)
- tick 251: fisher-dion cannot get fish (no-buyer)
- tick 251: weaver-ismene cannot get wool (no-buyer)
- tick 251: weaver-zoe cannot get wool (no-buyer)
- tick 251: weaver-xenia cannot get wool (no-buyer)
- tick 253: weaver-ismene cannot get wool (no-buyer)
- tick 253: weaver-zoe cannot get wool (no-buyer)
- tick 253: weaver-xenia cannot get food (no-seller)
- tick 254: olive-grower-phoebe cannot get olives (no-buyer)
- tick 255: athena blessed olive-grower-aristo: 3 planks for olive-press
- tick 255: olive-grower-phoebe prayed to hades: help with currency [evt-255-6751] (a trouble in the god's domain: routed to the domain god)
- tick 255: herdsman-damon prayed to hermes: punish olive-grower-leon, who owns  [evt-255-6756] (routed to its patron)
- tick 255: olive-grower-phoebe wronged weaver-zoe: unpaid-debt of 3 currency; honest, in need; the credit [evt-155-4090] failed [evt-255-6763]
- tick 255: weaver-ismene cannot get food (no-seller)
- tick 255: weaver-zoe cannot get wool (no-buyer)
- tick 255: athena answered olive-grower-aristo's prayer [evt-173-4577]
- tick 255: olive-grower-aristo remembers athena's answer
- tick 255: olive-grower-aristo → athena: affinity +1
- tick 256: market-trader-iris cannot get food (no-funds)
- tick 257: olive-grower-aristo cannot get food (no-funds)
- tick 257: smith-delia cannot get food (no-seller)
- tick 258: smith-delia prayed to athena: help with food [evt-258-6846] (routed to its patron)
- tick 258: market-trader-iris cannot get food (no-funds)
- tick 259: weaver-ismene cannot get wool (no-buyer)
- tick 260: market-trader-iris prayed to hermes: help with food [evt-260-6881] (routed to its patron)
- tick 262: fisher-stavros cannot get fish (no-buyer)
- tick 262: fisher-eleni cannot get fish (no-buyer)
- tick 262: fisher-dion cannot get fish (no-buyer)
- tick 262: weaver-ismene cannot get wool (no-buyer)
- tick 263: fisher-stavros prayed to hermes: help with fish [evt-263-6955] (a trouble in the god's domain: routed to the domain god)
- tick 263: olive-grower-phoebe cannot get olives (no-buyer)
- tick 263: weaver-zoe cannot get food (no-seller)
- tick 263: olive-grower-aristo's prayer to athena lapsed unanswered [evt-112-2858]
- tick 263: olive-grower-aristo remembers athena's silence
- tick 263: olive-grower-aristo → athena: affinity -2, grudge +1
- tick 264: weaver-ismene cannot get wool (no-buyer)
- tick 265: weaver-zoe prayed to athena: help with food [evt-265-7014] (routed to its patron)
- tick 265: fisher-stavros cannot get fish (no-buyer)
- tick 266: olive-grower-leon cannot get food (no-funds)
- tick 266: weaver-ismene cannot get wool (no-buyer)
- tick 268: hades blessed olive-grower-phoebe: 2 currency
- tick 268: woodcutter wronged fisher-kallias: feud of 2 tools; quarrelsome, not in need [evt-268-7098]
- tick 268: olive-grower-aristo cannot get food (no-funds)
- tick 268: weaver-ismene cannot get wool (no-buyer)
- tick 268: weaver-zoe cannot get food (no-seller)
- tick 268: hades answered olive-grower-phoebe's prayer [evt-255-6751]
- tick 268: olive-grower-phoebe remembers hades's answer
- tick 268: olive-grower-phoebe → hades: affinity +1
- tick 268: olive-grower-phoebe left athena for hades: athena left 1 prayers unanswered ([evt-53-1301]) and hades answered [evt-255-6751] [evt-268-7121]
- tick 269: fisher-eleni's prayer to athena lapsed unanswered [evt-118-3022]
- tick 269: fisher-eleni remembers athena's silence
- tick 269: fisher-eleni → athena: affinity -2, grudge +1
- tick 270: weaver-ismene cannot get wool (no-buyer)
- tick 271: fisher-stavros cannot get fish (no-buyer)
- tick 271: fisher-dion cannot get fish (no-buyer)
- tick 272: olive-grower-aristo cannot get food (no-funds)
- tick 272: olive-grower-phoebe cannot get olives (no-buyer)
- tick 272: weaver-ismene cannot get wool (no-buyer)
- tick 274: olive-grower-aristo prayed to athena: help with food [evt-274-7260] (routed to its patron)
- tick 274: fisher-kallias cannot get food (no-funds)
- tick 274: weaver-ismene cannot get wool (no-buyer)
- tick 275: fisher-kallias prayed to poseidon: help with food [evt-275-7279] (routed to its patron)
- tick 275: weaver-ismene cannot get food (no-seller)
- tick 275: weaver-zoe cannot get wool (no-buyer)
- tick 276: market-trader-iris cannot get food (no-funds)
- tick 277: hephaestus blessed smith-ktesias: 2 food
- tick 277: weaver-zoe cannot get wool (no-buyer)
- tick 277: hephaestus answered smith-ktesias's prayer [evt-132-3436]
- tick 277: smith-ktesias remembers hephaestus's answer
- tick 277: smith-ktesias → hephaestus: affinity +1
- tick 278: fisher-kallias cannot get fish (no-buyer)
- tick 279: olive-grower-aristo cannot get olives (no-buyer)
- tick 279: weaver-zoe cannot get wool (no-buyer)
- tick 281: weaver-zoe cannot get wool (no-buyer)
- tick 282: smith-delia prayed to hera: help with food [evt-282-7469] (a trouble in the god's domain: routed to the domain god)
- tick 285: fisher-melina cannot get food (no-funds)
- tick 285: olive-grower-aristo cannot get olives (no-buyer)
- tick 285: olive-grower-phoebe cannot get olives (no-buyer)
- tick 286: fisher-stavros cannot get fish (no-buyer)
- tick 286: olive-grower-leon cannot get food (no-funds)
- tick 287: fisher-stavros prayed to poseidon: punish fisher-kallias, who owns  [evt-287-7576] (routed to its patron)
- tick 288: fisher-kallias cannot get food (no-funds)
- tick 288: olive-grower-aristo cannot get food (no-funds)
- tick 288: fisher-dion's prayer to hermes lapsed unanswered [evt-137-3554]
- tick 288: fisher-dion remembers hermes's silence
- tick 288: fisher-dion → hermes: affinity -2, grudge +1
- tick 289: olive-grower-phoebe cannot get food (no-funds)
- tick 293: a lightning-fire in zeus's domain (summer, the god's floor) took 2 food of ferryman [evt-293-7733]
- tick 293: olive-grower-phoebe's prayer to hermes lapsed unanswered [evt-142-3705]
- tick 293: olive-grower-phoebe remembers hermes's silence
- tick 293: olive-grower-phoebe → hermes: affinity -2, grudge +1
- tick 294: hermes blessed fisher-stavros: 2 fish
- tick 294: hermes answered fisher-stavros's prayer [evt-263-6955]
- tick 294: fisher-stavros remembers hermes's answer
- tick 294: fisher-stavros → hermes: affinity +1
- tick 294: fisher-stavros left poseidon for hermes: poseidon left 1 prayers unanswered ([evt-56-1380]) and hermes answered [evt-263-6955] [evt-294-7767]
- tick 296: ferryman prayed to zeus: help with food [evt-296-7794] (a trouble in the god's domain: routed to the domain god)
- tick 296: market-trader-iris cannot get food (no-funds)
- tick 297: fisher-stavros cannot get food (no-seller)
- tick 297: fisher-stavros cannot get fish (no-buyer)
- tick 297: olive-grower-leon cannot get food (no-funds)
- tick 298: fisher-kallias cannot get food (no-seller)
- tick 298: fisher-kallias cannot get fish (no-buyer)
- tick 299: fisher-kallias prayed to poseidon: help with fish [evt-299-7870] (routed to its patron)
- tick 300: fisher-dion wronged fisher-kallias: theft of 2 tools; greedy, not in need [evt-300-7912]
- tick 300: fisher-stavros cannot get fish (no-buyer)
- tick 300: fisher-eleni cannot get food (no-funds)

## Journeys

- journeys: 1 started: 1 arrived, 0 refused, 0 replaced, 0 still travelling

1. Hades: underworld-shore → ferry-dock, set out at tick 9, 1 hop, arrived at tick 9
   - tick 9: crossed from underworld-shore to ferry-dock

## Practice threads

### supplication [evt-20-473]: hera → farmer, fulfilled

- Opened at tick 20
- Cause: unmet-need (farmer) [evt-1-24]
- Answers the prayer [evt-3-61]
- Moves:
  1. tick 20, Hera: offer — farmer offers hera 1 currency by tick 110
  2. tick 21, farmer: accept
- Boon: seen given (evt-32-746)
- Offering: not seen
- Ending: fulfilled at tick 33, by farmer; remembered by farmer, hera
- Changed: hera → farmer: affinity +1

### supplication [evt-209-5501]: hera → farmer, fulfilled

- Opened at tick 209
- Cause: wrong (olive-grower-leon) [evt-149-3901]
- Answers the prayer [evt-151-3952]
- Moves:
  1. tick 209, Hera: offer — farmer offers hera 1 cloth by tick 299
  2. tick 210, farmer: accept
- Boon: seen given (evt-226-5932)
- Offering: not seen
- Ending: fulfilled at tick 227, by farmer; remembered by farmer, hera
- Changed: hera → farmer: affinity +1

## What each god practiced

- athena: no practice move; thread endings: none
- hades: travel; thread endings: none
- hephaestus: no practice move; thread endings: none
- hera: supplication; thread endings: fulfilled [evt-20-473] by its act, fulfilled [evt-209-5501] by its act
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
| hera | 28 | evt-20-473 | 110 | bless | performed |  |
| hera | 221 | evt-209-5501 | 299 | strike | performed |  |

## Repetition

- Athena: longest run 1 of legend:legend (cap 3). Choices: legend:legend ×1, bless:evt-38-904 ×1, bless:evt-104-2644 ×1, bless:evt-153-4013 ×1, bless:evt-173-4577 ×1
- Hades: longest run 1 of travel:ferry-dock (cap 3). Choices: travel:ferry-dock ×1, bless:evt-52-1266 ×1, bless:evt-255-6751 ×1
- Hephaestus: longest run 1 of strike:the-forge (cap 3). Choices: strike:the-forge ×1, bless:evt-19-467 ×1, report:provisioner-nikanor ×1, bless:evt-160-4202 ×1, bless:evt-132-3436 ×1
- Hera: longest run 1 of practice:offer evt-3-61 (cap 3). Choices: practice:offer evt-3-61 ×1, bless:evt-3-61 ×1, strike:woodshed ×1, bless:evt-58-1427 ×1, practice:offer evt-151-3952 ×1, strike:olive-grower-leon ×1, report:zeus ×1
- Hermes: longest run 1 of bless:evt-7-170 (cap 3). Choices: bless:evt-7-170 ×1, bless:evt-72-1789 ×1, bless:evt-110-2801 ×1, bless:evt-190-5008 ×1, bless:evt-263-6955 ×1
- Poseidon: longest run 1 of strike:fisher-dion (cap 3). Choices: strike:fisher-dion ×1, bless:evt-84-2121 ×1, bless:evt-115-2938 ×1, bless:evt-196-5142 ×1
- Zeus: longest run 1 of bless:evt-5-109 (cap 3). Choices: bless:evt-5-109 ×1, bless:evt-84-2118 ×1, strike:olive-press ×1, bless:evt-138-3576 ×1

## Automated checks

| God | Check | Result | Detail |
| --- | --- | --- | --- |
| Athena | profile trace | pass | 5 actions: 5 ability-backed, 0 context-backed |
| Athena | repetition | pass | longest run 1 of legend:legend (cap 3) |
| Athena | minimum activity | pass | 5 committed model actions (at least 5) |
| Athena | influence | pass | 8 caused (told belief, relationship-changed) |
| Athena | petition heard | pass | 17 petitions addressed to this god (at least 1) |
| Athena | petition answered | pass | 4 of 17 answered (at least 1) |
| Hades | profile trace | pass | 3 actions: 0 ability-backed, 3 context-backed |
| Hades | repetition | pass | longest run 1 of travel:ferry-dock (cap 3) |
| Hades | minimum activity | FAIL | 3 committed model actions (at least 5) |
| Hades | influence | pass | 2 caused (relationship-changed) |
| Hades | petition heard | pass | 4 petitions addressed to this god (at least 1) |
| Hades | petition answered | pass | 2 of 4 answered (at least 1) |
| Hephaestus | profile trace | pass | 5 actions: 4 ability-backed, 1 context-backed |
| Hephaestus | repetition | pass | longest run 1 of strike:the-forge (cap 3) |
| Hephaestus | minimum activity | pass | 5 committed model actions (at least 5) |
| Hephaestus | influence | pass | 4 caused (relationship-changed, told belief) |
| Hephaestus | petition heard | pass | 3 petitions addressed to this god (at least 1) |
| Hephaestus | petition answered | pass | 3 of 3 answered (at least 1) |
| Hera | profile trace | pass | 7 actions: 2 ability-backed, 5 context-backed |
| Hera | repetition | pass | longest run 1 of practice:offer evt-3-61 (cap 3) |
| Hera | minimum activity | pass | 7 committed model actions (at least 5) |
| Hera | influence | pass | 5 caused (relationship-changed, told belief) |
| Hera | petition heard | pass | 5 petitions addressed to this god (at least 1) |
| Hera | petition answered | pass | 4 of 5 answered (at least 1) |
| Hermes | profile trace | pass | 5 actions: 5 ability-backed, 0 context-backed |
| Hermes | repetition | pass | longest run 1 of bless:evt-7-170 (cap 3) |
| Hermes | minimum activity | pass | 5 committed model actions (at least 5) |
| Hermes | influence | pass | 5 caused (relationship-changed) |
| Hermes | petition heard | pass | 11 petitions addressed to this god (at least 1) |
| Hermes | petition answered | pass | 5 of 11 answered (at least 1) |
| Poseidon | profile trace | pass | 4 actions: 1 ability-backed, 3 context-backed |
| Poseidon | repetition | pass | longest run 1 of strike:fisher-dion (cap 3) |
| Poseidon | minimum activity | FAIL | 4 committed model actions (at least 5) |
| Poseidon | influence | pass | 4 caused (relationship-changed) |
| Poseidon | petition heard | pass | 15 petitions addressed to this god (at least 1) |
| Poseidon | petition answered | pass | 4 of 15 answered (at least 1) |
| Zeus | profile trace | pass | 4 actions: 1 ability-backed, 3 context-backed |
| Zeus | repetition | pass | longest run 1 of bless:evt-5-109 (cap 3) |
| Zeus | minimum activity | FAIL | 4 committed model actions (at least 5) |
| Zeus | influence | pass | 4 caused (relationship-changed) |
| Zeus | petition heard | pass | 5 petitions addressed to this god (at least 1) |
| Zeus | petition answered | pass | 4 of 5 answered (at least 1) |

## Model run

- 35 requests: 34 answered (34 native, 0 repaired), 1 exhausted; latency p50 7364 ms, p95 12534 ms; prompt p50 7186 / max 10464 characters; frames showed model-degraded in 3% of polls
- exhaustion: 1 × term.resource: resource must be one of: cloth, currency, divinity, fish, food, olives, ore, planks, tools, wine, wood, w
- hades was refused after 2 attempts (term.resource: resource must be one of: cloth, currency, divinity, fish, food, olives, ore, planks, tools, wine, wood, wool); it sent {"action":"practice","move":"offer","prayer":"evt-52-1266","term":{"kind":"make-offering","party":"woodcutter","deadlineTicks":90}}
- valid actions: held (34 proposals, all god actions, none rejected as malformed)
- perception compliance: held (every id named by 34 proposals was in the prompt behind it)
- relationship change with provenance: held (140 changes, 140 explained from the log alone, e.g. wrong > memory-recorded > relationship-changed)
- changed next action: held (athena: bless:evt-104-2644 before its first belief, bless:evt-153-4013 after (changed); hades: travel:ferry-dock before its first belief, bless:evt-52-1266 after (changed); hera: bless:evt-3-61 before its first belief, strike:woodshed after (changed); hermes: bless:evt-72-1789 before its first belief, bless:evt-110-2801 after (changed); poseidon: bless:evt-84-2121 before its first belief, bless:evt-115-2938 after (changed))
- goal privacy: held (35 prompts checked against 0 goals: none carried another god's goal outside a told account or a perceived legend)
- petition privacy: held (35 prompts checked against 60 petitions: none listed a petition addressed to another god, and none carried one the god did not witness)
- god thread endings: FAILED (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: 2 (fulfilled [evt-20-473], fulfilled [evt-209-5501]); hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: no thread ending it caused left a persistent consequence)
- supplication and settlement: FAILED (2 supplications, 0 settlements, 0 refused or breached)
- thread endings recorded: held (2 threads: 2 ended with their parties remembering, 0 still open and inside their deadlines)
- no reopening without a new cause: held (0 settlements, 0 opened as linked successors on a newer cause, none reopened a closed matter on an old one)
- no-progress moves advance nothing: held (0 moves judged no progress, each leaving a refusal record and advancing no thread; no counter restated an earlier offer)
- consequence changes a later choice: held (hera: bless: before the consequence, strike:woodshed after (changed); the prompt behind it showed how the thread ended)
- obligated turns recorded: held (2 obligated turns, each with its recorded choice: 2 performed)
- contest endings: held (no contest was opened)
- alliances sealed by agreement: held (no alliance was formed)

Requests, in the order they ran (one at a time):

| # | God | Asked at tick | Applied at tick | Latency | Outcome | Prompt chars |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | athena | 1 | 6 | 4.8 s | answered | 5414 |
| 2 | hades | 6 | 9 | 2.2 s | answered | 3551 |
| 3 | hephaestus | 9 | 13 | 3.7 s | answered | 4839 |
| 4 | hera | 13 | 20 | 6.7 s | answered | 6740 |
| 5 | hermes | 20 | 28 | 7.0 s | answered | 6337 |
| 6 | hera | 28 | 32 | 3.4 s | answered | 6011 |
| 7 | poseidon | 32 | 40 | 7.1 s | answered | 7215 |
| 8 | zeus | 40 | 45 | 4.0 s | answered | 6925 |
| 9 | athena | 45 | 53 | 7.4 s | answered | 7537 |
| 10 | hades | 53 | — | 11.8 s | exhausted (invalid-output: term.resource: resource must be one of: cloth, currency, divinity, fish, food, olives, ore, planks, tools, wine, wood, w) | 6646 |
| 11 | hephaestus | 65 | 73 | 7.5 s | answered | 7157 |
| 12 | hera | 73 | 81 | 7.0 s | answered | 7920 |
| 13 | hermes | 81 | 90 | 8.7 s | answered | 7437 |
| 14 | poseidon | 90 | 101 | 10.6 s | answered | 9342 |
| 15 | zeus | 101 | 105 | 3.9 s | answered | 6965 |
| 16 | athena | 105 | 117 | 11.1 s | answered | 9640 |
| 17 | hades | 117 | 125 | 7.6 s | answered | 6953 |
| 18 | hephaestus | 125 | 131 | 5.6 s | answered | 5574 |
| 19 | hera | 131 | 136 | 4.1 s | answered | 7031 |
| 20 | hermes | 136 | 147 | 10.9 s | answered | 8445 |
| 21 | poseidon | 147 | 161 | 13.6 s | answered | 10464 |
| 22 | zeus | 161 | 168 | 6.1 s | answered | 8055 |
| 23 | athena | 168 | 181 | 12.4 s | answered | 10023 |
| 24 | hades | 181 | 192 | 10.8 s | answered | 7174 |
| 25 | hephaestus | 192 | 202 | 9.0 s | answered | 8053 |
| 26 | hera | 202 | 209 | 6.5 s | answered | 7186 |
| 27 | hermes | 209 | 221 | 11.3 s | answered | 8844 |
| 28 | hera | 221 | 226 | 4.2 s | answered | 6693 |
| 29 | poseidon | 226 | 238 | 11.4 s | answered | 9706 |
| 30 | zeus | 238 | 243 | 4.4 s | answered | 7038 |
| 31 | athena | 243 | 255 | 11.5 s | answered | 9680 |
| 32 | hades | 255 | 268 | 12.5 s | answered | 8738 |
| 33 | hephaestus | 268 | 277 | 8.4 s | answered | 7467 |
| 34 | hera | 277 | 283 | 5.7 s | answered | 5493 |
| 35 | hermes | 283 | 294 | 11.0 s | answered | 8490 |
| 36 | poseidon | ≈294 | — | — | in flight at the end (inferred) | — |

Each god's turns (finished requests; the gap is the ticks between its request starts):

| God | Turns | Median gap (ticks) | p95 gap (ticks) | Worst gap (ticks) | Median latency |
| --- | --- | --- | --- | --- | --- |
| athena | 5 | 61.5 | 75 | 75 | 11.1 s |
| hades | 5 | 64 | 74 | 74 | 10.8 s |
| hephaestus | 5 | 63.5 | 76 | 76 | 7.5 s |
| hera | 7 | 50.5 | 71 | 71 | 5.7 s |
| hermes | 5 | 67 | 74 | 74 | 10.9 s |
| poseidon | 4 | 58 | 79 | 79 | 11.0 s |
| zeus | 4 | 61 | 77 | 77 | 4.2 s |

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

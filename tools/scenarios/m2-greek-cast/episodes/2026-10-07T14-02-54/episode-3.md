# Episode 3 of 3

## Settings

- Recorded: 2026-10-07T14:18:09.022Z
- Model: qwen3-8b-4k through local Ollama, 4K context, reasoning off (reasoning_effort none)
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
   - says: "I, Athena, weave wisdom and peace, guiding mortals with olive's grace and the loom's craft."
   - heard by: herdsman-damon, weaver-ismene, weaver-xenia, weaver-zoe
   - caused: legend-recorded (athena)
   - then: herdsman-damon now believes athena: "I, Athena, weave wisdom and peace, guiding mortals with olive's grace and the loom's craft."
   - then: weaver-ismene now believes athena: "I, Athena, weave wisdom and peace, guiding mortals with olive's grace and the loom's craft."
   - then: weaver-xenia now believes athena: "I, Athena, weave wisdom and peace, guiding mortals with olive's grace and the loom's craft."
   - then: weaver-zoe now believes athena: "I, Athena, weave wisdom and peace, guiding mortals with olive's grace and the loom's craft."
2. **tick 10, Hades:** travel → ferry-dock (context-backed)
   - caused: journey-started (hades)
3. **tick 15, Hephaestus:** legend (ability-backed)
   - says: "I forged the great shield of Achilles, a marvel of craft and purpose, to aid a mortal in war."
   - heard by: provisioner-nikanor, smith-brontes, smith-delia, smith-ktesias
   - caused: legend-recorded (hephaestus)
   - then: provisioner-nikanor now believes hephaestus: "I forged the great shield of Achilles, a marvel of craft and purpose, to aid a mortal in war."
   - then: smith-brontes now believes hephaestus: "I forged the great shield of Achilles, a marvel of craft and purpose, to aid a mortal in war."
   - then: smith-delia now believes hephaestus: "I forged the great shield of Achilles, a marvel of craft and purpose, to aid a mortal in war."
   - then: smith-ktesias now believes hephaestus: "I forged the great shield of Achilles, a marvel of craft and purpose, to aid a mortal in war."
4. **tick 20, Hera:** travel → ancient-olive-tree (context-backed)
   - caused: journey-started (hera)
5. **tick 29, Hermes:** report → ferryman (ability-backed)
   - says: "I have brought tidings from the mortal realm; the market-trader-iris seeks help with wine, and I may aid them if they offer me currency."
   - caused: report-told (hermes → ferryman)
   - then: ferryman now believes hermes: "I have brought tidings from the mortal realm; the market-trader-iris seeks help with wine, and I may aid them if they offer me currency."
6. **tick 35, Poseidon:** travel → town-square (context-backed)
   - caused: journey-started (poseidon)
7. **tick 42, Zeus:** practice → offer evt-5-106 (context-backed)
   - caused: practice-opened (zeus)
8. **tick 49, Athena:** travel → ferry-dock (context-backed)
   - caused: journey-started (athena)
9. **tick 53, Zeus:** bless → evt-5-106 (context-backed)
   - caused: resource-consumed (zeus); blessing-granted (zeus)
   - then: woodcutter → zeus: affinity +1
10. **tick 57, Hades:** travel → underworld-shore (context-backed)
   - caused: journey-started (hades)
11. **tick 62, Hephaestus:** legend (ability-backed)
   - says: "I shaped the shield of Achilles, a marvel of craft and purpose, to aid a mortal in war."
   - heard by: provisioner-nikanor, smith-brontes, smith-delia, smith-ktesias
   - caused: legend-recorded (hephaestus)
   - then: provisioner-nikanor now believes hephaestus: "I shaped the shield of Achilles, a marvel of craft and purpose, to aid a mortal in war."
   - then: smith-brontes now believes hephaestus: "I shaped the shield of Achilles, a marvel of craft and purpose, to aid a mortal in war."
   - then: smith-delia now believes hephaestus: "I shaped the shield of Achilles, a marvel of craft and purpose, to aid a mortal in war."
   - then: smith-ktesias now believes hephaestus: "I shaped the shield of Achilles, a marvel of craft and purpose, to aid a mortal in war."
12. **tick 70, Hera:** report → weaver-ismene (context-backed)
   - says: "The olive trees whisper of abundance, and the press hums with promise. The harvest is in harmony, as it should be."
   - caused: report-told (hera → weaver-ismene)
   - then: weaver-ismene now believes hera: "The olive trees whisper of abundance, and the press hums with promise. The harvest is in harmony, as it should be."
13. **tick 77, Hermes:** report → ferryman (ability-backed)
   - says: "The market-trader-iris seeks aid with wine, and I may assist them if they offer me fish."
   - caused: report-told (hermes → ferryman)
   - then: ferryman now believes hermes: "The market-trader-iris seeks aid with wine, and I may assist them if they offer me fish."
14. **tick 86, Poseidon:** travel → ferry-dock (context-backed)
   - caused: journey-started (poseidon)
15. **tick 89, Zeus:** travel → town-square (context-backed)
   - caused: journey-started (zeus)
16. **tick 96, Athena:** legend (ability-backed)
   - says: "I, Athena, weave wisdom and peace, guiding mortals with olive's grace and the loom's craft."
   - heard by: ferryman, hermes, poseidon
   - caused: legend-recorded (athena)
   - then: ferryman now believes athena: "I, Athena, weave wisdom and peace, guiding mortals with olive's grace and the loom's craft."
   - then: hermes now believes athena: "I, Athena, weave wisdom and peace, guiding mortals with olive's grace and the loom's craft."
   - then: poseidon now believes athena: "I, Athena, weave wisdom and peace, guiding mortals with olive's grace and the loom's craft."
17. **tick 98, Hades:** travel → judgment-hall (context-backed)
   - caused: journey-started (hades)
18. **tick 103, Hephaestus:** legend (ability-backed)
   - says: "I shaped the shield of Achilles, a marvel of craft and purpose, to aid a mortal in war."
   - heard by: provisioner-nikanor, smith-delia, smith-ktesias
   - caused: legend-recorded (hephaestus)
19. **tick 110, Hera:** travel → wilderness-grove (context-backed)
   - caused: journey-started (hera)
20. **tick 116, Hermes:** travel → town-square (context-backed)
   - caused: journey-started (hermes)
21. **tick 127, Poseidon:** travel → town-square (context-backed)
   - caused: journey-started (poseidon)
22. **tick 136, Zeus:** report → woodcutter (context-backed)
   - says: "You have done well, and I mark your labor. Let this be a reminder that order and diligence bring prosperity."
   - caused: report-told (zeus → woodcutter)
   - then: woodcutter now believes zeus: "You have done well, and I mark your labor. Let this be a reminder that order and diligence bring prosperity."
23. **tick 142, Athena:** travel → town-square (context-backed)
   - caused: journey-started (athena)
24. **tick 144, Hades:** travel → asphodel-meadow (context-backed)
   - caused: journey-started (hades)
25. **tick 149, Hephaestus:** travel → town-square (context-backed)
   - caused: journey-started (hephaestus)
26. **tick 155, Hera:** travel → ancient-olive-tree (context-backed)
   - caused: journey-started (hera)
27. **tick 165, Hermes:** travel → ferry-dock (context-backed)
   - caused: journey-started (hermes)
28. **tick 177, Poseidon:** travel → ferry-dock (context-backed)
   - caused: journey-started (poseidon)
29. **tick 184, Zeus:** travel → olympus-gate (context-backed)
   - caused: journey-started (zeus)
30. **tick 195, Athena:** report → farmer (context-backed)
   - says: "I, Athena, bring wisdom and order. Your planks are needed for your tools, and I shall weave their return through the craft of the weavers."
   - caused: report-told (athena → farmer)
   - then: farmer now believes athena: "I, Athena, bring wisdom and order. Your planks are needed for your tools, and I shall weave their return through the craft of the weavers."
31. **tick 197, Hades:** travel → judgment-hall (context-backed)
   - caused: journey-started (hades)
32. **tick 204, Hephaestus:** travel → forge (context-backed)
   - caused: journey-started (hephaestus)
33. **tick 214, Hera:** travel → town-square (context-backed)
   - caused: journey-started (hera)
34. **tick 225, Hermes:** travel → town-square (context-backed)
   - caused: journey-started (hermes)
35. **tick 238, Poseidon:** report → ferryman (context-backed)
   - says: "I am the sea's wrath and the earth's tremor, and I command the waves. Your offerings must be true, or I shall bring ruin."
   - caused: report-told (poseidon → ferryman)
   - then: ferryman now believes poseidon: "I am the sea's wrath and the earth's tremor, and I command the waves. Your offerings must be true, or I shall bring ruin."
36. **tick 243, Zeus:** travel → town-square (context-backed)
   - caused: journey-started (zeus)
37. **tick 255, Athena:** travel → forge (context-backed)
   - caused: journey-started (athena)
38. **tick 259, Hades:** travel → ferry-dock (context-backed)
   - caused: journey-started (hades)
39. **tick 266, Hephaestus:** travel → town-square (context-backed)
   - caused: journey-started (hephaestus)
40. **tick 280, Hera:** report → market-trader-iris (context-backed)
   - says: "Your roof is safe, and I have blessed your home. Give me a cloth as tribute, and I shall ensure your store is never empty."
   - caused: report-told (hera → market-trader-iris)
   - then: market-trader-iris now believes hera: "Your roof is safe, and I have blessed your home. Give me a cloth as tribute, and I shall ensure your store is never empty."
41. **tick 295, Hermes:** report → market-trader-iris (ability-backed)
   - says: "I have brought tidings from the mortal realm; the market-trader-iris seeks aid with wine, and I may assist them if they offer me fish."
   - caused: report-told (hermes → market-trader-iris)
   - then: market-trader-iris now believes hermes: "I have brought tidings from the mortal realm; the market-trader-iris seeks aid with wine, and I may assist them if they offer me fish."

## What the world did with every proposal

- dispositions: travel 26 × committed, report 8 × committed, legend 5 × committed, practice 1 × committed, bless 1 × committed

1. Athena: legend → legend — committed: legend-recorded
2. Hades: travel → ferry-dock — committed: journey-started
3. Hephaestus: legend → legend — committed: legend-recorded
4. Hera: travel → ancient-olive-tree — committed: journey-started
5. Hermes: report → ferryman — committed: report-told
6. Poseidon: travel → town-square — committed: journey-started
7. Zeus: practice → offer evt-5-106 — committed: practice-opened
8. Athena: travel → ferry-dock — committed: journey-started
9. Zeus: bless → evt-5-106 — committed: resource-consumed, blessing-granted
10. Hades: travel → underworld-shore — committed: journey-started
11. Hephaestus: legend → legend — committed: legend-recorded
12. Hera: report → weaver-ismene — committed: report-told
13. Hermes: report → ferryman — committed: report-told
14. Poseidon: travel → ferry-dock — committed: journey-started
15. Zeus: travel → town-square — committed: journey-started
16. Athena: legend → legend — committed: legend-recorded
17. Hades: travel → judgment-hall — committed: journey-started
18. Hephaestus: legend → legend — committed: legend-recorded
19. Hera: travel → wilderness-grove — committed: journey-started
20. Hermes: travel → town-square — committed: journey-started
21. Poseidon: travel → town-square — committed: journey-started
22. Zeus: report → woodcutter — committed: report-told
23. Athena: travel → town-square — committed: journey-started
24. Hades: travel → asphodel-meadow — committed: journey-started
25. Hephaestus: travel → town-square — committed: journey-started
26. Hera: travel → ancient-olive-tree — committed: journey-started
27. Hermes: travel → ferry-dock — committed: journey-started
28. Poseidon: travel → ferry-dock — committed: journey-started
29. Zeus: travel → olympus-gate — committed: journey-started
30. Athena: report → farmer — committed: report-told
31. Hades: travel → judgment-hall — committed: journey-started
32. Hephaestus: travel → forge — committed: journey-started
33. Hera: travel → town-square — committed: journey-started
34. Hermes: travel → town-square — committed: journey-started
35. Poseidon: report → ferryman — committed: report-told
36. Zeus: travel → town-square — committed: journey-started
37. Athena: travel → forge — committed: journey-started
38. Hades: travel → ferry-dock — committed: journey-started
39. Hephaestus: travel → town-square — committed: journey-started
40. Hera: report → market-trader-iris — committed: report-told
41. Hermes: report → market-trader-iris — committed: report-told

## The episode's numbers

- Food: 95 "cannot get food" lines; 18 of 36 prayers are about food
- Troubles in a god's domain: Athena 3, Hades 2, Hephaestus 2, Hera 2, Hermes 2, Poseidon 2, Zeus 3
- Wrongs between mortals: 10; 9 between different patrons
  - [evt-1-23] fisher-dion (hermes) wronged fisher-kallias (poseidon): cheating; the victim prayed [evt-5-110]; revenge
  - [evt-61-1239] woodcutter (zeus) wronged fisher-stavros (poseidon): feud; the victim prayed [evt-148-2615]; no consequence yet
  - [evt-152-2697] fisher-kallias (poseidon) wronged farmer (hera): unpaid-debt; the victim prayed [evt-155-2761]; no consequence yet
  - [evt-167-2957] fisher-eleni (athena) wronged fisher-stavros (poseidon): feud; the victim prayed [evt-199-3500]; no consequence yet
  - [evt-180-3184] fisher-dion (hermes) wronged fisher-eleni (athena): theft; the victim did not pray about it; no consequence yet
  - [evt-183-3245] fisher-kallias (poseidon) wronged fisher-dion (hermes): feud; the victim did not pray about it; no consequence yet
  - [evt-257-4456] woodcutter (zeus) wronged fisher-eleni (athena): feud; the victim prayed [evt-291-5127]; no consequence yet
  - [evt-286-4979] smith-brontes (hephaestus) wronged market-trader-iris (hermes): feud; the victim prayed [evt-288-5030]; no consequence yet
  - [evt-290-5086] olive-grower-aristo (athena) wronged smith-ktesias (hephaestus): unpaid-debt; the victim did not pray about it; no consequence yet
- Defections: 0
- From a prayer's cause to its closing: 13 closed (median 153 ticks, p95 238 ticks); by outcome lapsed 12, answered 1

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
- tick 7: market-trader-iris prayed to hermes: help with wine [evt-7-163] (routed to its patron)
- tick 9: fisher-kallias cannot get fish (no-buyer)
- tick 36: a tool-flaw in athena's domain (spring, the god's floor) took 2 planks of farmer [evt-36-752]
- tick 37: woodcutter cannot get food (no-seller)
- tick 38: farmer prayed to athena: help with planks [evt-38-774] (a trouble in the god's domain: routed to the domain god)
- tick 49: fisher-kallias cannot get food (no-funds)
- tick 50: a hoard-swallowed in hades's domain (spring, the god's floor) took 2 currency of weaver-zoe [evt-50-998]
- tick 51: fisher-kallias prayed to poseidon: help with food [evt-51-1005] (routed to its patron)
- tick 53: zeus blessed woodcutter: 2 food
- tick 53: zeus's boon to woodcutter was seen given [evt-42-839] (evt-53-1045)
- tick 53: zeus answered woodcutter's prayer [evt-5-106]
- tick 53: woodcutter remembers zeus's answer
- tick 53: woodcutter → zeus: affinity +1
- tick 54: fisher-kallias cannot get fish (no-buyer)
- tick 55: a roof-leak in hera's domain (spring, the god's floor) took 2 food of ferryman [evt-55-1119]
- tick 58: ferryman prayed to hera: help with food [evt-58-1170] (a trouble in the god's domain: routed to the domain god)
- tick 61: woodcutter wronged fisher-stavros: feud of 1 food; quarrelsome, not in need [evt-61-1239]
- tick 67: a tool-flaw in athena's domain (spring, the season's odds) took 2 tools of smith-brontes [evt-67-1356]
- tick 68: fisher-kallias cannot get food (no-funds)
- tick 68: fisher-stavros cannot get food (no-seller)
- tick 69: fisher-stavros prayed to poseidon: help with food [evt-69-1386] (routed to its patron)
- tick 75: fisher-stavros cannot get fish (no-buyer)
- tick 81: a harbour-surge in poseidon's domain (spring, the god's floor) damaged fish-landing of ferryman [evt-81-1577]
- tick 81: fisher-kallias cannot get food (no-funds)
- tick 84: ferryman prayed to poseidon: help with fish-landing [evt-84-1626] (a trouble in the god's domain: routed to the domain god)
- tick 85: fisher-kallias cannot get food (no-funds)
- tick 88: fisher-kallias cannot get food (no-funds)
- tick 88: olive-grower-aristo cannot get food (no-funds)
- tick 97: fisher-kallias cannot get food (no-funds)
- tick 108: olive-grower-aristo cannot get food (no-funds)
- tick 110: fisher-kallias cannot get food (no-funds)
- tick 112: a lightning-fire in zeus's domain (spring, the god's floor) took 2 food of herdsman-damon [evt-112-2089]
- tick 113: weaver-xenia cannot get food (no-seller)
- tick 113: weaver-xenia cannot get wool (no-buyer)
- tick 114: fisher-kallias cannot get food (no-funds)
- tick 114: weaver-ismene cannot get wool (no-buyer)
- tick 115: weaver-ismene cannot get food (no-seller)
- tick 116: market-trader-iris cannot get food (no-funds)
- tick 117: herdsman-damon prayed to zeus: help with food [evt-117-2178] (a trouble in the god's domain: routed to the domain god)
- tick 120: the director made smith-ktesias take 102 food from ferryman
- tick 123: ferryman prayed to hermes: help with food [evt-123-2274] (not its authored patron (a defection or a domain))
- tick 124: a vanished-goods in hermes's domain (spring, the god's floor) took 2 food of smith-ktesias [evt-124-2293]
- tick 130: fisher-kallias cannot get food (no-funds)
- tick 134: fisher-kallias cannot get food (no-funds)
- tick 134: olive-grower-phoebe cannot get food (no-funds)
- tick 136: smith-delia cannot get food (no-funds)
- tick 137: market-trader-iris cannot get food (no-funds)
- tick 137: fisher-kallias cannot get food (no-funds)
- tick 139: market-trader-iris prayed to hermes: help with food [evt-139-2475] (routed to its patron)
- tick 139: a cracked-tools in hephaestus's domain (spring, the god's floor) took 2 tools of smith-delia [evt-139-2495]
- tick 147: fisher-stavros cannot get food (no-seller)
- tick 148: fisher-stavros prayed to poseidon: punish woodcutter, who owns woodshed [evt-148-2615] (routed to its patron)
- tick 148: fisher-kallias cannot get food (no-funds)
- tick 148: olive-grower-aristo cannot get food (no-funds)
- tick 149: olive-grower-phoebe cannot get food (no-funds)
- tick 150: olive-grower-leon cannot get food (no-funds)
- tick 152: fisher-kallias wronged farmer: unpaid-debt of 3 currency; greedy, not in need; the credit [evt-52-1042] failed [evt-152-2697]
- tick 153: weaver-ismene cannot get food (no-seller)
- tick 153: weaver-zoe cannot get food (no-seller)
- tick 153: weaver-xenia cannot get food (no-seller)
- tick 153: smith-brontes cannot get food (no-seller)
- tick 154: fisher-stavros cannot get fish (no-buyer)
- tick 154: fisher-eleni cannot get fish (no-buyer)
- tick 154: fisher-dion cannot get fish (no-buyer)
- tick 154: farmer's prayer to hera lapsed unanswered [evt-3-60]
- tick 154: farmer remembers hera's silence
- tick 154: farmer → hera: affinity -2, grudge +1
- tick 155: farmer prayed to hera: punish fisher-kallias, who owns  [evt-155-2761] (routed to its patron)
- tick 155: fisher-kallias cannot get fish (no-buyer)
- tick 155: fisher-melina cannot get fish (no-buyer)
- tick 156: market-trader-iris cannot get food (no-funds)
- tick 156: fisher-eleni cannot get fish (no-buyer)
- tick 156: fisher-dion cannot get fish (no-buyer)
- tick 156: smith-delia cannot get food (no-funds)
- tick 156: fisher-kallias's prayer to poseidon lapsed unanswered [evt-5-110]
- tick 156: fisher-kallias remembers poseidon's silence
- tick 156: fisher-kallias → poseidon: affinity -2, grudge +1
- tick 157: fisher-kallias prayed to poseidon: help with fish [evt-157-2807] (routed to its patron)
- tick 157: fisher-melina prayed to poseidon: help with fish [evt-157-2808] (routed to its patron)
- tick 157: fisher-eleni prayed to athena: help with fish [evt-157-2810] (routed to its patron)
- tick 157: fisher-dion prayed to hermes: help with fish [evt-157-2811] (routed to its patron)
- tick 158: market-trader-iris's prayer to hermes lapsed unanswered [evt-7-163]
- tick 158: market-trader-iris remembers hermes's silence
- tick 158: market-trader-iris → hermes: affinity -2, grudge +1
- tick 161: fisher-kallias cannot get fish (no-buyer)
- tick 161: fisher-melina cannot get fish (no-buyer)
- tick 165: fisher-eleni cannot get fish (no-buyer)
- tick 166: olive-grower-leon cannot get food (no-funds)
- tick 167: fisher-eleni wronged fisher-stavros: feud of 1 food; proud, not in need [evt-167-2957]
- tick 167: fisher-kallias cannot get fish (no-buyer)
- tick 167: fisher-melina cannot get fish (no-buyer)
- tick 167: fisher-stavros cannot get fish (no-buyer)
- tick 167: fisher-eleni cannot get fish (no-buyer)
- tick 167: fisher-dion cannot get fish (no-buyer)
- tick 169: fisher-kallias cannot get fish (no-buyer)
- tick 169: fisher-melina cannot get fish (no-buyer)
- tick 169: fisher-stavros cannot get fish (no-buyer)
- tick 169: fisher-eleni cannot get fish (no-buyer)
- tick 169: fisher-dion cannot get fish (no-buyer)
- tick 171: fisher-kallias cannot get fish (no-buyer)
- tick 171: fisher-melina cannot get fish (no-buyer)
- tick 171: fisher-eleni cannot get fish (no-buyer)
- tick 171: fisher-dion cannot get fish (no-buyer)
- tick 176: market-trader-iris cannot get food (no-funds)
- tick 180: fisher-dion wronged fisher-eleni: theft of 2 fish; greedy, in need [evt-180-3184]
- tick 183: fisher-kallias wronged fisher-dion: feud of 1 food; greedy, in need; a revenge for [evt-1-23] [evt-183-3245]
- tick 187: fisher-kallias cannot get fish (no-buyer)
- tick 187: fisher-melina cannot get fish (no-buyer)
- tick 188: a roof-leak in hera's domain (spring, the god's floor) took 1 food of market-trader-iris [evt-188-3316]
- tick 188: market-trader-iris cannot get food (no-funds)
- tick 189: olive-grower-aristo cannot get food (no-funds)
- tick 189: farmer's prayer to athena lapsed unanswered [evt-38-774]
- tick 189: farmer remembers athena's silence
- tick 189: farmer → athena: affinity -2, grudge +1
- tick 190: fisher-kallias cannot get fish (no-buyer)
- tick 190: fisher-melina cannot get fish (no-buyer)
- tick 191: market-trader-iris cannot get food (no-seller)
- tick 192: market-trader-iris prayed to hera: help with food [evt-192-3365] (a trouble in the god's domain: routed to the domain god)
- tick 192: a hoard-swallowed in hades's domain (spring, the god's floor) took 2 currency of olive-grower-leon [evt-192-3373]
- tick 193: a tool-flaw in athena's domain (spring, the god's floor) took 2 tools of farmer [evt-193-3387]
- tick 195: fisher-stavros cannot get food (no-seller)
- tick 195: fisher-eleni cannot get food (no-seller)
- tick 195: fisher-dion cannot get food (no-seller)
- tick 195: olive-grower-phoebe cannot get food (no-seller)
- tick 195: olive-grower-leon cannot get food (no-seller)
- tick 195: weaver-ismene cannot get food (no-seller)
- tick 195: weaver-zoe cannot get food (no-seller)
- tick 195: weaver-xenia cannot get food (no-seller)
- tick 195: smith-brontes cannot get food (no-seller)
- tick 195: smith-delia cannot get food (no-seller)
- tick 196: farmer prayed to athena: help with tools [evt-196-3424] (a trouble in the god's domain: routed to the domain god)
- tick 196: market-trader-iris cannot get food (no-funds)
- tick 198: olive-grower-phoebe prayed to athena: help with food [evt-198-3486] (routed to its patron)
- tick 198: olive-grower-leon prayed to poseidon: help with food [evt-198-3487] (routed to its patron)
- tick 198: weaver-zoe prayed to athena: help with food [evt-198-3488] (routed to its patron)
- tick 198: fisher-stavros cannot get food (no-seller)
- tick 199: fisher-stavros prayed to poseidon: punish fisher-eleni, who owns  [evt-199-3500] (routed to its patron)
- tick 200: the season turned from spring to summer
- tick 200: olive-grower-phoebe cannot get food (no-seller)
- tick 200: olive-grower-leon cannot get food (no-seller)
- tick 200: weaver-zoe cannot get food (no-seller)
- tick 202: fisher-kallias's prayer to poseidon lapsed unanswered [evt-51-1005]
- tick 202: fisher-kallias remembers poseidon's silence
- tick 202: fisher-kallias → poseidon: affinity -2, grudge +1
- tick 203: fisher-kallias cannot get fish (no-buyer)
- tick 203: fisher-melina cannot get fish (no-buyer)
- tick 203: fisher-stavros cannot get fish (no-buyer)
- tick 205: fisher-melina cannot get food (no-funds)
- tick 206: olive-grower-phoebe cannot get olives (no-buyer)
- tick 207: fisher-eleni cannot get food (no-seller)
- tick 208: fisher-eleni prayed to athena: help with food [evt-208-3678] (routed to its patron)
- tick 208: olive-grower-aristo cannot get food (no-funds)
- tick 208: olive-grower-phoebe cannot get olives (no-buyer)
- tick 208: olive-grower-leon cannot get olives (no-buyer)
- tick 209: fisher-melina cannot get fish (no-buyer)
- tick 209: fisher-dion cannot get fish (no-buyer)
- tick 209: ferryman's prayer to hera lapsed unanswered [evt-58-1170]
- tick 209: ferryman remembers hera's silence
- tick 209: ferryman → hera: affinity -2, grudge +1
- tick 210: fisher-dion cannot get food (no-seller)
- tick 211: fisher-dion prayed to hermes: help with food [evt-211-3741] (routed to its patron)
- tick 211: olive-grower-leon cannot get olives (no-buyer)
- tick 212: fisher-kallias cannot get fish (no-buyer)
- tick 212: fisher-stavros cannot get fish (no-buyer)
- tick 212: fisher-eleni cannot get fish (no-buyer)
- tick 212: olive-grower-phoebe cannot get olives (no-buyer)
- tick 213: olive-grower-aristo cannot get food (no-funds)
- tick 215: olive-grower-aristo prayed to athena: help with food [evt-215-3817] (routed to its patron)
- tick 215: fisher-melina cannot get fish (no-buyer)
- tick 215: fisher-dion cannot get fish (no-buyer)
- tick 216: market-trader-iris cannot get food (no-funds)
- tick 218: fisher-kallias cannot get fish (no-buyer)
- tick 218: fisher-stavros cannot get fish (no-buyer)
- tick 218: fisher-eleni cannot get fish (no-buyer)
- tick 218: fisher-dion cannot get fish (no-buyer)
- tick 219: fisher-melina cannot get fish (no-buyer)
- tick 219: weaver-zoe cannot get wool (no-buyer)
- tick 220: olive-grower-aristo cannot get olives (no-buyer)
- tick 220: fisher-stavros's prayer to poseidon lapsed unanswered [evt-69-1386]
- tick 220: fisher-stavros remembers poseidon's silence
- tick 220: fisher-stavros → poseidon: affinity -2, grudge +1
- tick 221: weaver-zoe cannot get wool (no-buyer)
- tick 224: a lightning-fire in zeus's domain (summer, the god's floor) took 1 food of weaver-zoe [evt-224-3999]
- tick 225: fisher-melina cannot get food (no-funds)
- tick 225: olive-grower-aristo cannot get olives (no-buyer)
- tick 227: fisher-melina cannot get food (no-funds)
- tick 228: olive-grower-aristo cannot get food (no-funds)
- tick 228: weaver-zoe cannot get food (no-seller)
- tick 230: fisher-kallias cannot get fish (no-buyer)
- tick 230: fisher-melina cannot get food (no-funds)
- tick 230: fisher-dion cannot get fish (no-buyer)
- tick 232: fisher-kallias cannot get fish (no-buyer)
- tick 232: fisher-dion cannot get fish (no-buyer)
- tick 233: fisher-melina cannot get food (no-funds)
- tick 235: olive-grower-phoebe cannot get food (no-funds)
- tick 235: ferryman's prayer to poseidon lapsed unanswered [evt-84-1626]
- tick 235: ferryman remembers poseidon's silence
- tick 235: ferryman → poseidon: affinity -2, grudge +1
- tick 236: market-trader-iris cannot get food (no-funds)
- tick 236: fisher-melina cannot get food (no-funds)
- tick 240: market-trader-iris wronged fisher-dion: unpaid-debt of 3 currency; greedy, not in need; the credit [evt-140-2519] failed [evt-240-4246]
- tick 240: the director spoiled 24 currency of fisher-stavros
- tick 250: fisher-kallias cannot get fish (no-buyer)
- tick 256: market-trader-iris cannot get food (no-funds)
- tick 257: woodcutter wronged fisher-eleni: feud of 2 tools; quarrelsome, not in need [evt-257-4456]
- tick 257: fisher-melina cannot get food (no-funds)
- tick 258: weaver-zoe cannot get food (no-seller)
- tick 259: weaver-zoe prayed to zeus: help with food [evt-259-4514] (a trouble in the god's domain: routed to the domain god)
- tick 259: fisher-melina cannot get food (no-funds)
- tick 261: weaver-zoe cannot get food (no-seller)
- tick 264: fisher-melina cannot get food (no-funds)
- tick 267: fisher-melina cannot get food (no-funds)
- tick 268: weaver-zoe cannot get wool (no-buyer)
- tick 268: herdsman-damon's prayer to zeus lapsed unanswered [evt-117-2178]
- tick 268: herdsman-damon remembers zeus's silence
- tick 268: herdsman-damon → zeus: affinity -2, grudge +1
- tick 270: a quake in poseidon's domain (summer, the god's floor) damaged woodshed of woodcutter [evt-270-4672]
- tick 270: fisher-melina cannot get food (no-funds)
- tick 270: weaver-zoe cannot get wool (no-buyer)
- tick 272: fisher-melina prayed to poseidon: help with food [evt-272-4696] (routed to its patron)
- tick 272: weaver-zoe cannot get wool (no-buyer)
- tick 274: woodcutter prayed to poseidon: help with woodshed [evt-274-4718] (a trouble in the god's domain: routed to the domain god)
- tick 274: weaver-zoe cannot get wool (no-buyer)
- tick 274: ferryman's prayer to hermes lapsed unanswered [evt-123-2274]
- tick 274: ferryman remembers hermes's silence
- tick 274: ferryman → hermes: affinity -2, grudge +1
- tick 275: fisher-melina cannot get fish (no-buyer)
- tick 275: fisher-stavros cannot get food (no-seller)
- tick 276: fisher-stavros prayed to poseidon: help with food [evt-276-4766] (routed to its patron)
- tick 276: market-trader-iris cannot get food (no-funds)
- tick 276: weaver-zoe cannot get wool (no-buyer)
- tick 278: a vanished-goods in hermes's domain (summer, the god's floor) took 2 fish of farmer [evt-278-4804]
- tick 278: weaver-zoe cannot get wool (no-buyer)
- tick 279: woodcutter cannot get food (no-seller)
- tick 279: fisher-eleni cannot get food (no-seller)
- tick 279: fisher-dion cannot get food (no-seller)
- tick 279: olive-grower-aristo cannot get food (no-seller)
- tick 279: olive-grower-leon cannot get food (no-seller)
- tick 279: weaver-ismene cannot get food (no-seller)
- tick 279: weaver-xenia cannot get food (no-seller)
- tick 279: smith-brontes cannot get food (no-seller)
- tick 279: smith-delia cannot get food (no-seller)
- tick 280: farmer prayed to hermes: help with fish [evt-280-4834] (a trouble in the god's domain: routed to the domain god)
- tick 280: fisher-kallias cannot get fish (no-buyer)
- tick 280: fisher-melina cannot get fish (no-buyer)
- tick 280: fisher-stavros cannot get fish (no-buyer)
- tick 280: weaver-zoe cannot get wool (no-buyer)
- tick 285: weaver-zoe cannot get wool (no-buyer)
- tick 286: smith-brontes wronged market-trader-iris: feud of 2 cloth; quarrelsome, not in need [evt-286-4979]
- tick 287: weaver-zoe cannot get wool (no-buyer)
- tick 288: market-trader-iris prayed to hermes: punish smith-brontes, who owns  [evt-288-5030] (routed to its patron)
- tick 288: olive-grower-leon cannot get food (no-seller)
- tick 289: olive-grower-leon prayed to hades: help with currency [evt-289-5055] (a trouble in the god's domain: routed to the domain god)
- tick 289: a cracked-tools in hephaestus's domain (summer, the god's floor) took 2 tools of smith-ktesias [evt-289-5066]
- tick 289: weaver-zoe cannot get wool (no-buyer)
- tick 290: olive-grower-aristo wronged smith-ktesias: unpaid-debt of 3 currency; greedy, not in need; the credit [evt-190-3346] failed [evt-290-5086]
- tick 290: fisher-kallias cannot get fish (no-buyer)
- tick 290: fisher-melina cannot get fish (no-buyer)
- tick 290: fisher-stavros cannot get fish (no-buyer)
- tick 290: fisher-eleni cannot get food (no-seller)
- tick 290: olive-grower-aristo cannot get food (no-funds)
- tick 290: market-trader-iris's prayer to hermes lapsed unanswered [evt-139-2475]
- tick 290: market-trader-iris remembers hermes's silence
- tick 290: market-trader-iris → hermes: affinity -2, grudge +1
- tick 291: fisher-eleni prayed to athena: punish woodcutter, who owns woodshed [evt-291-5127] (routed to its patron)
- tick 291: a lightning-fire in zeus's domain (summer, the season's odds) took 2 food of ferryman [evt-291-5136]
- tick 291: olive-grower-leon cannot get food (no-seller)
- tick 291: weaver-zoe cannot get wool (no-buyer)
- tick 292: fisher-kallias cannot get fish (no-buyer)
- tick 292: fisher-melina cannot get fish (no-buyer)
- tick 292: fisher-stavros cannot get fish (no-buyer)
- tick 293: fisher-eleni cannot get food (no-seller)
- tick 294: fisher-eleni cannot get fish (no-buyer)
- tick 295: ferryman prayed to zeus: help with food [evt-295-5198] (a trouble in the god's domain: routed to the domain god)
- tick 295: olive-grower-leon cannot get olives (no-buyer)
- tick 296: market-trader-iris cannot get food (no-funds)
- tick 298: fisher-stavros cannot get food (no-funds)
- tick 299: fisher-stavros's prayer to poseidon lapsed unanswered [evt-148-2615]
- tick 299: fisher-stavros remembers poseidon's silence
- tick 299: fisher-stavros → poseidon: affinity -2, grudge +1
- tick 300: fisher-eleni cannot get food (no-funds)

## Journeys

- journeys: 26 started: 26 arrived, 0 refused, 0 replaced, 0 still travelling

1. Hades: underworld-shore → ferry-dock, set out at tick 10, 1 hop, arrived at tick 10
   - tick 10: crossed from underworld-shore to ferry-dock
2. Hera: great-hall → ancient-olive-tree, set out at tick 20, 6 hops, arrived at tick 25
   - tick 20: moved to olympus-gate
   - tick 21: crossed from olympus-gate to mountain-path
   - tick 22: moved to town-square
   - tick 23: moved to wilderness-path
   - tick 24: moved to wilderness-grove
   - tick 25: moved to ancient-olive-tree
3. Poseidon: ferry-dock → town-square, set out at tick 35, 1 hop, arrived at tick 35
   - tick 35: moved to town-square
4. Athena: ancient-olive-tree → ferry-dock, set out at tick 49, 4 hops, arrived at tick 52
   - tick 49: moved to wilderness-grove
   - tick 50: moved to wilderness-path
   - tick 51: moved to town-square
   - tick 52: moved to ferry-dock
5. Hades: ferry-dock → underworld-shore, set out at tick 57, 1 hop, arrived at tick 57
   - tick 57: crossed from ferry-dock to underworld-shore
6. Poseidon: town-square → ferry-dock, set out at tick 86, 1 hop, arrived at tick 86
   - tick 86: moved to ferry-dock
7. Zeus: great-hall → town-square, set out at tick 89, 3 hops, arrived at tick 91
   - tick 89: moved to olympus-gate
   - tick 90: crossed from olympus-gate to mountain-path
   - tick 91: moved to town-square
8. Hades: underworld-shore → judgment-hall, set out at tick 98, 2 hops, arrived at tick 99
   - tick 98: moved to asphodel-meadow
   - tick 99: moved to judgment-hall
9. Hera: ancient-olive-tree → wilderness-grove, set out at tick 110, 1 hop, arrived at tick 110
   - tick 110: moved to wilderness-grove
10. Hermes: ferry-dock → town-square, set out at tick 116, 1 hop, arrived at tick 116
   - tick 116: moved to town-square
11. Poseidon: ferry-dock → town-square, set out at tick 127, 1 hop, arrived at tick 127
   - tick 127: moved to town-square
12. Athena: ferry-dock → town-square, set out at tick 142, 1 hop, arrived at tick 142
   - tick 142: moved to town-square
13. Hades: judgment-hall → asphodel-meadow, set out at tick 144, 1 hop, arrived at tick 144
   - tick 144: moved to asphodel-meadow
14. Hephaestus: forge → town-square, set out at tick 149, 1 hop, arrived at tick 149
   - tick 149: moved to town-square
15. Hera: wilderness-grove → ancient-olive-tree, set out at tick 155, 1 hop, arrived at tick 155
   - tick 155: moved to ancient-olive-tree
16. Hermes: town-square → ferry-dock, set out at tick 165, 1 hop, arrived at tick 165
   - tick 165: moved to ferry-dock
17. Poseidon: town-square → ferry-dock, set out at tick 177, 1 hop, arrived at tick 177
   - tick 177: moved to ferry-dock
18. Zeus: town-square → olympus-gate, set out at tick 184, 2 hops, arrived at tick 185
   - tick 184: moved to mountain-path
   - tick 185: crossed from mountain-path to olympus-gate
19. Hades: asphodel-meadow → judgment-hall, set out at tick 197, 1 hop, arrived at tick 197
   - tick 197: moved to judgment-hall
20. Hephaestus: town-square → forge, set out at tick 204, 1 hop, arrived at tick 204
   - tick 204: moved to forge
21. Hera: ancient-olive-tree → town-square, set out at tick 214, 3 hops, arrived at tick 216
   - tick 214: moved to wilderness-grove
   - tick 215: moved to wilderness-path
   - tick 216: moved to town-square
22. Hermes: ferry-dock → town-square, set out at tick 225, 1 hop, arrived at tick 225
   - tick 225: moved to town-square
23. Zeus: olympus-gate → town-square, set out at tick 243, 2 hops, arrived at tick 244
   - tick 243: crossed from olympus-gate to mountain-path
   - tick 244: moved to town-square
24. Athena: town-square → forge, set out at tick 255, 1 hop, arrived at tick 255
   - tick 255: moved to forge
25. Hades: judgment-hall → ferry-dock, set out at tick 259, 3 hops, arrived at tick 261
   - tick 259: moved to asphodel-meadow
   - tick 260: moved to underworld-shore
   - tick 261: crossed from underworld-shore to ferry-dock
26. Hephaestus: forge → town-square, set out at tick 266, 1 hop, arrived at tick 266
   - tick 266: moved to town-square

## Practice threads

### supplication [evt-42-839]: zeus → woodcutter, fulfilled

- Opened at tick 42
- Cause: unmet-need (woodcutter) [evt-2-56]
- Answers the prayer [evt-5-106]
- Moves:
  1. tick 42, Zeus: offer — woodcutter offers zeus 1 currency by tick 132
  2. tick 43, woodcutter: accept
- Boon: seen given (evt-53-1045)
- Offering: not seen
- Ending: fulfilled at tick 54, by woodcutter; remembered by woodcutter, zeus
- Changed: zeus → woodcutter: affinity +1

## What each god practiced

- athena: travel; thread endings: none
- hades: travel; thread endings: none
- hephaestus: travel; thread endings: none
- hera: travel; thread endings: none
- hermes: travel; thread endings: none
- poseidon: travel; thread endings: none
- zeus: supplication, travel; thread endings: fulfilled [evt-42-839] by its act

## Open threads at the end

No thread was open at the end.

## Moves judged no progress

No move was judged no progress.

## Turns while an obligation was open

A turn is performed, waited for a named event, or knowingly risked breach (R12, amended 2026-10-03: an acceptance binds).

Each turn is classified from the god's prompt and its proposal. An acceptance binds, so the god performs, waits, or risks breach, and bargaining is for a thread still open: the action the term calls for, committed, is performed; a turn that did something else is waited for a named event when its prompt shows what stops it (the digest's UNPERFORMABLE obstacle, or no mortal at the place a legend is to be told); every other turn, an attempt to bargain over the accepted thread included, is knowingly risked breach, since the obligation led the prompt.

| God | Tick | Thread | Deadline | Chose | Classified | Waiting for |
| --- | --- | --- | --- | --- | --- | --- |
| zeus | 49 | evt-42-839 | 132 | bless | performed |  |

## Repetition

- Athena: longest run 1 of legend:legend (cap 3). Choices: legend:legend ×2, travel:ferry-dock ×1, travel:town-square ×1, report:farmer ×1, travel:forge ×1
- Hades: longest run 1 of travel:ferry-dock (cap 3). Choices: travel:ferry-dock ×2, travel:judgment-hall ×2, travel:underworld-shore ×1, travel:asphodel-meadow ×1
- Hephaestus: longest run 3 of legend:legend (cap 3). Choices: legend:legend ×3, travel:town-square ×2, travel:forge ×1
- Hera: longest run 1 of travel:ancient-olive-tree (cap 3). Choices: travel:ancient-olive-tree ×2, report:weaver-ismene ×1, travel:wilderness-grove ×1, travel:town-square ×1, report:market-trader-iris ×1
- Hermes: longest run 2 of report:ferryman (cap 3). Choices: report:ferryman ×2, travel:town-square ×2, travel:ferry-dock ×1, report:market-trader-iris ×1
- Poseidon: longest run 1 of travel:town-square (cap 3). Choices: travel:town-square ×2, travel:ferry-dock ×2, report:ferryman ×1
- Zeus: longest run 1 of practice:offer evt-5-106 (cap 3). Choices: travel:town-square ×2, practice:offer evt-5-106 ×1, bless:evt-5-106 ×1, report:woodcutter ×1, travel:olympus-gate ×1

## Automated checks

| God | Check | Result | Detail |
| --- | --- | --- | --- |
| Athena | profile trace | pass | 6 actions: 2 ability-backed, 4 context-backed |
| Athena | repetition | pass | longest run 1 of legend:legend (cap 3) |
| Athena | minimum activity | pass | 6 committed model actions (at least 5) |
| Athena | influence | pass | 8 caused (told belief) |
| Athena | petition heard | pass | 8 petitions addressed to this god (at least 1) |
| Athena | petition answered | FAIL | 8 heard, none answered (at least 1) |
| Hades | profile trace | pass | 6 actions: 0 ability-backed, 6 context-backed |
| Hades | repetition | pass | longest run 1 of travel:ferry-dock (cap 3) |
| Hades | minimum activity | pass | 6 committed model actions (at least 5) |
| Hades | influence | FAIL | no told belief or relationship change traces to this god's proposals |
| Hades | petition heard | pass | 1 petition addressed to this god (at least 1) |
| Hades | petition answered | pass | 1 heard; this god has no bless or strike to answer with, so none is required |
| Hephaestus | profile trace | pass | 6 actions: 3 ability-backed, 3 context-backed |
| Hephaestus | repetition | pass | longest run 3 of legend:legend (cap 3) |
| Hephaestus | minimum activity | pass | 6 committed model actions (at least 5) |
| Hephaestus | influence | pass | 8 caused (told belief) |
| Hephaestus | petition heard | FAIL | no petition was addressed to this god (at least 1) |
| Hephaestus | petition answered | FAIL | 0 heard, none answered (at least 1) |
| Hera | profile trace | pass | 6 actions: 0 ability-backed, 6 context-backed |
| Hera | repetition | pass | longest run 1 of travel:ancient-olive-tree (cap 3) |
| Hera | minimum activity | pass | 6 committed model actions (at least 5) |
| Hera | influence | pass | 2 caused (told belief) |
| Hera | petition heard | pass | 4 petitions addressed to this god (at least 1) |
| Hera | petition answered | FAIL | 4 heard, none answered (at least 1) |
| Hermes | profile trace | pass | 6 actions: 3 ability-backed, 3 context-backed |
| Hermes | repetition | pass | longest run 2 of report:ferryman (cap 3) |
| Hermes | minimum activity | pass | 6 committed model actions (at least 5) |
| Hermes | influence | pass | 3 caused (told belief) |
| Hermes | petition heard | pass | 7 petitions addressed to this god (at least 1) |
| Hermes | petition answered | FAIL | 7 heard, none answered (at least 1) |
| Poseidon | profile trace | pass | 5 actions: 0 ability-backed, 5 context-backed |
| Poseidon | repetition | pass | longest run 1 of travel:town-square (cap 3) |
| Poseidon | minimum activity | pass | 5 committed model actions (at least 5) |
| Poseidon | influence | pass | 1 caused (told belief) |
| Poseidon | petition heard | pass | 12 petitions addressed to this god (at least 1) |
| Poseidon | petition answered | FAIL | 12 heard, none answered (at least 1) |
| Zeus | profile trace | pass | 6 actions: 0 ability-backed, 6 context-backed |
| Zeus | repetition | pass | longest run 1 of practice:offer evt-5-106 (cap 3) |
| Zeus | minimum activity | pass | 6 committed model actions (at least 5) |
| Zeus | influence | pass | 2 caused (relationship-changed, told belief) |
| Zeus | petition heard | pass | 4 petitions addressed to this god (at least 1) |
| Zeus | petition answered | pass | 1 of 4 answered (at least 1) |

## Model run

- 41 requests: 41 answered (41 native, 0 repaired), 0 exhausted; latency p50 6318 ms, p95 12381 ms; prompt p50 7095 / max 10471 characters; frames showed model-degraded in 0% of polls
- valid actions: held (41 proposals, all god actions, none rejected as malformed)
- perception compliance: held (every id named by 41 proposals was in the prompt behind it)
- relationship change with provenance: held (112 changes, 112 explained from the log alone, e.g. wrong > memory-recorded > relationship-changed)
- changed next action: held (hephaestus: legend: before its first belief, travel:town-square after (changed); hermes: report:ferryman before its first belief, travel:town-square after (changed); poseidon: travel:ferry-dock before its first belief, travel:town-square after (changed); zeus: bless:evt-5-106 before its first belief, travel:town-square after (changed))
- goal privacy: held (41 prompts checked against 0 goals: none carried another god's goal outside a told account or a perceived legend)
- petition privacy: held (41 prompts checked against 36 petitions: none listed a petition addressed to another god, and none carried one the god did not witness)
- god thread endings: FAILED (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: no thread ending it caused left a persistent consequence; hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: 1 (fulfilled [evt-42-839]))
- supplication and settlement: FAILED (1 supplications, 0 settlements, 0 refused or breached)
- thread endings recorded: held (1 threads: 1 ended with their parties remembering, 0 still open and inside their deadlines)
- no reopening without a new cause: held (0 settlements, 0 opened as linked successors on a newer cause, none reopened a closed matter on an old one)
- no-progress moves advance nothing: held (0 moves judged no progress, each leaving a refusal record and advancing no thread; no counter restated an earlier offer)
- consequence changes a later choice: held (zeus: bless: before the consequence, travel:town-square after (changed); the prompt behind it showed how the thread ended)
- obligated turns recorded: held (1 obligated turns, each with its recorded choice: 1 performed)
- contest endings: held (no contest was opened)
- alliances sealed by agreement: held (no alliance was formed)

Requests, in the order they ran (one at a time):

| # | God | Asked at tick | Applied at tick | Latency | Outcome | Prompt chars |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | athena | 1 | 7 | 5.8 s | answered | 5414 |
| 2 | hades | 7 | 10 | 2.0 s | answered | 3551 |
| 3 | hephaestus | 10 | 15 | 4.2 s | answered | 4848 |
| 4 | hera | 15 | 20 | 4.4 s | answered | 6740 |
| 5 | hermes | 20 | 29 | 8.1 s | answered | 6337 |
| 6 | poseidon | 29 | 35 | 5.9 s | answered | 7217 |
| 7 | zeus | 35 | 42 | 6.7 s | answered | 6510 |
| 8 | athena | 42 | 49 | 6.8 s | answered | 7533 |
| 9 | zeus | 49 | 53 | 3.1 s | answered | 5782 |
| 10 | hades | 53 | 57 | 3.7 s | answered | 4653 |
| 11 | hephaestus | 57 | 62 | 4.3 s | answered | 5113 |
| 12 | hera | 62 | 70 | 7.9 s | answered | 8298 |
| 13 | hermes | 70 | 77 | 6.7 s | answered | 6501 |
| 14 | poseidon | 77 | 86 | 8.6 s | answered | 9293 |
| 15 | zeus | 86 | 89 | 2.3 s | answered | 5076 |
| 16 | athena | 89 | 96 | 6.6 s | answered | 7611 |
| 17 | hades | 96 | 98 | 1.9 s | answered | 3675 |
| 18 | hephaestus | 98 | 103 | 4.3 s | answered | 5300 |
| 19 | hera | 103 | 110 | 6.4 s | answered | 8389 |
| 20 | hermes | 110 | 116 | 5.7 s | answered | 6798 |
| 21 | poseidon | 116 | 127 | 10.2 s | answered | 10411 |
| 22 | zeus | 127 | 136 | 8.4 s | answered | 8499 |
| 23 | athena | 136 | 142 | 5.5 s | answered | 7443 |
| 24 | hades | 142 | 144 | 1.8 s | answered | 3735 |
| 25 | hephaestus | 144 | 149 | 4.4 s | answered | 5987 |
| 26 | hera | 149 | 155 | 5.5 s | answered | 7334 |
| 27 | hermes | 155 | 165 | 9.5 s | answered | 8821 |
| 28 | poseidon | 165 | 177 | 11.1 s | answered | 10471 |
| 29 | zeus | 177 | 184 | 7.0 s | answered | 8617 |
| 30 | athena | 184 | 195 | 10.2 s | answered | 8751 |
| 31 | hades | 195 | 197 | 1.8 s | answered | 3765 |
| 32 | hephaestus | 197 | 204 | 6.0 s | answered | 6503 |
| 33 | hera | 204 | 214 | 9.8 s | answered | 9474 |
| 34 | hermes | 214 | 225 | 10.3 s | answered | 8977 |
| 35 | poseidon | 225 | 238 | 12.4 s | answered | 9940 |
| 36 | zeus | 238 | 243 | 5.0 s | answered | 7095 |
| 37 | athena | 243 | 255 | 11.4 s | answered | 10276 |
| 38 | hades | 255 | 259 | 3.8 s | answered | 3767 |
| 39 | hephaestus | 259 | 266 | 6.3 s | answered | 6087 |
| 40 | hera | 266 | 280 | 13.8 s | answered | 9107 |
| 41 | hermes | 280 | 295 | 14.4 s | answered | 9484 |
| 42 | poseidon | ≈294 | — | — | in flight at the end (inferred) | — |

Each god's turns (finished requests; the gap is the ticks between its request starts):

| God | Turns | Median gap (ticks) | p95 gap (ticks) | Worst gap (ticks) | Median latency |
| --- | --- | --- | --- | --- | --- |
| athena | 6 | 47 | 59 | 59 | 6.7 s |
| hades | 6 | 46 | 60 | 60 | 2.0 s |
| hephaestus | 6 | 47 | 62 | 62 | 4.4 s |
| hera | 6 | 47 | 62 | 62 | 7.1 s |
| hermes | 6 | 50 | 66 | 66 | 8.8 s |
| poseidon | 5 | 48.5 | 60 | 60 | 10.2 s |
| zeus | 6 | 41 | 61 | 61 | 5.8 s |

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

# Episode 1 of 3

## Settings

- Recorded: 2026-10-07T19:09:55.938Z
- Model: gemma4-e4b-4k through local Ollama, 4K context, reasoning off (reasoning_effort none)
- Length: 300 s (298 ticks)
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

1. **tick 11, Hades:** legend (ability-backed)
   - says: "The dead shall have their due respect within my realm, and the order of things shall be maintained."
   - heard by: no one
   - caused: legend-recorded (hades)
2. **tick 23, Hera:** report → zeus (context-backed)
   - says: "It seems the mortals still need aid. I feel compelled to assist the farmer's plight regarding the planks."
   - caused: report-told (hera → zeus)
   - then: zeus now believes hera: "It seems the mortals still need aid. I feel compelled to assist the farmer's plight regarding the planks."
3. **tick 39, Poseidon:** report → hermes (context-backed)
   - says: "The mortal realm feels distant, and old rivalries still burn bright in my heart. I will aim to quell the tension over these matters."
   - caused: report-told (poseidon → hermes)
   - then: hermes now believes poseidon: "The mortal realm feels distant, and old rivalries still burn bright in my heart. I will aim to quell the tension over these matters."
4. **tick 39, Poseidon:** goal set → fisher-dion (declaration)
   - goal: "Address the prayer concerning fisher-dion at town-square by striking him."
5. **tick 45, Zeus:** bless → evt-5-106 (context-backed)
   - caused: resource-consumed (zeus); blessing-granted (zeus)
   - then: woodcutter → zeus: affinity +1
6. **tick 56, Hades:** legend (ability-backed)
   - says: "The dead shall have their due respect within my realm, and my order shall prevail."
   - heard by: no one
   - caused: legend-recorded (hades)
7. **tick 64, Hera:** report → zeus (context-backed)
   - says: "My compassion extends even to the plight of mortals. I must address the pleas before me."
   - caused: report-told (hera → zeus)
   - then: zeus now believes hera: "My compassion extends even to the plight of mortals. I must address the pleas before me."
8. **tick 64, Hera:** goal set → altar (declaration)
   - goal: "To address the prayers from the farmer."
9. **tick 70, Hermes:** bless → evt-7-162 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: market-trader-iris → hermes: affinity +1
10. **tick 82, Poseidon:** report → hermes (context-backed)
   - says: "I see that a prayer asks for punishment against fisher-dion. I will address the goal now and strike him at town-square."
   - under goal: "Address the prayer concerning fisher-dion at town-square by striking him." (→ fisher-dion)
   - caused: report-told (poseidon → hermes)
   - then: hermes now believes poseidon: "I see that a prayer asks for punishment against fisher-dion. I will address the goal now and strike him at town-square."
11. **tick 82, Poseidon:** goal ended (abandoned) (declaration)
   - goal: "Address the prayer concerning fisher-dion at town-square by striking him."
12. **tick 82, Poseidon:** goal set → fisher-dion (declaration)
   - goal: "Strike fisher-dion at town-square using the available power."
13. **tick 89, Zeus:** legend (ability-backed)
   - says: "Attend to the matters here; the divine order requires my decree. The cares of mortals and gods shall be judged by my might."
   - heard by: hera
   - caused: legend-recorded (zeus)
   - then: hera now believes zeus: "Attend to the matters here; the divine order requires my decree. The cares of mortals and gods shall be judged by my might."
14. **tick 102, Hades:** legend (ability-backed)
   - says: "The boundaries of life and death must be respected within my domain."
   - heard by: no one
   - caused: legend-recorded (hades)
15. **tick 102, Hades:** goal set → judgment-hall (declaration)
   - goal: "Establish my authority in the underworld."
16. **tick 118, Hera:** report → zeus (context-backed)
   - says: "The mortals still bear burdens, one concerning food and another regarding planks. They call to me at the town square."
   - under goal: "To address the prayers from the farmer." (→ altar)
   - caused: report-told (hera → zeus)
   - then: zeus now believes hera: "The mortals still bear burdens, one concerning food and another regarding planks. They call to me at the town square."
17. **tick 146, Poseidon:** report → hermes (context-backed)
   - says: "The prayers from the mortals here and at town-square weigh heavily on me. The rivalry with Athena and Hera still embers in my mind."
   - under goal: "Strike fisher-dion at town-square using the available power." (→ fisher-dion)
   - caused: report-told (poseidon → hermes)
   - then: hermes now believes poseidon: "The prayers from the mortals here and at town-square weigh heavily on me. The rivalry with Athena and Hera still embers in my mind."
18. **tick 146, Poseidon:** goal ended (abandoned) (declaration)
   - goal: "Strike fisher-dion at town-square using the available power."
19. **tick 146, Poseidon:** goal set → town-square (declaration)
   - goal: "Strike fisher-dion at town-square using the available power."
20. **tick 154, Zeus:** report → hera (context-backed)
   - says: "I shall address these matters of food and planks directly. I will make my decrees from this place."
   - caused: report-told (zeus → hera)
   - then: hera now believes zeus: "I shall address these matters of food and planks directly. I will make my decrees from this place."
21. **tick 171, Athena:** report → herdsman-damon (context-backed)
   - says: "The mortals have sought counsel from me with their needs. I must direct them to the proper assistance. I will address the weaver first to aid her craft; this shall ensure order."
   - caused: report-told (athena → herdsman-damon)
   - then: herdsman-damon now believes athena: "The mortals have sought counsel from me with their needs. I must direct them to the proper assistance. I will address the weaver first to aid her craft; this shall ensure order."
22. **tick 171, Athena:** goal set → town-square (declaration)
   - goal: "bless the weaver-zoe's prayer by helping freely with food."
23. **tick 182, Hades:** bless → evt-162-2836 (context-backed)
   - under goal: "Establish my authority in the underworld." (→ judgment-hall)
   - caused: resource-consumed (hades); blessing-granted (hades)
   - then: herdsman-damon → hades: affinity +1
24. **tick 202, Hera:** report → zeus (context-backed)
   - says: "The mortals still bear weight upon their hearts, concerning both pleas for justice and the needs of the earth. The farmer seeks aid in two matters."
   - under goal: "To address the prayers from the farmer." (→ altar)
   - caused: report-told (hera → zeus)
   - then: zeus now believes hera: "The mortals still bear weight upon their hearts, concerning both pleas for justice and the needs of the earth. The farmer seeks aid in two matters."
25. **tick 211, Hermes:** practice → offer evt-170-2956 (context-backed)
   - caused: practice-opened (hermes)
26. **tick 220, Poseidon:** report → hermes (context-backed)
   - says: "The scent of brine and ambition hangs in the air among us. I must address that unresolved prayer at the town-square now."
   - under goal: "Strike fisher-dion at town-square using the available power." (→ town-square)
   - caused: report-told (poseidon → hermes)
   - then: hermes now believes poseidon: "The scent of brine and ambition hangs in the air among us. I must address that unresolved prayer at the town-square now."
27. **tick 237, Zeus:** report → hera (context-backed)
   - says: "Attend to the matters concerning food and justice, for my decree must be heard. I shall address these needs from this place."
   - claim: kindness by zeus on hera
   - caused: report-told (zeus → hera)
   - then: hera now believes zeus: "Attend to the matters concerning food and justice, for my decree must be heard. I shall address these needs from this place."
   - then: hera → zeus: affinity +1
28. **tick 247, Athena:** bless → evt-112-2136 (ability-backed)
   - under goal: "bless the weaver-zoe's prayer by helping freely with food." (→ town-square)
   - caused: resource-consumed (athena); blessing-granted (athena)
   - then: weaver-zoe → athena: affinity +1
29. **tick 251, Hades:** travel → judgment-hall (context-backed)
   - under goal: "Establish my authority in the underworld." (→ judgment-hall)
   - caused: journey-started (hades)
30. **tick 270, Hera:** report → zeus (context-backed)
   - says: "The farmer seeks justice for an unpaid debt from fisher-kallias at the ferry-dock. I must address this complaint."
   - under goal: "To address the prayers from the farmer." (→ altar)
   - caused: report-told (hera → zeus)
   - then: zeus now believes hera: "The farmer seeks justice for an unpaid debt from fisher-kallias at the ferry-dock. I must address this complaint."
31. **tick 270, Hera:** goal ended (abandoned) (declaration)
   - goal: "To address the prayers from the farmer."
32. **tick 270, Hera:** goal set → altar (declaration)
   - goal: "Address the prayers from the farmer."
33. **tick 282, Hermes:** bless → evt-170-2956 (ability-backed)
   - caused: resource-consumed (hermes); blessing-granted (hermes)
   - then: fisher-dion → hermes: affinity +1

## What the world did with every proposal

- dispositions: report 12 × committed, bless 5 × committed, legend 4 × committed, practice 1 × committed, travel 1 × committed

1. Hades: legend → legend — committed: legend-recorded
2. Hera: report → zeus — committed: report-told
3. Poseidon: report → hermes — committed: report-told, goal-set
4. Zeus: bless → evt-5-106 — committed: resource-consumed, blessing-granted
5. Hades: legend → legend — committed: legend-recorded
6. Hera: report → zeus — committed: report-told, goal-set
7. Hermes: bless → evt-7-162 — committed: resource-consumed, blessing-granted
8. Poseidon: report → hermes — committed: report-told, goal-ended, goal-set
9. Zeus: legend → legend — committed: legend-recorded
10. Hades: legend → legend — committed: legend-recorded, goal-set
11. Hera: report → zeus — committed: report-told
12. Poseidon: report → hermes — committed: report-told, goal-ended, goal-set
13. Zeus: report → hera — committed: report-told
14. Athena: report → herdsman-damon — committed: report-told, goal-set
15. Hades: bless → evt-162-2836 — committed: resource-consumed, blessing-granted
16. Hera: report → zeus — committed: report-told
17. Hermes: practice → offer evt-170-2956 — committed: practice-opened
18. Poseidon: report → hermes — committed: report-told
19. Zeus: report → hera — committed: report-told
20. Athena: bless → evt-112-2136 — committed: resource-consumed, blessing-granted
21. Hades: travel → judgment-hall — committed: journey-started
22. Hera: report → zeus — committed: report-told, goal-ended, goal-set
23. Hermes: bless → evt-170-2956 — committed: resource-consumed, blessing-granted

## The episode's numbers

- Food: 65 "cannot get food" lines; 15 of 34 prayers are about food
- Troubles in a god's domain: Athena 3, Hades 2, Hephaestus 2, Hera 2, Hermes 2, Poseidon 2, Zeus 2
- Wrongs between mortals: 6; 5 between different patrons
  - [evt-1-23] fisher-dion (hermes) wronged fisher-kallias (poseidon): cheating; the victim prayed [evt-5-110]; no consequence yet
  - [evt-61-1154] woodcutter (zeus) wronged fisher-stavros (poseidon): feud; the victim did not pray about it; no consequence yet
  - [evt-171-2985] fisher-kallias (poseidon) wronged farmer (hera): unpaid-debt; the victim prayed [evt-173-3041]; no consequence yet
  - [evt-195-3470] smith-brontes (hephaestus) wronged provisioner-nikanor (hermes): feud; the victim prayed [evt-199-3529]; no consequence yet
  - [evt-287-5077] fisher-kallias (poseidon) wronged ferryman (hades): theft; the victim prayed [evt-290-5128]; no consequence yet
- Defections: 0
- From a prayer's cause to its closing: 16 closed (median 153 ticks, p95 156 ticks); by outcome lapsed 11, answered 5

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
- tick 36: a tool-flaw in athena's domain (spring, the god's floor) took 2 planks of farmer [evt-36-729]
- tick 37: woodcutter cannot get food (no-seller)
- tick 38: farmer prayed to athena: help with planks [evt-38-751] (a trouble in the god's domain: routed to the domain god)
- tick 45: zeus blessed woodcutter: 2 food
- tick 45: zeus answered woodcutter's prayer [evt-5-106]
- tick 45: woodcutter remembers zeus's answer
- tick 45: woodcutter → zeus: affinity +1
- tick 50: a hoard-swallowed in hades's domain (spring, the god's floor) took 2 currency of weaver-zoe [evt-50-958]
- tick 55: a roof-leak in hera's domain (spring, the god's floor) took 2 food of farmer [evt-55-1036]
- tick 60: farmer prayed to hera: help with food [evt-60-1114] (a trouble in the god's domain: routed to the domain god)
- tick 60: fisher-eleni cannot get food (no-seller)
- tick 61: woodcutter wronged fisher-stavros: feud of 1 food; quarrelsome, not in need [evt-61-1154]
- tick 67: a tool-flaw in athena's domain (spring, the season's odds) took 2 tools of smith-delia [evt-67-1276]
- tick 68: fisher-kallias cannot get food (no-funds)
- tick 69: fisher-stavros cannot get food (no-seller)
- tick 70: hermes blessed market-trader-iris: 2 wine
- tick 70: fisher-kallias prayed to poseidon: help with food [evt-70-1327] (routed to its patron)
- tick 70: fisher-stavros prayed to poseidon: help with food [evt-70-1329] (routed to its patron)
- tick 70: hermes answered market-trader-iris's prayer [evt-7-162]
- tick 70: market-trader-iris remembers hermes's answer
- tick 70: market-trader-iris → hermes: affinity +1
- tick 74: fisher-stavros cannot get fish (no-buyer)
- tick 75: fisher-kallias cannot get fish (no-buyer)
- tick 81: a harbour-surge in poseidon's domain (spring, the god's floor) damaged fish-landing of ferryman [evt-81-1537]
- tick 84: ferryman prayed to poseidon: help with fish-landing [evt-84-1581] (a trouble in the god's domain: routed to the domain god)
- tick 85: fisher-melina cannot get food (no-funds)
- tick 87: fisher-melina prayed to poseidon: help with food [evt-87-1643] (routed to its patron)
- tick 88: olive-grower-aristo cannot get food (no-funds)
- tick 90: olive-grower-aristo prayed to athena: help with food [evt-90-1714] (routed to its patron)
- tick 90: fisher-kallias cannot get fish (no-buyer)
- tick 90: fisher-melina cannot get fish (no-buyer)
- tick 90: fisher-stavros cannot get fish (no-buyer)
- tick 95: olive-grower-aristo cannot get olives (no-buyer)
- tick 97: olive-grower-aristo cannot get olives (no-buyer)
- tick 99: weaver-ismene cannot get wool (no-buyer)
- tick 99: weaver-xenia cannot get wool (no-buyer)
- tick 101: weaver-ismene cannot get wool (no-buyer)
- tick 101: weaver-xenia cannot get wool (no-buyer)
- tick 103: weaver-ismene cannot get wool (no-buyer)
- tick 103: weaver-xenia cannot get wool (no-buyer)
- tick 105: fisher-melina cannot get food (no-funds)
- tick 105: weaver-ismene cannot get wool (no-buyer)
- tick 105: weaver-xenia cannot get wool (no-buyer)
- tick 107: weaver-ismene cannot get wool (no-buyer)
- tick 107: weaver-xenia cannot get wool (no-buyer)
- tick 108: olive-grower-aristo cannot get food (no-funds)
- tick 109: weaver-ismene cannot get wool (no-buyer)
- tick 109: weaver-xenia cannot get wool (no-buyer)
- tick 110: fisher-melina cannot get food (no-funds)
- tick 111: weaver-ismene cannot get wool (no-buyer)
- tick 111: weaver-zoe cannot get food (no-seller)
- tick 111: weaver-xenia cannot get wool (no-buyer)
- tick 112: weaver-zoe prayed to athena: help with food [evt-112-2136] (routed to its patron)
- tick 112: a lightning-fire in zeus's domain (spring, the god's floor) took 2 food of herdsman-damon [evt-112-2145]
- tick 113: weaver-ismene cannot get wool (no-buyer)
- tick 113: weaver-xenia cannot get food (no-seller)
- tick 115: weaver-ismene cannot get food (no-seller)
- tick 115: weaver-zoe cannot get food (no-seller)
- tick 116: market-trader-iris cannot get food (no-funds)
- tick 117: herdsman-damon prayed to zeus: help with food [evt-117-2229] (a trouble in the god's domain: routed to the domain god)
- tick 117: weaver-zoe cannot get wool (no-buyer)
- tick 119: weaver-zoe cannot get wool (no-buyer)
- tick 120: olive-grower-aristo cannot get food (no-funds)
- tick 120: the director made smith-ktesias take 108 food from ferryman
- tick 121: weaver-zoe cannot get wool (no-buyer)
- tick 123: ferryman prayed to hermes: help with food [evt-123-2323] (not its authored patron (a defection or a domain))
- tick 124: a vanished-goods in hermes's domain (spring, the god's floor) took 2 food of smith-ktesias [evt-124-2344]
- tick 125: weaver-zoe cannot get wool (no-buyer)
- tick 127: weaver-zoe cannot get wool (no-buyer)
- tick 129: olive-grower-phoebe cannot get food (no-funds)
- tick 129: weaver-zoe cannot get wool (no-buyer)
- tick 130: market-trader-iris cannot get food (no-funds)
- tick 131: weaver-zoe cannot get wool (no-buyer)
- tick 134: olive-grower-aristo cannot get food (no-funds)
- tick 136: market-trader-iris cannot get food (no-funds)
- tick 139: a cracked-tools in hephaestus's domain (spring, the god's floor) took 2 tools of smith-delia [evt-139-2551]
- tick 140: olive-grower-aristo cannot get food (no-funds)
- tick 149: olive-grower-phoebe cannot get food (no-funds)
- tick 154: farmer's prayer to hera lapsed unanswered [evt-3-60]
- tick 154: farmer remembers hera's silence
- tick 154: farmer → hera: affinity -2, grudge +1
- tick 156: market-trader-iris cannot get food (no-funds)
- tick 156: fisher-kallias's prayer to poseidon lapsed unanswered [evt-5-110]
- tick 156: fisher-kallias remembers poseidon's silence
- tick 156: fisher-kallias → poseidon: affinity -2, grudge +1
- tick 157: a hoard-swallowed in hades's domain (spring, the god's floor) took 1 currency of herdsman-damon [evt-157-2771]
- tick 158: market-trader-iris prayed to hermes: help with food [evt-158-2777] (routed to its patron)
- tick 161: a squall in zeus's domain (spring, the god's floor) damaged olive-press of olive-grower-aristo [evt-161-2828]
- tick 161: olive-grower-aristo cannot get food (no-funds)
- tick 162: herdsman-damon prayed to hades: help with currency [evt-162-2836] (a trouble in the god's domain: routed to the domain god)
- tick 165: a crossing-loss in hermes's domain (spring, the god's floor) took 2 fish of fisher-eleni [evt-165-2874]
- tick 166: a loom-break in athena's domain (spring, the god's floor) damaged loom-house of weaver-ismene [evt-166-2891]
- tick 166: fisher-eleni cannot get food (no-seller)
- tick 166: olive-grower-leon cannot get food (no-funds)
- tick 167: fisher-eleni prayed to athena: help with food [evt-167-2900] (routed to its patron)
- tick 167: fisher-melina cannot get fish (no-buyer)
- tick 167: fisher-stavros cannot get fish (no-buyer)
- tick 167: fisher-dion cannot get fish (no-buyer)
- tick 168: fisher-kallias cannot get food (no-funds)
- tick 168: fisher-stavros cannot get food (no-seller)
- tick 169: fisher-melina prayed to poseidon: help with fish [evt-169-2935] (routed to its patron)
- tick 169: fisher-stavros prayed to poseidon: help with fish [evt-169-2936] (routed to its patron)
- tick 169: fisher-dion cannot get food (no-seller)
- tick 169: olive-grower-phoebe cannot get food (no-funds)
- tick 170: fisher-dion prayed to hermes: help with food [evt-170-2956] (routed to its patron)
- tick 171: fisher-kallias wronged farmer: unpaid-debt of 3 currency; greedy, not in need; the credit [evt-71-1364] failed [evt-171-2985]
- tick 171: fisher-eleni cannot get fish (no-buyer)
- tick 171: olive-grower-aristo cannot get food (no-funds)
- tick 172: fisher-kallias cannot get fish (no-buyer)
- tick 172: fisher-stavros cannot get food (no-seller)
- tick 172: fisher-stavros cannot get fish (no-buyer)
- tick 172: fisher-dion cannot get food (no-seller)
- tick 172: fisher-dion cannot get fish (no-buyer)
- tick 172: weaver-ismene cannot get food (no-seller)
- tick 172: weaver-zoe cannot get food (no-seller)
- tick 172: weaver-xenia cannot get food (no-seller)
- tick 172: smith-delia cannot get food (no-seller)
- tick 173: farmer prayed to hera: punish fisher-kallias, who owns  [evt-173-3041] (routed to its patron)
- tick 173: fisher-melina cannot get fish (no-buyer)
- tick 174: olive-grower-aristo cannot get olives (no-buyer)
- tick 174: olive-grower-phoebe cannot get olives (no-buyer)
- tick 174: olive-grower-leon cannot get olives (no-buyer)
- tick 175: fisher-kallias cannot get fish (no-buyer)
- tick 175: fisher-melina cannot get fish (no-buyer)
- tick 175: fisher-stavros cannot get fish (no-buyer)
- tick 175: fisher-eleni cannot get fish (no-buyer)
- tick 175: fisher-dion cannot get fish (no-buyer)
- tick 176: fisher-kallias prayed to poseidon: help with fish [evt-176-3111] (routed to its patron)
- tick 176: olive-grower-aristo cannot get olives (no-buyer)
- tick 176: olive-grower-phoebe cannot get olives (no-buyer)
- tick 176: olive-grower-leon cannot get olives (no-buyer)
- tick 177: olive-grower-aristo prayed to athena: help with olives [evt-177-3138] (routed to its patron)
- tick 177: olive-grower-phoebe prayed to athena: help with olives [evt-177-3139] (routed to its patron)
- tick 177: olive-grower-leon prayed to poseidon: help with olives [evt-177-3140] (routed to its patron)
- tick 178: olive-grower-aristo cannot get olives (no-buyer)
- tick 178: olive-grower-phoebe cannot get olives (no-buyer)
- tick 178: olive-grower-leon cannot get olives (no-buyer)
- tick 180: fisher-kallias cannot get fish (no-buyer)
- tick 181: olive-grower-aristo cannot get food (no-seller)
- tick 182: hades blessed herdsman-damon: 1 currency
- tick 182: fisher-kallias cannot get fish (no-buyer)
- tick 182: fisher-melina cannot get fish (no-buyer)
- tick 182: fisher-stavros cannot get fish (no-buyer)
- tick 182: fisher-eleni cannot get fish (no-buyer)
- tick 182: fisher-dion cannot get fish (no-buyer)
- tick 182: hades answered herdsman-damon's prayer [evt-162-2836]
- tick 182: herdsman-damon remembers hades's answer
- tick 182: herdsman-damon → hades: affinity +1
- tick 184: olive-grower-phoebe cannot get food (no-seller)
- tick 186: olive-grower-leon cannot get food (no-funds)
- tick 187: olive-grower-aristo cannot get olives (no-buyer)
- tick 188: olive-grower-phoebe cannot get olives (no-buyer)
- tick 189: olive-grower-phoebe cannot get food (no-funds)
- tick 189: farmer's prayer to athena lapsed unanswered [evt-38-751]
- tick 189: farmer remembers athena's silence
- tick 189: farmer → athena: affinity -2, grudge +1
- tick 190: fisher-kallias cannot get fish (no-buyer)
- tick 190: fisher-melina cannot get fish (no-buyer)
- tick 190: fisher-stavros cannot get fish (no-buyer)
- tick 190: fisher-dion cannot get fish (no-buyer)
- tick 190: olive-grower-phoebe cannot get olives (no-buyer)
- tick 191: olive-grower-aristo cannot get olives (no-buyer)
- tick 195: smith-brontes wronged provisioner-nikanor: feud of 2 food; quarrelsome, not in need [evt-195-3470]
- tick 196: market-trader-iris cannot get food (no-funds)
- tick 198: smith-brontes cannot get ore (no-buyer)
- tick 199: provisioner-nikanor prayed to hermes: punish smith-brontes, who owns  [evt-199-3529] (routed to its patron)
- tick 200: the season turned from spring to summer
- tick 200: smith-brontes cannot get ore (no-buyer)
- tick 207: fisher-kallias cannot get fish (no-buyer)
- tick 207: fisher-melina cannot get fish (no-buyer)
- tick 210: fisher-kallias cannot get fish (no-buyer)
- tick 210: fisher-melina cannot get fish (no-buyer)
- tick 211: farmer's prayer to hera lapsed unanswered [evt-60-1114]
- tick 211: farmer remembers hera's silence
- tick 211: farmer → hera: affinity -2, grudge +1
- tick 216: market-trader-iris cannot get food (no-funds)
- tick 221: fisher-kallias's prayer to poseidon lapsed unanswered [evt-70-1327]
- tick 221: fisher-stavros's prayer to poseidon lapsed unanswered [evt-70-1329]
- tick 221: fisher-kallias remembers poseidon's silence
- tick 221: fisher-stavros remembers poseidon's silence
- tick 221: fisher-kallias → poseidon: affinity -2, grudge +1
- tick 221: fisher-stavros → poseidon: affinity -2, grudge +1
- tick 222: olive-grower-aristo cannot get food (no-funds)
- tick 230: fisher-kallias cannot get fish (no-buyer)
- tick 230: fisher-melina cannot get fish (no-buyer)
- tick 230: fisher-stavros cannot get food (no-funds)
- tick 231: olive-grower-aristo cannot get food (no-seller)
- tick 232: fisher-stavros prayed to poseidon: help with food [evt-232-4054] (routed to its patron)
- tick 232: olive-grower-aristo prayed to zeus: help with olive-press [evt-232-4055] (a trouble in the god's domain: routed to the domain god)
- tick 233: market-trader-iris cannot get food (no-funds)
- tick 234: olive-grower-aristo cannot get food (no-funds)
- tick 235: fisher-stavros cannot get fish (no-buyer)
- tick 235: ferryman's prayer to poseidon lapsed unanswered [evt-84-1581]
- tick 235: ferryman remembers poseidon's silence
- tick 235: ferryman → poseidon: affinity -2, grudge +1
- tick 236: market-trader-iris cannot get food (no-funds)
- tick 237: fisher-eleni cannot get food (no-seller)
- tick 237: olive-grower-aristo cannot get olives (no-buyer)
- tick 238: fisher-eleni prayed to hermes: help with fish [evt-238-4176] (a trouble in the god's domain: routed to the domain god)
- tick 238: fisher-melina's prayer to poseidon lapsed unanswered [evt-87-1643]
- tick 238: fisher-melina remembers poseidon's silence
- tick 238: fisher-melina → poseidon: affinity -2, grudge +1
- tick 240: the director spoiled 11 olives of fisher-eleni
- tick 241: olive-grower-aristo's prayer to athena lapsed unanswered [evt-90-1714]
- tick 241: olive-grower-aristo remembers athena's silence
- tick 241: olive-grower-aristo → athena: affinity -2, grudge +1
- tick 242: fisher-kallias cannot get fish (no-buyer)
- tick 242: fisher-melina cannot get fish (no-buyer)
- tick 242: fisher-stavros cannot get fish (no-buyer)
- tick 242: fisher-eleni cannot get fish (no-buyer)
- tick 247: athena blessed weaver-zoe: 2 food
- tick 247: fisher-kallias cannot get fish (no-buyer)
- tick 247: fisher-melina cannot get fish (no-buyer)
- tick 247: fisher-stavros cannot get fish (no-buyer)
- tick 247: fisher-eleni cannot get fish (no-buyer)
- tick 247: athena answered weaver-zoe's prayer [evt-112-2136]
- tick 247: weaver-zoe remembers athena's answer
- tick 247: weaver-zoe → athena: affinity +1
- tick 249: fisher-stavros cannot get food (no-funds)
- tick 251: a quake in poseidon's domain (summer, the god's floor) damaged the-tavern of farmer [evt-251-4448]
- tick 255: weaver-ismene cannot get food (no-seller)
- tick 255: weaver-xenia cannot get food (no-seller)
- tick 255: smith-delia cannot get food (no-seller)
- tick 256: farmer prayed to poseidon: help with the-tavern [evt-256-4531] (a trouble in the god's domain: routed to the domain god)
- tick 256: market-trader-iris cannot get food (no-funds)
- tick 259: olive-grower-aristo wronged fisher-eleni: theft of 2 cloth; greedy, not in need [evt-259-4604]
- tick 260: fisher-eleni cannot get food (no-funds)
- tick 267: fisher-kallias cannot get fish (no-buyer)
- tick 267: fisher-melina cannot get fish (no-buyer)
- tick 267: fisher-stavros cannot get fish (no-buyer)
- tick 268: herdsman-damon's prayer to zeus lapsed unanswered [evt-117-2229]
- tick 268: herdsman-damon remembers zeus's silence
- tick 268: herdsman-damon → zeus: affinity -2, grudge +1
- tick 270: fisher-kallias cannot get fish (no-buyer)
- tick 270: fisher-melina cannot get fish (no-buyer)
- tick 270: fisher-stavros cannot get fish (no-buyer)
- tick 274: ferryman's prayer to hermes lapsed unanswered [evt-123-2323]
- tick 274: ferryman remembers hermes's silence
- tick 274: ferryman → hermes: affinity -2, grudge +1
- tick 276: market-trader-iris cannot get food (no-funds)
- tick 277: a damp in hera's domain (summer, the god's floor) took 2 cloth of olive-grower-leon [evt-277-4886]
- tick 282: hermes blessed fisher-dion: 2 food
- tick 282: a forge-flare in hephaestus's domain (summer, the god's floor) damaged the-forge of smith-ktesias [evt-282-4969]
- tick 282: hermes answered fisher-dion's prayer [evt-170-2956]
- tick 282: fisher-dion remembers hermes's answer
- tick 282: fisher-dion → hermes: affinity +1
- tick 283: olive-grower-leon cannot get food (no-seller)
- tick 283: olive-grower-leon cannot get cloth (no-seller)
- tick 284: olive-grower-leon prayed to poseidon: help with food [evt-284-5019] (routed to its patron)
- tick 285: fisher-eleni cannot get food (no-funds)
- tick 286: olive-grower-leon cannot get food (no-seller)
- tick 286: olive-grower-leon cannot get cloth (no-seller)
- tick 287: fisher-kallias wronged ferryman: theft of 2 food; greedy, not in need [evt-287-5077]
- tick 287: fisher-kallias cannot get fish (no-buyer)
- tick 287: fisher-melina cannot get fish (no-buyer)
- tick 287: fisher-stavros cannot get fish (no-buyer)
- tick 288: fisher-eleni cannot get food (no-funds)
- tick 290: ferryman prayed to hades: punish fisher-kallias, who owns  [evt-290-5128] (routed to its patron)
- tick 291: fisher-eleni cannot get food (no-funds)
- tick 292: olive-grower-leon cannot get olives (no-buyer)
- tick 293: fisher-eleni prayed to athena: punish olive-grower-aristo, who owns olive-press [evt-293-5184] (routed to its patron)
- tick 295: weaver-ismene cannot get food (no-seller)
- tick 296: weaver-ismene prayed to athena: help with food [evt-296-5243] (routed to its patron)
- tick 296: market-trader-iris cannot get food (no-funds)
- tick 296: fisher-eleni cannot get fish (no-buyer)
- tick 298: weaver-ismene cannot get food (no-seller)

## Journeys

- journeys: 1 started: 1 arrived, 0 refused, 0 replaced, 0 still travelling

1. Hades: underworld-shore → judgment-hall, set out at tick 251, 2 hops, arrived at tick 252
   - tick 251: moved to asphodel-meadow
   - tick 252: moved to judgment-hall

## Practice threads

### supplication [evt-211-3717]: hermes → fisher-dion, fulfilled

- Opened at tick 211
- Cause: unmet-need (fisher-dion) [evt-169-2946]
- Answers the prayer [evt-170-2956]
- Moves:
  1. tick 211, Hermes: offer — fisher-dion offers hermes 1 currency by tick 301
  2. tick 212, fisher-dion: accept
- Boon: not seen
- Offering: not seen
- Ending: fulfilled at tick 282, by fisher-dion; remembered by fisher-dion, hermes
- Changed: hermes → fisher-dion: affinity +1

## What each god practiced

- athena: no practice move; thread endings: none
- hades: travel; thread endings: none
- hephaestus: no practice move; thread endings: none
- hera: no practice move; thread endings: none
- hermes: supplication; thread endings: fulfilled [evt-211-3717] by its act
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
| hermes | 270 | evt-211-3717 | 301 | bless | performed |  |

## Repetition

- Athena: longest run 1 of report:herdsman-damon (cap 3). Choices: report:herdsman-damon ×1, bless:evt-112-2136 ×1
- Hades: longest run 3 of legend:legend (cap 3). Choices: legend:legend ×3, bless:evt-162-2836 ×1, travel:judgment-hall ×1
- Hephaestus: longest run none (cap 3). Choices: none
- Hera: longest run 5 of report:zeus (cap 3). Choices: report:zeus ×5
- Hermes: longest run 1 of bless:evt-7-162 (cap 3). Choices: bless:evt-7-162 ×1, practice:offer evt-170-2956 ×1, bless:evt-170-2956 ×1
- Poseidon: longest run 4 of report:hermes (cap 3). Choices: report:hermes ×4
- Zeus: longest run 2 of report:hera (cap 3). Choices: report:hera ×2, bless:evt-5-106 ×1, legend:legend ×1

## Automated checks

| God | Check | Result | Detail |
| --- | --- | --- | --- |
| Athena | profile trace | pass | 2 actions: 1 ability-backed, 1 context-backed |
| Athena | repetition | pass | longest run 1 of report:herdsman-damon (cap 3) |
| Athena | minimum activity | FAIL | 2 committed model actions (at least 5) |
| Athena | influence | pass | 2 caused (told belief, relationship-changed) |
| Athena | petition heard | pass | 8 petitions addressed to this god (at least 1) |
| Athena | petition answered | pass | 1 of 8 answered (at least 1) |
| Hades | profile trace | pass | 5 actions: 3 ability-backed, 2 context-backed |
| Hades | repetition | pass | longest run 3 of legend:legend (cap 3) |
| Hades | minimum activity | pass | 5 committed model actions (at least 5) |
| Hades | influence | pass | 1 caused (relationship-changed) |
| Hades | petition heard | pass | 2 petitions addressed to this god (at least 1) |
| Hades | petition answered | pass | 1 of 2 answered (at least 1) |
| Hephaestus | profile trace | pass | 0 actions: 0 ability-backed, 0 context-backed |
| Hephaestus | repetition | pass | no ordered action |
| Hephaestus | minimum activity | FAIL | 0 committed model actions (at least 5) |
| Hephaestus | influence | FAIL | no told belief or relationship change traces to this god's proposals |
| Hephaestus | petition heard | FAIL | no petition was addressed to this god (at least 1) |
| Hephaestus | petition answered | FAIL | 0 heard, none answered (at least 1) |
| Hera | profile trace | pass | 5 actions: 0 ability-backed, 5 context-backed |
| Hera | repetition | FAIL | longest run 5 of report:zeus (cap 3) |
| Hera | minimum activity | pass | 5 committed model actions (at least 5) |
| Hera | influence | pass | 5 caused (told belief) |
| Hera | petition heard | pass | 3 petitions addressed to this god (at least 1) |
| Hera | petition answered | FAIL | 3 heard, none answered (at least 1) |
| Hermes | profile trace | pass | 3 actions: 2 ability-backed, 1 context-backed |
| Hermes | repetition | pass | longest run 1 of bless:evt-7-162 (cap 3) |
| Hermes | minimum activity | FAIL | 3 committed model actions (at least 5) |
| Hermes | influence | pass | 2 caused (relationship-changed) |
| Hermes | petition heard | pass | 6 petitions addressed to this god (at least 1) |
| Hermes | petition answered | pass | 2 of 6 answered (at least 1) |
| Poseidon | profile trace | pass | 4 actions: 0 ability-backed, 4 context-backed |
| Poseidon | repetition | FAIL | longest run 4 of report:hermes (cap 3) |
| Poseidon | minimum activity | FAIL | 4 committed model actions (at least 5) |
| Poseidon | influence | pass | 4 caused (told belief) |
| Poseidon | petition heard | pass | 12 petitions addressed to this god (at least 1) |
| Poseidon | petition answered | FAIL | 12 heard, none answered (at least 1) |
| Zeus | profile trace | pass | 4 actions: 1 ability-backed, 3 context-backed |
| Zeus | repetition | pass | longest run 2 of report:hera (cap 3) |
| Zeus | minimum activity | FAIL | 4 committed model actions (at least 5) |
| Zeus | influence | pass | 5 caused (relationship-changed, told belief) |
| Zeus | petition heard | pass | 3 petitions addressed to this god (at least 1) |
| Zeus | petition answered | pass | 1 of 3 answered (at least 1) |

## Model run

- 34 requests: 23 answered (23 native, 0 repaired), 11 exhausted; latency p50 7908 ms, p95 16783 ms; prompt p50 7126 / max 9776 characters; frames showed model-degraded in 28% of polls
- exhaustion: 11 × assertion: assertion must be 1 to 280 characters
- athena was refused after 2 attempts (assertion: assertion must be 1 to 280 characters); it sent {"action":"legend","linkedEventId":"evt-1-16"}
- hephaestus was refused after 2 attempts (assertion: assertion must be 1 to 280 characters); it sent {"action":"legend","linkedEventId":"evt-10-244"}
- hermes was refused after 2 attempts (assertion: assertion must be 1 to 280 characters); it sent {"action":"legend","linkedEventId":"evt-23-480"}
- athena was refused after 2 attempts (assertion: assertion must be 1 to 280 characters); it sent {"action":"legend","linkedEventId":"evt-45-871"}
- hephaestus was refused after 2 attempts (assertion: assertion must be 1 to 280 characters); it sent {"action":"legend","linkedEventId":"evt-56-1054"}
- athena was refused after 2 attempts (assertion: assertion must be 1 to 280 characters); it sent {"action":"legend","linkedEventId":"evt-89-1693"}
- hephaestus was refused after 2 attempts (assertion: assertion must be 1 to 280 characters); it sent {"action":"legend","linkedEventId":"evt-102-1945"}
- hermes was refused after 2 attempts (assertion: assertion must be 1 to 280 characters); it sent {"action":"legend","linkedEventId":"evt-118-2241"}
- hephaestus was refused after 2 attempts (assertion: assertion must be 1 to 280 characters); it sent {"action":"legend","linkedEventId":"evt-120-2285"}
- hermes was refused after 2 attempts (assertion: assertion must be 1 to 280 characters); it sent {"action":"legend","linkedEventId":"evt-220-3861"}
- hephaestus was refused after 2 attempts (assertion: assertion must be 1 to 280 characters); it sent {"action":"legend","linkedEventId":"evt-249-4401"}
- valid actions: held (23 proposals, all god actions, none rejected as malformed)
- perception compliance: held (every id named by 23 proposals was in the prompt behind it)
- relationship change with provenance: held (67 changes, 67 explained from the log alone, e.g. wrong > memory-recorded > relationship-changed)
- changed next action: FAILED (hera: report:zeus,altar before its first belief, report:zeus,altar after (same))
- goal privacy: held (34 prompts checked against 7 goals: none carried another god's goal outside a told account or a perceived legend)
- petition privacy: held (34 prompts checked against 34 petitions: none listed a petition addressed to another god, and none carried one the god did not witness)
- god thread endings: FAILED (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: no thread ending it caused left a persistent consequence; hermes: 1 (fulfilled [evt-211-3717]); poseidon: no thread ending it caused left a persistent consequence; zeus: no thread ending it caused left a persistent consequence)
- supplication and settlement: FAILED (1 supplications, 0 settlements, 0 refused or breached)
- thread endings recorded: held (1 threads: 1 ended with their parties remembering, 0 still open and inside their deadlines)
- no reopening without a new cause: held (0 settlements, 0 opened as linked successors on a newer cause, none reopened a closed matter on an old one)
- no-progress moves advance nothing: held (0 moves judged no progress, each leaving a refusal record and advancing no thread; no counter restated an earlier offer)
- consequence changes a later choice: FAILED (hermes: a consequence at 4989, but no committed action on both sides of it)
- obligated turns recorded: held (1 obligated turns, each with its recorded choice: 1 performed)
- contest endings: held (no contest was opened)
- alliances sealed by agreement: held (no alliance was formed)

Requests, in the order they ran (one at a time):

| # | God | Asked at tick | Applied at tick | Latency | Outcome | Prompt chars |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | athena | 1 | — | 5.7 s | exhausted (invalid-output: assertion: assertion must be 1 to 280 characters) | 5414 |
| 2 | hades | 7 | 11 | 3.6 s | answered | 3551 |
| 3 | hephaestus | 11 | — | 5.5 s | exhausted (invalid-output: assertion: assertion must be 1 to 280 characters) | 4856 |
| 4 | hera | 17 | 23 | 5.9 s | answered | 6740 |
| 5 | hermes | 23 | — | 6.5 s | exhausted (invalid-output: assertion: assertion must be 1 to 280 characters) | 6314 |
| 6 | poseidon | 30 | 39 | 8.8 s | answered | 7194 |
| 7 | zeus | 39 | 45 | 5.3 s | answered | 7126 |
| 8 | athena | 45 | — | 7.2 s | exhausted (invalid-output: assertion: assertion must be 1 to 280 characters) | 7317 |
| 9 | hades | 53 | 56 | 2.4 s | answered | 3725 |
| 10 | hephaestus | 56 | — | 3.5 s | exhausted (invalid-output: assertion: assertion must be 1 to 280 characters) | 4891 |
| 11 | hera | 60 | 64 | 3.8 s | answered | 7526 |
| 12 | hermes | 64 | 70 | 5.3 s | answered | 6509 |
| 13 | poseidon | 70 | 82 | 11.0 s | answered | 8879 |
| 14 | zeus | 82 | 89 | 6.7 s | answered | 5644 |
| 15 | athena | 89 | — | 8.6 s | exhausted (invalid-output: assertion: assertion must be 1 to 280 characters) | 7290 |
| 16 | hades | 98 | 102 | 3.8 s | answered | 3858 |
| 17 | hephaestus | 102 | — | 5.4 s | exhausted (invalid-output: assertion: assertion must be 1 to 280 characters) | 4872 |
| 18 | hera | 108 | 118 | 9.3 s | answered | 7968 |
| 19 | hermes | 118 | — | 10.4 s | exhausted (invalid-output: assertion: assertion must be 1 to 280 characters) | 5035 |
| 20 | poseidon | 129 | 146 | 16.8 s | answered | 9418 |
| 21 | zeus | 146 | 154 | 7.7 s | answered | 7559 |
| 22 | athena | 154 | 171 | 17.0 s | answered | 8596 |
| 23 | hades | 171 | 182 | 10.2 s | answered | 6110 |
| 24 | hephaestus | 182 | — | 10.3 s | exhausted (invalid-output: assertion: assertion must be 1 to 280 characters) | 5401 |
| 25 | hera | 193 | 202 | 8.3 s | answered | 8358 |
| 26 | hermes | 202 | 211 | 8.7 s | answered | 8865 |
| 27 | poseidon | 211 | 220 | 8.6 s | answered | 9697 |
| 28 | hermes | 220 | — | 8.2 s | exhausted (invalid-output: assertion: assertion must be 1 to 280 characters) | 7816 |
| 29 | zeus | 229 | 237 | 7.9 s | answered | 7737 |
| 30 | athena | 237 | 247 | 9.8 s | answered | 9776 |
| 31 | hades | 247 | 251 | 3.1 s | answered | 4092 |
| 32 | hephaestus | 251 | — | 7.9 s | exhausted (invalid-output: assertion: assertion must be 1 to 280 characters) | 5401 |
| 33 | hera | 259 | 270 | 9.4 s | answered | 7843 |
| 34 | hermes | 270 | 282 | 11.5 s | answered | 8306 |
| 35 | poseidon | ≈281 | — | — | in flight at the end (inferred) | — |

Each god's turns (finished requests; the gap is the ticks between its request starts):

| God | Turns | Median gap (ticks) | p95 gap (ticks) | Worst gap (ticks) | Median latency |
| --- | --- | --- | --- | --- | --- |
| athena | 5 | 54.5 | 83 | 83 | 8.6 s |
| hades | 5 | 59.5 | 76 | 76 | 3.6 s |
| hephaestus | 5 | 57.5 | 80 | 80 | 5.5 s |
| hera | 5 | 57 | 85 | 85 | 8.3 s |
| hermes | 6 | 50 | 84 | 84 | 8.5 s |
| poseidon | 4 | 59 | 82 | 82 | 9.9 s |
| zeus | 4 | 64 | 83 | 83 | 7.2 s |

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

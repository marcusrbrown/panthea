# Episode 1 of 3

## Settings

- Recorded: 2026-10-07T15:49:02.318Z
- Model: llama3.1-8b-4k through local Ollama, 4K context, reasoning off (reasoning_effort none)
- Length: 300 s (299 ticks)
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

1. **tick 18, Athena:** legend (ability-backed)
   - says: "In spring, mortal resource-gathering is a good omen. Many gather resources nearby, with success."
   - heard by: herdsman-damon, weaver-ismene, weaver-xenia, weaver-zoe
   - caused: legend-recorded (athena)
   - then: herdsman-damon now believes athena: "In spring, mortal resource-gathering is a good omen. Many gather resources nearby, with success."
   - then: weaver-ismene now believes athena: "In spring, mortal resource-gathering is a good omen. Many gather resources nearby, with success."
   - then: weaver-xenia now believes athena: "In spring, mortal resource-gathering is a good omen. Many gather resources nearby, with success."
   - then: weaver-zoe now believes athena: "In spring, mortal resource-gathering is a good omen. Many gather resources nearby, with success."
2. **tick 26, Hades:** travel → ferry-dock (context-backed)
   - caused: journey-started (hades)
3. **tick 37, Hephaestus:** travel → town-square (context-backed)
   - caused: journey-started (hephaestus)
4. **tick 55, Hera:** report → zeus (context-backed)
   - says: "I will travel to town-square to see what is happening there"
   - caused: report-told (hera → zeus)
   - then: zeus now believes hera: "I will travel to town-square to see what is happening there"
5. **tick 72, Hermes:** legend (ability-backed)
   - says: "I, a messenger god, have brought balance and exchange to the theft of Apollo's cattle."
   - heard by: ferryman, fisher-dion, hades, poseidon
   - caused: legend-recorded (hermes)
   - then: ferryman now believes hermes: "I, a messenger god, have brought balance and exchange to the theft of Apollo's cattle."
   - then: fisher-dion now believes hermes: "I, a messenger god, have brought balance and exchange to the theft of Apollo's cattle."
   - then: hades now believes hermes: "I, a messenger god, have brought balance and exchange to the theft of Apollo's cattle."
   - then: poseidon now believes hermes: "I, a messenger god, have brought balance and exchange to the theft of Apollo's cattle."
6. **tick 94, Poseidon:** report → ferryman (context-backed)
   - says: "There are more ways to resolve the situation between fisher-kallias and fisher-dion, such as justice through the river gods or the law of the land."
   - caused: report-told (poseidon → ferryman)
   - then: ferryman now believes poseidon: "There are more ways to resolve the situation between fisher-kallias and fisher-dion, such as justice through the river gods or the law of the land."
7. **tick 118, Zeus:** goal set → woodcutter (declaration)
   - goal: "help woodcutter with food"
8. **tick 132, Athena:** bless → evt-38-759 (ability-backed)
   - caused: resource-consumed (athena); blessing-granted (athena)
   - then: farmer → athena: affinity +1
9. **tick 142, Hades:** travel → underworld-shore (context-backed)
   - caused: journey-started (hades)
10. **tick 155, Hephaestus:** report → farmer (context-backed)
   - says: "I, the great Hephaestus, son of Hera and Zeus, teach glorious crafts to men with wise Athena, who once lived in caves. I recall my fall from the heavens, cast down by Zeus himself."
   - caused: report-told (hephaestus → farmer)
   - then: farmer now believes hephaestus: "I, the great Hephaestus, son of Hera and Zeus, teach glorious crafts to men with wise Athena, who once lived in caves. I recall my fall from the heavens, cast down by Zeus himself."
11. **tick 164, Hera:** travel → town-square (context-backed)
   - caused: journey-started (hera)
12. **tick 184, Hermes:** report → ferryman (ability-backed)
   - says: "There are prayers to me here. I can help those in need or set terms for what they must give if they want my aid."
   - caused: report-told (hermes → ferryman)
   - then: ferryman now believes hermes: "There are prayers to me here. I can help those in need or set terms for what they must give if they want my aid."
13. **tick 209, Poseidon:** travel → altar (context-backed)
   - caused: journey-started (poseidon)
14. **tick 222, Zeus:** travel → town-square (context-backed)
   - under goal: "help woodcutter with food" (→ woodcutter)
   - caused: journey-started (zeus)
15. **tick 239, Athena:** report → herdsman-damon (context-backed)
   - says: "Hera has entrusted me with a task, to protect this place and its people, and I have seen the resourcefulness of mortals gathering resources over several days, as shown in previous days' events, which is a good omen."
   - caused: report-told (athena → herdsman-damon)
   - then: herdsman-damon now believes athena: "Hera has entrusted me with a task, to protect this place and its people, and I have seen the resourcefulness of mortals gathering resources over several days, as shown in previous days' events, which is a good omen."
16. **tick 246, Hades:** legend (ability-backed)
   - says: "In the underworld, I declare order and justice for the dead, their realms and their kin, and those who would have it otherwise shall be declared as wrong"
   - heard by: no one
   - caused: legend-recorded (hades)
17. **tick 256, Hephaestus:** report → market-trader-iris (context-backed)
   - says: "We mortals are gifted in craft, but our great teachers, Athena and I, show the way to glorious skill."
   - caused: report-told (hephaestus → market-trader-iris)
   - then: market-trader-iris now believes hephaestus: "We mortals are gifted in craft, but our great teachers, Athena and I, show the way to glorious skill."
18. **tick 270, Hera:** report → zeus (context-backed)
   - says: "I sense you have been careless with your family, again. I am coming to see it with my own eyes."
   - caused: report-told (hera → zeus)
   - then: zeus now believes hera: "I sense you have been careless with your family, again. I am coming to see it with my own eyes."
19. **tick 284, Hermes:** legend (ability-backed)
   - says: "I, Hermes, guide souls, bringing order and balance to the world, and I am here to lend a hand to those in need."
   - heard by: ferryman, fisher-stavros
   - caused: legend-recorded (hermes)
   - then: ferryman now believes hermes: "I, Hermes, guide souls, bringing order and balance to the world, and I am here to lend a hand to those in need."
   - then: fisher-stavros now believes hermes: "I, Hermes, guide souls, bringing order and balance to the world, and I am here to lend a hand to those in need."
20. **tick 294, Poseidon:** travel → ferry-dock (context-backed)
   - caused: journey-started (poseidon)

## What the world did with every proposal

- dispositions: travel 7 × committed, report 7 × committed, legend 4 × committed, practice 1 × insufficient-resources, bless 1 × committed

1. Athena: legend → legend — committed: legend-recorded
2. Hades: travel → ferry-dock — committed: journey-started
3. Hephaestus: travel → town-square — committed: journey-started
4. Hera: report → zeus — committed: report-told
5. Hermes: legend → legend — committed: legend-recorded
6. Poseidon: report → ferryman — committed: report-told
7. Zeus: practice → offer evt-5-106 — rejected: insufficient-resources
8. Athena: bless → evt-38-759 — committed: resource-consumed, blessing-granted
9. Hades: travel → underworld-shore — committed: journey-started
10. Hephaestus: report → farmer — committed: report-told
11. Hera: travel → town-square — committed: journey-started
12. Hermes: report → ferryman — committed: report-told
13. Poseidon: travel → altar — committed: journey-started
14. Zeus: travel → town-square — committed: journey-started
15. Athena: report → herdsman-damon — committed: report-told
16. Hades: legend → legend — committed: legend-recorded
17. Hephaestus: report → market-trader-iris — committed: report-told
18. Hera: report → zeus — committed: report-told
19. Hermes: legend → legend — committed: legend-recorded
20. Poseidon: travel → ferry-dock — committed: journey-started

## The episode's numbers

- Food: 62 "cannot get food" lines; 14 of 29 prayers are about food
- Troubles in a god's domain: Athena 3, Hades 2, Hephaestus 2, Hera 2, Hermes 2, Poseidon 2, Zeus 2
- Wrongs between mortals: 11; 11 between different patrons
  - [evt-1-23] fisher-dion (hermes) wronged fisher-kallias (poseidon): cheating; the victim prayed [evt-5-110]; revenge
  - [evt-61-1146] woodcutter (zeus) wronged market-trader-iris (hermes): feud; the victim prayed [evt-64-1212]; revenge
  - [evt-141-2477] herdsman-damon (hermes) wronged weaver-ismene (athena): theft; the victim did not pray about it; no consequence yet
  - [evt-166-2840] fisher-kallias (poseidon) wronged fisher-dion (hermes): feud; the victim prayed [evt-213-3552]; no consequence yet
  - [evt-167-2881] weaver-xenia (hera) wronged herdsman-damon (hermes): feud; the victim prayed [evt-173-2961]; no consequence yet
  - [evt-193-3215] smith-ktesias (hephaestus) wronged weaver-xenia (hera): feud; the victim did not pray about it; no consequence yet
  - [evt-199-3317] market-trader-iris (hermes) wronged farmer (hera): unpaid-debt; the victim prayed [evt-201-3370]; no consequence yet
  - [evt-249-4082] fisher-kallias (poseidon) wronged fisher-eleni (athena): unpaid-debt; the victim did not pray about it; no consequence yet
  - [evt-251-4138] market-trader-iris (hermes) wronged woodcutter (zeus): feud; the victim prayed [evt-256-4240]; no consequence yet
  - [evt-279-4594] market-trader-iris (hermes) wronged fisher-kallias (poseidon): theft; the victim did not pray about it; no consequence yet
  - [evt-284-4676] fisher-kallias (poseidon) wronged fisher-dion (hermes): cheating; the victim did not pray about it; no consequence yet
- Defections: 1
- From a prayer's cause to its closing: 13 closed (median 153 ticks, p95 156 ticks); by outcome lapsed 12, answered 1

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
- tick 36: a tool-flaw in athena's domain (spring, the god's floor) took 2 planks of farmer [evt-36-734]
- tick 37: woodcutter cannot get food (no-seller)
- tick 38: farmer prayed to athena: help with planks [evt-38-759] (a trouble in the god's domain: routed to the domain god)
- tick 50: a hoard-swallowed in hades's domain (spring, the god's floor) took 2 currency of weaver-zoe [evt-50-957]
- tick 55: a roof-leak in hera's domain (spring, the god's floor) took 2 food of farmer [evt-55-1030]
- tick 59: fisher-dion cannot get food (no-seller)
- tick 60: farmer prayed to hera: help with food [evt-60-1109] (a trouble in the god's domain: routed to the domain god)
- tick 60: fisher-eleni cannot get food (no-seller)
- tick 61: woodcutter wronged market-trader-iris: feud of 2 food; quarrelsome, not in need [evt-61-1146]
- tick 61: fisher-dion cannot get food (no-seller)
- tick 62: fisher-dion prayed to hermes: help with food [evt-62-1177] (routed to its patron)
- tick 64: market-trader-iris prayed to hermes: punish woodcutter, who owns woodshed [evt-64-1212] (routed to its patron)
- tick 67: a tool-flaw in athena's domain (spring, the season's odds) took 2 tools of smith-brontes [evt-67-1283]
- tick 68: fisher-kallias cannot get food (no-funds)
- tick 68: fisher-dion cannot get fish (no-buyer)
- tick 72: fisher-dion cannot get fish (no-buyer)
- tick 81: a harbour-surge in poseidon's domain (spring, the god's floor) damaged fish-landing of ferryman [evt-81-1537]
- tick 84: ferryman prayed to poseidon: help with fish-landing [evt-84-1570] (a trouble in the god's domain: routed to the domain god)
- tick 96: market-trader-iris cannot get food (no-funds)
- tick 98: market-trader-iris prayed to hermes: help with food [evt-98-1780] (routed to its patron)
- tick 112: a lightning-fire in zeus's domain (spring, the god's floor) took 1 food of fisher-stavros [evt-112-1999]
- tick 113: fisher-stavros cannot get food (no-seller)
- tick 114: fisher-stavros prayed to poseidon: help with food [evt-114-2024] (routed to its patron)
- tick 116: market-trader-iris cannot get food (no-funds)
- tick 118: zeus's offer was refused (insufficient-resources)
- tick 118: fisher-stavros cannot get fish (no-buyer)
- tick 120: the director made smith-ktesias take 107 food from ferryman
- tick 123: ferryman prayed to hermes: help with food [evt-123-2180] (not its authored patron (a defection or a domain))
- tick 124: a vanished-goods in hermes's domain (spring, the god's floor) took 2 food of smith-ktesias [evt-124-2204]
- tick 131: fisher-stavros cannot get fish (no-buyer)
- tick 132: athena blessed farmer: 2 planks
- tick 132: athena answered farmer's prayer [evt-38-759]
- tick 132: farmer remembers athena's answer
- tick 132: farmer → athena: affinity +1
- tick 136: market-trader-iris cannot get food (no-funds)
- tick 136: smith-delia cannot get food (no-funds)
- tick 139: a cracked-tools in hephaestus's domain (spring, the god's floor) took 2 tools of smith-delia [evt-139-2445]
- tick 140: weaver-zoe cannot get food (no-seller)
- tick 141: weaver-zoe prayed to athena: help with food [evt-141-2471] (routed to its patron)
- tick 141: herdsman-damon wronged weaver-ismene: theft of 2 cloth; greedy, not in need [evt-141-2477]
- tick 143: weaver-zoe cannot get food (no-seller)
- tick 148: fisher-kallias cannot get food (no-funds)
- tick 154: farmer's prayer to hera lapsed unanswered [evt-3-60]
- tick 154: farmer remembers hera's silence
- tick 154: farmer → hera: affinity -2, grudge +1
- tick 156: woodcutter's prayer to zeus lapsed unanswered [evt-5-106]
- tick 156: fisher-kallias's prayer to poseidon lapsed unanswered [evt-5-110]
- tick 156: woodcutter remembers zeus's silence
- tick 156: fisher-kallias remembers poseidon's silence
- tick 156: woodcutter → zeus: affinity -2, grudge +1
- tick 156: fisher-kallias → poseidon: affinity -2, grudge +1
- tick 158: market-trader-iris's prayer to hermes lapsed unanswered [evt-7-162]
- tick 158: market-trader-iris remembers hermes's silence
- tick 158: market-trader-iris → hermes: affinity -2, grudge +1
- tick 163: weaver-zoe cannot get food (no-seller)
- tick 166: fisher-kallias wronged fisher-dion: feud of 2 fish; greedy, not in need; a revenge for [evt-1-23] [evt-166-2840]
- tick 167: weaver-xenia wronged herdsman-damon: feud of 2 food; proud, not in need [evt-167-2881]
- tick 168: weaver-xenia cannot get wool (no-buyer)
- tick 170: weaver-xenia cannot get wool (no-buyer)
- tick 172: weaver-xenia cannot get wool (no-buyer)
- tick 173: herdsman-damon prayed to hermes: punish weaver-xenia, who owns  [evt-173-2961] (routed to its patron)
- tick 173: weaver-xenia cannot get food (no-seller)
- tick 176: market-trader-iris cannot get food (no-funds)
- tick 180: a quake in poseidon's domain (spring, the season's odds) damaged olive-press of olive-grower-aristo [evt-180-3048]
- tick 187: olive-grower-aristo prayed to poseidon: help with olive-press [evt-187-3119] (a trouble in the god's domain: routed to the domain god)
- tick 188: fisher-kallias cannot get food (no-funds)
- tick 188: olive-grower-aristo cannot get food (no-seller)
- tick 190: olive-grower-aristo cannot get food (no-seller)
- tick 193: smith-ktesias wronged weaver-xenia: feud of 2 cloth; proud, not in need [evt-193-3215]
- tick 196: market-trader-iris cannot get food (no-funds)
- tick 196: olive-grower-aristo cannot get olives (no-buyer)
- tick 199: market-trader-iris wronged farmer: unpaid-debt of 3 currency; greedy, not in need; the credit [evt-99-1814] failed [evt-199-3317]
- tick 200: the season turned from spring to summer
- tick 200: fisher-stavros cannot get food (no-seller)
- tick 200: fisher-eleni cannot get food (no-seller)
- tick 200: fisher-dion cannot get food (no-seller)
- tick 200: weaver-ismene cannot get food (no-seller)
- tick 200: weaver-zoe cannot get food (no-seller)
- tick 200: weaver-xenia cannot get food (no-seller)
- tick 200: smith-brontes cannot get food (no-seller)
- tick 200: smith-delia cannot get food (no-seller)
- tick 201: farmer prayed to hera: punish market-trader-iris, who owns  [evt-201-3370] (routed to its patron)
- tick 208: fisher-kallias cannot get food (no-funds)
- tick 209: olive-grower-aristo cannot get food (no-seller)
- tick 211: farmer's prayer to hera lapsed unanswered [evt-60-1109]
- tick 211: farmer remembers hera's silence
- tick 211: farmer → hera: affinity -2, grudge +1
- tick 211: farmer left hera for athena: hera left 2 prayers unanswered ([evt-60-1109], [evt-3-60]) and athena answered [evt-38-759] [evt-211-3527]
- tick 212: fisher-stavros cannot get food (no-seller)
- tick 212: fisher-dion cannot get food (no-seller)
- tick 213: fisher-stavros prayed to zeus: help with food [evt-213-3550] (a trouble in the god's domain: routed to the domain god)
- tick 213: fisher-dion prayed to hermes: punish fisher-kallias, who owns  [evt-213-3552] (routed to its patron)
- tick 213: fisher-dion's prayer to hermes lapsed unanswered [evt-62-1177]
- tick 213: fisher-dion remembers hermes's silence
- tick 213: fisher-dion → hermes: affinity -2, grudge +1
- tick 215: market-trader-iris's prayer to hermes lapsed unanswered [evt-64-1212]
- tick 215: market-trader-iris remembers hermes's silence
- tick 215: market-trader-iris → hermes: affinity -2, grudge +1
- tick 216: market-trader-iris cannot get food (no-funds)
- tick 219: fisher-stavros cannot get fish (no-buyer)
- tick 219: fisher-dion cannot get fish (no-buyer)
- tick 230: olive-grower-aristo cannot get food (no-funds)
- tick 231: fisher-stavros cannot get fish (no-buyer)
- tick 231: fisher-dion cannot get fish (no-buyer)
- tick 235: ferryman's prayer to poseidon lapsed unanswered [evt-84-1570]
- tick 235: ferryman remembers poseidon's silence
- tick 235: ferryman → poseidon: affinity -2, grudge +1
- tick 236: market-trader-iris cannot get food (no-funds)
- tick 240: the director made provisioner-nikanor take 49 olives from fisher-kallias
- tick 242: a squall in zeus's domain (summer, the god's floor) damaged the-tavern of farmer [evt-242-3962]
- tick 244: a hoard-swallowed in hades's domain (summer, the god's floor) took 2 currency of smith-delia [evt-244-3984]
- tick 245: fisher-kallias prayed to hermes: help with olives [evt-245-3992] (not its authored patron (a defection or a domain))
- tick 246: fisher-melina cannot get food (no-seller)
- tick 246: fisher-melina cannot get fish (no-buyer)
- tick 246: fisher-stavros cannot get fish (no-buyer)
- tick 246: fisher-eleni cannot get fish (no-buyer)
- tick 246: fisher-dion cannot get fish (no-buyer)
- tick 246: olive-grower-leon cannot get food (no-funds)
- tick 246: weaver-ismene cannot get food (no-seller)
- tick 246: weaver-zoe cannot get food (no-seller)
- tick 246: weaver-xenia cannot get food (no-seller)
- tick 246: smith-brontes cannot get food (no-seller)
- tick 246: smith-delia cannot get food (no-seller)
- tick 247: farmer prayed to zeus: help with the-tavern [evt-247-4023] (a trouble in the god's domain: routed to the domain god)
- tick 247: market-trader-iris cannot get food (no-seller)
- tick 248: fisher-kallias cannot get food (no-funds)
- tick 248: fisher-melina cannot get food (no-seller)
- tick 248: fisher-melina cannot get fish (no-buyer)
- tick 248: fisher-stavros cannot get fish (no-buyer)
- tick 248: fisher-eleni cannot get fish (no-buyer)
- tick 248: fisher-dion cannot get fish (no-buyer)
- tick 248: olive-grower-aristo cannot get food (no-funds)
- tick 249: fisher-melina prayed to poseidon: help with food [evt-249-4071] (routed to its patron)
- tick 249: fisher-eleni prayed to athena: help with fish [evt-249-4073] (routed to its patron)
- tick 249: fisher-kallias wronged fisher-eleni: unpaid-debt of 3 currency; greedy, in need; the credit [evt-149-2608] failed [evt-249-4082]
- tick 249: a tool-flaw in athena's domain (summer, the god's floor) took 2 tools of smith-brontes [evt-249-4083]
- tick 249: fisher-kallias cannot get fish (no-buyer)
- tick 249: fisher-stavros cannot get food (no-seller)
- tick 249: fisher-dion cannot get food (no-seller)
- tick 249: market-trader-iris's prayer to hermes lapsed unanswered [evt-98-1780]
- tick 249: market-trader-iris remembers hermes's silence
- tick 249: market-trader-iris → hermes: affinity -2, grudge +1
- tick 250: fisher-stavros prayed to poseidon: help with fish [evt-250-4103] (routed to its patron)
- tick 250: fisher-dion prayed to hermes: help with food [evt-250-4105] (routed to its patron)
- tick 251: market-trader-iris wronged woodcutter: feud of 1 food; greedy, not in need; a revenge for [evt-61-1146] [evt-251-4138]
- tick 252: olive-grower-aristo cannot get food (no-funds)
- tick 254: fisher-kallias cannot get fish (no-buyer)
- tick 254: fisher-melina cannot get fish (no-buyer)
- tick 256: woodcutter prayed to zeus: punish market-trader-iris, who owns  [evt-256-4240] (routed to its patron)
- tick 256: market-trader-iris cannot get food (no-funds)
- tick 256: fisher-eleni cannot get fish (no-buyer)
- tick 257: woodcutter cannot get food (no-seller)
- tick 262: fisher-kallias cannot get fish (no-buyer)
- tick 262: fisher-melina cannot get fish (no-buyer)
- tick 262: fisher-stavros cannot get fish (no-buyer)
- tick 262: fisher-eleni cannot get fish (no-buyer)
- tick 265: fisher-stavros's prayer to poseidon lapsed unanswered [evt-114-2024]
- tick 265: fisher-stavros remembers poseidon's silence
- tick 265: fisher-stavros → poseidon: affinity -2, grudge +1
- tick 267: fisher-melina cannot get fish (no-buyer)
- tick 267: fisher-stavros cannot get fish (no-buyer)
- tick 267: fisher-eleni cannot get fish (no-buyer)
- tick 271: a vanished-goods in hermes's domain (summer, the god's floor) took 1 food of woodcutter [evt-271-4483]
- tick 271: fisher-stavros cannot get fish (no-buyer)
- tick 274: ferryman's prayer to hermes lapsed unanswered [evt-123-2180]
- tick 274: ferryman remembers hermes's silence
- tick 274: ferryman → hermes: affinity -2, grudge +1
- tick 276: market-trader-iris cannot get food (no-funds)
- tick 276: fisher-kallias cannot get food (no-funds)
- tick 279: market-trader-iris wronged fisher-kallias: theft of 2 cloth; greedy, not in need [evt-279-4594]
- tick 282: woodcutter prayed to hermes: help with food [evt-282-4645] (a trouble in the god's domain: routed to the domain god)
- tick 284: fisher-kallias wronged fisher-dion: cheating of 2 currency; greedy, not in need [evt-284-4676]
- tick 287: fisher-kallias cannot get food (no-funds)
- tick 291: fisher-kallias cannot get food (no-seller)
- tick 291: fisher-stavros cannot get fish (no-buyer)
- tick 292: fisher-kallias prayed to poseidon: help with food [evt-292-4814] (routed to its patron)
- tick 292: weaver-zoe's prayer to athena lapsed unanswered [evt-141-2471]
- tick 292: weaver-zoe remembers athena's silence
- tick 292: weaver-zoe → athena: affinity -2, grudge +1
- tick 293: a roof-leak in hera's domain (summer, the god's floor) took 1 food of olive-grower-leon [evt-293-4843]
- tick 293: fisher-melina cannot get food (no-funds)
- tick 294: a forge-flare in hephaestus's domain (summer, the god's floor) damaged the-forge of smith-ktesias [evt-294-4866]
- tick 294: olive-grower-leon cannot get food (no-seller)
- tick 295: olive-grower-leon prayed to poseidon: help with food [evt-295-4878] (routed to its patron)
- tick 296: market-trader-iris cannot get food (no-funds)
- tick 296: fisher-kallias cannot get fish (no-buyer)
- tick 296: fisher-melina cannot get food (no-funds)
- tick 297: olive-grower-leon cannot get food (no-seller)
- tick 298: market-trader-iris prayed to hermes: help with food [evt-298-4922] (routed to its patron)
- tick 298: fisher-melina cannot get food (no-funds)

## Journeys

- journeys: 7 started: 7 arrived, 0 refused, 0 replaced, 0 still travelling

1. Hades: underworld-shore → ferry-dock, set out at tick 26, 1 hop, arrived at tick 26
   - tick 26: crossed from underworld-shore to ferry-dock
2. Hephaestus: forge → town-square, set out at tick 37, 1 hop, arrived at tick 37
   - tick 37: moved to town-square
3. Hades: ferry-dock → underworld-shore, set out at tick 142, 1 hop, arrived at tick 142
   - tick 142: crossed from ferry-dock to underworld-shore
4. Hera: great-hall → town-square, set out at tick 164, 3 hops, arrived at tick 166
   - tick 164: moved to olympus-gate
   - tick 165: crossed from olympus-gate to mountain-path
   - tick 166: moved to town-square
5. Poseidon: ferry-dock → altar, set out at tick 209, 2 hops, arrived at tick 210
   - tick 209: moved to town-square
   - tick 210: moved to altar
6. Zeus: great-hall → town-square, set out at tick 222, 3 hops, arrived at tick 224
   - tick 222: moved to olympus-gate
   - tick 223: crossed from olympus-gate to mountain-path
   - tick 224: moved to town-square
7. Poseidon: altar → ferry-dock, set out at tick 294, 2 hops, arrived at tick 295
   - tick 294: moved to town-square
   - tick 295: moved to ferry-dock

## Practice threads

No practice thread was opened.

## What each god practiced

- athena: no practice move; thread endings: none
- hades: travel; thread endings: none
- hephaestus: travel; thread endings: none
- hera: travel; thread endings: none
- hermes: no practice move; thread endings: none
- poseidon: travel; thread endings: none
- zeus: travel; thread endings: none

## Open threads at the end

No thread was open at the end.

## Moves judged no progress

No move was judged no progress.

## Turns while an obligation was open

No obligation led a prompt, so no obligated turn was taken.

Each turn is classified from the god's prompt and its proposal. An acceptance binds, so the god performs, waits, or risks breach, and bargaining is for a thread still open: the action the term calls for, committed, is performed; a turn that did something else is waited for a named event when its prompt shows what stops it (the digest's UNPERFORMABLE obstacle, or no mortal at the place a legend is to be told); every other turn, an attempt to bargain over the accepted thread included, is knowingly risked breach, since the obligation led the prompt.

## Repetition

- Athena: longest run 1 of legend:legend (cap 3). Choices: legend:legend ×1, bless:evt-38-759 ×1, report:herdsman-damon ×1
- Hades: longest run 1 of travel:ferry-dock (cap 3). Choices: travel:ferry-dock ×1, travel:underworld-shore ×1, legend:legend ×1
- Hephaestus: longest run 1 of travel:town-square (cap 3). Choices: travel:town-square ×1, report:farmer ×1, report:market-trader-iris ×1
- Hera: longest run 1 of report:zeus (cap 3). Choices: report:zeus ×2, travel:town-square ×1
- Hermes: longest run 1 of legend:legend (cap 3). Choices: legend:legend ×2, report:ferryman ×1
- Poseidon: longest run 1 of report:ferryman (cap 3). Choices: report:ferryman ×1, travel:altar ×1, travel:ferry-dock ×1
- Zeus: longest run 1 of travel:town-square (cap 3). Choices: travel:town-square ×1

## Automated checks

| God | Check | Result | Detail |
| --- | --- | --- | --- |
| Athena | profile trace | pass | 3 actions: 2 ability-backed, 1 context-backed |
| Athena | repetition | pass | longest run 1 of legend:legend (cap 3) |
| Athena | minimum activity | FAIL | 3 committed model actions (at least 5) |
| Athena | influence | pass | 6 caused (told belief, relationship-changed) |
| Athena | petition heard | pass | 3 petitions addressed to this god (at least 1) |
| Athena | petition answered | pass | 1 of 3 answered (at least 1) |
| Hades | profile trace | pass | 3 actions: 1 ability-backed, 2 context-backed |
| Hades | repetition | pass | longest run 1 of travel:ferry-dock (cap 3) |
| Hades | minimum activity | FAIL | 3 committed model actions (at least 5) |
| Hades | influence | FAIL | no told belief or relationship change traces to this god's proposals |
| Hades | petition heard | FAIL | no petition was addressed to this god (at least 1) |
| Hades | petition answered | pass | 0 heard; this god has no bless or strike to answer with, so none is required |
| Hephaestus | profile trace | pass | 3 actions: 0 ability-backed, 3 context-backed |
| Hephaestus | repetition | pass | longest run 1 of travel:town-square (cap 3) |
| Hephaestus | minimum activity | FAIL | 3 committed model actions (at least 5) |
| Hephaestus | influence | pass | 2 caused (told belief) |
| Hephaestus | petition heard | FAIL | no petition was addressed to this god (at least 1) |
| Hephaestus | petition answered | FAIL | 0 heard, none answered (at least 1) |
| Hera | profile trace | pass | 3 actions: 0 ability-backed, 3 context-backed |
| Hera | repetition | pass | longest run 1 of report:zeus (cap 3) |
| Hera | minimum activity | FAIL | 3 committed model actions (at least 5) |
| Hera | influence | pass | 2 caused (told belief) |
| Hera | petition heard | pass | 3 petitions addressed to this god (at least 1) |
| Hera | petition answered | FAIL | 3 heard, none answered (at least 1) |
| Hermes | profile trace | pass | 3 actions: 3 ability-backed, 0 context-backed |
| Hermes | repetition | pass | longest run 1 of legend:legend (cap 3) |
| Hermes | minimum activity | FAIL | 3 committed model actions (at least 5) |
| Hermes | influence | pass | 7 caused (told belief) |
| Hermes | petition heard | pass | 11 petitions addressed to this god (at least 1) |
| Hermes | petition answered | FAIL | 11 heard, none answered (at least 1) |
| Poseidon | profile trace | pass | 3 actions: 0 ability-backed, 3 context-backed |
| Poseidon | repetition | pass | longest run 1 of report:ferryman (cap 3) |
| Poseidon | minimum activity | FAIL | 3 committed model actions (at least 5) |
| Poseidon | influence | pass | 1 caused (told belief) |
| Poseidon | petition heard | pass | 8 petitions addressed to this god (at least 1) |
| Poseidon | petition answered | FAIL | 8 heard, none answered (at least 1) |
| Zeus | profile trace | pass | 1 actions: 0 ability-backed, 1 context-backed |
| Zeus | repetition | pass | longest run 1 of travel:town-square (cap 3) |
| Zeus | minimum activity | FAIL | 1 committed model actions (at least 5) |
| Zeus | influence | FAIL | no told belief or relationship change traces to this god's proposals |
| Zeus | petition heard | pass | 4 petitions addressed to this god (at least 1) |
| Zeus | petition answered | FAIL | 4 heard, none answered (at least 1) |

## Model run

- 20 requests: 20 answered (20 native, 0 repaired), 0 exhausted; latency p50 13345 ms, p95 23718 ms; prompt p50 6736 / max 9102 characters; frames showed model-degraded in 0% of polls
- valid actions: held (20 proposals, all god actions, none rejected as malformed)
- perception compliance: held (every id named by 20 proposals was in the prompt behind it)
- relationship change with provenance: held (124 changes, 124 explained from the log alone, e.g. wrong > memory-recorded > relationship-changed)
- changed next action: held (hades: travel:ferry-dock before its first belief, travel:underworld-shore after (changed))
- goal privacy: held (20 prompts checked against 1 goals: none carried another god's goal outside a told account or a perceived legend)
- petition privacy: held (20 prompts checked against 29 petitions: none listed a petition addressed to another god, and none carried one the god did not witness)
- god thread endings: FAILED (no thread was opened)
- supplication and settlement: FAILED (0 supplications, 0 settlements, 0 refused or breached)
- thread endings recorded: held (0 threads: 0 ended with their parties remembering, 0 still open and inside their deadlines)
- no reopening without a new cause: held (0 settlements, 0 opened as linked successors on a newer cause, none reopened a closed matter on an old one)
- no-progress moves advance nothing: held (0 moves judged no progress, each leaving a refusal record and advancing no thread; no counter restated an earlier offer)
- consequence changes a later choice: FAILED (no thread ending left a consequence on a god)
- obligated turns recorded: held (no obligation led a prompt, so no obligated turn was taken)
- contest endings: held (no contest was opened)
- alliances sealed by agreement: held (no alliance was formed)

Requests, in the order they ran (one at a time):

| # | God | Asked at tick | Applied at tick | Latency | Outcome | Prompt chars |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | athena | 1 | 18 | 16.8 s | answered | 5414 |
| 2 | hades | 18 | 26 | 7.8 s | answered | 3552 |
| 3 | hephaestus | 26 | 37 | 10.3 s | answered | 4856 |
| 4 | hera | 37 | 55 | 17.6 s | answered | 6736 |
| 5 | hermes | 55 | 72 | 16.6 s | answered | 6276 |
| 6 | poseidon | 72 | 94 | 21.5 s | answered | 7596 |
| 7 | zeus | 94 | 118 | 23.7 s | answered | 7081 |
| 8 | athena | 118 | 132 | 13.4 s | answered | 7567 |
| 9 | hades | 132 | 142 | 9.6 s | answered | 5184 |
| 10 | hephaestus | 142 | 155 | 12.8 s | answered | 5392 |
| 11 | hera | 155 | 164 | 8.3 s | answered | 6862 |
| 12 | hermes | 164 | 184 | 19.5 s | answered | 7901 |
| 13 | poseidon | 184 | 209 | 24.1 s | answered | 8185 |
| 14 | zeus | 209 | 222 | 12.7 s | answered | 5220 |
| 15 | athena | 222 | 239 | 16.5 s | answered | 7635 |
| 16 | hades | 239 | 246 | 6.9 s | answered | 4162 |
| 17 | hephaestus | 246 | 256 | 9.1 s | answered | 5632 |
| 18 | hera | 256 | 270 | 13.3 s | answered | 9102 |
| 19 | hermes | 270 | 284 | 13.4 s | answered | 8046 |
| 20 | poseidon | 284 | 294 | 10.0 s | answered | 8130 |
| 21 | zeus | ≈294 | — | — | in flight at the end (inferred) | — |

Each god's turns (finished requests; the gap is the ticks between its request starts):

| God | Turns | Median gap (ticks) | p95 gap (ticks) | Worst gap (ticks) | Median latency |
| --- | --- | --- | --- | --- | --- |
| athena | 3 | 110.5 | 117 | 117 | 16.5 s |
| hades | 3 | 110.5 | 114 | 114 | 7.8 s |
| hephaestus | 3 | 110 | 116 | 116 | 10.3 s |
| hera | 3 | 109.5 | 118 | 118 | 13.3 s |
| hermes | 3 | 107.5 | 109 | 109 | 16.6 s |
| poseidon | 3 | 106 | 112 | 112 | 21.5 s |
| zeus | 2 | 115 | 115 | 115 | 18.2 s |

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

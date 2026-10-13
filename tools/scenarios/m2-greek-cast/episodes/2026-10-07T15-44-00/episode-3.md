# Episode 3 of 3

## Settings

- Recorded: 2026-10-07T15:59:07.831Z
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

1. **tick 17, Athena:** legend (ability-backed)
   - says: "With the contest of Attica, I have proven my rights to this land."
   - heard by: herdsman-damon, weaver-ismene, weaver-xenia, weaver-zoe
   - caused: legend-recorded (athena)
   - then: herdsman-damon now believes athena: "With the contest of Attica, I have proven my rights to this land."
   - then: weaver-ismene now believes athena: "With the contest of Attica, I have proven my rights to this land."
   - then: weaver-xenia now believes athena: "With the contest of Attica, I have proven my rights to this land."
   - then: weaver-zoe now believes athena: "With the contest of Attica, I have proven my rights to this land."
2. **tick 22, Hades:** travel → shop (context-backed)
   - caused: journey-started (hades)
3. **tick 32, Hephaestus:** legend (ability-backed)
   - says: "I taught glorious crafts to men on earth with bright-eyed Athena."
   - heard by: provisioner-nikanor, smith-brontes, smith-delia, smith-ktesias
   - caused: legend-recorded (hephaestus)
   - then: provisioner-nikanor now believes hephaestus: "I taught glorious crafts to men on earth with bright-eyed Athena."
   - then: smith-brontes now believes hephaestus: "I taught glorious crafts to men on earth with bright-eyed Athena."
   - then: smith-delia now believes hephaestus: "I taught glorious crafts to men on earth with bright-eyed Athena."
   - then: smith-ktesias now believes hephaestus: "I taught glorious crafts to men on earth with bright-eyed Athena."
4. **tick 68, Hermes:** practice → offer evt-7-162 (context-backed)
   - caused: practice-opened (hermes)
5. **tick 87, Poseidon:** report → ferryman (context-backed)
   - says: "I sense trouble between mortal fishermen, fisher-dion and fisher-kallias. I am considering intervening, but first I will judge his prayer."
   - caused: report-told (poseidon → ferryman)
   - then: ferryman now believes poseidon: "I sense trouble between mortal fishermen, fisher-dion and fisher-kallias. I am considering intervening, but first I will judge his prayer."
6. **tick 103, Hermes:** report → ferryman (ability-backed)
   - says: "I have been sent by my father Zeus to conduct matters here at this dock. I, however, have a pressing matter of my own to attend to."
   - caused: report-told (hermes → ferryman)
   - then: ferryman now believes hermes: "I have been sent by my father Zeus to conduct matters here at this dock. I, however, have a pressing matter of my own to attend to."
7. **tick 119, Zeus:** report → hera (context-backed)
   - says: "I have 10 divinity at hand, and my current location is within the Hall of the Gods. I see no threat or disturbance here."
   - caused: report-told (zeus → hera)
   - then: hera now believes zeus: "I have 10 divinity at hand, and my current location is within the Hall of the Gods. I see no threat or disturbance here."
8. **tick 135, Athena:** report → herdsman-damon (context-backed)
   - says: "I see that many of you have been gathering resources today."
   - caused: report-told (athena → herdsman-damon)
   - then: herdsman-damon now believes athena: "I see that many of you have been gathering resources today."
9. **tick 143, Hades:** travel → underworld-shore (context-backed)
   - caused: journey-started (hades)
10. **tick 155, Hephaestus:** report → provisioner-nikanor (context-backed)
   - says: "I built glorious crafts with bright-eyed Athena, teaching men on earth."
   - caused: report-told (hephaestus → provisioner-nikanor)
   - then: provisioner-nikanor now believes hephaestus: "I built glorious crafts with bright-eyed Athena, teaching men on earth."
11. **tick 165, Hera:** travel → town-square (context-backed)
   - caused: journey-started (hera)
12. **tick 185, Hermes:** report → ferryman (ability-backed)
   - says: "I have been sent by my father Zeus to settle the fish market at The Fish Landing [fish-landing]"
   - caused: report-told (hermes → ferryman)
   - then: ferryman now believes hermes: "I have been sent by my father Zeus to settle the fish market at The Fish Landing [fish-landing]"
13. **tick 201, Poseidon:** travel → ancient-olive-tree (context-backed)
   - caused: journey-started (poseidon)
14. **tick 206, Zeus:** travel → town-square (context-backed)
   - caused: journey-started (zeus)
15. **tick 220, Athena:** travel → town-square (context-backed)
   - caused: journey-started (athena)
16. **tick 240, Hephaestus:** practice → offer evt-207-3567 (context-backed)
   - caused: practice-opened (hephaestus)
17. **tick 261, Hera:** practice → offer evt-201-3466 (context-backed)
   - caused: practice-opened (hera)
18. **tick 281, Hephaestus:** legend (ability-backed)
   - says: "I took Hera's side, and Zeus cast me from heaven, where I fell to Lemnos."
   - heard by: provisioner-nikanor
   - caused: legend-recorded (hephaestus)
   - then: provisioner-nikanor now believes hephaestus: "I took Hera's side, and Zeus cast me from heaven, where I fell to Lemnos."

## What the world did with every proposal

- dispositions: travel 6 × committed, report 6 × committed, legend 3 × committed, practice 3 × committed

1. Athena: legend → legend — committed: legend-recorded
2. Hades: travel → shop — committed: journey-started
3. Hephaestus: legend → legend — committed: legend-recorded
4. Hermes: practice → offer evt-7-162 — committed: practice-opened
5. Poseidon: report → ferryman — committed: report-told
6. Hermes: report → ferryman — committed: report-told
7. Zeus: report → hera — committed: report-told
8. Athena: report → herdsman-damon — committed: report-told
9. Hades: travel → underworld-shore — committed: journey-started
10. Hephaestus: report → provisioner-nikanor — committed: report-told
11. Hera: travel → town-square — committed: journey-started
12. Hermes: report → ferryman — committed: report-told
13. Poseidon: travel → ancient-olive-tree — committed: journey-started
14. Zeus: travel → town-square — committed: journey-started
15. Athena: travel → town-square — committed: journey-started
16. Hephaestus: practice → offer evt-207-3567 — committed: practice-opened
17. Hera: practice → offer evt-201-3466 — committed: practice-opened
18. Hephaestus: legend → legend — committed: legend-recorded

## The episode's numbers

- Food: 69 "cannot get food" lines; 17 of 28 prayers are about food
- Troubles in a god's domain: Athena 3, Hades 2, Hephaestus 3, Hera 2, Hermes 2, Poseidon 2, Zeus 2
- Wrongs between mortals: 9; 9 between different patrons
  - [evt-1-23] fisher-dion (hermes) wronged fisher-kallias (poseidon): cheating; the victim prayed [evt-5-110]; revenge
  - [evt-61-1148] woodcutter (zeus) wronged market-trader-iris (hermes): feud; the victim prayed [evt-64-1214]; revenge
  - [evt-141-2538] herdsman-damon (hermes) wronged weaver-xenia (hera): theft; the victim did not pray about it; no consequence yet
  - [evt-166-2909] fisher-kallias (poseidon) wronged fisher-dion (hermes): feud; the victim did not pray about it; no consequence yet
  - [evt-167-2951] weaver-xenia (hera) wronged weaver-zoe (athena): feud; the victim prayed [evt-185-3182]; no consequence yet
  - [evt-193-3310] fisher-eleni (athena) wronged smith-ktesias (hephaestus): feud; the victim did not pray about it; no consequence yet
  - [evt-199-3417] market-trader-iris (hermes) wronged farmer (hera): unpaid-debt; the victim prayed [evt-201-3466]; no consequence yet
  - [evt-253-4251] fisher-kallias (poseidon) wronged fisher-eleni (athena): theft; the victim did not pray about it; no consequence yet
  - [evt-280-4703] market-trader-iris (hermes) wronged woodcutter (zeus): feud; the victim prayed [evt-284-4772]; no consequence yet
- Defections: 0
- From a prayer's cause to its closing: 14 closed (median 153 ticks, p95 156 ticks); by outcome lapsed 14

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
- tick 36: a tool-flaw in athena's domain (spring, the god's floor) took 2 planks of farmer [evt-36-741]
- tick 37: woodcutter cannot get food (no-seller)
- tick 38: farmer prayed to athena: help with planks [evt-38-763] (a trouble in the god's domain: routed to the domain god)
- tick 50: a hoard-swallowed in hades's domain (spring, the god's floor) took 2 currency of weaver-zoe [evt-50-961]
- tick 55: a roof-leak in hera's domain (spring, the god's floor) took 2 food of farmer [evt-55-1033]
- tick 59: fisher-dion cannot get food (no-seller)
- tick 60: farmer prayed to hera: help with food [evt-60-1111] (a trouble in the god's domain: routed to the domain god)
- tick 60: fisher-eleni cannot get food (no-seller)
- tick 61: woodcutter wronged market-trader-iris: feud of 2 food; quarrelsome, not in need [evt-61-1148]
- tick 61: fisher-dion cannot get food (no-seller)
- tick 62: fisher-dion prayed to hermes: help with food [evt-62-1179] (routed to its patron)
- tick 64: market-trader-iris prayed to hermes: punish woodcutter, who owns woodshed [evt-64-1214] (routed to its patron)
- tick 67: a tool-flaw in athena's domain (spring, the season's odds) took 2 tools of smith-brontes [evt-67-1285]
- tick 68: fisher-kallias cannot get food (no-funds)
- tick 68: fisher-dion cannot get fish (no-buyer)
- tick 72: fisher-dion cannot get fish (no-buyer)
- tick 81: a harbour-surge in poseidon's domain (spring, the god's floor) damaged fish-landing of ferryman [evt-81-1532]
- tick 84: ferryman prayed to poseidon: help with fish-landing [evt-84-1565] (a trouble in the god's domain: routed to the domain god)
- tick 96: market-trader-iris cannot get food (no-funds)
- tick 98: market-trader-iris prayed to hermes: help with food [evt-98-1775] (routed to its patron)
- tick 112: a lightning-fire in zeus's domain (spring, the god's floor) took 1 food of fisher-stavros [evt-112-1996]
- tick 113: fisher-stavros cannot get food (no-seller)
- tick 114: fisher-stavros prayed to poseidon: help with food [evt-114-2021] (routed to its patron)
- tick 116: market-trader-iris cannot get food (no-funds)
- tick 118: fisher-stavros cannot get fish (no-buyer)
- tick 120: the director made smith-ktesias take 82 food from farmer
- tick 121: fisher-eleni cannot get food (no-seller)
- tick 121: fisher-dion cannot get food (no-seller)
- tick 121: weaver-zoe cannot get food (no-seller)
- tick 121: smith-brontes cannot get food (no-seller)
- tick 122: farmer prayed to hermes: help with food [evt-122-2167] (not its authored patron (a defection or a domain))
- tick 124: a vanished-goods in hermes's domain (spring, the god's floor) took 2 food of smith-ktesias [evt-124-2221]
- tick 128: fisher-kallias cannot get food (no-funds)
- tick 130: fisher-kallias cannot get food (no-funds)
- tick 131: fisher-stavros cannot get fish (no-buyer)
- tick 132: fisher-kallias prayed to poseidon: help with food [evt-132-2350] (routed to its patron)
- tick 133: weaver-zoe cannot get food (no-seller)
- tick 134: weaver-zoe prayed to athena: help with food [evt-134-2393] (routed to its patron)
- tick 135: fisher-kallias cannot get fish (no-buyer)
- tick 136: market-trader-iris cannot get food (no-funds)
- tick 136: weaver-zoe cannot get food (no-seller)
- tick 136: smith-delia cannot get food (no-funds)
- tick 139: a cracked-tools in hephaestus's domain (spring, the god's floor) took 2 tools of smith-delia [evt-139-2493]
- tick 139: market-trader-iris's offering to hermes was seen made [evt-68-1288] (evt-139-2478)
- tick 141: herdsman-damon wronged weaver-xenia: theft of 2 cloth; greedy, not in need [evt-141-2538]
- tick 148: fisher-kallias cannot get food (no-funds)
- tick 154: farmer's prayer to hera lapsed unanswered [evt-3-60]
- tick 154: farmer remembers hera's silence
- tick 154: farmer → hera: affinity -2, grudge +1
- tick 156: market-trader-iris cannot get food (no-funds)
- tick 156: fisher-kallias cannot get food (no-funds)
- tick 156: smith-delia cannot get food (no-funds)
- tick 156: woodcutter's prayer to zeus lapsed unanswered [evt-5-106]
- tick 156: fisher-kallias's prayer to poseidon lapsed unanswered [evt-5-110]
- tick 156: woodcutter remembers zeus's silence
- tick 156: fisher-kallias remembers poseidon's silence
- tick 156: woodcutter → zeus: affinity -2, grudge +1
- tick 156: fisher-kallias → poseidon: affinity -2, grudge +1
- tick 158: market-trader-iris's prayer to hermes lapsed unanswered [evt-7-162]
- tick 158: market-trader-iris remembers hermes's silence
- tick 158: market-trader-iris → hermes: affinity -2, grudge +1
- tick 160: fisher-kallias cannot get food (no-funds)
- tick 166: fisher-kallias wronged fisher-dion: feud of 2 fish; greedy, not in need; a revenge for [evt-1-23] [evt-166-2909]
- tick 167: weaver-xenia wronged weaver-zoe: feud of 2 cloth; proud, not in need [evt-167-2951]
- tick 176: market-trader-iris cannot get food (no-funds)
- tick 184: weaver-zoe cannot get food (no-seller)
- tick 185: weaver-zoe prayed to athena: punish weaver-xenia, who owns  [evt-185-3182] (routed to its patron)
- tick 186: a roof-leak in hera's domain (spring, the god's floor) took 2 food of ferryman [evt-186-3203]
- tick 187: weaver-zoe cannot get food (no-seller)
- tick 188: fisher-kallias cannot get food (no-funds)
- tick 189: ferryman prayed to hera: help with food [evt-189-3235] (a trouble in the god's domain: routed to the domain god)
- tick 189: farmer's prayer to athena lapsed unanswered [evt-38-763]
- tick 189: farmer remembers athena's silence
- tick 189: farmer → athena: affinity -2, grudge +1
- tick 193: fisher-eleni wronged smith-ktesias: feud of 2 food; proud, not in need [evt-193-3310]
- tick 196: market-trader-iris cannot get food (no-funds)
- tick 199: market-trader-iris wronged farmer: unpaid-debt of 3 currency; greedy, not in need; the credit [evt-99-1809] failed [evt-199-3417]
- tick 200: the season turned from spring to summer
- tick 200: fisher-stavros cannot get food (no-seller)
- tick 200: fisher-eleni cannot get food (no-seller)
- tick 200: fisher-dion cannot get food (no-seller)
- tick 200: weaver-xenia cannot get food (no-seller)
- tick 200: smith-brontes cannot get food (no-seller)
- tick 200: smith-delia cannot get food (no-seller)
- tick 201: farmer prayed to hera: punish market-trader-iris, who owns  [evt-201-3466] (routed to its patron)
- tick 204: a cracked-tools in hephaestus's domain (summer, the god's floor) took 2 tools of fisher-kallias [evt-204-3528]
- tick 207: fisher-kallias prayed to hephaestus: help with tools [evt-207-3567] (a trouble in the god's domain: routed to the domain god)
- tick 208: fisher-kallias cannot get food (no-funds)
- tick 210: fisher-stavros cannot get food (no-seller)
- tick 211: fisher-stavros prayed to zeus: help with food [evt-211-3629] (a trouble in the god's domain: routed to the domain god)
- tick 211: fisher-kallias cannot get fish (no-buyer)
- tick 211: farmer's prayer to hera lapsed unanswered [evt-60-1111]
- tick 211: farmer remembers hera's silence
- tick 211: farmer → hera: affinity -2, grudge +1
- tick 213: fisher-dion's prayer to hermes lapsed unanswered [evt-62-1179]
- tick 213: fisher-dion remembers hermes's silence
- tick 213: fisher-dion → hermes: affinity -2, grudge +1
- tick 215: fisher-kallias cannot get fish (no-buyer)
- tick 215: fisher-stavros cannot get fish (no-buyer)
- tick 215: market-trader-iris's prayer to hermes lapsed unanswered [evt-64-1214]
- tick 215: market-trader-iris remembers hermes's silence
- tick 215: market-trader-iris → hermes: affinity -2, grudge +1
- tick 217: fisher-kallias cannot get fish (no-buyer)
- tick 217: fisher-stavros cannot get fish (no-buyer)
- tick 219: fisher-dion cannot get food (no-seller)
- tick 220: fisher-dion prayed to hermes: help with food [evt-220-3787] (routed to its patron)
- tick 224: fisher-dion cannot get fish (no-buyer)
- tick 231: fisher-kallias cannot get food (no-funds)
- tick 231: fisher-stavros cannot get fish (no-buyer)
- tick 231: fisher-dion cannot get fish (no-buyer)
- tick 234: a vanished-goods in hermes's domain (summer, the god's floor) took 2 olives of weaver-xenia [evt-234-4011]
- tick 235: fisher-kallias cannot get food (no-funds)
- tick 235: ferryman's prayer to poseidon lapsed unanswered [evt-84-1565]
- tick 235: ferryman remembers poseidon's silence
- tick 235: ferryman → poseidon: affinity -2, grudge +1
- tick 237: smith-delia cannot get food (no-funds)
- tick 240: the director spoiled 30 olives of fisher-melina
- tick 249: market-trader-iris's prayer to hermes lapsed unanswered [evt-98-1775]
- tick 249: market-trader-iris remembers hermes's silence
- tick 249: market-trader-iris → hermes: affinity -2, grudge +1
- tick 251: a ore-seam-lost in hades's domain (summer, the god's floor) took 2 tools of fisher-melina [evt-251-4228]
- tick 252: a quake in poseidon's domain (summer, the god's floor) damaged the-tavern of farmer [evt-252-4242]
- tick 253: fisher-kallias wronged fisher-eleni: theft of 2 fish; greedy, not in need [evt-253-4251]
- tick 254: fisher-eleni cannot get food (no-seller)
- tick 255: fisher-eleni prayed to athena: help with food [evt-255-4303] (routed to its patron)
- tick 256: market-trader-iris cannot get food (no-funds)
- tick 256: fisher-kallias cannot get food (no-seller)
- tick 256: fisher-melina cannot get food (no-seller)
- tick 256: fisher-stavros cannot get food (no-seller)
- tick 256: fisher-dion cannot get food (no-seller)
- tick 256: weaver-xenia cannot get food (no-seller)
- tick 256: smith-brontes cannot get food (no-seller)
- tick 256: smith-delia cannot get food (no-funds)
- tick 257: farmer prayed to poseidon: help with the-tavern [evt-257-4337] (a trouble in the god's domain: routed to the domain god)
- tick 257: woodcutter cannot get food (no-seller)
- tick 259: woodcutter prayed to zeus: help with food [evt-259-4370] (routed to its patron)
- tick 259: market-trader-iris prayed to hermes: help with food [evt-259-4372] (routed to its patron)
- tick 259: fisher-melina prayed to poseidon: help with food [evt-259-4375] (routed to its patron)
- tick 264: fisher-eleni cannot get fish (no-buyer)
- tick 265: fisher-stavros's prayer to poseidon lapsed unanswered [evt-114-2021]
- tick 265: fisher-stavros remembers poseidon's silence
- tick 265: fisher-stavros → poseidon: affinity -2, grudge +1
- tick 267: fisher-melina cannot get fish (no-buyer)
- tick 267: fisher-eleni cannot get fish (no-buyer)
- tick 268: olive-grower-aristo cannot get food (no-funds)
- tick 269: market-trader-iris cannot get food (no-funds)
- tick 273: farmer's prayer to hermes lapsed unanswered [evt-122-2167]
- tick 273: farmer remembers hermes's silence
- tick 273: farmer → hermes: affinity -2, grudge +1
- tick 274: a loom-break in athena's domain (summer, the god's floor) damaged loom-house of weaver-ismene [evt-274-4621]
- tick 276: market-trader-iris cannot get food (no-funds)
- tick 277: weaver-ismene cannot get food (no-seller)
- tick 280: market-trader-iris wronged woodcutter: feud of 1 food; greedy, not in need; a revenge for [evt-61-1148] [evt-280-4703]
- tick 283: fisher-kallias's prayer to poseidon lapsed unanswered [evt-132-2350]
- tick 283: fisher-kallias remembers poseidon's silence
- tick 283: fisher-kallias → poseidon: affinity -2, grudge +1
- tick 284: woodcutter prayed to zeus: punish market-trader-iris, who owns  [evt-284-4772] (routed to its patron)
- tick 285: a forge-flare in hephaestus's domain (summer, the season's odds) damaged the-forge of smith-ktesias [evt-285-4805]
- tick 285: weaver-zoe's prayer to athena lapsed unanswered [evt-134-2393]
- tick 285: weaver-zoe remembers athena's silence
- tick 285: weaver-zoe → athena: affinity -2, grudge +1
- tick 288: fisher-kallias cannot get food (no-funds)
- tick 288: olive-grower-aristo cannot get food (no-funds)
- tick 290: fisher-kallias prayed to poseidon: help with food [evt-290-4866] (routed to its patron)
- tick 292: fisher-melina cannot get food (no-funds)
- tick 293: fisher-kallias cannot get fish (no-buyer)
- tick 295: fisher-melina cannot get food (no-funds)
- tick 296: market-trader-iris cannot get food (no-funds)
- tick 297: a lightning-fire in zeus's domain (summer, the god's floor) took 2 food of farmer [evt-297-4985]
- tick 297: fisher-melina cannot get food (no-funds)
- tick 298: market-trader-iris cannot get food (no-seller)
- tick 298: fisher-stavros cannot get food (no-seller)
- tick 298: fisher-eleni cannot get food (no-seller)
- tick 298: fisher-dion cannot get food (no-seller)
- tick 298: weaver-ismene cannot get food (no-seller)
- tick 298: weaver-xenia cannot get food (no-seller)
- tick 298: smith-brontes cannot get food (no-seller)
- tick 298: smith-delia cannot get food (no-seller)
- tick 299: farmer prayed to zeus: help with food [evt-299-5011] (a trouble in the god's domain: routed to the domain god)

## Journeys

- journeys: 6 started: 6 arrived, 0 refused, 0 replaced, 0 still travelling

1. Hades: underworld-shore → shop, set out at tick 22, 3 hops, arrived at tick 24
   - tick 22: crossed from underworld-shore to ferry-dock
   - tick 23: moved to town-square
   - tick 24: moved to shop
2. Hades: shop → underworld-shore, set out at tick 143, 3 hops, arrived at tick 145
   - tick 143: moved to town-square
   - tick 144: moved to ferry-dock
   - tick 145: crossed from ferry-dock to underworld-shore
3. Hera: great-hall → town-square, set out at tick 165, 3 hops, arrived at tick 167
   - tick 165: moved to olympus-gate
   - tick 166: crossed from olympus-gate to mountain-path
   - tick 167: moved to town-square
4. Poseidon: ferry-dock → ancient-olive-tree, set out at tick 201, 4 hops, arrived at tick 204
   - tick 201: moved to town-square
   - tick 202: moved to wilderness-path
   - tick 203: moved to wilderness-grove
   - tick 204: moved to ancient-olive-tree
5. Zeus: great-hall → town-square, set out at tick 206, 3 hops, arrived at tick 208
   - tick 206: moved to olympus-gate
   - tick 207: crossed from olympus-gate to mountain-path
   - tick 208: moved to town-square
6. Athena: ancient-olive-tree → town-square, set out at tick 220, 3 hops, arrived at tick 222
   - tick 220: moved to wilderness-grove
   - tick 221: moved to wilderness-path
   - tick 222: moved to town-square

## Practice threads

### supplication [evt-68-1288]: hermes → market-trader-iris, expired

- Opened at tick 68
- Cause: unmet-need (market-trader-iris) [evt-6-155]
- Answers the prayer [evt-7-162]
- Moves:
  1. tick 68, Hermes: offer — market-trader-iris offers hermes 1 fish by tick 158
  2. tick 69, market-trader-iris: accept
- Boon: not seen
- Offering: seen made (evt-139-2478)
- Ending: expired at tick 159 (boon unanswered); remembered by hermes, market-trader-iris
- Changed: nothing beyond the memory of it

### supplication [evt-240-4090]: hephaestus → fisher-kallias, still open

- Opened at tick 240
- Cause: trouble (fisher-kallias) [evt-204-3528]
- Answers the prayer [evt-207-3567]
- Moves:
  1. tick 240, Hephaestus: offer — fisher-kallias offers hephaestus 1 fish by tick 330
  2. tick 241, fisher-kallias: accept
- Boon: not seen
- Offering: not seen

### supplication [evt-261-4406]: hera → farmer, still open

- Opened at tick 261
- Cause: wrong (market-trader-iris) [evt-199-3417]
- Answers the prayer [evt-201-3466]
- Moves:
  1. tick 261, Hera: offer — farmer offers hera 1 olives by tick 351
  2. tick 262, farmer: accept
- Boon: not seen
- Offering: not seen

## What each god practiced

- athena: travel; thread endings: none
- hades: travel; thread endings: none
- hephaestus: supplication; thread endings: none
- hera: supplication, travel; thread endings: none
- hermes: supplication; thread endings: expired [evt-68-1288]
- poseidon: travel; thread endings: none
- zeus: travel; thread endings: none

## Open threads at the end

- [evt-240-4090] supplication hephaestus → fisher-kallias, open 59 ticks (since tick 240): waits on hephaestus's boon on [evt-207-3567] and fisher-kallias's offering; ends by tick 330
- [evt-261-4406] supplication hera → farmer, open 38 ticks (since tick 261): waits on hera's boon on [evt-201-3466] and farmer's offering; ends by tick 351

## Moves judged no progress

No move was judged no progress.

## Turns while an obligation was open

A turn is performed, waited for a named event, or knowingly risked breach (R12, amended 2026-10-03: an acceptance binds).

Each turn is classified from the god's prompt and its proposal. An acceptance binds, so the god performs, waits, or risks breach, and bargaining is for a thread still open: the action the term calls for, committed, is performed; a turn that did something else is waited for a named event when its prompt shows what stops it (the digest's UNPERFORMABLE obstacle, or no mortal at the place a legend is to be told); every other turn, an attempt to bargain over the accepted thread included, is knowingly risked breach, since the obligation led the prompt.

| God | Tick | Thread | Deadline | Chose | Classified | Waiting for |
| --- | --- | --- | --- | --- | --- | --- |
| hermes | 87 | evt-68-1288 | 158 | report | knowingly risked breach |  |
| hephaestus | 261 | evt-240-4090 | 330 | legend | knowingly risked breach |  |

## Repetition

- Athena: longest run 1 of legend:legend (cap 3). Choices: legend:legend ×1, report:herdsman-damon ×1, travel:town-square ×1
- Hades: longest run 1 of travel:shop (cap 3). Choices: travel:shop ×1, travel:underworld-shore ×1
- Hephaestus: longest run 1 of legend:legend (cap 3). Choices: legend:legend ×2, report:provisioner-nikanor ×1, practice:offer evt-207-3567 ×1
- Hera: longest run 1 of travel:town-square (cap 3). Choices: travel:town-square ×1, practice:offer evt-201-3466 ×1
- Hermes: longest run 2 of report:ferryman (cap 3). Choices: report:ferryman ×2, practice:offer evt-7-162 ×1
- Poseidon: longest run 1 of report:ferryman (cap 3). Choices: report:ferryman ×1, travel:ancient-olive-tree ×1
- Zeus: longest run 1 of report:hera (cap 3). Choices: report:hera ×1, travel:town-square ×1

## Automated checks

| God | Check | Result | Detail |
| --- | --- | --- | --- |
| Athena | profile trace | pass | 3 actions: 1 ability-backed, 2 context-backed |
| Athena | repetition | pass | longest run 1 of legend:legend (cap 3) |
| Athena | minimum activity | FAIL | 3 committed model actions (at least 5) |
| Athena | influence | pass | 5 caused (told belief) |
| Athena | petition heard | pass | 4 petitions addressed to this god (at least 1) |
| Athena | petition answered | FAIL | 4 heard, none answered (at least 1) |
| Hades | profile trace | pass | 2 actions: 0 ability-backed, 2 context-backed |
| Hades | repetition | pass | longest run 1 of travel:shop (cap 3) |
| Hades | minimum activity | FAIL | 2 committed model actions (at least 5) |
| Hades | influence | FAIL | no told belief or relationship change traces to this god's proposals |
| Hades | petition heard | FAIL | no petition was addressed to this god (at least 1) |
| Hades | petition answered | pass | 0 heard; this god has no bless or strike to answer with, so none is required |
| Hephaestus | profile trace | pass | 4 actions: 2 ability-backed, 2 context-backed |
| Hephaestus | repetition | pass | longest run 1 of legend:legend (cap 3) |
| Hephaestus | minimum activity | FAIL | 4 committed model actions (at least 5) |
| Hephaestus | influence | pass | 6 caused (told belief) |
| Hephaestus | petition heard | pass | 1 petition addressed to this god (at least 1) |
| Hephaestus | petition answered | FAIL | 1 heard, none answered (at least 1) |
| Hera | profile trace | pass | 2 actions: 0 ability-backed, 2 context-backed |
| Hera | repetition | pass | longest run 1 of travel:town-square (cap 3) |
| Hera | minimum activity | FAIL | 2 committed model actions (at least 5) |
| Hera | influence | FAIL | no told belief or relationship change traces to this god's proposals |
| Hera | petition heard | pass | 4 petitions addressed to this god (at least 1) |
| Hera | petition answered | FAIL | 4 heard, none answered (at least 1) |
| Hermes | profile trace | pass | 3 actions: 2 ability-backed, 1 context-backed |
| Hermes | repetition | pass | longest run 2 of report:ferryman (cap 3) |
| Hermes | minimum activity | FAIL | 3 committed model actions (at least 5) |
| Hermes | influence | pass | 2 caused (told belief) |
| Hermes | petition heard | pass | 7 petitions addressed to this god (at least 1) |
| Hermes | petition answered | FAIL | 7 heard, none answered (at least 1) |
| Poseidon | profile trace | pass | 2 actions: 0 ability-backed, 2 context-backed |
| Poseidon | repetition | pass | longest run 1 of report:ferryman (cap 3) |
| Poseidon | minimum activity | FAIL | 2 committed model actions (at least 5) |
| Poseidon | influence | pass | 1 caused (told belief) |
| Poseidon | petition heard | pass | 7 petitions addressed to this god (at least 1) |
| Poseidon | petition answered | FAIL | 7 heard, none answered (at least 1) |
| Zeus | profile trace | pass | 2 actions: 0 ability-backed, 2 context-backed |
| Zeus | repetition | pass | longest run 1 of report:hera (cap 3) |
| Zeus | minimum activity | FAIL | 2 committed model actions (at least 5) |
| Zeus | influence | pass | 1 caused (told belief) |
| Zeus | petition heard | pass | 5 petitions addressed to this god (at least 1) |
| Zeus | petition answered | FAIL | 5 heard, none answered (at least 1) |

## Model run

- 20 requests: 19 answered (19 native, 0 repaired), 1 exhausted; latency p50 15047 ms, p95 19951 ms; prompt p50 6740 / max 9087 characters; frames showed model-degraded in 5% of polls
- exhaustion: 1 × term.resource: resource must be one of: cloth, currency, divinity, fish, food, olives, ore, planks, tools, wine, wood, w
- hera was refused after 2 attempts (term.resource: resource must be one of: cloth, currency, divinity, fish, food, olives, ore, planks, tools, wine, wood, wool); it sent {"action":"practice","move":"offer","prayer":"evt-3-60","term":{"kind":"make-offering","party":"farmer","deadlineTicks":90}}
- valid actions: held (18 proposals, all god actions, none rejected as malformed)
- perception compliance: held (every id named by 18 proposals was in the prompt behind it)
- relationship change with provenance: held (122 changes, 122 explained from the log alone, e.g. wrong > memory-recorded > relationship-changed)
- changed next action: held (hephaestus: legend: before its first belief, report:provisioner-nikanor after (changed))
- goal privacy: held (20 prompts checked against 0 goals: none carried another god's goal outside a told account or a perceived legend)
- petition privacy: held (20 prompts checked against 28 petitions: none listed a petition addressed to another god, and none carried one the god did not witness)
- god thread endings: FAILED (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: no thread ending it caused left a persistent consequence; hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: no thread ending it caused left a persistent consequence)
- supplication and settlement: FAILED (3 supplications, 0 settlements, 0 refused or breached)
- thread endings recorded: held (3 threads: 1 ended with their parties remembering, 2 still open and inside their deadlines)
- no reopening without a new cause: held (0 settlements, 0 opened as linked successors on a newer cause, none reopened a closed matter on an old one)
- no-progress moves advance nothing: held (0 moves judged no progress, each leaving a refusal record and advancing no thread; no counter restated an earlier offer)
- consequence changes a later choice: FAILED (no thread ending left a consequence on a god)
- obligated turns recorded: held (2 obligated turns, each with its recorded choice: 2 knowingly risked breach)
- contest endings: held (no contest was opened)
- alliances sealed by agreement: held (no alliance was formed)

Requests, in the order they ran (one at a time):

| # | God | Asked at tick | Applied at tick | Latency | Outcome | Prompt chars |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | athena | 1 | 17 | 15.0 s | answered | 5414 |
| 2 | hades | 17 | 22 | 4.2 s | answered | 3552 |
| 3 | hephaestus | 22 | 32 | 9.8 s | answered | 4856 |
| 4 | hera | 32 | — | 19.9 s | exhausted (invalid-output: term.resource: resource must be one of: cloth, currency, divinity, fish, food, olives, ore, planks, tools, wine, wood, w) | 6740 |
| 5 | hermes | 52 | 68 | 15.2 s | answered | 6249 |
| 6 | poseidon | 68 | 87 | 18.1 s | answered | 7300 |
| 7 | hermes | 87 | 103 | 15.0 s | answered | 6557 |
| 8 | zeus | 103 | 119 | 15.9 s | answered | 6926 |
| 9 | athena | 119 | 135 | 15.8 s | answered | 7508 |
| 10 | hades | 135 | 143 | 7.1 s | answered | 4186 |
| 11 | hephaestus | 143 | 155 | 11.2 s | answered | 5582 |
| 12 | hera | 155 | 165 | 9.3 s | answered | 6978 |
| 13 | hermes | 165 | 185 | 20.0 s | answered | 8079 |
| 14 | poseidon | 185 | 201 | 15.7 s | answered | 8653 |
| 15 | zeus | 201 | 206 | 4.4 s | answered | 4751 |
| 16 | athena | 206 | 220 | 13.3 s | answered | 8542 |
| 17 | hades | 220 | — | 2.5 s | answered | 3748 |
| 18 | hephaestus | 223 | 240 | 16.5 s | answered | 7391 |
| 19 | hera | 240 | 261 | 20.9 s | answered | 9087 |
| 20 | hephaestus | 261 | 281 | 19.2 s | answered | 6951 |
| 21 | hera | ≈280 | — | — | in flight at the end (inferred) | — |

Each god's turns (finished requests; the gap is the ticks between its request starts):

| God | Turns | Median gap (ticks) | p95 gap (ticks) | Worst gap (ticks) | Median latency |
| --- | --- | --- | --- | --- | --- |
| athena | 3 | 102.5 | 118 | 118 | 15.0 s |
| hades | 3 | 101.5 | 118 | 118 | 4.2 s |
| hephaestus | 4 | 80 | 121 | 121 | 13.8 s |
| hera | 3 | 104 | 123 | 123 | 19.9 s |
| hermes | 3 | 56.5 | 78 | 78 | 15.2 s |
| poseidon | 2 | 117 | 117 | 117 | 16.9 s |
| zeus | 2 | 98 | 98 | 98 | 10.1 s |

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

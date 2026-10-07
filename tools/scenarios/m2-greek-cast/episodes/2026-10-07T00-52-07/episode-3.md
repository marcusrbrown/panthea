# Episode 3 of 3

## Settings

- Recorded: 2026-10-07T01:07:19.484Z
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

1. **tick 12, Hades:** travel → ferry-dock (context-backed)
   - caused: journey-started (hades)
2. **tick 27, Hera:** travel → town-square (context-backed)
   - caused: journey-started (hera)
3. **tick 36, Hermes:** travel → town-square (context-backed)
   - caused: journey-started (hermes)
4. **tick 46, Poseidon:** travel → town-square (context-backed)
   - caused: journey-started (poseidon)
5. **tick 53, Zeus:** travel → town-square (context-backed)
   - caused: journey-started (zeus)
6. **tick 63, Athena:** travel → town-square (context-backed)
   - caused: journey-started (athena)
7. **tick 69, Hades:** travel → underworld-shore (context-backed)
   - caused: journey-started (hades)
8. **tick 90, Hera:** travel → ancient-olive-tree (context-backed)
   - caused: journey-started (hera)
9. **tick 105, Hermes:** travel → ferry-dock (context-backed)
   - caused: journey-started (hermes)
10. **tick 119, Poseidon:** travel → ferry-dock (context-backed)
   - caused: journey-started (poseidon)
11. **tick 134, Zeus:** practice → offer evt-5-106 (context-backed)
   - caused: practice-opened (zeus)
12. **tick 161, Hades:** travel → judgment-hall (context-backed)
   - caused: journey-started (hades)
13. **tick 168, Hephaestus:** travel → town-square (context-backed)
   - caused: journey-started (hephaestus)
14. **tick 178, Hera:** travel → town-square (context-backed)
   - caused: journey-started (hera)
15. **tick 193, Hermes:** travel → town-square (context-backed)
   - caused: journey-started (hermes)
16. **tick 208, Poseidon:** travel → town-square (context-backed)
   - caused: journey-started (poseidon)
17. **tick 224, Zeus:** practice → offer evt-171-2991 (context-backed)
   - caused: practice-opened (zeus)
18. **tick 258, Zeus:** travel → forge (context-backed)
   - caused: journey-started (zeus)
19. **tick 261, Hades:** travel → asphodel-meadow (context-backed)
   - caused: journey-started (hades)
20. **tick 275, Hephaestus:** travel → forge (context-backed)
   - caused: journey-started (hephaestus)
21. **tick 290, Hera:** travel → forge (context-backed)
   - caused: journey-started (hera)

## What the world did with every proposal

- dispositions: travel 19 × committed, practice 2 × committed, bless 1 × malformed

1. Hades: travel → ferry-dock — committed: journey-started
2. Hera: travel → town-square — committed: journey-started
3. Hermes: travel → town-square — committed: journey-started
4. Poseidon: travel → town-square — committed: journey-started
5. Zeus: travel → town-square — committed: journey-started
6. Athena: travel → town-square — committed: journey-started
7. Hades: travel → underworld-shore — committed: journey-started
8. Hera: travel → ancient-olive-tree — committed: journey-started
9. Hermes: travel → ferry-dock — committed: journey-started
10. Poseidon: travel → ferry-dock — committed: journey-started
11. Zeus: practice → offer evt-5-106 — committed: practice-opened
12. Zeus: bless → evt-5-106 — rejected: malformed
13. Hades: travel → judgment-hall — committed: journey-started
14. Hephaestus: travel → town-square — committed: journey-started
15. Hera: travel → town-square — committed: journey-started
16. Hermes: travel → town-square — committed: journey-started
17. Poseidon: travel → town-square — committed: journey-started
18. Zeus: practice → offer evt-171-2991 — committed: practice-opened
19. Zeus: travel → forge — committed: journey-started
20. Hades: travel → asphodel-meadow — committed: journey-started
21. Hephaestus: travel → forge — committed: journey-started
22. Hera: travel → forge — committed: journey-started

## The episode's numbers

- Food: 65 "cannot get food" lines; 22 of 43 prayers are about food
- Troubles in a god's domain: Athena 3, Hades 2, Hephaestus 2, Hera 2, Hermes 2, Poseidon 2, Zeus 3
- Wrongs between mortals: 10; 9 between different patrons
  - [evt-1-23] fisher-dion (hermes) wronged fisher-kallias (poseidon): cheating; the victim prayed [evt-5-110]; revenge
  - [evt-61-1152] woodcutter (zeus) wronged market-trader-iris (hermes): feud; the victim prayed [evt-64-1220]; revenge
  - [evt-141-2492] herdsman-damon (hermes) wronged weaver-ismene (athena): theft; the victim did not pray about it; no consequence yet
  - [evt-167-2918] weaver-xenia (hera) wronged herdsman-damon (hermes): feud; the victim prayed [evt-173-3041]; no consequence yet
  - [evt-198-3391] fisher-kallias (poseidon) wronged fisher-dion (hermes): feud; the victim prayed [evt-199-3415]; no consequence yet
  - [evt-199-3425] market-trader-iris (hermes) wronged farmer (hera): unpaid-debt; the victim prayed [evt-217-3751]; no consequence yet
  - [evt-252-4386] fisher-kallias (poseidon) wronged fisher-eleni (athena): unpaid-debt; the victim prayed [evt-254-4416]; no consequence yet
  - [evt-280-4863] olive-grower-leon (poseidon) wronged olive-grower-aristo (athena): feud; the victim prayed [evt-282-4920]; no consequence yet
  - [evt-286-5009] market-trader-iris (hermes) wronged woodcutter (zeus): feud; the victim prayed [evt-291-5117]; no consequence yet
- Defections: 0
- From a prayer's cause to its closing: 13 closed (median 153 ticks, p95 156 ticks); by outcome lapsed 13

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
- tick 36: a tool-flaw in athena's domain (spring, the god's floor) took 2 planks of farmer [evt-36-737]
- tick 37: woodcutter cannot get food (no-seller)
- tick 38: farmer prayed to athena: help with planks [evt-38-759] (a trouble in the god's domain: routed to the domain god)
- tick 50: a hoard-swallowed in hades's domain (spring, the god's floor) took 2 currency of weaver-zoe [evt-50-960]
- tick 55: a roof-leak in hera's domain (spring, the god's floor) took 2 food of farmer [evt-55-1037]
- tick 59: fisher-dion cannot get food (no-seller)
- tick 60: farmer prayed to hera: help with food [evt-60-1115] (a trouble in the god's domain: routed to the domain god)
- tick 60: fisher-eleni cannot get food (no-seller)
- tick 61: woodcutter wronged market-trader-iris: feud of 2 food; quarrelsome, not in need [evt-61-1152]
- tick 61: fisher-dion cannot get food (no-seller)
- tick 62: fisher-dion prayed to hermes: help with food [evt-62-1183] (routed to its patron)
- tick 64: market-trader-iris prayed to hermes: punish woodcutter, who owns woodshed [evt-64-1220] (routed to its patron)
- tick 67: a tool-flaw in athena's domain (spring, the season's odds) took 2 tools of smith-brontes [evt-67-1294]
- tick 68: fisher-kallias cannot get food (no-funds)
- tick 68: fisher-dion cannot get fish (no-buyer)
- tick 72: fisher-dion cannot get fish (no-buyer)
- tick 81: a harbour-surge in poseidon's domain (spring, the god's floor) damaged fish-landing of ferryman [evt-81-1546]
- tick 84: ferryman prayed to poseidon: help with fish-landing [evt-84-1579] (a trouble in the god's domain: routed to the domain god)
- tick 96: market-trader-iris cannot get food (no-funds)
- tick 98: market-trader-iris prayed to hermes: help with food [evt-98-1792] (routed to its patron)
- tick 112: a lightning-fire in zeus's domain (spring, the god's floor) took 1 food of fisher-stavros [evt-112-2014]
- tick 113: fisher-stavros cannot get food (no-seller)
- tick 114: fisher-stavros prayed to poseidon: help with food [evt-114-2039] (routed to its patron)
- tick 116: market-trader-iris cannot get food (no-funds)
- tick 118: fisher-stavros cannot get fish (no-buyer)
- tick 120: the director made smith-ktesias take 107 food from ferryman
- tick 123: ferryman prayed to hermes: help with food [evt-123-2198] (not its authored patron (a defection or a domain))
- tick 124: a vanished-goods in hermes's domain (spring, the god's floor) took 2 food of smith-ktesias [evt-124-2222]
- tick 131: fisher-stavros cannot get fish (no-buyer)
- tick 136: market-trader-iris cannot get food (no-funds)
- tick 136: smith-delia cannot get food (no-funds)
- tick 139: a cracked-tools in hephaestus's domain (spring, the god's floor) took 2 tools of smith-delia [evt-139-2458]
- tick 141: herdsman-damon wronged weaver-ismene: theft of 2 cloth; greedy, not in need [evt-141-2492]
- tick 141: weaver-zoe cannot get food (no-seller)
- tick 142: weaver-zoe prayed to athena: help with food [evt-142-2505] (routed to its patron)
- tick 144: weaver-zoe cannot get food (no-seller)
- tick 149: fisher-kallias cannot get food (no-funds)
- tick 151: fisher-kallias prayed to poseidon: help with food [evt-151-2637] (routed to its patron)
- tick 154: fisher-kallias cannot get fish (no-buyer)
- tick 154: farmer's prayer to hera lapsed unanswered [evt-3-60]
- tick 154: farmer remembers hera's silence
- tick 154: farmer → hera: affinity -2, grudge +1
- tick 156: market-trader-iris cannot get food (no-funds)
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
- tick 165: fisher-melina cannot get food (no-funds)
- tick 167: fisher-melina prayed to poseidon: help with food [evt-167-2910] (routed to its patron)
- tick 167: weaver-xenia wronged herdsman-damon: feud of 2 food; proud, not in need [evt-167-2918]
- tick 168: fisher-kallias cannot get food (no-funds)
- tick 168: weaver-xenia cannot get wool (no-buyer)
- tick 170: fisher-melina cannot get fish (no-buyer)
- tick 170: fisher-stavros cannot get food (no-seller)
- tick 170: weaver-xenia cannot get wool (no-buyer)
- tick 171: fisher-stavros prayed to zeus: help with food [evt-171-2991] (a trouble in the god's domain: routed to the domain god)
- tick 172: weaver-xenia cannot get wool (no-buyer)
- tick 173: herdsman-damon prayed to hermes: punish weaver-xenia, who owns  [evt-173-3041] (routed to its patron)
- tick 173: weaver-xenia cannot get food (no-seller)
- tick 175: fisher-kallias cannot get food (no-funds)
- tick 175: fisher-melina cannot get fish (no-buyer)
- tick 175: fisher-stavros cannot get fish (no-buyer)
- tick 187: fisher-melina cannot get fish (no-buyer)
- tick 187: fisher-stavros cannot get fish (no-buyer)
- tick 189: farmer's prayer to athena lapsed unanswered [evt-38-759]
- tick 189: farmer remembers athena's silence
- tick 189: farmer → athena: affinity -2, grudge +1
- tick 191: a squall in zeus's domain (spring, the god's floor) damaged the-forge of smith-ktesias [evt-191-3260]
- tick 192: a cracked-tools in hephaestus's domain (spring, the god's floor) took 2 tools of farmer [evt-192-3270]
- tick 193: fisher-kallias cannot get food (no-seller)
- tick 193: fisher-eleni cannot get food (no-seller)
- tick 193: fisher-dion cannot get food (no-seller)
- tick 193: olive-grower-aristo cannot get food (no-seller)
- tick 193: olive-grower-phoebe cannot get food (no-seller)
- tick 193: olive-grower-leon cannot get food (no-seller)
- tick 193: weaver-ismene cannot get food (no-seller)
- tick 193: weaver-zoe cannot get food (no-seller)
- tick 193: weaver-xenia cannot get food (no-seller)
- tick 193: smith-brontes cannot get food (no-seller)
- tick 193: smith-delia cannot get food (no-seller)
- tick 195: farmer prayed to hephaestus: help with tools [evt-195-3314] (a trouble in the god's domain: routed to the domain god)
- tick 195: fisher-kallias cannot get fish (no-buyer)
- tick 195: fisher-melina cannot get fish (no-buyer)
- tick 195: fisher-stavros cannot get fish (no-buyer)
- tick 195: fisher-eleni cannot get fish (no-buyer)
- tick 195: fisher-dion cannot get fish (no-buyer)
- tick 196: market-trader-iris cannot get food (no-funds)
- tick 196: olive-grower-aristo cannot get food (no-seller)
- tick 196: olive-grower-phoebe cannot get food (no-seller)
- tick 196: olive-grower-leon cannot get food (no-seller)
- tick 197: olive-grower-aristo prayed to athena: help with food [evt-197-3365] (routed to its patron)
- tick 197: olive-grower-phoebe prayed to athena: help with food [evt-197-3366] (routed to its patron)
- tick 197: olive-grower-leon prayed to poseidon: help with food [evt-197-3367] (routed to its patron)
- tick 198: fisher-kallias wronged fisher-dion: feud of 2 fish; greedy, in need; a revenge for [evt-1-23] [evt-198-3391]
- tick 198: fisher-kallias cannot get fish (no-buyer)
- tick 198: fisher-melina cannot get fish (no-buyer)
- tick 198: fisher-stavros cannot get fish (no-buyer)
- tick 198: fisher-dion cannot get fish (no-buyer)
- tick 199: fisher-kallias prayed to poseidon: help with fish [evt-199-3411] (routed to its patron)
- tick 199: fisher-melina prayed to poseidon: help with fish [evt-199-3412] (routed to its patron)
- tick 199: fisher-stavros prayed to poseidon: help with fish [evt-199-3413] (routed to its patron)
- tick 199: fisher-eleni prayed to athena: help with food [evt-199-3414] (routed to its patron)
- tick 199: fisher-dion prayed to hermes: punish fisher-kallias, who owns  [evt-199-3415] (routed to its patron)
- tick 199: market-trader-iris wronged farmer: unpaid-debt of 3 currency; greedy, not in need; the credit [evt-99-1826] failed [evt-199-3425]
- tick 199: olive-grower-phoebe cannot get food (no-seller)
- tick 199: olive-grower-leon cannot get food (no-seller)
- tick 200: the season turned from spring to summer
- tick 200: weaver-zoe cannot get food (no-seller)
- tick 202: weaver-zoe cannot get wool (no-buyer)
- tick 204: olive-grower-leon cannot get olives (no-buyer)
- tick 204: weaver-zoe cannot get wool (no-buyer)
- tick 205: fisher-eleni cannot get fish (no-buyer)
- tick 205: olive-grower-aristo cannot get olives (no-buyer)
- tick 205: olive-grower-phoebe cannot get olives (no-buyer)
- tick 206: weaver-zoe cannot get wool (no-buyer)
- tick 207: a damp in hera's domain (summer, the god's floor) took 2 cloth of olive-grower-leon [evt-207-3574]
- tick 208: olive-grower-aristo cannot get food (no-funds)
- tick 208: olive-grower-aristo cannot get olives (no-buyer)
- tick 208: olive-grower-phoebe cannot get olives (no-buyer)
- tick 208: olive-grower-leon cannot get olives (no-buyer)
- tick 208: weaver-zoe cannot get wool (no-buyer)
- tick 210: weaver-zoe cannot get wool (no-buyer)
- tick 211: olive-grower-aristo cannot get olives (no-buyer)
- tick 211: olive-grower-phoebe cannot get olives (no-buyer)
- tick 211: olive-grower-leon cannot get olives (no-buyer)
- tick 211: farmer's prayer to hera lapsed unanswered [evt-60-1115]
- tick 211: farmer remembers hera's silence
- tick 211: farmer → hera: affinity -2, grudge +1
- tick 212: weaver-zoe cannot get wool (no-buyer)
- tick 213: fisher-kallias cannot get fish (no-buyer)
- tick 213: fisher-eleni cannot get fish (no-buyer)
- tick 213: fisher-dion's prayer to hermes lapsed unanswered [evt-62-1183]
- tick 213: fisher-dion remembers hermes's silence
- tick 213: fisher-dion → hermes: affinity -2, grudge +1
- tick 214: weaver-zoe cannot get wool (no-buyer)
- tick 215: market-trader-iris's prayer to hermes lapsed unanswered [evt-64-1220]
- tick 215: market-trader-iris remembers hermes's silence
- tick 215: market-trader-iris → hermes: affinity -2, grudge +1
- tick 216: market-trader-iris cannot get food (no-funds)
- tick 216: fisher-melina cannot get food (no-seller)
- tick 216: fisher-melina cannot get fish (no-buyer)
- tick 216: fisher-stavros cannot get food (no-seller)
- tick 216: fisher-stavros cannot get fish (no-buyer)
- tick 216: fisher-dion cannot get food (no-seller)
- tick 216: fisher-dion cannot get fish (no-buyer)
- tick 216: weaver-ismene cannot get food (no-seller)
- tick 216: weaver-xenia cannot get food (no-seller)
- tick 216: smith-brontes cannot get food (no-seller)
- tick 216: smith-delia cannot get food (no-seller)
- tick 217: farmer prayed to hera: punish market-trader-iris, who owns  [evt-217-3751] (routed to its patron)
- tick 217: woodcutter cannot get food (no-seller)
- tick 217: market-trader-iris cannot get wine (no-buyer)
- tick 218: weaver-zoe cannot get food (no-seller)
- tick 219: woodcutter prayed to zeus: help with food [evt-219-3801] (routed to its patron)
- tick 219: market-trader-iris prayed to hermes: help with wine [evt-219-3803] (routed to its patron)
- tick 219: weaver-ismene prayed to athena: help with food [evt-219-3810] (routed to its patron)
- tick 219: weaver-xenia prayed to hera: help with food [evt-219-3812] (routed to its patron)
- tick 219: smith-ktesias prayed to zeus: help with the-forge [evt-219-3814] (a trouble in the god's domain: routed to the domain god)
- tick 219: smith-brontes prayed to hephaestus: help with food [evt-219-3815] (routed to its patron)
- tick 219: smith-delia prayed to athena: help with food [evt-219-3816] (routed to its patron)
- tick 219: fisher-kallias cannot get fish (no-buyer)
- tick 219: fisher-melina cannot get fish (no-buyer)
- tick 219: fisher-stavros cannot get fish (no-buyer)
- tick 219: fisher-eleni cannot get fish (no-buyer)
- tick 219: fisher-dion cannot get fish (no-buyer)
- tick 219: weaver-zoe cannot get wool (no-buyer)
- tick 221: weaver-zoe cannot get wool (no-buyer)
- tick 222: a vanished-goods in hermes's domain (summer, the god's floor) took 2 olives of weaver-xenia [evt-222-3890]
- tick 223: weaver-zoe cannot get wool (no-buyer)
- tick 225: weaver-zoe cannot get wool (no-buyer)
- tick 227: fisher-kallias cannot get fish (no-buyer)
- tick 227: fisher-melina cannot get fish (no-buyer)
- tick 227: fisher-stavros cannot get fish (no-buyer)
- tick 227: weaver-zoe cannot get wool (no-buyer)
- tick 229: fisher-eleni cannot get food (no-funds)
- tick 229: weaver-zoe cannot get wool (no-buyer)
- tick 230: fisher-kallias cannot get fish (no-buyer)
- tick 230: fisher-melina cannot get fish (no-buyer)
- tick 230: fisher-stavros cannot get fish (no-buyer)
- tick 231: weaver-zoe cannot get wool (no-buyer)
- tick 232: fisher-eleni cannot get food (no-funds)
- tick 233: weaver-zoe cannot get wool (no-buyer)
- tick 235: fisher-eleni cannot get food (no-funds)
- tick 235: weaver-zoe cannot get wool (no-buyer)
- tick 235: ferryman's prayer to poseidon lapsed unanswered [evt-84-1579]
- tick 235: ferryman remembers poseidon's silence
- tick 235: ferryman → poseidon: affinity -2, grudge +1
- tick 237: weaver-zoe cannot get wool (no-buyer)
- tick 240: fisher-eleni cannot get food (no-funds)
- tick 240: the director spoiled 154 food of ferryman
- tick 247: fisher-kallias cannot get fish (no-buyer)
- tick 247: fisher-melina cannot get fish (no-buyer)
- tick 247: fisher-stavros cannot get fish (no-buyer)
- tick 249: market-trader-iris's prayer to hermes lapsed unanswered [evt-98-1792]
- tick 249: market-trader-iris remembers hermes's silence
- tick 249: market-trader-iris → hermes: affinity -2, grudge +1
- tick 250: fisher-kallias cannot get fish (no-buyer)
- tick 250: fisher-melina cannot get fish (no-buyer)
- tick 250: fisher-stavros cannot get fish (no-buyer)
- tick 252: fisher-kallias wronged fisher-eleni: unpaid-debt of 3 currency; greedy, not in need; the credit [evt-152-2665] failed [evt-252-4386]
- tick 252: fisher-kallias cannot get fish (no-buyer)
- tick 252: fisher-melina cannot get fish (no-buyer)
- tick 252: fisher-stavros cannot get fish (no-buyer)
- tick 254: fisher-eleni prayed to athena: punish fisher-kallias, who owns  [evt-254-4416] (routed to its patron)
- tick 256: market-trader-iris cannot get food (no-funds)
- tick 257: fisher-eleni cannot get fish (no-buyer)
- tick 258: market-trader-iris prayed to hermes: help with food [evt-258-4466] (routed to its patron)
- tick 262: a quake in poseidon's domain (summer, the god's floor) damaged woodshed of woodcutter [evt-262-4556]
- tick 264: woodcutter prayed to poseidon: help with woodshed [evt-264-4572] (a trouble in the god's domain: routed to the domain god)
- tick 265: fisher-stavros's prayer to poseidon lapsed unanswered [evt-114-2039]
- tick 265: fisher-stavros remembers poseidon's silence
- tick 265: fisher-stavros → poseidon: affinity -2, grudge +1
- tick 267: fisher-kallias cannot get fish (no-buyer)
- tick 267: fisher-melina cannot get fish (no-buyer)
- tick 267: fisher-stavros cannot get fish (no-buyer)
- tick 267: fisher-eleni cannot get fish (no-buyer)
- tick 270: fisher-kallias cannot get fish (no-buyer)
- tick 270: fisher-melina cannot get fish (no-buyer)
- tick 270: fisher-stavros cannot get fish (no-buyer)
- tick 270: fisher-eleni cannot get fish (no-buyer)
- tick 272: fisher-kallias cannot get fish (no-buyer)
- tick 272: fisher-melina cannot get fish (no-buyer)
- tick 272: fisher-stavros cannot get fish (no-buyer)
- tick 272: fisher-eleni cannot get fish (no-buyer)
- tick 274: ferryman's prayer to hermes lapsed unanswered [evt-123-2198]
- tick 274: ferryman remembers hermes's silence
- tick 274: ferryman → hermes: affinity -2, grudge +1
- tick 276: a tool-flaw in athena's domain (summer, the god's floor) took 1 planks of market-trader-iris [evt-276-4800]
- tick 276: market-trader-iris cannot get food (no-funds)
- tick 277: ferryman prayed to hera: help with food [evt-277-4807] (not its authored patron (a defection or a domain))
- tick 280: market-trader-iris prayed to athena: help with planks [evt-280-4849] (a trouble in the god's domain: routed to the domain god)
- tick 280: olive-grower-leon wronged olive-grower-aristo: feud of 2 cloth; quarrelsome, not in need [evt-280-4863]
- tick 280: fisher-eleni cannot get food (no-funds)
- tick 282: olive-grower-aristo prayed to athena: punish olive-grower-leon, who owns  [evt-282-4920] (routed to its patron)
- tick 282: olive-grower-leon cannot get food (no-seller)
- tick 283: olive-grower-leon prayed to hera: help with cloth [evt-283-4936] (a trouble in the god's domain: routed to the domain god)
- tick 283: olive-grower-leon cannot get cloth (no-seller)
- tick 285: market-trader-iris wronged fisher-dion: cheating of 2 currency; greedy, not in need [evt-285-4970]
- tick 285: olive-grower-leon cannot get food (no-seller)
- tick 285: olive-grower-leon cannot get cloth (no-seller)
- tick 286: market-trader-iris wronged woodcutter: feud of 1 food; greedy, not in need; a revenge for [evt-61-1152] [evt-286-5009]
- tick 286: a hoard-swallowed in hades's domain (summer, the god's floor) took 2 currency of olive-grower-aristo [evt-286-5010]
- tick 287: olive-grower-aristo cannot get olives (no-buyer)
- tick 289: fisher-stavros cannot get food (no-funds)
- tick 289: olive-grower-leon cannot get olives (no-buyer)
- tick 290: fisher-kallias cannot get fish (no-buyer)
- tick 290: fisher-melina cannot get fish (no-buyer)
- tick 290: fisher-stavros cannot get fish (no-buyer)
- tick 290: fisher-eleni cannot get food (no-funds)
- tick 291: woodcutter prayed to zeus: punish market-trader-iris, who owns  [evt-291-5117] (routed to its patron)
- tick 291: fisher-dion cannot get food (no-seller)
- tick 291: olive-grower-aristo cannot get olives (no-buyer)
- tick 292: fisher-dion prayed to hermes: help with food [evt-292-5146] (routed to its patron)
- tick 293: weaver-zoe's prayer to athena lapsed unanswered [evt-142-2505]
- tick 293: weaver-zoe remembers athena's silence
- tick 293: weaver-zoe → athena: affinity -2, grudge +1
- tick 294: fisher-eleni cannot get food (no-funds)
- tick 295: fisher-stavros's offering to zeus was seen made [evt-224-3917] (evt-295-5192)
- tick 296: fisher-kallias cannot get fish (no-buyer)
- tick 296: fisher-melina cannot get fish (no-buyer)
- tick 296: fisher-stavros cannot get fish (no-buyer)
- tick 296: fisher-dion cannot get fish (no-buyer)
- tick 297: market-trader-iris cannot get food (no-funds)
- tick 300: a squall in zeus's domain (summer, the god's floor) damaged woodshed of woodcutter [evt-300-5302]
- tick 300: fisher-eleni cannot get food (no-funds)

## Journeys

- journeys: 19 started: 19 arrived, 0 refused, 0 replaced, 0 still travelling

1. Hades: underworld-shore → ferry-dock, set out at tick 12, 1 hop, arrived at tick 12
   - tick 12: crossed from underworld-shore to ferry-dock
2. Hera: great-hall → town-square, set out at tick 27, 3 hops, arrived at tick 29
   - tick 27: moved to olympus-gate
   - tick 28: crossed from olympus-gate to mountain-path
   - tick 29: moved to town-square
3. Hermes: ferry-dock → town-square, set out at tick 36, 1 hop, arrived at tick 36
   - tick 36: moved to town-square
4. Poseidon: ferry-dock → town-square, set out at tick 46, 1 hop, arrived at tick 46
   - tick 46: moved to town-square
5. Zeus: great-hall → town-square, set out at tick 53, 3 hops, arrived at tick 55
   - tick 53: moved to olympus-gate
   - tick 54: crossed from olympus-gate to mountain-path
   - tick 55: moved to town-square
6. Athena: ancient-olive-tree → town-square, set out at tick 63, 3 hops, arrived at tick 65
   - tick 63: moved to wilderness-grove
   - tick 64: moved to wilderness-path
   - tick 65: moved to town-square
7. Hades: ferry-dock → underworld-shore, set out at tick 69, 1 hop, arrived at tick 69
   - tick 69: crossed from ferry-dock to underworld-shore
8. Hera: town-square → ancient-olive-tree, set out at tick 90, 3 hops, arrived at tick 92
   - tick 90: moved to wilderness-path
   - tick 91: moved to wilderness-grove
   - tick 92: moved to ancient-olive-tree
9. Hermes: town-square → ferry-dock, set out at tick 105, 1 hop, arrived at tick 105
   - tick 105: moved to ferry-dock
10. Poseidon: town-square → ferry-dock, set out at tick 119, 1 hop, arrived at tick 119
   - tick 119: moved to ferry-dock
11. Hades: underworld-shore → judgment-hall, set out at tick 161, 2 hops, arrived at tick 162
   - tick 161: moved to asphodel-meadow
   - tick 162: moved to judgment-hall
12. Hephaestus: forge → town-square, set out at tick 168, 1 hop, arrived at tick 168
   - tick 168: moved to town-square
13. Hera: ancient-olive-tree → town-square, set out at tick 178, 3 hops, arrived at tick 180
   - tick 178: moved to wilderness-grove
   - tick 179: moved to wilderness-path
   - tick 180: moved to town-square
14. Hermes: ferry-dock → town-square, set out at tick 193, 1 hop, arrived at tick 193
   - tick 193: moved to town-square
15. Poseidon: ferry-dock → town-square, set out at tick 208, 1 hop, arrived at tick 208
   - tick 208: moved to town-square
16. Zeus: town-square → forge, set out at tick 258, 1 hop, arrived at tick 258
   - tick 258: moved to forge
17. Hades: judgment-hall → asphodel-meadow, set out at tick 261, 1 hop, arrived at tick 261
   - tick 261: moved to asphodel-meadow
18. Hephaestus: town-square → forge, set out at tick 275, 1 hop, arrived at tick 275
   - tick 275: moved to forge
19. Hera: town-square → forge, set out at tick 290, 1 hop, arrived at tick 290
   - tick 290: moved to forge

## Practice threads

### supplication [evt-134-2359]: zeus → woodcutter, expired

- Opened at tick 134
- Cause: unmet-need (woodcutter) [evt-2-56]
- Answers the prayer [evt-5-106]
- Moves:
  1. tick 134, Zeus: offer — woodcutter offers zeus 1 currency by tick 224
  2. tick 135, woodcutter: accept
- Boon: not seen
- Offering: not seen
- Ending: expired at tick 157 (boon unanswered); remembered by woodcutter, zeus
- Changed: nothing beyond the memory of it

### supplication [evt-224-3917]: zeus → fisher-stavros, still open

- Opened at tick 224
- Cause: trouble (fisher-stavros) [evt-112-2014]
- Answers the prayer [evt-171-2991]
- Moves:
  1. tick 224, Zeus: offer — fisher-stavros offers zeus 1 cloth by tick 314
  2. tick 225, fisher-stavros: accept
- Boon: not seen
- Offering: seen made (evt-295-5192)

## What each god practiced

- athena: travel; thread endings: none
- hades: travel; thread endings: none
- hephaestus: travel; thread endings: none
- hera: travel; thread endings: none
- hermes: travel; thread endings: none
- poseidon: travel; thread endings: none
- zeus: supplication, travel; thread endings: expired [evt-134-2359]

## Open threads at the end

- [evt-224-3917] supplication zeus → fisher-stavros, open 76 ticks (since tick 224): waits on zeus's boon on [evt-171-2991]; ends by tick 314

## Moves judged no progress

No move was judged no progress.

## Turns while an obligation was open

A turn is performed, waited for a named event, or knowingly risked breach (R12, amended 2026-10-03: an acceptance binds).

Each turn is classified from the god's prompt and its proposal. An acceptance binds, so the god performs, waits, or risks breach, and bargaining is for a thread still open: the action the term calls for, committed, is performed; a turn that did something else is waited for a named event when its prompt shows what stops it (the digest's UNPERFORMABLE obstacle, or no mortal at the place a legend is to be told); every other turn, an attempt to bargain over the accepted thread included, is knowingly risked breach, since the obligation led the prompt.

| God | Tick | Thread | Deadline | Chose | Classified | Waiting for |
| --- | --- | --- | --- | --- | --- | --- |
| zeus | 148 | evt-134-2359 | 224 | bless (refused: malformed) | knowingly risked breach |  |
| zeus | 243 | evt-224-3917 | 314 | travel | knowingly risked breach |  |

## Repetition

- Athena: longest run 1 of travel:town-square (cap 3). Choices: travel:town-square ×1
- Hades: longest run 1 of travel:ferry-dock (cap 3). Choices: travel:ferry-dock ×1, travel:underworld-shore ×1, travel:judgment-hall ×1, travel:asphodel-meadow ×1
- Hephaestus: longest run 1 of travel:town-square (cap 3). Choices: travel:town-square ×1, travel:forge ×1
- Hera: longest run 1 of travel:town-square (cap 3). Choices: travel:town-square ×2, travel:ancient-olive-tree ×1, travel:forge ×1
- Hermes: longest run 1 of travel:town-square (cap 3). Choices: travel:town-square ×2, travel:ferry-dock ×1
- Poseidon: longest run 1 of travel:town-square (cap 3). Choices: travel:town-square ×2, travel:ferry-dock ×1
- Zeus: longest run 1 of travel:town-square (cap 3). Choices: travel:town-square ×1, practice:offer evt-5-106 ×1, practice:offer evt-171-2991 ×1, travel:forge ×1

## Automated checks

| God | Check | Result | Detail |
| --- | --- | --- | --- |
| Athena | profile trace | pass | 1 actions: 0 ability-backed, 1 context-backed |
| Athena | repetition | pass | longest run 1 of travel:town-square (cap 3) |
| Athena | minimum activity | FAIL | 1 committed model actions (at least 5) |
| Athena | influence | FAIL | no told belief or relationship change traces to this god's proposals |
| Athena | petition heard | pass | 10 petitions addressed to this god (at least 1) |
| Athena | petition answered | FAIL | 10 heard, none answered (at least 1) |
| Hades | profile trace | pass | 4 actions: 0 ability-backed, 4 context-backed |
| Hades | repetition | pass | longest run 1 of travel:ferry-dock (cap 3) |
| Hades | minimum activity | FAIL | 4 committed model actions (at least 5) |
| Hades | influence | FAIL | no told belief or relationship change traces to this god's proposals |
| Hades | petition heard | FAIL | no petition was addressed to this god (at least 1) |
| Hades | petition answered | pass | 0 heard; this god has no bless or strike to answer with, so none is required |
| Hephaestus | profile trace | pass | 2 actions: 0 ability-backed, 2 context-backed |
| Hephaestus | repetition | pass | longest run 1 of travel:town-square (cap 3) |
| Hephaestus | minimum activity | FAIL | 2 committed model actions (at least 5) |
| Hephaestus | influence | FAIL | no told belief or relationship change traces to this god's proposals |
| Hephaestus | petition heard | pass | 2 petitions addressed to this god (at least 1) |
| Hephaestus | petition answered | FAIL | 2 heard, none answered (at least 1) |
| Hera | profile trace | pass | 4 actions: 0 ability-backed, 4 context-backed |
| Hera | repetition | pass | longest run 1 of travel:town-square (cap 3) |
| Hera | minimum activity | FAIL | 4 committed model actions (at least 5) |
| Hera | influence | FAIL | no told belief or relationship change traces to this god's proposals |
| Hera | petition heard | pass | 6 petitions addressed to this god (at least 1) |
| Hera | petition answered | FAIL | 6 heard, none answered (at least 1) |
| Hermes | profile trace | pass | 3 actions: 0 ability-backed, 3 context-backed |
| Hermes | repetition | pass | longest run 1 of travel:town-square (cap 3) |
| Hermes | minimum activity | FAIL | 3 committed model actions (at least 5) |
| Hermes | influence | FAIL | no told belief or relationship change traces to this god's proposals |
| Hermes | petition heard | pass | 10 petitions addressed to this god (at least 1) |
| Hermes | petition answered | FAIL | 10 heard, none answered (at least 1) |
| Poseidon | profile trace | pass | 3 actions: 0 ability-backed, 3 context-backed |
| Poseidon | repetition | pass | longest run 1 of travel:town-square (cap 3) |
| Poseidon | minimum activity | FAIL | 3 committed model actions (at least 5) |
| Poseidon | influence | FAIL | no told belief or relationship change traces to this god's proposals |
| Poseidon | petition heard | pass | 10 petitions addressed to this god (at least 1) |
| Poseidon | petition answered | FAIL | 10 heard, none answered (at least 1) |
| Zeus | profile trace | pass | 4 actions: 0 ability-backed, 4 context-backed |
| Zeus | repetition | pass | longest run 1 of travel:town-square (cap 3) |
| Zeus | minimum activity | FAIL | 4 committed model actions (at least 5) |
| Zeus | influence | FAIL | no told belief or relationship change traces to this god's proposals |
| Zeus | petition heard | pass | 5 petitions addressed to this god (at least 1) |
| Zeus | petition answered | FAIL | 5 heard, none answered (at least 1) |

## Model run

- 27 requests: 22 answered (22 native, 0 repaired), 5 exhausted; latency p50 9574 ms, p95 15281 ms; prompt p50 7308 / max 9814 characters; frames showed model-degraded in 15% of polls
- exhaustion: 5 × assertion: assertion must be 1 to 280 characters
- athena was refused after 2 attempts (assertion: assertion must be 1 to 280 characters); it sent {"action":"legend","linkedEventId":"evt-1-10"}
- hephaestus was refused after 2 attempts (assertion: assertion must be 1 to 280 characters); it sent {"action":"legend","linkedEventId":"evt-12-285"}
- hephaestus was refused after 2 attempts (assertion: assertion must be 1 to 280 characters); it sent {"action":"legend","linkedEventId":"evt-69-1340"}
- athena was refused after 2 attempts (assertion: assertion must be 1 to 280 characters); it sent {"action":"legend","linkedEventId":"evt-133-2348"}
- athena was refused after 2 attempts (assertion: assertion must be 1 to 280 characters); it sent {"action":"legend","linkedEventId":"evt-224-3926"}
- valid actions: FAILED (0 not god actions (), 1 rejected as malformed)
- perception compliance: held (every id named by 22 proposals was in the prompt behind it)
- relationship change with provenance: held (83 changes, 83 explained from the log alone, e.g. wrong > memory-recorded > relationship-changed)
- changed next action: FAILED (no god both formed a belief or feeling and acted on either side of it)
- goal privacy: held (27 prompts checked against 0 goals: none carried another god's goal outside a told account or a perceived legend)
- petition privacy: held (27 prompts checked against 43 petitions: none listed a petition addressed to another god, and none carried one the god did not witness)
- god thread endings: FAILED (athena: no thread ending it caused left a persistent consequence; hades: no thread ending it caused left a persistent consequence; hephaestus: no thread ending it caused left a persistent consequence; hera: no thread ending it caused left a persistent consequence; hermes: no thread ending it caused left a persistent consequence; poseidon: no thread ending it caused left a persistent consequence; zeus: no thread ending it caused left a persistent consequence)
- supplication and settlement: FAILED (2 supplications, 0 settlements, 0 refused or breached)
- thread endings recorded: held (2 threads: 1 ended with their parties remembering, 1 still open and inside their deadlines)
- no reopening without a new cause: held (0 settlements, 0 opened as linked successors on a newer cause, none reopened a closed matter on an old one)
- no-progress moves advance nothing: held (0 moves judged no progress, each leaving a refusal record and advancing no thread; no counter restated an earlier offer)
- consequence changes a later choice: FAILED (no thread ending left a consequence on a god)
- obligated turns recorded: held (2 obligated turns, each with its recorded choice: 2 knowingly risked breach)
- contest endings: held (no contest was opened)
- alliances sealed by agreement: held (no alliance was formed)

Requests, in the order they ran (one at a time):

| # | God | Asked at tick | Applied at tick | Latency | Outcome | Prompt chars |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | athena | 1 | — | 7.0 s | exhausted (invalid-output: assertion: assertion must be 1 to 280 characters) | 5206 |
| 2 | hades | 9 | 12 | 2.1 s | answered | 3460 |
| 3 | hephaestus | 12 | — | 7.3 s | exhausted (invalid-output: assertion: assertion must be 1 to 280 characters) | 4648 |
| 4 | hera | 20 | 27 | 6.8 s | answered | 6768 |
| 5 | hermes | 27 | 36 | 8.9 s | answered | 6312 |
| 6 | poseidon | 36 | 46 | 9.2 s | answered | 7066 |
| 7 | zeus | 46 | 53 | 7.0 s | answered | 6659 |
| 8 | athena | 53 | 63 | 9.6 s | answered | 7308 |
| 9 | hades | 63 | 69 | 5.5 s | answered | 4350 |
| 10 | hephaestus | 69 | — | 7.3 s | exhausted (invalid-output: assertion: assertion must be 1 to 280 characters) | 4637 |
| 11 | hera | 77 | 90 | 12.2 s | answered | 8413 |
| 12 | hermes | 90 | 105 | 14.1 s | answered | 8243 |
| 13 | poseidon | 105 | 119 | 13.2 s | answered | 8551 |
| 14 | zeus | 119 | 134 | 14.4 s | answered | 7889 |
| 15 | athena | 134 | — | 13.8 s | exhausted (invalid-output: assertion: assertion must be 1 to 280 characters) | 7620 |
| 16 | zeus | 148 | 158 | 9.5 s | answered | 7244 |
| 17 | hades | 158 | 161 | 2.9 s | answered | 3585 |
| 18 | hephaestus | 161 | 168 | 6.7 s | answered | 5186 |
| 19 | hera | 168 | 178 | 9.9 s | answered | 7614 |
| 20 | hermes | 178 | 193 | 14.3 s | answered | 8108 |
| 21 | poseidon | 193 | 208 | 14.4 s | answered | 8996 |
| 22 | zeus | 208 | 224 | 15.3 s | answered | 8236 |
| 23 | athena | 224 | — | 18.5 s | exhausted (invalid-output: assertion: assertion must be 1 to 280 characters) | 9814 |
| 24 | zeus | 243 | 258 | 14.3 s | answered | 9142 |
| 25 | hades | 258 | 261 | 2.8 s | answered | 3644 |
| 26 | hephaestus | 261 | 275 | 13.8 s | answered | 8152 |
| 27 | hera | 275 | 290 | 14.7 s | answered | 8980 |
| 28 | hermes | ≈290 | — | — | in flight at the end (inferred) | — |

Each god's turns (finished requests; the gap is the ticks between its request starts):

| God | Turns | Median gap (ticks) | p95 gap (ticks) | Worst gap (ticks) | Median latency |
| --- | --- | --- | --- | --- | --- |
| athena | 4 | 81 | 90 | 90 | 11.7 s |
| hades | 4 | 95 | 100 | 100 | 2.9 s |
| hephaestus | 4 | 92 | 100 | 100 | 7.3 s |
| hera | 4 | 91 | 107 | 107 | 11.0 s |
| hermes | 3 | 75.5 | 88 | 88 | 14.1 s |
| poseidon | 3 | 78.5 | 88 | 88 | 13.2 s |
| zeus | 5 | 47.5 | 73 | 73 | 14.3 s |

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

# Episode 2 of 3: one hera turn as the model saw it

- Request 4 of 35, chosen as the first prompt with a "Your open practices:" section.
- Outcome: intent; 5695 ms; route: native.
- Prompt: 6859 characters (instructions, then the scene), exactly as the trace holds it.

## The practices section

```text
Your open practices:
- You may begin a bargain if you wish (nothing requires it); each of these is legal as written:
  set terms on farmer's prayer [evt-3-60]: {"action":"practice","move":"offer","prayer":"evt-3-60","term":{"kind":"make-offering","party":"farmer","to":"hera","resource":"currency","amount":1,"deadlineTicks":90}}
```

## The prayers section

```text
Prayers to you:
- [evt-3-60] farmer (your worshipper) asks for help with planks (it lacked planks).
  farmer at Town Square [town-square]: you can travel there (action "travel", to "town-square").
  Your choices:
  - help freely: farmer is not here; if you choose this, travel to them {"action":"travel","to":"town-square"} (Town Square); the world walks you there, and once you are with them, bless them {"action":"bless","petition":"evt-3-60"}.
  - set terms (your boon for an offering, to be judged by the world): {"action":"practice","move":"offer","prayer":"evt-3-60","term":{"kind":"make-offering","party":"farmer","to":"hera","resource":"currency","amount":1,"deadlineTicks":90}}
  - refuse it (the one who prayed holds that against you as it would your silence): {"action":"refuse","petition":"evt-3-60"}
  - or let it be: waiting is always allowed.
```

## Model output

```json
{"action":"travel","to":"town-square"}
```

## The intent schema (as of the end of the run: the trace keeps no schema)

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "travel",
        "strike",
        "legend",
        "report",
        "bless",
        "refuse",
        "practice",
        "wait"
      ]
    },
    "to": {
      "type": "string",
      "enum": [
        "wilderness-grove",
        "wilderness-path",
        "town-square",
        "altar",
        "ferry-dock",
        "forge",
        "inn",
        "mountain-path",
        "shop",
        "tavern",
        "olympus-gate",
        "underworld-shore",
        "asphodel-meadow",
        "great-hall",
        "judgment-hall"
      ],
      "description": "Where to go: any place you can reach, for the action \"travel\" (name it here, not in \"target\"). The world walks you there a step at a time."
    },
    "target": {
      "type": "string",
      "enum": [
        "loom-house",
        "olive-press"
      ],
      "description": "The building, or the mortal a prayer asks you to punish, that a strike hits: for the action \"strike\" only, never a place to go."
    },
    "power": {
      "type": "integer",
      "minimum": 1,
      "maximum": 2
    },
    "assertion": {
      "type": "string",
      "minLength": 1,
      "maxLength": 280
    },
    "listener": {
      "type": "string",
      "enum": [
        "athena",
        "herdsman-damon"
      ]
    },
    "content": {
      "type": "string",
      "minLength": 1,
      "maxLength": 280
    },
    "claim": {
      "type": "object",
      "properties": {
        "effect": {
          "type": "string",
          "enum": [
            "harm",
            "kindness"
          ]
        },
        "agent": {
          "type": "string",
          "enum": [
            "hera",
            "athena",
            "herdsman-damon"
          ]
        },
        "target": {
          "type": "string",
          "enum": [
            "hera",
            "athena",
            "herdsman-damon",
            "loom-house",
            "olive-press"
          ]
        }
      },
      "required": [
        "effect",
        "agent"
      ],
      "additionalProperties": false
    },
    "petition": {
      "type": "string",
      "enum": [
        "evt-245-4223",
        "evt-189-3353"
      ]
    },
    "move": {
      "type": "string",
      "enum": [
        "demand",
        "offer"
      ]
    },
    "cause": {
      "type": "string",
      "enum": [
        "evt-168-3035"
      ]
    },
    "prayer": {
      "type": "string",
      "enum": [
        "evt-189-3353",
        "evt-245-4223"
      ]
    },
    "stake": {
      "type": "string",
      "enum": [
        "wolf"
      ],
      "description": "Only an offer on a prayer may carry a stake: what the one who prayed becomes if it takes your boon and breaks the term."
    },
    "term": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "enum": [
            "tell-legend",
            "be-at",
            "stay-away",
            "give-resource",
            "bless-mortal",
            "make-offering",
            "ally"
          ]
        },
        "party": {
          "type": "string",
          "enum": [
            "hera",
            "athena",
            "hades",
            "hephaestus",
            "hermes",
            "poseidon",
            "zeus",
            "ferryman",
            "herdsman-damon"
          ]
        },
        "place": {
          "type": "string",
          "enum": [
            "altar",
            "ancient-olive-tree",
            "asphodel-meadow",
            "ferry-dock",
            "forge",
            "great-hall",
            "inn",
            "judgment-hall",
            "mountain-path",
            "olympus-gate",
            "shop",
            "tavern",
            "town-square",
            "underworld-shore",
            "wilderness-grove",
            "wilderness-path"
          ]
        },
        "to": {
          "type": "string",
          "enum": [
            "hera",
            "athena",
            "hades",
            "hephaestus",
            "hermes",
            "poseidon",
            "zeus"
          ]
        },
        "mortal": {
          "type": "string",
          "enum": [
            "ferryman",
            "herdsman-damon"
          ]
        },
        "resource": {
          "type": "string",
          "enum": [
            "cloth",
            "currency",
            "divinity",
            "fish",
            "food",
            "olives",
            "ore",
            "planks",
            "tools",
            "wine",
            "wood",
            "wool"
          ]
        },
        "amount": {
          "type": "integer",
          "minimum": 1
        },
        "deadlineTicks": {
          "type": "integer",
          "minimum": 25,
          "maximum": 500
        }
      },
      "required": [
        "kind",
        "party",
        "deadlineTicks"
      ],
      "allOf": [
        {
          "if": {
            "properties": {
              "kind": {
                "enum": [
                  "tell-legend",
                  "be-at",
                  "stay-away"
                ]
              }
            },
            "required": [
              "kind"
            ]
          },
          "then": {
            "required": [
              "place"
            ]
          }
        },
        {
          "if": {
            "properties": {
              "kind": {
                "enum": [
                  "give-resource",
                  "make-offering"
                ]
              }
            },
            "required": [
              "kind"
            ]
          },
          "then": {
            "required": [
              "resource",
              "amount"
            ]
          }
        },
        {
          "if": {
            "properties": {
              "kind": {
                "const": "bless-mortal"
              }
            },
            "required": [
              "kind"
            ]
          },
          "then": {
            "required": [
              "mortal"
            ]
          }
        }
      ],
      "additionalProperties": false
    },
    "goal": {
      "type": "object",
      "properties": {
        "set": {
          "type": "object",
          "properties": {
            "text": {
              "type": "string",
              "minLength": 1,
              "maxLength": 140
            },
            "target": {
              "type": "string",
              "enum": [
                "athena",
                "herdsman-damon",
                "loom-house",
                "olive-press",
                "wilderness-grove",
                "wilderness-path",
                "town-square",
                "altar",
                "ferry-dock",
                "forge",
                "inn",
                "mountain-path",
                "shop",
                "tavern",
                "olympus-gate",
                "underworld-shore",
                "asphodel-meadow",
                "great-hall",
                "judgment-hall",
                "ancient-olive-tree",
                "zeus",
                "ferryman"
              ]
            }
          },
          "required": [
            "text",
            "target"
          ],
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    }
  },
  "required": [
    "action"
  ],
  "allOf": [
    {
      "if": {
        "properties": {
          "action": {
            "const": "legend"
          }
        },
        "required": [
          "action"
        ]
      },
      "then": {
        "required": [
          "assertion"
        ]
      }
    },
    {
      "if": {
        "properties": {
          "action": {
            "const": "bless"
          }
        },
        "required": [
          "action"
        ]
      },
      "then": {
        "required": [
          "petition"
        ],
        "properties": {
          "petition": {
            "enum": [
              "evt-245-4223"
            ]
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "action": {
            "const": "refuse"
          }
        },
        "required": [
          "action"
        ]
      },
      "then": {
        "required": [
          "petition"
        ],
        "properties": {
          "petition": {
            "enum": [
              "evt-245-4223",
              "evt-189-3353"
            ]
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "action": {
            "const": "practice"
          }
        },
        "required": [
          "action"
        ]
      },
      "then": {
        "required": [
          "move"
        ]
      }
    },
    {
      "if": {
        "properties": {
          "action": {
            "const": "practice"
          },
          "move": {
            "const": "demand"
          }
        },
        "required": [
          "action",
          "move"
        ]
      },
      "then": {
        "required": [
          "cause",
          "term"
        ]
      }
    },
    {
      "if": {
        "properties": {
          "action": {
            "const": "practice"
          },
          "move": {
            "const": "offer"
          }
        },
        "required": [
          "action",
          "move"
        ]
      },
      "then": {
        "required": [
          "prayer",
          "term"
        ]
      }
    }
  ],
  "additionalProperties": false
}
```

## The whole prompt

```text
Decide what you do next, in character, using only what you are shown as perceived. You know nothing else about the world, and you may only name ids listed in the scene.
You may also travel to any place you can reach, naming it in "to": {"action":"travel","to":"<place id>"}. The world walks you there, one step a tick.
For a legend: {"action":"legend","assertion":"<what you say, one or two short sentences>"}
Speak your report and legend words in the first person, to those who hear them, without using your own name.
Keep a legend assertion (at most 280 characters) and report content (at most 280 characters) to one or two short sentences.
You may keep one goal across turns: add "goal" to your reply, {"set": {"text": your aim in your own words, "target": one id you were shown}} and/or {"end": {"outcome": "achieved", "failed", or "abandoned"}}. Set a goal you can finish or fail within a few turns: something concrete with its target that you could see happen. A goal holds: you may end it as achieved or failed any time, but you may replace or abandon it only after 40 ticks, or once news of its target or a prayer to you gives you cause. A goal change goes with any action in the same turn; it never needs a turn of its own.
You may also choose to wait (action "wait") and do nothing this turn; waiting is always allowed.
Reply with one JSON object naming your action.
You are Hera, a Greek god of marriage, women, childbirth, queenship of the gods.
Your drives, from 0 to 1: fidelity 0.9, vengeance 0.8, guardianship 0.6, sovereignty 0.5, order 0.4.
What is told of you:
- Hera is the daughter of Cronus and Rhea, sister and wife of Zeus, and queen of the immortals, honored by all the gods on Olympus.
- In Hesiod, Hera bears Hebe, Ares, and Eileithyia to Zeus; in the Iliad, the Eileithyiai, who send the pangs of childbirth, are called Hera's daughters.
- Argos, Sparta, and Mycenae are the cities dearest to Hera.
- Hera reproaches Zeus for deciding matters in secret, apart from her, and never being willing to tell her what he intends.
- After Zeus bears Athena from his own head, Hera bears Hephaestus without union with Zeus and quarrels furiously with her husband (Hesiod); in the Hymn to Apollo she rages that Zeus bore Athena apart from her, prays for a child as strong as he, and bears the monster Typhaon.
- Hera outwits Zeus: he falls asleep in her arms on Mount Ida, which he later calls her trick and deception, and she once tricked him into an oath that made Eurystheus, not Heracles, ruler.
- Hera swears by Earth, Heaven, and the water of the Styx, the gravest oath of the gods, and by Zeus's head and their marriage bed.
- Hera's wrath pursues Heracles, Zeus's son by Alcmene: the Iliad names her storm against him at sea and her wrath that brought him down; Apollodorus adds serpents sent to his cradle, madness, and the same storm after Troy.
- Hera asks Zeus for the cow that Io has become and sets Argus to guard her; in Ovid's telling she relents and Io regains human form.
- Hera's hostility to Zeus's Theban lover Semele ends in Semele's death when she asks to see Zeus as he really is.
Those you hold close or against:
- zeus (spouse), disposition -0.20 on a scale from -1 to 1: Sister and wife, resentful of his affairs and secrecy yet bound to him by rite. The starting value is authored tuning.
Your powers:
- Wrath of Hera (action "strike"): Lashes out at a structure. Costs divinity equal to the power; at power 2 it damages a target without setting it alight. Use a power of at most 2 (your authored power and the divinity you hold).
- Tale of a Grievance (action "legend"): Tells the story of a wrong done to her, told aloud to everyone present and recorded as a legend.
You may also tell someone here something (action "report", naming the listener, your words, and optionally a claim of who harmed or did a kindness to whom, and an event you saw). It is your own account, told as you choose.
For a report, omit linkedEventId: you saw no event you can cite.
A legend is heard by everyone here now: zeus.
For a legend, omit linkedEventId: no event here can be cited.
Mortals pray to you, and you hear them wherever you are. Answering a prayer is how you are worshipped: strike the offender's building (action "strike") where it stands, or, for a petitioner who is here, bless them (action "bless", naming the petition, at a cost of 2 divinity). If the petitioner or the building is elsewhere, travel there first; each prayer below says how. Your worshippers are the mortals who revere you; a prayer about a trouble in your domain may come from anyone.
A practice (action "practice") is a bargain the world holds and judges: only moves bind, and words never do. Copy one of the objects the rows and openings below show; each names its move, and only a demand, an offer, and a counter carry a term {kind, party, deadlineTicks, and what the kind needs}.
An offer on a prayer (move "offer") may add a stake: what the one who prayed becomes if it takes your boon and breaks the term (wolf). The boon stays yours to give.

You have no goal. You may set one.
You are at Hall of the Gods [great-hall] in the olympus realm, tick 18.
It is spring; summer begins at tick 200.
Your flock: 2 mortals revere you, most at ancient-olive-tree (1), town-square (1).
You hold: divinity 10.
Here with you:
- zeus (a god)
Buildings here:
- none
Recent events here:
- none
Places you can travel to (steps away): olympus-gate 1, mountain-path 2, town-square 3, altar 4, ferry-dock 4, forge 4, inn 4, shop 4, tavern 4, wilderness-path 4, underworld-shore 5, wilderness-grove 5, ancient-olive-tree 6, asphodel-meadow 6, judgment-hall 7.
Prayers to you:
- [evt-3-60] farmer (your worshipper) asks for help with planks (it lacked planks).
  farmer at Town Square [town-square]: you can travel there (action "travel", to "town-square").
  Your choices:
  - help freely: farmer is not here; if you choose this, travel to them {"action":"travel","to":"town-square"} (Town Square); the world walks you there, and once you are with them, bless them {"action":"bless","petition":"evt-3-60"}.
  - set terms (your boon for an offering, to be judged by the world): {"action":"practice","move":"offer","prayer":"evt-3-60","term":{"kind":"make-offering","party":"farmer","to":"hera","resource":"currency","amount":1,"deadlineTicks":90}}
  - refuse it (the one who prayed holds that against you as it would your silence): {"action":"refuse","petition":"evt-3-60"}
  - or let it be: waiting is always allowed.
Your open practices:
- You may begin a bargain if you wish (nothing requires it); each of these is legal as written:
  set terms on farmer's prayer [evt-3-60]: {"action":"practice","move":"offer","prayer":"evt-3-60","term":{"kind":"make-offering","party":"farmer","to":"hera","resource":"currency","amount":1,"deadlineTicks":90}}
What do you do?
```

## A refused turn

- Request 20 of 35, hermes: refused after 2 attempts (invalid-output: listener: listener must be one of the ids you can see: athena, farmer, fisher-dion, fisher-eleni, fisher-kallias, fisher-stavros, hera, market-trader-iris, olive-grower-aristo, olive-grower-leon, olive-grower-phoebe, smith-brontes, smith-ktesias, weaver-zoe, woodcutter, zeus).

What the model sent last:

```json
{"action":"report","to":"ferry-dock","content":"I bring word of the woodshed's plight. The woodcutter has wronged it, and I offer a path to harmony. Provide a token of currency, and I shall make things right."}
```

The intent schema, as it was when the request was made:

```json
{"type":"object","properties":{"action":{"type":"string","enum":["travel","report","legend","bless","refuse","practice","wait"]},"to":{"type":"string","enum":["altar","ferry-dock","forge","inn","mountain-path","shop","tavern","wilderness-path","olympus-gate","underworld-shore","wilderness-grove","ancient-olive-tree","asphodel-meadow","great-hall","judgment-hall"],"description":"Where to go: any place you can reach, for the action \"travel\" (name it here, not in \"target\"). The world walks you there a step at a time."},"assertion":{"type":"string","minLength":1,"maxLength":280},"listener":{"type":"string","enum":["athena","farmer","fisher-dion","fisher-eleni","fisher-kallias","fisher-stavros","hera","market-trader-iris","olive-grower-aristo","olive-grower-leon","olive-grower-phoebe","smith-brontes","smith-ktesias","weaver-zoe","woodcutter","zeus"]},"content":{"type":"string","minLength":1,"maxLength":280},"claim":{"type":"object","properties":{"effect":{"type":"string","enum":["harm","kindness"]},"agent":{"type":"string","enum":["hermes","athena","farmer","fisher-dion","fisher-eleni","fisher-kallias","fisher-stavros","hera","market-trader-iris","olive-grower-aristo","olive-grower-leon","olive-grower-phoebe","smith-brontes","smith-ktesias","weaver-zoe","woodcutter","zeus"]},"target":{"type":"string","enum":["hermes","athena","farmer","fisher-dion","fisher-eleni","fisher-kallias","fisher-stavros","hera","market-trader-iris","olive-grower-aristo","olive-grower-leon","olive-grower-phoebe","smith-brontes","smith-ktesias","weaver-zoe","woodcutter","zeus","old-oak","woodshed"]}},"required":["effect","agent"],"additionalProperties":false},"petition":{"type":"string","enum":["evt-98-1807","evt-123-2281","evt-64-1237"]},"move":{"type":"string","enum":["demand","offer"]},"cause":{"type":"string","enum":["evt-108-1972","evt-118-2149"]},"prayer":{"type":"string","enum":["evt-64-1237","evt-98-1807","evt-123-2281"]},"stake":{"type":"string","enum":["wolf"],"description":"Only an offer on a prayer may carry a stake: what the one who prayed becomes if it takes your boon and breaks the term."},"term":{"type":"object","properties":{"kind":{"type":"string","enum":["tell-legend","be-at","stay-away","give-resource","bless-mortal","make-offering","ally"]},"party":{"type":"string","enum":["hermes","athena","hades","hephaestus","hera","poseidon","zeus","market-trader-iris","market-trader-iris","ferryman"]},"place":{"type":"string","enum":["altar","ancient-olive-tree","asphodel-meadow","ferry-dock","forge","great-hall","inn","judgment-hall","mountain-path","olympus-gate","shop","tavern","town-square","underworld-shore","wilderness-grove","wilderness-path"]},"to":{"type":"string","enum":["hermes","athena","hades","hephaestus","hera","poseidon","zeus"]},"mortal":{"type":"string","enum":["ferryman","market-trader-iris","woodcutter","farmer","fisher-dion","fisher-eleni","fisher-kallias","fisher-stavros","olive-grower-aristo","olive-grower-leon","olive-grower-phoebe","smith-brontes","smith-ktesias","weaver-zoe"]},"resource":{"type":"string","enum":["cloth","currency","divinity","fish","food","olives","ore","planks","tools","wine","wood","wool"]},"amount":{"type":"integer","minimum":1},"deadlineTicks":{"type":"integer","minimum":25,"maximum":500}},"required":["kind","party","deadlineTicks"],"allOf":[{"if":{"properties":{"kind":{"enum":["tell-legend","be-at","stay-away"]}},"required":["kind"]},"then":{"required":["place"]}},{"if":{"properties":{"kind":{"enum":["give-resource","make-offering"]}},"required":["kind"]},"then":{"required":["resource","amount"]}},{"if":{"properties":{"kind":{"const":"bless-mortal"}},"required":["kind"]},"then":{"required":["mortal"]}}],"additionalProperties":false},"goal":{"type":"object","properties":{"set":{"type":"object","properties":{"text":{"type":"string","minLength":1,"maxLength":140},"target":{"type":"string","enum":["athena","farmer","fisher-dion","fisher-eleni","fisher-kallias","fisher-stavros","hera","market-trader-iris","olive-grower-aristo","olive-grower-leon","olive-grower-phoebe","smith-brontes","smith-ktesias","weaver-zoe","woodcutter","zeus","old-oak","woodshed","altar","ferry-dock","forge","inn","mountain-path","shop","tavern","wilderness-path","olympus-gate","underworld-shore","wilderness-grove","ancient-olive-tree","asphodel-meadow","great-hall","judgment-hall","town-square","ferryman"]}},"required":["text","target"],"additionalProperties":false}},"additionalProperties":false},"linkedEventId":{"type":"string","enum":["evt-132-2426","evt-132-2428","evt-132-2430","evt-132-2431","evt-132-2432","evt-132-2433","evt-132-2434","evt-132-2440","evt-118-2149"],"description":"Cite only an id the instructions list for your action (report or legend); omit it when none is listed."}},"required":["action"],"allOf":[{"if":{"properties":{"action":{"const":"legend"}},"required":["action"]},"then":{"required":["assertion"]}},{"if":{"properties":{"action":{"const":"bless"}},"required":["action"]},"then":{"required":["petition"],"properties":{"petition":{"enum":["evt-98-1807"]}}}},{"if":{"properties":{"action":{"const":"refuse"}},"required":["action"]},"then":{"required":["petition"],"properties":{"petition":{"enum":["evt-123-2281","evt-98-1807","evt-64-1237"]}}}},{"if":{"properties":{"action":{"const":"practice"}},"required":["action"]},"then":{"required":["move"]}},{"if":{"properties":{"action":{"const":"practice"},"move":{"const":"demand"}},"required":["action","move"]},"then":{"required":["cause","term"]}},{"if":{"properties":{"action":{"const":"practice"},"move":{"const":"offer"}},"required":["action","move"]},"then":{"required":["prayer","term"]}}],"additionalProperties":false}
```

The prompt it was shown:

```text
Decide what you do next, in character, using only what you are shown as perceived. You know nothing else about the world, and you may only name ids listed in the scene.
You may also travel to any place you can reach, naming it in "to": {"action":"travel","to":"<place id>"}. The world walks you there, one step a tick.
For a legend: {"action":"legend","assertion":"<what you say, one or two short sentences>"}
Speak your report and legend words in the first person, to those who hear them, without using your own name.
Keep a legend assertion (at most 280 characters) and report content (at most 280 characters) to one or two short sentences.
You may keep one goal across turns: add "goal" to your reply, {"set": {"text": your aim in your own words, "target": one id you were shown}} and/or {"end": {"outcome": "achieved", "failed", or "abandoned"}}. Set a goal you can finish or fail within a few turns: something concrete with its target that you could see happen. A goal holds: you may end it as achieved or failed any time, but you may replace or abandon it only after 40 ticks, or once news of its target or a prayer to you gives you cause. A goal change goes with any action in the same turn; it never needs a turn of its own.
You may also choose to wait (action "wait") and do nothing this turn; waiting is always allowed.
Reply with one JSON object naming your action.
You are Hermes, a Greek god of messages, travel, exchange, herds, cunning, guiding souls.
Your drives, from 0 to 1: guardianship 0.6, desire 0.5, order 0.5, sovereignty 0.3.
What is told of you:
- On the day of his birth Hermes steals fifty of Apollo's cattle, hides their tracks, and roasts two of them.
- Apollo and Hermes settle the theft by exchange: Hermes gives him the lyre and Apollo gives him his whip and the keeping of herds.
- Zeus sends Hermes as his messenger, to bid Calypso let Odysseus go.
- At Zeus's order Hermes guides Priam unseen to Achilles' hut.
- Cyllenian Hermes calls the suitors' souls with his golden wand and leads them down to the asphodel meadow.
- Zeus sends Hermes down to Erebos with his command that Hades let Persephone go.
Those you hold close or against:
- zeus (father and master), disposition 0.50 on a scale from -1 to 1: Zeus sends him as messenger and guide. The starting value is authored tuning.
Your powers:
- Tidings (action "report"): Carries word to someone here: your own account, told as you choose.
- Tale of the Road (action "legend"): Tells a tale of the road or the market, told aloud to everyone present and recorded as a legend.
- Windfall (action "bless"): Answers a mortal's prayer for help with what it needs.
You may also tell someone here something (action "report", naming the listener, your words, and optionally a claim of who harmed or did a kindness to whom, and an event you saw). It is your own account, told as you choose.
For a report, linkedEventId may be only one of: evt-118-2149; omit it to cite nothing.
A legend is heard by everyone here now: athena, farmer, fisher-dion, fisher-eleni, fisher-kallias, fisher-stavros, hera, market-trader-iris, olive-grower-aristo, olive-grower-leon, olive-grower-phoebe, smith-brontes, smith-ktesias, weaver-zoe, woodcutter, zeus.
For a legend, linkedEventId may be only one of: evt-132-2426, evt-132-2428, evt-132-2430, evt-132-2431, evt-132-2432, evt-132-2433, evt-132-2434, evt-132-2440; omit it to cite nothing.
Mortals pray to you, and you hear them wherever you are. Answering a prayer is how you are worshipped: strike the offender's building (action "strike") where it stands, or, for a petitioner who is here, bless them (action "bless", naming the petition, at a cost of 2 divinity). If the petitioner or the building is elsewhere, travel there first; each prayer below says how. Your worshippers are the mortals who revere you; a prayer about a trouble in your domain may come from anyone.
A practice (action "practice") is a bargain the world holds and judges: only moves bind, and words never do. Copy one of the objects the rows and openings below show; each names its move, and only a demand, an offer, and a counter carry a term {kind, party, deadlineTicks, and what the kind needs}.
Causes you may demand over: [evt-108-1972] athena told you of it; [evt-118-2149] you saw worship-performed (woodcutter, zeus).
An offer on a prayer (move "offer") may add a stake: what the one who prayed becomes if it takes your boon and breaks the term (wolf). The boon stays yours to give.

You remember:
- athena told you: "The olive tree's wisdom flows through my hands, and I guard its gifts for all who seek peace."
- You saw [evt-118-2149] worship-performed (woodcutter, zeus): woodcutter was kind to zeus
What you did recently:
- you moved to town-square
- you told market-trader-iris: "I bring word of the woodshed's plight. The woodcutter has wronged it, and I offer a path to harmony. Provide a token of currency, and I shall make things right."
You have no goal. You may set one.
You are at Town Square [town-square] in the mortal realm, tick 132.
It is spring; summer begins at tick 200.
Your flock: 4 mortals revere you, most at ancient-olive-tree (1), ferry-dock (1).
You hold: divinity 10.
Here with you:
- athena (a god)
- farmer
- fisher-dion
- fisher-eleni
- fisher-kallias
- fisher-stavros
- hera (a god)
- market-trader-iris
- olive-grower-aristo
- olive-grower-leon
- olive-grower-phoebe
- smith-brontes
- smith-ktesias
- weaver-zoe
- woodcutter
- zeus (a god)
Buildings here:
- The Old Oak [old-oak], operational
- The Woodshed [woodshed], operational
Recent events here:
- [evt-132-2426] resource-gathered (market-trader-iris)
- [evt-132-2428] resource-traded (fisher-kallias, market-trader-iris)
- [evt-132-2430] resource-gathered (fisher-stavros)
- [evt-132-2431] resource-gathered (fisher-eleni)
- [evt-132-2432] resource-traded (olive-grower-aristo, farmer)
- [evt-132-2433] resource-traded (olive-grower-phoebe, farmer)
- [evt-132-2434] resource-traded (olive-grower-leon, farmer)
- [evt-132-2440] entity-moved (hera, town-square)
Places you can travel to (steps away): altar 1, ferry-dock 1, forge 1, inn 1, mountain-path 1, shop 1, tavern 1, wilderness-path 1, olympus-gate 2, underworld-shore 2, wilderness-grove 2, ancient-olive-tree 3, asphodel-meadow 3, great-hall 3, judgment-hall 4.
Prayers to you:
- [evt-123-2281] ferryman (not of your flock) asks for help with food (its food was stolen).
  ferryman at Styx Ferry Dock [ferry-dock]: you can travel there (action "travel", to "ferry-dock").
  Your choices:
  - help freely: ferryman is not here; if you choose this, travel to them {"action":"travel","to":"ferry-dock"} (Styx Ferry Dock); the world walks you there, and once you are with them, bless them {"action":"bless","petition":"evt-123-2281"}.
  - set terms (your boon for an offering, to be judged by the world): {"action":"practice","move":"offer","prayer":"evt-123-2281","term":{"kind":"make-offering","party":"ferryman","to":"hermes","resource":"currency","amount":1,"deadlineTicks":90}}
  - refuse it (the one who prayed holds that against you as it would your silence): {"action":"refuse","petition":"evt-123-2281"}
  - or let it be: waiting is always allowed.
- [evt-98-1807] market-trader-iris (your worshipper) asks for help with food (it lacked food).
  market-trader-iris at Town Square [town-square] (here).
  Your choices:
  - help freely: market-trader-iris is here: {"action":"bless","petition":"evt-98-1807"}
  - set terms (your boon for an offering, to be judged by the world): {"action":"practice","move":"offer","prayer":"evt-98-1807","term":{"kind":"make-offering","party":"market-trader-iris","to":"hermes","resource":"currency","amount":1,"deadlineTicks":90}}
  - refuse it (the one who prayed holds that against you as it would your silence): {"action":"refuse","petition":"evt-98-1807"}
  - or let it be: waiting is always allowed.
- [evt-64-1237] market-trader-iris (your worshipper) asks you to punish woodcutter, who owns woodshed (woodcutter wronged it: feud).
  market-trader-iris, woodcutter, woodshed at Town Square [town-square] (here).
  Your choices:
  - punish freely: woodshed is here, but you cannot strike it now: you have no power to strike with.
  - punish woodcutter itself: you cannot strike now: you have no power to strike with.
  - set terms (your boon for an offering, to be judged by the world): {"action":"practice","move":"offer","prayer":"evt-64-1237","term":{"kind":"make-offering","party":"market-trader-iris","to":"hermes","resource":"currency","amount":1,"deadlineTicks":90}}
  - refuse it (the one who prayed holds that against you as it would your silence): {"action":"refuse","petition":"evt-64-1237"}
  - or let it be: waiting is always allowed.
- and 2 more prayers to you.
Your open practices:
- You may begin a bargain if you wish (nothing requires it); each of these is legal as written:
  set terms on ferryman's prayer [evt-123-2281]: {"action":"practice","move":"offer","prayer":"evt-123-2281","term":{"kind":"make-offering","party":"ferryman","to":"hermes","resource":"currency","amount":1,"deadlineTicks":90}}
What do you do?
```

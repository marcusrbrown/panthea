# Episode 3 of 3: one hera turn as the model saw it

- Request 4 of 145, chosen as the first prompt with a "Your open practices:" section.
- Outcome: intent; 4421 ms; route: native.
- Prompt: 6740 characters (instructions, then the scene), exactly as the trace holds it.

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
  farmer at Town Square [town-square].
  Your choices:
  - help freely, from where you stand: {"action":"bless","petition":"evt-3-60"}
  - set terms (your boon for an offering, to be judged by the world): {"action":"practice","move":"offer","prayer":"evt-3-60","term":{"kind":"make-offering","party":"farmer","to":"hera","resource":"currency","amount":1,"deadlineTicks":90}}
  - refuse it (the one who prayed holds that against you as it would your silence): {"action":"refuse","petition":"evt-3-60"}
  - or let it be: waiting is always allowed.
```

## Model output

```json
{"action":"bless","petition":"evt-3-60"}
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
        "olympus-gate",
        "mountain-path",
        "town-square",
        "altar",
        "ferry-dock",
        "forge",
        "inn",
        "shop",
        "tavern",
        "wilderness-path",
        "underworld-shore",
        "wilderness-grove",
        "ancient-olive-tree",
        "asphodel-meadow",
        "judgment-hall"
      ],
      "description": "Where to go: any place you can reach, for the action \"travel\" (name it here, not in \"target\"). The world walks you there a step at a time."
    },
    "target": {
      "type": "string",
      "enum": [
        "olive-grower-aristo",
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
        "zeus"
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
            "zeus"
          ]
        },
        "target": {
          "type": "string",
          "enum": [
            "hera",
            "zeus"
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
        "evt-165-2924",
        "evt-213-3915"
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
        "evt-85-1664",
        "evt-142-2566"
      ]
    },
    "prayer": {
      "type": "string",
      "enum": [
        "evt-165-2924",
        "evt-213-3915"
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
            "market-trader-iris",
            "farmer"
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
            "farmer",
            "market-trader-iris"
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
                "zeus",
                "olympus-gate",
                "mountain-path",
                "town-square",
                "altar",
                "ferry-dock",
                "forge",
                "inn",
                "shop",
                "tavern",
                "wilderness-path",
                "underworld-shore",
                "wilderness-grove",
                "ancient-olive-tree",
                "asphodel-meadow",
                "judgment-hall",
                "great-hall",
                "farmer",
                "olive-grower-aristo",
                "olive-press",
                "market-trader-iris"
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
            "const": "report"
          }
        },
        "required": [
          "action"
        ]
      },
      "then": {
        "required": [
          "listener",
          "content"
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
              "evt-165-2924"
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
              "evt-213-3915",
              "evt-165-2924"
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
For a report: {"action":"report","listener":"<who is here>","content":"<what you tell, one or two short sentences>"}
For a report, omit linkedEventId: you saw no event you can cite.
A legend is heard by everyone here now: zeus.
For a legend, omit linkedEventId: no event here can be cited.
Mortals pray to you, and you hear them wherever you are. Answering a prayer is how you are worshipped, and you answer from where you stand: bless the one who prayed (action "bless", naming the petition, at a cost of 2 divinity), or strike the offender or a building the prayer lists (action "strike"); each prayer below writes its choices out whole. Your worshippers are the mortals who revere you; a prayer about a trouble in your domain may come from anyone.
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
  farmer at Town Square [town-square].
  Your choices:
  - help freely, from where you stand: {"action":"bless","petition":"evt-3-60"}
  - set terms (your boon for an offering, to be judged by the world): {"action":"practice","move":"offer","prayer":"evt-3-60","term":{"kind":"make-offering","party":"farmer","to":"hera","resource":"currency","amount":1,"deadlineTicks":90}}
  - refuse it (the one who prayed holds that against you as it would your silence): {"action":"refuse","petition":"evt-3-60"}
  - or let it be: waiting is always allowed.
Your open practices:
- You may begin a bargain if you wish (nothing requires it); each of these is legal as written:
  set terms on farmer's prayer [evt-3-60]: {"action":"practice","move":"offer","prayer":"evt-3-60","term":{"kind":"make-offering","party":"farmer","to":"hera","resource":"currency","amount":1,"deadlineTicks":90}}
What do you do?
```

## A refused turn

- Request 22 of 145, athena: refused after 1 attempts (unknown: 200 Invalid JSON response: {"id":"chatcmpl-202","object":"chat.completion","created":-62135596800,"model":"","system_fingerprint":"fp_ollama","choices":[{"index":0,"message":{"role":"","content":""},"finish_reason":null}],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}
).

What the model sent last:

```json
(not kept: the failure was not an invalid reply)
```

The intent schema, as it was when the request was made:

```json
(not kept)
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
You are Athena, a Greek god of wisdom, counsel, war, the protection of cities, weaving.
Your drives, from 0 to 1: guardianship 0.8, order 0.7, sovereignty 0.5, vengeance 0.3.
What is told of you:
- Zeus brings Athena forth himself, from his own head: bright-eyed Tritogeneia.
- She is hailed as Pallas Athena, bright-eyed, inventive, unbending of heart, a pure virgin and saviour of cities.
- Sent from heaven by Hera, Athena takes Achilles by his fair hair and checks him from drawing his sword on Agamemnon, bidding him use words instead.
- Poseidon and Athena contested Attica: he struck the acropolis and brought up a sea, she planted an olive with Cecrops as witness, and the twelve gods awarded the land to her.
- At Athens she is shown with the olive plant and Poseidon with the wave, and the contest fills the rear pediment of her temple.
- Hera, Poseidon, and Pallas Athena once wished to put Zeus in bonds.
- Zeus forbids the gods to join the fighting at Troy. Athena says they will keep out of the fight, though they may advise the Argives.
- Athena wears a soft embroidered robe that she herself wrought, and she and Hephaestus teach crafts to men.
Those you hold close or against:
- poseidon (rival over Athens), disposition -0.50 on a scale from -1 to 1: They contested Attica and the twelve gods gave it to her. The starting value is authored tuning.
- hera (ally), disposition 0.40 on a scale from -1 to 1: Hera sends her to check Achilles, and they once wished with Poseidon to bind Zeus. The starting value is authored tuning.
- zeus (father), disposition 0.30 on a scale from -1 to 1: He brought her forth from his head and bars the gods from the war; she obeys and still advises. The starting value is authored tuning.
Your powers:
- Wrath of Pallas (action "strike"): Lashes out at a structure. Costs divinity equal to the power; at power 2 it damages a target without setting it alight. Use a power of at most 2 (your authored power and the divinity you hold).
- Counsel (action "legend"): Gives counsel or a judgment, told aloud to everyone present and recorded as a legend.
- Gift of the Olive (action "bless"): Answers a mortal's prayer for help with what it needs.
You may also tell someone here something (action "report", naming the listener, your words, and optionally a claim of who harmed or did a kindness to whom, and an event you saw). It is your own account, told as you choose.
For a report: {"action":"report","listener":"<who is here>","content":"<what you tell, one or two short sentences>"}
For a report, omit linkedEventId: you saw no event you can cite.
A legend is heard by everyone here now: herdsman-damon, weaver-xenia.
For a legend, linkedEventId may be only one of: evt-139-2522, evt-139-2523, evt-140-2541, evt-140-2542, evt-141-2554, evt-141-2555, evt-142-2574, evt-142-2575; omit it to cite nothing.

What you did recently:
- you told everyone present: "In this time of gathering, I Athena, bless these mortals' labors, granting prosperity to their olive groves and weaving skills." (heard by herdsman-damon, weaver-ismene, weaver-xenia, weaver-zoe)
- you told everyone present: "May the bounty of our groves and skilled hands of our weavers flourish for this season and beyond, with Athena's blessing." (heard by herdsman-damon, weaver-ismene, weaver-xenia)
You have no goal. You may set one.
You are at The Ancient Olive Tree [ancient-olive-tree] in the mortal realm, tick 142.
It is spring; summer begins at tick 200.
Your flock: 6 mortals revere you, most at ancient-olive-tree (4), ferry-dock (1).
You hold: divinity 9.
Here with you:
- herdsman-damon
- weaver-xenia
Buildings here:
- The Loom House [loom-house], operational
- The Olive Press [olive-press], operational
Recent events here:
- [evt-139-2522] resource-produced (weaver-xenia)
- [evt-139-2523] resource-gathered (herdsman-damon)
- [evt-140-2541] resource-gathered (weaver-xenia)
- [evt-140-2542] resource-gathered (herdsman-damon)
- [evt-141-2554] resource-produced (weaver-xenia)
- [evt-141-2555] resource-gathered (herdsman-damon)
- [evt-142-2574] resource-gathered (weaver-xenia)
- [evt-142-2575] resource-gathered (herdsman-damon)
Places you can travel to (steps away): wilderness-grove 1, wilderness-path 2, town-square 3, altar 4, ferry-dock 4, forge 4, inn 4, mountain-path 4, shop 4, tavern 4, olympus-gate 5, underworld-shore 5, asphodel-meadow 6, great-hall 6, judgment-hall 7.
What do you do?
```

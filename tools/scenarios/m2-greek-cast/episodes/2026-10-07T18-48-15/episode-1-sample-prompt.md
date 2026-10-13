# Episode 1 of 3: one hera turn as the model saw it

- Request 4 of 35, chosen as the first prompt with a "Your open practices:" section.
- Outcome: intent; 8885 ms; route: native.
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
        "fisher-kallias"
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
        "evt-297-5487"
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
        "evt-121-2307",
        "evt-229-4146"
      ]
    },
    "prayer": {
      "type": "string",
      "enum": [
        "evt-297-5487"
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
            "farmer"
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
                "fisher-kallias"
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
              "evt-297-5487"
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
You are at Hall of the Gods [great-hall] in the olympus realm, tick 24.
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

- Request 25 of 35, hephaestus: refused after 2 attempts (invalid-output: term.party: party must be one of: athena, hades, hera, hermes, poseidon, zeus).

What the model sent last:

```json
{"action":"practice","cause":"evt-120-2297","term":{"kind":"make-offering","party":"hephaestus","deadlineTicks":100,"to":"zeus","amount":5}}
```

The intent schema, as it was when the request was made:

```json
{"type":"object","properties":{"action":{"type":"string","enum":["travel","strike","legend","report","practice","wait"]},"to":{"type":"string","enum":["town-square","altar","ferry-dock","inn","mountain-path","shop","tavern","wilderness-path","olympus-gate","underworld-shore","wilderness-grove","ancient-olive-tree","asphodel-meadow","great-hall","judgment-hall"],"description":"Where to go: any place you can reach, for the action \"travel\" (name it here, not in \"target\"). The world walks you there a step at a time."},"target":{"type":"string","enum":["the-forge"],"description":"The building, or the mortal a prayer asks you to punish, that a strike hits: for the action \"strike\" only, never a place to go."},"power":{"type":"integer","minimum":1,"maximum":3},"assertion":{"type":"string","minLength":1,"maxLength":280},"listener":{"type":"string","enum":["provisioner-nikanor","smith-brontes"]},"content":{"type":"string","minLength":1,"maxLength":280},"claim":{"type":"object","properties":{"effect":{"type":"string","enum":["harm","kindness"]},"agent":{"type":"string","enum":["hephaestus","provisioner-nikanor","smith-brontes"]},"target":{"type":"string","enum":["hephaestus","provisioner-nikanor","smith-brontes","the-forge"]}},"required":["effect","agent"],"additionalProperties":false},"move":{"type":"string","enum":["demand"]},"cause":{"type":"string","enum":["evt-120-2297","evt-137-2542"]},"term":{"type":"object","properties":{"kind":{"type":"string","enum":["tell-legend","be-at","stay-away","give-resource","bless-mortal","make-offering","ally"]},"party":{"type":"string","enum":["hephaestus","athena","hades","hera","hermes","poseidon","zeus"]},"place":{"type":"string","enum":["altar","ancient-olive-tree","asphodel-meadow","ferry-dock","forge","great-hall","inn","judgment-hall","mountain-path","olympus-gate","shop","tavern","town-square","underworld-shore","wilderness-grove","wilderness-path"]},"to":{"type":"string","enum":["hephaestus","athena","hades","hera","hermes","poseidon","zeus"]},"mortal":{"type":"string","enum":["ferryman","smith-ktesias","provisioner-nikanor","smith-brontes"]},"resource":{"type":"string","enum":["cloth","currency","divinity","fish","food","olives","ore","planks","tools","wine","wood","wool"]},"amount":{"type":"integer","minimum":1},"deadlineTicks":{"type":"integer","minimum":25,"maximum":500}},"required":["kind","party","deadlineTicks"],"allOf":[{"if":{"properties":{"kind":{"enum":["tell-legend","be-at","stay-away"]}},"required":["kind"]},"then":{"required":["place"]}},{"if":{"properties":{"kind":{"enum":["give-resource","make-offering"]}},"required":["kind"]},"then":{"required":["resource","amount"]}},{"if":{"properties":{"kind":{"const":"bless-mortal"}},"required":["kind"]},"then":{"required":["mortal"]}}],"additionalProperties":false},"goal":{"type":"object","properties":{"set":{"type":"object","properties":{"text":{"type":"string","minLength":1,"maxLength":140},"target":{"type":"string","enum":["provisioner-nikanor","smith-brontes","the-forge","town-square","altar","ferry-dock","inn","mountain-path","shop","tavern","wilderness-path","olympus-gate","underworld-shore","wilderness-grove","ancient-olive-tree","asphodel-meadow","great-hall","judgment-hall","forge","smith-ktesias","ferryman"]}},"required":["text","target"],"additionalProperties":false}},"additionalProperties":false},"linkedEventId":{"type":"string","enum":["evt-180-3356","evt-180-3357","evt-181-3370","evt-181-3371","evt-182-3386","evt-182-3387","evt-183-3401","evt-183-3402","evt-120-2297","evt-137-2542"],"description":"Cite only an id the instructions list for your action (report or legend); omit it when none is listed."}},"required":["action"],"allOf":[{"if":{"properties":{"action":{"const":"legend"}},"required":["action"]},"then":{"required":["assertion"]}},{"if":{"properties":{"action":{"const":"report"}},"required":["action"]},"then":{"required":["listener","content"]}},{"if":{"properties":{"action":{"const":"practice"}},"required":["action"]},"then":{"required":["move"]}},{"if":{"properties":{"action":{"const":"practice"},"move":{"const":"demand"}},"required":["action","move"]},"then":{"required":["cause","term"]}}],"additionalProperties":false}
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
You are Hephaestus, a Greek god of fire, the forge, craft.
Your drives, from 0 to 1: order 0.7, guardianship 0.5, vengeance 0.4, sovereignty 0.3.
What is told of you:
- At Thetis's asking Hephaestus forges Achilles' armour and shield in his house.
- With bright-eyed Athena he taught glorious crafts to men on earth, who once lived in caves.
- Hephaestus says Zeus caught him by the foot and hurled him from the threshold of heaven after he took Hera's side; he fell all day and landed on Lemnos.
- Hephaestus says his mother wished to hide him for his lameness and threw him out, and Thetis and Eurynome took him in.
- Hera bore Hephaestus without union with Zeus, in anger at Zeus's bearing Athena.
Those you hold close or against:
- hera (mother), disposition 0.10 on a scale from -1 to 1: In one telling she bore him alone and cast him out; in another Thetis took him in. The starting value is authored tuning.
- zeus (father, who cast him down), disposition -0.20 on a scale from -1 to 1: In the Iliad Zeus hurled him from the threshold of heaven after he took Hera's part. The starting value is authored tuning.
- athena (craft partner), disposition 0.40 on a scale from -1 to 1: They teach crafts to men together. The starting value is authored tuning.
Your powers:
- Fire of the Forge (action "strike"): Hurls fire at a structure. Costs divinity equal to the power; a strike at or above the ignition threshold sets a combustible target alight. Use a power of at most 3 (your authored power and the divinity you hold).
- Craftsman's Tale (action "legend"): Tells of a made thing or a debt of craft, told aloud to everyone present and recorded as a legend.
- Gift of Craft (action "bless"): Answers a mortal's prayer for help with what it needs.
You may also tell someone here something (action "report", naming the listener, your words, and optionally a claim of who harmed or did a kindness to whom, and an event you saw). It is your own account, told as you choose.
For a report: {"action":"report","listener":"<who is here>","content":"<what you tell, one or two short sentences>"}
For a report, linkedEventId may be only one of: evt-120-2297, evt-137-2542; omit it to cite nothing.
A legend is heard by everyone here now: provisioner-nikanor, smith-brontes.
For a legend, linkedEventId may be only one of: evt-180-3356, evt-180-3357, evt-181-3370, evt-181-3371, evt-182-3386, evt-182-3387, evt-183-3401, evt-183-3402; omit it to cite nothing.
A practice (action "practice") is a bargain the world holds and judges: only moves bind, and words never do. Copy one of the objects the rows and openings below show; each names its move, and only a demand, an offer, and a counter carry a term {kind, party, deadlineTicks, and what the kind needs}.
Causes you may demand over: [evt-120-2297] you saw theft (smith-ktesias, ferryman); [evt-137-2542] you saw building-damaged (the-forge, hephaestus, smith-ktesias).

You remember:
- You saw [evt-120-2297] theft (smith-ktesias, ferryman): smith-ktesias harmed ferryman
- You saw [evt-137-2542] building-damaged (the-forge, hephaestus, smith-ktesias): hephaestus harmed smith-ktesias
How you feel now:
- smith-ktesias: affinity -2
What you did recently:
- you told everyone present: "I, Hephaestus, am known for teaching crafts to men. I share this tale with my fellow craftsmen." (heard by provisioner-nikanor, smith-brontes, smith-delia, smith-ktesias)
- you told smith-ktesias: "I remember well when we, with Athena, taught the arts to men in caves, aiding their climb from darkness."
- you struck the-forge
You have no goal. You may set one.
You are at The Forge [forge] in the mortal realm, tick 183.
It is spring; summer begins at tick 200.
Your flock: 2 mortals revere you, most at forge (2).
You hold: divinity 8.
Here with you:
- provisioner-nikanor
- smith-brontes
Buildings here:
- The Forge [the-forge], damaged
Recent events here:
- [evt-180-3356] resource-produced (smith-brontes)
- [evt-180-3357] resource-gathered (provisioner-nikanor)
- [evt-181-3370] resource-gathered (smith-brontes)
- [evt-181-3371] resource-gathered (provisioner-nikanor)
- [evt-182-3386] resource-produced (smith-brontes)
- [evt-182-3387] resource-gathered (provisioner-nikanor)
- [evt-183-3401] resource-gathered (smith-brontes)
- [evt-183-3402] resource-gathered (provisioner-nikanor)
Places you can travel to (steps away): town-square 1, altar 2, ferry-dock 2, inn 2, mountain-path 2, shop 2, tavern 2, wilderness-path 2, olympus-gate 3, underworld-shore 3, wilderness-grove 3, ancient-olive-tree 4, asphodel-meadow 4, great-hall 4, judgment-hall 5.
What do you do?
```

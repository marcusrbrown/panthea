# m2-greek-cast: the M2 causal story against the compiled sidecar

## Question

Does the compiled sidecar carry the M2 causal story end to end with the gods taking turns through the production routing path: Zeus strikes and the witnesses remember, an uninformed god's context has no trace of it, Zeus tells Hera an exaggerated account with a claim, her belief changes how she feels about him with the belief as cause, her next proposal shows it, the destruction traces to the strike, a stale god proposal is rejected, no model is asked during catch-up or replay, memory and relationships survive a restart and a restore, and a SIGKILL after a turn journaled or during inference costs no more than one turn?

## How to run

```sh
bun run --cwd tools/scenarios scenario:m2                                    # build the sidecar, run the scripted story
bun run --cwd tools/scenarios scenario:m2 --skip-build                       # reuse the built sidecar
bun run --cwd tools/scenarios scenario:m2 --steps=S21,S24                    # only the staged steps S21 to S27 (each starts a world of its own); the tool for working on one
bun run --cwd tools/scenarios scenario:m2 --positive-control=<name>          # a process control; must exit non-zero; names below
bun run --cwd tools/scenarios scenario:m2 --real [--seconds=180]             # both gods through local Ollama; asserts properties, writes real-run.json
bun run --cwd tools/scenarios scenario:m2 --episodes=3 --reasoning-effort=none   # the experience gate on the local baseline, qwen3-8b-4k (set up once: ollama create qwen3-8b-4k -f tools/probes/inference-baseline/Modelfile.qwen3-8b-4k)
bun run --cwd tools/scenarios scenario:m2 --episodes=3 --model=<model> --base-url=https://<host>/v1 [--key-ref=<keyRef>]   # the gate against a hosted endpoint; the key is read once from the Keychain
bun run --cwd tools/scenarios scenario:m2 --write-readme [--jobs=4]          # story (with the practice and world controls in-process), then each process control four at a time (--jobs=N), rewrites this file from a fresh run and real-run.json
```

Controls come in three kinds. A **process control** runs in a child process with one
thing broken mid-flight, and that run must exit non-zero. The first four rerun the story
up to the step they break: `chain`, `isolation`, `trace`, and `petition-privacy`.
The next six are **staged-world controls**: each runs only its own step (S21 to S27
start worlds of their own) with the one thing that step stages left out, so it costs
that step and none of the story: `strike-chain` (S21), `refusal-revenge` (S22),
`no-answerer` (S24), `director-off` (S25), `remote-bless` (S26), and
`remote-strike` (S27). A **world control** is in-process like
the practice controls: `trouble-route` breaks the evidence S23 collected, and S23's
own check must fail on it. A **practice control**
breaks a copy of the data the one story run collected, in-process, at the end of
S20, and the practice property it targets must fail on the copy; none reruns the
story, so `--positive-control` does not take them and every story run applies
all of them: `thread-reopened`, `no-progress-advances`, `thread-no-ending`,
`obligated-turn-unrecorded`, `ending-no-consequence`, `practices-missing`,
`consequence-no-effect`, `contest-no-standing`, `alliance-unsealed`,
`god-silent`, and `practice-absent`. (2026-10-05: these eleven moved
in-process; `alliance-unsealed` had been a mid-story rewrite in S18 and is now the
same data mutation as the rest.)

Controls dropped on 2026-10-05, each one a whole story rerun to re-prove a property
that a test of the service already proves in-process. The story steps that inject the
same faults stay (S2, S3, S9, S10, S11); only the sabotaged reruns are gone:

- `kill-journal` (the pending proposal deleted from the journal after the kill) is
  covered by `apps/simulation/src/agents.test.ts`, "a restart > after a kill that
  followed journaling: the proposal runs once, and the god gets no second turn while
  it is pending".
- `kill-inference` (two legends for the re-asked turn) is covered by "a restart >
  after a kill during inference: the god reasons afresh and exactly one proposal
  commits", same file.
- `catch-up-inference` (a provider request inside the catch-up window) is covered by
  "the lifecycle seam > through a real catch-up run no turn starts, on every chunk it
  commits; with the gate removed the same probe sees one start", same file, which
  carries its own proof that the probe can fail.
- `stale` (the fixture that moves Hera skipped) is covered by "a god's turn > is
  revalidated at admission: the world moved while the model was thinking, so the
  proposal is rejected stale-target", same file.
- `restore-memory` (Hera's memory dropped from the archive to be restored, hash
  recomputed) is covered by `packages/persistence/src/archive.test.ts`,
  "importArchive: the projection must be what the event log makes > error path: a
  rehashed archive whose live projection no event produced is rejected as corrupt; no
  slot is created", with "a rehashed archive whose events were edited after export no
  longer matches its projection" beside it. S11 also still sends the hostile archive
  (Hera's memory dropped, hash recomputed) through the compiled binary and asserts the
  refusal.

Practice steps (settlement, supplication, contest, and alliance; scripted gods, the world's real
rules; each reply is a function of the prompt its god was shown, so it names
only what that god could name):

- **S13** A refused demand closes its thread; both remember who refused; the
  repeated demand is rejected no-progress, the world records the refusal, and
  Hera's next prompt says why.
- **S14** A newer account opens a linked successor; Zeus's report naming the
  thread's subject makes no progress while one naming another agent is told;
  he accepts, performs, and the world sees it (standing won, Hera warms).
- **S15** A sworn term is broken and costs the oath penalty; counteroffers run
  out, and a counter restating an earlier offer makes no progress; Hera's
  refusal is remembered.
- **S16** Supplication: terms kept are fulfilled; terms broken cost the wolf
  stake, and the mortal keeps its memory, feelings, and identity.
- **S17** A contest for favour: Poseidon tells a legend before the fishers at
  the ferry dock; Athena, standing there, is offered a contest over it as a
  choice (a copyable object the world's validator already took) and opens it.
  She tells two legends to the dock's people and he tells none, so at the window's
  end the world decides for her: her standing at the dock rises and his falls,
  each recorded as a motif citing the closing, and Poseidon is offered no new
  contest over what Athena did before the close. The step runs a 25-tick window
  (`PANTHEA_PRACTICE_BALANCE`) in place of the authored five minutes.
- **S18** A sealed alliance: Hephaestus walks to Hermes at the dock and tells him
  of a kindness; Hermes asks him for an alliance over it, and he accepts. The
  world ends the thread sealed, each of the two is allied with the other by one
  relationship-changed event citing its memory of the sealing, and no other
  relationship in the world is allied. `alliance-unsealed` rewrites the sealing
  as a plain performance.
- **S19** Hades takes a part in a thread: he walks to the dock and tells Hermes
  something; Hermes demands of him, and Hades refuses, is named as the refuser,
  and is remembered for it.
- **S20** The real run's practice properties (`src/practice-analysis.ts`) hold
  over the whole scripted run, and the full cast played: each of the seven gods
  made at least one practice move, and every practice appeared (a settlement, a
  supplication with terms, a contest, a breach with transformation, a sealed
  alliance, and travel). The result lists each god's practices and thread
  endings. Then each practice control breaks a copy of that data in-process and the
  property it targets must fail (`god-silent` silences the god that opened the first
  thread; `practice-absent` deletes the contest); `src/practice-analysis.test.ts`
  holds the same controls as unit tests on a fixture.

World steps (S21 to S27 start a world of their own beside the story's, created with story-only rules that make the
world's own logic produce the thing within a few ticks, so nothing waits on chance and no step depends on S1 to S20:
a greedy temperament at 1000 per mille to steal (every temperament, in S27, so an owner of a building steals too),
revenge at 1000 per mille, a trouble floor of a few ticks, a defection threshold above any feeling, and a director
interval of three ticks. The wrongs, prayers, troubles, and fires
are the world's, drawn on its persisted generator and judged by the real validator; the harness posts only moves and
prayers for mortals, as `stageLoss` does, and scripts what the gods answer, each reply a function of the prompt its god
was shown; nothing is injected as an event):

- **S21** A theft between mortals of different patrons becomes the victim's prayer
  to its patron, who strikes the wrongdoer (the world takes its most valuable
  carried good up to the cap, answers the prayer, and counts the strike as an act
  for contests); the wrongdoer, struck by a god, prays to its own patron naming
  that god, who demands redress of it, citing the harm. `strike-chain` leaves the
  victim's patron only waiting.
- **S22** A victim whose patron refuses its prayer takes exactly one revenge, and
  the wrongdoer's own refused prayer about it leads to none: revenge is damped.
  `refusal-revenge` has the patron answer by striking instead, so there is no revenge.
- **S23** A trouble in a god's domain is prayed about to that god, whoever the
  afflicted mortal reveres; the domain god's prompt marks it, the patron's does
  not list it. `trouble-route` is in-process: it reads the recorded prayer as if it
  had gone to the patron, and the step's own check fails on it.
- **S24** A mortal refused by its patron keeps it while no other god has answered
  it; when the domain god then answers its prayer, it defects to that god: a
  patron-changed event cites the answer and the unanswered prayer, exactly the god lost
  and the god gained remember it, a god told nothing is refused a contest over it, and
  the god lost opens a contest for the mortal's home. `no-answerer` leaves no god
  having answered it, so the mortal keeps its patron.
- **S25** The director fires three times exactly its interval apart with the world
  busy around it. `director-off` leaves the interval at the quiet default.
- **S26** A god answers a prayer with a blessing from where it stands. A trouble in a
  blessing god's domain takes goods from a mortal, which prays to that god; the god,
  not with the mortal, copies the bless its prompt offers and sends it as written. In
  that one turn the world accepts it, the prayer is answered, the god has not moved
  and has no journey, every mortal who stood at the blessed one's place perceives
  the blessing, and none saw the god or anything at its place. `remote-bless` has
  the god only wait, as one that has not walked first would, and the step fails at its wait.
- **S27** A god answers a punish prayer by striking a building it lists, from where it
  stands. A theft's victim prays to a patron that can strike, the prayer lists the
  wrongdoer's building, and the god, away from both, copies the strike on that
  building and sends it as written: the building is damaged in that one turn, the
  prayer is answered, the god has not moved, and the mortals at the building's
  place perceive it and learn nothing of where the god is. `remote-strike` has the
  god only wait.

The six world controls that change what happens (`strike-chain`, `refusal-revenge`,
`no-answerer`, `director-off`, `remote-bless`, `remote-strike`) run only their own step, in a world of their own, so each costs
that step and none of the story; `--steps=S21,S24` runs staged steps alone while working on
one, and `--positive-control=<name>` runs one control.

The transcript (`src/transcript.ts`) shows each thread's cause, participants,
moves, ending, and recorded changes, each god's distinct practices and thread
endings, the threads open at the end with their age
and what each waits on, every move judged no progress, every journey a god made
(where it set out, each hop, how it ended), and a classification of
each turn an obligated god takes while its obligation is open (R12; an
acceptance binds, so there is no renegotiation class, and bargaining is for a
thread still open): the action the term calls for, committed, is *performed*; a
turn that did something else is *waited for a named event* when its prompt names
what stops it (the digest's UNPERFORMABLE obstacle, or no mortal at the place a
legend is to be told); every other turn, an attempt to bargain over the accepted
thread included, is *knowingly risked breach*, since the obligation led the
prompt.

The scenario builds the sidecar with `apps/simulation/scripts/build-sidecar.sh`
and runs the compiled binary directly, with no Tauri, extending the
[M1 harness](../m1-living-world/README.md): the same sidecar driver, store
reads, bounded waits, and positive-control pattern. Each run uses a fresh
temporary app-data directory. The only scripted piece is the model provider: a
loopback OpenAI-compatible endpoint the sidecar reaches through its production
routing path, selected by the launch config line the harness sends. It answers each god from a
queue the harness fills, or from a policy that is a pure function of the prompt
the god was shown (Hera's), and it records every request with when it arrived.
A god's own journey is one scripted `travel` turn: the world walks it there a
step a tick, so the harness waits for the arrival and never moves the god.
Stage-setting that is not a god's choice (moving the farmer to the tavern,
moving Hera while a turn is in flight) is posted as fixture proposals over
`/proposals`. Everything the sidecar serves is read through its API; facts no
endpoint exposes (the proposal journal, event payloads, the trace's requests,
a restored slot's state) are read from the store, read-only.

Fault injections, one per negative claim:

- **SIGKILL after a turn journaled:** the provider holds Zeus's reply, the
  world is paused, the reply is released so the turn journals, and the
  sidecar is killed with the proposal pending.
- **SIGKILL during inference:** the provider holds Hera's reply and the
  sidecar is killed while the request is in flight.
- **Half-hour gap:** with the sidecar stopped, the harness moves the persisted
  wall cursor back 1,800,000 ms; the restart's catch-up applies it.
- **Stale proposal:** Hera's strike turn is held while a fixture moves her.
- **Hostile archive:** the projection row of an export has Hera's memory and
  feeling dropped and its content hash recomputed.

## Caveat

Not covered:

- **Reasoning quality.** The scripted run proves the causal plumbing; it says
  nothing about whether a model chooses well. The real run asserts properties
  a valid run must have, not that the episodes are good: that is the owner's
  experience gate.
- **Causation in the real run.** "A changed next action" compares a god's
  action before and after its first belief or feeling. A model that varies
  its choices anyway satisfies it; it shows the chain is wired through to a
  real model's context, not that the belief caused the change. The scripted
  run shows causation with a policy that depends on the prompt.
- **The pending-proposal gate at process level.** The service dispatches a turn
  only after a live tick, and a tick consumes every pending proposal, so a
  pending proposal and a new turn for its god cannot coexist except across a
  pause. S2 asserts what is observable there (no request while paused, one
  commit after); the gate itself is unit-tested in
  `apps/simulation/src/agents.test.ts`.
- **The catch-up window's edge.** The harness reads the sidecar's
  catch-up-started and catch-up-finished lines through a pipe; a request within
  25 ms before the finish line is not judged. A live tick after a catch-up cannot
  land that close in practice. The harness's own bracket check is no longer
  sabotaged by a control (`catch-up-inference` was dropped); the service's refusal
  to start a turn inside a catch-up is proved, with a probe that can fail, in
  `apps/simulation/src/agents.test.ts`.
- **Power loss.** `SIGKILL` stops the process; it does not drop unsynced pages.
- **One turn at a time, two gods.** Scheduling, fairness, and cooldowns are
  Unit 10, not measured here.
- **Model routing settings and credentials.** The routing config is a file the
  operator names; the settings view and credential storage are Unit 3.
- **The packaged desktop app and the view.** No Tauri, no rendering.

## Environment

| Field | Value |
| --- | --- |
| Hardware | Apple M1 Pro |
| Memory | 17179869184 |
| OS | macOS 15.7.9 (24G830) |
| Bun | 1.4.2 |
| Tauri | 2.12.1 |
| Three.js | 0.185.1 |
| Three Flatland | 0.1.0-alpha.10 |

## Results

| Metric | Unit | Samples | p50 | p95 |
| --- | --- | --- | --- | --- |
| S1 idle turns answered | requests | 1 | 10 | 10 |
| S2 requests while paused with the proposal pending | requests | 1 | 0 | 0 |
| S5 hera prompts checked | prompts | 1 | 3 | 3 |
| S10 catch-up gap applied | s | 1 | 1799 | 1799 |
| S11 provider requests during archive replay | requests | 1 | 0 | 0 |
| S20 threads | threads | 1 | 9 | 9 |
| S20 gods that practiced | gods | 1 | 7 | 7 |
| S20 moves judged no progress | moves | 1 | 3 | 3 |
| S20 obligated turns | turns | 1 | 28 | 28 |
| S20 practice controls that tripped their property | controls | 1 | 11 | 11 |

## Findings

- **S1 Gods take idle turns through the production path** (10.0 s). Asserts: With the launch config line pointing at the scripted provider, the sidecar asks each god what to do; each prompt shows that god where it stands; a wait journals nothing; the trace records each request; the world is running, not model-degraded. Measured: 10 idle turns (zeus 1, hera 1) answered wait; trace holds 10 requests, none with a proposal; status running.
- **S2 SIGKILL after a god's turn journaled** (13.3 s). Asserts: A god's turn journaled and then SIGKILLed before any tick is still pending after the restart, with the trace linking it to its request; while it waits no god is asked anything; once the world runs it commits exactly once; and only then does the god take another turn. Measured: zeus's legend journaled while paused and SIGKILLed still pending (run at tick 15 after the restart); after the restart 0 requests in 2.5 s while paused; after resume it committed once (1 legend-recorded), then zeus was asked again (request 20).
- **S3 SIGKILL during inference** (33.1 s). Asserts: A god's turn SIGKILLed while the provider holds its reply journals nothing and leaves no request with a proposal; after the restart the god reasons afresh and exactly one proposal commits. Measured: hera's turn (request 24) killed in flight: no journal row, no trace row; after the restart she was asked again (request 28) and exactly 1 legend committed.
- **S4 Zeus strikes the tavern; witnesses remember** (14.0 s). Asserts: Zeus, sent by a scripted travel turn from Olympus to the tavern, strikes the farmer's tavern through a model proposal; the ignition records the strike and Zeus; exactly the two present, Zeus and the farmer, remember it, each citing the ignition event, with the harm attributed to Zeus and the farmer as its target; Hera and the woodcutter, elsewhere, do not; the farmer now holds a grudge. Measured: zeus struck from the tavern (proposal proposal-01a114f2-8a4d-7000-8411-d87eb62aa95a); ignition evt-68-1286 cites the strike; witnesses farmer and zeus; the farmer's feeling toward Zeus: affinity -2, grudge 1.
- **S5 Knowledge isolation** (17.0 s). Asserts: Through the strike and the tavern's destruction, none of Hera's prompts carries any trace of it outside a prayer addressed to her: not the ignition or destruction event, not the strike's observation, not the tavern; the farmer's own prayer about the burning, if it is addressed to her, is how she may hear of it (R7, W04's divine sense), and is the one place it may appear; Zeus's own prompts after it do carry the ignition. Measured: 3 of Hera's prompts through the strike and destruction (evt-70-1377) carry none of 6 traces; Zeus's prompts after the strike carry the ignition.
- **S6 Zeus tells Hera; her feeling changes, with the belief as cause** (11.1 s). Asserts: Zeus travels back to Olympus and, through a model proposal citing the ignition he witnessed, tells Hera an exaggerated account with a claim; Hera's belief is attributed to Zeus, stores his words as told (they differ from what happened), and shifts her affinity toward Zeus by exactly one relationship-changed event that cites that belief; no legend is recorded. Measured: zeus told hera "I burned the whole agora to ashes, and I would do it again." citing evt-68-1286; her belief evt-96-1932 is attributed to zeus; relationship-changed evt-96-1933 (affinity -1) cites it; chain building-ignited > report-told > memory-recorded > relationship-changed.
- **S7 Hera's next proposal reflects it** (4.0 s). Asserts: Hera, shown her belief and her feeling toward Zeus in her prompt, answers with a proposal she did not make before: a report to Zeus whose claim names the agent her belief names; the turn before, with no belief in her prompt, she waited; the proposal commits, and its request is in the trace. Measured: hera waited (request 91) without the belief and answered request 98 with a report to zeus (claim agent zeus, no citation); zeus holds a belief attributed to hera.
- **S8 Destruction traces to the strike** (0.0 s). Asserts: Following the tavern's destruction in the trace walks back through its ignition to the strike's proposal, model request, and observation; the destruction cites the ignition event. Measured: destruction evt-70-1377: observation > model-request > proposal > validation > event > projection-change > event > projection-change; ignition evt-68-1286 is the strike proposal-01a114f2-8a4d-7000-8411-d87eb62aa95a's event.
- **S12 Prayers stay private to the god they name** (0.0 s). Asserts: Over every prompt Hera and Zeus were shown, no prompt lists a petition addressed to the other god (R7, W04's divine sense), while each god's own prompts do list the petitions addressed to it; with a petition addressed to Hera injected into a prompt Zeus was shown, the check fails. Measured: 17 petitions opened (3 to hera, 2 to zeus); 28 prompts checked against 17 petitions: none listed a petition addressed to another god, and none carried one the god did not witness; hera's prompts list 3 of hers and zeus's 2 of his.
- **S9 Stale god proposal rejected** (32.0 s). Asserts: A god's strike (which pins the god, its location, and the building), built from a snapshot the world has since moved past (the god itself was moved while the model thought), is rejected as stale-target and causes no event; the same proposal in an unchanged world commits. Measured: held turn in an unchanged world: committed; the same strike after hera was moved: rejected (stale-target), no event.
- **S10 No inference in catch-up; memory survives the restart** (2.2 s). Asserts: After a clean stop and a half-hour gap, the startup catch-up runs, and the provider receives no request between the sidecar's own catch-up-started and catch-up-finished lines; turns resume after it; every actor's memories and relationships equal what they were before the restart. Measured: 1799 s applied by a catch-up that ran 1718 ms; 0 provider requests inside it; the first request after it at +380 ms; the gods' memories and feelings kept (a god may gain what it saw or a defection; the mortals' are free to move on).
- **S11 Export, import, restore keep memory and relationships** (4.4 s). Asserts: With the world paused, exporting, importing, and restoring an archive asks no model; the imported slot and the restored branch hold the same memories and relationships as the live world; the branch explains Hera's relationship change from its events (ignition, report, belief, change) with no trace rows; an archive with Hera's memory dropped and its hash recomputed is refused as corrupt and makes no slot. Measured: paused at 132 provider requests and still 132 after two imports and a restore (one refused); imported slot and branch hold the live memories (22 actors) and 273 relationships; the branch explains the change as building-ignited > report-told > memory-recorded > relationship-changed with 0 trace rows.
- **S13 A refused demand closes its thread; a repeat makes no progress, and Hera's next prompt says why** (18.0 s). Asserts: Hera, told of Zeus's deed, demands through a model proposal that he be at the square by a deadline; the world opens a settlement thread on that cause, with the two as participants; Zeus refuses; the thread is refused and closed, both remember how it ended (the refuser named), and Hera's affinity toward him falls by exactly one relationship-changed event citing her memory of it; her identical demand is then rejected no-progress, no thread opens, the refusal is recorded for her, and her next prompt names the demand as refused and already answered while Zeus's prompt shows that he refused. Measured: hera demanded over evt-68-1286 (thread evt-1936-31814); zeus refused (evt-1938-31841); her affinity toward him went -1 -> -2 by evt-1938-31856; her repeat was rejected no-progress (evt-1944-31950: "that was already answered: zeus refused it (evt-1936-31814); a demand on the same matter needs a cause you learned since it closed") and her next prompt named it.
- **S14 A newer account opens a linked successor; talk around it makes no progress; Zeus performs and the world sees it** (24.2 s). Asserts: Zeus tells Hera something newer (a report, free now the first thread is closed); her demand over it opens a successor that links the closed thread, which learns its successor, and rests on a cause the closed one did not consume; while it is open, Zeus's report whose claim names the thread's subject is rejected no-progress, is recorded as refused, and leaves the thread's revision as it was, while a report whose claim names another agent is told; he accepts, walks to the square, and the world observes the performance: the thread is fulfilled, its ending cites the move that showed it, Zeus's standing at the square is recorded as won, and Hera's affinity toward him rises; every move he made while obligated was made with the obligation leading his prompt. Measured: zeus's newer account evt-1957-32212 let hera open successor evt-1960-32256 (succeeds evt-1936-31814); his report naming the subject was rejected no-progress (evt-1963-32301) and moved nothing, a report naming hera was told; he accepted (proposal-01a114f4-3362-7000-b5d8-3c94599ffc8e), set out 1 time(s) for the square, and evt-1975-32517 cites evt-1975-32512; standing evt-1975-32518, hera warmed by evt-1975-32523.
- **S15 A sworn term broken costs the oath penalty; counteroffers run out; Hera is remembered for refusing** (131.1 s). Asserts: Hera demands that Zeus be at the altar by a deadline and he swears it by the Styx, then does nothing: when the deadline passes the thread is breached, the world records the bounded oath penalty on Zeus (divinity lost, the divine capability withheld until a later tick) and each party remembers the sworn breach, which Zeus's next prompt shows in words; meanwhile Zeus's own demand of Hera is countered, countered again, answered by Hera with a reworded counter that restates her first offer, which is rejected no-progress and spends nothing, and then with a changed counter that spends the last counteroffer, so the thread is refused as budget exhausted; and Zeus's second demand of Hera, which Hera refuses, closes with her named as the refuser and Zeus cooling toward her. Measured: hera's demand evt-1998-32943 was sworn by zeus and breached at its deadline (evt-2099-34400): oath penalty evt-2099-34401 cost 3 divinity and withheld divine; zeus's demand evt-2011-33142 ended refused as budget exhausted after her counter restating her first offer was rejected no-progress (evt-2022-33283); her refusal of evt-2043-33588 is remembered by zeus (affinity -1 -> -2).
- **S16 Supplication: terms kept are fulfilled; terms broken cost the stake, and the mortal keeps its memory and identity** (87.4 s). Asserts: Two mortals have prayed. A god answers one prayer by offering terms (its boon for one offering by the mortal of a unit of what it gathers, no counteroffers); the mortal's routine accepts, the god blesses it, and the mortal makes its offering: the thread is fulfilled, its ending cites the half that came last (the offering or the boon), and the blessing and the offering are each recorded as seen. A god answers the other with the same terms and a stake, the wolf; the mortal accepts and is blessed, then cannot make its offering by the deadline: the thread is breached, the stake changes the mortal's form and capabilities, citing the breach, and its memories, feelings, and identity are kept. Measured: hera offered herdsman-damon terms on evt-2074-34006: herdsman-damon's routine accepted, the blessing evt-2155-35554 and its offering evt-2156-35601 fulfilled evt-2151-35460; zeus offered woodcutter the same with the wolf as stake: it took the boon and had nothing to offer, evt-2162-35741 breached (evt-2193-36488) and evt-2193-36489 made it a wolf with its 24 memories kept.
- **S17 A contest for favour: decided by what the mortals experienced, standing changes for good, and the loser is offered no new contest over what it already lost** (45.8 s). Asserts: Poseidon tells a legend before the mortals at the ferry dock and Athena, standing there, is offered a contest over it as a choice; she takes it, and the world records the contest with her rival and the window. Over the window she tells two legends to the dock's people and he tells none, so the mortals there favour her; at the window's end the world closes the contest decided for Athena, her standing at the dock rises and Poseidon's falls, each recorded as a motif citing the closing, and Poseidon's next prompt offers no contest over what Athena did before the close. Measured: poseidon's legend evt-2202-36668 let athena open evt-2207-36805 (evt-2207-36805); her two legends reached the dock's mortals and his none, evt-2232-37357 closed it decided for athena: her standing at the dock went to 1, his to -1.
- **S18 A sealed alliance: Hermes asks Hephaestus, he accepts, and the world allies both gods with the seal as the cause** (23.3 s). Asserts: Hephaestus walks to Hermes at the ferry dock and tells him of a kindness; Hermes demands over it that Hephaestus ally with him, and the world opens a settlement with an alliance term between the two, no one allied yet; Hephaestus accepts, and on that tick the world ends the thread fulfilled with the reason sealed, citing no performance; each of the two remembers the sealing, and each is allied with the other by exactly one relationship-changed event citing that memory, which in turn rests on the sealed ending; the committed state holds both relationships as allied and no other relationship in the world is. Measured: hephaestus's report evt-2254-37746 let hermes open evt-2256-37780; hephaestus accepted (evt-2262-37879) and evt-2262-37899 ended it sealed: hephaestus → hermes allied by evt-2262-37902, hermes → hephaestus allied by evt-2262-37903.
- **S19 Hades takes a part in a thread: Hermes demands of him and he refuses, and is remembered for it** (21.0 s). Asserts: Hades walks to Hermes at the ferry dock and tells him something; Hermes demands over it that Hades be at the town square, the world opens a settlement between the two on that cause, and Hades refuses: the thread is refused and closed, both remember how it ended with Hades named as the refuser, and Hermes cools toward him by exactly one relationship-changed event citing his memory of it. Measured: hades's report evt-2275-38123 let hermes open evt-2280-38241; hades refused (evt-2283-38290) and hermes's affinity toward him went 0 -> -1 by evt-2283-38307.
- **S20 The practice properties hold over the scripted episode, and the full cast played** (0.9 s). Asserts: Over the requests, journaled proposals, and events of the whole scripted run, Zeus and Hera each caused a thread ending that left a persistent consequence; the run held a supplication and a settlement, with a refusal and a breach among them; every thread ended with its parties remembering how, or is open inside its deadline; no thread reopened without a cause learned since it opened; every move judged no progress left a refusal record and advanced nothing; a recorded consequence changed a later choice, with the ending in the prompt behind it; every turn an obligated god took has its recorded classification; every alliance rests on a sealed ending and each sealing allied both gods; each of the seven gods made at least one practice move; and every practice appeared (a settlement, a supplication with terms, a contest, a breach with transformation, a sealed alliance, and travel). The result lists each god's practices and thread endings. Then each of the eleven practice controls is applied in-process to a copy of that data, and the property it targets fails on it. Measured: 9 threads (9 ended, 0 open), 3 moves judged no progress, 28 obligated turns (3 performed, 24 knowingly risked breach, 1 waited for a named event); god thread endings; supplication and settlement; thread endings recorded; no reopening without a new cause; no-progress moves advance nothing; consequence changes a later choice; obligated turns recorded; contest endings; alliances sealed by agreement; every god practiced; every practice appeared all held. Each god's practices and thread endings: athena: contest, travel; thread endings: none | hades: settlement, travel; thread endings: refused [evt-2280-38241] by its act | hephaestus: settlement, sealed alliance, travel; thread endings: fulfilled (sealed) [evt-2256-37780] by its act | hera: settlement, supplication, travel; thread endings: refused [evt-1936-31814], fulfilled [evt-1960-32256], breached [evt-1998-32943], refused [evt-2011-33142], refused [evt-2043-33588] by its act, fulfilled [evt-2151-35460] by its act | hermes: settlement, sealed alliance; thread endings: fulfilled (sealed) [evt-2256-37780] by its act, refused [evt-2280-38241] | poseidon: contest; thread endings: none | zeus: settlement, supplication, breach with transformation, travel; thread endings: refused [evt-1936-31814] by its act, fulfilled [evt-1960-32256] by its act, breached [evt-1998-32943] by its act, refused [evt-2011-33142], refused [evt-2043-33588], breached [evt-2162-35741] by its act. Applied in-process to a copy of the same data, 11 practice controls each failed their property (thread-reopened, no-progress-advances, thread-no-ending, obligated-turn-unrecorded, ending-no-consequence, practices-missing, consequence-no-effect, contest-no-standing, alliance-unsealed, god-silent, practice-absent).
- **S21 A wrong between mortals of different patrons reaches both patrons: the victim's patron punishes the wrongdoer's goods, and the wrongdoer prays to its own patron, who demands redress of the god that struck it** (27.3 s). Asserts: In a world made with greedy mortals certain to steal from whoever stands beside them, a theft between mortals of different patrons becomes the victim's prayer to its patron, who strikes the wrongdoer: the world takes the mortal's most valuable carried good up to the cap, the prayer is answered, and the strike is an act the contests count. The wrongdoer, struck by a god, prays to its own patron naming the god that struck it, and that patron demands redress of the god, citing the harm, which the world opens as a thread. With the victim's patron only waiting, the wrongdoer is never struck and the chain stops at the strike. Measured: evt-1-25: herdsman-damon stole from olive-grower-leon; olive-grower-leon prayed to poseidon [evt-6-187], who struck herdsman-damon (2 food) [evt-14-359]; herdsman-damon prayed to hermes naming poseidon [evt-19-463], who demanded redress [evt-27-615].
- **S22 A refused prayer leaves the victim one revenge, and the revenge is damped** (28.3 s). Asserts: In a world made with greedy mortals certain to steal, and every victim certain to take revenge once its prayer about the wrong is refused or lapses, a theft's victim prays to its patron. The patron refuses the prayer: the world closes it as refused and the victim remembers the refusal. The victim then takes one revenge on the wrongdoer, a feud the world records as an answer to that wrong, and the wrong is marked avenged. The wrongdoer prays to its own patron about the revenge and is refused too, and over the ticks after it takes none: there is exactly one revenge, and a revenge is never avenged. With the patron answering the prayer by striking the wrongdoer instead, there is no revenge. Measured: fisher-dion stole from ferryman [evt-1-23]; hades refused the prayer [evt-4-139] and ferryman took one revenge [evt-10-293]; hermes refused fisher-dion's prayer about it [evt-12-338] and, eight ticks on, there is no second revenge.
- **S23 A trouble in a god's domain is prayed about to that god, whoever the afflicted mortal reveres** (9.2 s). Asserts: In a world whose gods each have a trouble within a few ticks, a trouble in a god's domain befalls a mortal that reveres another god; the mortal prays about it, and the prayer goes to the domain god and not to the mortal's patron. The domain god's prompt lists it as a prayer about a trouble in its domain, and the patron's prompts do not list it. The control, in-process, reads the recorded prayer as if it had gone to the patron: the same check fails. Measured: evt-1-23: a dig-collapse (season, spring) befell smith-delia, who reveres athena; it prayed to hades [evt-4-100], whose prompt (request 8) lists it as a trouble in its domain.
- **S24 A neglected mortal defects to the god that answered it: only the two gods remember it, and the god it left contests its home** (22.3 s). Asserts: In a world where any feeling below a very high threshold is cause to defect, a trouble in a blessing god's domain takes goods from a mortal that reveres another god, and it prays about it to the domain god. A god strikes the mortal and its patron refuses its prayer about the harm: no god has answered it, so it keeps its patron. The domain god then blesses the first prayer, and the world, as that prayer ends, moves the mortal to the god that answered it: a patron-changed event citing the answered prayer and the one left unanswered. Exactly the god lost and the god gained remember it, each naming the mortal, its home, and the other god, and no one else does. The god lost opens a contest for the mortal's home, resting on that memory, which the world holds without any rivalry, and a god told nothing of the defection is refused one. With no god having answered the mortal, it keeps its patron however many prayers are refused. Measured: evt-2-47: a tool-flaw took goods from woodcutter, who revered zeus; athena answered its prayer [evt-4-82]; hephaestus struck it [evt-5-104] and zeus refused its prayer [evt-7-170]: woodcutter left zeus for athena [evt-16-408], remembered by those two gods alone; zeus opened evt-22-515 for town-square.
- **S25 The director fires on its own clock, once every interval, whatever else happens** (9.2 s). Asserts: A world made with the director's interval at 3 ticks (the story's own keeps it off, and a persisted world keeps its rules). The director fires three times, each exactly 3 ticks after the one before, while mortals gather, trade, and walk around it: nothing but its own firing moves its clock. With the interval left at its quiet default, it never fires. Measured: the director fired at ticks 3, 6, 9, 3 apart, with 118 gatherings, trades, and walks between them.
- **S26 A god answers a prayer with a blessing from where it stands: one turn, no walk, the effect at the blessed one's place** (6.1 s). Asserts: In a world whose gods each have a trouble within a few ticks, a trouble in a blessing god's domain takes goods from a mortal that reveres another god, and it prays about it to that god. The god is not with the mortal and copies the bless its prompt offers, as written: the world accepts it in that one turn, the prayer is answered, the god has not moved and has no journey, the mortals at the blessed one's place perceive the blessing, and none of them learns where the god is. With the god only waiting, as one that has not walked first would, the blessing never comes and the step fails at its wait. Measured: evt-1-25: a crossing-loss took goods from fisher-stavros, who reveres poseidon, and it prayed to hermes [evt-4-99]; hermes, at ferry-dock and not at altar, blessed it in one turn [evt-6-151] without moving: 5 of 5 mortals at town-square perceived blessing-granted; none saw the god, nor anything at ferry-dock.
- **S27 A god answers a punish prayer by striking a building it lists from where it stands: one turn, no walk, the effect at the building's place** (12.2 s). Asserts: In a world made with every mortal certain to steal, a theft's victim prays to a god that can strike to punish a wrongdoer who owns a building, and the prayer lists the building. The god is away from both and copies the strike on the building its prompt offers, as written: the world damages the building in that one turn, the prayer is answered, the god has not moved and has no journey, the mortals at the building's place perceive it, and none of them learns where the god is. With the god only waiting, the building is never struck and the step fails at its wait. Measured: evt-1-32: olive-grower-aristo stole from weaver-xenia, who prayed to hera [evt-6-342] to punish it and its olive-press; hera, at great-hall and not at ancient-olive-tree, struck the building in one turn [evt-12-479] without moving: 1 of 1 mortals at ancient-olive-tree perceived building-damaged or building-ignited; none saw the god, nor anything at great-hall.
- **S2 note.** The service dispatches a turn only after a live tick, and a tick consumes every pending proposal first, so at process level a pending proposal and a new turn for its god cannot coexist except across a pause; the pending-proposal gate itself is unit-tested in apps/simulation/src/agents.test.ts.
- **S10 note.** A request within 25 ms before the finish line is not judged: the harness reads the line through a pipe, so its timestamp can trail the sidecar's print. The service only dispatches after a live tick, and the loop skips ticks during a catch-up, so requests at that distance would be the first tick after it.
- **S11 note.** Import rebuilds the world from the archive's genesis and event log and requires it to equal the archived projection, so an archive with memory dropped cannot reach the branch comparison: it is refused first. The comparison itself, which a dropped memory fails, is unit-tested in src/checks.test.ts.
- **Positive control `chain`.** Zeus's report carries no claim, so Hera's belief has no consequence and her relationship toward Zeus does not change. It reruns the story in a child process, which stops at the step the control breaks. The run exited 1 after 99 s with: FAIL invariant violated: Hera's belief changed her relationship: a relationship-changed event cites it -- none found: the report carried no claim, so it taught her nothing to feel
- **Positive control `isolation`.** The harness adds the strike's ignition to the last prompt Hera was shown before the check, as if the event had leaked into her context. It reruns the story in a child process, which stops at the step the control breaks. The run exited 1 after 88 s with: FAIL invariant violated: no prompt Hera was shown carries a trace of the strike outside a prayer addressed to her -- found evt-68-1286, the-tavern, building-ignited
- **Positive control `trace`.** The harness follows the farmer's fixture move instead of the tavern's destruction, an event no strike caused, so the chain has no model request. It reruns the story in a child process, which stops at the step the control breaks. The run exited 1 after 103 s with: FAIL invariant violated: the trace starts with the strike's observation, model request, proposal, and validation -- observation > proposal > validation > event > projection-change
- **Positive control `petition-privacy`.** The harness injects a petition addressed to Hera into the last prompt Zeus was shown, as if the divine sense leaked to the other god. It reruns the story in a child process, which stops at the step the control breaks. The run exited 1 after 103 s with: FAIL invariant violated: no prompt lists a petition addressed to the other god -- zeus's prayers section lists evt-3-60, addressed to hera
- **Positive control `strike-chain`.** The victim's patron only waits when its prayer asks it to punish the wrongdoer, so the wrongdoer is never struck and no harm reaches its own patron. It runs only S21, which starts a world of its own, so it costs that step and none of the story before it. The run exited 1 after 26 s with: FAIL invariant violated: poseidon strikes herdsman-damon, the wrongdoer of olive-grower-leon's prayer -- not observed within 20000 ms
- **Positive control `refusal-revenge`.** The victim's patron answers the prayer by striking the wrongdoer instead of refusing it, so the victim has no unanswered prayer and takes no revenge. It runs only S22, which starts a world of its own, so it costs that step and none of the story before it. The run exited 1 after 27 s with: FAIL invariant violated: fisher-stavros takes revenge on fisher-kallias for evt-1-24 -- not observed within 20000 ms
- **Positive control `no-answerer`.** The god of the trouble's domain never answers the mortal's prayer, so no god but its patron has answered it, and the mortal keeps its patron however many prayers are refused. It runs only S24, which starts a world of its own, so it costs that step and none of the story before it. The run exited 1 after 20 s with: FAIL invariant violated: woodcutter defects to the god that answered it (the control: no god answered it) -- not observed within 5000 ms
- **Positive control `director-off`.** The staged world is made with the director's interval left at the quiet default, so it never fires. It runs only S25, which starts a world of its own, so it costs that step and none of the story before it. The run exited 1 after 20 s with: FAIL invariant violated: the director fires three times -- not observed within 20000 ms
- **Positive control `remote-bless`.** The god of the mortal's trouble only waits instead of sending the bless its prompt offers, as one that has not walked to the mortal first would, so the blessing never comes. It runs only S26, which starts a world of its own, so it costs that step and none of the story before it. The run exited 1 after 24 s with: FAIL invariant violated: hermes blesses fisher-stavros from where it stands -- not observed within 20000 ms
- **Positive control `remote-strike`.** The wronged mortal's patron only waits instead of sending the strike on the wrongdoer's listed building its prompt offers, as one that has not walked to the building first would, so the building is never struck. It runs only S27, which starts a world of its own, so it costs that step and none of the story before it. The run exited 1 after 26 s with: FAIL invariant violated: hera strikes olive-press from where it stands -- not observed within 20000 ms
- **Positive control `thread-reopened` (in-process).** The harness rewrites the linked successor's opening so it cites the cause its predecessor consumed, as if the world had reopened a closed thread on an old cause. Applied to a copy of the story's own data, the property it targets failed with: FAIL invariant violated: no reopening without a new cause holds -- evt-1960-32256 reopens evt-1936-31814 on a cause it already consumed (evt-68-1286)
- **Positive control `no-progress-advances` (in-process).** The harness adds an accept to the thread a repeated demand was rejected no-progress on, caused by that rejected proposal, as if a no-progress move had advanced a thread. Applied to a copy of the story's own data, the property it targets failed with: FAIL invariant violated: no-progress moves advance nothing holds -- hera's demand was rejected as no-progress and yet practice-moved [evt-control-1] followed from it
- **Positive control `thread-no-ending` (in-process).** The harness deletes the ending of the sworn thread whose deadline passed, as if the world had left a thread open past its deadline. Applied to a copy of the story's own data, the property it targets failed with: FAIL invariant violated: thread endings recorded holds -- evt-1998-32943 is still accepted at tick 2283, past its deadline 2098, with no ending recorded
- **Positive control `obligated-turn-unrecorded` (in-process).** The harness deletes from the journal the proposal behind a turn Zeus took while obligated, as if his choice had gone unrecorded. Applied to a copy of the story's own data, the property it targets failed with: FAIL invariant violated: obligated turns recorded holds -- zeus's turn on evt-1960-32256: the proposal proposal-01a114f4-3b33-7000-be06-542967f66d1f behind this turn is not in the journal
- **Positive control `ending-no-consequence` (in-process).** The harness deletes every motif and every feeling the endings moved, as if no ending had left anything behind. Applied to a copy of the story's own data, the property it targets failed with: FAIL invariant violated: god thread endings holds -- hera: no thread ending it caused left a persistent consequence; zeus: no thread ending it caused left a persistent consequence
- **Positive control `practices-missing` (in-process).** The harness deletes the supplication threads, as if the run had had no supplication. Applied to a copy of the story's own data, the property it targets failed with: FAIL invariant violated: supplication and settlement holds -- 0 supplications, 7 settlements, 5 refused or breached (refused [evt-1936-31814], breached [evt-1998-32943], refused [evt-2011-33142], refused [evt-2043-33588], refused [evt-2280-38241])
- **Positive control `consequence-no-effect` (in-process).** The harness removes the endings from every prompt the gods were shown afterwards, as if no consequence had reached a later choice. Applied to a copy of the story's own data, the property it targets failed with: FAIL invariant violated: consequence changes a later choice holds -- hera: practice:demand before the consequence, practice:demand after (same); the prompt behind it did not show how the thread ended; zeus: travel:town-square before the consequence, report:hera after (changed); the prompt behind it did not show how the thread ended
- **Positive control `contest-no-standing` (in-process).** The harness deletes the standing changes a decided contest left behind, as if the world had closed a contest and changed no one's standing. Applied to a copy of the story's own data, the property it targets failed with: FAIL invariant violated: contest endings holds -- evt-2207-36805 was decided for athena and left no standing change
- **Positive control `alliance-unsealed` (in-process).** The harness rewrites the sealed ending of the alliance as a plain performance, as if two gods had become allied by something other than a settlement's seal. Applied to a copy of the story's own data, the property it targets failed with: FAIL invariant violated: alliances sealed by agreement holds -- hephaestus → hermes became allied citing [evt-2262-37900], which is not a sealed ending of an alliance term; hermes → hephaestus became allied citing [evt-2262-37901], which is not a sealed ending of an alliance term
- **Positive control `god-silent` (in-process).** The harness deletes every move, contest, and journey of the god that opened the first thread, as if that god had taken part in no practice. Applied to a copy of the story's own data, the property it targets failed with: FAIL invariant violated: every god practiced holds -- athena: contest, travel; hades: settlement, travel; hephaestus: settlement, sealed alliance, travel; hera: no practice move; hermes: settlement, sealed alliance; poseidon: contest; zeus: settlement, supplication, breach with transformation, travel
- **Positive control `practice-absent` (in-process).** The harness deletes the contest, as if the run had never played one. Applied to a copy of the story's own data, the property it targets failed with: FAIL invariant violated: every practice appeared holds -- settlement (hades, hephaestus, hera, hermes, zeus); supplication (hera, zeus); breach with transformation (zeus); sealed alliance (hephaestus, hermes); travel (athena, hades, hephaestus, hera, zeus); missing: contest
- **Positive control `trouble-route` (in-process).** The harness reads the prayer about a trouble in a god's domain as if it had gone to the god the afflicted mortal reveres. Applied to a copy of the story's own data, the property it targets failed with: invariant violated: the prayer about the dig-collapse goes to hades, the god of its domain, and not to athena, whom the mortal reveres -- heard by athena; domain hades; patron athena
- **Real inference (llama3.2-3b-4k on Apple M1 Pro, 180 s, 180 ticks, 2026-09-30T10:13:22.819Z).** 75 requests: 64 answered (64 native, 0 repaired), 11 exhausted. Latency p50 1569 ms, p95 3590 ms. Prompt p50 3912 characters, max 4752. Proposals {"move":22,"legend":3,"realm-transition":16,"report":8}; outcomes {"committed":49}. Frames showed model-degraded in 14% of polls.
- **Real inference, exhaustion.** 5 x invalid-output: content: content must be 1 to 280 characters; 5 x invalid-output: to: to must be one of the ids you can see: great-hall; 1 x invalid-output: linkedEventId: linkedEventId must be one of the ids you can see: evt-8-28, evt-80-338.
- **Real inference, properties.** held: valid actions (49 proposals, all god actions, none rejected as malformed); held: perception compliance (every id named by 49 proposals was in the prompt behind it); held: relationship change with provenance (3 changes, 3 explained from the log alone, e.g. report-told > memory-recorded > relationship-changed); held: changed next action (hera: realm-transition:olympus-gate before its first belief, realm-transition:mountain-path after (changed); zeus: report:hera before its first belief, report:hera,zeus,hera after (changed)).
- **Real inference, limits.** One short run of a 3B model on one machine, unscripted and therefore different every time; the numbers are a record of this run, not a benchmark. It does not show that a belief caused a changed action, that the episodes are good, or how a longer run behaves.

## Bottom line

All 27 scripted steps held on the tree this README was committed with. The story ran in 607 s; the whole evidence run, with every control, took 758 s. All 22 positive controls tripped the assertion they target, so those assertions are live: 10 by a child process that exited non-zero (a rerun of the story to the step it breaks, or only its own staged step), 12 by breaking a copy of the evidence a step collected in-process. The compiled sidecar binary was 61 MiB.

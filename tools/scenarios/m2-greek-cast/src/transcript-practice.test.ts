import { expect, test } from "bun:test";
import { analyzeEpisode } from "./episode-analysis";
import { identities } from "./episode-test-data";
import { episode } from "./practice-test-data";
import { analyzeReal, type RealInput } from "./real-analysis";
import {
  type EpisodeRecord,
  renderSummary,
  renderTranscript,
} from "./transcript";

function recordOf(data: RealInput, index = 1): EpisodeRecord {
  return {
    index,
    total: 3,
    settings: {
      model: "qwen3-8b-4k",
      reasoningEffort: "none",
      seconds: 300,
      ranAt: "2026-10-02T12:00:00.000Z",
      ticks: 300,
      hardware: "Apple M1 Pro",
    },
    identities: ["zeus", "hera"].flatMap((god) => {
      const identity = identities.get(god);
      return identity ? [identity] : [];
    }),
    input: data,
    analysis: analyzeReal(data),
    episode: analyzeEpisode(data, identities, ["zeus", "hera"]),
  };
}

const section = (text: string, heading: string) =>
  (text.split(`## ${heading}\n`)[1]?.split("\n## ")[0] ?? "").trim();

test("each thread is shown with its cause, participants, moves, ending, and the changes it recorded", () => {
  const { input, ids } = episode();
  const text = renderTranscript(recordOf(input));
  const threads = section(text, "Practice threads");
  // The refused settlement.
  expect(threads).toContain(
    `### settlement [${ids.refused}]: hera → zeus, refused`,
  );
  expect(threads).toContain('- Cause: zeus told hera "I burned the agora"');
  expect(threads).toContain(
    "tick 10, Hera: demand — zeus is at town-square by tick 40",
  );
  expect(threads).toContain("tick 12, Zeus: refuse");
  expect(threads).toContain(
    "- Ending: refused at tick 12, by zeus; remembered by hera, zeus",
  );
  expect(threads).toContain("- Changed: hera → zeus: affinity -1");
  expect(threads).toContain(`- Reopened as: [${ids.successor}]`);
  // The sworn, breached successor, with the oath penalty.
  expect(threads).toContain(
    `### settlement [${ids.successor}]: hera → zeus, breached`,
  );
  expect(threads).toContain(`- Succeeds: [${ids.refused}]`);
  expect(threads).toContain("tick 21, Zeus: accept, sworn by the Styx");
  expect(threads).toContain(
    "zeus paid the oath penalty: 3 divinity lost and divine withheld until tick 151",
  );
  expect(threads).toContain("- Ending: breached at tick 51, by zeus (sworn)");
  // The supplications, the broken one with its stake and the transformation.
  expect(threads).toContain(
    `### supplication [${ids.kept}]: hera → farmer, fulfilled`,
  );
  expect(threads).toContain("- Boon: seen given");
  expect(threads).toContain(
    `### supplication [${ids.broken}]: zeus → woodcutter, breached`,
  );
  expect(threads).toContain("- Stake: wolf");
  expect(threads).toContain("woodcutter became wolf as punishment");
});

test("each god's distinct practices and thread endings are listed, in the order the gods are shown", () => {
  const { input, ids } = episode();
  const lines = section(
    renderTranscript(recordOf(input)),
    "What each god practiced",
  ).split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toStartWith(
    "- zeus: settlement, supplication, breach with transformation; thread endings: ",
  );
  expect(lines[0]).toContain(`refused [${ids.refused}]`);
  expect(lines[0]).toContain(`breached [${ids.successor}] by its act`);
  expect(lines[1]).toStartWith(
    "- hera: settlement, supplication; thread endings: ",
  );
  expect(lines[1]).toContain(`fulfilled [${ids.kept}] by its act`);
});

test("threads still open at the end are listed with their age and what each waits on; none says so", () => {
  const { input } = episode();
  expect(
    section(renderTranscript(recordOf(input)), "Open threads at the end"),
  ).toBe("No thread was open at the end.");
  // Cut the log at the successor's acceptance: it is open, accepted, and waiting on Zeus.
  const cut: RealInput = {
    ...input,
    events: input.events.filter((e) => Number(e.tick) <= 41),
  };
  const open = section(
    renderTranscript(recordOf(cut)),
    "Open threads at the end",
  );
  expect(open).toContain(
    "settlement hera → zeus, open 21 ticks (since tick 20)",
  );
  expect(open).toContain(
    "waits on zeus to perform: zeus tells a legend to the mortals at altar by tick 50",
  );
  expect(open).toContain("ends by tick 50");
});

test("every move judged no progress is listed with the god, the move, the thread, and the world's reason", () => {
  const { input, ids } = episode();
  const moves = section(
    renderTranscript(recordOf(input)),
    "Moves judged no progress",
  );
  expect(moves).toContain(
    `- tick 14, hera: demand [${ids.refused}] — that was already answered: zeus refused it`,
  );
  expect(
    section(
      renderTranscript(
        recordOf({
          ...input,
          proposals: input.proposals.filter((p) => p.reason !== "no-progress"),
        }),
      ),
      "Moves judged no progress",
    ),
  ).toBe("No move was judged no progress.");
});

test("each turn an obligated god took while its obligation was open shows what it chose and how it is classified, with the rule that classifies it", () => {
  const { input, ids } = episode();
  const turns = section(
    renderTranscript(recordOf(input)),
    "Turns while an obligation was open",
  );
  expect(turns).toContain(
    "performed, waited for a named event, or knowingly risked breach",
  );
  // An acceptance binds: renegotiating belongs to an open thread, so it is not a class of obligated turn.
  expect(turns).not.toContain("renegotiated");
  expect(turns).toContain(
    `| zeus | 22 | ${ids.successor} | 50 | travel | performed |  |`,
  );
  expect(turns).toContain(
    `| zeus | 30 | ${ids.successor} | 50 | waited | waited for a named event | a mortal to arrive at altar |`,
  );
  expect(turns).toContain(
    `| zeus | 40 | ${ids.successor} | 50 | report | knowingly risked breach |  |`,
  );
  // A turn that cannot be classified is said to be unrecorded.
  const lost: RealInput = {
    ...input,
    proposals: input.proposals.filter(
      (p) => !(p.actor === "zeus" && p.kind === "travel"),
    ),
  };
  expect(
    section(
      renderTranscript(recordOf(lost)),
      "Turns while an obligation was open",
    ),
  ).toContain("Not recorded:");
  // No obligation: no turns.
  const none: RealInput = {
    ...input,
    events: input.events.filter(
      (e) => !(e.kind === "practice-moved" && e.sworn === true),
    ),
    requests: input.requests.map((r) => ({
      ...r,
      promptPayload: r.promptPayload?.replace("YOU OWE", ""),
    })),
  };
  expect(
    section(
      renderTranscript(recordOf(none)),
      "Turns while an obligation was open",
    ),
  ).toContain("No obligation led a prompt");
});

test("the properties of the practice run appear in the model run section, and the summary lists the practices of each episode and keeps the requirement line", () => {
  const { input } = episode();
  const record = recordOf(input);
  const text = renderTranscript(record);
  expect(section(text, "Model run")).toContain("- god thread endings: held");
  expect(section(text, "Model run")).toContain(
    "- obligated turns recorded: held",
  );
  const summary = renderSummary([record], {
    seconds: 300,
    model: "qwen3-8b-4k",
    reasoningEffort: "none",
    files: ["episode-1.md"],
  });
  expect(summary).toContain("- Requirements: O08");
  const practices = section(summary, "Practices");
  expect(practices).toContain(
    "| Episode | Threads | Ended | Open | Refused or breached | No progress | Obligated turns |",
  );
  expect(practices).toContain("| 1 | 4 | 4 | 0 | 3 | 1 | 3 |");
});

test("the model run section lists the replies the world refused, with whose turn and how many attempts, so a gate with exhausted requests can be read", () => {
  const { input } = episode();
  const refused: RealInput = {
    ...input,
    requests: [
      ...input.requests,
      {
        proposalId: undefined,
        role: "zeus",
        outcome: "exhausted",
        elapsedMs: 9000,
        promptPayload: "p",
        steps: [
          {
            reason: "invalid-output",
            detail: "move: move is missing; legal here: accept",
            attempts: 2,
            output: '{"action":"practice","thread":"evt-1-5"}',
            schema: "{}",
          },
        ],
      },
    ],
  };
  const text = section(renderTranscript(recordOf(refused)), "Model run");
  expect(text).toContain(
    '- zeus was refused after 2 attempts (move: move is missing; legal here: accept); it sent {"action":"practice","thread":"evt-1-5"}',
  );
  // An episode with none lists none.
  expect(section(renderTranscript(recordOf(input)), "Model run")).not.toContain(
    "was refused after",
  );
});

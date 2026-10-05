// S11: export, import, and restore. While paused nothing asks a model (import
// and restore replay the event log). The restored branch holds the same
// memories and relationships, and explains Hera's change from its events with
// no trace rows. A hostile archive with Hera's memory dropped and its hash
// recomputed is refused.

import { copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readFrame } from "../../../m1-living-world/src/steps/api";
import {
  slotStorePath,
  withWorldDb,
} from "../../../m1-living-world/src/world-db";
import { differences, explainChain } from "../checks";
import {
  readProjectedState,
  readStoredEvents,
  rewriteArchiveProjection,
} from "../db";
import type { Report } from "./chain";
import type { Recorder, Story } from "./context";
import { check, stateOf, waitFor } from "./support";

const dropHera = (encoded: Record<string, unknown>): void => {
  encoded.memories = (encoded.memories as [string, unknown][]).filter(
    ([owner]) => owner !== "hera",
  );
  encoded.relationships = (encoded.relationships as [string, unknown][]).filter(
    ([key]) => key !== "hera>zeus",
  );
};

const fmt = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value);

export async function stepRestore(
  recorder: Recorder,
  story: Story,
  report: Report,
): Promise<void> {
  await recorder.run(
    "S11",
    "Export, import, restore keep memory and relationships",
    "With the world paused, exporting, importing, and restoring an archive asks no model; the imported slot and the restored branch hold the same memories and relationships as the live world; the branch explains Hera's relationship change from its events (ignition, report, belief, change) with no trace rows; an archive with Hera's memory dropped and its hash recomputed is refused as corrupt and makes no slot.",
    async (step) => {
      const { provider } = story;
      const paused = await story.sidecar.request("POST", "/pause");
      check(
        paused.status === 200,
        "POST /pause answers",
        String(paused.status),
      );
      await waitFor(
        "the frame reports paused",
        async () =>
          (await readFrame(story.sidecar)).frame.status === "paused"
            ? true
            : undefined,
        { timeoutMs: 5000 },
      );
      // A turn already in flight may still land; let it settle before counting.
      await Bun.sleep(1500);
      const asked = provider.requests.length;
      const live = await stateOf(story);

      const exportPath = join(story.root, "m2-export.sqlite");
      const exported = await story.sidecar.request("POST", "/export", {
        path: exportPath,
      });
      check(exported.status === 200, "POST /export answers", fmt(exported));
      const hostilePath = join(story.root, "m2-export-hostile.sqlite");
      copyFileSync(exportPath, hostilePath);
      rewriteArchiveProjection(hostilePath, dropHera);

      const imported = await story.sidecar.request("POST", "/import", {
        archivePath: exportPath,
      });
      check(
        imported.status === 200,
        "importing the export succeeds",
        `${imported.status} ${fmt(imported.body)}`,
      );
      const importedSlot = (
        imported.body as { result: { slotId: string; slotPath: string } }
      ).result;
      const hostile = await story.sidecar.request("POST", "/import", {
        archivePath: hostilePath,
      });
      check(
        hostile.status === 422 && fmt(hostile.body).includes("event log"),
        "an archive with Hera's memory dropped and its hash recomputed is refused as not what its event log produces",
        `${hostile.status} ${fmt(hostile.body)}`,
      );
      const restored = await story.sidecar.request("POST", "/restore", {
        archivePath: exportPath,
      });
      check(
        restored.status === 200,
        "restoring the export succeeds",
        `${restored.status} ${fmt(restored.body)}`,
      );
      const branch = (
        restored.body as { result: { slotId: string; slotPath: string } }
      ).result;
      const slots = (
        (await story.sidecar.request("GET", "/slots")).body as {
          slots: unknown[];
        }
      ).slots;
      check(
        slots.length === 2,
        "the refused archive made no slot: the import and the restore made two",
        String(slots.length),
      );
      const staged = readdirSync(join(story.dataDir, "slots")).filter((name) =>
        name.startsWith(".staging-"),
      );
      check(staged.length === 0, "no staging directory was left", fmt(staged));

      for (const [label, slot] of [
        ["imported slot", importedSlot],
        ["restored branch", branch],
      ] as const) {
        const held = readProjectedState(slotStorePath(slot.slotPath));
        const changed = differences(live, held);
        check(
          changed.length === 0,
          `the ${label} holds the live world's memories and relationships`,
          changed.join("; "),
        );
      }
      const branchPath = slotStorePath(branch.slotPath);
      const chain = explainChain(
        readStoredEvents(branchPath),
        report.changeEventId,
      );
      check(
        chain.join() ===
          "building-ignited,report-told,memory-recorded,relationship-changed",
        "the restored branch explains Hera's change from its events alone",
        chain.join(),
      );
      const traceRows = withWorldDb(branchPath, (db) => {
        const tables = (
          db
            .query(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'trace_%'",
            )
            .all() as { name: string }[]
        ).map((row) => row.name);
        return tables.reduce(
          (sum, name) =>
            sum +
            (
              db.query(`SELECT COUNT(*) AS n FROM ${name}`).get() as {
                n: number;
              }
            ).n,
          0,
        );
      });
      check(
        traceRows === 0,
        "the restored branch carries no trace rows",
        `${traceRows} rows`,
      );

      await Bun.sleep(1000);
      const askedAfter = provider.requests.length;
      check(
        askedAfter === asked,
        "no provider request during export, import, refusal, and restore",
        `${askedAfter - asked} requests`,
      );
      const resumed = await story.sidecar.request("POST", "/resume");
      check(
        resumed.status === 200,
        "POST /resume answers",
        String(resumed.status),
      );
      await waitFor(
        "gods are asked again after the resume",
        () => (provider.requests.length > asked ? true : undefined),
        { timeoutMs: 20_000 },
      );
      step.done(
        `paused at ${asked} provider requests and still ${askedAfter} after two imports and a restore (one refused); imported slot and branch hold the live memories (${live.memories.size} actors) and ${live.relationships.size} relationships; the branch explains the change as ${chain.join(" > ")} with ${traceRows} trace rows`,
        [
          {
            name: "provider requests during archive replay",
            unit: "requests",
            value: 0,
          },
        ],
        [
          "Import rebuilds the world from the archive's genesis and event log and requires it to equal the archived projection, so an archive with memory dropped cannot reach the branch comparison: it is refused first. The comparison itself, which a dropped memory fails, is unit-tested in src/checks.test.ts.",
        ],
      );
    },
  );
}

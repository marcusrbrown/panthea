// Authoring-root layout and the pieces every record kind shares. Everything
// under the root is studio-local bookkeeping; canon stays in the registry.
//
//   <root>/session.lock          OS-held exclusive lock (SQLite)
//   <root>/session.json          the session record
//   <root>/requests/<id>.json
//   <root>/jobs/<id>.json
//   <root>/candidates/<jobId>.json
//   <root>/working-sets/<id>.json
//   <root>/edits/<id>.json
//   <root>/edits/<id>/{sheet.png,sheet.json,workspace.aseprite}
//   <root>/commands/<seq>.json   the always-on command ledger
//   <root>/blobs/<sha256>.png    content-addressed bytes

import { join } from "node:path";
import {
  fail,
  ok,
  type ParseResult,
  parseIntegerAtLeast,
  parseSlug,
  parseStrictRecord,
  parseString,
} from "@panthea/contracts";

export const STUDIO_SCHEMA_VERSION = 1;

export function parseStudioVersion(
  value: unknown,
  path: string,
): ParseResult<1> {
  return value === STUDIO_SCHEMA_VERSION
    ? ok(STUDIO_SCHEMA_VERSION)
    : fail(`${path}.schemaVersion`, `expected ${STUDIO_SCHEMA_VERSION}`);
}

export const studioPaths = (root: string) => ({
  lock: join(root, "session.lock"),
  session: join(root, "session.json"),
  requests: join(root, "requests"),
  jobs: join(root, "jobs"),
  candidates: join(root, "candidates"),
  workingSets: join(root, "working-sets"),
  edits: join(root, "edits"),
  commands: join(root, "commands"),
  blobs: join(root, "blobs"),
});

/** Where a job came from: its request, the slot it fills and its place in the request's sequence. */
export interface JobSource {
  readonly requestId: string;
  readonly slotKey: string;
  readonly ordinal: number;
}

export function parseJobSource(
  input: unknown,
  path: string,
): ParseResult<JobSource> {
  return parseStrictRecord(
    input,
    path,
    ["requestId", "slotKey", "ordinal"],
    (record) => {
      const requestId = parseSlug(record.requestId, `${path}.requestId`);
      if (!requestId.ok) return requestId;
      const slotKey = parseString(record.slotKey, `${path}.slotKey`);
      if (!slotKey.ok) return slotKey;
      const ordinal = parseIntegerAtLeast(record.ordinal, `${path}.ordinal`, 0);
      if (!ordinal.ok) return ordinal;
      return ok({
        requestId: requestId.value,
        slotKey: slotKey.value,
        ordinal: ordinal.value,
      });
    },
  );
}

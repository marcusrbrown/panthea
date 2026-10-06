// Authoring-root layout and the workspace record. Everything under the root is
// studio-local bookkeeping; canon stays in the registry.
//
//   <root>/session.lock          OS-held exclusive lock (SQLite)
//   <root>/session.json          the session record
//   <root>/requests/<id>.json
//   <root>/jobs/<id>.json
//   <root>/workspaces/<id>.json
//   <root>/commands/<seq>.json   the always-on command ledger
//   <root>/blobs/<sha256>.png    content-addressed bytes

import { join } from "node:path";
import {
  fail,
  ok,
  type ParseResult,
  parseEnum,
  parseSlug,
  parseStrictRecord,
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
  workspaces: join(root, "workspaces"),
  commands: join(root, "commands"),
  blobs: join(root, "blobs"),
});

export interface WorkspaceRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly requestId: string;
  readonly status: "open" | "complete";
}

export function parseWorkspaceRecord(
  input: unknown,
): ParseResult<WorkspaceRecord> {
  return parseStrictRecord(
    input,
    "workspace",
    ["schemaVersion", "id", "requestId", "status"],
    (record) => {
      const version = parseStudioVersion(record.schemaVersion, "workspace");
      if (!version.ok) return version;
      const id = parseSlug(record.id, "workspace.id");
      if (!id.ok) return id;
      const requestId = parseSlug(record.requestId, "workspace.requestId");
      if (!requestId.ok) return requestId;
      const status = parseEnum(record.status, "workspace.status", [
        "open",
        "complete",
      ] as const);
      if (!status.ok) return status;
      return ok({
        schemaVersion: version.value,
        id: id.value,
        requestId: requestId.value,
        status: status.value,
      });
    },
  );
}

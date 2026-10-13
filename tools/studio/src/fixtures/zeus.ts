import type { RequestInput } from "@panthea/assets/studio";

export interface AcceptanceRequest {
  readonly id: string;
  readonly input: RequestInput;
}

/** Zeus idle south: one 64x80 sprite slot at batch 1, generated at 512x640. */
export const idleSouth: AcceptanceRequest = {
  id: "zeus-idle-south-u7",
  input: {
    subject: "zeus",
    kind: "sprite",
    slots: [{ state: "idle", direction: "south" }],
    batch: 1,
    seed: 20261006,
  },
};

/** One portrait request over the vocabulary's expressions, batch 1 each, generated at 768x768. */
export const portraitRequest = (
  expressions: readonly string[],
): AcceptanceRequest => ({
  id: "zeus-portrait-u7",
  input: {
    subject: "zeus",
    kind: "portrait",
    slots: expressions.map((expression) => ({ expression })),
    batch: 1,
    seed: 20261007,
  },
});

/** Three idle sprite slots for the queue check: the second is removed, the first aborted, the third completes. */
export const queueProbe: AcceptanceRequest = {
  id: "zeus-queue-u7",
  input: {
    subject: "zeus",
    kind: "sprite",
    slots: [
      { state: "idle", direction: "south" },
      { state: "idle", direction: "north" },
      { state: "idle", direction: "east" },
    ],
    batch: 1,
    seed: 20261008,
  },
};

/** The runtime timings measured on the selected profile; every value is explicit. */
export const runtimeSettings = {
  pollMs: 100,
  deadlines: {
    httpMs: 10_000,
    startupMs: 120_000,
    generationMs: 300_000,
    termGraceMs: 2_000,
    killMs: 10_000,
  },
} as const;

/** A complete CLI config for the acceptance run: no conformance, editor or environment settings. */
export const acceptanceConfig = (paths: {
  studioRoot: string;
  contentRoot: string;
  registryRoot: string;
  artifactRoot: string;
  port: number;
}): Record<string, unknown> => ({
  studioRoot: paths.studioRoot,
  contentRoot: paths.contentRoot,
  registryRoot: paths.registryRoot,
  artifactRoot: paths.artifactRoot,
  runtime: {
    port: paths.port,
    pollMs: runtimeSettings.pollMs,
    deadlines: { ...runtimeSettings.deadlines },
  },
});

/** The `generate` command's arguments for a request. */
export const generateArgs = (
  request: AcceptanceRequest,
): Record<string, unknown> => ({ id: request.id, ...request.input });

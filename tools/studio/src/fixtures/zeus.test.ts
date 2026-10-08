import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  adapterInput,
  buildSpec,
  loadStudioContent,
  newRequestRecord,
  type RequestInput,
} from "@panthea/assets/studio";
import { parseConfig } from "../config";
import {
  acceptanceConfig,
  generateArgs,
  idleSouth,
  portraitRequest,
  queueProbe,
  runtimeSettings,
} from "./zeus";

const loaded = loadStudioContent(
  join(import.meta.dir, "..", "..", "..", "..", "content", "greek"),
);
if (!loaded.ok) throw new Error("the committed content does not load");
const content = loaded.content;
const never = () => {
  throw new Error("the fixtures give every seed; none may be drawn");
};

const specOf = (id: string, input: RequestInput) => {
  const built = newRequestRecord(content, { ...input, id }, never);
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  const spec = buildSpec(content, built.value.record.request);
  if (!spec.ok) throw new Error(JSON.stringify(spec.error));
  return { record: built.value.record, spec: spec.value };
};

describe("the Zeus acceptance requests", () => {
  test("idle south is one sprite slot, batch 1, with its own seed and the native 512x640 generation size", () => {
    expect(idleSouth.input).toMatchObject({
      subject: "zeus",
      kind: "sprite",
      slots: [{ state: "idle", direction: "south" }],
      batch: 1,
    });
    expect(Number.isSafeInteger(idleSouth.input.seed)).toBe(true);

    const { record, spec } = specOf(idleSouth.id, idleSouth.input);

    expect(spec.generated).toEqual({ w: 512, h: 640 });
    expect(record.request.batch).toBe(1);
    expect(record.request.seed).toBe(idleSouth.input.seed);
  });

  test("the portrait request has exactly the six vocabulary expressions in order, batch 1, with a seed and the native 768x768 size", () => {
    const portrait = portraitRequest(content.vocabulary.expressions);

    expect(portrait.input.slots).toEqual(
      content.vocabulary.expressions.map((expression) => ({ expression })),
    );
    expect(portrait.input.slots).toHaveLength(6);
    expect(portrait.input).toMatchObject({
      subject: "zeus",
      kind: "portrait",
      batch: 1,
    });
    expect(Number.isSafeInteger(portrait.input.seed)).toBe(true);
    const { spec } = specOf(portrait.id, portrait.input);
    expect(spec.generated).toEqual({ w: 768, h: 768 });
    expect(spec.slots.map((s) => s.key)).toEqual([
      ...content.vocabulary.expressions,
    ]);
  });

  test("the queue probe is three distinct idle sprite slots at batch 1", () => {
    expect(queueProbe.input.slots).toHaveLength(3);
    expect(new Set(queueProbe.input.slots.map((s) => s.direction)).size).toBe(
      3,
    );
    expect(queueProbe.input.slots.every((s) => s.state === "idle")).toBe(true);
    expect(queueProbe.input).toMatchObject({ kind: "sprite", batch: 1 });
    specOf(queueProbe.id, queueProbe.input);
  });

  test("request ids are distinct slugs and seeds differ, so no two requests share a job id or a seed", () => {
    const portrait = portraitRequest(content.vocabulary.expressions);
    const all = [idleSouth, portrait, queueProbe];

    expect(new Set(all.map((r) => r.id)).size).toBe(3);
    expect(new Set(all.map((r) => r.input.seed)).size).toBe(3);
    for (const r of all) expect(r.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  test("each request builds adapter inputs for every slot from the request's own seed", () => {
    for (const r of [
      idleSouth,
      portraitRequest(content.vocabulary.expressions),
      queueProbe,
    ]) {
      const { spec } = specOf(r.id, r.input);
      for (const slot of spec.slots) {
        const input = adapterInput(spec, slot.key, r.input.seed as number);
        expect(input.ok && input.value.seed).toBe(r.input.seed as number);
      }
    }
  });

  test("the generate arguments are the request's own fields with its id, and nothing about conformance", () => {
    const args = generateArgs(idleSouth);

    expect(args).toEqual({ id: idleSouth.id, ...idleSouth.input });
    for (const key of [
      "params",
      "set",
      "background",
      "alphaCutoff",
      "grid",
      "scale",
    ])
      expect(args).not.toHaveProperty(key);
  });
});

describe("the acceptance config", () => {
  const paths = {
    studioRoot: "/abs/studio",
    contentRoot: "/abs/content",
    registryRoot: "/abs/registry",
    artifactRoot: "/abs/artifacts",
    port: 8191,
  };

  test("is a complete config the CLI parser accepts, with the explicit runtime timings and no conformance, editor or env settings", () => {
    const config = acceptanceConfig(paths);

    const parsed = parseConfig(JSON.stringify(config), "/ignored");

    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.value.studioRoot).toBe("/abs/studio");
    expect(parsed.value.contentRoot).toBe("/abs/content");
    expect(parsed.value.registryRoot).toBe("/abs/registry");
    expect(parsed.value.artifactRoot).toBe("/abs/artifacts");
    expect(parsed.value.runtime).toEqual({
      port: 8191,
      pollMs: runtimeSettings.pollMs,
      deadlines: runtimeSettings.deadlines,
    });
    expect(parsed.value.conform).toBeUndefined();
    expect(parsed.value.editor).toBeUndefined();
    expect(Object.keys(config).sort()).toEqual([
      "artifactRoot",
      "contentRoot",
      "registryRoot",
      "runtime",
      "studioRoot",
    ]);
  });

  test("the runtime timings are the documented measured ones, every value a positive whole number", () => {
    expect(runtimeSettings).toEqual({
      pollMs: 100,
      deadlines: {
        httpMs: 10_000,
        startupMs: 120_000,
        generationMs: 300_000,
        termGraceMs: 2_000,
        killMs: 10_000,
      },
    });
  });
});

import { describe, expect, it } from "bun:test";
import vocabularyJson from "../../../content/greek/assets/vocabulary.json";
import {
  type AssetAction,
  type AssetRecord,
  type ConformanceReport,
  checkProvenanceAgainstJobs,
  type GenerationJob,
  mediumOfKind,
  newCandidate,
  parseConformanceReport,
  parseGenerationJob,
  transitionAsset,
} from "./asset-lifecycle";
import {
  type AssetManifest,
  type GenerationRequest,
  type Provenance,
  parseAssetManifest,
  parseAssetVocabulary,
  parseProvenance,
  type Sha256,
} from "./assets";

const H = (c: string) => c.repeat(64);

const request = {
  schemaVersion: 1,
  subject: "zeus",
  kind: "sprite",
  slots: [{ state: "idle", direction: "south" }],
  batch: 1,
  seed: 1,
};

function provenance(): Provenance {
  const parsed = parseProvenance({
    method: "generated",
    generations: [
      {
        jobId: "job-1",
        request,
        runtime: { name: "sd", version: "1" },
        model: { id: "m", sha256: H("a") },
        loras: [],
        encoder: null,
        vae: null,
        seed: 1,
        settings: {},
        used: [H("c")],
      },
    ],
    licences: [
      { subject: "sd", role: "runtime", licence: "MIT" },
      { subject: "m", role: "model", licence: "Apache-2.0" },
    ],
    relatedJobs: [
      { jobId: "job-1", status: "succeeded", outputs: [H("c"), H("7")] },
      { jobId: "job-0", status: "cancelled" },
    ],
    handEdits: [],
    sourceAssets: [],
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

function manifest(): AssetManifest {
  const vocabulary = parseAssetVocabulary(vocabularyJson);
  if (!vocabulary.ok) throw new Error(vocabulary.message);
  const parsed = parseAssetManifest(
    {
      schemaVersion: 1,
      kind: "sprite",
      id: "placeholder-zeus",
      cell: { w: 64, h: 80 },
      pixelScale: 1,
      paletteFamily: "olympus",
      paletteId: "provisional",
      styleTag: "draft",
      atlas: { blob: H("d"), width: 256, height: 80 },
      pivot: { x: 32, y: 80 },
      footprint: { w: 1, h: 1 },
      directions: ["south"],
      realmVariants: [],
      animations: [
        {
          state: "idle",
          direction: "south",
          frames: [0, 1, 2, 3].map((i) => ({
            rect: { x: i * 64, y: 0, w: 64, h: 80 },
            durationMs: 167,
          })),
        },
      ],
      provenance: provenance(),
    },
    vocabulary.value,
  );
  if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.message}`);
  return parsed.value;
}

/** The manifest after one recorded hand edit. */
function withHandEdit(
  base: AssetManifest,
  description: string,
  hash?: Sha256,
): AssetManifest {
  return {
    ...base,
    provenance: {
      ...base.provenance,
      handEdits: [
        ...base.provenance.handEdits,
        hash === undefined ? { description } : { description, hash },
      ],
    },
  };
}

const pass: ConformanceReport = {
  schemaVersion: 1,
  status: "pass",
  checks: [{ check: "binary-alpha", status: "pass" }],
};
const failing: ConformanceReport = {
  schemaVersion: 1,
  status: "fail",
  checks: [{ check: "binary-alpha", status: "fail", message: "soft edge" }],
};

describe("kinds and media", () => {
  it("maps kinds to the medium of their provider", () => {
    for (const kind of ["sprite", "portrait", "effect", "tile"] as const) {
      expect(mediumOfKind(kind)).toBe("image");
    }
    expect(mediumOfKind("sound")).toBe("sound");
  });
});

describe("generation jobs", () => {
  const image = { id: "local-image", medium: "image", hosting: "local" };
  const base = { schemaVersion: 1, id: "job-1", request, provider: image };
  const imageOutput = { medium: "image", hash: H("c"), width: 64, height: 80 };

  it("parses every status", () => {
    for (const job of [
      { ...base, status: "queued" },
      { ...base, status: "running", progress: 0.5 },
      { ...base, status: "succeeded", outputs: [imageOutput] },
      { ...base, status: "failed", error: "server exited" },
      {
        ...base,
        status: "unavailable",
        reason: "weights missing",
        staging: "stage the arm",
      },
      { ...base, status: "cancelled", cancelledBy: "aborted" },
      { ...base, status: "cancelled", cancelledBy: "removed" },
    ]) {
      const parsed = parseGenerationJob(job);
      expect(parsed.ok, JSON.stringify(job)).toBe(true);
      if (parsed.ok) expect<string>(parsed.value.status).toBe(job.status);
    }
  });

  it("rejects malformed jobs", () => {
    const bad: [string, object][] = [
      ["unknown status", { ...base, status: "paused" }],
      ["unknown key", { ...base, status: "queued", apiKey: "k" }],
      [
        "a cancelled job carrying outputs",
        {
          ...base,
          status: "cancelled",
          cancelledBy: "aborted",
          outputs: [imageOutput],
        },
      ],
      [
        "a succeeded job without outputs",
        { ...base, status: "succeeded", outputs: [] },
      ],
      ["progress out of range", { ...base, status: "running", progress: 2 }],
      [
        "unavailable without staging",
        { ...base, status: "unavailable", reason: "x" },
      ],
      ["a failed job without an error", { ...base, status: "failed" }],
      [
        "an unsupported version",
        { ...base, schemaVersion: 2, status: "queued" },
      ],
      [
        "a sound provider on an image request",
        { ...base, provider: { ...image, medium: "sound" }, status: "queued" },
      ],
      [
        "an image output without dimensions",
        {
          ...base,
          status: "succeeded",
          outputs: [{ medium: "image", hash: H("c") }],
        },
      ],
      [
        "a sound output claiming image dimensions",
        {
          ...base,
          request: { ...request, kind: "sound", slots: [{ state: "idle" }] },
          provider: { id: "local-sound", medium: "sound", hosting: "local" },
          status: "succeeded",
          outputs: [
            {
              medium: "sound",
              hash: H("c"),
              sampleRate: 44100,
              channels: 1,
              durationMs: 800,
              width: 64,
              height: 64,
            },
          ],
        },
      ],
      [
        "an image output on a sound job",
        {
          ...base,
          request: { ...request, kind: "sound", slots: [{ state: "idle" }] },
          provider: { id: "local-sound", medium: "sound", hosting: "local" },
          status: "succeeded",
          outputs: [imageOutput],
        },
      ],
      [
        "a hosted provider that ran",
        {
          ...base,
          provider: { ...image, hosting: "hosted" },
          status: "running",
        },
      ],
    ];
    for (const [name, job] of bad) {
      expect(parseGenerationJob(job).ok, name).toBe(false);
    }
  });

  it("parses a sound job with sound-shaped outputs and a hosted provider only as unavailable", () => {
    const soundBase = {
      schemaVersion: 1,
      id: "job-2",
      request: {
        ...request,
        kind: "sound",
        slots: [{ state: "thunder-strike" }],
      },
      provider: { id: "local-sound", medium: "sound", hosting: "local" },
    };
    expect(
      parseGenerationJob({
        ...soundBase,
        status: "succeeded",
        outputs: [
          {
            medium: "sound",
            hash: H("c"),
            sampleRate: 44100,
            channels: 1,
            durationMs: 800,
          },
        ],
      }).ok,
    ).toBe(true);
    expect(
      parseGenerationJob({
        ...base,
        provider: { id: "hosted-image", medium: "image", hosting: "hosted" },
        status: "unavailable",
        reason: "no hosted provider is wired",
        staging: "none",
      }).ok,
    ).toBe(true);
  });
});

describe("conformance reports", () => {
  it("parses consistent reports and rejects contradictions", () => {
    expect(parseConformanceReport(pass).ok).toBe(true);
    expect(parseConformanceReport(failing).ok).toBe(true);
    expect(parseConformanceReport({ ...pass, checks: failing.checks }).ok).toBe(
      false,
    );
    expect(parseConformanceReport({ ...failing, checks: pass.checks }).ok).toBe(
      false,
    );
    expect(parseConformanceReport({ ...pass, extra: 1 }).ok).toBe(false);
    expect(parseConformanceReport({ ...pass, schemaVersion: 2 }).ok).toBe(
      false,
    );
  });
});

describe("asset lifecycle", () => {
  const original = manifest();
  const candidate = newCandidate(original, pass);
  const failedCandidate = newCandidate(original, failing);

  function apply(record: AssetRecord, ...actions: AssetAction[]): AssetRecord {
    let current = record;
    for (const action of actions) {
      const result = transitionAsset(current, action);
      if (!result.ok) throw new Error(`${action.type}: ${result.message}`);
      current = result.value;
    }
    return current;
  }

  const draft = apply(candidate, { type: "pick" });
  const editing = apply(draft, { type: "start-edit" });
  const approved = apply(draft, { type: "approve" });
  const canon = apply(approved, { type: "canonize" });
  const rejected = apply(candidate, { type: "reject" });

  const states: [string, AssetRecord][] = [
    ["candidate", candidate],
    ["draft", draft],
    ["draft (editing)", editing],
    ["approved", approved],
    ["canon", canon],
    ["rejected", rejected],
  ];
  const actions: AssetAction[] = [
    { type: "pick" },
    { type: "reject" },
    { type: "start-edit" },
    {
      type: "finish-edit",
      manifest: withHandEdit(original, "tidied the outline"),
    },
    { type: "discard-edit" },
    { type: "approve" },
    { type: "canonize" },
  ];
  const legal: Record<string, string[]> = {
    candidate: ["pick", "reject"],
    draft: ["reject", "start-edit", "approve"],
    "draft (editing)": ["finish-edit", "discard-edit"],
    approved: ["canonize"],
    canon: [],
    rejected: [],
  };

  it("allows exactly the legal transitions and fails every other pair", () => {
    for (const [name, record] of states) {
      for (const action of actions) {
        const result = transitionAsset(record, action);
        const expected = legal[name]?.includes(action.type) ?? false;
        expect(result.ok, `${name} + ${action.type}`).toBe(expected);
        if (!result.ok) expect(result.code).toBe("illegal-transition");
      }
    }
  });

  it("walks candidate to draft to approved to canon, keeping the approved manifest", () => {
    expect(draft).toMatchObject({ state: "draft", edit: "idle", edits: [] });
    expect(approved).toMatchObject({
      state: "approved",
      basis: { type: "report-pass" },
    });
    expect(canon.state).toBe("canon");
    expect(canon.manifest).toEqual(original);
    expect(approved.manifest).toEqual(original);
  });

  it("rejection keeps the provenance and where it was rejected from", () => {
    const fromDraft = apply(
      candidate,
      { type: "pick" },
      { type: "reject", reason: "wrong pose" },
    );
    expect(rejected).toMatchObject({
      state: "rejected",
      rejectedFrom: "candidate",
    });
    expect(fromDraft).toMatchObject({
      state: "rejected",
      rejectedFrom: "draft",
      reason: "wrong pose",
    });
    expect(fromDraft.manifest.provenance).toEqual(original.provenance);
  });

  it("records an external edit without altering anything else", () => {
    const finished = apply(editing, {
      type: "finish-edit",
      manifest: withHandEdit(original, "tidied the outline", H("e") as Sha256),
    });
    expect(finished).toMatchObject({
      state: "draft",
      edit: "idle",
      edits: ["finished"],
    });
    expect(finished.manifest.provenance.handEdits).toEqual([
      { description: "tidied the outline", hash: H("e") as Sha256 },
    ]);
    expect((finished as { report?: unknown }).report).toBeUndefined();
    const discarded = apply(editing, { type: "discard-edit" });
    expect(discarded).toMatchObject({
      state: "draft",
      edit: "idle",
      edits: ["discarded"],
    });
    expect(discarded.manifest).toEqual(original);
  });

  it("approval needs a passing report or an owner exception with a reason", () => {
    const draftFailing = apply(failedCandidate, { type: "pick" });
    const refused = transitionAsset(draftFailing, { type: "approve" });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("conformance-failed");
    const blank = transitionAsset(draftFailing, {
      type: "approve",
      exception: { reason: "" },
    });
    expect(blank.ok).toBe(false);

    const withException = apply(draftFailing, {
      type: "approve",
      exception: { reason: "owner accepted the soft edge" },
    });
    expect(withException).toMatchObject({
      state: "approved",
      basis: {
        type: "owner-exception",
        reason: "owner accepted the soft edge",
      },
    });
    expect(withException.manifest.provenance.ownerException).toEqual({
      reason: "owner accepted the soft edge",
    });

    const freshReport = apply(draftFailing, { type: "approve", report: pass });
    expect(freshReport).toMatchObject({
      state: "approved",
      basis: { type: "report-pass" },
    });
  });

  it("refuses an edit that is not the old manifest plus one recorded hand edit", () => {
    const refuses = (edited: AssetManifest) => {
      const result = transitionAsset(editing, {
        type: "finish-edit",
        manifest: edited,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("invalid-manifest");
    };
    refuses({ ...original, id: "placeholder-hera" } as AssetManifest);
    refuses(original);
    refuses(withHandEdit(withHandEdit(original, "one"), "two"));
    refuses({
      ...withHandEdit(original, "tidied"),
      provenance: {
        ...withHandEdit(original, "tidied").provenance,
        licences: [{ subject: "someone-else", role: "model", licence: "MIT" }],
      },
    } as AssetManifest);
    const edited = apply(editing, {
      type: "finish-edit",
      manifest: withHandEdit(original, "tidied"),
    });
    const second = apply(edited, { type: "start-edit" });
    expect(
      transitionAsset(second, {
        type: "finish-edit",
        manifest: withHandEdit(original, "replaced"),
      }).ok,
    ).toBe(false);
  });

  it("an approval covers the edited manifest, and an edit invalidates the old report", () => {
    const edited = apply(
      draft,
      { type: "start-edit" },
      { type: "finish-edit", manifest: withHandEdit(original, "touch-up") },
    );
    const refused = transitionAsset(edited, { type: "approve" });
    expect(refused.ok).toBe(false);
    const reapproved = apply(edited, { type: "approve", report: pass });
    expect(reapproved.state).toBe("approved");
    expect(reapproved.manifest.provenance.handEdits).toEqual([
      { description: "touch-up" },
    ]);
  });
});

describe("provenance against job records", () => {
  const prov = provenance();
  const base = {
    schemaVersion: 1,
    request: request as unknown as GenerationRequest,
    provider: { id: "local-image", medium: "image", hosting: "local" },
  };
  const out = (hash: string) => ({
    medium: "image",
    hash,
    width: 64,
    height: 80,
  });
  const succeeded = {
    ...base,
    id: "job-1",
    status: "succeeded",
    outputs: [out(H("c")), out(H("7"))],
  };
  const cancelled = {
    ...base,
    id: "job-0",
    status: "cancelled",
    cancelledBy: "aborted",
  };
  const jobs = (...raw: object[]) =>
    raw.map((job) => {
      const parsed = parseGenerationJob(job);
      if (!parsed.ok) throw new Error(parsed.message);
      return parsed.value as GenerationJob;
    });
  const code = (result: ReturnType<typeof checkProvenanceAgainstJobs>) =>
    result.ok ? "ok" : result.code;

  it("accepts a ledger that agrees with the provenance", () => {
    expect(
      code(checkProvenanceAgainstJobs(prov, jobs(succeeded, cancelled))),
    ).toBe("ok");
  });

  it("rejects a missing job and a changed status", () => {
    expect(code(checkProvenanceAgainstJobs(prov, jobs(succeeded)))).toBe(
      "job-mismatch",
    );
    expect(
      code(
        checkProvenanceAgainstJobs(
          prov,
          jobs(succeeded, {
            ...base,
            id: "job-0",
            status: "failed",
            error: "x",
          }),
        ),
      ),
    ).toBe("job-mismatch");
  });

  it("needs the whole output set to match, not just the hashes the asset uses", () => {
    expect(
      code(
        checkProvenanceAgainstJobs(
          prov,
          jobs({ ...succeeded, outputs: [out(H("c"))] }, cancelled),
        ),
      ),
    ).toBe("hash-mismatch");
    expect(
      code(
        checkProvenanceAgainstJobs(
          prov,
          jobs(
            { ...succeeded, outputs: [out(H("c")), out(H("7")), out(H("6"))] },
            cancelled,
          ),
        ),
      ),
    ).toBe("hash-mismatch");
    expect(
      code(
        checkProvenanceAgainstJobs(
          prov,
          jobs(
            { ...succeeded, outputs: [out(H("c")), out(H("9"))] },
            cancelled,
          ),
        ),
      ),
    ).toBe("hash-mismatch");
  });

  it("rejects a generation whose job did not succeed in the ledger", () => {
    expect(
      code(
        checkProvenanceAgainstJobs(
          prov,
          jobs({ ...base, id: "job-1", status: "running" }, cancelled),
        ),
      ),
    ).toBe("job-not-succeeded");
  });

  it("rejects a request that differs from the job's, and a used hash outside the job's outputs", () => {
    expect(
      code(
        checkProvenanceAgainstJobs(
          prov,
          jobs({ ...succeeded, request: { ...request, seed: 2 } }, cancelled),
        ),
      ),
    ).toBe("job-mismatch");
    const stray =
      prov.method === "generated"
        ? {
            ...prov,
            generations: [{ ...prov.generations[0], used: [H("9")] }],
          }
        : prov;
    expect(
      code(
        checkProvenanceAgainstJobs(
          stray as Provenance,
          jobs(succeeded, cancelled),
        ),
      ),
    ).toBe("hash-mismatch");
  });

  it("checks every generation and every related job, and ignores source assets", () => {
    const twoJobs = {
      ...(prov as object),
      generations: [
        (prov as unknown as { generations: object[] }).generations[0],
        {
          ...(prov as unknown as { generations: object[] }).generations[0],
          jobId: "job-2",
          request: { ...request, seed: 2 },
          seed: 2,
          used: [H("d")],
        },
      ],
      relatedJobs: [
        ...(prov as unknown as { relatedJobs: object[] }).relatedJobs,
        { jobId: "job-2", status: "succeeded", outputs: [H("d")] },
      ],
      sourceAssets: [{ assetId: "older-zeus", revision: H("5") }],
    } as unknown as Provenance;
    const second = {
      ...succeeded,
      id: "job-2",
      request: { ...request, seed: 2 },
      outputs: [out(H("d"))],
    };

    expect(
      code(
        checkProvenanceAgainstJobs(twoJobs, jobs(succeeded, second, cancelled)),
      ),
    ).toBe("ok");
    expect(
      code(checkProvenanceAgainstJobs(twoJobs, jobs(succeeded, cancelled))),
    ).toBe("job-mismatch");
    expect(
      code(
        checkProvenanceAgainstJobs(
          twoJobs,
          jobs(
            succeeded,
            { ...second, request: { ...request, seed: 3 } },
            cancelled,
          ),
        ),
      ),
    ).toBe("job-mismatch");
  });

  it("holds failed, cancelled and unavailable refs to a ledger with no outputs", () => {
    const refs = (status: string) =>
      ({
        ...(prov as object),
        relatedJobs: [
          ...(
            prov as unknown as { relatedJobs: { jobId: string }[] }
          ).relatedJobs.filter((r) => r.jobId === "job-1"),
          { jobId: "job-x", status },
        ],
      }) as unknown as Provenance;
    const ledgerOf = (extra: object) =>
      jobs(succeeded, { ...base, id: "job-x", ...extra });

    expect(
      code(
        checkProvenanceAgainstJobs(
          refs("failed"),
          ledgerOf({ status: "failed", error: "x" }),
        ),
      ),
    ).toBe("ok");
    expect(
      code(
        checkProvenanceAgainstJobs(
          refs("unavailable"),
          ledgerOf({ status: "unavailable", reason: "r", staging: "s" }),
        ),
      ),
    ).toBe("ok");
    expect(
      code(
        checkProvenanceAgainstJobs(
          refs("failed"),
          ledgerOf({ status: "queued" }),
        ),
      ),
    ).toBe("job-mismatch");
    expect(
      code(
        checkProvenanceAgainstJobs(
          refs("cancelled"),
          ledgerOf({ status: "cancelled", cancelledBy: "removed" }),
        ),
      ),
    ).toBe("ok");
  });

  it("does not look at hand or derived provenance for generations", () => {
    const hand = {
      method: "hand",
      licences: [{ subject: "o", role: "original-work", licence: "MIT" }],
      relatedJobs: [
        { jobId: "job-1", status: "succeeded", outputs: [H("c"), H("7")] },
      ],
      handEdits: [{ description: "drew it" }],
      sourceAssets: [{ assetId: "older", revision: H("5") }],
    } as unknown as Provenance;

    expect(code(checkProvenanceAgainstJobs(hand, jobs(succeeded)))).toBe("ok");
    expect(
      code(
        checkProvenanceAgainstJobs(
          hand,
          jobs({ ...succeeded, outputs: [out(H("c"))] }),
        ),
      ),
    ).toBe("hash-mismatch");
  });
});

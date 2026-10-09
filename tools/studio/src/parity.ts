// AE9: whether two studio roots hold the same candidate for the same request.
//
// A candidate's evidence is its decoded generated original, its decoded
// conformed 1x image, its conformance report and its metrics, read from the
// durable records without the writer lock. Two candidates are identical when
// every decoded pixel, every check outcome and every metric match. The seed is
// shown for the reader but is not compared: a different seed shows up as
// different pixels.
//
//   bun tools/studio/src/parity.ts --a <root> --a-candidate <id> \
//     --b <root> --b-candidate <id>
//
// Exit 0 when identical, 1 when they differ or a candidate cannot be read,
// 64 for a usage error.

import {
  candidateFrames,
  decodePng,
  readStudioBlob,
  readStudioStatus,
} from "@panthea/assets/studio";

export interface PixelImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export interface CandidateEvidence {
  readonly candidateId: string;
  readonly seed: number | null;
  readonly generated: PixelImage;
  readonly conformed: PixelImage;
  readonly report: {
    readonly status: string;
    readonly checks: readonly {
      readonly check: string;
      readonly status: string;
    }[];
  };
  readonly metrics: {
    readonly resizeFactor: number;
    readonly coloursMerged: number;
    readonly pixelsChanged: number;
  };
}

export type EvidenceRead =
  | { readonly ok: true; readonly evidence: CandidateEvidence }
  | { readonly ok: false; readonly message: string };

const unreadable = (message: string): EvidenceRead => ({ ok: false, message });

/** Reads one candidate's evidence from a root, never writing to it. */
export function readCandidateEvidence(
  root: string,
  candidateId: string,
): EvidenceRead {
  let status: ReturnType<typeof readStudioStatus>;
  try {
    status = readStudioStatus(root);
  } catch (error) {
    return unreadable(
      `the studio root cannot be read: ${(error as Error).message}`,
    );
  }
  const candidate = status.candidates.find((c) => c.id === candidateId);
  if (candidate === undefined)
    return unreadable(`no candidate ${candidateId} in this root`);
  if (candidate.result.status !== "done")
    return unreadable(
      `candidate ${candidateId} needs a scale and has no conformed image`,
    );
  const job = status.jobs.find((j) => j.job.id === candidateId);
  if (job === undefined || job.job.status !== "succeeded")
    return unreadable(`the job of candidate ${candidateId} did not succeed`);
  const output = job.job.outputs[0];
  if (output === undefined)
    return unreadable(`the job of candidate ${candidateId} has no output`);
  const original = readStudioBlob(root, output.hash);
  if (original === undefined)
    return unreadable(`the generated image of ${candidateId} is missing`);
  const generated = decodePng(original);
  if (!generated.ok)
    return unreadable(
      `the generated image of ${candidateId} cannot be decoded: ${generated.message}`,
    );
  const frames = candidateFrames(root, candidateId);
  if (!frames.ok) return unreadable(frames.message);
  const frame = frames.frames[0];
  const conformed = frame === undefined ? undefined : decodePng(frame.bytes);
  if (conformed === undefined || !conformed.ok)
    return unreadable(
      `the conformed image of ${candidateId} cannot be decoded`,
    );
  const { result } = candidate;
  return {
    ok: true,
    evidence: {
      candidateId,
      seed: job.job.request.seed ?? null,
      generated: generated.image,
      conformed: conformed.image,
      report: {
        status: result.report.status,
        checks: result.report.checks.map((c) => ({
          check: c.check,
          status: c.status,
        })),
      },
      metrics: {
        resizeFactor: result.metrics.resize.factor,
        coloursMerged: result.metrics.coloursMerged,
        pixelsChanged: result.metrics.pixelsChanged,
      },
    },
  };
}

export interface Comparison {
  readonly identical: boolean;
  /** One line per difference, in a fixed order; empty when identical. */
  readonly differences: readonly string[];
}

function comparePixels(
  name: string,
  a: PixelImage,
  b: PixelImage,
): string | undefined {
  if (a.width !== b.width || a.height !== b.height)
    return `${name} size differs: ${a.width}x${a.height} against ${b.width}x${b.height}`;
  let differing = 0;
  let first: { x: number; y: number } | undefined;
  for (let at = 0; at < a.rgba.length; at += 4) {
    if (
      a.rgba[at] !== b.rgba[at] ||
      a.rgba[at + 1] !== b.rgba[at + 1] ||
      a.rgba[at + 2] !== b.rgba[at + 2] ||
      a.rgba[at + 3] !== b.rgba[at + 3]
    ) {
      differing += 1;
      const pixel = at / 4;
      first ??= { x: pixel % a.width, y: Math.floor(pixel / a.width) };
    }
  }
  if (differing === 0 || first === undefined) return undefined;
  return `${name} pixels differ: ${differing} of ${a.width * a.height} pixels, first at x=${first.x} y=${first.y}`;
}

export function compareEvidence(
  a: CandidateEvidence,
  b: CandidateEvidence,
): Comparison {
  const differences: string[] = [];
  const generated = comparePixels("generated", a.generated, b.generated);
  if (generated !== undefined) differences.push(generated);
  const conformed = comparePixels("conformed", a.conformed, b.conformed);
  if (conformed !== undefined) differences.push(conformed);
  if (a.report.status !== b.report.status)
    differences.push(
      `report status differs: ${a.report.status} against ${b.report.status}`,
    );
  const namesA = a.report.checks.map((c) => c.check);
  const namesB = b.report.checks.map((c) => c.check);
  if (namesA.join(",") !== namesB.join(",")) {
    differences.push(
      `report checks differ: ${namesA.join(", ")} against ${namesB.join(", ")}`,
    );
  } else {
    for (const [index, check] of a.report.checks.entries()) {
      const other = b.report.checks[index];
      if (other !== undefined && other.status !== check.status)
        differences.push(
          `report check ${check.check} differs: ${check.status} against ${other.status}`,
        );
    }
  }
  for (const key of [
    "resizeFactor",
    "coloursMerged",
    "pixelsChanged",
  ] as const) {
    if (a.metrics[key] !== b.metrics[key])
      differences.push(
        `metric ${key} differs: ${a.metrics[key]} against ${b.metrics[key]}`,
      );
  }
  return { identical: differences.length === 0, differences };
}

function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

/** The command line: prints one JSON object and returns the exit code. */
export function main(
  argv: readonly string[],
  write: (line: string) => void,
): number {
  const roots = [flag(argv, "--a"), flag(argv, "--b")];
  const ids = [flag(argv, "--a-candidate"), flag(argv, "--b-candidate")];
  if (roots.some((r) => r === undefined) || ids.some((i) => i === undefined)) {
    write(
      JSON.stringify({
        ok: false,
        error:
          "usage: --a <root> --a-candidate <id> --b <root> --b-candidate <id>",
      }),
    );
    return 64;
  }
  const reads = [0, 1].map((n) =>
    readCandidateEvidence(roots[n] as string, ids[n] as string),
  );
  const [a, b] = reads;
  if (a === undefined || b === undefined || !a.ok || !b.ok) {
    write(
      JSON.stringify({
        ok: false,
        error: [a, b].flatMap((r) =>
          r !== undefined && !r.ok ? [r.message] : [],
        ),
      }),
    );
    return 1;
  }
  const result = compareEvidence(a.evidence, b.evidence);
  write(
    JSON.stringify({
      ok: true,
      identical: result.identical,
      seeds: [a.evidence.seed, b.evidence.seed],
      generated: [a.evidence.generated.width, a.evidence.generated.height],
      conformed: [a.evidence.conformed.width, a.evidence.conformed.height],
      report: [a.evidence.report.status, b.evidence.report.status],
      differences: result.differences,
    }),
  );
  return result.identical ? 0 : 1;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2), (line) => console.log(line)));
}

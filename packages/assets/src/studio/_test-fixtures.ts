import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGodProfile, parseGodVisualProfiles } from "@panthea/content";
import {
  type GenerationJob,
  type GenerationRequest,
  type ParseResult,
  parseAssetVocabulary,
} from "@panthea/contracts";
import type { ConformanceMetrics, RgbaImage } from "../conformance";
import { sha256Hex } from "../hash";
import { parsePalette } from "../palette";
import { encodeRgbaPng } from "../placeholder";
import type { CandidateRecord, ConformParams } from "./candidates";
import type { StudioContent } from "./request";
import type { StudioSession } from "./session";
import type { AuthoredFrames, Keyframe, WorkingSetRecord } from "./working-set";

export const HOLDER = join(import.meta.dir, "_test-holder.ts");

export const request: GenerationRequest = {
  schemaVersion: 1,
  subject: "zeus",
  kind: "sprite",
  slots: [{ state: "idle", direction: "south" }],
  batch: 1,
  seed: 7,
};

const provider = {
  id: "fake-local",
  medium: "image",
  hosting: "local",
} as const;

export function jobSource(requestId = "r1", ordinal = 0) {
  return { requestId, slotKey: "idle/south", ordinal };
}

export function queuedJob(id: string) {
  return {
    schemaVersion: 1,
    id,
    request,
    provider,
    status: "queued",
  } as const satisfies GenerationJob;
}

export function runningJob(id: string) {
  return { ...queuedJob(id), status: "running" } as const;
}

export function succeededJob(id: string): GenerationJob {
  return {
    ...queuedJob(id),
    status: "succeeded",
    outputs: [
      {
        medium: "image",
        hash: sha256Hex(new Uint8Array([1])),
        width: 8,
        height: 8,
      },
    ],
  };
}

const roots: string[] = [];

export function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "studio-"));
  roots.push(dir);
  return join(dir, "authoring");
}

export function removeTempRoots(): void {
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

const children: ReturnType<typeof Bun.spawn>[] = [];

/** Spawns a real process that opens a session on `root` and records a running job. */
export async function spawnHolder(root: string, jobId: string) {
  const child = Bun.spawn(["bun", "run", HOLDER, root, jobId], {
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(child);
  const decoder = new TextDecoder();
  let seen = "";
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  const deadline = Date.now() + 20_000;
  while (!/READY|BUSY/.test(seen)) {
    if (Date.now() > deadline) throw new Error(`holder timed out: ${seen}`);
    const chunk = await reader.read();
    if (chunk.done) break;
    seen += decoder.decode(chunk.value);
  }
  reader.releaseLock();
  return { child, seen };
}

export async function reapChildren(): Promise<void> {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited;
  }
}

const contentRoot = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "content",
  "greek",
);
const readText = (...parts: string[]) =>
  readFileSync(join(contentRoot, ...parts), "utf8");
const readJson = (...parts: string[]): unknown =>
  JSON.parse(readText(...parts));

function unwrap<T>(result: ParseResult<T>): T {
  if (!result.ok) throw new Error(`${result.path}: ${result.message}`);
  return result.value;
}

/** The authored Greek content, parsed through the production parsers. */
export function loadContent(): StudioContent {
  const vocabulary = unwrap(
    parseAssetVocabulary(readJson("assets", "vocabulary.json")),
  );
  const gods = readdirSync(join(contentRoot, "gods"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => unwrap(parseGodProfile(readJson("gods", f), f)));
  const visuals = unwrap(
    parseGodVisualProfiles(
      readdirSync(join(contentRoot, "assets", "subjects"))
        .sort()
        .map((f) => ({ label: f, value: readJson("assets", "subjects", f) })),
      gods,
      vocabulary.paletteFamilies,
    ),
  );
  const palette = unwrap(
    parsePalette(
      {
        json: readJson("palette", "palette.json"),
        gpl: readText("palette", "master.gpl"),
        hex: readText("palette", "master.hex"),
      },
      vocabulary.paletteFamilies,
    ),
  );
  return { vocabulary, gods, visuals, palette };
}

/** Provisional fixture values for conformance tests: not owner defaults. */
export const PROVISIONAL_TEST_PARAMS: ConformParams = {
  background: { type: "alpha" },
  alphaCutoff: 128,
  grid: { edgeTolerance: 8, minConfidence: 0.6, minEdges: 20 },
};

export const TEST_PALETTE = {
  id: "greek-master",
  family: "olympus",
  digest: null,
  colours: ["#526471", "#8fa6ad", "#c7d8d4", "#f0eee0"],
} as const;

export function testReport(pass: boolean) {
  return pass
    ? ({
        schemaVersion: 1,
        status: "pass",
        checks: [{ check: "grid", status: "pass" }],
      } as const)
    : ({
        schemaVersion: 1,
        status: "fail",
        checks: [{ check: "palette", status: "fail", message: "off palette" }],
      } as const);
}

export function testMetrics(pixelsChanged: number): ConformanceMetrics {
  const grid = {
    scale: 8,
    source: "detected",
    confidence: 1,
    onGridEdges: 40,
    offGridEdges: 0,
    coarserThanCell: false,
  } as const;
  return {
    resize: {
      from: { w: 512, h: 640 },
      to: { w: 64, h: 80 },
      factor: 8,
      detected: true,
      supplied: false,
    },
    grid,
    blendedBlocks: 0,
    keyedPixels: 0,
    alphaChanged: 0,
    coloursBefore: 3,
    coloursAfter: 3,
    coloursMerged: 0,
    iterations: 0,
    colourMap: [{ from: "#010203", to: "#526471", pixels: pixelsChanged }],
    pixelsRecoloured: pixelsChanged,
    pixelsChanged,
  };
}

interface CandidateOptions {
  requestId?: string;
  slotKey?: string;
  ordinal?: number;
  subject?: string;
  kind?: "sprite" | "portrait";
  pass?: boolean;
  pixelsChanged?: number;
}

const candidateBase = (id: string, o: CandidateOptions) => ({
  schemaVersion: 1 as const,
  id,
  source: {
    requestId: o.requestId ?? "r1",
    slotKey: o.slotKey ?? "idle/south",
    ordinal: o.ordinal ?? 0,
  },
  subject: o.subject ?? "zeus",
  kind: o.kind ?? ("sprite" as const),
  input: {
    hash: sha256Hex(new TextEncoder().encode(`input-${id}`)),
    width: 512,
    height: 640,
    decodedSha256: sha256Hex(new TextEncoder().encode(`decoded-${id}`)),
  },
  params: { ...PROVISIONAL_TEST_PARAMS, scale: null },
  target: {
    cell: { id: "god", w: 64, h: 80 },
    pivot: { x: 32, y: 80 },
    palette: { ...TEST_PALETTE, colours: [...TEST_PALETTE.colours] },
  },
});

export function doneCandidate(
  id: string,
  o: CandidateOptions = {},
): CandidateRecord {
  return {
    ...candidateBase(id, o),
    result: {
      status: "done",
      imageHash: sha256Hex(new TextEncoder().encode(`image-${id}`)),
      proposalHash: sha256Hex(new TextEncoder().encode(`proposal-${id}`)),
      report: testReport(o.pass ?? true),
      metrics: testMetrics(o.pixelsChanged ?? 0),
      diff: [{ x: 1, y: 2, before: "#01020304", after: "#526471ff" }],
    },
  };
}

export function needsScaleCandidate(
  id: string,
  o: CandidateOptions = {},
): CandidateRecord {
  return {
    ...candidateBase(id, o),
    result: {
      status: "needs-scale",
      grid: {
        scale: 1,
        source: "detected",
        confidence: 0.2,
        onGridEdges: 3,
        offGridEdges: 12,
        coarserThanCell: false,
      },
      message: "the grid is ambiguous; supply a scale",
    },
  };
}

export function workingSet(
  id: string,
  o: Partial<WorkingSetRecord> & { picks?: Record<string, Keyframe> } = {},
): WorkingSetRecord {
  const required = o.required ?? ["idle/south", "idle/north"];
  const portrait = o.kind === "portrait";
  return {
    schemaVersion: 1,
    id,
    subject: "zeus",
    kind: "sprite",
    sheetRequestId: "r1",
    required,
    limits: Object.fromEntries(
      required.map((slot) => [
        slot,
        portrait ? { min: 1, max: 1 } : { min: 4, max: 4 },
      ]),
    ),
    picks: {},
    frames: {},
    status: "open",
    ...o,
  };
}

const hashText = (text: string) => sha256Hex(new TextEncoder().encode(text));

/** Authored frames for a slot, written by hand into a record. */
export function authoredFrames(
  editId: string,
  count: number,
  o: Partial<AuthoredFrames> = {},
): AuthoredFrames {
  return {
    editId,
    basis: {
      kind: "keyframe",
      candidateId: "job-a",
      imageHash: hashText("image-job-a"),
    },
    sheetHash: hashText(`sheet-${editId}`),
    frames: Array.from({ length: count }, (_, i) => ({
      hash: hashText(`frame-${editId}-${i}`),
      durationMs: 167,
    })),
    pivot: null,
    handEdits: [
      { description: `hand edit ${editId}`, hash: hashText(`sheet-${editId}`) },
    ],
    ...o,
  };
}

/** A keyframe snapshot taken by hand from a done candidate. */
export function keyframe(candidate: CandidateRecord): Keyframe {
  if (candidate.result.status !== "done") throw new Error("not done");
  return {
    candidateId: candidate.id,
    source: candidate.source,
    inputHash: candidate.input.hash,
    decodedSha256: candidate.input.decodedSha256,
    imageHash: candidate.result.imageHash,
    params: candidate.params,
    palette: candidate.target.palette,
    report: candidate.result.report,
  };
}

/** A 64x80 figure on a transparent field, painted only with the olympus palette family. */
export function nativeFigure(content: StudioContent): RgbaImage {
  const ramps =
    content.palette.families.find((f) => f.id === "olympus")?.ramps ?? [];
  const shade = (ramp: number, index: number) =>
    ramps[ramp]?.shades[index] ?? [0, 0, 0];
  const width = 64;
  const height = 80;
  const rgba = new Uint8Array(width * height * 4);
  const paint = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    rgb: readonly number[],
  ) => {
    for (let y = y0; y < y1; y += 1)
      for (let x = x0; x < x1; x += 1)
        rgba.set(
          [rgb[0] as number, rgb[1] as number, rgb[2] as number, 255],
          (y * width + x) * 4,
        );
  };
  paint(27, 14, 37, 24, shade(0, 3));
  paint(24, 24, 40, 56, shade(1, 2));
  paint(26, 56, 32, 72, shade(0, 1));
  paint(32, 56, 38, 72, shade(0, 1));
  paint(24, 30, 40, 34, shade(1, 3));
  return { rgba, width, height };
}

/** Sets the RGB of every fully transparent pixel to a pattern of `variant`; visible pixels are untouched. */
export function withHiddenRgb(image: RgbaImage, variant: number): RgbaImage {
  const rgba = Uint8Array.from(image.rgba);
  for (let at = 0; at < rgba.length; at += 4) {
    if (rgba[at + 3] !== 0) continue;
    const pixel = at / 4;
    rgba[at] = (variant * 37 + pixel) & 255;
    rgba[at + 1] = (variant * 91 + (pixel >> 3)) & 255;
    rgba[at + 2] = (variant * 17 + pixel * 5) & 255;
  }
  return { rgba, width: image.width, height: image.height };
}

export function upscale(image: RgbaImage, factor: number): RgbaImage {
  const width = image.width * factor;
  const height = image.height * factor;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const from =
        (Math.floor(y / factor) * image.width + Math.floor(x / factor)) * 4;
      rgba.set(image.rgba.subarray(from, from + 4), (y * width + x) * 4);
    }
  return { rgba, width, height };
}

export const pngOf = (image: RgbaImage) =>
  encodeRgbaPng(image.rgba, image.width, image.height);

/** Deterministic full-opacity noise: no pixel grid to recover. */
export function noiseImage(width: number, height: number): RgbaImage {
  const rgba = new Uint8Array(width * height * 4);
  let state = 0x9e3779b9;
  for (let at = 0; at < rgba.length; at += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      rgba[at + channel] = (state >>> 0) & 255;
    }
    rgba[at + 3] = 255;
  }
  return { rgba, width, height };
}

/** Records a job's original image the way the runtime does: start, blob, succeed. */
export function succeedWithImage(
  session: StudioSession,
  jobId: string,
  png: Uint8Array,
  size = { w: 512, h: 640 },
) {
  if (!session.start(jobId).ok) throw new Error(`cannot start ${jobId}`);
  const hash = session.store.putBlob(png);
  const done = session.succeed(jobId, [
    { medium: "image", hash, width: size.w, height: size.h },
  ]);
  if (!done.ok) throw new Error(`cannot succeed ${jobId}`);
  return hash;
}

/** A solid-colour frame at the given size, distinguishable by `tone`. */
export function toneFrame(
  cell: { w: number; h: number },
  tone: number,
  hidden = 0,
): RgbaImage {
  const rgba = new Uint8Array(cell.w * cell.h * 4);
  for (let at = 0; at < rgba.length; at += 4) {
    const pixel = at / 4;
    const x = pixel % cell.w;
    const y = Math.floor(pixel / cell.w);
    if (x >= 4 && x < cell.w - 4 && y >= 4 && y < cell.h - 4) {
      rgba.set([82 + tone, 100, 113, 255], at);
    } else if (hidden !== 0) {
      rgba.set([hidden & 255, (hidden * 3) & 255, (hidden * 7) & 255, 0], at);
    }
  }
  return { rgba, width: cell.w, height: cell.h };
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes)
    c = (crcTable[(c ^ byte) & 255] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The same pixels with an extra ancillary tEXt chunk: different bytes, same image. */
export function withAncillaryChunk(png: Uint8Array): Uint8Array {
  const body = new Uint8Array([
    ...new TextEncoder().encode("tEXt"),
    ...new TextEncoder().encode("note\0re-encoded"),
  ]);
  const chunk = new Uint8Array(12 + body.length - 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, body.length - 4);
  chunk.set(body, 4);
  view.setUint32(8 + body.length - 4, crc32(body));
  const at = 8 + 12 + 13;
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, at));
  out.set(chunk, at);
  out.set(png.subarray(at), at + chunk.length);
  return out;
}

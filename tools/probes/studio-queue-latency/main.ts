// Queue keystroke-latency harness (plan U8). It mounts the studio's real
// WorkflowView on a fake host with N queued/running/finished jobs, types into
// the Subject field with real input events, and times each keystroke from the
// dispatch until React has committed and the browser has laid the page out.
// The numbers are for comparing two builds of the view, not absolute.
//
// window.measureKeystrokes({ keystrokes }) -> { jobs, keystrokes, medianMs, p95Ms, maxMs, meanMs, reactRenderMedianMs }
// medianMs is wall time around the dispatch (commit and layout); reactRenderMedianMs is the React Profiler
// time (the build aliases react-dom/client to the profiling build so it reports in production).

import { createElement, Profiler, useEffect, useReducer } from "react";
import { createRoot } from "react-dom/client";
import { createStudioHost } from "../../../apps/studio/src/host/client";
import type { StudioSnapshot } from "../../../apps/studio/src/host/types";
import {
  initialWorkflowState,
  workflowReducer,
} from "../../../apps/studio/src/workflow/model";
import { WorkflowView } from "../../../apps/studio/src/workflow/Workflow";

const JOBS = Number(new URLSearchParams(location.search).get("jobs") ?? "72");

const STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"];

function snapshot(): StudioSnapshot {
  const jobs = Array.from({ length: JOBS }, (_, i) => ({
    id: `zeus-sitting-${String(i).padStart(4, "0")}`,
    requestId: `zeus-sitting-${Math.floor(i / 6)}`,
    slotKey: `idle/${["south", "north", "east", "west", "south-east", "north-west"][i % 6]}`,
    status: STATUSES[i % STATUSES.length],
    candidate: null,
  }));
  return {
    host: { state: "running", lock: "held" },
    status: { idle: false, conformSets: ["standard"] },
    requests: Array.from({ length: Math.ceil(JOBS / 6) }, (_, i) => ({
      id: `zeus-sitting-${i}`,
      subject: "zeus",
    })),
    jobs,
    candidates: jobs
      .filter((job) => job.status === "succeeded")
      .map((job) => ({ id: job.id, requestId: job.requestId, status: "done" })),
    edits: [],
    workingSets: [],
    assets: [],
  } as unknown as StudioSnapshot;
}

/** The Profiler's render time (ms) for every commit: what React spent rendering, memoized rows costing nothing. */
const renders: number[] = [];

const host = createStudioHost({
  invoke: async () => ({}),
  openChannel: () => ({}),
});

function App() {
  const [state, dispatch] = useReducer(
    workflowReducer,
    undefined,
    initialWorkflowState,
  );
  (window as unknown as { push: (s: StudioSnapshot) => void }).push = (s) =>
    dispatch({ type: "snapshot", snapshot: s });
  useEffect(() => dispatch({ type: "snapshot", snapshot: snapshot() }), []);
  return createElement(
    Profiler,
    {
      id: "workflow",
      onRender: (_id, _phase, actualMs) => renders.push(actualMs),
    },
    createElement(WorkflowView, { state, host, dispatch }),
  );
}

const root = document.getElementById("root") as HTMLElement;
createRoot(root).render(createElement(App));

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

(
  window as unknown as { measureKeystrokes: (o: object) => Promise<object> }
).measureKeystrokes = async ({ keystrokes = 60 }: { keystrokes?: number }) => {
  await frame();
  const input = root.querySelector<HTMLInputElement>("input.workflow-control");
  if (!input) throw new Error("no subject field");
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set as (v: string) => void;
  const samples: number[] = [];
  const reactMs: number[] = [];
  let text = "";
  for (let i = 0; i < keystrokes; i += 1) {
    text += "abcdefghij"[i % 10];
    const renderedBefore = renders.length;
    const start = performance.now();
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Force layout so the cost of the commit's DOM changes is inside the sample.
    void document.body.offsetHeight;
    samples.push(performance.now() - start);
    reactMs.push(renders.slice(renderedBefore).reduce((a, b) => a + b, 0));
    await frame();
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[
      Math.min(sorted.length - 1, Math.floor(q * sorted.length))
    ] as number;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    jobs: root.querySelectorAll("li.queue-row").length,
    keystrokes,
    medianMs: round(at(0.5)),
    p95Ms: round(at(0.95)),
    maxMs: round(sorted[sorted.length - 1] as number),
    meanMs: round(samples.reduce((a, b) => a + b, 0) / samples.length),
    reactRenderMedianMs: round(
      [...reactMs].sort((a, b) => a - b)[
        Math.floor(reactMs.length / 2)
      ] as number,
    ),
  };
};

// A poll that brings the same jobs again as fresh objects (what every unchanged
// poll looks like): React's render time for the commit it causes.
(
  window as unknown as { measureSnapshots: (o: object) => Promise<object> }
).measureSnapshots = async ({ polls = 30 }: { polls?: number }) => {
  await frame();
  const push = (window as unknown as { push: (s: StudioSnapshot) => void })
    .push;
  const times: number[] = [];
  for (let i = 0; i < polls; i += 1) {
    const before = renders.length;
    push(snapshot());
    await frame();
    await frame();
    times.push(renders.slice(before).reduce((a, b) => a + b, 0));
  }
  const sorted = [...times].sort((a, b) => a - b);
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    jobs: root.querySelectorAll("li.queue-row").length,
    polls,
    reactRenderMedianMs: round(sorted[Math.floor(sorted.length / 2)] as number),
    reactRenderMaxMs: round(sorted[sorted.length - 1] as number),
  };
};

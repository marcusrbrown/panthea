import { useEffect, useMemo, useRef, useState } from "react";
import { type CheckResult, runChecks } from "./check/run";
import { harnessItems, type OcclusionPair, pickIn } from "./harness/layout";
import { usePreview } from "./harness/usePreview";
import { inTauri } from "./host/tauri";
import { ZOOMS, type Zoom } from "./renderer/preview";
import type { ListingEntry, Selection, SourceKind } from "./source/port";
import { SOURCE_KINDS } from "./source/port";
import { type PreviewSelection, WorkflowApp } from "./workflow/Workflow";

type CheckState =
  | { readonly status: "idle" | "running" }
  | { readonly status: "error"; readonly message: string }
  | CheckResult;

declare global {
  interface Window {
    __studioCheck?: CheckState;
  }
}

const STATES = ["idle", "seated", "walk", "hurt", "down"];
const DIRECTIONS = ["south", "north", "east", "west"];
const EXPRESSIONS = [
  "neutral",
  "pleased",
  "angry",
  "grieving",
  "scheming",
  "awed",
];

const keyOf = (selection: Selection) => `${selection.source}:${selection.id}`;

function parseKey(key: string | null): Selection | undefined {
  if (key === null) return undefined;
  const [source, id] = key.split(":");
  return SOURCE_KINDS.includes(source as SourceKind) && id
    ? { source: source as SourceKind, id }
    : undefined;
}

function readParams() {
  const query = new URLSearchParams(window.location.search);
  const zoom = Number(query.get("zoom"));
  const source = query.get("source");
  return {
    check: query.has("check"),
    forceWebGL: query.get("backend") === "webgl",
    animate: query.get("animate") !== "0" && !query.has("check"),
    zoom: (ZOOMS as readonly number[]).includes(zoom) ? (zoom as Zoom) : 2,
    source: SOURCE_KINDS.includes(source as SourceKind)
      ? (source as SourceKind)
      : ("canon" as SourceKind),
    occlusion:
      query.get("occlusion") === "structure-front"
        ? ("structure-front" as const)
        : ("subject-front" as const),
    subject: query.get("subject"),
    portrait: query.get("portrait"),
  };
}

const describe = (entry: ListingEntry) =>
  `${entry.id}${entry.assetId === entry.id ? "" : ` (${entry.assetId})`}${entry.ok ? "" : " — refused"}`;

export function App() {
  const params = readParams();
  if (params.check || !inTauri()) return <PreviewHarness />;
  return (
    <WorkflowApp
      renderPreview={(selection) => (
        <PreviewHarness compact selection={selection} />
      )}
    />
  );
}

function PreviewHarness({
  compact = false,
  selection,
}: {
  readonly compact?: boolean;
  readonly selection?: PreviewSelection;
}) {
  const selectionSource = selection?.source;
  const selectionId = selection?.id;
  const params = useMemo(() => {
    const base = readParams();
    return selectionSource === undefined || selectionId === undefined
      ? base
      : {
          ...base,
          source: selectionSource,
          subject: `${selectionSource}:${selectionId}`,
        };
  }, [selectionSource, selectionId]);
  const container = useRef<HTMLDivElement | null>(null);
  const handle = usePreview(container, params);
  const { preview, source, listing } = handle;

  const [sourceKind, setSourceKind] = useState<SourceKind>(params.source);
  const [subjectKey, setSubjectKey] = useState(params.subject);
  const [portraitKey, setPortraitKey] = useState(params.portrait);
  const [state, setState] = useState("idle");
  const [direction, setDirection] = useState("south");
  const [expression, setExpression] = useState("neutral");
  const [zoom, setZoom] = useState<Zoom>(params.zoom);
  const [companion, setCompanion] = useState(true);
  const [occlusion, setOcclusion] = useState<OcclusionPair>(params.occlusion);
  const [check, setCheck] = useState<CheckState>({ status: "idle" });
  useEffect(() => {
    if (selectionSource === undefined || selectionId === undefined) return;
    setSourceKind(selectionSource);
    setSubjectKey(`${selectionSource}:${selectionId}`);
  }, [selectionSource, selectionId]);

  const entries = listing?.entries ?? [];
  const sprites = entries.filter(
    (entry) => entry.source === sourceKind && entry.kind === "sprite",
  );
  const portraits = entries.filter(
    (entry) => entry.source === sourceKind && entry.kind === "portrait",
  );
  const subjectChoice = pickIn(sprites, parseKey(subjectKey));
  const portraitChoice = pickIn(portraits, parseKey(portraitKey));
  const subjectChosen = subjectChoice && keyOf(subjectChoice);
  const portraitChosen = portraitChoice && keyOf(portraitChoice);

  useEffect(() => {
    if (params.check || preview === undefined || listing === undefined) return;
    void preview.setItems(
      harnessItems({
        subject: parseKey(subjectChosen ?? null),
        portrait: parseKey(portraitChosen ?? null),
        state,
        direction,
        expression,
        companion,
        occlusion,
      }),
    );
  }, [
    params.check,
    preview,
    listing,
    subjectChosen,
    portraitChosen,
    state,
    direction,
    expression,
    companion,
    occlusion,
  ]);

  useEffect(() => {
    preview?.setZoom(zoom);
  }, [preview, zoom]);

  useEffect(() => {
    if (
      !params.check ||
      handle.status !== "ready" ||
      preview === undefined ||
      source === undefined ||
      listing === undefined
    ) {
      return;
    }
    const cancelled = { current: false };
    const running: CheckState = { status: "running" };
    window.__studioCheck = running;
    setCheck(running);
    runChecks({ preview, source, listing, cancelled }).then(
      (result) => {
        if (cancelled.current) return;
        window.__studioCheck = result;
        setCheck(result);
      },
      (error: unknown) => {
        if (cancelled.current) return;
        const failed: CheckState = {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        };
        window.__studioCheck = failed;
        setCheck(failed);
      },
    );
    return () => {
      cancelled.current = true;
    };
  }, [params.check, handle.status, preview, source, listing]);

  const problems = [...(listing?.problems ?? []), ...handle.problems];

  return (
    <section
      className={
        compact ? "preview-harness preview-compact" : "preview-harness"
      }
      style={{ fontFamily: "monospace", padding: compact ? 0 : 12 }}
    >
      {!compact && <h1 style={{ fontSize: 16 }}>Panthea Studio preview</h1>}
      <p>
        {handle.status === "failed"
          ? `Renderer failed: ${handle.failure}`
          : `Renderer: ${handle.backend ?? "starting"}${params.forceWebGL ? " (WebGL2 forced)" : ""}`}
      </p>
      <fieldset style={{ marginBottom: 8 }}>
        <legend>Controls</legend>
        <label>
          Source{" "}
          <select
            value={sourceKind}
            onChange={(event) => {
              setSourceKind(event.target.value as SourceKind);
              setSubjectKey(null);
              setPortraitKey(null);
            }}
          >
            {SOURCE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind === "draft" ? "draft (not approved)" : kind}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          Sprite{" "}
          <select
            value={subjectChosen ?? ""}
            onChange={(event) => setSubjectKey(event.target.value)}
          >
            {sprites.length === 0 && (
              <option value="">none (placeholder)</option>
            )}
            {sprites.map((entry) => (
              <option key={keyOf(entry)} value={keyOf(entry)}>
                {describe(entry)}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          State{" "}
          <select
            value={state}
            onChange={(event) => setState(event.target.value)}
          >
            {STATES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>{" "}
        <label>
          Direction{" "}
          <select
            value={direction}
            onChange={(event) => setDirection(event.target.value)}
          >
            {DIRECTIONS.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>{" "}
        <label>
          Portrait{" "}
          <select
            value={portraitChosen ?? ""}
            onChange={(event) => setPortraitKey(event.target.value)}
          >
            {portraits.length === 0 && <option value="">none</option>}
            {portraits.map((entry) => (
              <option key={keyOf(entry)} value={keyOf(entry)}>
                {describe(entry)}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          Expression{" "}
          <select
            value={expression}
            onChange={(event) => setExpression(event.target.value)}
          >
            {EXPRESSIONS.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>{" "}
        <fieldset style={{ display: "inline" }}>
          <legend>Zoom</legend>
          {ZOOMS.map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="zoom"
                checked={zoom === value}
                onChange={() => setZoom(value)}
              />
              {value}×{" "}
            </label>
          ))}
        </fieldset>{" "}
        <label>
          Occlusion{" "}
          <select
            value={occlusion}
            onChange={(event) =>
              setOcclusion(event.target.value as OcclusionPair)
            }
          >
            <option value="subject-front">subject in front</option>
            <option value="structure-front">structure in front</option>
          </select>
        </label>{" "}
        <label>
          <input
            type="checkbox"
            checked={companion}
            onChange={(event) => setCompanion(event.target.checked)}
          />
          seated companion
        </label>
      </fieldset>

      <div
        ref={container}
        id="preview"
        style={{
          display: "inline-block",
          background: "#171817",
          imageRendering: "pixelated",
        }}
      />

      <section>
        <h2 style={{ fontSize: 14 }}>Problems ({problems.length})</h2>
        <ul id="problems">
          {problems.map((problem) => (
            <li key={`${problem.scope}|${problem.message}`}>
              {problem.scope}: {problem.message}
            </li>
          ))}
        </ul>
      </section>

      {params.check && (
        <section>
          <h2 style={{ fontSize: 14 }}>Check: {check.status}</h2>
          <pre id="check-result">{JSON.stringify(check, null, 2)}</pre>
        </section>
      )}
    </section>
  );
}

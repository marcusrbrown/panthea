// The packaged inspection fixture's window. It lists the registry snapshot's
// assets, draws an explicitly selected state, direction or expression through
// the shared renderer, and shows the readback checks as text. It reads no
// world state.

import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  type CanonClient,
  type CanonProblem,
  createCanonClient,
  createTauriCanonSource,
} from "../assets/canon";
import type { CheckResult } from "./check";
import { evaluate } from "./check";
import { CHECK_ZOOMS } from "./digest";
import { REFERENCE } from "./expected";
import {
  createInspector,
  type Inspector,
  type Listing,
  type Shown,
} from "./inspector";
import { CheckReport, describeShown } from "./report";
import { defaultSelection, type Selection, selectionLabel } from "./selection";
import "./inspect.css";

export interface InspectViewProps {
  /** Defaults to the shell's canon commands, or none outside the shell. */
  readonly canon?: CanonClient;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function InspectView({ canon: provided }: InspectViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inspectorRef = useRef<Inspector | undefined>(undefined);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const canon = useMemo(
    () =>
      provided ??
      createCanonClient({
        ...(isTauri() ? { source: createTauriCanonSource() } : {}),
        onProblem: (problem: CanonProblem) =>
          setProblems((all) => [
            ...all,
            `${problem.scope}: ${problem.message}`,
          ]),
      }),
    [provided],
  );
  const [listing, setListing] = useState<Listing>();
  const [selection, setSelection] = useState<Selection>();
  const [zoom, setZoom] = useState(2);
  const [shown, setShown] = useState<Shown>();
  const [results, setResults] = useState<readonly CheckResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [backend, setBackend] = useState<string>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let live = true;
    let inspector: Inspector;
    try {
      inspector = createInspector(canvas, { canon });
    } catch (error) {
      setFailure(messageOf(error));
      return;
    }
    inspectorRef.current = inspector;
    void (async () => {
      try {
        await inspector.start(() =>
          setFailure("The graphics device was lost; reload the fixture."),
        );
        const loaded = await inspector.listing();
        if (!live) return;
        setBackend(inspector.backendName);
        setListing(loaded);
        const first = loaded.assets[0];
        if (first) setSelection(defaultSelection(first, undefined));
      } catch (error) {
        if (live) setFailure(messageOf(error));
      }
    })();
    return () => {
      live = false;
      inspectorRef.current = undefined;
      inspector.dispose();
    };
  }, [canon]);

  useEffect(() => {
    const inspector = inspectorRef.current;
    if (!inspector || !selection) return;
    let live = true;
    inspector.setZoom(zoom);
    inspector.show(selection).then(
      (next) => live && setShown(next),
      (error: unknown) => live && setFailure(messageOf(error)),
    );
    return () => {
      live = false;
    };
  }, [selection, zoom]);

  async function runSelected() {
    const inspector = inspectorRef.current;
    if (!inspector || !selection) return;
    setBusy(true);
    try {
      setResults(evaluate(await inspector.measure(selection), REFERENCE));
    } catch (error) {
      setFailure(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function runAll() {
    const inspector = inspectorRef.current;
    if (!inspector) return;
    setBusy(true);
    try {
      setResults((await inspector.runAll()).results);
    } catch (error) {
      setFailure(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  const options = listing?.options;
  const asset = listing?.assets.find((a) => a.assetId === selection?.assetId);

  return (
    <main className="inspect">
      <header>
        <h1>Canon inspection</h1>
        <p>
          Registry root: <strong>{listing?.rootKind ?? "none"}</strong> ·
          Backend: <strong>{backend ?? "starting"}</strong>
        </p>
      </header>
      {failure && (
        <p className="inspect-failure" role="alert">
          {failure}
        </p>
      )}
      <section className="inspect-controls" aria-label="Selection">
        <label>
          Asset
          <select
            value={selection?.assetId ?? ""}
            onChange={(event) => {
              const next = listing?.assets.find(
                (a) => a.assetId === event.target.value,
              );
              if (next) setSelection(defaultSelection(next, undefined));
            }}
          >
            {listing?.assets.map((a) => (
              <option key={a.assetId} value={a.assetId}>
                {a.assetId} ({a.kind})
              </option>
            ))}
          </select>
        </label>
        {selection?.kind === "sprite" && options && (
          <>
            <label>
              State
              <select
                value={selection.state}
                onChange={(event) =>
                  setSelection({ ...selection, state: event.target.value })
                }
              >
                {options.states.map((state) => (
                  <option key={state.id} value={state.id}>
                    {state.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Direction
              <select
                value={selection.direction}
                onChange={(event) =>
                  setSelection({ ...selection, direction: event.target.value })
                }
              >
                {options.directions.map((direction) => (
                  <option key={direction} value={direction}>
                    {direction}
                  </option>
                ))}
              </select>
            </label>
            {options.states.find((state) => state.id === selection.state)
              ?.perAbility && (
              <label>
                Ability
                <input
                  value={selection.ability ?? ""}
                  onChange={(event) =>
                    setSelection({ ...selection, ability: event.target.value })
                  }
                />
              </label>
            )}
          </>
        )}
        {selection?.kind === "portrait" && options && (
          <label>
            Expression
            <select
              value={selection.expression}
              onChange={(event) =>
                setSelection({ ...selection, expression: event.target.value })
              }
            >
              {options.expressions.map((expression) => (
                <option key={expression} value={expression}>
                  {expression}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset>
          <legend>Zoom</legend>
          {CHECK_ZOOMS.map((z) => (
            <button
              key={z}
              type="button"
              aria-pressed={zoom === z}
              onClick={() => setZoom(z)}
            >
              {z}x
            </button>
          ))}
        </fieldset>
      </section>
      <p
        className="inspect-shown"
        data-source={shown?.resolution.source ?? "none"}
      >
        {shown
          ? describeShown(shown)
          : selection
            ? `Loading ${selectionLabel(selection)}…`
            : "Nothing selected."}
        {asset ? ` (revision ${asset.revision.slice(0, 8)})` : ""}
      </p>
      <div className="inspect-stage">
        <canvas ref={canvasRef} aria-label="Inspected asset" />
      </div>
      <section className="inspect-actions">
        <button
          type="button"
          disabled={busy || !selection}
          onClick={() => void runSelected()}
        >
          Check this selection
        </button>
        <button
          type="button"
          disabled={busy || !listing}
          onClick={() => void runAll()}
        >
          Run all checks
        </button>
      </section>
      <CheckReport results={results} />
      {problems.length > 0 && (
        <section className="inspect-problems" aria-label="Registry problems">
          <h2>Registry problems</h2>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

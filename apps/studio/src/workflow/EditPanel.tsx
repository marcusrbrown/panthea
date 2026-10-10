import { useState } from "react";
import type { StudioHost } from "../host/client";
import type { EditReport, SummaryRecord } from "../host/types";
import {
  exportEditFallback,
  finishOutcomeMessage,
  finishReviewedEdit,
  importEditFallback,
} from "./actions";
import { recordText } from "./model";

function editorReasonCopy(reason: string | undefined) {
  switch (reason) {
    case "no-workspace":
      return "No Aseprite workspace for this edit. Use export and import below.";
    case "editor-unavailable":
      return "No editor is configured. Use export and import below.";
    case "launch-failed":
      return "Aseprite didn't start. Use export and import below, or try again.";
    default:
      return "Aseprite didn't open. Export the sheets and bring the edited files back here.";
  }
}

export function EditPanel({
  host,
  edit,
  report,
  editorLaunched,
  editorReason,
  canMutate,
  durationsMs = [],
  onOpen,
  onChange,
  onStale,
}: {
  readonly host: StudioHost;
  readonly edit: SummaryRecord;
  readonly report?: EditReport;
  readonly editorLaunched?: boolean;
  readonly editorReason?: string;
  readonly canMutate: boolean;
  readonly durationsMs?: readonly number[];
  readonly onOpen?: () => void;
  readonly onChange?: (message: string) => void;
  /** The workspace was saved again since the report on screen: refresh it. */
  readonly onStale?: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editId = report?.editId ?? edit.id;
  const editState = recordText(edit, "state") ?? recordText(edit, "status");
  const isOpen = editState === undefined || editState === "open";
  const enabled = canMutate && !busy;

  const finish = async () => {
    if (!confirmed || !report || !enabled) return;
    setBusy(true);
    setError("");
    try {
      const outcome = await finishReviewedEdit(
        host,
        editId,
        report,
        editorLaunched,
      );
      if (outcome.kind === "stale") {
        setError(outcome.message);
        setConfirmed(false);
        onStale?.();
      } else {
        const message = finishOutcomeMessage(outcome);
        if (message) onChange?.(message);
        setConfirmed(false);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!confirmed || !enabled) return;
    setBusy(true);
    setError("");
    try {
      await host.call("discard", { id: editId });
      onChange?.("Edit discarded. The draft was restored.");
      setConfirmed(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const exportEdit = async () => {
    if (!enabled) return;
    setBusy(true);
    setError("");
    try {
      const result = await exportEditFallback(host, editId);
      if (!result.cancelled) onChange?.(`Exported ${result.files.join(", ")}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const importEdit = async () => {
    if (!confirmed || !enabled) return;
    setBusy(true);
    setError("");
    try {
      const result = await importEditFallback(host, editId);
      if (!result.cancelled)
        onChange?.(
          "Imported edit. Review the report-only result and pixel diff before finishing.",
        );
      setConfirmed(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="edit-panel" aria-labelledby="edit-heading">
      <div className="section-heading">
        <span className="step-number">✎</span>
        <div>
          <h3 id="edit-heading">External edit</h3>
          <p>
            {editId} ·{" "}
            {recordText(edit, "state") ?? recordText(edit, "status") ?? "open"}
          </p>
        </div>
      </div>
      {isOpen && editorLaunched === false ? (
        <div className="editor-fallback">
          <strong>Editor unavailable</strong>
          <p>{editorReasonCopy(editorReason)}</p>
          <button
            type="button"
            disabled={!enabled}
            onClick={() => void exportEdit()}
          >
            Export sheets
          </button>
          <button
            type="button"
            disabled={!enabled || !confirmed}
            onClick={() => void importEdit()}
          >
            Import edited sheets
          </button>
        </div>
      ) : isOpen ? (
        <div className="editor-ready">
          <p>
            {editorLaunched
              ? "Aseprite opened this workspace. Save a version to review its report and pixel diff here."
              : "This edit was open when the app loaded. Its saved versions are shown below."}
          </p>
          <button type="button" disabled={!enabled} onClick={onOpen}>
            {editorLaunched ? "Open editor again" : "Open in Aseprite"}
          </button>
        </div>
      ) : null}
      {durationsMs.length > 0 && (
        <p className="frame-timing">
          Frame timing:{" "}
          {durationsMs
            .map((duration, index) => `${index + 1}: ${duration} ms`)
            .join(" · ")}
        </p>
      )}
      {!report && (
        <p className="muted">
          Waiting for the report-only check for this edit.
        </p>
      )}
      {report && (
        <div className="edit-report">
          <h4>Saved version · Report only · {report.state}</h4>
          {report.slots.map((slot) => (
            <section className="edit-slot" key={slot.slot}>
              <h5>{slot.slot}</h5>
              <p className="slot-diff">
                Diff against{" "}
                {slot.diffAgainst === "recorded"
                  ? "the recorded version"
                  : "unavailable"}
                .
              </p>
              {slot.addedFrames.map((index) => (
                <p className="frame-change" key={`added:${index}`}>
                  Frame {index + 1} added.
                </p>
              ))}
              {slot.removedFrames.map((index) => (
                <p className="frame-change" key={`removed:${index}`}>
                  Frame {index + 1} removed.
                </p>
              ))}
              {slot.frames.map((frame) => (
                <article
                  className="edit-frame"
                  key={`${slot.slot}:${frame.index}`}
                >
                  <div className="edit-frame-heading">
                    <strong>Frame {frame.index + 1}</strong>
                    <span className={`state-label state-${frame.report}`}>
                      {frame.report}
                    </span>
                  </div>
                  <p>
                    Pixel change:{" "}
                    {frame.change === "unavailable"
                      ? "unavailable"
                      : frame.change}{" "}
                    ·{" "}
                    {frame.pixelsChanged === null
                      ? "count unavailable"
                      : `${frame.pixelsChanged} pixels changed`}
                  </p>
                  {frame.failedChecks.length > 0 && (
                    <ul className="report-failures">
                      {frame.failedChecks.map((check) => (
                        <li key={check}>{check}</li>
                      ))}
                    </ul>
                  )}
                  {frame.diff && frame.diff.length > 0 && (
                    <details>
                      <summary>
                        Pixel diff ({frame.diff.length} entries)
                      </summary>
                      <pre>
                        {frame.diff
                          .map((change) => detailDiff(change))
                          .join("\n")}
                      </pre>
                    </details>
                  )}
                </article>
              ))}
            </section>
          ))}
        </div>
      )}
      {isOpen && (
        <>
          <label className="edit-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!canMutate}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {editorLaunched === false && !report
              ? "I confirm importing this version to review."
              : "I reviewed this pixel diff before changing the draft."}
          </label>
          <div className="edit-actions">
            <button
              type="button"
              className="primary"
              disabled={!enabled || !confirmed || !report}
              onClick={() => void finish()}
            >
              Finish and keep
            </button>
            <button
              type="button"
              disabled={!enabled || !confirmed}
              onClick={() => void discard()}
            >
              Discard edit
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="gate-reason" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function detailDiff(value: unknown) {
  if (typeof value !== "object" || value === null) return String(value);
  const item = value as Record<string, unknown>;
  const coords = [item.x, item.y].every((part) => typeof part === "number")
    ? `x: ${item.x}, y: ${item.y}`
    : "pixel";
  return `${coords} · ${JSON.stringify(value)}`;
}

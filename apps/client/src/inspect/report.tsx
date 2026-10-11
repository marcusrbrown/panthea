import { type CheckResult, summarize } from "./check";
import type { Shown } from "./inspector";
import { selectionLabel } from "./selection";

/** One line saying what is on show, and whether it is canon or the placeholder. */
export function describeShown(shown: Shown): string {
  const { resolution, selection } = shown;
  if (resolution.source === "placeholder") {
    return `PLACEHOLDER (${resolution.reason}): ${selectionLabel(selection)} is not published; the shared placeholder is drawn`;
  }
  return `CANON: ${selectionLabel(selection)}, ${resolution.frames.length} frames, atlas ${resolution.atlas.blob}`;
}

/** The checks as text: PASS or FAIL, the label, and what was compared. */
export function CheckReport({ results }: { results: readonly CheckResult[] }) {
  const { passed, failed, ok } = summarize(results);
  const status = results.length === 0 ? "none" : ok ? "pass" : "fail";
  return (
    <section
      className="inspect-report"
      data-status={status}
      aria-label="Checks"
    >
      <p className="inspect-summary" role="status">
        {results.length === 0
          ? "No checks have run."
          : `${passed} passed, ${failed} failed`}
      </p>
      <ul>
        {results.map((result) => (
          <li key={result.id} data-status={result.ok ? "pass" : "fail"}>
            <strong>{result.ok ? "PASS" : "FAIL"}</strong> {result.label}
            {result.detail === "" ? null : <small> — {result.detail}</small>}
          </li>
        ))}
      </ul>
    </section>
  );
}

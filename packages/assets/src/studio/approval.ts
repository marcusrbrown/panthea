// The publication-terms gate for canon. It is a compatibility check against
// the owner's decision that canon redistributes under MIT-compatible terms,
// not a legal clearance and not a list of approved sources. Drafts,
// generation, editing and import never consult it.

import {
  canonicalJson,
  type LicenceRecord,
  type Sha256,
} from "@panthea/contracts";
import type { LicenceAssessment, LicenceReviewEntry } from "./workspace";

export interface KnownTerms {
  readonly status: "compatible" | "incompatible";
  readonly reason: string;
}

const COMPATIBLE = new Set(["MIT", "Apache-2.0", "CC0-1.0"]);
// The standard Creative Commons identifiers whose terms forbid commercial use
// or derivatives: exact SPDX ids, so an invented version stays unknown.
const NON_COMMERCIAL_OR_NO_DERIVATIVES = new Set([
  "CC-BY-NC-1.0",
  "CC-BY-NC-2.0",
  "CC-BY-NC-2.5",
  "CC-BY-NC-3.0",
  "CC-BY-NC-4.0",
  "CC-BY-NC-ND-1.0",
  "CC-BY-NC-ND-2.0",
  "CC-BY-NC-ND-2.5",
  "CC-BY-NC-ND-3.0",
  "CC-BY-NC-ND-3.0-DE",
  "CC-BY-NC-ND-3.0-IGO",
  "CC-BY-NC-ND-4.0",
  "CC-BY-NC-SA-1.0",
  "CC-BY-NC-SA-2.0",
  "CC-BY-NC-SA-2.0-DE",
  "CC-BY-NC-SA-2.0-FR",
  "CC-BY-NC-SA-2.0-UK",
  "CC-BY-NC-SA-2.5",
  "CC-BY-NC-SA-3.0",
  "CC-BY-NC-SA-3.0-DE",
  "CC-BY-NC-SA-3.0-IGO",
  "CC-BY-NC-SA-4.0",
  "CC-BY-ND-1.0",
  "CC-BY-ND-2.0",
  "CC-BY-ND-2.5",
  "CC-BY-ND-3.0",
  "CC-BY-ND-3.0-DE",
  "CC-BY-ND-4.0",
]);

// An explicit publication prohibition is a whole clause of the terms, not words
// that appear in them: "Never canon, never publication." is one; a clause that
// quotes, negates or merely contains those words is free text.
const PROHIBITION_CLAUSES = new Set([
  "never canon",
  "never publication",
  "never canon, never publication",
]);

const forbidsPublication = (licence: string): boolean =>
  licence
    .split(/[.;\n]/)
    .map((clause) => clause.replace(/\s+/g, " ").trim().toLowerCase())
    .some((clause) => PROHIBITION_CLAUSES.has(clause));

/** What the studio decides by the terms alone, for any subject and role; undefined when the terms are not known. */
export function knownTerms(record: LicenceRecord): KnownTerms | undefined {
  const { licence } = record;
  if (forbidsPublication(licence))
    return {
      status: "incompatible",
      reason: "the recorded terms forbid canon or publication",
    };
  if (NON_COMMERCIAL_OR_NO_DERIVATIVES.has(licence))
    return {
      status: "incompatible",
      reason: `${licence} does not allow MIT-compatible redistribution`,
    };
  if (COMPATIBLE.has(licence))
    return {
      status: "compatible",
      reason: `${licence} is MIT-compatible`,
    };
  return undefined;
}

const sameRecord = (a: LicenceRecord, b: LicenceRecord) =>
  canonicalJson(a) === canonicalJson(b);

/** One entry per licence record of the manifest, bound to that manifest's revision. */
export function reviewLicences(
  licences: readonly LicenceRecord[],
  assessments: readonly LicenceAssessment[],
  manifestRevision: Sha256,
): { manifestRevision: Sha256; entries: LicenceReviewEntry[] } {
  return {
    manifestRevision,
    entries: licences.map((record): LicenceReviewEntry => {
      const base = { subject: record.subject, role: record.role };
      const known = knownTerms(record);
      if (known !== undefined)
        return { ...base, source: "pinned-terms", ...known };
      const assessed = assessments.find((a) => sameRecord(a.record, record));
      if (assessed !== undefined)
        return {
          ...base,
          source: "owner-assessment",
          status:
            assessed.disposition === "mit-compatible"
              ? "compatible"
              : "incompatible",
          reason: assessed.reason,
        };
      return {
        ...base,
        source: "none",
        status: "unclear",
        reason: "the terms are not known and the owner has not assessed them",
      };
    }),
  };
}

export type Checked<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

/** Assessments are only for records the manifest carries and the studio cannot decide, one each, with a reason. */
export function checkAssessments(
  licences: readonly LicenceRecord[],
  assessments: readonly LicenceAssessment[],
): Checked<true> {
  const seen: LicenceRecord[] = [];
  for (const { record, reason } of assessments) {
    const label = `${record.role} "${record.subject}" (${record.licence})`;
    if (!licences.some((l) => sameRecord(l, record)))
      return {
        ok: false,
        message: `the manifest carries no licence record for the assessed ${label}`,
      };
    if (seen.some((s) => sameRecord(s, record)))
      return { ok: false, message: `${label} is assessed twice` };
    seen.push(record);
    if (knownTerms(record) !== undefined)
      return {
        ok: false,
        message: `the terms of ${label} are decided by the studio and cannot be assessed`,
      };
    if (reason.trim() === "")
      return {
        ok: false,
        message: `the assessment of ${label} needs a reason`,
      };
  }
  return { ok: true, value: true };
}

/** Why canon cannot take these licences, naming each blocked or unclear record; undefined when all are compatible. */
export function licenceBlock(
  entries: readonly LicenceReviewEntry[],
): string | undefined {
  const blocked = entries.filter((entry) => entry.status !== "compatible");
  if (blocked.length === 0) return undefined;
  return blocked
    .map(
      (entry) =>
        `${entry.role} "${entry.subject}" is ${entry.status}: ${entry.reason}`,
    )
    .join("; ");
}

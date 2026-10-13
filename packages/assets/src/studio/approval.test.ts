import { describe, expect, test } from "bun:test";
import {
  LICENCE_ROLES,
  type LicenceRecord,
  type Sha256,
} from "@panthea/contracts";
import { sha256Hex } from "../hash";
import {
  checkAssessments,
  knownTerms,
  licenceBlock,
  reviewLicences,
} from "./approval";
import type { LicenceAssessment } from "./workspace";

const revision = sha256Hex(new Uint8Array([1])) as Sha256;
const record = (
  licence: string,
  role: LicenceRecord["role"] = "input",
  subject = "thing",
): LicenceRecord => ({ subject, role, licence });
const assessment = (
  licence: LicenceRecord,
  disposition: LicenceAssessment["disposition"] = "mit-compatible",
  reason = "the owner read the terms",
): LicenceAssessment => ({ record: licence, disposition, reason });

describe("terms the studio knows", () => {
  for (const licence of ["MIT", "Apache-2.0", "CC0-1.0"])
    for (const role of LICENCE_ROLES)
      test(`${licence} is MIT-compatible for a ${role}`, () => {
        expect(knownTerms(record(licence, role))?.status).toBe("compatible");
      });

  for (const licence of [
    "CC-BY-NC-4.0",
    "CC-BY-NC-3.0",
    "CC-BY-NC-SA-4.0",
    "CC-BY-NC-ND-4.0",
    "CC-BY-ND-4.0",
  ])
    for (const role of ["input", "original-work", "model"] as const)
      test(`${licence} is incompatible for a ${role}`, () => {
        expect(knownTerms(record(licence, role))?.status).toBe("incompatible");
      });

  test("an explicit prohibition on canon or publication is incompatible for any subject and role", () => {
    const terms =
      "Civitai custom terms; owner approved benchmark ONLY. Never canon, never publication.";
    for (const role of LICENCE_ROLES)
      expect(knownTerms(record(terms, role))?.status).toBe("incompatible");
    expect(
      knownTerms(record("Never publication", "original-work"))?.status,
    ).toBe("incompatible");
  });

  test("the benchmark restriction as recorded for the Civitai LoRA is incompatible for any subject and role", () => {
    const recorded =
      "Civitai custom terms; owner approved benchmark ONLY (model 1770073 / version 2454660 / file 2344890). Never canon, never publication.";
    for (const role of LICENCE_ROLES)
      for (const subject of ["pixel-lora", "anything-else", "mine"])
        expect(knownTerms(record(recorded, role, subject))?.status).toBe(
          "incompatible",
        );
  });

  test("an explicit standalone clause is recognised however it is cased, spaced or punctuated", () => {
    for (const licence of [
      "Never canon",
      "never publication",
      "Never canon, never publication",
      "NEVER   CANON,   NEVER   PUBLICATION.",
      "Never canon; never publication",
      "Custom terms. Never canon.",
      "Custom terms; never publication",
      "Custom terms\nNever canon, never publication.",
    ])
      expect(knownTerms(record(licence))?.status, licence).toBe("incompatible");
  });

  test("a free-text term that merely mentions or quotes the words stays unknown, and takes an explicit assessment", () => {
    const mentions = [
      'Custom terms; the obsolete clause "never canon" was dropped in v2',
      "Custom terms. The old line 'Never canon, never publication' no longer applies.",
      "Formerly never canon, now redistributable under owner terms",
      "never canonical use is discouraged",
      "Never publication-ready without review",
      "Not a never canon licence",
      "'Never canon'",
      "Custom terms (never canon was a draft clause)",
    ];
    for (const licence of mentions) {
      const custom = record(licence, "input", "texture");
      expect(knownTerms(custom), licence).toBeUndefined();
      const none = reviewLicences([custom], [], revision).entries[0];
      const assessed = reviewLicences([custom], [assessment(custom)], revision)
        .entries[0];
      expect(none, licence).toMatchObject({
        source: "none",
        status: "unclear",
      });
      expect(assessed, licence).toMatchObject({
        source: "owner-assessment",
        status: "compatible",
      });
      expect(checkAssessments([custom], [assessment(custom)]).ok, licence).toBe(
        true,
      );
    }
  });

  test("only the standard Creative Commons NC and ND identifiers are known; invented versions are unknown", () => {
    for (const licence of [
      "CC-BY-NC-1.0",
      "CC-BY-NC-2.5",
      "CC-BY-NC-SA-3.0",
      "CC-BY-NC-ND-3.0-IGO",
      "CC-BY-ND-2.0",
      "CC-BY-NC-SA-4.0",
    ])
      expect(knownTerms(record(licence))?.status, licence).toBe("incompatible");
    for (const licence of [
      "CC-BY-NC-9.9",
      "CC-BY-NC-SA-0.1",
      "CC-BY-ND-5.0",
      "CC-BY-NC-ND-4.0-FAKE",
      "CC-BY-NC-XX-4.0",
      "cc-by-nc-4.0",
    ])
      expect(knownTerms(record(licence)), licence).toBeUndefined();
  });

  test("anything else is unknown, including near-misses of known identifiers", () => {
    for (const licence of [
      "fixture",
      "Custom terms",
      "mit",
      "MIT-0",
      "Apache-2.0 with exceptions",
      "CC-BY-4.0",
      "CC-BY-SA-4.0",
      "GPL-3.0",
      "",
    ])
      expect(knownTerms(record(licence)), licence).toBeUndefined();
  });
});

describe("the licence review of a manifest", () => {
  test("known terms are decided by the pinned terms alone and carry the manifest revision", () => {
    const review = reviewLicences(
      [
        record("MIT", "runtime", "sd"),
        record("CC-BY-NC-4.0", "input", "photo"),
      ],
      [],
      revision,
    );

    expect(review.manifestRevision).toBe(revision);
    expect(
      review.entries.map((e) => [e.subject, e.role, e.source, e.status]),
    ).toEqual([
      ["sd", "runtime", "pinned-terms", "compatible"],
      ["photo", "input", "pinned-terms", "incompatible"],
    ]);
    expect(review.entries.every((e) => e.reason.length > 0)).toBe(true);
  });

  test("unknown terms are unclear until the owner assesses that exact record", () => {
    const custom = record("Custom terms", "input", "texture");
    const other = record("Custom terms", "input", "other");

    const none = reviewLicences([custom], [], revision);
    const compatible = reviewLicences([custom], [assessment(custom)], revision);
    const incompatible = reviewLicences(
      [custom],
      [assessment(custom, "incompatible", "no redistribution")],
      revision,
    );
    const wrongRecord = reviewLicences([custom], [assessment(other)], revision);

    expect(none.entries[0]).toMatchObject({
      source: "none",
      status: "unclear",
    });
    expect(compatible.entries[0]).toMatchObject({
      source: "owner-assessment",
      status: "compatible",
      reason: "the owner read the terms",
    });
    expect(incompatible.entries[0]).toMatchObject({
      source: "owner-assessment",
      status: "incompatible",
      reason: "no redistribution",
    });
    expect(wrongRecord.entries[0]).toMatchObject({
      source: "none",
      status: "unclear",
    });
  });

  test("an attribution difference makes it a different record for an assessment", () => {
    const plain = record("Custom terms");
    const credited = { ...plain, attribution: "by someone" };

    const review = reviewLicences([credited], [assessment(plain)], revision);

    expect(review.entries[0]?.status).toBe("unclear");
  });

  test("an assessment never overrides known terms in either direction", () => {
    const nc = record("CC-BY-NC-4.0", "original-work", "mine");
    const mit = record("MIT", "model", "m");
    const review = reviewLicences(
      [nc, mit],
      [assessment(nc), assessment(mit, "incompatible", "x")],
      revision,
    );

    expect(review.entries.map((e) => [e.source, e.status])).toEqual([
      ["pinned-terms", "incompatible"],
      ["pinned-terms", "compatible"],
    ]);
  });

  test("a blocked or unclear entry yields a refusal message that names it; all compatible yields none", () => {
    const custom = record("Custom terms", "input", "texture");
    const nc = record("CC-BY-NC-4.0", "original-work", "mine");

    expect(
      licenceBlock(reviewLicences([record("MIT")], [], revision).entries),
    ).toBeUndefined();
    expect(
      licenceBlock(reviewLicences([custom], [], revision).entries),
    ).toMatch(/texture.*unclear/s);
    expect(licenceBlock(reviewLicences([nc], [], revision).entries)).toMatch(
      /mine.*incompatible/s,
    );
  });
});

describe("assessments the owner may record", () => {
  const custom = record("Custom terms", "input", "texture");

  test("an assessment of a record the manifest carries and the studio does not know is accepted", () => {
    expect(checkAssessments([custom], [assessment(custom)]).ok).toBe(true);
    expect(checkAssessments([custom], []).ok).toBe(true);
  });

  test("an assessment of a record the manifest does not carry is refused", () => {
    expect(checkAssessments([record("MIT")], [assessment(custom)]).ok).toBe(
      false,
    );
  });

  test("two assessments of the same record are refused", () => {
    const result = checkAssessments(
      [custom],
      [assessment(custom), assessment(custom, "incompatible", "again")],
    );
    expect(result).toMatchObject({ ok: false });
  });

  test("an assessment of terms the studio already decides is refused, compatible or not", () => {
    for (const known of [
      record("MIT"),
      record("CC0-1.0", "input"),
      record("CC-BY-NC-4.0", "original-work"),
      record("Never canon, never publication", "model"),
    ])
      expect(
        checkAssessments([known], [assessment(known)]).ok,
        known.licence,
      ).toBe(false);
  });

  test("an assessment needs a reason", () => {
    expect(
      checkAssessments([custom], [assessment(custom, "mit-compatible", "  ")])
        .ok,
    ).toBe(false);
  });
});

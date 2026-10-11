---
title: "Keep test support out of production source, guarded by an import scan"
date: 2026-10-10
module: workspace
problem_type: convention
component: testing_framework
severity: low
applies_when:
  - "Adding a test helper, fixture or test-only holder under apps/, packages/ or tools/"
  - "Adding a package or subpath that only tests depend on"
  - "Creating any new source file"
tags: [test-support, testkit, guard-test, devdependency, fixtures, file-naming, workspace-layout, convention]
---

# Keep test support out of production source, guarded by an import scan

## Context

Test helpers had been landing inside production source as underscore-prefixed files (`_test-*.ts`, `_testkit.ts`). Nothing prevented production code from importing them, and nothing proved they stayed out of builds.

## Guidance

- **No new source file starts with an underscore.**
- **Helpers for one app go in that app's `test/` directory, outside `src`.** `apps/client/test/` holds that app's fixtures. The app's `tsconfig.json` includes `test`, so the helpers typecheck. Vite bundles only what `index.html` reaches, so they never ship.
- **Helpers shared across workspaces go in the private `@panthea/testkit` package**, listed only in `devDependencies`. It has narrow subpaths (`/world`, `/renderer`) so a test loads only what it needs. A production package never exports a testing subpath.
- **A guard test enforces the boundary** (`packages/testkit/src/guard.test.ts:27-33`):

  ```ts
    test("no production source in the repo imports @panthea/testkit", () => {
      expect(findTestkitImports(repoRoot)).toEqual([]);
    });

    test("no production source under apps/client/src imports apps/client/test", () => {
      expect(findClientTestImports(repoRoot)).toEqual([]);
    });
  ```

  Positive controls in the same file build temporary trees. They prove that every import form is caught (static, re-export, dynamic, bare and `require`), and that test files, `test/` directories, comments and plain strings are not flagged.

## Why This Matters

Only the guard keeps a helper out of a production bundle; the directory and devDependency do not. The client guard covers only `apps/client/src`. Nothing automated enforces the underscore rule, so review does.

Known exceptions that predate the rule: `apps/simulation/src/_test-lock-holder.ts`, `apps/studio/src/host/_testkit.ts`, `apps/studio/src/source/_testkit.ts`, `packages/assets/src/studio/_test-{fixtures,holder,preview,runtime}.ts` and `tools/studio/src/_testkit.ts`.

## Related

- [The first canon publish broke the asset validator tests](../test-failures/canon-registry-polluted-validator-fixtures-2026-10-08.md)
- [Headless scenarios need a positive control per negative claim](end-to-end-scenario-with-positive-controls-2026-09-28.md)

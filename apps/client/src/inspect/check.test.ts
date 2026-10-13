import { expect, test } from "bun:test";

import { globalChecks, summarize } from "./check";

test("the root kind passes only when it is bundled, and says what it was", () => {
  const check = (rootKind: "repo" | "bundled" | undefined) =>
    globalChecks({
      rootKind,
      backendName: "webgl2",
      webGpuPresent: false,
    }).find((result) => result.id === "root-kind");

  expect(check("bundled")).toMatchObject({ ok: true, detail: "bundled" });
  expect(check("repo")).toMatchObject({ ok: false, detail: "repo" });
  expect(check(undefined)).toMatchObject({ ok: false, detail: "none" });
});

test("the backend check passes only for WebGL2, and reports whether navigator.gpu exists", () => {
  const check = (backendName: string | undefined, webGpuPresent: boolean) =>
    globalChecks({ rootKind: "bundled", backendName, webGpuPresent }).find(
      (result) => result.id === "backend",
    );

  expect(check("webgl2", false)).toMatchObject({
    ok: true,
    detail: "webgl2; navigator.gpu absent",
  });
  expect(check("webgpu", true)).toMatchObject({
    ok: false,
    detail: "webgpu; navigator.gpu present",
  });
  expect(check(undefined, false)).toMatchObject({ ok: false });
});

test("a summary counts passes and failures", () => {
  const results = [
    { id: "a", label: "a", ok: true, detail: "" },
    { id: "b", label: "b", ok: false, detail: "" },
    { id: "c", label: "c", ok: true, detail: "" },
  ];

  expect(summarize(results)).toEqual({ passed: 2, failed: 1, ok: false });
  expect(summarize(results.filter((r) => r.ok))).toEqual({
    passed: 2,
    failed: 0,
    ok: true,
  });
  expect(summarize([])).toEqual({ passed: 0, failed: 0, ok: false });
});

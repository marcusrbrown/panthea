import { expect, test } from "bun:test";

import { isInspectChord, isInspectRoute } from "./route";

test("?inspect=1 and #inspect select the inspection fixture, nothing else does", () => {
  expect(isInspectRoute("?inspect=1", "")).toBe(true);
  expect(isInspectRoute("?a=b&inspect=1", "")).toBe(true);
  expect(isInspectRoute("", "#inspect")).toBe(true);
  expect(isInspectRoute("", "")).toBe(false);
  expect(isInspectRoute("?inspect=0", "")).toBe(false);
  expect(isInspectRoute("?fixture=1", "#other")).toBe(false);
  expect(isInspectRoute("?inspect", "")).toBe(false);
});

test("Alt+Shift+I is the in-app way to the fixture, and no other chord is", () => {
  const press = (over: Partial<Parameters<typeof isInspectChord>[0]>) =>
    isInspectChord({
      code: "KeyI",
      altKey: true,
      shiftKey: true,
      ctrlKey: false,
      metaKey: false,
      ...over,
    });

  expect(press({})).toBe(true);
  expect(press({ altKey: false })).toBe(false);
  expect(press({ shiftKey: false })).toBe(false);
  expect(press({ ctrlKey: true })).toBe(false);
  expect(press({ metaKey: true })).toBe(false);
  expect(press({ code: "KeyJ" })).toBe(false);
});

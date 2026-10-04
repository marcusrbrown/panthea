import { expect, test } from "bun:test";
import type { Capture } from "./capture";
import { diff } from "./compare-contexts";

const cap = (instructions: string, prompt: string): Capture => ({
  tick: 1,
  god: "zeus",
  instructions,
  prompt,
  schema: {},
});

test("the same lines in another order, or moved from the system text to the user text, are the same lines", () => {
  expect(diff(cap("a\nb\nc", "d\ne"), cap("c\na", "e\nd\nb"))).toEqual({
    onlyBefore: [],
    onlyAfter: [],
  });
});

test("a line that was dropped, one that was added, and one repeated a different number of times are all differences", () => {
  expect(diff(cap("a\nb", "c"), cap("a", "c"))).toEqual({
    onlyBefore: ["b"],
    onlyAfter: [],
  });
  expect(diff(cap("a", "c"), cap("a\nz", "c"))).toEqual({
    onlyBefore: [],
    onlyAfter: ["z"],
  });
  expect(diff(cap("a\na", ""), cap("a", ""))).toEqual({
    onlyBefore: ["a"],
    onlyAfter: [],
  });
  // Blank lines are layout, not content.
  expect(diff(cap("a\n\nb", ""), cap("a\nb", ""))).toEqual({
    onlyBefore: [],
    onlyAfter: [],
  });
});

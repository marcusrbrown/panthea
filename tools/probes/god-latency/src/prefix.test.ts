import { expect, test } from "bun:test";
import {
  commonPrefixLength,
  reusable,
  rotationReuse,
  sharedPrefixLength,
  sharedPrefixLines,
} from "./prefix";

test("the common start of two strings is as long as they agree, and no longer", () => {
  expect(commonPrefixLength("abcdef", "abcxyz")).toBe(3);
  expect(commonPrefixLength("abc", "abcdef")).toBe(3);
  expect(commonPrefixLength("", "abc")).toBe(0);
  expect(commonPrefixLength("same", "same")).toBe(4);
  expect(commonPrefixLength("xbc", "abc")).toBe(0);
});

test("the shared start of several is the shortest of the pairwise starts, and an empty list shares nothing", () => {
  expect(sharedPrefixLength(["abcd", "abxx", "abcz"])).toBe(2);
  expect(sharedPrefixLength(["abcd"])).toBe(4);
  expect(sharedPrefixLength([])).toBe(0);
  expect(sharedPrefixLength(["abc", "xyz", "abc"])).toBe(0);
});

test("the shared lines stop at the last whole line: half a line two texts happen to agree on is not a shared line", () => {
  expect(sharedPrefixLines(["one\ntwo\nthree", "one\ntwo\ntheft"])).toBe(
    "one\ntwo\n",
  );
  expect(sharedPrefixLines(["one\ntwo", "one\ntwo"])).toBe("one\n");
  expect(sharedPrefixLines(["alpha", "alphabet"])).toBe("");
});

test("reuse is measured against the request that follows: how much of it a server holding the previous one could skip", () => {
  expect(reusable("abcdef", "abcxyzzz")).toEqual({ chars: 3, share: 3 / 8 });
  expect(rotationReuse(["aaa1", "aaa2", "bbb"]).map((r) => r.chars)).toEqual([
    3, 0,
  ]);
  expect(rotationReuse(["only"])).toEqual([]);
});

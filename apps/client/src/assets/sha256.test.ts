import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { sha256Hex } from "./sha256";

const reference = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

test("matches the standard test vectors", () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  expect(sha256Hex(encode(""))).toBe(
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  expect(sha256Hex(encode("abc"))).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("agrees with node:crypto at every padding boundary", () => {
  for (let length = 0; length <= 130; length += 1) {
    const bytes = new Uint8Array(length).map(
      (_, index) => (index * 7 + 3) % 256,
    );
    expect(sha256Hex(bytes)).toBe(reference(bytes));
  }
});

test("hashes multi-byte text as its UTF-8 bytes", () => {
  const bytes = new TextEncoder().encode("Ζεύς — 雷");
  expect(sha256Hex(bytes)).toBe(reference(bytes));
});

// Periodic value noise for the tile stamper: exact repeats, a bounded range, and no engine-dependent maths.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hash2 } from "../effects/random";
import { periodicValueNoise } from "./lattice-noise";

const N = 4;
const dyadic = (k: number) => k / 16;

describe("periodicValueNoise", () => {
  it("repeats every N along both axes, to the bit, on dyadic inputs", () => {
    for (let ku = -40; ku <= 40; ku += 3) {
      for (let kv = -40; kv <= 40; kv += 5) {
        const u = dyadic(ku);
        const v = dyadic(kv);
        const here = periodicValueNoise(7, u, v, N);
        expect(periodicValueNoise(7, u + N, v, N), `u+N at ${ku},${kv}`).toBe(
          here,
        );
        expect(periodicValueNoise(7, u, v + N, N), `v+N at ${ku},${kv}`).toBe(
          here,
        );
        expect(periodicValueNoise(7, u - 3 * N, v + 2 * N, N)).toBe(here);
      }
    }
  });

  it("is the node's hash at an integer point, wrapped mod N", () => {
    for (let x = -6; x <= 6; x += 1)
      for (let y = -6; y <= 6; y += 1) {
        const wrap = (i: number) => ((i % N) + N) % N;
        expect(periodicValueNoise(3, x, y, N)).toBe(hash2(3, wrap(x), wrap(y)));
      }
  });

  it("stays in [0, 1) and is smooth: a step of 1/16 moves it by little", () => {
    let largest = 0;
    for (let ku = 0; ku < 16 * N; ku += 1)
      for (let kv = 0; kv < 16 * N; kv += 1) {
        const n = periodicValueNoise(11, dyadic(ku), dyadic(kv), N);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(1);
        largest = Math.max(
          largest,
          Math.abs(n - periodicValueNoise(11, dyadic(ku + 1), dyadic(kv), N)),
        );
      }
    expect(largest).toBeLessThan(0.15);
  });

  it("depends on the seed and on the period", () => {
    expect(periodicValueNoise(1, 0.5, 0.5, N)).not.toBe(
      periodicValueNoise(2, 0.5, 0.5, N),
    );
    expect(periodicValueNoise(1, 2.5, 0.5, 2)).toBe(
      periodicValueNoise(1, 0.5, 0.5, 2),
    );
  });

  it("uses only exact operations: no Math.sin, cos, pow or random in its source", () => {
    const source = readFileSync(
      join(import.meta.dir, "lattice-noise.ts"),
      "utf8",
    );
    for (const banned of [
      "Math.sin",
      "Math.cos",
      "Math.pow",
      "Math.random",
      " ** ",
    ])
      expect(source.includes(banned), banned).toBe(false);
  });
});

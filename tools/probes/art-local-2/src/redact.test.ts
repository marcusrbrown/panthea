// Committed evidence must not carry private absolute paths.

import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { redactPrivatePaths } from "./redact";

describe("redactPrivatePaths", () => {
  it("replaces explicit prefixes (longest first) with their labels, deeply", () => {
    const out = redactPrivatePaths(
      {
        a: "/Volumes/ssd/models/flux/x.gguf",
        b: [
          "/Volumes/ssd/models",
          { c: "cmd --model /Volumes/ssd/models/y.bin --other" },
        ],
        n: 3,
        ok: true,
        nothing: null,
      },
      [
        { prefix: "/Volumes/ssd", label: "<ssd>" },
        { prefix: "/Volumes/ssd/models", label: "<models>" },
      ],
    );
    expect(out).toEqual({
      a: "<models>/flux/x.gguf",
      b: ["<models>", { c: "cmd --model <models>/y.bin --other" }],
      n: 3,
      ok: true,
      nothing: null,
    });
  });

  it("replaces the user's home directory and generic home-like paths", () => {
    const out = redactPrivatePaths({
      mine: `${homedir()}/work/x`,
      other: "/Users/someone-else/Documents/a.png and /home/bob/b.png",
    });
    expect(JSON.stringify(out)).not.toContain(homedir());
    expect(out.other).toBe("<home>/Documents/a.png and <home>/b.png");
  });

  it("replaces temp-directory paths", () => {
    const out = redactPrivatePaths({
      t: "/var/folders/ab/cd123/T/art-local-2-xyz/m.gguf",
    });
    expect(out.t).toBe("<tmp>/m.gguf");
  });

  it("does not mutate its input", () => {
    const input = { p: "/Users/zed/a" };
    redactPrivatePaths(input);
    expect(input.p).toBe("/Users/zed/a");
  });
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");

/** The declarations of the rule whose selector is exactly `selector`. */
function declarations(css: string, selector: string): Map<string, string> {
  const escaped = selector.replace(/[.[\]"=()*]/g, "\\$&");
  const match = new RegExp(
    `(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`,
    "m",
  ).exec(css);
  if (!match?.[1]) throw new Error(`no rule for ${selector}`);
  return new Map(
    [...match[1].matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)].flatMap((found) =>
      found[1] && found[2] ? [[found[1], found[2].trim()] as const] : [],
    ),
  );
}

test("the surface clips the page, so the inspection window scrolls itself: a report taller than the window must stay reachable", () => {
  const surface = read("../ui/surface.css");
  expect(declarations(surface, "html,\nbody,\n#root").get("overflow")).toBe(
    "hidden",
  );

  const inspect = declarations(read("./inspect.css"), ".inspect");
  expect(inspect.get("height")).toBe("100%");
  expect(inspect.get("overflow")).toBe("auto");
});

test("inspection buttons keep a readable label on the default light button face", () => {
  const surface = declarations(read("../ui/surface.css"), "button");
  const inspect = declarations(read("./inspect.css"), ".inspect button");

  // The surface's `color: inherit` would give the dark page's light text on it.
  expect(surface.get("color")).toBe("inherit");
  expect(inspect.get("color")).toMatch(/^#[0-9a-f]{6}$/i);
});

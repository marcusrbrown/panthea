// Redacts private absolute paths from values destined for committed
// evidence: explicit prefixes first (longest wins), then the user's home
// directory, then generic home/temp shapes as a safety net.

import { homedir } from "node:os";

export interface PathReplacement {
  readonly prefix: string;
  readonly label: string;
}

const GENERIC: readonly (readonly [RegExp, string])[] = [
  [
    /(?:\/private)?\/var\/folders\/[^/\s"']+\/[^/\s"']+\/T\/[^/\s"']+/g,
    "<tmp>",
  ],
  [/(?:\/private)?\/tmp\/[^/\s"']+/g, "<tmp>"],
  [/\/(?:Users|home)\/[^/\s"']+/g, "<home>"],
];

function redactString(
  text: string,
  replacements: readonly PathReplacement[],
): string {
  let out = text;
  for (const { prefix, label } of replacements) {
    if (prefix.length > 0) {
      out = out.split(prefix).join(label);
    }
  }
  const home = homedir();
  if (home.length > 1) {
    out = out.split(home).join("~");
  }
  for (const [pattern, label] of GENERIC) {
    out = out.replace(pattern, label);
  }
  return out;
}

export function redactPrivatePaths<T>(
  value: T,
  replacements: readonly PathReplacement[] = [],
): T {
  const sorted = [...replacements].sort(
    (a, b) => b.prefix.length - a.prefix.length,
  );
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      return redactString(node, sorted);
    }
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (typeof node === "object" && node !== null) {
      return Object.fromEntries(
        Object.entries(node).map(([key, child]) => [key, walk(child)]),
      );
    }
    return node;
  };
  return walk(value) as T;
}

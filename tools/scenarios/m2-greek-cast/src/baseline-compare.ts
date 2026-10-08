// The comparison the end capture reports when two projections differ: where, not what. Pure, so the child and the tests
// share it without loading the world.

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The path of the first place two JSON values differ (object keys in sorted order, arrays by index), or `undefined` when
 * they are equal. The path of two values of different shape at the top is the empty string. Values are never returned,
 * only the path: a projection holds the whole world.
 */
export function firstDifference(a: unknown, b: unknown): string | undefined {
  return walk(a, b, "");
}

function walk(a: unknown, b: unknown, path: string): string | undefined {
  if (Array.isArray(a) && Array.isArray(b)) {
    const length = Math.max(a.length, b.length);
    for (let i = 0; i < length; i += 1) {
      if (i >= a.length || i >= b.length) return `${path}[${i}]`;
      const found = walk(a[i], b[i], `${path}[${i}]`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (isObject(a) && isObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const key of keys) {
      const at = path === "" ? key : `${path}.${key}`;
      if (!(key in a) || !(key in b)) return at;
      const found = walk(a[key], b[key], at);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return Object.is(a, b) ? undefined : path;
}

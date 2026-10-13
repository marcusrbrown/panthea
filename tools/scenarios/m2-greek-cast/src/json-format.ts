// JSON as biome's formatter writes it. The evidence files are committed and CI runs `biome format` over them, which
// rejects `JSON.stringify(x, null, 2)`: biome keeps an array of short values on one line when it fits in 80 columns
// (the key, the indent and the trailing comma counted), fills an array of numbers across lines, and puts each element of
// any other array on its own line. Objects are always one key to a line, and an empty container is `[]` or `{}`.
// `json-format.test.ts` holds this to biome itself.

const WIDTH = 80;
const INDENT = "  ";

const isContainer = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

const isEmpty = (value: object): boolean =>
  Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0;

/** JSON.stringify's own view of a value: dropped keys and undefined elements as they would be written. */
function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value) ?? "null");
}

/** `value` on one line, or `undefined` when it cannot be (a non-empty object always breaks). */
function flat(value: unknown): string | undefined {
  if (!isContainer(value)) return JSON.stringify(value);
  if (isEmpty(value)) return Array.isArray(value) ? "[]" : "{}";
  if (!Array.isArray(value)) return undefined;
  const items: string[] = [];
  for (const item of value) {
    const text = flat(item);
    if (text === undefined) return undefined;
    items.push(text);
  }
  return `[${items.join(", ")}]`;
}

/**
 * The lines of `value` placed at `depth`, the first line carrying `prefix` (a key) and the last `suffix` (a comma).
 * The first line starts at `INDENT.repeat(depth)`.
 */
function lines(
  value: unknown,
  depth: number,
  prefix: string,
  suffix: string,
): string[] {
  const pad = INDENT.repeat(depth);
  const inline = flat(value);
  if (inline !== undefined) {
    const line = `${pad}${prefix}${inline}${suffix}`;
    const isArray = Array.isArray(value);
    // Only a non-empty array can be too long; scalars and empty containers are what they are.
    if (!isArray || (value as unknown[]).length === 0 || line.length <= WIDTH) {
      return [line];
    }
  }
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "number")) {
      return fillNumbers(value as number[], pad, prefix, suffix, depth);
    }
    const body = value.flatMap((item, i) =>
      lines(item, depth + 1, "", i < value.length - 1 ? "," : ""),
    );
    return [`${pad}${prefix}[`, ...body, `${pad}]${suffix}`];
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const body = entries.flatMap(([key, item], i) =>
    lines(
      item,
      depth + 1,
      `${JSON.stringify(key)}: `,
      i < entries.length - 1 ? "," : "",
    ),
  );
  return [`${pad}${prefix}{`, ...body, `${pad}}${suffix}`];
}

/** Numbers fill each line up to the width, the way biome fills a numeric array. */
function fillNumbers(
  numbers: readonly number[],
  pad: string,
  prefix: string,
  suffix: string,
  depth: number,
): string[] {
  const inner = INDENT.repeat(depth + 1);
  const out: string[] = [];
  let line = inner;
  numbers.forEach((n, i) => {
    const token = `${n}${i < numbers.length - 1 ? "," : ""}`;
    const next = line === inner ? `${line}${token}` : `${line} ${token}`;
    if (line !== inner && next.length > WIDTH) {
      out.push(line);
      line = `${inner}${token}`;
    } else {
      line = next;
    }
  });
  out.push(line);
  return [`${pad}${prefix}[`, ...out, `${pad}]${suffix}`];
}

/** `value` as biome's formatter writes a JSON document, with the trailing newline. */
export function formatJson(value: unknown): string {
  return `${lines(plain(value), 0, "", "").join("\n")}\n`;
}

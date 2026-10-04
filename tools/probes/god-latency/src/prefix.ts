// What a prompt cache can reuse. A server that keeps the last request's
// tokens (Ollama keeps one slot's worth) reuses the longest run of leading
// tokens a new request shares with the old one and evaluates the rest, so the
// useful question about two prompts is how long their common start is. These
// functions answer it on the text, which is what a prompt's order decides.

/** Length, in characters, of the longest string both begin with. */
export function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
}

/** Length of the longest string every one of `texts` begins with; 0 for none. */
export function sharedPrefixLength(texts: readonly string[]): number {
  const [first, ...rest] = texts;
  if (first === undefined) return 0;
  return rest.reduce(
    (len, text) => commonPrefixLength(first.slice(0, len), text),
    first.length,
  );
}

/** The shared start, cut back to the last whole line, since a prefix a line has only begun is not one a reader (or a test) can name. */
export function sharedPrefixLines(texts: readonly string[]): string {
  const len = sharedPrefixLength(texts);
  const first = texts[0] ?? "";
  const cut = first.slice(0, len);
  const lastBreak = cut.lastIndexOf("\n");
  return lastBreak < 0 ? "" : cut.slice(0, lastBreak + 1);
}

/** What a server that holds one slot would find reusable when `next` follows `previous`: the characters, and the share of `next`. */
export function reusable(
  previous: string,
  next: string,
): { chars: number; share: number } {
  const chars = commonPrefixLength(previous, next);
  return { chars, share: next.length === 0 ? 0 : chars / next.length };
}

/** The reuse of each request after the first when `texts` are sent in order to one slot. */
export function rotationReuse(
  texts: readonly string[],
): { chars: number; share: number }[] {
  return texts.slice(1).map((text, i) => reusable(texts[i] as string, text));
}

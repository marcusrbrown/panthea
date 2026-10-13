// sha256 of a file on disk, streamed, abortable, and cached for the life of the process.
//
// Hashing the models is most of a cold start (about 6 s of 8 s on the real ones:
// tools/probes/studio-release), and a release that gives the lock back opens a new runtime on
// the same files. An entry holds only while the path, the size and the mtime (to the
// nanosecond) are what was hashed against the same pin; any other change is hashed again.

import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";

export function hashFile(path: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    const onAbort = () => {
      stream.destroy();
      reject(new DOMException("aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    stream
      .on("data", (chunk) => hash.update(chunk))
      .on("error", (error) => {
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      })
      .on("end", () => {
        signal?.removeEventListener("abort", onAbort);
        resolve(hash.digest("hex"));
      });
  });
}

const hashedFiles = new Set<string>();

export type PinCheck =
  | { readonly kind: "match" }
  | { readonly kind: "mismatch"; readonly actual: string }
  | { readonly kind: "aborted" };

/** Whether the file hashes to `sha256`; remembered while the path, size and mtime stay what was hashed. */
export async function matchesPin(
  path: string,
  sha256: string,
  signal?: AbortSignal,
): Promise<PinCheck> {
  // The stat is taken before the hash: a file that changes while it is read
  // has another mtime next time and is hashed again.
  const stat = statSync(path, { bigint: true });
  const key = `${path}\0${stat.size}\0${stat.mtimeNs}\0${sha256}`;
  if (hashedFiles.has(key)) return { kind: "match" };
  let actual: string;
  try {
    actual = await hashFile(path, signal);
  } catch (error) {
    if ((error as Error).name === "AbortError") return { kind: "aborted" };
    throw error;
  }
  if (actual !== sha256) return { kind: "mismatch", actual };
  hashedFiles.add(key);
  return { kind: "match" };
}

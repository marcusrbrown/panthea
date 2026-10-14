// Lists the files under a directory, sorted, as relative posix paths.
//
// The render script writes a slot into `<outDir>.partial` and moves it to `<outDir>` in one rename
// while the engine is polling it, so a directory this walk saw can be gone by the time it reads
// it. A directory that has vanished holds no files here (they are under the new name, which the
// caller lists separately); any other read error still throws.

import { type Dirent, readdirSync } from "node:fs";
import { join } from "node:path";

/** The entries of one directory; the seam a test uses to move a directory mid-walk. */
export type EntriesOf = (dir: string) => Dirent[];

const entriesOfDisk: EntriesOf = (dir) =>
  readdirSync(dir, { withFileTypes: true });

const gone = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
};

export function listFiles(
  dir: string,
  entriesOf: EntriesOf = entriesOfDisk,
): string[] {
  const found: string[] = [];
  const walk = (at: string) => {
    let entries: Dirent[];
    try {
      entries = entriesOf(join(dir, at));
    } catch (error) {
      if (gone(error)) return;
      throw error;
    }
    for (const entry of entries) {
      const path = at === "" ? entry.name : `${at}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else found.push(path);
    }
  };
  walk("");
  return found.sort();
}

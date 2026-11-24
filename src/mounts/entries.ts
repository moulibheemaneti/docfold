/**
 * Search entries from mounted folders: read from each folder's own index, kept apart from the
 * markdown library (they have no page, sidebar entry or facet of docfold's own) and searched with it.
 */

import { errorMessage, warn } from "../shared/log";
import { isDirectory } from "../shared/paths";
import { MOUNT_FORMATS } from "./formats";
import type { IndexedDoc, ResolvedMount, Urls } from "../types";

const NONE: readonly IndexedDoc[] = Object.freeze([]);

/**
 * A mounted folder's search entries, read from its index. A missing or unreadable index is reported
 * through `report` and gives no entries: the folder is still served, just not searched.
 */
export const loadMountEntries = async (
  mount: ResolvedMount,
  urls: Urls,
  report: (message: string) => void = warn,
): Promise<IndexedDoc[]> => {
  if (!mount.search) return [];
  const { format, index } = mount.search;
  const where = `mounts "${mount.path}"`;
  let data: unknown;
  try {
    data = await Bun.file(index).json();
  } catch (err) {
    report(
      (err as { code?: string }).code === "ENOENT"
        ? `Search index not found: ${index} (${where}). Its pages are served but not searched.`
        : `Could not read the search index ${index} (${where}): ${errorMessage(err)}`,
    );
    return [];
  }
  try {
    return MOUNT_FORMATS[format].read(data, mount, urls);
  } catch (err) {
    report(`Could not read the search index ${index} (${where}) as "${format}": ${errorMessage(err)}`);
    return [];
  }
};

/**
 * Every searchable mount's entries, in config order. Mounts in `skip` (folders already reported
 * missing) are left out without another warning.
 */
export const loadAllMountEntries = async (
  mounts: readonly ResolvedMount[],
  urls: Urls,
  skip: readonly ResolvedMount[] = [],
): Promise<IndexedDoc[]> =>
  (await Promise.all(mounts.filter((mount) => mount.search && !skip.includes(mount)).map((mount) => loadMountEntries(mount, urls)))).flat();

/**
 * The dev server's mounted entries: read at start, then again for one mount when its folder changes
 * (with `watch` on). A folder that doesn't exist gives no entries quietly (the server says so once at
 * start), and an index problem is reported once, not again on every re-read, until it changes.
 */
export class MountedEntries {
  #entries = new Map<ResolvedMount, Promise<IndexedDoc[]>>();
  #all: Promise<readonly IndexedDoc[]> | undefined;
  #problems = new Map<ResolvedMount, string>();

  constructor(
    readonly mounts: readonly ResolvedMount[],
    readonly urls: Urls,
  ) {
    for (const mount of mounts) if (mount.search) void this.reload(mount);
  }

  /** Re-reads one mount's index; resolves once it has been read. */
  reload(mount: ResolvedMount): Promise<IndexedDoc[]> {
    const loading = this.#load(mount);
    this.#entries.set(mount, loading);
    this.#all = undefined;
    return loading;
  }

  /** Every mount's entries, in config order: searched after the markdown documents. */
  all(): Promise<readonly IndexedDoc[]> {
    if (!this.#entries.size) return Promise.resolve(NONE);
    return (this.#all ??= Promise.all(this.mounts.map((mount) => this.#entries.get(mount) ?? NONE)).then((lists) => lists.flat()));
  }

  async #load(mount: ResolvedMount): Promise<IndexedDoc[]> {
    if (!(await isDirectory(mount.dir))) return [];
    let problem: string | undefined;
    const entries = await loadMountEntries(mount, this.urls, (message) => {
      problem = message;
    });
    if (problem === undefined) this.#problems.delete(mount);
    else if (this.#problems.get(mount) !== problem) {
      this.#problems.set(mount, problem);
      warn(problem);
    }
    return entries;
  }
}

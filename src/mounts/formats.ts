/**
 * Search index formats a mounted folder can bring, by the name used in `search.format`. A new
 * format is a reader here: its default index file and a function from the parsed file to entries.
 */

import { readDartdoc } from "./dartdoc";
import type { IndexedDoc, MountSearchFormat, ResolvedMount, Urls } from "../types";

export interface MountFormat {
  /** The index file, relative to the mount's folder, when the config doesn't name one. */
  index: string;
  /** Turns the parsed index into search entries. Throws when the file isn't in this format. */
  read: (data: unknown, mount: ResolvedMount, urls: Urls) => IndexedDoc[];
}

export const MOUNT_FORMATS: Record<MountSearchFormat, MountFormat> = {
  dartdoc: { index: "index.json", read: readDartdoc },
};

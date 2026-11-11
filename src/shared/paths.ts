/**
 * File-system path checks shared by the build, the dev server and the preview server.
 *
 * Server-only (uses node:fs); the browser bundle never imports this module.
 */

import { stat } from "node:fs/promises";
import { sep } from "node:path";

/** True when the absolute path `child` is `parent` itself or somewhere inside it. */
export const isInside = (child: string, parent: string): boolean => child === parent || child.startsWith(parent + sep);

/** True when `path` exists and is a regular file (not a folder). */
export const isFile = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

/**
 * Decodes the part of a URL `pathname` after `prefix` (e.g. "/files/my%20img.png" → "my img.png"),
 * or returns null when it is not valid percent-encoding.
 */
export const decodePathAfter = (pathname: string, prefix: string): string | null => {
  try {
    return decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return null;
  }
};

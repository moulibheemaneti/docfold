/**
 * The files of a mounted folder: what the dev server serves and the build copies. Both follow the
 * same rules, so a site behaves the same in dev and once built: hidden names (".git", ".DS_Store")
 * are never served or copied, and neither is anything outside the folder, symlinks included.
 */

import { copyFile, mkdir, readdir, realpath, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { isInside } from "../shared/paths";

const isHidden = (relPath: string): boolean => relPath.split(/[/\\]/).some((part) => part.startsWith("."));

/** `path`'s real location when it is inside `realDir` (the folder's own real path) and not hidden. */
const realInside = async (path: string, realDir: string): Promise<string | null> => {
  try {
    const real = await realpath(path);
    return isInside(real, realDir) && !isHidden(relative(realDir, real)) ? real : null;
  } catch {
    return null; // missing, or a broken symlink
  }
};

export interface MountFile {
  type: "file" | "folder";
  /** Real path on disk. */
  path: string;
}

/**
 * What `relPath` (decoded, relative to the mount's address) names inside the folder `dir`: a file or
 * a folder. Null for anything else: missing, hidden, or outside the folder (through ".." or a symlink).
 */
export const findMountFile = async (dir: string, relPath: string): Promise<MountFile | null> => {
  if (isHidden(relPath)) return null;
  const path = resolve(dir, relPath);
  if (!isInside(path, resolve(dir))) return null;
  let realDir: string;
  try {
    realDir = await realpath(dir);
  } catch {
    return null; // the folder doesn't exist (yet)
  }
  const real = await realInside(path, realDir);
  if (!real) return null;
  try {
    const info = await stat(real);
    return info.isFile() ? { type: "file", path: real } : info.isDirectory() ? { type: "folder", path: real } : null;
  } catch {
    return null;
  }
};

/**
 * Copies the folder `dir` into `to`, leaving out what `findMountFile` refuses: hidden names, and
 * symlinks that lead outside the folder or to a hidden name. Symlinks inside it are copied as the
 * files they point to. Returns how many files were copied.
 */
export const copyMount = async (dir: string, to: string): Promise<number> => {
  const realDir = await realpath(dir);
  let copied = 0;

  /** `folder` is a real path; `parents` are the real folders walked to reach it, so a symlink back up one stops. */
  const walk = async (folder: string, dest: string, parents: readonly string[]): Promise<void> => {
    await mkdir(dest, { recursive: true });
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      let path: string | null = join(folder, entry.name);
      let type = entry.isFile() ? "file" : entry.isDirectory() ? "folder" : undefined;
      if (entry.isSymbolicLink()) {
        path = await realInside(path, realDir);
        const info = path ? await stat(path).catch(() => undefined) : undefined;
        type = info?.isFile() ? "file" : info?.isDirectory() ? "folder" : undefined;
      }
      if (!path) continue;
      if (type === "file") {
        await copyFile(path, join(dest, entry.name));
        copied++;
      } else if (type === "folder" && !parents.some((parent) => isInside(parent, path))) {
        await walk(path, join(dest, entry.name), [...parents, path]);
      }
    }
  };

  await walk(realDir, to, [realDir]);
  return copied;
};

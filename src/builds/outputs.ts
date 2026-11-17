/**
 * Finds what a finished run produced: the command's `outputs` (paths or globs relative to its
 * folder), keeping only files and folders created or changed since the run started.
 */

import { lstat, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { naturalCompare } from "../shared/natural-compare";
import { isInside } from "../shared/paths";
import type { BuildOutput } from "../types";

/**
 * Some file systems keep modification times in whole seconds (HFS+) or two-second steps (FAT,
 * exFAT). Allow for that rather than miss a file the run just wrote.
 */
export const MTIME_SLACK_MS = 2000;

/** An output with its absolute path, which stays on the server. */
export interface ResolvedOutput extends BuildOutput {
  path: string;
}

export interface OutputResult {
  outputs: ResolvedOutput[];
  /** Matches left out because the run didn't create or change them. */
  stale: number;
}

const GLOB_CHARS = /[*?[\]{}!]/;

/** "../web/dist/*.js" → base "../web/dist", glob "*.js". Bun.Glob can't climb out of its cwd with "..". */
const splitGlob = (pattern: string): { base: string; glob: string } => {
  const parts = pattern.split(/[\\/]/);
  const first = parts.findIndex((part) => GLOB_CHARS.test(part));
  return { base: parts.slice(0, first).join("/"), glob: parts.slice(first).join("/") };
};

/** Absolute paths matching one entry of `outputs`, in a stable order. */
const matches = async (pattern: string, cwd: string): Promise<string[]> => {
  if (!GLOB_CHARS.test(pattern)) return [resolve(cwd, pattern)];
  const { base, glob } = splitGlob(pattern);
  const root = resolve(cwd, base || ".");
  const found: string[] = [];
  try {
    for await (const path of new Bun.Glob(glob).scan({ cwd: root, onlyFiles: false, followSymlinks: false })) {
      found.push(join(root, path));
    }
  } catch {
    // the base folder doesn't exist: no matches
  }
  return found.sort(naturalCompare);
};

/** A file, or a symlink re-pointed at one, written at or after `since`. */
const fileChangedSince = async (path: string, since: number): Promise<boolean> => {
  const [link, target] = await Promise.all([lstat(path), stat(path)]);
  return Math.max(link.mtimeMs, target.mtimeMs) >= since;
};

/** True when anything in the folder (or the folder itself) was modified at or after `since`. */
const folderChangedSince = async (dir: string, since: number): Promise<boolean> => {
  if ((await lstat(dir)).mtimeMs >= since) return true;
  for await (const path of new Bun.Glob("**").scan({ cwd: dir, onlyFiles: false, dot: true, followSymlinks: false })) {
    try {
      if ((await lstat(join(dir, path))).mtimeMs >= since) return true;
    } catch {
      // removed while walking
    }
  }
  return false;
};

/**
 * Resolves `patterns` against `cwd` and keeps the files and folders changed at or after `startedAt`
 * (less `MTIME_SLACK_MS`). Something inside a folder that is itself an output is not listed again.
 */
export const resolveOutputs = async (patterns: readonly string[], cwd: string, startedAt: number): Promise<OutputResult> => {
  const since = startedAt - MTIME_SLACK_MS;
  const seen = new Set<string>();
  const candidates: { path: string; kind: "file" | "folder"; size?: number }[] = [];

  for (const pattern of patterns) {
    for (const path of await matches(pattern, cwd)) {
      if (seen.has(path)) continue;
      seen.add(path);
      try {
        const info = await stat(path); // follows a symlinked output to what it points at
        if (info.isFile()) candidates.push({ path, kind: "file", size: info.size });
        else if (info.isDirectory()) candidates.push({ path, kind: "folder" });
      } catch {
        // doesn't exist (yet)
      }
    }
  }

  const folders = candidates.filter((candidate) => candidate.kind === "folder").map((candidate) => candidate.path);
  const outputs: ResolvedOutput[] = [];
  let stale = 0;
  for (const candidate of candidates) {
    if (folders.some((folder) => folder !== candidate.path && isInside(candidate.path, folder))) continue;
    const fresh =
      candidate.kind === "folder" ? await folderChangedSince(candidate.path, since) : await fileChangedSince(candidate.path, since);
    if (!fresh) {
      stale++;
      continue;
    }
    const relPath = relative(cwd, candidate.path).split(sep).join("/") || ".";
    outputs.push({ index: outputs.length, name: basename(candidate.path), relPath, ...candidate });
  }
  return { outputs, stale };
};

/** Why a successful run offers nothing to download, or undefined when it does. */
export const outputsNote = (result: OutputResult, patterns: readonly string[]): string | undefined => {
  if (result.outputs.length) return undefined;
  if (!patterns.length) return undefined; // the command declares no outputs
  if (result.stale) {
    const files = result.stale === 1 ? "1 file matched" : `${result.stale} files matched`;
    return `No new outputs: ${files} ${patterns.join(", ")}, but this run didn't create or change ${result.stale === 1 ? "it" : "them"}, so ${result.stale === 1 ? "it is" : "they are"} probably from an older build.`;
  }
  return `No outputs: nothing matched ${patterns.join(", ")}.`;
};

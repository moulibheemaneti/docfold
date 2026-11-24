/**
 * Validates the `mounts` key of docfold.config.ts. Every problem is reported at once, each with
 * the mount it belongs to. What can change between runs (publicDir's contents, whether a folder
 * exists yet) is checked when `dev` and `build` start, by `inspectMounts`.
 */

import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDirectory, isInside } from "../shared/paths";
import { MOUNT_FORMATS } from "./formats";
import type { ResolvedConfig, ResolvedMount } from "../types";

/** One part of a mount's path: lower-case letters, digits, "-" and "_", starting with a letter or digit. */
export const MOUNT_PATH_PART = /^[a-z0-9][a-z0-9_-]*$/;

/** Addresses docfold serves itself (see ../shared/urls.ts); a mount's path can't start with one. */
export const RESERVED_MOUNT_PATHS: readonly string[] = ["docs", "files", "assets", "api", "builds"];

const EXAMPLE = '{ dir: "../doc/api", path: "reference", label: "API reference" }';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const quoted = (values: readonly string[]): string => values.map((value) => `"${value}"`).join(", ");

const fail = (errors: readonly string[]): never => {
  throw new Error(`Invalid mounts config:\n${errors.map((error) => `- ${error}`).join("\n")}`);
};

/** Folders a mount's `dir` is checked against. */
interface ProjectFolders {
  srcDir: string;
  outDir: string;
  publicDir: string;
}

/** "reference/" → "reference"; undefined (with an error) when it isn't a valid address. */
const resolvePath = (raw: unknown, where: string, errors: string[]): string | undefined => {
  if (typeof raw !== "string") {
    errors.push(`${where}: path must be a string, e.g. "reference".`);
    return undefined;
  }
  const path = raw.replace(/^\/+|\/+$/g, "");
  const parts = path.split("/");
  if (!path || !parts.every((part) => MOUNT_PATH_PART.test(part))) {
    errors.push(
      `${where}: path ${JSON.stringify(raw)} is the folder's address: use one or more "/"-separated parts of lower-case letters, digits, "-" and "_", each starting with a letter or digit.`,
    );
    return undefined;
  }
  if (RESERVED_MOUNT_PATHS.includes(parts[0]!)) {
    errors.push(`${where}: path ${JSON.stringify(raw)} can't start with "${parts[0]}": docfold serves that address itself (${quoted(RESERVED_MOUNT_PATHS)}).`);
    return undefined;
  }
  return path;
};

const resolveDir = (raw: unknown, at: string, root: string, folders: ProjectFolders, errors: string[]): string | undefined => {
  if (typeof raw !== "string" || !raw.trim()) {
    errors.push(`${at}: dir must be the folder to serve, relative to the config file, e.g. "../doc/api".`);
    return undefined;
  }
  const dir = resolve(root, raw);
  const before = errors.length;
  if (isInside(root, dir)) {
    errors.push(`${at}: dir (${dir}) must not be the project folder or one of its parents.`);
  } else {
    for (const [name, folder] of Object.entries(folders)) {
      if (isInside(folder, dir)) errors.push(`${at}: dir (${dir}) must not contain ${name} (${folder}).`);
    }
    if (isInside(dir, folders.outDir)) errors.push(`${at}: dir (${dir}) must not be inside outDir (${folders.outDir}), which the build replaces.`);
  }
  return errors.length > before ? undefined : dir;
};

const resolveSearch = (raw: unknown, at: string, dir: string | undefined, errors: string[]): ResolvedMount["search"] => {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    errors.push(`${at}: search must be an object like { format: "dartdoc" }, or left out to serve the folder without searching it.`);
    return undefined;
  }
  const { format, index } = raw;
  const reader = typeof format === "string" && Object.hasOwn(MOUNT_FORMATS, format) ? MOUNT_FORMATS[format as keyof typeof MOUNT_FORMATS] : undefined;
  if (!reader) {
    errors.push(`${at}: search.format ${JSON.stringify(format)} is not supported. Supported formats: ${quoted(Object.keys(MOUNT_FORMATS))}.`);
  }
  const validIndex = index === undefined || (typeof index === "string" && index.trim() !== "");
  if (!validIndex) errors.push(`${at}: search.index must be a file name relative to dir, e.g. "index.json".`);
  if (!reader || !validIndex || !dir) return undefined;
  return { format: format as keyof typeof MOUNT_FORMATS, index: resolve(dir, (index as string | undefined) ?? reader.index) };
};

const resolveMount = (raw: unknown, index: number, root: string, folders: ProjectFolders, errors: string[]): ResolvedMount | undefined => {
  const where = `mounts[${index}]`;
  if (!isObject(raw)) {
    errors.push(`${where} must be an object like ${EXAMPLE}.`);
    return undefined;
  }
  const before = errors.length;
  const path = resolvePath(raw.path, where, errors);
  const at = path ? `${where} ("${path}")` : where;
  const dir = resolveDir(raw.dir, at, root, folders, errors);
  if (typeof raw.label !== "string" || !raw.label.trim()) {
    errors.push(`${at}: label must not be empty: it's the text of the folder's header link, e.g. "API reference".`);
  }
  const search = resolveSearch(raw.search, at, dir, errors);
  if (errors.length > before || !path || !dir) return undefined;
  return { dir, path, label: (raw.label as string).trim(), ...(search ? { search } : {}) };
};

/**
 * The validated `mounts`: [] when the config declares none. Paths are resolved against `root` (the
 * config file's folder). Throws one error listing every problem.
 */
export const resolveMounts = (mounts: unknown, root: string, folders: ProjectFolders): ResolvedMount[] => {
  if (mounts === undefined || mounts === null) return [];
  if (!Array.isArray(mounts)) fail([`mounts must be a list like [${EXAMPLE}].`]);

  const errors: string[] = [];
  const resolved = (mounts as unknown[]).map((raw, index) => resolveMount(raw, index, root, folders, errors));

  // Two mounts can't share an address, and one can't sit inside another's.
  resolved.forEach((mount, j) => {
    if (!mount) return;
    resolved.slice(0, j).forEach((other, i) => {
      if (!other) return;
      const at = `mounts[${j}] ("${mount.path}")`;
      if (mount.path === other.path) errors.push(`${at}: path "${mount.path}" is also used by mounts[${i}].`);
      else if (mount.path.startsWith(`${other.path}/`) || other.path.startsWith(`${mount.path}/`)) {
        errors.push(`${at}: path "${mount.path}" and mounts[${i}]'s "${other.path}" are nested; mounts can't be inside each other.`);
      }
    });
  });

  if (errors.length) fail(errors);
  return resolved as ResolvedMount[];
};

/**
 * Checks the mounts when `dev` and `build` start. A mount whose first path part is also a top-level
 * file or folder in publicDir is an error: both would be served at the same address, and a mount never
 * wins. Returns the mounts whose folder doesn't exist (yet), for the caller to report.
 */
export const inspectMounts = async (config: Pick<ResolvedConfig, "mounts" | "publicDir">): Promise<ResolvedMount[]> => {
  if (!config.mounts.length) return [];

  let names: string[] = [];
  try {
    names = await readdir(config.publicDir);
  } catch {
    // no publicDir
  }
  // Lower-cased: on a case-insensitive file system "Reference/" and "reference/" are one folder.
  const byLowerName = new Map(names.map((name) => [name.toLowerCase(), name]));
  const errors = config.mounts.flatMap((mount, index) => {
    const first = mount.path.split("/")[0]!;
    const name = byLowerName.get(first);
    return name
      ? [`mounts[${index}] ("${mount.path}"): publicDir has "${name}" (${join(config.publicDir, name)}) at the same address. Rename one of them.`]
      : [];
  });
  if (errors.length) fail(errors);

  const missing: ResolvedMount[] = [];
  for (const mount of config.mounts) if (!(await isDirectory(mount.dir))) missing.push(mount);
  return missing;
};

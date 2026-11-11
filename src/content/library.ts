/**
 * Finds and parses every markdown file under the docs folder.
 */

import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { countFacets } from "../search";
import { errorMessage, warn } from "../shared/log";
import { naturalCompare } from "../shared/natural-compare";
import { buildTree } from "../sidebar";
import { DEFAULT_URLS, parseDoc } from "./parse";
import type { Doc, Library, LoadOptions, Urls } from "../types";

/** Dot-files/folders and node_modules are never read, served or published. */
export const isSkippedName = (name: string): boolean => name.startsWith(".") || name === "node_modules";

/**
 * Whether a file the markdown links to may be served and copied into the build.
 * Hidden paths (".env", ".git/config") and node_modules never are, even when linked.
 */
export const isPublishableFile = (relPath: string): boolean => !relPath.split("/").some(isSkippedName);

/** Finds every `*.md` file under `root`, skipping dot-folders, node_modules and `ignore`d folders. */
const findMarkdownFiles = async (root: string, ignore: ReadonlySet<string>): Promise<string[] | null> => {
  const found: string[] = [];

  const walk = async (rel: string): Promise<boolean> => {
    let entries;
    try {
      entries = await readdir(rel ? join(root, rel) : root, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (isSkippedName(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!ignore.has(resolve(root, childRel))) await walk(childRel);
      } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        found.push(childRel);
      }
    }
    return true;
  };

  return (await walk("")) ? found : null;
};

/** One file that can't be read (deleted mid-save, no permission…) is skipped, not fatal. */
const readDoc = async (root: string, relPath: string, urls: Urls): Promise<Doc | undefined> => {
  try {
    return parseDoc(relPath, await Bun.file(join(root, relPath)).text(), urls);
  } catch (err) {
    warn(`Skipped ${relPath}: ${errorMessage(err)}`);
    return undefined;
  }
};

export const loadLibrary = async (root: string, options: LoadOptions = {}): Promise<Library> => {
  const urls = options.urls ?? DEFAULT_URLS;
  const relPaths = await findMarkdownFiles(root, new Set((options.ignore ?? []).map((dir) => resolve(dir))));
  if (!relPaths) warn(`Docs folder not found: ${root}`);

  const docs = (await Promise.all((relPaths ?? []).map((relPath) => readDoc(root, relPath, urls)))).filter(
    (doc): doc is Doc => doc !== undefined,
  );
  docs.sort((a, b) => naturalCompare(a.relPath, b.relPath));

  return {
    root,
    docs,
    bySlug: new Map(docs.map((doc) => [doc.slug, doc])),
    tree: buildTree(docs),
    assets: new Set(docs.flatMap((doc) => doc.assets).filter(isPublishableFile)),
    ...countFacets(docs),
  };
};

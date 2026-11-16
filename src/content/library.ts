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
import type { Doc, Library, LoadOptions, SlugCollision, Urls } from "../types";

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

/** Natural order, then exact order for names that differ only in case ("SETUP.md" before "Setup.md"). */
const byRelPath = (a: Doc, b: Doc): number =>
  naturalCompare(a.relPath, b.relPath) || (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0);

/**
 * Groups of files whose paths turn into the same slug, so they would share one page address:
 * "Setup.md" and "SETUP.md" (both "setup"), "My_Notes.md" and "my notes.md" (both "my-notes").
 * Each group lists its files in the order given.
 */
export const findSlugCollisions = (docs: readonly Pick<Doc, "relPath" | "slug">[]): SlugCollision[] => {
  const relPathsBySlug = new Map<string, string[]>();
  for (const { slug, relPath } of docs) relPathsBySlug.set(slug, [...(relPathsBySlug.get(slug) ?? []), relPath]);
  return [...relPathsBySlug].filter(([, relPaths]) => relPaths.length > 1).map(([slug, relPaths]) => ({ slug, relPaths }));
};

/** `"a", "b" and "c"`. */
const quoteList = (items: readonly string[]): string => {
  const quoted = items.map((item) => `"${item}"`);
  return quoted.length > 1 ? `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}` : quoted.join("");
};

/** Lists the groups, one per line: `  "SETUP.md" and "Setup.md" → /docs/setup`, plus `note(group)`. */
const describeCollisions = (collisions: readonly SlugCollision[], urls: Urls, note = (_: SlugCollision) => ""): string =>
  [
    'These files would share a page address (addresses are lower-case, with "-" for spaces and underscores):',
    ...collisions.map((group) => `  ${quoteList(group.relPaths)} → ${urls.doc(group.slug)}${note(group)}`),
  ].join("\n");

export const loadLibrary = async (root: string, options: LoadOptions = {}): Promise<Library> => {
  const urls = options.urls ?? DEFAULT_URLS;
  const relPaths = await findMarkdownFiles(root, new Set((options.ignore ?? []).map((dir) => resolve(dir))));
  if (!relPaths) warn(`Docs folder not found: ${root}`);

  let docs = (await Promise.all((relPaths ?? []).map((relPath) => readDoc(root, relPath, urls)))).filter(
    (doc): doc is Doc => doc !== undefined,
  );
  docs.sort(byRelPath);

  // Two files can't share one address: `build` stops, `dev` keeps the first file of each group and says so.
  const collisions = findSlugCollisions(docs);
  if (collisions.length) {
    if (options.slugCollisions === "error") {
      throw new Error(`${describeCollisions(collisions, urls)}\nRename one file in each group.`);
    }
    warn(
      `${describeCollisions(collisions, urls, (group) => `  (showing "${group.relPaths[0]}")`)}\n` +
        "Only the first file of each group is shown. Rename the others; `docfold build` fails until you do.",
    );
    const hidden = new Set(collisions.flatMap((group) => group.relPaths.slice(1)));
    docs = docs.filter((doc) => !hidden.has(doc.relPath));
  }

  return {
    root,
    docs,
    bySlug: new Map(docs.map((doc) => [doc.slug, doc])),
    tree: buildTree(docs),
    assets: new Set(docs.flatMap((doc) => doc.assets).filter(isPublishableFile)),
    ...countFacets(docs),
  };
};

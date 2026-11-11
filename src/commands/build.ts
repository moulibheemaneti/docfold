/**
 * `docfold build`: writes a static site. Search runs in the browser from
 * search-index.json, so no server is needed. Pages are "<name>.html" files
 * linked without the extension or a trailing slash ("/docs/intro"), which
 * GitHub Pages, Netlify and Cloudflare Pages serve as is (nginx needs
 * `try_files $uri $uri.html $uri/ =404;`).
 *
 *   dist/
 *     index.html                 home page, or search + filters when there's no home page
 *     docs.html                  search + filters at "/docs" (only with a home page)
 *     docs/<slug>.html           one page per markdown file, at "/docs/<slug>"
 *     files/<path>               images / attachments the markdown links to
 *     assets/styles.css, app.js
 *     search-index.json
 *     404.html
 *     …                          everything in publicDir (logo, favicon…)
 */

import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { loadLibrary } from "../content";
import { docPage, notFoundPage } from "../pages";
import { DEFAULT_PARAMS } from "../search";
import { isFile, isInside } from "../shared/paths";
import { createSite, ignoredFolders, renderHome, renderList, searchIndex } from "../site";
import { bundleClient, loadStyles } from "./assets";
import type { BuildResult, Library, ResolvedConfig } from "../types";

/** Written into every build; only folders carrying it are ever emptied. */
export const BUILD_MARKER = ".docfold-build";

const isDirectory = (path: string): Promise<boolean> =>
  stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );

/** Empties `outDir`, refusing anything that could hold the user's own files. */
const prepareOutDir = async (config: ResolvedConfig): Promise<void> => {
  const { outDir, root, srcDir, publicDir } = config;
  if (isInside(root, outDir)) throw new Error(`outDir (${outDir}) must not be the project folder or one of its parents.`);
  if (isInside(srcDir, outDir)) throw new Error(`outDir (${outDir}) must not contain the docs folder (${srcDir}).`);
  // Only matters when publicDir exists (outDir: "public" is fine for a site without one).
  if ((await isDirectory(publicDir)) && (isInside(publicDir, outDir) || isInside(outDir, publicDir))) {
    throw new Error(`outDir (${outDir}) and publicDir (${publicDir}) must not contain each other.`);
  }

  let entries: string[] = [];
  try {
    entries = await readdir(outDir);
  } catch {
    // doesn't exist yet
  }
  if (entries.length && !entries.includes(BUILD_MARKER)) {
    throw new Error(`${outDir} already exists and wasn't created by docfold. Remove it or choose another outDir.`);
  }
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
};

/** Copies publicDir's contents into the output root; returns how many files were copied. */
const copyPublicDir = async (publicDir: string, outDir: string): Promise<number> => {
  let entries: string[];
  try {
    entries = (await readdir(publicDir, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => relative(publicDir, join(entry.parentPath, entry.name)))
      .filter((relPath) => !relPath.split(sep).some((part) => part.startsWith(".")));
  } catch {
    return 0; // no publicDir
  }
  await Promise.all(
    entries.map(async (relPath) => {
      const to = join(outDir, relPath);
      await mkdir(dirname(to), { recursive: true });
      await cp(join(publicDir, relPath), to);
    }),
  );
  return entries.length;
};

/**
 * Copies the files the markdown links to into `files/`. Returns the ones that couldn't be copied:
 * missing, folders, hidden paths or node_modules (see `isPublishableFile`).
 */
const copyLinkedFiles = async (library: Library, srcDir: string, outDir: string): Promise<{ copied: number; missing: string[] }> => {
  const linked = [...new Set(library.docs.flatMap((doc) => doc.assets))];
  const missing: string[] = [];
  const copies: Promise<void>[] = [];
  for (const relPath of linked) {
    const from = resolve(srcDir, relPath);
    if (!library.assets.has(relPath) || !isInside(from, srcDir) || !(await isFile(from))) {
      missing.push(relPath);
      continue;
    }
    const to = join(outDir, "files", relPath);
    copies.push(mkdir(dirname(to), { recursive: true }).then(() => cp(from, to)));
  }
  await Promise.all(copies);
  return { copied: copies.length, missing };
};

export const build = async (config: ResolvedConfig): Promise<BuildResult> => {
  const started = performance.now();
  const site = createSite(config, "static");
  const library = await loadLibrary(config.srcDir, { urls: site.urls, ignore: ignoredFolders(config) });
  const [styles, clientScript] = await Promise.all([loadStyles(config), bundleClient()]);

  await prepareOutDir(config);

  // publicDir first, so generated files win if names clash. Dot-files stay behind.
  const publicFiles = await copyPublicDir(config.publicDir, config.outDir);
  const writes: Promise<unknown>[] = [];
  const write = (path: string, data: string) => writes.push(Bun.write(join(config.outDir, path), data));

  // Marks the folder as ours (safe to replace) and tells `preview` which base the pages were built for.
  write(BUILD_MARKER, `${JSON.stringify({ generator: "docfold", base: config.base, builtAt: new Date().toISOString() }, null, 2)}\n`);
  write(".nojekyll", ""); // GitHub Pages: serve files as-is

  const list = renderList(site, library, DEFAULT_PARAMS);
  if (config.home) {
    write("index.html", await renderHome(config, site, library));
    write("docs.html", list);
  } else {
    write("index.html", list);
  }
  // "docs/<slug>.html" is served at "/docs/<slug>" (no trailing slash) by GitHub Pages, Netlify, Cloudflare Pages…
  for (const doc of library.docs) write(`docs/${doc.slug}.html`, docPage(site, library, doc));
  write("404.html", notFoundPage(site, library));

  write("search-index.json", JSON.stringify(searchIndex(library)));
  write("assets/styles.css", styles);
  write("assets/app.js", clientScript);

  // Only the files the markdown actually links to.
  const [linked] = await Promise.all([copyLinkedFiles(library, config.srcDir, config.outDir), ...writes]);

  return {
    outDir: config.outDir,
    pages: library.docs.length + (config.home ? 2 : 1),
    files: linked.copied,
    publicFiles,
    missingFiles: linked.missing,
    ms: Math.round(performance.now() - started),
  };
};

export const describeOutDir = (config: ResolvedConfig): string => relative(process.cwd(), config.outDir) || ".";

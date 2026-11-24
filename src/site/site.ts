/**
 * Turns the resolved config into what the page templates need, and renders the pages
 * `docfold dev` and `docfold build` have in common.
 */

import { isAbsolute, relative } from "node:path";
import { DEFAULT_THEME_COLOR, GOOGLE_FONTS, themeStyle } from "../config/theme";
import { toIndexedDoc } from "../content";
import { homePage, searchPage } from "../pages";
import { searchDocs } from "../search";
import { raw } from "../shared/html";
import { isInside } from "../shared/paths";
import { createUrls } from "../shared/urls";
import type { IndexedDoc, Library, ResolvedConfig, SearchParams, Site } from "../types";

export const createSite = (config: ResolvedConfig, mode: Site["mode"]): Site => {
  const urls = createUrls(config.base, { home: !!config.home });
  const rel = relative(config.root, config.srcDir);
  const sourceLabel = !rel ? "./" : rel.startsWith("..") || isAbsolute(rel) ? `${config.srcDir}/` : `${rel}/`;
  const primary = config.theme.colors.primary ?? config.theme.light.primary;

  return {
    title: config.title,
    description: config.description,
    sourceLabel,
    urls,
    mode,
    liveReload: mode === "dev" && !!config.watch && config.watch.liveReload,
    head: [config.theme.googleFonts ? GOOGLE_FONTS : "", themeStyle(config.theme), ...config.head]
      .filter(Boolean)
      .join("\n  "),
    themeColor: primary && /^#[\da-f]{3,8}$/i.test(primary) ? primary : DEFAULT_THEME_COLOR,
    header: config.header,
    home: config.home ? { hero: config.home.hero, features: config.home.features } : false,
    builds: mode === "dev" && !!config.builds,
    mounts: config.mounts.map(({ path, label }) => ({ path, label })),
  };
};

/**
 * Folders that never hold documents even when they sit inside the docs folder: the build output,
 * publicDir and mounted folders.
 */
export const ignoredFolders = (config: ResolvedConfig): string[] => [
  config.outDir,
  config.publicDir,
  ...config.mounts.map((mount) => mount.dir).filter((dir) => isInside(dir, config.srcDir)),
];

/**
 * What search runs over: the markdown documents, then the entries from mounted folders. Without
 * mounted entries it is the library's own list.
 */
export const searchable = (library: Library, mounted: readonly IndexedDoc[] = []): readonly IndexedDoc[] =>
  mounted.length ? [...library.docs, ...mounted] : library.docs;

/** A full HTML document is served as it is; anything else is a fragment shown inside the site layout. */
const isFullDocument = (source: string): boolean => /^\s*(?:<!--[\s\S]*?-->\s*)*<(?:!doctype|html)[\s>]/i.test(source);

/** The home page: the `home.html` override when it exists, otherwise the generated hero + features. */
export const renderHome = async (config: ResolvedConfig, site: Site, library: Library): Promise<string> => {
  const file = config.home ? Bun.file(config.home.file) : undefined;
  if (file && (await file.exists())) {
    const source = await file.text();
    return isFullDocument(source) ? source : homePage(site, library, raw(source));
  }
  return homePage(site, library);
};

/**
 * The documents list with `params` applied (the build renders it unfiltered; the browser applies URL
 * filters). `mounted`: search entries from mounted folders, listed with the documents.
 */
export const renderList = (site: Site, library: Library, params: SearchParams, mounted: readonly IndexedDoc[] = []): string =>
  searchPage(site, library, searchDocs(searchable(library, mounted), params));

/** The documents as the browser downloads them for search (search-index.json), then any `mounted` entries. */
export const searchIndex = (library: Library, mounted: readonly IndexedDoc[] = []): IndexedDoc[] => [
  ...library.docs.map(toIndexedDoc),
  ...mounted,
];

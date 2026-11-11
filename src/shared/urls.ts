/**
 * Every URL the site produces goes through here, so hosting under a sub-path
 * (e.g. GitHub Pages at "/my-repo/") works for pages, assets and links alike.
 *
 *   base + ""                    home page (or the documents list when there's no home page)
 *   base + "docs"                documents list: search + filters (when there is a home page)
 *   base + "docs/<slug>"         one document
 *   base + "files/<path>"        a non-markdown file from the docs folder
 *   base + "assets/<name>"       the site's CSS and JS
 *   base + "search-index.json"   data for in-browser search
 *   base + "<path>"              anything else comes from publicDir (logo, images…)
 *
 * Page URLs have no trailing slash; the build writes them as "docs.html" and
 * "docs/<slug>.html", which static hosts serve at "/docs" and "/docs/<slug>".
 *
 * Browser-safe (no Bun / node APIs).
 */

import type { Urls } from "../types";

/** "docs" → "/docs/", "/" → "/", "/a//b" → "/a/b/". */
export const normalizeBase = (base = "/"): string => `/${base.trim()}/`.replace(/\/{2,}/g, "/");

const encodePath = (path: string): string => path.split("/").map(encodeURIComponent).join("/");

/** Starts with a URL scheme such as "https:", "mailto:" or "data:". */
export const hasScheme = (value: string): boolean => /^[a-z][a-z\d+.-]*:/i.test(value);

/** Has a scheme, is protocol-relative ("//cdn…"), or is an in-page link ("#top", "?q="). */
const isExternal = (target: string): boolean => hasScheme(target) || /^(?:\/\/|#|\?)/.test(target);

export const createUrls = (base = "/", options: { home?: boolean } = {}): Urls => {
  const root = normalizeBase(base);
  const hasHome = options.home ?? false;
  const searchRoot = hasHome ? `${root}docs` : root;
  return {
    base: root,
    hasHome,
    home: () => root,
    search: (query = "") => (query ? `${searchRoot}?${query}` : searchRoot),
    doc: (slug) => `${root}docs/${encodePath(slug)}`,
    file: (relPath) => `${root}files/${encodePath(relPath)}`,
    asset: (name) => `${root}assets/${name}`,
    link: (target) => {
      const value = target.trim();
      if (!value || isExternal(value)) return value;
      if (root !== "/" && value.startsWith(root)) return value; // already includes the base
      return root + value.replace(/^\.?\/+/, "");
    },
    searchIndex: `${root}search-index.json`,
  };
};

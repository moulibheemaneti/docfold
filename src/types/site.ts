/** What the page templates need: URLs, the resolved site settings and layout options. */

import type { SafeHtml } from "../shared/html";
import type { Library } from "./content";
import type { ResolvedHeader, ResolvedHome } from "./config";

export interface Urls {
  base: string;
  /** Whether the site has a home page in front of the documents list. */
  hasHome: boolean;
  /** The landing page: the home page, or the documents list when there's none. */
  home: () => string;
  /** The documents list with search and filters, optionally with a query string. */
  search: (query?: string) => string;
  doc: (slug: string) => string;
  file: (relPath: string) => string;
  asset: (name: string) => string;
  /**
   * A link or image path from the config, resolved against the base:
   * "/logo.svg" and "logo.svg" → base + "logo.svg"; "https://…", "mailto:…", "#top" stay as they are.
   */
  link: (target: string) => string;
  searchIndex: string;
  /** The dev server's WebSocket (live reload and build logs). */
  events: string;
  /**
   * Dev only: the Builds section. `builds()` is the list, `builds("apk")` a command's page, and
   * further segments address its runs: `builds("apk", "runs", runId, "cancel")`. Each segment is encoded.
   */
  builds: (...segments: string[]) => string;
}

export interface Site {
  title: string;
  description?: string;
  /** Shown on the documents list, e.g. "files/". */
  sourceLabel: string;
  urls: Urls;
  /** "dev" pages are rendered per request; "static" pages apply URL filters in the browser. */
  mode: "dev" | "static";
  /** Open pages reload when files change (dev server with `watch` on). */
  liveReload: boolean;
  /** Extra markup for <head>: fonts, theme overrides, user tags. Trusted (comes from the config). */
  head: string;
  /** Browser UI colour (mobile address bar). */
  themeColor: string;
  header: ResolvedHeader;
  home: false | Pick<ResolvedHome, "hero" | "features">;
  /**
   * Show the Builds section (the "Docs · Builds" nav and its stylesheet). Only on the dev server,
   * when the config declares builds, and only for pages sent to this computer.
   */
  builds: boolean;
}

/** Which kind of page is rendering; decides the sidebar, header search and current-page markers. */
export type PageKind = "home" | "search" | "doc" | "builds" | "other";

export interface LayoutOptions {
  site: Site;
  library: Library;
  title: string;
  content: SafeHtml;
  page: PageKind;
  activeSlug?: string;
  /** Meta description; defaults to the site's. */
  description?: string;
  /** Replaces the documents sidebar (the Builds pages list their commands instead). */
  sidebar?: SafeHtml;
  /** Extra module script for this page, e.g. the Builds page's own. */
  script?: string;
}

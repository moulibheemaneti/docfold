/** Parsed markdown documents, the loaded library and how it is loaded. */

import type { FolderNode } from "./tree";
import type { Urls } from "./site";

export interface Doc {
  /** Path relative to the docs folder, always "/"-separated, e.g. "ios/0001-disable-spm.md". */
  relPath: string;
  /** `relPath` without ".md"; unique key used in URLs. */
  slug: string;
  /** Page URL including the configured base, e.g. "/docs/ios/0001-disable-spm". */
  url: string;
  fileName: string;
  /** Folder relative to the docs folder ("" for files at the root). */
  folder: string;
  title: string;
  description?: string;
  /** Lower-cased, e.g. "accepted". */
  status?: string;
  /** ISO date, "YYYY-MM-DD". */
  date?: string;
  /** Lower-cased, de-duplicated. */
  tags: string[];
  /** Plain text of the rendered body, for search and snippets. */
  text: string;
  /** Plain text of every heading in the body, for search. */
  headings: string[];
  /** The body's H2 and H3 headings that have an id, in order: the page's "On this page" outline. */
  outline: Heading[];
  /** Front matter exactly as parsed. */
  meta: Record<string, unknown>;
  /** Markdown body (front matter removed). */
  body: string;
  /** Rendered body. */
  html: string;
  /** Non-markdown files this document links to (relative to the docs folder), copied by `build`. */
  assets: string[];
}

/** A heading inside a document's body. */
export interface Heading {
  /** 1–6, from <h1>–<h6>. */
  level: number;
  /** The heading's id attribute (the target of "#id" links). */
  id: string;
  /** Plain text, e.g. "The foo API" for "The `foo` **API**". */
  text: string;
}

/** What the browser needs for search: everything except the heavy or server-only fields. */
export type IndexedDoc = Omit<Doc, "meta" | "body" | "html" | "assets" | "outline">;

export interface Facet {
  name: string;
  count: number;
}

export interface Facets {
  tags: Facet[];
  statuses: Facet[];
}

export interface Library extends Facets {
  root: string;
  docs: Doc[];
  bySlug: Map<string, Doc>;
  tree: FolderNode;
  /**
   * Files the documents link to that may be served and published (relative to the docs folder).
   * Hidden paths and node_modules are left out; the files may not exist.
   */
  assets: ReadonlySet<string>;
}

export interface FrontMatter {
  data: Record<string, unknown>;
  body: string;
  error?: string;
}

export interface ResolvedLink {
  href: string;
  kind: "doc" | "file";
  /** Target path relative to the docs folder. */
  target: string;
}

export interface LoadOptions {
  urls?: Urls;
  /** Absolute folders to skip (e.g. the build output when it sits inside the docs folder). */
  ignore?: readonly string[];
}

export interface StoreOptions extends LoadOptions {
  /** Milliseconds to wait for more file events before telling listeners. Default: `DEFAULTS.debounce` (80). */
  debounce?: number;
}

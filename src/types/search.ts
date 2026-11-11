/** Search parameters (from the URL) and results. */

import type { IndexedDoc } from "./content";

export type SortKey = "relevance" | "newest" | "oldest" | "title";

/** "all" = a document must have every selected tag; "any" = at least one. */
export type TagMatch = "all" | "any";

export interface SearchParams {
  /** Free text. Words are AND-ed; "quoted phrases" are matched as a whole. */
  q: string;
  tags: string[];
  statuses: string[];
  /** Only documents inside this folder (and its sub-folders). */
  folder: string;
  match: TagMatch;
  sort: SortKey;
}

export interface SearchHit {
  doc: IndexedDoc;
  score: number;
  /** Plain-text excerpt around the first match (or the start of the document). */
  snippet: string;
}

export interface SearchResult {
  params: SearchParams;
  /** Lower-cased search terms, for highlighting. */
  terms: string[];
  hits: SearchHit[];
  /** Number of documents searched. */
  total: number;
}

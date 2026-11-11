/**
 * Matching, ranking and snippets: runs a search over the documents.
 *
 * Search runs on every keystroke in the browser, so the per-document work is
 * kept small: lower-cased fields are computed once per document and cached,
 * and each term's pattern is compiled once per search, not once per document.
 */

import { naturalCompare } from "../shared/natural-compare";
import { unique } from "./query";
import type { IndexedDoc, SearchHit, SearchParams, SearchResult, SortKey } from "../types";

/** Splits a query into lower-cased terms, keeping "quoted phrases" together. A stray `"` is ignored. */
export const tokenize = (query: string): string[] => {
  const terms: string[] = [];
  for (const match of query.toLowerCase().matchAll(/"([^"]+)"|([^\s"]+)/g)) {
    const term = (match[1] ?? match[2] ?? "").trim();
    if (term) terms.push(term);
  }
  return unique(terms);
};

export const matchesFilters = (doc: IndexedDoc, params: SearchParams): boolean => {
  if (params.folder && doc.folder !== params.folder && !doc.folder.startsWith(`${params.folder}/`)) return false;
  if (params.statuses.length && !(doc.status && params.statuses.includes(doc.status))) return false;
  if (params.tags.length) {
    const hasTag = (tag: string) => doc.tags.includes(tag);
    if (params.match === "any" ? !params.tags.some(hasTag) : !params.tags.every(hasTag)) return false;
  }
  return true;
};

export const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Lower-cased copies of the fields a search looks at. */
interface SearchFields {
  title: string;
  text: string;
  path: string;
  headings: string[];
  description: string;
}

// Loaded documents never change (a reload creates new objects), so their fields are cached per object.
const fieldsCache = new WeakMap<IndexedDoc, SearchFields>();

const fieldsOf = (doc: IndexedDoc): SearchFields => {
  let fields = fieldsCache.get(doc);
  if (!fields) {
    fields = {
      title: doc.title.toLowerCase(),
      text: doc.text.toLowerCase(),
      path: doc.relPath.toLowerCase(),
      headings: doc.headings.map((heading) => heading.toLowerCase()),
      description: doc.description?.toLowerCase() ?? "",
    };
    fieldsCache.set(doc, fields);
  }
  return fields;
};

/** A search term and its "starts a word" pattern. */
interface Term {
  text: string;
  startsWord: RegExp;
}

const compileTerms = (terms: readonly string[]): Term[] =>
  terms.map((text) => ({ text, startsWord: new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(text)}`, "u") }));

const countOccurrences = (haystack: string, needle: string): number => {
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1 && count < 50; i = haystack.indexOf(needle, i + needle.length)) count++;
  return count;
};

const scoreTerms = (doc: IndexedDoc, fields: SearchFields, terms: readonly Term[]): number | null => {
  let score = 0;
  for (const { text: term, startsWord } of terms) {
    let termScore = 0;
    if (fields.title === term) termScore += 20;
    else if (startsWord.test(fields.title)) termScore += 12;
    else if (fields.title.includes(term)) termScore += 8;

    if (doc.tags.includes(term)) termScore += 8;
    else if (doc.tags.some((tag) => tag.includes(term))) termScore += 4;

    if (fields.headings.some((heading) => heading.includes(term))) termScore += 4;
    if (fields.path.includes(term)) termScore += 2;
    if (doc.status === term) termScore += 2;
    if (fields.description.includes(term)) termScore += 2;

    const hits = countOccurrences(fields.text, term);
    if (hits) termScore += 1 + Math.min(hits, 10) * 0.25;

    if (termScore === 0) return null;
    score += termScore;
  }
  return score;
};

/**
 * Scores a document against every term. Returns null when any term is missing
 * (all terms must appear somewhere: title, tags, headings, path, status or body).
 */
export const scoreDoc = (doc: IndexedDoc, terms: readonly string[]): number | null =>
  scoreTerms(doc, fieldsOf(doc), compileTerms(terms));

const truncate = (text: string, length: number): string => {
  if (text.length <= length) return text;
  const cut = text.lastIndexOf(" ", length);
  return `${text.slice(0, cut > length * 0.6 ? cut : length).trimEnd()} …`;
};

/**
 * An excerpt of `text` around the earliest term, roughly `length` characters long.
 * `lower` is `text` lower-cased, when the caller already has it.
 */
export const makeSnippet = (text: string, terms: readonly string[], length = 180, lower = text.toLowerCase()): string => {
  let first = -1;
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index !== -1 && (first === -1 || index < first)) first = index;
  }
  if (first === -1) return truncate(text, length);

  let start = Math.max(0, first - 60);
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space !== -1 && space < first) start = space + 1;
  }
  let end = Math.min(text.length, start + length);
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > first) end = space;
  }
  return `${start > 0 ? "… " : ""}${text.slice(start, end).trim()}${end < text.length ? " …" : ""}`;
};

const byTitle = (a: SearchHit, b: SearchHit) =>
  naturalCompare(a.doc.title, b.doc.title) || naturalCompare(a.doc.relPath, b.doc.relPath);

/** Undated documents always go last. */
const byDate = (direction: 1 | -1) => (a: SearchHit, b: SearchHit) => {
  if (a.doc.date !== b.doc.date) {
    if (!a.doc.date) return 1;
    if (!b.doc.date) return -1;
    return direction * a.doc.date.localeCompare(b.doc.date);
  }
  return naturalCompare(a.doc.relPath, b.doc.relPath);
};

const COMPARATORS: Record<SortKey, (a: SearchHit, b: SearchHit) => number> = {
  relevance: (a, b) => b.score - a.score || byDate(-1)(a, b),
  newest: byDate(-1),
  oldest: byDate(1),
  title: byTitle,
};

export const searchDocs = (docs: readonly IndexedDoc[], params: SearchParams): SearchResult => {
  const terms = tokenize(params.q);
  const compiled = compileTerms(terms);
  const hits: SearchHit[] = [];

  for (const doc of docs) {
    if (!matchesFilters(doc, params)) continue;
    if (!compiled.length) {
      hits.push({ doc, score: 0, snippet: doc.description || makeSnippet(doc.text, terms) });
      continue;
    }
    const fields = fieldsOf(doc);
    const score = scoreTerms(doc, fields, compiled);
    if (score !== null) hits.push({ doc, score, snippet: makeSnippet(doc.text, terms, undefined, fields.text) });
  }

  hits.sort(COMPARATORS[params.sort]);
  return { params, terms, hits, total: docs.length };
};

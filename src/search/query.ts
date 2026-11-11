/**
 * Search parameters <-> URL query strings (`?q=&tag=a&status=&folder=&match=&sort=`).
 */

import type { SearchParams, SortKey } from "../types";

export const SORT_KEYS: readonly SortKey[] = ["relevance", "newest", "oldest", "title"];

// Shared by every `{ ...DEFAULT_PARAMS, … }` copy, so it must never change: frozen, lists included.
const NONE: string[] = [];
Object.freeze(NONE);

export const DEFAULT_PARAMS: SearchParams = Object.freeze({
  q: "",
  tags: NONE,
  statuses: NONE,
  folder: "",
  match: "all",
  sort: "relevance",
});

export const unique = (values: string[]): string[] => [...new Set(values)];

const listParam = (query: URLSearchParams, key: string): string[] =>
  unique(
    query
      .getAll(key)
      .flatMap((value) => value.split(","))
      .map((value) => value.trim().toLowerCase().replace(/^#/, ""))
      .filter(Boolean),
  );

/** Reads `?q=&tag=a&tag=b&status=&folder=&match=any&sort=newest` (comma lists also work: `tag=a,b`). */
export const parseSearchParams = (query: URLSearchParams): SearchParams => {
  const sort = query.get("sort") as SortKey | null;
  return {
    q: (query.get("q") ?? "").trim(),
    tags: listParam(query, "tag"),
    statuses: listParam(query, "status"),
    folder: (query.get("folder") ?? "").trim().replace(/^\/+|\/+$/g, ""),
    match: query.get("match") === "any" ? "any" : "all",
    sort: sort && SORT_KEYS.includes(sort) ? sort : "relevance",
  };
};

/** Builds a query string with only the non-default values (no leading "?"). */
export const toQueryString = (params: Partial<SearchParams>): string => {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  for (const tag of params.tags ?? []) query.append("tag", tag);
  for (const status of params.statuses ?? []) query.append("status", status);
  if (params.folder) query.set("folder", params.folder);
  if (params.match && params.match !== DEFAULT_PARAMS.match) query.set("match", params.match);
  if (params.sort && params.sort !== DEFAULT_PARAMS.sort) query.set("sort", params.sort);
  return query.toString();
};

/** Adds the value if missing, removes it if present. */
export const toggle = (values: readonly string[], value: string): string[] =>
  values.includes(value) ? values.filter((v) => v !== value) : [...values, value];

/** Query parameters that belong to the documents list (see parseSearchParams). */
export const SEARCH_KEYS = ["q", "tag", "status", "folder", "match", "sort"];

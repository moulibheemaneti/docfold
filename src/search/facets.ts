/**
 * Tag and status counts for the filter chips.
 */

import { naturalCompare } from "../shared/natural-compare";
import type { Facet, Facets, IndexedDoc } from "../types";

const countFacet = (docs: readonly IndexedDoc[], pick: (doc: IndexedDoc) => readonly string[]): Facet[] => {
  const counts = new Map<string, number>();
  for (const doc of docs) for (const name of pick(doc)) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || naturalCompare(a.name, b.name));
};

export const countFacets = (docs: readonly IndexedDoc[]): Facets => {
  return {
    tags: countFacet(docs, (doc) => doc.tags),
    statuses: countFacet(docs, (doc) => (doc.status ? [doc.status] : [])),
  };
};

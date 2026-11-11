/**
 * Natural, case-insensitive ordering, shared by the sidebar and search.
 *
 * Browser-safe (no Bun / node APIs).
 */

// One collator for every comparison: `localeCompare(b, locale, options)` builds a new one per call.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Natural, case-insensitive ordering so "2-foo" sorts before "10-bar". */
export const naturalCompare = (a: string, b: string): number => collator.compare(a, b);

/**
 * Page addresses: how a markdown file's path becomes the "<slug>" in "<base>docs/<slug>".
 *
 *   CONTRIBUTING.md          → contributing
 *   Guides/My_Notes.md       → guides/my-notes
 *   notes/Release Notes.md   → notes/release-notes
 *
 * Every segment, folders included, is lower-cased, and spaces and underscores become one "-".
 * Everything else is kept as it is (`urls.doc` percent-encodes it).
 *
 * Browser-safe (no Bun / node APIs).
 */

/**
 * One path segment: "My_Notes" → "my-notes". A run of spaces and underscores, along with any
 * hyphens next to it, becomes a single "-" ("Q&A - 2026" → "q&a-2026"); "a--b" stays as it is.
 */
const slugifySegment = (segment: string): string => segment.toLowerCase().replace(/[-\s_]*[\s_][-\s_]*/g, "-");

/** A "/"-separated path with every segment slugified: "Guides/Team_Notes" → "guides/team-notes". */
export const slugifyPath = (path: string): string => path.split("/").map(slugifySegment).join("/");

/** A markdown file's path (relative to the docs folder) → its slug: "Guides/My_Notes.md" → "guides/my-notes". */
export const toSlug = (relPath: string): string => slugifyPath(relPath.replace(/\.md$/i, ""));

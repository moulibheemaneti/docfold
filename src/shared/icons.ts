/**
 * Inline SVG icons used by the header, sidebar folders and search box.
 * (The sidebar's file icon is drawn in CSS: it would repeat once per file on every page.)
 *
 * Browser-safe (no Bun / node APIs).
 */

import { raw } from "./html";

export const ICONS = {
  menu: raw(
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  ),
  search: raw(
    '<svg class="input-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  ),
  folder: raw(
    '<svg class="tree-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  ),
};

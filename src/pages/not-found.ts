/**
 * The 404 page.
 */

import { html } from "../shared/html";
import { layout } from "./layout";
import type { Library, Site } from "../types";

export const notFoundPage = (site: Site, library: Library, path?: string): string => {
  const content = html`<div class="page not-found">
    <h1>Page not found</h1>
    <p>${path ? html`Nothing lives at <code>${path}</code>. ` : ""}Pick a file from the sidebar or <a href="${site.urls.search()}">search all documents</a>.</p>
  </div>`;
  return layout({ site, library, title: "Not found", content, page: "other" });
};

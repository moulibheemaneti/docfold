/**
 * The documents list: search box, tag/status filters and results.
 *
 * Browser-safe: the client bundle reuses `searchPanel` and `resultsFragment` to re-render results.
 */

import { toggle } from "../search";
import { html, raw, type SafeHtml } from "../shared/html";
import { ICONS } from "../shared/icons";
import { layout } from "./layout";
import { dateLabel, highlight, plural, searchUrl, statusBadge } from "./parts";
import type { Facet, Facets, Library, SearchParams, SearchResult, Site, Urls } from "../types";

const facetChips = (name: "tag" | "status", facets: readonly Facet[], selected: readonly string[]): SafeHtml => {
  // Keep selected values visible even if no document uses them any more.
  const all = [
    ...facets,
    ...selected.filter((value) => !facets.some((f) => f.name === value)).map((value) => ({ name: value, count: 0 })),
  ];
  return html`<div class="chips">${all.map(
    (facet) => html`<label class="chip"${name === "status" ? html` data-status="${facet.name}"` : ""}>
      <input type="checkbox" name="${name}" value="${facet.name}"${selected.includes(facet.name) ? raw(" checked") : ""}>
      <span>${name === "tag" ? `#${facet.name}` : facet.name}</span><span class="chip-count">${facet.count}</span>
    </label>`,
  )}</div>`;
};

const filterForm = (facets: Facets, params: SearchParams, urls: Urls): SafeHtml => {
  const sortOptions: [SearchParams["sort"], string][] = [
    ["relevance", "Best match"],
    ["newest", "Newest first"],
    ["oldest", "Oldest first"],
    ["title", "Title A–Z"],
  ];

  return html`<form id="search-form" class="filters" action="${urls.search()}" method="get" role="search">
    <div class="search-row">
      <label class="input-wrap search-main">
        ${ICONS.search}
        <span class="sr-only">Search documents</span>
        <input type="search" name="q" value="${params.q}" placeholder="Search titles, tags, headings and content…" autocomplete="off" data-shortcut>
        <kbd class="shortcut-hint" aria-hidden="true">/</kbd>
      </label>
      <label class="select-wrap">
        <span class="sr-only">Sort by</span>
        <select name="sort">${sortOptions.map(
          ([value, label]) => html`<option value="${value}"${params.sort === value ? raw(" selected") : ""}>${label}</option>`,
        )}</select>
      </label>
    </div>

    ${
      params.folder
        ? html`<div class="active-folder">
            <input type="hidden" name="folder" value="${params.folder}">
            In folder <code>${params.folder}/</code>
            <a href="${searchUrl(urls, { ...params, folder: "" })}" aria-label="Search all folders">✕</a>
          </div>`
        : ""
    }

    ${
      facets.tags.length || params.tags.length
        ? html`<fieldset class="facet">
            <legend>Tags</legend>
            ${facetChips("tag", facets.tags, params.tags)}
            <div class="match-mode" role="radiogroup" aria-label="Tag matching">
              <span>Match</span>
              <label><input type="radio" name="match" value="all"${params.match === "all" ? raw(" checked") : ""}> all selected tags</label>
              <label><input type="radio" name="match" value="any"${params.match === "any" ? raw(" checked") : ""}> any selected tag</label>
            </div>
          </fieldset>`
        : ""
    }

    ${
      facets.statuses.length || params.statuses.length
        ? html`<fieldset class="facet">
            <legend>Status</legend>
            ${facetChips("status", facets.statuses, params.statuses)}
          </fieldset>`
        : ""
    }

    <div class="filter-actions">
      <button type="submit" class="button no-js-only">Apply filters</button>
      <a class="button-link" href="${urls.search()}">Clear all</a>
    </div>
  </form>`;
};

const resultCard = (hit: SearchResult["hits"][number], result: SearchResult, urls: Urls): SafeHtml => {
  const { doc } = hit;
  const { params, terms } = result;
  return html`<li class="result">
    <div class="result-head">
      <h2 class="result-title"><a href="${doc.url}">${highlight(doc.title, terms)}</a></h2>
      ${statusBadge(doc.status)}
    </div>
    <div class="result-path">${doc.relPath}</div>
    ${hit.snippet ? html`<p class="result-snippet">${highlight(hit.snippet, terms)}</p>` : ""}
    <div class="meta">
      ${dateLabel(doc.date)}
      ${doc.tags.map(
        (tag) =>
          html`<a class="tag${params.tags.includes(tag) ? " is-active" : ""}" data-tag="${tag}" href="${searchUrl(urls, { ...params, tags: toggle(params.tags, tag) })}">${tag}</a>`,
      )}
    </div>
  </li>`;
};

/** The results list; live search swaps just this part while the reader types. */
export const resultsFragment = (result: SearchResult, urls: Urls): SafeHtml => {
  const { hits, total, params } = result;
  const filtered = !!(params.q || params.tags.length || params.statuses.length || params.folder);

  const summary = filtered
    ? html`<strong>${plural(hits.length, "result")}</strong> of ${plural(total, "document")}`
    : html`<strong>${plural(total, "document")}</strong>`;

  const body = hits.length
    ? html`<ol class="result-list" role="list">${hits.map((hit) => resultCard(hit, result, urls))}</ol>`
    : html`<div class="empty-state">
        <p><strong>No documents match.</strong></p>
        <p>${filtered ? html`Try fewer words, other tags, or <a href="${urls.search()}">clear all filters</a>.` : "Add markdown files to the docs folder and they will show up here."}</p>
      </div>`;

  return html`<p class="results-summary">${summary}</p>${body}`;
};

/** Filters + results: everything inside #search-root. */
export const searchPanel = (facets: Facets, result: SearchResult, urls: Urls): SafeHtml => {
  return html`${filterForm(facets, result.params, urls)}
    <section id="results" class="results" aria-live="polite">${resultsFragment(result, urls)}</section>`;
};

/** The documents list: search + filters. At the site root, or at "docs" when there's a home page. */
export const searchPage = (site: Site, library: Library, result: SearchResult): string => {
  const content = html`<div class="page">
    <header class="page-header">
      <h1>Documents</h1>
      <p>Everything in <code>${site.sourceLabel}</code>. Search the text or narrow it down by tag and status.</p>
    </header>
    <div id="search-root">${searchPanel(library, result, site.urls)}</div>
  </div>`;
  const title = result.params.q ? `“${result.params.q}”` : site.urls.hasHome ? "Documents" : site.title;
  return layout({ site, library, title, content, page: "search" });
};

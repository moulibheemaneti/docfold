/**
 * A document page: breadcrumbs, title, meta and the rendered markdown.
 */

import { html, raw, type SafeHtml } from "../shared/html";
import type { Doc, Library, Site, Urls } from "../types";
import { layout } from "./layout";
import { dateLabel, searchUrl, statusBadge } from "./parts";

const breadcrumbs = (doc: Doc, urls: Urls): SafeHtml => {
  const parts = doc.folder ? doc.folder.split("/") : [];
  return html`<nav class="breadcrumbs" aria-label="Breadcrumb">
    <a href="${urls.search()}">Docs</a>${parts.map((part, i) => {
    const folder = parts.slice(0, i + 1).join("/");
    return html`<span aria-hidden="true">/</span><a href="${searchUrl(urls, { folder })}" title="${`Search in ${folder}/`}">${part}</a>`;
  })}<span aria-hidden="true">/</span><span>${doc.fileName}</span>
  </nav>`;
};

export const docPage = (site: Site, library: Library, doc: Doc): string => {
  const { urls } = site;
  const content = html`<article class="doc">
    ${breadcrumbs(doc, urls)}
    <header class="doc-header">
      <h1>${doc.title}</h1>
      ${doc.description ? html`<p class="lead">${doc.description}</p>` : ""}
      <div class="meta">
        ${statusBadge(doc.status, doc.status ? searchUrl(urls, { statuses: [doc.status] }) : undefined)}
        ${dateLabel(doc.date)}
        ${doc.tags.map((tag) => html`<a class="tag" href="${searchUrl(urls, { tags: [tag] })}">${tag}</a>`)}
      </div>
    </header>
    <div class="prose">${raw(doc.html)}</div>
    <footer class="doc-footer">Source: <code>${site.sourceLabel}${doc.relPath}</code></footer>
  </article>`;
  return layout({ site, library, title: doc.title, content, page: "doc", activeSlug: doc.slug, description: doc.description });
};

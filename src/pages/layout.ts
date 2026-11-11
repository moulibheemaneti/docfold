/**
 * The page shell: <head>, the header (logo, name, search, action button), sidebar and main area.
 */

import { html, raw, type SafeHtml } from "../shared/html";
import { ICONS } from "../shared/icons";
import { sidebar } from "../sidebar";
import { image } from "./parts";
import type { LayoutOptions, PageKind, Site } from "../types";

/** Logo + name + badge on the left, search after it, the one action button on the right. */
const topbar = (site: Site, page: PageKind): SafeHtml => {
  const { urls, header } = site;
  // Never leave the brand link empty: without a logo the name is required.
  const name = header.name || (header.logo ? "" : site.title);
  const logo = header.logo ? image(header.logo, urls, "brand-logo", name ? "" : (header.logo.alt ?? site.title)) : "";
  const actionHref = header.action ? (header.action.link ? urls.link(header.action.link) : urls.search()) : "";

  return html`<header class="topbar">
    ${
      page === "home"
        ? ""
        : html`<button class="nav-toggle" type="button" aria-controls="sidebar" aria-expanded="false" aria-label="Show files">${ICONS.menu}</button>`
    }
    <a class="brand" href="${urls.home()}"${page === "home" ? raw(' aria-current="page"') : ""}>${logo}${name ? html`<span class="brand-name">${name}</span>` : ""}${header.tag ? html`<span class="brand-tag">${header.tag}</span>` : ""}</a>
    ${
      // The documents list has its own, bigger search box.
      page === "search"
        ? ""
        : html`<form class="header-search" action="${urls.search()}" method="get" role="search">
            <label class="input-wrap">
              ${ICONS.search}
              <span class="sr-only">Search documents</span>
              <input type="search" name="q" placeholder="Search docs…" data-shortcut>
              <kbd class="shortcut-hint" aria-hidden="true">/</kbd>
            </label>
          </form>`
    }
    ${header.action ? html`<a class="button topbar-action" href="${actionHref}">${header.action.text}</a>` : ""}
  </header>`;
};

export const layout = ({ site, library, title, content, page, activeSlug, description = site.description }: LayoutOptions): string => {
  const { urls } = site;
  const withSidebar = page !== "home";
  return html`<!doctype html>
<html lang="en" data-base="${urls.base}" data-mode="${site.mode}" data-page="${page}"${urls.hasHome ? raw(" data-home") : ""}${site.liveReload ? raw(" data-live-reload") : ""}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="${site.themeColor}">
  <meta name="generator" content="docfold">
  ${description ? html`<meta name="description" content="${description}">` : ""}
  <title>${title === site.title ? title : `${title} · ${site.title}`}</title>
  <link rel="stylesheet" href="${urls.asset("styles.css")}">
  ${raw(site.head)}
  <script>document.documentElement.classList.add("js")</script>
  <script type="module" src="${urls.asset("app.js")}"></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  ${topbar(site, page)}
  <div class="shell${withSidebar ? "" : " is-wide"}">
    ${withSidebar ? html`${sidebar(library, urls, activeSlug, page === "search")}<div class="backdrop" data-nav-close></div>` : ""}
    <main class="main" id="main">${content}</main>
  </div>
</body>
</html>`.value;
};

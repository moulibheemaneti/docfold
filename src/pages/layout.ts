/**
 * The page shell: <head>, the header (logo, name, sections, search, action button), sidebar and main area.
 */

import { html, raw, type SafeHtml } from "../shared/html";
import { ICONS } from "../shared/icons";
import { sidebar } from "../sidebar";
import { image } from "./parts";
import type { LayoutOptions, PageKind, Site } from "../types";

/** "Docs · Builds" (dev server with builds, on this computer only), marking the section being viewed. */
const sections = (site: Site, page: PageKind, activeSlug: string | undefined): SafeHtml | "" => {
  if (!site.builds) return "";
  const { urls } = site;
  const docs = page === "search" ? "page" : page === "doc" || page === "other" ? "true" : "";
  const builds = page === "builds" ? (activeSlug === undefined ? "page" : "true") : "";
  const link = (href: string, text: string, current: string) =>
    html`<a class="section-link" href="${href}"${current ? html` aria-current="${current}"` : ""}>${text}</a>`;
  return html`<nav class="sections" aria-label="Sections">${link(urls.search(), "Docs", docs)}${link(urls.builds(), "Builds", builds)}</nav>`;
};

/** Logo + name + badge on the left, then the sections nav and search, the one action button on the right. */
const topbar = (site: Site, page: PageKind, activeSlug: string | undefined): SafeHtml => {
  const { urls, header } = site;
  // Never leave the brand link empty: without a logo the name is required.
  const name = header.name || (header.logo ? "" : site.title);
  const logo = header.logo ? image(header.logo, urls, "brand-logo", name ? "" : (header.logo.alt ?? site.title)) : "";
  const actionHref = header.action ? (header.action.link ? urls.link(header.action.link) : urls.search()) : "";

  return html`<header class="topbar">
    ${
      page === "home"
        ? ""
        : html`<button class="nav-toggle" type="button" aria-controls="sidebar" aria-expanded="false" aria-label="${`Show ${page === "builds" ? "builds" : "files"}`}" data-nav-label="${page === "builds" ? "builds" : "files"}">${ICONS.menu}</button>`
    }
    <a class="brand" href="${urls.home()}"${page === "home" ? raw(' aria-current="page"') : ""}>${logo}${name ? html`<span class="brand-name">${name}</span>` : ""}${header.tag ? html`<span class="brand-tag">${header.tag}</span>` : ""}</a>
    ${sections(site, page, activeSlug)}
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

export const layout = (options: LayoutOptions): string => {
  const { site, library, title, content, page, activeSlug, description = site.description, script } = options;
  const { urls } = site;
  const withSidebar = page !== "home";
  const nav = options.sidebar ?? sidebar(library, urls, activeSlug, page === "search");
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
  ${site.builds ? html`<link rel="stylesheet" href="${urls.asset("builds.css")}">` : ""}
  ${raw(site.head)}
  <script>document.documentElement.classList.add("js")</script>
  <script type="module" src="${urls.asset("app.js")}"></script>
  ${script ? html`<script type="module" src="${script}"></script>` : ""}
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  ${topbar(site, page, activeSlug)}
  <div class="shell${withSidebar ? "" : " is-wide"}">
    ${withSidebar ? html`${nav}<div class="backdrop" data-nav-close></div>` : ""}
    <main class="main" id="main">${content}</main>
  </div>
</body>
</html>`.value;
};

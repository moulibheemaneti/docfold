/**
 * The sidebar: a filter box and every folder, sub-folder and markdown file in the docs folder.
 *
 * Browser-safe (no Bun / node APIs).
 */

import { html, raw, type SafeHtml } from "../shared/html";
import { ICONS } from "../shared/icons";
import { folderContains } from "./tree";
import type { FileNode, FolderNode, Library, Urls } from "../types";

/**
 * One file. Every page repeats the whole tree, so this markup is kept lean: one line, and the
 * file icon is drawn by CSS (`.tree-file a::before`) rather than an inline <svg> per file.
 */
const renderFile = (node: FileNode, urls: Urls, activeSlug: string | undefined): SafeHtml => {
  const current = node.slug === activeSlug;
  return html`<li class="tree-file" data-search="${`${node.title} ${node.name}`.toLowerCase()}"><a href="${urls.doc(node.slug)}" title="${node.path}"${current ? raw(' aria-current="page"') : ""}><span class="tree-label">${node.title}</span></a></li>`;
};

/** Folders render open; the client re-collapses the ones the reader closed earlier (except the current file's). */
const renderFolder = (node: FolderNode, urls: Urls, activeSlug: string | undefined): SafeHtml => {
  const holdsCurrent = folderContains(node, activeSlug);
  return html`<li class="tree-folder" data-path="${node.path}" data-search="${node.name.toLowerCase()}"${holdsCurrent ? raw(" data-current") : ""}>
    <details open>
      <summary title="${node.path}">${ICONS.folder}<span class="tree-label">${node.name}</span><span class="tree-count">${node.docCount}</span></summary>
      ${renderChildren(node, urls, activeSlug)}
    </details>
  </li>`;
};

const renderChildren = (folder: FolderNode, urls: Urls, activeSlug: string | undefined): SafeHtml => {
  return html`<ul class="tree" role="list">${folder.children.map((child) =>
    child.kind === "folder" ? renderFolder(child, urls, activeSlug) : renderFile(child, urls, activeSlug),
  )}</ul>`;
};

export const sidebar = (library: Library, urls: Urls, activeSlug: string | undefined, onSearchPage: boolean): SafeHtml => {
  const tree = library.docs.length
    ? renderChildren(library.tree, urls, activeSlug)
    : html`<p class="sidebar-note">No markdown files found.</p>`;

  return html`<aside class="sidebar" id="sidebar" aria-label="Files">
    <div class="sidebar-filter">
      <label class="input-wrap">
        ${ICONS.search}
        <span class="sr-only">Filter files</span>
        <input id="nav-filter" type="search" placeholder="Filter files…" autocomplete="off" spellcheck="false">
      </label>
    </div>
    <nav class="sidebar-tree">
      <a class="sidebar-home" href="${urls.search()}"${onSearchPage ? raw(' aria-current="page"') : ""}>All documents <span class="tree-count">${library.docs.length}</span></a>
      ${tree}
      <p class="sidebar-note" id="nav-empty" hidden>No files match.</p>
    </nav>
  </aside>`;
};

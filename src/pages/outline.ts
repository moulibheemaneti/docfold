/**
 * "On this page": a document's headings as a nested list of links. A sticky column on the right
 * on wide screens; a collapsible box above the text on narrow ones (see the client script).
 *
 * Browser-safe (no Bun / node APIs).
 */

import { html, type SafeHtml } from "../shared/html";
import type { Heading } from "../types";

/** Fewer headings than this and the page gets no outline: one link isn't worth a column. */
export const OUTLINE_MIN_HEADINGS = 2;

interface OutlineNode {
  heading: Heading;
  children: OutlineNode[];
}

/** Nests each heading under the closest heading before it with a lower level (H3s under their H2). */
const nest = (headings: readonly Heading[]): OutlineNode[] => {
  const roots: OutlineNode[] = [];
  const open: OutlineNode[] = [];
  for (const heading of headings) {
    const node: OutlineNode = { heading, children: [] };
    while (open.length && open[open.length - 1]!.heading.level >= heading.level) open.pop();
    (open[open.length - 1]?.children ?? roots).push(node);
    open.push(node);
  }
  return roots;
};

const renderList = (nodes: readonly OutlineNode[], className?: string): SafeHtml =>
  html`<ul${className ? html` class="${className}"` : ""} role="list">${nodes.map(
    ({ heading, children }) =>
      html`<li><a href="${`#${heading.id}`}">${heading.text}</a>${children.length ? renderList(children) : ""}</li>`,
  )}</ul>`;

/**
 * The outline, or "" when there are too few headings. No ids on the markup: they could clash with
 * the heading ids generated from the document's own text.
 */
export const outline = (headings: readonly Heading[]): SafeHtml | "" => {
  if (headings.length < OUTLINE_MIN_HEADINGS) return "";
  return html`<nav class="outline" aria-label="On this page">
      <p class="outline-title" aria-hidden="true">On this page</p>
      <button class="outline-toggle" type="button" aria-expanded="false">On this page</button>
      ${renderList(nest(headings), "outline-list")}
    </nav>`;
};

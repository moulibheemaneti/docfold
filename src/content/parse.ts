/**
 * Parses one markdown file into a document: title, headings, rendered HTML, rewritten links.
 */

import { posix } from "node:path";
import { htmlToText } from "../shared/html";
import { warn } from "../shared/log";
import { createUrls, hasScheme } from "../shared/urls";
import { humanize, normalizeDate, normalizeTags, optionalString, splitFrontMatter } from "./front-matter";
import type { Doc, IndexedDoc, ResolvedLink, Urls } from "../types";

const MARKDOWN_OPTIONS: Bun.markdown.Options = {
  headings: { ids: true, autolink: true },
  autolinks: true,
};

export const DEFAULT_URLS = createUrls("/");

/**
 * A leading ATX heading: "# Title", optionally closed by " ##". The closing hashes need a space
 * before them (CommonMark), so "# Learn C#" keeps its "#".
 */
const LEADING_H1 = /^\s*#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*(?:\r?\n|$)/;

/**
 * Plain text of a heading's inline markdown: "The `foo` **API**" → "The foo API". Rendered as a
 * heading, not a paragraph, so text like "1. Intro" isn't read as a list.
 */
const headingText = (markdown: string): string => htmlToText(Bun.markdown.html(`# ${markdown}`)) || markdown;

/**
 * Makes relative links inside a document work in the browser:
 * `./other.md#x` → `<base>docs/<folder>/other#x`, `./diagram.png` → `<base>files/<folder>/diagram.png`.
 * Absolute URLs, anchors and anything pointing outside the docs folder are left alone (null).
 */
export const resolveRelativeUrl = (value: string, fromRelPath: string, urls: Urls = DEFAULT_URLS): ResolvedLink | null => {
  if (hasScheme(value) || /^[/#]/.test(value)) return null;
  const [, pathPart = "", suffix = ""] = value.match(/^([^?#]*)([\s\S]*)$/) ?? [];
  if (!pathPart) return null;

  let decoded = pathPart;
  try {
    decoded = decodeURI(pathPart);
  } catch {
    // keep the raw value
  }

  const target = posix.normalize(posix.join(posix.dirname(fromRelPath), decoded));
  if (target === ".." || target.startsWith("../") || target.endsWith("/")) return null;
  if (/\.md$/i.test(target)) return { href: urls.doc(target.replace(/\.md$/i, "")) + suffix, kind: "doc", target };
  return { href: urls.file(target) + suffix, kind: "file", target };
};

const rewriteRelativeUrls = (markup: string, relPath: string, urls: Urls, assets: Set<string>): string => {
  const rewrite = (attr: string) => ({
    element: (el: HTMLRewriterTypes.Element) => {
      const value = el.getAttribute(attr);
      const resolved = value ? resolveRelativeUrl(value, relPath, urls) : null;
      if (!resolved) return;
      el.setAttribute(attr, resolved.href);
      if (resolved.kind === "file") assets.add(resolved.target);
    },
  });
  return new HTMLRewriter().on("a[href]", rewrite("href")).on("img[src]", rewrite("src")).transform(markup);
};

export const parseDoc = (relPath: string, source: string, urls: Urls = DEFAULT_URLS): Doc => {
  const { data, body: rawBody, error } = splitFrontMatter(source);
  if (error) warn(`Could not parse front matter in ${relPath}: ${error}`);

  const slug = relPath.replace(/\.md$/i, "");
  const fileName = posix.basename(relPath);
  const folder = posix.dirname(relPath) === "." ? "" : posix.dirname(relPath);

  // No `title` in front matter? Use a leading "# Heading" (and don't render it twice), else the file name.
  let title = optionalString(data.title);
  let body = rawBody;
  if (!title) {
    const h1 = body.match(LEADING_H1);
    if (h1?.[1]) {
      title = headingText(h1[1]);
      body = body.slice(h1[0].length);
    }
  }

  const assets = new Set<string>();
  const markup = rewriteRelativeUrls(Bun.markdown.html(body, MARKDOWN_OPTIONS), relPath, urls, assets);
  const headings = [...markup.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g)].map((m) => htmlToText(m[1] ?? ""));

  return {
    relPath,
    slug,
    url: urls.doc(slug),
    fileName,
    folder,
    title: title ?? humanize(fileName),
    description: optionalString(data.description) ?? optionalString(data.summary),
    status: optionalString(data.status)?.toLowerCase(),
    date: normalizeDate(data.date),
    tags: normalizeTags(data.tags ?? data.tag),
    text: htmlToText(markup),
    headings,
    meta: data,
    body,
    html: markup,
    assets: [...assets],
  };
};

/** The subset of a document that the browser downloads for search. */
export const toIndexedDoc = (doc: Doc): IndexedDoc => {
  const { meta: _meta, body: _body, html: _html, assets: _assets, ...indexed } = doc;
  return indexed;
};

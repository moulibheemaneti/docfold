/**
 * Small pieces several pages share: dates, status badges, search highlighting, images.
 *
 * Browser-safe (no Bun / node APIs).
 */

import { escapeRegExp, toQueryString } from "../search";
import { escapeHtml, html, raw, type SafeHtml } from "../shared/html";
import type { ImageConfig, SearchParams, Urls } from "../types";

const DATE_FORMAT = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

const formatDate = (iso: string): string => {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : DATE_FORMAT.format(date);
};

export const searchUrl = (urls: Urls, params: Partial<SearchParams>): string => urls.search(toQueryString(params));

/** An <img>, or a <picture> that swaps to `dark` in dark mode. */
export const image = (img: ImageConfig, urls: Urls, className: string, alt = img.alt ?? ""): SafeHtml => {
  const tag = html`<img class="${className}" src="${urls.link(img.src)}" alt="${alt}">`;
  return img.dark
    ? html`<picture><source srcset="${urls.link(img.dark)}" media="(prefers-color-scheme: dark)">${tag}</picture>`
    : tag;
};

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Escapes `text` and wraps every occurrence of a search term in <mark>. */
export const highlight = (text: string, terms: readonly string[]): SafeHtml => {
  if (!terms.length) return html`${text}`;
  const pattern = new RegExp(
    `(${[...terms].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")})`,
    "gi",
  );
  return raw(
    text
      .split(pattern)
      .map((part, i) => (i % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)))
      .join(""),
  );
};

export const statusBadge = (status: string | undefined, href?: string): SafeHtml | "" => {
  if (!status) return "";
  return href
    ? html`<a class="badge" data-status="${status}" href="${href}">${status}</a>`
    : html`<span class="badge" data-status="${status}">${status}</span>`;
};

export const dateLabel = (date: string | undefined): SafeHtml | "" =>
  date ? html`<time datetime="${date}">${formatDate(date)}</time>` : "";

/**
 * Tiny HTML templating helper.
 *
 * `html` is a tagged template that escapes every interpolated value unless it
 * is already `SafeHtml` (another `html` result, or something wrapped in `raw`).
 * That keeps front-matter values like titles and tags from injecting markup.
 */

import type { HtmlValue } from "../types";

export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

/** Marks a string as trusted HTML (e.g. the output of the markdown renderer). */
export const raw = (value: string): SafeHtml => new SafeHtml(value);

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };

/** Plain JS (no Bun API) so the same templates also run in the browser bundle. */
export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

const render = (value: HtmlValue): string => {
  if (value === null || value === undefined || typeof value === "boolean") return "";
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  return escapeHtml(String(value));
};

export const html = (strings: TemplateStringsArray, ...values: HtmlValue[]): SafeHtml => {
  let out = strings[0] ?? "";
  values.forEach((value, i) => {
    out += render(value) + (strings[i + 1] ?? "");
  });
  return new SafeHtml(out);
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** `&#…;` / `&#x…;` → the character; like browsers, 0 and anything past U+10FFFF become U+FFFD. */
const decodeNumericEntity = (code: string): string => {
  const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "�";
};

/** Turns rendered HTML back into plain text (used for search and snippets). */
export const htmlToText = (markup: string): string => {
  return markup
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    // Block-level tags separate words; inline ones (<code>, <a>, <strong>…) must not add spaces.
    .replace(/<\/?(?:p|div|br|hr|h[1-6]|li|ul|ol|dl|dt|dd|blockquote|pre|table|thead|tbody|tr|th|td|details|summary|figure|figcaption|section|article)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) =>
      code[0] === "#" ? decodeNumericEntity(code) : (ENTITIES[code.toLowerCase()] ?? entity),
    )
    .replace(/\s+/g, " ")
    .trim();
};

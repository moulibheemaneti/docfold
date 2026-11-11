/**
 * Front matter: splitting it from the markdown and normalising its values.
 */

import type { FrontMatter } from "../types";

const FRONT_MATTER = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** Splits `---`-fenced YAML front matter from the markdown body. */
export const splitFrontMatter = (source: string): FrontMatter => {
  const text = source.replace(/^﻿/, "");
  const match = text.match(FRONT_MATTER);
  if (!match) return { data: {}, body: text };

  const body = text.slice(match[0].length);
  const yaml = match[1] ?? "";
  if (!yaml.trim()) return { data: {}, body };

  try {
    const parsed: unknown = Bun.YAML.parse(yaml);
    const data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    return { data, body };
  } catch (err) {
    return { data: {}, body, error: err instanceof Error ? err.message : String(err) };
  }
};

export const normalizeTags = (value: unknown): string[] => {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const tags = list
    .filter((tag) => typeof tag === "string" || typeof tag === "number")
    .map((tag) => String(tag).trim().toLowerCase().replace(/^#/, ""))
    .filter(Boolean);
  return [...new Set(tags)];
};

export const normalizeDate = (value: unknown): string | undefined => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
};

export const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

export const humanize = (fileName: string): string => {
  const words = fileName.replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

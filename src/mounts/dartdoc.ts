/**
 * Reads the search index `dart doc` writes (index.json at the root of its output): a list of
 * entries like
 *
 *   { "name": "greet", "qualifiedName": "greeting.Greeter.greet", "href": "greeting/Greeter/greet.html",
 *     "kind": 10, "overriddenDepth": 0, "packageRank": 0, "desc": "Returns a greeting for name.",
 *     "enclosedBy": { "name": "Greeter", "kind": 3, "href": "greeting/Greeter-class.html" } }
 *
 * `href` is relative to the docs root (libraries end in "/"), `desc` is the first sentence as
 * plain text, and `overriddenDepth` is more than 0 on members that inherit their docs.
 */

import { decodeEntities } from "../shared/html";
import { hasScheme } from "../shared/urls";
import type { IndexedDoc, ResolvedMount, Urls } from "../types";

/**
 * dartdoc's `Kind` enum in order, as its own `toString()` names them: index.json gives an entry's
 * kind as its position here. From lib/src/model/kind.dart in dart-lang/dartdoc.
 */
export const DARTDOC_KINDS: readonly string[] = [
  "accessor",
  "constant",
  "constructor",
  "class",
  "dynamic",
  "enum",
  "extension",
  "extension type",
  "function",
  "library",
  "method",
  "mixin",
  "Never",
  "package",
  "parameter",
  "prefix",
  "property",
  "SDK",
  "topic",
  "top-level constant",
  "top-level property",
  "typedef",
  "type parameter",
];

const LIBRARY = DARTDOC_KINDS.indexOf("library");

/** The label for a kind number; "symbol" for numbers this list doesn't know. */
export const dartdocKind = (kind: unknown): string =>
  (typeof kind === "number" && Number.isInteger(kind) ? DARTDOC_KINDS[kind] : undefined) ?? "symbol";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** An address inside the docs: no scheme, not absolute, no "..". */
const isRelativeHref = (href: string): boolean =>
  href !== "" && !hasScheme(href) && !/^[/\\]/.test(href) && !href.split(/[/\\]/).includes("..");

const text = (value: unknown): string =>
  typeof value === "string" ? decodeEntities(value).replace(/\s+/g, " ").trim() : "";

/** One search entry per documented symbol, in the index's order. */
export const readDartdoc = (data: unknown, mount: ResolvedMount, urls: Urls): IndexedDoc[] => {
  if (!Array.isArray(data)) throw new Error("expected a list of entries, the way dart doc writes index.json");
  const root = urls.mount(mount.path);
  const entries: IndexedDoc[] = [];

  for (const item of data) {
    if (!isObject(item)) continue;
    const { name, href } = item;
    if (typeof name !== "string" || !name || typeof href !== "string" || !isRelativeHref(href)) continue;
    // Overrides that inherit their docs would repeat their parent's text (every widget's `build`…).
    if (typeof item.overriddenDepth === "number" && item.overriddenDepth > 0) continue;

    const enclosedBy = isObject(item.enclosedBy) ? item.enclosedBy : undefined;
    const parent = enclosedBy && enclosedBy.kind !== LIBRARY && typeof enclosedBy.name === "string" ? enclosedBy.name : "";
    const desc = text(item.desc);
    const page = href.replace(/\/+$/, "");

    entries.push({
      relPath: typeof item.qualifiedName === "string" && item.qualifiedName ? item.qualifiedName : name,
      slug: `${mount.path}/${page.replace(/\.html$/i, "")}`,
      url: root + href,
      fileName: page.split("/").at(-1) ?? page,
      folder: mount.path,
      title: parent ? `${parent}.${name}` : name,
      description: desc || undefined,
      tags: [],
      text: desc,
      headings: [],
      source: { path: mount.path, label: mount.label, kind: dartdocKind(item.kind) },
    });
  }
  return entries;
};

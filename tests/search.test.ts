import { describe, expect, test } from "bun:test";
import { parseDoc } from "../src/content";
import {
  DEFAULT_PARAMS,
  makeSnippet,
  parseSearchParams,
  scoreDoc,
  searchDocs,
  tokenize,
  toQueryString,
} from "../src/search";
import type { Doc, SearchParams } from "../src/types";

const doc = (relPath: string, meta: string, body = ""): Doc => parseDoc(relPath, `---\n${meta}\n---\n${body}`);

const docs = [
  doc("0001-disable-spm.md", "title: Disable Swift Package Manager\nstatus: accepted\ndate: 2026-11-11\ntags: [ios, build]", "We use CocoaPods for iOS builds."),
  doc("0002-state.md", "title: State management with Riverpod\nstatus: proposed\ndate: 2026-10-01\ntags: [flutter, architecture]", "Riverpod providers replace the build context lookups."),
  doc("android/0003-gradle.md", "title: Gradle version catalogs\nstatus: accepted\ndate: 2026-12-01\ntags: [android, build]", "Centralise dependency versions."),
  doc("android/legacy/0004-old.md", "title: Old notes\nstatus: deprecated\ntags: [android]", "Nothing about builds here, just notes."),
];

const search = (params: Partial<SearchParams>) =>
  searchDocs(docs, { ...DEFAULT_PARAMS, ...params }).hits.map((hit) => hit.doc.slug);

describe("parseSearchParams / toQueryString", () => {
  test("reads repeated and comma-separated values", () => {
    const params = parseSearchParams(new URLSearchParams("q=+spm+&tag=iOS&tag=build,%23flutter&status=Accepted&folder=/android/&match=any&sort=newest"));
    expect(params).toEqual({
      q: "spm",
      tags: ["ios", "build", "flutter"],
      statuses: ["accepted"],
      folder: "android",
      match: "any",
      sort: "newest",
    });
  });

  test("falls back to defaults for unknown values", () => {
    expect(parseSearchParams(new URLSearchParams("match=nope&sort=random"))).toEqual(DEFAULT_PARAMS);
  });

  test("DEFAULT_PARAMS can't be changed through a copy", () => {
    const copy = { ...DEFAULT_PARAMS };
    expect(() => copy.tags.push("ios")).toThrow();
    expect(() => {
      (DEFAULT_PARAMS as { q: string }).q = "x";
    }).toThrow();
    expect(DEFAULT_PARAMS.tags).toEqual([]);
  });

  test("round-trips and omits defaults", () => {
    const params: SearchParams = { ...DEFAULT_PARAMS, q: "a b", tags: ["ios", "build"] };
    expect(toQueryString(params)).toBe("q=a+b&tag=ios&tag=build");
    expect(parseSearchParams(new URLSearchParams(toQueryString(params)))).toEqual(params);
    expect(toQueryString(DEFAULT_PARAMS)).toBe("");
  });
});

describe("tokenize", () => {
  test("lower-cases words and keeps quoted phrases together", () => {
    expect(tokenize('Build  "Swift Package" build')).toEqual(["build", "swift package"]);
  });

  test("ignores a stray quote", () => {
    expect(tokenize('"swift package')).toEqual(["swift", "package"]);
    expect(tokenize('spm"')).toEqual(["spm"]);
  });
});

describe("tag, status and folder filters", () => {
  test("match=all requires every selected tag", () => {
    expect(search({ tags: ["android", "build"] })).toEqual(["android/0003-gradle"]);
  });

  test("match=any accepts any selected tag", () => {
    expect(search({ tags: ["ios", "flutter"], match: "any", sort: "title" })).toEqual(["0001-disable-spm", "0002-state"]);
  });

  test("status filter", () => {
    expect(search({ statuses: ["accepted"], sort: "title" })).toEqual(["0001-disable-spm", "android/0003-gradle"]);
  });

  test("folder filter includes sub-folders but not look-alike names", () => {
    expect(search({ folder: "android", sort: "title" })).toEqual(["android/0003-gradle", "android/legacy/0004-old"]);
    expect(search({ folder: "android/legacy" })).toEqual(["android/legacy/0004-old"]);
    expect(search({ folder: "andr" })).toEqual([]);
  });

  test("filters combine with text search", () => {
    expect(search({ q: "build", tags: ["android"] })).toEqual(["android/0003-gradle", "android/legacy/0004-old"]);
  });
});

describe("text search", () => {
  test("every term must match somewhere", () => {
    expect(search({ q: "riverpod providers" })).toEqual(["0002-state"]);
    expect(search({ q: "riverpod gradle" })).toEqual([]);
  });

  test("matches tags, status and path, not just the body", () => {
    expect(search({ q: "architecture" })).toEqual(["0002-state"]);
    expect(search({ q: "deprecated" })).toEqual(["android/legacy/0004-old"]);
    expect(search({ q: "legacy" })).toEqual(["android/legacy/0004-old"]);
  });

  test("ranks title and tag matches above body-only matches", () => {
    // "build" is a tag on 0001 and 0003, and only appears in the body of 0002 / 0004.
    const ranked = search({ q: "build" });
    expect(ranked.slice(0, 2).sort()).toEqual(["0001-disable-spm", "android/0003-gradle"]);
    expect(ranked).toHaveLength(4);
  });

  test("phrases must appear as written", () => {
    expect(search({ q: '"swift package"' })).toEqual(["0001-disable-spm"]);
    expect(search({ q: '"package swift"' })).toEqual([]);
  });
});

describe("scores and snippets", () => {
  test("repeated searches give the same results (cached fields)", () => {
    const first = searchDocs(docs, { ...DEFAULT_PARAMS, q: "build" });
    const again = searchDocs(docs, { ...DEFAULT_PARAMS, q: "build" });
    expect(again.hits.map((hit) => [hit.doc.slug, hit.score, hit.snippet])).toEqual(
      first.hits.map((hit) => [hit.doc.slug, hit.score, hit.snippet]),
    );
  });

  test("scoreDoc matches the score searchDocs ranks by", () => {
    const [top] = searchDocs(docs, { ...DEFAULT_PARAMS, q: "gradle build" }).hits;
    expect(top?.doc.slug).toBe("android/0003-gradle");
    expect(scoreDoc(docs[2]!, ["gradle", "build"])).toBe(top!.score);
    expect(scoreDoc(docs[2]!, ["gradle", "riverpod"])).toBeNull();
  });

  test("a word start in the title outranks a match inside a word", () => {
    const titled = [doc("a.md", "title: Builder notes"), doc("b.md", "title: Rebuild plan")];
    expect(searchDocs(titled, { ...DEFAULT_PARAMS, q: "build" }).hits.map((hit) => hit.doc.slug)).toEqual(["a", "b"]);
  });

  test("without a query the snippet is the description, else the start of the text", () => {
    const described = [doc("a.md", "title: A\ndescription: Short summary", "Body text."), doc("b.md", "title: B", "Body text.")];
    expect(searchDocs(described, { ...DEFAULT_PARAMS, sort: "title" }).hits.map((hit) => hit.snippet)).toEqual([
      "Short summary",
      "Body text.",
    ]);
  });
});

describe("sorting", () => {
  test("newest / oldest put undated documents last", () => {
    expect(search({ sort: "newest" })).toEqual(["android/0003-gradle", "0001-disable-spm", "0002-state", "android/legacy/0004-old"]);
    expect(search({ sort: "oldest" })).toEqual(["0002-state", "0001-disable-spm", "android/0003-gradle", "android/legacy/0004-old"]);
  });

  test("relevance without a query falls back to newest", () => {
    expect(search({})).toEqual(search({ sort: "newest" }));
  });
});

describe("makeSnippet", () => {
  const text = `${"lorem ".repeat(40)}the important keyword lives here ${"ipsum ".repeat(40)}`;

  test("centres on the first match with ellipses", () => {
    const snippet = makeSnippet(text, ["keyword"], 120);
    expect(snippet.startsWith("… ")).toBe(true);
    expect(snippet.endsWith(" …")).toBe(true);
    expect(snippet).toContain("important keyword lives");
  });

  test("uses the start of the text when nothing matches", () => {
    expect(makeSnippet("short text", ["zzz"])).toBe("short text");
  });
});

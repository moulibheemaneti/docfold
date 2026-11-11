import { afterAll, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadLibrary,
  normalizeDate,
  normalizeTags,
  parseDoc,
  resolveRelativeUrl,
  splitFrontMatter,
} from "../src/content";
import { createUrls } from "../src/shared/urls";

describe("splitFrontMatter", () => {
  test("separates YAML metadata from the body", () => {
    const { data, body } = splitFrontMatter("---\ntitle: Hello\ntags: [a, b]\n---\n## Body\n");
    expect(data).toEqual({ title: "Hello", tags: ["a", "b"] });
    expect(body).toBe("## Body\n");
  });

  test("handles CRLF, a BOM and empty front matter", () => {
    expect(splitFrontMatter("﻿---\r\ntitle: X\r\n---\r\nbody").data).toEqual({ title: "X" });
    expect(splitFrontMatter("---\n---\nbody")).toEqual({ data: {}, body: "body" });
  });

  test("leaves files without front matter untouched", () => {
    expect(splitFrontMatter("# Title\n\ntext")).toEqual({ data: {}, body: "# Title\n\ntext" });
  });

  test("reports invalid YAML instead of throwing", () => {
    const result = splitFrontMatter("---\ntitle: [unclosed\n---\nbody");
    expect(result.data).toEqual({});
    expect(result.body).toBe("body");
    expect(result.error).toBeString();
  });
});

describe("normalizers", () => {
  test("tags accept arrays or comma strings and are lower-cased and de-duplicated", () => {
    expect(normalizeTags(["iOS", " Build ", "ios", "#flutter"])).toEqual(["ios", "build", "flutter"]);
    expect(normalizeTags("ios, build")).toEqual(["ios", "build"]);
    expect(normalizeTags(undefined)).toEqual([]);
  });

  test("dates become YYYY-MM-DD", () => {
    expect(normalizeDate("2026-11-11")).toBe("2026-11-11");
    expect(normalizeDate("2026-11-11T09:30:00Z")).toBe("2026-11-11");
    expect(normalizeDate(new Date("2026-01-02T00:00:00Z"))).toBe("2026-01-02");
    expect(normalizeDate("not a date")).toBeUndefined();
  });
});

describe("parseDoc", () => {
  test("reads metadata and renders the body", () => {
    const doc = parseDoc(
      "ios/0001-disable-spm.md",
      "---\ntitle: Disable SPM\nstatus: Accepted\ndate: 2026-11-11\ntags: [ios, build]\n---\n## Why\nBecause.\n",
    );
    expect(doc).toMatchObject({
      slug: "ios/0001-disable-spm",
      url: "/docs/ios/0001-disable-spm",
      folder: "ios",
      fileName: "0001-disable-spm.md",
      title: "Disable SPM",
      status: "accepted",
      date: "2026-11-11",
      tags: ["ios", "build"],
      headings: ["Why"],
      text: "Why Because.",
    });
    expect(doc.html).toContain('<h2 id="why">');
  });

  test("falls back to a leading # heading, then to the file name", () => {
    const fromHeading = parseDoc("a.md", "# Real Title\n\nBody");
    expect(fromHeading.title).toBe("Real Title");
    expect(fromHeading.html).not.toContain("<h1"); // not rendered twice

    expect(parseDoc("setup_guide.md", "Body").title).toBe("Setup guide");
  });

  test("a heading title keeps a trailing # and loses its markdown syntax", () => {
    expect(parseDoc("a.md", "# Learn C#\n").title).toBe("Learn C#");
    expect(parseDoc("a.md", "# Closed heading ##\n").title).toBe("Closed heading");
    expect(parseDoc("a.md", "# The `foo` **API** &amp; [docs](x.md)\n").title).toBe("The foo API & docs");
    expect(parseDoc("a.md", "# 1. Introduction\n").title).toBe("1. Introduction");
  });

  test("an out-of-range character reference in raw HTML doesn't break parsing", () => {
    const doc = parseDoc("a.md", "<div>\n&#99999999999; and &#x110000;\n</div>\n");
    expect(doc.text).toBe("\uFFFD and \uFFFD");
  });

  test("rewrites relative links to other docs and to files", () => {
    const doc = parseDoc(
      "guides/setup.md",
      "[other](./other.md#step-2) [up](../intro.md) [img](img/shot.png) [web](https://x.dev) [anchor](#top)",
    );
    expect(doc.html).toContain('href="/docs/guides/other#step-2"');
    expect(doc.html).toContain('href="/docs/intro"');
    expect(doc.html).toContain('href="/files/guides/img/shot.png"');
    expect(doc.html).toContain('href="https://x.dev"');
    expect(doc.html).toContain('href="#top"');
    expect(doc.assets).toEqual(["guides/img/shot.png"]);
  });

  test("prefixes every generated URL with the base path", () => {
    const doc = parseDoc("a/b.md", "[c](c.md) ![d](d.png)", createUrls("/my-repo/"));
    expect(doc.url).toBe("/my-repo/docs/a/b");
    expect(doc.html).toContain('href="/my-repo/docs/a/c"');
    expect(doc.html).toContain('src="/my-repo/files/a/d.png"');
  });
});

describe("resolveRelativeUrl", () => {
  test("never resolves outside the docs folder", () => {
    expect(resolveRelativeUrl("../../secret.md", "a/b.md")).toBeNull();
    expect(resolveRelativeUrl("/absolute.md", "a/b.md")).toBeNull();
    expect(resolveRelativeUrl("mailto:me@example.com", "a.md")).toBeNull();
  });

  test("encodes spaces and keeps query/hash", () => {
    expect(resolveRelativeUrl("my%20notes.md?x=1#h", "a.md")).toEqual({
      href: "/docs/my%20notes?x=1#h",
      kind: "doc",
      target: "my notes.md",
    });
  });
});

describe("loadLibrary", () => {
  const dirs: string[] = [];
  afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

  test("walks folders and sub-folders and builds tree + facets", async () => {
    const root = await mkdtemp(join(tmpdir(), "docs-test-"));
    dirs.push(root);
    await mkdir(join(root, "ios/build"), { recursive: true });
    await mkdir(join(root, ".hidden"), { recursive: true });
    await Bun.write(join(root, "10-intro.md"), "---\ntitle: Intro\ntags: [general]\n---\nHi");
    await Bun.write(join(root, "2-setup.md"), "---\ntitle: Setup\nstatus: draft\ntags: [general, ios]\n---\nHi");
    await Bun.write(join(root, "ios/build/0001-spm.md"), "---\ntitle: SPM\nstatus: accepted\ntags: [ios]\n---\nHi");
    await Bun.write(join(root, "ios/notes.txt"), "not markdown");
    await Bun.write(join(root, ".hidden/secret.md"), "# Hidden");
    await Bun.write(join(root, "node_modules/pkg/README.md"), "# Dependency readme");
    await Bun.write(join(root, "dist/docs/old.md"), "# Build output");

    const library = await loadLibrary(root, { ignore: [join(root, "dist")] });

    expect(library.docs.map((d) => d.relPath)).toEqual(["2-setup.md", "10-intro.md", "ios/build/0001-spm.md"]);
    expect(library.bySlug.get("ios/build/0001-spm")?.title).toBe("SPM");
    expect(library.tags).toEqual([
      { name: "general", count: 2 },
      { name: "ios", count: 2 },
    ]);
    expect(library.statuses).toEqual([
      { name: "accepted", count: 1 },
      { name: "draft", count: 1 },
    ]);

    const [ios, setup, intro] = library.tree.children;
    expect(ios).toMatchObject({ kind: "folder", name: "ios", docCount: 1 });
    expect(setup).toMatchObject({ kind: "file", name: "2-setup.md" });
    expect(intro).toMatchObject({ kind: "file", name: "10-intro.md" });
  });

  test("only publishes linked files outside hidden folders and node_modules", async () => {
    const root = await mkdtemp(join(tmpdir(), "docs-test-"));
    dirs.push(root);
    await Bun.write(
      join(root, "a.md"),
      "![shot](img/shot.png) [env](.env) [git](.git/config) [dep](node_modules/x/y.png) [b](sub/b.md)",
    );
    await Bun.write(join(root, "sub/b.md"), "![shot](../img/shot.png) [pdf](./spec.pdf)");

    const library = await loadLibrary(root);
    expect(library.docs[0]?.assets).toEqual(["img/shot.png", ".env", ".git/config", "node_modules/x/y.png"]);
    expect([...library.assets].sort()).toEqual(["img/shot.png", "sub/spec.pdf"]);
  });

  // Root can read any file, so the unreadable one would load.
  test.skipIf(process.getuid?.() === 0)("skips a file it can't read instead of failing", async () => {
    const root = await mkdtemp(join(tmpdir(), "docs-test-"));
    dirs.push(root);
    await Bun.write(join(root, "ok.md"), "# Fine");
    await Bun.write(join(root, "locked.md"), "# Locked");
    await chmod(join(root, "locked.md"), 0o000);

    const library = await loadLibrary(root);
    expect(library.docs.map((doc) => doc.relPath)).toEqual(["ok.md"]);
  });

  test("returns an empty library for a missing folder", async () => {
    const library = await loadLibrary(join(tmpdir(), "definitely-missing-docs-folder"));
    expect(library.docs).toEqual([]);
    expect(library.tree.children).toEqual([]);
  });
});

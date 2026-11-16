import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findSlugCollisions,
  loadLibrary,
  normalizeDate,
  normalizeTags,
  parseDoc,
  resolveRelativeUrl,
  splitFrontMatter,
  toIndexedDoc,
} from "../src/content";
import { toSlug } from "../src/shared/slug";
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

describe("toSlug", () => {
  test("drops .md, lower-cases every segment and turns spaces and underscores into one hyphen", () => {
    expect(toSlug("CONTRIBUTING.md")).toBe("contributing");
    expect(toSlug("Guides/My_Notes.md")).toBe("guides/my-notes");
    expect(toSlug("Team Notes/Release  Notes.MD")).toBe("team-notes/release-notes");
    expect(toSlug("a__b _ c.md")).toBe("a-b-c");
    expect(toSlug("Q&A - 2026.md")).toBe("q&a-2026");
    expect(toSlug("ios/0001-disable-spm.md")).toBe("ios/0001-disable-spm");
  });

  test("keeps hyphens that aren't next to a space or underscore, and other characters", () => {
    expect(toSlug("a--b.md")).toBe("a--b");
    expect(toSlug("Café/Ünïcode.md")).toBe("café/ünïcode");
    expect(toSlug("v1.2 notes.md")).toBe("v1.2-notes");
  });

  test("is stable: a slug maps to itself", () => {
    for (const path of ["CONTRIBUTING.md", "Guides/My_Notes.md", "Q&A - 2026.md"]) {
      expect(toSlug(toSlug(path))).toBe(toSlug(path));
    }
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

  test("collects H2 and H3 headings with ids for the outline", () => {
    const doc = parseDoc(
      "a.md",
      [
        "# Title",
        "## The `foo` **API** &amp; more",
        "### Sub",
        "#### Too deep",
        "## Sub",
        "## 日本", // Bun gives it an empty id: nothing to link to
        "<h2>Raw HTML</h2>",
        '<h3 id="by-hand">By hand</h3>',
      ].join("\n\n"),
    );

    expect(doc.outline).toEqual([
      { level: 2, id: "the-foo-api-more", text: "The foo API & more" },
      { level: 3, id: "sub", text: "Sub" },
      { level: 2, id: "sub-1", text: "Sub" },
      { level: 3, id: "by-hand", text: "By hand" },
    ]);
    // Search still sees every heading.
    expect(doc.headings).toEqual(["The foo API & more", "Sub", "Too deep", "Sub", "日本", "Raw HTML", "By hand"]);
    expect(toIndexedDoc(doc)).not.toHaveProperty("outline");
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

  test("page addresses are lower-case and hyphenated; titles and file names are not", () => {
    const contributing = parseDoc("CONTRIBUTING.md", "Body");
    expect(contributing).toMatchObject({ slug: "contributing", url: "/docs/contributing", fileName: "CONTRIBUTING.md" });
    expect(contributing.title).toBe("CONTRIBUTING");

    const notes = parseDoc("Guides/My_Notes.md", "Body");
    expect(notes).toMatchObject({ slug: "guides/my-notes", url: "/docs/guides/my-notes", folder: "Guides", relPath: "Guides/My_Notes.md" });
    expect(notes.title).toBe("My Notes");
    expect(parseDoc("Guides/My_Notes.md", "---\ntitle: Notes, Mine\n---\nBody").title).toBe("Notes, Mine");
  });

  test("links to a doc use its slug whatever case they are written in; other files keep their path", () => {
    const doc = parseDoc(
      "Guides/My_Notes.md",
      "[a](../CONTRIBUTING.md) [b](../contributing.md#Setup) [c](./Team_Notes.md?x=1) ![shot](./Shots/Screen_Shot.PNG) [pdf](../Spec%20Sheet.PDF)",
    );
    expect(doc.html).toContain('href="/docs/contributing"');
    expect(doc.html).toContain('href="/docs/contributing#Setup"');
    expect(doc.html).toContain('href="/docs/guides/team-notes?x=1"');
    expect(doc.html).toContain('src="/files/Guides/Shots/Screen_Shot.PNG"');
    expect(doc.html).toContain('href="/files/Spec%20Sheet.PDF"');
    expect(doc.assets).toEqual(["Guides/Shots/Screen_Shot.PNG", "Spec Sheet.PDF"]);
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

  test("turns spaces in doc links into hyphens and keeps query/hash", () => {
    expect(resolveRelativeUrl("My%20Notes.md?x=1#h", "a.md")).toEqual({
      href: "/docs/my-notes?x=1#h",
      kind: "doc",
      target: "My Notes.md",
    });
  });

  test("encodes spaces in links to other files and keeps their case", () => {
    expect(resolveRelativeUrl("Img/My%20Shot.png#x", "a.md")).toEqual({
      href: "/files/Img/My%20Shot.png#x",
      kind: "file",
      target: "Img/My Shot.png",
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

  test("findSlugCollisions groups files that would share a page address", () => {
    const docs = ["SETUP.md", "Setup.md", "guides/My_Notes.md", "guides/my notes.md", "guides/my-notes-2.md", "intro.md"].map(
      (relPath) => ({ relPath, slug: toSlug(relPath) }),
    );
    expect(findSlugCollisions(docs)).toEqual([
      { slug: "setup", relPaths: ["SETUP.md", "Setup.md"] },
      { slug: "guides/my-notes", relPaths: ["guides/My_Notes.md", "guides/my notes.md"] },
    ]);
    expect(findSlugCollisions(docs.slice(-2))).toEqual([]);
  });

  // "My_Notes.md" and "my notes.md" rather than "Setup.md" and "SETUP.md": they can sit side by side on
  // case-insensitive file systems (macOS, Windows) too.
  test("files with the same page address: an error naming both, or a warning that keeps the first", async () => {
    const root = await mkdtemp(join(tmpdir(), "docs-test-"));
    dirs.push(root);
    await Bun.write(join(root, "Guides/My_Notes.md"), "# Underscore");
    await Bun.write(join(root, "Guides/my notes.md"), "# Space");
    await Bun.write(join(root, "intro.md"), "# Intro");

    const error = await loadLibrary(root, { slugCollisions: "error" }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('"Guides/my notes.md" and "Guides/My_Notes.md" → /docs/guides/my-notes');

    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const library = await loadLibrary(root);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(
        '"Guides/my notes.md" and "Guides/My_Notes.md" → /docs/guides/my-notes  (showing "Guides/my notes.md")',
      );
      expect(library.docs.map((doc) => doc.relPath)).toEqual(["Guides/my notes.md", "intro.md"]);
      expect(library.bySlug.get("guides/my-notes")?.title).toBe("Space");
      expect(library.tree.children[0]).toMatchObject({ kind: "folder", docCount: 1 });
    } finally {
      warn.mockRestore();
    }
  });

  test("returns an empty library for a missing folder", async () => {
    const library = await loadLibrary(join(tmpdir(), "definitely-missing-docs-folder"));
    expect(library.docs).toEqual([]);
    expect(library.tree.children).toEqual([]);
  });
});

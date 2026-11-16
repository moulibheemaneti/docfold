import { describe, expect, test } from "bun:test";
import { parseDoc } from "../src/content";
import { docPage, highlight, outline } from "../src/pages";
import { html, htmlToText, raw } from "../src/shared/html";
import { createUrls } from "../src/shared/urls";
import { buildTree, folderContains, sidebar } from "../src/sidebar";
import type { FolderNode, Heading, Library, Site } from "../src/types";

describe("html template", () => {
  test("escapes interpolated values but not nested templates or raw()", () => {
    const evil = `<script>alert("x")</script>`;
    const out = html`<p title="${evil}">${evil}${html`<b>ok</b>`}${raw("<i>trusted</i>")}${[1, null, false, "&"]}</p>`.value;
    expect(out).toBe(
      '<p title="&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;">&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;<b>ok</b><i>trusted</i>1&amp;</p>',
    );
  });

  test("htmlToText strips tags and decodes entities", () => {
    expect(htmlToText("<p>a &amp; b &lt;c&gt; &#39;d&#x27;</p>\n<p>e</p>")).toBe("a & b <c> 'd' e");
  });

  test("htmlToText turns invalid character references into U+FFFD instead of throwing", () => {
    expect(htmlToText("a&#0;b &#x110000; &#99999999999; &#x1F600;")).toBe("a\uFFFDb \uFFFD \uFFFD 😀");
  });

  test("htmlToText does not add spaces around inline tags", () => {
    expect(htmlToText("<p>Use <code>ref</code>. <strong>Bold</strong>, <a href='#'>link</a>!</p><ul><li>one</li><li>two</li></ul>")).toBe(
      "Use ref. Bold, link! one two",
    );
  });
});

describe("highlight", () => {
  test("wraps matches in <mark> and escapes everything else", () => {
    expect(highlight("Use <Build> builds", ["build"]).value).toBe(
      "Use &lt;<mark>Build</mark>&gt; <mark>build</mark>s",
    );
  });

  test("treats regex characters in terms literally", () => {
    expect(highlight("c++ and c", ["c++"]).value).toBe("<mark>c++</mark> and c");
  });
});

describe("sidebar", () => {
  test("file entries stay lean (no inline icon) and mark the current page", () => {
    const docs = ["guide/intro.md", "guide/next.md"].map((path) => parseDoc(path, "text"));
    const library = { docs, tree: buildTree(docs) } as unknown as Library;
    const markup = sidebar(library, createUrls("/"), "guide/next", false).value;

    expect(markup).toContain(
      '<li class="tree-file" data-search="next next.md"><a href="/docs/guide/next" title="guide/next.md" aria-current="page"><span class="tree-label">Next</span></a></li>',
    );
    expect(markup).toContain('<li class="tree-folder" data-path="guide" data-search="guide" data-current>');
    expect(markup.match(/<svg/g)).toHaveLength(2); // the filter box and the one folder
  });

  test("opens the folder of the current page when folder and file names have upper case and underscores", () => {
    const docs = ["Guides/Team_Notes/My_Notes.md", "Guides/intro.md", "Other/x.md"].map((path) => parseDoc(path, "text"));
    const library = { docs, tree: buildTree(docs) } as unknown as Library;
    const markup = sidebar(library, createUrls("/"), "guides/team-notes/my-notes", false).value;

    expect(markup).toContain('<li class="tree-folder" data-path="Guides" data-search="guides" data-current>');
    expect(markup).toContain('<li class="tree-folder" data-path="Guides/Team_Notes" data-search="team_notes" data-current>');
    expect(markup).toContain('<li class="tree-folder" data-path="Other" data-search="other">');
    expect(markup).toContain('<a href="/docs/guides/team-notes/my-notes" title="Guides/Team_Notes/My_Notes.md" aria-current="page">');
  });
});

describe("folderContains", () => {
  const tree = buildTree(["Guides/My_Notes.md", "Guides/Team_Notes/a.md", "Guides-Old/b.md"].map((path) => parseDoc(path, "text")));
  const folder = (name: string) => tree.children.find((child) => child.kind === "folder" && child.name === name) as FolderNode;

  test("matches page slugs against folder slugs, not file paths", () => {
    expect(folder("Guides")).toMatchObject({ path: "Guides", slug: "guides" });
    expect(folderContains(folder("Guides"), "guides/my-notes")).toBe(true);
    expect(folderContains(folder("Guides"), "guides/team-notes/a")).toBe(true);
    expect(folderContains(folder("Guides").children[0] as FolderNode, "guides/team-notes/a")).toBe(true);
    expect(folderContains(tree, "anything")).toBe(true);
  });

  test("doesn't match look-alike folders, other folders or no page", () => {
    expect(folderContains(folder("Guides"), "guides-old/b")).toBe(false);
    expect(folderContains(folder("Guides-Old"), "guides/my-notes")).toBe(false);
    expect(folderContains(folder("Guides"), "Guides/My_Notes")).toBe(false);
    expect(folderContains(folder("Guides"), undefined)).toBe(false);
  });
});

describe("buildTree", () => {
  test("nests folders, sorts folders first and naturally, and counts documents", () => {
    const docs = ["b.md", "10-x.md", "2-x.md", "a/z.md", "a/b/c.md", "Z/y.md"].map((path) => parseDoc(path, "text"));
    const tree = buildTree(docs);

    const names = (node: typeof tree): unknown =>
      node.children.map((child) => (child.kind === "folder" ? { [child.name]: names(child) } : child.name));

    expect(names(tree)).toEqual([{ a: [{ b: ["c.md"] }, "z.md"] }, { Z: ["y.md"] }, "2-x.md", "10-x.md", "b.md"]);
    expect(tree.docCount).toBe(6);
    expect(tree.children[0]).toMatchObject({ name: "a", path: "a", slug: "a", docCount: 2 });
  });
});

describe("outline", () => {
  const h = (level: number, text: string): Heading => ({ level, id: text.toLowerCase(), text });

  test("nests H3s under the H2 before them and links to each heading", () => {
    const markup = outline([h(3, "Lead"), h(2, "One"), h(3, "One-a"), h(3, "One-b"), h(2, "Two")]).toString();
    expect(markup).toContain('<nav class="outline" aria-label="On this page">');
    expect(markup).toContain(
      '<ul class="outline-list" role="list"><li><a href="#lead">Lead</a></li><li><a href="#one">One</a><ul role="list"><li><a href="#one-a">One-a</a></li><li><a href="#one-b">One-b</a></li></ul></li><li><a href="#two">Two</a></li></ul>',
    );
    expect(markup).toContain('<button class="outline-toggle" type="button" aria-expanded="false">On this page</button>');
  });

  test("escapes heading text and ids", () => {
    const markup = outline([{ level: 2, id: 'a"b', text: "<script>" }, h(2, "Two")]).toString();
    expect(markup).toContain('<a href="#a&quot;b">&lt;script&gt;</a>');
  });

  test("is left out when there are fewer than two headings", () => {
    expect(outline([])).toBe("");
    expect(outline([h(2, "Only")])).toBe("");
  });
});

describe("docPage", () => {
  const site = {
    title: "Docs",
    sourceLabel: "./",
    urls: createUrls("/"),
    mode: "static",
    liveReload: false,
    head: "",
    themeColor: "#4355e0",
    header: { name: "Docs", tag: false, action: false },
    home: false,
  } as unknown as Site;

  const render = (source: string) => {
    const doc = parseDoc("guide/intro.md", source);
    const library = { docs: [doc], tree: buildTree([doc]) } as unknown as Library;
    return docPage(site, library, doc);
  };

  test("puts the outline between the header and the text", () => {
    const page = render("## Why\n\nBecause.\n\n## How\n\nLike this.");
    expect(page).toContain('<article class="doc has-outline">');
    expect(page.indexOf('class="doc-header"')).toBeLessThan(page.indexOf('class="outline"'));
    expect(page.indexOf('class="outline"')).toBeLessThan(page.indexOf('class="prose"'));
    expect(page).toContain('<a href="#why">Why</a>');
  });

  test("has no outline without enough headings", () => {
    const page = render("## Why\n\nBecause.");
    expect(page).toContain('<article class="doc">');
    expect(page).not.toContain('class="outline"');
  });
});

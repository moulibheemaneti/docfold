import { describe, expect, test } from "bun:test";
import { parseDoc } from "../src/content";
import { highlight } from "../src/pages";
import { html, htmlToText, raw } from "../src/shared/html";
import { createUrls } from "../src/shared/urls";
import { buildTree, sidebar } from "../src/sidebar";
import type { Library } from "../src/types";

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
});

describe("buildTree", () => {
  test("nests folders, sorts folders first and naturally, and counts documents", () => {
    const docs = ["b.md", "10-x.md", "2-x.md", "a/z.md", "a/b/c.md", "Z/y.md"].map((path) => parseDoc(path, "text"));
    const tree = buildTree(docs);

    const names = (node: typeof tree): unknown =>
      node.children.map((child) => (child.kind === "folder" ? { [child.name]: names(child) } : child.name));

    expect(names(tree)).toEqual([{ a: [{ b: ["c.md"] }, "z.md"] }, { Z: ["y.md"] }, "2-x.md", "10-x.md", "b.md"]);
    expect(tree.docCount).toBe(6);
    expect(tree.children[0]).toMatchObject({ name: "a", path: "a", docCount: 2 });
  });
});

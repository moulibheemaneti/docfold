import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { cp, mkdtemp, readdir, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, createDevServer, createPreviewServer } from "../src/commands";
import { loadConfig } from "../src/config";
import { parseDoc } from "../src/content";
import { DARTDOC_KINDS, inspectMounts, loadMountEntries, readDartdoc, resolveMounts } from "../src/mounts";
import { resultsFragment, searchPage } from "../src/pages";
import { countFacets, DEFAULT_PARAMS, parseSearchParams, searchDocs } from "../src/search";
import { createUrls } from "../src/shared/urls";
import { ignoredFolders } from "../src/site";
import { buildTree } from "../src/sidebar";
import type { DevServer, IndexedDoc, Library, MountConfig, ResolvedMount, Site, UserConfig } from "../src/types";

const FIXTURE = join(import.meta.dir, "fixtures/dartdoc");
const CLI = join(import.meta.dir, "../src/cli.ts");

const REFERENCE: MountConfig = { dir: "../doc/api", path: "reference", label: "API reference", search: { format: "dartdoc" } };

/**
 * A project laid out the way `dart doc` and docfold meet:
 *
 *   project/
 *     secret.txt          outside every served folder
 *     doc/api/            dart doc's output: the fixture, plus a root page, hidden files and symlinks
 *     docs/               the docfold site (config + markdown), mounting ../doc/api at "reference"
 */
let project: string;
let docs: string;
let api: string;

const writeConfig = (dir: string, config: UserConfig) =>
  Bun.write(join(dir, "docfold.config.ts"), `export default ${JSON.stringify(config)};`);

beforeAll(async () => {
  project = await mkdtemp(join(tmpdir(), "docfold-mounts-"));
  docs = join(project, "docs");
  api = join(project, "doc/api");

  await Bun.write(join(project, "secret.txt"), "outside");
  await cp(FIXTURE, api, { recursive: true });
  await Bun.write(join(api, "index.html"), "<p>API home</p>");
  await Bun.write(join(api, "greeting/index.html"), "<p>Library greeting</p>");
  await Bun.write(join(api, "greeting/Mood.html"), "<p>Mood page</p>");
  await Bun.write(join(api, ".secret"), "hidden");
  await Bun.write(join(api, ".hidden/page.html"), "hidden folder");
  await symlink(join(project, "secret.txt"), join(api, "escape.html"));
  await symlink(project, join(api, "escape-dir"));
  await symlink(join(api, "greeting/Mood.html"), join(api, "mood-link.html"));
  await symlink(join(api, ".secret"), join(api, "hidden-link.html"));
  await symlink(api, join(api, "greeting/loop"));

  await writeConfig(docs, { title: "Mounted", base: "sub", mounts: [REFERENCE] });
  await Bun.write(join(docs, "guide/intro.md"), "---\ntitle: Intro\ntags: [setup]\nstatus: accepted\n---\nHow to greet the team.\n");
  await Bun.write(join(docs, "guide/next.md"), "# Next steps\n\nBody text.\n");
});

afterAll(async () => {
  await rm(project, { recursive: true, force: true });
});

/** Console warnings while `run` runs, without printing them. */
const warningsDuring = async <T>(run: () => Promise<T>): Promise<{ result: T; warnings: string[] }> => {
  const spy = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const result = await run();
    return { result, warnings: spy.mock.calls.map((call) => String(call[0])) };
  } finally {
    spy.mockRestore();
  }
};

/** The error message `run` fails with ("" when it doesn't). */
const failure = (run: () => Promise<unknown>): Promise<string> =>
  run().then(
    () => "",
    (err: unknown) => (err instanceof Error ? err.message : String(err)),
  );

const resolved = (overrides: Partial<ResolvedMount> = {}): ResolvedMount => ({
  dir: api,
  path: "reference",
  label: "API reference",
  search: { format: "dartdoc", index: join(api, "index.json") },
  ...overrides,
});

describe("mounts config", () => {
  test("resolves dir, path, label and the format's own index file", async () => {
    const config = await loadConfig(docs);
    expect(config.mounts).toEqual([
      { dir: api, path: "reference", label: "API reference", search: { format: "dartdoc", index: join(api, "index.json") } },
    ]);

    const other = await loadConfig(docs, {
      mounts: [
        { dir: "../doc/api", path: "/api-docs/v2/", label: "  Old API  ", search: { format: "dartdoc", index: "search/index.json" } },
        { dir: "../doc/other", path: "plain", label: "Plain" },
      ],
    });
    expect(other.mounts).toEqual([
      { dir: api, path: "api-docs/v2", label: "Old API", search: { format: "dartdoc", index: join(api, "search/index.json") } },
      { dir: join(project, "doc/other"), path: "plain", label: "Plain" },
    ]);
  });

  test("without mounts there are none, and nothing else changes", async () => {
    const config = await loadConfig(docs, { mounts: [] });
    expect(config.mounts).toEqual([]);
    expect(ignoredFolders(config)).toEqual([config.outDir, config.publicDir]);
    expect(resolveMounts(undefined, docs, config)).toEqual([]);
  });

  test("a path must be lower-case parts, not docfold's own addresses", async () => {
    const problems = await failure(() =>
      loadConfig(docs, {
        mounts: ["docs", "files/x", "assets", "api", "builds/v1", "Reference", "a b", "", "/", "a//b", "-x", "../x", "a.b"].map(
          (path) => ({ dir: "../doc/api", path, label: "L" }),
        ),
      }),
    );
    for (const reserved of ["docs", "files", "assets", "api", "builds"]) expect(problems).toContain(`can't start with "${reserved}"`);
    for (let i = 5; i <= 12; i++) expect(problems).toContain(`mounts[${i}]: path`);
    // Every problem at once, one per line.
    expect(problems.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(13);

    // Close to a reserved name is fine.
    const config = await loadConfig(docs, { mounts: [{ dir: "../doc/api", path: "apis", label: "L" }] });
    expect(config.mounts[0]?.path).toBe("apis");
  });

  test("paths can't be equal or nested", async () => {
    const mount = (path: string, dir = "../doc/api"): MountConfig => ({ dir, path, label: path });
    const problems = await failure(() =>
      loadConfig(docs, { mounts: [mount("a"), mount("a/b", "../doc/b"), mount("x"), mount("x/", "../doc/x"), mount("ab")] }),
    );
    expect(problems).toContain('mounts[1] ("a/b"): path "a/b" and mounts[0]\'s "a" are nested');
    expect(problems).toContain('mounts[3] ("x"): path "x" is also used by mounts[2]');
    expect(problems).not.toContain("mounts[4]");
  });

  test("dir must leave the project, docs, output and publicDir alone", async () => {
    const at = (dir: string, overrides: UserConfig = {}) =>
      failure(() => loadConfig(docs, { ...overrides, mounts: [{ dir, path: "reference", label: "API" }] }));

    expect(await at(".")).toContain("must not be the project folder or one of its parents");
    expect(await at("..")).toContain("must not be the project folder or one of its parents");
    expect(await at("../doc", { srcDir: "../doc/content" })).toContain("must not contain srcDir");
    expect(await at("../doc", { outDir: "../doc/dist" })).toContain("must not contain outDir");
    expect(await at("../doc", { publicDir: "../doc/public" })).toContain("must not contain publicDir");
    expect(await at("dist/api")).toContain("must not be inside outDir");
    // A folder that doesn't exist yet is fine: it's usually generated.
    expect(await at("../doc/not-yet")).toBe("");
  });

  test("label, search and the list itself are checked", async () => {
    const problems = await failure(() =>
      loadConfig(docs, {
        mounts: [
          { dir: "../doc/api", path: "a", label: "  " },
          { dir: "../doc/api", path: "b", label: "B", search: { format: "javadoc" as "dartdoc" } },
          { dir: "../doc/api", path: "c", label: "C", search: { format: "dartdoc", index: "" } },
          { dir: "../doc/api", path: "d", label: "D", search: "dartdoc" as unknown as MountConfig["search"] },
          "reference" as unknown as MountConfig,
        ],
      }),
    );
    expect(problems).toContain('mounts[0] ("a"): label must not be empty');
    expect(problems).toContain('mounts[1] ("b"): search.format "javadoc" is not supported. Supported formats: "dartdoc".');
    expect(problems).toContain('mounts[2] ("c"): search.index must be a file name');
    expect(problems).toContain('mounts[3] ("d"): search must be an object');
    expect(problems).toContain("mounts[4] must be an object");

    expect(await failure(() => loadConfig(docs, { mounts: {} as unknown as MountConfig[] }))).toContain("mounts must be a list");
  });

  test("a mount can't share its address with a top-level file or folder in publicDir", async () => {
    const config = await loadConfig(docs);
    const publicDir = join(project, "public-clash");
    try {
      await Bun.write(join(publicDir, "Reference/logo.svg"), "<svg/>");
      await Bun.write(join(publicDir, "plain"), "a file");
      await Bun.write(join(publicDir, "reference.txt"), "a different name");
      const mounts = [resolved(), resolved({ path: "plain/deep", dir: join(project, "doc/plain") }), resolved({ path: "fine" })];
      const problems = await failure(() => inspectMounts({ publicDir, mounts }));
      expect(problems).toContain('mounts[0] ("reference"): publicDir has "Reference"');
      expect(problems).toContain('mounts[1] ("plain/deep"): publicDir has "plain"');
      expect(problems).not.toContain("mounts[2]");

      // Checked when dev and build start, before anything is served or written.
      const clashing = { ...config, publicDir };
      expect(await failure(() => createDevServer(clashing, { port: 0 }))).toContain('publicDir has "Reference"');
      expect(await failure(() => build(clashing))).toContain('publicDir has "Reference"');
      expect(await Bun.file(join(config.outDir, "index.html")).exists()).toBe(false);
    } finally {
      await rm(publicDir, { recursive: true, force: true });
    }
  });

  test("a mounted folder inside the docs folder holds no documents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "docfold-mount-inside-"));
    try {
      await Bun.write(join(dir, "intro.md"), "# Intro\n");
      await Bun.write(join(dir, "api/README.md"), "# Generated, not a document\n");
      await writeConfig(dir, { mounts: [{ dir: "api", path: "reference", label: "API" }] });
      const config = await loadConfig(dir);
      expect(ignoredFolders(config)).toEqual([config.outDir, config.publicDir, join(dir, "api")]);

      const dev = await createDevServer(config, { port: 0 });
      try {
        expect((await dev.store.library()).docs.map((doc) => doc.relPath)).toEqual(["intro.md"]);
        expect((await fetch(new URL("/reference/README.md", dev.server.url))).status).toBe(200);
      } finally {
        await dev.stop();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("dartdoc index", () => {
  const urls = createUrls("/sub/");

  test("maps entries to search entries", async () => {
    const entries = await loadMountEntries(resolved(), urls);
    expect(entries.map((entry) => [entry.title, entry.source?.kind, entry.url])).toEqual([
      ["greeting", "library", "/sub/reference/greeting/"],
      ["Greeter", "class", "/sub/reference/greeting/Greeter-class.html"],
      ["Greeter.greet", "method", "/sub/reference/greeting/Greeter/greet.html"],
      ["Mood", "enum", "/sub/reference/greeting/Mood.html"],
      ["mystery", "symbol", "/sub/reference/greeting/mystery.html"],
    ]);

    expect(entries[2]).toEqual({
      relPath: "greeting.Greeter.greet",
      slug: "reference/greeting/Greeter/greet",
      url: "/sub/reference/greeting/Greeter/greet.html",
      fileName: "greet.html",
      folder: "reference",
      title: "Greeter.greet",
      description: "Returns a greeting for name.",
      tags: [],
      text: "Returns a greeting for name.",
      headings: [],
      source: { path: "reference", label: "API reference", kind: "method" },
    });

    // A library: its folder is its page. No description when `desc` is empty.
    expect(entries[0]).toMatchObject({ slug: "reference/greeting", fileName: "greeting", relPath: "greeting", text: "" });
    expect(entries[0]?.description).toBeUndefined();
    expect(entries.every((entry) => entry.folder === "reference" && !entry.status && !entry.date)).toBe(true);
  });

  test("skips overrides that inherit their docs", async () => {
    const entries = await loadMountEntries(resolved(), urls);
    expect(entries.map((entry) => entry.relPath)).not.toContain("greeting.Greeter.toString");
  });

  test("kind numbers follow dartdoc's Kind enum", () => {
    const seen = { 1: "constant", 2: "constructor", 3: "class", 5: "enum", 8: "function", 9: "library", 10: "method", 16: "property" };
    for (const [kind, label] of Object.entries(seen)) expect(DARTDOC_KINDS[Number(kind)]).toBe(label);
    expect(DARTDOC_KINDS).toHaveLength(23);
  });

  test("keeps only entries it can link to, and reads desc as text", () => {
    const entries = readDartdoc(
      [
        { __PACKAGE_ORDER__: ["greeting"] },
        "not an entry",
        { name: "a", href: "https://example.com/a.html", kind: 3 },
        { name: "b", href: "/b.html", kind: 3 },
        { name: "c", href: "../c.html", kind: 3 },
        { name: "", href: "d.html", kind: 3 },
        { name: "e", kind: 3 },
        { name: "html", href: "f.html", kind: 1.5, desc: "Uses   List&lt;T&gt; &amp; more.", enclosedBy: { name: "Box", kind: 3 } },
      ],
      resolved({ path: "api-docs/v2" }),
      urls,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      title: "Box.html",
      relPath: "html",
      url: "/sub/api-docs/v2/f.html",
      folder: "api-docs/v2",
      text: "Uses List<T> & more.",
      source: { kind: "symbol" },
    });
  });

  test("a missing or invalid index is a warning and no entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "docfold-index-"));
    try {
      const missing = await warningsDuring(() => loadMountEntries(resolved({ dir, search: { format: "dartdoc", index: join(dir, "index.json") } }), urls));
      expect(missing.result).toEqual([]);
      expect(missing.warnings.join()).toContain("Search index not found");

      await Bun.write(join(dir, "index.json"), "[{");
      const invalid = await warningsDuring(() => loadMountEntries(resolved({ dir, search: { format: "dartdoc", index: join(dir, "index.json") } }), urls));
      expect(invalid.result).toEqual([]);
      expect(invalid.warnings.join()).toContain("Could not read the search index");

      await Bun.write(join(dir, "index.json"), '{"not": "a list"}');
      const wrong = await warningsDuring(() => loadMountEntries(resolved({ dir, search: { format: "dartdoc", index: join(dir, "index.json") } }), urls));
      expect(wrong.result).toEqual([]);
      expect(wrong.warnings.join()).toContain('as "dartdoc": expected a list of entries');

      // No search config: nothing to read.
      expect(await loadMountEntries(resolved({ search: undefined }), urls)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("search over documents and mounted entries", () => {
  const urls = createUrls("/");
  const markdown = [
    parseDoc("guide/intro.md", "---\ntitle: Intro\ntags: [setup]\nstatus: accepted\n---\nHow to greet the team.\n", urls),
    parseDoc("reference/notes.md", "# Notes\n\nGreeting etiquette.\n", urls),
    parseDoc("guide/next.md", "# Next steps\n\nBody text.\n", urls),
  ];
  let mounted: IndexedDoc[];

  beforeAll(async () => {
    mounted = await loadMountEntries(resolved(), urls);
  });

  test("?folder=<path> narrows to the mount (and any markdown in a folder of that name)", () => {
    const result = searchDocs([...markdown, ...mounted], parseSearchParams(new URLSearchParams("folder=reference&q=greet")));
    expect(result.hits.map((hit) => hit.doc.title)).toEqual(["Greeter.greet", "greeting", "Greeter", "Mood", "mystery", "Notes"]);
    expect(result.hits.filter((hit) => !hit.doc.source).map((hit) => hit.doc.relPath)).toEqual(["reference/notes.md"]);
  });

  test("markdown hits are the same with or without mounted entries", () => {
    for (const query of ["q=greet", "q=greet&sort=title", "tag=setup", "", "q=next&sort=newest", "status=accepted"]) {
      const params = parseSearchParams(new URLSearchParams(query));
      const alone = searchDocs(markdown, params);
      const together = searchDocs([...markdown, ...mounted], params);
      expect(together.hits.filter((hit) => !hit.doc.source)).toEqual(alone.hits);
    }
    // Facets come from tags and statuses, which mounted entries don't have.
    expect(countFacets([...markdown, ...mounted])).toEqual(countFacets(markdown));
  });

  test("result cards: a source badge for mounted entries, markdown cards as before", () => {
    const params = parseSearchParams(new URLSearchParams("q=greet"));
    const card = (markup: string, href: string) => markup.match(new RegExp(`<li class="result">(?:(?!</li>)[\\s\\S])*?href="${href}"[\\s\\S]*?</li>`))?.[0];
    const alone = resultsFragment(searchDocs(markdown, params), urls).value;
    const together = resultsFragment(searchDocs([...markdown, ...mounted], params), urls).value;

    expect(card(together, "/reference/greeting/Greeter/greet.html")).toContain(
      '<span class="badge" data-source="reference">API reference · method</span>',
    );
    expect(card(together, "/reference/greeting/Greeter/greet.html")).toContain('<div class="result-path">greeting.Greeter.greet</div>');
    for (const href of ["/docs/guide/intro", "/docs/reference/notes"]) {
      expect(card(together, href)).toBeDefined();
      expect(card(together, href)).toBe(card(alone, href));
    }
  });

  test("the header links each mount, between Docs and Builds", () => {
    const site = {
      title: "Docs",
      sourceLabel: "./",
      urls: createUrls("/sub/"),
      mode: "static",
      liveReload: false,
      head: "",
      themeColor: "#4355e0",
      header: { name: "Docs", tag: false, action: false },
      home: false,
      builds: false,
      mounts: [
        { path: "reference", label: "API reference" },
        { path: "api-docs/v2", label: "Old <API>" },
      ],
    } as unknown as Site;
    const library = { docs: markdown, tree: buildTree(markdown), tags: [], statuses: [] } as unknown as Library;
    const page = (options: Partial<Site>) => searchPage({ ...site, ...options }, library, searchDocs(markdown, DEFAULT_PARAMS));

    expect(page({})).toContain(
      '<nav class="sections" aria-label="Sections"><a class="section-link" href="/sub/" aria-current="page">Docs</a><a class="section-link" href="/sub/reference/">API reference</a><a class="section-link" href="/sub/api-docs/v2/">Old &lt;API&gt;</a></nav>',
    );
    expect(page({ builds: true })).toContain(
      '<a class="section-link" href="/sub/api-docs/v2/">Old &lt;API&gt;</a><a class="section-link" href="/sub/builds">Builds</a></nav>',
    );
    expect(page({ mounts: [] })).not.toContain('class="sections"');
  });
});

describe("dev server with mounts", () => {
  let dev: DevServer;
  let startWarnings: string[];
  const get = (path: string) => fetch(new URL(path, dev.server.url), { redirect: "manual" });
  const moved = async (path: string) => {
    const res = await get(path);
    return [res.status, res.headers.get("location")];
  };

  beforeAll(async () => {
    const config = await loadConfig(docs, {
      mounts: [REFERENCE, { dir: "../doc/not-yet", path: "later/v1", label: "Later", search: { format: "dartdoc" } }],
    });
    const started = await warningsDuring(() => createDevServer(config, { port: 0 }));
    dev = started.result;
    startWarnings = started.warnings;
  });

  afterAll(async () => {
    await dev.stop();
  });

  test("a missing folder is reported once, when the server starts", () => {
    expect(startWarnings).toHaveLength(1);
    expect(startWarnings[0]).toContain(`Mounted folder not found: ${join(project, "doc/not-yet")} (mounts "later/v1")`);
  });

  test("the mount's address redirects to its folder form, keeping the query", async () => {
    expect(await moved("/sub/reference")).toEqual([301, "/sub/reference/"]);
    expect(await moved("/sub/reference?q=1")).toEqual([301, "/sub/reference/?q=1"]);
    expect(await moved("/sub/reference/greeting")).toEqual([301, "/sub/reference/greeting/"]);
    expect(await moved("/sub/reference/greeting?x=1")).toEqual([301, "/sub/reference/greeting/?x=1"]);
  });

  test("serves files, and folders as their index.html", async () => {
    expect(await (await get("/sub/reference/")).text()).toBe("<p>API home</p>");
    expect(await (await get("/sub/reference/greeting/")).text()).toBe("<p>Library greeting</p>");
    const page = await get("/sub/reference/greeting/Mood.html");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toBe("<p>Mood page</p>");
    expect((await get("/sub/reference/index.json")).status).toBe(200);
    // A symlink to a file inside the folder is served; a folder without index.html isn't.
    expect(await (await get("/sub/reference/mood-link.html")).text()).toBe("<p>Mood page</p>");
    expect((await get("/sub/reference/greeting/Greeter/")).status).toBe(404);
  });

  test("refuses hidden names, paths out of the folder and symlinks that escape it", async () => {
    const refused = [
      "/sub/reference/.secret",
      "/sub/reference/.hidden/page.html",
      "/sub/reference/hidden-link.html",
      "/sub/reference/..%2f..%2fsecret.txt",
      "/sub/reference/greeting%2f..%2f..%2f..%2fsecret.txt",
      "/sub/reference/%2e%2e%2f%2e%2e%2fsecret.txt",
      "/sub/reference/escape.html",
      "/sub/reference/escape-dir/secret.txt",
      "/sub/reference/missing.html",
      "/sub/reference/greeting/Mood.html/",
    ];
    for (const path of refused) {
      const res = await get(path);
      expect([path, res.status]).toEqual([path, 404]);
      // The docfold 404 page, as for files/*.
      expect(await res.text()).toContain("Page not found");
    }
  });

  test("a mount whose folder doesn't exist answers with the 404 page", async () => {
    expect(await moved("/sub/later/v1")).toEqual([301, "/sub/later/v1/"]);
    const res = await get("/sub/later/v1/");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Page not found");
  });

  test("searches the mounted entries with the documents", async () => {
    const api = (await (await get("/sub/api/search?q=greet")).json()) as { total: number; results: Record<string, unknown>[] };
    expect(api.total).toBe(7);
    expect(api.results.map((result) => result.title)).toEqual(["Greeter.greet", "greeting", "Greeter", "Mood", "mystery", "Intro"]);
    const intro = api.results.find((result) => result.title === "Intro");
    const greet = api.results.find((result) => result.title === "Greeter.greet");
    expect(intro).not.toHaveProperty("source");
    expect(greet).toMatchObject({
      path: "greeting.Greeter.greet",
      url: "/sub/reference/greeting/Greeter/greet.html",
      folder: "reference",
      status: null,
      tags: [],
      source: { path: "reference", label: "API reference", kind: "method" },
    });

    const narrowed = (await (await get("/sub/api/search?q=greet&folder=reference")).json()) as { results: { folder: string }[] };
    expect(narrowed.results.map((result) => result.folder)).toEqual(Array(5).fill("reference"));

    const index = (await (await get("/sub/search-index.json")).json()) as IndexedDoc[];
    expect(index.map((doc) => doc.title)).toEqual(["Intro", "Next steps", "greeting", "Greeter", "Greeter.greet", "Mood", "mystery"]);
    expect(index[0]).not.toHaveProperty("source");

    const list = await (await get("/sub/?q=greet")).text();
    expect(list).toContain('<span class="badge" data-source="reference">API reference · method</span>');
    expect(list).toContain('<a class="section-link" href="/sub/reference/">API reference</a>');
    expect(list).toContain('<a class="section-link" href="/sub/later/v1/">Later</a>');
    expect(await (await get("/sub/assets/styles.css")).text()).toContain(".section-link {");
  });
});

describe("watching mounted folders", () => {
  let dir: string;

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("re-reads a mount's index when its folder changes, or appears, and reloads pages", async () => {
    dir = await mkdtemp(join(tmpdir(), "docfold-mount-watch-"));
    await writeConfig(join(dir, "docs"), {
      watch: { debounce: 20 },
      mounts: [{ dir: "../api", path: "reference", label: "API", search: { format: "dartdoc" } }],
    });
    await Bun.write(join(dir, "docs/intro.md"), "# Intro\n");
    const { result: dev } = await warningsDuring(async () => createDevServer(await loadConfig(join(dir, "docs")), { port: 0 }));
    const titles = async () =>
      ((await (await fetch(new URL("/search-index.json", dev.server.url))).json()) as IndexedDoc[]).map((doc) => doc.title);
    const socket = new WebSocket(new URL("/__docfold/events", dev.server.url.href.replace(/^http/, "ws")));
    const reloads: string[] = [];
    socket.addEventListener("message", (event) => reloads.push(String(event.data)));
    const until = async (check: () => Promise<boolean>) => {
      for (let i = 0; i < 60 && !(await check()); i++) await Bun.sleep(50);
      return check();
    };

    try {
      await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
      expect(await titles()).toEqual(["Intro"]);

      // The folder appears (as when dart doc first runs), all at once.
      await cp(FIXTURE, join(dir, "staging"), { recursive: true });
      await rename(join(dir, "staging"), join(dir, "api"));
      expect(await until(async () => (await titles()).includes("Greeter.greet"))).toBe(true);
      expect(await until(async () => reloads.includes("reload"))).toBe(true);

      // It changes.
      await Bun.write(join(dir, "api/index.json"), JSON.stringify([{ name: "Hello", href: "hello.html", kind: 3, desc: "" }]));
      expect(await until(async () => (await titles()).join() === "Intro,Hello")).toBe(true);
    } finally {
      socket.close();
      await dev.stop();
    }
  });
});

describe("build with mounts", () => {
  test("copies each folder to its address, as dev serves it, and searches its index", async () => {
    const config = await loadConfig(docs);
    const result = await build(config);
    expect(result).toMatchObject({ pages: 3, mountFiles: 9, mountEntries: 5, missingMounts: [] });

    const out = config.outDir;
    const copied = (await readdir(join(out, "reference"), { recursive: true })).map(String).sort();
    expect(copied).toEqual([
      "greeting",
      "greeting/Greeter",
      "greeting/Greeter-class.html",
      "greeting/Greeter/greet.html",
      "greeting/Greeter/toString.html",
      "greeting/Mood.html",
      "greeting/index.html",
      "greeting/mystery.html",
      "index.html",
      "index.json",
      "mood-link.html",
    ]);
    expect(await Bun.file(join(out, "reference/mood-link.html")).text()).toBe("<p>Mood page</p>");

    const index = (await Bun.file(join(out, "search-index.json")).json()) as IndexedDoc[];
    expect(index.filter((doc) => doc.source).map((doc) => doc.title)).toEqual(["greeting", "Greeter", "Greeter.greet", "Mood", "mystery"]);
    const list = await Bun.file(join(out, "index.html")).text();
    expect(list).toContain('<span class="badge" data-source="reference">API reference · class</span>');
    expect(list).toContain('<a class="section-link" href="/sub/reference/">API reference</a>');
    expect(await Bun.file(join(out, "assets/styles.css")).text()).toContain(".section-link {");

    // Preview: a folder under a mount gets its trailing slash, like on a static host.
    const preview = await createPreviewServer(config, { port: 0 });
    const get = (path: string) => fetch(new URL(path, preview.server.url), { redirect: "manual" });
    try {
      expect((await get("/sub/reference")).headers.get("location")).toBe("/sub/reference/");
      expect((await get("/sub/reference/greeting?x=1")).headers.get("location")).toBe("/sub/reference/greeting/?x=1");
      expect(await (await get("/sub/reference/greeting/")).text()).toBe("<p>Library greeting</p>");
      expect(await (await get("/sub/reference/greeting/Mood.html")).text()).toBe("<p>Mood page</p>");
      expect((await get("/sub/reference/.secret")).status).toBe(404);
      // Elsewhere nothing changes: a folder of pages is not a page.
      const guide = await get("/sub/docs/guide");
      expect([guide.status, guide.headers.get("location")]).toEqual([404, null]);
      expect((await get("/sub/docs/guide/intro/")).headers.get("location")).toBe("/sub/docs/guide/intro");
    } finally {
      await preview.stop();
    }
  });

  test("a missing folder is reported, not fatal", async () => {
    const config = await loadConfig(docs, { mounts: [REFERENCE, { dir: "../doc/not-yet", path: "later", label: "Later" }] });
    const { result, warnings } = await warningsDuring(() => build(config));
    expect(result).toMatchObject({ mountFiles: 9, mountEntries: 5, missingMounts: [join(project, "doc/not-yet")] });
    expect(warnings).toEqual([]);
    expect(await Bun.file(join(config.outDir, "later")).exists()).toBe(false);
  });

  test("the summary has a line for mounts only when there are mounts", async () => {
    const out = await mkdtemp(join(tmpdir(), "docfold-mount-cli-"));
    const run = async (...args: string[]) => {
      const child = Bun.spawn(["bun", CLI, "build", docs, "--out", out, ...args], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
      await child.exited;
      return stdout + stderr;
    };
    try {
      const printed = await run();
      expect(printed).toContain("Built 3 pages and copied 0 linked files in");
      expect(printed).toContain("  Mounted 1 folder: copied 9 files, indexed 5 search entries\n");
      expect(printed).not.toContain("not found");

      await writeConfig(docs, { title: "Mounted", base: "sub", mounts: [REFERENCE, { dir: "../doc/not-yet", path: "later", label: "Later" }] });
      const missing = await run();
      expect(missing).toContain("  Mounted 1 folder: copied 9 files, indexed 5 search entries\n");
      expect(missing).toContain("Mounted folders not found, so not copied or searched");
      expect(missing).toContain("doc/not-yet (for later/)");

      await writeConfig(docs, { title: "Mounted", base: "sub" });
      expect(await run()).not.toContain("Mounted");
    } finally {
      await writeConfig(docs, { title: "Mounted", base: "sub", mounts: [REFERENCE] });
      await rm(out, { recursive: true, force: true });
    }
  });

  test("refuses an outDir that holds a mounted folder or sits inside one", async () => {
    // The config's checks catch it first…
    expect(await failure(() => loadConfig(docs, { outDir: "../doc" }))).toContain("must not be inside outDir");
    expect(await failure(() => loadConfig(docs, { outDir: "../doc/api/site" }))).toContain("must not contain outDir");

    // …and the build checks again before emptying anything, for configs made by hand.
    const config = await loadConfig(docs);
    for (const outDir of [join(api, "site"), join(project, "doc")]) {
      expect(await failure(() => build({ ...config, outDir }))).toContain("and the mounted folder");
    }
    expect(await Bun.file(join(api, "greeting/Mood.html")).text()).toBe("<p>Mood page</p>");
  });
});

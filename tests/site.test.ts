import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, BUILD_MARKER, createDevServer, createPreviewServer } from "../src/commands";
import { loadConfig, parsePort, themeStyle } from "../src/config";
import { createUrls, normalizeBase } from "../src/shared/urls";
import type { DevServer, UserConfig } from "../src/types";

let root: string;
let homeRoot: string;

// Plain object exports: the temp folders can't resolve the "@moulibheemaneti/docfold" package for defineConfig.
const writeConfig = (dir: string, config: UserConfig) =>
  Bun.write(join(dir, "docfold.config.ts"), `export default ${JSON.stringify(config)};`);

const client = (dev: DevServer) => (path: string) => fetch(new URL(path, dev.server.url), { redirect: "manual" });

/** Opens a live-reload socket the way a page does, once it is connected. */
const liveReload = (dev: DevServer, path: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(new URL(path, dev.server.url.href.replace(/^http/, "ws")));
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error(`Could not connect to ${path}`)), { once: true });
  });

/**
 * Waits for "reload" messages until one arrives after which `check()` passes. A single message isn't
 * enough: the OS can deliver a change made just before the watcher started (another test's file).
 */
const reloadsUntil = (socket: WebSocket, check: () => Promise<boolean>, timeout = 3000): Promise<boolean> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeout);
    socket.addEventListener("message", async (event) => {
      if (event.data === "reload" && (await check())) {
        clearTimeout(timer);
        resolve(true);
      }
    });
  });

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "docfold-site-"));
  await writeConfig(root, {
    title: "Test Docs",
    srcDir: "content",
    base: "sub",
    theme: { colors: { primary: "#123456" }, dark: { bg: "#000" } },
  });
  await Bun.write(
    join(root, "content/guide/intro.md"),
    "---\ntitle: Intro\ntags: [setup]\nstatus: accepted\n---\nSee [next](next.md) and ![diagram](img/a.png).\n",
  );
  await Bun.write(join(root, "content/guide/next.md"), "# Next steps\n\nBody text.\n");
  await Bun.write(join(root, "content/guide/img/a.png"), "PNG");
  await Bun.write(join(root, "content/unlinked.txt"), "not linked from any markdown");

  homeRoot = await mkdtemp(join(tmpdir(), "docfold-home-"));
  await writeConfig(homeRoot, {
    title: "Home Docs",
    description: "Every decision we made.",
    srcDir: "content",
    base: "sub",
    header: {
      logo: { src: "/logo.svg", dark: "/logo-dark.svg" },
      tag: false,
      action: { text: "Start here", link: "/docs?tag=setup" },
    },
    home: {
      hero: {
        text: "Decision records",
        image: "/logo.svg",
        actions: [
          { text: "Browse", link: "/docs" },
          { text: "Source", link: "https://example.com/repo" },
        ],
      },
      features: [
        { icon: "🔎", title: "Search", details: "Find <anything>", link: "/docs", linkText: "Open" },
        { title: "Plain card" },
      ],
    },
  });
  await Bun.write(join(homeRoot, "content/a.md"), "---\ntitle: Alpha\ntags: [setup]\n---\nA.\n");
  await Bun.write(join(homeRoot, "content/b.md"), "# Beta\n");
  await Bun.write(join(homeRoot, "public/logo.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  await Bun.write(join(homeRoot, "public/.secret"), "hidden");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(homeRoot, { recursive: true, force: true });
});

describe("urls", () => {
  test("normalizeBase always has leading and trailing slashes", () => {
    expect(normalizeBase()).toBe("/");
    expect(normalizeBase("")).toBe("/");
    expect(normalizeBase("docs")).toBe("/docs/");
    expect(normalizeBase("/a//b")).toBe("/a/b/");
  });

  test("the documents list moves to docs/ when there's a home page", () => {
    expect(createUrls("/sub/").search("tag=a")).toBe("/sub/?tag=a");
    expect(createUrls("/sub/", { home: true }).search("tag=a")).toBe("/sub/docs?tag=a");
    expect(createUrls("/sub/", { home: true }).home()).toBe("/sub/");
  });

  test("config links resolve against the base; external ones don't", () => {
    const urls = createUrls("/sub/");
    expect(urls.link("/logo.svg")).toBe("/sub/logo.svg");
    expect(urls.link("img/logo.svg")).toBe("/sub/img/logo.svg");
    expect(urls.link("/sub/docs")).toBe("/sub/docs");
    for (const external of ["https://x.dev/a", "//cdn.x/a.png", "mailto:a@b.c", "#top", "data:image/png;base64,AA"]) {
      expect(urls.link(external)).toBe(external);
    }
  });
});

describe("config", () => {
  test("loads docfold.config.ts, resolves paths and applies overrides", async () => {
    const config = await loadConfig(root, { outDir: "public" });
    expect(config).toMatchObject({
      root,
      configFile: join(root, "docfold.config.ts"),
      title: "Test Docs",
      srcDir: join(root, "content"),
      outDir: join(root, "public"),
      publicDir: join(root, "public"),
      base: "/sub/",
      port: 3000,
      watch: false,
      home: false,
      header: { name: "Test Docs", tag: "Docs", action: { text: "Get Started" } },
    });
    expect(config.theme.googleFonts).toBe(true);
  });

  test("parsePort accepts 0–65535 and names the bad value", () => {
    expect(parsePort("0")).toBe(0);
    expect(parsePort(8080)).toBe(8080);
    for (const bad of ["", "abc", "1.5", -1, 65536]) expect(() => parsePort(bad, "--port")).toThrow(`Invalid --port: ${bad}`);
  });

  test("an explicit config file that doesn't exist is a clear error", async () => {
    await expect(loadConfig(join(root, "missing.config.ts"))).rejects.toThrow("Config file not found");
  });

  test("works without a config file", async () => {
    const config = await loadConfig(join(root, "content"));
    expect(config.configFile).toBeUndefined();
    expect(config.srcDir).toBe(join(root, "content"));
    expect(config.title).toBe("Docs");
  });

  test("watch, home and header shorthands", async () => {
    expect((await loadConfig(root, { watch: true })).watch).toEqual({ liveReload: true, debounce: 80 });
    expect((await loadConfig(root, { watch: { liveReload: false } })).watch).toEqual({ liveReload: false, debounce: 80 });
    await expect(loadConfig(root, { watch: { debounce: -1 } })).rejects.toThrow("watch.debounce");

    const home = await loadConfig(root, { home: true, header: { logo: "/logo.svg", name: false, action: false } });
    expect(home.home).toEqual({ hero: { image: undefined }, features: [], file: join(root, "home.html") });
    expect(home.header).toEqual({ logo: { src: "/logo.svg" }, name: false, tag: "Docs", action: false });
  });

  test("theme variables can't break out of the <style> tag", () => {
    const css = themeStyle({
      colors: { primary: "#123", "bad</style><script>": "x" },
      light: {},
      dark: { bg: "red;}</style><script>alert(1)</script>" },
      googleFonts: false,
    });
    expect(css).toBe(
      "<style>:root{--primary:#123;--badstylescript:x}@media (prefers-color-scheme: dark){:root{--bg:red/stylescriptalert(1)/script}}</style>",
    );
  });
});

describe("dev server", () => {
  test("serves pages, search and files under the base path", async () => {
    const dev = await createDevServer(await loadConfig(root), { port: 0 });
    const get = client(dev);

    try {
      const home = await (await get("/sub/")).text();
      expect(home).toContain('data-base="/sub/"');
      expect(home).toContain('data-mode="dev"');
      expect(home).toContain('data-page="search"');
      expect(home).toContain('href="/sub/assets/styles.css"');
      expect(home).toContain("--primary:#123456");
      expect(home).toContain("2 documents");
      // Default header: title, "Docs" badge and a "Get Started" button to the documents list.
      expect(home).toContain('<span class="brand-name">Test Docs</span><span class="brand-tag">Docs</span>');
      expect(home).toContain('<a class="button topbar-action" href="/sub/">Get Started</a>');

      expect(await (await get("/sub/?tag=setup")).text()).toContain("1 result");
      expect((await get("/")).headers.get("location")).toBe("/sub/");
      // Without a home page the list stays at the root.
      expect((await get("/sub/docs?tag=setup")).headers.get("location")).toBe("/sub/?tag=setup");

      const page = await get("/sub/docs/guide/intro");
      expect(page.status).toBe(200);
      const pageHtml = await page.text();
      expect(pageHtml).toContain('href="/sub/docs/guide/next"');
      expect(pageHtml).toContain('src="/sub/files/guide/img/a.png"');

      const index = (await (await get("/sub/search-index.json")).json()) as Record<string, unknown>[];
      expect(index.map((doc) => doc.title)).toEqual(["Intro", "Next steps"]);
      expect(index[0]).not.toHaveProperty("html");

      expect((await get("/sub/files/guide/img/a.png")).status).toBe(200);
      // Like the build: only files the markdown links to, never anything else in the folder.
      expect((await get("/sub/files/unlinked.txt")).status).toBe(404);
      expect((await get("/sub/files/..%2fdocfold.config.ts")).status).toBe(404);
      expect((await get("/sub/docs/missing")).status).toBe(404);
      // Old trailing-slash and .md links land on the clean URL.
      expect((await get("/sub/docs/guide/intro/?x=1")).headers.get("location")).toBe("/sub/docs/guide/intro?x=1");
      expect((await get("/sub/docs/guide/intro.md")).headers.get("location")).toBe("/sub/docs/guide/intro");
      expect((await get("/sub/assets/app.js")).headers.get("content-type")).toContain("javascript");
    } finally {
      await dev.stop();
    }
  });

  test("reads the markdown once when watch is off (the default)", async () => {
    const dev = await createDevServer(await loadConfig(root), { port: 0 });
    const get = client(dev);
    const added = join(root, "content/added.md");

    try {
      expect(await (await get("/sub/")).text()).not.toContain("data-live-reload");
      expect((await get("/sub/__docfold/events")).status).toBe(404);

      await Bun.write(added, "# Added\n");
      await Bun.sleep(200);
      expect(await (await get("/sub/")).text()).toContain("2 documents");
    } finally {
      await dev.stop();
      await rm(added, { force: true });
    }
  });

  test("watch: true re-reads changed files and reloads open pages", async () => {
    const dev = await createDevServer(await loadConfig(root, { watch: { debounce: 20 } }), { port: 0 });
    const get = client(dev);

    try {
      expect(await (await get("/sub/")).text()).toContain("data-live-reload");

      // Every open page gets told, however many there are (browsers cap plain HTTP connections at 6 per host).
      const pages = await Promise.all(Array.from({ length: 8 }, () => liveReload(dev, "/sub/__docfold/events")));
      await Bun.write(join(root, "content/guide/next.md"), "# Next steps\n\nEdited.\n");
      const edited = async () => (await (await get("/sub/docs/guide/next")).text()).includes("Edited.");
      expect(await Promise.all(pages.map((page) => reloadsUntil(page, edited)))).toEqual(Array(8).fill(true));
      for (const page of pages) page.close();

      // A plain request is refused rather than held open: a long-lived HTTP response per page used up
      // the browser's connections to the host, and new pages then never loaded.
      const plain = await get("/sub/__docfold/events");
      expect(plain.status).toBe(426);
      expect(plain.headers.get("content-type")).not.toContain("event-stream");
    } finally {
      await dev.stop();
    }
  });
});

describe("home page", () => {
  test("renders the hero, cards and branded header; the list moves to /docs", async () => {
    const dev = await createDevServer(await loadConfig(homeRoot), { port: 0 });
    const get = client(dev);

    try {
      const home = await (await get("/sub/")).text();
      expect(home).toContain('data-page="home"');
      expect(home).toContain('<meta name="description" content="Every decision we made.">');
      expect(home).not.toContain('id="sidebar"');

      // Header: logo with a dark variant, name (decorative logo), no badge, custom action.
      expect(home).toContain(
        '<picture><source srcset="/sub/logo-dark.svg" media="(prefers-color-scheme: dark)"><img class="brand-logo" src="/sub/logo.svg" alt=""></picture><span class="brand-name">Home Docs</span></a>',
      );
      expect(home).not.toContain("brand-tag");
      expect(home).toContain('<a class="button topbar-action" href="/sub/docs?tag=setup">Start here</a>');

      // Hero
      expect(home).toContain('<span class="hero-name">Home Docs</span> <span class="hero-text">Decision records</span>');
      expect(home).toContain('<p class="hero-tagline">Every decision we made.</p>');
      expect(home).toContain('<a class="hero-action is-brand" href="/sub/docs">Browse</a>');
      expect(home).toContain('<a class="hero-action is-alt" href="https://example.com/repo">Source</a>');
      expect(home).toContain('<img class="hero-image" src="/sub/logo.svg" alt="">');

      // Feature cards: escaped text, linked and plain cards.
      expect(home).toContain("Find &lt;anything&gt;");
      expect(home).toContain('<a class="feature-card" href="/sub/docs">');
      expect(home).toContain('<div class="feature-card">');

      const list = await get("/sub/docs");
      expect(list.status).toBe(200);
      const listHtml = await list.text();
      expect(listHtml).toContain('data-page="search"');
      expect(listHtml).toContain('data-home');
      expect(listHtml).toContain('action="/sub/docs"');
      expect(listHtml).toContain("2 documents");

      expect((await get("/sub/docs/")).headers.get("location")).toBe("/sub/docs");
      expect((await get("/sub/?tag=setup")).headers.get("location")).toBe("/sub/docs?tag=setup");

      // publicDir files, without dot-files or escaping the folder.
      expect(await (await get("/sub/logo.svg")).text()).toContain("<svg");
      expect((await get("/sub/.secret")).status).toBe(404);
      expect((await get("/sub/..%2fdocfold.config.ts")).status).toBe(404);
    } finally {
      await dev.stop();
    }
  });

  test("home.html replaces the generated home page", async () => {
    const dev = await createDevServer(await loadConfig(homeRoot), { port: 0 });
    const get = client(dev);
    const file = join(homeRoot, "home.html");

    try {
      // A fragment keeps the site header.
      await Bun.write(file, '<section class="custom">Hello</section>');
      const fragment = await (await get("/sub/")).text();
      expect(fragment).toContain('<main class="main" id="main"><section class="custom">Hello</section></main>');
      expect(fragment).toContain('class="topbar"');
      expect(fragment).not.toContain("hero-name");

      // A full document is served as it is.
      const full = "<!doctype html>\n<html><body>Own page</body></html>\n";
      await Bun.write(file, full);
      expect(await (await get("/sub/")).text()).toBe(full);
    } finally {
      await dev.stop();
      await rm(file, { force: true });
    }
  });

  test("build writes the home page, the list at docs/ and publicDir", async () => {
    const config = await loadConfig(homeRoot);
    const result = await build(config);
    expect(result).toMatchObject({ pages: 4, publicFiles: 1 });

    const files = (await readdir(config.outDir, { recursive: true })).map(String);
    expect(files).toEqual(expect.arrayContaining(["index.html", "docs.html", "logo.svg"]));
    expect(files).not.toContain(".secret");
    expect(await Bun.file(join(config.outDir, "index.html")).text()).toContain("hero-name");
    expect(await Bun.file(join(config.outDir, "docs.html")).text()).toContain('data-page="search"');

    await expect(build(await loadConfig(homeRoot, { outDir: "public" }))).rejects.toThrow("must not contain each other");
  });

  test("build reports hidden and missing linked files instead of copying them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "docfold-links-"));
    try {
      await Bun.write(join(dir, ".env"), "SECRET=1");
      await Bun.write(join(dir, "img/ok.png"), "PNG");
      await Bun.write(join(dir, "doc.md"), "![ok](img/ok.png) [env](.env) [gone](gone.pdf) [folder](img)");
      const config = await loadConfig(dir);
      const result = await build(config);

      expect(result.files).toBe(1);
      expect(result.missingFiles.sort()).toEqual([".env", "gone.pdf", "img"]);
      const files = (await readdir(config.outDir, { recursive: true })).map(String);
      expect(files).toContain("files/img/ok.png");
      expect(files).not.toContain("files/.env");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("build + preview", () => {
  test("writes a static site that preview serves like a static host", async () => {
    const config = await loadConfig(root);
    const result = await build(config);
    expect(result).toMatchObject({ pages: 3, files: 1, publicFiles: 0, missingFiles: [] });

    const out = config.outDir;
    const files = (await readdir(out, { recursive: true })).map(String).sort();
    expect(files).toEqual(
      expect.arrayContaining([
        BUILD_MARKER,
        ".nojekyll",
        "404.html",
        "assets/app.js",
        "assets/styles.css",
        "docs/guide/intro.html",
        "docs/guide/next.html",
        "files/guide/img/a.png",
        "index.html",
        "search-index.json",
      ]),
    );
    expect(files).not.toContain("files/unlinked.txt");
    expect(files).not.toContain("docs.html");
    expect(await Bun.file(join(out, "index.html")).text()).toContain('data-mode="static"');

    // Re-building over its own output is fine.
    await build(config);

    // Preview uses the base the site was built with, even if the config now says otherwise.
    const other = await createPreviewServer({ ...config, base: "/" }, { port: 0 });
    expect(other.url.pathname).toBe("/sub/");

    // A busy port moves on to the next one, unless told not to.
    const busyPort = Number(other.url.port);
    const next = await createPreviewServer(config, { port: busyPort });
    expect(Number(next.url.port)).toBeGreaterThan(busyPort);
    await next.stop();
    await expect(createPreviewServer(config, { port: busyPort, findFreePort: false })).rejects.toThrow();
    await other.stop();

    const preview = await createPreviewServer(config, { port: 0 });
    const get = (path: string) => fetch(new URL(path, preview.server.url), { redirect: "manual" });
    try {
      expect((await get("/sub/")).status).toBe(200);
      // Like GitHub Pages: "/docs/guide/intro" is served from docs/guide/intro.html.
      expect(await (await get("/sub/docs/guide/intro")).text()).toContain("<h1>Intro</h1>");
      expect((await get("/sub/docs/guide/intro/")).headers.get("location")).toBe("/sub/docs/guide/intro");
      expect((await get("/sub/docs/guide")).status).toBe(404);
      expect((await get("/sub/search-index.json")).status).toBe(200);
      expect((await get("/")).headers.get("location")).toBe("/sub/");

      const missing = await get("/sub/nope/");
      expect(missing.status).toBe(404);
      expect(await missing.text()).toContain("Page not found");
      expect((await get("/sub/..%2fdocfold.config.ts")).status).toBe(404);
    } finally {
      await preview.stop();
    }
  });

  test("refuses to wipe folders it didn't create", async () => {
    const other = await mkdtemp(join(tmpdir(), "docfold-guard-"));
    try {
      await Bun.write(join(other, "keep/important.txt"), "user data");
      await Bun.write(join(other, "doc.md"), "# Doc");

      await expect(build(await loadConfig(other, { outDir: "keep" }))).rejects.toThrow("wasn't created by docfold");
      await expect(build(await loadConfig(other, { outDir: "." }))).rejects.toThrow("must not be the project folder");
      await expect(build(await loadConfig(other, { srcDir: "keep", outDir: "." }))).rejects.toThrow();
      expect(await Bun.file(join(other, "keep/important.txt")).text()).toBe("user data");
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });
});

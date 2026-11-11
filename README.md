<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/docfold-logo-dark.svg">
    <img src="./assets/docfold-logo.svg" alt="docfold" width="320">
  </picture>
</h1>

<p align="center">Turn a folder of markdown into a searchable docs site.<br>Folders become the sidebar, front matter becomes filters. Runs on Bun.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@moulibheemaneti/docfold"><img src="https://img.shields.io/npm/v/@moulibheemaneti/docfold" alt="npm version"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

<p align="center"><a href="https://www.npmjs.com/package/@moulibheemaneti/docfold">npm</a> · <a href="https://github.com/moulibheemaneti/docfold">GitHub</a></p>

- **Your folders are the navigation.** Every folder, sub-folder and `.md` file shows up in the sidebar. No sidebar config.
- **Your front matter is the filter.** `tags`, `status` and `date` become filter chips (with counts), status badges and sort orders. Combine them with full-text search.
- **No framework.** Pages are plain HTML with a small script on top; they work with JavaScript off. No React, Vue or Vite; the only requirement is [Bun](https://bun.sh).
- **Static output.** `docfold build` writes a folder you can host anywhere (GitHub Pages, Netlify, S3, nginx). Search runs in the browser.
- **Your branding.** Logo, name and one "Get Started" button in the header, and an optional landing page with a hero and feature cards (or your own `home.html`).

It's built for **collections of records**: decision records (ADRs), RFCs, specs, runbooks, meeting notes, an internal knowledge base. Anything where finding a page by its labels matters more than reading pages in order.

## Quick start

```sh
bun add -d @moulibheemaneti/docfold
```

Put markdown files in a folder:

```md
---
title: Disable Swift Package Manager
status: accepted
date: 2026-11-11
tags: [ios, build]
description: Optional one-line summary shown in results.
---

## Context
…
```

Then run:

```sh
bunx docfold dev      # http://localhost:3000 (add watch: true to the config to reload on save)
bunx docfold build    # static site in ./dist
bunx docfold preview  # serve ./dist to check the build
```

Or add scripts to `package.json`:

```json
{
  "scripts": {
    "docs:dev": "docfold dev",
    "docs:build": "docfold build",
    "docs:preview": "docfold preview"
  }
}
```

Bun is required (`docfold` uses Bun's built-in markdown renderer, YAML parser, bundler and server). It works the same in any repository: JavaScript, Flutter, Go, Python, or plain docs.

## Front matter

All fields are optional.

| Field | Used for |
|---|---|
| `title` | Page and result title. Falls back to a leading `# Heading`, then the file name. |
| `tags` | Filter chips (match **all** or **any** selected tag). A list or a comma-separated string. |
| `status` | Filter chips and a coloured badge. `accepted`, `approved`, `done` are green; `proposed`, `draft`, `in-progress` are amber; `rejected`, `blocked` are red; `deprecated`, `superseded` are struck through. |
| `date` | "Newest / oldest first" sorting, shown on results and pages. |
| `description` (or `summary`) | Lead paragraph on the page, and the excerpt in results. |

Relative links between files work as you'd expect: `[see](../ios/0001-spm.md#context)` opens that page, and `![diagram](./img/flow.png)` shows the image. Only linked files are served (by `dev`) and copied (by `build`); hidden paths such as `.env` or `.git/…` and `node_modules` never are, even when linked. `build` lists the links it couldn't copy.

## Search and filters

The documents list (the site root, or `/docs` when there's a [home page](#home-page)) searches titles, tags, headings, file paths, status and body text. Every word must match; `"quoted phrases"` match exactly. Title and tag matches rank highest.

Every filter lives in the URL, so searches can be bookmarked and shared:

| Parameter | Example |
|---|---|
| `q` | `?q=riverpod "build context"` |
| `tag` (repeatable) | `?tag=ios&tag=build` |
| `match` | `?tag=ios&tag=flutter&match=any` (default `all`) |
| `status` (repeatable) | `?status=accepted` |
| `folder` | `?folder=architecture/state` (includes sub-folders) |
| `sort` | `relevance` (default), `newest`, `oldest`, `title` |

The dev server also answers the same parameters as JSON at `/api/search`.

## Configuration

Optional `docfold.config.ts` (or `.js` / `.mjs`) in the folder you run `docfold` from:

```ts
import { defineConfig } from "@moulibheemaneti/docfold";

export default defineConfig({
  title: "My Project",          // top bar and page titles (default "Docs")
  description: "One line about the site.", // meta description and default hero tagline
  srcDir: "content",            // markdown folder, relative to this file (default ".")
  outDir: "dist",               // build output (default "dist")
  publicDir: "public",          // files served as-is from the site root: public/logo.svg → /logo.svg
  base: "/my-repo/",            // when hosted in a sub-folder, e.g. GitHub Pages project sites
  port: 3000,                   // dev server port
  watch: true,                  // dev only: reload open pages on save (default false)
  header: { logo: "/logo.svg" },
  home: { hero: { text: "Engineering docs" } },  // a landing page (default: none)
  theme: {
    colors: { primary: "#1d3557", secondary: "#f1c40f" },  // both light and dark
    light: { bg: "#ffffff" },                               // light mode only
    dark: { bg: "#0b0b0b" },                                // dark mode only
    css: "./theme.css",         // extra stylesheet appended after the theme
    googleFonts: false,         // use system fonts instead of Lora + Hanken Grotesk
  },
  head: ['<link rel="icon" href="/favicon.svg">'],
});
```

Folders starting with `.`, `node_modules`, `outDir` and `publicDir` are never scanned.

### Header

```ts
header: {
  logo: "/logo.svg",              // a file in publicDir, any URL, or { src, dark, alt }
  name: "My Project",             // text beside the logo (default: title); false = logo only
  tag: "Docs",                    // small badge after the name (default "Docs"); false hides it
  action: { text: "Get Started", link: "/docs" }, // the one button on the right; false hides it
},
```

The button links to the documents list unless you give it a `link`. Links and image paths starting with `/` are resolved against `base`, so `/docs` works on GitHub Pages too. On phones, a header with a logo shows only the logo.

### Home page

Off by default: the site opens on the documents list. Set `home` to get a landing page; the documents list then moves to `/docs` (old `/?tag=…` links are forwarded there).

```ts
home: {
  hero: {
    name: "My Project",           // big gradient text (default: title)
    text: "Engineering docs",     // heading under it
    tagline: "Decisions, specs and runbooks.",  // default: description
    image: "/logo.svg",           // on the right, with a soft glow; or { src, dark, alt }
    actions: [
      { text: "Browse documents", link: "/docs" },              // first one is the filled button
      { text: "Accepted decisions", link: "/docs?status=accepted" },
    ],
  },
  features: [
    { icon: "🔎", title: "Search everything", details: "Titles, tags, headings and text.", link: "/docs", linkText: "Search" },
    { icon: { src: "/icons/tag.svg" }, title: "Filter by tag" },
  ],
},
```

`home: true` gives the defaults: your title, `description` and a "Browse documents" button.

**Your own page.** Put a `home.html` next to the config file (or point `home.file` at another file) and it replaces the generated hero and cards. A fragment such as `<section>…</section>` is shown inside the site's header and styles; a full document (starting with `<!doctype html>` or `<html>`) is served exactly as it is. The home page sits at the site root, so relative links like `docs` and `logo.svg` work under any `base`. `home.html` is only used while `home` is set.

### Watching for changes

`docfold dev` reads the markdown once when it starts. To pick up edits without restarting, turn watching on in the config. There's no command-line flag; it's a config setting:

```ts
watch: true,                                   // re-read on save and reload open pages
watch: { liveReload: false },                  // re-read on save; you refresh the page yourself
watch: { debounce: 200 },                      // wait longer for editors that save in several steps
```

With watching on, the docs folder, `home.html`, `theme.css` and `publicDir` are all watched.

### Theme variables

Override any of these through `theme.colors` / `light` / `dark` (without the `--`) or in `theme.css`:

| Variable | What it colours |
|---|---|
| `primary` / `primary-deep` | Top bar, links, selected filters, page titles / link hover |
| `secondary` / `secondary-hover` / `on-secondary` | Buttons, "Docs" badge, quote borders; links in dark mode / text on buttons |
| `bg`, `bg-subtle`, `bg-muted` | Page, sidebar and panels, hover |
| `fg`, `fg-muted`, `fg-faint` | Text, secondary text, counts and paths |
| `border`, `border-strong` | Dividers, inputs |
| `accent`, `accent-soft`, `accent-fg` | Interactive colour (defaults to `primary` in light mode, `secondary` in dark) |
| `code-bg`, `mark`, `quote-border` | Code blocks, search highlights, blockquotes |
| `hero-name-bg`, `hero-glow` | Home page: gradient on the hero name, glow behind the hero image (any CSS background) |
| `font-sans`, `font-serif`, `font-mono` | Body text, headings, code |

The default palette is docfold's own indigo (`primary`) and coral (`secondary`). Headings use Lora and body text uses Hanken Grotesk.

## CLI

```
docfold dev     [dir] [--port 3000]
docfold build   [dir] [--out dist] [--base /]
docfold preview [dir] [--port 4173]
```

`dir` is the folder holding `docfold.config.ts` (default: the current folder), or the config file itself. `--src`, `--out`, `--base` and `--port` override the config. Watching is set only in the config (`watch`). When the port is taken, `dev` and `preview` try the next few ports and print the one they use.

`build` only ever empties an `outDir` it created itself (it leaves a `.docfold-build` marker), and refuses an `outDir` that contains the project, the docs or `publicDir`.

## Deploying to GitHub Pages

Page addresses have no trailing slash (`/docs/intro`, not `/docs/intro/`). The build writes each page as `docs/intro.html`; GitHub Pages, Netlify and Cloudflare Pages serve it at `/docs/intro` without any setup. On nginx, add `try_files $uri $uri.html $uri/ =404;`.

```yaml
# .github/workflows/docs.yml
name: Docs
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: github-pages
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bunx docfold build docs --base /${{ github.event.repository.name }}/
      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs/dist
      - uses: actions/deploy-pages@v4
```

## Programmatic API

```ts
import { loadConfig, loadLibrary, searchDocs, parseSearchParams, build, createDevServer } from "@moulibheemaneti/docfold";

const config = await loadConfig("./docs");
const library = await loadLibrary(config.srcDir);
const result = searchDocs(library.docs, parseSearchParams(new URLSearchParams("tag=ios&status=accepted")));
console.log(result.hits.map((hit) => hit.doc.title));
```

## Limits

- Requires Bun 1.4 or newer.
- Plain markdown (GitHub-flavoured: tables, task lists, strikethrough, autolinks). No components in markdown (MDX), no versioning or translations.
- No syntax highlighting in code blocks yet.
- Search matches exact substrings, so a typo finds nothing. The whole index loads in the browser, which suits up to a few thousand documents.
- Every page carries the whole sidebar (so it works without JavaScript), which makes the build grow with the square of the document count: about 90 MB for 500 documents and 270 MB for 1,000. Pages compress well when served gzipped.

## License

[MIT](./LICENSE)

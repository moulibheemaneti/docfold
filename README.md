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
- **Your builds, next to your docs.** Optionally, `docfold dev` can run the build commands you list in the config (Flutter, Gradle, Bun, make…), stream their output, and hand you the result. Local only; never part of the static site. See [Builds](#builds-dev-only).

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

Each page lists its `##` and `###` headings under **On this page**: a column on the right on wide screens, a collapsible box above the text on narrower ones (a plain list with JavaScript off). The section you're reading is highlighted as you scroll. Pages with fewer than two such headings don't get one.

## Page addresses

Each markdown file becomes a page at `/docs/<slug>`. The slug is the file's path inside the docs folder without `.md`, lower-cased, with spaces and underscores turned into a hyphen. Folder names follow the same rule.

| File | Page address |
|---|---|
| `intro.md` | `/docs/intro` |
| `CONTRIBUTING.md` | `/docs/contributing` |
| `Guides/My_Notes.md` | `/docs/guides/my-notes` |
| `notes/Release Notes.md` | `/docs/notes/release-notes` |

Links between files use the same rule, so `[guide](./CONTRIBUTING.md)` and `[guide](./contributing.md)` both open `/docs/contributing`. Page titles don't change: they still come from `title`, the first heading or the file name. Images and other linked files keep their exact path (`/files/Guides/Screen_Shot.png`).

Earlier versions kept the file name as it was (`/docs/CONTRIBUTING`, `/docs/Guides/My_Notes`). `dev` and `preview` redirect those addresses to the new ones; static hosts don't, so update any bookmarks or outside links that use upper case, spaces or underscores.

Two files that end up with the same address, such as `Setup.md` and `SETUP.md`, stop `docfold build` with an error that names both. `dev` prints a warning and shows the first one. Scripts can get a file's slug with `toSlug("Guides/My_Notes.md")` (→ `"guides/my-notes"`).

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
  builds: { commands: [{ id: "web", run: ["bun", "run", "build"], outputs: ["dist"] }] }, // dev only, see Builds
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

With watching on, the docs folder, `home.html`, `theme.css` and `publicDir` are all watched. `docfold.config.ts` itself isn't: restart `docfold dev` after changing it (including `builds`).

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

## Builds (dev only)

List your project's build commands in the config and `docfold dev` adds a **Builds** section next to **Docs**. Pick options, press **Run**, watch the output live, and download what the build produced: the file itself when it's one file, a `.zip` when it's several files or a folder. On macOS, **Open** shows it in Finder.

It's a local tool. It exists only under `docfold dev`, only for the computer running it, and only when the config declares at least one command. `docfold build` leaves no trace of it (no pages, links, search entries or scripts), so `docfold preview` and your hosted site don't have it either.

```ts
builds: {
  cwd: "..",                    // where commands run, relative to this file (default: this file's folder)
  commands: [
    {
      id: "apk",                // unique; a-z, 0-9, "-", "_". The page is /builds/apk
      label: "Android APK",
      group: "Android",         // optional; groups the list
      description: "Sideloadable APK",
      run: ["fvm", "flutter", "build", "apk", "--{mode}", "{split}"],
      options: [
        { id: "mode", label: "Mode", type: "select", choices: ["debug", "profile", "release"], default: "release" },
        { id: "split", label: "One APK per ABI", type: "boolean", flag: "--split-per-abi" },
      ],
      outputs: ["build/app/outputs/flutter-apk/*.apk"],
    },
    {
      id: "web",
      label: "Web bundle",
      cwd: "../web",            // per command, also relative to this file
      run: ["bun", "run", "build"],
      env: { NODE_ENV: "production" },
      outputs: ["dist"],        // a folder is one output, downloaded as a .zip
    },
  ],
},
```

**Commands**

| Field | |
|---|---|
| `id` | Required. Unique, lower-case letters, digits, `-` and `_`. Also the page address, `/builds/<id>`. |
| `run` | Required. An argument list runs as it is, **without a shell**. A string runs with `sh -c`, for pipes and `&&`. |
| `label`, `description`, `group` | Shown in the list. Commands with the same `group` are listed together. |
| `cwd` | Folder to run in, relative to the config file. Default: `builds.cwd`. |
| `env` | Extra environment variables. Commands also get the dev server's own environment (its `PATH`, so `fvm`, `flutter` or `gradle` work as in your terminal). |
| `options` | Fields on the command's page (below). |
| `outputs` | Files or folders the command produces, relative to its `cwd`. Paths or globs (`build/*.apk`, `../web/dist`). |

**Options**

| `type` | Field | `{id}` becomes |
|---|---|---|
| `select` | A list of `choices`; `default` must be one of them (default: the first). | The chosen value. |
| `boolean` | A checkbox; `default: true` ticks it. | `flag` when ticked (`"true"` if it has none), nothing when not. |
| `text` | Free text; `pattern` (a regular expression the whole value must match), `default`, `placeholder`. | The text. |

Every option takes an optional `label` and `description`.

- `{id}` can be a whole argument (`"{split}"`) or part of one (`"--{mode}"`, `"--flavor={flavor}"`). An argument that is only `{id}` and comes out empty is dropped, so an unticked checkbox leaves nothing behind.
- In a string `run`, values are never pasted into the shell command. `{id}` becomes a reference to the environment variable `DOCFOLD_OPT_<ID>` that holds the value (`{split}` → `DOCFOLD_OPT_SPLIT`), quoted, and dropped when empty. It works unquoted and inside double quotes; inside single quotes the shell can't fill it in, so that's an error. `${VAR}` is a shell variable, not a placeholder, and `\{word}` is a literal `{word}`.
- Every option's value is also in the environment as `DOCFOLD_OPT_<ID>`, for scripts.
- The page shows the exact command your choices produce before you run it.

The config is checked when `docfold dev` (or `build`) starts. It stops with a list of what's wrong: a duplicate or unsafe `id`, a `{placeholder}` that isn't one of the command's options, a `select` default that isn't one of its `choices`, a `pattern` that isn't a valid regular expression. Changes to the config need a restart of `docfold dev`, even with `watch` on.

**Running**

- One run at a time per command; different commands can run at once.
- Commands start in their own process group with their input closed. **Cancel** stops the whole group: SIGTERM, then SIGKILL a few seconds later for anything still running. Stopping `docfold dev` (Ctrl+C) cancels running builds too.
- Output streams to the page as it comes. Basic terminal colours are shown; other escape codes are removed.
- The last 10 runs of each command are kept in memory, each with up to about 2 MB of output (the start is dropped beyond that). Reloading the page, by hand or because a doc was saved during a build, picks the run back up with its output so far. Runs are forgotten when `docfold dev` stops.
- **Commands can't be interactive.** The page can't answer prompts, and a command's input is closed. If a command goes quiet after something that looks like a question (`Continue? [y/N]`, `Password:`), the page says so: cancel it and make the command non-interactive, often with a flag such as `--yes` or `--no-input`.

**Outputs**

When a run exits with code 0, docfold resolves `outputs` and keeps only the files and folders the run created or changed (by modification time, allowing two seconds for file systems that store whole seconds), so an artifact left over from an older build isn't offered. If nothing new matches, the page says so, including when only older files matched.

- One file: **Download** gives you that file, under its own name.
- Several files, or a folder (a `dist` folder, a macOS `.app` bundle): a `.zip` named `<id>-<timestamp>.zip`. Each output also has its own **Download**. Zips keep file permissions and symlinks, so apps and executables still work after unzipping.
- **Open** (macOS only) runs `open -R` on the output, which opens Finder with it selected. It isn't shown on other systems.

**Security**

The dev server can now run commands, so:

- Only commands declared in the config can run. The browser sends a command id and option values, never a command or a path, and each value is checked against its option (a `select` must be one of its `choices`, `text` must match its `pattern` and be a single line). Download and Open take a run id and an output index, and only paths recorded for that finished run are served or opened.
- The dev server listens on every network interface, so other devices on your network can read your docs. The Builds pages, their downloads and their live output answer only this computer, at `localhost` or `127.0.0.1` (requests addressed to any other name are refused too, which stops DNS-rebinding tricks). Other devices don't see the Builds link.
- Run, Cancel and Open are POST requests whose `Origin` must be the dev server's own address, and the live-output connection checks it too, so another website open in your browser can't start a build or read its output. Builds pages can't be shown inside another site's frame.
- A command runs with your user's permissions, like any script you run yourself. Only list commands you'd run in your terminal.

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

/**
 * What docfold writes and serves for a site with no `mounts`, recorded byte for byte: the build
 * output, the CLI's summaries, and the dev and preview servers' answers. Options added later to
 * the config must leave every recorded byte as it is, so a change here means a new option changed
 * the output of sites that don't use it.
 *
 * Normalised before recording, because they change from run to run: temporary folders, ports,
 * timings, the build time in .docfold-build and docfold's own version. The browser bundle
 * (assets/app.js) is listed but its bytes aren't recorded: they depend on the Bun version that
 * minifies it. The theme stylesheet is recorded as a hash, to keep this file readable.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import pkg from "../package.json" with { type: "json" };
import { build, createDevServer, createPreviewServer } from "../src/commands";
import { loadConfig } from "../src/config";
import type { UserConfig } from "../src/types";

const CLI = join(import.meta.dir, "../src/cli.ts");

/** The two sites the other tests use: one without a home page, one with. */
const SITES: Record<string, { config: UserConfig; files: Record<string, string> }> = {
  plain: {
    config: {
      title: "Test Docs",
      srcDir: "content",
      base: "sub",
      theme: { colors: { primary: "#123456" }, dark: { bg: "#000" } },
    },
    files: {
      "content/guide/intro.md":
        "---\ntitle: Intro\ntags: [setup]\nstatus: accepted\n---\nSee [next](next.md) and ![diagram](img/a.png).\n",
      "content/guide/next.md": "# Next steps\n\nBody text.\n",
      "content/guide/img/a.png": "PNG",
      "content/unlinked.txt": "not linked from any markdown",
    },
  },
  home: {
    config: {
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
    },
    files: {
      "content/a.md": "---\ntitle: Alpha\ntags: [setup]\n---\nA.\n",
      "content/b.md": "# Beta\n",
      "content/guide/c.md": "---\ntitle: Gamma\nstatus: draft\ndate: 2024-05-01\n---\n## One\n\nText with [a link](../a.md).\n\n## Two\n\nMore.\n",
      "public/logo.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
      "public/.secret": "hidden",
    },
  },
};

/** Addresses asked of the dev server, under the base "/sub/". */
const DEV_PATHS = [
  "/",
  "/sub/",
  "/sub/?tag=setup",
  "/sub/docs",
  "/sub/docs/",
  "/sub/docs/guide/intro",
  "/sub/docs/a",
  "/sub/docs/guide/c",
  "/sub/docs/Guide/Intro.md",
  "/sub/docs/missing",
  "/sub/search-index.json",
  "/sub/api/search?q=next",
  "/sub/api/search?q=a&sort=title",
  "/sub/api/search?folder=guide",
  "/sub/files/guide/img/a.png",
  "/sub/files/unlinked.txt",
  "/sub/logo.svg",
  "/sub/.secret",
  "/sub/reference",
  "/sub/reference/",
  "/sub/nope/",
];

/** Addresses asked of the preview server, for the built site. */
const PREVIEW_PATHS = [
  "/",
  "/sub/",
  "/sub/docs",
  "/sub/docs/guide/intro",
  "/sub/docs/guide/intro/",
  "/sub/docs/guide",
  "/sub/docs/guide/c",
  "/sub/docs/a",
  "/sub/search-index.json",
  "/sub/logo.svg",
  "/sub/reference",
  "/sub/nope/",
];

const roots: Record<string, string> = {};
const outDirs: Record<string, string> = {};

beforeAll(async () => {
  for (const [name, site] of Object.entries(SITES)) {
    const root = await mkdtemp(join(tmpdir(), `docfold-snapshot-${name}-`));
    roots[name] = root;
    outDirs[name] = await mkdtemp(join(tmpdir(), `docfold-snapshot-${name}-out-`));
    // A plain object: the temp folder can't resolve the package for defineConfig.
    await Bun.write(join(root, "docfold.config.ts"), `export default ${JSON.stringify(site.config)};`);
    for (const [path, text] of Object.entries(site.files)) await Bun.write(join(root, path), text);
  }
});

afterAll(async () => {
  for (const dir of [...Object.values(roots), ...Object.values(outDirs)]) await rm(dir, { recursive: true, force: true });
});

/** Replaces what changes between runs: folders, ports, timings and the version. */
const normalize = (text: string, name: string): string => {
  const root = roots[name]!;
  const out = outDirs[name]!;
  // Relative forms first: they contain the absolute ones ("../../tmp/x" holds "/tmp/x").
  return text
    .replaceAll(relative(process.cwd(), out), "<out>")
    .replaceAll(out, "<out>")
    .replaceAll(relative(process.cwd(), root), "<root>")
    .replaceAll(root, "<root>")
    .replace(/(localhost|127\.0\.0\.1|\[::1?\]):\d+/g, "$1:<port>")
    .replace(/\b\d+ ms\b/g, "<n> ms")
    .replace(/"builtAt": "[^"]+"/, '"builtAt": "<time>"')
    .replaceAll(`docfold ${pkg.version}`, "docfold <version>");
};

/** Every file in the build, by path, with its contents (see the note at the top). */
const readBuild = async (name: string): Promise<Record<string, string>> => {
  const out = outDirs[name]!;
  const files = (await readdir(out, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(out, join(entry.parentPath, entry.name)).split("\\").join("/"))
    .sort();
  const contents: Record<string, string> = {};
  for (const file of files) {
    const data = Bun.file(join(out, file));
    if (file === "assets/app.js") contents[file] = "(browser bundle: listed, not recorded)";
    else if (file === "assets/styles.css") {
      contents[file] = `sha256:${new Bun.CryptoHasher("sha256").update(await data.arrayBuffer()).digest("hex")}`;
    } else contents[file] = normalize(await data.text(), name);
  }
  return contents;
};

const record = async (response: Response, name: string) => ({
  status: response.status,
  location: response.headers.get("location"),
  type: response.headers.get("content-type"),
  body: normalize(await response.text(), name),
});

/** Runs the CLI and returns what it printed once `done` appears (or it exits). */
const runCli = async (args: string[], done?: string): Promise<string> => {
  const child = Bun.spawn(["bun", CLI, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
  if (!done) {
    const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    await child.exited;
    return stdout + stderr;
  }
  let text = "";
  const decoder = new TextDecoder();
  const timer = setTimeout(() => child.kill(), 10_000);
  for await (const chunk of child.stdout) {
    text += decoder.decode(chunk);
    if (text.includes(done)) break;
  }
  clearTimeout(timer);
  child.kill();
  await child.exited;
  return text;
};

describe.each(Object.keys(SITES))("site without mounts: %s", (name) => {
  test("build output", async () => {
    const result = await build(await loadConfig(roots[name]!, { outDir: outDirs[name] }));
    expect({ ...result, outDir: "<out>", ms: 0 }).toMatchSnapshot("result");
    expect(await readBuild(name)).toMatchSnapshot("files");
  });

  test("docfold build prints", async () => {
    const printed = await runCli(["build", roots[name]!, "--out", outDirs[name]!]);
    expect(normalize(printed, name)).toMatchSnapshot();
  });

  test("dev server answers", async () => {
    const dev = await createDevServer(await loadConfig(roots[name]!, { outDir: outDirs[name] }), { port: 0 });
    try {
      const answers: Record<string, unknown> = {};
      for (const path of DEV_PATHS) {
        answers[path] = await record(await fetch(new URL(path, dev.server.url), { redirect: "manual" }), name);
      }
      expect(answers).toMatchSnapshot();
    } finally {
      await dev.stop();
    }
  });

  test("docfold dev prints", async () => {
    const printed = await runCli(["dev", roots[name]!, "--port", "0"], "Press Ctrl+C to stop.");
    expect(normalize(printed, name)).toMatchSnapshot();
  });

  test("preview server answers", async () => {
    const config = await loadConfig(roots[name]!, { outDir: outDirs[name] });
    await build(config);
    const built = Object.entries(await readBuild(name));
    const preview = await createPreviewServer(config, { port: 0 });
    try {
      const answers: Record<string, unknown> = {};
      for (const path of PREVIEW_PATHS) {
        const answer = await record(await fetch(new URL(path, preview.server.url), { redirect: "manual" }), name);
        // Preview serves the built files: name the file instead of repeating it.
        const file = answer.body && built.find(([, contents]) => contents === answer.body)?.[0];
        answers[path] = file ? { ...answer, body: `(the built file ${file})` } : answer;
      }
      expect(answers).toMatchSnapshot();
    } finally {
      await preview.stop();
    }
  });
});

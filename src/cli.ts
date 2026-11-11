#!/usr/bin/env bun
/**
 * docfold dev     [dir] [--port 3000]   dev server (watching is set in the config: `watch: true`)
 * docfold build   [dir] [--out dist] [--base /]
 * docfold preview [dir] [--port 4173]   serve the build
 *
 * `dir` is the folder holding docfold.config.ts (default: current folder), or the config file itself.
 */

import { parseArgs } from "node:util";
import pkg from "../package.json" with { type: "json" };
import { build, createDevServer, createPreviewServer, describeOutDir } from "./commands";
import { loadConfig, parsePort } from "./config";
import { DEFAULTS } from "./shared/constants";
import { errorMessage } from "./shared/log";
import type { UserConfig } from "./types";

const HELP = `docfold ${pkg.version} — a searchable docs site from a folder of markdown

Usage
  docfold dev     [dir]   Start the dev server (set watch: true in the config to reload on save)
  docfold build   [dir]   Write a static site to outDir (default: ${DEFAULTS.outDir})
  docfold preview [dir]   Serve the built site locally

  [dir] is the folder with docfold.config.ts, or the config file itself. Default: current folder.

Options
  -p, --port <n>     Port for dev (default ${DEFAULTS.port}) or preview (default ${DEFAULTS.previewPort})
      --base <path>  URL path the site is served from, e.g. /my-repo/
      --out <dir>    Build output folder
      --src <dir>    Folder with the markdown files
  -h, --help         Show this help
  -v, --version      Show the version
`;

const dim = (text: string) => (process.stdout.isTTY ? `\x1b[2m${text}\x1b[22m` : text);
const bold = (text: string) => (process.stdout.isTTY ? `\x1b[1m${text}\x1b[22m` : text);

const main = async (argv: string[]): Promise<void> => {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: "string", short: "p" },
      base: { type: "string" },
      out: { type: "string" },
      src: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (values.version) return console.log(pkg.version);
  const [command = "dev", dir = "."] = positionals;
  if (values.help || command === "help") return console.log(HELP);

  const overrides: UserConfig = { base: values.base, outDir: values.out, srcDir: values.src };
  const config = await loadConfig(dir, overrides);
  const port = values.port === undefined ? undefined : parsePort(values.port, "--port");

  console.log(`${bold("docfold")} ${dim(pkg.version)}  ${dim(config.configFile ?? "(no config file, using defaults)")}`);

  switch (command) {
    case "dev": {
      const dev = await createDevServer(config, { port });
      const { docs } = await dev.store.library();
      console.log(`\n  ${bold("Local:")}  ${dev.url}`);
      console.log(dim(`  ${docs.length} markdown files from ${config.srcDir}`));
      console.log(
        dim(
          !config.watch
            ? "  Not watching for changes (set watch: true in docfold.config.ts to reload on save)."
            : config.watch.liveReload
              ? "  Watching for changes; open pages reload on save."
              : "  Watching for changes; refresh to see them.",
        ),
      );
      console.log(dim("  Press Ctrl+C to stop.\n"));
      break;
    }

    case "build": {
      const result = await build(config);
      const copied = [
        `${result.files} linked file${result.files === 1 ? "" : "s"}`,
        result.publicFiles ? `${result.publicFiles} from publicDir` : "",
      ].filter(Boolean);
      console.log(`\n  Built ${result.pages} pages and copied ${copied.join(" + ")} in ${result.ms} ms`);
      console.log(`  → ${bold(describeOutDir(config))}${config.base !== "/" ? dim(`  (base ${config.base})`) : ""}`);
      if (result.missingFiles.length) {
        const list = result.missingFiles.map((file) => `    - ${file}`).join("\n");
        console.warn(`\n  Linked from markdown but not copied (missing, a folder, or a hidden path):\n${list}`);
      }
      console.log(dim(`\n  Check it with: docfold preview${dir === "." ? "" : ` ${dir}`}\n`));
      break;
    }

    case "preview": {
      const preview = await createPreviewServer(config, { port });
      console.log(`\n  ${bold("Preview:")}  ${preview.url}  ${dim(`(serving ${describeOutDir(config)})`)}\n`);
      break;
    }

    default:
      console.error(`Unknown command "${command}".\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
};

main(Bun.argv.slice(2)).catch((err: unknown) => {
  console.error(`\n  docfold: ${errorMessage(err)}\n`);
  process.exit(1);
});

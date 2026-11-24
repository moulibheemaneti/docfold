/**
 * The site's own CSS (theme + the user's theme.css) and browser scripts, for dev and build.
 */

import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { warn } from "../shared/log";
import type { ResolvedConfig } from "../types";

const themeFile = (name: string): Promise<string> => Bun.file(fileURLToPath(new URL(`../theme/${name}`, import.meta.url))).text();

/**
 * The built-in theme plus the user's extra stylesheet, if any. With mounts, the header's section
 * links (sections.css) come between the two.
 */
export const loadStyles = async (config: ResolvedConfig): Promise<string> => {
  const builtIn = await themeFile("styles.css");
  const theme = config.mounts.length ? `${builtIn}\n${await themeFile("sections.css")}` : builtIn;
  if (!config.theme.css) return theme;
  const file = Bun.file(config.theme.css);
  if (!(await file.exists())) {
    warn(`theme.css not found: ${config.theme.css}`);
    return theme;
  }
  return `${theme}\n\n/* ${relative(config.root, config.theme.css)} */\n${await file.text()}`;
};

/** The Builds section's stylesheet (dev only, never written by the build). */
export const loadBuildStyles = (): Promise<string> => themeFile("builds.css");

/**
 * Bundles a browser script with Bun's bundler: "app" (sidebar, live search, live reload; every
 * page, dev and build) or "builds" (the Builds page; dev only).
 */
export const bundleClient = async (name: "app" | "builds" = "app"): Promise<string> => {
  const result = await Bun.build({
    entrypoints: [fileURLToPath(new URL(`../client/${name}.ts`, import.meta.url))],
    target: "browser",
    format: "esm",
    minify: true,
  });
  const output = result.outputs[0];
  if (!result.success || !output) {
    throw new AggregateError(result.logs, `docfold: failed to bundle the ${name} script`);
  }
  return output.text();
};

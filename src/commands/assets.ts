/**
 * The site's own CSS (theme + the user's theme.css) and browser script, for dev and build.
 */

import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { warn } from "../shared/log";
import type { ResolvedConfig } from "../types";

/** The built-in theme plus the user's extra stylesheet, if any. */
export const loadStyles = async (config: ResolvedConfig): Promise<string> => {
  const theme = await Bun.file(fileURLToPath(new URL("../theme/styles.css", import.meta.url))).text();
  if (!config.theme.css) return theme;
  const file = Bun.file(config.theme.css);
  if (!(await file.exists())) {
    warn(`theme.css not found: ${config.theme.css}`);
    return theme;
  }
  return `${theme}\n\n/* ${relative(config.root, config.theme.css)} */\n${await file.text()}`;
};

/** Bundles the browser script (sidebar, live search, live reload) with Bun's bundler. */
export const bundleClient = async (): Promise<string> => {
  const result = await Bun.build({
    entrypoints: [fileURLToPath(new URL("../client/app.ts", import.meta.url))],
    target: "browser",
    format: "esm",
    minify: true,
  });
  const output = result.outputs[0];
  if (!result.success || !output) {
    throw new AggregateError(result.logs, "docfold: failed to bundle the client script");
  }
  return output.text();
};

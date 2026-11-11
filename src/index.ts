/**
 * docfold — public API.
 *
 * Most people only need `defineConfig` (for docfold.config.ts) and the CLI.
 * The rest is exported for scripts and tests: load a folder, search it, or run
 * the dev server / build programmatically. Every type lives in ./types.
 */

export { build, createDevServer, createPreviewServer } from "./commands";
export { defineConfig, loadConfig } from "./config";
export { ContentStore, loadLibrary, parseDoc, splitFrontMatter, toIndexedDoc } from "./content";
export { countFacets, DEFAULT_PARAMS, parseSearchParams, searchDocs, toQueryString } from "./search";
export { createUrls } from "./shared/urls";
export { buildTree } from "./sidebar";
export type * from "./types";

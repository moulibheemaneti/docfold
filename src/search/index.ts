/**
 * Search and filtering over the loaded documents.
 *
 * Everything here is a pure function of (docs, params) with no Bun or DOM APIs,
 * so the same code runs on the server (pages, JSON API) and in the browser
 * (live search, static builds).
 */

export * from "./facets";
export * from "./match";
export * from "./query";

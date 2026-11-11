/**
 * Default values, in one place so the config loader, the CLI help, the servers
 * and the content store can't drift apart.
 */

export const DEFAULTS = {
  title: "Docs",
  srcDir: ".",
  outDir: "dist",
  publicDir: "public",
  base: "/",
  /** `docfold dev`. */
  port: 3000,
  /** `docfold preview`. */
  previewPort: 4173,
  /** Milliseconds to wait for more file events before reloading. */
  debounce: 80,
  homeFile: "home.html",
  headerTag: "Docs",
  headerActionText: "Get Started",
} as const;

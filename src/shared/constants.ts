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
  /** Builds: runs kept in memory per command. */
  buildHistory: 10,
  /** Builds: characters of output kept per run; the start is dropped beyond this. */
  buildLogChars: 2_000_000,
  /** Builds: milliseconds between SIGTERM and SIGKILL when a run is cancelled. */
  buildKillDelay: 5000,
} as const;

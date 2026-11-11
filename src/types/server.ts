/** The dev server, preview server and build results. */

import type { ContentStore } from "../content";

export interface BuildResult {
  outDir: string;
  pages: number;
  /** Files linked from the markdown, copied to files/. */
  files: number;
  /** Files copied from publicDir. */
  publicFiles: number;
  /** Linked from the markdown but not copied: missing, a folder, or a hidden / node_modules path. */
  missingFiles: string[];
  ms: number;
}

export interface ServerOptions {
  /** Default: `port` from the config for dev, 4173 for preview. */
  port?: number;
  /** Try the next ports when the requested one is busy. Default: true. */
  findFreePort?: boolean;
}

export type DevServerOptions = ServerOptions;
export type PreviewServerOptions = ServerOptions;

export interface DevServer {
  server: Bun.Server<undefined>;
  store: ContentStore;
  url: URL;
  stop: () => Promise<void>;
}

export interface PreviewServer {
  server: Bun.Server<undefined>;
  url: URL;
  stop: () => Promise<void>;
}

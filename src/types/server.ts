/** The dev server, preview server and build results. */

import type { BuildRunner } from "../builds";
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

export interface DevServerOptions extends ServerOptions {
  /** For tests and tools: the platform the Builds section assumes ("Open" is macOS only) and how it shows a file in Finder. */
  builds?: { platform?: NodeJS.Platform; reveal?: (path: string) => Promise<void> };
}
export type PreviewServerOptions = ServerOptions;

/** What the dev server keeps per WebSocket connection. */
export interface SocketData {
  /** Subscribed to live reload. */
  reload: boolean;
  /** May follow build logs: a page on this computer, from the dev server's own origin. */
  builds: boolean;
  /** The run whose log it follows. */
  run?: string;
}

export interface DevServer {
  server: Bun.Server<SocketData>;
  store: ContentStore;
  /** Runs the config's build commands; undefined when it declares none. */
  builds?: BuildRunner;
  url: URL;
  stop: () => Promise<void>;
}

export interface PreviewServer {
  server: Bun.Server<undefined>;
  url: URL;
  stop: () => Promise<void>;
}

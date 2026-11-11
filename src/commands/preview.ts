/**
 * `docfold preview`: serves the output of `docfold build` the way static hosts
 * like GitHub Pages do ("/docs/intro" → docs/intro.html, index.html, 404.html,
 * base path), to check a build locally.
 */

import { resolve } from "node:path";
import { DEFAULTS } from "../shared/constants";
import { decodePathAfter, isFile, isInside } from "../shared/paths";
import { normalizeBase } from "../shared/urls";
import { BUILD_MARKER } from "./build";
import { listen } from "./serve";
import type { PreviewServer, PreviewServerOptions, ResolvedConfig } from "../types";

/** The base the site was built with (pages only work under it), falling back to the config's. */
const builtBase = async (outDir: string, fallback: string): Promise<string> => {
  try {
    const marker = (await Bun.file(resolve(outDir, BUILD_MARKER)).json()) as { base?: unknown };
    return typeof marker.base === "string" ? normalizeBase(marker.base) : fallback;
  } catch {
    return fallback;
  }
};

export const createPreviewServer = async (config: ResolvedConfig, options: PreviewServerOptions = {}): Promise<PreviewServer> => {
  const { outDir } = config;
  if (!(await isFile(resolve(outDir, "index.html")))) {
    throw new Error(`No build found in ${outDir}. Run "docfold build" first.`);
  }
  const base = await builtBase(outDir, config.base);

  /** The file at `relPath` inside outDir, or null (also for folders and paths escaping outDir). */
  const fileAt = async (relPath: string): Promise<Bun.BunFile | null> => {
    const path = resolve(outDir, relPath);
    return isInside(path, outDir) && (await isFile(path)) ? Bun.file(path) : null;
  };

  const notFound = async (): Promise<Response> => {
    const page = await fileAt("404.html");
    return page ? new Response(page, { status: 404 }) : new Response("Not found", { status: 404 });
  };

  const fetch = async (req: Request): Promise<Response> => {
    const { pathname, search } = new URL(req.url);
    if (pathname === "/" && base !== "/") return Response.redirect(base, 302);
    if (!pathname.startsWith(base)) return notFound();

    const relPath = decodePathAfter(pathname, base);
    if (relPath === null) return notFound();

    // Pages have no trailing slash: "/docs/intro/" → "/docs/intro" when docs/intro.html exists.
    if (relPath.endsWith("/") && (await fileAt(`${relPath.replace(/\/+$/, "")}.html`))) {
      return Response.redirect(pathname.replace(/\/+$/, "") + search, 301);
    }

    const candidates =
      relPath === "" || relPath.endsWith("/") ? [`${relPath}index.html`] : [relPath, `${relPath}.html`, `${relPath}/index.html`];
    for (const candidate of candidates) {
      const file = await fileAt(candidate);
      if (file) return new Response(file);
    }
    return notFound();
  };

  const server = listen((port) => Bun.serve({ port, fetch }), options.port ?? DEFAULTS.previewPort, options.findFreePort ?? true);

  return {
    server,
    url: new URL(base, server.url),
    stop: async () => {
      await server.stop(true);
    },
  };
};

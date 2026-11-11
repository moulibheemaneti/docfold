/**
 * `docfold dev`: renders pages on request from the markdown on disk. With
 * `watch` on in the config, it re-reads the folder when anything changes and
 * reloads open browser tabs; with it off (the default) files are read once.
 */

import { type FSWatcher, watch } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { ContentStore } from "../content";
import { docPage, notFoundPage } from "../pages";
import { parseSearchParams, SEARCH_KEYS, searchDocs } from "../search";
import { decodePathAfter, isFile, isInside } from "../shared/paths";
import { createSite, ignoredFolders, renderHome, renderList, searchIndex } from "../site";
import { bundleClient, loadStyles } from "./assets";
import { htmlResponse, listen } from "./serve";
import type { DevServer, DevServerOptions, ResolvedConfig } from "../types";

/** Watches single files (by their folder, so files created later count too) and whole folders. */
const watchPaths = (files: string[], folders: string[], onChange: () => void): FSWatcher[] => {
  const watchers: FSWatcher[] = [];
  const namesByDir = new Map<string, Set<string>>();
  for (const file of files) {
    const names = namesByDir.get(dirname(file)) ?? new Set<string>();
    namesByDir.set(dirname(file), names.add(basename(file)));
  }
  for (const [dir, names] of namesByDir) {
    try {
      watchers.push(watch(dir, (_event, filename) => (!filename || names.has(basename(String(filename)))) && onChange()));
    } catch {
      // folder doesn't exist: nothing to watch
    }
  }
  for (const folder of folders) {
    try {
      watchers.push(watch(folder, { recursive: true }, () => onChange()));
    } catch {
      // folder doesn't exist: nothing to watch
    }
  }
  return watchers;
};

/**
 * Live reload runs over a WebSocket, not server-sent events: browsers allow only 6 HTTP/1.1
 * connections per host, and an event stream holds one open for as long as the page is open,
 * so a few open tabs left every new page loading forever. WebSockets don't count toward that limit.
 */
const RELOAD_TOPIC = "reload";

export const createDevServer = async (config: ResolvedConfig, options: DevServerOptions = {}): Promise<DevServer> => {
  const site = createSite(config, "dev");
  const { urls } = site;
  const base = urls.base;
  // Bundle first: if it fails, nothing has been started yet.
  const clientScript = await bundleClient();

  const store = new ContentStore(config.srcDir, {
    urls,
    ignore: ignoredFolders(config),
    debounce: config.watch ? config.watch.debounce : undefined,
  });

  // Off by default: files are read once. `watch` in the config turns on re-reading (and live reload).
  const watchers: FSWatcher[] = [];
  if (config.watch) {
    store.watch();
    const files = [config.home ? config.home.file : "", config.theme.css ?? ""].filter(Boolean);
    watchers.push(...watchPaths(files, [config.publicDir], () => store.notify()));
  }

  const notFound = async (pathname: string): Promise<Response> =>
    htmlResponse(notFoundPage(site, await store.library(), pathname), 404);

  const listPage = async (url: URL): Promise<Response> =>
    htmlResponse(renderList(site, await store.library(), parseSearchParams(url.searchParams)));

  /** A file from publicDir (logo, favicon, images) served at the same path under the base. */
  const publicFile = async (pathname: string): Promise<Response | null> => {
    if (!pathname.startsWith(base)) return null;
    const relPath = decodePathAfter(pathname, base);
    if (!relPath || relPath.split("/").some((part) => part.startsWith("."))) return null;
    const path = resolve(config.publicDir, relPath);
    return isInside(path, config.publicDir) && (await isFile(path))
      ? new Response(Bun.file(path))
      : null;
  };

  const routes: Bun.Serve.RoutesWithUpgrade<undefined, string> = {
    [base]: async (req) => {
      const url = new URL(req.url);
      if (!urls.hasHome) return listPage(url);
      // Old links like "/?tag=ios" now belong to the documents list.
      if (SEARCH_KEYS.some((key) => url.searchParams.has(key))) return Response.redirect(urls.search(url.search.slice(1)), 302);
      return htmlResponse(await renderHome(config, site, await store.library()));
    },

    [`${base}docs`]: (req) => {
      const url = new URL(req.url);
      // The documents list lives here only when there's a home page.
      return urls.hasHome ? listPage(url) : Response.redirect(urls.search(url.search.slice(1)), 302);
    },

    [`${base}docs/*`]: async (req) => {
      const { pathname, search } = new URL(req.url);
      // Page URLs have no trailing slash: ".../docs/" → ".../docs", ".../docs/foo/" → ".../docs/foo".
      if (pathname.endsWith("/")) return Response.redirect(pathname.replace(/\/+$/, "") + search, 301);

      const slug = decodePathAfter(pathname, `${base}docs/`);
      if (slug === null) return notFound(pathname);
      const library = await store.library();

      const doc = library.bySlug.get(slug);
      if (doc) return htmlResponse(docPage(site, library, doc));

      // ".../foo.md" or ".../foo.html" → ".../foo"
      const withoutExtension = library.bySlug.get(slug.replace(/\.(?:md|html)$/i, ""));
      if (withoutExtension) return Response.redirect(withoutExtension.url + search, 301);

      return notFound(pathname);
    },

    [urls.searchIndex]: async () => Response.json(searchIndex(await store.library())),

    [`${base}api/search`]: async (req) => {
      const library = await store.library();
      const result = searchDocs(library.docs, parseSearchParams(new URL(req.url).searchParams));
      return Response.json({
        params: result.params,
        total: result.total,
        count: result.hits.length,
        results: result.hits.map(({ doc, score, snippet }) => ({
          title: doc.title,
          path: doc.relPath,
          url: doc.url,
          folder: doc.folder,
          status: doc.status ?? null,
          date: doc.date ?? null,
          tags: doc.tags,
          description: doc.description ?? null,
          score,
          snippet,
        })),
        facets: { tags: library.tags, statuses: library.statuses },
      });
    },

    // Images and attachments linked from the markdown: the same files the build copies, nothing else.
    [`${base}files/*`]: async (req) => {
      const { pathname } = new URL(req.url);
      const relPath = decodePathAfter(pathname, `${base}files/`);
      const library = await store.library();
      const filePath = relPath && library.assets.has(relPath) ? resolve(config.srcDir, relPath) : "";
      return filePath && isInside(filePath, config.srcDir) && (await isFile(filePath))
        ? new Response(Bun.file(filePath))
        : notFound(pathname);
    },

    [urls.asset("styles.css")]: async () =>
      new Response(await loadStyles(config), {
        headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-cache" },
      }),

    [urls.asset("app.js")]: () =>
      new Response(clientScript, {
        headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" },
      }),
  };

  // Open pages connect here and reload when told to (see RELOAD_TOPIC).
  if (site.liveReload) {
    routes[`${base}__docfold/events`] = (req, server) =>
      server.upgrade(req) ? undefined : new Response("Live reload needs a WebSocket connection.", { status: 426 });
  }

  if (base !== "/") routes["/"] = Response.redirect(base, 302);

  let server: Bun.Server<undefined> | undefined;
  const stop = async (): Promise<void> => {
    store.close();
    for (const watcher of watchers) watcher.close();
    await server?.stop(true);
  };

  try {
    server = listen(
      (port) =>
        Bun.serve({
          port,
          routes,
          fetch: async (req) => {
            const { pathname } = new URL(req.url);
            return (await publicFile(pathname)) ?? notFound(pathname);
          },
          websocket: {
            open: (ws) => {
              ws.subscribe(RELOAD_TOPIC);
            },
            message: () => {}, // pages only listen
          },
          error: (err) => {
            console.error(err);
            return new Response(`docfold: ${err.message}`, { status: 500 });
          },
        }),
      options.port ?? config.port,
      options.findFreePort ?? true,
    );
    const started = server;
    if (site.liveReload) store.onChange(() => started.publish(RELOAD_TOPIC, "reload"));
    await store.library(); // parse once up front so the first request is fast and errors show early
  } catch (err) {
    await stop();
    throw err;
  }

  return { server, store, url: new URL(base, server.url), stop };
};

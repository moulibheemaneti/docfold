/**
 * `docfold dev`: renders pages on request from the markdown on disk. With
 * `watch` on in the config, it re-reads the folder when anything changes and
 * reloads open browser tabs; with it off (the default) files are read once.
 * When the config declares `builds`, it also serves the Builds section (see ../builds).
 */

import { type FSWatcher, watch } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { BuildRunner, createBuildRoutes, handleBuildSocketMessage, isLocalRequest, isSameOrigin } from "../builds";
import { ContentStore } from "../content";
import { docPage, notFoundPage } from "../pages";
import { parseSearchParams, SEARCH_KEYS, searchDocs } from "../search";
import { decodePathAfter, isFile, isInside } from "../shared/paths";
import { toSlug } from "../shared/slug";
import { createSite, ignoredFolders, renderHome, renderList, searchIndex } from "../site";
import { bundleClient, loadBuildStyles, loadStyles } from "./assets";
import { htmlResponse, listen } from "./serve";
import type { DevServer, DevServerOptions, ResolvedConfig, Site, SocketData } from "../types";

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

type Server = Bun.Server<SocketData>;

export const createDevServer = async (config: ResolvedConfig, options: DevServerOptions = {}): Promise<DevServer> => {
  const site = createSite(config, "dev");
  const { urls } = site;
  const base = urls.base;
  // Bundle first: if it fails, nothing has been started yet.
  const [clientScript, buildsScript, buildsStyles] = await Promise.all([
    bundleClient("app"),
    config.builds ? bundleClient("builds") : "",
    config.builds ? loadBuildStyles() : "",
  ]);

  // Builds run commands, so pages sent to other devices (a phone on the same network) don't offer them.
  const runner = config.builds ? new BuildRunner(config.builds) : undefined;
  const docsOnly: Site = { ...site, builds: false };
  const siteFor = (req: Request, server: Server): Site => (runner && isLocalRequest(req, server) ? site : docsOnly);

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

  const notFound = async (req: Request, server: Server): Promise<Response> =>
    htmlResponse(notFoundPage(siteFor(req, server), await store.library(), new URL(req.url).pathname), 404);

  const listPage = async (req: Request, server: Server): Promise<Response> =>
    htmlResponse(renderList(siteFor(req, server), await store.library(), parseSearchParams(new URL(req.url).searchParams)));

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

  const routes: Bun.Serve.RoutesWithUpgrade<SocketData, string> = {
    [base]: async (req, server) => {
      const url = new URL(req.url);
      if (!urls.hasHome) return listPage(req, server);
      // Old links like "/?tag=ios" now belong to the documents list.
      if (SEARCH_KEYS.some((key) => url.searchParams.has(key))) return Response.redirect(urls.search(url.search.slice(1)), 302);
      return htmlResponse(await renderHome(config, siteFor(req, server), await store.library()));
    },

    [`${base}docs`]: (req, server) => {
      const url = new URL(req.url);
      // The documents list lives here only when there's a home page.
      return urls.hasHome ? listPage(req, server) : Response.redirect(urls.search(url.search.slice(1)), 302);
    },

    [`${base}docs/*`]: async (req, server) => {
      const { pathname, search } = new URL(req.url);
      // Page URLs have no trailing slash: ".../docs/" → ".../docs", ".../docs/foo/" → ".../docs/foo".
      if (pathname.endsWith("/")) return Response.redirect(pathname.replace(/\/+$/, "") + search, 301);

      const slug = decodePathAfter(pathname, `${base}docs/`);
      if (slug === null) return notFound(req, server);
      const library = await store.library();

      const doc = library.bySlug.get(slug);
      if (doc) return htmlResponse(docPage(siteFor(req, server), library, doc));

      // Old or hand-typed addresses go to the page's own one: ".../CONTRIBUTING" → ".../contributing",
      // ".../Guides/My_Notes" → ".../guides/my-notes", ".../foo.md" or ".../foo.html" → ".../foo".
      const moved = library.bySlug.get(toSlug(slug.replace(/\.html$/i, "")));
      if (moved) return Response.redirect(moved.url + search, 301);

      return notFound(req, server);
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
    [`${base}files/*`]: async (req, server) => {
      const { pathname } = new URL(req.url);
      const relPath = decodePathAfter(pathname, `${base}files/`);
      const library = await store.library();
      const filePath = relPath && library.assets.has(relPath) ? resolve(config.srcDir, relPath) : "";
      return filePath && isInside(filePath, config.srcDir) && (await isFile(filePath))
        ? new Response(Bun.file(filePath))
        : notFound(req, server);
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

  if (runner) {
    Object.assign(
      routes,
      createBuildRoutes({
        config,
        site,
        runner,
        library: () => store.library(),
        styles: buildsStyles,
        script: buildsScript,
        platform: options.builds?.platform,
        reveal: options.builds?.reveal,
      }),
    );
  }

  // Open pages connect here to reload when told to (see RELOAD_TOPIC); the Builds page follows a run's log.
  if (site.liveReload || runner) {
    routes[urls.events] = (req, server) => {
      const data: SocketData = {
        reload: site.liveReload,
        // A socket may follow build logs only from this computer and the dev server's own pages.
        builds: !!runner && isLocalRequest(req, server) && isSameOrigin(req),
      };
      return server.upgrade(req, { data }) ? undefined : new Response("This address needs a WebSocket connection.", { status: 426 });
    };
  }

  if (base !== "/") routes["/"] = Response.redirect(base, 302);

  let server: Server | undefined;
  const stop = async (): Promise<void> => {
    store.close();
    for (const watcher of watchers) watcher.close();
    await runner?.stop();
    await server?.stop(true);
  };

  try {
    server = listen(
      (port) =>
        Bun.serve<SocketData, string>({
          port,
          routes,
          fetch: async (req, server) => {
            const { pathname } = new URL(req.url);
            return (await publicFile(pathname)) ?? notFound(req, server);
          },
          websocket: {
            open: (ws) => {
              if (ws.data.reload) ws.subscribe(RELOAD_TOPIC);
            },
            // Pages only listen, except the Builds page, which says which run it follows.
            message: (ws, message) => {
              if (runner) handleBuildSocketMessage(runner, ws, message);
            },
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
    if (runner) runner.publish = (topic, message) => started.publish(topic, message);
    await store.library(); // parse once up front so the first request is fast and errors show early
  } catch (err) {
    await stop();
    throw err;
  }

  return { server, store, builds: runner, url: new URL(base, server.url), stop };
};

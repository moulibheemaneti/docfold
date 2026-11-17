/**
 * The dev server's /builds routes and the build part of its WebSocket.
 *
 *   GET  builds                                         the commands
 *   GET  builds/<id>[?run=<run>]                        a command: form, log, outputs, recent runs
 *   POST builds/<id>/runs                               start (form or JSON option values)
 *   GET  builds/<id>/runs/<run>                         a run as JSON, with its log
 *   POST builds/<id>/runs/<run>/cancel                  stop it and everything it started
 *   GET  builds/<id>/runs/<run>/download                the result: the one file, or a .zip of everything
 *   GET  builds/<id>/runs/<run>/outputs/<n>             one output: the file, or a folder as .zip
 *   POST builds/<id>/runs/<run>/outputs/<n>/open        show it in Finder (macOS)
 *
 * Every route answers only requests from this computer (see ./security.ts); POSTs and the
 * WebSocket must also come from the dev server's own pages. The browser never sends a command or
 * a path: only a command id, option values, a run id and an output index.
 */

import { relative, sep } from "node:path";
import { stat } from "node:fs/promises";
import { buildPage, buildsListPage, type BuildListItem } from "../pages";
import { errorMessage } from "../shared/log";
import { fileStamp } from "./format";
import { BuildError, runTopic, type BuildRun, type BuildRunner } from "./runner";
import { isLocalRequest, isSameOrigin } from "./security";
import { zipStream } from "./zip";
import type { ResolvedOutput } from "./outputs";
import type { BuildSocketMessage, Library, ResolvedConfig, Site, SocketData } from "../types";

type Server = Bun.Server<SocketData>;
type Handler = (req: Bun.BunRequest, server: Server) => Response | Promise<Response>;

export interface BuildRoutesOptions {
  config: ResolvedConfig;
  /** The site as pages for this computer see it (with the Builds nav). */
  site: Site;
  runner: BuildRunner;
  library: () => Promise<Library>;
  styles: string;
  script: string;
  /** Default: `process.platform`. "Open" exists only on "darwin". */
  platform?: NodeJS.Platform;
  /** Shows a path in Finder. Default: `open -R <path>`. */
  reveal?: (path: string) => Promise<void>;
}

/** `open -R` opens a Finder window with the file or folder selected. */
export const revealInFinder = async (path: string): Promise<void> => {
  const proc = Bun.spawn(["open", "-R", path], { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) throw new Error((await new Response(proc.stderr).text()).trim() || `open exited with code ${code}`);
};

/** Builds pages must not be framed by another site (a click on "Run" there would be a real click here). */
const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
};

const text = (message: string, status: number): Response =>
  new Response(`${message}\n`, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

const wantsJson = (req: Request): boolean => (req.headers.get("accept") ?? "").includes("application/json");

/** `attachment` with an ASCII fallback name and the real one (RFC 6266). */
export const attachment = (name: string): string =>
  `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/** Builds run commands: only this computer, and for POSTs only the dev server's own pages. */
const guard =
  (handler: Handler, { post = false } = {}): Handler =>
  (req, server) => {
    if (!isLocalRequest(req, server)) {
      return text("Builds can only be used on the computer running docfold dev, at http://localhost.", 403);
    }
    if (post && !isSameOrigin(req)) return text("Refused: this request didn't come from the docfold dev server's own page.", 403);
    return handler(req, server);
  };

/** Option values from a form post or a JSON body, looked up by option id. */
const readValues = async (req: Request): Promise<(id: string) => unknown> => {
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const body: unknown = await req.json().catch(() => {
      throw new BuildError(400, "The request body isn't valid JSON.");
    });
    const values = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    return (id) => (Object.hasOwn(values, id) ? values[id] : undefined);
  }
  const form = await req.formData().catch(() => new FormData());
  return (id) => form.get(id) ?? undefined;
};

export const createBuildRoutes = (options: BuildRoutesOptions): Record<string, Handler | Partial<Record<"GET" | "POST", Handler>>> => {
  const { config, site, runner } = options;
  const { urls } = site;
  const base = urls.base;
  const platform = options.platform ?? process.platform;
  const canReveal = platform === "darwin";
  const reveal = options.reveal ?? revealInFinder;
  const configName = config.configFile ? relative(config.root, config.configFile) : "docfold.config.ts";

  const items = (): BuildListItem[] =>
    [...runner.commands.values()].map((command) => ({ command: info(command), last: runner.runs(command.id)[0]?.view() }));

  /** A command without its folder or environment: what pages may show. */
  const info = ({ id, label, group, description, run, options: opts }: BuildListItem["command"]) => ({ id, label, group, description, run, options: opts });

  const cwdLabel = (cwd: string): string => relative(config.root, cwd).split(sep).join("/") || ".";

  /** The run in the URL, if it belongs to the command in the URL. */
  const findRun = (req: Bun.BunRequest): BuildRun | undefined => {
    const run = runner.run(req.params.run ?? "");
    return run && run.command.id === req.params.command ? run : undefined;
  };

  /** A finished, successful run's output by index, if it is still on disk. */
  const findOutput = async (run: BuildRun, index: string | undefined): Promise<ResolvedOutput | Response> => {
    const output = run.status === "succeeded" && /^\d+$/.test(index ?? "") ? run.outputs[Number(index)] : undefined;
    if (!output) return text("No such output.", 404);
    const exists = await stat(output.path).then(
      () => true,
      () => false,
    );
    return exists ? output : text(`${output.relPath} is gone: it was deleted or moved after the run.`, 410);
  };

  const sendFile = (output: ResolvedOutput): Response =>
    new Response(Bun.file(output.path), {
      headers: { "Content-Type": "application/octet-stream", "Content-Disposition": attachment(output.name), "Cache-Control": "no-store" },
    });

  const sendZip = (req: Request, server: Server, outputs: ResolvedOutput[], name: string): Response => {
    server.timeout(req, 0); // big folders take a while; the connection is local
    return new Response(zipStream(outputs.map((output) => ({ name: output.name, path: output.path }))), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": attachment(name), "Cache-Control": "no-store" },
    });
  };

  const failure = (req: Request, err: unknown): Response => {
    const status = err instanceof BuildError ? err.status : 500;
    const message = errorMessage(err);
    return wantsJson(req) ? Response.json({ error: message }, { status }) : text(message, status);
  };

  const page = async (req: Bun.BunRequest): Promise<Response> => {
    const command = runner.commands.get(req.params.command ?? "");
    if (!command) return text(`There is no build "${req.params.command}".`, 404);
    const runs = runner.runs(command.id);
    const wanted = new URL(req.url).searchParams.get("run");
    const run = (wanted && runs.find((r) => r.id === wanted)) || runs[0];
    const body = buildPage(site, await options.library(), {
      command: info(command),
      items: items(),
      run: run?.view(),
      log: run ? run.log + run.pending : "",
      history: runs.map((r) => r.view()),
      cwdLabel: cwdLabel(command.cwd),
      canReveal,
    });
    return new Response(body, { headers: PAGE_HEADERS });
  };

  return {
    [urls.builds()]: guard(async () =>
      new Response(buildsListPage(site, await options.library(), items(), configName), { headers: PAGE_HEADERS }),
    ),
    [`${urls.builds()}/`]: guard(() => Response.redirect(urls.builds(), 301)),
    [`${base}builds/:command`]: guard(page),

    [`${base}builds/:command/runs`]: {
      POST: guard(
        async (req) => {
          try {
            const run = await runner.start(req.params.command ?? "", await readValues(req));
            return wantsJson(req)
              ? Response.json({ run: run.view(), history: runner.history(run.command.id) }, { status: 201 })
              : Response.redirect(`${urls.builds(run.command.id)}?run=${run.id}`, 303);
          } catch (err) {
            return failure(req, err);
          }
        },
        { post: true },
      ),
    },

    [`${base}builds/:command/runs/:run`]: {
      GET: guard((req) => {
        const run = findRun(req);
        if (!run) return text("No such run.", 404);
        return Response.json({ run: run.view(), log: run.log + run.pending, history: runner.history(run.command.id) });
      }),
    },

    [`${base}builds/:command/runs/:run/cancel`]: {
      POST: guard(
        (req) => {
          const run = findRun(req);
          if (!run) return failure(req, new BuildError(404, "No such run."));
          if (!runner.cancel(run.id)) return failure(req, new BuildError(409, "This run has already finished."));
          return wantsJson(req) ? Response.json({ run: run.view() }, { status: 202 }) : Response.redirect(`${urls.builds(run.command.id)}?run=${run.id}`, 303);
        },
        { post: true },
      ),
    },

    [`${base}builds/:command/runs/:run/download`]: {
      GET: guard(async (req, server) => {
        const run = findRun(req);
        if (!run || run.status !== "succeeded" || !run.outputs.length) return text("This run has nothing to download.", 404);
        const outputs: ResolvedOutput[] = [];
        for (const { index } of run.outputs) {
          const output = await findOutput(run, String(index));
          if (output instanceof Response) return output;
          outputs.push(output);
        }
        const only = outputs.length === 1 ? outputs[0] : undefined;
        return only?.kind === "file" ? sendFile(only) : sendZip(req, server, outputs, `${run.command.id}-${fileStamp(run.startedAt)}.zip`);
      }),
    },

    [`${base}builds/:command/runs/:run/outputs/:index`]: {
      GET: guard(async (req, server) => {
        const run = findRun(req);
        if (!run) return text("No such run.", 404);
        const output = await findOutput(run, req.params.index);
        if (output instanceof Response) return output;
        if (output.kind === "file") return sendFile(output);
        const stamp = `${run.command.id}-${fileStamp(run.startedAt)}`;
        return sendZip(req, server, [output], run.outputs.length === 1 ? `${stamp}.zip` : `${stamp}-${output.name}.zip`);
      }),
    },

    [`${base}builds/:command/runs/:run/outputs/:index/open`]: {
      POST: guard(
        async (req) => {
          if (!canReveal) return failure(req, new BuildError(404, "Open (show in Finder) is only available on macOS."));
          const run = findRun(req);
          if (!run) return failure(req, new BuildError(404, "No such run."));
          const output = await findOutput(run, req.params.index);
          if (output instanceof Response) return output;
          try {
            await reveal(output.path);
          } catch (err) {
            return failure(req, new BuildError(500, `Couldn't show it in Finder: ${errorMessage(err)}`));
          }
          return wantsJson(req) ? new Response(null, { status: 204 }) : Response.redirect(`${urls.builds(run.command.id)}?run=${run.id}`, 303);
        },
        { post: true },
      ),
    },

    [urls.asset("builds.css")]: guard(
      () => new Response(options.styles, { headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-cache" } }),
    ),
    [urls.asset("builds.js")]: guard(
      () => new Response(options.script, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" } }),
    ),
  };
};

/** A page following a run's log: `{ "type": "subscribe", "run": "<id>" }`. Answers with a snapshot, then live updates. */
export const handleBuildSocketMessage = (runner: BuildRunner, ws: Bun.ServerWebSocket<SocketData>, message: string | Buffer): void => {
  if (!ws.data.builds) return;
  let request: unknown;
  try {
    request = JSON.parse(String(message));
  } catch {
    return;
  }
  const { type, run: runId } = (request ?? {}) as { type?: unknown; run?: unknown };
  if (type !== "subscribe" || typeof runId !== "string") return;

  if (ws.data.run) ws.unsubscribe(runTopic(ws.data.run));
  const run = runner.run(runId);
  const send = (reply: BuildSocketMessage) => ws.send(JSON.stringify(reply));
  if (!run) {
    ws.data.run = undefined;
    send({ type: "missing", run: runId });
    return;
  }
  // Subscribing and sending the snapshot in the same tick: nothing published in between is lost or doubled.
  ws.data.run = run.id;
  ws.subscribe(runTopic(run.id));
  send({ type: "snapshot", run: run.view(), log: run.log, history: runner.history(run.command.id) });
};

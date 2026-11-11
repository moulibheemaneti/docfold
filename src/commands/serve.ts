/**
 * Helpers shared by the dev and preview servers.
 */

/** Ports tried after the requested one when it is busy (dev and preview). */
const PORT_ATTEMPTS = 10;

/**
 * Starts a server with `serve(port)`. When the port is busy and `findFreePort` is on, tries the
 * next few ports instead of failing. Port 0 always lets the OS pick a free one.
 */
export const listen = <T>(serve: (port: number) => T, port: number, findFreePort = true): T => {
  for (let attempt = 0; ; attempt++) {
    try {
      return serve(port === 0 ? 0 : port + attempt);
    } catch (err) {
      const busy = (err as { code?: string }).code === "EADDRINUSE";
      if (!busy || !findFreePort || port === 0 || attempt >= PORT_ATTEMPTS) throw err;
    }
  }
};

export const htmlResponse = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

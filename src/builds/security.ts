/**
 * Who may use the Builds section. The dev server listens on every network interface, so docs are
 * reachable from a phone on the same network; builds run commands, so they answer only requests
 * from this computer, addressed to it by a loopback name (which also defeats DNS rebinding), and
 * state-changing requests must come from the dev server's own pages (Origin check).
 */

/** 127.0.0.0/8, ::1, and IPv4-mapped forms such as ::ffff:127.0.0.1. */
export const isLoopbackAddress = (address: string): boolean => {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "::1" || value === "0:0:0:0:0:0:0:1") return true;
  const v4 = value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
  return /^127(?:\.\d{1,3}){3}$/.test(v4);
};

/** A host name that can only mean this computer: localhost, *.localhost or a loopback address. */
export const isLoopbackHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "localhost" || host.endsWith(".localhost") || isLoopbackAddress(host);
};

interface RequestIP {
  requestIP: (request: Request) => { address: string } | null;
}

/** A request from this computer, sent to a loopback address (not a LAN address or a rebound domain). */
export const isLocalRequest = (req: Request, server: RequestIP): boolean => {
  const address = server.requestIP(req)?.address;
  if (!address || !isLoopbackAddress(address)) return false;
  try {
    return isLoopbackHost(new URL(req.url).hostname);
  } catch {
    return false;
  }
};

/** The request's Origin header is the dev server's own address, as the browser reached it. */
export const isSameOrigin = (req: Request): boolean => {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return origin === new URL(req.url).origin;
  } catch {
    return false;
  }
};

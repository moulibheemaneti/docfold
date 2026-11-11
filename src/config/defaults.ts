/**
 * Fills in defaults for the header, home page and watch options, and validates ports.
 */

import { resolve } from "node:path";
import { DEFAULTS } from "../shared/constants";
import type { HeaderConfig, ImageConfig, ImageSource, ResolvedConfig, ResolvedHeader, UserConfig } from "../types";

/**
 * A TCP port number (0 lets the OS pick a free one). Throws a readable error for anything else,
 * e.g. `Invalid --port: abc`.
 */
export const parsePort = (value: unknown, label = "port"): number => {
  const port = typeof value === "string" && !value.trim() ? Number.NaN : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid ${label}: ${String(value)}`);
  return port;
};

/** `"/logo.svg"` → `{ src: "/logo.svg" }`; an empty `src` means no image. */
export const toImage = (image: ImageSource | undefined): ImageConfig | undefined => {
  if (!image) return undefined;
  const config = typeof image === "string" ? { src: image } : image;
  return config.src?.trim() ? config : undefined;
};

export const resolveWatch = (watch: UserConfig["watch"]): ResolvedConfig["watch"] => {
  if (!watch) return false;
  const options = watch === true ? {} : watch;
  const debounce = Number(options.debounce ?? DEFAULTS.debounce);
  if (!Number.isFinite(debounce) || debounce < 0) throw new Error(`Invalid watch.debounce: ${options.debounce}`);
  return { liveReload: options.liveReload ?? true, debounce };
};

export const resolveHeader = (header: HeaderConfig = {}, title: string): ResolvedHeader => {
  const text = (value: string | false | undefined, fallback: string | false) =>
    value === false ? false : value?.trim() || fallback;
  const action =
    header.action === false
      ? false
      : { text: header.action?.text?.trim() || DEFAULTS.headerActionText, link: header.action?.link };
  return { logo: toImage(header.logo), name: text(header.name, title), tag: text(header.tag, DEFAULTS.headerTag), action };
};

export const resolveHome = (home: UserConfig["home"], root: string): ResolvedConfig["home"] => {
  if (!home) return false;
  const options = home === true ? {} : home;
  return {
    hero: { ...options.hero, image: toImage(options.hero?.image) },
    features: (options.features ?? []).filter((feature) => feature?.title?.trim()),
    file: resolve(root, options.file ?? DEFAULTS.homeFile),
  };
};

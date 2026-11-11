/**
 * Loads `docfold.config.ts` (or .js / .mjs) next to your docs:
 *
 *   import { defineConfig } from "docfold";
 *   export default defineConfig({ title: "My project", srcDir: "content" });
 *
 * Every option is optional; with no config file docfold serves the current folder.
 */

import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULTS } from "../shared/constants";
import { warn } from "../shared/log";
import { normalizeBase } from "../shared/urls";
import { parsePort, resolveHeader, resolveHome, resolveWatch } from "./defaults";
import type { ResolvedConfig, UserConfig } from "../types";

/** Identity helper that gives `docfold.config.ts` type checking and autocompletion. */
export const defineConfig = (config: UserConfig): UserConfig => config;

export const CONFIG_FILES = ["docfold.config.ts", "docfold.config.js", "docfold.config.mjs"];

const findConfigFile = async (root: string): Promise<string | undefined> => {
  for (const name of CONFIG_FILES) {
    const path = resolve(root, name);
    if (await Bun.file(path).exists()) return path;
  }
  return undefined;
};

const importConfig = async (configFile: string): Promise<UserConfig> => {
  if (!(await Bun.file(configFile).exists())) throw new Error(`Config file not found: ${configFile}`);
  const mod = (await import(pathToFileURL(configFile).href)) as { default?: UserConfig };
  if (!mod.default || typeof mod.default !== "object") {
    throw new Error(`${configFile} must have a default export: export default defineConfig({ ... })`);
  }
  return mod.default;
};

const stripUndefined = <T extends object>(value: T): Partial<T> =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;

/**
 * Loads the config from `root` (a folder) or from an explicit config file path,
 * applies `overrides` (CLI flags) and fills in defaults. All paths come back absolute.
 */
export const loadConfig = async (rootOrFile: string, overrides: UserConfig = {}): Promise<ResolvedConfig> => {
  const target = resolve(rootOrFile);
  const isFile = /\.(?:[cm]?[jt]s)$/.test(target);
  const configFile = isFile ? target : await findConfigFile(target);
  const root = isFile ? dirname(target) : target;
  const user = configFile ? await importConfig(configFile) : {};

  const merged: UserConfig = { ...user, ...stripUndefined(overrides), theme: { ...user.theme, ...overrides.theme } };
  const title = merged.title?.trim() || DEFAULTS.title;

  const home = resolveHome(merged.home, root);
  if (home && typeof merged.home === "object" && merged.home.file && !(await Bun.file(home.file).exists())) {
    warn(`home.file not found: ${home.file} (using the generated home page)`);
  }

  return {
    root,
    configFile,
    title,
    description: merged.description?.trim() || undefined,
    srcDir: resolve(root, merged.srcDir ?? DEFAULTS.srcDir),
    outDir: resolve(root, merged.outDir ?? DEFAULTS.outDir),
    publicDir: resolve(root, merged.publicDir ?? DEFAULTS.publicDir),
    base: normalizeBase(merged.base ?? DEFAULTS.base),
    port: parsePort(merged.port ?? DEFAULTS.port),
    watch: resolveWatch(merged.watch),
    header: resolveHeader(merged.header, title),
    home,
    theme: {
      colors: merged.theme?.colors ?? {},
      light: merged.theme?.light ?? {},
      dark: merged.theme?.dark ?? {},
      googleFonts: merged.theme?.googleFonts ?? true,
      css: merged.theme?.css ? resolve(root, merged.theme.css) : undefined,
    },
    head: merged.head ?? [],
  };
};

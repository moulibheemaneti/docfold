/**
 * Theme overrides from the config, as an inline <style>, plus the Google Fonts links.
 */

import type { CssVariables, ResolvedConfig } from "../types";

export const GOOGLE_FONTS = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400..700&family=Lora:wght@400..700&display=swap">',
].join("\n  ");

export const DEFAULT_THEME_COLOR = "#4355e0";

/** `{ primary: "#123" }` → `--primary:#123`. Names and values are sanitised so they can't break out of <style>. */
const declarations = (vars: CssVariables): string => {
  return Object.entries(vars)
    .map(([name, value]) => {
      const prop = name.replace(/^--/, "").replace(/[^\w-]/g, "");
      const val = String(value).replace(/[<>{};]/g, "").trim();
      return prop && val ? `--${prop}:${val}` : "";
    })
    .filter(Boolean)
    .join(";");
};

export const themeStyle = (theme: ResolvedConfig["theme"]): string => {
  const rules = [
    Object.keys(theme.colors).length ? `:root{${declarations(theme.colors)}}` : "",
    Object.keys(theme.light).length ? `@media (prefers-color-scheme: light){:root{${declarations(theme.light)}}}` : "",
    Object.keys(theme.dark).length ? `@media (prefers-color-scheme: dark){:root{${declarations(theme.dark)}}}` : "",
  ].filter(Boolean);
  return rules.length ? `<style>${rules.join("")}</style>` : "";
};

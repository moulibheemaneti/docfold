/** Options for `docfold.config.ts` (`UserConfig`) and the same options after defaults are applied (`ResolvedConfig`). */

import type { ResolvedBuilds } from "./builds";

export type CssVariables = Record<string, string>;

export interface ThemeConfig {
  /**
   * CSS variables for both light and dark mode, without the leading "--".
   * The main ones: `primary` (top bar, links, selected filters), `secondary` (buttons, highlights).
   * @example { primary: "#1d3557", secondary: "#f1c40f" }
   */
  colors?: CssVariables;
  /** CSS variables for light mode only, e.g. `{ bg: "#ffffff" }`. */
  light?: CssVariables;
  /** CSS variables for dark mode only, e.g. `{ bg: "#0b0b0b" }`. */
  dark?: CssVariables;
  /** Path (relative to the config file) of an extra stylesheet appended after the theme. */
  css?: string;
  /** Load Lora + Hanken Grotesk from Google Fonts. Set false to use system fonts. Default: true. */
  googleFonts?: boolean;
}

/**
 * An image: a file in `publicDir` ("/logo.svg"), any URL, or an object with a
 * separate dark-mode version and alt text.
 */
export type ImageSource = string | ImageConfig;

export interface ImageConfig {
  src: string;
  /** Shown instead of `src` in dark mode. */
  dark?: string;
  alt?: string;
}

export interface HeaderConfig {
  /** Logo before the site name, e.g. "/logo.svg" (a file in publicDir) or { src, dark, alt }. */
  logo?: ImageSource;
  /** Text beside the logo. Default: `title`. `false` shows only the logo. */
  name?: string | false;
  /** Small badge after the name. Default: "Docs". `false` hides it. */
  tag?: string | false;
  /**
   * The one button on the right of the header. `false` hides it.
   * Default: { text: "Get Started", link: <the documents list> }.
   */
  action?: false | { text?: string; link?: string };
}

export interface HeroAction {
  text: string;
  /** A page on this site ("/docs/", "/docs/guide/intro/", "/docs/?tag=ios") or any URL. */
  link: string;
  /** "brand" is the filled button, "alt" the quiet one. Default: the first action is "brand". */
  theme?: "brand" | "alt";
}

export interface HeroConfig {
  /** Big text in the brand gradient. Default: `title`. */
  name?: string;
  /** Large heading under the name. */
  text?: string;
  /** Smaller line under the heading. Default: `description`. */
  tagline?: string;
  /** Picture on the right (above the text on phones), with a soft glow behind it. */
  image?: ImageSource;
  /** Default: one "Browse documents" button linking to the documents list. */
  actions?: HeroAction[];
}

export interface FeatureConfig {
  /** An emoji or short text, or an image: { src, dark?, alt? }. */
  icon?: string | ImageConfig;
  title: string;
  details?: string;
  /** Makes the whole card a link. */
  link?: string;
  /** Text at the bottom of a linked card, e.g. "Read more". */
  linkText?: string;
}

export interface HomeConfig {
  hero?: HeroConfig;
  /** Cards under the hero. */
  features?: FeatureConfig[];
  /**
   * HTML file that replaces the generated home page, relative to the config file.
   * Default: "home.html", used whenever it exists. A fragment is shown inside the
   * site's header; a full document (starting with <!doctype> or <html>) is served as it is.
   */
  file?: string;
}

export interface WatchConfig {
  /** Reload open pages after a change. With `false`, changes show on the next manual refresh. Default: true. */
  liveReload?: boolean;
  /** Milliseconds to wait for more changes before reloading (editors often write a file several times). Default: 80. */
  debounce?: number;
}

/** Fields every build option has. */
interface BuildOptionBase {
  /** Name used in `{id}` placeholders, the form and the `DOCFOLD_OPT_<ID>` environment variable. Letters, digits, "-" and "_". */
  id: string;
  /** Text beside the field. Default: the id. */
  label?: string;
  /** Small hint under the field. */
  description?: string;
}

/** One of a fixed list of values. */
export interface BuildSelectOption extends BuildOptionBase {
  type: "select";
  choices: string[];
  /** Must be one of `choices`. Default: the first choice. */
  default?: string;
}

/** A checkbox. `{id}` becomes `flag` when it is on and nothing when it is off. */
export interface BuildBooleanOption extends BuildOptionBase {
  type: "boolean";
  /** Inserted where `{id}` appears when the box is ticked, e.g. "--split-per-abi". Default: "true". */
  flag?: string;
  /** Default: false. */
  default?: boolean;
}

/** Free text. */
export interface BuildTextOption extends BuildOptionBase {
  type: "text";
  /** The whole value must match this regular expression (like the HTML `pattern` attribute). */
  pattern?: string;
  default?: string;
  placeholder?: string;
}

export type BuildOptionConfig = BuildSelectOption | BuildBooleanOption | BuildTextOption;

/** A command the Builds section of `docfold dev` can run. */
export interface BuildCommandConfig {
  /** Unique; lower-case letters, digits, "-" and "_". Also the page address: /builds/<id>. */
  id: string;
  /** Default: the id. */
  label?: string;
  /** Commands with the same group are listed together. */
  group?: string;
  description?: string;
  /** Folder to run in, relative to the config file. Default: `builds.cwd`. */
  cwd?: string;
  /**
   * The command. An array runs as it is, without a shell: `["flutter", "build", "apk", "--{mode}"]`.
   * A string runs with `sh -c`, for pipes and `&&`. `{id}` is replaced by an option's value.
   */
  run: string | string[];
  /** Extra environment variables, on top of the dev server's own. */
  env?: Record<string, string>;
  options?: BuildOptionConfig[];
  /**
   * Files or folders the command produces, relative to its `cwd`. Globs work: "build/*.apk".
   * Only ones created or changed by a run are offered for download.
   */
  outputs?: string | string[];
}

export interface BuildsConfig {
  /** Folder commands run in, relative to the config file. Default: the config file's folder. */
  cwd?: string;
  commands: BuildCommandConfig[];
}

/** Formats a mounted folder's own search index can be read in. */
export type MountSearchFormat = "dartdoc";

export interface MountSearchConfig {
  /** The index's format. Supported: "dartdoc" (the index.json `dart doc` writes). */
  format: MountSearchFormat;
  /** The index file, relative to `dir`. Default: the format's own file ("index.json" for "dartdoc"). */
  index?: string;
}

/** A folder of HTML made by another tool (such as `dart doc`), served as it is at an address of its own. */
export interface MountConfig {
  /** The folder to serve, relative to the config file, e.g. "../doc/api". It may not exist yet. */
  dir: string;
  /**
   * Its address under the base: "reference" is served at <base>reference/. One or more "/"-separated
   * parts of lower-case letters, digits, "-" and "_". Can't start with docs, files, assets, api or builds.
   */
  path: string;
  /** Text of its link in the header and of the badge on its search results, e.g. "API reference". */
  label: string;
  /** Adds the folder's own search index to docfold's search. Leave out to serve the folder without searching it. */
  search?: MountSearchConfig;
}

export interface UserConfig {
  /** Site name in the top bar and page titles. Default: "Docs". */
  title?: string;
  /** One-line summary for search engines and the default hero tagline. */
  description?: string;
  /** Folder holding the markdown, relative to the config file. Default: "." (the config's folder). */
  srcDir?: string;
  /** Where `docfold build` writes the static site, relative to the config file. Default: "dist". */
  outDir?: string;
  /**
   * Folder whose files are served as they are from the site root (logo, favicon, images), relative
   * to the config file. "public/logo.svg" is available as "/logo.svg". Default: "public".
   */
  publicDir?: string;
  /** URL path the site is served from, e.g. "/my-repo/" for GitHub Pages project sites. Default: "/". */
  base?: string;
  /** Port for `docfold dev`. Default: 3000. */
  port?: number;
  /**
   * `docfold dev` only: watch the docs, home page, theme CSS and publicDir, and reload open
   * pages on save. `true` or an object turns it on. Default: false (files are read once at start).
   */
  watch?: boolean | WatchConfig;
  /** Logo, name, badge and the "Get Started" button in the top bar. */
  header?: HeaderConfig;
  /**
   * A landing page at the site root, with the documents list moving to "/docs/".
   * `true` uses the defaults, an object customises it. Default: false (the root is the documents list).
   */
  home?: boolean | HomeConfig;
  theme?: ThemeConfig;
  /** Extra raw HTML for every page's <head> (favicon, analytics…). */
  head?: string[];
  /**
   * `docfold dev` only: build commands you can run from the browser, listed under "Builds".
   * Never part of `docfold build`. Changes need a restart of `docfold dev`.
   */
  builds?: BuildsConfig;
  /**
   * Folders of HTML made by other tools (such as `dart doc`), each served as it is at its own
   * address, with an optional search index added to docfold's search.
   */
  mounts?: MountConfig[];
}

export interface ResolvedHeader {
  logo?: ImageConfig;
  name: string | false;
  tag: string | false;
  action: false | { text: string; link?: string };
}

/** `HeroConfig` with its image normalised to `{ src, dark?, alt? }`. */
export interface ResolvedHero extends Omit<HeroConfig, "image"> {
  image?: ImageConfig;
}

export interface ResolvedHome {
  hero: ResolvedHero;
  features: FeatureConfig[];
  /** Absolute path of the HTML override; it may not exist. */
  file: string;
}

export interface ResolvedConfig {
  /** Folder the config was loaded from (or the folder passed on the command line). */
  root: string;
  configFile?: string;
  title: string;
  description?: string;
  srcDir: string;
  outDir: string;
  publicDir: string;
  base: string;
  port: number;
  watch: false | Required<WatchConfig>;
  header: ResolvedHeader;
  home: false | ResolvedHome;
  theme: Required<Pick<ThemeConfig, "colors" | "light" | "dark" | "googleFonts">> & { css?: string };
  head: string[];
  /** `false` when the config declares no build commands. */
  builds: false | ResolvedBuilds;
  /** Empty when the config declares no mounts. */
  mounts: ResolvedMount[];
}

export interface ResolvedMount {
  /** Absolute path of the folder. */
  dir: string;
  /** The address under the base, without leading or trailing slashes: "reference", "api/v2". */
  path: string;
  label: string;
  search?: {
    format: MountSearchFormat;
    /** Absolute path of the index file. */
    index: string;
  };
}

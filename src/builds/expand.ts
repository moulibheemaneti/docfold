/**
 * Turns a build command and the values chosen in the form into what actually runs.
 *
 *   run: ["flutter", "build", "apk", "--{mode}", "{split}"]   mode = "release", split off
 *   →    ["flutter", "build", "apk", "--release"]             ("{split}" alone and empty: dropped)
 *
 * A string `run` is a shell script for `sh -c`. Values never go into it: each `{id}` becomes a
 * reference to the DOCFOLD_OPT_<ID> environment variable that holds the value.
 *
 * Browser-safe (no Bun / node APIs): the Builds page previews the command with the same code.
 */

import type { BuildCommandInfo, BuildOptionValues, ResolvedBuildOption } from "../types";

/** `{id}`, but not `${VAR}` (shell variables in a script). */
export const PLACEHOLDER = /(?<!\$)\{([A-Za-z][\w-]*)\}/g;

/** Option ids: a letter, then letters, digits, "-" and "_". */
export const OPTION_ID = /^[A-Za-z][\w-]*$/;

/** Longest text value accepted from the form. */
export const MAX_TEXT_VALUE = 1000;

/** The names of the options `run` refers to, in order of first use. In a script, `\{id}` is a literal "{id}". */
export const placeholdersIn = (run: string | string[]): string[] => {
  const ids = new Set<string>();
  if (typeof run === "string") {
    replaceInScript(run, (id, _quoting, match) => {
      ids.add(id);
      return match;
    });
  } else {
    for (const part of run) for (const match of part.matchAll(PLACEHOLDER)) ids.add(match[1]!);
  }
  return [...ids];
};

/** "split-per-abi" → "DOCFOLD_OPT_SPLIT_PER_ABI". */
export const envName = (optionId: string): string => `DOCFOLD_OPT_${optionId.toUpperCase().replace(/-/g, "_")}`;

/** A `RegExp` matching the whole value, like the HTML `pattern` attribute. */
export const fullMatch = (pattern: string): RegExp => new RegExp(`^(?:${pattern})$`, "u");

export const defaultValues = (options: readonly ResolvedBuildOption[]): BuildOptionValues =>
  Object.fromEntries(options.map((option) => [option.id, option.default]));

/**
 * Checks values from the form (or JSON) against the declared options. Missing values take the
 * default, except checkboxes: a form leaves out unticked ones, so missing means off.
 * Throws a readable error for anything that doesn't fit.
 */
export const parseValues = (
  options: readonly ResolvedBuildOption[],
  get: (id: string) => unknown,
): BuildOptionValues => {
  const values: BuildOptionValues = {};
  for (const option of options) {
    const input = get(option.id);
    if (option.type === "boolean") {
      if (input === undefined || input === null || input === false || input === "" || input === "false" || input === "0") {
        values[option.id] = false;
      } else if (input === true || input === "true" || input === "on" || input === "1") {
        values[option.id] = true;
      } else {
        throw new Error(`${option.label}: expected on or off.`);
      }
      continue;
    }

    if (input !== undefined && input !== null && typeof input !== "string") throw new Error(`${option.label}: expected text.`);
    const value = (input as string | null | undefined) ?? option.default;
    if (option.type === "select") {
      if (!option.choices.includes(value)) throw new Error(`${option.label}: "${value}" is not one of ${option.choices.join(", ")}.`);
    } else {
      if (value.length > MAX_TEXT_VALUE) throw new Error(`${option.label}: longer than ${MAX_TEXT_VALUE} characters.`);
      if (/[\0\r\n]/.test(value)) throw new Error(`${option.label}: must be a single line.`);
      if (option.pattern && !fullMatch(option.pattern).test(value)) {
        throw new Error(`${option.label}: "${value}" doesn't match the pattern ${option.pattern}.`);
      }
    }
    values[option.id] = value;
  }
  return values;
};

/** The text an option puts in place of `{id}`: a ticked checkbox gives its flag, an unticked one nothing. */
export const optionText = (option: ResolvedBuildOption, value: string | boolean | undefined): string => {
  if (option.type === "boolean") return value === true ? (option.flag ?? "true") : "";
  return typeof value === "string" ? value : option.default;
};

const textsById = (options: readonly ResolvedBuildOption[], values: BuildOptionValues): Map<string, string> =>
  new Map(options.map((option) => [option.id, optionText(option, values[option.id])]));

/**
 * Replaces placeholders in an argv array. An element that is only `{id}` and comes out empty is
 * dropped, so an unticked flag leaves no "" argument behind.
 */
export const expandArgv = (argv: readonly string[], options: readonly ResolvedBuildOption[], values: BuildOptionValues): string[] => {
  const texts = textsById(options, values);
  const out: string[] = [];
  for (const part of argv) {
    const whole = /^\{([A-Za-z][\w-]*)\}$/.exec(part);
    const expanded = part.replace(PLACEHOLDER, (match, id: string) => texts.get(id) ?? match);
    if (whole && texts.has(whole[1]!) && expanded === "") continue;
    out.push(expanded);
  }
  return out;
};

type Quoting = "none" | "single" | "double";

/**
 * Walks a shell script, tracking quotes, and replaces each `{id}` with what `replace` returns
 * for it in that context.
 */
const replaceInScript = (script: string, replace: (id: string, quoting: Quoting, match: string) => string): string => {
  let out = "";
  let quoting: Quoting = "none";
  for (let i = 0; i < script.length; ) {
    const char = script[i]!;
    const placeholder = char === "{" && script[i - 1] !== "$" ? /^\{([A-Za-z][\w-]*)\}/.exec(script.slice(i)) : null;
    if (placeholder) {
      out += replace(placeholder[1]!, quoting, placeholder[0]);
      i += placeholder[0].length;
      continue;
    }
    if (quoting === "single") {
      if (char === "'") quoting = "none";
    } else if (char === "\\" && i + 1 < script.length) {
      out += char + script[i + 1];
      i += 2;
      continue;
    } else if (quoting === "double") {
      if (char === '"') quoting = "none";
    } else if (char === "'") quoting = "single";
    else if (char === '"') quoting = "double";
    out += char;
    i++;
  }
  return out;
};

/** Options a script uses inside single quotes, where the shell can't put their values. */
export const singleQuotedPlaceholders = (script: string): string[] => {
  const ids = new Set<string>();
  replaceInScript(script, (id, quoting, match) => {
    if (quoting === "single") ids.add(id);
    return match;
  });
  return [...ids];
};

/**
 * A `run` script with every `{id}` replaced by `${DOCFOLD_OPT_ID:+"$DOCFOLD_OPT_ID"}`: the value,
 * quoted, or no word at all when it is empty (like a dropped argv element). Works unquoted and
 * inside double quotes.
 */
export const shellScript = (script: string): string =>
  replaceInScript(script, (id, quoting, match) => {
    if (quoting === "single") return match;
    const name = envName(id);
    return `\${${name}:+"$${name}"}`;
  });

/** The environment variables holding each option's value (for scripts, and for any command that wants them). */
export const optionEnv = (options: readonly ResolvedBuildOption[], values: BuildOptionValues): Record<string, string> =>
  Object.fromEntries(options.map((option) => [envName(option.id), optionText(option, values[option.id])]));

/** Quotes an argument for a POSIX shell, only when it needs it: `a b` → `'a b'`. */
export const shellQuote = (arg: string): string =>
  arg !== "" && /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;

/** What will run, as one line you could paste into a terminal. */
export const commandLine = (command: Pick<BuildCommandInfo, "run" | "options">, values: BuildOptionValues): string => {
  if (typeof command.run !== "string") return expandArgv(command.run, command.options, values).map(shellQuote).join(" ");
  const texts = textsById(command.options, values);
  return replaceInScript(command.run, (id, quoting, match) => {
    const text = texts.get(id);
    if (text === undefined || quoting === "single") return match;
    return quoting === "double" ? text.replace(/[\\$`"]/g, "\\$&") : text && shellQuote(text);
  });
};

/** The program and arguments to spawn. */
export const spawnArgs = (command: Pick<BuildCommandInfo, "run" | "options">, values: BuildOptionValues): string[] =>
  typeof command.run === "string" ? ["sh", "-c", shellScript(command.run)] : expandArgv(command.run, command.options, values);

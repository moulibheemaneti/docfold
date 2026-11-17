/**
 * Validates the `builds` key of docfold.config.ts and fills in its defaults. Every problem is
 * reported at once, each with the command (and option) it belongs to.
 */

import { resolve } from "node:path";
import { fullMatch, OPTION_ID, placeholdersIn, singleQuotedPlaceholders } from "./expand";
import type { BuildOptionConfig, BuildsConfig, ResolvedBuildCommand, ResolvedBuildOption, ResolvedBuilds } from "../types";

/** Command ids are page addresses (/builds/<id>): lower-case letters, digits, "-" and "_". */
export const COMMAND_ID = /^[a-z0-9][a-z0-9_-]*$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): value is string | undefined => value === undefined || typeof value === "string";

const text = (value: string | undefined): string | undefined => value?.trim() || undefined;

const resolveOption = (raw: unknown, where: string, errors: string[]): ResolvedBuildOption | undefined => {
  if (!isObject(raw)) {
    errors.push(`${where} must be an object like { id: "mode", type: "select", choices: ["debug", "release"] }.`);
    return undefined;
  }
  const option = raw as unknown as BuildOptionConfig;
  if (typeof option.id !== "string" || !OPTION_ID.test(option.id)) {
    errors.push(`${where}: id ${JSON.stringify(option.id)} must start with a letter and use only letters, digits, "-" and "_".`);
    return undefined;
  }
  const at = `${where} ("${option.id}")`;
  const label = (typeof option.label === "string" && option.label.trim()) || option.id;
  const description = typeof option.description === "string" ? text(option.description) : undefined;

  switch (option.type) {
    case "select": {
      const { choices } = option;
      if (!Array.isArray(choices) || !choices.length || choices.some((choice) => typeof choice !== "string")) {
        errors.push(`${at}: choices must be a non-empty list of strings.`);
        return undefined;
      }
      if (option.default !== undefined && !choices.includes(option.default)) {
        errors.push(`${at}: default ${JSON.stringify(option.default)} is not one of its choices (${choices.join(", ")}).`);
        return undefined;
      }
      return { id: option.id, label, description, type: "select", choices: [...new Set(choices)], default: option.default ?? choices[0]! };
    }
    case "boolean": {
      if (!optionalString(option.flag)) errors.push(`${at}: flag must be a string, e.g. "--verbose".`);
      if (option.default !== undefined && typeof option.default !== "boolean") errors.push(`${at}: default must be true or false.`);
      return { id: option.id, label, description, type: "boolean", flag: option.flag || undefined, default: option.default === true };
    }
    case "text": {
      if (!optionalString(option.default) || !optionalString(option.placeholder) || !optionalString(option.pattern)) {
        errors.push(`${at}: default, placeholder and pattern must be strings.`);
        return undefined;
      }
      const value = option.default ?? "";
      if (option.pattern) {
        let pattern: RegExp;
        try {
          pattern = fullMatch(option.pattern);
        } catch {
          errors.push(`${at}: pattern ${JSON.stringify(option.pattern)} is not a valid regular expression.`);
          return undefined;
        }
        if (value && !pattern.test(value)) errors.push(`${at}: default ${JSON.stringify(value)} doesn't match its pattern.`);
      }
      return {
        id: option.id,
        label,
        description,
        type: "text",
        default: value,
        pattern: option.pattern || undefined,
        placeholder: text(option.placeholder),
      };
    }
    default:
      errors.push(`${at}: type must be "select", "boolean" or "text".`);
      return undefined;
  }
};

const resolveCommand = (raw: unknown, index: number, defaultCwd: string, root: string, errors: string[]): ResolvedBuildCommand | undefined => {
  const where = `builds.commands[${index}]`;
  if (!isObject(raw)) {
    errors.push(`${where} must be an object like { id: "web", run: ["bun", "run", "build"] }.`);
    return undefined;
  }
  const { id } = raw;
  if (typeof id !== "string" || !COMMAND_ID.test(id)) {
    errors.push(`${where}: id ${JSON.stringify(id)} is used in the page address (/builds/<id>): use only lower-case letters, digits, "-" and "_".`);
    return undefined;
  }
  const at = `${where} ("${id}")`;
  const before = errors.length;

  const { run } = raw;
  const validRun =
    (typeof run === "string" && run.trim() !== "") ||
    (Array.isArray(run) && run.length > 0 && run.every((part) => typeof part === "string") && run[0] !== "");
  if (!validRun) errors.push(`${at}: run must be a list of arguments (["bun", "run", "build"]) or a shell command string.`);

  for (const key of ["label", "group", "description", "cwd"] as const) {
    if (!optionalString(raw[key])) errors.push(`${at}: ${key} must be a string.`);
  }

  const env: Record<string, string> = {};
  if (raw.env !== undefined) {
    if (!isObject(raw.env)) errors.push(`${at}: env must be an object of strings, e.g. { NODE_ENV: "production" }.`);
    else {
      for (const [name, value] of Object.entries(raw.env)) {
        if (!/^[A-Za-z_][\w]*$/.test(name)) errors.push(`${at}: env name ${JSON.stringify(name)} is not a valid variable name.`);
        else if (typeof value !== "string") errors.push(`${at}: env.${name} must be a string.`);
        else env[name] = value;
      }
    }
  }

  const rawOutputs = typeof raw.outputs === "string" ? [raw.outputs] : (raw.outputs ?? []);
  if (!Array.isArray(rawOutputs) || rawOutputs.some((output) => typeof output !== "string" || !output.trim())) {
    errors.push(`${at}: outputs must be a path or glob, or a list of them, relative to the command's cwd.`);
  }

  const options: ResolvedBuildOption[] = [];
  if (raw.options !== undefined && !Array.isArray(raw.options)) errors.push(`${at}: options must be a list.`);
  else {
    const seen = new Set<string>();
    (raw.options ?? []).forEach((rawOption: unknown, i: number) => {
      const option = resolveOption(rawOption, `${at}.options[${i}]`, errors);
      if (!option) return;
      // DOCFOLD_OPT_<ID> must be unique too, so "out-dir" and "out_dir" can't both exist.
      const key = option.id.toLowerCase().replace(/-/g, "_");
      if (seen.has(key)) errors.push(`${at}: option id "${option.id}" is used more than once.`);
      seen.add(key);
      options.push(option);
    });
  }

  if (validRun) {
    const ids = new Set(options.map((option) => option.id));
    for (const name of placeholdersIn(run as string | string[])) {
      if (!ids.has(name)) {
        const known = options.length ? `its options are ${options.map((option) => option.id).join(", ")}` : "it has no options";
        errors.push(`${at}: run uses {${name}}, but ${known}.`);
      }
    }
    if (typeof run === "string") {
      for (const name of singleQuotedPlaceholders(run)) {
        errors.push(`${at}: {${name}} is inside single quotes in run, where sh can't fill it in. Use double quotes instead.`);
      }
    }
  }

  if (errors.length > before) return undefined;
  return {
    id,
    label: text(raw.label as string | undefined) ?? id,
    group: text(raw.group as string | undefined),
    description: text(raw.description as string | undefined),
    cwd: typeof raw.cwd === "string" && raw.cwd.trim() ? resolve(root, raw.cwd) : defaultCwd,
    run: run as string | string[],
    env,
    options,
    outputs: (rawOutputs as string[]).map((output) => output.trim()),
  };
};

/**
 * The validated `builds` config, or `false` when it declares no commands. Paths are resolved
 * against `root` (the config file's folder). Throws one error listing every problem.
 */
export const resolveBuilds = (builds: BuildsConfig | undefined, root: string): false | ResolvedBuilds => {
  if (builds === undefined || builds === null) return false;
  const errors: string[] = [];
  if (!isObject(builds) || !Array.isArray(builds.commands)) {
    throw new Error('Invalid builds config: expected { commands: [{ id: "web", run: ["bun", "run", "build"] }] }.');
  }
  if (!optionalString(builds.cwd)) errors.push("builds.cwd must be a string.");
  const cwd = resolve(root, typeof builds.cwd === "string" ? builds.cwd : ".");

  const commands: ResolvedBuildCommand[] = [];
  const seen = new Set<string>();
  builds.commands.forEach((raw, index) => {
    const command = resolveCommand(raw, index, cwd, root, errors);
    if (!command) return;
    if (seen.has(command.id)) errors.push(`builds.commands[${index}]: id "${command.id}" is used by another command.`);
    seen.add(command.id);
    commands.push(command);
  });

  if (errors.length) throw new Error(`Invalid builds config:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  return commands.length ? { commands } : false;
};

/** Build commands after validation, their runs and what the browser is sent about them. */

import type { BuildBooleanOption, BuildSelectOption, BuildTextOption } from "./config";

export type ResolvedBuildOption =
  | (Required<Pick<BuildSelectOption, "id" | "label" | "type" | "choices" | "default">> & { description?: string })
  | (Required<Pick<BuildBooleanOption, "id" | "label" | "type" | "default">> & { description?: string; flag?: string })
  | (Required<Pick<BuildTextOption, "id" | "label" | "type" | "default">> & {
      description?: string;
      pattern?: string;
      placeholder?: string;
    });

/** What the browser needs to show a command and preview it: no paths, no environment. */
export interface BuildCommandInfo {
  id: string;
  label: string;
  group?: string;
  description?: string;
  /** An argv array (run without a shell) or a script for `sh -c`. */
  run: string | string[];
  options: ResolvedBuildOption[];
}

export interface ResolvedBuildCommand extends BuildCommandInfo {
  /** Absolute folder the command runs in. */
  cwd: string;
  env: Record<string, string>;
  /** Paths or globs relative to `cwd`. */
  outputs: string[];
}

export interface ResolvedBuilds {
  commands: ResolvedBuildCommand[];
}

/** Option values for one run: text and select values are strings, checkboxes are booleans. */
export type BuildOptionValues = Record<string, string | boolean>;

export type BuildRunStatus = "running" | "succeeded" | "failed" | "cancelled";

/** A file or folder a run produced. The browser only ever refers to it by `index`. */
export interface BuildOutput {
  index: number;
  /** File or folder name. */
  name: string;
  /** Path relative to the command's folder, for display. */
  relPath: string;
  kind: "file" | "folder";
  /** Bytes, for files. */
  size?: number;
}

/** A run as the browser sees it (JSON). */
export interface BuildRunView {
  id: string;
  command: string;
  status: BuildRunStatus;
  /** The command line, quoted for a shell. */
  commandLine: string;
  values: BuildOptionValues;
  /** Epoch milliseconds. */
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  signal?: string | null;
  /** Why it couldn't start, e.g. a missing program. */
  error?: string;
  /** The last output looks like a question and nothing has been printed for a few seconds. */
  waitingForInput: boolean;
  /** The start of the log was dropped to keep it under the size limit. */
  logTrimmed: boolean;
  outputs: BuildOutput[];
  /** Why no outputs are offered for a successful run (nothing matched, or only older files did). */
  outputsNote?: string;
}

/** Messages the dev server sends on a run's WebSocket topic. */
export type BuildSocketMessage =
  | { type: "snapshot"; run: BuildRunView; log: string; history: BuildRunView[] }
  | { type: "log"; run: string; text: string }
  | { type: "status"; run: BuildRunView; history: BuildRunView[] }
  | { type: "missing"; run: string };

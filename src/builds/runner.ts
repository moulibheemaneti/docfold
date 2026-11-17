/**
 * Runs build commands for the dev server and keeps their recent runs in memory.
 *
 * - Each run is spawned in its own process group (a new session), with stdin closed and the
 *   dev server's environment plus the command's `env` and its option values (DOCFOLD_OPT_<ID>).
 * - One run at a time per command; different commands run in parallel.
 * - Cancel sends SIGTERM to the whole group, then SIGKILL if it is still there a few seconds later.
 * - Output is batched and published on the run's topic (`runTopic(id)`); the log is capped by
 *   dropping its start. Runs are lost when the server stops.
 */

import { stat } from "node:fs/promises";
import { DEFAULTS } from "../shared/constants";
import { stripAnsi } from "../shared/ansi";
import { errorMessage } from "../shared/log";
import { commandLine, optionEnv, parseValues, spawnArgs } from "./expand";
import { formatDuration } from "./format";
import { outputsNote, resolveOutputs, type ResolvedOutput } from "./outputs";
import type { BuildOptionValues, BuildRunStatus, BuildRunView, BuildSocketMessage, ResolvedBuildCommand, ResolvedBuilds } from "../types";

/** An error with the HTTP status the dev server should answer with. */
export class BuildError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface BuildRunnerOptions {
  /** Sends a message to everyone subscribed to a topic (the dev server's `server.publish`). */
  publish?: (topic: string, message: string) => void;
  /** Runs kept per command. Default: 10. */
  history?: number;
  /** Characters of log kept per run. Default: 2,000,000. */
  maxLog?: number;
  /** Milliseconds from SIGTERM to SIGKILL on cancel. Default: 5000. */
  killDelay?: number;
  /** Milliseconds of silence after a question-like line before the run counts as waiting for input. Default: 3000. */
  promptDelay?: number;
  /** Milliseconds to batch output before publishing it. Default: 40. */
  flushDelay?: number;
}

/** The WebSocket topic carrying one run's output and status. */
export const runTopic = (runId: string): string => `build:${runId}`;

const PROMPT_END = /(?:[?:>]|\[[^\]\n]*\/[^\]\n]*\]|\([^)\n]*\/[^)\n]*\))\s*$/;
const PROMPT_WORDS = /password|passphrase|press (?:any key|enter|return)|\[y\/n\]|\(y\/n\)|yes\/no/i;

/**
 * Whether the end of a log looks like a question: a last line without a newline ending in "?",
 * ":", ">" or "[y/N]", or a line mentioning a password or "press enter".
 */
export const looksLikePrompt = (log: string): boolean => {
  const tail = stripAnsi(log.slice(-1000));
  const cut = tail.lastIndexOf("\n");
  const last = tail.slice(cut + 1);
  if (last.trim()) return PROMPT_END.test(last) || PROMPT_WORDS.test(last);
  const previous = tail.slice(tail.lastIndexOf("\n", cut - 1) + 1, cut);
  return PROMPT_WORDS.test(previous);
};

const randomId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 12);
};

/** Signals a run's whole process group. False when there is no such group (any more), or no groups (Windows). */
const signalGroup = (pid: number, signal: NodeJS.Signals): boolean => {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
};

/** Signals the group, or the process alone where groups don't exist, as long as it hasn't exited. */
const stopRun = (run: BuildRun, signal: NodeJS.Signals): void => {
  if (!run.proc) return;
  if (!signalGroup(run.proc.pid, signal) && run.running) run.proc.kill(signal);
};

const dim = (text: string): string => `\x1b[2m${text}\x1b[22m`;

/** One run of a command. Server-side only: `view()` is what browsers get. */
export class BuildRun {
  readonly id = randomId();
  readonly startedAt = Date.now();
  status: BuildRunStatus = "running";
  endedAt?: number;
  exitCode?: number | null;
  signal?: string | null;
  error?: string;
  waitingForInput = false;
  log = "";
  logTrimmed = false;
  outputs: ResolvedOutput[] = [];
  outputsNote?: string;

  /** Output not yet added to `log` and published. */
  pending = "";
  proc?: Bun.Subprocess<"ignore", "pipe", "pipe">;
  cancelRequested = false;
  done: Promise<void>;
  finish!: () => void;
  timers: { flush?: ReturnType<typeof setTimeout>; prompt?: ReturnType<typeof setTimeout>; kill?: ReturnType<typeof setTimeout> } = {};

  constructor(
    readonly command: ResolvedBuildCommand,
    readonly values: BuildOptionValues,
  ) {
    this.done = new Promise((resolve) => {
      this.finish = resolve;
    });
  }

  get running(): boolean {
    return this.status === "running";
  }

  view(): BuildRunView {
    return {
      id: this.id,
      command: this.command.id,
      status: this.status,
      commandLine: commandLine(this.command, this.values),
      values: this.values,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      exitCode: this.exitCode,
      signal: this.signal,
      error: this.error,
      waitingForInput: this.waitingForInput,
      logTrimmed: this.logTrimmed,
      outputs: this.outputs.map(({ path: _path, ...output }) => output),
      outputsNote: this.outputsNote,
    };
  }
}

export class BuildRunner {
  readonly commands: ReadonlyMap<string, ResolvedBuildCommand>;
  /** Newest first. */
  readonly #history = new Map<string, BuildRun[]>();
  readonly #byId = new Map<string, BuildRun>();
  readonly #options: Required<Omit<BuildRunnerOptions, "publish">>;
  #publish: (topic: string, message: string) => void;
  /** Stops builds left running if the dev server's process exits without `stop()`. */
  readonly #onExit = () => {
    for (const run of this.#byId.values()) if (run.running) stopRun(run, "SIGTERM");
  };

  constructor(builds: ResolvedBuilds, options: BuildRunnerOptions = {}) {
    this.commands = new Map(builds.commands.map((command) => [command.id, command]));
    this.#publish = options.publish ?? (() => {});
    this.#options = {
      history: options.history ?? DEFAULTS.buildHistory,
      maxLog: options.maxLog ?? DEFAULTS.buildLogChars,
      killDelay: options.killDelay ?? DEFAULTS.buildKillDelay,
      promptDelay: options.promptDelay ?? 3000,
      flushDelay: options.flushDelay ?? 40,
    };
    process.on("exit", this.#onExit);
  }

  /** Where run messages go (set once the dev server is listening). */
  set publish(publish: (topic: string, message: string) => void) {
    this.#publish = publish;
  }

  /** The command's runs, newest first. */
  runs(commandId: string): BuildRun[] {
    return this.#history.get(commandId) ?? [];
  }

  run(runId: string): BuildRun | undefined {
    return this.#byId.get(runId);
  }

  history(commandId: string): BuildRunView[] {
    return this.runs(commandId).map((run) => run.view());
  }

  /**
   * Starts `commandId` with option values from a form or JSON (`get(id)` returns one value).
   * Throws a `BuildError`: 404 unknown command, 400 bad values, 409 already running.
   */
  async start(commandId: string, get: (id: string) => unknown = () => undefined): Promise<BuildRun> {
    const command = this.commands.get(commandId);
    if (!command) throw new BuildError(404, `There is no build "${commandId}".`);
    const active = this.runs(commandId)[0];
    if (active?.running) throw new BuildError(409, `${command.label} is already running.`);

    let values: BuildOptionValues;
    try {
      values = parseValues(command.options, get);
    } catch (err) {
      throw new BuildError(400, errorMessage(err));
    }

    const run = new BuildRun(command, values);
    this.#remember(run);
    const argv = spawnArgs(command, values);
    run.log = `${dim(`$ ${commandLine(command, values)}`)}\n`;

    const cwdOk = await stat(command.cwd).then(
      (info) => info.isDirectory(),
      () => false,
    );
    if (!argv[0]) this.#fail(run, "The command is empty for these options.");
    else if (!cwdOk) this.#fail(run, `The folder to run in doesn't exist: ${command.cwd}`);
    else {
      try {
        run.proc = Bun.spawn({
          cmd: argv,
          cwd: command.cwd,
          env: { ...process.env, PWD: command.cwd, ...command.env, ...optionEnv(command.options, values) },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          detached: true,
        });
      } catch (err) {
        this.#fail(run, `Couldn't start ${argv[0]}: ${errorMessage(err)}`);
      }
    }
    if (run.proc) void this.#watch(run, run.proc);
    return run;
  }

  /** Stops a run and everything it started. Returns false when it wasn't running. */
  cancel(runId: string): boolean {
    const run = this.#byId.get(runId);
    if (!run?.running || !run.proc) return false;
    if (run.cancelRequested) return true;
    run.cancelRequested = true;
    stopRun(run, "SIGTERM");
    // Whatever ignores SIGTERM (the command or something it started) goes a few seconds later.
    run.timers.kill = setTimeout(() => stopRun(run, "SIGKILL"), this.#options.killDelay);
    run.timers.kill.unref?.();
    this.#append(run, `\n${dim("Cancelling…")}\n`);
    return true;
  }

  /** Cancels every running build and waits (briefly) for them to end. */
  async stop(): Promise<void> {
    process.off("exit", this.#onExit);
    const running = [...this.#byId.values()].filter((run) => run.running);
    for (const run of running) this.cancel(run.id);
    await Promise.race([Promise.all(running.map((run) => run.done)), Bun.sleep(this.#options.killDelay + 1000)]);
    for (const run of running) {
      clearTimeout(run.timers.kill);
      stopRun(run, "SIGKILL");
    }
  }

  #remember(run: BuildRun): void {
    const runs = [run, ...this.runs(run.command.id)];
    // Keep the newest runs, and never forget one that is still going.
    const kept = runs.filter((r, i) => i < this.#options.history || r.running);
    for (const dropped of runs.filter((r) => !kept.includes(r))) this.#byId.delete(dropped.id);
    this.#history.set(run.command.id, kept);
    this.#byId.set(run.id, run);
  }

  #send(run: BuildRun, message: BuildSocketMessage): void {
    this.#publish(runTopic(run.id), JSON.stringify(message));
  }

  #status(run: BuildRun): void {
    this.#send(run, { type: "status", run: run.view(), history: this.history(run.command.id) });
  }

  #fail(run: BuildRun, message: string): void {
    run.error = message;
    this.#append(run, `\x1b[31m${message}\x1b[39m\n`);
    this.#end(run, "failed");
  }

  /** Queues output; it reaches the log and the browser in batches. */
  #append(run: BuildRun, text: string): void {
    if (!text) return;
    run.pending += text;
    if (run.timers.flush === undefined) run.timers.flush = setTimeout(() => this.#flush(run), this.#options.flushDelay);
  }

  #flush(run: BuildRun): void {
    clearTimeout(run.timers.flush);
    run.timers.flush = undefined;
    if (!run.pending) return;
    const text = run.pending;
    run.pending = "";
    run.log += text;
    const { maxLog } = this.#options;
    if (run.log.length > maxLog) {
      // Drop whole lines from the start.
      const cut = run.log.length - maxLog;
      const newline = run.log.indexOf("\n", cut);
      run.log = run.log.slice(newline === -1 || newline - cut > 10_000 ? cut : newline + 1);
      run.logTrimmed = true;
    }
    this.#send(run, { type: "log", run: run.id, text });

    if (!run.running) return;
    if (run.waitingForInput) {
      run.waitingForInput = false;
      this.#status(run);
    }
    clearTimeout(run.timers.prompt);
    run.timers.prompt = setTimeout(() => {
      if (run.running && !run.pending && looksLikePrompt(run.log)) {
        run.waitingForInput = true;
        this.#status(run);
      }
    }, this.#options.promptDelay);
  }

  /** Reads one output stream into the log until it closes or `stop` resolves. */
  async #pump(run: BuildRun, stream: ReadableStream<Uint8Array>, stop: Promise<unknown>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const stopped = stop.then(() => ({ done: true as const, value: undefined }));
    try {
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), stopped]);
        if (done) break;
        this.#append(run, decoder.decode(value, { stream: true }));
      }
      this.#append(run, decoder.decode());
    } catch {
      // stream errored: the process is gone
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  async #watch(run: BuildRun, proc: NonNullable<BuildRun["proc"]>): Promise<void> {
    // Something the command left running in the background can hold the pipes open; stop
    // reading shortly after the command itself has exited.
    const exited = proc.exited;
    const giveUp = exited.then(() => Bun.sleep(1000));
    await Promise.all([this.#pump(run, proc.stdout, giveUp), this.#pump(run, proc.stderr, giveUp), exited]);

    run.exitCode = proc.exitCode;
    run.signal = proc.signalCode === null ? null : String(proc.signalCode);
    const took = formatDuration(Date.now() - run.startedAt);
    if (run.cancelRequested) {
      this.#append(run, dim(`Cancelled after ${took}.`) + "\n");
      this.#end(run, "cancelled");
      return;
    }
    if (proc.exitCode === 0) {
      const result = await resolveOutputs(run.command.outputs, run.command.cwd, run.startedAt).catch(() => ({ outputs: [], stale: 0 }));
      run.outputs = result.outputs;
      run.outputsNote = outputsNote(result, run.command.outputs);
      this.#append(run, dim(`Finished in ${took}.`) + "\n");
      this.#end(run, "succeeded");
      return;
    }
    const how = proc.signalCode ? `was stopped by ${proc.signalCode}` : `exited with code ${proc.exitCode}`;
    this.#append(run, `\x1b[31mFailed: the command ${how} after ${took}.\x1b[39m\n`);
    this.#end(run, "failed");
  }

  #end(run: BuildRun, status: BuildRunStatus): void {
    run.status = status;
    run.endedAt = Date.now();
    run.waitingForInput = false;
    clearTimeout(run.timers.prompt);
    if (status !== "cancelled") clearTimeout(run.timers.kill);
    this.#flush(run);
    this.#status(run);
    run.finish();
  }
}

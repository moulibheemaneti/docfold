import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, rm, symlink, utimes } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import {
  BuildRunner,
  commandLine,
  expandArgv,
  isLoopbackAddress,
  isLoopbackHost,
  looksLikePrompt,
  outputsNote,
  parseValues,
  resolveBuilds,
  resolveOutputs,
  shellScript,
  spawnArgs,
  zipStream,
} from "../src/builds";
import { build, createDevServer } from "../src/commands";
import { loadConfig } from "../src/config";
import { AnsiRenderer, ansiToHtml, stripAnsi } from "../src/shared/ansi";
import type { BuildCommandConfig, BuildRunView, DevServer, ResolvedBuildCommand, UserConfig } from "../src/types";

const temp = (name: string) => mkdtemp(join(tmpdir(), `docfold-${name}-`));

const writeConfig = (dir: string, config: UserConfig) =>
  Bun.write(join(dir, "docfold.config.ts"), `export default ${JSON.stringify(config)};`);

/** One validated command. */
const command = (config: Partial<BuildCommandConfig> & { run: BuildCommandConfig["run"] }, cwd = tmpdir()): ResolvedBuildCommand => {
  const resolved = resolveBuilds({ commands: [{ id: "cmd", ...config }] }, cwd);
  if (!resolved) throw new Error("no command");
  return resolved.commands[0]!;
};

/** The error message `resolveBuilds` throws for `commands`. */
const configError = (commands: unknown[]): string => {
  try {
    resolveBuilds({ commands } as never, "/project");
  } catch (err) {
    return (err as Error).message;
  }
  return "";
};

/** Lists a .zip's entries from its central directory, checking each one's data against its CRC. */
const readZip = (zip: Uint8Array) => {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.byteLength - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries: { name: string; mode: number; data: string }[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const mode = view.getUint32(at + 38, true) >>> 16;
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    const localStart = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const data = zip.subarray(localStart, localStart + size);
    expect(Bun.hash.crc32(data) >>> 0).toBe(crc);
    entries.push({ name, mode, data: new TextDecoder().decode(data) });
    at += 46 + nameLength + extra + comment;
  }
  return entries;
};

const waitFor = async (check: () => boolean | Promise<boolean>, timeout = 5000): Promise<void> => {
  const until = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > until) throw new Error("timed out");
    await Bun.sleep(20);
  }
};

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("builds config", () => {
  test("no builds key, or no commands, turns the section off", () => {
    expect(resolveBuilds(undefined, "/p")).toBe(false);
    expect(resolveBuilds({ commands: [] }, "/p")).toBe(false);
  });

  test("fills in defaults and resolves folders against the config file", () => {
    const builds = resolveBuilds(
      {
        cwd: "..",
        commands: [
          {
            id: "apk",
            label: "Android APK",
            group: "Android",
            run: ["fvm", "flutter", "build", "apk", "--{mode}", "{split}"],
            options: [
              { id: "mode", label: "Mode", type: "select", choices: ["debug", "profile", "release"], default: "release" },
              { id: "split", type: "boolean", flag: "--split-per-abi" },
              { id: "flavor", type: "text" },
            ],
            outputs: ["build/app/outputs/flutter-apk/*.apk"],
          },
          { id: "web", cwd: "../web", run: ["bun", "run", "build"], env: { NODE_ENV: "production" }, outputs: "dist" },
        ],
      },
      "/repo/docs",
    );
    if (!builds) throw new Error("expected builds");
    const [apk, web] = builds.commands;
    expect(apk).toMatchObject({ id: "apk", label: "Android APK", group: "Android", cwd: "/repo", env: {} });
    expect(apk!.options).toEqual([
      { id: "mode", label: "Mode", type: "select", choices: ["debug", "profile", "release"], default: "release", description: undefined },
      { id: "split", label: "split", type: "boolean", flag: "--split-per-abi", default: false, description: undefined },
      { id: "flavor", label: "flavor", type: "text", default: "", pattern: undefined, placeholder: undefined, description: undefined },
    ]);
    expect(web).toMatchObject({ label: "web", cwd: "/repo/web", env: { NODE_ENV: "production" }, outputs: ["dist"] });
  });

  test("a select's default is its first choice", () => {
    const cmd = command({ run: ["x", "{a}"], options: [{ id: "a", type: "select", choices: ["one", "two"] }] });
    expect(cmd.options[0]).toMatchObject({ default: "one" });
  });

  test("reports duplicate and unsafe ids, unknown placeholders and bad defaults, all at once", () => {
    const message = configError([
      { id: "apk", run: ["a"] },
      { id: "apk", run: ["b"] },
      { id: "My APK", run: ["c"] },
      { id: "../etc", run: ["d"] },
      { id: "web", run: ["bun", "--{mod}"], options: [{ id: "mode", type: "select", choices: ["a"] }] },
      { id: "sel", run: ["x"], options: [{ id: "mode", type: "select", choices: ["debug", "release"], default: "prod" }] },
      { id: "dup", run: ["x"], options: [{ id: "out-dir", type: "text" }, { id: "out_dir", type: "text" }] },
      { id: "re", run: ["x"], options: [{ id: "name", type: "text", pattern: "([a-z" }] },
      { id: "quote", run: "echo '{name}'", options: [{ id: "name", type: "text" }] },
      { id: "norun", run: [] },
    ]);
    expect(message).toStartWith("Invalid builds config:\n");
    for (const expected of [
      'builds.commands[1]: id "apk" is used by another command.',
      'builds.commands[2]: id "My APK" is used in the page address',
      'builds.commands[3]: id "../etc"',
      'builds.commands[4] ("web"): run uses {mod}, but its options are mode.',
      'builds.commands[5] ("sel").options[0] ("mode"): default "prod" is not one of its choices (debug, release).',
      'builds.commands[6] ("dup"): option id "out_dir" is used more than once.',
      'builds.commands[7] ("re").options[0] ("name"): pattern "([a-z" is not a valid regular expression.',
      'builds.commands[8] ("quote"): {name} is inside single quotes in run',
      'builds.commands[9] ("norun"): run must be a list of arguments',
    ]) {
      expect(message).toContain(expected);
    }
  });

  test("${VAR} in a shell command is a shell variable, not a placeholder", () => {
    expect(() => command({ run: 'echo "${HOME}" $PATH' })).not.toThrow();
    expect(configError([{ id: "x", run: "echo {nope}" }])).toContain("run uses {nope}, but it has no options.");
  });

  test("loadConfig validates builds and leaves them out when there are none", async () => {
    const dir = await temp("builds-config");
    try {
      await writeConfig(dir, { builds: { commands: [{ id: "web", run: ["bun", "run", "build"] }] } });
      const config = await loadConfig(dir);
      expect(config.builds && config.builds.commands.map((c) => [c.id, c.cwd])).toEqual([["web", dir]]);
      expect((await loadConfig(join(dir, "missing-folder"))).builds).toBe(false);

      // A separate file: Bun caches an imported config by path.
      await Bun.write(join(dir, "bad.config.ts"), `export default ${JSON.stringify({ builds: { commands: [{ id: "a", run: ["x"] }, { id: "a", run: ["y"] }] } })};`);
      await expect(loadConfig(join(dir, "bad.config.ts"))).rejects.toThrow('id "a" is used by another command');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("placeholder expansion", () => {
  const apk = command({
    run: ["fvm", "flutter", "build", "apk", "--{mode}", "{split}", "--flavor={flavor}", "{flavor}"],
    options: [
      { id: "mode", type: "select", choices: ["debug", "profile", "release"], default: "release" },
      { id: "split", type: "boolean", flag: "--split-per-abi" },
      { id: "flavor", type: "text" },
    ],
  });
  const expand = (values: Record<string, string | boolean>) => expandArgv(apk.run as string[], apk.options, values);

  test("select, boolean on and off, text, and dropped empty elements", () => {
    expect(expand({ mode: "release", split: false, flavor: "" })).toEqual(["fvm", "flutter", "build", "apk", "--release", "--flavor="]);
    expect(expand({ mode: "debug", split: true, flavor: "prod eu" })).toEqual([
      "fvm",
      "flutter",
      "build",
      "apk",
      "--debug",
      "--split-per-abi",
      "--flavor=prod eu",
      "prod eu",
    ]);
  });

  test("a boolean without a flag is \"true\" when on", () => {
    const cmd = command({ run: ["x", "{on}"], options: [{ id: "on", type: "boolean" }] });
    expect(expandArgv(cmd.run as string[], cmd.options, { on: true })).toEqual(["x", "true"]);
    expect(expandArgv(cmd.run as string[], cmd.options, { on: false })).toEqual(["x"]);
  });

  test("the preview quotes only what needs it", () => {
    expect(commandLine(apk, { mode: "release", split: true, flavor: "it's" })).toBe(
      "fvm flutter build apk --release --split-per-abi '--flavor=it'\\''s' 'it'\\''s'",
    );
  });

  test("form values are checked against the options", () => {
    const get = (values: Record<string, unknown>) => (id: string) => values[id];
    // A form leaves unticked checkboxes out; missing select and text values take their defaults.
    expect(parseValues(apk.options, get({}))).toEqual({ mode: "release", split: false, flavor: "" });
    expect(parseValues(apk.options, get({ mode: "debug", split: "on", flavor: "x" }))).toEqual({ mode: "debug", split: true, flavor: "x" });
    expect(() => parseValues(apk.options, get({ mode: "nightly" }))).toThrow('"nightly" is not one of debug, profile, release');
    expect(() => parseValues(apk.options, get({ flavor: "a\nb" }))).toThrow("single line");
    expect(() => parseValues(apk.options, get({ split: "maybe" }))).toThrow("expected on or off");
    const pattern = command({ run: ["x", "{v}"], options: [{ id: "v", type: "text", pattern: "[0-9]+" }] });
    expect(() => parseValues(pattern.options, get({ v: "12; rm -rf /" }))).toThrow("doesn't match the pattern [0-9]+");
    expect(parseValues(pattern.options, get({ v: "12" }))).toEqual({ v: "12" });
  });

  test("a shell command never contains the values: they come from the environment", async () => {
    const cmd = command({
      run: 'printf "<%s>" {name} "in {name} quotes" {empty} --{name}',
      options: [
        { id: "name", type: "text" },
        { id: "empty", type: "boolean", flag: "-x" },
      ],
    });
    const values = { name: 'a "b" $(echo pwned) `id`', empty: false };
    const argv = spawnArgs(cmd, values);
    expect(argv[2]).toBe(shellScript(cmd.run as string));
    expect(argv.join(" ")).not.toContain("pwned");
    const proc = Bun.spawnSync(argv, { env: { ...process.env, DOCFOLD_OPT_NAME: values.name, DOCFOLD_OPT_EMPTY: "" } });
    // The empty option leaves no argument behind, like a dropped argv element.
    expect(proc.stdout.toString()).toBe(`<${values.name}><in ${values.name} quotes><--${values.name}>`);
  });
});

describe("outputs", () => {
  let dir: string;
  const old = new Date("2020-01-01T00:00:00Z");

  beforeAll(async () => {
    dir = await temp("outputs");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const fresh = async (path: string, text = "x") => Bun.write(join(dir, path), text);
  const stale = async (path: string) => {
    await Bun.write(join(dir, path), "old");
    await utimes(join(dir, path), old, old);
  };

  test("nothing matched", async () => {
    const result = await resolveOutputs(["missing/*.apk", "nope.txt"], dir, Date.now());
    expect(result).toEqual({ outputs: [], stale: 0 });
    expect(outputsNote(result, ["missing/*.apk"])).toBe("No outputs: nothing matched missing/*.apk.");
    expect(outputsNote(result, [])).toBeUndefined();
  });

  test("one file, several files, a folder, and stale files left out", async () => {
    const started = Date.now();
    await fresh("one/app.apk", "APK");
    await fresh("many/a.apk");
    await fresh("many/b.apk");
    await stale("many/old.apk");
    await mkdir(join(dir, "web/dist/assets"), { recursive: true });
    await fresh("web/dist/assets/app.js");
    // A folder counts as new when anything inside changed, even if the folder itself didn't.
    await utimes(join(dir, "web/dist"), old, old);
    await stale("web/old-dist/index.html");
    await utimes(join(dir, "web/old-dist"), old, old);

    const one = await resolveOutputs(["one/*.apk"], dir, started);
    expect(one.outputs).toEqual([{ index: 0, name: "app.apk", relPath: "one/app.apk", kind: "file", size: 3, path: join(dir, "one/app.apk") }]);

    const many = await resolveOutputs(["many/*.apk"], dir, started);
    expect(many.outputs.map((o) => o.relPath)).toEqual(["many/a.apk", "many/b.apk"]);
    expect(many.stale).toBe(1);

    const folder = await resolveOutputs(["web/dist", "web/dist/assets/*.js", "web/old-dist"], dir, started);
    // The .js file is inside an output folder, so it isn't listed again.
    expect(folder.outputs.map((o) => [o.relPath, o.kind])).toEqual([["web/dist", "folder"]]);
    expect(folder.stale).toBe(1);

    // Paths outside the command's folder work too ("../").
    const up = await resolveOutputs(["../one/*.apk"], join(dir, "many"), started);
    expect(up.outputs.map((o) => o.relPath)).toEqual(["../one/app.apk"]);
  });

  test("only stale matches: says so instead of offering an empty download", async () => {
    await stale("only-old/app.apk");
    const result = await resolveOutputs(["only-old/*.apk"], dir, Date.now());
    expect(result).toEqual({ outputs: [], stale: 1 });
    expect(outputsNote(result, ["only-old/*.apk"])).toContain("probably from an older build");
  });
});

describe("zip", () => {
  test("streams files and folders with their modes, empty folders and symlinks", async () => {
    const dir = await temp("zip");
    try {
      await Bun.write(join(dir, "App.app/Contents/MacOS/App"), "#!/bin/sh\necho hi\n");
      await chmod(join(dir, "App.app/Contents/MacOS/App"), 0o755);
      await Bun.write(join(dir, "App.app/Contents/Info.plist"), "<plist/>");
      await mkdir(join(dir, "App.app/Contents/Empty"));
      await symlink("MacOS/App", join(dir, "App.app/Contents/Current"));
      await Bun.write(join(dir, "notes.txt"), "héllo");
      await Bun.write(join(dir, "other/notes.txt"), "second");

      const zip = new Uint8Array(
        await new Response(
          zipStream([
            { name: "App.app", path: join(dir, "App.app") },
            { name: "notes.txt", path: join(dir, "notes.txt") },
            { name: "notes.txt", path: join(dir, "other/notes.txt") },
          ]),
        ).arrayBuffer(),
      );
      const entries = readZip(zip);
      expect(entries.map((e) => e.name)).toEqual([
        "App.app/",
        "App.app/Contents/",
        "App.app/Contents/Current",
        "App.app/Contents/Empty/",
        "App.app/Contents/Info.plist",
        "App.app/Contents/MacOS/",
        "App.app/Contents/MacOS/App",
        "notes.txt",
        "notes (2).txt",
      ]);
      const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
      expect(byName["App.app/Contents/MacOS/App"]!.mode).toBe(0o100755);
      expect(byName["App.app/Contents/Current"]).toMatchObject({ mode: 0o120777, data: "MacOS/App" });
      expect(byName["App.app/Contents/Empty/"]!.mode & 0o170000).toBe(0o040000);
      expect(byName["notes.txt"]!.data).toBe("héllo");
      expect(byName["notes (2).txt"]!.data).toBe("second");

      // A real unzip tool agrees, when there is one.
      if (Bun.which("unzip")) {
        await Bun.write(join(dir, "out.zip"), zip);
        const check = Bun.spawnSync(["unzip", "-t", join(dir, "out.zip")]);
        expect(check.exitCode).toBe(0);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("ansi", () => {
  test("colours become classes, other escape codes disappear, text is escaped", () => {
    expect(ansiToHtml("\x1b[1;31mError:\x1b[0m <b>&\x1b[2K\x1b[?25l\x1b]8;;https://x.dev\x07link\x1b]8;;\x07")).toBe(
      '<span class="ansi-bold ansi-fg-1">Error:</span> &lt;b&gt;&amp;link',
    );
    expect(ansiToHtml("\x1b[38;5;208mo\x1b[38;2;1;2;3mr\x1b[39m")).toBe(
      '<span style="color:#ff8700">o</span><span style="color:#010203">r</span>',
    );
    expect(stripAnsi("\x1b[32m✓\x1b[0m done\r\n")).toBe("✓ done\n");
  });

  test("keeps colours and split escape codes across chunks", () => {
    const renderer = new AnsiRenderer();
    expect(renderer.push("a\x1b[3")).toBe("a");
    expect(renderer.push("2mgreen")).toBe('<span class="ansi-fg-2">green</span>');
    expect(renderer.push(" still\r")).toBe('<span class="ansi-fg-2"> still</span>');
    expect(renderer.push("\nnext\rover")).toBe('<span class="ansi-fg-2">\nnext\nover</span>');
  });
});

describe("runner", () => {
  const runner = (commands: BuildCommandConfig[], cwd: string, options: ConstructorParameters<typeof BuildRunner>[1] = {}) => {
    const builds = resolveBuilds({ commands }, cwd);
    if (!builds) throw new Error("no builds");
    return new BuildRunner(builds, { killDelay: 400, promptDelay: 150, ...options });
  };

  test("runs a command in its folder with its env and options, then finds its outputs", async () => {
    const dir = await temp("runner");
    const messages: string[] = [];
    const builds = runner(
      [
        {
          id: "app",
          cwd: "app",
          run: 'mkdir -p out && echo "$GREETING $DOCFOLD_OPT_MODE" && echo {mode} > out/app-{mode}.apk && echo oops >&2',
          env: { GREETING: "hello" },
          options: [{ id: "mode", type: "select", choices: ["debug", "release"] }],
          outputs: ["out/*.apk"],
        },
      ],
      dir,
      { publish: (_topic, message) => messages.push(message) },
    );
    try {
      await mkdir(join(dir, "app"));
      const run = await builds.start("app", (id) => (id === "mode" ? "release" : undefined));
      await expect(builds.start("app")).rejects.toMatchObject({ status: 409 });
      await run.done;
      expect(run.status).toBe("succeeded");
      expect(run.exitCode).toBe(0);
      expect(stripAnsi(run.log)).toContain("hello release\n");
      expect(run.log).toContain("oops\n");
      expect(run.view().outputs).toEqual([{ index: 0, name: "app-release.apk", relPath: "out/app-release.apk", kind: "file", size: 8 }]);
      // The browser hears the log and the final status; paths never leave the server.
      const parsed = messages.map((m) => JSON.parse(m) as { type: string; run: BuildRunView });
      expect(parsed.some((m) => m.type === "log")).toBe(true);
      expect(parsed.at(-1)).toMatchObject({ type: "status", run: { status: "succeeded" } });
      expect(messages.join("")).not.toContain(dir);
      await expect(builds.start("nope")).rejects.toMatchObject({ status: 404 });
      await expect(builds.start("app", () => "nightly")).rejects.toMatchObject({ status: 400 });
    } finally {
      await builds.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("failures: a non-zero exit, a missing program, a missing folder", async () => {
    const dir = await temp("runner-fail");
    const builds = runner(
      [
        { id: "exit", run: "echo bad >&2; exit 3", outputs: ["*"] },
        { id: "missing", run: ["definitely-not-a-program-docfold"] },
        { id: "nofolder", cwd: "gone", run: ["true"] },
      ],
      dir,
    );
    try {
      const exit = await builds.start("exit");
      await exit.done;
      expect(exit.view()).toMatchObject({ status: "failed", exitCode: 3, outputs: [] });
      expect(stripAnsi(exit.log)).toContain("exited with code 3");

      const missing = await builds.start("missing");
      await missing.done;
      expect(missing.view()).toMatchObject({ status: "failed" });
      expect(missing.error).toContain("definitely-not-a-program-docfold");

      const noFolder = await builds.start("nofolder");
      expect(noFolder.view()).toMatchObject({ status: "failed", error: expect.stringContaining("doesn't exist") });
    } finally {
      await builds.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("cancel stops the whole process group, SIGKILL for whatever ignores SIGTERM", async () => {
    const dir = await temp("runner-cancel");
    const builds = runner(
      [
        { id: "group", run: "sleep 30 & echo child=$!; wait" },
        { id: "stubborn", run: "trap '' TERM; sleep 30 & echo child=$!; wait; wait" },
      ],
      dir,
    );
    try {
      // Different commands run at the same time.
      const [group, stubborn] = await Promise.all([builds.start("group"), builds.start("stubborn")]);
      await waitFor(() => /child=\d+/.test(group.log) && /child=\d+/.test(stubborn.log));
      const groupChild = Number(/child=(\d+)/.exec(group.log)![1]);
      const stubbornChild = Number(/child=(\d+)/.exec(stubborn.log)![1]);

      expect(builds.cancel(group.id)).toBe(true);
      expect(builds.cancel(stubborn.id)).toBe(true);
      await group.done;
      expect(group.status).toBe("cancelled");
      await waitFor(() => !isAlive(groupChild), 2000);

      await stubborn.done; // only after SIGKILL (killDelay)
      expect(stubborn.status).toBe("cancelled");
      expect(stubborn.endedAt! - stubborn.startedAt).toBeGreaterThanOrEqual(300);
      await waitFor(() => !isAlive(stubbornChild), 2000);
      expect(builds.cancel(group.id)).toBe(false);
    } finally {
      await builds.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("keeps the last runs per command and trims long logs from the start", async () => {
    const dir = await temp("runner-history");
    const builds = runner([{ id: "noisy", run: "i=0; while [ $i -lt 400 ]; do i=$((i+1)); echo line $i; done" }], dir, {
      history: 2,
      maxLog: 1000,
    });
    try {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const run = await builds.start("noisy");
        ids.push(run.id);
        await run.done;
      }
      expect(builds.runs("noisy").map((run) => run.id)).toEqual([ids[2]!, ids[1]!]);
      expect(builds.run(ids[0]!)).toBeUndefined();
      const last = builds.run(ids[2]!)!;
      expect(last.logTrimmed).toBe(true);
      expect(last.log.length).toBeLessThanOrEqual(1000);
      expect(last.log).toStartWith("line "); // whole lines
      expect(last.log).toContain("line 400\n");
    } finally {
      await builds.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("notices a command that seems to wait for input", async () => {
    expect(looksLikePrompt("Building…\nContinue? [y/N] ")).toBe(true);
    expect(looksLikePrompt("Password: ")).toBe(true);
    expect(looksLikePrompt("Do you want to continue? (yes/no)\n")).toBe(true);
    // Flutter prints this and finishes the line much later; it isn't a question.
    expect(looksLikePrompt("Running Gradle task 'assembleRelease'...")).toBe(false);
    expect(looksLikePrompt("compiled 12 files\n")).toBe(false);

    const dir = await temp("runner-prompt");
    const builds = runner([{ id: "ask", run: "printf 'Overwrite? [y/N] '; sleep 30" }], dir);
    try {
      const run = await builds.start("ask");
      await waitFor(() => run.waitingForInput, 3000);
      builds.cancel(run.id);
      await run.done;
      expect(run.waitingForInput).toBe(false);
    } finally {
      await builds.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("stop() ends running builds", async () => {
    const dir = await temp("runner-stop");
    const builds = runner([{ id: "long", run: "sleep 30 & echo child=$!; wait" }], dir);
    try {
      const run = await builds.start("long");
      await waitFor(() => /child=\d+/.test(run.log));
      await builds.stop();
      expect(run.status).toBe("cancelled");
      await waitFor(() => !isAlive(Number(/child=(\d+)/.exec(run.log)![1])), 2000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("security checks", () => {
  test("loopback addresses and host names", () => {
    for (const address of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1", "[::1]"]) expect(isLoopbackAddress(address)).toBe(true);
    for (const address of ["192.168.1.2", "10.0.0.1", "::ffff:192.168.1.2", "0.0.0.0", "128.0.0.1"]) expect(isLoopbackAddress(address)).toBe(false);
    for (const host of ["localhost", "app.localhost", "127.0.0.1", "[::1]"]) expect(isLoopbackHost(host)).toBe(true);
    for (const host of ["evil.com", "localhost.evil.com", "192.168.1.2"]) expect(isLoopbackHost(host)).toBe(false);
  });
});

describe("dev server: builds", () => {
  let dir: string;
  let dev: DevServer;
  const revealed: string[] = [];
  const lanAddress = Object.values(networkInterfaces())
    .flat()
    .find((info) => info && info.family === "IPv4" && !info.internal)?.address;

  const get = (path: string, init?: RequestInit) => fetch(new URL(path, dev.server.url), { redirect: "manual", ...init });
  const origin = () => dev.server.url.origin;
  const post = (path: string, body?: Record<string, string>, headers: Record<string, string> = {}) =>
    get(path, {
      method: "POST",
      body: body ? new URLSearchParams(body) : undefined,
      headers: { Origin: origin(), Accept: "application/json", ...headers },
    });

  const finished = async (commandId: string, runId: string) => {
    let view: BuildRunView | undefined;
    await waitFor(async () => {
      view = ((await (await get(`/sub/builds/${commandId}/runs/${runId}`)).json()) as { run: BuildRunView }).run;
      return view.status !== "running";
    });
    return view!;
  };

  beforeAll(async () => {
    dir = await temp("dev-builds");
    await Bun.write(join(dir, "docs/intro.md"), "# Intro\n");
    await writeConfig(dir, {
      srcDir: "docs",
      base: "sub",
      builds: {
        cwd: "app",
        commands: [
          {
            id: "apk",
            label: "Android APK",
            group: "Android",
            run: "mkdir -p out && echo {mode} > out/app-{mode}.apk && printf '\\033[32mdone\\033[0m\\n'",
            options: [{ id: "mode", type: "select", choices: ["debug", "release"], default: "release" }],
            outputs: ["out/*.apk"],
          },
          { id: "web", run: "mkdir -p dist/a && echo hi > dist/index.html && echo js > dist/a/app.js", outputs: ["dist"] },
          { id: "slow", run: "echo started; sleep 30" },
        ],
      },
    });
    await mkdir(join(dir, "app"));
    dev = await createDevServer(await loadConfig(dir), {
      port: 0,
      builds: { platform: "darwin", reveal: async (path) => void revealed.push(path) },
    });
  });

  afterAll(async () => {
    await dev?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("this computer sees the Builds nav, its pages and assets", async () => {
    const docs = await (await get("/sub/docs/intro")).text();
    expect(docs).toContain(
      '<nav class="sections" aria-label="Sections"><a class="section-link" href="/sub/" aria-current="true">Docs</a><a class="section-link" href="/sub/builds">Builds</a></nav>',
    );
    expect(docs).toContain('href="/sub/assets/builds.css"');
    expect(docs).not.toContain("builds.js");

    const list = await get("/sub/builds");
    expect(list.status).toBe(200);
    expect(list.headers.get("x-frame-options")).toBe("DENY");
    const listHtml = await list.text();
    expect(listHtml).toContain('data-page="builds"');
    expect(listHtml).toContain('<a class="section-link" href="/sub/builds" aria-current="page">Builds</a>');
    expect(listHtml).toContain("<h2>Android</h2>");
    expect(listHtml).toContain("Not run yet");

    const page = await (await get("/sub/builds/apk")).text();
    expect(page).toContain('<select name="mode">');
    expect(page).toContain('<script type="module" src="/sub/assets/builds.js"></script>');
    expect((await get("/sub/assets/builds.js")).status).toBe(200);
    expect((await get("/sub/assets/builds.css")).status).toBe(200);
    expect((await get("/sub/builds/nope")).status).toBe(404);
  });

  test("runs a command and downloads one file, a .zip, and opens it in Finder (macOS)", async () => {
    const started = await post("/sub/builds/apk/runs", { mode: "debug" });
    expect(started.status).toBe(201);
    const { run } = (await started.json()) as { run: BuildRunView };
    expect(run.commandLine).toStartWith("mkdir -p out && echo debug");
    const done = await finished("apk", run.id);
    expect(done).toMatchObject({ status: "succeeded", outputs: [{ index: 0, name: "app-debug.apk", relPath: "out/app-debug.apk" }] });

    const page = await (await get(`/sub/builds/apk?run=${run.id}`)).text();
    expect(page).toContain('<span class="ansi-fg-2">done</span>');
    expect(page).toContain(">Open</button>");

    const file = await get(`/sub/builds/apk/runs/${run.id}/download`);
    expect(file.headers.get("content-disposition")).toBe("attachment; filename=\"app-debug.apk\"; filename*=UTF-8''app-debug.apk");
    expect(await file.text()).toBe("debug\n");
    expect((await get(`/sub/builds/apk/runs/${run.id}/outputs/0`)).status).toBe(200);
    expect((await get(`/sub/builds/apk/runs/${run.id}/outputs/1`)).status).toBe(404);
    expect((await get(`/sub/builds/apk/runs/${run.id}/outputs/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    // A run is only found under its own command.
    expect((await get(`/sub/builds/web/runs/${run.id}/download`)).status).toBe(404);

    expect((await post(`/sub/builds/apk/runs/${run.id}/outputs/0/open`)).status).toBe(204);
    expect(revealed).toEqual([join(dir, "app/out/app-debug.apk")]);

    const web = (await (await post("/sub/builds/web/runs")).json()) as { run: BuildRunView };
    await finished("web", web.run.id);
    const zip = await get(`/sub/builds/web/runs/${web.run.id}/download`);
    expect(zip.headers.get("content-type")).toBe("application/zip");
    expect(zip.headers.get("content-disposition")).toMatch(/^attachment; filename="web-\d{8}-\d{6}\.zip"/);
    expect(readZip(new Uint8Array(await zip.arrayBuffer())).map((e) => e.name)).toEqual([
      "dist/",
      "dist/a/",
      "dist/a/app.js",
      "dist/index.html",
    ]);
  });

  test("bad values, a second run at once, and cancel", async () => {
    const bad = await post("/sub/builds/apk/runs", { mode: "nightly" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain('"nightly" is not one of debug, release');

    const { run } = (await (await post("/sub/builds/slow/runs")).json()) as { run: BuildRunView };
    expect((await post("/sub/builds/slow/runs")).status).toBe(409);
    expect((await post(`/sub/builds/slow/runs/${run.id}/cancel`)).status).toBe(202);
    expect(await finished("slow", run.id)).toMatchObject({ status: "cancelled" });

    // Without JavaScript the form posts and lands back on the page.
    const form = await post("/sub/builds/apk/runs", { mode: "release" }, { Accept: "text/html" });
    expect(form.status).toBe(303);
    expect(form.headers.get("location")).toMatch(/^\/sub\/builds\/apk\?run=\w+$/);
  });

  test("the page's WebSocket gets a snapshot and live output; other origins get nothing", async () => {
    const socket = (originHeader: string) =>
      new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(new URL("/sub/__docfold/events", dev.server.url.href.replace(/^http/, "ws")), {
          headers: { Origin: originHeader },
        } as never);
        ws.addEventListener("open", () => resolve(ws), { once: true });
        ws.addEventListener("error", () => reject(new Error("no socket")), { once: true });
      });
    const messages = (ws: WebSocket) => {
      const list: { type: string; text?: string; run?: unknown; log?: string }[] = [];
      ws.addEventListener("message", (event) => list.push(JSON.parse(String(event.data))));
      return list;
    };

    const { run } = (await (await post("/sub/builds/slow/runs")).json()) as { run: BuildRunView };
    try {
      const own = await socket(origin());
      const ownMessages = messages(own);
      const evil = await socket("http://evil.example");
      const evilMessages = messages(evil);
      own.send(JSON.stringify({ type: "subscribe", run: run.id }));
      evil.send(JSON.stringify({ type: "subscribe", run: run.id }));
      await waitFor(() => ownMessages.some((m) => m.type === "snapshot" && (m.log ?? "").includes("started")));
      await post(`/sub/builds/slow/runs/${run.id}/cancel`);
      await waitFor(() => ownMessages.some((m) => m.type === "status" && (m.run as BuildRunView).status === "cancelled"));
      expect(ownMessages.some((m) => m.type === "log" && (m.text ?? "").includes("Cancelling"))).toBe(true);
      expect(evilMessages).toEqual([]);

      own.send(JSON.stringify({ type: "subscribe", run: "unknown" }));
      await waitFor(() => ownMessages.some((m) => m.type === "missing"));
      own.close();
      evil.close();
    } finally {
      await finished("slow", run.id);
    }
  });

  test("refuses cross-origin posts, rebound host names and other devices", async () => {
    // No Origin, or another site's: refused before anything runs.
    expect((await get("/sub/builds/apk/runs", { method: "POST" })).status).toBe(403);
    expect((await post("/sub/builds/apk/runs", {}, { Origin: "http://evil.example" })).status).toBe(403);
    expect((await post("/sub/builds/apk/runs", {}, { Origin: "null" })).status).toBe(403);
    // DNS rebinding: a loopback connection addressed to another name.
    const rebound = await get("/sub/builds", { headers: { Host: `evil.example:${dev.server.port}` } });
    expect(rebound.status).toBe(403);
    expect(dev.builds!.runs("apk").filter((run) => run.running)).toEqual([]);
  });

  test.skipIf(!lanAddress)("another device on the network sees docs but not builds", async () => {
    const remote = (path: string) => fetch(`http://${lanAddress}:${dev.server.port}${path}`, { redirect: "manual" });
    const docs = await remote("/sub/docs/intro");
    expect(docs.status).toBe(200);
    const html = await docs.text();
    expect(html).not.toContain("section-link");
    expect(html).not.toContain("builds.css");
    for (const path of ["/sub/builds", "/sub/builds/apk", "/sub/assets/builds.js", "/sub/assets/builds.css"]) {
      expect((await remote(path)).status).toBe(403);
    }
    const posted = await fetch(`http://${lanAddress}:${dev.server.port}/sub/builds/apk/runs`, {
      method: "POST",
      headers: { Origin: `http://${lanAddress}:${dev.server.port}` },
    });
    expect(posted.status).toBe(403);
  });
});

describe("without builds", () => {
  test("dev looks the same as before: no nav, no routes, no assets", async () => {
    const dir = await temp("no-builds");
    await Bun.write(join(dir, "intro.md"), "# Intro\n");
    const dev = await createDevServer(await loadConfig(dir), { port: 0 });
    const get = (path: string) => fetch(new URL(path, dev.server.url), { redirect: "manual" });
    try {
      const html = await (await get("/docs/intro")).text();
      expect(html).not.toContain("sections");
      expect(html).not.toContain("builds");
      expect(dev.builds).toBeUndefined();
      for (const path of ["/builds", "/builds/x", "/assets/builds.js", "/assets/builds.css"]) expect((await get(path)).status).toBe(404);
    } finally {
      await dev.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("docfold build leaves no trace of builds: pages, links, index entries or client code", async () => {
    const dir = await temp("build-no-trace");
    try {
      await Bun.write(join(dir, "docs/intro.md"), "# Intro\n");
      await writeConfig(dir, {
        srcDir: "docs",
        builds: { commands: [{ id: "apk", label: "Android APK", run: ["flutter", "build", "apk"], outputs: ["build/*.apk"] }] },
      });
      const config = await loadConfig(dir);
      expect(config.builds).not.toBe(false);
      await build(config);

      const files = (await readdir(config.outDir, { recursive: true })).map(String);
      expect(files.filter((file) => /build/i.test(file) && !file.startsWith(".docfold-build"))).toEqual([]);
      for (const file of files.filter((name) => /\.(html|js|css|json)$/.test(name))) {
        const content = await Bun.file(join(config.outDir, file)).text();
        expect(content).not.toContain("Android APK");
        expect(content).not.toContain("/builds");
        expect(content).not.toContain("section-link");
        expect(content).not.toContain("builds.css");
      }
      // The shared script has none of the Builds page's code.
      const app = await Bun.file(join(config.outDir, "assets/app.js")).text();
      for (const marker of ["build-data", "DOCFOLD_OPT", "subscribe", "run-log", "ansi-"]) expect(app).not.toContain(marker);
      const index = (await Bun.file(join(config.outDir, "search-index.json")).json()) as { title: string }[];
      expect(index.map((doc) => doc.title)).toEqual(["Intro"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

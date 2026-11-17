/**
 * The Builds section of `docfold dev`: the list of commands and one command's page (options form,
 * command preview, Run / Cancel, live log, outputs and recent runs).
 *
 * Browser-safe: the Builds client script re-renders the run's status, outputs and history with
 * the same functions.
 */

import { commandLine, defaultValues } from "../builds/expand";
import { formatBytes, formatDuration, formatTime } from "../builds/format";
import { ansiToHtml } from "../shared/ansi";
import { html, raw, type SafeHtml } from "../shared/html";
import { ICONS } from "../shared/icons";
import { layout } from "./layout";
import type { BuildCommandInfo, BuildOptionValues, BuildRunView, Library, ResolvedBuildOption, Site, Urls } from "../types";

/** A command with its newest run, for the list and the sidebar. */
export interface BuildListItem {
  command: BuildCommandInfo;
  last?: BuildRunView;
}

export interface BuildPageData {
  command: BuildCommandInfo;
  /** Every command, for the sidebar. */
  items: BuildListItem[];
  /** The run shown: the newest, or the one asked for with ?run=. */
  run?: BuildRunView;
  log: string;
  /** Newest first. */
  history: BuildRunView[];
  /** The folder the command runs in, as written for people (relative to the config when inside it). */
  cwdLabel: string;
  /** "Open" (show in Finder) is offered: macOS only. */
  canReveal: boolean;
}

/** What the page hands its script (JSON inside the page). */
export interface BuildClientData {
  command: BuildCommandInfo;
  run: BuildRunView | null;
  canReveal: boolean;
}

const STATUS_LABEL: Record<BuildRunView["status"], string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const runBadge = (run: BuildRunView): SafeHtml =>
  html`<span class="badge run-badge" data-run-status="${run.status}">${STATUS_LABEL[run.status]}</span>`;

/** "exit 0", "SIGTERM", or nothing while running. */
const exitLabel = (run: BuildRunView): string => {
  if (run.status === "running" || (run.exitCode === undefined && !run.signal)) return "";
  if (run.signal) return run.signal;
  return run.exitCode === null ? "" : `exit ${run.exitCode}`;
};

const elapsed = (run: BuildRunView, now: number): number => (run.endedAt ?? now) - run.startedAt;

/** The sentence beside the badge: how long it ran and how it ended. */
export const runSummary = (run: BuildRunView, now = Date.now()): string => {
  const took = formatDuration(elapsed(run, now));
  switch (run.status) {
    case "running":
      return `for ${took}`;
    case "succeeded":
      return `in ${took}`;
    case "cancelled":
      return `after ${took}`;
    case "failed":
      if (run.error) return run.error;
      return run.signal ? `stopped by ${run.signal} after ${took}` : `with exit code ${run.exitCode} after ${took}`;
  }
};

/** Badge, summary and start time; the client refreshes it every second while running. */
export const runStatus = (run: BuildRunView | undefined, now = Date.now()): SafeHtml =>
  run
    ? html`${runBadge(run)} <span class="run-summary" data-elapsed>${runSummary(run, now)}</span> <span class="run-started">· started <time datetime="${new Date(run.startedAt).toISOString()}">${formatTime(run.startedAt, now)}</time></span>`
    : html`<span class="run-summary">Not run yet. Pick the options and press Run.</span>`;

const outputUrl = (urls: Urls, run: BuildRunView, index: number) => urls.builds(run.command, "runs", run.id, "outputs", String(index));

/** What a finished run produced, with Download (and Open on macOS); a note when there's nothing. */
export const runOutputs = (run: BuildRunView | undefined, urls: Urls, canReveal: boolean): SafeHtml | "" => {
  if (!run || run.status !== "succeeded") return "";
  if (!run.outputs.length) return run.outputsNote ? html`<p class="run-note">${run.outputsNote}</p>` : "";

  const several = run.outputs.length > 1;
  return html`<div class="run-outputs">
    <div class="run-outputs-head">
      <h3>${several ? `${run.outputs.length} outputs` : "Output"}</h3>
      ${several ? html`<a class="button" href="${urls.builds(run.command, "runs", run.id, "download")}" download>Download all (.zip)</a>` : ""}
    </div>
    <ul class="output-list" role="list">${run.outputs.map(
      (output) => html`<li class="output" data-kind="${output.kind}">
        <span class="output-text">
          <span class="output-name">${output.name}${output.kind === "folder" ? "/" : ""}</span>
          <span class="output-meta">${output.relPath}${output.size !== undefined ? ` · ${formatBytes(output.size)}` : output.kind === "folder" ? " · folder, downloads as .zip" : ""}</span>
        </span>
        <span class="output-actions">
          <a class="button" href="${outputUrl(urls, run, output.index)}" download>Download</a>
          ${
            canReveal
              ? html`<form method="post" action="${outputUrl(urls, run, output.index)}/open" data-reveal>
                  <button class="button button-quiet" type="submit" title="Show in Finder" aria-label="${`Show ${output.name} in Finder`}">Open</button>
                </form>`
              : ""
          }
        </span>
      </li>`,
    )}</ul>
  </div>`;
};

/** Recent runs, newest first; each links to its log and outputs. */
export const runHistory = (runs: readonly BuildRunView[], urls: Urls, current?: string, now = Date.now()): SafeHtml => {
  if (!runs.length) return html`<p class="run-note">No runs yet. Runs are kept until <code>docfold dev</code> stops.</p>`;
  return html`<ol class="history-list" role="list">${runs.map((run) => {
    const meta = [exitLabel(run), run.status === "running" ? "" : formatDuration(elapsed(run, now))].filter(Boolean).join(" · ");
    return html`<li class="history-item"${run.id === current ? raw(' aria-current="true"') : ""}>
      <a class="history-link" href="${`${urls.builds(run.command)}?run=${encodeURIComponent(run.id)}`}">${runBadge(run)}<time datetime="${new Date(run.startedAt).toISOString()}">${formatTime(run.startedAt, now)}</time></a>
      ${meta ? html`<span class="history-meta">${meta}</span>` : ""}
      ${
        run.outputs.length
          ? html`<span class="history-outputs">${run.outputs.map(
              (output) => html`<a href="${outputUrl(urls, run, output.index)}" download>${output.name}</a>`,
            )}</span>`
          : ""
      }
    </li>`;
  })}</ol>`;
};

const optionField = (option: ResolvedBuildOption, value: string | boolean | undefined): SafeHtml => {
  const hint = option.description ? html`<span class="field-hint">${option.description}</span>` : "";
  switch (option.type) {
    case "select":
      return html`<label class="field">
        <span class="field-label">${option.label}</span>
        <select name="${option.id}">${option.choices.map(
          (choice) => html`<option value="${choice}"${choice === value ? raw(" selected") : ""}>${choice}</option>`,
        )}</select>
        ${hint}
      </label>`;
    case "boolean":
      return html`<label class="field field-check">
        <input type="checkbox" name="${option.id}" value="on"${value === true ? raw(" checked") : ""}>
        <span class="field-label">${option.label}${option.flag ? html` <code>${option.flag}</code>` : ""}</span>
        ${hint}
      </label>`;
    case "text":
      return html`<label class="field">
        <span class="field-label">${option.label}</span>
        <input type="text" name="${option.id}" value="${typeof value === "string" ? value : option.default}"${option.pattern ? html` pattern="${option.pattern}"` : ""}${option.placeholder ? html` placeholder="${option.placeholder}"` : ""} autocomplete="off" spellcheck="false">
        ${hint}
      </label>`;
  }
};

/** The commands, grouped, with a status dot for each one's newest run. */
export const buildsSidebar = (items: readonly BuildListItem[], urls: Urls, active?: string): SafeHtml => {
  const entry = ({ command, last }: BuildListItem) =>
    html`<li class="tree-file build-nav-item"${last ? html` data-run-status="${last.status}"` : ""}><a href="${urls.builds(command.id)}"${command.id === active ? raw(' aria-current="page"') : ""}><span class="tree-label">${command.label}</span></a></li>`;
  const { loose, groups } = grouped(items);
  return html`<aside class="sidebar" id="sidebar" aria-label="Builds">
    <nav class="sidebar-tree">
      <a class="sidebar-home" href="${urls.builds()}"${active === undefined ? raw(' aria-current="page"') : ""}>All builds <span class="tree-count">${items.length}</span></a>
      <ul class="tree" role="list">
        ${loose.map(entry)}
        ${[...groups].map(
          ([group, members]) => html`<li class="tree-folder" data-path="${`builds:${group}`}" data-search="${group.toLowerCase()}"${members.some((item) => item.command.id === active) ? raw(" data-current") : ""}>
            <details open>
              <summary title="${group}">${ICONS.folder}<span class="tree-label">${group}</span><span class="tree-count">${members.length}</span></summary>
              <ul class="tree" role="list">${members.map(entry)}</ul>
            </details>
          </li>`,
        )}
      </ul>
    </nav>
  </aside>`;
};

/** Commands without a group first, then each group in the order it first appears. */
const grouped = (items: readonly BuildListItem[]) => {
  const loose: BuildListItem[] = [];
  const groups = new Map<string, BuildListItem[]>();
  for (const item of items) {
    if (!item.command.group) loose.push(item);
    else groups.set(item.command.group, [...(groups.get(item.command.group) ?? []), item]);
  }
  return { loose, groups };
};

const buildCard = ({ command, last }: BuildListItem, urls: Urls, now: number): SafeHtml => html`<li class="build-card">
  <div class="build-card-head">
    <h3 class="build-card-title"><a href="${urls.builds(command.id)}">${command.label}</a></h3>
    ${last ? runBadge(last) : ""}
  </div>
  ${command.description ? html`<p class="build-card-description">${command.description}</p>` : ""}
  <code class="build-card-command">${commandLine(command, defaultValues(command.options))}</code>
  <p class="build-card-last">${
    last
      ? html`Last run <time datetime="${new Date(last.startedAt).toISOString()}">${formatTime(last.startedAt, now)}</time> · ${last.status === "running" ? "still running" : formatDuration(elapsed(last, now))}`
      : "Not run yet"
  }</p>
</li>`;

/** /builds: every command, grouped. */
export const buildsListPage = (site: Site, library: Library, items: readonly BuildListItem[], configName: string): string => {
  const now = Date.now();
  const { loose, groups } = grouped(items);
  const list = (members: readonly BuildListItem[]) =>
    html`<ul class="build-cards" role="list">${members.map((item) => buildCard(item, site.urls, now))}</ul>`;
  const content = html`<div class="page builds">
    <header class="page-header">
      <h1>Builds</h1>
      <p>Commands from <code>${configName}</code>. They run on this computer while <code>docfold dev</code> is running, and are never part of <code>docfold build</code>.</p>
    </header>
    ${loose.length ? list(loose) : ""}
    ${[...groups].map(([group, members]) => html`<section class="build-group"><h2>${group}</h2>${list(members)}</section>`)}
  </div>`;
  return layout({
    site,
    library,
    title: "Builds",
    content,
    page: "builds",
    sidebar: buildsSidebar(items, site.urls),
  });
};

/** JSON for a <script type="application/json">: "<" is escaped so it can't close the tag. */
const jsonScript = (value: unknown): SafeHtml => raw(JSON.stringify(value).replace(/</g, "\\u003c"));

/** /builds/<id>: options, preview, Run / Cancel, the log, outputs and recent runs. */
export const buildPage = (site: Site, library: Library, data: BuildPageData): string => {
  const { urls } = site;
  const { command, run, history, canReveal } = data;
  const now = Date.now();
  const running = history[0]?.status === "running";
  // The form starts from the run on screen, so "run it again" is one click.
  const values: BuildOptionValues = { ...defaultValues(command.options), ...run?.values };
  const client: BuildClientData = { command, run: run ?? null, canReveal };

  const content = html`<div class="page build" id="build" data-command="${command.id}">
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <a href="${urls.builds()}">Builds</a>${command.group ? html`<span aria-hidden="true">/</span><span>${command.group}</span>` : ""}<span aria-hidden="true">/</span><span>${command.label}</span>
    </nav>
    <header class="page-header">
      <h1>${command.label}</h1>
      ${command.description ? html`<p>${command.description}</p>` : ""}
    </header>

    <form class="build-form" id="build-form" method="post" action="${urls.builds(command.id, "runs")}">
      ${command.options.length ? html`<fieldset class="build-options"><legend class="sr-only">Options</legend>${command.options.map((option) => optionField(option, values[option.id]))}</fieldset>` : ""}
      <div class="build-preview">
        <span class="build-preview-label">Runs in <code>${data.cwdLabel}</code></span>
        <pre class="build-command"><code id="build-preview">${commandLine(command, values)}</code></pre>
      </div>
      <div class="build-actions">
        <button class="button" type="submit" id="build-start"${running ? raw(" disabled") : ""}>Run</button>
        <button class="button button-quiet" type="submit" form="build-cancel" id="build-cancel-button"${running ? "" : raw(" hidden")}>Cancel</button>
        <p class="build-error" id="build-error" role="alert" hidden></p>
      </div>
    </form>
    <form id="build-cancel" method="post" action="${running ? urls.builds(command.id, "runs", history[0]!.id, "cancel") : ""}" hidden></form>

    <section class="run" id="run" aria-label="Output"${run ? html` data-run="${run.id}" data-status="${run.status}"` : ""}>
      <div class="run-status" id="run-status" role="status">${runStatus(run, now)}</div>
      <p class="run-notice" id="run-waiting"${run?.waitingForInput ? "" : raw(" hidden")}>
        <strong>This command seems to be waiting for input.</strong> Builds can't answer prompts: their input is closed. Cancel it, and make the command non-interactive (often a <code>--yes</code> or <code>--no-input</code> flag).
      </p>
      <p class="run-note" id="run-trimmed"${run?.logTrimmed ? "" : raw(" hidden")}>The start of this log was dropped to keep it small.</p>
      <pre class="run-log" id="run-log" tabindex="0" aria-label="Log"${run ? "" : raw(" hidden")}>${raw(ansiToHtml(data.log))}</pre>
      <div id="run-outputs">${runOutputs(run, urls, canReveal)}</div>
    </section>

    <section class="run-history" aria-labelledby="history-title">
      <h2 id="history-title">Recent runs</h2>
      <div id="run-history">${runHistory(history, urls, run?.id, now)}</div>
    </section>
    <script type="application/json" id="build-data">${jsonScript(client)}</script>
  </div>`;

  return layout({
    site,
    library,
    title: command.label,
    content,
    page: "builds",
    activeSlug: command.id,
    description: command.description,
    sidebar: buildsSidebar(data.items, urls, command.id),
    script: urls.asset("builds.js"),
  });
};

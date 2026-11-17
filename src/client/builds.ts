// Browser script for a Builds page (`docfold dev` only; never part of a build). The page works
// without it (plain form posts, refresh to see more output); this adds the live command preview,
// Run and Cancel without leaving the page, and the live log over the dev server's WebSocket.

import { commandLine } from "../builds/expand";
import { runHistory, runOutputs, runStatus, runSummary, type BuildClientData } from "../pages/builds";
import { AnsiRenderer } from "../shared/ansi";
import type { SafeHtml } from "../shared/html";
import { createUrls } from "../shared/urls";
import type { BuildOptionValues, BuildRunView, BuildSocketMessage } from "../types";

const root = document.documentElement;
const urls = createUrls(root.dataset.base ?? "/", { home: "home" in root.dataset });
const dataElement = document.getElementById("build-data");

/** Same cap as the server's log; the start is dropped beyond it. */
const MAX_LOG = 2_000_000;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const markup = (value: SafeHtml | ""): string => (value === "" ? "" : value.value);

if (dataElement?.textContent) {
  const { command, canReveal, run: initial } = JSON.parse(dataElement.textContent) as BuildClientData;

  const form = $<HTMLFormElement>("build-form");
  const preview = $<HTMLElement>("build-preview");
  const start = $<HTMLButtonElement>("build-start");
  const cancelButton = $<HTMLButtonElement>("build-cancel-button");
  const cancelForm = $<HTMLFormElement>("build-cancel");
  const errorBox = $<HTMLElement>("build-error");
  const section = $<HTMLElement>("run");
  const statusBox = $<HTMLElement>("run-status");
  const waiting = $<HTMLElement>("run-waiting");
  const trimmed = $<HTMLElement>("run-trimmed");
  const log = $<HTMLPreElement>("run-log");
  const outputs = $<HTMLElement>("run-outputs");
  const historyBox = $<HTMLElement>("run-history");

  let current: BuildRunView | null = initial;
  let rawLog = "";
  let renderer = new AnsiRenderer();

  // -------------------------------------------------------------------------
  // Options → command preview. The form's state is kept for this tab, so a
  // reload (live reload fires when a doc is saved) doesn't lose half-made choices.
  // -------------------------------------------------------------------------

  const formKey = `docfold:build-form:${urls.base}${command.id}`;

  const formValues = (): BuildOptionValues => {
    const data = new FormData(form);
    const values: BuildOptionValues = {};
    for (const option of command.options) {
      values[option.id] = option.type === "boolean" ? data.has(option.id) : String(data.get(option.id) ?? "");
    }
    return values;
  };

  const updatePreview = (): void => {
    preview.textContent = commandLine(command, formValues());
  };

  const saveForm = (): void => {
    try {
      sessionStorage.setItem(formKey, JSON.stringify(formValues()));
    } catch {
      // storage unavailable
    }
  };

  const restoreForm = (): void => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation?.type !== "reload") return;
    let saved: BuildOptionValues;
    try {
      saved = JSON.parse(sessionStorage.getItem(formKey) ?? "null") as BuildOptionValues;
    } catch {
      return;
    }
    if (!saved) return;
    for (const option of command.options) {
      const field = form.elements.namedItem(option.id);
      const value = saved[option.id];
      if (field instanceof HTMLInputElement && field.type === "checkbox") field.checked = value === true;
      else if (field instanceof HTMLSelectElement && typeof value === "string" && option.type === "select" && option.choices.includes(value)) field.value = value;
      else if (field instanceof HTMLInputElement && typeof value === "string") field.value = value;
    }
  };

  form.addEventListener("input", () => {
    updatePreview();
    saveForm();
  });
  restoreForm();
  updatePreview();

  // -------------------------------------------------------------------------
  // Showing a run
  // -------------------------------------------------------------------------

  const showError = (message: string): void => {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  };

  const atBottom = (): boolean => log.scrollTop + log.clientHeight >= log.scrollHeight - 24;

  const setLog = (text: string): void => {
    rawLog = text;
    renderer = new AnsiRenderer();
    log.innerHTML = renderer.push(text);
    log.scrollTop = log.scrollHeight;
  };

  const appendLog = (text: string): void => {
    rawLog += text;
    if (rawLog.length > MAX_LOG * 1.2) {
      const cut = rawLog.length - MAX_LOG;
      const newline = rawLog.indexOf("\n", cut);
      setLog(rawLog.slice(newline === -1 ? cut : newline + 1));
      trimmed.hidden = false;
      return;
    }
    const follow = atBottom();
    log.insertAdjacentHTML("beforeend", renderer.push(text));
    if (follow) log.scrollTop = log.scrollHeight;
  };

  let ticker: ReturnType<typeof setInterval> | undefined;

  const show = (run: BuildRunView, history?: BuildRunView[]): void => {
    current = run;
    const running = run.status === "running";
    section.dataset.run = run.id;
    section.dataset.status = run.status;
    statusBox.innerHTML = runStatus(run).value;
    waiting.hidden = !run.waitingForInput;
    trimmed.hidden = !run.logTrimmed;
    log.hidden = false;
    outputs.innerHTML = markup(runOutputs(run, urls, canReveal));
    if (history) historyBox.innerHTML = runHistory(history, urls, run.id).value;

    start.disabled = running;
    cancelButton.hidden = !running;
    cancelButton.disabled = false;
    cancelForm.action = urls.builds(command.id, "runs", run.id, "cancel");

    clearInterval(ticker);
    if (running) {
      ticker = setInterval(() => {
        const elapsed = statusBox.querySelector("[data-elapsed]");
        if (current && elapsed) elapsed.textContent = runSummary(current);
      }, 1000);
    }
  };

  // -------------------------------------------------------------------------
  // Following a run's log over the dev server's WebSocket
  // -------------------------------------------------------------------------

  const address = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${urls.events}`;
  let socket: WebSocket | undefined;
  let following: string | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const subscribe = (): void => {
    if (following && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "subscribe", run: following }));
  };

  const onMessage = (event: MessageEvent): void => {
    let message: BuildSocketMessage;
    try {
      message = JSON.parse(String(event.data)) as BuildSocketMessage;
    } catch {
      return; // "reload" is for app.js
    }
    switch (message.type) {
      case "snapshot":
        if (message.run.id !== following) return;
        setLog(message.log);
        show(message.run, message.history);
        break;
      case "log":
        if (message.run === following) appendLog(message.text);
        break;
      case "status":
        if (message.run.id === following) show(message.run, message.history);
        break;
      case "missing":
        if (message.run !== following) return;
        following = undefined;
        clearInterval(ticker);
        statusBox.innerHTML = '<span class="run-summary">This run is gone: <code>docfold dev</code> was restarted. Its log and outputs are no longer available.</span>';
        start.disabled = false;
        cancelButton.hidden = true;
        break;
    }
  };

  const connect = (): void => {
    clearTimeout(retry);
    const next = new WebSocket(address);
    socket = next;
    next.addEventListener("open", subscribe);
    next.addEventListener("message", onMessage);
    // The dev server restarted or was briefly unreachable: try again while the run may still be going.
    next.addEventListener("close", () => {
      if (socket === next && following && current?.status === "running") retry = setTimeout(connect, 2000);
    });
  };

  const follow = (runId: string): void => {
    following = runId;
    if (socket && socket.readyState <= WebSocket.OPEN) subscribe();
    else connect();
  };

  window.addEventListener("pagehide", () => {
    clearTimeout(retry);
    following = undefined;
    socket?.close();
  });

  // -------------------------------------------------------------------------
  // Run, Cancel and Open, without leaving the page
  // -------------------------------------------------------------------------

  const post = async (url: string, body?: URLSearchParams): Promise<Record<string, unknown>> => {
    const response = await fetch(url, { method: "POST", body, headers: { Accept: "application/json" } });
    const data = (response.status === 204 ? {} : await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `The dev server answered ${response.status}.`);
    return data;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    showError("");
    start.disabled = true;
    try {
      const { run, history } = (await post(form.action, new URLSearchParams(new FormData(form) as unknown as Record<string, string>))) as {
        run: BuildRunView;
        history: BuildRunView[];
      };
      if (location.search) window.history.replaceState(null, "", urls.builds(command.id));
      setLog("");
      show(run, history);
      follow(run.id);
    } catch (err) {
      showError((err as Error).message);
      start.disabled = current?.status === "running";
    }
  });

  cancelForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    cancelButton.disabled = true;
    try {
      await post(cancelForm.action);
    } catch (err) {
      showError((err as Error).message);
      cancelButton.disabled = false;
    }
  });

  outputs.addEventListener("submit", async (event) => {
    const target = event.target as HTMLFormElement;
    if (!target.matches("form[data-reveal]")) return;
    event.preventDefault();
    try {
      showError("");
      await post(target.action);
    } catch (err) {
      showError((err as Error).message);
    }
  });

  // -------------------------------------------------------------------------
  // On load: pick a running build back up (also after a reload mid-build)
  // -------------------------------------------------------------------------

  rawLog = log.textContent ?? "";
  log.scrollTop = log.scrollHeight;
  if (current?.status === "running") {
    show(current);
    follow(current.id);
  }
}

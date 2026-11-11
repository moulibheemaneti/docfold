// Browser script, bundled by `bundleClient()`. Pages work without it (plain
// links and GET forms); it adds live search, the sidebar filter, remembered
// folders, the mobile menu, the "/" shortcut and (in dev, with `watch` on) live reload.

import { resultsFragment, searchPanel } from "../pages/list";
import { countFacets, parseSearchParams, SEARCH_KEYS, searchDocs } from "../search";
import { escapeHtml } from "../shared/html";
import { createUrls } from "../shared/urls";
import type { IndexedDoc } from "../types";

const root = document.documentElement;
const urls = createUrls(root.dataset.base ?? "/", { home: "home" in root.dataset });
const mode = root.dataset.mode;

// Old links like "/?tag=ios" point at the root; with a home page the documents list lives at "docs".
const pageQuery = new URLSearchParams(location.search);
if (root.dataset.page === "home" && SEARCH_KEYS.some((key) => pageQuery.has(key))) {
  location.replace(urls.search(pageQuery.toString()));
}

// ---------------------------------------------------------------------------
// Mobile sidebar
// ---------------------------------------------------------------------------

const navToggle = document.querySelector<HTMLButtonElement>(".nav-toggle");

const setNavOpen = (open: boolean): void => {
  root.classList.toggle("nav-open", open);
  navToggle?.setAttribute("aria-expanded", String(open));
  navToggle?.setAttribute("aria-label", open ? "Hide files" : "Show files");
};

navToggle?.addEventListener("click", () => setNavOpen(!root.classList.contains("nav-open")));
document.querySelector("[data-nav-close]")?.addEventListener("click", () => setNavOpen(false));

// Keep the current file in view inside the sidebar's own scroll area.
const sidebarTree = document.querySelector<HTMLElement>(".sidebar-tree");
const currentFile = sidebarTree?.querySelector<HTMLElement>('.tree-file a[aria-current="page"]');
if (sidebarTree && currentFile) {
  const top = currentFile.getBoundingClientRect().top - sidebarTree.getBoundingClientRect().top;
  if (top > sidebarTree.clientHeight - 40) sidebarTree.scrollTop = top - sidebarTree.clientHeight / 2;
}

// ---------------------------------------------------------------------------
// Sidebar folders: all start open; ones the reader collapses stay collapsed
// across pages (except the folder holding the current file).
// ---------------------------------------------------------------------------

const navFilter = document.querySelector<HTMLInputElement>("#nav-filter");
const navEmpty = document.querySelector<HTMLElement>("#nav-empty");
const treeFiles = [...document.querySelectorAll<HTMLElement>(".sidebar .tree-file")];
// Deepest folders first, so a parent can look at its already-filtered children.
const treeFolders = [...document.querySelectorAll<HTMLElement>(".sidebar .tree-folder")].reverse();
const detailsOf = (folder: HTMLElement) => folder.querySelector<HTMLDetailsElement>(":scope > details")!;

const COLLAPSED_KEY = `docfold:collapsed:${urls.base}`;
const collapsed = new Set<string>();
try {
  for (const path of JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]") as string[]) collapsed.add(path);
} catch {
  // storage unavailable or corrupt: start with everything open
}

for (const folder of treeFolders) {
  const details = detailsOf(folder);
  const path = folder.dataset.path ?? "";
  if (collapsed.has(path) && !("current" in folder.dataset)) details.open = false;

  details.addEventListener("toggle", () => {
    if (navFilter?.value.trim()) return; // opened/closed by the filter, not by the reader
    if (details.open) collapsed.delete(path);
    else collapsed.add(path);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
    } catch {
      // ignore
    }
  });
}

// ---------------------------------------------------------------------------
// Sidebar filter: hides files/folders that don't match, opens folders that do
// ---------------------------------------------------------------------------

const filterSidebar = (rawQuery: string): void => {
  const query = rawQuery.trim().toLowerCase();

  if (!query) {
    for (const item of [...treeFiles, ...treeFolders]) item.hidden = false;
    for (const folder of treeFolders) {
      const details = detailsOf(folder);
      if (details.dataset.open !== undefined) {
        details.open = details.dataset.open === "true";
        delete details.dataset.open;
      }
    }
    if (navEmpty) navEmpty.hidden = true;
    return;
  }

  for (const folder of treeFolders) {
    const details = detailsOf(folder);
    if (details.dataset.open === undefined) details.dataset.open = String(details.open);
  }

  for (const file of treeFiles) file.hidden = !(file.dataset.search ?? "").includes(query);

  let anyVisible = treeFiles.some((file) => !file.hidden);
  for (const folder of treeFolders) {
    const nameMatches = (folder.dataset.search ?? "").includes(query);
    // A matching folder shows everything inside it.
    if (nameMatches) for (const child of folder.querySelectorAll<HTMLElement>(".tree-file, .tree-folder")) child.hidden = false;
    const visible = nameMatches || !!folder.querySelector(".tree-file:not([hidden])");
    folder.hidden = !visible;
    detailsOf(folder).open = visible;
    anyVisible ||= visible;
  }

  if (navEmpty) navEmpty.hidden = anyVisible;
};

navFilter?.addEventListener("input", () => filterSidebar(navFilter.value));
navFilter?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const first = treeFiles.find((file) => !file.hidden)?.querySelector("a");
  if (first) location.href = first.href;
});

// ---------------------------------------------------------------------------
// Search + filters on the home page (runs in the browser from search-index.json)
// ---------------------------------------------------------------------------

const searchRoot = document.querySelector<HTMLElement>("#search-root");

if (searchRoot) {
  let index: Promise<IndexedDoc[]> | undefined;
  const loadIndex = (): Promise<IndexedDoc[]> =>
    (index ??= fetch(urls.searchIndex).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<IndexedDoc[]>;
    }));

  const formQuery = (form: HTMLFormElement): URLSearchParams => {
    const query = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      if (typeof value !== "string" || !value.trim()) continue;
      if ((key === "match" && value === "all") || (key === "sort" && value === "relevance")) continue;
      query.append(key, value.trim());
    }
    return query;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest = 0;

  const refresh = async (): Promise<void> => {
    const form = searchRoot!.querySelector<HTMLFormElement>("#search-form");
    const results = searchRoot!.querySelector<HTMLElement>("#results");
    if (!form || !results) return;

    const query = formQuery(form);
    history.replaceState(null, "", urls.search(query.toString()));

    const ticket = ++latest;
    results.setAttribute("aria-busy", "true");
    try {
      const docs = await loadIndex();
      if (ticket !== latest) return; // a newer keystroke already rendered
      results.innerHTML = resultsFragment(searchDocs(docs, parseSearchParams(query)), urls).value;
    } catch (error) {
      results.innerHTML = `<p class="results-summary">Search is unavailable: ${escapeHtml(String(error))}</p>`;
    } finally {
      results.removeAttribute("aria-busy");
    }
  };

  searchRoot.addEventListener("input", (event) => {
    clearTimeout(timer);
    const delay = (event.target as HTMLInputElement).type === "search" ? 150 : 0;
    timer = setTimeout(refresh, delay);
  });

  searchRoot.addEventListener("submit", (event) => {
    event.preventDefault();
    clearTimeout(timer);
    void refresh();
  });

  // Clicking a tag on a result toggles the matching tag filter instead of reloading.
  searchRoot.addEventListener("click", (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>("#results a[data-tag]");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const checkbox = [...searchRoot.querySelectorAll<HTMLInputElement>('input[name="tag"]')].find(
      (input) => input.value === link.dataset.tag,
    );
    if (!checkbox) return;
    event.preventDefault();
    checkbox.checked = !checkbox.checked;
    void refresh();
  });

  // Static pages are pre-rendered without filters: apply the ones in the URL (e.g. links to ?tag=ios).
  if (mode === "static" && location.search) {
    const params = parseSearchParams(new URLSearchParams(location.search));
    loadIndex()
      .then((docs) => {
        searchRoot.innerHTML = searchPanel(countFacets(docs), searchDocs(docs, params), urls).value;
      })
      .catch(() => {
        // keep the unfiltered list
      });
  }
}

// ---------------------------------------------------------------------------
// Keyboard: "/" focuses search, Escape closes the mobile menu
// ---------------------------------------------------------------------------

document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  const typing = target.closest?.("input, textarea, select, [contenteditable]");

  if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
    const search = document.querySelector<HTMLInputElement>("[data-shortcut]") ?? navFilter;
    if (search) {
      event.preventDefault();
      search.focus();
      search.select();
    }
  }

  if (event.key === "Escape") {
    setNavOpen(false);
    if (typing && target instanceof HTMLInputElement && target.type === "search" && !target.value) target.blur();
  }
});

// ---------------------------------------------------------------------------
// Dev server with `watch` on: reload when a file changes.
// A WebSocket, not EventSource: browsers allow 6 HTTP connections per host and an
// event stream holds one for as long as the page is open, so a few open tabs made
// every new page load forever. WebSockets don't count toward that limit.
// ---------------------------------------------------------------------------

if ("liveReload" in root.dataset && "WebSocket" in window) {
  const address = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${urls.base}__docfold/events`;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const connect = (): void => {
    const current = new WebSocket(address);
    socket = current;
    current.addEventListener("message", (event) => {
      if (event.data === "reload") location.reload();
    });
    // Dev server restarted or briefly unreachable: keep trying, quietly.
    current.addEventListener("close", () => {
      if (socket === current) retry = setTimeout(connect, 2000);
    });
  };

  // Release the connection as soon as the page is left; reconnect if it comes back from the back/forward cache.
  window.addEventListener("pagehide", () => {
    clearTimeout(retry);
    const leaving = socket;
    socket = undefined;
    leaving?.close();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted || !socket) connect();
  });
}

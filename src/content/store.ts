/**
 * Caches the parsed library, re-reads it after a change and tells listeners (live reload).
 */

import { type FSWatcher, watch } from "node:fs";
import { resolve } from "node:path";
import { DEFAULTS } from "../shared/constants";
import { errorMessage, warn } from "../shared/log";
import { isInside } from "../shared/paths";
import { isSkippedName, loadLibrary } from "./library";
import type { Library, StoreOptions } from "../types";

/** Caches the parsed library, re-reads it after any change, and tells listeners (live reload). */
export class ContentStore {
  #library: Promise<Library> | undefined;
  #watcher: FSWatcher | undefined;
  #listeners = new Set<() => void>();
  #debounce: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly root: string,
    readonly options: StoreOptions = {},
  ) {}

  /** The parsed library; read on first use and again after `invalidate()`. */
  library(): Promise<Library> {
    if (!this.#library) {
      const loading: Promise<Library> = loadLibrary(this.root, this.options).catch((err: unknown) => {
        // Retry on next use, unless a newer load already replaced this one.
        if (this.#library === loading) this.#library = undefined;
        throw err;
      });
      this.#library = loading;
    }
    return this.#library;
  }

  /** Drops the cached library (re-read on next use) and tells listeners. */
  invalidate(): void {
    this.#library = undefined;
    this.notify();
  }

  /** Tells listeners something changed (e.g. a file outside the docs folder), without re-reading the docs. */
  notify(): void {
    clearTimeout(this.#debounce);
    // Editors fire several events per save; tell listeners once.
    this.#debounce = setTimeout(() => {
      for (const listener of this.#listeners) listener();
    }, this.options.debounce ?? DEFAULTS.debounce);
  }

  /** Calls `listener` after the docs folder changes (or `notify()` is called). Returns an unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Watches the docs folder so added, edited, moved or deleted files show up on the next request. */
  watch(): this {
    if (this.#watcher) return this;
    const ignored = (this.options.ignore ?? []).map((dir) => resolve(dir));
    try {
      this.#watcher = watch(this.root, { recursive: true }, (_event, filename) => {
        if (filename) {
          const name = String(filename);
          if (name.split(/[\\/]/).some(isSkippedName)) return;
          const full = resolve(this.root, name);
          if (ignored.some((dir) => isInside(full, dir))) return;
        }
        this.invalidate();
      });
    } catch (err) {
      warn(`Not watching ${this.root} for changes: ${errorMessage(err)}`);
    }
    return this;
  }

  /** Stops watching and drops every listener and pending notification. */
  close(): void {
    this.#watcher?.close();
    this.#watcher = undefined;
    clearTimeout(this.#debounce);
    this.#listeners.clear();
  }
}

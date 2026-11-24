/**
 * `docfold dev` with `watch` on: notices changes inside a mounted folder, and the folder being
 * created or deleted (generators such as `dart doc` often replace their whole output folder).
 */

import { type FSWatcher, watch } from "node:fs";
import { basename, dirname } from "node:path";

/**
 * Watches `dir` recursively while it exists, and its parent for `dir` itself, the way the dev
 * server watches single files. `onChange` runs once events have stopped for `debounce` milliseconds.
 */
export const watchMount = (dir: string, debounce: number, onChange: () => void): { close: () => void } => {
  let inside: FSWatcher | undefined;
  let parent: FSWatcher | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const changed = (): void => {
    clearTimeout(timer);
    timer = setTimeout(onChange, debounce);
  };

  // (Re)starts the recursive watcher: a watcher on a deleted folder sees nothing of its replacement.
  const watchInside = (): void => {
    inside?.close();
    inside = undefined;
    try {
      const watcher = watch(dir, { recursive: true }, changed);
      watcher.on("error", () => watcher.close());
      inside = watcher;
    } catch {
      // doesn't exist (yet)
    }
  };

  try {
    parent = watch(dirname(dir), (_event, filename) => {
      if (filename && basename(String(filename)) !== basename(dir)) return;
      watchInside();
      changed();
    });
    parent.on("error", () => parent?.close());
  } catch {
    // the parent folder doesn't exist either: nothing to watch
  }
  watchInside();

  return {
    close: () => {
      clearTimeout(timer);
      inside?.close();
      parent?.close();
    },
  };
};

/**
 * Builds the sidebar tree (folders → sub-folders → files) from the markdown documents.
 *
 * Browser-safe (no Bun / node APIs).
 */

import { naturalCompare } from "../shared/natural-compare";
import type { FolderNode, TreeInput } from "../types";

const folderNode = (name: string, path: string): FolderNode => ({ kind: "folder", name, path, children: [], docCount: 0 });

export const buildTree = (docs: readonly TreeInput[]): FolderNode => {
  const root = folderNode("", "");
  // Folder path → node, so each document finds its folder without scanning siblings.
  const folders = new Map<string, FolderNode>([["", root]]);

  for (const doc of docs) {
    const segments = doc.relPath.split("/");
    const fileName = segments.pop() ?? doc.relPath;
    let folder = root;

    for (const segment of segments) {
      const path = folder.path ? `${folder.path}/${segment}` : segment;
      let next = folders.get(path);
      if (!next) {
        next = folderNode(segment, path);
        folders.set(path, next);
        folder.children.push(next);
      }
      folder = next;
    }

    folder.children.push({ kind: "file", name: fileName, path: doc.relPath, slug: doc.slug, title: doc.title });
  }

  finalize(root);
  return root;
};

/** Sorts folders before files (both naturally) and fills in `docCount`. */
const finalize = (folder: FolderNode): number => {
  folder.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return naturalCompare(a.name, b.name);
  });
  folder.docCount = folder.children.reduce(
    (total, child) => total + (child.kind === "folder" ? finalize(child) : 1),
    0,
  );
  return folder.docCount;
};

/** True when `slug` lives somewhere inside `folder`. */
export const folderContains = (folder: FolderNode, slug: string | undefined): boolean =>
  !!slug && (folder.path === "" || slug.startsWith(`${folder.path}/`));

/** The sidebar tree: folders → sub-folders → files. */

export interface FileNode {
  kind: "file";
  /** File name, e.g. "0001-disable-spm.md". */
  name: string;
  /** Path relative to the docs folder, e.g. "ios/0001-disable-spm.md". */
  path: string;
  slug: string;
  title: string;
}

export interface FolderNode {
  kind: "folder";
  /** Folder name ("" for the root). */
  name: string;
  /** Folder path relative to the docs folder ("" for the root). */
  path: string;
  children: TreeNode[];
  /** Number of documents in this folder and all of its sub-folders. */
  docCount: number;
}

export type TreeNode = FileNode | FolderNode;

export interface TreeInput {
  relPath: string;
  slug: string;
  title: string;
}

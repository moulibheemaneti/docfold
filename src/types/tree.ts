/** The sidebar tree: folders → sub-folders → files. */

export interface FileNode {
  kind: "file";
  /** File name, e.g. "0001-disable-spm.md". */
  name: string;
  /** Path relative to the docs folder, e.g. "ios/0001-disable-spm.md". */
  path: string;
  /** The page's slug, e.g. "ios/0001-disable-spm". */
  slug: string;
  title: string;
}

export interface FolderNode {
  kind: "folder";
  /** Folder name ("" for the root). */
  name: string;
  /** Folder path relative to the docs folder ("" for the root), e.g. "Guides/Team Notes". */
  path: string;
  /** `path` with the same rule as page slugs ("" for the root), e.g. "guides/team-notes". */
  slug: string;
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

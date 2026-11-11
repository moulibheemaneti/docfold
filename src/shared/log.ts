/**
 * Console output shared by every module, so warnings look the same in the CLI,
 * the dev server and programmatic use.
 */

/** The message of anything thrown (an `Error` or any other value). */
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A non-fatal problem the reader should know about (missing file, unreadable front matter…). */
export const warn = (message: string): void => console.warn(`[docfold] ${message}`);

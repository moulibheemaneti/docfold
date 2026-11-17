/**
 * Terminal output → HTML for the Builds log. Colours and bold/dim/italic/underline become
 * <span> classes (or an inline colour for 256-colour and true-colour codes); every other escape
 * sequence (cursor movement, titles, links) is dropped, so raw codes never show. A lone "\r"
 * (progress bars) starts a new line.
 *
 * `AnsiRenderer` keeps its state between chunks: a colour set in one chunk carries on in the next,
 * and an escape sequence split across two chunks is held back until it is complete.
 *
 * Browser-safe (no Bun / node APIs).
 */

import { escapeHtml } from "./html";

interface Style {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** 0–15 (a class) or "#rrggbb" (inline). */
  fg?: number | string;
  bg?: number | string;
}

const plain = (): Style => ({ bold: false, dim: false, italic: false, underline: false, strike: false });

/** CSI (colours, cursor), OSC (titles, hyperlinks) and two-byte escapes, plus stray control characters. */
const SEQUENCE =
  /\x1b\[([0-?]*)[ -/]*([@-~])|\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b[@-Z\\^_]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const COMPLETE = /^(?:\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b[@-Z\\^_])/;

/** An unfinished sequence longer than this (a hyperlink's URL can be long) is garbage, not something still arriving. */
const MAX_CARRY = 4096;

const hex = (n: number): string => n.toString(16).padStart(2, "0");

/** xterm's 256-colour palette: 0–15 named, 16–231 a 6×6×6 cube, 232–255 greys. */
const color256 = (n: number): number | string | undefined => {
  if (!Number.isInteger(n) || n < 0 || n > 255) return undefined;
  if (n < 16) return n;
  if (n >= 232) {
    const level = 8 + (n - 232) * 10;
    return `#${hex(level).repeat(3)}`;
  }
  const steps = [0, 95, 135, 175, 215, 255];
  const i = n - 16;
  return `#${hex(steps[Math.floor(i / 36)]!)}${hex(steps[Math.floor(i / 6) % 6]!)}${hex(steps[i % 6]!)}`;
};

/** Applies one SGR sequence ("1;31", "38;5;208", "0"…) to `style`. */
const applySgr = (style: Style, params: string): Style => {
  const codes = params === "" ? [0] : params.split(/[;:]/).map((code) => (code === "" ? 0 : Number(code)));
  let next = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!;
    if (code === 0) next = plain();
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 9) next.strike = true;
    else if (code === 22) next.bold = next.dim = false;
    else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code === 29) next.strike = false;
    else if (code >= 30 && code <= 37) next.fg = code - 30;
    else if (code >= 90 && code <= 97) next.fg = code - 90 + 8;
    else if (code === 39) next.fg = undefined;
    else if (code >= 40 && code <= 47) next.bg = code - 40;
    else if (code >= 100 && code <= 107) next.bg = code - 100 + 8;
    else if (code === 49) next.bg = undefined;
    else if (code === 38 || code === 48) {
      let color: number | string | undefined;
      if (codes[i + 1] === 5) {
        color = color256(codes[i + 2]!);
        i += 2;
      } else if (codes[i + 1] === 2) {
        const [r, g, b] = codes.slice(i + 2, i + 5);
        if ([r, g, b].every((v) => v !== undefined && Number.isInteger(v) && v >= 0 && v <= 255)) color = `#${hex(r!)}${hex(g!)}${hex(b!)}`;
        i += 4;
      }
      if (code === 38) next.fg = color;
      else next.bg = color;
    }
  }
  return next;
};

const isPlain = (style: Style): boolean =>
  !style.bold && !style.dim && !style.italic && !style.underline && !style.strike && style.fg === undefined && style.bg === undefined;

const openTag = (style: Style): string => {
  const classes: string[] = [];
  const inline: string[] = [];
  if (style.bold) classes.push("ansi-bold");
  if (style.dim) classes.push("ansi-dim");
  if (style.italic) classes.push("ansi-italic");
  if (style.underline) classes.push("ansi-underline");
  if (style.strike) classes.push("ansi-strike");
  if (typeof style.fg === "number") classes.push(`ansi-fg-${style.fg}`);
  else if (style.fg) inline.push(`color:${style.fg}`);
  if (typeof style.bg === "number") classes.push(`ansi-bg-${style.bg}`);
  else if (style.bg) inline.push(`background-color:${style.bg}`);
  return `<span${classes.length ? ` class="${classes.join(" ")}"` : ""}${inline.length ? ` style="${inline.join(";")}"` : ""}>`;
};

export class AnsiRenderer {
  #style: Style = plain();
  /** The end of the last chunk when it was an unfinished escape sequence, or a "\r" that may precede "\n". */
  #carry = "";

  /** HTML for the next piece of output. */
  push(chunk: string): string {
    let text = this.#carry + chunk;
    this.#carry = "";

    const lastEscape = text.lastIndexOf("\x1b");
    if (lastEscape !== -1 && text.length - lastEscape < MAX_CARRY && !COMPLETE.test(text.slice(lastEscape))) {
      this.#carry = text.slice(lastEscape);
      text = text.slice(0, lastEscape);
    } else if (text.endsWith("\r")) {
      this.#carry = "\r";
      text = text.slice(0, -1);
    }
    text = text.replace(/\r\n?/g, "\n");

    let out = "";
    let at = 0;
    const emit = (part: string) => {
      if (!part) return;
      const escaped = escapeHtml(part);
      out += isPlain(this.#style) ? escaped : `${openTag(this.#style)}${escaped}</span>`;
    };
    for (const match of text.matchAll(SEQUENCE)) {
      emit(text.slice(at, match.index));
      at = match.index + match[0].length;
      if (match[2] === "m") this.#style = applySgr(this.#style, match[1] ?? "");
    }
    emit(text.slice(at));
    return out;
  }
}

/** The whole of `text` as HTML. */
export const ansiToHtml = (text: string): string => new AnsiRenderer().push(text);

/** `text` without escape sequences or control characters (except newlines and tabs). */
export const stripAnsi = (text: string): string => text.replace(/\r\n?/g, "\n").replace(SEQUENCE, "");

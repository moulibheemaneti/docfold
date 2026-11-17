/**
 * Durations, sizes and times for the Builds pages and log.
 *
 * Browser-safe (no Bun / node APIs).
 */

/** "850 ms", "12.3 s", "4 min 05 s", "1 h 02 min". */
export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${String(seconds % 60).padStart(2, "0")} s`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
};

/** "512 B", "12.4 kB", "45.2 MB". */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1000;
    unit++;
  } while (value >= 1000 && unit < units.length - 1);
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
};

const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const DATE_TIME = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** "14:32" today, "Nov 16, 14:32" before. */
export const formatTime = (ms: number, now = Date.now()): string => {
  const date = new Date(ms);
  return new Date(now).toDateString() === date.toDateString() ? TIME.format(date) : DATE_TIME.format(date);
};

/** "20261117-143205", for download names. */
export const fileStamp = (ms: number): string => {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
};

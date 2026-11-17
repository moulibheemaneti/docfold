/**
 * A streaming .zip writer, so build outputs (several files, a folder, a macOS .app bundle) download
 * as one file without a dependency or a temporary archive on disk.
 *
 * Entries are stored, not compressed: downloads come from this computer, so compressing would only
 * cost time, and build artifacts (.apk, .ipa, images) are mostly compressed already. Each entry's
 * size and CRC go in its local header (no data descriptors), which every unzip tool reads. Unix
 * permissions and symlinks are kept, so executables and app bundles still work after unzipping.
 * ZIP64 records are added only when an entry, offset or count passes the classic format's limits.
 */

import { lstat, readdir, readlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { naturalCompare } from "../shared/natural-compare";

export interface ZipSource {
  /** Name at the top of the archive: a file name, or a folder whose contents go under "<name>/". */
  name: string;
  /** Absolute path of the file or folder (a symlink at this level is followed). */
  path: string;
}

/** Files up to this size are read once; larger ones are read twice (CRC first, then the data) to keep memory flat. */
const IN_MEMORY_LIMIT = 8 * 1024 * 1024;

const MAX_32 = 0xffffffff;
const MAX_16 = 0xffff;
const UTF8_NAMES = 0x0800;
const MADE_BY_UNIX = 3 << 8;

const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

interface Entry {
  name: string;
  kind: "file" | "dir" | "link";
  /** Absolute path (files), link target (links). */
  path: string;
  mode: number;
  mtime: Date;
  size: number;
}

interface Written {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  mode: number;
  dosTime: number;
  dosDate: number;
  zip64: boolean;
}

/** DOS date and time (local time, two-second steps); dates before 1980 become 1980-01-01. */
const dosDateTime = (date: Date): { dosTime: number; dosDate: number } => {
  const year = date.getFullYear();
  if (year < 1980) return { dosTime: 0, dosDate: (1 << 5) | 1 };
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    dosDate: ((Math.min(year, 2107) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
};

/** Little-endian writer over a fixed-size buffer. */
class Bytes {
  readonly bytes: Uint8Array;
  readonly #view: DataView;
  #at = 0;
  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.#view = new DataView(this.bytes.buffer);
  }
  u16(value: number): this {
    this.#view.setUint16(this.#at, value, true);
    this.#at += 2;
    return this;
  }
  u32(value: number): this {
    this.#view.setUint32(this.#at, value >>> 0, true);
    this.#at += 4;
    return this;
  }
  u64(value: number): this {
    this.#view.setBigUint64(this.#at, BigInt(value), true);
    this.#at += 8;
    return this;
  }
  raw(data: Uint8Array): this {
    this.bytes.set(data, this.#at);
    this.#at += data.length;
    return this;
  }
}

const localHeader = (entry: Written): Uint8Array => {
  const extra = entry.zip64 ? 20 : 0;
  const out = new Bytes(30 + entry.name.length + extra)
    .u32(0x04034b50)
    .u16(entry.zip64 ? 45 : 20)
    .u16(UTF8_NAMES)
    .u16(0) // stored
    .u16(entry.dosTime)
    .u16(entry.dosDate)
    .u32(entry.crc)
    .u32(entry.zip64 ? MAX_32 : entry.size)
    .u32(entry.zip64 ? MAX_32 : entry.size)
    .u16(entry.name.length)
    .u16(extra)
    .raw(entry.name);
  if (entry.zip64) out.u16(0x0001).u16(16).u64(entry.size).u64(entry.size);
  return out.bytes;
};

const centralHeader = (entry: Written): Uint8Array => {
  const bigSize = entry.size >= MAX_32;
  const bigOffset = entry.offset >= MAX_32;
  const extra = bigSize || bigOffset ? 4 + (bigSize ? 16 : 0) + (bigOffset ? 8 : 0) : 0;
  const isDir = (entry.mode & 0o170000) === S_IFDIR;
  const out = new Bytes(46 + entry.name.length + extra)
    .u32(0x02014b50)
    .u16(MADE_BY_UNIX | 45)
    .u16(entry.zip64 || bigOffset ? 45 : 20)
    .u16(UTF8_NAMES)
    .u16(0)
    .u16(entry.dosTime)
    .u16(entry.dosDate)
    .u32(entry.crc)
    .u32(bigSize ? MAX_32 : entry.size)
    .u32(bigSize ? MAX_32 : entry.size)
    .u16(entry.name.length)
    .u16(extra)
    .u16(0) // comment
    .u16(0) // disk
    .u16(0) // internal attributes
    .u32(((entry.mode & 0xffff) << 16) | (isDir ? 0x10 : 0))
    .u32(bigOffset ? MAX_32 : entry.offset)
    .raw(entry.name);
  if (extra) {
    out.u16(0x0001).u16(extra - 4);
    if (bigSize) out.u64(entry.size).u64(entry.size);
    if (bigOffset) out.u64(entry.offset);
  }
  return out.bytes;
};

const endRecords = (count: number, cdOffset: number, cdSize: number): Uint8Array => {
  const zip64 = count >= MAX_16 || cdOffset >= MAX_32 || cdSize >= MAX_32;
  const parts: Uint8Array[] = [];
  if (zip64) {
    const zip64End = cdOffset + cdSize;
    parts.push(
      new Bytes(56)
        .u32(0x06064b50)
        .u64(44)
        .u16(MADE_BY_UNIX | 45)
        .u16(45)
        .u32(0)
        .u32(0)
        .u64(count)
        .u64(count)
        .u64(cdSize)
        .u64(cdOffset).bytes,
      new Bytes(20).u32(0x07064b50).u32(0).u64(zip64End).u32(1).bytes,
    );
  }
  parts.push(
    new Bytes(22)
      .u32(0x06054b50)
      .u16(0)
      .u16(0)
      .u16(Math.min(count, MAX_16))
      .u16(Math.min(count, MAX_16))
      .u32(Math.min(cdSize, MAX_32))
      .u32(Math.min(cdOffset, MAX_32))
      .u16(0).bytes,
  );
  return concat(parts);
};

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

/** Every entry under a source, folders before their contents, names sorted naturally. */
async function* walk(source: ZipSource): AsyncGenerator<Entry> {
  const top = await stat(source.path);
  if (top.isFile()) {
    yield { name: source.name, kind: "file", path: source.path, mode: S_IFREG | (top.mode & 0o7777), mtime: top.mtime, size: top.size };
    return;
  }
  if (!top.isDirectory()) return;

  async function* folder(dir: string, name: string, info: { mode: number; mtime: Date }): AsyncGenerator<Entry> {
    yield { name: `${name}/`, kind: "dir", path: dir, mode: S_IFDIR | (info.mode & 0o7777), mtime: info.mtime, size: 0 };
    const children = (await readdir(dir)).sort(naturalCompare);
    for (const child of children) {
      const path = join(dir, child);
      const childName = `${name}/${child}`;
      let info: Awaited<ReturnType<typeof lstat>>;
      try {
        info = await lstat(path);
      } catch {
        continue; // removed while zipping
      }
      if (info.isSymbolicLink()) {
        const target = await readlink(path);
        yield { name: childName, kind: "link", path: target, mode: S_IFLNK | 0o777, mtime: info.mtime, size: Buffer.byteLength(target) };
      } else if (info.isDirectory()) {
        yield* folder(path, childName, info);
      } else if (info.isFile()) {
        yield { name: childName, kind: "file", path, mode: S_IFREG | (info.mode & 0o7777), mtime: info.mtime, size: info.size };
      }
      // sockets, FIFOs and devices are skipped
    }
  }
  yield* folder(source.path, source.name, top);
}

/** CRC-32 and length of a file, reading it as a stream. */
const checksum = async (path: string): Promise<{ crc: number; size: number }> => {
  let crc = 0;
  let size = 0;
  for await (const chunk of Bun.file(path).stream()) {
    crc = Bun.hash.crc32(chunk, crc);
    size += chunk.length;
  }
  return { crc, size };
};

/** Gives each source a unique top-level name: "app.apk", "app (2).apk"… */
const uniqueNames = (sources: readonly ZipSource[]): ZipSource[] => {
  const used = new Set<string>();
  return sources.map((source) => {
    const dot = source.name.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [source.name.slice(0, dot), source.name.slice(dot)] : [source.name, ""];
    let name = source.name;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem} (${n})${ext}`;
    used.add(name.toLowerCase());
    return { ...source, name };
  });
};

/** The archive's bytes, produced as the reader asks for them. */
async function* zipChunks(sources: readonly ZipSource[]): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  const written: Written[] = [];
  let offset = 0;

  for (const source of uniqueNames(sources)) {
    for await (const entry of walk(source)) {
      let data: Uint8Array | undefined;
      let crc = 0;
      let size = 0;
      if (entry.kind === "link") {
        data = encoder.encode(entry.path);
      } else if (entry.kind === "file") {
        if (entry.size <= IN_MEMORY_LIMIT) data = await Bun.file(entry.path).bytes();
        else ({ crc, size } = await checksum(entry.path));
      } else {
        data = new Uint8Array(0);
      }
      if (data) {
        crc = Bun.hash.crc32(data);
        size = data.length;
      }

      const record: Written = {
        name: encoder.encode(entry.name),
        crc,
        size,
        offset,
        mode: entry.mode,
        ...dosDateTime(entry.mtime),
        zip64: size >= MAX_32,
      };
      const header = localHeader(record);
      yield header;
      offset += header.length;

      if (data) {
        if (data.length) yield data;
      } else {
        // Large file: stream it, stopping at the size the header promised even if it grew meanwhile.
        let left = size;
        for await (const chunk of Bun.file(entry.path).stream()) {
          const part = chunk.length > left ? chunk.subarray(0, left) : chunk;
          yield part;
          left -= part.length;
          if (!left) break;
        }
        if (left) throw new Error(`${entry.path} got shorter while it was being zipped.`);
      }
      offset += size;
      written.push(record);
    }
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const record of written) {
    const header = centralHeader(record);
    cdSize += header.length;
    yield header;
  }
  yield endRecords(written.length, cdOffset, cdSize);
}

/** A .zip of `sources` as a stream, for a `Response` body. */
export const zipStream = (sources: readonly ZipSource[]): ReadableStream<Uint8Array> => {
  const chunks = zipChunks(sources);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await chunks.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
};

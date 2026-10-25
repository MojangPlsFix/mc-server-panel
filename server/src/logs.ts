import { EventEmitter } from "node:events";
import { createReadStream } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { StringDecoder } from "node:string_decoder";
import { createGunzip } from "node:zlib";

import type { LogContent, LogFileInfo } from "@shared/types.js";

/** Logged by vanilla, Forge, Fabric and Paper once the server accepts players. */
const DONE_LINE = /\]: Done \([\d.,]+s\)!/;

export interface TailerOptions {
  pollMs: number;
  /** Lines kept in memory for clients that connect later. */
  keepLines: number;
  /** On the first poll, only this many trailing bytes of an existing file are read. */
  initialBytes: number;
  /** Upper bound per poll so a huge burst can't block the event loop. */
  maxReadBytes: number;
}

const DEFAULT_TAILER: TailerOptions = {
  pollMs: 500,
  keepLines: 1000,
  initialBytes: 256 * 1024,
  maxReadBytes: 1024 * 1024,
};

/**
 * Follows a log file like `tail -F`: emits new lines, and "reset" when the file is replaced
 * (the server rotates latest.log on every start) or truncated.
 */
export type TailerEvents = { lines: [string[]]; reset: [] };

export class LogTailer extends EventEmitter<TailerEvents> {
  private readonly options: TailerOptions;
  private inode: number | null = null;
  private offset = 0;
  private partial = "";
  private dropFirstLine = false;
  private decoder = new StringDecoder("utf8");
  private recentLines: string[] = [];
  private started = false;
  private polling = false;
  private timer: NodeJS.Timeout | null = null;
  /** True once the current file contains the server's "Done (...)!" line. */
  ready = false;

  constructor(
    readonly file: string,
    options: Partial<TailerOptions> = {},
  ) {
    super();
    this.options = { ...DEFAULT_TAILER, ...options };
  }

  get recent(): readonly string[] {
    return this.recentLines;
  }

  start() {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.options.pollMs);
  }

  stop() {
    clearInterval(this.timer ?? undefined);
    this.timer = null;
  }

  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.readNew();
    } finally {
      this.polling = false;
    }
  }

  private async readNew() {
    let info;
    try {
      info = await stat(this.file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      if (this.inode !== null) this.reset(null);
      this.started = true;
      return;
    }

    if (this.inode === null && !this.started) {
      // First look at an existing file: start near its end.
      this.inode = info.ino;
      this.offset = Math.max(0, info.size - this.options.initialBytes);
      this.dropFirstLine = this.offset > 0;
    } else if (this.inode === null) {
      this.inode = info.ino; // file (re)appeared after being missing
    } else if (info.ino !== this.inode || info.size < this.offset) {
      this.reset(info.ino);
    }
    this.started = true;
    if (info.size <= this.offset) return;

    const length = Math.min(info.size - this.offset, this.options.maxReadBytes);
    const handle = await open(this.file, "r");
    let chunk: Buffer;
    try {
      chunk = Buffer.alloc(length);
      const { bytesRead } = await handle.read(chunk, 0, length, this.offset);
      chunk = chunk.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
    this.offset += chunk.length;

    const parts = (this.partial + this.decoder.write(chunk)).split("\n");
    this.partial = parts.pop() ?? "";
    if (this.dropFirstLine) {
      parts.shift();
      this.dropFirstLine = false;
    }
    const lines = parts.map((line) => line.replace(/\r$/, ""));
    if (lines.length === 0) return;
    if (lines.some((line) => DONE_LINE.test(line))) this.ready = true;
    this.recentLines = [...this.recentLines, ...lines].slice(-this.options.keepLines);
    this.emit("lines", lines);
  }

  private reset(inode: number | null) {
    this.inode = inode;
    this.offset = 0;
    this.partial = "";
    this.dropFirstLine = false;
    this.decoder = new StringDecoder("utf8");
    this.recentLines = [];
    this.ready = false;
    this.emit("reset");
  }
}

const LOG_NAME = /^[\w-][\w.-]*\.(log|txt)(\.gz)?$/;

export async function listLogFiles(directory: string, liveName: string): Promise<LogFileInfo[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && LOG_NAME.test(entry.name))
      .map(async (entry) => {
        const info = await stat(path.join(directory, entry.name));
        return {
          name: entry.name,
          size: info.size,
          modified: info.mtime.toISOString(),
          live: entry.name === liveName,
        };
      }),
  );
  return files.sort((a, b) => Number(b.live) - Number(a.live) || b.modified.localeCompare(a.modified));
}

/** Absolute path of a log file inside `directory`, or null if the name is not an allowed log file. */
export async function resolveLogFile(directory: string, name: string): Promise<string | null> {
  if (!LOG_NAME.test(name) || path.basename(name) !== name) return null;
  const file = path.join(directory, name);
  try {
    return (await stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

/** Reads the last `maxLines` lines of a (possibly gzipped) log file. */
export async function readLogTail(file: string, maxLines: number): Promise<LogContent> {
  const source = createReadStream(file);
  const input = file.endsWith(".gz") ? source.pipe(createGunzip()) : source;
  const lines: string[] = [];
  let totalLines = 0;
  for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
    totalLines++;
    lines.push(line);
    if (lines.length > maxLines) lines.shift();
  }
  return { name: path.basename(file), lines, totalLines, truncated: totalLines > lines.length };
}

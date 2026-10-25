import { appendFileSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LogTailer, listLogFiles, readLogTail, resolveLogFile } from "../../server/src/logs.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "mcp-logs-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function collect(tailer: LogTailer) {
  const events: (string[] | "reset")[] = [];
  tailer.on("lines", (lines) => events.push(lines));
  tailer.on("reset", () => events.push("reset"));
  return events;
}

describe("LogTailer", () => {
  it("starts near the end of an existing file and drops the cut-off first line", async () => {
    const file = path.join(dir, "latest.log");
    writeFileSync(file, "first line that is long\nsecond\nthird\n");
    const tailer = new LogTailer(file, { initialBytes: 10 }); // cut inside "second"
    const events = collect(tailer);
    await tailer.poll();
    expect(events).toEqual([["third"]]);
  });

  it("keeps the first line when the cut lands exactly on a line break", async () => {
    const file = path.join(dir, "latest.log");
    writeFileSync(file, "first line that is long\nsecond\nthird\n");
    const tailer = new LogTailer(file, { initialBytes: 14 });
    const events = collect(tailer);
    await tailer.poll();
    expect(events).toEqual([["second", "third"]]);
  });

  it("emits appended lines and buffers partial lines until complete", async () => {
    const file = path.join(dir, "latest.log");
    writeFileSync(file, "a\n");
    const tailer = new LogTailer(file);
    const events = collect(tailer);
    await tailer.poll();
    appendFileSync(file, "b\r\nc-par");
    await tailer.poll();
    appendFileSync(file, "tial\n");
    await tailer.poll();
    expect(events).toEqual([["a"], ["b"], ["c-partial"]]);
    expect(tailer.recent).toEqual(["a", "b", "c-partial"]);
  });

  it("decodes multi-byte characters split across reads", async () => {
    const file = path.join(dir, "latest.log");
    writeFileSync(file, "");
    const tailer = new LogTailer(file);
    const events = collect(tailer);
    await tailer.poll();
    const bytes = Buffer.from("Grüße\n");
    appendFileSync(file, bytes.subarray(0, 3));
    await tailer.poll();
    appendFileSync(file, bytes.subarray(3));
    await tailer.poll();
    expect(events).toEqual([["Grüße"]]);
  });

  it("resets when the server rotates the file on start", async () => {
    const file = path.join(dir, "latest.log");
    writeFileSync(file, 'old run\n[x] [Server thread/INFO] [y/]: Done (1.2s)! For help, type "help"\n');
    const tailer = new LogTailer(file);
    const events = collect(tailer);
    await tailer.poll();
    expect(tailer.ready).toBe(true);

    renameSync(file, path.join(dir, "2026-10-25-1.log"));
    writeFileSync(file, "new run\n");
    await tailer.poll();
    expect(events.slice(1)).toEqual(["reset", ["new run"]]);
    expect(tailer.ready).toBe(false);
    expect(tailer.recent).toEqual(["new run"]);
  });

  it("resets when the file is truncated or deleted", async () => {
    const file = path.join(dir, "latest.log");
    writeFileSync(file, "one\ntwo\n");
    const tailer = new LogTailer(file);
    const events = collect(tailer);
    await tailer.poll();
    writeFileSync(file, "x\n");
    await tailer.poll();
    rmSync(file);
    await tailer.poll();
    writeFileSync(file, "back\n");
    await tailer.poll();
    expect(events).toEqual([["one", "two"], "reset", ["x"], "reset", ["back"]]);
  });

  it("waits for a file that does not exist yet", async () => {
    const file = path.join(dir, "latest.log");
    const tailer = new LogTailer(file);
    const events = collect(tailer);
    await tailer.poll();
    writeFileSync(file, "hello\n");
    await tailer.poll();
    expect(events).toEqual([["hello"]]);
  });
});

describe("log files", () => {
  it("lists log files with the live file first, newest next", async () => {
    writeFileSync(path.join(dir, "latest.log"), "x");
    writeFileSync(path.join(dir, "2026-10-24-1.log.gz"), gzipSync("a"));
    writeFileSync(path.join(dir, "2026-10-25-1.log.gz"), gzipSync("b"));
    writeFileSync(path.join(dir, "notes.md"), "ignored");
    utimesSync(path.join(dir, "2026-10-24-1.log.gz"), new Date("2026-10-24"), new Date("2026-10-24"));
    utimesSync(path.join(dir, "2026-10-25-1.log.gz"), new Date("2026-10-25"), new Date("2026-10-25"));
    const files = await listLogFiles(dir, "latest.log");
    expect(files.map((f) => [f.name, f.live])).toEqual([
      ["latest.log", true],
      ["2026-10-25-1.log.gz", false],
      ["2026-10-24-1.log.gz", false],
    ]);
  });

  it("returns no files for a missing directory", async () => {
    expect(await listLogFiles(path.join(dir, "missing"), "latest.log")).toEqual([]);
  });

  it("only resolves plain log file names inside the directory", async () => {
    writeFileSync(path.join(dir, "latest.log"), "x");
    expect(await resolveLogFile(dir, "latest.log")).toBe(path.join(dir, "latest.log"));
    for (const name of ["../latest.log", "..", "sub/latest.log", ".hidden.log", "latest.log/..", "passwd"]) {
      expect(await resolveLogFile(dir, name)).toBeNull();
    }
    expect(await resolveLogFile(dir, "missing.log")).toBeNull();
  });

  it("reads the tail of plain and gzipped logs", async () => {
    const text = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    writeFileSync(path.join(dir, "a.log"), text);
    writeFileSync(path.join(dir, "b.log.gz"), gzipSync(text));
    for (const name of ["a.log", "b.log.gz"]) {
      expect(await readLogTail(path.join(dir, name), 3)).toEqual({
        name,
        lines: ["line 8", "line 9", "line 10"],
        totalLines: 10,
        truncated: true,
      });
    }
    expect((await readLogTail(path.join(dir, "a.log"), 50)).truncated).toBe(false);
  });
});

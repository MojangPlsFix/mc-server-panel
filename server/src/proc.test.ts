import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CpuMeter, findServerProcess, parseProcStat, readHostInfo } from "./proc.js";

/** Builds a /proc/<pid>/stat line; fields after the command start at "state". */
function statLine(pid: number, comm: string, ppid: number, utime: number, stime: number, rssPages: number) {
  const fields = [
    "S",
    ppid,
    1,
    1,
    0,
    -1,
    4194304,
    0,
    0,
    0,
    0,
    utime,
    stime,
    0,
    0,
    20,
    0,
    1,
    0,
    100,
    1000,
    rssPages,
  ];
  return `${pid} (${comm}) ${fields.join(" ")}`;
}

describe("parseProcStat", () => {
  it("handles command names with spaces and parentheses", () => {
    expect(parseProcStat(42, statLine(42, "java (Server thread)", 7, 150, 50, 1000))).toEqual({
      pid: 42,
      ppid: 7,
      cpuTicks: 200,
      rssBytes: 1000 * 4096,
    });
  });

  it("rejects garbage", () => {
    expect(parseProcStat(1, "nonsense")).toBeNull();
  });
});

describe("findServerProcess", () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("picks the largest process below the tmux pane", async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "mcp-proc-"));
    const procs: [number, string, number, number][] = [
      [10, "bash", 1, 900], // pane shell
      [11, "java", 10, 1_500_000], // the server
      [12, "sleep", 10, 100],
      [20, "other java", 1, 9_999_999], // unrelated, bigger
    ];
    for (const [pid, comm, ppid, rss] of procs) {
      mkdirSync(path.join(root, String(pid)));
      writeFileSync(path.join(root, String(pid), "stat"), statLine(pid, comm, ppid, 0, 0, rss));
    }
    mkdirSync(path.join(root, "self"));
    expect((await findServerProcess(10, root))?.pid).toBe(11);
    expect(await findServerProcess(999, root)).toBeNull();
  });
});

describe("CpuMeter", () => {
  it("reports percent of one core between samples of the same process", () => {
    const meter = new CpuMeter();
    const base = { pid: 5, ppid: 1, rssBytes: 1 };
    expect(meter.sample({ ...base, cpuTicks: 1000 }, 0).cpuPercent).toBeNull();
    // 150 ticks = 1.5 s CPU in 1 s wall time = 150 %
    expect(meter.sample({ ...base, cpuTicks: 1150 }, 1000).cpuPercent).toBeCloseTo(150);
    // new pid starts over
    expect(meter.sample({ ...base, pid: 6, cpuTicks: 5 }, 2000).cpuPercent).toBeNull();
  });
});

describe("readHostInfo", () => {
  it("reads total and available memory", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "mcp-mem-"));
    writeFileSync(
      path.join(root, "meminfo"),
      "MemTotal:        8388608 kB\nMemFree: 1 kB\nMemAvailable:    1048576 kB\n",
    );
    expect(await readHostInfo(root)).toMatchObject({
      memTotalBytes: 8 * 1024 ** 3,
      memAvailableBytes: 1024 ** 3,
    });
    rmSync(root, { recursive: true, force: true });
  });
});

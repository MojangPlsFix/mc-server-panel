import { readdir, readFile } from "node:fs/promises";
import os from "node:os";

import type { HostInfo, ProcessInfo } from "@shared/types.js";

/** Linux reports CPU time in /proc in USER_HZ ticks, which is 100 on all mainstream architectures. */
const USER_HZ = 100;
const PAGE_SIZE = 4096;

interface ProcStat {
  pid: number;
  ppid: number;
  cpuTicks: number;
  rssBytes: number;
}

/** Parses /proc/<pid>/stat. The command name is in parentheses and may contain spaces. */
export function parseProcStat(pid: number, text: string): ProcStat | null {
  const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
  // Field numbers from proc(5), shifted by 3 because the slice starts at field 3 (state).
  const ppid = Number(fields[1]);
  const cpuTicks = Number(fields[11]) + Number(fields[12]);
  const rssPages = Number(fields[21]);
  if (![ppid, cpuTicks, rssPages].every(Number.isFinite)) return null;
  return { pid, ppid, cpuTicks, rssBytes: rssPages * PAGE_SIZE };
}

async function readAllStats(procRoot: string): Promise<ProcStat[]> {
  const entries = await readdir(procRoot);
  const stats = await Promise.all(
    entries
      .filter((name) => /^\d+$/.test(name))
      .map(async (name) => {
        try {
          return parseProcStat(Number(name), await readFile(`${procRoot}/${name}/stat`, "utf8"));
        } catch {
          return null; // process exited while scanning
        }
      }),
  );
  return stats.filter((s): s is ProcStat => s !== null);
}

/**
 * Finds the server process below `rootPid` (e.g. the tmux pane's shell running java):
 * the process in that subtree with the largest resident memory.
 */
export async function findServerProcess(rootPid: number, procRoot = "/proc"): Promise<ProcStat | null> {
  const all = await readAllStats(procRoot);
  const children = new Map<number, ProcStat[]>();
  for (const stat of all) children.set(stat.ppid, [...(children.get(stat.ppid) ?? []), stat]);
  let best: ProcStat | null = all.find((s) => s.pid === rootPid) ?? null;
  const queue = [...(children.get(rootPid) ?? [])];
  for (let stat = queue.shift(); stat; stat = queue.shift()) {
    if (!best || stat.rssBytes > best.rssBytes) best = stat;
    queue.push(...(children.get(stat.pid) ?? []));
  }
  return best;
}

/** Turns successive CPU tick counters into a percentage of one core. */
export class CpuMeter {
  private last: { pid: number; ticks: number; at: number } | null = null;

  sample(stat: ProcStat, now = performance.now()): ProcessInfo {
    const previous = this.last?.pid === stat.pid ? this.last : null;
    this.last = { pid: stat.pid, ticks: stat.cpuTicks, at: now };
    const seconds = previous ? (now - previous.at) / 1000 : 0;
    const cpuPercent =
      previous && seconds > 0 ? ((stat.cpuTicks - previous.ticks) / USER_HZ / seconds) * 100 : null;
    return { pid: stat.pid, rssBytes: stat.rssBytes, cpuPercent };
  }
}

export async function readHostInfo(procRoot = "/proc"): Promise<HostInfo | null> {
  try {
    const meminfo = await readFile(`${procRoot}/meminfo`, "utf8");
    const kb = (key: string) =>
      Number(new RegExp(`^${key}:\\s+(\\d+) kB`, "m").exec(meminfo)?.[1] ?? NaN) * 1024;
    const memTotalBytes = kb("MemTotal");
    const memAvailableBytes = kb("MemAvailable");
    if (!Number.isFinite(memTotalBytes) || !Number.isFinite(memAvailableBytes)) return null;
    return { memTotalBytes, memAvailableBytes, cpuCount: os.availableParallelism() };
  } catch {
    return null;
  }
}

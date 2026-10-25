export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LogEntry {
  /** Time of day (HH:MM:SS) if the line has a timestamp. */
  time: string | null;
  thread: string | null;
  level: LogLevel | null;
  /** Logger name (Forge/NeoForge format only). */
  source: string | null;
  message: string;
  /** Continuation lines (stack traces, multi-line messages) that belong to this entry. */
  continuation: string[];
}

// Forge / NeoForge: [25Oct2026 08:22:19.464] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: Done
const FORGE = /^\[([^\]]+)\] \[(.+?)\/(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\] \[([^\]]*)\]: ?(.*)$/;
// Vanilla / Paper / Fabric: [08:22:19] [Server thread/INFO]: Done
const VANILLA = /^\[([^\]]+)\] \[(.+?)\/(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\]: ?(.*)$/;
const TIME = /(\d{2}:\d{2}:\d{2})/;

/** Parses one log line; returns null for lines without a recognizable header (continuations). */
export function parseLogLine(line: string): Omit<LogEntry, "continuation"> | null {
  const forge = FORGE.exec(line);
  if (forge) {
    const [, stamp = "", thread = "", level = "", source = "", message = ""] = forge;
    return {
      time: TIME.exec(stamp)?.[1] ?? null,
      thread,
      level: level.toLowerCase() as LogLevel,
      source: source.replace(/\/$/, "") || null,
      message,
    };
  }
  const vanilla = VANILLA.exec(line);
  if (vanilla) {
    const [, stamp = "", thread = "", level = "", message = ""] = vanilla;
    return {
      time: TIME.exec(stamp)?.[1] ?? null,
      thread,
      level: level.toLowerCase() as LogLevel,
      source: null,
      message,
    };
  }
  return null;
}

/** Groups raw lines into entries, attaching header-less lines to the entry before them. */
export function groupLogLines(lines: readonly string[]): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of lines) {
    const parsed = parseLogLine(line);
    const last = entries.at(-1);
    if (parsed) {
      entries.push({ ...parsed, continuation: [] });
    } else if (last) {
      last.continuation.push(line);
    } else {
      entries.push({ time: null, thread: null, level: null, source: null, message: line, continuation: [] });
    }
  }
  return entries;
}

const SEVERITY: Record<LogLevel, number> = { trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5 };

/** True if the entry is at least as severe as `min`. Entries without a level never match. */
export function atLeast(entry: Pick<LogEntry, "level">, min: LogLevel): boolean {
  return entry.level !== null && SEVERITY[entry.level] >= SEVERITY[min];
}

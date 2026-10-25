/** Lifecycle state of the Minecraft server as shown in the panel. */
export type ServerState = "stopped" | "starting" | "running" | "stopping" | "failed" | "unknown";

export type ServerAction = "start" | "stop" | "restart";

export interface PlayerInfo {
  name: string;
  id: string;
}

/** Result of a Server List Ping against the game port. */
export interface PingInfo {
  version: string;
  protocol: number;
  motd: string;
  playersOnline: number;
  playersMax: number;
  /** Player sample from the ping response (vanilla sends at most 12). */
  players: PlayerInfo[];
  latencyMs: number;
}

export interface ProcessInfo {
  pid: number;
  rssBytes: number;
  /** Percent of one CPU core; null until two samples exist. */
  cpuPercent: number | null;
}

export interface HostInfo {
  memTotalBytes: number;
  memAvailableBytes: number;
  cpuCount: number;
}

export interface StatusSnapshot {
  name: string;
  state: ServerState;
  /** ISO time the server process was started, if running. */
  since: string | null;
  pending: ServerAction | null;
  ping: PingInfo | null;
  process: ProcessInfo | null;
  host: HostInfo | null;
  error: string | null;
  updatedAt: string;
}

export interface LogFileInfo {
  name: string;
  size: number;
  modified: string;
  /** True for the file the server is currently writing. */
  live: boolean;
}

export interface LogContent {
  name: string;
  lines: string[];
  totalLines: number;
  truncated: boolean;
}

export type WsMessage =
  | { type: "hello"; status: StatusSnapshot; lines: string[] }
  | { type: "status"; status: StatusSnapshot }
  | { type: "log"; lines: string[] }
  | { type: "log-reset" };

export interface ApiError {
  error: string;
}

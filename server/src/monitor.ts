import { EventEmitter } from "node:events";

import type { PingInfo, ProcessInfo, ServerAction, ServerState, StatusSnapshot } from "@shared/types.js";

import { ControlError, type ServiceControl, type UnitStatus } from "./control.js";
import type { LogTailer, TailerEvents } from "./logs.js";
import { CpuMeter, findServerProcess, readHostInfo } from "./proc.js";
import type { TmuxSession } from "./tmux.js";

export interface MonitorDeps {
  name: string;
  control: ServiceControl;
  session: Pick<TmuxSession, "panePid">;
  tailer: EventEmitter<TailerEvents> & Pick<LogTailer, "ready">;
  ping: () => Promise<PingInfo>;
  intervalMs?: number;
  findProcess?: typeof findServerProcess;
  hostInfo?: typeof readHostInfo;
  clock?: () => number;
}

/** Actions allowed per state. */
const ALLOWED: Record<ServerAction, ServerState[]> = {
  start: ["stopped", "failed"],
  stop: ["starting", "running"],
  restart: ["starting", "running"],
};

const PENDING_TIMEOUT_MS = 10 * 60_000;

export type MonitorEvents = { status: [StatusSnapshot] };

/** Combines service state, server list ping and the log into one status that is refreshed periodically. */
export class StatusMonitor extends EventEmitter<MonitorEvents> {
  private snapshot: StatusSnapshot;
  private pending: { action: ServerAction; since: number; sawDown: boolean } | null = null;
  private readonly cpu = new CpuMeter();
  private timer: NodeJS.Timeout | null = null;
  private refreshing: Promise<void> | null = null;
  /** The "Done" line only counts if the log was rotated after the server was last seen stopped. */
  private logReadyTrusted = true;
  private readonly clock: () => number;

  constructor(private readonly deps: MonitorDeps) {
    super();
    this.clock = deps.clock ?? Date.now;
    this.snapshot = {
      name: deps.name,
      state: "unknown",
      since: null,
      pending: null,
      ping: null,
      process: null,
      host: null,
      error: null,
      updatedAt: new Date(this.clock()).toISOString(),
    };
    deps.tailer.on("reset", () => {
      this.logReadyTrusted = true;
    });
  }

  get status(): StatusSnapshot {
    return this.snapshot;
  }

  start() {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.deps.intervalMs ?? 2000);
  }

  stop() {
    clearInterval(this.timer ?? undefined);
    this.timer = null;
  }

  refresh(): Promise<void> {
    this.refreshing ??= this.collect().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async perform(action: ServerAction): Promise<void> {
    await this.refresh();
    const { state } = this.snapshot;
    if (this.pending) throw new ControlError(`Still busy with "${this.pending.action}"`);
    if (!ALLOWED[action].includes(state))
      throw new ControlError(`Cannot ${action} while the server is ${state}`);
    // The server is about to write a new log; until it does, the old Done line means nothing.
    if (action !== "stop") this.logReadyTrusted = false;
    await this.deps.control[action]();
    this.pending = { action, since: this.clock(), sawDown: false };
    await this.refresh();
  }

  private async collect() {
    let unit: UnitStatus | null = null;
    let error: string | null;
    try {
      unit = await this.deps.control.status();
      error = unit.detail;
    } catch (err) {
      error = (err as Error).message;
    }

    const alive = unit !== null && unit.activity !== "inactive" && unit.activity !== "failed";
    // Any non-active phase (stopping, starting, stopped) invalidates the Done line until a new log starts.
    if (unit?.activity !== "active") this.logReadyTrusted = false;
    const [ping, processInfo, host] = await Promise.all([
      unit?.activity === "active" ? this.deps.ping().catch(() => null) : null,
      alive ? this.processInfo() : null,
      (this.deps.hostInfo ?? readHostInfo)(),
    ]);

    const state = unit ? this.deriveState(unit, ping !== null) : "unknown";
    error = this.settlePending(state) ?? error;

    this.snapshot = {
      name: this.deps.name,
      state,
      since: unit?.since?.toISOString() ?? null,
      pending: this.pending?.action ?? null,
      ping,
      process: processInfo,
      host,
      error,
      updatedAt: new Date(this.clock()).toISOString(),
    };
    this.emit("status", this.snapshot);
  }

  private deriveState(unit: UnitStatus, pingOk: boolean): ServerState {
    switch (unit.activity) {
      case "inactive":
        return "stopped";
      case "failed":
        return "failed";
      case "activating":
        return "starting";
      case "deactivating":
        return "stopping";
      case "active":
        if (this.pending?.action === "stop") return "stopping";
        return pingOk || (this.logReadyTrusted && this.deps.tailer.ready) ? "running" : "starting";
    }
  }

  /** Clears the pending action once its goal is reached; returns an error message if it went wrong. */
  private settlePending(state: ServerState): string | null {
    const pending = this.pending;
    if (!pending) return null;
    if (state !== "running") pending.sawDown = true;
    const age = this.clock() - pending.since;
    const diedOnStart = pending.action === "start" && state === "stopped" && age > 15_000;
    const reached: Record<ServerAction, boolean> = {
      start: state === "running",
      stop: state === "stopped",
      restart: state === "running" && pending.sawDown,
    };
    const timedOut = age > PENDING_TIMEOUT_MS;
    if (state !== "failed" && !reached[pending.action] && !diedOnStart && !timedOut) return null;
    this.pending = null;
    if (diedOnStart) return "The server stopped right after starting - check the log";
    if (timedOut && state !== "failed" && !reached[pending.action]) {
      return `"${pending.action}" did not finish within ${PENDING_TIMEOUT_MS / 60_000} minutes`;
    }
    return null;
  }

  private async processInfo(): Promise<ProcessInfo | null> {
    const rootPid = await this.deps.session.panePid();
    if (rootPid === null) return null;
    const stat = await (this.deps.findProcess ?? findServerProcess)(rootPid);
    return stat ? this.cpu.sample(stat) : null;
  }
}

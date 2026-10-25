import { setTimeout as sleep } from "node:timers/promises";

import type { Exec } from "./exec.js";
import type { TmuxSession } from "./tmux.js";

export type UnitActivity = "inactive" | "activating" | "active" | "deactivating" | "failed";

export interface UnitStatus {
  activity: UnitActivity;
  /** When the server process was started (only while it runs). */
  since: Date | null;
  /** Extra information, e.g. why the unit failed. */
  detail: string | null;
}

/** Starts and stops the server process. Actions return once requested, not once finished. */
export interface ServiceControl {
  status(): Promise<UnitStatus>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
}

export class ControlError extends Error {}

const SYSTEMD_ACTIVITY: Record<string, UnitActivity> = {
  active: "active",
  reloading: "active",
  refreshing: "active",
  activating: "activating",
  deactivating: "deactivating",
  failed: "failed",
  inactive: "inactive",
  maintenance: "inactive",
};

/** Controls a systemd unit, optionally through `sudo -n` (see deploy/sudoers). */
export class SystemdControl implements ServiceControl {
  constructor(
    private readonly exec: Exec,
    private readonly unit: string,
    private readonly sudo: boolean,
  ) {}

  async status(): Promise<UnitStatus> {
    const result = await this.exec("systemctl", [
      "show",
      this.unit,
      "--timestamp=unix",
      "--property=ActiveState,Result,ActiveEnterTimestamp",
    ]);
    if (result.code !== 0) {
      throw new ControlError(result.stderr.trim() || `systemctl show exited with ${result.code}`);
    }
    const props = new Map(
      result.stdout
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
    const activity = SYSTEMD_ACTIVITY[props.get("ActiveState") ?? ""] ?? "inactive";
    const entered = /^@(\d+)$/.exec(props.get("ActiveEnterTimestamp") ?? "");
    const running = activity === "active" || activity === "deactivating";
    return {
      activity,
      since: running && entered?.[1] ? new Date(Number(entered[1]) * 1000) : null,
      detail: activity === "failed" ? `systemd unit failed (result: ${props.get("Result") ?? "unknown"})` : null,
    };
  }

  start() {
    return this.systemctl("start");
  }

  stop() {
    return this.systemctl("stop");
  }

  restart() {
    return this.systemctl("restart");
  }

  private async systemctl(action: "start" | "stop" | "restart") {
    // --no-block: queue the job and return; progress shows up in status().
    const args = ["--no-block", action, this.unit];
    const result = this.sudo
      ? await this.exec("sudo", ["-n", "systemctl", ...args])
      : await this.exec("systemctl", args);
    if (result.code !== 0) {
      throw new ControlError(result.stderr.trim() || `systemctl ${action} exited with ${result.code}`);
    }
  }
}

export interface TmuxControlOptions {
  directory: string;
  startCommand: string;
  stopCommand: string;
  stopTimeoutMs: number;
  pollMs?: number;
}

/** Runs the server directly in a tmux session owned by the panel's user (no service manager). */
export class TmuxControl implements ServiceControl {
  private stopping: Promise<void> | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly session: TmuxSession,
    private readonly options: TmuxControlOptions,
  ) {}

  async status(): Promise<UnitStatus> {
    const detail = this.lastError;
    if (!(await this.session.exists())) return { activity: "inactive", since: null, detail };
    return {
      activity: this.stopping ? "deactivating" : "active",
      since: await this.session.createdAt(),
      detail,
    };
  }

  async start(): Promise<void> {
    if (await this.session.exists()) throw new ControlError("The server is already running");
    this.lastError = null;
    await this.session.create(this.options.directory, this.options.startCommand);
  }

  async stop(): Promise<void> {
    if (!(await this.session.exists())) throw new ControlError("The server is not running");
    this.runInBackground(() => this.stopAndWait());
  }

  async restart(): Promise<void> {
    if (!(await this.session.exists())) return this.start();
    this.runInBackground(async () => {
      await this.stopAndWait();
      await this.session.create(this.options.directory, this.options.startCommand);
    });
  }

  /** Resolves once a background stop/restart has finished (immediately if none runs). */
  async idle(): Promise<void> {
    await this.stopping;
  }

  private runInBackground(task: () => Promise<void>) {
    if (this.stopping) throw new ControlError("The server is already stopping");
    this.lastError = null;
    this.stopping = task()
      .catch((err: unknown) => {
        this.lastError = (err as Error).message;
      })
      .finally(() => {
        this.stopping = null;
      });
  }

  private async stopAndWait() {
    await this.session.sendLine(this.options.stopCommand);
    const deadline = Date.now() + this.options.stopTimeoutMs;
    while (Date.now() < deadline) {
      if (!(await this.session.exists())) return;
      await sleep(this.options.pollMs ?? 500);
    }
    await this.session.kill();
    this.lastError = `The server did not stop within ${this.options.stopTimeoutMs / 1000}s and was killed`;
  }
}

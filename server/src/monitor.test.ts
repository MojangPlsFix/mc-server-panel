import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import type { PingInfo } from "@shared/types.js";

import { ControlError, type ServiceControl, type UnitActivity } from "./control.js";
import type { TailerEvents } from "./logs.js";
import { StatusMonitor } from "./monitor.js";

const PING: PingInfo = {
  version: "1.20.1",
  protocol: 763,
  motd: "hi",
  playersOnline: 0,
  playersMax: 20,
  players: [],
  latencyMs: 1,
};

/** A scripted world: tests flip `activity`, `pingOk` and `tailer.ready` between refreshes. */
function setup() {
  const world = { activity: "inactive" as UnitActivity, pingOk: false, now: 0, actions: [] as string[] };
  const control: ServiceControl = {
    status: async () => ({ activity: world.activity, since: null, detail: null }),
    start: async () => void world.actions.push("start"),
    stop: async () => void world.actions.push("stop"),
    restart: async () => void world.actions.push("restart"),
  };
  const tailer = Object.assign(new EventEmitter<TailerEvents>(), { ready: false });
  const monitor = new StatusMonitor({
    name: "Test",
    control,
    session: { panePid: async () => null },
    tailer,
    ping: async () => {
      if (!world.pingOk) throw new Error("offline");
      return PING;
    },
    hostInfo: async () => null,
    clock: () => world.now,
  });
  return { world, tailer, monitor };
}

describe("StatusMonitor", () => {
  it("derives the state from the unit and the ping", async () => {
    const { world, monitor } = setup();
    await monitor.refresh();
    expect(monitor.status.state).toBe("stopped");
    world.activity = "active";
    await monitor.refresh();
    expect(monitor.status.state).toBe("starting");
    world.pingOk = true;
    await monitor.refresh();
    expect(monitor.status).toMatchObject({ state: "running", ping: PING });
    world.activity = "deactivating";
    await monitor.refresh();
    expect(monitor.status).toMatchObject({ state: "stopping", ping: null });
  });

  it("treats the log's Done line as running only after a fresh log", async () => {
    const { world, tailer, monitor } = setup();
    tailer.ready = true; // Done line from the previous run
    await monitor.refresh();
    world.activity = "active";
    await monitor.refresh();
    expect(monitor.status.state).toBe("starting");
    tailer.emit("reset"); // server rotated latest.log on start
    tailer.ready = true; // and logged Done again
    await monitor.refresh();
    expect(monitor.status.state).toBe("running");
  });

  it("does not trust the previous run's Done line during a restart", async () => {
    const { world, tailer, monitor } = setup();
    world.activity = "active";
    tailer.ready = true; // panel started while the server was already running
    await monitor.refresh();
    expect(monitor.status.state).toBe("running");

    // systemd restart: deactivating -> activating -> active, never "inactive" between polls,
    // while the old latest.log (with its Done line) has not been rotated yet.
    await monitor.perform("restart");
    world.activity = "deactivating";
    await monitor.refresh();
    world.activity = "active";
    await monitor.refresh();
    expect(monitor.status).toMatchObject({ state: "starting", pending: "restart" });

    tailer.emit("reset");
    tailer.ready = false;
    await monitor.refresh();
    expect(monitor.status.state).toBe("starting");
    tailer.ready = true; // new run logged Done
    await monitor.refresh();
    expect(monitor.status).toMatchObject({ state: "running", pending: null });
  });

  it("keeps a start pending until the server runs", async () => {
    const { world, monitor } = setup();
    await monitor.perform("start");
    expect(world.actions).toEqual(["start"]);
    expect(monitor.status.pending).toBe("start");
    world.activity = "active";
    await monitor.refresh();
    expect(monitor.status).toMatchObject({ state: "starting", pending: "start" });
    world.pingOk = true;
    await monitor.refresh();
    expect(monitor.status).toMatchObject({ state: "running", pending: null, error: null });
  });

  it("only finishes a restart after the server was down in between", async () => {
    const { world, monitor } = setup();
    world.activity = "active";
    world.pingOk = true;
    await monitor.perform("restart");
    expect(monitor.status).toMatchObject({ state: "running", pending: "restart" });
    world.activity = "deactivating";
    await monitor.refresh();
    expect(monitor.status).toMatchObject({ state: "stopping", pending: "restart" });
    world.activity = "activating";
    await monitor.refresh();
    expect(monitor.status).toMatchObject({ state: "starting", pending: "restart" });
    world.activity = "active";
    await monitor.refresh();
    expect(monitor.status).toMatchObject({ state: "running", pending: null });
  });

  it("shows stopping as soon as a stop is requested", async () => {
    const { world, monitor } = setup();
    world.activity = "active";
    world.pingOk = true;
    await monitor.perform("stop");
    expect(monitor.status).toMatchObject({ state: "stopping", pending: "stop" });
    world.activity = "inactive";
    await monitor.refresh();
    expect(monitor.status).toMatchObject({ state: "stopped", pending: null });
  });

  it("reports a server that dies right after starting", async () => {
    const { world, monitor } = setup();
    await monitor.perform("start");
    world.now = 20_000;
    await monitor.refresh();
    expect(monitor.status).toMatchObject({ state: "stopped", pending: null });
    expect(monitor.status.error).toMatch(/stopped right after starting/);
  });

  it("rejects actions that make no sense in the current state", async () => {
    const { world, monitor } = setup();
    await expect(monitor.perform("stop")).rejects.toThrow(ControlError);
    await monitor.perform("start");
    await expect(monitor.perform("start")).rejects.toThrow(/Still busy/);
    world.activity = "active";
    world.pingOk = true;
    await monitor.refresh();
    await expect(monitor.perform("start")).rejects.toThrow(/Cannot start while the server is running/);
    expect(world.actions).toEqual(["start"]);
  });

  it("reports state unknown when the service manager cannot be asked", async () => {
    const broken = new StatusMonitor({
      name: "x",
      control: { ...({} as ServiceControl), status: async () => Promise.reject(new Error("no systemctl")) },
      session: { panePid: async () => null },
      tailer: Object.assign(new EventEmitter<TailerEvents>(), { ready: false }),
      ping: async () => PING,
      hostInfo: async () => null,
    });
    await broken.refresh();
    expect(broken.status).toMatchObject({ state: "unknown", error: "no systemctl" });
  });
});

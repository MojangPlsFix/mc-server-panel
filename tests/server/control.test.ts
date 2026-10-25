import { describe, expect, it } from "vitest";

import { ControlError, SystemdControl, TmuxControl } from "../../server/src/control.js";
import type { Exec, ExecResult } from "../../server/src/exec.js";
import type { TmuxSession } from "../../server/src/tmux.js";

function fakeExec(results: Record<string, Partial<ExecResult>>) {
  const calls: string[] = [];
  const exec: Exec = async (file, args) => {
    const call = [file, ...args].join(" ");
    calls.push(call);
    const match = Object.entries(results).find(([prefix]) => call.startsWith(prefix))?.[1] ?? {};
    return { code: 0, stdout: "", stderr: "", ...match };
  };
  return { exec, calls };
}

describe("SystemdControl", () => {
  it("maps systemd state and start time", async () => {
    const { exec } = fakeExec({
      "systemctl show": { stdout: "ActiveState=active\nResult=success\nActiveEnterTimestamp=@1761380539\n" },
    });
    expect(await new SystemdControl(exec, "mc", true).status()).toEqual({
      activity: "active",
      since: new Date(1761380539 * 1000),
      detail: null,
    });
  });

  it("reports why a unit failed and drops the start time when stopped", async () => {
    const { exec } = fakeExec({
      "systemctl show": {
        stdout: "ActiveState=failed\nResult=exit-code\nActiveEnterTimestamp=@1761380539\n",
      },
    });
    expect(await new SystemdControl(exec, "mc", true).status()).toEqual({
      activity: "failed",
      since: null,
      detail: "systemd unit failed (result: exit-code)",
    });
  });

  it("queues jobs without blocking, through sudo when configured", async () => {
    const withSudo = fakeExec({});
    await new SystemdControl(withSudo.exec, "minecraft", true).stop();
    const withoutSudo = fakeExec({});
    await new SystemdControl(withoutSudo.exec, "minecraft", false).restart();
    expect(withSudo.calls).toEqual(["sudo -n systemctl --no-block stop minecraft"]);
    expect(withoutSudo.calls).toEqual(["systemctl --no-block restart minecraft"]);
  });

  it("surfaces sudo/systemctl errors", async () => {
    const { exec } = fakeExec({ sudo: { code: 1, stderr: "sudo: a password is required\n" } });
    await expect(new SystemdControl(exec, "minecraft", true).start()).rejects.toThrow(
      new ControlError("sudo: a password is required"),
    );
  });
});

/** In-memory tmux session; `stop` (the console command) ends it after `exitAfterChecks` polls. */
class FakeSession {
  alive = false;
  sent: string[] = [];
  created: string[] = [];
  killed = false;
  private checksUntilExit = Infinity;

  constructor(private readonly exitAfterChecks: number) {}

  async exists() {
    if (this.alive && --this.checksUntilExit <= 0) this.alive = false;
    return this.alive;
  }
  async create(_dir: string, command: string) {
    this.alive = true;
    this.checksUntilExit = Infinity;
    this.created.push(command);
  }
  async sendLine(text: string) {
    this.sent.push(text);
    if (text === "stop") this.checksUntilExit = this.exitAfterChecks;
  }
  async createdAt() {
    return new Date(0);
  }
  async kill() {
    this.killed = true;
    this.alive = false;
  }
}

function tmuxControl(session: FakeSession, stopTimeoutMs = 5000) {
  return new TmuxControl(session as unknown as TmuxSession, {
    directory: "/srv/mc",
    startCommand: "./run.sh",
    stopCommand: "stop",
    stopTimeoutMs,
    pollMs: 1,
  });
}

describe("TmuxControl", () => {
  it("starts the server in the session and refuses a second start", async () => {
    const session = new FakeSession(3);
    const control = tmuxControl(session);
    await control.start();
    expect(session.created).toEqual(["./run.sh"]);
    expect((await control.status()).activity).toBe("active");
    await expect(control.start()).rejects.toThrow(ControlError);
  });

  it("stops gracefully with the stop command", async () => {
    const session = new FakeSession(3);
    const control = tmuxControl(session);
    await control.start();
    await control.stop();
    expect(session.sent).toEqual(["stop"]);
    await control.idle();
    expect(await control.status()).toMatchObject({ activity: "inactive", detail: null });
    expect(session.killed).toBe(false);
  });

  it("kills the session when the server ignores stop", async () => {
    const session = new FakeSession(Infinity);
    // A 20 ms real timeout: the deadline is wall-clock based by design (Date.now + sleep).
    const control = tmuxControl(session, 20);
    await control.start();
    await control.stop();
    await control.idle();
    expect(session.killed).toBe(true);
    expect((await control.status()).detail).toMatch(/did not stop/);
  });

  it("restarts by stopping and starting again", async () => {
    const session = new FakeSession(2);
    const control = tmuxControl(session);
    await control.start();
    await control.restart();
    await control.idle();
    expect(session.created).toEqual(["./run.sh", "./run.sh"]);
    expect((await control.status()).activity).toBe("active");
  });

  it("refuses to stop a server that is not running", async () => {
    await expect(tmuxControl(new FakeSession(1)).stop()).rejects.toThrow(ControlError);
  });
});

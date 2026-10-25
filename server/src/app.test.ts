import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ServerAction, ServerState, StatusSnapshot } from "@shared/types.js";

import { type AppDeps, buildApp, SESSION_COOKIE } from "./app.js";
import { generateSecret, hashPassword, LoginLimiter } from "./auth.js";
import type { Config } from "./config.js";
import { ControlError } from "./control.js";

const PASSWORD = "hunter2-but-longer";

class FakeMonitor extends EventEmitter<{ status: [StatusSnapshot] }> {
  state: ServerState = "stopped";
  actions: ServerAction[] = [];
  get status(): StatusSnapshot {
    return {
      name: "Test",
      state: this.state,
      since: null,
      pending: null,
      ping: null,
      process: null,
      host: null,
      error: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
  }
  async perform(action: ServerAction) {
    if (action === "stop" && this.state === "stopped") throw new ControlError("Cannot stop while the server is stopped");
    this.actions.push(action);
  }
}

let app: FastifyInstance;
let logDir: string;
let monitor: FakeMonitor;
let sent: string[];

beforeEach(async () => {
  logDir = mkdtempSync(path.join(os.tmpdir(), "mcp-app-"));
  writeFileSync(path.join(logDir, "latest.log"), "one\ntwo\n");
  monitor = new FakeMonitor();
  sent = [];
  const config = {
    listen: { host: "127.0.0.1", port: 0 },
    server: { name: "Test", logFile: "latest.log" },
    auth: {
      passwordHash: await hashPassword(PASSWORD),
      sessionSecret: generateSecret(),
      sessionDays: 1,
      secureCookie: false,
    },
  } as Config;
  const deps: AppDeps = {
    config,
    monitor,
    session: { sendLine: async (text) => void sent.push(text) },
    tailer: Object.assign(new EventEmitter<{ lines: [string[]]; reset: [] }>(), { recent: ["one", "two"] }),
    logDirectory: logDir,
    limiter: new LoginLimiter(3, 60_000),
  };
  app = await buildApp(deps);
});

afterEach(async () => {
  await app.close();
  rmSync(logDir, { recursive: true, force: true });
});

async function login(): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: PASSWORD } });
  expect(response.statusCode).toBe(204);
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });
  return `${SESSION_COOKIE}=${cookie?.value}`;
}

describe("authentication", () => {
  it("guards every API route except health, login and session", async () => {
    for (const [method, url] of [
      ["GET", "/api/status"],
      ["POST", "/api/server/start"],
      ["POST", "/api/console"],
      ["GET", "/api/logs"],
      ["GET", "/api/logs/latest.log"],
      ["GET", "/api/ws"],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    }
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/auth/session" })).json()).toEqual({
      authenticated: false,
      name: "Test",
    });
  });

  it("logs in with the right password and accepts the session cookie", async () => {
    const cookie = await login();
    const status = await app.inject({ method: "GET", url: "/api/status", headers: { cookie } });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ state: "stopped" });
    const session = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } });
    expect(session.json()).toMatchObject({ authenticated: true });
  });

  it("rejects wrong passwords and rate-limits repeated failures", async () => {
    for (let i = 0; i < 3; i++) {
      const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "nope" } });
      expect(response.statusCode).toBe(401);
    }
    const blocked = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: PASSWORD } });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("rejects forged cookies", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/status",
      headers: { cookie: `${SESSION_COOKIE}=eyJleHAiOjk5OTk5OTk5OTk5OTl9.c2lnbmF0dXJl` },
    });
    expect(response.statusCode).toBe(401);
  });

  it("logout clears the cookie", async () => {
    const cookie = await login();
    const response = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(response.statusCode).toBe(204);
    expect(response.cookies.find((c) => c.name === SESSION_COOKIE)?.value).toBe("");
  });
});

describe("server actions", () => {
  it("passes valid actions to the monitor and maps refusals to 409", async () => {
    const cookie = await login();
    const start = await app.inject({ method: "POST", url: "/api/server/start", headers: { cookie } });
    expect(start.statusCode).toBe(202);
    const stop = await app.inject({ method: "POST", url: "/api/server/stop", headers: { cookie } });
    expect(stop.statusCode).toBe(409);
    expect(stop.json()).toEqual({ error: "Cannot stop while the server is stopped" });
    const bogus = await app.inject({ method: "POST", url: "/api/server/explode", headers: { cookie } });
    expect(bogus.statusCode).toBe(400);
    expect(monitor.actions).toEqual(["start"]);
  });
});

describe("console", () => {
  it("sends commands to the server only while it runs", async () => {
    const cookie = await login();
    const post = (command: string) =>
      app.inject({ method: "POST", url: "/api/console", headers: { cookie }, payload: { command } });
    expect((await post("list")).statusCode).toBe(409);
    monitor.state = "running";
    expect((await post("  say hello  ")).statusCode).toBe(204);
    expect((await post("")).statusCode).toBe(400);
    expect((await post("say a\nstop")).statusCode).toBe(400);
    expect((await post("x".repeat(1001))).statusCode).toBe(400);
    expect(sent).toEqual(["say hello"]);
  });
});

describe("logs", () => {
  it("lists and reads log files but nothing outside the log directory", async () => {
    const cookie = await login();
    const list = await app.inject({ method: "GET", url: "/api/logs", headers: { cookie } });
    expect(list.json()).toEqual([expect.objectContaining({ name: "latest.log", live: true })]);
    const content = await app.inject({ method: "GET", url: "/api/logs/latest.log?lines=1", headers: { cookie } });
    expect(content.json()).toEqual({ name: "latest.log", lines: ["two"], totalLines: 2, truncated: true });
    for (const url of ["/api/logs/..%2Fsecret.log", "/api/logs/%2E%2E", "/api/logs/missing.log/raw"]) {
      expect((await app.inject({ method: "GET", url, headers: { cookie } })).statusCode, url).toBe(404);
    }
    const raw = await app.inject({ method: "GET", url: "/api/logs/latest.log/raw", headers: { cookie } });
    expect(raw.body).toBe("one\ntwo\n");
    expect(raw.headers["content-disposition"]).toBe('attachment; filename="latest.log"');
  });
});

describe("security headers", () => {
  it("sets a content security policy and nosniff", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});

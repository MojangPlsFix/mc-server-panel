import type { EventEmitter } from "node:events";
import { createReadStream } from "node:fs";

import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyRequest, LogController } from "fastify";

import type { ServerAction, StatusSnapshot, WsMessage } from "@shared/types.js";

import { createSessionToken, LoginLimiter, verifyPassword, verifySessionToken } from "./auth.js";
import type { Config } from "./config.js";
import { ControlError } from "./control.js";
import { type LogTailer, listLogFiles, readLogTail, resolveLogFile, type TailerEvents } from "./logs.js";
import type { MonitorEvents, StatusMonitor } from "./monitor.js";
import type { TmuxSession } from "./tmux.js";

export interface AppDeps {
  config: Config;
  monitor: EventEmitter<MonitorEvents> & Pick<StatusMonitor, "status" | "perform">;
  session: Pick<TmuxSession, "sendLine">;
  tailer: EventEmitter<TailerEvents> & Pick<LogTailer, "recent">;
  logDirectory: string;
  /** Built web UI; omitted in tests and when running the UI through the Vite dev server. */
  publicDirectory?: string;
  limiter?: LoginLimiter;
  logger?: boolean | { level: string };
}

export const SESSION_COOKIE = "mcp_session";
const MAX_COMMAND_LENGTH = 1000;
// Rejecting control characters is the point: a newline would inject a second console command.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data: https://mc-heads.net",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, monitor, session, tailer, logDirectory } = deps;
  const limiter = deps.limiter ?? new LoginLimiter();
  const app = Fastify({
    logger: deps.logger ?? false,
    // Requests are not logged; logins, actions and console commands are logged explicitly below.
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 16 * 1024,
  });

  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 1024 } });

  const authenticated = (request: FastifyRequest) =>
    verifySessionToken(config.auth.sessionSecret, request.cookies[SESSION_COOKIE]);

  app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  });

  // --- Public routes ---------------------------------------------------------------------------

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/auth/session", async (request) => ({
    authenticated: authenticated(request),
    name: config.server.name,
  }));

  app.post<{ Body: { password: string } }>(
    "/api/auth/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["password"],
          properties: { password: { type: "string", minLength: 1, maxLength: 1024 } },
        },
      },
    },
    async (request, reply) => {
      const wait = limiter.retryAfter(request.ip);
      if (wait > 0) {
        const seconds = Math.ceil(wait / 1000);
        reply.header("Retry-After", String(seconds));
        return reply.code(429).send({ error: `Too many failed attempts. Try again in ${seconds}s.` });
      }
      if (!(await verifyPassword(request.body.password, config.auth.passwordHash))) {
        limiter.recordFailure(request.ip);
        app.log.warn({ ip: request.ip }, "failed login");
        return reply.code(401).send({ error: "Wrong password" });
      }
      limiter.reset(request.ip);
      const lifetimeMs = config.auth.sessionDays * 86_400_000;
      reply.setCookie(SESSION_COOKIE, createSessionToken(config.auth.sessionSecret, lifetimeMs), {
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        secure: config.auth.secureCookie,
        maxAge: Math.floor(lifetimeMs / 1000),
      });
      app.log.info({ ip: request.ip }, "login");
      return reply.code(204).send();
    },
  );

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  // --- Protected routes ------------------------------------------------------------------------
  // Authorization is attached to the routes themselves (an encapsulated scope with its own hook),
  // not derived from request.url: the router decodes percent-encoded paths, so URL-prefix checks
  // could be bypassed with e.g. /%61pi/status. Every route registered below requires a session.
  await app.register(async (api) => {
    api.addHook("onRequest", async (request, reply) => {
      if (!authenticated(request)) return reply.code(401).send({ error: "Not logged in" });
    });

    api.get("/api/status", async () => monitor.status);

    api.post<{ Params: { action: ServerAction } }>(
      "/api/server/:action",
      {
        schema: {
          params: {
            type: "object",
            properties: { action: { type: "string", enum: ["start", "stop", "restart"] } },
          },
        },
      },
      async (request, reply) => {
        const { action } = request.params;
        try {
          await monitor.perform(action);
        } catch (err) {
          if (err instanceof ControlError) return reply.code(409).send({ error: err.message });
          app.log.error({ err, action }, "server action failed");
          return reply.code(500).send({ error: (err as Error).message });
        }
        app.log.info({ ip: request.ip, action }, "server action");
        return reply.code(202).send(monitor.status);
      },
    );

    api.post<{ Body: { command: string } }>(
      "/api/console",
      {
        schema: {
          body: {
            type: "object",
            required: ["command"],
            properties: { command: { type: "string" } },
          },
        },
      },
      async (request, reply) => {
        const command = request.body.command.trim();
        if (!command || command.length > MAX_COMMAND_LENGTH || CONTROL_CHARS.test(command)) {
          return reply
            .code(400)
            .send({ error: `Commands must be 1-${MAX_COMMAND_LENGTH} printable characters` });
        }
        if (!["starting", "running"].includes(monitor.status.state)) {
          return reply.code(409).send({ error: "The server is not running" });
        }
        await session.sendLine(command);
        app.log.info({ ip: request.ip, command }, "console command");
        return reply.code(204).send();
      },
    );

    api.get("/api/logs", async () => listLogFiles(logDirectory, config.server.logFile));

    api.get<{ Params: { name: string }; Querystring: { lines?: number } }>(
      "/api/logs/:name",
      {
        schema: {
          querystring: {
            type: "object",
            properties: { lines: { type: "integer", minimum: 1, maximum: 50_000 } },
          },
        },
      },
      async (request, reply) => {
        const file = await resolveLogFile(logDirectory, request.params.name);
        if (!file) return reply.code(404).send({ error: "No such log file" });
        return readLogTail(file, request.query.lines ?? 2000);
      },
    );

    api.get<{ Params: { name: string } }>("/api/logs/:name/raw", async (request, reply) => {
      const file = await resolveLogFile(logDirectory, request.params.name);
      if (!file) return reply.code(404).send({ error: "No such log file" });
      const gzip = file.endsWith(".gz");
      return reply
        .header("Content-Type", gzip ? "application/gzip" : "text/plain; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${request.params.name}"`)
        .send(createReadStream(file));
    });

    api.get(
      "/api/ws",
      {
        websocket: true,
        preValidation: async (request, reply) => {
          // Browsers always send Origin on WebSocket handshakes; refuse other sites.
          const origin = request.headers.origin;
          if (origin && new URL(origin).host !== request.headers.host) {
            return reply.code(403).send({ error: "Cross-origin WebSocket refused" });
          }
        },
      },
      (socket) => {
        const send = (message: WsMessage) => socket.send(JSON.stringify(message));
        const onStatus = (status: StatusSnapshot) => send({ type: "status", status });
        const onLines = (lines: string[]) => send({ type: "log", lines });
        const onReset = () => send({ type: "log-reset" });
        monitor.on("status", onStatus);
        tailer.on("lines", onLines);
        tailer.on("reset", onReset);
        socket.on("close", () => {
          monitor.off("status", onStatus);
          tailer.off("lines", onLines);
          tailer.off("reset", onReset);
        });
        send({ type: "hello", status: monitor.status, lines: [...tailer.recent] });
      },
    );
  });

  // --- Web UI ------------------------------------------------------------------------------------

  if (deps.publicDirectory) {
    await app.register(fastifyStatic, { root: deps.publicDirectory, wildcard: true });
  }
  app.setNotFoundHandler((request, reply) => {
    const wantsPage = request.method === "GET" && !request.url.startsWith("/api/");
    if (deps.publicDirectory && wantsPage) return reply.sendFile("index.html");
    return reply.code(404).send({ error: "Not found" });
  });

  return app;
}

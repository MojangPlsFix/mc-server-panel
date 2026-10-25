import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const SystemdControl = z.object({
  type: z.literal("systemd"),
  /** systemd unit that runs the server, e.g. "minecraft" or "minecraft.service". */
  unit: z.string().min(1),
  /** Call systemctl through `sudo -n` (needs a sudoers rule, see deploy/). */
  sudo: z.boolean().default(true),
});

const TmuxControl = z.object({
  type: z.literal("tmux"),
  /** Command the panel runs inside the tmux session to start the server. */
  startCommand: z.string().min(1),
  /** Console command that stops the server gracefully. */
  stopCommand: z.string().min(1).default("stop"),
  /** After this many seconds the tmux session is killed. */
  stopTimeoutSeconds: z.number().int().positive().default(120),
});

export const ConfigSchema = z.object({
  listen: z
    .object({
      host: z.string().default("0.0.0.0"),
      port: z.number().int().min(1).max(65535).default(8080),
      /**
       * Behind a reverse proxy: the proxy's address(es), e.g. "127.0.0.1", so logs and the login limit see the
       * real client IP from X-Forwarded-For. Only trust addresses that are actually your proxy.
       */
      trustProxy: z.union([z.boolean(), z.string()]).default(false),
    })
    .prefault({}),
  server: z.object({
    /** Display name in the panel. */
    name: z.string().min(1).default("Minecraft"),
    /** Server working directory (contains logs/, world/, ...). */
    directory: z.string().min(1),
    /** Log directory, relative to `directory` unless absolute. */
    logDirectory: z.string().default("logs"),
    /** The file the server is currently writing, inside `logDirectory`. */
    logFile: z.string().default("latest.log"),
    /** tmux session that holds the server console. */
    tmuxSession: z.string().min(1).default("minecraft"),
    /** Optional tmux socket path (tmux -S); default is the user's default socket. */
    tmuxSocket: z.string().optional(),
    /** Address used for the Server List Ping (status, players). */
    address: z
      .object({
        host: z.string().default("127.0.0.1"),
        port: z.number().int().min(1).max(65535).default(25565),
      })
      .prefault({}),
    control: z.discriminatedUnion("type", [SystemdControl, TmuxControl]),
  }),
  auth: z.object({
    /** scrypt hash, written by `node server.js set-password`. */
    passwordHash: z.string().min(1),
    /** Secret for signing session cookies (min. 32 chars). Changing it logs everyone out. */
    sessionSecret: z.string().min(32),
    sessionDays: z.number().positive().default(30),
    /** Set when the panel is served over HTTPS (e.g. behind a reverse proxy). */
    secureCookie: z.boolean().default(false),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ControlConfig = Config["server"]["control"];

export class ConfigError extends Error {}

export function defaultConfigPath(): string {
  return process.env.MC_PANEL_CONFIG ?? path.resolve("config.json");
}

export async function loadConfig(file: string): Promise<Config> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    throw new ConfigError(`Cannot read config ${file}: ${(err as Error).message}`);
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(`Invalid config ${file}:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** Absolute path of the log directory. */
export function logDirectoryOf(config: Config): string {
  return path.resolve(config.server.directory, config.server.logDirectory);
}

/** Merges auth fields into the config file without touching other settings. The file ends up mode 0600. */
export async function writeAuth(file: string, auth: { passwordHash: string; sessionSecret?: string }) {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const current = (raw.auth ?? {}) as Record<string, unknown>;
  raw.auth = {
    ...current,
    passwordHash: auth.passwordHash,
    sessionSecret: auth.sessionSecret ?? current.sessionSecret,
  };
  // `mode` only applies when the file is created; an existing file (e.g. a copied 0644 example) is made
  // private first so the credentials are never written into a readable file. chmod keeps the owner.
  await chmod(file, 0o600).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err;
  });
  await writeFile(file, JSON.stringify(raw, null, 2) + "\n", { mode: 0o600 });
}

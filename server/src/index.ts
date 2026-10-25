import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { buildApp } from "./app.js";
import { setPassword } from "./cli.js";
import { ConfigError, defaultConfigPath, loadConfig, logDirectoryOf } from "./config.js";
import { type ServiceControl, SystemdControl, TmuxControl } from "./control.js";
import { exec } from "./exec.js";
import { LogTailer } from "./logs.js";
import { StatusMonitor } from "./monitor.js";
import { pingServer } from "./slp.js";
import { TmuxSession } from "./tmux.js";

const USAGE = `Usage:
  node server.js [--config <file>]               start the panel
  node server.js set-password [--config <file>]  set the login password

The config file defaults to $MC_PANEL_CONFIG or ./config.json.`;

async function serve(configFile: string) {
  const config = await loadConfig(configFile);
  const { server } = config;
  const session = new TmuxSession(exec, server.tmuxSession, server.tmuxSocket);
  const control: ServiceControl =
    server.control.type === "systemd"
      ? new SystemdControl(exec, server.control.unit, server.control.sudo)
      : new TmuxControl(session, {
          directory: server.directory,
          startCommand: server.control.startCommand,
          stopCommand: server.control.stopCommand,
          stopTimeoutMs: server.control.stopTimeoutSeconds * 1000,
        });
  const logDirectory = logDirectoryOf(config);
  const tailer = new LogTailer(path.join(logDirectory, server.logFile));
  const monitor = new StatusMonitor({
    name: server.name,
    control,
    session,
    tailer,
    ping: () => pingServer(server.address.host, server.address.port),
  });
  const publicDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");

  const app = await buildApp({
    config,
    monitor,
    session,
    tailer,
    logDirectory,
    publicDirectory: existsSync(publicDirectory) ? publicDirectory : undefined,
    logger: { level: "info" },
  });

  tailer.start();
  monitor.start();
  await app.listen({ host: config.listen.host, port: config.listen.port });

  const shutdown = async () => {
    monitor.stop();
    tailer.stop();
    await app.close();
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { config: { type: "string" }, help: { type: "boolean", short: "h" } },
  });
  if (values.help) return console.log(USAGE);
  const configFile = path.resolve(values.config ?? defaultConfigPath());
  const [command = "serve"] = positionals;
  if (command === "serve") return serve(configFile);
  if (command === "set-password") return setPassword(configFile);
  throw new ConfigError(`Unknown command "${command}"\n\n${USAGE}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
});

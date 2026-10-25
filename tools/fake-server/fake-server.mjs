#!/usr/bin/env node
// A stand-in for a Minecraft server, used by the dev sandbox and the end-to-end tests.
// It behaves like the parts of a real server the panel touches:
//  - rotates logs/latest.log into a dated .log.gz on start, then logs in Forge format
//  - answers the Server List Ping (status + player sample) on FAKE_PORT
//  - reads console commands from stdin (list, say, save-*, stop, help, ...)
// Test-only commands: fake:join <name>, fake:leave <name>, fake:warn <msg>, fake:error <msg>, fake:crash
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import { gzipSync } from "node:zlib";

const dir = process.env.FAKE_DIR ?? process.cwd();
const port = Number(process.env.FAKE_PORT ?? 25565);
const version = process.env.FAKE_VERSION ?? "1.20.1";
const motd = process.env.FAKE_MOTD ?? "A Fake Minecraft Server";
const maxPlayers = Number(process.env.FAKE_MAX_PLAYERS ?? 20);
const startupMs = Number(process.env.FAKE_STARTUP_MS ?? 1500);

const logDir = path.join(dir, "logs");
const latest = path.join(logDir, "latest.log");
const players = new Map();

function rotateLatestLog() {
  mkdirSync(logDir, { recursive: true });
  if (!existsSync(latest)) return;
  const day = new Date().toISOString().slice(0, 10);
  let n = 1;
  while (existsSync(path.join(logDir, `${day}-${n}.log.gz`))) n++;
  writeFileSync(path.join(logDir, `${day}-${n}.log.gz`), gzipSync(readFileSync(latest)));
  rmSync(latest);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function stamp(date = new Date()) {
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return (
    `${pad(date.getDate())}${MONTHS[date.getMonth()]}${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
  );
}

function log(level, message, { thread = "Server thread", source = "net.minecraft.server.MinecraftServer/" } = {}) {
  const line = `[${stamp()}] [${thread}/${level}] [${source}]: ${message}`;
  appendFileSync(latest, line + "\n");
  process.stdout.write(line + "\n");
}

function offlineUuid(name) {
  const hex = createHash("md5").update(`OfflinePlayer:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-3${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// --- Server List Ping -------------------------------------------------------------------------

function varInt(value) {
  const bytes = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return Buffer.from(bytes);
}

function readVarInt(buf, offset) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (offset + i >= buf.length) return null;
    const byte = buf[offset + i];
    value |= (byte & 0x7f) << (7 * i);
    if ((byte & 0x80) === 0) return { value, size: i + 1 };
  }
  return null;
}

function frame(id, payload) {
  const body = Buffer.concat([varInt(id), payload]);
  return Buffer.concat([varInt(body.length), body]);
}

function statusJson() {
  return JSON.stringify({
    version: { name: version, protocol: 763 },
    players: {
      max: maxPlayers,
      online: players.size,
      sample: [...players.values()],
    },
    description: { text: motd },
  });
}

const slp = net.createServer((socket) => {
  let buffer = Buffer.alloc(0);
  socket.on("error", () => {});
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const length = readVarInt(buffer, 0);
      if (!length || buffer.length < length.size + length.value) return;
      const body = buffer.subarray(length.size, length.size + length.value);
      buffer = buffer.subarray(length.size + length.value);
      const id = readVarInt(body, 0);
      if (!id) return;
      if (id.value === 0x00 && body.length === 1) {
        const json = Buffer.from(statusJson(), "utf8");
        socket.write(frame(0x00, Buffer.concat([varInt(json.length), json])));
      } else if (id.value === 0x01) {
        socket.end(frame(0x01, body.subarray(id.size)));
      }
      // other packets (the handshake) need no answer
    }
  });
});

// --- Console ----------------------------------------------------------------------------------

let running = false;

function stop(code = 0) {
  log("INFO", "Stopping server");
  log("INFO", "Saving players");
  log("INFO", "Saving worlds");
  log("INFO", "ThreadedAnvilChunkStorage: All dimensions are saved");
  slp.close();
  setTimeout(() => process.exit(code), 300);
}

function handle(input) {
  const line = input.trim();
  if (!line) return;
  const [command = "", ...rest] = line.replace(/^\//, "").split(" ");
  const arg = rest.join(" ");
  switch (command) {
    case "list": {
      const names = [...players.values()].map((p) => p.name).join(", ");
      return log("INFO", `There are ${players.size} of a max of ${maxPlayers} players online: ${names}`);
    }
    case "say":
      return log("INFO", `[Server] ${arg}`);
    case "save-all":
      log("INFO", "Saving the game (this may take a moment!)");
      return log("INFO", "Saved the game");
    case "save-off":
      return log("INFO", "Automatic saving is now disabled");
    case "save-on":
      return log("INFO", "Automatic saving is now enabled");
    case "help":
      for (const help of ["/list", "/say <message>", "/save-all [flush]", "/stop"]) log("INFO", help);
      return;
    case "stop":
      return stop(0);
    case "fake:join":
      players.set(arg, { name: arg, id: offlineUuid(arg) });
      return log("INFO", `${arg} joined the game`);
    case "fake:leave":
      players.delete(arg);
      return log("INFO", `${arg} left the game`);
    case "fake:warn":
      return log("WARN", arg);
    case "fake:error":
      log("ERROR", arg, { source: "fake.test/" });
      appendFileSync(latest, "java.lang.IllegalStateException: " + arg + "\n\tat fake.Test.run(Test.java:42)\n");
      return;
    case "fake:crash":
      log("FATAL", "Simulated crash", { source: "fake.test/" });
      return setTimeout(() => process.exit(1), 100);
    default:
      log("INFO", "Unknown or incomplete command, see below for error");
      return log("INFO", `${line}<--[HERE]`);
  }
}

rotateLatestLog();
log("INFO", `ModLauncher running: fake server ${version}`, { thread: "main", source: "cpw.mods.modlauncher.Launcher/MODLAUNCHER" });
log("INFO", `Starting minecraft server version ${version}`, { source: "net.minecraft.server.dedicated.DedicatedServer/" });
log("INFO", `Starting Minecraft server on *:${port}`, { source: "net.minecraft.server.dedicated.DedicatedServer/" });
log("WARN", "Example warning during startup", { thread: "main", source: "fake.startup/" });

readline.createInterface({ input: process.stdin }).on("line", (input) => {
  if (running) handle(input);
});

setTimeout(() => {
  slp.listen(port, () => {
    running = true;
    log("INFO", `Done (${(startupMs / 1000).toFixed(3)}s)! For help, type "help"`, {
      source: "net.minecraft.server.dedicated.DedicatedServer/",
    });
  });
}, startupMs);

process.on("SIGTERM", () => stop(0));
process.on("SIGHUP", () => stop(0));

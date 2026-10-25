import net from "node:net";

import type { PingInfo } from "@shared/types.js";

// Server List Ping: https://minecraft.wiki/w/Java_Edition_protocol/Server_List_Ping

export function encodeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return Buffer.from(bytes);
}

/** Returns the value and its byte length, or null if the buffer ends mid-VarInt. */
export function decodeVarInt(buffer: Buffer, offset = 0): { value: number; size: number } | null {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buffer[offset + i];
    if (byte === undefined) return null;
    value |= (byte & 0x7f) << (7 * i);
    if ((byte & 0x80) === 0) return { value, size: i + 1 };
  }
  throw new Error("VarInt too long");
}

function packet(id: number, ...fields: Buffer[]): Buffer {
  const body = Buffer.concat([encodeVarInt(id), ...fields]);
  return Buffer.concat([encodeVarInt(body.length), body]);
}

function mcString(text: string): Buffer {
  const bytes = Buffer.from(text, "utf8");
  return Buffer.concat([encodeVarInt(bytes.length), bytes]);
}

/** Flattens a chat component (string or {text, extra}) to plain text without § codes. */
export function chatToPlain(component: unknown): string {
  const walk = (node: unknown): string => {
    if (typeof node === "string") return node;
    if (Array.isArray(node)) return node.map(walk).join("");
    if (node && typeof node === "object") {
      const { text, translate, extra } = node as { text?: unknown; translate?: unknown; extra?: unknown };
      return walk(text ?? translate ?? "") + (Array.isArray(extra) ? extra.map(walk).join("") : "");
    }
    return "";
  };
  return walk(component).replace(/§./g, "");
}

interface StatusResponse {
  version?: { name?: string; protocol?: number };
  players?: { online?: number; max?: number; sample?: { name?: string; id?: string }[] };
  description?: unknown;
}

export function parseStatus(json: string, latencyMs: number): PingInfo {
  const status = JSON.parse(json) as StatusResponse;
  return {
    version: status.version?.name ?? "unknown",
    protocol: status.version?.protocol ?? -1,
    motd: chatToPlain(status.description ?? ""),
    playersOnline: status.players?.online ?? 0,
    playersMax: status.players?.max ?? 0,
    players: (status.players?.sample ?? [])
      .filter(
        (p): p is { name: string; id: string } => typeof p.name === "string" && typeof p.id === "string",
      )
      .map(({ name, id }) => ({ name, id })),
    latencyMs,
  };
}

const MAX_RESPONSE = 4 * 1024 * 1024;

export function pingServer(host: string, port: number, timeoutMs = 3000): Promise<PingInfo> {
  const { promise, resolve, reject } = Promise.withResolvers<PingInfo>();
  const started = performance.now();
  const socket = net.createConnection({ host, port });
  let buffer = Buffer.alloc(0);

  const fail = (err: Error) => {
    socket.destroy();
    reject(err);
  };
  socket.setTimeout(timeoutMs, () => fail(new Error(`Server list ping timed out after ${timeoutMs}ms`)));
  socket.on("error", fail);
  socket.on("connect", () => {
    const portBytes = Buffer.alloc(2);
    portBytes.writeUInt16BE(port);
    // Handshake (protocol -1 = "any", next state 1 = status), then status request.
    socket.write(packet(0x00, encodeVarInt(-1), mcString(host), portBytes, encodeVarInt(1)));
    socket.write(packet(0x00));
  });
  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > MAX_RESPONSE) return fail(new Error("Server list ping response too large"));
    try {
      const length = decodeVarInt(buffer);
      if (!length || buffer.length < length.size + length.value) return;
      const id = decodeVarInt(buffer, length.size);
      if (!id || id.value !== 0x00) return fail(new Error(`Unexpected packet id ${id?.value}`));
      const strLength = decodeVarInt(buffer, length.size + id.size);
      if (!strLength) return fail(new Error("Truncated status response"));
      const start = length.size + id.size + strLength.size;
      const json = buffer.subarray(start, start + strLength.value).toString("utf8");
      socket.destroy();
      resolve(parseStatus(json, Math.round(performance.now() - started)));
    } catch (err) {
      fail(err as Error);
    }
  });
  return promise;
}

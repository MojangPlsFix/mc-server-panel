import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { chatToPlain, decodeVarInt, encodeVarInt, parseStatus, pingServer } from "../../server/src/slp.js";

describe("VarInt", () => {
  it.each([0, 1, 127, 128, 255, 25565, 2_097_151, 2_147_483_647, -1])("round-trips %i", (value) => {
    const encoded = encodeVarInt(value);
    expect(decodeVarInt(encoded)).toEqual({ value, size: encoded.length });
  });

  it("encodes -1 as five bytes (the protocol version used for status pings)", () => {
    expect([...encodeVarInt(-1)]).toEqual([0xff, 0xff, 0xff, 0xff, 0x0f]);
  });

  it("reports an incomplete VarInt as null", () => {
    expect(decodeVarInt(Buffer.from([0x80]))).toBeNull();
  });
});

describe("chatToPlain", () => {
  it("flattens components and strips formatting codes", () => {
    expect(chatToPlain("§aGreen §lbold")).toBe("Green bold");
    expect(chatToPlain({ text: "A ", extra: [{ text: "B" }, " C", { extra: [{ text: "!" }] }] })).toBe(
      "A B C!",
    );
    expect(chatToPlain(null)).toBe("");
  });
});

describe("parseStatus", () => {
  it("reads a complete status response", () => {
    const json = JSON.stringify({
      version: { name: "1.20.1", protocol: 763 },
      players: {
        max: 64,
        online: 1,
        sample: [{ name: "Ingrid_Vale", id: "573a8f10-ebb7-33ad-8403-e81d3f2ca1ee" }],
      },
      description: { text: "Hello" },
      favicon: "data:image/png;base64,AAAA",
    });
    expect(parseStatus(json, 12)).toEqual({
      version: "1.20.1",
      protocol: 763,
      motd: "Hello",
      playersOnline: 1,
      playersMax: 64,
      players: [{ name: "Ingrid_Vale", id: "573a8f10-ebb7-33ad-8403-e81d3f2ca1ee" }],
      latencyMs: 12,
    });
  });

  it("rejects the partial response a modded server sends while it is still loading", () => {
    // Forge answers on the game port before startup finishes, without version or players.
    expect(() => parseStatus(JSON.stringify({ description: { text: "" } }), 5)).toThrow(/still starting/);
    expect(() => parseStatus(JSON.stringify({ version: { name: "1.20.1" } }), 5)).toThrow(/still starting/);
  });
});

async function freePort(): Promise<number> {
  const server = net.createServer();
  const { promise, resolve } = Promise.withResolvers<number>();
  server.listen(0, () => {
    const { port } = server.address() as net.AddressInfo;
    server.close(() => resolve(port));
  });
  return promise;
}

/** Resolves once the fake server has printed `text` (its console output is line-buffered). */
function waitForOutput(child: ChildProcessWithoutNullStreams, text: string): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  let seen = "";
  const onData = (chunk: Buffer) => {
    seen += chunk.toString();
    if (!seen.includes(text)) return;
    child.stdout.off("data", onData);
    resolve();
  };
  child.stdout.on("data", onData);
  return promise;
}

describe("pingServer against the fake server", () => {
  let fake: ChildProcessWithoutNullStreams;
  let port: number;
  let dir: string;

  beforeAll(async () => {
    port = await freePort();
    dir = mkdtempSync(path.join(os.tmpdir(), "mcp-slp-"));
    fake = spawn(process.execPath, [path.resolve("tools/fake-server/fake-server.mjs")], {
      env: {
        ...process.env,
        FAKE_DIR: dir,
        FAKE_PORT: String(port),
        FAKE_STARTUP_MS: "50",
        FAKE_MOTD: "§bTest MOTD",
      },
    });
    await waitForOutput(fake, "Done (");
  });

  afterAll(() => {
    fake.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads version, MOTD and players", async () => {
    const joined = waitForOutput(fake, "Thorvald_Brask joined the game");
    fake.stdin.write("fake:join Thorvald_Brask\n");
    await joined;
    const info = await pingServer("127.0.0.1", port);
    expect(info).toMatchObject({
      version: "1.20.1",
      protocol: 763,
      motd: "Test MOTD",
      playersOnline: 1,
      playersMax: 20,
      players: [{ name: "Thorvald_Brask" }],
    });
    expect(info.players[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects when nothing listens", async () => {
    await expect(pingServer("127.0.0.1", await freePort(), 1000)).rejects.toThrow();
  });
});

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeAuth } from "../../server/src/config.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "mc-panel-config-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("writeAuth", () => {
  it("keeps the other settings and the existing session secret", async () => {
    const file = path.join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        port: 9000,
        auth: { passwordHash: "old", sessionSecret: "s".repeat(43), sessionDays: 7 },
      }),
    );
    await writeAuth(file, { passwordHash: "new" });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      port: 9000,
      auth: { passwordHash: "new", sessionSecret: "s".repeat(43), sessionDays: 7 },
    });
  });

  // Windows has no POSIX permission bits.
  it.skipIf(process.platform === "win32")(
    "makes a world-readable config (e.g. a copied example) private before storing credentials",
    async () => {
      const file = path.join(dir, "config.json");
      writeFileSync(file, JSON.stringify({ port: 9000 }), { mode: 0o644 });
      await writeAuth(file, { passwordHash: "hash", sessionSecret: "s".repeat(43) });
      expect(statSync(file).mode & 0o777).toBe(0o600);
    },
  );

  it.skipIf(process.platform === "win32")("creates a new config file private", async () => {
    const file = path.join(dir, "new.json");
    await writeAuth(file, { passwordHash: "hash", sessionSecret: "s".repeat(43) });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

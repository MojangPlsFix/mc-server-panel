import { describe, expect, it } from "vitest";

import {
  createSessionToken,
  generateSecret,
  hashPassword,
  LoginLimiter,
  verifyPassword,
  verifySessionToken,
} from "../../server/src/auth.js";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
  });

  it("uses a fresh salt per hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$1$2")).toBe(false);
  });
});

describe("session tokens", () => {
  const secret = generateSecret();

  it("accepts a valid token until it expires", () => {
    const token = createSessionToken(secret, 1000, 10_000);
    expect(verifySessionToken(secret, token, 10_500)).toBe(true);
    expect(verifySessionToken(secret, token, 11_000)).toBe(false);
  });

  it("rejects tokens signed with another secret or tampered with", () => {
    const token = createSessionToken(secret, 60_000);
    expect(verifySessionToken(generateSecret(), token)).toBe(false);
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ exp: Date.now() + 10 ** 9 })).toString("base64url");
    expect(verifySessionToken(secret, `${forged}.${signature}`)).toBe(false);
    expect(verifySessionToken(secret, `${payload}.`)).toBe(false);
    expect(verifySessionToken(secret, undefined)).toBe(false);
  });
});

describe("LoginLimiter", () => {
  it("blocks after the maximum failures and frees the client after the window", () => {
    const limiter = new LoginLimiter(3, 60_000);
    for (const t of [0, 1000, 2000]) {
      expect(limiter.retryAfter("ip", t)).toBe(0);
      limiter.recordFailure("ip", t);
    }
    expect(limiter.retryAfter("ip", 3000)).toBe(57_000);
    expect(limiter.retryAfter("other", 3000)).toBe(0);
    expect(limiter.retryAfter("ip", 61_000)).toBe(0);
  });

  it("forgets failures after a successful login", () => {
    const limiter = new LoginLimiter(2, 60_000);
    limiter.recordFailure("ip", 0);
    limiter.recordFailure("ip", 0);
    limiter.reset("ip");
    expect(limiter.retryAfter("ip", 1)).toBe(0);
  });
});

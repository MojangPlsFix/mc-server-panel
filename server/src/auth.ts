import { createHmac, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const KEY_LENGTH = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

function deriveKey(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  scrypt(password, salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key)));
  return promise;
}

/** Format: scrypt$N$r$p$<salt base64url>$<key base64url> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return ["scrypt", N, r, p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await deriveKey(password, Buffer.from(salt, "base64url"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function generateSecret(): string {
  return randomBytes(32).toString("base64url");
}

function sign(secret: string, payload: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

/** Stateless session token: base64url({exp}) + "." + HMAC. Survives panel restarts. */
export function createSessionToken(secret: string, lifetimeMs: number, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ exp: now + lifetimeMs })).toString("base64url");
  return `${payload}.${sign(secret, payload).toString("base64url")}`;
}

export function verifySessionToken(secret: string, token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = sign(secret, payload);
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { exp?: unknown };
    return typeof exp === "number" && exp > now;
  } catch {
    return false;
  }
}

/** Blocks a client after `maxFailures` failed logins inside `windowMs`. */
export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 5 * 60_000,
  ) {}

  /** Milliseconds until the client may try again; 0 if allowed now. */
  retryAfter(client: string, now = Date.now()): number {
    const recent = (this.failures.get(client) ?? []).filter((t) => now - t < this.windowMs);
    this.failures.set(client, recent);
    const oldest = recent[0];
    return recent.length >= this.maxFailures && oldest !== undefined ? oldest + this.windowMs - now : 0;
  }

  recordFailure(client: string, now = Date.now()) {
    this.failures.set(client, [...(this.failures.get(client) ?? []), now]);
  }

  reset(client: string) {
    this.failures.delete(client);
  }
}

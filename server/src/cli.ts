import { readFile } from "node:fs/promises";
import { stdin, stdout } from "node:process";

import { generateSecret, hashPassword } from "./auth.js";
import { writeAuth } from "./config.js";

const MIN_PASSWORD_LENGTH = 8;

/** Reads a line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  let value = "";
  const finish = (result: () => void) => {
    stdin.setRawMode(false);
    stdin.pause();
    stdin.off("data", onData);
    stdout.write("\n");
    result();
  };
  const onData = (chunk: string) => {
    for (const char of chunk) {
      if (char === "\r" || char === "\n") return finish(() => resolve(value));
      if (char === "\u0003") return finish(() => reject(new Error("Cancelled")));
      if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
      else value += char;
    }
  };
  stdin.on("data", onData);
  return promise;
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.MC_PANEL_PASSWORD;
  if (fromEnv) return fromEnv;
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks)
      .toString("utf8")
      .replace(/\r?\n$/, "");
  }
  const first = await promptHidden("New panel password: ");
  const second = await promptHidden("Repeat password: ");
  if (first !== second) throw new Error("Passwords do not match");
  return first;
}

/**
 * `node server.js set-password`: stores a new password hash (and a session secret if missing).
 * The panel reads its config at startup, so a running panel keeps the old password until restarted.
 */
export async function setPassword(configFile: string): Promise<void> {
  const password = await readPassword();
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`The password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  let hasSecret = false;
  try {
    const raw = JSON.parse(await readFile(configFile, "utf8")) as { auth?: { sessionSecret?: string } };
    hasSecret = typeof raw.auth?.sessionSecret === "string" && raw.auth.sessionSecret.length >= 32;
  } catch {
    // new config file
  }
  await writeAuth(configFile, {
    passwordHash: await hashPassword(password),
    sessionSecret: hasSecret ? undefined : generateSecret(),
  });
  stdout.write(
    `Password saved to ${configFile}.\n` +
      "Restart the panel to use it, e.g. `systemctl restart mc-panel`. Until then the old password stays valid.\n" +
      "Restarting the panel does not restart the Minecraft server.\n",
  );
}

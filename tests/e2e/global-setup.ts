import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Starts a fresh Docker sandbox (panel + fake server) for the run and removes it afterwards.
 * Set E2E_BASE_URL to test an already running panel instead, E2E_KEEP_SANDBOX=1 to keep it.
 */
export default function globalSetup() {
  if (process.env.E2E_BASE_URL) return;
  if (!existsSync("dist/server.js") || !existsSync("dist/public/index.html")) {
    throw new Error("No build found: run `npm run build` before the end-to-end tests.");
  }
  const compose = ["compose", "-f", "docker/compose.yml"];
  execFileSync("docker", [...compose, "down", "--volumes", "--remove-orphans"], { stdio: "inherit" });
  execFileSync("docker", [...compose, "up", "--detach", "--build", "--wait"], { stdio: "inherit" });
  return () => {
    if (!process.env.E2E_KEEP_SANDBOX) {
      execFileSync("docker", [...compose, "down", "--volumes"], { stdio: "inherit" });
    }
  };
}

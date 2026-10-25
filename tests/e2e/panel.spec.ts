import { execFileSync } from "node:child_process";

import { expect, type Page, test } from "@playwright/test";

// One server, driven through its whole lifecycle: the tests depend on each other's state.
test.describe.configure({ mode: "serial" });

const PASSWORD = process.env.PANEL_PASSWORD ?? "sandbox-password";

async function login(page: Page, password = PASSWORD) {
  await page.goto("/");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
}

const serverState = (page: Page) => page.getByTestId("server-state").first();

async function sendCommand(page: Page, command: string) {
  const input = page.getByLabel("Console command");
  await input.fill(command);
  await input.press("Enter");
  await expect(input).toHaveValue("");
}

test("refuses a wrong password and protects the API", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Wrong password");
  expect((await request.get("/api/status")).status()).toBe(401);
});

test("starts the server and shows its status", async ({ page }) => {
  await login(page);
  await expect(serverState(page)).toHaveAttribute("data-state", "stopped");
  await page.getByRole("button", { name: "Start server" }).click();
  await expect(serverState(page)).toHaveAttribute("data-state", "running", { timeout: 30_000 });
  await expect(page.locator("dd", { hasText: "1.20.1" })).toBeVisible();
  await expect(page.getByText("A Fake Minecraft Server")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
});

test("runs console commands and shows their output", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Console", exact: true }).click();
  await sendCommand(page, "list");
  await expect(page.getByTestId("log-view")).toContainText("There are 0 of a max of 20 players online");
  await sendCommand(page, "say hello from the end-to-end test");
  await expect(page.getByTestId("log-view")).toContainText("[Server] hello from the end-to-end test");

  const input = page.getByLabel("Console command");
  await input.press("ArrowUp");
  await expect(input).toHaveValue("say hello from the end-to-end test");
  await input.press("ArrowUp");
  await expect(input).toHaveValue("list");
});

test("keeps console commands sent at the same time apart", async ({ page }) => {
  await login(page);
  const messages = Array.from({ length: 12 }, (_, i) => `parallel message ${i} ${"x".repeat(1 + i * 7)}`);
  // page.request shares the logged-in browser context's cookie.
  const responses = await Promise.all(
    messages.map((message) => page.request.post("/api/console", { data: { command: `say ${message}` } })),
  );
  expect(responses.map((response) => response.status())).toEqual(messages.map(() => 204));

  const said = async () => {
    const response = await page.request.get("/api/logs/latest.log?lines=500");
    const { lines } = (await response.json()) as { lines: string[] };
    return lines
      .filter((line) => line.includes("parallel message"))
      .map((line) => line.split(": ").slice(1).join(": "));
  };
  // Every command runs exactly once, on its own; none merged into another or broken up.
  await expect
    .poll(async () => (await said()).sort())
    .toEqual(messages.map((message) => `[Server] ${message}`).sort());
});

test("filters console output by level", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Console", exact: true }).click();
  await sendCommand(page, "fake:warn Chunk save took 812 ms");
  await sendCommand(page, "fake:error Ticking block entity failed");
  await expect(page.getByTestId("log-view")).toContainText("Ticking block entity failed");

  await page.getByRole("button", { name: "Errors" }).click();
  const lines = page.getByTestId("log-line");
  await expect(lines.filter({ hasText: "Ticking block entity failed" })).toHaveAttribute(
    "data-level",
    "error",
  );
  await expect(lines.filter({ hasText: "fake.Test.run" })).toHaveCount(1); // stack trace stays attached
  await expect(page.locator('[data-testid="log-line"][data-level="info"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="log-line"][data-level="warn"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Warnings" }).click();
  await expect(lines.filter({ hasText: "Chunk save took 812 ms" })).toBeVisible();
});

test("lists online players", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Console", exact: true }).click();
  await sendCommand(page, "fake:join Thorvald_Brask");
  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByTestId("player")).toContainText("Thorvald_Brask");
  await expect(page.getByTestId("player-count")).toHaveText("1/20");
});

test("restarts the server and archives the previous log", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Restart" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Restart" }).click();
  await expect(page.getByRole("button", { name: "Restarting…" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restarting…" })).toBeHidden({ timeout: 45_000 });
  await expect(serverState(page)).toHaveAttribute("data-state", "running");
  await expect(page.getByText("Nobody online")).toBeVisible();

  await page.getByRole("link", { name: "Logs" }).click();
  const files = page.getByTestId("log-file");
  await expect(files.first()).toContainText("latest.log");
  await expect(files.filter({ hasText: /\.log\.gz/ })).toHaveCount(1);
});

test("browses and searches logs", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Logs" }).click();
  await page.getByTestId("log-file").filter({ hasText: ".log.gz" }).click();
  await expect(page.getByTestId("log-view")).toContainText("Thorvald_Brask joined the game");
  await page.getByLabel("Search log").fill("joined");
  await expect(page.getByTestId("log-line")).toHaveCount(1);
  await expect(page.locator("mark")).toHaveText("joined");
});

test("stops the server", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Stop" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Stop server" }).click();
  await expect(serverState(page)).toHaveAttribute("data-state", "stopped", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Start server" })).toBeVisible();
  await page.getByRole("link", { name: "Console", exact: true }).click();
  await expect(page.getByLabel("Console command")).toBeDisabled();
});

test("logs out", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  expect((await page.request.get("/api/status")).status()).toBe(401);
});

test("uses a password changed with set-password once the panel restarts", async ({ page }) => {
  test.skip(Boolean(process.env.E2E_BASE_URL), "needs the Docker sandbox");
  const compose = ["compose", "-f", "docker/compose.yml"];
  const newPassword = "changed-sandbox-password";
  execFileSync("docker", [
    ...compose,
    "exec",
    "-T",
    "-e",
    `MC_PANEL_PASSWORD=${newPassword}`,
    "panel",
    "node",
    "/opt/panel/server.js",
    "set-password",
  ]);
  // `restart` keeps the container (and its config). Don't use `up --wait` here: some Compose versions recreate
  // the container, which brings back the initial config.
  execFileSync("docker", [...compose, "restart", "panel"]);
  await expect
    .poll(() =>
      page.request.get("/api/health").then(
        (response) => response.status(),
        () => 0,
      ),
    )
    .toBe(200);

  await page.goto("/");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Wrong password");
  await login(page, newPassword);
});

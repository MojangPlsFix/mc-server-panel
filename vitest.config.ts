import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@shared": path.join(root, "shared") },
  },
  test: {
    include: ["server/**/*.test.ts", "shared/**/*.test.ts", "tools/**/*.test.ts"],
    environment: "node",
  },
});

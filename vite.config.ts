import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const backend = process.env.PANEL_BACKEND ?? "http://localhost:8080";

export default defineConfig({
  root: path.join(root, "web"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.join(root, "web/src"),
      "@shared": path.join(root, "shared"),
    },
  },
  build: {
    outDir: path.join(root, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": { target: backend, ws: true, changeOrigin: false },
    },
  },
});

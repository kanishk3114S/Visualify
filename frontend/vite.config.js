import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Phase 0 decision: keep a single React 18 copy for @excalidraw/excalidraw.
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    // Never ship source maps publicly (Agents.MD Section 21).
    sourcemap: false,
  },
  test: {
    include: ["src/**/*.test.js"],
    environment: "node",
  },
});

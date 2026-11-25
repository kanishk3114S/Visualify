import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only the API's own tests. backend/worker has its own Vitest run
    // (npm run test:worker); without this, its tests ran (and were counted) twice.
    include: ["tests/**/*.test.js"],
    environment: "node",
  },
});

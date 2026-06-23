import { defineConfig } from "vitest/config";

// Live tests hit real external services (mcp.deepwiki.com, api.github.com).
// Run with: pnpm test:live
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/live/**/*.test.ts"],
    testTimeout: 180000,
    hookTimeout: 180000,
    retry: 2,
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["**/*.e2e.ts"],
    globalSetup: ["./global-setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 90_000,
    fileParallelism: false,
  },
});

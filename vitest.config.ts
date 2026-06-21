import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/eval/**", "src/main/**", "src/renderer/**"],
    },
  },
  resolve: {
    alias: {
      "@engine": resolve(__dirname, "src/engine"),
      "@agent": resolve(__dirname, "src/agent"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
});

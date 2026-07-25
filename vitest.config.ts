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
      // main は「electron/uiohook を import する I/O グルー」だけ除外する。
      // store / cheerRuntime は依存注入で決定的にテストできるため計測対象に含める。
      exclude: [
        "src/**/*.d.ts",
        "src/eval/**",
        "src/renderer/**",
        "src/main/index.ts",
        "src/main/ipc.ts",
        "src/main/keyHook.ts",
        "src/main/tray.ts",
        "src/main/windows.ts",
      ],
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

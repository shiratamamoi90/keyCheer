import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    },
  },
  {
    // engine の依存方向不変条件:engine から agent/eval/electron/fetch を import 禁止
    files: ["src/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@agent/*", "../agent/*", "../../agent/*"],
              message: "engine は agent を import しない(architecture.md)",
            },
            {
              group: ["electron", "electron/*"],
              message: "engine は Electron API を直接触らない(impl-rules.md)",
            },
            {
              group: ["node:child_process", "child_process"],
              message: "engine は child_process を直接触らない(impl-rules.md)",
            },
            {
              group: ["node:fs", "fs", "node:fs/promises"],
              message: "engine は fs を直接触らない(I/O は agent/main)",
            },
          ],
          paths: [
            {
              name: "uiohook-napi",
              message: "engine は uiohook-napi を直接触らない(main 側で扱う)",
            },
            {
              name: "electron-store",
              message: "engine は electron-store を直接触らない(設定値は引数で受ける)",
            },
          ],
        },
      ],
    },
  },
);

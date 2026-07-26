import js from "@eslint/js";
import tseslint from "typescript-eslint";

// engine の依存方向不変条件:engine から agent/eval/electron/通信/I-O を import 禁止
const engineRestrictedPatterns = [
  {
    group: ["@agent/*", "../agent/*", "../../agent/*"],
    message: "engine は agent を import しない(architecture.md)",
  },
  {
    group: ["../eval/*", "../../eval/*"],
    message: "engine は eval を import しない(architecture.md)",
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
  {
    group: ["node:http", "http", "node:https", "https", "node:net", "net"],
    message: "engine はネットワーク API を直接触らない(プライバシー不変条件)",
  },
];

const engineRestrictedPaths = [
  {
    name: "uiohook-napi",
    message: "engine は uiohook-napi を直接触らない(main 側で扱う)",
  },
  {
    name: "electron-store",
    message: "engine は electron-store を直接触らない(設定値は引数で受ける)",
  },
];

// 応援発動経路の不変条件:providers を import レベルで分離。
// 発動はプール + wav のみで成立し、providers 設定・実装に依存しない(CLAUDE.md / cheer-trigger.md)。
const cheerPathRestrictedPatterns = [
  ...engineRestrictedPatterns,
  {
    group: ["./providers/*", "../providers/*", "**/providers/*"],
    message:
      "応援発動経路から providers を import しない(発動はプール + wav のみで成立。CLAUDE.md 不変条件)",
  },
];

// main 側の発動経路グルー(keyHook / cheerRuntime)も providers・生成系から分離する。
// これらは engine + agent/cheerPlayer(wav パス解決のみ)だけに依存してよい。
const mainCheerPathRestrictedPatterns = [
  {
    group: [
      "**/providers/*",
      "../agent/providerRouter*",
      "../agent/poolGenerator*",
      "../agent/voiceSynth*",
      "../agent/secrets*",
      "../agent/auditLog*",
    ],
    message:
      "応援発動経路(main)から providers・生成系を import しない(発動はプール + wav のみ。CLAUDE.md 不変条件)",
  },
];

// renderer / preload も発動経路の一部(main → preload → renderer)。
// engine の内部実装・providers・agent の生成系を持ち込まず、型は src/shared からのみ取る。
const rendererRestrictedPatterns = [
  {
    group: ["**/providers/*", "../agent/*", "../../agent/*", "@agent/*"],
    message:
      "renderer / preload から providers・agent 生成系を import しない(発動経路の分離。CLAUDE.md 不変条件)",
  },
  {
    group: ["../engine/*", "../../engine/*", "@engine/*"],
    message: "renderer / preload は engine の内部実装に依存しない(共有型は src/shared から取る)",
  },
  {
    group: ["node:*", "electron-store", "uiohook-napi"],
    message:
      "renderer は Node / ネイティブ依存に触らない(最小権限。必要なら preload 経由で main に委ねる)",
  },
];

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
    files: ["src/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: engineRestrictedPatterns, paths: engineRestrictedPaths },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "engine は fetch を使わない(通信は agent/main 側。プライバシー不変条件)",
        },
        {
          name: "XMLHttpRequest",
          message: "engine は XHR を使わない(通信は agent/main 側。プライバシー不変条件)",
        },
        {
          name: "WebSocket",
          message: "engine は WebSocket を使わない(通信は agent/main 側。プライバシー不変条件)",
        },
      ],
    },
  },
  {
    // flat config は後段の同名ルールが上書きのため、engine 全体の制限も含めて再宣言する。
    // 発動経路に属する engine ファイルを列挙する。`runtime.ts`(発動経路の合成中心)と
    // `index.ts`(main が読む re-export ハブ。ここから providers を漏らすと発動経路へ伝播する)を
    // 必ず含めること — 新しい発動経路モジュールを足したらこの配列にも追加する。
    files: [
      "src/engine/index.ts",
      "src/engine/runtime.ts",
      "src/engine/trigger.ts",
      "src/engine/triggerConfig.ts",
      "src/engine/cheerSelector.ts",
      "src/engine/messagePool.ts",
      "src/engine/keyCounter.ts",
      "src/engine/speedZone.ts",
      "src/engine/timeOfDay.ts",
      "src/engine/baseline/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: cheerPathRestrictedPatterns, paths: engineRestrictedPaths },
      ],
    },
  },
  {
    // main 側の発動経路グルー:providers・生成系の import を禁止(発動経路の分離を型/import レベルで担保)。
    // `index.ts` は発動経路の配線に徹する(キャラ作成フローは別モジュールへ分離する)ため対象に含める。
    files: ["src/main/index.ts", "src/main/keyHook.ts", "src/main/cheerRuntime.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: mainCheerPathRestrictedPatterns }],
    },
  },
  {
    // renderer / preload:表示に必要な型は src/shared からのみ。engine 実装・providers・Node には触れない。
    // preload だけは electron(contextBridge / ipcRenderer)の import を許す。
    // .tsx も対象に含める(changes/0008 で main window の renderer に React を導入したため)。
    files: ["src/renderer/**/*.ts", "src/renderer/**/*.tsx", "src/preload/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: rendererRestrictedPatterns }],
    },
  },
);

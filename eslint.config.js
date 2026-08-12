import js from "@eslint/js";
import tseslint from "typescript-eslint";

// core の依存方向不変条件:core から agent/eval/electron/通信/I-O を import 禁止
const coreRestrictedPatterns = [
  {
    group: ["@agent/*", "../agent/*", "../../agent/*"],
    message: "core は agent を import しない(architecture.md)",
  },
  {
    group: ["../eval/*", "../../eval/*"],
    message: "core は eval を import しない(architecture.md)",
  },
  {
    group: ["electron", "electron/*"],
    message: "core は Electron API を直接触らない(impl-rules.md)",
  },
  {
    group: ["node:child_process", "child_process"],
    message: "core は child_process を直接触らない(impl-rules.md)",
  },
  {
    group: ["node:fs", "fs", "node:fs/promises"],
    message: "core は fs を直接触らない(I/O は agent/main)",
  },
  {
    group: ["node:http", "http", "node:https", "https", "node:net", "net"],
    message: "core はネットワーク API を直接触らない(プライバシー不変条件)",
  },
];

const coreRestrictedPaths = [
  {
    name: "uiohook-napi",
    message: "core は uiohook-napi を直接触らない(main 側で扱う)",
  },
  {
    name: "electron-store",
    message: "core は electron-store を直接触らない(設定値は引数で受ける)",
  },
];

// 応援発動経路の不変条件:providers を import レベルで分離。
// 発動はプール + wav のみで成立し、providers 設定・実装に依存しない(CLAUDE.md / cheer-trigger.md)。
const cheerPathRestrictedPatterns = [
  ...coreRestrictedPatterns,
  {
    group: ["./providers/*", "../providers/*", "**/providers/*"],
    message:
      "応援発動経路から providers を import しない(発動はプール + wav のみで成立。CLAUDE.md 不変条件)",
  },
];

// main 側の発動経路グルー(keyHook / cheerRuntime)も providers・生成系から分離する。
// これらは core + agent/cheerPlayer(wav パス解決のみ)だけに依存してよい。
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
// core の内部実装・providers・agent の生成系を持ち込まず、型は src/core/shared からのみ取る。
const rendererRestrictedPatterns = [
  {
    group: ["**/providers/*", "../agent/*", "../../agent/*", "@agent/*"],
    message:
      "renderer / preload から providers・agent 生成系を import しない(発動経路の分離。CLAUDE.md 不変条件)",
  },
  {
    // 共有型(core/shared)は取ってよい。core の内部実装(cheerSelector 等)だけを止める。
    // group の glob は `*` が `/` を跨ぐため shared まで巻き込む。除外を効かせるには regex を使う
    // (glob の否定パターンは no-restricted-imports では効かない)。
    regex: "(^|/)(\\.\\.\\/)+core\\/(?!shared\\/)|^@core\\/(?!shared\\/)",
    message: "renderer / preload は core の内部実装に依存しない(共有型は src/core/shared から取る)",
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
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: coreRestrictedPatterns, paths: coreRestrictedPaths },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "core は fetch を使わない(通信は agent/main 側。プライバシー不変条件)",
        },
        {
          name: "XMLHttpRequest",
          message: "core は XHR を使わない(通信は agent/main 側。プライバシー不変条件)",
        },
        {
          name: "WebSocket",
          message: "core は WebSocket を使わない(通信は agent/main 側。プライバシー不変条件)",
        },
      ],
    },
  },
  {
    // flat config は後段の同名ルールが上書きのため、core 全体の制限も含めて再宣言する。
    // 発動経路に属する core ファイルを列挙する。`runtime.ts`(発動経路の合成中心)と
    // `index.ts`(main が読む re-export ハブ。ここから providers を漏らすと発動経路へ伝播する)を
    // 必ず含めること — 新しい発動経路モジュールを足したらこの配列にも追加する。
    files: [
      "src/core/index.ts",
      "src/core/runtime.ts",
      "src/core/trigger.ts",
      "src/core/triggerConfig.ts",
      "src/core/cheerSelector.ts",
      "src/core/messagePool.ts",
      "src/core/keyCounter.ts",
      "src/core/speedZone.ts",
      "src/core/timeOfDay.ts",
      "src/core/baseline/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: cheerPathRestrictedPatterns, paths: coreRestrictedPaths },
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
    // renderer / preload:表示に必要な型は src/core/shared からのみ。core 実装・providers・Node には触れない。
    // preload だけは electron(contextBridge / ipcRenderer)の import を許す。
    // .tsx も対象に含める(論点 0018 で main window の renderer に React を導入したため)。
    files: ["src/renderer/**/*.ts", "src/renderer/**/*.tsx", "src/preload/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: rendererRestrictedPatterns }],
    },
  },
);

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 要件: docs/cheer-trigger.md(発動経路で外部依存に触らない)/ docs/integrations.md
//       (応援発動経路から外部 API を呼ばない)/ docs/main-window.md(発動経路と独立している)
//
// なぜソースを読む形にするか:これらは「実行時に何が起きるか」ではなく
// **どこに依存を持たないか**の要件で、実行させても「呼ばれなかった」ことしか言えない。
// import の有無で読むと、経路に生成系が紛れ込んだ時点で落ちる。
// ESLint の no-restricted-imports も同じ不変条件を止めるが、そちらは規約の強制であって
// 要件 ↔ test の対応にはならないため、要件側からもここで縛る(@.claude/rules/impl-rules.md N-2)。

const ROOT = join(import.meta.dirname, "..", "..");

/** 対象ファイルの import 文の from パスをすべて返す。 */
function readImportSources(relativePath: string): string[] {
  const source = readFileSync(join(ROOT, relativePath), "utf8");
  return [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
}

// 応援発動経路を構成するファイル。新しく経路へ足したらここにも追加する。
const CHEER_PATH_FILES = [
  "src/core/index.ts",
  "src/core/runtime.ts",
  "src/core/trigger.ts",
  "src/core/cheerSelector.ts",
  "src/core/messagePool.ts",
  "src/core/keyCounter.ts",
  "src/core/speedZone.ts",
  "src/core/timeOfDay.ts",
  "src/core/baseline/messages.ts",
  "src/main/keyHook.ts",
  "src/main/cheerRuntime.ts",
];

const GENERATION_MODULES = /providers\/|providerRouter|poolGenerator|voiceSynth|secrets|auditLog/;
const NETWORK_OR_PROCESS = /^(node:)?(http|https|net|child_process)$/;

describe("発動経路の分離 / 発動経路は生成系に依存しない", () => {
  it("S0013_06 発動経路のどのファイルも providers・生成系を import しない", () => {
    const violations = CHEER_PATH_FILES.flatMap((file) =>
      readImportSources(file)
        .filter((source) => GENERATION_MODULES.test(source))
        .map((source) => `${file} → ${source}`),
    );

    expect(violations).toEqual([]);
  });

  it("S0016_09 発動経路のどのファイルも通信・子プロセスの API を import しない", () => {
    const violations = CHEER_PATH_FILES.flatMap((file) =>
      readImportSources(file)
        .filter((source) => NETWORK_OR_PROCESS.test(source))
        .map((source) => `${file} → ${source}`),
    );

    expect(violations).toEqual([]);
  });
});

describe("発動経路の分離 / メインウィンドウは発動経路と独立している", () => {
  it("S0018_11 cheerRuntime はメインウィンドウのモジュールを import しない", () => {
    const sources = readImportSources("src/main/cheerRuntime.ts");

    expect(sources.filter((s) => /mainWindow/i.test(s))).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// 要件: docs/popup.md(renderer は core / providers を import しない)/
//       docs/main-window.md(メインウィンドウの renderer は providers を import しない)
//
// renderer は表示だけを担い、型は src/core/shared からのみ取る。
// ここを破ると、発動経路の分離(docs/cheer-trigger.md)が UI 側から崩れる。

const ROOT = join(import.meta.dirname, "..", "..");
const RENDERER_DIR = join(ROOT, "src", "renderer");

function rendererFiles(): string[] {
  return readdirSync(RENDERER_DIR).filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"));
}

function readImportSources(fileName: string): string[] {
  const source = readFileSync(join(RENDERER_DIR, fileName), "utf8");
  return [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
}

describe("renderer / import 境界", () => {
  it("S0017_08 renderer は core の内部実装を import しない(共有型は core/shared からのみ)", () => {
    const violations = rendererFiles().flatMap((file) =>
      readImportSources(file)
        .filter((source) => /(^|\/)core\//.test(source) && !/core\/shared\//.test(source))
        .map((source) => `${file} → ${source}`),
    );

    expect(violations).toEqual([]);
  });

  it("S0018_12 renderer は providers・agent の生成系を import しない", () => {
    const violations = rendererFiles().flatMap((file) =>
      readImportSources(file)
        .filter((source) => /providers\/|\/agent\/|^\.\.\/agent\//.test(source))
        .map((source) => `${file} → ${source}`),
    );

    expect(violations).toEqual([]);
  });
});

// main/weightInstallMode: 補助モードの引数(インストーラが渡す)の読み取り。
// 要件: docs/model-weights.md(論点 0072)。流れは tests/integration/weightInstallFlow.test.ts

import { describe, expect, it } from "vitest";
import {
  buildWeightInstallMessage,
  resolveWeightInstallArgs,
} from "../../src/main/weightInstallMode.js";

describe("weightInstallMode / 引数", () => {
  it("reads the source folder and the result file given by the installer", () => {
    expect(
      resolveWeightInstallArgs([
        "app.exe",
        "--install-weights=C:\\dl\\keyCheer",
        "--result-file=C:\\t\\r.json",
      ]),
    ).toEqual({ sourceDir: "C:\\dl\\keyCheer", resultFile: "C:\\t\\r.json", messageFile: null });
  });

  it("returns null for a normal launch (the app starts as usual)", () => {
    expect(resolveWeightInstallArgs(["app.exe"])).toBeNull();
  });
});

describe("weightInstallMode / インストーラに出す文面", () => {
  it("names the missing files", () => {
    expect(
      buildWeightInstallMessage({ ok: false, reason: "missing", files: ["a.gguf", "b.st"] }),
    ).toBe(
      "インストーラと同じフォルダに、次のファイルがありません。すべて同じフォルダに置いてから、もう一度インストールしてください。\r\na.gguf\r\nb.st",
    );
  });

  it("names the mismatched files", () => {
    expect(buildWeightInstallMessage({ ok: false, reason: "mismatch", files: ["b.st"] })).toBe(
      "次のファイルが壊れているか、別の版です。配布元から落とし直してから、もう一度インストールしてください。\r\nb.st",
    );
  });

  it("states the space shortage in GB", () => {
    expect(
      buildWeightInstallMessage({
        ok: false,
        reason: "no-space",
        requiredBytes: 4_300_000_000,
        freeBytes: 1_000_000_000,
      }),
    ).toBe(
      "空き容量が足りません(必要 4.3 GB、空き 1.0 GB)。空きを作ってから、もう一度インストールしてください。",
    );
  });

  it("states that the text model could not be imported", () => {
    expect(
      buildWeightInstallMessage({
        ok: false,
        reason: "import-failed",
        detail: "ollama-unavailable",
      }),
    ).toBe("テキストモデルを Ollama に取り込めませんでした。もう一度インストールしてください。");
  });

  it("reads the message file path", () => {
    expect(
      resolveWeightInstallArgs(["app.exe", "--install-weights=D", "--message-file=M"]),
    ).toEqual({
      sourceDir: "D",
      resultFile: null,
      messageFile: "M",
    });
  });
});

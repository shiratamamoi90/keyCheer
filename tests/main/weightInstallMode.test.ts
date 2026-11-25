// main/weightInstallMode: 補助モードの引数(インストーラが渡す)の読み取り。
// 要件: docs/model-weights.md(論点 0072)。流れは tests/integration/weightInstallFlow.test.ts

import { describe, expect, it } from "vitest";
import { resolveWeightInstallArgs } from "../../src/main/weightInstallMode.js";

describe("weightInstallMode / 引数", () => {
  it("reads the source folder and the result file given by the installer", () => {
    expect(
      resolveWeightInstallArgs([
        "app.exe",
        "--install-weights=C:\\dl\\keyCheer",
        "--result-file=C:\\t\\r.json",
      ]),
    ).toEqual({ sourceDir: "C:\\dl\\keyCheer", resultFile: "C:\\t\\r.json" });
  });

  it("returns null for a normal launch (the app starts as usual)", () => {
    expect(resolveWeightInstallArgs(["app.exe"])).toBeNull();
  });
});

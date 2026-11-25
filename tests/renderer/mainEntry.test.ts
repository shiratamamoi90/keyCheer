// renderer/mainEntry: メインウィンドウの I/O グルー(mainEntry.tsx と画面ごとの .tsx)。グルーは単体で動かせないので、ソースの中身で「出さないもの」を縛る。
// 要件: docs/main-window.md / docs/licenses.md(論点 0050 / 0054 / 0060)

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// メインウィンドウの画面は mainEntry.tsx と、画面ごと・部品の .tsx に分けている(論点 0079)。そのすべてを読む
const mainWindowSource = (): string =>
  readdirSync("src/renderer")
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => readFileSync(`src/renderer/${file}`, "utf8"))
    .join("\n");

describe("mainEntry / 画像プロバイダーを選ぶ操作を出さない [否定]", () => {
  it("S0050_05 has no provider selection on the generation screen", () => {
    const source = mainWindowSource();
    expect(source).not.toMatch(/プロバイダー|getProviders|setProviders|PROVIDER_IDS/);
  });
});

describe("mainEntry / アプリの中にライセンスの表示を出さない [否定]", () => {
  it("S0060_02 shows no license text and has no channel that hands license texts to the renderer", async () => {
    const source = mainWindowSource();
    const { IpcChannel } = await import("../../src/core/shared/ipc.js");
    expect(source).not.toMatch(/ライセンス|LicenseTexts|利用の制限/);
    expect(Object.values(IpcChannel).filter((channel) => /license/i.test(channel))).toEqual([]);
  });
});

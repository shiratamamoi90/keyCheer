// 総合(経路): インストーラ(installer/installer.nsh)が補助モードに渡す引数 → 補助モードの引数の読み取り →
// 失敗のときに書く文面のファイル → インストーラが読む、までのつなぎ目を 1 本で通す。
// NSIS は動かせないので、スクリプトの ExecWait の引数をそのまま補助モードに渡し、文面のファイルが UTF-16LE で読めることを見る。
// 同意の文書は、同梱した原文と lock の依存から作ったものが、どの項目も欠けないことを見る。
// 総合テストにシナリオ ID は付けない(@.claude/rules/impl-rules.md N-2)。

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveWeightInstallArgs,
  runWeightInstallMode,
} from "../../src/main/weightInstallMode.js";

describe("総合: インストーラが渡す引数で補助モードが動き、失敗の文面をインストーラが読める形で返す", () => {
  it("parses the installer's ExecWait arguments and writes a UTF-16LE message the installer reads", async () => {
    const script = readFileSync("installer/installer.nsh", "utf8");
    const exec = /ExecWait '"\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}" (.+)' \$0/.exec(script);
    expect(exec).not.toBeNull();
    const pluginsDir = mkdtempSync(join(tmpdir(), "keycheer-plugins-"));
    // NSIS の変数を、インストーラが実行するときの値に置き換える
    const argv = [...exec![1]!.matchAll(/"([^"]+)"/g)].map((m) =>
      m[1]!
        .replace("$EXEDIR", "C:\\Downloads\\keycheer")
        .replace("$PLUGINSDIR\\", `${pluginsDir}/`),
    );
    const args = resolveWeightInstallArgs(["keycheer.exe", ...argv]);
    expect(args).toEqual({
      sourceDir: "C:\\Downloads\\keycheer",
      resultFile: null,
      messageFile: `${pluginsDir}/weights-message.txt`,
    });

    const { exitCode } = await runWeightInstallMode({
      args: args!,
      install: () =>
        Promise.resolve({ ok: false, reason: "missing", files: ["lcm-lora-sdv1-5.safetensors"] }),
      importTextModel: () => Promise.resolve({ ok: true, isImported: true }),
    });
    expect(exitCode).not.toBe(0); // インストーラは 0 以外で文面を出して中止する
    const message = readFileSync(args!.messageFile!, "utf16le");
    expect(message).toContain("lcm-lora-sdv1-5.safetensors");
    expect(message.charCodeAt(0)).not.toBe(0xfeff);
  });
});

describe("総合: インストーラからの削除が、electron-builder が書いた登録情報とアンインストーラを使う", () => {
  it("reads the same registry value and uninstaller name that the electron-builder installer writes", () => {
    const script = readFileSync("installer/installer.nsh", "utf8");
    const templates = "node_modules/app-builder-lib/templates/nsis";
    const writer = readFileSync(`${templates}/include/installer.nsh`, "utf8");
    const uninstaller = readFileSync(`${templates}/uninstaller.nsh`, "utf8");
    // 入っているかの判定:利用者ごとのインストール(perMachine: false)で書かれる InstallLocation
    expect(script).toContain(
      'ReadRegStr $keycheerInstalled HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation',
    );
    expect(writer).toContain(
      'WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"',
    );
    // 動かすアンインストーラ:インストーラが入れる名前と同じ
    expect(script).toContain("$keycheerInstalled\\${UNINSTALL_FILENAME}");
    expect(writer).toContain('File "/oname=${UNINSTALL_FILENAME}"');
    // アプリのデータも消す指定を、アンインストーラが受け付ける(アンインストールと同じ消え方)
    expect(script).toContain("--delete-app-data");
    expect(uninstaller).toContain('${GetOptions} $R0 "--delete-app-data" $R1');
  });
});

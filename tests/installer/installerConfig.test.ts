// installer: インストーラ(electron-builder の NSIS)の設定と、重みを置く手順(installer/installer.nsh)。
// 要件: docs/licenses.md・docs/model-weights.md(論点 0047 / 0048 / 0055 / 0072)
// NSIS は実行できないので、設定とスクリプトの中身で縛る(実物は Windows で確かめる)。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  build: { nsis: Record<string, unknown>; win: { target: unknown } };
};
const nsis = pkg.build.nsis;
const script = readFileSync("installer/installer.nsh", "utf8");

describe("installer / 同意しなければインストールを進めない [否定]", () => {
  it("S0047_03 shows the license page (assisted installer) and places weights only in the install step after it", () => {
    expect(nsis.oneClick).toBe(false);
    expect(nsis.license).toBe("installer/license.txt");
    // 重みを置くのは customInstall(同意の画面より後の、ファイルを入れる工程)の中だけ
    const placing = script.indexOf("--install-weights=");
    expect(placing).toBeGreaterThan(script.indexOf("!macro customInstall"));
    expect(placing).toBeLessThan(script.indexOf("!macroend"));
  });
});

describe("installer / 同意の画面は通信しない [否定]", () => {
  it("S0047_10 builds the license page from a bundled file, not a web page", () => {
    expect(String(nsis.license)).not.toMatch(/^https?:/);
    expect(script).not.toMatch(/https?:\/\//);
  });
});

describe("installer / インストールで通信しない [否定]", () => {
  it("S0055_05 is a full (non-web) installer whose script has no download plugin", () => {
    expect(JSON.stringify(pkg.build.win.target)).not.toMatch(/nsis-web/);
    expect(script).not.toMatch(/inetc|NSISdl|INetC|nsisdl|https?:\/\//i);
  });
});

describe("installer / アンインストールで、アプリが保存したものをすべて消す", () => {
  it("S0048_13 deletes the app data folder on uninstall", () => {
    expect(nsis.deleteAppDataOnUninstall).toBe(true);
  });
});

describe("installer / 更新のインストールでは保存したものを消さない [否定]", () => {
  it("S0048_14 has no deletion of the app data in the install steps (electron-builder skips it on update)", () => {
    expect(script).not.toMatch(/\$APPDATA/i);
  });
});

// --- インストーラからの削除(論点 0075)。customInit(.onInit。同意の画面より前)の中身で縛る ---

const macroBody = (name: string): string => {
  const begin = script.indexOf(`!macro ${name}`);
  if (begin < 0) return "";
  return script.slice(begin, script.indexOf("!macroend", begin));
};
const init = macroBody("customInit");

describe("installer / 入っている状態で実行すると、更新するか削除するかを選べる", () => {
  it("S0075_01 asks update / remove / cancel at start when an installation is registered", () => {
    expect(init).toContain("InstallLocation");
    expect(init).toMatch(/MessageBox MB_YESNOCANCEL/);
    expect(init).toContain("更新する");
    expect(init).toContain("削除する");
    expect(init).toContain("中止する");
  });
});

describe("installer / 削除を選んで確かめると、アンインストールと同じものを消す", () => {
  it("S0075_02 confirms, runs the installed uninstaller with app data deletion, reports and quits", () => {
    expect(init).toMatch(/MessageBox MB_OKCANCEL[^\n]*重み・キャラクター・設定・統計/);
    expect(init).toMatch(/ExecWait '"[^']*" \/S \/currentuser --delete-app-data _\?=/);
    expect(init).toContain("${UNINSTALL_FILENAME}");
    expect(init).toMatch(/削除しました/);
    expect(init).toMatch(/\bQuit\b/);
  });
});

describe("installer / 確かめで取りやめたら何も消さない [否定]", () => {
  it("S0075_03 returns to the choice on cancel and quits without changes on 中止する", () => {
    // 確かめの取りやめ(IDCANCEL)は選択に戻る。中止(IDCANCEL)は消さずに終わる
    expect(init).toMatch(/MB_OKCANCEL[^\n]*IDCANCEL\s+removeChoice/);
    const cancelBranch = init.slice(init.indexOf("removeCancelled:"));
    expect(cancelBranch.slice(0, cancelBranch.indexOf("Quit"))).not.toMatch(
      /ExecWait|RMDir|Delete/,
    );
  });
});

describe("installer / 入っていない状態では選択を出さない [境界]", () => {
  it("S0075_04 skips the choice when no installation location is registered", () => {
    expect(init).toMatch(/\$\{If\} \$keycheerInstalled == ""\s+Goto removeSkip/);
  });
});

describe("installer / 削除には重みの別ファイルが要らない [境界]", () => {
  it("S0075_05 removes before the license page and never looks for the weight files", () => {
    expect(init).not.toContain("--install-weights");
    expect(init).not.toContain("$EXEDIR");
  });
});

describe("installer / 削除で通信しない [否定]", () => {
  it("S0075_06 uses no download plugin or URL in the removal", () => {
    expect(init).not.toMatch(/inetc|NSISdl|https?:\/\//i);
  });
});

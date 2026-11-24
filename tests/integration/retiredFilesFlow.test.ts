// 総合: 起動時に前の版が残したもの(API キーの保存先・監査ログ)を実際のファイルの上で消す(論点 0054)。
// index.ts と同じ受け渡し(rmSync の force)で、実の一時ディレクトリを使う。

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeRetiredFiles } from "../../src/main/retiredFiles.js";

let dir: string | null = null;
afterEach(() => {
  if (dir !== null) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("総合: 起動時の前の版のファイルの掃除", () => {
  it("2 つのファイルだけを消し、キャラクター・設定は残し、2 回目の起動でも落ちない", () => {
    dir = mkdtempSync(join(tmpdir(), "keycheer-retired-"));
    writeFileSync(join(dir, "secrets.json"), '{"keycheer.api-key.openai":"enc"}');
    writeFileSync(join(dir, "audit.log.json"), "[]");
    writeFileSync(join(dir, "config.json"), "{}");
    mkdirSync(join(dir, "characters", "c1"), { recursive: true });
    writeFileSync(join(dir, "characters", "c1", "pool.json"), "{}");

    const removeFile = (path: string) => rmSync(path, { force: true });
    removeRetiredFiles({ userDataDir: dir, removeFile });

    expect(existsSync(join(dir, "secrets.json"))).toBe(false);
    expect(existsSync(join(dir, "audit.log.json"))).toBe(false);
    expect(existsSync(join(dir, "config.json"))).toBe(true);
    expect(existsSync(join(dir, "characters", "c1", "pool.json"))).toBe(true);

    // 消すものが無い 2 回目の起動
    expect(() => removeRetiredFiles({ userDataDir: dir!, removeFile })).not.toThrow();
  });
});

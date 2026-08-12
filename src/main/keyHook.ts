// keyHook: uiohook-napi の薄いアダプタ。グローバルキーフックを core の発動経路に橋渡しする。
//
// ★ プライバシー不変条件(security-rules.md「このプロジェクト固有」):
//   キーフックは「キーの種類のみカウント」= ここでは 1 押下 = 1 コールバックとしてのみ扱う。
//   イベントの keycode / 文字 / 修飾キーは **一切読まない・保存しない・送信しない**。
//   ハンドラは押下時刻(epoch ms)だけを下流へ渡す。キーリピートはデバウンスせず生イベント 1 = 1 カウント。
//
// この層は providers に触れない(発動経路)。テスト対象外の I/O グルー(uiohook を import するため)。

import { uIOhook } from "uiohook-napi";

export interface KeyHook {
  start(): void;
  stop(): void;
}

// onKeyDown は押下時刻(ms since epoch)のみを受け取る。イベントオブジェクトは渡さない。
export function createKeyHook(onKeyDown: (now: number) => void): KeyHook {
  // e は意図的に参照しない(keycode を読まないことがプライバシー契約)。
  const handler = (): void => onKeyDown(Date.now());

  return {
    start(): void {
      uIOhook.on("keydown", handler);
      uIOhook.start();
    },
    stop(): void {
      uIOhook.removeListener("keydown", handler);
      uIOhook.stop();
    },
  };
}

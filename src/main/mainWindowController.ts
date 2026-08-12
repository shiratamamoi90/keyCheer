// mainWindowController: メインウィンドウの表示/非表示ライフサイクルの決定ロジック。
// spec: 論点 0018
// Electron を import しない。BrowserWindow / dialog の実体は main/mainWindow.ts が
// MainWindowHandle として注入するため、ここは決定的にテストできる。

import { hasCharacter } from "../core/index.js";
import type { Character, Onboarding } from "../core/shared/types.js";

export interface MainWindowHandle {
  isVisible(): boolean;
  show(): void;
  hide(): void;
  focus(): void;
}

// シナリオ: キャラクター未作成なら起動時にメインウィンドウを表示する
//         / キャラクター作成済みなら表示しない / スキップ済みなら未作成でも表示しない
export function shouldAutoShowMainWindow(
  character: Partial<Character> | undefined,
  onboarding: Onboarding,
): boolean {
  return !hasCharacter(character) && !onboarding.skipMainWindowAutoShow;
}

// シナリオ: トレイクリックで表示する / 隠す(トグル)/ 重複表示の防止
// (show() は BrowserWindow.show の冪等呼び出しに委ねる。ここでは可視状態だけで分岐する)
export function toggleMainWindow(win: MainWindowHandle): void {
  if (win.isVisible()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
}

// シナリオ: 作成済みなら閉じてもダイアログを出さない / 未作成のまま閉じるとダイアログが出る
export type CloseDecision = "hide" | "confirm";

export function decideOnMainWindowClose(character: Partial<Character> | undefined): CloseDecision {
  return hasCharacter(character) ? "hide" : "confirm";
}

// シナリオ: ダイアログでチェックして/せず閉じた場合。
// チェックなしなら onboarding は変更しない(既に true でもそのまま。false に戻すことはない)。
export function applyCloseConfirmation(checked: boolean, onboarding: Onboarding): Onboarding {
  if (!checked) return onboarding;
  return { ...onboarding, skipMainWindowAutoShow: true };
}

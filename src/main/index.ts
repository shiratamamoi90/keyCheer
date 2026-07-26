// index: Electron メインプロセスのエントリ。各 I/O アダプタを配線するライフサイクル層。
// ここは「発動経路の配線」に徹する。キャラ作成フロー(providers を使う)は
// characterCreationIpc.ts に分離してあり、この経路に providers を混ぜない
// (privacy 不変条件:発動経路は外部依存ゼロ。eslint.config.js で import レベルで強制)。
//
// テスト対象外(electron/uiohook を import する I/O グルー)。検証は typecheck / lint。

import { app } from "electron";
import { existsSync as fsExistsSync } from "node:fs";
import { createStore, createAppStore } from "./store.js";
import { createKeyHook } from "./keyHook.js";
import { createCheerRuntime } from "./cheerRuntime.js";
import { createPopupWindow } from "./windows.js";
import { createMainWindow } from "./mainWindow.js";
import { createTray } from "./tray.js";
import { registerIpcHandlers } from "./ipc.js";
import { registerAudioProtocol } from "./audioProtocol.js";
import { createNodeCharacterFs } from "./nodeCharacterFs.js";
import { loadPool } from "./characterStore.js";
import { registerCharacterCreation } from "./characterCreationIpc.js";
import { IpcChannel } from "../shared/ipc.js";

// 単一インスタンス化(キーフックの多重登録・トレイ重複を防ぐ)。
// ロックを取れなかった側は quit を要求し、以降の初期化(キーフック登録)へは進まない。
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

// 統計をディスクへ書き戻す間隔。キー 1 打ごとに書かない(specs/key-counter.md 不変条件)。
const STATS_FLUSH_INTERVAL_MS = 10_000;

function bootstrap(): void {
  const store = createAppStore(createStore());
  const { config, migrated } = store.loadTriggerConfig();
  const stats = store.loadStats();

  registerAudioProtocol(app.getPath("userData"));
  const popupWindow = createPopupWindow();

  // メインウィンドウ(将来キャラ作成 UI を載せる場所)。キャラ未作成 かつ 自動表示未スキップなら
  // 起動時に自動表示する(changes/0008-main-window-character-creation/spec.md)。
  const mainWindow = createMainWindow({
    getCharacter: () => store.loadCharacter(),
    getOnboarding: () => store.loadOnboarding(),
    saveOnboarding: (onboarding) => store.saveOnboarding(onboarding),
  });
  mainWindow.showIfNeeded();
  // 表示中に次の発動が来たら上書き + 表示時間リセット(spec 0007 確定事項 #3)。
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  // 発動経路の配線:onKeyPress → wav 解決 → ポップアップ IPC + 履歴記録。
  const cheerRuntime = createCheerRuntime(
    {
      userDataDir: app.getPath("userData"),
      popupDurationMs: 5000, // TODO: popup.duration 設定を反映
      wavExists: (path) => fsExistsSync(path),
      emitCheer: (payload) => {
        if (popupWindow.isDestroyed()) return;
        popupWindow.showInactive(); // フォーカスを奪わずに表示する
        popupWindow.webContents.send(IpcChannel.CheerFired, payload);
        if (hideTimer !== undefined) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          if (!popupWindow.isDestroyed()) popupWindow.hide();
        }, payload.popupDurationMs);
      },
      recordHistory: (entry) => store.appendCheerHistory(entry),
      // まとめ書き:キー数とアクティブ秒数を日付ごとに永続化する
      recordStats: ({ day, keys, activeSeconds }) => {
        store.recordKeyCount(day, keys);
        if (activeSeconds > 0) store.addActiveSeconds(day, activeSeconds);
      },
    },
    config,
    // 発動判定は累計カウント基準(specs/cheer-trigger.md)。前回までの累計から継続する。
    { initialCount: stats.totalKeyCount },
  );

  // 起動時に既存キャラのプールを読み込んで発動経路へ紐付ける(changes/0011)。
  // プールが無い / 壊れている場合は null のまま = baseline 定型文で応援する。
  const characterFs = createNodeCharacterFs();
  const savedCharacter = store.loadCharacter();
  const savedPool =
    savedCharacter?.id !== undefined
      ? loadPool(characterFs, app.getPath("userData"), savedCharacter.id)
      : null;
  cheerRuntime.setActiveCharacter(savedCharacter?.id ?? null, savedPool);

  // キーフック:押下ごとにカウント記録 + 発動判定。keycode は読まない(privacy)。
  // カウンタはメモリ上で加算し、ディスクへは定期 flush する(specs/key-counter.md 不変条件)。
  const keyHook = createKeyHook((now) => cheerRuntime.handleKeyPress(now));
  keyHook.start();

  const flushTimer = setInterval(() => cheerRuntime.flushStats(), STATS_FLUSH_INTERVAL_MS);

  registerIpcHandlers({
    store,
    onConfigUpdated: (next) => cheerRuntime.setConfig(next),
  });

  // キャラ作成(プール・wav 生成)の配線。providers を使うのはこのモジュールの中だけで、
  // 発動経路(上の cheerRuntime 配線)には混ざらない。
  registerCharacterCreation({
    store,
    fs: characterFs,
    userDataDir: app.getPath("userData"),
    // シナリオ: 生成直後は再起動なしで応援に反映される
    onPoolReady: (characterId, pool) => cheerRuntime.setActiveCharacter(characterId, pool),
    getWindow: () => mainWindow.win,
  });

  createTray({ onQuit: () => app.quit(), onShowMain: () => mainWindow.toggle() });

  // 旧既定(regular=100)からの移行通知(specs/data-model.md)。
  // 表示先の設定ウィンドウは本スライスに無いため、今はログに残すだけ。
  // 設定 UI の change で IpcChannel.ConfigMigrated を使って画面に出す。
  if (migrated) {
    console.info(
      `[keycheer] triggers.regular を既定値 ${config.regular} にリセットしました(旧既定 100)`,
    );
  }

  // 常駐アプリ:全ウィンドウを閉じても終了しない(トレイに残る)。
  app.on("window-all-closed", () => {
    // no-op(明示終了はトレイの「終了」/ app.quit のみ)
  });

  // 終了前に未書き込みの統計を確定させる(取りこぼし防止)。
  app.on("before-quit", () => {
    clearInterval(flushTimer);
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    keyHook.stop();
    cheerRuntime.flushStats();
  });
}

if (hasSingleInstanceLock) {
  void app.whenReady().then(bootstrap);
}

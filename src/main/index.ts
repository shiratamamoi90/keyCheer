// index: Electron メインプロセスのエントリ。各 I/O アダプタを配線するライフサイクル層。
// ここは「発動経路の配線」に徹する。キャラ作成フロー(プロバイダー実装を使う)は
// characterCreationIpc.ts に分離してあり、この経路にプロバイダー実装を混ぜない
// (privacy 不変条件:発動経路は外部依存ゼロ。eslint.config.js で import レベルで強制)。
//
// テスト対象外(electron/uiohook を import する I/O グルー)。検証は typecheck / lint。

import { app, nativeTheme } from "electron";
import { existsSync as fsExistsSync, rmSync } from "node:fs";
import { createStore, createAppStore } from "./store.js";
import { removeRetiredFiles } from "./retiredFiles.js";
import { createKeyHook } from "./keyHook.js";
import { createCheerRuntime } from "./cheerRuntime.js";
import {
  applyAlwaysShow,
  createPopupWindow,
  getWorkAreas,
  setPopupCaptureMouse,
} from "./windows.js";
import { createPopupPointerHandler } from "./popupPointer.js";
import { resolvePopupPosition, shouldShowWindowOnCheer } from "../core/shared/popupLayout.js";
import { createMainWindow } from "./mainWindow.js";
import { createTray } from "./tray.js";
import { registerIpcHandlers } from "./ipc.js";
import { registerAudioProtocol, registerAudioSchemePrivileges } from "./audioProtocol.js";
import { createNodeCharacterFs } from "./nodeCharacterFs.js";
import { loadPool } from "./characterStore.js";
import { loadActiveCharacterPool } from "./characterSelection.js";
import { registerCharacterCreation } from "./characterCreationIpc.js";
import { IpcChannel } from "../core/shared/ipc.js";
import {
  createBundledRuntimeController,
  createNodeRuntimeSpawn,
  isRuntimeResponding,
  resolveBundledRuntimes,
} from "./bundledRuntime.js";
import { computeFileSha256, isTextModelIntact, resolveTextModelPath } from "./textModelCheck.js";
import { TEXT_MODEL_FILE } from "../core/shared/textModel.js";

// 単一インスタンス化(キーフックの多重登録・トレイ重複を防ぐ)。
// ロックを取れなかった側は quit を要求し、以降の初期化(キーフック登録)へは進まない。
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

// 音声スキームの特権登録は ready より前にしか効かないので、bootstrap ではなくここで行う。
registerAudioSchemePrivileges();

// 統計をディスクへ書き戻す間隔。キー 1 打ごとに書かない(docs/key-counter.md 不変条件)。
const STATS_FLUSH_INTERVAL_MS = 10_000;
// 同梱ランタイムの起動待ちの時間上限(論点 0034 決定 5)。**仮の値** — CPU で応答し始めるまでを Windows 実機で測って直す。
// VOICEVOX ENGINE は CPU で音声モデルを読み込むのに数十秒かかるので、短いと遅い機械で起動に失敗する
const RUNTIME_START_TIMEOUT_MS = 120_000;
const RUNTIME_POLL_INTERVAL_MS = 500;
// 応答の確認 1 回の時間上限。応答しないポートで待ち続けないため
const RUNTIME_HEALTH_TIMEOUT_MS = 2_000;

function bootstrap(): void {
  const characterFs = createNodeCharacterFs();
  // S0054_01〜04 前の版が残した API キーの保存先と監査ログを消す(論点 0054)
  removeRetiredFiles({
    userDataDir: app.getPath("userData"),
    removeFile: (path) => rmSync(path, { force: true }),
  });

  const rawStore = createStore();
  // 旧形式の 1 キャラを移すときに、プールがあれば使用中にする(論点 0032)
  const store = createAppStore(rawStore, {
    hasPool: (characterId) => loadPool(characterFs, app.getPath("userData"), characterId) !== null,
  });
  const { config, migrated } = store.loadTriggerConfig();
  const stats = store.loadStats();

  registerAudioProtocol(app.getPath("userData"));
  // S0052_06 / S0052_07 覚えた位置に出す。画面の外になっていれば既定の右下に出す
  const popupWindow = createPopupWindow(
    resolvePopupPosition(store.loadPopupPosition(), getWorkAreas()),
  );

  // メインウィンドウ(将来キャラ作成 UI を載せる場所)。キャラ未作成 かつ 自動表示未スキップなら
  // 起動時に自動表示する(論点 0018)。
  // 終了中か。メインウィンドウは × では閉じずに隠すので、終了のときだけ閉じさせるために要る
  let isQuitting = false;
  app.on("before-quit", () => {
    isQuitting = true;
  });
  const mainWindow = createMainWindow({
    getCharacters: () => store.loadCharacters(),
    getOnboarding: () => store.loadOnboarding(),
    saveOnboarding: (onboarding) => store.saveOnboarding(onboarding),
    isQuitting: () => isQuitting,
  });
  mainWindow.showIfNeeded();
  // 表示中に次の発動が来たら上書き + 表示時間リセット(spec 0007 確定事項 #3)。
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  // キャラ画像の常時表示(論点 0036)。待機画像と常時表示の設定を窓へ送り、窓を出す・隠す。
  let popupDisplay = store.loadPopupDisplay();
  let idleImagePath: string | null = null;
  // キャラの窓を絵をつかんで動かす(論点 0052)。絵が出ているのは、常時表示で待機画像があるとき
  // (常時表示を切ると renderer は絵を描かない。docs/popup.md S0036_24)
  const popupPointer = createPopupPointerHandler({
    isImageShown: () => popupDisplay.shouldAlwaysShow && idleImagePath !== null,
    setCaptureMouse: (shouldCapture) => setPopupCaptureMouse(popupWindow, shouldCapture),
    getWindowPosition: () => {
      const [x = 0, y = 0] = popupWindow.getPosition();
      return { x, y };
    },
    setWindowPosition: (position) => {
      if (!popupWindow.isDestroyed()) popupWindow.setPosition(position.x, position.y);
    },
    savePosition: (position) => store.savePopupPosition(position),
  });
  const sendCharacterDisplay = (): void => {
    if (popupWindow.isDestroyed()) return;
    popupWindow.webContents.send(IpcChannel.CharacterDisplay, {
      idleImagePath,
      shouldAlwaysShow: popupDisplay.shouldAlwaysShow,
      shouldShowMessage: popupDisplay.shouldShowMessage,
    });
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    applyAlwaysShow(popupWindow, popupDisplay.shouldAlwaysShow);
    // 絵が替わった・消えたら、ポインタの状態を忘れてクリックを通す状態へ戻す(S0052_04)
    popupPointer.reset();
  };
  // 起動直後は renderer の読み込みが終わっていないので、読み込み後にもう一度送る
  popupWindow.webContents.on("did-finish-load", sendCharacterDisplay);

  // 発動経路の配線:onKeyPress → wav 解決 → ポップアップ IPC + 履歴記録。
  const cheerRuntime = createCheerRuntime(
    {
      userDataDir: app.getPath("userData"),
      popupDurationMs: 5000, // TODO: popup.duration 設定を反映
      wavExists: (path) => fsExistsSync(path),
      imageExists: (path) => fsExistsSync(path),
      emitCharacterDisplay: (display) => {
        idleImagePath = display.idleImagePath;
        sendCharacterDisplay();
      },
      emitCheer: (payload) => {
        if (popupWindow.isDestroyed()) return;
        // S0053_06 セリフも常時表示も切っているときは窓を出さない。音声は renderer が鳴らすので、ペイロードは送る
        if (!shouldShowWindowOnCheer(popupDisplay)) {
          popupWindow.webContents.send(IpcChannel.CheerFired, payload);
          return;
        }
        popupWindow.showInactive(); // フォーカスを奪わずに表示する
        popupWindow.webContents.send(IpcChannel.CheerFired, payload);
        if (hideTimer !== undefined) clearTimeout(hideTimer);
        // 常時表示なら窓は消さない(文言だけ renderer が消す。S0036_19)
        if (popupDisplay.shouldAlwaysShow) return;
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
    // 発動判定は累計カウント基準(docs/cheer-trigger.md)。前回までの累計から継続する。
    { initialCount: stats.totalKeyCount },
  );

  // 起動時に使用中のキャラクターのプールを読み込んで発動経路へ紐付ける(論点 0020 / 0032)。
  // 使用中が無い・指す先が一覧に無い・プールが無い / 壊れている場合は null = baseline 定型文で応援する。
  const active = loadActiveCharacterPool({
    store,
    loadPool: (characterId) => loadPool(characterFs, app.getPath("userData"), characterId),
  });
  cheerRuntime.setActiveCharacter(active?.characterId ?? null, active?.pool ?? null);

  // キーフック:押下ごとにカウント記録 + 発動判定。keycode は読まない(privacy)。
  // カウンタはメモリ上で加算し、ディスクへは定期 flush する(docs/key-counter.md 不変条件)。
  const keyHook = createKeyHook((now) => cheerRuntime.handleKeyPress(now));
  keyHook.start();

  const flushTimer = setInterval(() => cheerRuntime.flushStats(), STATS_FLUSH_INTERVAL_MS);

  registerIpcHandlers({
    store,
    isOsDark: () => nativeTheme.shouldUseDarkColors,
    onConfigUpdated: (next) => cheerRuntime.setConfig(next),
    // S0036_29 再起動しなくても窓を出す・隠す
    onPopupDisplayUpdated: (next) => {
      popupDisplay = next;
      sendCharacterDisplay();
    },
    onPopupPointer: (raw) => popupPointer.handle(raw),
  });

  // 同梱ランタイム(Ollama / VOICEVOX ENGINE。論点 0034)。メインウィンドウの表示中だけ起動する。
  // 配布物では resources/ にあり、開発起動(vendor/ に無い)では起動を試みず既存の接続先を使う(S0034_13)
  const bundledRuntimes = createBundledRuntimeController({
    runtimes: resolveBundledRuntimes({
      resourcesDir: app.isPackaged ? process.resourcesPath : `${app.getAppPath()}/vendor`,
      userDataDir: app.getPath("userData"),
      platform: process.platform,
    }),
    exists: fsExistsSync,
    spawn: createNodeRuntimeSpawn(),
    isResponding: (url) => isRuntimeResponding(url, RUNTIME_HEALTH_TIMEOUT_MS),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    startTimeoutMs: RUNTIME_START_TIMEOUT_MS,
    pollIntervalMs: RUNTIME_POLL_INTERVAL_MS,
  });
  const mainWin = mainWindow.win;
  mainWin.on("show", () => void bundledRuntimes.onMainWindowShown());
  mainWin.on("hide", () => bundledRuntimes.onMainWindowHidden());
  // 起動時に自動で表示した場合は show が登録より先に出ているので、ここで追いつく
  if (mainWin.isVisible()) void bundledRuntimes.onMainWindowShown();

  // キャラ作成(プール・wav 生成)の配線。プロバイダー実装を使うのはこのモジュールの中だけで、
  // 発動経路(上の cheerRuntime 配線)には混ざらない。
  const characterCreation = registerCharacterCreation({
    store,
    fs: characterFs,
    userDataDir: app.getPath("userData"),
    // シナリオ: 生成直後は再起動なしで応援に反映される
    onActiveCharacterChanged: (characterId, pool) =>
      cheerRuntime.setActiveCharacter(characterId, pool),
    onActiveCharacterRemoved: () => cheerRuntime.setActiveCharacter(null, null),
    getWindow: () => mainWindow.win,
    // 同梱した sd.cpp(論点 0040)。配布物では resources/、開発時はリポジトリの vendor/(scripts/fetch-sdcpp.sh の置き先)
    sdcpp: {
      resourcesDir: app.isPackaged ? process.resourcesPath : `${app.getAppPath()}/vendor`,
      tempDir: `${app.getPath("temp")}/keycheer-sdcpp`,
    },
    runtimes: bundledRuntimes,
    // 論点 0059 配布物のテキストモデル(インストーラが置く)を、生成を始めるたびに照合する
    isTextModelIntact: () =>
      isTextModelIntact({
        path: resolveTextModelPath(app.getPath("userData")),
        expectedSha256: TEXT_MODEL_FILE.sha256,
        computeSha256: computeFileSha256,
      }),
  });

  // S0057_02 OS の設定が変わったら、開いているメインウィンドウへ知らせる(見た目は renderer が決める)。
  // nativeTheme のテーマの出どころ(source)は書き換えない — 書き換えると OS の確認ダイアログまでアプリのテーマに引きずられる(S0057_05)
  nativeTheme.on("updated", () => {
    const win = mainWindow.win;
    if (win !== null && !win.isDestroyed()) {
      win.webContents.send(IpcChannel.OsThemeChanged, nativeTheme.shouldUseDarkColors);
    }
  });

  createTray({ onQuit: () => app.quit(), onShowMain: () => mainWindow.toggle() });

  // 旧既定(regular=100)からの移行通知(docs/data-model.md)。
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
    // S0040_05 アプリ終了時に、実行中の sd.cpp を止める
    characterCreation.stopSdcpp();
    // S0034_09 アプリ終了時に、起動した同梱ランタイムを必ず止める
    bundledRuntimes.stopAll();
  });
}

if (hasSingleInstanceLock) {
  void app.whenReady().then(bootstrap);
}

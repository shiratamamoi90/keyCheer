// mainEntry: メインウィンドウ(キャラクター・切り替え・設定の 3 タブ)の描画エントリ。
// spec: 論点 0019 / 0020 / 0032 / 0033 / 0061
//
// バンドラを使わない。React / ReactDOM は main.html が UMD の <script> で読み込み、JSX は tsc が
// React.createElement に変換する(tsconfig の jsx: react。globals.d.ts。論点 0079)。
// 画面ごとの表示は characterScreen / switchScreen / settingsScreen、共通の部品は ui に置く。
// 入力・生成・設定の状態は、タブを切り替えても残すためにここ(アプリの根)で持つ。
// core 実装 / providers / agent は import しない(renderer は「使う側」に留める)。

import type * as ReactNS from "react";
import { APP_DISPLAY_NAME } from "../core/shared/appIdentity.js";
import {
  applyMainScreenEvent,
  generationTabBadge,
  initialMainScreenState,
  MAIN_SCREENS,
  type MainScreen,
} from "./mainScreen.js";
import { CharacterScreen, useCharacterEditor } from "./characterScreen.js";
import { SwitchScreen } from "./switchScreen.js";
import { SettingsScreen, useSettings } from "./settingsScreen.js";
import { useImageRegeneration } from "./imagePanel.js";
import { Message, Pill } from "./ui.js";

const SCREEN_LABEL: Record<MainScreen, string> = {
  character: "キャラクター",
  switch: "切り替え",
  settings: "設定",
};

function App(): ReactNS.ReactElement {
  // 画面(タブ)・一覧・生成の状態は mainScreen の純粋関数で動かす(論点 0033)
  const [state, dispatch] = React.useReducer(applyMainScreenEvent, initialMainScreenState());
  const [status, setStatus] = React.useState<string | null>(null);

  // 一覧を読み直すと、画像を作れるか(重みの有無)も読み直す。後者は画像の作り直しの状態が持つ
  const refreshCanMakeImagesRef = React.useRef<() => void>(() => {});
  const refreshCharacters = React.useCallback((): void => {
    void window.keycheer.listCharacters().then((items) => {
      dispatch({ type: "characters-loaded", items });
    });
    refreshCanMakeImagesRef.current();
  }, []);
  const regeneration = useImageRegeneration(refreshCharacters);
  refreshCanMakeImagesRef.current = regeneration.refreshCanMakeImages;

  const editor = useCharacterEditor({ state, dispatch, refreshCharacters, setStatus });
  const settings = useSettings();

  // シナリオ: 最初に出す画面(S0033_02〜04)。読み込み時と、非表示から表示になるたびに決め直す。
  React.useEffect(() => {
    const showInitialScreen = (): void => {
      void window.keycheer.listCharacters().then((items) => {
        dispatch({ type: "window-shown", items });
      });
    };
    showInitialScreen();
    return window.keycheer.onMainWindowShown(showInitialScreen);
  }, []);

  // シナリオ: 生成の進捗が通知される。終わったら一覧(プールの有無・使用中)を読み直す
  React.useEffect(() => {
    return window.keycheer.onGenerationProgress((payload) => {
      dispatch({ type: "generation", payload });
      if (payload.type !== "progress") refreshCharacters();
    });
  }, [refreshCharacters]);

  const isAnythingRunning =
    generationTabBadge(state.generation) !== null ||
    regeneration.progress?.type === "progress" ||
    state.items.some((item) => item.isGenerating);

  return (
    <div className="flex min-h-screen flex-col">
      {/* S0061_01 3 つの画面をタブでいつでも切り替えられる / S0033_07 生成中はキャラクタータブに示す */}
      <header className="sticky top-0 z-10 border-b border-line bg-surface">
        <nav className="flex gap-1 px-3 pt-2" role="tablist" aria-label="画面">
          {MAIN_SCREENS.map((screen) => {
            const badge = screen === "character" ? generationTabBadge(state.generation) : null;
            const isActive = screen === state.screen;
            return (
              <button
                key={screen}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`flex items-center gap-1.5 border-b-[3px] px-3.5 pb-2.5 pt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
                  isActive
                    ? "border-accent font-semibold text-fg"
                    : "border-transparent text-muted hover:text-fg"
                }`}
                onClick={() => {
                  setStatus(null);
                  dispatch({ type: "tab-selected", screen });
                }}
              >
                {SCREEN_LABEL[screen]}
                {badge !== null ? <Pill text={badge} /> : null}
              </button>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-5">
        {state.screen === "character" ? (
          <CharacterScreen
            state={state}
            editor={editor}
            status={status}
            regeneration={regeneration}
            isAnythingRunning={isAnythingRunning}
          />
        ) : state.screen === "switch" ? (
          <SwitchScreen
            state={state}
            dispatch={dispatch}
            refreshCharacters={refreshCharacters}
            setStatus={setStatus}
            regeneration={regeneration}
            isAnythingRunning={isAnythingRunning}
          />
        ) : (
          <SettingsScreen settings={settings} />
        )}
        {state.screen !== "character" && status !== null ? (
          <Message kind="info" text={status} />
        ) : null}
      </main>
    </div>
  );
}

// 論点 0077 窓の題名は見える名前の定義から付ける(HTML に名前を直書きしない)
document.title = APP_DISPLAY_NAME;
const container = document.getElementById("root");
if (container !== null) {
  ReactDOM.createRoot(container).render(<App />);
}

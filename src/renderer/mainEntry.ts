// mainEntry: メインウィンドウ(キャラクター・切り替え・設定の 3 タブ)の描画エントリ。
// spec: 論点 0019 / 0020 / 0032 / 0033 / 0061
//
// バンドラを使わない(0007 確定事項の延長)ため、React/ReactDOM は main.html が UMD の
// <script> でグローバルとして読み込む。JSX は使わず React.createElement を直接呼ぶ
// ("react/jsx-runtime" の ESM import が発生する自動ランタイムを避けるため — ブラウザの
// ESM は bare specifier を解決できず、UMD も ESM の named export を持たないので噛み合わない)。
//
// 検証ロジックは characterForm.ts、画面の状態遷移と一覧は mainScreen.ts(どちらも純粋関数)に置き
// テストで縛る。ここは DOM 配線だけの
// I/O グルーでユニットテスト対象外 — 検証は typecheck / lint / 実機確認。
// core 実装 / providers / agent は import しない(renderer は「使う側」に留める)。

import { resolveEditableSpeakerId } from "../core/shared/selectableSpeaker.js";
import type * as ReactNS from "react";
import type * as ReactDOMClientNS from "react-dom/client";
import {
  validateCharacterForm,
  toCharacterProfile,
  CHARACTER_NAME_MAX,
  CHARACTER_PERSONALITY_MAX,
  type CharacterFormError,
} from "./characterForm.js";
import {
  resolveGenerateButton,
  progressLabel,
  START_GENERATION_LABEL,
  shouldConfirmRebuild,
  REBUILD_CONFIRMATION_TEXT,
} from "./generationView.js";
import {
  MAIN_SCREENS,
  initialMainScreenState,
  applyMainScreenEvent,
  generationTabBadge,
  canShowGenerationControls,
  buildGenerationHeading,
  buildSwitchList,
  switchEmptyNotice,
  type MainScreen,
} from "./mainScreen.js";
import { createThemeController, type ThemeController } from "./theme.js";
import {
  buildImageSlots,
  canShowGeneratedImages,
  resolveImageRegeneration,
} from "./characterImagesView.js";
import type { CharacterListItem, ImageRegenerationProgressPayload } from "../core/shared/ipc.js";
import {
  THEME_SETTINGS,
  type ThemeSetting,
  type GenerationConfig,
  type PopupDisplayConfig,
} from "../core/shared/types.js";
import type { SpeakerOption } from "../core/shared/ipc.js";
// window.keycheer の型は preload の公開 API がそのまま正本(popup.ts と同じ宣言を共有する)。
// 型だけの import なので renderer → preload の実行時依存は生まれない。
import type { KeyCheerApi } from "../preload/api.js";

// 画像だけ作り直すの文言(論点 0050)
const IMAGE_REGENERATION_FAILURE_TEXT: Record<
  "already-running" | "no-character" | "no-pool" | "runtime-not-installed",
  string
> = {
  "already-running": "生成中です。終わってから作り直せます",
  "no-character": "キャラクターが見つかりません",
  "no-pool": "まだ生成していないキャラクターです",
  "runtime-not-installed": "画像生成のモデルの重みがありません。インストーラで入れ直してください",
};
const IMAGE_REGENERATION_RESULT_TEXT: Record<"images-failed" | "cancelled", string> = {
  "images-failed": "画像を作れませんでした。前の画像のままです",
  cancelled: "作り直しを中断しました。前の画像のままです",
};

// テーマの選択肢の文言(論点 0057)
const THEME_LABELS: Record<ThemeSetting, string> = {
  system: "システムに合わせる",
  light: "ライト",
  dark: "ダーク",
};

declare const React: typeof ReactNS;
declare const ReactDOM: typeof ReactDOMClientNS;

declare global {
  interface Window {
    keycheer: KeyCheerApi;
  }
}

const ERROR_TEXT: Record<string, string> = {
  "name:required": "名前を入力してください",
  "name:too-long": `名前は ${CHARACTER_NAME_MAX} 文字以内で入力してください`,
  "personality:required": "性格を入力してください",
  "personality:too-long": `性格は ${CHARACTER_PERSONALITY_MAX} 文字以内で入力してください`,
  "speakerId:required": "話者を選択してください",
};

const SCREEN_LABEL: Record<MainScreen, string> = {
  character: "キャラクター",
  switch: "切り替え",
  settings: "設定",
};

const DELETE_FAILURE_TEXT: Record<string, string> = {
  generating: "生成中のキャラクターは削除できません",
  "remove-failed": "生成物を削除できませんでした。開いているファイルを閉じてからやり直してください",
  "not-found": "キャラクターが見つかりません",
};

const ACTIVATE_FAILURE_TEXT: Record<string, string> = {
  generating: "生成中のキャラクターは使用中にできません",
  "no-pool": "生成が済んでいません",
  "not-found": "キャラクターが見つかりません",
  "invalid-request": "切り替えられませんでした",
};

function errorText(error: CharacterFormError): string {
  return ERROR_TEXT[`${error.field}:${error.reason}`] ?? "入力を確認してください";
}

// ---- 見た目の部品(論点 0058)。振る舞いは持たない。色は styles/main.css の変数が決める ----

type Child = ReactNS.ReactNode;

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50";
const BUTTON_CLASS = {
  primary: `${BUTTON_BASE} bg-accent text-on-accent hover:bg-accent/90`,
  secondary: `${BUTTON_BASE} border border-line bg-sunken text-fg hover:bg-line/60`,
  danger: `${BUTTON_BASE} border border-danger/40 text-danger hover:bg-danger-soft`,
} as const;
type ButtonVariant = keyof typeof BUTTON_CLASS;

const FIELD_BASE_CLASS =
  "rounded-lg border border-line bg-sunken px-3 py-2 text-fg placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60";
const FIELD_CLASS = `${FIELD_BASE_CLASS} w-full`;

const MESSAGE_CLASS = {
  notice: "rounded-lg bg-warn-soft px-3 py-2 text-warn",
  error: "rounded-lg bg-danger-soft px-3 py-2 text-danger",
  info: "text-muted",
  ok: "rounded-lg bg-ok-soft px-3 py-2 text-ok",
} as const;
type MessageKind = keyof typeof MESSAGE_CLASS;

function button(
  variant: ButtonVariant,
  props: { key?: string; disabled?: boolean; onClick: () => void },
  label: Child,
): ReactNS.ReactElement {
  return React.createElement(
    "button",
    { ...props, type: "button", className: BUTTON_CLASS[variant] },
    label,
  );
}

function message(kind: MessageKind, text: string, key?: string): ReactNS.ReactElement {
  return React.createElement("p", { key, className: `m-0 ${MESSAGE_CLASS[kind]}` }, text);
}

function card(key: string, heading: Child | null, ...children: Child[]): ReactNS.ReactElement {
  return React.createElement(
    "section",
    {
      key,
      className:
        "flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card",
    },
    heading === null
      ? null
      : React.createElement("h2", { className: "m-0 text-base font-semibold" }, heading),
    ...children,
  );
}

function field(key: string, label: string, control: Child): ReactNS.ReactElement {
  return React.createElement(
    "label",
    { key, className: "flex flex-col gap-1.5" },
    React.createElement("span", { className: "text-xs font-medium text-muted" }, label),
    control,
  );
}

function pill(text: string, isBusy = false): ReactNS.ReactElement {
  return React.createElement(
    "span",
    {
      key: text,
      className: `whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${
        isBusy ? "bg-sunken text-muted" : "bg-accent-soft text-accent"
      }`,
    },
    text,
  );
}

// 設定の 1 行(Windows 11 の設定画面のように、左に説明・右に切り替え)
function settingRow(key: string, label: string, control: Child): ReactNS.ReactElement {
  return React.createElement(
    "div",
    { key, className: "flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0" },
    React.createElement("span", { className: "min-w-0 flex-1" }, label),
    control,
  );
}

function toggleSwitch(props: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}): ReactNS.ReactElement {
  return React.createElement(
    "label",
    { className: "relative inline-flex shrink-0 cursor-pointer items-center" },
    React.createElement("input", {
      type: "checkbox",
      className: "peer sr-only",
      "aria-label": props.label,
      checked: props.checked,
      disabled: props.disabled,
      onChange: (e: ReactNS.ChangeEvent<HTMLInputElement>) => props.onChange(e.target.checked),
    }),
    React.createElement("span", {
      className:
        "h-5 w-9 rounded-full bg-line transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60 peer-disabled:opacity-50",
    }),
    React.createElement("span", {
      className:
        "pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4",
    }),
  );
}

// 一覧の 1 件(保存画面・切り替え画面)。待機画像があれば小さく出す
function characterCard(props: {
  key: string;
  name: string;
  meta: string | null;
  pills: ReactNS.ReactElement[];
  thumbnailUrl: string | null;
  isSelected: boolean;
  isDimmed?: boolean;
  onClick: () => void;
}): ReactNS.ReactElement {
  return React.createElement(
    "button",
    {
      key: props.key,
      type: "button",
      role: "option",
      "aria-selected": props.isSelected,
      onClick: props.onClick,
      className: `flex w-full items-center gap-3 rounded-card border bg-surface p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
        props.isSelected ? "border-accent ring-1 ring-accent" : "border-line hover:border-muted/50"
      } ${props.isDimmed === true ? "opacity-70" : ""}`,
    },
    React.createElement(
      "span",
      {
        className:
          "grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-sunken font-semibold text-accent",
      },
      props.thumbnailUrl === null
        ? (Array.from(props.name)[0] ?? "")
        : React.createElement("img", {
            src: props.thumbnailUrl,
            alt: "",
            className: "h-full w-full object-cover object-top [image-rendering:pixelated]",
          }),
    ),
    React.createElement(
      "span",
      { className: "flex min-w-0 flex-col" },
      React.createElement("span", { className: "truncate font-semibold" }, props.name),
      props.meta === null
        ? null
        : React.createElement("span", { className: "text-xs text-muted" }, props.meta),
    ),
    props.pills.length === 0
      ? null
      : React.createElement("span", { className: "ml-auto flex flex-wrap gap-1" }, ...props.pills),
  );
}

function characterList(label: string, ...cards: Child[]): ReactNS.ReactElement {
  return React.createElement(
    "div",
    { key: "list", role: "listbox", "aria-label": label, className: "flex flex-col gap-2" },
    ...cards,
  );
}

function thumbnailOf(item: CharacterListItem | undefined): string | null {
  if (item === undefined) return null;
  return buildImageSlots(item.images).find((image) => image.kind === "idle")?.url ?? null;
}

// 一覧と、その横の面(S0050_01 一覧の横に 3 枚)
function twoColumns(left: Child, right: Child): ReactNS.ReactElement {
  return React.createElement(
    "div",
    { key: "columns", className: "grid grid-cols-[220px_minmax(0,1fr)] items-start gap-4" },
    left,
    right,
  );
}

function App(): ReactNS.ReactElement {
  // 画面(タブ)・一覧・生成の状態は mainScreen の純粋関数で動かす(論点 0033)
  const [state, dispatch] = React.useReducer(applyMainScreenEvent, initialMainScreenState());
  // 保存画面:編集中のキャラクター(null = 新規)と入力
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [personality, setPersonality] = React.useState("");
  const [speakerId, setSpeakerId] = React.useState<number | null>(null);
  const [speakers, setSpeakers] = React.useState<SpeakerOption[]>([]);
  const [speakersUnavailable, setSpeakersUnavailable] = React.useState(false);
  const [errors, setErrors] = React.useState<CharacterFormError[]>([]);
  const [status, setStatus] = React.useState<string | null>(null);
  const [blocked, setBlocked] = React.useState<string | null>(null);
  // 作り直しの確認を出しているキャラクター(論点 0038。null = 出していない)
  const [rebuildConfirmId, setRebuildConfirmId] = React.useState<string | null>(null);
  // 確認したキャラクター。同意ダイアログを挟んで呼び直すときにも確認済みとして渡す
  const confirmedRebuildIdRef = React.useRef<string | null>(null);
  // 設定画面(論点 0033)
  const [generationConfig, setGenerationConfig] = React.useState<GenerationConfig | null>(null);
  // 常時表示(論点 0036)
  const [popupDisplay, setPopupDisplay] = React.useState<PopupDisplayConfig | null>(null);
  // テーマ(論点 0057)。見た目は <html> の dark クラスで切り替える
  const [theme, setTheme] = React.useState<ThemeSetting | null>(null);
  const themeControllerRef = React.useRef<ThemeController | null>(null);

  React.useEffect(() => {
    let off: (() => void) | null = null;
    void window.keycheer.getTheme().then((snapshot) => {
      setTheme(snapshot.theme);
      const controller = createThemeController({
        setting: snapshot.theme,
        isOsDark: snapshot.isOsDark,
        apply: (resolved) => document.documentElement.classList.toggle("dark", resolved === "dark"),
        save: (next) => void window.keycheer.setTheme(next),
      });
      themeControllerRef.current = controller;
      // S0057_02 OS の設定が変わったらすぐ反映する
      off = window.keycheer.onOsThemeChanged((isOsDark) => controller.onOsChanged(isOsDark));
    });
    return () => off?.();
  }, []);

  // S0057_03 設定画面でテーマを選ぶとすぐ反映する
  const changeTheme = (next: ThemeSetting): void => {
    setTheme(next);
    themeControllerRef.current?.onSettingChanged(next);
  };
  const refreshCharacters = React.useCallback((): void => {
    void window.keycheer.listCharacters().then((items) => {
      dispatch({ type: "characters-loaded", items });
    });
    void window.keycheer.canMakeImages().then(setCanMakeImages);
  }, []);

  // 画像だけ作り直す(論点 0050)。進捗は main から届く。終わったら一覧(画像のパス)を読み直す
  const [canMakeImages, setCanMakeImages] = React.useState(false);
  const [imageRegeneration, setImageRegeneration] =
    React.useState<ImageRegenerationProgressPayload | null>(null);
  const [imageRegenerationError, setImageRegenerationError] = React.useState<string | null>(null);
  React.useEffect(() => {
    void window.keycheer.canMakeImages().then(setCanMakeImages);
    return window.keycheer.onImageRegenerationProgress((payload) => {
      setImageRegeneration(payload);
      if (payload.type !== "progress") refreshCharacters();
    });
  }, [refreshCharacters]);

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

  React.useEffect(() => {
    void window.keycheer.getGenerationConfig().then(setGenerationConfig);
    void window.keycheer.getPopupDisplay().then(setPopupDisplay);
  }, []);

  // シナリオ: 話者一覧を VOICEVOX から取得する / VOICEVOX 未起動でも画面は壊れない [異常系]
  React.useEffect(() => {
    void window.keycheer.getSpeakers().then((result) => {
      if (result.ok) {
        setSpeakers(result.speakers);
      } else {
        setSpeakersUnavailable(true);
      }
    });
  }, []);

  // シナリオ: 生成の進捗が通知される。終わったら一覧(プールの有無・使用中)を読み直す
  React.useEffect(() => {
    return window.keycheer.onGenerationProgress((payload) => {
      dispatch({ type: "generation", payload });
      if (payload.type !== "progress") refreshCharacters();
    });
  }, [refreshCharacters]);

  const startGeneration = (characterId: string): void => {
    setBlocked(null);
    const isRebuildConfirmed = confirmedRebuildIdRef.current === characterId;
    void window.keycheer.startGeneration(characterId, { isRebuildConfirmed }).then((result) => {
      if (result.ok) {
        confirmedRebuildIdRef.current = null;
        dispatch({ type: "generation-started", characterId }); // S0061_06 進捗と結果の持ち主
        refreshCharacters(); // 一覧に生成中を出す(S0033_11)
        return;
      }

      // S0038_07 作り直しになるときは、生成を始める前に確認する
      if (shouldConfirmRebuild(result)) {
        setRebuildConfirmId(characterId);
        return;
      }

      dispatch({ type: "generation", payload: { type: "failed", reason: result.reason } });
    });
  };

  // S0038_07 作り直すを選んだときだけ、確認済みとして呼び直す
  const confirmRebuild = (): void => {
    if (rebuildConfirmId === null) return;
    confirmedRebuildIdRef.current = rebuildConfirmId;
    const characterId = rebuildConfirmId;
    setRebuildConfirmId(null);
    startGeneration(characterId);
  };

  // S0038_08 確認で取りやめたら何も変えない — 呼び直さないだけ(main は確認を求めた時点で何も書いていない)
  const cancelRebuild = (): void => {
    confirmedRebuildIdRef.current = null;
    setRebuildConfirmId(null);
  };

  const fillForm = (editing: CharacterListItem | undefined): void => {
    setEditingId(editing?.id ?? null);
    setName(editing?.name ?? "");
    setPersonality(editing?.personality ?? "");
    // S0044_06 今の話者が選べる話者に無ければ未選択として出す(選び直すまで保存できない)
    setSpeakerId(resolveEditableSpeakerId(editing?.voicevoxSpeakerId ?? null));
    setErrors([]);
    setStatus(null);
  };

  const editCharacter = (characterId: string | null): void => {
    fillForm(state.items.find((c) => c.id === characterId));
  };

  const submit = (): void => {
    const input = { name, personality, speakerId };
    const validation = validateCharacterForm(input);
    setErrors(validation.errors);
    setStatus(null);
    if (!validation.ok) return;

    const profile = toCharacterProfile(input);
    const request = editingId !== null ? { ...profile, id: editingId } : profile;
    void window.keycheer.saveCharacter(request).then((result) => {
      // シナリオ: 保存に失敗した場合 [異常系] — 失敗を伝えるだけで画面は壊さない
      if (!result.ok) {
        setStatus(
          result.errors.includes("character limit reached")
            ? "保存できるのは 10 件までです"
            : "保存できませんでした",
        );
        return;
      }
      // 保存したキャラクターを選んだままにする。そのまま生成ボタンを押せる(論点 0061 S0061_02)。
      // 新規は応答に id が無いので、読み直した一覧で前に無かったものを選ぶ
      const knownIds = new Set(state.items.map((c) => c.id));
      void window.keycheer.listCharacters().then((items) => {
        dispatch({ type: "characters-loaded", items });
        fillForm(
          editingId !== null
            ? items.find((c) => c.id === editingId)
            : items.find((c) => !knownIds.has(c.id)),
        );
        setStatus("保存しました");
      });
      void window.keycheer.canMakeImages().then(setCanMakeImages);
    });
  };

  const removeCharacter = (): void => {
    if (editingId === null) return;
    void window.keycheer.deleteCharacter(editingId).then((result) => {
      if (!result.ok) {
        setStatus(DELETE_FAILURE_TEXT[result.reason] ?? "削除できませんでした");
        return;
      }
      editCharacter(null);
      setStatus("削除しました");
      refreshCharacters();
    });
  };

  const activate = (characterId: string): void => {
    void window.keycheer.activateCharacter(characterId).then((result) => {
      setStatus(
        result.ok ? null : (ACTIVATE_FAILURE_TEXT[result.reason] ?? "切り替えられませんでした"),
      );
      refreshCharacters();
    });
  };

  const changeActivateOnComplete = (checked: boolean): void => {
    const next = { shouldActivateOnComplete: checked };
    void window.keycheer.setGenerationConfig(next).then((result) => {
      if (result.ok) setGenerationConfig(next);
    });
  };

  // S0036_29 設定画面で常時表示を切り替える(保存すると main が再起動なしで窓を出す・隠す)
  // S0053_08 設定画面でセリフを出すかを切り替える(次の応援から効く)
  // 2 つは同じ設定(popup の表示)として保存する。変えていない方は読み込んだ値のまま送る
  const changePopupDisplay = (change: Partial<PopupDisplayConfig>): void => {
    if (popupDisplay === null) return;
    const next = { ...popupDisplay, ...change };
    void window.keycheer.setPopupDisplay(next).then((result) => {
      if (result.ok) setPopupDisplay(next);
    });
  };

  // S0061_01 3 つの画面をタブでいつでも切り替えられる / S0033_07 生成中はキャラクタータブに示す
  const header = React.createElement(
    "header",
    { className: "sticky top-0 z-10 border-b border-line bg-surface" },
    React.createElement(
      "nav",
      { className: "flex gap-1 px-3 pt-2", role: "tablist", "aria-label": "画面" },
      ...MAIN_SCREENS.map((screen) => {
        const badge = screen === "character" ? generationTabBadge(state.generation) : null;
        const isActive = screen === state.screen;
        return React.createElement(
          "button",
          {
            key: screen,
            type: "button",
            role: "tab",
            "aria-selected": isActive,
            className: `flex items-center gap-1.5 border-b-[3px] px-3.5 pb-2.5 pt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
              isActive
                ? "border-accent font-semibold text-fg"
                : "border-transparent text-muted hover:text-fg"
            }`,
            onClick: () => {
              setStatus(null);
              dispatch({ type: "tab-selected", screen });
            },
          },
          SCREEN_LABEL[screen],
          badge !== null ? pill(badge) : null,
        );
      }),
    ),
  );

  const title = (text: string): ReactNS.ReactElement =>
    React.createElement("h1", { key: "h", className: "m-0 text-xl font-semibold" }, text);

  const isAnythingRunning =
    generationTabBadge(state.generation) !== null ||
    imageRegeneration?.type === "progress" ||
    state.items.some((item) => item.isGenerating);

  const startImageRegeneration = (characterId: string): void => {
    setImageRegenerationError(null);
    void window.keycheer.regenerateImages(characterId).then((result) => {
      if (result.ok) {
        setImageRegeneration({ type: "progress", characterId, done: 0, total: 3 });
      } else {
        setImageRegenerationError(IMAGE_REGENERATION_FAILURE_TEXT[result.reason]);
      }
    });
  };

  const progressBar = (done: number, total: number): ReactNS.ReactElement =>
    React.createElement("progress", {
      value: done,
      max: Math.max(total, 1),
      className:
        "h-1.5 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-sunken [&::-webkit-progress-value]:bg-accent",
    });

  // S0050_01 / S0050_03 3 枚を並べる(透明が分かる下地。欠けたら欠けていると示す)
  // S0050_06 / S0050_07 「画像だけ作り直す」と、使えないときの理由
  const imagePanel = (
    item: CharacterListItem,
    key: string,
    leadingAction: ReactNS.ReactElement | null = null,
  ): ReactNS.ReactElement => {
    const availability = resolveImageRegeneration({ canMakeImages, isRunning: isAnythingRunning });
    const regen = imageRegeneration?.characterId === item.id ? imageRegeneration : null;
    return card(
      key,
      React.createElement(
        "span",
        { className: "flex flex-wrap items-baseline gap-x-3 gap-y-1" },
        item.name,
        React.createElement(
          "span",
          { className: "text-xs font-normal text-muted" },
          "作った画像(市松模様は透明な部分)",
        ),
      ),
      React.createElement(
        "div",
        { key: "slots", className: "grid grid-cols-3 gap-3" },
        ...buildImageSlots(item.images).map((image) =>
          React.createElement(
            "figure",
            { key: image.kind, className: "m-0 flex min-w-0 flex-col gap-1.5" },
            React.createElement(
              "div",
              {
                className:
                  "checkerboard grid aspect-[2/3] max-w-full place-items-center overflow-hidden rounded-lg border border-line",
              },
              image.url === null
                ? React.createElement(
                    "span",
                    { className: "p-2 text-center text-xs text-danger" },
                    "画像がありません",
                  )
                : React.createElement("img", {
                    src: image.url,
                    alt: image.label,
                    className: "h-full w-full object-contain [image-rendering:pixelated]",
                  }),
            ),
            React.createElement(
              "figcaption",
              { className: "text-center text-xs text-muted" },
              image.label,
            ),
          ),
        ),
      ),
      regen?.type === "progress" ? progressBar(regen.done, regen.total) : null,
      React.createElement(
        "div",
        { key: "actions", className: "flex flex-wrap items-center gap-2" },
        leadingAction,
        button(
          "secondary",
          { disabled: !availability.isEnabled, onClick: () => startImageRegeneration(item.id) },
          "画像だけ作り直す",
        ),
        regen?.type === "progress"
          ? button("secondary", { onClick: () => void window.keycheer.cancelGeneration() }, "中断")
          : null,
      ),
      availability.notice !== null && regen?.type !== "progress"
        ? message("notice", availability.notice, "availability")
        : null,
      regen === null
        ? null
        : regen.type === "progress"
          ? message("info", `画像を作り直しています… ${regen.done} / ${regen.total}`, "regen")
          : regen.type === "done"
            ? message("info", "画像を作り直しました", "regen")
            : message("error", IMAGE_REGENERATION_RESULT_TEXT[regen.reason], "regen"),
      imageRegenerationError !== null
        ? message("error", imageRegenerationError, "regen-error")
        : null,
    );
  };

  const isGenerationRunning = generationTabBadge(state.generation) !== null;
  const editingItem = state.items.find((c) => c.id === editingId) ?? null;
  const generateButton = resolveGenerateButton({
    generation: state.generation,
    editing: editingItem,
    form: { name, personality, speakerId },
  });
  const generatingItem = state.items.find((c) => c.id === state.generatingCharacterId);
  const generationHeading = buildGenerationHeading(state);

  // 入力の枠(保存・編集・削除と、生成ボタン。論点 0061)
  const formCard = (): ReactNS.ReactElement =>
    card(
      "form",
      editingId === null ? "新しいキャラクター" : "キャラクターを編集",
      field(
        "name",
        "名前",
        React.createElement("input", {
          className: FIELD_CLASS,
          value: name,
          onChange: (e: ReactNS.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
        }),
      ),
      field(
        "personality",
        "性格",
        React.createElement("textarea", {
          className: `${FIELD_CLASS} resize-y`,
          value: personality,
          rows: 4,
          onChange: (e: ReactNS.ChangeEvent<HTMLTextAreaElement>) => setPersonality(e.target.value),
        }),
      ),
      field(
        "speaker",
        "話者",
        speakersUnavailable
          ? message("notice", "VOICEVOX に接続できません。起動してから画面を開き直してください。")
          : React.createElement(
              "select",
              {
                className: FIELD_CLASS,
                value: speakerId ?? "",
                onChange: (e: ReactNS.ChangeEvent<HTMLSelectElement>) =>
                  setSpeakerId(e.target.value === "" ? null : Number(e.target.value)),
              },
              React.createElement("option", { value: "" }, "選択してください"),
              ...speakers.map((s) =>
                React.createElement(
                  "option",
                  { key: `${s.id}`, value: s.id },
                  `${s.name}(${s.styleName})`,
                ),
              ),
            ),
      ),
      ...errors.map((e) => message("error", errorText(e), `${e.field}:${e.reason}`)),
      editingItem?.hasProfileChanged === true
        ? message(
            "notice",
            "生成した後にプロフィールを変更しています。生成すると新しいプロフィールで作り直します。",
            "changed",
          )
        : null,
      React.createElement(
        "div",
        { key: "actions", className: "flex flex-wrap items-center gap-2" },
        button("secondary", { onClick: submit }, "保存"),
        // S0061_02〜04 保存済みで入力が保存した内容と同じときだけ押せる。生成中は押せない(論点 0020)
        button(
          "primary",
          {
            disabled: !generateButton.isEnabled,
            onClick: () => {
              if (editingId !== null) startGeneration(editingId);
            },
          },
          START_GENERATION_LABEL,
        ),
        editingId !== null ? button("danger", { onClick: removeCharacter }, "削除") : null,
      ),
      generateButton.notice !== null
        ? message("info", generateButton.notice, "generate-notice")
        : null,
      status !== null ? message("info", status, "status") : null,
    );

  // S0061_05 生成の進捗と結果を入力の枠の下に出す / S0061_06 生成しているキャラクターの名前を示す
  // S0033_08 進捗と中断はこの画面だけに出す
  const generationCard = (): ReactNS.ReactElement | null => {
    const label = progressLabel(state.generation);
    if (blocked === null && (generationHeading === null || label === "")) return null;
    const isFailed = state.generation.phase === "failed";
    // 画像が欠けても生成は完了だが、欠けたことは目立たせる(S0036_09 / S0036_10)
    const images = state.generation.images;
    const isPartial =
      images !== null && (images.unavailableReason !== null || images.saved < images.total);
    const doneKind: MessageKind = isPartial ? "notice" : "ok";
    return card(
      "generation",
      generationHeading,
      isGenerationRunning ? progressBar(state.generation.done, state.generation.total) : null,
      label === ""
        ? null
        : message(
            isFailed ? "error" : state.generation.phase === "done" ? doneKind : "info",
            label,
            "progress",
          ),
      blocked !== null ? message("error", blocked, "blocked") : null,
      isGenerationRunning
        ? React.createElement(
            "div",
            { key: "actions", className: "flex flex-wrap items-center gap-2" },
            button("secondary", { onClick: () => void window.keycheer.cancelGeneration() }, "中断"),
          )
        : null,
    );
  };

  const characterScreen = (): Child[] => [
    title("キャラクター"),
    twoColumns(
      // 保存済みのキャラクターを一覧から選んで編集・生成する。先頭は新規作成
      characterList(
        "キャラクター",
        React.createElement(
          "button",
          {
            key: "new",
            type: "button",
            role: "option",
            "aria-selected": editingId === null,
            onClick: () => editCharacter(null),
            className: `flex w-full items-center gap-3 rounded-card border border-dashed p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
              editingId === null
                ? "border-accent bg-accent-soft text-accent"
                : "border-line text-muted hover:text-fg"
            }`,
          },
          React.createElement(
            "span",
            { className: "grid h-9 w-9 place-items-center rounded-lg bg-surface text-lg" },
            "+",
          ),
          "新しく作る",
        ),
        ...state.items.map((c) =>
          characterCard({
            key: c.id,
            name: c.name,
            meta: c.isGenerating ? null : c.hasPool ? "生成済み" : "まだ生成していません",
            pills: [
              ...(c.isActive ? [pill("使用中")] : []),
              ...(c.isGenerating ? [pill("生成中", true)] : []),
            ],
            thumbnailUrl: thumbnailOf(c),
            isSelected: editingId === c.id,
            onClick: () => editCharacter(c.id),
          }),
        ),
      ),
      React.createElement(
        "div",
        { key: "right", className: "flex min-w-0 flex-col gap-4" },
        formCard(),
        canShowGenerationControls(state.screen, state.generation) ? generationCard() : null,
        // S0061_05 / S0050_01 完了したら、生成したキャラクターの 3 枚を出す
        canShowGeneratedImages(state.generation) && generatingItem !== undefined
          ? imagePanel(generatingItem, "generated-images")
          : null,
      ),
    ),
    // 作り直しの確認(論点 0038)
    rebuildConfirmId === null
      ? null
      : React.createElement(
          "div",
          {
            key: "rebuild",
            className: "fixed inset-0 z-20 grid place-items-center bg-black/40 p-6",
          },
          React.createElement(
            "div",
            {
              role: "dialog",
              "aria-modal": true,
              className:
                "flex w-full max-w-md flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card",
            },
            React.createElement(
              "p",
              { className: "m-0 leading-relaxed" },
              REBUILD_CONFIRMATION_TEXT,
            ),
            React.createElement(
              "div",
              { className: "flex justify-end gap-2" },
              button("secondary", { onClick: cancelRebuild }, "取りやめる"),
              button("primary", { onClick: confirmRebuild }, "作り直す"),
            ),
          ),
        ),
  ];

  const switchScreen = (): Child[] => {
    const notice = switchEmptyNotice(state.items);
    const entries = buildSwitchList(state.items);
    // 選んでいなければ使用中、それも無ければ先頭の 3 枚を出す
    const selectedId =
      state.selectedSwitchId ?? entries.find((e) => e.isActive)?.id ?? entries[0]?.id ?? null;
    const selected = state.items.find((item) => item.id === selectedId);
    const selectedEntry = entries.find((e) => e.id === selectedId);
    return [
      title("応援に使うキャラクター"),
      // S0033_12 プールのあるキャラクターが無ければそう示す
      notice !== null ? message("notice", notice, "empty") : null,
      entries.length === 0
        ? null
        : twoColumns(
            // S0033_10 プールの無いものは出さない / S0033_11 生成中のものは選べない形で出す
            characterList(
              "応援に使うキャラクター",
              ...entries.map((entry) =>
                characterCard({
                  key: entry.id,
                  name: entry.name,
                  meta: null,
                  pills: [
                    ...(entry.isActive ? [pill("使用中")] : []),
                    ...(entry.isGenerating ? [pill("生成中", true)] : []),
                  ],
                  thumbnailUrl: thumbnailOf(state.items.find((item) => item.id === entry.id)),
                  isSelected: entry.id === selectedId,
                  isDimmed: !entry.isSelectable,
                  // S0050_04 選ぶだけでは使用中を変えない(3 枚を見るだけ)
                  onClick: () => dispatch({ type: "switch-selected", characterId: entry.id }),
                }),
              ),
            ),
            // S0050_01 選んだキャラクターの 3 枚を一覧の横に大きく出す
            selected !== undefined && selectedEntry !== undefined
              ? imagePanel(
                  selected,
                  "switch-images",
                  button(
                    "primary",
                    {
                      disabled: !selectedEntry.isSelectable || selectedEntry.isActive,
                      onClick: () => activate(selectedEntry.id),
                    },
                    selectedEntry.isActive ? "使用中" : "これにする",
                  ),
                )
              : null,
          ),
    ];
  };

  const settingRows = (key: string, ...rows: Child[]): ReactNS.ReactElement =>
    React.createElement("div", { key, className: "flex flex-col divide-y divide-line" }, ...rows);

  const settingsScreen = (): Child[] => [
    title("設定"),
    card(
      "display",
      "表示",
      settingRows(
        "rows",
        settingRow(
          "always-show",
          "キャラを常に表示する",
          toggleSwitch({
            label: "キャラを常に表示する",
            checked: popupDisplay?.shouldAlwaysShow ?? true,
            disabled: popupDisplay === null,
            onChange: (checked) => changePopupDisplay({ shouldAlwaysShow: checked }),
          }),
        ),
        settingRow(
          "show-message",
          "セリフを表示する(外しても音声は鳴ります)",
          toggleSwitch({
            label: "セリフを表示する",
            checked: popupDisplay?.shouldShowMessage ?? true,
            disabled: popupDisplay === null,
            onChange: (checked) => changePopupDisplay({ shouldShowMessage: checked }),
          }),
        ),
        settingRow(
          "theme",
          "テーマ",
          React.createElement(
            "select",
            {
              "aria-label": "テーマ",
              className: `${FIELD_BASE_CLASS} shrink-0`,
              value: theme ?? "system",
              disabled: theme === null,
              onChange: (e: ReactNS.ChangeEvent<HTMLSelectElement>) =>
                changeTheme(e.target.value as ThemeSetting),
            },
            ...THEME_SETTINGS.map((value) =>
              React.createElement("option", { key: value, value }, THEME_LABELS[value]),
            ),
          ),
        ),
      ),
    ),
    card(
      "generation",
      "生成",
      settingRows(
        "rows",
        settingRow(
          "activate",
          "生成が完了したら、そのキャラクターを使用中にする",
          toggleSwitch({
            label: "生成が完了したら、そのキャラクターを使用中にする",
            checked: generationConfig?.shouldActivateOnComplete ?? true,
            disabled: generationConfig === null,
            onChange: changeActivateOnComplete,
          }),
        ),
      ),
    ),
  ];

  const body: Record<MainScreen, () => Child[]> = {
    character: characterScreen,
    switch: switchScreen,
    settings: settingsScreen,
  };

  return React.createElement(
    "div",
    { className: "flex min-h-screen flex-col" },
    header,
    React.createElement(
      "main",
      { className: "mx-auto flex w-full max-w-5xl flex-col gap-4 p-5" },
      ...body[state.screen](),
      state.screen !== "character" && status !== null ? message("info", status, "status") : null,
    ),
  );
}

const container = document.getElementById("root");
if (container !== null) {
  ReactDOM.createRoot(container).render(React.createElement(App));
}

// mainEntry: メインウィンドウ(保存・生成・切り替え・設定の 4 タブ)の描画エントリ。
// spec: 論点 0019 / 0020 / 0032 / 0033
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

import type * as ReactNS from "react";
import type * as ReactDOMClientNS from "react-dom/client";
import {
  validateCharacterForm,
  toCharacterProfile,
  CHARACTER_NAME_MAX,
  CHARACTER_PERSONALITY_MAX,
  type CharacterFormError,
} from "./characterForm.js";
import { canStartGeneration, progressLabel } from "./generationView.js";
import {
  MAIN_SCREENS,
  initialMainScreenState,
  applyMainScreenEvent,
  generationTabBadge,
  canShowGenerationControls,
  buildGenerationCandidates,
  buildSwitchList,
  switchEmptyNotice,
  type MainScreen,
} from "./mainScreen.js";
import {
  openConsentDialog,
  setAgreement,
  canSubmitConsent,
  consentNeededFor,
  blockMessage,
  type ConsentDialogState,
} from "./consentDialog.js";
import { providerDisplayName } from "../core/shared/providerDisclosure.js";
import {
  TEXT_PROVIDER_IDS,
  VOICE_PROVIDER_IDS,
  DEFAULT_PROVIDER_SELECTION,
  type ProviderSelection,
  type TextProviderId,
  type VoiceProviderId,
  type GenerationConfig,
} from "../core/shared/types.js";
import type { SpeakerOption } from "../core/shared/ipc.js";
// window.keycheer の型は preload の公開 API がそのまま正本(popup.ts と同じ宣言を共有する)。
// 型だけの import なので renderer → preload の実行時依存は生まれない。
import type { KeyCheerApi } from "../preload/api.js";

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
  save: "保存",
  generate: "生成",
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
  // 生成画面:生成するキャラクター
  const [generateTargetId, setGenerateTargetId] = React.useState<string | null>(null);
  // プロバイダー選択と同意(論点 0016)。既定はローカル一式。
  const [selection, setSelection] = React.useState<ProviderSelection>(DEFAULT_PROVIDER_SELECTION);
  const [dialog, setDialog] = React.useState<ConsentDialogState | null>(null);
  const [blocked, setBlocked] = React.useState<string | null>(null);
  // 設定画面(論点 0033)
  const [generationConfig, setGenerationConfig] = React.useState<GenerationConfig | null>(null);

  const refreshCharacters = React.useCallback((): void => {
    void window.keycheer.listCharacters().then((items) => {
      dispatch({ type: "characters-loaded", items });
    });
  }, []);

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
    void window.keycheer.getProviders().then(setSelection);
    void window.keycheer.getGenerationConfig().then(setGenerationConfig);
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

  const candidates = buildGenerationCandidates(state);
  const target = candidates.find((c) => c.id === generateTargetId) ?? candidates[0];

  const chooseProvider = (kind: "text" | "voice", id: TextProviderId | VoiceProviderId): void => {
    const next = { ...selection, [kind]: id } as ProviderSelection;
    setSelection(next);
    setBlocked(null);
    void window.keycheer.setProviders(next);
  };

  const startGeneration = (characterId: string): void => {
    setBlocked(null);
    void window.keycheer.startGeneration(characterId).then((result) => {
      if (result.ok) {
        refreshCharacters(); // 一覧に生成中を出す(S0033_11)
        return;
      }

      // シナリオ: 外部選択時は同意ダイアログを経る
      const needsConsent = consentNeededFor(result);
      if (needsConsent !== null) {
        setDialog(openConsentDialog(needsConsent));
        return;
      }

      // シナリオ: 外部生成失敗時は自動でローカルに切り替えない [異常系]
      // 何が足りないかだけを出す。こちらでローカルへ倒さない。
      if ("provider" in result) {
        setBlocked(blockMessage(result.reason, providerDisplayName(result.provider)));
        return;
      }
      dispatch({ type: "generation", payload: { type: "failed", reason: result.reason } });
    });
  };

  // 同意ダイアログを通過した時だけ grantConsent を呼ぶ(表示・チェック操作では呼ばない)。
  const submitConsent = (): void => {
    if (dialog === null || !canSubmitConsent(dialog) || target === undefined) return;
    const provider = dialog.providerId;
    const characterId = target.id;
    setDialog(null);
    void window.keycheer.grantConsent(provider).then(() => startGeneration(characterId));
  };

  const providerSelect = (
    kind: "text" | "voice",
    label: string,
    ids: readonly (TextProviderId | VoiceProviderId)[],
    current: string,
  ): ReactNS.ReactElement =>
    React.createElement(
      "label",
      { key: kind },
      label,
      React.createElement(
        "select",
        {
          value: current,
          onChange: (e: ReactNS.ChangeEvent<HTMLSelectElement>) =>
            chooseProvider(kind, e.target.value as TextProviderId | VoiceProviderId),
        },
        ...ids.map((id) =>
          React.createElement("option", { key: id, value: id }, providerDisplayName(id)),
        ),
      ),
    );

  const editCharacter = (characterId: string | null): void => {
    const editing = state.items.find((c) => c.id === characterId);
    setEditingId(editing?.id ?? null);
    setName(editing?.name ?? "");
    setPersonality(editing?.personality ?? "");
    setSpeakerId(editing?.voicevoxSpeakerId ?? null);
    setErrors([]);
    setStatus(null);
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
      setStatus("保存しました");
      if (editingId === null) editCharacter(null); // 新規保存の後は次の新規入力に戻す
      refreshCharacters();
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

  // S0033_01 4 つの画面をタブでいつでも切り替えられる / S0033_07 生成中は生成タブに示す
  const tabs = React.createElement(
    "nav",
    { className: "tabs" },
    ...MAIN_SCREENS.map((screen) => {
      const badge = screen === "generate" ? generationTabBadge(state.generation) : null;
      return React.createElement(
        "button",
        {
          key: screen,
          type: "button",
          className: screen === state.screen ? "tab active" : "tab",
          onClick: () => {
            setStatus(null);
            dispatch({ type: "tab-selected", screen });
          },
        },
        badge !== null ? `${SCREEN_LABEL[screen]}(${badge})` : SCREEN_LABEL[screen],
      );
    }),
  );

  const saveScreen = (): (ReactNS.ReactElement | null)[] => [
    React.createElement("h1", { key: "h" }, "キャラクターを保存"),
    // 保存済みのキャラクターを一覧から選んで編集する。先頭は新規作成
    React.createElement(
      "ul",
      { key: "list", className: "list", role: "listbox", "aria-label": "キャラクター" },
      ...[
        { id: null as string | null, label: "+ 新しく作る" },
        ...state.items.map((c) => ({ id: c.id as string | null, label: c.name })),
      ].map((entry) =>
        React.createElement(
          "li",
          {
            key: entry.id ?? "new",
            role: "option",
            "aria-selected": editingId === entry.id,
            className: editingId === entry.id ? "selected" : undefined,
            onClick: () => editCharacter(entry.id),
          },
          entry.label,
        ),
      ),
    ),
    React.createElement(
      "label",
      { key: "name" },
      "名前",
      React.createElement("input", {
        value: name,
        onChange: (e: ReactNS.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
      }),
    ),
    React.createElement(
      "label",
      { key: "personality" },
      "性格",
      React.createElement("textarea", {
        value: personality,
        rows: 4,
        onChange: (e: ReactNS.ChangeEvent<HTMLTextAreaElement>) => setPersonality(e.target.value),
      }),
    ),
    React.createElement(
      "label",
      { key: "speaker" },
      "話者",
      speakersUnavailable
        ? React.createElement(
            "span",
            { className: "notice" },
            "VOICEVOX に接続できません。起動してから画面を開き直してください。",
          )
        : React.createElement(
            "select",
            {
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
    React.createElement(
      "div",
      { key: "actions", className: "chips" },
      React.createElement("button", { type: "button", onClick: submit }, "保存"),
      editingId !== null
        ? React.createElement("button", { type: "button", onClick: removeCharacter }, "削除")
        : null,
    ),
    ...errors.map((e) =>
      React.createElement("p", { key: `${e.field}:${e.reason}`, className: "error" }, errorText(e)),
    ),
  ];

  const generateScreen = (): (ReactNS.ReactElement | null)[] => [
    React.createElement("h1", { key: "h" }, "メッセージと音声を生成"),
    // S0033_09 生成画面で選べるのは保存済みのキャラクターだけ
    candidates.length === 0
      ? React.createElement(
          "p",
          { key: "empty", className: "notice" },
          "保存したキャラクターがありません。保存画面で作成してください。",
        )
      : React.createElement(
          "label",
          { key: "target" },
          "キャラクター",
          React.createElement(
            "select",
            {
              value: target?.id ?? "",
              onChange: (e: ReactNS.ChangeEvent<HTMLSelectElement>) =>
                setGenerateTargetId(e.target.value),
            },
            ...candidates.map((c) =>
              React.createElement(
                "option",
                { key: c.id, value: c.id },
                c.hasPool ? `${c.name}(生成済み)` : c.name,
              ),
            ),
          ),
        ),
    target?.hasProfileChanged === true
      ? React.createElement(
          "p",
          { key: "changed", className: "notice" },
          "生成した後にプロフィールを変更しています。作り直すと新しいプロフィールで生成します。",
        )
      : null,
    // プロバイダー選択(論点 0016)。画像は生成フローに乗っていないため出さない。
    React.createElement("h2", { key: "providers" }, "生成に使うプロバイダー"),
    providerSelect("text", "応援メッセージ", TEXT_PROVIDER_IDS, selection.text),
    providerSelect("voice", "音声", VOICE_PROVIDER_IDS, selection.voice),
    // 生成(論点 0020)。保存済みのキャラクターを選んでいるときだけ押せる。生成中は押せない。
    React.createElement(
      "button",
      {
        key: "start",
        type: "button",
        onClick: () => {
          if (target !== undefined) startGeneration(target.id);
        },
        disabled: !canStartGeneration(state.generation, target !== undefined),
      },
      "応援メッセージと音声を生成",
    ),
    // S0033_08 進捗と中断は生成画面だけに出す
    ...(canShowGenerationControls(state.screen, state.generation)
      ? [
          progressLabel(state.generation) !== ""
            ? React.createElement(
                "p",
                { key: "progress", className: "progress" },
                progressLabel(state.generation),
              )
            : null,
          generationTabBadge(state.generation) !== null
            ? React.createElement(
                "button",
                {
                  key: "cancel",
                  type: "button",
                  onClick: () => void window.keycheer.cancelGeneration(),
                },
                "中断",
              )
            : null,
        ]
      : []),
    blocked !== null
      ? React.createElement("p", { key: "blocked", className: "error" }, blocked)
      : null,
    // シナリオ: 同意ダイアログに ToS リンクと必須チェック
    dialog === null
      ? null
      : React.createElement(
          "div",
          { key: "dialog", className: "dialog", role: "dialog", "aria-modal": true },
          React.createElement("h2", null, `${dialog.displayName} へ送信します`),
          React.createElement("p", null, "送信される情報:"),
          React.createElement(
            "ul",
            null,
            ...dialog.sentItems.map((item) => React.createElement("li", { key: item }, item)),
          ),
          React.createElement(
            "p",
            null,
            React.createElement(
              "a",
              { href: dialog.tosUrl, target: "_blank", rel: "noreferrer" },
              "利用規約",
            ),
            " / ",
            React.createElement(
              "a",
              { href: dialog.privacyUrl, target: "_blank", rel: "noreferrer" },
              "プライバシーポリシー",
            ),
          ),
          React.createElement(
            "label",
            { className: "agree" },
            React.createElement("input", {
              type: "checkbox",
              checked: dialog.agreed,
              onChange: (e: ReactNS.ChangeEvent<HTMLInputElement>) =>
                setDialog(setAgreement(dialog, e.target.checked)),
            }),
            "上記に同意します",
          ),
          React.createElement(
            "button",
            { type: "button", onClick: submitConsent, disabled: !canSubmitConsent(dialog) },
            "同意して生成",
          ),
          React.createElement(
            "button",
            { type: "button", onClick: () => setDialog(null) },
            "キャンセル",
          ),
        ),
  ];

  const switchScreen = (): (ReactNS.ReactElement | null)[] => {
    const notice = switchEmptyNotice(state.items);
    return [
      React.createElement("h1", { key: "h" }, "応援に使うキャラクター"),
      // S0033_12 プールのあるキャラクターが無ければそう示す
      notice !== null
        ? React.createElement("p", { key: "empty", className: "notice" }, notice)
        : null,
      // S0033_10 プールの無いものは出さない / S0033_11 生成中のものは選べない形で出す
      ...buildSwitchList(state.items).map((entry) =>
        React.createElement(
          "div",
          { key: entry.id, className: "row" },
          React.createElement(
            "span",
            null,
            entry.name,
            entry.isActive ? "(使用中)" : "",
            entry.isGenerating ? "(生成中)" : "",
          ),
          React.createElement(
            "button",
            {
              type: "button",
              onClick: () => activate(entry.id),
              disabled: !entry.isSelectable || entry.isActive,
            },
            "これにする",
          ),
        ),
      ),
    ];
  };

  const settingsScreen = (): (ReactNS.ReactElement | null)[] => [
    React.createElement("h1", { key: "h" }, "設定"),
    React.createElement(
      "label",
      { key: "activate", className: "agree" },
      React.createElement("input", {
        type: "checkbox",
        checked: generationConfig?.shouldActivateOnComplete ?? true,
        disabled: generationConfig === null,
        onChange: (e: ReactNS.ChangeEvent<HTMLInputElement>) =>
          changeActivateOnComplete(e.target.checked),
      }),
      "生成が完了したら、そのキャラクターを使用中にする",
    ),
  ];

  const body: Record<MainScreen, () => (ReactNS.ReactElement | null)[]> = {
    save: saveScreen,
    generate: generateScreen,
    switch: switchScreen,
    settings: settingsScreen,
  };

  return React.createElement(
    "div",
    { className: "form" },
    tabs,
    ...body[state.screen](),
    status !== null
      ? React.createElement("p", { key: "status", className: "status" }, status)
      : null,
  );
}

const container = document.getElementById("root");
if (container !== null) {
  ReactDOM.createRoot(container).render(React.createElement(App));
}

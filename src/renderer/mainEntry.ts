// mainEntry: メインウィンドウ(キャラ作成フォーム)の描画エントリ。
// spec: 論点 0019
//
// バンドラを使わない(0007 確定事項の延長)ため、React/ReactDOM は main.html が UMD の
// <script> でグローバルとして読み込む。JSX は使わず React.createElement を直接呼ぶ
// ("react/jsx-runtime" の ESM import が発生する自動ランタイムを避けるため — ブラウザの
// ESM は bare specifier を解決できず、UMD も ESM の named export を持たないので噛み合わない)。
//
// 検証ロジックは characterForm.ts(純粋関数)に置きテストで縛る。ここは DOM 配線だけの
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
import {
  initialGenerationState,
  applyGenerationEvent,
  canStartGeneration,
  progressLabel,
} from "./generationView.js";
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

function errorText(error: CharacterFormError): string {
  return ERROR_TEXT[`${error.field}:${error.reason}`] ?? "入力を確認してください";
}

function App(): ReactNS.ReactElement {
  const [name, setName] = React.useState("");
  const [personality, setPersonality] = React.useState("");
  const [speakerId, setSpeakerId] = React.useState<number | null>(null);
  const [speakers, setSpeakers] = React.useState<SpeakerOption[]>([]);
  const [speakersUnavailable, setSpeakersUnavailable] = React.useState(false);
  const [errors, setErrors] = React.useState<CharacterFormError[]>([]);
  const [status, setStatus] = React.useState<string | null>(null);
  // 生成(論点 0020)。状態遷移は generationView(純粋関数)に委譲する。
  const [saved, setSaved] = React.useState(false);
  const [generation, setGeneration] = React.useState(initialGenerationState());
  // プロバイダー選択と同意(論点 0016)。既定はローカル一式。
  const [selection, setSelection] = React.useState<ProviderSelection>(DEFAULT_PROVIDER_SELECTION);
  const [dialog, setDialog] = React.useState<ConsentDialogState | null>(null);
  const [blocked, setBlocked] = React.useState<string | null>(null);

  React.useEffect(() => {
    void window.keycheer.getProviders().then(setSelection);
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

  // 確定事項「保存だけして後で生成できる」— 再起動後も現在のキャラを読み出して
  // フォームへ復元し、生成ボタンを押せる状態にする。
  React.useEffect(() => {
    void window.keycheer.getCharacter().then((character) => {
      if (character === null) return;
      setName(character.name);
      setPersonality(character.personality);
      setSpeakerId(character.voicevoxSpeakerId);
      setSaved(true);
    });
  }, []);

  // シナリオ: 生成の進捗が通知される
  React.useEffect(() => {
    return window.keycheer.onGenerationProgress((payload) => {
      setGeneration((prev) => applyGenerationEvent(prev, payload));
    });
  }, []);

  const chooseProvider = (kind: "text" | "voice", id: TextProviderId | VoiceProviderId): void => {
    const next = { ...selection, [kind]: id } as ProviderSelection;
    setSelection(next);
    setBlocked(null);
    void window.keycheer.setProviders(next);
  };

  const startGeneration = (): void => {
    setBlocked(null);
    void window.keycheer.startGeneration().then((result) => {
      if (result.ok) return;

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
      setGeneration((prev) =>
        applyGenerationEvent(prev, { type: "failed", reason: result.reason }),
      );
    });
  };

  // 同意ダイアログを通過した時だけ grantConsent を呼ぶ(表示・チェック操作では呼ばない)。
  const submitConsent = (): void => {
    if (dialog === null || !canSubmitConsent(dialog)) return;
    const provider = dialog.providerId;
    setDialog(null);
    void window.keycheer.grantConsent(provider).then(() => startGeneration());
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

  const submit = (): void => {
    const input = { name, personality, speakerId };
    const validation = validateCharacterForm(input);
    setErrors(validation.errors);
    setStatus(null);
    if (!validation.ok) return;

    void window.keycheer.saveCharacter(toCharacterProfile(input)).then((result) => {
      // シナリオ: 保存に失敗した場合 [異常系] — 失敗を伝えるだけで画面は壊さない
      setStatus(result.ok ? "保存しました" : "保存できませんでした");
      if (result.ok) setSaved(true);
    });
  };

  return React.createElement(
    "div",
    { className: "form" },
    React.createElement("h1", null, "キャラクターを作成"),

    React.createElement(
      "label",
      null,
      "名前",
      React.createElement("input", {
        value: name,
        onChange: (e: ReactNS.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
      }),
    ),

    React.createElement(
      "label",
      null,
      "性格",
      React.createElement("textarea", {
        value: personality,
        rows: 4,
        onChange: (e: ReactNS.ChangeEvent<HTMLTextAreaElement>) => setPersonality(e.target.value),
      }),
    ),

    React.createElement(
      "label",
      null,
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

    React.createElement("button", { type: "button", onClick: submit }, "保存"),

    // プロバイダー選択(論点 0016)。画像は生成フローに乗っていないため出さない。
    React.createElement("h2", null, "生成に使うプロバイダー"),
    providerSelect("text", "応援メッセージ", TEXT_PROVIDER_IDS, selection.text),
    providerSelect("voice", "音声", VOICE_PROVIDER_IDS, selection.voice),

    // 生成(論点 0020)。キャラ保存後にのみ押せる。生成中は押せない。
    React.createElement(
      "button",
      {
        type: "button",
        onClick: startGeneration,
        disabled: !canStartGeneration(generation, saved),
      },
      "応援メッセージと音声を生成",
    ),
    progressLabel(generation) !== ""
      ? React.createElement("p", { className: "progress" }, progressLabel(generation))
      : null,

    ...errors.map((e) =>
      React.createElement("p", { key: `${e.field}:${e.reason}`, className: "error" }, errorText(e)),
    ),
    status !== null ? React.createElement("p", { className: "status" }, status) : null,
    blocked !== null ? React.createElement("p", { className: "error" }, blocked) : null,

    // シナリオ: 同意ダイアログに ToS リンクと必須チェック
    dialog === null
      ? null
      : React.createElement(
          "div",
          { className: "dialog", role: "dialog", "aria-modal": true },
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
  );
}

const container = document.getElementById("root");
if (container !== null) {
  ReactDOM.createRoot(container).render(React.createElement(App));
}

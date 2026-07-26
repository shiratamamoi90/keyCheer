// mainEntry: メインウィンドウ(キャラ作成フォーム)の描画エントリ。
// spec: changes/0010-character-creation-local/spec.md
//
// バンドラを使わない(0007 確定事項の延長)ため、React/ReactDOM は main.html が UMD の
// <script> でグローバルとして読み込む。JSX は使わず React.createElement を直接呼ぶ
// ("react/jsx-runtime" の ESM import が発生する自動ランタイムを避けるため — ブラウザの
// ESM は bare specifier を解決できず、UMD も ESM の named export を持たないので噛み合わない)。
//
// 検証ロジックは characterForm.ts(純粋関数)に置きテストで縛る。ここは DOM 配線だけの
// I/O グルーでユニットテスト対象外 — 検証は typecheck / lint / 実機確認。
// engine 実装 / providers / agent は import しない(renderer は「使う側」に留める)。

import type * as ReactNS from "react";
import type * as ReactDOMClientNS from "react-dom/client";
import {
  validateCharacterForm,
  toCharacterProfile,
  CHARACTER_NAME_MAX,
  CHARACTER_PERSONALITY_MAX,
  type CharacterFormError,
} from "./characterForm.js";
import type { SpeakerOption } from "../shared/ipc.js";
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

  const submit = (): void => {
    const input = { name, personality, speakerId };
    const validation = validateCharacterForm(input);
    setErrors(validation.errors);
    setStatus(null);
    if (!validation.ok) return;

    void window.keycheer.saveCharacter(toCharacterProfile(input)).then((result) => {
      // シナリオ: 保存に失敗した場合 [異常系] — 失敗を伝えるだけで画面は壊さない
      setStatus(result.ok ? "保存しました" : "保存できませんでした");
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

    ...errors.map((e) =>
      React.createElement("p", { key: `${e.field}:${e.reason}`, className: "error" }, errorText(e)),
    ),
    status !== null ? React.createElement("p", { className: "status" }, status) : null,
  );
}

const container = document.getElementById("root");
if (container !== null) {
  ReactDOM.createRoot(container).render(React.createElement(App));
}

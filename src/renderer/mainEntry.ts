// mainEntry: メインウィンドウ(プレースホルダー)の描画エントリ。
// spec: changes/0008-main-window-character-creation/spec.md
//
// バンドラを使わない(0007 確定事項の延長)ため、React/ReactDOM は main.html が UMD の
// <script> でグローバルとして読み込む。JSX は使わず React.createElement を直接呼ぶ
// ("react/jsx-runtime" の ESM import が発生する自動ランタイムを避けるため — ブラウザの
// ESM は bare specifier を解決できず、UMD も ESM の named export を持たないので噛み合わない)。
//
// 中身はプレースホルダーの静的文言のみ。キャラ作成フォーム本体は別 change のスコープ。
// engine / providers / agent は import しない(発動経路と同じく renderer は「使う側」に留める)。

import type * as ReactNS from "react";
import type * as ReactDOMClientNS from "react-dom/client";

declare const React: typeof ReactNS;
declare const ReactDOM: typeof ReactDOMClientNS;

function App(): ReactNS.ReactElement {
  return React.createElement("div", { className: "placeholder" }, "キャラクターを作成してください");
}

const container = document.getElementById("root");
if (container !== null) {
  ReactDOM.createRoot(container).render(React.createElement(App));
}

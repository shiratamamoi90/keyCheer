// メインウィンドウとキャラの窓が使う全体の値の型。
// React / ReactDOM は main.html が UMD の <script> で読み込む(バンドラを使わないため。論点 0079)。
// JSX は tsc の変換(tsconfig の jsx: react)で React.createElement になり、この React を使う。
// window.keycheer の型は preload の公開 API がそのまま正本(型だけなので renderer → preload の実行時依存は無い)。

import type * as ReactNS from "react";
import type * as ReactDOMClientNS from "react-dom/client";
import type { KeyCheerApi } from "../preload/api.js";

declare global {
  const React: typeof ReactNS;
  const ReactDOM: typeof ReactDOMClientNS;
  interface Window {
    keycheer: KeyCheerApi;
  }
}

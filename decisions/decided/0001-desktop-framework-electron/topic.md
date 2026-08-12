# 論点 0001: デスクトップアプリの実行基盤

- **種別: 決定的**
- **状態: 決定済み**
- **反映先: —(実行基盤の決定。要件には及ばない)**

## 何を決めるか

Windows デスクトップアプリで、Ollama / VOICEVOX(いずれも HTTP API)と連携し、
ポップアップやアニメーションなど自由度の高い UI を作る必要がある。

## 決定

Electron + TypeScript を採用(UI は React + Tailwind CSS)。

## 理由

- 利点:
  - Ollama / VOICEVOX が HTTP API なので Node.js から素直に呼べる。
  - Windows 向けインストーラー(electron-builder)が成熟。
  - UI 表現の自由度が高い(透明・最前面ポップアップ等)。
- 欠点 / トレードオフ:
  - ランタイムが重い。将来パフォーマンスが問題になれば Tauri 移行を再検討。

## 案(採らなかったものは却下理由付きで残す)

- Tauri(Rust+Web): 軽量だが Rust 学習コストと VOICEVOX 連携事例の少なさ。
- JavaFX: Java 資産は活かせるが UI 制約が多い。

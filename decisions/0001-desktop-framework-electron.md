# ADR 0001: デスクトップフレームワークに Electron を採用(2026-05)

## 文脈

Windows デスクトップアプリで、Ollama / VOICEVOX(いずれも HTTP API)と連携し、
ポップアップやアニメーションなど自由度の高い UI を作る必要がある。

## 決定

Electron + TypeScript を採用(UI は React + Tailwind CSS)。

## 結果

- 利点:
  - Ollama / VOICEVOX が HTTP API なので Node.js から素直に呼べる。
  - Windows 向けインストーラー(electron-builder)が成熟。
  - UI 表現の自由度が高い(透明・最前面ポップアップ等)。
- 欠点 / トレードオフ:
  - ランタイムが重い。将来パフォーマンスが問題になれば Tauri 移行を再検討。

## 比較した選択肢

- Tauri(Rust+Web): 軽量だが Rust 学習コストと VOICEVOX 連携事例の少なさ。
- JavaFX: Java 資産は活かせるが UI 制約が多い。

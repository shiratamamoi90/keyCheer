- [ ] spec の各シナリオに対応する失敗テストを書く(Red)
  - tests/engine/providerRegistry.test.ts(識別子バリデーション・既定セット)
  - tests/engine/consentStore.test.ts(同意フラグ管理、プロバイダー単位)
  - tests/agent/secrets.test.ts(平文 JSON に出ない・safeStorage 経由)
  - tests/agent/providerRouting.test.ts(ローカル/外部ルーティング、失敗時に自動フォールバックしない)
  - tests/agent/noExternalOnCheer.test.ts(応援発動経路で外部 API を呼ばない)
- [ ] テストが赤になることを確認
- [ ] engine 側の最小実装(Green):
  - [ ] `src/engine/providers/types.ts` — `TextGenerator` / `VoiceSynthesizer` / `ImageGenerator` インターフェース、`ProviderId` の閉じた union
  - [ ] `src/engine/providers/registry.ts` — 識別子バリデーション
  - [ ] `src/engine/consent.ts` — 同意フラグの状態遷移(プロバイダー単位)
- [ ] agent 側(I/O)の最小実装(Green):
  - [ ] `src/agent/secrets.ts` — Electron `safeStorage` ラッパー(キー保存/取得、平文 JSON に出ない不変条件)
  - [ ] `src/agent/providers/local-ollama.ts` / `local-voicevox.ts` / `local-sdcpp.ts` — 既存(0002)からの移行
  - [ ] `src/agent/providers/openai-text.ts` — テキスト外部実装
  - [ ] `src/agent/providers/openai-tts.ts` — 音声外部実装
  - [ ] `src/agent/providers/openai-dalle.ts` — 画像外部実装
  - [ ] MVP に含める他プロバイダー(Anthropic / ElevenLabs / Stability AI 等)は [要確認] 後に追加
  - [ ] `src/agent/providerRouter.ts` — 設定に応じて適切なプロバイダーを呼び分け、失敗時は自動フォールバックしない
- [ ] UI(キャラ設定画面):
  - [ ] プロバイダー選択(テキスト/音声/画像、各ドロップダウン)
  - [ ] API キー入力フィールド + 接続テストボタン
  - [ ] 外部選択時の同意ダイアログ(送信される情報・利用規約リンクを明示)
  - [ ] [要確認] 概算コスト表示
- [ ] 「応援発動経路では providers 設定を参照しない」を結合テストで担保
- [ ] リファクタ(全緑維持)
- [ ] specs/integrations.md・specs/data-model.md に反映、CLAUDE.md のプライバシー方針文を更新、diff.md 作成、この change をアーカイブ

> 注意:
>
> - 0002(オフライン応援)が先に承認 & 反映されていることが前提。両者を並行で進める場合は依存を tasks.md 冒頭で明示する。
> - 出力品質・レイテンシは experiments/ で比較。本 change のテストでは「契約を満たす」「外部送信のガードが効く」のみ。
> - 人間が spec を承認するまで実装に入らない。
> - [要確認] 項目(MVP プロバイダーセット、同意粒度、概算コスト表示、フォールバック許可有無)は承認段階で確定。

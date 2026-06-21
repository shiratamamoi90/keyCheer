- [ ] spec の各シナリオに対応する失敗テストを書く(Red)— tests/engine/messagePool.test.ts, tests/engine/cheerTrigger.test.ts
- [ ] テストが赤になることを確認
- [ ] engine 側の最小実装(Green):
  - [ ] `src/engine/messagePool.ts` — プール構造の型・バリデーション・シナリオキー解決
  - [ ] `src/engine/cheerSelector.ts` — `(zone, type, timeOfDay)` → 1 文の選択、連続回避、欠損時フォールバック
  - [ ] `src/engine/trigger.ts` — 発動判定はそのまま、選択は engine 内で完結(LLM/TTS を呼ばない)
- [ ] agent 側(I/O):
  - [ ] `src/agent/poolGenerator.ts` — Ollama でプール 480 文一括生成(キャラ作成時のみ呼ばれる)
  - [ ] `src/agent/voiceSynth.ts` — VOICEVOX で全文事前合成し wav 保存
  - [ ] `src/agent/cheerPlayer.ts` — 発動時に wav を再生(VOICEVOX には触らない)
- [ ] リファクタ(全緑維持)
- [ ] specs/integrations.md・specs/cheer-trigger.md・specs/data-model.md に反映、CLAUDE.md の冒頭説明とプライバシー方針の文言更新、diff.md 作成、この change をアーカイブ

> 注意:
>
> - 480 文の「らしさ・自然さ」は experiments/ で測る。本 change のテストでは「契約を満たす」「クラッシュしない」「外部依存を呼ばない」のみを縛る。
> - 人間が spec を承認するまで実装に入らない。
> - 「同一文連続回避」「中断時の再開方針」は [要確認] が残るため、承認段階で確定させる。

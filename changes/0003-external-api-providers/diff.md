# diff: change 0003 を specs/ と CLAUDE.md に反映

## 反映先

### specs/integrations.md(0002 と同タイミングで全面書き直し)

- タイトルを「外部連携の決定的契約(Ollama / VOICEVOX / sd.cpp)」→「生成プロバイダーと外部連携の決定的契約」に変更。
- 新セクション「プロバイダー識別子(閉じた union)」を追加:
  - text: `local-ollama` / `openai` / `anthropic`
  - voice: `local-voicevox` / `openai-tts` / `elevenlabs`
  - image: `local-sdcpp` / `openai-dalle` / `stability-ai`
- 新セクション「共通: プライバシー境界」を追加。シナリオ:
  - ローカル選択時は外部送信が発生しない[不変条件]
  - 外部選択時は同意ダイアログを経る
  - 同意はプロバイダー単位で記録
  - API キーは平文 JSON に出ない[不変条件]
  - 外部生成失敗時は自動でローカルに切り替えない[異常系]
  - 応援発動経路から外部 API を呼ばない[不変条件]
- 既存の Ollama/VOICEVOX/sd.cpp 各セクションを「ローカル実装の契約」として位置付け直し。
- 「生成元の記録(`character.generatedBy`)」シナリオを追加。
- 要確認に「外部 API ToS 同意誘導 / 概算コスト表示 / 監査ログ」を追加。

### specs/data-model.md(追加)

- 設定 JSON に新セクション `providers` を追加:
  - `text` / `voice` / `image` の選択
  - `consent`: プロバイダー単位の同意フラグ
- 新セクション「API キー(OS セキュアストレージ)」を追加。`safeStorage` 経由 / 平文 JSON に書かない契約。
- 新規シナリオ:
  - プロバイダー識別子の定義域[境界]
  - API キーが平文 JSON に出ない[不変条件]
  - 同意フラグ未通過状態の永続化禁止
- 既存「既定値補完」シナリオに「`providers` 旧バージョン JSON でも欠損補完されること」を追記。

### CLAUDE.md

- プライバシー方針セクションを大幅改定:
  - 旧: 「ネットワーク通信は localhost(Ollama / VOICEVOX)のみ」
  - 新: 「キーカウント・KPM・統計・応援発動は永久に外部送信しない。キャラ作成時に限り、ユーザー明示選択 + 同意ダイアログ通過時のみ外部送信可。API キーは OS セキュアストレージに保存」
- Stack セクションを「ローカル LLM / 音声合成 / 画像生成」の 3 行から、プロバイダー抽象 + 各識別子の表現に変更。
- 不変条件に「API キーは平文 JSON に出さない」を追加。
- 不変条件に「応援発動経路から `providers` 設定を参照しない」を追加。

## 既存 ADR への影響

- ADR 0002 (Ollama 採用): 撤回せず、`local-ollama` として既定プロバイダー扱い。
- ADR 0003 (VOICEVOX 採用): 撤回せず、`local-voicevox` として既定プロバイダー扱い。
- ADR 0005 (sd.cpp 採用): 撤回せず、`local-sdcpp` として既定プロバイダー扱い。
- ADR 0007 (オフライン応援プール): 影響なし。プールを**何で作るか**だけプロバイダー化される。

## アーカイブ

本 change は specs/ + CLAUDE.md に反映済み。実装着手は `tasks.md` の [要確認] 項目(MVP プロバイダーセット / 同意粒度 / 概算コスト表示 / フォールバック許可有無)が確定してから。

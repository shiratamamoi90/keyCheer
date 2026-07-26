# 要件: 生成プロバイダーと外部連携の決定的契約

キャラ作成時のテキスト/音声/画像生成は**プロバイダー**として抽象化され、ローカル(Ollama / VOICEVOX / sd.cpp)または外部 API(OpenAI / Anthropic / ElevenLabs / DALL-E / Stability AI 等)を差し替え可能。**応援発動経路は本契約に依存せず、外部送信は一切しない**(→ specs/cheer-trigger.md)。

メッセージや画像の品質は仕様化しない(→ experiments/)。決定的に縛るのは「契約を満たす」「クラッシュしない」「予算内」「外部送信ガードが効く」。

## プロバイダー識別子(閉じた union)

- `text`: `"local-ollama" | "openai" | "anthropic"`
- `voice`: `"local-voicevox" | "openai-tts" | "elevenlabs"`
- `image`: `"local-sdcpp" | "openai-dalle" | "stability-ai"`

### MVP 実装セット(確定)

Phase 1 では各種別**ローカル 1 + 外部 1** の最小セットを実装する:

- text: `local-ollama` + `openai`
- voice: `local-voicevox` + `openai-tts`
- image: `local-sdcpp` + `openai-dalle`

`anthropic` / `elevenlabs` / `stability-ai` は同じインターフェース上で後の change で追加する(抽象は最初から union に含めて将来の追加を阻まない)。

## 共通: プライバシー境界

### シナリオ: ローカル選択時は外部送信が発生しない [不変条件]

- GIVEN `providers` 3 種すべてが `local-*`
- WHEN キャラ作成・プール生成・音声合成・画像生成を実行
- THEN localhost 以外への HTTP リクエストは一切発生しない

### シナリオ: 外部選択時は同意ダイアログを経る

- GIVEN 任意の `providers` を外部に切り替えた直後
- WHEN 初回の生成を試行
- THEN 送信される情報(性格説明・プロンプト等)を明示するダイアログが出て、同意するまで送信は発生しない

### シナリオ: 同意はプロバイダー単位で 1 回のみ

- GIVEN `openai` テキストへ同意済み、`anthropic` には未同意
- WHEN テキスト生成プロバイダーを `anthropic` に変更して再試行
- THEN `anthropic` で同意ダイアログが再表示される。一度同意した `openai` は再度ダイアログを出さない(プロバイダー単位で 1 回、生成のたびには問わない)

### シナリオ: 同意ダイアログに ToS リンクと必須チェック

- GIVEN 外部プロバイダーの同意ダイアログ
- WHEN 表示
- THEN 当該プロバイダーの利用規約(ToS)・プライバシーポリシーへのリンクと、「同意します」必須チェックボックスを含む。チェックなしでは「送信」ボタンは無効

### シナリオ: API キーは平文 JSON に出ない [不変条件]

- GIVEN ユーザーが任意の外部 API キーを入力
- WHEN 設定を保存
- THEN キーは OS セキュアストレージ(Electron `safeStorage` / Windows Credential Manager)に保存され、`electron-store` の JSON にはプレースホルダ参照しか出ない

### シナリオ: 外部生成失敗時は自動でローカルに切り替えない [異常系]

- GIVEN 外部プロバイダー選択、API 失敗
- WHEN 生成中にエラー
- THEN 自動フォールバックはせず、エラー表示+再試行/プロバイダー変更を促す

### シナリオ: 通信失敗・プロキシ環境 [異常系]

- GIVEN プロキシ・社用ネット環境などで外部プロバイダーへ到達できない
- WHEN 生成リクエストがタイムアウト or 接続失敗
- THEN **自動リトライしない**。エラー内容を表示し、ユーザーに再試行/プロバイダー変更を促す(意図しない通信の反復を防ぐ)

### シナリオ: 外部送信を監査ログに記録

- GIVEN 外部プロバイダーへの送信が発生
- WHEN 送信前 / 送信後
- THEN `{userData}/audit.log.json` に `{ timestamp, provider, action, payloadSummary }` を append する(payload 本文は含めず要約のみ。データ位置・構造は specs/data-model.md)

### シナリオ: 応援発動経路から外部 API を呼ばない [不変条件]

- GIVEN プロバイダー設定が何であれ、キャラ作成完了
- WHEN 応援が発動する
- THEN providers 設定は参照されず、localhost を含めて一切のサーバー通信が発生しない(→ cheer-trigger.md)

## テキスト(セリフ生成 — キャラ作成時のみ)

キャラ作成時に **(zone × type × timeOfDay) = 3 × 2 × 4 = 24 シナリオ × 8 文 = 192 文**を一括生成し、メッセージプールとして保存する。
(2026-07-26 に 1 バケット 20 文 = 480 文から引き下げ。理由は作成時間とディスク使用量 — decisions/0007 参照)

システムプロンプト(キャラ設定から自動生成):

```
あなたは「{character.name}」です。
性格: {character.personality}
キーボードを打っている人を応援する短いメッセージを返してください(各 30 文字以内)。
これから示すシナリオ {zone, type, timeOfDay} に合わせて {count} 個生成してください。
速度ゾーンでテンション調整: slow=寄り添う / normal=標準 / fast=勢いを煽る
```

### シナリオ: プール一括生成成功

- GIVEN プロバイダー設定済み、性格 P 入力済み
- WHEN プール生成を要求
- THEN 24 シナリオ × 8 文 = 192 文がプールとして保存される(各文 30 文字以内、シナリオキーで引ける構造)

### シナリオ: 生成途中の中断と再開

- GIVEN 192 文一括生成中にプロバイダー失敗・ユーザーキャンセル
- WHEN 状態を保存
- THEN 生成済みシナリオは `completion: "complete"` で保持、未生成は `"pending"`、失敗は `"failed"` で残る。再開時は未完了(`pending` / `failed`)のシナリオのみ再生成する

### シナリオ: 一括生成中の進捗 UX

- GIVEN プール 192 文の一括生成中
- WHEN 生成が進行
- THEN UI に進捗バー(完了シナリオ数 / 24)とキャンセルボタンを表示する。キャンセルしても部分結果は失われない(`completion` フラグで管理)

### シナリオ: 文字数契約 [境界]

- GIVEN プロバイダーの応答
- WHEN 1 文を保存する直前
- THEN 30 文字を超える文は切り詰める or 再生成キューに戻す(クラッシュしない)

### シナリオ: Ollama (ローカル) 未起動のフォールバック [異常系]

- GIVEN `text = "local-ollama"`、Ollama に接続できない
- WHEN プール生成を要求
- THEN エラーを表示し、キャラ作成は完了させない(クラッシュもしない)。**自動で別プロバイダーには切り替えない**

## 音声(TTS — キャラ作成時のみ)

プール 192 文を全文事前合成して wav 保存。発動時はこの wav を再生するだけ。

### シナリオ: 全文事前合成

- GIVEN プロバイダー設定済み、プール 192 文が確定
- WHEN 音声合成を要求
- THEN 各メッセージに 1:1 対応する wav が生成・保存され、メッセージ ID から wav パスを一意に解決できる

### シナリオ: VOICEVOX (ローカル) の呼び出し契約

- GIVEN `voice = "local-voicevox"`、VOICEVOX 起動済み、話者ID指定
- WHEN テキストを合成
- THEN `POST /audio_query?text=...&speaker=ID` → `POST /synthesis?speaker=ID` を呼び、wav が返る

### シナリオ: VOICEVOX 未起動のフォールバック [異常系]

- GIVEN `voice = "local-voicevox"`、VOICEVOX に接続できない
- WHEN 合成を要求
- THEN エラーを返し、キャラ作成フローはユーザーに「VOICEVOX を起動してください」と提示する(クラッシュしない)。**自動で別プロバイダーには切り替えない**

### シナリオ: 部分失敗時の許容

- GIVEN 192 文中 5 文の合成が失敗
- WHEN 完了処理に入る
- THEN 失敗 5 文は「wav 欠損」フラグで残り、キャラ作成は完了する(発動時のフォールバックで吸収 → cheer-trigger.md)

## 画像 (sd.cpp / 外部 — キャラ作成時のみ)

キャラ設定画面の「AIで生成」押下**だけ**で起動(常駐しない)。SD1.5 アニメ系 + LCM LoRA(ローカル時)、4 ステップ、Vulkan iGPU 加速→失敗時 CPU。通常/喜び/激励の 3 枚を**同一シード+表情タグ差し替え**で生成。

### シナリオ: 3 枚生成して終了

- GIVEN 必要資材(sd.cpp 同梱 or 外部 API キー)が揃っている
- WHEN 「AIで生成」を実行
- THEN 3 枚が imagePaths に保存され、子プロセス(ローカル時)は終了する

### シナリオ: 同一シードで再現

- GIVEN 同じシード・プロンプト・プロバイダー
- WHEN 2 回生成
- THEN 同じ画像が得られる(プロバイダー側の決定性に依存。外部 API でシード対応がない場合は [要確認])

### シナリオ: タイムアウト/失敗時 [異常系]

- GIVEN 生成が予算時間を超過 or 失敗
- WHEN 子プロセス/HTTP を監視
- THEN プロセス終了(ゾンビ防止)し、エラー表示+手動アップロード or 再試行に誘導する

## 生成元の記録

### シナリオ: 生成元プロバイダーの保存

- GIVEN プール・音声・画像の生成が完了
- WHEN `character` を保存する
- THEN そのキャラを作ったプロバイダーが `character.generatedBy: { text, voice, image }` に記録される(再生成時の参照用)

## 不変条件 / 要確認

- 子プロセス(ローカル画像生成)はタイムアウト・キャンセル・重複起動排他を持つ。
- 画像/音声/メッセージの**品質**は決定的に縛らない(→ experiments/)。
- 同意ダイアログ通過前の中断時に同意は永続化されない(→ specs/data-model.md)。
- **自動リトライしない**(C6 確定)。失敗は常にユーザー判断で再試行。

### [要確認](β 以降)

- 同梱モデルの最終選定・量子化(q4/q8)・表情差分方式(同一シード+タグ / img2img)。
- **外部画像 API の制約**: `openai-dalle` は表情タグ差し替えの 3 枚を 1 リクエスト = 1 枚で生成するが、
  (a) この API に **seed 指定が無い**ため「同一シードで再現」はローカル(sd.cpp)でのみ成立する、
  (b) 受け付ける **size が固定値**(1024x1024 等)で `system.imageGen` の 512x768 は渡せない。
  外部選択時に size をどう決めるか(プロバイダーごとの許容値へ丸めるか、UI で選ばせるか)は未確定。

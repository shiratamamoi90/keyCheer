# 要件: 生成プロバイダーと外部連携の決定的契約

キャラ作成時のテキスト/音声/画像生成は**プロバイダー**として抽象化され、ローカル(Ollama / VOICEVOX / sd.cpp)または外部 API(OpenAI / Anthropic / ElevenLabs / DALL-E / Stability AI 等)を差し替え可能。**応援発動経路は本契約に依存せず、外部送信は一切しない**(→ docs/cheer-trigger.md)。

メッセージや画像の品質は仕様化しない(→ experiments/)。決定的に縛るのは「契約を満たす」「クラッシュしない」「予算内」「外部送信ガードが効く」。

## プロバイダー識別子(閉じた union)

- `text`: `"local-ollama" | "openai" | "anthropic"`
- `voice`: `"local-voicevox" | "openai-tts" | "elevenlabs"`
- `image`: `"local-sdcpp" | "openai-dalle" | "stability-ai"`

### MVP 実装セット(確定)

union の **9 件すべてを実装済み**(`anthropic` / `elevenlabs` / `stability-ai` は 論点 0016 で追加):

- text: `local-ollama` + `openai` + `anthropic`
- voice: `local-voicevox` + `openai-tts` + `elevenlabs`
- image: `local-sdcpp` + `openai-dalle` + `stability-ai`

3 種別とも同一インターフェース(`TextGenerator` / `VoiceSynthesizer` / `ImageGenerator`)上に実装され、
プロバイダーを増やしてもインターフェースは変えない。

> **UI 未接続**:外部プロバイダーを選ぶ画面と同意ダイアログは未実装のため、
> 現時点で外部プロバイダーへ到達する経路はアプリ上に存在しない(論点 0016 の残タスク)。

## 共通: プライバシー境界

### S0016_01 ローカル選択時は外部送信が発生しない [不変条件]

- GIVEN `providers` 3 種すべてが `local-*`
- WHEN キャラ作成・プール生成・音声合成・画像生成を実行
- THEN localhost 以外への HTTP リクエストは一切発生しない

### S0016_02 外部選択時は同意ダイアログを経る

- GIVEN 任意の `providers` を外部に切り替えた直後
- WHEN 初回の生成を試行
- THEN 送信される情報(性格説明・プロンプト等)を明示するダイアログが出て、同意するまで送信は発生しない

### S0016_03 同意はプロバイダー単位で 1 回のみ

- GIVEN `openai` テキストへ同意済み、`anthropic` には未同意
- WHEN テキスト生成プロバイダーを `anthropic` に変更して再試行
- THEN `anthropic` で同意ダイアログが再表示される。一度同意した `openai` は再度ダイアログを出さない(プロバイダー単位で 1 回、生成のたびには問わない)

### S0016_04 同意ダイアログに ToS リンクと必須チェック

- GIVEN 外部プロバイダーの同意ダイアログ
- WHEN 表示
- THEN 当該プロバイダーの利用規約(ToS)・プライバシーポリシーへのリンクと、「同意します」必須チェックボックスを含む。チェックなしでは「送信」ボタンは無効

### S0016_05 API キーは平文 JSON に出ない [不変条件]

- GIVEN ユーザーが任意の外部 API キーを入力
- WHEN 設定を保存
- THEN キーは OS セキュアストレージ(Electron `safeStorage` / Windows Credential Manager)に保存され、`electron-store` の JSON にはプレースホルダ参照しか出ない

### S0016_06 外部生成失敗時は自動でローカルに切り替えない [異常系]

- GIVEN 外部プロバイダー選択、API 失敗
- WHEN 生成中にエラー
- THEN 自動フォールバックはせず、エラー表示+再試行/プロバイダー変更を促す

### S0016_07 通信失敗・プロキシ環境 [異常系]

- GIVEN プロキシ・社用ネット環境などで外部プロバイダーへ到達できない
- WHEN 生成リクエストがタイムアウト or 接続失敗
- THEN **自動リトライしない**。エラー内容を表示し、ユーザーに再試行/プロバイダー変更を促す(意図しない通信の反復を防ぐ)

### S0016_08 外部送信を監査ログに記録

- GIVEN 外部プロバイダーへの送信が発生
- WHEN 送信前 / 送信後
- THEN `{userData}/audit.log.json` に `{ timestamp, provider, action, payloadSummary }` を append する(payload 本文は含めず要約のみ。データ位置・構造は docs/data-model.md)

### S0016_09 応援発動経路から外部 API を呼ばない [不変条件]

- GIVEN プロバイダー設定が何であれ、キャラ作成完了
- WHEN 応援が発動する
- THEN providers 設定は参照されず、localhost を含めて一切のサーバー通信が発生しない(→ cheer-trigger.md)

## 共通: 外部プロバイダー呼び出しの契約

種別(text / voice / image)を問わず、すべての外部プロバイダー実装が満たす。

### S0016_10 API キーは認証ヘッダにのみ乗る [不変条件]

- GIVEN 任意の外部プロバイダー実装に API キーを渡す
- WHEN リクエストを組み立てる
- THEN キーは認証ヘッダにのみ現れ、URL クエリ・リクエストボディ・ログには現れない

### S0016_11 タイムアウト予算を超えたら中断する [境界]

- GIVEN `timeoutMs` を指定したリクエスト
- WHEN 応答が `timeoutMs` を超えても返らない
- THEN `AbortController` でリクエストを中断し、タイマーは `finally` で必ず解除される

### S0016_12 HTTP エラーは throw する [異常系]

- GIVEN API が 4xx / 5xx を返す
- WHEN 生成を実行する
- THEN 自動リトライせず、ステータスコードと本文を含むエラーを throw する
  (呼び出し側の `providerRouter` が `generation-failed` に変換する)

### S0016_13 実 API を叩かずにテストできる [不変条件]

- GIVEN テストコード
- WHEN プロバイダー実装を生成する
- THEN `fetchFn` を注入でき、テストは実際の外部通信を一切発生させない

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

### S0016_14 プール一括生成成功

- GIVEN プロバイダー設定済み、性格 P 入力済み
- WHEN プール生成を要求
- THEN 24 シナリオ × 8 文 = 192 文がプールとして保存される(各文 30 文字以内、シナリオキーで引ける構造)

### S0016_15 生成途中の中断と再開

- GIVEN 192 文一括生成中にプロバイダー失敗・ユーザーキャンセル
- WHEN 状態を保存
- THEN 生成済みシナリオは `completion: "complete"` で保持、未生成は `"pending"`、失敗は `"failed"` で残る。再開時は未完了(`pending` / `failed`)のシナリオのみ再生成する

### S0016_16 一括生成中の進捗 UX

- GIVEN プール 192 文の一括生成中
- WHEN 生成が進行
- THEN UI に進捗バー(完了シナリオ数 / 24)とキャンセルボタンを表示する。キャンセルしても部分結果は失われない(`completion` フラグで管理)

### S0016_17 文字数契約 [境界]

- GIVEN プロバイダーの応答
- WHEN 1 文を保存する直前
- THEN 30 文字を超える文は切り詰める or 再生成キューに戻す(クラッシュしない)

### S0016_18 Ollama (ローカル) 未起動のフォールバック [異常系]

- GIVEN `text = "local-ollama"`、Ollama に接続できない
- WHEN プール生成を要求
- THEN エラーを表示し、キャラ作成は完了させない(クラッシュもしない)。**自動で別プロバイダーには切り替えない**

### S0016_19 Anthropic (外部) の呼び出し契約

- GIVEN `TextGenerationRequest`(`systemPrompt` / `scenarioKey` / `count` / `timeoutMs`)
- WHEN `generateMessages` を呼ぶ
- THEN `POST https://api.anthropic.com/v1/messages` へ送信し、応答本文を 1 行 1 文に分割して返す
  - ヘッダは `content-type: application/json` / `anthropic-version: 2023-06-01` / `x-api-key`
  - `systemPrompt` は**トップレベルの `system` パラメータ**に置く(`messages` 内の system ロールではない。OpenAI 実装と構造が異なる)
  - `messages` には最低 1 件の `user` ロールが必要なため、生成指示(`scenarioKey` と `count` を含む文)を user メッセージとして送る
  - 応答本文は `content[]` のうち `type === "text"` の要素の `text` を連結して取る
  - 行頭の箇条書き記号・番号は `openaiText` と同じ規則で除去し、空行は除去する

### S0016_20 Anthropic の max_tokens を要求量から決める [境界]

- GIVEN `count` 文の生成要求
- WHEN リクエストボディを組み立てる
- THEN Anthropic API が**必須とする** `max_tokens` を `count` から決定的に算出して渡す
  - 算出式は `count * TOKENS_PER_MESSAGE + MARGIN`。係数は定数として 1 箇所に定義する
  - 初期値は `TOKENS_PER_MESSAGE = 64` / `MARGIN = 256`(`count = 20` なら `1536`)
  - 根拠は 1 文 30 字以内という上記「文字数契約」。日本語は 1 文字あたり複数トークンになり得るため係数に余裕を持たせる
  - 定数は実疎通での実測後に調整しうる(調整しても本契約は変わらない)

### S0016_21 Anthropic はシードを受け付けない [境界]

- GIVEN `seed` を指定した `TextGenerationRequest`
- WHEN リクエストを組み立てる
- THEN シードは**送らない**(Messages API に `seed` パラメータが存在しないため)。
  このプロバイダーは「同一シードで同一出力」を満たさない
  - テキスト生成の再現性はベストエフォート(既存の `openai` 実装も同様)。
    再現性の不変条件は画像生成(`local-sdcpp` / `stability-ai`)で担保する

## 音声(TTS — キャラ作成時のみ)

プール 192 文を全文事前合成して wav 保存。発動時はこの wav を再生するだけ。

### S0016_22 全文事前合成

- GIVEN プロバイダー設定済み、プール 192 文が確定
- WHEN 音声合成を要求
- THEN 各メッセージに 1:1 対応する wav が生成・保存され、メッセージ ID から wav パスを一意に解決できる

### S0016_23 VOICEVOX (ローカル) の呼び出し契約

- GIVEN `voice = "local-voicevox"`、VOICEVOX 起動済み、話者ID指定
- WHEN テキストを合成
- THEN `POST /audio_query?text=...&speaker=ID` → `POST /synthesis?speaker=ID` を呼び、wav が返る

### S0016_24 VOICEVOX 未起動のフォールバック [異常系]

- GIVEN `voice = "local-voicevox"`、VOICEVOX に接続できない
- WHEN 合成を要求
- THEN エラーを返し、キャラ作成フローはユーザーに「VOICEVOX を起動してください」と提示する(クラッシュしない)。**自動で別プロバイダーには切り替えない**

### S0016_25 部分失敗時の許容

- GIVEN 192 文中 5 文の合成が失敗
- WHEN 完了処理に入る
- THEN 失敗 5 文は「wav 欠損」フラグで残り、キャラ作成は完了する(発動時のフォールバックで吸収 → cheer-trigger.md)

### S0016_26 ElevenLabs (外部) の呼び出し契約

- GIVEN `VoiceSynthesisRequest`(`text` / `speakerId` / `timeoutMs`)
- WHEN `synthesize` を呼ぶ
- THEN `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` へ送信し、音声バイト列を返す
  - 認証ヘッダは `xi-api-key`(Bearer ではない)
  - 必須ボディは `text` のみ。`model_id` 未指定時はプロバイダー既定に任せる
  - `voice_id` は**パスパラメータ**。数値の `speakerId` を注入された写像テーブル(`Record<number, string>`)で voice ID 文字列へ変換する
  - `speakerId` 未指定、またはテーブルに該当が無い場合は既定 voice ID を使う

### S0016_27 ElevenLabs も wav を返す [不変条件]

- GIVEN `VoiceSynthesizer` の戻り値契約(wav バイト列)
- WHEN ElevenLabs から音声を受け取る
- THEN `output_format` に `wav_*` を指定して **wav** バイト列を直接受け取る(既定は mp3 のため明示指定が必須)
  - **`wav_44100` は使わない**(Pro 以上のプラン契約が必要)。既定は `wav_22050`
  - wav を直接要求できるため、変換用の依存追加は不要で `voiceSynth` と再生側への波及もない

## 画像 (sd.cpp / 外部 — キャラ作成時のみ)

キャラ設定画面の「AIで生成」押下**だけ**で起動(常駐しない)。SD1.5 アニメ系 + LCM LoRA(ローカル時)、4 ステップ、Vulkan iGPU 加速→失敗時 CPU。通常/喜び/激励の 3 枚を**同一シード+表情タグ差し替え**で生成。

### S0016_28 3 枚生成して終了

- GIVEN 必要資材(sd.cpp 同梱 or 外部 API キー)が揃っている
- WHEN 「AIで生成」を実行
- THEN 3 枚が imagePaths に保存され、子プロセス(ローカル時)は終了する

### S0016_29 同一シードで再現

- GIVEN 同じシード・プロンプト・プロバイダー
- WHEN 2 回生成
- THEN 同じ画像が得られる(プロバイダー側の決定性に依存)
  - `local-sdcpp` / `stability-ai` は `seed` を受け付けるため再現性を満たせる
  - `openai-dalle` は seed 非対応のため満たさない([要確認] — 再現性が要る用途では選ばせない)

### S0016_30 Stability AI (外部) の呼び出し契約

- GIVEN `ImageGenerationRequest`(`prompt` / `seed` / `count` / `width` / `height` / `timeoutMs`)
- WHEN `generateImages` を呼ぶ
- THEN `POST https://api.stability.ai/v2beta/stable-image/generate/core` へ送信し、`count` 枚の画像バイト列を返す
  - 認証は `Authorization: Bearer`、`accept: image/*` で生バイト列を受け取る(`application/json` にすると base64 JSON になるため使わない)
  - リクエストは `multipart/form-data`。`prompt` / `seed` / `aspect_ratio` / `output_format` を送る
  - **1 リクエスト 1 枚**しか返らないため、`openai-dalle` と同じく `count` 回呼ぶ
  - 表情差分は同一 `seed` + プロンプトのタグ差し替えで作る(sd.cpp と同じ方式)

### S0016_31 Stability AI は width/height をアスペクト比へ写像する [境界]

- GIVEN `ImageGenerationRequest` の `width` / `height`(既定は 512x768)
- WHEN リクエストを組み立てる
- THEN 任意の width/height は受け付けられず `aspect_ratio` のみを取るため、`width:height` の比を決定的な規則で許容値へ写像する
  - 許容値は `21:9` / `16:9` / `3:2` / `5:4` / `1:1` / `4:5` / `2:3` / `9:16` / `9:21`。一覧はコード内の 1 箇所にまとめる
  - 512x768 は `2:3` に完全一致する
  - 完全一致しない比は**数値として最も近い許容値**を選ぶ(決定的な規則)

### S0016_32 解決できないサイズはエラーにする [異常系]

- GIVEN `width` または `height` が 0 以下、あるいは比が写像規則で解決できない
- WHEN 生成を実行する
- THEN 黙って別サイズで生成せず、エラーを throw する

### S0016_33 タイムアウト/失敗時 [異常系]

- GIVEN 生成が予算時間を超過 or 失敗
- WHEN 子プロセス/HTTP を監視
- THEN プロセス終了(ゾンビ防止)し、エラー表示+手動アップロード or 再試行に誘導する

## 生成元の記録

### S0016_34 生成元プロバイダーの保存

- GIVEN プール・音声・画像の生成が完了
- WHEN `character` を保存する
- THEN そのキャラを作ったプロバイダーが `character.generatedBy: { text, voice, image }` に記録される(再生成時の参照用)

## 不変条件 / 要確認

- 子プロセス(ローカル画像生成)はタイムアウト・キャンセル・重複起動排他を持つ。
- 画像/音声/メッセージの**品質**は決定的に縛らない(→ experiments/)。
- 同意ダイアログ通過前の中断時に同意は永続化されない(→ docs/data-model.md)。
- **自動リトライしない**(C6 確定)。失敗は常にユーザー判断で再試行。

### [要確認](β 以降)

- 同梱モデルの最終選定・量子化(q4/q8)・表情差分方式(同一シード+タグ / img2img)。
- **外部画像 API の制約**: `openai-dalle` は表情タグ差し替えの 3 枚を 1 リクエスト = 1 枚で生成するが、
  (a) この API に **seed 指定が無い**ため「同一シードで再現」はローカル(sd.cpp)でのみ成立する、
  (b) 受け付ける **size が固定値**(1024x1024 等)で `system.imageGen` の 512x768 は渡せない。
  外部選択時に size をどう決めるか(プロバイダーごとの許容値へ丸めるか、UI で選ばせるか)は未確定。

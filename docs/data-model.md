# 要件: データ契約(設定 / プール / 統計 / ランタイム / シークレット)

`electron-store`(JSON)で永続化するデータ、メッセージプール、音声ファイル、API キー(OS セキュアストレージ)の構造を契約として固定する。型は `src/core/shared` に置き main/renderer で共有する。

> スキーマは設計時点のもの。変更時は `/new-change` で diff を切り、本ファイルへ反映する。

## 設定データ(`electron-store`)

```jsonc
{
  "character": {
    "name": "チアちゃん",
    "personality": "元気いっぱいで、いつもポジティブ。語尾に「だよ!」をつける。",
    "imagePaths": { "normal": "...", "happy": "...", "excited": "..." },
    "voicevoxSpeakerId": 3,
    // 生成元プロバイダー(再生成時の参照用。論点 0022)。
    // **実際に作った種別だけ**が現れる。各フィールドは任意で、未生成・未実装の種別は持たない
    // (下の例は画像生成が未実装のため image が無い)。選択値は providers 側であって、ここではない
    "generatedBy": {
      "text": "local-ollama",
      "voice": "local-voicevox",
    },
  },
  "triggers": {
    "regular": 50, // 既定 50、1 ≦ N ≦ 10000(設定可能)
    "milestones": [1000, 5000, 10000, 50000, 100000], // 設定可能、各値 1 以上・昇順・重複なし、最大 20、空配列許容(milestone OFF)
    "activeThresholdSec": 60, // 既定 60、5 ≦ s ≦ 600(設定可能、KPM 窓とは独立)
  },
  "popup": { "position": "bottom-right", "duration": 5000, "opacity": 0.95 },
  "providers": {
    "text": "local-ollama", // "local-ollama" | "openai" | "anthropic"
    "voice": "local-voicevox", // "local-voicevox" | "openai-tts" | "elevenlabs"
    "image": "local-sdcpp", // "local-sdcpp" | "openai-dalle" | "stability-ai"
    // 同意フラグ。プロバイダー単位で記録(外部送信は同意済みのみ)
    "consent": {
      "openai": false,
      "anthropic": false,
      "openai-tts": false,
      "elevenlabs": false,
      "openai-dalle": false,
      "stability-ai": false,
    },
  },
  "system": {
    "ollamaModel": "gemma2:2b",
    "ollamaEndpoint": "http://localhost:11434",
    "voicevoxEndpoint": "http://localhost:50021",
    "imageGen": { "useGpu": true, "steps": 4, "width": 512, "height": 768 },
    "startWithWindows": true,
    "excludedApps": [], // スキーマのみ用意。Phase 1 では参照しない
    "excludedKeys": [], // スキーマのみ用意。Phase 1 では参照しない
  },
  "onboarding": {
    "skipMainWindowAutoShow": false, // 既定 false。true ならキャラ未作成でも起動時のメインウィンドウ自動表示をしない(→ docs/main-window.md)
  },
}
```

## `hasCharacter` の判定(→ docs/main-window.md)

`character` が「作成済み」かどうかは、単なるキーの有無ではなく**プロフィール**の充足で判定する
(`src/core/hasCharacter.ts`。純粋関数。main がメインウィンドウの自動表示判定に使う)。

- `name` / `personality` が非空文字列であること
- `voicevoxSpeakerId` が数値であること

上記いずれか欠ける・`character` 自体が未保存の場合は「未作成」として扱う。

**`imagePaths` とメッセージプールは判定に含めない**(2026-07-26 確定)。画像生成とプール生成は
キャラ作成とは別 change で実装されるため、必須にすると生成が済むまで永久に「未作成」となり、
起動のたびにメインウィンドウが自動表示されてしまう。生成物の有無は別軸で扱う:

- プールがある → その文言で応援する / 無い → baseline 定型文で応援する
- 画像がある → 表示する / 無い → 表示しない

## メッセージプール(キャラごとに別ファイル)

```jsonc
// {userData}/characters/{characterId}/pool.json
{
  "characterId": "chia-2026-05-30",
  "version": 1,
  "buckets": {
    // キー = "{zone}_{type}_{timeOfDay}"、値 = メッセージ配列
    "slow_regular_morning":  [{ "id": "slow_regular_morning-000", "text": "おはよう、ゆっくりでいいよ" }, ...],
    "normal_regular_morning":[ /* 20 件 */ ],
    "fast_regular_morning":  [ /* 20 件 */ ],
    "slow_milestone_morning":[ /* 20 件 */ ],
    // ... 計 24 シナリオ
  },
  // 中断時の状態
  "completion": {
    "slow_regular_morning": "complete",   // "complete" | "pending" | "failed"
    // ...
  },
}
```

- キーの定義域: `zone ∈ {slow, normal, fast}` × `type ∈ {regular, milestone}` × `timeOfDay ∈ {morning, afternoon, evening, night}` = **24 シナリオ**
- 各バケットの目標サイズ: 8 文(`integrations.md` 参照。2026-07-26 に 20 文から引き下げ)
- 1 文 = 30 文字以内
- **中身が空のプールは無効**として扱う(構造が妥当でも 1 文も無ければ読み込み時に破棄し
  baseline 定型文へ落とす)。生成失敗時も部分結果は再開のために保存するため、
  全バケットが空の `pool.json` が残りうる。1 文でもあれば中断の途中経過として活かす。
- **プロバイダーが要求数より多く返した場合はバケット単位で切り詰める**。件数はプロンプトで
  指示するだけでは守られないため、総数・生成時間・ディスク使用量の見積もりを機械的に保つ。
- メッセージ ID の規約: `{バケットキー}-{3桁連番}`(例 `slow_regular_morning-000`)。
  wav ファイル名にそのまま使うため **Windows で使える文字のみ**・プール内で一意であること。
  baseline 定型文の ID は `baseline:` 接頭辞を持ち、事前合成 wav を持たない(→ cheer-trigger.md)。

## 保存ルート

- ベース: Electron `app.getPath('userData')`(OS 差を吸収、Windows: `%APPDATA%/keyCheer/`)
- キャラ別: `{userData}/characters/{characterId}/`
- `characterId` は**キャラ保存時に採番される不変 ID**(論点 0020)。名前から導出しない
  — 名前を変えるたびに生成済みの wav ディレクトリが迷子になるため。ディレクトリ名になるので
  パス区切りや Windows で使えない文字を含まない文字種のみを使う。
- ユーザーが触る場面なし(設定 JSON のみ「設定>データ位置を開く」で参照可能、内部物の編集は非推奨)

## 音声ファイル

```
{userData}/characters/{characterId}/voices/{messageId}.wav
```

- メッセージ ID → wav パスは決定的に解決可能
- 欠損時は発動経路でテキストのみフォールバック(→ cheer-trigger.md)

## Baseline 定型文(同梱)

- 同梱位置: `src/core/baseline/messages.ts`(コード同梱、外部リソースファイルではない)
- 用途: プール未生成・バケット全欠損時のフォールバック(→ cheer-trigger.md)
- 構造: `(zone, type, timeOfDay)` シナリオごとに 1〜数件の定型文を持つ
- 1 文 30 字以内の契約はプール生成文と同一

## 監査ログ(外部送信履歴・別ファイル)

```
{userData}/audit.log.json
```

- 外部プロバイダーへ送信が発生したときに append される(キャラ作成時のみ発生)
- エントリ: `{ timestamp, provider, action, payloadSummary }`(payload 本文は含めない・要約のみ)
- `stats` と分離する(プライバシー方針の境界をデータレベルで明示するため)
- UI から閲覧・エクスポート可能

## API キー(OS セキュアストレージ)

- Electron `safeStorage` 経由(Windows: Credential Manager)
- `electron-store` の JSON にはキー本体を書かない
- `providers.consent` フラグは平文 JSON でよい(キーそのものではないため)
- キー識別子の例: `keycheer.api-key.openai`, `keycheer.api-key.anthropic`, ...

## 統計データ

```jsonc
{
  "stats": {
    "totalKeyCount": 0,
    "totalActiveSeconds": 0,
    "dailyCounts": { "2026-03-30": 4523 },
    "dailyActiveSeconds": { "2026-03-30": 1820 },
    "cheerHistory": [
      {
        "timestamp": "2026-03-30T14:30:00",
        "count": 500,
        "kpm": 240,
        "speedZone": "fast",
        "type": "regular",
        "timeOfDay": "afternoon",
        "messageId": "fast_regular_afternoon-017",
        "message": "500回達成だよ!すごいすごい!",
      },
    ],
  },
}
```

## ランタイム状態(永続化しないが契約上重要)

```jsonc
{
  "runtime": {
    "lastKeyTimestamp": "2026-03-30T14:30:05.123Z",
    "isActive": true,
    "recentKeyTimestamps": [],
    "currentKpm": 240,
    "currentZone": "fast",
    "lastMessageIdByBucket": { "fast_regular_afternoon": "fast_regular_afternoon-017" }, // 連続回避用
  },
}
```

### S0015_01 既存設定の読み込みと既定値補完

- GIVEN 一部キーが欠けた設定 JSON(`providers` / `triggers.activeThresholdSec` 等が無い旧バージョン含む)
- WHEN 起動時に読み込む
- THEN 欠損キーは既定値(`triggers.regular=50` / `activeThresholdSec=60` / ローカルプロバイダー / 同意=false 等)で補完され、型に適合した設定オブジェクトになる(**例外: `character.generatedBy` は補完しない** → S0022_09)

### S0015_02 `triggers.regular = 100` のマイグレーション [境界]

- GIVEN アップデート前の保存値 `triggers.regular = 100`(現行既定)
- WHEN アップデート後に起動
- THEN `triggers.regular` は **50 にリセット**され、初回起動で「既定値が 50 に変わりました」と main プロセスから通知する。以降ユーザーが明示変更した値は尊重する(再上書きしない)

### S0015_03 speedZone は 3 値のみ [境界]

- GIVEN cheerHistory に記録する speedZone
- WHEN 値を書き込む
- THEN `"slow" | "normal" | "fast"` のいずれか(他値は不正)

### S0015_04 timeOfDay は 4 値のみ [境界]

- GIVEN cheerHistory・プールバケットキーに使う timeOfDay
- WHEN 値を書き込む
- THEN `"morning" | "afternoon" | "evening" | "night"` のいずれか
- 注:時刻 → timeOfDay の分類関数(境界定数)は `docs/time-of-day.md` に確定。各呼び出し側は core の `classifyTimeOfDay` を使い、独自実装で if を書かない。

### S0015_05 プロバイダー識別子の定義域 [境界]

- GIVEN `providers.text` / `providers.voice` / `providers.image`
- WHEN 値を書き込む
- THEN それぞれ閉じた union(`integrations.md`)に含まれる識別子のみ

### S0015_06 `triggers` 値域バリデーション [境界]

- GIVEN `triggers.regular` / `triggers.activeThresholdSec` / `triggers.milestones`
- WHEN 値を保存
- THEN それぞれ `1 ≦ regular ≦ 10000` / `5 ≦ activeThresholdSec ≦ 600` / 各 milestone 値 1 以上・昇順・重複なし・最大 20 個 を満たす値のみ受理。違反値は拒否(JSON 直接編集時は起動時バリデーションで既定値に置換しログ)

### S0015_07 API キーが平文 JSON に出ない [不変条件]

- GIVEN 任意の API キー保存操作
- WHEN 設定が保存される
- THEN `electron-store` の JSON にキー本体は現れない(safeStorage にのみ存在)

### S0015_08 同意フラグ未通過状態の永続化禁止

- GIVEN 同意ダイアログ表示中に強制終了 → 再起動
- WHEN 設定を読み込む
- THEN `providers.consent.<プロバイダー>` は `false` のまま(永続化されない)

### S0022_09 `generatedBy` は既定値で補完しない [境界]

- GIVEN `character.generatedBy` が無い、または一部の種別だけを持つ設定 JSON(旧バージョン含む)
- WHEN 起動時に読み込む
- THEN 欠けている種別は**未設定のまま**で、S0015_01 の既定値補完の**対象外**。
  とくに `providers` の選択値で埋めない(「作った」と「選んだ」を混ぜないため)

### S0022_10 `generatedBy` の値はプロバイダー識別子の定義域に従う [境界]

- GIVEN `generatedBy` に記録された値
- WHEN 設定を読み込む
- THEN 各種別の値は S0015_05 と同じ閉じた union に属する(未設定は許すが、定義域外の文字列は不正)

## 検討事項 [要確認](β 以降に確定)

- **`dailyCounts` / `dailyActiveSeconds` の日付境界のタイムゾーン**。現状は **ローカル暦日**で実装
  (`timeOfDay` がローカル時基準なので揃えた)。UTC 基準にすると JST では 09:00 に「当日」が変わる。
- **統計をディスクへ書き戻す間隔**。「メモリ上で加算し定期的に保存」(key-counter.md 不変条件)の
  「定期的」を現状 **10 秒 + 終了前 flush** で実装。秒未満の端数は次回へ繰り越す(累計が目減りしないため)。
- **`pool.json` の `completion` の保存形式**。core の `MessagePool` 型は `buckets` のみを持ち、
  `completion` は生成オーケストレーション側(agent)の状態。本 spec の「同一ファイルに併記」を採るか、
  別ファイルに分けるかは永続化を実装する change で確定する。
- 統計肥大化時の保持期間・集約方針(未検討)。
- sd.cpp バイナリ/モデル/LoRA のパスは同梱物配置で決まる内部定数とし、設定 JSON に持たない。
- プールの version 互換戦略(将来スキーマ変更時の自動移行)。
- 同意の有効期限(永続的か、一定期間で再同意を求めるか)。

## 確定済み(本 spec で固定)

- 生成画像・プール・wav の保存先ルート = `app.getPath('userData')` 直下の `characters/{characterId}/`。
- 監査ログは `{userData}/audit.log.json` の別ファイル(`stats` とは分離)。
- baseline 定型文は `src/core/baseline/messages.ts` にコード同梱。

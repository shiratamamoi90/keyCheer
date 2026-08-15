# 要件: 応援トリガー & メッセージプール選択

累計カウントが `triggers.regular` の倍数・`triggers.milestones` のいずれかに達したら応援を発動し、その時点の `(speedZone, type, timeOfDay)` に対応するメッセージプールから 1 文を選び、対応する事前合成 wav を再生する。**発動経路では外部 API・localhost を含めて一切のサーバー通信を行わない**(プールと wav はキャラ作成時に確定済み — → docs/integrations.md)。

トリガー設定値(既定):

- `triggers.regular = 50`(設定可、1 ≦ N ≦ 10000)
- `triggers.milestones = [1000, 5000, 10000, 50000, 100000]`(設定可、空配列 = milestone OFF を許容)
- 詳細は `docs/data-model.md` および `論点 0009(`decisions/decided/0009-configurable-triggers/`)`。

### S0013_01 通常応援を N 回ごとに発動

- GIVEN `triggers.regular = 50`、累計カウントが 49
- WHEN キーが押されてカウントが 50 になる
- THEN 種別 `regular` の応援が 1 回発動する

### S0013_02 倍数以外では発動しない [境界]

- GIVEN `triggers.regular = 50`、カウントが 50
- WHEN カウントが 51 になる
- THEN 応援は発動しない

### S0013_03 マイルストーン発動

- GIVEN マイルストーン = [1000, 5000, 10000]、カウントが 999
- WHEN カウントが 1000 になる
- THEN 種別 `milestone` の特別応援が発動する(同時に通常条件も満たす場合は milestone を優先)

### S0013_04 発動時に現在の (zone, timeOfDay) を付与

- GIVEN 発動条件を満たし、現在ゾーン `fast`、時間帯 `evening`
- WHEN 応援を選択する
- THEN シナリオキー `(fast, regular | milestone, evening)` でプール照会する

### S0013_05 プールからの 1 文選択 + 対応 wav 再生

- GIVEN プールがシナリオキー `(fast, regular, evening)` に 8 文を持つ
- WHEN 応援が発動する
- THEN そのバケットから 1 文だけ取り出し、対応する事前合成 wav を再生する(LLM/TTS の呼び出しは発生しない)

### S0013_06 発動経路で外部依存に触らない [不変条件]

- GIVEN プール・wav が揃ったキャラ、プロバイダー設定が何であれ
- WHEN 応援が発動する
- THEN Ollama / VOICEVOX / sd.cpp / 外部 API への通信・子プロセス起動は一切発生しない

### S0013_07 同一文の連続再生を避ける(セッション内除外方式)

- GIVEN あるバケットから直前に文 m を選んで再生した(`runtime.lastMessageIdByBucket` に m が記録される)
- WHEN 同じバケットから次に選ぶ
- THEN m を除外して残りから 1 文を選ぶ。アプリ再起動で除外状態はリセット(セッション内のみ有効)
- 注:LRU(全期間履歴)ではなく**直前 1 件をセッションスコープで除外**する方式。永続化コストを抑え、core 内の純粋関数で完結する
- 注:記録・参照のキーは**実際に選択したバケット**(`CheerSelection.sourceBucketKey`)。フォールバックで
  別バケットから選んだ場合も、記録は選択元バケットに対して行う(照会キー `bucketKey` ではない)。
  → work(削除済み)/0006-cheer-selection-source-bucket/spec.md(選択元シナリオ一式)

### S0013_08 マイルストーン文中の動的数値補間

- GIVEN milestone バケットの文に `{milestone}` プレースホルダを含む(例: 「{milestone} 回達成だよ!」)
- WHEN 文を選び再生する
- THEN テキストポップアップでは `{milestone}` を実際の数値(例: 1000)に置換して表示する。**wav は数値抜きで合成されているため再生はそのまま**(数値の音声化は行わない)
- 注:数値表現の正確性より発動経路の単純さ・wav プリ合成の単純さを優先する判断。regular バケットでの `{milestone}` は無効(置換しない)

### S0013_09 対象バケットが空のときのフォールバック [異常系]

- GIVEN `(fast, milestone, night)` バケットが空(生成失敗で欠損)
- WHEN そのシナリオで発動する
- THEN 同じ `(type, timeOfDay)` の別ゾーン → 同じ `type` の任意 → 同梱 baseline 定型文 の順でフォールバックし、クラッシュしない

### S0013_10 音声ファイル欠損時のフォールバック [異常系]

- GIVEN プールに文 m が存在するが対応 wav が欠損
- WHEN m を選んで再生する
- THEN 音声なしでテキストポップアップのみ表示し、クラッシュしない(エラーはログ)

### S0013_11 キャラ未作成時の発動 [異常系]

- GIVEN プールが未生成のままアプリが起動・キーが押される
- WHEN トリガー条件を満たす
- THEN 同梱 baseline 定型文で応援し、キャラ作成を促す通知を出す(クラッシュしない、外部送信は発生しない)

### S0013_12 履歴の記録

- GIVEN 応援が発動し、選択文 m と現在の `(kpm, speedZone, type, timeOfDay)` が確定
- WHEN `cheerHistory` に記録する
- THEN そのエントリの `count` / `kpm` / `speedZone` / `message` / `type` / `timeOfDay` / `messageId` が保存される(→ docs/data-model.md)

### S0013_13 マイルストーン空配列 [境界]

- GIVEN `triggers.milestones = []`(milestone OFF 設定)
- WHEN 任意のカウント到達
- THEN `milestone` 種別の応援は発動しない。`regular` の倍数判定のみが行われる

## 不変条件

- 発動判定は決定的(同じカウント・設定・ゾーン・時間帯・直前 messageId なら同じ選択になる)。
- 発動経路は外部依存ゼロ(`providers` 設定を参照しない)。
- 連続回避は **セッション内除外方式**(LRU ではない、永続化しない)。
- マイルストーン動的数値は **テキストのみ補間**(wav には反映しない)。
- どの文字列が選ばれるか(=プール内容そのもの)の良し悪しは**仕様化しない**(→ experiments/)。

# 用語集(ドメイン語彙の「正」)

仕様に登場する概念の正本。**ここに登録されていない語をコードのドメイン語彙として使わない。**
このファイルが持つのは**語そのものだけ**で、語の選び方(名詞形が正・述語は `is_<形容詞形>` /
`has_<名詞形>`・同義語を作らない・追加や変更は論点(`decisions/`)を通す仕様変更)は
@.claude/rules/impl-rules.md「命名規則」N-1 が正本。ここに書き写さない(2箇所あると片方が古くなる)。

## 書き方(検査対象なので形式を崩さない)

- テーブルは**5列固定**。列位置を `scripts/validate.sh` が参照するため増減させない。
- 形容詞形が作れない語は空欄にせず `—` を入れる(空セルは列位置をずらす)。
- 「使ってはいけない表記」はバッククォート付きのカンマ区切りで書く(`` `cheerMsg`, `encouragement` ``)。
  この列の識別子が `src/` `tests/` `docs/` に出現すると検査が NG を出す。
- **汎用語(`count`, `state`, `data`, `status` 等)を禁止表記に登録しない。**
  単語境界の grep が無関係な箇所まで拾い、検査が使い物にならなくなる。
  汎用語の扱いは impl-rules.md N-6(中身のない名前)で縛る。
- 記法(camelCase)は @.claude/rules/stack.md「命名の記法」が正本。ここでは語だけを決める。

## 用語

| 仕様(日本語) | 名詞形(正) | 形容詞形 | 使ってはいけない表記 | 定義 |
|---|---|---|---|---|
| 応援 | `cheer` | — | `cheerMsg`, `encouragement` | 打鍵に反応してキャラがメッセージと音声を出す振る舞いの総称 |
| 応援種別 | `cheerType` | — | `cheerKind`, `cheertype` | 発動理由の区分。`regular`(通常)と `milestone`(節目)の2値 |
| キー押下数 | `keyCount` | — | `strokeCount`, `keycount` | 押下イベントを数えた累計。入力内容は含まない |
| 打鍵速度 | `kpm` | — | `keysPerMin`, `kpmValue`, `spd` | 直近 60 秒のキー押下数。算出窓は固定(論点 0012) |
| 速度ゾーン | `speedZone` | — | `velocityZone`, `zoneOf`, `speedzone` | `kpm` を丸めた3段階(`slow` / `normal` / `fast`) |
| 時間帯 | `timeOfDay` | — | `dayPart`, `tod`, `timeofday` | 時刻を丸めた4値(`morning` / `afternoon` / `evening` / `night`) |
| アクティブ時間 | `activeThresholdSec` | — | `idleThreshold` | 最後の押下からこの秒数以内を「入力中」とみなす設定値(既定 60) |
| メッセージプール | `messagePool` | — | `msgPool`, `poolData` | キャラ作成時に一括生成した応援文の集合 |
| バケット | `bucket` | — | `bkt`, `slot` | プールの区画。`(speedZone × cheerType × timeOfDay)` で1つ決まる |
| 定型文 | `baseline` | — | `cannedText` | 同梱の固定文。プール未生成・バケット欠損時に使う比較基準 |
| マイルストーン | `milestone` | — | `milestoneList` | 節目の押下数。到達で `milestone` 種別の応援が出る |
| キャラクター | `character` | — | `chara`, `charName` | 利用者が作る応援役。名前・性格・話者・生成物を持つ |
| 話者 | `speaker` | — | `voiceActor`, `spk` | 音声プロバイダーが持つ声の種類 |
| プロバイダー | `provider` | — | `prov` | 生成手段の差し替え単位(テキスト / 音声 / 画像) |
| 同意 | `consent` | — | `consentFlag` | 外部プロバイダーへの送信を利用者が明示的に承認した状態 |
| 監査ログ | `auditLog` | — | `sendLog`, `auditlog` | 外部送信の記録。統計とは別ファイルに置く |
| ポップアップ | `popup` | — | `toast` | 応援を表示する小さなウィンドウ |
| 音声ファイル | `wav` | — | `wavFile`, `voicePath` | 事前合成した応援音声。プールの各文に対応する |
| プール生成 | `poolGeneration` | — | `genPool` | キャラ作成時にプールと `wav` をまとめて作る処理 |

> 名詞形は**概念・データ・型の名前**。関数名にするときは N-3 の接頭辞を付ける(例と理由は N-3)。

## 却下した語

同義語の再提案を防ぐための記録。ここにある語は再検討しない(覆すなら新しい論点を通す)。

| 却下した語 | 採用した語 | 却下理由 | 決定した論点 |
|---|---|---|---|
| encouragement | `cheer` | 長く、UI 文言とコードで表記が割れる | 0013-cheer-trigger |
| velocityZone | `speedZone` | 「正」の表記が「速度ゾーン」。訳語を2つ持たない | 0012-speed-zone |
| dayPart | `timeOfDay` | プールのバケットキーが `timeOfDay` で確定済み | 0014-time-of-day |
| slot | `bucket` | 「区画」の意味が薄く、時間枠とも読める | 0013-cheer-trigger |
| voiceActor | `speaker` | VOICEVOX の API 用語が `speaker` | 0003-tts-voicevox |

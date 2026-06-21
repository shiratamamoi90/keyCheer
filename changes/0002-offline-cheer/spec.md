# 要件: オフライン応援とメッセージプール

応援発動は外部依存ゼロで動く。発動時に現在の `(speedZone, type, timeOfDay)` に対応するプールから 1 文を選び、対応する事前合成 wav を再生する。プール一括生成・音声事前合成はキャラ作成時にのみ Ollama / VOICEVOX を使用する。

## シナリオ: キャラ作成時にプールを生成

- GIVEN Ollama 起動済み、キャラ性格 P が確定
- WHEN キャラを保存(=メッセージプール生成を要求)
- THEN `(zone × type × timeOfDay) = 3 × 2 × 4 = 24` シナリオそれぞれに対し、性格 P に沿った文が **20 文ずつ**生成され、合計 480 文がプールとして保存される

## シナリオ: キャラ作成時に音声を事前合成

- GIVEN VOICEVOX 起動済み、プール 480 文が生成済み
- WHEN 音声合成を要求
- THEN 各メッセージに 1:1 対応する wav が生成・保存され、メッセージ ID から wav パスを一意に解決できる

## シナリオ: 発動時のプール選択

- GIVEN 応援発動条件を満たし、現在 `speedZone=fast`, `type=regular`, `timeOfDay=evening`
- WHEN 応援文を選ぶ
- THEN そのシナリオキー `(fast, regular, evening)` のバケットから 1 文だけ取り出し、対応する wav を再生する(LLM/TTS の呼び出しは発生しない)

## シナリオ: 発動時は外部依存に触らない [不変条件]

- GIVEN プール・wav が揃ったキャラ
- WHEN 応援が発動する
- THEN Ollama / VOICEVOX / sd.cpp への通信・子プロセス起動は **一切発生しない**(localhost も呼ばない)

## シナリオ: マイルストーン発動時のプール選択

- GIVEN 発動条件: マイルストーン 1000 回到達、ゾーン `normal`、時間帯 `afternoon`
- WHEN 応援を選ぶ
- THEN `(normal, milestone, afternoon)` バケットから 1 文を選ぶ(milestone を regular より優先)

## シナリオ: 同一文の連続再生を避ける

- GIVEN あるバケットから直前に文 m を選んで再生した
- WHEN 同じバケットから次に選ぶ
- THEN m と異なる文を選ぶ([要確認]: LRU / セッション内除外のどちらか)

## シナリオ: 対象バケットが空のときのフォールバック [異常系]

- GIVEN `(fast, milestone, night)` バケットが空(例: 生成失敗で欠損)
- WHEN そのシナリオで発動する
- THEN 同じ `(type, timeOfDay)` の別ゾーン → 同じ `type` の任意 → 定型文 の順でフォールバックし、クラッシュしない

## シナリオ: 音声ファイル欠損時のフォールバック [異常系]

- GIVEN プールに文 m が存在するが対応 wav が欠損
- WHEN m を選んで再生する
- THEN 音声なしでテキストポップアップのみ表示し、クラッシュしない(エラーはログ)

## シナリオ: プール構造の契約 [境界]

- GIVEN プール JSON を読み込む
- WHEN バリデーション
- THEN 24 シナリオすべてがキーとして存在し、各値は文字列配列。`zone ∈ {slow, normal, fast}`, `type ∈ {regular, milestone}`, `timeOfDay ∈ {morning, afternoon, evening, night}` に限る

## シナリオ: キャラ未作成時の発動 [異常系]

- GIVEN プールが未生成のままアプリが起動・キーが押される
- WHEN トリガー条件を満たす
- THEN 定型文(同梱の baseline)で応援し、キャラ作成を促す通知を出す(クラッシュしない)

## シナリオ: 生成途中での中断 [異常系]

- GIVEN 480 文一括生成中に Ollama がクラッシュ or キャンセル
- WHEN 状態を保存する
- THEN 生成済みシナリオは保持され、未生成シナリオは「未完了」マークで残る。再開時は未完了分のみ生成する([要確認]: 全廃棄 & やり直しでも可)

## 不変条件

- 発動経路から Ollama / VOICEVOX への通信を出さない(コード上 import すら engine から行わない)。
- プール構造とシナリオキーの順序付け(`zone × type × timeOfDay`)は決定的。
- どんな文字列が入るか・音声の自然さは**仕様化しない**(→ experiments/)。
- プライバシー方針(キーの種類のみカウント / 外部送信なし)は維持。

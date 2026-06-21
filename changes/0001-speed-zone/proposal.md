# 提案 0001: 打鍵速度ゾーンの算出と応援文言切り替え

## なぜ

「沢山打った」だけでなく「集中して速く打った/のんびり打った」をキャラが認識して反応する方が体験が良い。
そのために直近1分の KPM を算出し、3段階ゾーン(slow/normal/fast)に分類して、発動時に Ollama プロンプトへ渡す。

## 影響範囲

- ADDED: KPM 算出(直近1分の押下リング)、速度ゾーン分類、ランタイム状態への `currentKpm` / `currentZone`
- MODIFIED: 応援トリガー(発動時にゾーンを付与)、cheerHistory に `kpm` / `speedZone` を記録、Ollama プロンプト生成
- 関連 spec: specs/speed-zone.md(新規)、specs/cheer-trigger.md(ゾーン付与)、specs/data-model.md(履歴フィールド追加)

## 種別判定

**決定的**(同じ押下時刻列 → 同じ KPM・ゾーン)。仕様ループで進める。
※ ゾーンを受け取った Ollama が**どんな文言を返すか**は非決定的 → それは experiments/0001-cheer-prompt-tone で測る。本 change では「ゾーンを正しく算出・付与する」までを縛る。

## 要確認

- ゾーン閾値(slow<100, normal 100-249, fast>=250)は仮置き。本実装では設定可能 or 定数か。
- キーリピート(押しっぱなし)を1カウントとするか除外するか。

# 要件: キーカウント & アクティブ時間

全アプリ横断でキー押下回数をカウントし、最後の押下から **`triggers.activeThresholdSec` 秒以内**(既定 60 秒、設定可能)を「入力中(アクティブ)」と判定する。入力内容は一切記録しない。

### S0011_01 キー押下でカウント加算

- GIVEN 現在の累計カウントが N
- WHEN 任意のキーが1回押される
- THEN 累計カウントは N+1 になる(押されたキーの種類・内容は保存しない)

### S0011_02 同時押し・複数キーもそれぞれ1カウント

- GIVEN カウントが N
- WHEN 2つのキーがほぼ同時に押される
- THEN カウントは N+2 になる(イベント単位で数える)

### S0011_03 キーリピート(押しっぱなし)

- GIVEN OS の自動リピートで同じキーが連続して送られる
- WHEN uiohook-napi がリピートイベントを発火
- THEN **生イベントごとに 1 カウント**(デバウンスしない)。リピート抑制は Phase 1 では行わない

### S0011_04 アクティブ判定(`activeThresholdSec` 以内)

- GIVEN 最後のキー押下時刻 last、設定 `activeThresholdSec = 60`
- WHEN 現在時刻が last + 59 秒
- THEN `isActive` は true(入力中とみなす)

### S0011_05 閾値ちょうどは非アクティブ [境界]

- GIVEN 最後のキー押下時刻 last、設定 `activeThresholdSec = 60`
- WHEN 現在時刻が last + 60 秒ちょうどに達する
- THEN `isActive` は false(`now - last < activeThresholdSec * 1000` の strict less-than 方式)

### S0011_06 閾値変更後の判定

- GIVEN `activeThresholdSec` を 60 → 120 に変更
- WHEN 直後に `isActive` を判定
- THEN 新しい閾値 120 秒で判定される(再起動不要、core は引数で受け取る)

### S0011_07 アクティブ秒数の累積

- GIVEN アクティブ状態が継続している
- WHEN 入力中の経過時間を集計する
- THEN 累計アクティブ秒数・当日アクティブ秒数に加算される(アイドル中は加算しない)

### S0011_08 KPM 算出窓は activeThresholdSec とは独立 [不変条件]

- GIVEN `activeThresholdSec = 120`(変更)、KPM 算出窓は 60 秒固定
- WHEN KPM を求める
- THEN 直近 60 秒の押下数を返す(`activeThresholdSec` の値に左右されない。`speed-zone.md` 参照)

### S0011_09 除外設定(Phase 1 では未実装)

- GIVEN 設定スキーマに `system.excludedApps: []` / `system.excludedKeys: []` が存在
- WHEN 起動・キー押下
- THEN Phase 1 ではこれらの配列は参照されない(常に全アプリ・全キーを対象)。スキーマだけ用意し将来の change で実装する

## 不変条件

- 押下されたキーの**種類・並び・文字を保存しない**(カウンタのみ更新)。
- カウンタはメモリ上で加算し、定期的にディスク(electron-store)へ保存する。
- `activeThresholdSec` は設定値、KPM 算出窓(60 秒)はコード固定の別軸。

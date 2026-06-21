# 要件: 打鍵速度ゾーン (Speed Zone)

直近1分の KPM を算出して slow/normal/fast に分類し、応援発動時に現在ゾーンを付与・記録する。

## シナリオ: 直近1分の押下数を KPM とする

- GIVEN 直近60秒以内に 150 件の押下時刻がある
- WHEN KPM を求める
- THEN KPM = 150

## シナリオ: 1分より古い押下を除外

- GIVEN 61秒前に1件、30秒前に1件の押下
- WHEN KPM を求める
- THEN KPM = 1(61秒前は窓の外)

## シナリオ: KPM をゾーンに分類

- GIVEN KPM = 80 / 180 / 300
- WHEN ゾーンを判定する
- THEN それぞれ slow / normal / fast

## シナリオ: 閾値ちょうどの境界 [境界]

- GIVEN KPM = 100 と KPM = 250
- WHEN ゾーンを判定する
- THEN 100 → normal、250 → fast(下限を含む)

## シナリオ: 入力なしは slow [境界]

- GIVEN 直近1分に押下なし
- WHEN KPM とゾーンを求める
- THEN KPM = 0、ゾーン = slow

## シナリオ: 発動時にゾーンを付与・記録

- GIVEN 応援が発動し、現在ゾーンが fast
- WHEN cheerHistory に記録する
- THEN そのエントリの `kpm` と `speedZone="fast"` が保存される

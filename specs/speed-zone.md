# 要件: 打鍵速度(KPM)と速度ゾーン

**直近 60 秒間(コード固定)** のキー押下数を KPM(Keys Per Minute)として算出し、3段階の速度ゾーン(slow / normal / fast)に分類する。KPM 算出窓は `triggers.activeThresholdSec`(設定可能)とは**独立**で、ユーザー設定では変更できない(「分」表記の意味を保つため)。

ゾーン閾値(仮置き、利用実態で調整):
| ゾーン | KPM | 用途 |
|---|---|---|
| `slow` | 0 〜 99 | ゆっくり寄り添う応援 |
| `normal` | 100 〜 249 | 標準の応援 |
| `fast` | 250 〜 | 勢いを煽る応援 |

## シナリオ: 直近1分のキー数で KPM 算出

- GIVEN 直近1分の押下時刻リング(例:120 件)
- WHEN 現在の KPM を求める
- THEN 「現在時刻から60秒以内」の押下数を返す(= 120)

## シナリオ: 1分より古い押下は除外 [境界]

- GIVEN 61秒前と59秒前に各1回の押下がある
- WHEN KPM を求める
- THEN 61秒前は窓の外、59秒前のみ数え、KPM = 1

## シナリオ: slow ゾーン分類

- GIVEN KPM = 80
- WHEN ゾーンを判定する
- THEN `slow`

## シナリオ: normal ゾーン分類

- GIVEN KPM = 180
- WHEN ゾーンを判定する
- THEN `normal`

## シナリオ: fast ゾーン分類

- GIVEN KPM = 300
- WHEN ゾーンを判定する
- THEN `fast`

## シナリオ: 閾値ちょうどの境界 [境界]

- GIVEN KPM = 100(slow/normal 境界)と KPM = 250(normal/fast 境界)
- WHEN ゾーンを判定する
- THEN 100 → `normal`、250 → `fast`(下限を含む方式)

## シナリオ: 入力が無い場合

- GIVEN 直近1分に押下が無い
- WHEN KPM を求める
- THEN KPM = 0、ゾーンは `slow`

## シナリオ: activeThresholdSec を変えても KPM 窓は不変 [不変条件]

- GIVEN `triggers.activeThresholdSec` を 60 → 120 に変更
- WHEN KPM を求める
- THEN KPM 窓は依然 60 秒(`activeThresholdSec` を参照しない)

## 不変条件 / 要確認

- KPM 算出窓 = **60 秒固定**(設定対象外)。
- キーリピート(押しっぱなし)は**生イベントごとに 1 カウント**(Phase 1、`key-counter.md` 参照)。
- 速度ゾーン閾値は仮置き。β版で実測して確定する([要確認])。

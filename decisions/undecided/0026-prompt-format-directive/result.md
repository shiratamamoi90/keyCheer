# 結果(計測後に記入)

| 指標                       | baseline(no_directive) | 本計測(format_directive) |
| -------------------------- | ---------------------- | ------------------------ |
| 書式混入率(%)              | -                      | -                        |
| 契約違反率(%)              | -                      | -                        |
| 平均レイテンシ(ms/バケット) | -                      | -                        |

## 考察

<指示で混入率が下がったか。文言の質に副作用は出たか。層 3 の保険で拾い切れているか>

## 再現条件

model=gemma2:2b, temperature=0.8, seed=42, structured_output=false, deps=package-lock.json(固定)

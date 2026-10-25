# 結果(2026-10-25 計測)

計測:`npm run eval -- decisions/undecided/0027-local-text-model-sarashina`(各モデル 360 バケット =
キャラ 3 × 24 バケット × 5 試行)。生データは `~/.cache/keycheer-eval/`(リポジトリ外)。

| 指標                         | baseline(gemma2:2b) | sarashina2.2-3b-instruct |
| ---------------------------- | ------------------- | ------------------------ |
| **日本語率(%)**(主指標)     | 86.1                | **90.7**                 |
| 失敗バケット率(%)            | 4.4                 | 0.8                      |
| 書式混入率(%)                | 6.5                 | 3.7                      |
| 30 字超過率(%、層 3 の前)    | 3.7                 | 2.8                      |
| 件数充足率(%、8 件に対して)  | 67.4                | 96.7                     |
| 平均レイテンシ(ms/バケット) | 7463                | 6070                     |
| 文言の質(人手評価)           | 未評価              | 未評価                   |

## 考察

- 主指標の日本語率は +4.6 ポイント。副指標もすべて案B が良く、中止条件(失敗バケット率・
  レイテンシの悪化)には掛からない。3B なのに速いのは、件数を守って短く終わるためと見られる(未検証)。
- 件数充足率の差(67.4 → 96.7)が最も大きい。gemma2:2b は 8 件の要求に対して少なく返すことが多い。
- 文言の質(人手評価)は未実施。
- 指標関数(日本語判定・書式混入判定)に単体テストはまだ無い。

## 再現条件

model=sbintuitions/sarashina2.2-3b-instruct-v0.1@4f3626fb1b64b3e97c908e67f27b2d627ba2a999 →
ollama create --quantize q4_K_M(層 sha256=60e33bab…6b959、TEMPLATE は config.yaml)、
baseline=gemma2:2b(ollama id 8ccf136fdd52)、temperature=Ollama 既定 0.8、seed=42+試行番号(42〜46)、
structured_output=true、ollama=0.32.13(compose.yaml の digest)CPU、deps=package-lock.json(固定)

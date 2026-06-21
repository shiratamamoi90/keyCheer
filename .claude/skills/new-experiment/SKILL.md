---
name: new-experiment
description: 新しい実験フォルダを作り、探索ループ(仮説→設定→計測→考察)を開始する。勝率・精度など指標で測る非決定的な作業に使う。
---

引数 $ARGUMENTS を実験名(kebab-case)として、探索ループを開始する。

手順:

1. experiments/ の最大連番+1 を NNNN(4桁)とする。
2. `experiments/NNNN-$ARGUMENTS/` を作り、.claude/rules/experiment-rules.md のテンプレに従って生成:
   - hypothesis.md … 仮説 / 測り方(指標・試行数・シード) / 中止条件
   - config.yaml … 変更するパラメータ(1実験1変数)
   - result.md … 空(計測後に指標と考察を記入)
3. baseline が存在するか確認し、無ければ先に baseline を作るよう促す。
4. 強さ・精度を test で縛ろうとしないこと。決定的な制約(クラッシュしない/予算内/再現性)が必要なら、それは別途 tests/ にテストとして追加するよう提案する。

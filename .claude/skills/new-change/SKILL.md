---
name: new-change
description: 新しい変更フォルダを作り、仕様ループ(仕様→テスト→実装→テスト)を開始する。決定的な機能追加・修正に使う。
---

引数 $ARGUMENTS を変更名(kebab-case)として、仕様ループを開始する。

手順:

1. changes/ 内の既存連番を調べ、最大+1 を 4桁ゼロ詰めで NNNN とする(無ければ 0001)。
2. `changes/NNNN-$ARGUMENTS/` を作り、以下を生成:
   - proposal.md … なぜ変えるか / ADDED・MODIFIED の影響範囲
   - spec.md … .claude/rules/spec-rules.md のテンプレに従った GIVEN/WHEN/THEN(雛形のみ。シナリオの中身は人間が確定)
   - tasks.md … テスト先行のチェックリスト(下記の形)
   - diff.md … ADDED / MODIFIED / 完了条件
3. この変更が本当に決定的かを判定して報告する。非決定的な要素が混じっていたら experiments/ 側に分けるよう提案する。
4. **spec.md のシナリオを人間が承認するまで実装・テストを書かない。** 雛形を用意したら停止し、人間のレビューを促す。

tasks.md の形:

```markdown
- [ ] spec の各シナリオに対応する失敗テストを書く(Red)
- [ ] テストが赤になることを確認
- [ ] 最小実装で緑にする(Green)
- [ ] リファクタ(全緑維持)
- [ ] specs/ に反映、diff.md 更新、この change をアーカイブ
```

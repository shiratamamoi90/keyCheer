- [ ] spec の各シナリオに対応する失敗テストを書く(Red)— `tests/engine/timeOfDay.test.ts`
- [ ] テストが赤になることを確認
- [ ] 最小実装で緑にする(Green)— `src/engine/timeOfDay.ts`
- [ ] リファクタ(全緑維持)
- [ ] `specs/time-of-day.md` を新規作成し本 spec を反映
- [ ] `specs/data-model.md` の「timeOfDay は 4 値のみ [境界]」シナリオに分類関数への参照を追記
- [ ] `src/engine/index.ts` に公開エクスポートを追加
- [ ] diff.md を更新、この change をアーカイブ

> 注意:
>
> - 人間が spec を承認するまで実装に入らない([要確認] 項目すべて確定要)。
> - 境界値・不正値処理の方針が確定したらシナリオ本文の「[要確認]」を消し、定数値を埋める。

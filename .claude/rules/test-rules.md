# テストのルール(テストはコード前提 = 先に書く)

## ループ厳守:仕様 → テスト → 実装 → テスト

1. spec.md の各シナリオに対し、**失敗するテストを先に書く**(Red)。
2. テストが赤になることを確認する(緑のテストは検証になっていない)。
3. テストを通す**最小実装**(Green)。
4. リファクタ。全テスト緑を維持。

## 対応関係

- spec の1シナリオ = test の1ケース(`it`/`test`)。テスト名にシナリオ名を含める。
  例: `classifies 240 KPM as fast zone`
- 要件ごとに `describe` でグループ化し、spec の見出しと一致させる。
- ランナーは Vitest を想定(`npm test`)。

## 何をテストするか / しないか

- **する**:engine の全シナリオ(カウント、アクティブ時間60秒判定、KPM算出、速度ゾーン分類、トリガー発動、ゾーン別バケット選択、データ契約)、境界、エラー処理。
- **する(非決定側でも)**:「Ollama/VOICEVOX 未起動でもクラッシュせずフォールバックする」「メッセージは30文字以内など契約を満たす」「sd.cpp は同シードで同結果」— これらは決定的なのでテスト対象。
- **しない**:応援文言の面白さ・らしさ、画像の品質、生成レイテンシの良し悪し(→ experiments/ の result.md で測る)。

## 回帰

- バグ修正時は、再現する**失敗テストを先に追加**してから直す。

## 例(実装より先に書く)

```typescript
import { describe, it, expect } from "vitest";
import { classifyZone, isActive } from "../../src/engine/speedZone";

describe("speed-zone", () => {
  it("classifies 240 KPM as fast zone", () => {
    expect(classifyZone(240)).toBe("fast"); // GIVEN/WHEN/THEN
  });

  it("treats keys within 60s as active", () => {
    const last = 1000,
      now = 1000 + 59_000; // GIVEN: 59秒後
    expect(isActive(last, now)).toBe(true); // THEN: まだ入力中
  });

  it("ends session after 60s idle", () => {
    expect(isActive(1000, 1000 + 61_000)).toBe(false); // [境界] 61秒
  });
});
```

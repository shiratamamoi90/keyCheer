// 総合(経路): VOICEVOX が返す話者一覧 → 選べる話者への絞り込み → 選んだ話者のクレジット表記、を 1 本で通す。
// 選択肢に出る話者にはどれも表記があり、表記を組み立てるときに通信が増えないこと(VOICEVOX への 1 回だけ)を見る。
// 総合テストにシナリオ ID は付けない(@.claude/rules/impl-rules.md N-2)。

import { describe, expect, it, vi } from "vitest";
import { fetchSpeakers } from "../../src/main/speakerCatalog.js";
import { buildSpeakerCreditNotice } from "../../src/core/shared/selectableSpeaker.js";

// VOICEVOX ENGINE 0.25.2 が返す形(話者ごとに styles)。選べる話者 4 つとそれ以外を混ぜる
const SPEAKERS_RESPONSE = [
  {
    name: "四国めたん",
    styles: [
      { name: "ノーマル", id: 2 },
      { name: "あまあま", id: 0 },
    ],
  },
  { name: "ずんだもん", styles: [{ name: "ノーマル", id: 3 }] },
  { name: "春日部つむぎ", styles: [{ name: "ノーマル", id: 8 }] },
  { name: "雨晴はう", styles: [{ name: "ノーマル", id: 10 }] },
  { name: "玄野武宏", styles: [{ name: "ノーマル", id: 11 }] },
];

describe("総合: 選べる話者のどれを選んでも、通信を増やさずにクレジット表記が出る", () => {
  it("every selectable speaker returned by VOICEVOX has a credit notice built offline", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(SPEAKERS_RESPONSE)));
    const result = await fetchSpeakers({ fetchFn: fetchFn as unknown as typeof fetch });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 一覧の取得が選べる話者だけに絞る。画面はこれをそのまま選択肢にする
    const options = result.speakers;
    expect(options.map((s) => s.id)).toEqual([2, 8, 10, 11]);

    const notices = options.map((s) => buildSpeakerCreditNotice(s.id));
    expect(notices.every((text) => text !== null && text.includes(`VOICEVOX:`))).toBe(true);
    // 表記を出しても、通信は一覧の取得の 1 回だけ
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

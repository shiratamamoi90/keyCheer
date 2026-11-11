// core/generationMode: 生成を始めたときに、再開するか作り直すかを決める。純粋関数のみ。
// 要件: docs/pool-generation.md「生成を始めたときに、再開するか作り直すかを決める」(論点 0038)

import { describe, it, expect } from "vitest";
import { resolveGenerationMode } from "../../src/core/generationMode.js";
import { ALL_BUCKET_KEYS } from "../../src/core/messagePool.js";

const PROFILE = { name: "チアちゃん", personality: "元気いっぱい", voicevoxSpeakerId: 3 };

type Status = "complete" | "pending" | "failed";

// 全バケットを status にし、overrides で一部だけ変える
function makeCompletion(
  status: Status,
  overrides: Partial<Record<string, Status>> = {},
): Record<string, Status> {
  const completion: Record<string, Status> = Object.fromEntries(
    ALL_BUCKET_KEYS.map((key) => [key, status]),
  );
  return { ...completion, ...overrides } as Record<string, Status>;
}

describe("generationMode / 生成を始めたときに、再開するか作り直すかを決める", () => {
  it("S0038_01 resumes when a bucket is still pending or failed and the profile is unchanged", () => {
    for (const unfinished of ["pending", "failed"] as const) {
      // GIVEN 1 バケットだけ未完了。生成後にプロフィールを変えていない
      const completion = makeCompletion("complete", { fast_milestone_night: unfinished });
      const input = { completion, profile: PROFILE, generatedProfile: { ...PROFILE } };
      const before = structuredClone(input);

      // WHEN 生成を開始するときの扱いを決める
      const mode = resolveGenerationMode(input);

      // THEN 再開する。入力は書き換えない
      expect(mode).toBe("resume");
      expect(input).toEqual(before);
    }
  });

  it("S0038_02 rebuilds from scratch when every bucket is complete", () => {
    // GIVEN 全バケットが complete
    const completion = makeCompletion("complete");

    // WHEN 生成を開始するときの扱いを決める
    const mode = resolveGenerationMode({
      completion,
      profile: PROFILE,
      generatedProfile: { ...PROFILE },
    });

    // THEN 最初から作り直す
    expect(mode).toBe("rebuild");
  });

  it("S0038_03 rebuilds even with pending buckets once the profile changed after generation", () => {
    // GIVEN 未完了のバケットが残り、生成後に性格を変えた
    const completion = makeCompletion("complete", { slow_regular_morning: "pending" });

    // WHEN 生成を開始するときの扱いを決める
    const mode = resolveGenerationMode({
      completion,
      profile: { ...PROFILE, personality: "落ち着いていて丁寧" },
      generatedProfile: { ...PROFILE },
    });

    // THEN 再開せず作り直す
    expect(mode).toBe("rebuild");
  });

  it("S0038_04 resumes a pending pool that has no generated profile", () => {
    // GIVEN 未完了のバケットが残り、generatedProfile を持たない旧いプール
    const completion = makeCompletion("pending", { slow_regular_morning: "complete" });

    // WHEN 生成を開始するときの扱いを決める
    const mode = resolveGenerationMode({
      completion,
      profile: { ...PROFILE, personality: "落ち着いていて丁寧" },
      generatedProfile: undefined,
    });

    // THEN 比べる元が無いので「変えた」と判定せず、再開する
    expect(mode).toBe("resume");
  });
});

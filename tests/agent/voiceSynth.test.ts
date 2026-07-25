import { describe, it, expect, vi } from "vitest";
import { synthesizePoolVoices } from "../../src/agent/voiceSynth.js";
import type { VoiceSynthesizer } from "../../src/engine/providers/types.js";
import type { PoolMessage } from "../../src/engine/messagePool.js";

// spec: specs/integrations.md「全文事前合成」「部分失敗時の許容」
//   各メッセージ 1:1 の wav、失敗分は「wav 欠損」として残しキャラ作成は完了する。

const WAV = new Uint8Array([82, 73, 70, 70]);

function makeSynth(failIds: Set<string> = new Set()): VoiceSynthesizer {
  return {
    id: "local-voicevox",
    synthesize: async ({ text }) => {
      if ([...failIds].some((id) => text.includes(id))) {
        throw new Error("synthesis failed");
      }
      return WAV;
    },
  };
}

function messages(n: number): PoolMessage[] {
  return Array.from({ length: n }, (_, i) => ({ id: `msg-${i}`, text: `text msg-${i}` }));
}

describe("voiceSynth / 全文事前合成", () => {
  it("writes one wav per message, keyed by messageId", async () => {
    const writes: string[] = [];
    const writeWav = vi.fn(async (messageId: string, _bytes: Uint8Array) => {
      writes.push(messageId);
    });
    const result = await synthesizePoolVoices({
      messages: messages(5),
      synthesizer: makeSynth(),
      speakerId: 3,
      timeoutMsPerMessage: 5_000,
      writeWav,
    });

    expect(result.synthesized).toEqual(["msg-0", "msg-1", "msg-2", "msg-3", "msg-4"]);
    expect(result.missing).toEqual([]);
    expect(writeWav).toHaveBeenCalledTimes(5);
    expect(new Set(writes).size).toBe(5); // 1:1 対応
  });

  it("reports progress per message", async () => {
    const progress: Array<[number, number]> = [];
    await synthesizePoolVoices({
      messages: messages(3),
      synthesizer: makeSynth(),
      speakerId: 3,
      timeoutMsPerMessage: 5_000,
      writeWav: async () => {},
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });
});

describe("voiceSynth / 部分失敗時の許容 [異常系]", () => {
  it("collects failed ids as missing and does not throw (5 of 480 may fail)", async () => {
    const failIds = new Set(["msg-1", "msg-3"]);
    const writeWav = vi.fn(async () => {});
    const result = await synthesizePoolVoices({
      messages: messages(6),
      synthesizer: makeSynth(failIds),
      speakerId: 3,
      timeoutMsPerMessage: 5_000,
      writeWav,
    });

    expect(result.missing).toEqual(["msg-1", "msg-3"]); // wav 欠損として残る
    expect(result.synthesized).toEqual(["msg-0", "msg-2", "msg-4", "msg-5"]);
    expect(writeWav).toHaveBeenCalledTimes(4); // 失敗分は書き込まれない
  });

  it("counts write failures as missing too (disk error tolerance)", async () => {
    const writeWav = vi.fn(async (messageId: string) => {
      if (messageId === "msg-0") throw new Error("EACCES");
    });
    const result = await synthesizePoolVoices({
      messages: messages(2),
      synthesizer: makeSynth(),
      speakerId: 3,
      timeoutMsPerMessage: 5_000,
      writeWav,
    });
    expect(result.missing).toEqual(["msg-0"]);
    expect(result.synthesized).toEqual(["msg-1"]);
  });
});

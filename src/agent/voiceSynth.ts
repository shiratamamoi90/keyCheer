// voiceSynth: プール全文の事前 wav 合成オーケストレーション。キャラ作成時のみ実行。
// 合成(VoiceSynthesizer)と書き込み(writeWav)は注入。発動経路はここに依存しない
// (発動時は保存済み wav を再生するだけ)。
// spec: specs/integrations.md「全文事前合成」「部分失敗時の許容」

import type { PoolMessage } from "../engine/messagePool.js";
import type { VoiceSynthesizer } from "../engine/providers/types.js";

export interface SynthesizePoolInput {
  messages: readonly PoolMessage[];
  synthesizer: VoiceSynthesizer;
  speakerId?: number;
  timeoutMsPerMessage: number;
  // messageId → wav 保存(保存先解決は cheerPlayer.resolveWavPath と同一規約)
  writeWav: (messageId: string, bytes: Uint8Array) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
}

export interface SynthesizePoolResult {
  synthesized: string[]; // wav が保存できた messageId
  missing: string[]; // 合成 or 書き込みに失敗した messageId(発動時はテキストのみで吸収)
}

export async function synthesizePoolVoices(
  input: SynthesizePoolInput,
): Promise<SynthesizePoolResult> {
  const { messages, synthesizer, speakerId, timeoutMsPerMessage, writeWav, onProgress } = input;
  const synthesized: string[] = [];
  const missing: string[] = [];
  const total = messages.length;
  let done = 0;

  for (const message of messages) {
    try {
      const bytes = await synthesizer.synthesize({
        text: message.text,
        ...(speakerId !== undefined ? { speakerId } : {}),
        timeoutMs: timeoutMsPerMessage,
      });
      await writeWav(message.id, bytes);
      synthesized.push(message.id);
    } catch {
      // シナリオ: 部分失敗時の許容 — 失敗は wav 欠損として残し、処理は継続する
      missing.push(message.id);
    }
    done++;
    onProgress?.(done, total);
  }

  return { synthesized, missing };
}

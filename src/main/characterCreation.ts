// characterCreation: プール生成 → wav 合成 → 永続化のオーケストレーション。
// spec: 論点 0020
//
// 生成の中身は agent 側(generatePool / synthesizePoolVoices)が持つ。ここは配線と
// 「いつ保存するか」「失敗をどう扱うか」だけを決める。
// プロバイダーと fs はすべて注入 — 実 HTTP も実ファイル書き込みもテストで起こさない。

import { generatePool, isPoolComplete, type PoolGenerationState } from "../agent/poolGenerator.js";
import { synthesizePoolVoices } from "../agent/voiceSynth.js";
import { ALL_BUCKET_KEYS, type MessagePool, type PoolMessage } from "../core/messagePool.js";
import type { TextGenerator, VoiceSynthesizer } from "../core/providers/types.js";
import type { GeneratedBy } from "../core/shared/types.js";
import { savePool, createWavWriter, clearVoices, type CharacterFs } from "./characterStore.js";

export type GenerationPhase = "text" | "voice";

export interface GenerationProgress {
  phase: GenerationPhase;
  done: number;
  total: number;
}

export interface StartGenerationInput {
  characterId: string;
  character: { name: string; personality: string };
  userDataDir: string;
  fs: CharacterFs;
  textGenerator: TextGenerator;
  synthesizer: VoiceSynthesizer;
  speakerId?: number;
  resumeFrom?: PoolGenerationState;
  shouldCancel?: () => boolean;
  onProgress?: (progress: GenerationProgress) => void;
  timeoutMsPerBucket?: number;
  timeoutMsPerMessage?: number;
}

// completed: 欠損なく完了した種別と、実際に使ったプロバイダー ID(論点 0022)。
// 保存は呼び出し側(store.recordGeneratedBy)。runner は store を知らない。
export type GenerationResult =
  | { ok: true; pool: MessagePool; synthesized: number; missing: number; completed: GeneratedBy }
  | {
      ok: false;
      reason: "text-generation-failed" | "cancelled" | "already-running";
      state?: PoolGenerationState;
      // already-running では生成を始めていないので持たない(記録の対象外)
      completed?: GeneratedBy;
    };

export interface GenerationRunner {
  start(input: StartGenerationInput): Promise<GenerationResult>;
  isRunning(): boolean;
  cancel(): void;
}

const DEFAULT_TIMEOUT_MS_PER_MESSAGE = 30_000;

function allMessages(pool: MessagePool): PoolMessage[] {
  const messages: PoolMessage[] = [];
  for (const key of ALL_BUCKET_KEYS) {
    for (const message of pool.buckets[key]) messages.push(message);
  }
  return messages;
}

export function createGenerationRunner(): GenerationRunner {
  let running = false;
  let cancelled = false;

  return {
    isRunning: () => running,
    cancel: () => {
      cancelled = true;
    },

    async start(input: StartGenerationInput): Promise<GenerationResult> {
      // シナリオ: 生成中に再度生成を開始できない [境界]
      if (running) return { ok: false, reason: "already-running" };
      running = true;
      cancelled = false;

      try {
        const shouldCancel = (): boolean => cancelled || (input.shouldCancel?.() ?? false);

        // --- テキスト ---
        const state = await generatePool({
          characterId: input.characterId,
          character: input.character,
          generator: input.textGenerator,
          ...(input.resumeFrom !== undefined ? { resumeFrom: input.resumeFrom } : {}),
          ...(input.timeoutMsPerBucket !== undefined
            ? { timeoutMsPerBucket: input.timeoutMsPerBucket }
            : {}),
          shouldCancel,
          onProgress: (done, total) => input.onProgress?.({ phase: "text", done, total }),
        });

        // 部分結果は必ず残す(再開のため)。完成扱いにはしない。
        savePool(input.fs, input.userDataDir, input.characterId, state);

        if (!isPoolComplete(state)) {
          // シナリオ: 生成を中断して再開する / Ollama 未起動で生成を開始した [異常系]
          // 未完了のまま音声合成へ進まない(中途半端な wav を作らない)。
          return {
            ok: false,
            reason: shouldCancel() ? "cancelled" : "text-generation-failed",
            state,
            // S0022_07 全種別が失敗したら記録しない — テキストが揃わなければ音声にも進まない
            completed: {},
          };
        }

        // --- 音声 ---
        // シナリオ: 既にプールがある状態で再生成 — 古い wav を残さない
        clearVoices(input.fs, input.userDataDir, input.characterId);

        const messages = allMessages(state.pool);
        const { synthesized, missing } = await synthesizePoolVoices({
          messages,
          synthesizer: input.synthesizer,
          ...(input.speakerId !== undefined ? { speakerId: input.speakerId } : {}),
          timeoutMsPerMessage: input.timeoutMsPerMessage ?? DEFAULT_TIMEOUT_MS_PER_MESSAGE,
          writeWav: createWavWriter(input.fs, input.userDataDir, input.characterId),
          onProgress: (done, total) => input.onProgress?.({ phase: "voice", done, total }),
        });

        // シナリオ: VOICEVOX 未起動で音声だけ失敗した / 音声の部分失敗を許容する [境界]
        // wav が 1 本も取れなくてもプールは有効。応援はテキストのみで成立する。
        // S0022_01 テキスト生成の完了で text を記録 / S0022_02 音声合成の完了で voice を記録
        // S0022_03 欠損のある種別は記録しない — 1 本でも欠けたら voice は記録しない。
        // generatedBy は再生成時の参照用なので、欠損したまま「このプロバイダーで作った」と
        // 残すと同じ欠損を再現する余地が残る(論点 0022 理由)。
        // ID は選択値ではなく、実際に呼んだ生成器から取る(S0022_04)。
        const completed: GeneratedBy =
          missing.length === 0
            ? { text: input.textGenerator.id, voice: input.synthesizer.id }
            : { text: input.textGenerator.id };

        return {
          ok: true,
          pool: state.pool,
          synthesized: synthesized.length,
          missing: missing.length,
          completed,
        };
      } finally {
        running = false;
      }
    },
  };
}

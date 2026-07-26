// poolGenerator: キャラ作成時に 24 シナリオ × 約 20 文のメッセージプールを一括生成する
// オーケストレーション。I/O(実際の LLM 呼び出し)は TextGenerator として注入される。
// spec: specs/integrations.md(プール一括生成成功 / 中断と再開 / 進捗 UX / 文字数契約 /
//        Ollama 未起動のフォールバック)
// 品質は縛らない(→ experiments/)。契約(件数・30 字・再開可能性・クラッシュしない)のみ。

import {
  ALL_BUCKET_KEYS,
  type BucketKey,
  type MessagePool,
  type PoolMessage,
} from "../engine/messagePool.js";
import type { TextGenerator } from "../engine/providers/types.js";

export type CompletionStatus = "complete" | "pending" | "failed";

export interface PoolGenerationState {
  pool: MessagePool;
  completion: Record<BucketKey, CompletionStatus>;
}

export interface CharacterProfile {
  name: string;
  personality: string;
}

// 1 文 = 30 文字以内(コードポイント基準。specs/data-model.md)
export const MAX_MESSAGE_LENGTH = 30;
// バケットあたりの生成文数。24 バケット × 8 = 192 文。
// 2026-07-26 に 20(= 480 文)から引き下げた。理由はキャラ作成の所要時間と wav の
// ディスク使用量(480 文だと 16〜32 分 / 約 80MB、192 文なら 7〜13 分 / 約 33MB)。
// 20 という数字は decisions/0007 で [要確認] のまま置かれた未検証の見積もりだった。
// 引き下げにより同じ文を聞く頻度は上がる(1 時間の打鍵で 3〜4 回 → 9 回程度)。
// 「何文なら飽きないか」は指標でしか測れないため、実使用で調整する前提の初期値。
export const MESSAGES_PER_BUCKET = 8;
const DEFAULT_TIMEOUT_MS_PER_BUCKET = 60_000;

export function emptyPoolState(characterId: string): PoolGenerationState {
  const buckets = {} as Record<BucketKey, PoolMessage[]>;
  const completion = {} as Record<BucketKey, CompletionStatus>;
  for (const k of ALL_BUCKET_KEYS) {
    buckets[k] = [];
    completion[k] = "pending";
  }
  return { pool: { characterId, version: 1, buckets }, completion };
}

export function isPoolComplete(state: PoolGenerationState): boolean {
  return ALL_BUCKET_KEYS.every((k) => state.completion[k] === "complete");
}

// システムプロンプト(specs/integrations.md のテンプレート。キャラ設定から自動生成)
export function buildSystemPrompt(
  character: CharacterProfile,
  scenarioKey: BucketKey,
  count: number,
): string {
  return [
    `あなたは「${character.name}」です。`,
    `性格: ${character.personality}`,
    `キーボードを打っている人を応援する短いメッセージを返してください(各 ${MAX_MESSAGE_LENGTH} 文字以内)。`,
    `これから示すシナリオ {${scenarioKey}} に合わせて ${count} 個生成してください。`,
    `速度ゾーンでテンション調整: slow=寄り添う / normal=標準 / fast=勢いを煽る`,
  ].join("\n");
}

// シナリオ: 文字数契約 [境界] — 30 文字超は切り詰め(再生成キューではなく切り詰め方式を採用)
// シナリオ: 要求数を超える応答は切り詰める [境界] — 件数はプロンプトで指示するだけでは
// 守られない(LLM が多く返すことがある)。そのまま採用するとプール総数・生成時間・
// ディスク使用量の見積もりが崩れるため、ここで上限を機械的に効かせる。
// 少ない分は切り上げない(空でなければバケットとして成立するため)。
function sanitizeMessages(raw: string[], limit: number): string[] {
  return raw
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, limit)
    .map((t) => [...t].slice(0, MAX_MESSAGE_LENGTH).join(""));
}

export interface GeneratePoolInput {
  characterId: string;
  character: CharacterProfile;
  generator: TextGenerator;
  messagesPerBucket?: number;
  timeoutMsPerBucket?: number;
  seed?: number;
  // シナリオ: 生成途中の中断と再開 — complete のバケットは再生成しない
  resumeFrom?: PoolGenerationState;
  // シナリオ: 一括生成中の進捗 UX — キャンセルしても部分結果は失われない
  shouldCancel?: () => boolean;
  onProgress?: (completedBuckets: number, totalBuckets: number) => void;
}

export async function generatePool(input: GeneratePoolInput): Promise<PoolGenerationState> {
  const {
    characterId,
    character,
    generator,
    messagesPerBucket = MESSAGES_PER_BUCKET,
    timeoutMsPerBucket = DEFAULT_TIMEOUT_MS_PER_BUCKET,
    seed,
    resumeFrom,
    shouldCancel,
    onProgress,
  } = input;

  const base = resumeFrom ?? emptyPoolState(characterId);
  const buckets = { ...base.pool.buckets };
  const completion = { ...base.completion };
  const total = ALL_BUCKET_KEYS.length;

  for (const key of ALL_BUCKET_KEYS) {
    if (completion[key] === "complete") continue;
    if (shouldCancel?.()) break; // 以降は pending / failed のまま残す(部分結果保持)

    try {
      const raw = await generator.generateMessages({
        systemPrompt: buildSystemPrompt(character, key, messagesPerBucket),
        scenarioKey: key,
        count: messagesPerBucket,
        ...(seed !== undefined ? { seed } : {}),
        timeoutMs: timeoutMsPerBucket,
      });
      const texts = sanitizeMessages(raw, messagesPerBucket);
      if (texts.length === 0) {
        // 全文が空 = 実質失敗。空バケット complete にすると発動時フォールバック頼みになるため failed
        completion[key] = "failed";
      } else {
        // messageId は wav ファイル名に使うため Windows セーフな文字のみ(specs/data-model.md)
        buckets[key] = texts.map((text, i) => ({
          id: `${key}-${String(i).padStart(3, "0")}`,
          text,
        }));
        completion[key] = "complete";
      }
    } catch {
      // シナリオ: Ollama 未起動のフォールバック — クラッシュせず failed で残す
      // (自動で別プロバイダーへは切り替えない。再試行は resumeFrom で)
      completion[key] = "failed";
    }

    const done = ALL_BUCKET_KEYS.filter((k) => completion[k] === "complete").length;
    onProgress?.(done, total);
  }

  return { pool: { characterId, version: 1, buckets }, completion };
}

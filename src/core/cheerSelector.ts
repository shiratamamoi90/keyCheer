// cheerSelector: 発動時に (zone, type, timeOfDay) に対応するプール → 1 文を選ぶ純粋関数。
// 連続回避はセッション内除外方式。バケット欠損時は zone → type → baseline の順でフォールバック。
// {milestone} はテキストのみ補間(wav は事前合成で数値なし)。
// 要件: docs/cheer-trigger.md / 論点 0013

import {
  SPEED_ZONES,
  TIMES_OF_DAY,
  type SpeedZone,
  type CheerType,
  type TimeOfDay,
} from "./shared/types.js";
import { bucketKey, type BucketKey, type MessagePool, type PoolMessage } from "./messagePool.js";
import type { BaselineKey } from "./baseline/messages.js";

export type SelectionSource = "pool" | "fallback-zone" | "fallback-type" | "baseline";

export interface CheerSelectorInput {
  pool: MessagePool | null;
  zone: SpeedZone;
  type: CheerType;
  timeOfDay: TimeOfDay;
  milestone?: number;
  lastMessageIdByBucket: Readonly<Record<string, string | undefined>>;
  baseline: Record<BaselineKey, string[]>;
  random: () => number;
}

export interface CheerSelection {
  messageId: string;
  text: string;
  bucketKey: BucketKey; // 照会キー(ターゲット)
  // 実際に選択したバケット。連続回避の記録は呼び出し側がこのキーで行う:
  //   lastMessageIdByBucket[result.sourceBucketKey] = result.messageId
  // 要件: docs/cheer-trigger.md 論点 0013「記録契約」
  sourceBucketKey: BucketKey;
  source: SelectionSource;
}

// `random` は `[0, 1)` を返す契約(`Math.random()` 互換)。呼び出し側責任。
function pickIndex(length: number, random: () => number): number {
  return Math.floor(random() * length);
}

// シナリオ: 同一文の連続再生を避ける(セッション内除外方式)
// 引数 `messages` は length >= 1 を呼び出し側で保証する。
function pickFromMessages(
  messages: readonly PoolMessage[],
  excludeId: string | undefined,
  random: () => number,
): PoolMessage {
  const filtered = excludeId ? messages.filter((m) => m.id !== excludeId) : null;
  // 除外すると 0 件になる場合は除外を諦めて元配列を使う(1 文しかないバケットの挙動)
  const candidates = filtered && filtered.length > 0 ? filtered : messages;
  return candidates[pickIndex(candidates.length, random)]!;
}

function interpolate(text: string, type: CheerType, milestone: number | undefined): string {
  if (type !== "milestone" || milestone === undefined) return text;
  return text.replace(/\{milestone\}/g, String(milestone));
}

function tryPoolBucket(
  pool: MessagePool,
  key: BucketKey,
  lastId: string | undefined,
  random: () => number,
): PoolMessage | undefined {
  const bucket = pool.buckets[key];
  if (!bucket || bucket.length === 0) return undefined;
  return pickFromMessages(bucket, lastId, random);
}

function tryBaselineBucket(
  baseline: Record<BaselineKey, string[]>,
  key: BucketKey,
  random: () => number,
): { text: string; index: number } | undefined {
  const list = baseline[key];
  if (!list || list.length === 0) return undefined;
  const idx = pickIndex(list.length, random);
  return { text: list[idx]!, index: idx };
}

export function selectCheer(input: CheerSelectorInput): CheerSelection {
  const { pool, zone, type, timeOfDay, milestone, lastMessageIdByBucket, baseline, random } = input;

  const targetKey = bucketKey(zone, type, timeOfDay);

  if (pool !== null) {
    // 1. ターゲットバケット
    // シナリオ: 直接ヒット時は source = target
    const direct = tryPoolBucket(pool, targetKey, lastMessageIdByBucket[targetKey], random);
    if (direct) {
      return {
        messageId: direct.id,
        text: interpolate(direct.text, type, milestone),
        bucketKey: targetKey,
        sourceBucketKey: targetKey,
        source: "pool",
      };
    }

    // 2. シナリオ: 対象バケットが空のときのフォールバック [異常系]
    //    同 (type, timeOfDay) の別ゾーン
    for (const z of SPEED_ZONES) {
      if (z === zone) continue;
      const k = bucketKey(z, type, timeOfDay);
      const m = tryPoolBucket(pool, k, lastMessageIdByBucket[k], random);
      if (m) {
        // シナリオ: ゾーンフォールバック時の選択元
        return {
          messageId: m.id,
          text: interpolate(m.text, type, milestone),
          bucketKey: targetKey,
          sourceBucketKey: k,
          source: "fallback-zone",
        };
      }
    }

    // 3. 同 type の任意バケット(zone × timeOfDay を総当たり)
    for (const z of SPEED_ZONES) {
      for (const d of TIMES_OF_DAY) {
        if (z === zone && d === timeOfDay) continue;
        const k = bucketKey(z, type, d);
        const m = tryPoolBucket(pool, k, lastMessageIdByBucket[k], random);
        if (m) {
          // シナリオ: type フォールバック時の選択元
          return {
            messageId: m.id,
            text: interpolate(m.text, type, milestone),
            bucketKey: targetKey,
            sourceBucketKey: k,
            source: "fallback-type",
          };
        }
      }
    }
  }

  // 4. baseline 定型文(同梱)
  //    シナリオ: キャラ未作成時の発動 [異常系]
  // シナリオ: baseline 選択時の選択元(実際に参照した baseline キー)
  const direct = tryBaselineBucket(baseline, targetKey, random);
  if (direct) {
    return {
      messageId: `baseline:${targetKey}:${direct.index}`,
      text: interpolate(direct.text, type, milestone),
      bucketKey: targetKey,
      sourceBucketKey: targetKey,
      source: "baseline",
    };
  }

  // 同 type の baseline を順に探す(構造化探索、文字列パターン依存を排除)
  for (const z of SPEED_ZONES) {
    for (const d of TIMES_OF_DAY) {
      const k = bucketKey(z, type, d);
      const fallback = tryBaselineBucket(baseline, k, random);
      if (fallback) {
        return {
          messageId: `baseline:${k}:${fallback.index}`,
          text: interpolate(fallback.text, type, milestone),
          bucketKey: targetKey,
          sourceBucketKey: k,
          source: "baseline",
        };
      }
    }
  }

  // 完全に何も無い場合の最終フォールバック(契約: クラッシュしない)
  return {
    messageId: "baseline:empty",
    text: "",
    bucketKey: targetKey,
    sourceBucketKey: targetKey,
    source: "baseline",
  };
}
